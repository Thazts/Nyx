use std::sync::Mutex;

pub struct AppState {
    pub open_files: Mutex<Vec<String>>,          // { file paths }
    pub active_file: Mutex<Option<String>>,      // { current file path }
    pub terminal_output: Mutex<Vec<String>>,     // { terminal lines }
}
