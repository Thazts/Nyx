use mlua::{Lua, MultiValue as LuaMultiValue, Table as LuaTable, Value as LuaValue};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use tauri::State;

use super::RendererState;

const ROBLOX_SHIM: &str = include_str!("../../nyx_runtime/roblox/init.lua");
const UNITY_SHIM: &str = include_str!("../../nyx_runtime/unity/init.cs");
const UNREAL_SHIM: &str = include_str!("../../nyx_runtime/unreal/init.cpp");

static DOTNET_AVAILABLE: OnceLock<bool> = OnceLock::new();
static CPP_COMPILER_CMD: OnceLock<Option<&'static str>> = OnceLock::new();
static SCENE_EXE_CACHE: OnceLock<Mutex<std::collections::HashMap<String, (u64, PathBuf)>>> =
    OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "PascalCase")]
pub struct RunSceneResult {
    pub commands: Vec<serde_json::Value>,
    pub terminal: Vec<String>,
    pub errors: Vec<String>,
    pub skipped: bool,
}

#[tauri::command]
pub fn run_file(path: String, app_state: State<'_, crate::state::AppState>) -> Vec<String> {
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

#[tauri::command]
pub fn run_scene(path: String, profile: String) -> Result<RunSceneResult, String> {
    RunSceneAtTime(path, profile, None)
}


const LIVE_TICK_FPS: f32 = 60.0;
const LIVE_EDIT_GATE: std::time::Duration = std::time::Duration::from_millis(140);

pub struct LiveSession {
    path: String,
    stop: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Default)]
pub struct LiveSceneState(pub Mutex<Option<LiveSession>>);

#[tauri::command]
pub fn start_live_scene(
    path: String,
    profile: String,
    app: tauri::AppHandle,
    live: State<'_, LiveSceneState>,
) -> Result<(), String> {
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let ThreadStop = Arc::clone(&stop);
    let ThreadPath = path.clone();
    let mut guard = live.0.lock().map_err(|e| e.to_string())?;
    if let Some(Previous) = guard.take() {
        Previous.stop.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    std::thread::Builder::new()
        .name("nyx-live-scene".into())
        .spawn(move || LiveSceneLoop(app, ThreadPath, profile, ThreadStop))
        .map_err(|e| e.to_string())?;
    *guard = Some(LiveSession { path, stop });
    Ok(())
}

#[tauri::command]
pub fn stop_live_scene(path: Option<String>, live: State<'_, LiveSceneState>) -> Result<(), String> {
    let mut guard = live.0.lock().map_err(|e| e.to_string())?;
    let Owns = match (&path, guard.as_ref()) {
        (Some(P), Some(Session)) => Session.path == *P,
        (None, Some(_)) => true,
        (_, None) => false,
    };
    if Owns {
        if let Some(Session) = guard.take() {
            Session.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }
    Ok(())
}

fn LiveSceneLoop(
    app: tauri::AppHandle,
    path: String,
    profile: String,
    stop: Arc<std::sync::atomic::AtomicBool>,
) {
    use std::sync::atomic::Ordering;
    use tauri::Manager;

    let TickBudget = std::time::Duration::from_secs_f32(1.0 / LIVE_TICK_FPS);
    let StartedAt = std::time::Instant::now();

    while !stop.load(Ordering::Relaxed) {
        let TickStart = std::time::Instant::now();
        let Paused = {
            let renderer = app.state::<RendererState>();
            let Held = renderer.lock().ok().and_then(|r| {
                r.state
                    .lock()
                    .ok()
                    .map(|s| !s.visible || s.last_edit_interaction.elapsed() < LIVE_EDIT_GATE)
            });
            Held.unwrap_or(true)
        };
        if Paused {
            std::thread::sleep(std::time::Duration::from_millis(30));
            continue;
        }

        let Elapsed = StartedAt.elapsed().as_secs_f64();
        if let Ok(Result) = RunSceneAtTime(path.clone(), profile.clone(), Some(Elapsed)) {
            if !stop.load(Ordering::Relaxed) {
                let renderer = app.state::<RendererState>();
                let app_state = app.state::<crate::state::AppState>();
                let _ = crate::commands::renderer::ApplyLiveScene(
                    &renderer,
                    &app_state,
                    Result.commands,
                    &profile,
                );
            }
        }

        std::thread::sleep(
            TickBudget
                .saturating_sub(TickStart.elapsed())
                .max(std::time::Duration::from_millis(1)),
        );
    }
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
        return Err("No C# compiler: dotnet SDK not found in PATH. \
             Install the .NET SDK or add a @nyx-scene block."
            .to_string());
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
pub fn load_model_file(path: String) -> Result<RunSceneResult, String> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "obj" => LoadObj(&path),
        "fbx" => LoadFbx(&path),
        "gltf" => LoadGltf(&path),
        "glb" => LoadGlb(&path),
        "blend" => LoadBlend(&path),
        "dae" => LoadDae(&path),
        "stl" => LoadStl(&path),
        "ply" => LoadPly(&path),
        _ => Err(format!("Unsupported model format: .{}", ext)),
    }
}

fn LoadObj(path: &str) -> Result<RunSceneResult, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;

    let mut vertices: Vec<[f32; 3]> = Vec::new();
    let mut groups: Vec<(String, Vec<Vec<usize>>)> = Vec::new();
    let mut cur_name = String::from("mesh");
    let mut cur_faces: Vec<Vec<usize>> = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        let mut split = line.splitn(2, ' ');
        let token = split.next().unwrap_or("");
        let rest = split.next().unwrap_or("").trim();

        match token {
            "v" => {
                let mut nums = rest.split_whitespace();
                let x = nums
                    .next()
                    .and_then(|s| s.parse::<f32>().ok())
                    .unwrap_or(0.0);
                let y = nums
                    .next()
                    .and_then(|s| s.parse::<f32>().ok())
                    .unwrap_or(0.0);
                let z = nums
                    .next()
                    .and_then(|s| s.parse::<f32>().ok())
                    .unwrap_or(0.0);
                vertices.push([x, y, z]);
            }
            "o" | "g" => {
                if !cur_faces.is_empty() {
                    groups.push((cur_name.clone(), cur_faces.clone()));
                    cur_faces.clear();
                }
                if !rest.is_empty() {
                    cur_name = rest.to_string();
                }
            }
            "f" => {
                let mut Face: Vec<usize> = Vec::new();
                for token in rest.split_whitespace() {
                    let idx_str = token.split('/').next().unwrap_or("0");
                    if let Ok(idx) = idx_str.parse::<i32>() {
                        let vi = if idx < 0 {
                            (vertices.len() as i32 + idx) as usize
                        } else {
                            idx.saturating_sub(1) as usize
                        };
                        if vi < vertices.len() {
                            Face.push(vi);
                        }
                    }
                }
                if Face.len() >= 3 {
                    cur_faces.push(Face);
                }
            }
            _ => {}
        }
    }

    if !cur_faces.is_empty() {
        groups.push((cur_name, cur_faces));
    }
    if groups.is_empty() {
        return Err("OBJ file contains no geometry".to_string());
    }

    let palette: &[[f32; 3]] = &[
        [0.72, 0.72, 0.76],
        [0.65, 0.76, 0.65],
        [0.76, 0.65, 0.65],
        [0.65, 0.65, 0.76],
        [0.76, 0.76, 0.65],
        [0.76, 0.65, 0.76],
    ];

    let mut commands: Vec<serde_json::Value> = Vec::new();
    let mut all_min = [f32::MAX; 3];
    let mut all_max = [f32::MIN; 3];
    let mut part_count = 0usize;

    for (i, (name, faces)) in groups.iter().enumerate() {
        if faces.is_empty() {
            continue;
        }
        let mut LocalIndex: std::collections::HashMap<usize, u32> =
            std::collections::HashMap::new();
        let mut LocalVertices: Vec<[f32; 3]> = Vec::new();
        let mut Indices: Vec<u32> = Vec::new();
        let mut mn = [f32::MAX; 3];
        let mut mx = [f32::MIN; 3];
        for Face in faces {
            let BaseIndex = Face[0];
            for I in 1..(Face.len() - 1) {
                for SourceIndex in [BaseIndex, Face[I], Face[I + 1]] {
                    let Entry = match LocalIndex.get(&SourceIndex) {
                        Some(Index) => *Index,
                        None => {
                            let Index = LocalVertices.len() as u32;
                            LocalIndex.insert(SourceIndex, Index);
                            LocalVertices.push(vertices[SourceIndex]);
                            Index
                        }
                    };
                    Indices.push(Entry);
                }
            }
        }
        if LocalVertices.is_empty() || Indices.is_empty() {
            continue;
        }
        for v in &LocalVertices {
            for k in 0..3 {
                if v[k] < mn[k] {
                    mn[k] = v[k];
                }
                if v[k] > mx[k] {
                    mx[k] = v[k];
                }
            }
        }
        for k in 0..3 {
            if mn[k] < all_min[k] {
                all_min[k] = mn[k];
            }
            if mx[k] > all_max[k] {
                all_max[k] = mx[k];
            }
        }
        let ctr = [
            (mn[0] + mx[0]) * 0.5,
            (mn[1] + mx[1]) * 0.5,
            (mn[2] + mx[2]) * 0.5,
        ];
        let sz = [
            (mx[0] - mn[0]).max(0.001),
            (mx[1] - mn[1]).max(0.001),
            (mx[2] - mn[2]).max(0.001),
        ];
        let col = palette[i % palette.len()];
        let LocalJson: Vec<serde_json::Value> = LocalVertices
            .iter()
            .map(|V| {
                serde_json::json!({
                    "X": V[0] - ctr[0],
                    "Y": V[1] - ctr[1],
                    "Z": V[2] - ctr[2],
                })
            })
            .collect();

        commands.push(serde_json::json!({
            "Cmd": "AddMesh",
            "Id": format!("obj_{}_{}", i, name),
            "Name": name,
            "Position": {"X": ctr[0], "Y": ctr[1], "Z": ctr[2]},
            "Size": {"X": 1.0, "Y": 1.0, "Z": 1.0},
            "Color": {"R": col[0], "G": col[1], "B": col[2]},
            "Anchored": true,
            "CanCollide": false,
            "Material": "SmoothPlastic",
            "Transparency": 0.0,
            "Shape": "Mesh",
            "Bounds": {"X": sz[0], "Y": sz[1], "Z": sz[2]},
            "Vertices": LocalJson,
            "Indices": Indices,
        }));
        part_count += 1;
    }

    let scene_ctr = [
        (all_min[0] + all_max[0]) * 0.5,
        (all_min[1] + all_max[1]) * 0.5,
        (all_min[2] + all_max[2]) * 0.5,
    ];
    let span = (all_max[0] - all_min[0])
        .max(all_max[1] - all_min[1])
        .max(all_max[2] - all_min[2])
        .max(1.0);
    let dist = span * 1.6 + 4.0;
    commands.insert(
        0,
        serde_json::json!({
            "Cmd": "SetCamera",
            "Position": {
                "X": scene_ctr[0] + dist * 0.6,
                "Y": scene_ctr[1] + dist * 0.45,
                "Z": scene_ctr[2] + dist * 0.6,
            },
            "LookAt": {"X": scene_ctr[0], "Y": scene_ctr[1], "Z": scene_ctr[2]},
        }),
    );

    Ok(RunSceneResult {
        commands,
        terminal: vec![
            "runtime: OBJ loader".to_string(),
            format!(
                "{} mesh group(s) loaded with real face geometry",
                part_count
            ),
        ],
        errors: Vec::new(),
        skipped: false,
    })
}

struct ImportedMesh {
    Name: String,
    Vertices: Vec<[f32; 3]>,
    Indices: Vec<u32>,
}

fn MeshPalette(Index: usize) -> [f32; 3] {
    const PALETTE: &[[f32; 3]] = &[
        [0.72, 0.72, 0.76],
        [0.65, 0.76, 0.65],
        [0.76, 0.65, 0.65],
        [0.65, 0.65, 0.76],
        [0.76, 0.76, 0.65],
        [0.76, 0.65, 0.76],
    ];
    PALETTE[Index % PALETTE.len()]
}

fn SafeMeshName(Name: &str) -> String {
    let Clean: String = Name
        .chars()
        .map(|Ch| {
            if Ch.is_ascii_alphanumeric() || Ch == '_' || Ch == '-' {
                Ch
            } else {
                '_'
            }
        })
        .collect();
    if Clean.is_empty() {
        "mesh".to_string()
    } else {
        Clean
    }
}

fn BuildImportedMeshScene(
    Runtime: &str,
    Meshes: Vec<ImportedMesh>,
) -> Result<RunSceneResult, String> {
    let mut Commands: Vec<serde_json::Value> = Vec::new();
    let mut AllMin = [f32::MAX; 3];
    let mut AllMax = [f32::MIN; 3];
    let mut PartCount = 0usize;

    for (I, Mesh) in Meshes.iter().enumerate() {
        if Mesh.Vertices.is_empty() || Mesh.Indices.len() < 3 {
            continue;
        }

        let mut Indices: Vec<u32> = Vec::new();
        for Triangle in Mesh.Indices.chunks(3) {
            if Triangle.len() != 3 {
                continue;
            }
            if Triangle
                .iter()
                .all(|Index| (*Index as usize) < Mesh.Vertices.len())
            {
                Indices.extend_from_slice(Triangle);
            }
        }
        if Indices.is_empty() {
            continue;
        }

        let mut Min = [f32::MAX; 3];
        let mut Max = [f32::MIN; 3];
        for Vertex in &Mesh.Vertices {
            for K in 0..3 {
                if Vertex[K] < Min[K] {
                    Min[K] = Vertex[K];
                }
                if Vertex[K] > Max[K] {
                    Max[K] = Vertex[K];
                }
            }
        }
        for K in 0..3 {
            if Min[K] < AllMin[K] {
                AllMin[K] = Min[K];
            }
            if Max[K] > AllMax[K] {
                AllMax[K] = Max[K];
            }
        }

        let Center = [
            (Min[0] + Max[0]) * 0.5,
            (Min[1] + Max[1]) * 0.5,
            (Min[2] + Max[2]) * 0.5,
        ];
        let Bounds = [
            (Max[0] - Min[0]).max(0.001),
            (Max[1] - Min[1]).max(0.001),
            (Max[2] - Min[2]).max(0.001),
        ];
        let Color = MeshPalette(I);
        let LocalVertices: Vec<serde_json::Value> = Mesh
            .Vertices
            .iter()
            .map(|Vertex| {
                serde_json::json!({
                    "X": Vertex[0] - Center[0],
                    "Y": Vertex[1] - Center[1],
                    "Z": Vertex[2] - Center[2],
                })
            })
            .collect();

        Commands.push(serde_json::json!({
            "Cmd": "AddMesh",
            "Id": format!("{}_{}_{}", Runtime.to_lowercase(), I, SafeMeshName(&Mesh.Name)),
            "Name": Mesh.Name,
            "Position": {"X": Center[0], "Y": Center[1], "Z": Center[2]},
            "Size": {"X": 1.0, "Y": 1.0, "Z": 1.0},
            "Color": {"R": Color[0], "G": Color[1], "B": Color[2]},
            "Anchored": true,
            "CanCollide": false,
            "Material": "SmoothPlastic",
            "Transparency": 0.0,
            "Shape": "Mesh",
            "Bounds": {"X": Bounds[0], "Y": Bounds[1], "Z": Bounds[2]},
            "Vertices": LocalVertices,
            "Indices": Indices,
        }));
        PartCount += 1;
    }

    if PartCount == 0 {
        return Err(format!(
            "{} file contains no supported mesh geometry",
            Runtime
        ));
    }

    let SceneCenter = [
        (AllMin[0] + AllMax[0]) * 0.5,
        (AllMin[1] + AllMax[1]) * 0.5,
        (AllMin[2] + AllMax[2]) * 0.5,
    ];
    let Span = (AllMax[0] - AllMin[0])
        .max(AllMax[1] - AllMin[1])
        .max(AllMax[2] - AllMin[2])
        .max(1.0);
    let Dist = Span * 1.6 + 4.0;
    Commands.insert(
        0,
        serde_json::json!({
            "Cmd": "SetCamera",
            "Position": {
                "X": SceneCenter[0] + Dist * 0.6,
                "Y": SceneCenter[1] + Dist * 0.45,
                "Z": SceneCenter[2] + Dist * 0.6,
            },
            "LookAt": {"X": SceneCenter[0], "Y": SceneCenter[1], "Z": SceneCenter[2]},
        }),
    );

    Ok(RunSceneResult {
        commands: Commands,
        terminal: vec![
            format!("runtime: {} loader", Runtime),
            format!("{} mesh group(s) loaded with real face geometry", PartCount),
        ],
        errors: Vec::new(),
        skipped: false,
    })
}

fn LoadFbx(path: &str) -> Result<RunSceneResult, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"Kaydara FBX Binary  ") {
        let Content = String::from_utf8_lossy(&bytes);
        if let Ok(Result) = LoadFbxAscii(&Content) {
            return Ok(Result);
        }
    }
    let note = if bytes.starts_with(b"Kaydara FBX Binary  ") {
        "FBX binary — bounding box placeholder (full mesh rendering not yet supported)"
    } else {
        "FBX ASCII — bounding box placeholder (full mesh rendering not yet supported)"
    };

    Ok(RunSceneResult {
        commands: vec![
            serde_json::json!({
                "Cmd": "SetCamera",
                "Position": {"X": 8.0, "Y": 6.0, "Z": 8.0},
                "LookAt": {"X": 0.0, "Y": 0.0, "Z": 0.0},
            }),
            serde_json::json!({
                "Cmd": "AddPart",
                "Id": "fbx_placeholder",
                "Name": "FBX Model",
                "Position": {"X": 0.0, "Y": 0.0, "Z": 0.0},
                "Size": {"X": 4.0, "Y": 4.0, "Z": 4.0},
                "Color": {"R": 0.70, "G": 0.65, "B": 0.60},
                "Anchored": true,
                "CanCollide": false,
                "Material": "SmoothPlastic",
                "Transparency": 0.0,
                "Shape": "Block",
            }),
        ],
        terminal: vec!["runtime: FBX loader".to_string(), note.to_string()],
        errors: Vec::new(),
        skipped: false,
    })
}

fn ExtractFbxNumberArray(Content: &str, Label: &str) -> Option<Vec<f32>> {
    let LabelIndex = Content.find(Label)?;
    let Slice = &Content[LabelIndex..];
    let ArrayIndex = Slice.find("a:")? + 2;
    let AfterArray = &Slice[ArrayIndex..];
    let EndIndex = AfterArray.find('}')?;
    let Numbers = &AfterArray[..EndIndex];
    let Values = Numbers
        .replace(',', " ")
        .split_whitespace()
        .filter_map(|Token| Token.parse::<f32>().ok())
        .collect::<Vec<_>>();
    if Values.is_empty() {
        None
    } else {
        Some(Values)
    }
}

fn LoadFbxAscii(Content: &str) -> Result<RunSceneResult, String> {
    let VertexValues =
        ExtractFbxNumberArray(Content, "Vertices:").ok_or("FBX vertices not found")?;
    let PolygonValues = ExtractFbxNumberArray(Content, "PolygonVertexIndex:")
        .ok_or("FBX polygon indices not found")?;

    let mut Vertices: Vec<[f32; 3]> = Vec::new();
    for Chunk in VertexValues.chunks(3) {
        if Chunk.len() == 3 {
            Vertices.push([Chunk[0], Chunk[1], Chunk[2]]);
        }
    }
    if Vertices.is_empty() {
        return Err("FBX contains no vertices".to_string());
    }

    let mut Indices: Vec<u32> = Vec::new();
    let mut Face: Vec<u32> = Vec::new();
    for Value in PolygonValues {
        let Raw = Value as i32;
        let End = Raw < 0;
        let Index = if End { (-Raw - 1) as u32 } else { Raw as u32 };
        Face.push(Index);
        if End {
            if Face.len() >= 3 {
                let Base = Face[0];
                for I in 1..(Face.len() - 1) {
                    Indices.extend_from_slice(&[Base, Face[I], Face[I + 1]]);
                }
            }
            Face.clear();
        }
    }

    BuildImportedMeshScene(
        "FBX",
        vec![ImportedMesh {
            Name: "FBX Mesh".to_string(),
            Vertices,
            Indices,
        }],
    )
}

fn ReadF32Le(Bytes: &[u8], Offset: usize) -> Option<f32> {
    let Slice = Bytes.get(Offset..Offset + 4)?;
    Some(f32::from_le_bytes([Slice[0], Slice[1], Slice[2], Slice[3]]))
}

fn LoadStl(path: &str) -> Result<RunSceneResult, String> {
    let Bytes = fs::read(path).map_err(|e| e.to_string())?;
    if Bytes.len() >= 84 {
        let Count = u32::from_le_bytes([Bytes[80], Bytes[81], Bytes[82], Bytes[83]]) as usize;
        let Expected = 84usize.saturating_add(Count.saturating_mul(50));
        if Expected == Bytes.len() {
            return LoadBinaryStl(&Bytes, Count);
        }
    }
    let Content = String::from_utf8_lossy(&Bytes);
    LoadAsciiStl(&Content)
}

fn LoadBinaryStl(Bytes: &[u8], Count: usize) -> Result<RunSceneResult, String> {
    let mut Vertices: Vec<[f32; 3]> = Vec::with_capacity(Count * 3);
    let mut Indices: Vec<u32> = Vec::with_capacity(Count * 3);
    for I in 0..Count {
        let Base = 84 + I * 50 + 12;
        for J in 0..3 {
            let Offset = Base + J * 12;
            let X = ReadF32Le(Bytes, Offset).ok_or("Invalid binary STL vertex")?;
            let Y = ReadF32Le(Bytes, Offset + 4).ok_or("Invalid binary STL vertex")?;
            let Z = ReadF32Le(Bytes, Offset + 8).ok_or("Invalid binary STL vertex")?;
            Vertices.push([X, Y, Z]);
            Indices.push((Vertices.len() - 1) as u32);
        }
    }
    BuildImportedMeshScene(
        "STL",
        vec![ImportedMesh {
            Name: "STL Mesh".to_string(),
            Vertices,
            Indices,
        }],
    )
}

fn LoadAsciiStl(Content: &str) -> Result<RunSceneResult, String> {
    let mut Vertices: Vec<[f32; 3]> = Vec::new();
    let mut Indices: Vec<u32> = Vec::new();
    for Line in Content.lines() {
        let Trimmed = Line.trim();
        if !Trimmed.starts_with("vertex ") {
            continue;
        }
        let Values = Trimmed
            .split_whitespace()
            .skip(1)
            .filter_map(|Token| Token.parse::<f32>().ok())
            .collect::<Vec<_>>();
        if Values.len() == 3 {
            Vertices.push([Values[0], Values[1], Values[2]]);
            Indices.push((Vertices.len() - 1) as u32);
        }
    }
    if Indices.len() < 3 {
        return Err("ASCII STL file contains no triangles".to_string());
    }
    Indices.truncate(Indices.len() / 3 * 3);
    BuildImportedMeshScene(
        "STL",
        vec![ImportedMesh {
            Name: "STL Mesh".to_string(),
            Vertices,
            Indices,
        }],
    )
}

fn LoadPly(path: &str) -> Result<RunSceneResult, String> {
    let Content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut Lines = Content.lines();
    if Lines.next().map(str::trim) != Some("ply") {
        return Err("PLY header not found".to_string());
    }

    let mut Format = String::new();
    let mut VertexCount = 0usize;
    let mut FaceCount = 0usize;
    let mut CurrentElement = String::new();
    let mut VertexProperties: Vec<String> = Vec::new();

    for Line in &mut Lines {
        let Trimmed = Line.trim();
        if Trimmed == "end_header" {
            break;
        }
        let Parts = Trimmed.split_whitespace().collect::<Vec<_>>();
        if Parts.is_empty() {
            continue;
        }
        match Parts.as_slice() {
            ["format", Value, ..] => Format = (*Value).to_string(),
            ["element", "vertex", Count] => {
                CurrentElement = "vertex".to_string();
                VertexCount = Count.parse::<usize>().unwrap_or(0);
            }
            ["element", "face", Count] => {
                CurrentElement = "face".to_string();
                FaceCount = Count.parse::<usize>().unwrap_or(0);
            }
            ["element", Name, ..] => CurrentElement = (*Name).to_string(),
            ["property", _, Name] if CurrentElement == "vertex" => {
                VertexProperties.push((*Name).to_string());
            }
            ["property", _, _, Name] if CurrentElement == "vertex" => {
                VertexProperties.push((*Name).to_string());
            }
            _ => {}
        }
    }

    if Format != "ascii" {
        return Err(format!("PLY format '{}' is not supported yet", Format));
    }
    if VertexCount == 0 || FaceCount == 0 {
        return Err("PLY contains no mesh faces".to_string());
    }

    let XIndex = VertexProperties
        .iter()
        .position(|Name| Name == "x")
        .ok_or("PLY vertex x property not found")?;
    let YIndex = VertexProperties
        .iter()
        .position(|Name| Name == "y")
        .ok_or("PLY vertex y property not found")?;
    let ZIndex = VertexProperties
        .iter()
        .position(|Name| Name == "z")
        .ok_or("PLY vertex z property not found")?;

    let mut Vertices: Vec<[f32; 3]> = Vec::with_capacity(VertexCount);
    for _ in 0..VertexCount {
        let Line = Lines.next().ok_or("PLY ended inside vertex data")?;
        let Values = Line
            .split_whitespace()
            .filter_map(|Token| Token.parse::<f32>().ok())
            .collect::<Vec<_>>();
        if Values.len() <= XIndex || Values.len() <= YIndex || Values.len() <= ZIndex {
            return Err("Invalid PLY vertex row".to_string());
        }
        Vertices.push([Values[XIndex], Values[YIndex], Values[ZIndex]]);
    }

    let mut Indices: Vec<u32> = Vec::new();
    for _ in 0..FaceCount {
        let Line = Lines.next().ok_or("PLY ended inside face data")?;
        let Values = Line
            .split_whitespace()
            .filter_map(|Token| Token.parse::<u32>().ok())
            .collect::<Vec<_>>();
        if Values.len() < 4 {
            continue;
        }
        let Count = Values[0] as usize;
        if Count < 3 || Values.len() < Count + 1 {
            continue;
        }
        let Base = Values[1];
        for I in 2..Count {
            Indices.extend_from_slice(&[Base, Values[I], Values[I + 1]]);
        }
    }

    BuildImportedMeshScene(
        "PLY",
        vec![ImportedMesh {
            Name: "PLY Mesh".to_string(),
            Vertices,
            Indices,
        }],
    )
}

fn XmlAttribute(Tag: &str, Name: &str) -> Option<String> {
    for Quote in ['"', '\''] {
        let Pattern = format!("{}={}", Name, Quote);
        if let Some(Start) = Tag.find(&Pattern) {
            let ValueStart = Start + Pattern.len();
            let ValueEnd = Tag[ValueStart..].find(Quote)? + ValueStart;
            return Some(Tag[ValueStart..ValueEnd].to_string());
        }
    }
    None
}

fn XmlNameBoundary(Content: &str, Offset: usize) -> bool {
    Content
        .as_bytes()
        .get(Offset)
        .map(|Byte| matches!(*Byte, b' ' | b'\t' | b'\r' | b'\n' | b'>' | b'/'))
        .unwrap_or(false)
}

fn XmlBlocks<'a>(Content: &'a str, Name: &str) -> Vec<(String, &'a str)> {
    let Open = format!("<{}", Name);
    let Close = format!("</{}>", Name);
    let mut Blocks = Vec::new();
    let mut Search = 0usize;
    while let Some(RelStart) = Content[Search..].find(&Open) {
        let Start = Search + RelStart;
        if !XmlNameBoundary(Content, Start + Open.len()) {
            Search = Start + Open.len();
            continue;
        }
        let Some(TagEndRel) = Content[Start..].find('>') else {
            break;
        };
        let TagEnd = Start + TagEndRel;
        let Tag = Content[Start..=TagEnd].to_string();
        if Tag.ends_with("/>") {
            Search = TagEnd + 1;
            continue;
        }
        let InnerStart = TagEnd + 1;
        let Some(CloseRel) = Content[InnerStart..].find(&Close) else {
            break;
        };
        let CloseStart = InnerStart + CloseRel;
        Blocks.push((Tag, &Content[InnerStart..CloseStart]));
        Search = CloseStart + Close.len();
    }
    Blocks
}

fn XmlOpeningTags(Content: &str, Name: &str) -> Vec<String> {
    let Open = format!("<{}", Name);
    let mut Tags = Vec::new();
    let mut Search = 0usize;
    while let Some(RelStart) = Content[Search..].find(&Open) {
        let Start = Search + RelStart;
        if !XmlNameBoundary(Content, Start + Open.len()) {
            Search = Start + Open.len();
            continue;
        }
        if Content[Start..].starts_with("</") {
            Search = Start + Open.len();
            continue;
        }
        let Some(TagEndRel) = Content[Start..].find('>') else {
            break;
        };
        let TagEnd = Start + TagEndRel;
        Tags.push(Content[Start..=TagEnd].to_string());
        Search = TagEnd + 1;
    }
    Tags
}

fn XmlFirstText<'a>(Content: &'a str, Name: &str) -> Option<&'a str> {
    XmlBlocks(Content, Name)
        .into_iter()
        .next()
        .map(|(_, Body)| Body)
}

fn DaeId(Source: &str) -> String {
    Source.trim_start_matches('#').to_string()
}

fn ParseDaeFloatArray(Text: &str) -> Vec<f32> {
    Text.split_whitespace()
        .filter_map(|Token| Token.parse::<f32>().ok())
        .collect()
}

fn ParseDaeIndexArray(Text: &str) -> Vec<u32> {
    Text.split_whitespace()
        .filter_map(|Token| Token.parse::<u32>().ok())
        .collect()
}

fn LoadDaePrimitive(
    Body: &str,
    SourceVertices: &std::collections::HashMap<String, Vec<[f32; 3]>>,
    VertexSources: &std::collections::HashMap<String, String>,
    Mode: &str,
) -> Option<(Vec<[f32; 3]>, Vec<u32>)> {
    let mut PositionOffset = 0usize;
    let mut PositionSource = String::new();
    let mut InputStride = 1usize;
    for Input in XmlOpeningTags(Body, "input") {
        let Semantic = XmlAttribute(&Input, "semantic")?;
        let Source = DaeId(&XmlAttribute(&Input, "source")?);
        let Offset = XmlAttribute(&Input, "offset")
            .and_then(|Value| Value.parse::<usize>().ok())
            .unwrap_or(0);
        InputStride = InputStride.max(Offset + 1);
        if Semantic == "VERTEX" {
            PositionOffset = Offset;
            PositionSource = VertexSources.get(&Source).cloned().unwrap_or(Source);
        } else if Semantic == "POSITION" {
            PositionOffset = Offset;
            PositionSource = Source;
        }
    }
    if PositionSource.is_empty() {
        return None;
    }
    let Vertices = SourceVertices.get(&PositionSource)?.clone();
    let mut Indices: Vec<u32> = Vec::new();

    if Mode == "triangles" {
        let Values = ParseDaeIndexArray(XmlFirstText(Body, "p")?);
        for Triangle in Values.chunks(InputStride * 3) {
            if Triangle.len() < InputStride * 3 {
                continue;
            }
            for I in 0..3 {
                Indices.push(Triangle[I * InputStride + PositionOffset]);
            }
        }
    } else if Mode == "polylist" {
        let Counts = ParseDaeIndexArray(XmlFirstText(Body, "vcount")?);
        let Values = ParseDaeIndexArray(XmlFirstText(Body, "p")?);
        let mut Cursor = 0usize;
        for Count in Counts {
            let Count = Count as usize;
            if Count < 3 || Cursor + Count * InputStride > Values.len() {
                Cursor = Cursor.saturating_add(Count.saturating_mul(InputStride));
                continue;
            }
            let mut Face: Vec<u32> = Vec::with_capacity(Count);
            for I in 0..Count {
                Face.push(Values[Cursor + I * InputStride + PositionOffset]);
            }
            for I in 1..(Face.len() - 1) {
                Indices.extend_from_slice(&[Face[0], Face[I], Face[I + 1]]);
            }
            Cursor += Count * InputStride;
        }
    } else if Mode == "polygons" {
        for (_, PolygonBody) in XmlBlocks(Body, "p") {
            let Values = ParseDaeIndexArray(PolygonBody);
            let Count = Values.len() / InputStride;
            if Count < 3 {
                continue;
            }
            let mut Face: Vec<u32> = Vec::with_capacity(Count);
            for I in 0..Count {
                Face.push(Values[I * InputStride + PositionOffset]);
            }
            for I in 1..(Face.len() - 1) {
                Indices.extend_from_slice(&[Face[0], Face[I], Face[I + 1]]);
            }
        }
    }

    if Indices.is_empty() {
        None
    } else {
        Some((Vertices, Indices))
    }
}

fn LoadDae(path: &str) -> Result<RunSceneResult, String> {
    let Content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    LoadDaeContent(&Content)
}

fn LoadDaeContent(Content: &str) -> Result<RunSceneResult, String> {
    let mut Meshes: Vec<ImportedMesh> = Vec::new();
    for (GeometryTag, GeometryBody) in XmlBlocks(Content, "geometry") {
        let GeometryName = XmlAttribute(&GeometryTag, "name")
            .or_else(|| XmlAttribute(&GeometryTag, "id"))
            .unwrap_or_else(|| "DAE Mesh".to_string());
        let Some((_, MeshBody)) = XmlBlocks(GeometryBody, "mesh").into_iter().next() else {
            continue;
        };
        let mut SourceVertices: std::collections::HashMap<String, Vec<[f32; 3]>> =
            std::collections::HashMap::new();
        let mut VertexSources: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();

        for (SourceTag, SourceBody) in XmlBlocks(MeshBody, "source") {
            let Some(SourceId) = XmlAttribute(&SourceTag, "id") else {
                continue;
            };
            let Some(FloatText) = XmlFirstText(SourceBody, "float_array") else {
                continue;
            };
            let Values = ParseDaeFloatArray(FloatText);
            let Stride = XmlOpeningTags(SourceBody, "accessor")
                .first()
                .and_then(|Tag| XmlAttribute(Tag, "stride"))
                .and_then(|Value| Value.parse::<usize>().ok())
                .unwrap_or(3);
            if Stride < 3 {
                continue;
            }
            let mut Vertices: Vec<[f32; 3]> = Vec::new();
            for Chunk in Values.chunks(Stride) {
                if Chunk.len() >= 3 {
                    Vertices.push([Chunk[0], Chunk[1], Chunk[2]]);
                }
            }
            if !Vertices.is_empty() {
                SourceVertices.insert(SourceId, Vertices);
            }
        }

        for (VerticesTag, VerticesBody) in XmlBlocks(MeshBody, "vertices") {
            let Some(VerticesId) = XmlAttribute(&VerticesTag, "id") else {
                continue;
            };
            for Input in XmlOpeningTags(VerticesBody, "input") {
                if XmlAttribute(&Input, "semantic").as_deref() == Some("POSITION") {
                    if let Some(Source) = XmlAttribute(&Input, "source") {
                        VertexSources.insert(VerticesId.clone(), DaeId(&Source));
                    }
                }
            }
        }

        for Mode in ["triangles", "polylist", "polygons"] {
            for (PrimitiveIndex, (_, PrimitiveBody)) in
                XmlBlocks(MeshBody, Mode).into_iter().enumerate()
            {
                if let Some((Vertices, Indices)) =
                    LoadDaePrimitive(PrimitiveBody, &SourceVertices, &VertexSources, Mode)
                {
                    Meshes.push(ImportedMesh {
                        Name: format!("{}_{}_{}", GeometryName, Mode, PrimitiveIndex),
                        Vertices,
                        Indices,
                    });
                }
            }
        }
    }
    BuildImportedMeshScene("DAE", Meshes)
}

fn LoadGltf(path: &str) -> Result<RunSceneResult, String> {
    let Content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let Document: serde_json::Value = serde_json::from_str(&Content).map_err(|e| e.to_string())?;
    let BaseDir = Path::new(path).parent().unwrap_or_else(|| Path::new("."));
    BuildGltfScene(&Document, Some(BaseDir), None)
}

fn LoadGlb(path: &str) -> Result<RunSceneResult, String> {
    let Bytes = fs::read(path).map_err(|e| e.to_string())?;
    if Bytes.len() < 20 || &Bytes[0..4] != b"glTF" {
        return Err("GLB header not found".to_string());
    }
    let Version = u32::from_le_bytes([Bytes[4], Bytes[5], Bytes[6], Bytes[7]]);
    if Version != 2 {
        return Err(format!("GLB version {} is not supported", Version));
    }
    let TotalLength = u32::from_le_bytes([Bytes[8], Bytes[9], Bytes[10], Bytes[11]]) as usize;
    if TotalLength > Bytes.len() {
        return Err("GLB length exceeds file size".to_string());
    }

    let mut Offset = 12usize;
    let mut JsonChunk: Option<Vec<u8>> = None;
    let mut BinChunk: Option<Vec<u8>> = None;
    while Offset + 8 <= TotalLength {
        let ChunkLength = u32::from_le_bytes([
            Bytes[Offset],
            Bytes[Offset + 1],
            Bytes[Offset + 2],
            Bytes[Offset + 3],
        ]) as usize;
        let ChunkType = u32::from_le_bytes([
            Bytes[Offset + 4],
            Bytes[Offset + 5],
            Bytes[Offset + 6],
            Bytes[Offset + 7],
        ]);
        Offset += 8;
        if Offset + ChunkLength > Bytes.len() {
            return Err("GLB chunk exceeds file size".to_string());
        }
        let Chunk = Bytes[Offset..Offset + ChunkLength].to_vec();
        if ChunkType == 0x4E4F534A {
            JsonChunk = Some(Chunk);
        } else if ChunkType == 0x004E4942 {
            BinChunk = Some(Chunk);
        }
        Offset += ChunkLength;
    }

    let JsonBytes = JsonChunk.ok_or("GLB JSON chunk not found")?;
    let JsonText = String::from_utf8(JsonBytes).map_err(|e| e.to_string())?;
    let Document: serde_json::Value =
        serde_json::from_str(JsonText.trim()).map_err(|e| e.to_string())?;
    BuildGltfScene(&Document, None, BinChunk)
}

fn BlenderCandidates() -> Vec<PathBuf> {
    let mut Candidates: Vec<PathBuf> = Vec::new();
    if let Some(Path) = std::env::var_os("BLENDER_PATH") {
        Candidates.push(PathBuf::from(Path));
    }
    Candidates.push(PathBuf::from("blender"));

    for EnvKey in ["PROGRAMFILES", "PROGRAMFILES(X86)"] {
        let Some(Root) = std::env::var_os(EnvKey) else {
            continue;
        };
        let Foundation = PathBuf::from(Root).join("Blender Foundation");
        let Ok(Entries) = fs::read_dir(Foundation) else {
            continue;
        };
        let mut Found = Entries
            .filter_map(|Entry| Entry.ok())
            .map(|Entry| Entry.path().join("blender.exe"))
            .filter(|Path| Path.exists())
            .collect::<Vec<_>>();
        Found.sort_by(|A, B| B.cmp(A));
        Candidates.extend(Found);
    }

    Candidates
}

fn BlendExportScript() -> String {
    [
        "import bpy",
        "import sys",
        "Output = sys.argv[sys.argv.index('--') + 1]",
        "bpy.ops.object.select_all(action='SELECT')",
        "bpy.ops.export_scene.gltf(filepath=Output, export_format='GLB')",
    ]
    .join("\n")
}

fn LoadBlend(path: &str) -> Result<RunSceneResult, String> {
    let Stamp = UNIX_EPOCH
        .elapsed()
        .map(|Duration| Duration.as_millis())
        .unwrap_or(0);
    let TempDir = std::env::temp_dir().join(format!("nyx_blend_import_{}", Stamp));
    fs::create_dir_all(&TempDir).map_err(|E| E.to_string())?;
    let ScriptPath = TempDir.join("export_blend.py");
    let OutputPath = TempDir.join("model.glb");
    fs::write(&ScriptPath, BlendExportScript()).map_err(|E| E.to_string())?;

    let mut Errors: Vec<String> = Vec::new();
    for Candidate in BlenderCandidates() {
        let Output = Command::new(&Candidate)
            .arg("--background")
            .arg(path)
            .arg("--python")
            .arg(&ScriptPath)
            .arg("--")
            .arg(&OutputPath)
            .output();
        match Output {
            Ok(Result) if Result.status.success() && OutputPath.exists() => {
                let mut Scene = LoadGlb(OutputPath.to_str().ok_or("Invalid BLEND export path")?)?;
                Scene.terminal.insert(
                    0,
                    "runtime: BLEND loader via Blender GLB export".to_string(),
                );
                let _ = fs::remove_file(&ScriptPath);
                let _ = fs::remove_file(&OutputPath);
                let _ = fs::remove_dir(&TempDir);
                return Ok(Scene);
            }
            Ok(Result) => {
                let Stderr = String::from_utf8_lossy(&Result.stderr);
                Errors.push(format!(
                    "{} exited with {}: {}",
                    Candidate.display(),
                    Result.status,
                    Stderr.trim()
                ));
            }
            Err(Error) => {
                Errors.push(format!("{}: {}", Candidate.display(), Error));
            }
        }
    }

    let _ = fs::remove_file(&ScriptPath);
    let _ = fs::remove_file(&OutputPath);
    let _ = fs::remove_dir(&TempDir);
    Err(format!(
        "BLEND import requires Blender CLI access. Set BLENDER_PATH or install Blender. {}",
        Errors.join(" | ")
    ))
}

fn GltfArray<'a>(
    Document: &'a serde_json::Value,
    Key: &str,
) -> Result<&'a Vec<serde_json::Value>, String> {
    Document
        .get(Key)
        .and_then(|Value| Value.as_array())
        .ok_or_else(|| format!("glTF '{}' array not found", Key))
}

fn LoadGltfBuffers(
    Document: &serde_json::Value,
    BaseDir: Option<&Path>,
    GlbBin: Option<Vec<u8>>,
) -> Result<Vec<Vec<u8>>, String> {
    let BuffersJson = GltfArray(Document, "buffers")?;
    let mut Buffers = Vec::with_capacity(BuffersJson.len());
    for (I, Buffer) in BuffersJson.iter().enumerate() {
        if let Some(Uri) = Buffer.get("uri").and_then(|Value| Value.as_str()) {
            if Uri.starts_with("data:") {
                use base64::Engine as _;
                let (_, Encoded) = Uri
                    .split_once(',')
                    .ok_or_else(|| "Invalid glTF data URI".to_string())?;
                Buffers.push(
                    base64::engine::general_purpose::STANDARD
                        .decode(Encoded)
                        .map_err(|E| E.to_string())?,
                );
            } else {
                let Root = BaseDir.ok_or("External glTF buffer has no base directory")?;
                Buffers.push(fs::read(Root.join(Uri)).map_err(|E| E.to_string())?);
            }
        } else if I == 0 {
            Buffers.push(GlbBin.clone().ok_or("GLB BIN chunk not found")?);
        } else {
            return Err("glTF buffer has no URI".to_string());
        }
    }
    Ok(Buffers)
}

fn ComponentSize(ComponentType: u64) -> Option<usize> {
    match ComponentType {
        5121 => Some(1),
        5123 => Some(2),
        5125 | 5126 => Some(4),
        _ => None,
    }
}

fn AccessorView<'a>(
    Document: &'a serde_json::Value,
    Buffers: &'a [Vec<u8>],
    AccessorIndex: usize,
) -> Result<(&'a [u8], usize, usize, u64, String), String> {
    let Accessors = GltfArray(Document, "accessors")?;
    let Accessor = Accessors
        .get(AccessorIndex)
        .ok_or_else(|| "glTF accessor index out of range".to_string())?;
    let BufferViewIndex = Accessor
        .get("bufferView")
        .and_then(|Value| Value.as_u64())
        .ok_or_else(|| "glTF accessor has no bufferView".to_string())?
        as usize;
    let BufferViews = GltfArray(Document, "bufferViews")?;
    let BufferView = BufferViews
        .get(BufferViewIndex)
        .ok_or_else(|| "glTF bufferView index out of range".to_string())?;
    let BufferIndex = BufferView
        .get("buffer")
        .and_then(|Value| Value.as_u64())
        .unwrap_or(0) as usize;
    let Buffer = Buffers
        .get(BufferIndex)
        .ok_or_else(|| "glTF buffer index out of range".to_string())?;
    let ViewOffset = BufferView
        .get("byteOffset")
        .and_then(|Value| Value.as_u64())
        .unwrap_or(0) as usize;
    let ViewLength = BufferView
        .get("byteLength")
        .and_then(|Value| Value.as_u64())
        .ok_or_else(|| "glTF bufferView has no byteLength".to_string())?
        as usize;
    let AccessorOffset = Accessor
        .get("byteOffset")
        .and_then(|Value| Value.as_u64())
        .unwrap_or(0) as usize;
    let ComponentType = Accessor
        .get("componentType")
        .and_then(|Value| Value.as_u64())
        .ok_or_else(|| "glTF accessor has no componentType".to_string())?;
    let AccessorType = Accessor
        .get("type")
        .and_then(|Value| Value.as_str())
        .ok_or_else(|| "glTF accessor has no type".to_string())?
        .to_string();
    let Count = Accessor
        .get("count")
        .and_then(|Value| Value.as_u64())
        .ok_or_else(|| "glTF accessor has no count".to_string())? as usize;
    let ComponentSize = ComponentSize(ComponentType).ok_or("Unsupported glTF component type")?;
    let Components = match AccessorType.as_str() {
        "SCALAR" => 1,
        "VEC2" => 2,
        "VEC3" => 3,
        "VEC4" => 4,
        _ => return Err("Unsupported glTF accessor type".to_string()),
    };
    let Stride = BufferView
        .get("byteStride")
        .and_then(|Value| Value.as_u64())
        .map(|Value| Value as usize)
        .unwrap_or(ComponentSize * Components);
    let Start = ViewOffset + AccessorOffset;
    let End = ViewOffset + ViewLength;
    if Start > End || End > Buffer.len() {
        return Err("glTF accessor exceeds buffer".to_string());
    }
    Ok((
        &Buffer[Start..End],
        Stride,
        Count,
        ComponentType,
        AccessorType,
    ))
}

fn ReadGltfPositions(
    Document: &serde_json::Value,
    Buffers: &[Vec<u8>],
    AccessorIndex: usize,
) -> Result<Vec<[f32; 3]>, String> {
    let (Bytes, Stride, Count, ComponentType, AccessorType) =
        AccessorView(Document, Buffers, AccessorIndex)?;
    if ComponentType != 5126 || AccessorType != "VEC3" {
        return Err("glTF POSITION accessor must be FLOAT VEC3".to_string());
    }
    let mut Vertices = Vec::with_capacity(Count);
    for I in 0..Count {
        let Offset = I * Stride;
        if Offset + 12 > Bytes.len() {
            return Err("glTF POSITION accessor exceeds buffer".to_string());
        }
        Vertices.push([
            f32::from_le_bytes([
                Bytes[Offset],
                Bytes[Offset + 1],
                Bytes[Offset + 2],
                Bytes[Offset + 3],
            ]),
            f32::from_le_bytes([
                Bytes[Offset + 4],
                Bytes[Offset + 5],
                Bytes[Offset + 6],
                Bytes[Offset + 7],
            ]),
            f32::from_le_bytes([
                Bytes[Offset + 8],
                Bytes[Offset + 9],
                Bytes[Offset + 10],
                Bytes[Offset + 11],
            ]),
        ]);
    }
    Ok(Vertices)
}

fn ReadGltfIndices(
    Document: &serde_json::Value,
    Buffers: &[Vec<u8>],
    AccessorIndex: usize,
) -> Result<Vec<u32>, String> {
    let (Bytes, Stride, Count, ComponentType, AccessorType) =
        AccessorView(Document, Buffers, AccessorIndex)?;
    if AccessorType != "SCALAR" {
        return Err("glTF index accessor must be SCALAR".to_string());
    }
    let mut Indices = Vec::with_capacity(Count);
    for I in 0..Count {
        let Offset = I * Stride;
        let Index = match ComponentType {
            5121 => *Bytes.get(Offset).ok_or("glTF index exceeds buffer")? as u32,
            5123 => {
                if Offset + 2 > Bytes.len() {
                    return Err("glTF index exceeds buffer".to_string());
                }
                u16::from_le_bytes([Bytes[Offset], Bytes[Offset + 1]]) as u32
            }
            5125 => {
                if Offset + 4 > Bytes.len() {
                    return Err("glTF index exceeds buffer".to_string());
                }
                u32::from_le_bytes([
                    Bytes[Offset],
                    Bytes[Offset + 1],
                    Bytes[Offset + 2],
                    Bytes[Offset + 3],
                ])
            }
            _ => return Err("Unsupported glTF index component type".to_string()),
        };
        Indices.push(Index);
    }
    Ok(Indices)
}

fn BuildGltfScene(
    Document: &serde_json::Value,
    BaseDir: Option<&Path>,
    GlbBin: Option<Vec<u8>>,
) -> Result<RunSceneResult, String> {
    let Buffers = LoadGltfBuffers(Document, BaseDir, GlbBin)?;
    let MeshesJson = GltfArray(Document, "meshes")?;
    let mut Meshes: Vec<ImportedMesh> = Vec::new();
    for (MeshIndex, MeshJson) in MeshesJson.iter().enumerate() {
        let MeshName = MeshJson
            .get("name")
            .and_then(|Value| Value.as_str())
            .unwrap_or("glTF Mesh");
        let Some(Primitives) = MeshJson
            .get("primitives")
            .and_then(|Value| Value.as_array())
        else {
            continue;
        };
        for (PrimitiveIndex, Primitive) in Primitives.iter().enumerate() {
            let Mode = Primitive
                .get("mode")
                .and_then(|Value| Value.as_u64())
                .unwrap_or(4);
            if Mode != 4 {
                continue;
            }
            let PositionAccessor = Primitive
                .get("attributes")
                .and_then(|Value| Value.get("POSITION"))
                .and_then(|Value| Value.as_u64())
                .ok_or("glTF primitive has no POSITION attribute")?
                as usize;
            let Vertices = ReadGltfPositions(Document, &Buffers, PositionAccessor)?;
            let mut Indices = if let Some(IndexAccessor) =
                Primitive.get("indices").and_then(|Value| Value.as_u64())
            {
                ReadGltfIndices(Document, &Buffers, IndexAccessor as usize)?
            } else {
                (0..Vertices.len() as u32).collect::<Vec<_>>()
            };
            Indices.truncate(Indices.len() / 3 * 3);
            Meshes.push(ImportedMesh {
                Name: format!("{}_{}_{}", MeshName, MeshIndex, PrimitiveIndex),
                Vertices,
                Indices,
            });
        }
    }
    BuildImportedMeshScene("glTF", Meshes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn MeshCount(Result: &RunSceneResult) -> usize {
        Result
            .commands
            .iter()
            .filter(|Command| {
                Command.get("Cmd").and_then(|Value| Value.as_str()) == Some("AddMesh")
            })
            .count()
    }

    #[test]
    fn LoadsAsciiFbxMesh() {
        let Content = r#"
            Objects:  {
                Geometry: 1, "Geometry::Mesh", "Mesh" {
                    Vertices: *9 {
                        a: 0,0,0, 1,0,0, 0,1,0
                    }
                    PolygonVertexIndex: *3 {
                        a: 0,1,-3
                    }
                }
            }
        "#;
        let Result = LoadFbxAscii(Content).expect("FBX mesh should load");
        assert_eq!(MeshCount(&Result), 1);
    }

    #[test]
    fn LoadsAsciiStlMesh() {
        let Content = r#"
            solid sample
                facet normal 0 0 1
                    outer loop
                        vertex 0 0 0
                        vertex 1 0 0
                        vertex 0 1 0
                    endloop
                endfacet
            endsolid sample
        "#;
        let Result = LoadAsciiStl(Content).expect("STL mesh should load");
        assert_eq!(MeshCount(&Result), 1);
    }

    #[test]
    fn LoadsAsciiPlyMesh() {
        let Path = std::env::temp_dir().join("nyx_ascii_mesh_test.ply");
        let Content = "\
ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
element face 1
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
3 0 1 2
";
        fs::write(&Path, Content).expect("write temp PLY");
        let Result = LoadPly(Path.to_str().unwrap()).expect("PLY mesh should load");
        let _ = fs::remove_file(&Path);
        assert_eq!(MeshCount(&Result), 1);
    }

    #[test]
    fn LoadsDaeMesh() {
        let Content = r##"
<COLLADA>
    <library_geometries>
        <geometry id="TriangleGeometry" name="Triangle">
            <mesh>
                <source id="TrianglePositions">
                    <float_array id="TrianglePositionsArray" count="9">0 0 0 1 0 0 0 1 0</float_array>
                    <technique_common>
                        <accessor source="#TrianglePositionsArray" count="3" stride="3">
                            <param name="X" type="float"/>
                            <param name="Y" type="float"/>
                            <param name="Z" type="float"/>
                        </accessor>
                    </technique_common>
                </source>
                <vertices id="TriangleVertices">
                    <input semantic="POSITION" source="#TrianglePositions"/>
                </vertices>
                <triangles count="1">
                    <input semantic="VERTEX" source="#TriangleVertices" offset="0"/>
                    <p>0 1 2</p>
                </triangles>
            </mesh>
        </geometry>
    </library_geometries>
</COLLADA>
"##;
        let Result = LoadDaeContent(Content).expect("DAE mesh should load");
        assert_eq!(MeshCount(&Result), 1);
    }

    #[test]
    fn LoadsGltfBinaryMesh() {
        let mut Buffer = Vec::new();
        for Value in [0.0f32, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0] {
            Buffer.extend_from_slice(&Value.to_le_bytes());
        }
        for Value in [0u16, 1, 2] {
            Buffer.extend_from_slice(&Value.to_le_bytes());
        }
        let Document = serde_json::json!({
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": Buffer.len()}],
            "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                {"buffer": 0, "byteOffset": 36, "byteLength": 6}
            ],
            "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"}
            ],
            "meshes": [{
                "name": "Triangle",
                "primitives": [{
                    "attributes": {"POSITION": 0},
                    "indices": 1
                }]
            }]
        });
        let Result = BuildGltfScene(&Document, None, Some(Buffer)).expect("glTF mesh should load");
        assert_eq!(MeshCount(&Result), 1);
    }
}
