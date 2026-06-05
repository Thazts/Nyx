use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

static CHANGE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct AgentActivityEvent {
    pub kind: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct AiChangePreview {
    pub start_line: usize,
    pub removed: usize,
    pub added: usize,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct AiChangeEvent {
    pub id: String,
    pub tool_call_id: String,
    pub path: String,
    pub kind: String,
    pub status: String,
    pub preview: AiChangePreview,
    pub before: String,
    pub after: String,
}

pub fn ActivityForTool(tool: &str) -> AgentActivityEvent {
    let (kind, label) = match tool {
        "read_file" | "read_file_range" | "summarize_file" => ("reading", "Reading files"),
        "list_directory" | "list_tree" | "find_files" | "search_files" | "grep" => {
            ("searching", "Searching workspace")
        }
        "write_file" | "edit_file" | "write_obsidian" => ("editing", "Preparing changes"),
        "run_command" | "run_powershell" => ("running", "Running command"),
        "create_memory" | "list_memories" | "read_memory" => ("memory", "Using memory"),
        "read_obsidian" | "search_obsidian" => ("notes", "Using notes"),
        "ask_user" => ("waiting_question", "Waiting for answer"),
        _ => ("working", "Working"),
    };

    AgentActivityEvent {
        kind: kind.to_string(),
        label: label.to_string(),
    }
}

pub fn SimpleActivity(kind: &str, label: &str) -> AgentActivityEvent {
    AgentActivityEvent {
        kind: kind.to_string(),
        label: label.to_string(),
    }
}

pub fn BuildChangePreview(before: &str, after: &str) -> AiChangePreview {
    let before_lines: Vec<&str> = before.lines().collect();
    let after_lines: Vec<&str> = after.lines().collect();
    let mut start = 0usize;
    while start < before_lines.len()
        && start < after_lines.len()
        && before_lines[start] == after_lines[start]
    {
        start += 1;
    }

    let mut end_before = before_lines.len();
    let mut end_after = after_lines.len();
    while end_before > start
        && end_after > start
        && before_lines[end_before - 1] == after_lines[end_after - 1]
    {
        end_before -= 1;
        end_after -= 1;
    }

    let removed = end_before.saturating_sub(start);
    let added = end_after.saturating_sub(start);
    let mut lines = Vec::new();
    lines.push(format!(
        "change: line {} | -{} +{}",
        start + 1,
        removed,
        added
    ));

    for line in before_lines.iter().skip(start).take(removed.min(18)) {
        lines.push(format!("- {}", line));
    }
    for line in after_lines.iter().skip(start).take(added.min(18)) {
        lines.push(format!("+ {}", line));
    }
    if removed > 18 || added > 18 {
        lines.push("... preview truncated".to_string());
    }

    AiChangePreview {
        start_line: start + 1,
        removed,
        added,
        lines,
    }
}

pub fn ChangePreviewText(preview: &AiChangePreview) -> String {
    preview.lines.join("\n")
}

pub fn BuildChangeEvent(
    tool_call_id: &str,
    path: &str,
    kind: &str,
    status: &str,
    before: &str,
    after: &str,
) -> AiChangeEvent {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let index = CHANGE_COUNTER.fetch_add(1, Ordering::Relaxed);

    AiChangeEvent {
        id: format!("Change_{millis}_{index}"),
        tool_call_id: tool_call_id.to_string(),
        path: path.to_string(),
        kind: kind.to_string(),
        status: status.to_string(),
        preview: BuildChangePreview(before, after),
        before: before.to_string(),
        after: after.to_string(),
    }
}
