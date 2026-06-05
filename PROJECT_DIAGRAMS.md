# Nyx Project Diagrams

These diagrams map the source-side project structure. Generated installer payloads, compiled binaries, and copied runtime payloads are intentionally excluded from the dependency graph.

## Workspace Map

```mermaid
flowchart TD
    Root["Nyx workspace"]

    Root --> Frontend["src/ React + TypeScript client"]
    Root --> Backend["src-tauri/ Rust + Tauri backend"]
    Root --> Runtime["nyx_runtime/ engine shims"]
    Root --> Presets["presets/ object test scripts"]
    Root --> Scripts["scripts/ Node build helpers"]
    Root --> Tools["tools/ PowerShell installer tools"]
    Root --> Media["media/ static assets"]
    Root --> Installer["installer/ installer docs"]

    Root --> ViteConfig["vite.config.ts"]
    Root --> TsConfig["tsconfig.json / tsconfig.node.json"]
    Root --> Package["package.json / package-lock.json"]
    Root --> TauriConfig["src-tauri/tauri.conf.json"]
    Root --> Cargo["src-tauri/Cargo.toml / Cargo.lock"]

    Frontend --> MainTsx["main.tsx"]
    Frontend --> AppTsx["App.tsx"]
    Frontend --> Components["components/*.tsx"]
    Frontend --> Services["services/*.ts"]
    Frontend --> State["state/*.ts"]
    Frontend --> Styles["styles/*.css"]
    Frontend --> UiLib["ui/UILib.ts"]
    Frontend --> DevtoolsStub["devtools-stub/index.ts"]

    Backend --> RustMain["src/main.rs"]
    Backend --> Commands["src/commands/"]
    Backend --> AppState["src/state/mod.rs"]
    Backend --> Renderer["src/renderer/"]
    Backend --> AgentRuntime["src/agent_runtime/"]
    Backend --> Bins["src/bin/"]
    Backend --> BuildRs["build.rs"]

    Scripts --> StageSidecars["stage-sidecars.mjs"]
    Tools --> BuildInstaller["build-installer.ps1"]
```

## Framework Data River

```mermaid
flowchart LR
    RustLogic["Rust logic/state"]
    TauriCommands["Tauri commands"]
    TauriEvents["Tauri events"]
    FrontendServices["Frontend services"]
    StateManager["StateManager"]
    ClientState["ClientState"]
    ReactComponents["React components"]

    RustLogic --> TauriCommands
    RustLogic --> TauriEvents
    TauriCommands --> FrontendServices
    TauriEvents --> FrontendServices
    FrontendServices --> StateManager
    StateManager --> ClientState
    ClientState --> ReactComponents

    ReactComponents -->|"user action"| FrontendServices
```

## Frontend Dependency Graph

```mermaid
flowchart TD
    Main["src/main.tsx"] --> App["src/App.tsx"]

    App --> ActivityBar["ActivityBar.tsx"]
    App --> Sidebar["Sidebar.tsx"]
    App --> EditorArea["EditorArea.tsx"]
    App --> ViewportTab["ViewportTab.tsx"]
    App --> TerminalPanel["TerminalPanel.tsx"]
    App --> StatusBar["StatusBar.tsx"]
    App --> PropertiesBar["PropertiesBar.tsx"]
    App --> StartScreen["StartScreen.tsx"]
    App --> SourceControl["SourceControl.tsx"]
    App --> SettingsPanel["SettingsPanel.tsx"]
    App --> CommandPalette["CommandPalette.tsx"]
    App --> DevMenu["@devtools alias"]

    App --> FileService["FileService.ts"]
    App --> EditorService["EditorService.ts"]
    App --> CaptureService["CaptureService.ts"]
    App --> RunService["RunService.ts"]
    App --> SceneService["SceneService.ts"]
    App --> RendererService["RendererService.ts"]
    App --> StateService["StateService.ts"]
    App --> NativeCommands["NativeCommands.ts"]
    App --> EngineProfiles["EngineProfiles.ts"]
    App --> Tokenizer["Tokenizer.ts"]
    App --> UILib["UILib.ts"]

    TerminalPanel --> AiPanel["AiPanel.tsx"]
    AiPanel --> AiService["AiService.ts"]
    AiPanel --> StateService
    SourceControl --> GitService["GitService.ts"]
    SettingsPanel --> AiService
    SettingsPanel --> FileService
    PropertiesBar --> RendererService
    PropertiesBar --> StateService
    PropertiesBar --> UseStateKey["useStateKey.ts"]
    ViewportTab --> RendererService
    ViewportTab --> StateService
    EditorArea --> HighlightOverlay["HighlightOverlay.tsx"]
    EditorArea --> Tokenizer
    EditorArea --> TerminalTokenizer["TerminalTokenizer.ts"]
    Tokenizer --> TokenizerWorker["Tokenizer.worker.ts"]

    StateService --> StateManager["StateManager.ts"]
    StateManager --> ClientState["ClientState.ts"]
    UseStateKey --> ClientState

    FileService --> TauriInvoke["@tauri invoke"]
    EditorService --> TauriInvoke
    CaptureService --> TauriInvoke
    RunService --> TauriInvoke
    SceneService --> TauriInvoke
    RendererService --> TauriInvoke
    AiService --> TauriInvoke
    SystemService["SystemService.ts"] --> TauriInvoke
```

## Backend Dependency Graph

```mermaid
flowchart TD
    MainRs["src-tauri/src/main.rs"]

    MainRs --> CommandsMod["commands/mod.rs"]
    MainRs --> AgentRuntime["agent_runtime/mod.rs"]
    MainRs --> RendererMod["renderer/mod.rs"]
    MainRs --> AppState["state/mod.rs"]
    MainRs --> ApprovalState["commands/agent.rs ApprovalState"]

    CommandsMod --> AppState
    CommandsMod --> AgentCommands["commands/agent.rs"]
    CommandsMod --> RendererMod
    CommandsMod --> RuntimeShims["nyx_runtime/* init files"]
    CommandsMod --> SystemStats["sysinfo system stats"]
    CommandsMod --> Keyring["keyring API keys"]
    CommandsMod --> SettingsJson["APPDATA/Nyx/settings.json"]

    AgentCommands --> AgentRuntime
    AgentCommands --> Reqwest["reqwest provider APIs"]
    AgentCommands --> Keyring
    AgentCommands --> WorkspaceTools["workspace tool execution"]
    AgentCommands --> TauriEvents["AI activity/tool/change events"]

    RendererMod --> Camera["renderer/camera.rs"]
    RendererMod --> Pipeline["renderer/pipeline.rs"]
    RendererMod --> SceneRenderer["renderer/scene.rs"]
    RendererMod --> Window["renderer/window.rs"]
    RendererMod --> Physics["renderer/physics/mod.rs"]

    SceneRenderer --> Shaders["renderer/shaders/*.wgsl"]
    Physics --> NyxPhysics["nyx_physics.rs"]
    Physics --> RobloxPhysics["roblox_physics.rs"]
    Physics --> UnityPhysics["unity_physics.rs"]
    Physics --> UnrealPhysics["unreal_physics.rs"]
```

## Tauri Command Surface

```mermaid
flowchart LR
    Services["Frontend services"] --> Commands["Tauri commands"]

    Commands --> FileCommands["file commands\nlist/open/save/delete/rename/create/metadata/select folder"]
    Commands --> TerminalCommands["terminal commands\nrun terminal / capture command / run file"]
    Commands --> SceneCommands["scene commands\nrun scene / run live scene"]
    Commands --> RendererCommands["renderer commands\nload scene / camera / gizmo / selection / bounds"]
    Commands --> AiCommands["AI commands\nconfig / agent / approvals / sidecar launch"]
    Commands --> SettingsCommands["settings commands\nget/save app settings"]
    Commands --> SystemCommands["system commands\nget system stats"]

    FileCommands --> AppState["AppState"]
    TerminalCommands --> AppState
    SceneCommands --> RuntimeShims["Runtime shims"]
    RendererCommands --> RendererState["NyxRenderer SceneState"]
    RendererCommands --> AppState
    AiCommands --> AgentRuntime["agent runtime"]
    AiCommands --> ApprovalState["ApprovalState"]
    SettingsCommands --> SettingsFile["APPDATA/Nyx/settings.json"]
    SystemCommands --> SysMonitor["sysinfo monitor"]
```

## Renderer And Scene Pipeline

```mermaid
flowchart TD
    SourceFile["workspace scene source\n.luau / .lua / .cs / .cpp"]
    App["App.tsx"]
    SceneService["SceneService.ts"]
    RunScene["run_scene / run_live_scene"]
    ProfileResolver["resolve_scene_profile"]
    RobloxShim["nyx_runtime/roblox/init.lua"]
    UnityShim["nyx_runtime/unity/init.cs"]
    UnrealShim["nyx_runtime/unreal/init.cpp"]
    SceneCommands["SceneCommand JSON"]
    RendererService["RendererService.ts"]
    RendererCommand["renderer_load_scene / renderer_load_live_scene"]
    SceneState["renderer::SceneState"]
    PhysicsWorld["PhysicsWorld"]
    RenderLoop["renderer render_loop"]
    SceneRenderer["SceneRenderer"]
    Shaders["roblox.wgsl / grid.wgsl / gizmo.wgsl"]
    ViewportWindow["Win32 child viewport"]

    SourceFile --> App
    App --> SceneService
    SceneService --> RunScene
    RunScene --> ProfileResolver
    ProfileResolver --> RobloxShim
    ProfileResolver --> UnityShim
    ProfileResolver --> UnrealShim
    RobloxShim --> SceneCommands
    UnityShim --> SceneCommands
    UnrealShim --> SceneCommands
    SceneCommands --> RendererService
    RendererService --> RendererCommand
    RendererCommand --> SceneState
    SceneState --> PhysicsWorld
    SceneState --> RenderLoop
    RenderLoop --> SceneRenderer
    SceneRenderer --> Shaders
    SceneRenderer --> ViewportWindow
```

## AI Agent Pipeline

```mermaid
sequenceDiagram
    participant UI as AiPanel / TerminalPanel
    participant AiService as AiService.ts
    participant Command as ai_start_agent
    participant Agent as commands/agent.rs
    participant Runtime as agent_runtime/mod.rs
    participant Provider as Anthropic/DeepSeek API
    participant Tools as Workspace/Memory/Obsidian tools
    participant Events as Tauri events

    UI->>AiService: start/provider/messages/workspace/mode
    AiService->>Command: invoke ai_start_agent
    Command->>Agent: build system prompt + tool settings
    Agent->>Provider: stream request
    Provider-->>Agent: text/tool deltas
    Agent->>Events: ai_token / ai_activity / ai_tool_call
    Agent->>Tools: execute approved tool calls
    Tools-->>Agent: ToolOutcome + optional change event
    Agent->>Events: ai_tool_result / ai_change_applied / ai_done
    Events-->>UI: render stream, approvals, changes
```

## Build And Packaging Flow

```mermaid
flowchart TD
    PackageScripts["package.json scripts"]

    PackageScripts --> Dev["npm run dev\nVite dev server"]
    PackageScripts --> Build["npm run build\ntsc + vite build"]
    PackageScripts --> Preview["npm run preview\nVite preview"]
    PackageScripts --> Tauri["npm run tauri\nTauri CLI"]
    PackageScripts --> Sidecars["npm run build:sidecars"]

    Sidecars --> StageSidecars["scripts/stage-sidecars.mjs"]
    StageSidecars --> CargoRelease["cargo build --release\nnyx-keyman + NyxCli"]
    CargoRelease --> ExtraBin["src-tauri/extra-bin sidecars"]

    Tauri --> TauriConfig["src-tauri/tauri.conf.json"]
    Tauri --> CargoManifest["src-tauri/Cargo.toml"]
    Tauri --> FrontendDist["dist/ frontend bundle"]
    Tauri --> RustBins["Rust binaries"]

    BuildInstaller["tools/build-installer.ps1"] --> InstallerPayload["installer payload"]
    InstallerPayload --> DistInstaller["dist-installer/"]
```

## Rust Binaries

```mermaid
flowchart TD
    CargoToml["src-tauri/Cargo.toml"]

    CargoToml --> MainBin["thazts-ide\nsrc/main.rs"]
    CargoToml --> KeymanBin["nyx-keyman\nsrc/bin/nyx_keyman.rs"]
    CargoToml --> InstallerBin["nyx-installer\nsrc/bin/nyx_installer.rs"]
    CargoToml --> NyxCliBin["NyxCli\nsrc/bin/NyxCli/main.rs"]

    MainBin --> TauriApp["Desktop IDE"]
    KeymanBin --> KeyStorage["API key setup"]
    InstallerBin --> InstallerUi["Windows installer UI"]
    NyxCliBin --> CliAgent["Terminal agent workflow"]

    StageSidecars["stage-sidecars.mjs"] --> KeymanBin
    StageSidecars --> NyxCliBin
    MainBin --> LaunchKeyman["ai_launch_keyman"]
    MainBin --> LaunchCli["ai_launch_nyx_cli"]
```

## Runtime Script Inputs

```mermaid
flowchart TD
    Presets["presets/"]
    Runtime["nyx_runtime/"]
    WorkspaceFiles["user workspace files"]
    SceneRunner["run_scene / run_live_scene"]
    FileRunner["run_file"]

    Presets --> RobloxPreset["roblox_object_test.luau"]
    Presets --> UnityPreset["unity_object_test.cs"]
    Presets --> UnrealPreset["unreal_object_test.cpp"]

    Runtime --> RobloxRuntime["roblox/init.lua"]
    Runtime --> RobloxDemo["roblox/demo_scene.luau"]
    Runtime --> UnityRuntime["unity/init.cs"]
    Runtime --> UnrealRuntime["unreal/init.cpp"]

    WorkspaceFiles --> SceneRunner
    WorkspaceFiles --> FileRunner
    RobloxPreset --> SceneRunner
    UnityPreset --> SceneRunner
    UnrealPreset --> SceneRunner

    RobloxRuntime --> SceneRunner
    UnityRuntime --> SceneRunner
    UnrealRuntime --> SceneRunner
    RobloxDemo --> SceneRunner
```
