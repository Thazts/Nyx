use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct AppState {
    pub workspace_path: Mutex<Option<String>>, // { workspace path }
    pub open_files: Mutex<Vec<String>>,        // { file paths }
    pub active_file: Mutex<Option<String>>,    // { current file path }
    pub file_metadata: Mutex<HashMap<String, FileRecord>>, // { file path -> FileRecord }
    pub terminal_output: Mutex<Vec<String>>,   // { terminal lines }
    pub run_output: Mutex<Vec<String>>,        // { terminal lines }
    pub is_running: Mutex<bool>,
    pub scene_profile: Mutex<Option<String>>, // { engine profile }
    pub scene_commands: Mutex<Vec<serde_json::Value>>, // { SceneCommand }
    pub selected_part_id: Mutex<Option<String>>, // { renderer part id }
    pub gizmo_mode: Mutex<String>,
    pub viewport_visible: Mutex<bool>,
    pub ai_activity: Mutex<Option<String>>, // { activity label }
    pub ai_pending_approval: Mutex<Option<String>>, // { tool call id }
    pub watcher_shutdown: Mutex<Option<std::sync::mpsc::SyncSender<()>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct FileRecord {
    pub size: u64,
    pub modified: String,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            workspace_path: Mutex::new(None),
            open_files: Mutex::new(Vec::new()),
            active_file: Mutex::new(None),
            file_metadata: Mutex::new(HashMap::new()),
            terminal_output: Mutex::new(Vec::new()),
            run_output: Mutex::new(Vec::new()),
            is_running: Mutex::new(false),
            scene_profile: Mutex::new(None),
            scene_commands: Mutex::new(Vec::new()),
            selected_part_id: Mutex::new(None),
            gizmo_mode: Mutex::new("move".to_string()),
            viewport_visible: Mutex::new(false),
            ai_activity: Mutex::new(None),
            ai_pending_approval: Mutex::new(None),
            watcher_shutdown: Mutex::new(None),
        }
    }
}
