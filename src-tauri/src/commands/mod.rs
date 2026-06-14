pub mod agent;
pub mod filesystem;
pub mod renderer;
pub mod scene_runner;

pub use filesystem::*;
pub use renderer::*;
pub use scene_runner::*;

use serde::Serialize;
use std::fs;
use std::sync::{Arc, Mutex, OnceLock};
use sysinfo::System;
use tauri::State;
use zeroize::Zeroizing;

use crate::renderer::NyxRenderer;
use crate::state::{AppState, FileRecord};

pub type RendererState = Arc<Mutex<NyxRenderer>>;

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
        deepseek_key_set: KrExists(KEYRING_DEEPSEEK),
        openai_key_set: KrExists(KEYRING_OPENAI),
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

/// Default port the Charon ferry listens on. Mirrored by the engine plugins.
const CHARON_PORT: u16 = 34777;

/// Is something already listening on the Charon port? Uses a bounded connect so
/// a wedged socket can never hang the command for the default OS timeout.
fn CharonListening() -> bool {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], CHARON_PORT));
    std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(250)).is_ok()
}

/// Launch the Charon ferry sidecar (the connector that syncs files between game
/// engines and Nyx). Idempotent: if Charon is already listening, this just
/// returns the port instead of spawning a second instance that would fail to
/// bind. After spawning it waits (briefly, bounded) for the port to come up so
/// the caller knows Charon is actually ready rather than merely launched.
/// Returns the port the engine-side plugin should connect to.
#[tauri::command]
pub fn charon_start(workspace: Option<String>) -> Result<u16, String> {
    // Already up? Don't double-bind. (TOCTOU is benign: a second spawn just
    // fails to bind and exits; the readiness wait below still sees the first.)
    if CharonListening() {
        return Ok(CHARON_PORT);
    }

    let ExePath = std::env::current_exe().map_err(|e| e.to_string())?;
    let ExeDir = ExePath.parent().ok_or("Cannot determine exe directory")?;
    let Candidates = [
        ExeDir.join("Charon").join("Charon.exe"),
        ExeDir.join("Charon.exe"),
        ExeDir.join("resources").join("extra-bin").join("Charon.exe"),
    ];
    let Bin = match Candidates.iter().find(|p| p.exists()) {
        Some(found) => found.clone(),
        None => {
            return Err(format!(
                "Charon binary not found. Looked in: {}",
                Candidates
                    .iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        }
    };

    let mut Cmd = std::process::Command::new(&Bin);
    Cmd.args(["--port", &CHARON_PORT.to_string()]);
    if let Some(w) = workspace.as_deref().filter(|w| !w.trim().is_empty()) {
        let Root = std::path::Path::new(w).join(".charon");
        Cmd.args(["--root", &Root.to_string_lossy()]);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        Cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — runs headless.
    }

    let mut Child = Cmd
        .spawn()
        .map_err(|e| format!("Could not launch Charon ({Bin:?}): {e}"))?;

    // Wait for readiness, but don't wait forever. Each loop also checks whether
    // the child died (e.g. failed to bind because another instance won the race)
    // so we surface a real error instead of a misleading timeout.
    for _ in 0..40 {
        if CharonListening() {
            return Ok(CHARON_PORT);
        }
        if let Ok(Some(status)) = Child.try_wait() {
            // It exited before binding. If the port is nonetheless up, another
            // instance owns it and we're fine; otherwise report the failure.
            if CharonListening() {
                return Ok(CHARON_PORT);
            }
            return Err(format!("Charon exited before it started listening ({status})."));
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    Err("Charon was launched but did not start listening in time.".into())
}

/// Ferry a script from Nyx toward the engine. Writes `source` into the Charon
/// `out/` directory under a file whose name and suffix encode the target
/// instance path and class; the running Charon sidecar watches `out/`, queues
/// the change, and the engine plugin's Live Sync pulls and materialises it.
///
/// `path` is an engine instance path (e.g. `game.ServerScriptService.Main`).
/// `class` chooses the Rojo-style suffix: `Script` → `.server.luau`,
/// `LocalScript` → `.client.luau`, anything else → `.luau` (ModuleScript).
/// Every segment is sanitized and the result confined to the ferry root, the
/// same path-confinement the sidecar applies to input from across the river.
/// Returns the absolute path written.
#[tauri::command]
pub fn charon_sync(
    workspace: String,
    path: String,
    class: Option<String>,
    source: String,
) -> Result<String, String> {
    if workspace.trim().is_empty() {
        return Err("workspace is required".into());
    }

    let Extension = match class.as_deref() {
        Some("Script") => "server.luau",
        Some("LocalScript") => "client.luau",
        _ => "luau",
    };

    let OutRoot = std::path::Path::new(&workspace)
        .join(".charon")
        .join("out");

    let Segments: Vec<String> = path
        .split('.')
        .filter(|s| !s.trim().is_empty())
        .filter_map(|segment| {
            let cleaned: String = segment
                .chars()
                .map(|c| {
                    if c.is_alphanumeric() || c == '_' || c == '-' || c == ' ' {
                        c
                    } else {
                        '_'
                    }
                })
                .collect();
            let cleaned = cleaned.trim().to_string();
            if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
                None
            } else {
                Some(cleaned)
            }
        })
        .collect();
    if Segments.is_empty() {
        return Err("empty or invalid instance path".into());
    }

    let mut Target = OutRoot.clone();
    let LastIndex = Segments.len() - 1;
    for (index, segment) in Segments.iter().enumerate() {
        if index == LastIndex {
            Target.push(format!("{segment}.{Extension}"));
        } else {
            Target.push(segment);
        }
    }

    // Defense in depth: confine to the ferry root even though the per-segment
    // sanitizer above already strips traversal.
    if !Target.starts_with(&OutRoot) {
        return Err("resolved path escapes the ferry root".into());
    }

    let Parent = Target
        .parent()
        .ok_or("could not determine ferry directory")?;
    std::fs::create_dir_all(Parent).map_err(|e| e.to_string())?;

    // Atomic write: stage to a sibling temp file, then rename into place. The
    // sidecar's out/ watcher therefore only ever sees a complete file — never a
    // half-flushed one — and the temp name (leading dot, not `.luau`) is ignored
    // by the watcher even if it fires on it.
    let FileName = Target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "ferry".to_string());
    let Tmp = Parent.join(format!(".{}.tmp.{}", FileName, std::process::id()));

    if let Err(e) = std::fs::write(&Tmp, source) {
        let _ = std::fs::remove_file(&Tmp);
        return Err(format!("could not stage ferry file: {e}"));
    }
    if let Err(e) = std::fs::rename(&Tmp, &Target) {
        let _ = std::fs::remove_file(&Tmp);
        return Err(format!("could not commit ferry file: {e}"));
    }

    Ok(Target.to_string_lossy().to_string())
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

    // Cost guard: agentic mode is DeepSeek-only. OpenAI/Anthropic keys are limited
    // to supervised/autonomous until agentic cost is brought under control.
    let AgentMode = match agent::AgentMode::FromStr(&mode) {
        agent::AgentMode::Agentic if provider != "deepseek" => agent::AgentMode::Autonomous,
        Requested => Requested,
    };
    let Resolved = crate::skills::Resolve(&skills.unwrap_or_default());
    for (skill_id, reason) in &Resolved.blocked {
        let _ = window.emit(
            "ai_event",
            serde_json::json!({
                "type": "skill_blocked",
                "skill_id": skill_id,
                "reason": reason,
            }),
        );
    }
    let system = agent::BuildSystemPrompt(
        workspace.as_deref(),
        &AgentMode,
        &Resolved.loaded,
        &provider,
    );

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
