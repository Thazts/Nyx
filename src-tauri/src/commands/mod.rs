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
