# File Interpreters
generated: 1749513600

Everything that interprets a file lives in one place: `src-tauri/src/commands/scene_runner.rs`.

There are two dispatch paths: scene scripts (executed as code to produce a scene) and model files (parsed as geometry directly).

---

## Scene Scripts

**Entry points:**

- `run_scene(path, profile)` - full execution, called when a file is opened as a viewport.
- `run_live_scene(path, profile, elapsed)` - rate-limited execution (140 ms throttle), called on every tick of the live viewport loop.

Both call `RunSceneAtTime()` internally. `RunSceneAtTime()` branches on `profile`:

| Profile | Interpreter | How it works |
|---|---|---|
| `"roblox"` | mlua (Lua 5.4, embedded) | See Lua section below |
| `"unity"` | dotnet SDK (external) | See C# section below |
| `"unreal"` | g++ / clang++ / cl (external) | See C++ section below |

The profile is inferred from the file path at the TypeScript layer by `InferProfileFromPath()` in `src/services/EngineProfiles.ts` and passed through to the Tauri command.

**Return type: `RunSceneResult`**

All three paths return the same struct:
- `commands: Vec<serde_json::Value>` - the scene objects to render, as `AddPart` / `AddMesh` / `SetCamera` etc. commands.
- `terminal: Vec<String>` - lines from stdout / print calls.
- `errors: Vec<String>` - compile or runtime errors.
- `skipped: bool` - true when the rate limiter suppressed execution.

---

### Lua (roblox profile)

**Function:** `RunLuaSceneAtTime(path, profile, elapsed)`

**Runtime:** mlua with Lua 5.4, fully in-process, no subprocess.

**What happens:**
1. A fresh Lua context is created per call.
2. A `print` override is injected that captures output into `terminal`.
3. The Roblox shim (`nyx_runtime/roblox/init.lua`, embedded at compile time) is loaded. This provides `game`, `workspace`, `Vector3`, `Instance`, `CFrame`, and other Roblox globals.
4. The user script is loaded and executed.
5. `_NYX_COMMANDS` is read back from the Lua global table. This is the list of scene commands the shim accumulated.
6. On live ticks, `_nyx_step_live(elapsed)` is called if it exists in the script.

**Shim location:** `src-tauri/src/renderer/`; embedded via `include_str!` in `scene_runner.rs`.

---

### C# (unity profile)

**Function:** `TryRunCSharpScene(path, elapsed)`, with `CompileCSharp()` for the build step.

**Runtime:** .NET SDK, spawned as a subprocess via `dotnet run` or the compiled output.

**What happens:**
1. `CompileCSharp()` writes the Unity shim, the user file, and either a top-level snippet wrapper or a reflection-based scene host, then compiles the project using the system `dotnet` CLI.
2. Output is cached by a hash of the source content so repeated runs skip recompilation.
3. The compiled binary is executed and its stdout is parsed for JSON command output.
4. If no .NET SDK is found or compilation fails, the call falls back to the file's `@nyx-scene` block.

**Fallback shim identifier:** `UNITY_SHIM` (string constant in `scene_runner.rs`).

---

### C++ (unreal profile)

**Function:** `TryRunCppScene(path, elapsed)`, with `CompileCpp()` for the build step.

**Runtime:** System C++ compiler, tried in order: `g++`, `clang++`, `cl` (MSVC).

**What happens:**
1. `CompileCpp()` writes `NyxUnrealRuntime.h`, places the user C++ at file scope, and appends a generated `main()` that calls a recognised scene builder with `UWorld&`.
2. The wrapped source is compiled and the binary is cached by source hash.
3. The compiled binary is executed and stdout is parsed for JSON commands.
4. If no compiler is found or compilation fails, falls back to the file's `@nyx-scene` block.

**Fallback shim identifier:** `UNREAL_SHIM` (string constant in `scene_runner.rs`).

---

## Model Files

**Entry point:** `load_model_file(path)` in `scene_runner.rs`.

Dispatch is by file extension (lowercased). Each loader produces a `Vec<ImportedMesh>`:

```
struct ImportedMesh {
    Name:     String,
    Vertices: Vec<[f32; 3]>,
    Indices:  Vec<u32>,
}
```

After parsing, `BuildImportedMeshScene()` converts the mesh list into `AddMesh` commands with a fitted `SetCamera` command. The result is returned to TypeScript as a `ModelLoadResult` (via `ModelService.LoadModelFile()` in `src/services/ModelService.ts`), which hands the commands directly to `RendererService.LoadScene()`.

| Extension | Loader | Notes |
|---|---|---|
| `.obj` | `LoadObj()` | Parses `v`/`f` lines, one `ImportedMesh` per object group |
| `.fbx` | `LoadFbx()` | Binary and ASCII variants, uses `ExtractFbxNumberArray` |
| `.stl` | `LoadStl()` | Binary (80-byte header + 4-byte count + 50-byte triangles) and ASCII (`solid`/`facet` lines) |
| `.ply` | `LoadPly()` | ASCII, reads `vertex` and `face` sections after the header |
| `.dae` | `LoadDae()` | Collada XML, reads `geometry/mesh/vertices` and `triangles/polylist` primitives |
| `.gltf` | `LoadGltf()` | glTF 2.0 JSON, resolves buffer accessors and component types |
| `.glb` | `LoadGlb()` | Binary glTF 2.0, same accessor logic as `.gltf` after header parse |
| `.blend` | `LoadBlend()` | Invokes Blender via CLI with a Python export script to convert to GLB, then calls `LoadGlb()` |

**Where loaders live:** All loader functions are in `src-tauri/src/commands/scene_runner.rs`, starting after the scene script execution code.

---

## TypeScript Side

The TypeScript layer has two thin service wrappers that map to the Tauri commands above.

| Service | File | Tauri command |
|---|---|---|
| `ModelService.LoadModelFile()` | `src/services/ModelService.ts` | `load_model_file` |
| `SceneService.RunScene()` | `src/services/SceneService.ts` (or similar) | `run_scene` |
| `SceneService.RunLiveScene()` | same | `run_live_scene` |

Profile inference happens at the TypeScript layer in `src/services/EngineProfiles.ts` before the command is invoked.

---

## Quick Reference: Where Is Each Thing

| What | File |
|---|---|
| All loaders and scene runners | `src-tauri/src/commands/scene_runner.rs` |
| Profile dispatch logic | `src-tauri/src/commands/scene_runner.rs`, function `RunSceneAtTime` |
| Model file dispatch | `src-tauri/src/commands/scene_runner.rs`, function `load_model_file` |
| Profile inference (TS) | `src/services/EngineProfiles.ts` |
| Model service (TS) | `src/services/ModelService.ts` |
| Roblox Lua shim | `src-tauri/src/renderer/` (embedded via `include_str!` in scene_runner.rs) |
| Unity / Unreal fallback shims | Constants in `src-tauri/src/commands/scene_runner.rs` |
| Renderer command handlers | `src-tauri/src/commands/renderer.rs` |
| Scene command registration | `src-tauri/src/main.rs` |
