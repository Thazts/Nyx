use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::State;

use crate::state::{AppState, FileRecord};

#[derive(Serialize)]
pub struct FileMetadata {
    pub size: u64,
    pub modified: String,
}

fn SkipDir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | "target"
            | "__pycache__"
            | ".next"
            | "dist"
            | "build"
            | ".svelte-kit"
            | ".venv"
            | "venv"
            | "vendor"
            | ".idea"
            | ".vscode"
            | "aider"
    ) || name.starts_with(".aider")
}

fn NormalizePath(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn WorkspaceRoot(app_state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let workspace = app_state
        .workspace_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("No workspace selected")?;
    let root = fs::canonicalize(&workspace).map_err(|e| format!("Invalid workspace: {e}"))?;
    if !root.is_dir() {
        return Err("Workspace is not a directory".to_string());
    }
    Ok(root)
}

fn ResolveWorkspacePath(path: &str, app_state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let root = WorkspaceRoot(app_state)?;
    let raw = Path::new(path);
    let candidate = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        root.join(raw)
    };
    let canonical = fs::canonicalize(&candidate).map_err(|e| format!("Path not found: {e}"))?;
    if !canonical.starts_with(&root) {
        return Err("Path is outside the selected workspace".to_string());
    }
    Ok(canonical)
}

fn ResolveWorkspaceWritePath(
    path: &str,
    app_state: &State<'_, AppState>,
) -> Result<PathBuf, String> {
    let root = WorkspaceRoot(app_state)?;
    let raw = Path::new(path);
    let candidate = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        root.join(raw)
    };

    if candidate.exists() {
        let canonical =
            fs::canonicalize(&candidate).map_err(|e| format!("Invalid write path: {e}"))?;
        if !canonical.starts_with(&root) {
            return Err("Path is outside the selected workspace".to_string());
        }
        return Ok(canonical);
    }

    let normalized = NormalizePath(&candidate);
    if !normalized.starts_with(&root) {
        return Err("Path is outside the selected workspace".to_string());
    }
    Ok(normalized)
}

fn SetWorkspace(
    path: PathBuf,
    app_state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    let WorkspacePath = fs::canonicalize(&path)
        .map_err(|e| format!("Invalid workspace path: {e}"))?
        .to_string_lossy()
        .to_string();
    if !Path::new(&WorkspacePath).is_dir() {
        return Err("Workspace path is not a directory".to_string());
    }
    *app_state.workspace_path.lock().map_err(|e| e.to_string())? = Some(WorkspacePath.clone());
    if let Ok(mut guard) = app_state.watcher_shutdown.lock() {
        if let Some(old) = guard.take() {
            let _ = old.send(());
        }
    }
    let shutdown_tx = spawn_workspace_watcher(WorkspacePath.clone(), window);
    if let Ok(mut guard) = app_state.watcher_shutdown.lock() {
        *guard = Some(shutdown_tx);
    }

    Ok(WorkspacePath)
}

fn ListFilesRecursivePath(path: &Path) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let EntryPath = entry.path();
        let name = EntryPath
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if EntryPath.is_file() {
            result.push(EntryPath.to_string_lossy().to_string());
        } else if EntryPath.is_dir() && !SkipDir(&name) {
            let SubFiles = ListFilesRecursivePath(&EntryPath)?;
            result.extend(SubFiles);
        }
    }
    result.sort();
    Ok(result)
}

#[tauri::command]
pub fn list_files(path: String, app_state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let path = ResolveWorkspacePath(&path, &app_state)?;
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name() {
                files.push(name.to_string_lossy().to_string());
            }
        }
    }
    files.sort();
    Ok(files)
}

#[tauri::command]
pub fn list_files_recursive(
    path: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let path = ResolveWorkspacePath(&path, &app_state)?;
    ListFilesRecursivePath(&path)
}

#[tauri::command]
pub fn open_file(path: String, app_state: State<'_, AppState>) -> Result<String, String> {
    let path = ResolveWorkspacePath(&path, &app_state)?;
    let PathText = path.to_string_lossy().to_string();
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    {
        let mut OpenFiles = app_state.open_files.lock().map_err(|e| e.to_string())?;
        if !OpenFiles.iter().any(|p| p == &PathText) {
            OpenFiles.push(PathText.clone());
        }
    }
    *app_state.active_file.lock().map_err(|e| e.to_string())? = Some(PathText);
    Ok(content)
}

#[tauri::command]
pub fn save_file(
    path: String,
    content: String,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let path = ResolveWorkspaceWritePath(&path, &app_state)?;
    let PathText = path.to_string_lossy().to_string();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    let metadata = ReadFileMetadata(&PathText)?;
    app_state
        .file_metadata
        .lock()
        .map_err(|e| e.to_string())?
        .insert(
            PathText.clone(),
            FileRecord {
                size: metadata.size,
                modified: metadata.modified,
            },
        );
    {
        let mut OpenFiles = app_state.open_files.lock().map_err(|e| e.to_string())?;
        if !OpenFiles.iter().any(|p| p == &PathText) {
            OpenFiles.push(PathText.clone());
        }
    }
    *app_state.active_file.lock().map_err(|e| e.to_string())? = Some(PathText);
    Ok(())
}

#[tauri::command]
pub fn run_terminal_command(command: String, app_state: State<'_, AppState>) -> Vec<String> {
    let cwd = match WorkspaceRoot(&app_state) {
        Ok(path) => path,
        Err(e) => return vec![format!("$ {}", command), format!("err: {}", e)],
    };
    let output = std::process::Command::new("cmd")
        .args(["/C", &command])
        .current_dir(cwd)
        .output();
    let lines = match output {
        Ok(out) => {
            let mut lines = vec![format!("$ {}", command)];
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                let t = line.trim_end_matches('\r');
                if !t.is_empty() {
                    lines.push(t.to_string());
                }
            }
            let stderr = String::from_utf8_lossy(&out.stderr);
            for line in stderr.lines() {
                let t = line.trim_end_matches('\r');
                if !t.is_empty() {
                    lines.push(format!("err: {}", t));
                }
            }
            lines
        }
        Err(e) => vec![format!("$ {}", command), format!("err: {}", e)],
    };
    if let Ok(mut terminal_output) = app_state.terminal_output.lock() {
        terminal_output.extend(lines.clone());
    }
    lines
}

fn spawn_workspace_watcher(path: String, window: tauri::Window) -> std::sync::mpsc::SyncSender<()> {
    let (shutdown_tx, shutdown_rx) = std::sync::mpsc::sync_channel::<()>(1);
    let (event_tx, event_rx) = std::sync::mpsc::channel::<()>();

    let watcher_result = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            match event.kind {
                notify::EventKind::Create(_) | notify::EventKind::Remove(_) => {
                    let _ = event_tx.send(());
                }
                _ => {}
            }
        }
    });

    match watcher_result {
        Ok(mut w) => {
            if w.watch(std::path::Path::new(&path), RecursiveMode::Recursive)
                .is_ok()
            {
                std::thread::spawn(move || {
                    let _w = w;
                    loop {
                        if shutdown_rx.try_recv().is_ok() {
                            break;
                        }
                        match event_rx.recv_timeout(std::time::Duration::from_millis(200)) {
                            Ok(_) => {
                                loop {
                                    match event_rx
                                        .recv_timeout(std::time::Duration::from_millis(400))
                                    {
                                        Ok(_) => {}
                                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
                                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                                            return
                                        }
                                    }
                                    if shutdown_rx.try_recv().is_ok() {
                                        return;
                                    }
                                }
                                if shutdown_rx.try_recv().is_ok() {
                                    break;
                                }
                                let _ = window.emit("workspace_changed", ());
                            }
                            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                        }
                    }
                });
            }
        }
        Err(e) => eprintln!("[nyx] watcher error: {e}"),
    }

    shutdown_tx
}

#[tauri::command]
pub fn select_folder(
    app_state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    let dialog = rfd::FileDialog::new().pick_folder();
    match dialog {
        Some(path) => SetWorkspace(path, app_state, window),
        None => Err("No folder selected".to_string()),
    }
}

#[tauri::command]
pub fn open_workspace(
    path: String,
    app_state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    SetWorkspace(PathBuf::from(path), app_state, window)
}

#[tauri::command]
pub fn get_file_metadata(
    path: String,
    app_state: State<'_, AppState>,
) -> Result<FileMetadata, String> {
    let path = ResolveWorkspacePath(&path, &app_state)?;
    let PathText = path.to_string_lossy().to_string();
    let metadata = ReadFileMetadata(&PathText)?;
    app_state
        .file_metadata
        .lock()
        .map_err(|e| e.to_string())?
        .insert(
            PathText,
            FileRecord {
                size: metadata.size,
                modified: metadata.modified.clone(),
            },
        );
    Ok(metadata)
}

pub fn ReadFileMetadata(path: &str) -> Result<FileMetadata, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let size = meta.len();
    let modified = meta
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let secs = modified as i64;
    let (year, month, day, hour, min, sec) = SecsToDatetime(secs);
    let ModifiedStr = format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        year, month, day, hour, min, sec
    );

    Ok(FileMetadata {
        size,
        modified: ModifiedStr,
    })
}

fn SecsToDatetime(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = secs / 86400;

    let mut year = 1970i32;
    let mut remaining = days;
    loop {
        let dy = if IsLeap(year) { 366 } else { 365 };
        if remaining < dy {
            break;
        }
        remaining -= dy;
        year += 1;
    }
    let months = if IsLeap(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1u32;
    for dm in &months {
        if remaining < *dm {
            break;
        }
        remaining -= *dm;
        month += 1;
    }
    (
        year,
        month,
        remaining as u32 + 1,
        h as u32,
        m as u32,
        s as u32,
    )
}

fn IsLeap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

#[tauri::command]
pub fn capture_command(
    command: String,
    cwd: String,
    app_state: State<'_, AppState>,
) -> Vec<String> {
    let cwd = match ResolveWorkspacePath(&cwd, &app_state) {
        Ok(path) if path.is_dir() => path,
        Ok(_) => return vec!["err: cwd is not a directory".to_string()],
        Err(e) => return vec![format!("err: {}", e)],
    };
    let output = std::process::Command::new("cmd")
        .args(["/C", &command])
        .current_dir(&cwd)
        .output();

    match output {
        Ok(out) => {
            let mut lines = Vec::new();
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                let t = line.trim_end_matches('\r');
                if !t.is_empty() {
                    lines.push(t.to_string());
                }
            }
            let stderr = String::from_utf8_lossy(&out.stderr);
            for line in stderr.lines() {
                let t = line.trim_end_matches('\r');
                if !t.is_empty() {
                    lines.push(format!("err: {}", t));
                }
            }
            if lines.is_empty() {
                lines.push("(no output)".to_string());
            }
            lines
        }
        Err(e) => vec![format!("err: {}", e)],
    }
}

#[tauri::command]
pub fn delete_path(path: String, app_state: State<'_, AppState>) -> Result<(), String> {
    let path = ResolveWorkspacePath(&path, &app_state)?;
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let IsDir = meta.is_dir();
    if meta.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    let DeletedPath = PathBuf::from(&path);
    app_state
        .open_files
        .lock()
        .map_err(|e| e.to_string())?
        .retain(|OpenPath| !PathMatchesTarget(OpenPath, &DeletedPath, IsDir));
    app_state
        .file_metadata
        .lock()
        .map_err(|e| e.to_string())?
        .retain(|file_path, _| !PathMatchesTarget(file_path, &DeletedPath, IsDir));
    let mut ActiveFile = app_state.active_file.lock().map_err(|e| e.to_string())?;
    if ActiveFile
        .as_ref()
        .map(|active| PathMatchesTarget(active, &DeletedPath, IsDir))
        .unwrap_or(false)
    {
        *ActiveFile = None;
    }
    Ok(())
}

#[tauri::command]
pub fn rename_path(
    path: String,
    new_name: String,
    app_state: State<'_, AppState>,
) -> Result<String, String> {
    if Path::new(&new_name).file_name().and_then(|n| n.to_str()) != Some(new_name.as_str()) {
        return Err("New name must not contain path separators".to_string());
    }
    let old = ResolveWorkspacePath(&path, &app_state)?;
    let parent = old.parent().ok_or("No parent directory")?;
    let new = parent.join(&new_name);
    let NewChecked = ResolveWorkspaceWritePath(&new.to_string_lossy(), &app_state)?;
    let IsDir = fs::metadata(&old).map_err(|e| e.to_string())?.is_dir();
    fs::rename(&old, &NewChecked).map_err(|e| e.to_string())?;
    let NewPath = NewChecked.to_string_lossy().to_string();
    {
        let mut OpenFiles = app_state.open_files.lock().map_err(|e| e.to_string())?;
        for OpenPath in OpenFiles.iter_mut() {
            if let Some(rebased) = RebasePath(OpenPath, &old, &NewChecked, IsDir) {
                *OpenPath = rebased;
            }
        }
    }
    {
        let mut ActiveFile = app_state.active_file.lock().map_err(|e| e.to_string())?;
        if let Some(active) = ActiveFile
            .as_ref()
            .and_then(|value| RebasePath(value, &old, &NewChecked, IsDir))
        {
            *ActiveFile = Some(active);
        }
    }
    {
        let mut metadata = app_state.file_metadata.lock().map_err(|e| e.to_string())?;
        let entries: Vec<(String, FileRecord)> = metadata.drain().collect();
        for (file_path, record) in entries {
            let key = RebasePath(&file_path, &old, &NewChecked, IsDir).unwrap_or(file_path);
            metadata.insert(key, record);
        }
    }
    Ok(NewPath)
}

#[tauri::command]
pub fn create_folder(path: String, app_state: State<'_, AppState>) -> Result<(), String> {
    let path = ResolveWorkspaceWritePath(&path, &app_state)?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

fn PathMatchesTarget(value: &str, target: &Path, target_is_dir: bool) -> bool {
    let candidate = Path::new(value);
    if target_is_dir {
        candidate.starts_with(target)
    } else {
        candidate == target
    }
}

fn RebasePath(value: &str, old: &Path, new: &Path, old_is_dir: bool) -> Option<String> {
    let candidate = Path::new(value);
    if old_is_dir {
        let suffix = candidate.strip_prefix(old).ok()?;
        return Some(new.join(suffix).to_string_lossy().to_string());
    }
    if candidate == old {
        return Some(new.to_string_lossy().to_string());
    }
    None
}
