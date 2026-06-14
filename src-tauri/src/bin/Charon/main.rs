#![allow(non_snake_case)]

use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::{RecursiveMode, Watcher};
use tiny_http::{Header, Method, Response, Server};

const PROTOCOL_VERSION: u32 = 2;
const DEFAULT_PORT: u16 = 34777;

const MAX_PUSH_BYTES: u64 = 16 * 1024 * 1024;
const MAX_QUEUE: usize = 8192;

const READ_RETRIES: u32 = 6;

struct Config {
    port: u16,
    root: PathBuf,
}

fn ParseArgs() -> Config {
    let mut port = DEFAULT_PORT;
    let mut root: Option<PathBuf> = None;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--port" => {
                if let Some(value) = args.next() {
                    if let Ok(parsed) = value.parse() {
                        port = parsed;
                    }
                }
            }
            "--root" => {
                if let Some(value) = args.next() {
                    root = Some(PathBuf::from(value));
                }
            }
            _ => {}
        }
    }

    let root = root.unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("charon_ferry")
    });

    Config { port, root }
}
fn SessionId() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}-{:x}", now, std::process::id())
}

fn JsonResponse(body: String) -> Response<std::io::Cursor<Vec<u8>>> {
    let header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
        .expect("static header is valid");
    Response::from_string(body).with_header(header)
}

#[derive(Clone)]
struct Change {
    cursor: u64,
    path: String,
    class: String,
    source: String,
    removed: bool,
}

#[derive(Default)]
struct Queue {
    changes: Vec<Change>,
    next_cursor: u64,
    floor: u64,
}

impl Queue {
    fn enqueue(&mut self, path: String, class: String, source: String, removed: bool) -> bool {
        if let Some(existing) = self.changes.iter().find(|c| c.path == path) {
            if existing.removed == removed && existing.class == class && existing.source == source {
                return false;
            }
        }
        self.changes.retain(|c| c.path != path);
        self.next_cursor += 1;
        let cursor = self.next_cursor;
        self.changes.push(Change {
            cursor,
            path,
            class,
            source,
            removed,
        });
        while self.changes.len() > MAX_QUEUE {
            let evicted = self.changes.remove(0);
            if evicted.cursor > self.floor {
                self.floor = evicted.cursor;
            }
        }
        true
    }

    fn since(&self, cursor: u64) -> (u64, u64, Vec<Change>) {
        let pending = self
            .changes
            .iter()
            .filter(|c| c.cursor > cursor)
            .cloned()
            .collect();
        (self.next_cursor, self.floor, pending)
    }
}

fn LockQueue(queue: &Mutex<Queue>) -> MutexGuard<'_, Queue> {
    queue.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn ParseCursor(url: &str) -> u64 {
    let query = match url.split('?').nth(1) {
        Some(q) => q,
        None => return 0,
    };
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        if kv.next() == Some("cursor") {
            return kv.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        }
    }
    0
}

fn SafeFerryPath(root: &Path, instance_path: &str) -> Option<PathBuf> {
    let segments: Vec<&str> = instance_path
        .split('.')
        .filter(|s| !s.trim().is_empty())
        .collect();
    if segments.is_empty() {
        return None;
    }

    let mut relative = PathBuf::new();
    for segment in segments {
        let cleaned = SanitizeSegment(segment)?;
        relative.push(cleaned);
    }
    relative.set_extension("luau");

    Confine(root, &root.join(&relative))
}

fn SanitizeSegment(segment: &str) -> Option<String> {
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
    let cleaned = cleaned.trim();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        return None;
    }
    Some(cleaned.to_string())
}

fn Confine(root: &Path, candidate: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    if normalized.starts_with(root) {
        Some(normalized)
    } else {
        None
    }
}

fn MapOutFile(out_root: &Path, file: &Path) -> Option<(String, String)> {
    let relative = file.strip_prefix(out_root).ok()?;
    let mut segments: Vec<String> = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(s) => segments.push(s.to_string_lossy().to_string()),
            _ => return None,
        }
    }
    let last = segments.pop()?;

    let (name, class) = if let Some(stem) = last.strip_suffix(".server.luau") {
        (stem, "Script")
    } else if let Some(stem) = last.strip_suffix(".client.luau") {
        (stem, "LocalScript")
    } else if let Some(stem) = last.strip_suffix(".luau") {
        (stem, "ModuleScript")
    } else {
        return None;
    };
    if name.is_empty() {
        return None;
    }

    segments.push(name.to_string());
    Some((segments.join("."), class.to_string()))
}

fn ReadWithRetry(path: &Path) -> Option<String> {
    let mut delay = Duration::from_millis(15);
    for attempt in 0..READ_RETRIES {
        match std::fs::read_to_string(path) {
            Ok(contents) => return Some(contents),
            Err(_) if attempt + 1 < READ_RETRIES => {
                std::thread::sleep(delay);
                delay = (delay * 2).min(Duration::from_millis(250));
            }
            Err(_) => return None,
        }
    }
    None
}

fn HandlePush(in_root: &Path, body: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("invalid JSON: {e}"))?;
    let instance_path = value
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or("missing 'path'")?;
    let source = value.get("source").and_then(|v| v.as_str()).unwrap_or("");

    let target = SafeFerryPath(in_root, instance_path).ok_or("unsafe or empty instance path")?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    WriteAtomic(&target, source).map_err(|e| e.to_string())?;

    let relative = target.strip_prefix(in_root).unwrap_or(&target);
    let written = relative.to_string_lossy().replace('\\', "/");
    println!("[Charon] ferried {instance_path} -> in/{written}");
    Ok(serde_json::json!({ "ok": true, "wrote": written }).to_string())
}

fn WriteAtomic(target: &Path, contents: &str) -> std::io::Result<()> {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "ferry".to_string());
    let tmp = parent.join(format!(".{}.tmp.{}", file_name, std::process::id()));

    if let Err(e) = std::fs::write(&tmp, contents) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

fn SpawnOutWatcher(out_root: PathBuf, queue: Arc<Mutex<Queue>>) {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = match notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    }) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[Charon] could not start the out/ watcher: {e}");
            eprintln!("[Charon] Nyx → engine live sync is disabled this run; pushes still work.");
            return;
        }
    };
    if let Err(e) = watcher.watch(&out_root, RecursiveMode::Recursive) {
        eprintln!("[Charon] could not watch {}: {e}", out_root.display());
        eprintln!("[Charon] Nyx → engine live sync is disabled this run; pushes still work.");
        return;
    }

    std::thread::spawn(move || {
        let _watcher = watcher;
        for res in rx {
            let event = match res {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("[Charon] watch event error: {e}");
                    continue;
                }
            };
            match event.kind {
                notify::EventKind::Create(_) | notify::EventKind::Modify(_) => {
                    for path in &event.paths {
                        QueueFromFile(&out_root, path, &queue);
                    }
                }
                notify::EventKind::Remove(_) => {
                    for path in &event.paths {
                        if let Some((instance_path, class)) = MapOutFile(&out_root, path) {
                            if LockQueue(&queue).enqueue(
                                instance_path.clone(),
                                class,
                                String::new(),
                                true,
                            ) {
                                println!("[Charon] queued removal of {instance_path}");
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        eprintln!("[Charon] out/ watcher stopped (event channel closed).");
    });
}

fn QueueFromFile(out_root: &Path, path: &Path, queue: &Mutex<Queue>) {
    let (instance_path, class) = match MapOutFile(out_root, path) {
        Some(mapped) => mapped,
        None => return,
    };
    if !path.is_file() {
        return;
    }
    let source = match ReadWithRetry(path) {
        Some(contents) => contents,
        None => {
            eprintln!("[Charon] could not read {} after retries; skipping", path.display());
            return;
        }
    };
    if LockQueue(queue).enqueue(instance_path.clone(), class, source, false) {
        println!("[Charon] queued {instance_path} for engine pull");
    }
}

fn main() {
    let config = ParseArgs();
    let session = SessionId();

    let in_root = config.root.join("in");
    let out_root = config.root.join("out");
    for dir in [&config.root, &in_root, &out_root] {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("[Charon] could not create {}: {e}", dir.display());
            std::process::exit(1);
        }
    }

    let queue: Arc<Mutex<Queue>> = Arc::new(Mutex::new(Queue::default()));
    SpawnOutWatcher(out_root.clone(), Arc::clone(&queue));

    let addr = format!("127.0.0.1:{}", config.port);
    let server = match Server::http(&addr) {
        Ok(server) => server,
        Err(e) => {
            eprintln!("[Charon] could not bind {addr}: {e}");
            std::process::exit(1);
        }
    };

    println!("╔══════════════════════════════════════════╗");
    println!("║  Charon — the Nyx ferry                    ║");
    println!("╚══════════════════════════════════════════╝");
    println!("[Charon] listening on http://{addr}");
    println!("[Charon] ferry root: {}", config.root.display());
    println!("[Charon]   in/  (engine → Nyx): {}", in_root.display());
    println!("[Charon]   out/ (Nyx → engine): {}", out_root.display());
    println!("[Charon] protocol v{PROTOCOL_VERSION}, session {session}");

    for mut request in server.incoming_requests() {
        let method = request.method().clone();
        let url = request.url().to_string();
        let path = url.split('?').next().unwrap_or("/");

        match (&method, path) {
            (Method::Get, "/") => {
                let body = serde_json::json!({
                    "name": "Charon",
                    "role": "ferry",
                    "protocol": PROTOCOL_VERSION,
                    "session": session,
                })
                .to_string();
                let _ = request.respond(JsonResponse(body));
            }
            (Method::Get, "/ping") => {
                let _ = request.respond(Response::from_string("pong"));
            }
            (Method::Get, "/pull") => {
                let cursor = ParseCursor(&url);
                let (head, floor, pending) = {
                    let q = LockQueue(&queue);
                    q.since(cursor)
                };
                let changes: Vec<serde_json::Value> = pending
                    .iter()
                    .map(|c| {
                        serde_json::json!({
                            "cursor": c.cursor,
                            "path": c.path,
                            "class": c.class,
                            "source": c.source,
                            "removed": c.removed,
                        })
                    })
                    .collect();
                let body = serde_json::json!({
                    "session": session,
                    "cursor": head,
                    "floor": floor,
                    "changes": changes,
                })
                .to_string();
                let _ = request.respond(JsonResponse(body));
            }
            (Method::Post, "/push") => {
                if let Some(len) = request.body_length() {
                    if len as u64 > MAX_PUSH_BYTES {
                        let _ = request.respond(
                            JsonResponse(r#"{"ok":false,"error":"body too large"}"#.to_string())
                                .with_status_code(413),
                        );
                        continue;
                    }
                }
                let mut body = String::new();
                if request
                    .as_reader()
                    .take(MAX_PUSH_BYTES + 1)
                    .read_to_string(&mut body)
                    .is_err()
                {
                    let _ = request.respond(
                        JsonResponse(r#"{"ok":false,"error":"could not read body"}"#.to_string())
                            .with_status_code(400),
                    );
                    continue;
                }
                if body.len() as u64 > MAX_PUSH_BYTES {
                    let _ = request.respond(
                        JsonResponse(r#"{"ok":false,"error":"body too large"}"#.to_string())
                            .with_status_code(413),
                    );
                    continue;
                }
                match HandlePush(&in_root, &body) {
                    Ok(reply) => {
                        let _ = request.respond(JsonResponse(reply));
                    }
                    Err(err) => {
                        let reply = serde_json::json!({ "ok": false, "error": err }).to_string();
                        let _ = request.respond(JsonResponse(reply).with_status_code(400));
                    }
                }
            }
            _ => {
                let reply = serde_json::json!({ "ok": false, "error": "not found" }).to_string();
                let _ = request.respond(JsonResponse(reply).with_status_code(404));
            }
        }
    }
}
