# Viewport Runtime Follow-ups

## Current State

The Roblox runtime shim is the most complete runtime surface. Unity and Unreal now expose richer engine-shaped APIs in both runtime trees:

- `src-tauri/nyx_runtime/*` for app-embedded runtime shims.
- `nyx_runtime/*` for installer payload staging.

The two trees should stay byte-for-byte equivalent for each matching runtime file.

## Shaky Logic

### C# and C++ execution

Unity and Unreal files are still not compiled or executed by the viewport runner. `run_scene` extracts the `@nyx-scene` JSON block from `.cs` and `.cpp` files, then sends that JSON to the renderer. The new `init.cs` and `init.cpp` files document and model the expected API surface, but they are not currently used as live interpreters for arbitrary C# or C++ code.

Follow-up: either add real script execution for C# and C++ or keep generated examples explicit that `@nyx-scene` is the executable source of truth.

### Destroy semantics

The Unity and Unreal shims remove objects from their in-memory command output, but the renderer command schema does not yet have a first-class `RemovePart` or `DestroyPart` command. This is fine for full scene reloads because omitted objects disappear when the scene is rebuilt, but it is not enough for incremental live deletion.

Follow-up: add a renderer-supported remove command if live C# or C++ execution becomes incremental.

### Light duplication

Light setters can append multiple `AddLight` commands. This is acceptable for current static command output, but a future live runner should upsert lights by ID the same way parts are upserted.

Follow-up: extend the scene command schema with stable light IDs or add upsert behavior in runtime command assembly.

### Compiler validation

The local machine has a .NET runtime but no .NET SDK, and no C++ compiler was available on PATH during this pass. The Rust app and frontend build passed, but the standalone C# and C++ shim syntax could not be compiler-verified locally.

Follow-up: validate `init.cs` with a C# compiler and `init.cpp` with MSVC or clang when the toolchain is available.

### Coordinate assumptions

Unreal conversion preserves Z-up by mapping Unreal `X -> X`, `Z -> Y`, and `Y -> Z`. Existing presets already follow this convention, but any future renderer changes to coordinate systems must update the Unreal shim, presets, and `ViewportManual.md` together.

Follow-up: add a small regression test that confirms Unreal position, scale, camera, light, velocity, force, and impulse conversion.

## Documentation Updates Needed

- Keep `src-tauri/src/skills/ViewportManual.md` aligned with the shim API surface.
- Keep this follow-up note current whenever C# or C++ moves from JSON extraction to real execution.
- Update presets if new supported APIs become preferred examples.
