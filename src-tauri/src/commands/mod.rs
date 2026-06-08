pub mod agent;

use mlua::{Lua, MultiValue as LuaMultiValue, Table as LuaTable, Value as LuaValue};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use sysinfo::System;
use notify::{RecursiveMode, Watcher};
use tauri::{AppHandle, State};

use crate::renderer::{window as nyx_window, NyxRenderer};
use crate::state::{AppState, FileRecord};

const ROBLOX_SHIM: &str = include_str!("../../nyx_runtime/roblox/init.lua");
const UNITY_SHIM: &str = include_str!("../../nyx_runtime/unity/init.cs");
const UNREAL_SHIM: &str = include_str!("../../nyx_runtime/unreal/init.cpp");

static SYS_MONITOR: OnceLock<Mutex<System>> = OnceLock::new();

#[derive(Serialize)]
pub struct SystemStats {
    pub cpu_usage: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    pub process_memory_mb: u64,
}

#[tauri::command]
pub fn get_system_stats() -> SystemStats {
    let monitor = SYS_MONITOR.get_or_init(|| Mutex::new(System::new_all()));
    let mut sys = monitor.lock().unwrap_or_else(|e| e.into_inner());
    sys.refresh_all();

    let CpuUsage = sys.global_cpu_usage();
    let MemoryUsedMb = sys.used_memory() / (1024 * 1024);
    let MemoryTotalMb = sys.total_memory() / (1024 * 1024);
    let CurrentPid = sysinfo::Pid::from(std::process::id() as usize);
    let ProcessMemoryMb = sys
        .process(CurrentPid)
        .map(|p| p.memory() / (1024 * 1024))
        .unwrap_or(0);

    SystemStats {
        cpu_usage: CpuUsage,
        memory_used_mb: MemoryUsedMb,
        memory_total_mb: MemoryTotalMb,
        process_memory_mb: ProcessMemoryMb,
    }
}

#[derive(Serialize)]
pub struct FileMetadata {
    pub size: u64,
    pub modified: String,
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct AppStateSnapshot {
    pub workspace_path: Option<String>,
    pub open_files: Vec<String>,
    pub active_file: Option<String>,
    pub file_metadata: std::collections::HashMap<String, FileRecord>,
    pub terminal_output: Vec<String>,
    pub run_output: Vec<String>,
    pub is_running: bool,
    pub scene_profile: Option<String>,
    pub scene_commands: Vec<serde_json::Value>,
    pub selected_part_id: Option<String>,
    pub gizmo_mode: String,
    pub viewport_visible: bool,
    pub ai_activity: Option<String>,
    pub ai_pending_approval: Option<String>,
}

#[tauri::command]
pub fn get_app_state_snapshot(app_state: State<'_, AppState>) -> Result<AppStateSnapshot, String> {
    Ok(AppStateSnapshot {
        workspace_path: app_state
            .workspace_path
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
        open_files: app_state
            .open_files
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
        active_file: app_state
            .active_file
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
        file_metadata: app_state
            .file_metadata
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
        terminal_output: app_state
            .terminal_output
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
        run_output: app_state
            .run_output
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
        is_running: *app_state.is_running.lock().map_err(|e| e.to_string())?,
        scene_profile: app_state
            .scene_profile
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
        scene_commands: app_state
            .scene_commands
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
        selected_part_id: app_state
            .selected_part_id
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
        gizmo_mode: app_state
            .gizmo_mode
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
        viewport_visible: *app_state
            .viewport_visible
            .lock()
            .map_err(|e| e.to_string())?,
        ai_activity: app_state
            .ai_activity
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
        ai_pending_approval: app_state
            .ai_pending_approval
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
    })
}

#[tauri::command]
pub fn list_files(path: String) -> Result<Vec<String>, String> {
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

#[tauri::command]
pub fn list_files_recursive(path: String) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
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
            let SubFiles = list_files_recursive(EntryPath.to_string_lossy().to_string())?;
            result.extend(SubFiles);
        }
    }
    result.sort();
    Ok(result)
}

#[tauri::command]
pub fn open_file(path: String, app_state: State<'_, AppState>) -> Result<String, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    {
        let mut OpenFiles = app_state.open_files.lock().map_err(|e| e.to_string())?;
        if !OpenFiles.iter().any(|p| p == &path) {
            OpenFiles.push(path.clone());
        }
    }
    *app_state.active_file.lock().map_err(|e| e.to_string())? = Some(path);
    Ok(content)
}

#[tauri::command]
pub fn save_file(
    path: String,
    content: String,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    let metadata = ReadFileMetadata(&path)?;
    app_state
        .file_metadata
        .lock()
        .map_err(|e| e.to_string())?
        .insert(
            path.clone(),
            FileRecord {
                size: metadata.size,
                modified: metadata.modified,
            },
        );
    {
        let mut OpenFiles = app_state.open_files.lock().map_err(|e| e.to_string())?;
        if !OpenFiles.iter().any(|p| p == &path) {
            OpenFiles.push(path.clone());
        }
    }
    *app_state.active_file.lock().map_err(|e| e.to_string())? = Some(path);
    Ok(())
}

#[tauri::command]
pub fn run_terminal_command(command: String, app_state: State<'_, AppState>) -> Vec<String> {
    let output = std::process::Command::new("cmd")
        .args(["/C", &command])
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

fn spawn_workspace_watcher(
    path: String,
    window: tauri::Window,
) -> std::sync::mpsc::SyncSender<()> {
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
            if w.watch(std::path::Path::new(&path), RecursiveMode::Recursive).is_ok() {
                std::thread::spawn(move || {
                    let _w = w;
                    loop {
                        if shutdown_rx.try_recv().is_ok() { break; }
                        match event_rx.recv_timeout(std::time::Duration::from_millis(200)) {
                            Ok(_) => {
                                loop {
                                    match event_rx.recv_timeout(std::time::Duration::from_millis(400)) {
                                        Ok(_) => {}
                                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
                                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                                    }
                                    if shutdown_rx.try_recv().is_ok() { return; }
                                }
                                if shutdown_rx.try_recv().is_ok() { break; }
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
        Some(path) => {
            let WorkspacePath = path.to_string_lossy().to_string();
            *app_state.workspace_path.lock().map_err(|e| e.to_string())? =
                Some(WorkspacePath.clone());
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
        None => Err("No folder selected".to_string()),
    }
}

#[tauri::command]
pub fn get_file_metadata(
    path: String,
    app_state: State<'_, AppState>,
) -> Result<FileMetadata, String> {
    let metadata = ReadFileMetadata(&path)?;
    app_state
        .file_metadata
        .lock()
        .map_err(|e| e.to_string())?
        .insert(
            path,
            FileRecord {
                size: metadata.size,
                modified: metadata.modified.clone(),
            },
        );
    Ok(metadata)
}

fn ReadFileMetadata(path: &str) -> Result<FileMetadata, String> {
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
pub fn capture_command(command: String, cwd: String) -> Vec<String> {
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
pub fn run_file(path: String, app_state: State<'_, AppState>) -> Vec<String> {
    if let Ok(mut is_running) = app_state.is_running.lock() {
        *is_running = true;
    }
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let lines = match ext.as_str() {
        "lua" | "luau" => RunLuaEmbedded(&path),
        "py" => RunSubprocess("python", &path),
        "js" => RunSubprocess("node", &path),
        _ => vec![format!("No runner configured for .{} files", ext)],
    };
    if let Ok(mut run_output) = app_state.run_output.lock() {
        *run_output = lines.clone();
    }
    if let Ok(mut is_running) = app_state.is_running.lock() {
        *is_running = false;
    }
    lines
}

fn RunLuaEmbedded(path: &str) -> Vec<String> {
    let code = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            return vec![
                format!("\u{25b6} {}", path),
                format!("err: {}", e),
                "exit 1".to_string(),
            ]
        }
    };

    let lua = Lua::new();
    let lines = Arc::new(Mutex::new(vec![format!("\u{25b6} {}", path)]));
    let sink = Arc::clone(&lines);

    if let Ok(f) = lua.create_function(move |_, args: LuaMultiValue| {
        let Text = args.iter().map(LuaDisplay).collect::<Vec<_>>().join("\t");
        sink.lock().unwrap().push(Text);
        Ok(())
    }) {
        let _ = lua.globals().set("print", f);
    }

    if let Err(e) = lua.load(ROBLOX_SHIM).exec() {
        let mut l = lines.lock().unwrap();
        l.push(format!("err: runtime shim: {}", e));
        l.push("exit 1".to_string());
        return l.clone();
    }

    match lua.load(&code).exec() {
        Ok(_) => lines.lock().unwrap().push("exit 0".to_string()),
        Err(e) => {
            let mut l = lines.lock().unwrap();
            l.push(format!("err: {}", e));
            l.push("exit 1".to_string());
        }
    }

    let result = lines.lock().unwrap().clone();
    result
}

fn RunSubprocess(program: &str, path: &str) -> Vec<String> {
    let mut lines = vec![format!("\u{25b6} {}", path)];
    match std::process::Command::new(program).arg(path).output() {
        Ok(out) => {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                lines.push(line.to_string());
            }
            if !out.stderr.is_empty() {
                for line in String::from_utf8_lossy(&out.stderr).lines() {
                    lines.push(format!("err: {}", line));
                }
            }
            lines.push(format!("exit {}", out.status.code().unwrap_or(-1)));
        }
        Err(e) => {
            lines.push(format!("err: {} not found in PATH", program));
            lines.push(format!("    {}", e));
            lines.push("exit -1".to_string());
        }
    }
    lines
}

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct RunSceneResult {
    pub commands: Vec<serde_json::Value>,
    pub terminal: Vec<String>,
    pub errors: Vec<String>,
    pub skipped: bool,
}

#[tauri::command]
pub fn run_scene(path: String, profile: String) -> Result<RunSceneResult, String> {
    RunSceneAtTime(path, profile, None)
}

#[tauri::command]
pub fn run_live_scene(
    path: String,
    profile: String,
    elapsed: f64,
    renderer: State<'_, RendererState>,
) -> Result<RunSceneResult, String> {
    {
        let r = renderer.lock().map_err(|e| e.to_string())?;
        let s = r.state.lock().map_err(|e| e.to_string())?;
        if s.last_interaction.elapsed() < std::time::Duration::from_millis(140) {
            return Ok(RunSceneResult {
                commands: Vec::new(),
                terminal: Vec::new(),
                errors: Vec::new(),
                skipped: true,
            });
        }
    }
    RunSceneAtTime(path, profile, Some(elapsed))
}

fn RunSceneAtTime(
    path: String,
    profile: String,
    elapsed: Option<f64>,
) -> Result<RunSceneResult, String> {
    let profile = ResolveSceneProfile(&path, &profile);
    let UserCode =
        fs::read_to_string(&path).map_err(|e| format!("Cannot read scene file: {}", e))?;

    match profile.as_str() {
        "roblox" => RunLuaSceneAtTime(&path, &UserCode, elapsed),
        "unity" => TryRunCSharpScene(&path, &UserCode, elapsed).or_else(|e| {
            RunEmbeddedSceneCommands(&path, &UserCode, "Unity C# shim", UNITY_SHIM)
                .map_err(|je| format!("{e}\nFallback (@nyx-scene): {je}"))
        }),
        "unreal" => TryRunCppScene(&path, &UserCode, elapsed).or_else(|e| {
            RunEmbeddedSceneCommands(&path, &UserCode, "Unreal C++ shim", UNREAL_SHIM)
                .map_err(|je| format!("{e}\nFallback (@nyx-scene): {je}"))
        }),
        other => Err(format!("Unknown engine profile: '{}'", other)),
    }
}

fn RunLuaSceneAtTime(
    path: &str,
    UserCode: &str,
    elapsed: Option<f64>,
) -> Result<RunSceneResult, String> {
    let lua = Lua::new();
    let captured = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = Arc::clone(&captured);

    let PrintFn = lua
        .create_function(move |_, args: LuaMultiValue| {
            let Text = args.iter().map(LuaDisplay).collect::<Vec<_>>().join("\t");
            sink.lock().unwrap().push(Text);
            Ok(())
        })
        .map_err(|e| e.to_string())?;
    lua.globals()
        .set("print", PrintFn)
        .map_err(|e| e.to_string())?;
    if let Some(elapsed) = elapsed {
        lua.globals()
            .set("_NYX_LIVE_TIME", elapsed)
            .map_err(|e| e.to_string())?;
    }

    lua.load(ROBLOX_SHIM)
        .exec()
        .map_err(|e| format!("Runtime shim error: {}", e))?;

    let mut errors = Vec::new();
    if let Err(e) = lua.load(UserCode).exec() {
        errors.push(e.to_string());
    }
    if let Some(elapsed) = elapsed {
        match lua.globals().get::<mlua::Function>("_nyx_step_live") {
            Ok(step_live) => {
                if let Err(e) = step_live.call::<()>(elapsed) {
                    errors.push(e.to_string());
                }
            }
            Err(e) => errors.push(e.to_string()),
        }
    }

    let (commands, cmd_err) = match ReadNyxCommands(&lua) {
        Ok(cmds) => (cmds, None),
        Err(e) => (vec![], Some(e)),
    };
    if let Some(e) = cmd_err {
        errors.push(format!("_NYX_COMMANDS read error: {}", e));
    }

    let mut terminal = captured.lock().unwrap().clone();
    if terminal.is_empty() {
        terminal.push(format!("runtime: Roblox Luau shim ({})", path));
    }

    Ok(RunSceneResult {
        commands,
        terminal,
        errors,
        skipped: false,
    })
}

fn RunEmbeddedSceneCommands(
    path: &str,
    UserCode: &str,
    shim_label: &str,
    shim_source: &str,
) -> Result<RunSceneResult, String> {
    let JsonText = ExtractNyxSceneJson(UserCode).map_err(|e| format!("{}: {}", path, e))?;
    let value: serde_json::Value = serde_json::from_str(JsonText)
        .map_err(|e| format!("{}: invalid @nyx-scene JSON: {}", path, e))?;
    let commands = match value {
        serde_json::Value::Array(items) => items,
        other => vec![other],
    };

    Ok(RunSceneResult {
        commands,
        terminal: vec![
            format!("runtime: {}", shim_label),
            format!("shim bytes: {}", shim_source.len()),
            "@nyx-scene command block loaded".to_string(),
        ],
        errors: Vec::new(),
        skipped: false,
    })
}

static DOTNET_AVAILABLE: OnceLock<bool> = OnceLock::new();
static CPP_COMPILER_CMD: OnceLock<Option<&'static str>> = OnceLock::new();
static SCENE_EXE_CACHE: OnceLock<Mutex<std::collections::HashMap<String, (u64, PathBuf)>>> =
    OnceLock::new();

fn SceneExeCache() -> &'static Mutex<std::collections::HashMap<String, (u64, PathBuf)>> {
    SCENE_EXE_CACHE.get_or_init(|| Mutex::new(Default::default()))
}

fn NyxTempBuildDir() -> PathBuf {
    let d = std::env::temp_dir().join("nyx_scene_build");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn IsDotnetAvailable() -> bool {
    *DOTNET_AVAILABLE.get_or_init(|| {
        std::process::Command::new("dotnet")
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    })
}

fn CppCompiler() -> Option<&'static str> {
    *CPP_COMPILER_CMD.get_or_init(|| {
        for &cmd in &["g++", "clang++"] {
            let ok = std::process::Command::new(cmd)
                .arg("--version")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok();
            if ok {
                return Some(cmd);
            }
        }
        if std::process::Command::new("cl")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok()
        {
            return Some("cl");
        }
        None
    })
}

fn SourceHash(shim: &str, code: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in shim.as_bytes().iter().chain(code.as_bytes()) {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn TryRunCSharpScene(
    path: &str,
    UserCode: &str,
    elapsed: Option<f64>,
) -> Result<RunSceneResult, String> {
    if !IsDotnetAvailable() {
        return Err(
            "No C# compiler: dotnet SDK not found in PATH. \
             Install the .NET SDK or add a @nyx-scene block."
                .to_string(),
        );
    }

    let hash = SourceHash(UNITY_SHIM, UserCode);
    let cached_exe = {
        let cache = SceneExeCache().lock().unwrap();
        if let Some((h, p)) = cache.get(path) {
            if *h == hash && p.exists() {
                Some(p.clone())
            } else {
                None
            }
        } else {
            None
        }
    };

    let ExePath = match cached_exe {
        Some(p) => p,
        None => {
            let p = CompileCSharp(UserCode, hash)?;
            SceneExeCache()
                .lock()
                .unwrap()
                .insert(path.to_string(), (hash, p.clone()));
            p
        }
    };

    RunCompiledScene(&ExePath, elapsed, "Unity C# (dotnet)")
}

fn CompileCSharp(UserCode: &str, hash: u64) -> Result<PathBuf, String> {
    let BuildDir = NyxTempBuildDir().join(format!("cs_{:016x}", hash));
    std::fs::create_dir_all(&BuildDir).map_err(|e| format!("mkdir: {e}"))?;

    std::fs::write(BuildDir.join("NyxShim.cs"), UNITY_SHIM)
        .map_err(|e| format!("write shim: {e}"))?;

    let SceneCs = format!(
        "using UnityEngine;\n\
         double __elapsed = args.Length > 0\n\
             ? double.Parse(args[0], \
               System.Globalization.CultureInfo.InvariantCulture)\n\
             : 0.0;\n\
         {}\n\
         Console.Write(NyxRuntime.CommandsToJson());\n",
        UserCode
    );
    std::fs::write(BuildDir.join("NyxScene.cs"), &SceneCs)
        .map_err(|e| format!("write scene: {e}"))?;

    std::fs::write(
        BuildDir.join("NyxScene.csproj"),
        concat!(
            "<Project Sdk=\"Microsoft.NET.Sdk\">\n",
            "  <PropertyGroup>\n",
            "    <OutputType>Exe</OutputType>\n",
            "    <TargetFramework>net8.0</TargetFramework>\n",
            "    <Nullable>disable</Nullable>\n",
            "    <ImplicitUsings>disable</ImplicitUsings>\n",
            "    <NoWarn>CS0219;CS8600;CS8602;CS8604</NoWarn>\n",
            "  </PropertyGroup>\n",
            "</Project>\n",
        ),
    )
    .map_err(|e| format!("write csproj: {e}"))?;

    let out = std::process::Command::new("dotnet")
        .args([
            "build",
            "--output",
            BuildDir.to_str().unwrap_or("."),
            "--configuration",
            "Release",
            "--nologo",
            "-v",
            "quiet",
        ])
        .current_dir(&BuildDir)
        .output()
        .map_err(|e| format!("dotnet build: {e}"))?;

    if !out.status.success() {
        return Err(format!(
            "C# compile error:\n{}{}",
            String::from_utf8_lossy(&out.stdout).trim(),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    for name in &["NyxScene.exe", "NyxScene", "NyxScene.dll"] {
        let p = BuildDir.join(name);
        if p.exists() {
            return Ok(p);
        }
    }
    Err(format!("C# compile: no output in {}", BuildDir.display()))
}

fn TryRunCppScene(
    path: &str,
    UserCode: &str,
    elapsed: Option<f64>,
) -> Result<RunSceneResult, String> {
    let compiler = CppCompiler().ok_or_else(|| {
        "No C++ compiler: g++/clang++/cl not found in PATH. \
         Install one or add a @nyx-scene block."
            .to_string()
    })?;

    let hash = SourceHash(UNREAL_SHIM, UserCode);
    let cached_exe = {
        let cache = SceneExeCache().lock().unwrap();
        if let Some((h, p)) = cache.get(path) {
            if *h == hash && p.exists() {
                Some(p.clone())
            } else {
                None
            }
        } else {
            None
        }
    };

    let ExePath = match cached_exe {
        Some(p) => p,
        None => {
            let p = CompileCpp(UserCode, hash, compiler)?;
            SceneExeCache()
                .lock()
                .unwrap()
                .insert(path.to_string(), (hash, p.clone()));
            p
        }
    };

    RunCompiledScene(&ExePath, elapsed, &format!("Unreal C++ ({})", compiler))
}

fn CompileCpp(UserCode: &str, hash: u64, compiler: &str) -> Result<PathBuf, String> {
    let BuildDir = NyxTempBuildDir().join(format!("cpp_{:016x}", hash));
    std::fs::create_dir_all(&BuildDir).map_err(|e| format!("mkdir: {e}"))?;

    let ExeName = if cfg!(target_os = "windows") {
        "NyxScene.exe"
    } else {
        "NyxScene"
    };
    let ExePath = BuildDir.join(ExeName);
    let FullCpp = format!(
        "#include <iostream>\n\
         {}\n\
         static void __NyxScene__(double __elapsed, NyxUnreal::UWorld& World) {{\n\
         {}\n\
         }}\n\
         int main(int argc, char** argv) {{\n\
             double __elapsed = argc > 1 ? std::stod(argv[1]) : 0.0;\n\
             NyxUnreal::UWorld World;\n\
             __NyxScene__(__elapsed, World);\n\
             std::cout << World.CommandsToJson() << std::flush;\n\
             return 0;\n\
         }}\n",
        UNREAL_SHIM, UserCode
    );

    let SrcPath = BuildDir.join("NyxScene.cpp");
    std::fs::write(&SrcPath, &FullCpp).map_err(|e| format!("write cpp: {e}"))?;

    let out = if compiler == "cl" {
        std::process::Command::new("cl")
            .args([
                "/std:c++17",
                "/EHsc",
                "/O2",
                "/nologo",
                &format!("/Fe:{}", ExePath.display()),
                SrcPath.to_str().unwrap_or("NyxScene.cpp"),
            ])
            .current_dir(&BuildDir)
            .output()
            .map_err(|e| format!("cl: {e}"))?
    } else {
        std::process::Command::new(compiler)
            .args([
                "-std=c++17",
                "-O2",
                "-o",
                ExePath.to_str().unwrap_or("NyxScene"),
                SrcPath.to_str().unwrap_or("NyxScene.cpp"),
            ])
            .output()
            .map_err(|e| format!("{compiler}: {e}"))?
    };

    if !out.status.success() {
        return Err(format!(
            "C++ compile error:\n{}{}",
            String::from_utf8_lossy(&out.stdout).trim(),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    if ExePath.exists() {
        return Ok(ExePath);
    }
    Err(format!("C++ compile: no output at {}", ExePath.display()))
}

fn RunCompiledScene(
    ExePath: &Path,
    elapsed: Option<f64>,
    label: &str,
) -> Result<RunSceneResult, String> {
    let IsDll = ExePath.extension().and_then(|e| e.to_str()) == Some("dll");
    let mut cmd = if IsDll {
        let mut c = std::process::Command::new("dotnet");
        c.arg(ExePath);
        c
    } else {
        std::process::Command::new(ExePath)
    };

    if let Some(e) = elapsed {
        cmd.arg(format!("{:.6}", e));
    }

    let out = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("run scene ({label}): {e}"))?;

    if !out.status.success() {
        return Err(format!(
            "{label} runtime error:\n{}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    let JsonStr = String::from_utf8_lossy(&out.stdout);
    let value: serde_json::Value = serde_json::from_str(JsonStr.trim()).map_err(|e| {
        format!(
            "{label}: invalid JSON output: {e}\nOutput: {}",
            JsonStr.trim()
        )
    })?;

    let commands = match value {
        serde_json::Value::Array(items) => items,
        other => vec![other],
    };

    Ok(RunSceneResult {
        commands,
        terminal: vec![format!("runtime: {}", label)],
        errors: Vec::new(),
        skipped: false,
    })
}

fn ResolveSceneProfile(path: &str, requested: &str) -> String {
    let requested = requested.trim().to_ascii_lowercase();
    if !requested.is_empty() && requested != "auto" {
        return requested;
    }
    match std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "cs" => "unity".to_string(),
        "cpp" | "cc" | "cxx" | "h" | "hpp" => "unreal".to_string(),
        _ => "roblox".to_string(),
    }
}

fn ExtractNyxSceneJson(source: &str) -> Result<&str, String> {
    let marker = "@nyx-scene";
    let MarkerPos = source
        .find(marker)
        .ok_or_else(|| "missing @nyx-scene command block".to_string())?;
    let tail = &source[MarkerPos + marker.len()..];
    let start = tail
        .find(|ch| ch == '[' || ch == '{')
        .ok_or_else(|| "@nyx-scene block does not contain JSON".to_string())?;
    let end = JsonBlockEnd(tail, start)?;
    Ok(&tail[start..end])
}

fn JsonBlockEnd(source: &str, start: usize) -> Result<usize, String> {
    let open = source[start..]
        .chars()
        .next()
        .ok_or_else(|| "@nyx-scene block is empty".to_string())?;
    let close = match open {
        '[' => ']',
        '{' => '}',
        _ => return Err("@nyx-scene JSON must start with '[' or '{'".to_string()),
    };
    let mut depth = 0usize;
    let mut InString = false;
    let mut escape = false;

    for (offset, ch) in source[start..].char_indices() {
        if InString {
            if escape {
                escape = false;
            } else if ch == '\\' {
                escape = true;
            } else if ch == '"' {
                InString = false;
            }
            continue;
        }

        if ch == '"' {
            InString = true;
        } else if ch == open {
            depth += 1;
        } else if ch == close {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return Ok(start + offset + ch.len_utf8());
            }
        }
    }

    Err("@nyx-scene JSON block is not closed".to_string())
}

fn ReadNyxCommands(lua: &Lua) -> Result<Vec<serde_json::Value>, String> {
    let tbl: LuaTable = lua
        .globals()
        .get("_NYX_COMMANDS")
        .map_err(|_| "_NYX_COMMANDS missing — did the shim load?".to_string())?;

    let mut out = Vec::new();
    for item in tbl.sequence_values::<LuaTable>() {
        let cmd = item.map_err(|e| e.to_string())?;
        out.push(LuaTableToJson(cmd));
    }
    Ok(out)
}

fn LuaTableToJson(tbl: LuaTable) -> serde_json::Value {
    let len = tbl.raw_len();
    if len > 0 {
        let arr = (1..=len)
            .filter_map(|i| tbl.raw_get::<LuaValue>(i as i64).ok())
            .map(LuaValueToJson)
            .collect();
        return serde_json::Value::Array(arr);
    }
    let mut map = serde_json::Map::new();
    for pair in tbl.pairs::<String, LuaValue>() {
        if let Ok((k, v)) = pair {
            map.insert(k, LuaValueToJson(v));
        }
    }
    serde_json::Value::Object(map)
}

fn LuaValueToJson(v: LuaValue) -> serde_json::Value {
    match v {
        LuaValue::Nil => serde_json::Value::Null,
        LuaValue::Boolean(b) => serde_json::Value::Bool(b),
        LuaValue::Integer(i) => serde_json::Value::Number(i.into()),
        LuaValue::Number(n) => serde_json::Number::from_f64(n)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        LuaValue::String(s) => {
            serde_json::Value::String(String::from_utf8_lossy(&s.as_bytes()).into_owned())
        }
        LuaValue::Table(t) => LuaTableToJson(t),
        _ => serde_json::Value::Null,
    }
}

fn LuaDisplay(v: &LuaValue) -> String {
    match v {
        LuaValue::Nil => "nil".to_string(),
        LuaValue::Boolean(b) => b.to_string(),
        LuaValue::Integer(i) => i.to_string(),
        LuaValue::Number(n) => {
            if n.fract() == 0.0 && n.abs() < 1e15 {
                format!("{}", *n as i64)
            } else {
                format!("{n}")
            }
        }
        LuaValue::String(s) => String::from_utf8_lossy(&s.as_bytes()).into_owned(),
        LuaValue::Table(_) => "(table)".to_string(),
        _ => "(value)".to_string(),
    }
}

#[tauri::command]
pub fn delete_path(path: String, app_state: State<'_, AppState>) -> Result<(), String> {
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
    let old = std::path::Path::new(&path);
    let parent = old.parent().ok_or("No parent directory")?;
    let new = parent.join(&new_name);
    let IsDir = fs::metadata(&path).map_err(|e| e.to_string())?.is_dir();
    fs::rename(&path, &new).map_err(|e| e.to_string())?;
    let NewPath = new.to_string_lossy().to_string();
    {
        let mut OpenFiles = app_state.open_files.lock().map_err(|e| e.to_string())?;
        for OpenPath in OpenFiles.iter_mut() {
            if let Some(rebased) = RebasePath(OpenPath, old, &new, IsDir) {
                *OpenPath = rebased;
            }
        }
    }
    {
        let mut ActiveFile = app_state.active_file.lock().map_err(|e| e.to_string())?;
        if let Some(active) = ActiveFile
            .as_ref()
            .and_then(|value| RebasePath(value, old, &new, IsDir))
        {
            *ActiveFile = Some(active);
        }
    }
    {
        let mut metadata = app_state.file_metadata.lock().map_err(|e| e.to_string())?;
        let entries: Vec<(String, FileRecord)> = metadata.drain().collect();
        for (file_path, record) in entries {
            let key = RebasePath(&file_path, old, &new, IsDir).unwrap_or(file_path);
            metadata.insert(key, record);
        }
    }
    Ok(NewPath)
}

#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
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

type RendererState = Arc<Mutex<NyxRenderer>>;

#[tauri::command]
pub fn renderer_camera_orbit(
    dx: f32,
    dy: f32,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut ci = r.camera_input.lock().map_err(|e| e.to_string())?;
    ci.orbit_dx += dx;
    ci.orbit_dy += dy;
    Ok(())
}

#[tauri::command]
pub fn renderer_camera_pan(
    dx: f32,
    dy: f32,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut ci = r.camera_input.lock().map_err(|e| e.to_string())?;
    ci.pan_dx += dx;
    ci.pan_dy += dy;
    Ok(())
}

#[tauri::command]
pub fn renderer_camera_zoom(delta: f32, renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut ci = r.camera_input.lock().map_err(|e| e.to_string())?;
    ci.zoom += delta;
    Ok(())
}

#[tauri::command]
pub fn renderer_camera_wasd(
    forward: f32,
    right: f32,
    up: f32,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut ci = r.camera_input.lock().map_err(|e| e.to_string())?;
    ci.forward += forward;
    ci.right += right;
    ci.up += up;
    Ok(())
}

#[tauri::command]
pub fn renderer_camera_right_mouse(
    _down: bool,
    _renderer: State<'_, RendererState>,
) -> Result<(), String> {
    Ok(())
}

fn RayAabbIntersect(
    origin: glam::Vec3,
    dir: glam::Vec3,
    min: glam::Vec3,
    max: glam::Vec3,
) -> Option<f32> {
    let InvDir = 1.0 / dir;
    let mut tmin = (min.x - origin.x) * InvDir.x;
    let mut tmax = (max.x - origin.x) * InvDir.x;
    if InvDir.x < 0.0 {
        std::mem::swap(&mut tmin, &mut tmax);
    }

    let mut tymin = (min.y - origin.y) * InvDir.y;
    let mut tymax = (max.y - origin.y) * InvDir.y;
    if InvDir.y < 0.0 {
        std::mem::swap(&mut tymin, &mut tymax);
    }

    if tmin > tymax || tymin > tmax {
        return None;
    }
    if tymin > tmin {
        tmin = tymin;
    }
    if tymax < tmax {
        tmax = tymax;
    }

    let mut tzmin = (min.z - origin.z) * InvDir.z;
    let mut tzmax = (max.z - origin.z) * InvDir.z;
    if InvDir.z < 0.0 {
        std::mem::swap(&mut tzmin, &mut tzmax);
    }

    if tmin > tzmax || tzmin > tmax {
        return None;
    }
    if tzmin > tmin {
        tmin = tzmin;
    }
    if tzmax < tmax {
        tmax = tzmax;
    }

    if tmax < 0.0 {
        return None;
    }
    Some(tmin.max(0.0))
}

fn DistRaySegment(
    ray_origin: glam::Vec3,
    ray_dir: glam::Vec3,
    p0: glam::Vec3,
    p1: glam::Vec3,
) -> f32 {
    let u = ray_dir;
    let v = p1 - p0;
    let w = ray_origin - p0;

    let a = u.dot(u);
    let b = u.dot(v);
    let c = v.dot(v);
    let d = u.dot(w);
    let e = v.dot(w);

    let den = a * c - b * b;
    let mut sc;
    let mut tc;

    if den < 1e-4 {
        sc = 0.0;
        tc = if b > c { d / b } else { e / c };
    } else {
        sc = (b * e - c * d) / den;
        tc = (a * e - b * d) / den;
    }

    if tc < 0.0 {
        tc = 0.0;
        sc = -d / a;
    } else if tc > 1.0 {
        tc = 1.0;
        sc = (b - d) / a;
    }

    let dp = w + u * sc - v * tc;
    dp.length()
}
fn ClosestTOnLine(
    ray_o: glam::Vec3,
    ray_d: glam::Vec3,
    line_o: glam::Vec3,
    line_d: glam::Vec3,
) -> f32 {
    let w = ray_o - line_o;
    let b = ray_d.dot(line_d);
    let d = ray_d.dot(w);
    let e = line_d.dot(w);
    let den = 1.0 - b * b;
    if den.abs() < 1e-6 {
        return e;
    }
    (e - b * d) / den
}

#[tauri::command]
pub fn renderer_gizmo_hit_test(
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    renderer: State<'_, RendererState>,
) -> Result<Option<String>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let s = r.state.lock().map_err(|e| e.to_string())?;

    let sel = match &s.selected {
        Some(id) => id.clone(),
        None => return Ok(None),
    };

    let NdcX = (x / width) * 2.0 - 1.0;
    let NdcY = 1.0 - (y / height) * 2.0;
    let (origin, dir) = s.camera.GetRay(NdcX, NdcY);

    for cmd in &s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
            continue;
        }

        let gf = |k: &str, f: &str| -> f32 {
            cmd.get(k)
                .and_then(|o| o.get(f))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0) as f32
        };
        let c = glam::Vec3::new(
            gf("Position", "X"),
            gf("Position", "Y"),
            gf("Position", "Z"),
        );
        let sx = gf("Size", "X");
        let sy = gf("Size", "Y");
        let sz = gf("Size", "Z");

        match s.gizmo_mode.as_str() {
            "rotate" => {
                let radius = sx.max(sy).max(sz) * 0.5 + 0.8;
                let thr = 0.4_f32;
                let TestRing = |PlaneNormal: glam::Vec3| -> Option<f32> {
                    let denom = PlaneNormal.dot(dir);
                    if denom.abs() < 1e-6 {
                        return None;
                    }
                    let t = PlaneNormal.dot(c - origin) / denom;
                    if t < 0.0 {
                        return None;
                    }
                    let hit = origin + dir * t;
                    let dist = ((hit - c).length() - radius).abs();
                    if dist < thr {
                        Some(dist)
                    } else {
                        None
                    }
                };
                let dx = TestRing(glam::Vec3::X);
                let dy = TestRing(glam::Vec3::Y);
                let dz = TestRing(glam::Vec3::Z);
                let best = [("X", dx), ("Y", dy), ("Z", dz)]
                    .into_iter()
                    .filter_map(|(ax, d)| d.map(|v| (ax, v)))
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
                if let Some((ax, _)) = best {
                    return Ok(Some(ax.into()));
                }
            }
            "scale" => {
                let len = 6.0_f32;
                let thr = 1.0_f32;
                let tips = [
                    ("X", c + glam::Vec3::X * len),
                    ("Y", c + glam::Vec3::Y * len),
                    ("Z", c + glam::Vec3::Z * len),
                ];
                let best = tips
                    .iter()
                    .map(|(ax, tip)| {
                        let v = *tip - origin;
                        let t = v.dot(dir);
                        let d = (v - dir * t).length();
                        (ax, d)
                    })
                    .filter(|(_, d)| *d < thr)
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
                if let Some((ax, _)) = best {
                    return Ok(Some((*ax).into()));
                }
            }
            _ => {
                // "move"
                let len = 6.0_f32;
                let dx = DistRaySegment(origin, dir, c, c + glam::Vec3::X * len);
                let dy = DistRaySegment(origin, dir, c, c + glam::Vec3::Y * len);
                let dz = DistRaySegment(origin, dir, c, c + glam::Vec3::Z * len);
                let thr = 0.8_f32;
                if dx < thr && dx < dy && dx < dz {
                    return Ok(Some("X".into()));
                }
                if dy < thr && dy < dz {
                    return Ok(Some("Y".into()));
                }
                if dz < thr {
                    return Ok(Some("Z".into()));
                }
            }
        }
        break;
    }

    Ok(None)
}

#[tauri::command]
pub fn renderer_gizmo_drag(
    axis: String,
    prev_x: f32,
    prev_y: f32,
    curr_x: f32,
    curr_y: f32,
    width: f32,
    height: f32,
    renderer: State<'_, RendererState>,
) -> Result<Option<[f32; 3]>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;

    let sel = match s.selected.clone() {
        Some(id) => id,
        None => return Ok(None),
    };

    if !s.drag_undo_pushed {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        PushUndo(&s, &mut u);
        s.drag_undo_pushed = true;
    }

    let AxisDir = match axis.as_str() {
        "X" => glam::Vec3::X,
        "Y" => glam::Vec3::Y,
        "Z" => glam::Vec3::Z,
        _ => return Ok(None),
    };

    let PartPos = {
        let mut found = None;
        for cmd in &s.commands {
            if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") {
                continue;
            }
            if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
                continue;
            }
            let f = |k: &str, ff: &str| -> f32 {
                cmd.get(k)
                    .and_then(|o| o.get(ff))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0) as f32
            };
            found = Some(glam::Vec3::new(
                f("Position", "X"),
                f("Position", "Y"),
                f("Position", "Z"),
            ));
            break;
        }
        match found {
            Some(p) => p,
            None => return Ok(None),
        }
    };

    let ToNdc =
        |sx: f32, sy: f32| -> (f32, f32) { ((sx / width) * 2.0 - 1.0, 1.0 - (sy / height) * 2.0) };
    let (pnx, pny) = ToNdc(prev_x, prev_y);
    let (cnx, cny) = ToNdc(curr_x, curr_y);
    let (po, pd) = s.camera.GetRay(pnx, pny);
    let (co, cd) = s.camera.GetRay(cnx, cny);

    let TPrev = ClosestTOnLine(po, pd, PartPos, AxisDir);
    let TCurr = ClosestTOnLine(co, cd, PartPos, AxisDir);
    let NewPos = PartPos + AxisDir * (TCurr - TPrev);

    for cmd in &mut s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
            continue;
        }
        if let Some(p) = cmd.get_mut("Position") {
            *p = serde_json::json!({"X": NewPos.x, "Y": NewPos.y, "Z": NewPos.z});
        }
        break;
    }

    let mut physics = std::mem::take(&mut s.physics);
    let profile = s.profile.clone();
    physics.Reconcile(&s.commands, &profile);
    s.physics = physics;
    s.dirty = true;
    Ok(Some([NewPos.x, NewPos.y, NewPos.z]))
}

#[tauri::command]
pub fn renderer_click(
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    renderer: State<'_, RendererState>,
    app_state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;

    let NdcX = (x / width) * 2.0 - 1.0;
    let NdcY = 1.0 - (y / height) * 2.0;

    let (origin, dir) = s.camera.GetRay(NdcX, NdcY);

    let GetF32 = |obj: &serde_json::Value, k: &str, field: &str, d: f32| -> f32 {
        obj.get(k)
            .and_then(|o| o.get(field))
            .and_then(|v| v.as_f64())
            .map(|v| v as f32)
            .unwrap_or(d)
    };

    let mut ClosestT = f32::MAX;
    let mut SelectedId = None;

    for cmd in &s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) == Some("AddPart") {
            let px = GetF32(cmd, "Position", "X", 0.0);
            let py = GetF32(cmd, "Position", "Y", 0.0);
            let pz = GetF32(cmd, "Position", "Z", 0.0);

            let sx = GetF32(cmd, "Size", "X", 1.0);
            let sy = GetF32(cmd, "Size", "Y", 1.0);
            let sz = GetF32(cmd, "Size", "Z", 1.0);

            let center = glam::Vec3::new(px, py, pz);
            let extents = glam::Vec3::new(sx, sy, sz) * 0.5;

            let min = center - extents;
            let max = center + extents;

            if let Some(t) = RayAabbIntersect(origin, dir, min, max) {
                if t < ClosestT {
                    ClosestT = t;
                    if let Some(id) = cmd.get("Id").and_then(|v| v.as_str()) {
                        SelectedId = Some(id.to_string());
                    }
                }
            }
        }
    }

    s.selected = SelectedId.clone();
    s.dirty = true;
    *app_state
        .selected_part_id
        .lock()
        .map_err(|e| e.to_string())? = SelectedId.clone();

    Ok(SelectedId)
}

#[tauri::command]
pub fn renderer_set_on_top(
    on_top: bool,
    app: AppHandle,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let hwnd = renderer.lock().map_err(|e| e.to_string())?.hwnd;
    app.run_on_main_thread(move || {
        nyx_window::SetZOrder(hwnd, on_top);
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renderer_load_scene(
    commands: Vec<serde_json::Value>,
    profile: String,
    renderer: State<'_, RendererState>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    let mut physics = std::mem::take(&mut s.physics);
    physics.Reset(&commands, &profile);
    s.commands = commands.clone();
    s.profile = profile.clone();
    s.physics = physics;
    s.dirty = true;
    *app_state.scene_commands.lock().map_err(|e| e.to_string())? = commands;
    *app_state.scene_profile.lock().map_err(|e| e.to_string())? = Some(profile);
    *app_state
        .selected_part_id
        .lock()
        .map_err(|e| e.to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn renderer_load_live_scene(
    commands: Vec<serde_json::Value>,
    profile: String,
    renderer: State<'_, RendererState>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    if s.last_interaction.elapsed() < std::time::Duration::from_millis(140) {
        return Ok(());
    }
    let mut physics = std::mem::take(&mut s.physics);
    physics.Reconcile(&commands, &profile);
    s.commands = commands.clone();
    s.profile = profile.clone();
    s.physics = physics;
    s.skip_camera_meta = true;
    s.dirty = true;
    *app_state.scene_commands.lock().map_err(|e| e.to_string())? = commands;
    *app_state.scene_profile.lock().map_err(|e| e.to_string())? = Some(profile);
    Ok(())
}

#[tauri::command]
pub fn renderer_set_bounds(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    app: AppHandle,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let hwnd = {
        let r = renderer.lock().map_err(|e| e.to_string())?;
        let mut s = r.state.lock().map_err(|e| e.to_string())?;
        s.bounds = (x, y, width, height);
        r.hwnd
    };
    app.run_on_main_thread(move || {
        nyx_window::SetWindowBounds(hwnd, x, y, width, height);
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renderer_set_visible(
    visible: bool,
    app: AppHandle,
    renderer: State<'_, RendererState>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let hwnd = {
        let r = renderer.lock().map_err(|e| e.to_string())?;
        let mut s = r.state.lock().map_err(|e| e.to_string())?;
        s.visible = visible;
        r.hwnd
    };
    *app_state
        .viewport_visible
        .lock()
        .map_err(|e| e.to_string())? = visible;
    app.run_on_main_thread(move || {
        nyx_window::ShowWindow(hwnd, visible);
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renderer_detach(app: AppHandle, renderer: State<'_, RendererState>) -> Result<(), String> {
    let hwnd = renderer.lock().map_err(|e| e.to_string())?.hwnd;
    app.run_on_main_thread(move || {
        nyx_window::DetachWindow(hwnd);
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renderer_attach(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    app: AppHandle,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    use tauri::Manager;
    let hwnd = renderer.lock().map_err(|e| e.to_string())?.hwnd;
    let ParentHwnd = {
        use raw_window_handle::{HasRawWindowHandle, RawWindowHandle};
        match app
            .get_window("main")
            .ok_or("main window not found")?
            .raw_window_handle()
        {
            RawWindowHandle::Win32(h) => h.hwnd as isize,
            _ => return Err("Not a Win32 window".to_string()),
        }
    };
    app.run_on_main_thread(move || {
        nyx_window::AttachWindow(hwnd, ParentHwnd, x, y, width, height);
    })
    .map_err(|e| e.to_string())
}

fn PushUndo(state: &crate::renderer::SceneState, undo: &mut crate::renderer::UndoHistory) {
    undo.undo_stack.push(state.commands.clone());
    if undo.undo_stack.len() > 50 {
        undo.undo_stack.remove(0);
    }
    undo.redo_stack.clear();
}

#[tauri::command]
pub fn renderer_get_part(
    id: String,
    renderer: State<'_, RendererState>,
) -> Result<Option<serde_json::Value>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let s = r.state.lock().map_err(|e| e.to_string())?;
    for cmd in &s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) == Some(id.as_str()) {
            return Ok(Some(cmd.clone()));
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn renderer_set_part_properties(
    id: String,
    position: Option<serde_json::Value>,
    size: Option<serde_json::Value>,
    color: Option<serde_json::Value>,
    rotation: Option<serde_json::Value>,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        PushUndo(&s, &mut u);
    }
    for cmd in &mut s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(id.as_str()) {
            continue;
        }
        if let Some(p) = position {
            cmd["Position"] = p;
        }
        if let Some(sz) = size {
            cmd["Size"] = sz;
        }
        if let Some(c) = color {
            cmd["Color"] = c;
        }
        if let Some(rot) = rotation {
            let CurCf = cmd.get("CFrame").cloned().unwrap_or(serde_json::json!({}));
            let mut NewCf = CurCf;
            if let Some(rx) = rot.get("RX") {
                NewCf["RX"] = rx.clone();
            }
            if let Some(ry) = rot.get("RY") {
                NewCf["RY"] = ry.clone();
            }
            if let Some(rz) = rot.get("RZ") {
                NewCf["RZ"] = rz.clone();
            }
            if let Some(pos) = cmd.get("Position") {
                NewCf["X"] = pos.get("X").cloned().unwrap_or(serde_json::json!(0.0));
                NewCf["Y"] = pos.get("Y").cloned().unwrap_or(serde_json::json!(0.0));
                NewCf["Z"] = pos.get("Z").cloned().unwrap_or(serde_json::json!(0.0));
            }
            cmd["CFrame"] = NewCf;
        }
        break;
    }
    let mut physics = std::mem::take(&mut s.physics);
    let profile = s.profile.clone();
    physics.Reconcile(&s.commands, &profile);
    s.physics = physics;
    s.dirty = true;
    Ok(())
}

#[tauri::command]
pub fn renderer_set_gizmo_mode(
    mode: String,
    renderer: State<'_, RendererState>,
    app_state: State<'_, AppState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    s.gizmo_mode = mode.clone();
    s.dirty = true;
    *app_state.gizmo_mode.lock().map_err(|e| e.to_string())? = mode;
    Ok(())
}

#[tauri::command]
pub fn renderer_rotate_drag(
    axis: String,
    prev_x: f32,
    prev_y: f32,
    curr_x: f32,
    curr_y: f32,
    width: f32,
    height: f32,
    renderer: State<'_, RendererState>,
) -> Result<Option<[f32; 3]>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;

    let sel = match s.selected.clone() {
        Some(id) => id,
        None => return Ok(None),
    };

    if !s.drag_undo_pushed {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        PushUndo(&s, &mut u);
        s.drag_undo_pushed = true;
    }

    let PlaneNormal = match axis.as_str() {
        "X" => glam::Vec3::X,
        "Y" => glam::Vec3::Y,
        "Z" => glam::Vec3::Z,
        _ => return Ok(None),
    };

    let PartPos = {
        let mut found = None;
        for cmd in &s.commands {
            if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") {
                continue;
            }
            if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
                continue;
            }
            let f = |k: &str, ff: &str| -> f32 {
                cmd.get(k)
                    .and_then(|o| o.get(ff))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0) as f32
            };
            found = Some(glam::Vec3::new(
                f("Position", "X"),
                f("Position", "Y"),
                f("Position", "Z"),
            ));
            break;
        }
        match found {
            Some(p) => p,
            None => return Ok(None),
        }
    };

    let ToNdc =
        |sx: f32, sy: f32| -> (f32, f32) { ((sx / width) * 2.0 - 1.0, 1.0 - (sy / height) * 2.0) };
    let (pnx, pny) = ToNdc(prev_x, prev_y);
    let (cnx, cny) = ToNdc(curr_x, curr_y);
    let (po, pd) = s.camera.GetRay(pnx, pny);
    let (co, cd) = s.camera.GetRay(cnx, cny);

    let PlaneIntersect = |ray_o: glam::Vec3, ray_d: glam::Vec3| -> Option<glam::Vec3> {
        let denom = PlaneNormal.dot(ray_d);
        if denom.abs() < 1e-6 {
            return None;
        }
        let t = PlaneNormal.dot(PartPos - ray_o) / denom;
        if t < 0.0 {
            return None;
        }
        Some(ray_o + ray_d * t)
    };

    let PrevPt = match PlaneIntersect(po, pd) {
        Some(p) => p,
        None => return Ok(None),
    };
    let CurrPt = match PlaneIntersect(co, cd) {
        Some(p) => p,
        None => return Ok(None),
    };

    let VPrev = PrevPt - PartPos;
    let VCurr = CurrPt - PartPos;
    if VPrev.length() < 1e-6 || VCurr.length() < 1e-6 {
        return Ok(None);
    }
    let VPrev = VPrev.normalize();
    let VCurr = VCurr.normalize();

    let CosA = VPrev.dot(VCurr).clamp(-1.0, 1.0);
    let SinA = VPrev.cross(VCurr).dot(PlaneNormal);
    let angle = SinA.atan2(CosA);

    let RotKey = match axis.as_str() {
        "X" => "RX",
        "Y" => "RY",
        _ => "RZ",
    };
    let mut result = None;
    for cmd in &mut s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
            continue;
        }
        let cur: f32 = cmd
            .get("CFrame")
            .and_then(|cf| cf.get(RotKey))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0) as f32;
        let NewR = cur + angle;
        let cf = cmd.get("CFrame").cloned().unwrap_or_else(|| {
            let pos = cmd.get("Position").cloned().unwrap_or(serde_json::json!({}));
            serde_json::json!({ "X": pos["X"], "Y": pos["Y"], "Z": pos["Z"], "RX": 0, "RY": 0, "RZ": 0 })
        });
        let mut NewCf = cf;
        NewCf[RotKey] = serde_json::json!(NewR);
        let rx = if RotKey == "RX" {
            NewR
        } else {
            NewCf.get("RX").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
        };
        let ry = if RotKey == "RY" {
            NewR
        } else {
            NewCf.get("RY").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
        };
        let rz = if RotKey == "RZ" {
            NewR
        } else {
            NewCf.get("RZ").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
        };
        cmd["CFrame"] = NewCf;
        result = Some([rx, ry, rz]);
        break;
    }
    let mut physics = std::mem::take(&mut s.physics);
    let profile = s.profile.clone();
    physics.Reconcile(&s.commands, &profile);
    s.physics = physics;
    s.dirty = true;
    Ok(result)
}

#[tauri::command]
pub fn renderer_scale_drag(
    axis: String,
    prev_x: f32,
    prev_y: f32,
    curr_x: f32,
    curr_y: f32,
    width: f32,
    height: f32,
    renderer: State<'_, RendererState>,
) -> Result<Option<[f32; 3]>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;

    let sel = match s.selected.clone() {
        Some(id) => id,
        None => return Ok(None),
    };

    if !s.drag_undo_pushed {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        PushUndo(&s, &mut u);
        s.drag_undo_pushed = true;
    }

    let AxisDir = match axis.as_str() {
        "X" => glam::Vec3::X,
        "Y" => glam::Vec3::Y,
        "Z" => glam::Vec3::Z,
        _ => return Ok(None),
    };

    let PartPos = {
        let mut found = None;
        for cmd in &s.commands {
            if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") {
                continue;
            }
            if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
                continue;
            }
            let f = |k: &str, ff: &str| -> f32 {
                cmd.get(k)
                    .and_then(|o| o.get(ff))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0) as f32
            };
            found = Some(glam::Vec3::new(
                f("Position", "X"),
                f("Position", "Y"),
                f("Position", "Z"),
            ));
            break;
        }
        match found {
            Some(p) => p,
            None => return Ok(None),
        }
    };

    let ToNdc =
        |sx: f32, sy: f32| -> (f32, f32) { ((sx / width) * 2.0 - 1.0, 1.0 - (sy / height) * 2.0) };
    let (pnx, pny) = ToNdc(prev_x, prev_y);
    let (cnx, cny) = ToNdc(curr_x, curr_y);
    let (po, pd) = s.camera.GetRay(pnx, pny);
    let (co, cd) = s.camera.GetRay(cnx, cny);

    let TPrev = ClosestTOnLine(po, pd, PartPos, AxisDir);
    let TCurr = ClosestTOnLine(co, cd, PartPos, AxisDir);
    let delta = TCurr - TPrev;

    let SizeKey = axis.as_str();
    let mut result = None;
    for cmd in &mut s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") {
            continue;
        }
        if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel.as_str()) {
            continue;
        }
        if let Some(size_obj) = cmd.get_mut("Size") {
            let cur: f32 = size_obj
                .get(SizeKey)
                .and_then(|v| v.as_f64())
                .unwrap_or(1.0) as f32;
            let NewS = (cur + delta * 2.0).max(0.05);
            size_obj[SizeKey] = serde_json::json!(NewS);
            let sx = size_obj.get("X").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            let sy = size_obj.get("Y").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            let sz = size_obj.get("Z").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            result = Some([sx, sy, sz]);
        }
        break;
    }
    let mut physics = std::mem::take(&mut s.physics);
    let profile = s.profile.clone();
    physics.Reconcile(&s.commands, &profile);
    s.physics = physics;
    s.dirty = true;
    Ok(result)
}

#[tauri::command]
pub fn renderer_undo(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    let mut u = r.undo.lock().map_err(|e| e.to_string())?;
    if let Some(prev) = u.undo_stack.pop() {
        u.redo_stack.push(s.commands.clone());
        s.commands = prev;
        s.selected = None;
        let mut physics = std::mem::take(&mut s.physics);
        let profile = s.profile.clone();
        physics.Reconcile(&s.commands, &profile);
        s.physics = physics;
        s.dirty = true;
    }
    Ok(())
}

#[tauri::command]
pub fn renderer_redo(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    let mut u = r.undo.lock().map_err(|e| e.to_string())?;
    if let Some(next) = u.redo_stack.pop() {
        u.undo_stack.push(s.commands.clone());
        s.commands = next;
        s.selected = None;
        let mut physics = std::mem::take(&mut s.physics);
        let profile = s.profile.clone();
        physics.Reconcile(&s.commands, &profile);
        s.physics = physics;
        s.dirty = true;
    }
    Ok(())
}

#[tauri::command]
pub fn renderer_delete_part(id: String, renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        PushUndo(&s, &mut u);
    }
    s.commands.retain(|cmd| {
        !(cmd.get("Cmd").and_then(|v| v.as_str()) == Some("AddPart")
            && cmd.get("Id").and_then(|v| v.as_str()) == Some(id.as_str()))
    });
    if s.selected.as_deref() == Some(id.as_str()) {
        s.selected = None;
    }
    let mut physics = std::mem::take(&mut s.physics);
    let profile = s.profile.clone();
    physics.Reconcile(&s.commands, &profile);
    s.physics = physics;
    s.dirty = true;
    Ok(())
}

#[tauri::command]
pub fn renderer_frame_selected(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;

    let TargetPos: Option<glam::Vec3>;
    let TargetSize: f32;

    if let Some(sel_id) = s.selected.clone() {
        let mut FoundPos = None;
        let mut FoundSize = 4.0_f32;
        for cmd in &s.commands {
            if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") {
                continue;
            }
            if cmd.get("Id").and_then(|v| v.as_str()) != Some(sel_id.as_str()) {
                continue;
            }
            let gf = |k: &str, f: &str, d: f64| -> f32 {
                cmd.get(k)
                    .and_then(|o| o.get(f))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(d) as f32
            };
            let px = gf("Position", "X", 0.0);
            let py = gf("Position", "Y", 0.0);
            let pz = gf("Position", "Z", 0.0);
            let sx = gf("Size", "X", 2.0);
            let sy = gf("Size", "Y", 2.0);
            let sz = gf("Size", "Z", 2.0);
            FoundPos = Some(glam::Vec3::new(px, py, pz));
            FoundSize = sx.max(sy).max(sz);
            break;
        }
        TargetPos = FoundPos;
        TargetSize = FoundSize;
    } else {
        let mut min = glam::Vec3::splat(f32::MAX);
        let mut max = glam::Vec3::splat(f32::MIN);
        let mut any = false;
        for cmd in &s.commands {
            if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") {
                continue;
            }
            let gf = |k: &str, f: &str, d: f64| -> f32 {
                cmd.get(k)
                    .and_then(|o| o.get(f))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(d) as f32
            };
            let p = glam::Vec3::new(
                gf("Position", "X", 0.0),
                gf("Position", "Y", 0.0),
                gf("Position", "Z", 0.0),
            );
            let h = glam::Vec3::new(
                gf("Size", "X", 2.0),
                gf("Size", "Y", 2.0),
                gf("Size", "Z", 2.0),
            ) * 0.5;
            min = min.min(p - h);
            max = max.max(p + h);
            any = true;
        }
        if any {
            let center = (min + max) * 0.5;
            TargetPos = Some(center);
            TargetSize = (max - min).length();
        } else {
            return Ok(());
        }
    }

    if let Some(pos) = TargetPos {
        let dist = TargetSize * 2.5 + 5.0;
        let eye = pos + glam::Vec3::new(dist * 0.6, dist * 0.5, dist * 0.6);
        s.camera.SetFromEyeTarget(eye.to_array(), pos.to_array());
        s.dirty = true;
    }
    Ok(())
}

#[tauri::command]
pub fn renderer_end_drag(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    s.drag_undo_pushed = false;
    Ok(())
}

use zeroize::Zeroizing;

const KEYRING_SERVICE: &str = "nyx-ide";
const KEYRING_ANTHROPIC: &str = "anthropic";
const KEYRING_DEEPSEEK: &str = "deepseek";
const KEYRING_OPENAI: &str = "openai";

fn KrExists(account: &str) -> bool {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .ok()
        .and_then(|e| e.get_password().ok())
        .is_some()
}

fn KrGet(account: &str) -> Option<Zeroizing<String>> {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .ok()
        .and_then(|e| e.get_password().ok())
        .map(Zeroizing::new)
}

#[derive(serde::Deserialize)]
pub struct AiChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct AiConfigStatus {
    pub anthropic_key_set: bool,
    pub deepseek_key_set: bool,
    pub openai_key_set: bool,
}

#[derive(Serialize, serde::Deserialize, Clone, Default)]
pub struct AppSettings {
    #[serde(default = "DefaultProvider")]
    pub DefaultProvider: String,
    #[serde(default)]
    pub obsidian_vault_path: Option<String>,
    #[serde(default = "DefaultAiMode")]
    pub ai_mode: String,
    #[serde(default)]
    pub rate_limit_auto_continue: Option<bool>,
}

fn DefaultProvider() -> String {
    "anthropic".to_string()
}
fn DefaultAiMode() -> String {
    "supervised".to_string()
}

fn SettingsPath() -> Option<std::path::PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(
        std::path::PathBuf::from(appdata)
            .join("Nyx")
            .join("settings.json"),
    )
}

#[tauri::command]
pub fn get_app_settings() -> AppSettings {
    SettingsPath()
        .and_then(|p| fs::read_to_string(&p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn save_app_settings(settings: AppSettings) -> Result<(), String> {
    let path = SettingsPath().ok_or("Cannot determine AppData path")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_get_config() -> AiConfigStatus {
    AiConfigStatus {
        anthropic_key_set: KrExists(KEYRING_ANTHROPIC),
        deepseek_key_set:  KrExists(KEYRING_DEEPSEEK),
        openai_key_set:    KrExists(KEYRING_OPENAI),
    }
}

#[tauri::command]
pub fn ai_launch_keyman() -> Result<(), String> {
    let ExeDir = std::env::current_exe().map_err(|e| e.to_string())?;
    let ExeDir = ExeDir.parent().ok_or("Cannot determine exe directory")?;
    let DevKeyman = ExeDir.join("nyx-keyman.exe");
    let ResourceKeyman = ExeDir
        .join("resources")
        .join("extra-bin")
        .join("nyx-keyman.exe");
    let keyman = if DevKeyman.exists() {
        DevKeyman
    } else if ResourceKeyman.exists() {
        ResourceKeyman
    } else {
        DevKeyman
    };

    std::process::Command::new(&keyman)
        .spawn()
        .map_err(|e| format!("Could not launch key manager ({keyman:?}): {e}"))?;
    Ok(())
}

fn PowershellQuote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[tauri::command]
pub fn ai_launch_nyx_cli(workspace: Option<String>) -> Result<(), String> {
    let ExePath = std::env::current_exe().map_err(|e| e.to_string())?;
    let ExeDir = ExePath.parent().ok_or("Cannot determine exe directory")?;

    let InstalledCli = ExeDir.join("NyxCli").join("NyxCli.exe");
    let DevCli = ExeDir.join("NyxCli.exe");
    let ResourceCli = ExeDir
        .join("resources")
        .join("extra-bin")
        .join("NyxCli.exe");
    let cli = if InstalledCli.exists() {
        InstalledCli
    } else if DevCli.exists() {
        DevCli
    } else if ResourceCli.exists() {
        ResourceCli
    } else {
        InstalledCli
    };

    let mut command = format!("& {}", PowershellQuote(&cli.to_string_lossy()));
    if let Some(w) = workspace.as_deref().filter(|w| !w.trim().is_empty()) {
        command.push_str(" --workspace ");
        command.push_str(&PowershellQuote(w));
    }

    let spawn = std::process::Command::new("wt.exe")
        .args(["powershell.exe", "-NoExit", "-Command", &command])
        .spawn()
        .or_else(|_| {
            std::process::Command::new("powershell.exe")
                .args(["-NoExit", "-Command", &command])
                .spawn()
        });

    spawn
        .map(|_| ())
        .map_err(|e| format!("Could not launch NyxCli ({cli:?}): {e}"))
}

#[tauri::command]
pub async fn ai_start_agent(
    provider: String,
    messages: Vec<AiChatMessage>,
    workspace: Option<String>,
    mode: String,
    skills: Option<Vec<String>>,
    window: tauri::Window,
    approval: State<'_, Arc<Mutex<agent::ApprovalState>>>,
) -> Result<(), String> {
    let (ApiKey, model) = match provider.as_str() {
        "anthropic" => {
            let k = KrGet(KEYRING_ANTHROPIC).ok_or("Anthropic API key not configured")?;
            (k, "claude-sonnet-4-6".to_string())
        }
        "deepseek" => {
            let k = KrGet(KEYRING_DEEPSEEK).ok_or("DeepSeek API key not configured")?;
            (k, "deepseek-chat".to_string())
        }
        "openai" => {
            let k = KrGet(KEYRING_OPENAI).ok_or("OpenAI API key not configured")?;
            (k, "gpt-4o".to_string())
        }
        _ => return Err(format!("Unknown provider: {provider}")),
    };

    {
        let mut settings = get_app_settings();
        if settings.DefaultProvider != provider {
            settings.DefaultProvider = provider.clone();
            let _ = save_app_settings(settings);
        }
    }

    let GlobalMemory = {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        std::path::PathBuf::from(appdata)
            .join("Nyx")
            .join("NyxMemory")
    };
    let ProjectMemory = workspace
        .as_ref()
        .map(|w| std::path::PathBuf::from(w).join(".nyx").join("memory"));

    let settings = get_app_settings();
    let ToolSettings = agent::ToolSettings {
        workspace_path: workspace.clone(),
        obsidian_vault_path: settings.obsidian_vault_path,
        global_memory_path: GlobalMemory,
        project_memory_path: ProjectMemory,
    };

    let ApiMessages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();

    let AgentMode = agent::AgentMode::FromStr(&mode);
    let Resolved = crate::skills::Resolve(&skills.unwrap_or_default());
    for (skill_id, reason) in &Resolved.blocked {
        let _ = window.emit("ai_event", serde_json::json!({
            "type": "skill_blocked",
            "skill_id": skill_id,
            "reason": reason,
        }));
    }
    let system = agent::BuildSystemPrompt(workspace.as_deref(), &AgentMode, &Resolved.loaded, &provider);

    let result = agent::RunAgent(
        ApiMessages,
        system,
        &ApiKey,
        &model,
        &provider,
        ToolSettings,
        Arc::clone(&*approval),
        AgentMode,
        window.clone(),
        settings.rate_limit_auto_continue,
    )
    .await;

    if let Err(ref e) = result {
        let _ = window.emit("ai_error", e.clone());
    }
    result
}

#[tauri::command]
pub fn ai_tool_respond(approve: bool, approval: State<'_, Arc<Mutex<agent::ApprovalState>>>) {
    let mut state = approval.lock().unwrap();
    if let Some(tx) = state.pending.take() {
        let _ = tx.send(approve);
    }
}

#[tauri::command]
pub fn ai_question_respond(
    response: agent::QuestionResponse,
    approval: State<'_, Arc<Mutex<agent::ApprovalState>>>,
) {
    let mut state = approval.lock().unwrap();
    if let Some(tx) = state.pending_question.take() {
        let _ = tx.send(response);
    }
}

#[tauri::command]
pub fn ai_rate_limit_respond(
    approved: bool,
    approval: State<'_, Arc<Mutex<agent::ApprovalState>>>,
) {
    let mut state = approval.lock().unwrap();
    if let Some(tx) = state.pending_rate_limit.take() {
        let _ = tx.send(approved);
    }
}
