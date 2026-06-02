pub mod agent;

use std::fs;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, State};
use serde::Serialize;
use mlua::{Lua, Value as LuaValue, MultiValue as LuaMultiValue, Table as LuaTable};
use sysinfo::System;

use crate::renderer::{NyxRenderer, window as nyx_window};

const ROBLOX_SHIM: &str = include_str!("../../../nyx_runtime/roblox/init.lua");

static SYS_MONITOR: OnceLock<Mutex<System>> = OnceLock::new();

#[derive(Serialize)]
pub struct SystemStats {
    pub cpu_usage:         f32,
    pub memory_used_mb:    u64,
    pub memory_total_mb:   u64,
    pub process_memory_mb: u64,
}

#[tauri::command]
pub fn get_system_stats() -> SystemStats {
    let monitor = SYS_MONITOR.get_or_init(|| Mutex::new(System::new_all()));
    let mut sys = monitor.lock().unwrap_or_else(|e| e.into_inner());
    sys.refresh_all();

    let cpu_usage        = sys.global_cpu_usage();
    let memory_used_mb   = sys.used_memory()  / (1024 * 1024);
    let memory_total_mb  = sys.total_memory() / (1024 * 1024);
    let current_pid      = sysinfo::Pid::from(std::process::id() as usize);
    let process_memory_mb = sys.process(current_pid)
        .map(|p| p.memory() / (1024 * 1024))
        .unwrap_or(0);

    SystemStats { cpu_usage, memory_used_mb, memory_total_mb, process_memory_mb }
}

#[derive(Serialize)]
pub struct FileMetadata {
    pub size:     u64,
    pub modified: String,
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

fn skip_dir(name: &str) -> bool {
    matches!(name,
        "node_modules" | ".git" | "target" | "__pycache__" |
        ".next" | "dist" | "build" | ".svelte-kit" | ".venv" |
        "venv" | "vendor" | ".idea" | ".vscode" | "aider"
    ) || name.starts_with(".aider")
}

#[tauri::command]
pub fn list_files_recursive(path: String) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    let entries = fs::read_dir(&path).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let name = entry_path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if entry_path.is_file() {
            result.push(entry_path.to_string_lossy().to_string());
        } else if entry_path.is_dir() && !skip_dir(&name) {
            let sub_files = list_files_recursive(entry_path.to_string_lossy().to_string())?;
            result.extend(sub_files);
        }
    }
    result.sort();
    Ok(result)
}

#[tauri::command]
pub fn open_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn run_terminal_command(command: String) -> Vec<String> {
    let output = std::process::Command::new("cmd")
        .args(["/C", &command])
        .output();
    match output {
        Ok(out) => {
            let mut lines = vec![format!("$ {}", command)];
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                let t = line.trim_end_matches('\r');
                if !t.is_empty() { lines.push(t.to_string()); }
            }
            let stderr = String::from_utf8_lossy(&out.stderr);
            for line in stderr.lines() {
                let t = line.trim_end_matches('\r');
                if !t.is_empty() { lines.push(format!("err: {}", t)); }
            }
            lines
        }
        Err(e) => vec![format!("$ {}", command), format!("err: {}", e)],
    }
}

#[tauri::command]
pub fn select_folder() -> Result<String, String> {
    let dialog = rfd::FileDialog::new().pick_folder();
    match dialog {
        Some(path) => Ok(path.to_string_lossy().to_string()),
        None => Err("No folder selected".to_string()),
    }
}

#[tauri::command]
pub fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let meta     = fs::metadata(&path).map_err(|e| e.to_string())?;
    let size     = meta.len();
    let modified = meta.modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let secs = modified as i64;
    let (year, month, day, hour, min, sec) = secs_to_datetime(secs);
    let modified_str = format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", year, month, day, hour, min, sec);

    Ok(FileMetadata { size, modified: modified_str })
}

fn secs_to_datetime(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = secs / 86400;

    let mut year = 1970i32;
    let mut remaining = days;
    loop {
        let dy = if is_leap(year) { 366 } else { 365 };
        if remaining < dy { break; }
        remaining -= dy;
        year += 1;
    }
    let months = if is_leap(year) {
        [31,29,31,30,31,30,31,31,30,31,30,31]
    } else {
        [31,28,31,30,31,30,31,31,30,31,30,31]
    };
    let mut month = 1u32;
    for dm in &months {
        if remaining < *dm { break; }
        remaining -= *dm;
        month += 1;
    }
    (year, month, remaining as u32 + 1, h as u32, m as u32, s as u32)
}

fn is_leap(y: i32) -> bool {
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
                if !t.is_empty() { lines.push(t.to_string()); }
            }
            let stderr = String::from_utf8_lossy(&out.stderr);
            for line in stderr.lines() {
                let t = line.trim_end_matches('\r');
                if !t.is_empty() { lines.push(format!("err: {}", t)); }
            }
            if lines.is_empty() { lines.push("(no output)".to_string()); }
            lines
        }
        Err(e) => vec![format!("err: {}", e)],
    }
}

#[tauri::command]
pub fn run_file(path: String) -> Vec<String> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "lua" | "luau" => run_lua_embedded(&path),
        "py"           => run_subprocess("python", &path),
        "js"           => run_subprocess("node",   &path),
        _              => vec![format!("No runner configured for .{} files", ext)],
    }
}

fn run_lua_embedded(path: &str) -> Vec<String> {
    let code = match fs::read_to_string(path) {
        Ok(c)  => c,
        Err(e) => return vec![
            format!("\u{25b6} {}", path),
            format!("err: {}", e),
            "exit 1".to_string(),
        ],
    };

    let lua   = Lua::new();
    let lines = Arc::new(Mutex::new(vec![format!("\u{25b6} {}", path)]));
    let sink  = Arc::clone(&lines);

    if let Ok(f) = lua.create_function(move |_, args: LuaMultiValue| {
        let text = args.iter().map(lua_display).collect::<Vec<_>>().join("\t");
        sink.lock().unwrap().push(text);
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
        Ok(_)  => lines.lock().unwrap().push("exit 0".to_string()),
        Err(e) => {
            let mut l = lines.lock().unwrap();
            l.push(format!("err: {}", e));
            l.push("exit 1".to_string());
        }
    }

    let result = lines.lock().unwrap().clone();
    result
}

fn run_subprocess(program: &str, path: &str) -> Vec<String> {
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
    pub errors:   Vec<String>,
    pub skipped:  bool,
}

#[tauri::command]
pub fn run_scene(path: String, profile: String) -> Result<RunSceneResult, String> {
    run_scene_at_time(path, profile, None)
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
    run_scene_at_time(path, profile, Some(elapsed))
}

fn run_scene_at_time(path: String, profile: String, elapsed: Option<f64>) -> Result<RunSceneResult, String> {
    let shim = match profile.as_str() {
        "roblox" => ROBLOX_SHIM,
        other    => return Err(format!("Unknown engine profile: '{}'", other)),
    };

    let user_code = fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read scene file: {}", e))?;

    let lua      = Lua::new();
    let captured = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink     = Arc::clone(&captured);

    let print_fn = lua.create_function(move |_, args: LuaMultiValue| {
        let text = args.iter().map(lua_display).collect::<Vec<_>>().join("\t");
        sink.lock().unwrap().push(text);
        Ok(())
    }).map_err(|e| e.to_string())?;
    lua.globals().set("print", print_fn).map_err(|e| e.to_string())?;
    if let Some(elapsed) = elapsed {
        lua.globals().set("_NYX_LIVE_TIME", elapsed).map_err(|e| e.to_string())?;
    }

    lua.load(shim).exec()
        .map_err(|e| format!("Runtime shim error: {}", e))?;

    let mut errors = Vec::new();
    if let Err(e) = lua.load(&user_code).exec() {
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

    let (commands, cmd_err) = match read_nyx_commands(&lua) {
        Ok(cmds) => (cmds, None),
        Err(e)   => (vec![], Some(e)),
    };
    let terminal = captured.lock().unwrap().clone();
    if let Some(e) = cmd_err {
        errors.push(format!("_NYX_COMMANDS read error: {}", e));
    }

    Ok(RunSceneResult { commands, terminal, errors, skipped: false })
}

fn read_nyx_commands(lua: &Lua) -> Result<Vec<serde_json::Value>, String> {
    let tbl: LuaTable = lua.globals()
        .get("_NYX_COMMANDS")
        .map_err(|_| "_NYX_COMMANDS missing — did the shim load?".to_string())?;

    let mut out = Vec::new();
    for item in tbl.sequence_values::<LuaTable>() {
        let cmd = item.map_err(|e| e.to_string())?;
        out.push(lua_table_to_json(cmd));
    }
    Ok(out)
}

fn lua_table_to_json(tbl: LuaTable) -> serde_json::Value {
    let len = tbl.raw_len();
    if len > 0 {
        let arr = (1..=len)
            .filter_map(|i| tbl.raw_get::<LuaValue>(i as i64).ok())
            .map(lua_value_to_json)
            .collect();
        return serde_json::Value::Array(arr);
    }
    let mut map = serde_json::Map::new();
    for pair in tbl.pairs::<String, LuaValue>() {
        if let Ok((k, v)) = pair {
            map.insert(k, lua_value_to_json(v));
        }
    }
    serde_json::Value::Object(map)
}

fn lua_value_to_json(v: LuaValue) -> serde_json::Value {
    match v {
        LuaValue::Nil        => serde_json::Value::Null,
        LuaValue::Boolean(b) => serde_json::Value::Bool(b),
        LuaValue::Integer(i) => serde_json::Value::Number(i.into()),
        LuaValue::Number(n)  => serde_json::Number::from_f64(n)
                                    .map(serde_json::Value::Number)
                                    .unwrap_or(serde_json::Value::Null),
        LuaValue::String(s)  => serde_json::Value::String(
                                    String::from_utf8_lossy(&s.as_bytes()).into_owned()),
        LuaValue::Table(t)   => lua_table_to_json(t),
        _                    => serde_json::Value::Null,
    }
}

fn lua_display(v: &LuaValue) -> String {
    match v {
        LuaValue::Nil        => "nil".to_string(),
        LuaValue::Boolean(b) => b.to_string(),
        LuaValue::Integer(i) => i.to_string(),
        LuaValue::Number(n)  => {
            if n.fract() == 0.0 && n.abs() < 1e15 { format!("{}", *n as i64) }
            else { format!("{n}") }
        }
        LuaValue::String(s)  => String::from_utf8_lossy(&s.as_bytes()).into_owned(),
        LuaValue::Table(_)   => "(table)".to_string(),
        _                    => "(value)".to_string(),
    }
}

#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn rename_path(path: String, new_name: String) -> Result<String, String> {
    let old    = std::path::Path::new(&path);
    let parent = old.parent().ok_or("No parent directory")?;
    let new    = parent.join(&new_name);
    fs::rename(&path, &new).map_err(|e| e.to_string())?;
    Ok(new.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

type RendererState = Arc<Mutex<NyxRenderer>>;

#[tauri::command]
pub fn renderer_camera_orbit(
    dx: f32, dy: f32,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r  = renderer.lock().map_err(|e| e.to_string())?;
    let mut ci = r.camera_input.lock().map_err(|e| e.to_string())?;
    ci.orbit_dx += dx;
    ci.orbit_dy += dy;
    Ok(())
}

#[tauri::command]
pub fn renderer_camera_pan(
    dx: f32, dy: f32,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r  = renderer.lock().map_err(|e| e.to_string())?;
    let mut ci = r.camera_input.lock().map_err(|e| e.to_string())?;
    ci.pan_dx += dx;
    ci.pan_dy += dy;
    Ok(())
}

#[tauri::command]
pub fn renderer_camera_zoom(
    delta: f32,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r  = renderer.lock().map_err(|e| e.to_string())?;
    let mut ci = r.camera_input.lock().map_err(|e| e.to_string())?;
    ci.zoom += delta;
    Ok(())
}

#[tauri::command]
pub fn renderer_camera_wasd(
    forward: f32, right: f32, up: f32,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r  = renderer.lock().map_err(|e| e.to_string())?;
    let mut ci = r.camera_input.lock().map_err(|e| e.to_string())?;
    ci.forward += forward;
    ci.right   += right;
    ci.up      += up;
    Ok(())
}

#[tauri::command]
pub fn renderer_camera_right_mouse(
    down: bool,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    // This command is a no‑op on the Rust side; the frontend uses it to
    // know when to capture mouse events.  We keep it for future use.
    Ok(())
}

fn ray_aabb_intersect(origin: glam::Vec3, dir: glam::Vec3, min: glam::Vec3, max: glam::Vec3) -> Option<f32> {
    let inv_dir = 1.0 / dir;
    let mut tmin = (min.x - origin.x) * inv_dir.x;
    let mut tmax = (max.x - origin.x) * inv_dir.x;
    if inv_dir.x < 0.0 { std::mem::swap(&mut tmin, &mut tmax); }

    let mut tymin = (min.y - origin.y) * inv_dir.y;
    let mut tymax = (max.y - origin.y) * inv_dir.y;
    if inv_dir.y < 0.0 { std::mem::swap(&mut tymin, &mut tymax); }

    if tmin > tymax || tymin > tmax { return None; }
    if tymin > tmin { tmin = tymin; }
    if tymax < tmax { tmax = tymax; }

    let mut tzmin = (min.z - origin.z) * inv_dir.z;
    let mut tzmax = (max.z - origin.z) * inv_dir.z;
    if inv_dir.z < 0.0 { std::mem::swap(&mut tzmin, &mut tzmax); }

    if tmin > tzmax || tzmin > tmax { return None; }
    if tzmin > tmin { tmin = tzmin; }
    if tzmax < tmax { tmax = tzmax; }

    if tmax < 0.0 { return None; }
    Some(tmin.max(0.0))
}

fn dist_ray_segment(ray_origin: glam::Vec3, ray_dir: glam::Vec3, p0: glam::Vec3, p1: glam::Vec3) -> f32 {
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

// t on the infinite line (line_o + t*line_d) closest to the given ray — used
// for axis-constrained gizmo drag; delta t equals world-space displacement along the axis.
fn closest_t_on_line(
    ray_o:  glam::Vec3,
    ray_d:  glam::Vec3,
    line_o: glam::Vec3,
    line_d: glam::Vec3,
) -> f32 {
    let w   = ray_o - line_o;
    let b   = ray_d.dot(line_d);
    let d   = ray_d.dot(w);
    let e   = line_d.dot(w);
    let den = 1.0 - b * b;
    if den.abs() < 1e-6 { return e; }
    (e - b * d) / den
}

#[tauri::command]
pub fn renderer_gizmo_hit_test(
    x: f32, y: f32, width: f32, height: f32,
    renderer: State<'_, RendererState>,
) -> Result<Option<String>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let s = r.state.lock().map_err(|e| e.to_string())?;

    let sel = match &s.selected { Some(id) => id.clone(), None => return Ok(None) };

    let ndc_x = (x / width)  * 2.0 - 1.0;
    let ndc_y = 1.0 - (y / height) * 2.0;
    let (origin, dir) = s.camera.get_ray(ndc_x, ndc_y);

    for cmd in &s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
        if cmd.get("Id").and_then(|v| v.as_str())  != Some(sel.as_str()) { continue; }

        let gf = |k: &str, f: &str| -> f32 {
            cmd.get(k).and_then(|o| o.get(f)).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
        };
        let c   = glam::Vec3::new(gf("Position","X"), gf("Position","Y"), gf("Position","Z"));
        let sx  = gf("Size","X"); let sy = gf("Size","Y"); let sz = gf("Size","Z");

        match s.gizmo_mode.as_str() {
            "rotate" => {
                let radius = sx.max(sy).max(sz) * 0.5 + 0.8;
                let thr = 0.4_f32;
                let test_ring = |plane_normal: glam::Vec3| -> Option<f32> {
                    let denom = plane_normal.dot(dir);
                    if denom.abs() < 1e-6 { return None; }
                    let t = plane_normal.dot(c - origin) / denom;
                    if t < 0.0 { return None; }
                    let hit = origin + dir * t;
                    let dist = ((hit - c).length() - radius).abs();
                    if dist < thr { Some(dist) } else { None }
                };
                let dx = test_ring(glam::Vec3::X);
                let dy = test_ring(glam::Vec3::Y);
                let dz = test_ring(glam::Vec3::Z);
                let best = [("X", dx), ("Y", dy), ("Z", dz)]
                    .into_iter()
                    .filter_map(|(ax, d)| d.map(|v| (ax, v)))
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
                if let Some((ax, _)) = best { return Ok(Some(ax.into())); }
            }
            "scale" => {
                let len = 6.0_f32;
                let thr = 1.0_f32;
                let tips = [
                    ("X", c + glam::Vec3::X * len),
                    ("Y", c + glam::Vec3::Y * len),
                    ("Z", c + glam::Vec3::Z * len),
                ];
                let best = tips.iter()
                    .map(|(ax, tip)| {
                        let v = *tip - origin;
                        let t = v.dot(dir);
                        let d = (v - dir * t).length();
                        (ax, d)
                    })
                    .filter(|(_, d)| *d < thr)
                    .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
                if let Some((ax, _)) = best { return Ok(Some((*ax).into())); }
            }
            _ => { // "move"
                let len = 6.0_f32;
                let dx  = dist_ray_segment(origin, dir, c, c + glam::Vec3::X * len);
                let dy  = dist_ray_segment(origin, dir, c, c + glam::Vec3::Y * len);
                let dz  = dist_ray_segment(origin, dir, c, c + glam::Vec3::Z * len);
                let thr = 0.8_f32;
                if dx < thr && dx < dy && dx < dz { return Ok(Some("X".into())); }
                if dy < thr && dy < dz            { return Ok(Some("Y".into())); }
                if dz < thr                       { return Ok(Some("Z".into())); }
            }
        }
        break;
    }

    Ok(None)
}

#[tauri::command]
pub fn renderer_gizmo_drag(
    axis:   String,
    prev_x: f32, prev_y: f32,
    curr_x: f32, curr_y: f32,
    width:  f32, height: f32,
    renderer: State<'_, RendererState>,
) -> Result<Option<[f32; 3]>, String> {
    let r   = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;

    let sel = match s.selected.clone() {
        Some(id) => id,
        None     => return Ok(None),
    };

    if !s.drag_undo_pushed {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        push_undo(&s, &mut u);
        s.drag_undo_pushed = true;
    }

    let axis_dir = match axis.as_str() {
        "X" => glam::Vec3::X,
        "Y" => glam::Vec3::Y,
        "Z" => glam::Vec3::Z,
        _   => return Ok(None),
    };

    let part_pos = {
        let mut found = None;
        for cmd in &s.commands {
            if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
            if cmd.get("Id").and_then(|v| v.as_str())  != Some(sel.as_str()) { continue; }
            let f = |k: &str, ff: &str| -> f32 {
                cmd.get(k).and_then(|o| o.get(ff)).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
            };
            found = Some(glam::Vec3::new(f("Position","X"), f("Position","Y"), f("Position","Z")));
            break;
        }
        match found { Some(p) => p, None => return Ok(None) }
    };

    let to_ndc = |sx: f32, sy: f32| -> (f32, f32) {
        ((sx / width) * 2.0 - 1.0, 1.0 - (sy / height) * 2.0)
    };
    let (pnx, pny) = to_ndc(prev_x, prev_y);
    let (cnx, cny) = to_ndc(curr_x, curr_y);
    let (po, pd) = s.camera.get_ray(pnx, pny);
    let (co, cd) = s.camera.get_ray(cnx, cny);

    let t_prev  = closest_t_on_line(po, pd, part_pos, axis_dir);
    let t_curr  = closest_t_on_line(co, cd, part_pos, axis_dir);
    let new_pos = part_pos + axis_dir * (t_curr - t_prev);

    for cmd in &mut s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
        if cmd.get("Id").and_then(|v| v.as_str())  != Some(sel.as_str()) { continue; }
        if let Some(p) = cmd.get_mut("Position") {
            *p = serde_json::json!({"X": new_pos.x, "Y": new_pos.y, "Z": new_pos.z});
        }
        break;
    }

    s.dirty = true;
    Ok(Some([new_pos.x, new_pos.y, new_pos.z]))
}

#[tauri::command]
pub fn renderer_click(
    x: f32, y: f32, width: f32, height: f32,
    renderer: State<'_, RendererState>,
) -> Result<Option<String>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;

    let ndc_x = (x / width) * 2.0 - 1.0;
    let ndc_y = 1.0 - (y / height) * 2.0;

    let (origin, dir) = s.camera.get_ray(ndc_x, ndc_y);

    let get_f32 = |obj: &serde_json::Value, k: &str, field: &str, d: f32| -> f32 {
        obj.get(k).and_then(|o| o.get(field)).and_then(|v| v.as_f64()).map(|v| v as f32).unwrap_or(d)
    };

    let mut closest_t = f32::MAX;
    let mut selected_id = None;

    for cmd in &s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) == Some("AddPart") {
            let px = get_f32(cmd, "Position", "X", 0.0);
            let py = get_f32(cmd, "Position", "Y", 0.0);
            let pz = get_f32(cmd, "Position", "Z", 0.0);

            let sx = get_f32(cmd, "Size", "X", 1.0);
            let sy = get_f32(cmd, "Size", "Y", 1.0);
            let sz = get_f32(cmd, "Size", "Z", 1.0);

            let center = glam::Vec3::new(px, py, pz);
            let extents = glam::Vec3::new(sx, sy, sz) * 0.5;

            let min = center - extents;
            let max = center + extents;

            if let Some(t) = ray_aabb_intersect(origin, dir, min, max) {
                if t < closest_t {
                    closest_t = t;
                    if let Some(id) = cmd.get("Id").and_then(|v| v.as_str()) {
                        selected_id = Some(id.to_string());
                    }
                }
            }
        }
    }

    s.selected = selected_id.clone();
    s.dirty = true;

    Ok(selected_id)
}

#[tauri::command]
pub fn renderer_set_on_top(
    on_top: bool,
    app: AppHandle,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let hwnd = renderer.lock().map_err(|e| e.to_string())?.hwnd;
    app.run_on_main_thread(move || {
        nyx_window::set_z_order(hwnd, on_top);
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renderer_load_scene(
    commands: Vec<serde_json::Value>,
    profile: String,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    s.commands = commands;
    s.profile  = profile;
    s.dirty    = true;
    Ok(())
}

#[tauri::command]
pub fn renderer_load_live_scene(
    commands: Vec<serde_json::Value>,
    profile: String,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    if s.last_interaction.elapsed() < std::time::Duration::from_millis(140) {
        return Ok(());
    }
    s.commands = commands;
    s.profile  = profile;
    s.skip_camera_meta = true;
    s.dirty    = true;
    Ok(())
}

#[tauri::command]
pub fn renderer_set_bounds(
    x: i32, y: i32, width: u32, height: u32,
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
        nyx_window::set_window_bounds(hwnd, x, y, width, height);
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renderer_set_visible(
    visible: bool,
    app: AppHandle,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let hwnd = {
        let r = renderer.lock().map_err(|e| e.to_string())?;
        let mut s = r.state.lock().map_err(|e| e.to_string())?;
        s.visible = visible;
        r.hwnd
    };
    app.run_on_main_thread(move || {
        nyx_window::show_window(hwnd, visible);
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renderer_detach(
    app: AppHandle,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let hwnd = renderer.lock().map_err(|e| e.to_string())?.hwnd;
    app.run_on_main_thread(move || {
        nyx_window::detach_window(hwnd);
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn renderer_attach(
    x: i32, y: i32, width: u32, height: u32,
    app: AppHandle,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    use tauri::Manager;
    let hwnd = renderer.lock().map_err(|e| e.to_string())?.hwnd;
    let parent_hwnd = {
        use raw_window_handle::{HasRawWindowHandle, RawWindowHandle};
        match app.get_window("main")
            .ok_or("main window not found")?
            .raw_window_handle()
        {
            RawWindowHandle::Win32(h) => h.hwnd as isize,
            _ => return Err("Not a Win32 window".to_string()),
        }
    };
    app.run_on_main_thread(move || {
        nyx_window::attach_window(hwnd, parent_hwnd, x, y, width, height);
    }).map_err(|e| e.to_string())
}

// ── Undo helper ───────────────────────────────────────────────────────────────

fn push_undo(state: &crate::renderer::SceneState, undo: &mut crate::renderer::UndoHistory) {
    undo.undo_stack.push(state.commands.clone());
    if undo.undo_stack.len() > 50 {
        undo.undo_stack.remove(0);
    }
    undo.redo_stack.clear();
}

// ── Part inspector ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn renderer_get_part(
    id:       String,
    renderer: State<'_, RendererState>,
) -> Result<Option<serde_json::Value>, String> {
    let r = renderer.lock().map_err(|e| e.to_string())?;
    let s = r.state.lock().map_err(|e| e.to_string())?;
    for cmd in &s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
        if cmd.get("Id").and_then(|v| v.as_str())  == Some(id.as_str()) {
            return Ok(Some(cmd.clone()));
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn renderer_set_part_properties(
    id:       String,
    position: Option<serde_json::Value>,
    size:     Option<serde_json::Value>,
    color:    Option<serde_json::Value>,
    rotation: Option<serde_json::Value>,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r   = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        push_undo(&s, &mut u);
    }
    for cmd in &mut s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
        if cmd.get("Id").and_then(|v| v.as_str())  != Some(id.as_str()) { continue; }
        if let Some(p) = position { cmd["Position"] = p; }
        if let Some(sz) = size    { cmd["Size"]     = sz; }
        if let Some(c) = color    { cmd["Color"]    = c; }
        if let Some(rot) = rotation {
            let cur_cf = cmd.get("CFrame").cloned().unwrap_or(serde_json::json!({}));
            let mut new_cf = cur_cf;
            if let Some(rx) = rot.get("RX") { new_cf["RX"] = rx.clone(); }
            if let Some(ry) = rot.get("RY") { new_cf["RY"] = ry.clone(); }
            if let Some(rz) = rot.get("RZ") { new_cf["RZ"] = rz.clone(); }
            // Keep translation in CFrame synced to Position
            if let Some(pos) = cmd.get("Position") {
                new_cf["X"] = pos.get("X").cloned().unwrap_or(serde_json::json!(0.0));
                new_cf["Y"] = pos.get("Y").cloned().unwrap_or(serde_json::json!(0.0));
                new_cf["Z"] = pos.get("Z").cloned().unwrap_or(serde_json::json!(0.0));
            }
            cmd["CFrame"] = new_cf;
        }
        break;
    }
    s.dirty = true;
    Ok(())
}

// ── Gizmo mode ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn renderer_set_gizmo_mode(
    mode:     String,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r   = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    s.gizmo_mode = mode;
    s.dirty = true;
    Ok(())
}

// ── Rotate drag ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn renderer_rotate_drag(
    axis:   String,
    prev_x: f32, prev_y: f32,
    curr_x: f32, curr_y: f32,
    width:  f32, height: f32,
    renderer: State<'_, RendererState>,
) -> Result<Option<[f32; 3]>, String> {
    let r   = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;

    let sel = match s.selected.clone() { Some(id) => id, None => return Ok(None) };

    if !s.drag_undo_pushed {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        push_undo(&s, &mut u);
        s.drag_undo_pushed = true;
    }

    let plane_normal = match axis.as_str() {
        "X" => glam::Vec3::X,
        "Y" => glam::Vec3::Y,
        "Z" => glam::Vec3::Z,
        _   => return Ok(None),
    };

    let part_pos = {
        let mut found = None;
        for cmd in &s.commands {
            if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
            if cmd.get("Id").and_then(|v| v.as_str())  != Some(sel.as_str()) { continue; }
            let f = |k: &str, ff: &str| -> f32 {
                cmd.get(k).and_then(|o| o.get(ff)).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
            };
            found = Some(glam::Vec3::new(f("Position","X"), f("Position","Y"), f("Position","Z")));
            break;
        }
        match found { Some(p) => p, None => return Ok(None) }
    };

    let to_ndc = |sx: f32, sy: f32| -> (f32, f32) {
        ((sx / width) * 2.0 - 1.0, 1.0 - (sy / height) * 2.0)
    };
    let (pnx, pny) = to_ndc(prev_x, prev_y);
    let (cnx, cny) = to_ndc(curr_x, curr_y);
    let (po, pd) = s.camera.get_ray(pnx, pny);
    let (co, cd) = s.camera.get_ray(cnx, cny);

    let plane_intersect = |ray_o: glam::Vec3, ray_d: glam::Vec3| -> Option<glam::Vec3> {
        let denom = plane_normal.dot(ray_d);
        if denom.abs() < 1e-6 { return None; }
        let t = plane_normal.dot(part_pos - ray_o) / denom;
        if t < 0.0 { return None; }
        Some(ray_o + ray_d * t)
    };

    let prev_pt = match plane_intersect(po, pd) { Some(p) => p, None => return Ok(None) };
    let curr_pt = match plane_intersect(co, cd) { Some(p) => p, None => return Ok(None) };

    let v_prev = prev_pt - part_pos;
    let v_curr = curr_pt - part_pos;
    if v_prev.length() < 1e-6 || v_curr.length() < 1e-6 { return Ok(None); }
    let v_prev = v_prev.normalize();
    let v_curr = v_curr.normalize();

    let cos_a = v_prev.dot(v_curr).clamp(-1.0, 1.0);
    let sin_a = v_prev.cross(v_curr).dot(plane_normal);
    let angle = sin_a.atan2(cos_a);

    let rot_key = match axis.as_str() { "X" => "RX", "Y" => "RY", _ => "RZ" };
    let mut result = None;
    for cmd in &mut s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
        if cmd.get("Id").and_then(|v| v.as_str())  != Some(sel.as_str()) { continue; }
        let cur: f32 = cmd.get("CFrame").and_then(|cf| cf.get(rot_key))
            .and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
        let new_r = cur + angle;
        let cf = cmd.get("CFrame").cloned().unwrap_or_else(|| {
            let pos = cmd.get("Position").cloned().unwrap_or(serde_json::json!({}));
            serde_json::json!({ "X": pos["X"], "Y": pos["Y"], "Z": pos["Z"], "RX": 0, "RY": 0, "RZ": 0 })
        });
        let mut new_cf = cf;
        new_cf[rot_key] = serde_json::json!(new_r);
        let rx = if rot_key == "RX" { new_r } else { new_cf.get("RX").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32 };
        let ry = if rot_key == "RY" { new_r } else { new_cf.get("RY").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32 };
        let rz = if rot_key == "RZ" { new_r } else { new_cf.get("RZ").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32 };
        cmd["CFrame"] = new_cf;
        result = Some([rx, ry, rz]);
        break;
    }
    s.dirty = true;
    Ok(result)
}

// ── Scale drag ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn renderer_scale_drag(
    axis:   String,
    prev_x: f32, prev_y: f32,
    curr_x: f32, curr_y: f32,
    width:  f32, height: f32,
    renderer: State<'_, RendererState>,
) -> Result<Option<[f32; 3]>, String> {
    let r   = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;

    let sel = match s.selected.clone() { Some(id) => id, None => return Ok(None) };

    if !s.drag_undo_pushed {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        push_undo(&s, &mut u);
        s.drag_undo_pushed = true;
    }

    let axis_dir = match axis.as_str() {
        "X" => glam::Vec3::X,
        "Y" => glam::Vec3::Y,
        "Z" => glam::Vec3::Z,
        _   => return Ok(None),
    };

    let part_pos = {
        let mut found = None;
        for cmd in &s.commands {
            if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
            if cmd.get("Id").and_then(|v| v.as_str())  != Some(sel.as_str()) { continue; }
            let f = |k: &str, ff: &str| -> f32 {
                cmd.get(k).and_then(|o| o.get(ff)).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32
            };
            found = Some(glam::Vec3::new(f("Position","X"), f("Position","Y"), f("Position","Z")));
            break;
        }
        match found { Some(p) => p, None => return Ok(None) }
    };

    let to_ndc = |sx: f32, sy: f32| -> (f32, f32) {
        ((sx / width) * 2.0 - 1.0, 1.0 - (sy / height) * 2.0)
    };
    let (pnx, pny) = to_ndc(prev_x, prev_y);
    let (cnx, cny) = to_ndc(curr_x, curr_y);
    let (po, pd) = s.camera.get_ray(pnx, pny);
    let (co, cd) = s.camera.get_ray(cnx, cny);

    let t_prev = closest_t_on_line(po, pd, part_pos, axis_dir);
    let t_curr = closest_t_on_line(co, cd, part_pos, axis_dir);
    let delta  = t_curr - t_prev;

    let size_key = axis.as_str();
    let mut result = None;
    for cmd in &mut s.commands {
        if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
        if cmd.get("Id").and_then(|v| v.as_str())  != Some(sel.as_str()) { continue; }
        if let Some(size_obj) = cmd.get_mut("Size") {
            let cur: f32 = size_obj.get(size_key).and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            let new_s = (cur + delta * 2.0).max(0.05);
            size_obj[size_key] = serde_json::json!(new_s);
            let sx = size_obj.get("X").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            let sy = size_obj.get("Y").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            let sz = size_obj.get("Z").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
            result = Some([sx, sy, sz]);
        }
        break;
    }
    s.dirty = true;
    Ok(result)
}

// ── Undo / Redo ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn renderer_undo(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r   = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    let mut u = r.undo.lock().map_err(|e| e.to_string())?;
    if let Some(prev) = u.undo_stack.pop() {
        u.redo_stack.push(s.commands.clone());
        s.commands = prev;
        s.selected = None;
        s.dirty    = true;
    }
    Ok(())
}

#[tauri::command]
pub fn renderer_redo(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r   = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    let mut u = r.undo.lock().map_err(|e| e.to_string())?;
    if let Some(next) = u.redo_stack.pop() {
        u.undo_stack.push(s.commands.clone());
        s.commands = next;
        s.selected = None;
        s.dirty    = true;
    }
    Ok(())
}

// ── Delete part ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn renderer_delete_part(
    id:       String,
    renderer: State<'_, RendererState>,
) -> Result<(), String> {
    let r   = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    {
        let mut u = r.undo.lock().map_err(|e| e.to_string())?;
        push_undo(&s, &mut u);
    }
    s.commands.retain(|cmd| {
        !(cmd.get("Cmd").and_then(|v| v.as_str()) == Some("AddPart") &&
          cmd.get("Id").and_then(|v| v.as_str())  == Some(id.as_str()))
    });
    if s.selected.as_deref() == Some(id.as_str()) {
        s.selected = None;
    }
    s.dirty = true;
    Ok(())
}

// ── Frame selected ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn renderer_frame_selected(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r   = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;

    let target_pos: Option<glam::Vec3>;
    let target_size: f32;

    if let Some(sel_id) = s.selected.clone() {
        let mut found_pos  = None;
        let mut found_size = 4.0_f32;
        for cmd in &s.commands {
            if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
            if cmd.get("Id").and_then(|v| v.as_str())  != Some(sel_id.as_str()) { continue; }
            let gf = |k: &str, f: &str, d: f64| -> f32 {
                cmd.get(k).and_then(|o| o.get(f)).and_then(|v| v.as_f64()).unwrap_or(d) as f32
            };
            let px = gf("Position","X",0.0);
            let py = gf("Position","Y",0.0);
            let pz = gf("Position","Z",0.0);
            let sx = gf("Size","X",2.0);
            let sy = gf("Size","Y",2.0);
            let sz = gf("Size","Z",2.0);
            found_pos  = Some(glam::Vec3::new(px, py, pz));
            found_size = sx.max(sy).max(sz);
            break;
        }
        target_pos  = found_pos;
        target_size = found_size;
    } else {
        // Frame all: compute AABB center of all parts
        let mut min = glam::Vec3::splat(f32::MAX);
        let mut max = glam::Vec3::splat(f32::MIN);
        let mut any = false;
        for cmd in &s.commands {
            if cmd.get("Cmd").and_then(|v| v.as_str()) != Some("AddPart") { continue; }
            let gf = |k: &str, f: &str, d: f64| -> f32 {
                cmd.get(k).and_then(|o| o.get(f)).and_then(|v| v.as_f64()).unwrap_or(d) as f32
            };
            let p = glam::Vec3::new(gf("Position","X",0.0), gf("Position","Y",0.0), gf("Position","Z",0.0));
            let h = glam::Vec3::new(gf("Size","X",2.0), gf("Size","Y",2.0), gf("Size","Z",2.0)) * 0.5;
            min = min.min(p - h);
            max = max.max(p + h);
            any = true;
        }
        if any {
            let center = (min + max) * 0.5;
            target_pos  = Some(center);
            target_size = (max - min).length();
        } else {
            return Ok(());
        }
    }

    if let Some(pos) = target_pos {
        let dist = target_size * 2.5 + 5.0;
        let eye  = pos + glam::Vec3::new(dist * 0.6, dist * 0.5, dist * 0.6);
        s.camera.set_from_eye_target(eye.to_array(), pos.to_array());
        s.dirty = true;
    }
    Ok(())
}

// ── End drag (resets undo flag) ───────────────────────────────────────────────

#[tauri::command]
pub fn renderer_end_drag(renderer: State<'_, RendererState>) -> Result<(), String> {
    let r   = renderer.lock().map_err(|e| e.to_string())?;
    let mut s = r.state.lock().map_err(|e| e.to_string())?;
    s.drag_undo_pushed = false;
    Ok(())
}

// ── AI ────────────────────────────────────────────────────────────────────────

use zeroize::Zeroizing;

const KEYRING_SERVICE:   &str = "nyx-ide";
const KEYRING_ANTHROPIC: &str = "anthropic";
const KEYRING_DEEPSEEK:  &str = "deepseek";

fn kr_exists(account: &str) -> bool {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .ok()
        .and_then(|e| e.get_password().ok())
        .is_some()
}

fn kr_get(account: &str) -> Option<Zeroizing<String>> {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .ok()
        .and_then(|e| e.get_password().ok())
        .map(Zeroizing::new)
}

#[derive(serde::Deserialize)]
pub struct AiChatMessage {
    pub role:    String,
    pub content: String,
}

#[derive(Serialize)]
pub struct AiConfigStatus {
    pub anthropic_key_set: bool,
    pub deepseek_key_set:  bool,
}

#[derive(Serialize, serde::Deserialize, Clone, Default)]
pub struct AppSettings {
    #[serde(default = "default_provider")]
    pub default_provider: String,
    #[serde(default)]
    pub obsidian_vault_path: Option<String>,
    #[serde(default = "default_ai_mode")]
    pub ai_mode: String,
}

fn default_provider() -> String { "anthropic".to_string() }
fn default_ai_mode()   -> String { "supervised".to_string() }

fn settings_path() -> Option<std::path::PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(std::path::PathBuf::from(appdata).join("Nyx").join("settings.json"))
}

#[tauri::command]
pub fn get_app_settings() -> AppSettings {
    settings_path()
        .and_then(|p| fs::read_to_string(&p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn save_app_settings(settings: AppSettings) -> Result<(), String> {
    let path = settings_path().ok_or("Cannot determine AppData path")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_get_config() -> AiConfigStatus {
    AiConfigStatus {
        anthropic_key_set: kr_exists(KEYRING_ANTHROPIC),
        deepseek_key_set:  kr_exists(KEYRING_DEEPSEEK),
    }
}

#[tauri::command]
pub fn ai_launch_keyman() -> Result<(), String> {
    let exe_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?;
    let exe_dir = exe_dir.parent()
        .ok_or("Cannot determine exe directory")?;
    let keyman = exe_dir.join("nyx-keyman.exe");

    std::process::Command::new(&keyman)
        .spawn()
        .map_err(|e| format!("Could not launch key manager ({keyman:?}): {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn ai_start_agent(
    provider:  String,
    messages:  Vec<AiChatMessage>,
    workspace: Option<String>,
    mode:      String,
    window:    tauri::Window,
    approval:  State<'_, Arc<Mutex<agent::ApprovalState>>>,
) -> Result<(), String> {
    let (api_key, model, is_anthropic) = match provider.as_str() {
        "anthropic" => {
            let k = kr_get(KEYRING_ANTHROPIC).ok_or("Anthropic API key not configured")?;
            (k, "claude-sonnet-4-6".to_string(), true)
        }
        "deepseek" => {
            let k = kr_get(KEYRING_DEEPSEEK).ok_or("DeepSeek API key not configured")?;
            (k, "deepseek-chat".to_string(), false)
        }
        _ => return Err(format!("Unknown provider: {provider}")),
    };

    let global_memory = {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        std::path::PathBuf::from(appdata).join("Nyx").join("NyxMemory")
    };
    let project_memory = workspace.as_ref().map(|w| {
        std::path::PathBuf::from(w).join(".nyx").join("memory")
    });

    let settings       = get_app_settings();
    let tool_settings  = agent::ToolSettings {
        workspace_path:      workspace.clone(),
        obsidian_vault_path: settings.obsidian_vault_path,
        global_memory_path:  global_memory,
        project_memory_path: project_memory,
    };

    let api_messages: Vec<serde_json::Value> = messages.iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();

    let system     = agent::build_system_prompt(workspace.as_deref());
    let agent_mode = agent::AgentMode::from_str(&mode);

    let result = agent::run_agent(
        api_messages, system, &api_key, &model, is_anthropic,
        tool_settings, Arc::clone(&*approval), agent_mode, window.clone(),
    ).await;

    if let Err(ref e) = result {
        let _ = window.emit("ai_error", e.clone());
    }
    result
}

#[tauri::command]
pub fn ai_tool_respond(
    approve:  bool,
    approval: State<'_, Arc<Mutex<agent::ApprovalState>>>,
) {
    let mut state = approval.lock().unwrap();
    if let Some(tx) = state.pending.take() {
        let _ = tx.send(approve);
    }
}
