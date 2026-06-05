%%{init: {'flowchart': {'nodeSpacing': 10, 'rankSpacing': 20, 'curve': 'basis'}}}%%
flowchart LR
    classDef rootStyle fill:#2A2D34,stroke:#A2A7B5,stroke-width:2px,color:#FFF;
    classDef frontendStyle fill:#003366,stroke:#3399FF,stroke-width:1px,color:#E0F0FF;
    classDef backendStyle fill:#4A1525,stroke:#FF4D4D,stroke-width:1px,color:#FFE0E6;
    classDef toolStyle fill:#2E4A3E,stroke:#52BE80,stroke-width:1px,color:#E8F8F5;
    classDef configStyle fill:#5B3A29,stroke:#D35400,stroke-width:1px,color:#FDF2E9;
    classDef runtimeStyle fill:#4A235A,stroke:#BB8FCE,stroke-width:1px,color:#F5EEF8;
    classDef externalStyle fill:#1F2421,stroke:#95A5A6,stroke-width:1px,stroke-dasharray:5 5,color:#EAEDED;
    subgraph Layer_Workspace ["Nyx Workspace"]
        Root["Nyx Workspace Root"]:::rootStyle
        Root --> FrontendDir["src/ (React+TS)"]:::frontendStyle
        Root --> BackendDir["src-tauri/ (Rust)"]:::backendStyle
        Root --> RuntimeDir["nyx_runtime/ (Shims)"]:::runtimeStyle
        Root --> PresetsDir["presets/ (Test Scripts)"]:::runtimeStyle
        Root --> ScriptsDir["scripts/ (Node Helpers)"]:::toolStyle
        Root --> ToolsDir["tools/ (PS Installers)"]:::toolStyle
        Root --> MediaDir["media/ (Assets)"]:::toolStyle
        Root --> InstallerDir["installer/ (Docs)"]:::toolStyle
        Root --> ViteConfig["vite.config.ts"]:::configStyle
        Root --> TsConfig["tsconfig*.json"]:::configStyle
        Root --> Package["package*.json"]:::configStyle
        Root --> TauriConfig["tauri.conf.json"]:::configStyle
        Root --> Cargo["Cargo.toml / .lock"]:::configStyle
    end
    subgraph Layer_Frontend ["Frontend Client"]
        MainTsx["main.tsx"]:::frontendStyle --> AppTsx["App.tsx"]:::frontendStyle
        FrontendDir -.-> MainTsx

        subgraph FE_Components ["UI Components"]
            AppTsx --> ActivityBar["ActivityBar.tsx"]:::frontendStyle
            AppTsx --> Sidebar["Sidebar.tsx"]:::frontendStyle
            AppTsx --> EditorArea["EditorArea.tsx"]:::frontendStyle
            AppTsx --> ViewportTab["ViewportTab.tsx"]:::frontendStyle
            AppTsx --> TerminalPanel["TerminalPanel.tsx"]:::frontendStyle
            AppTsx --> StatusBar["StatusBar.tsx"]:::frontendStyle
            AppTsx --> PropertiesBar["PropertiesBar.tsx"]:::frontendStyle
            AppTsx --> StartScreen["StartScreen.tsx"]:::frontendStyle
            AppTsx --> SourceControl["SourceControl.tsx"]:::frontendStyle
            AppTsx --> SettingsPanel["SettingsPanel.tsx"]:::frontendStyle
            AppTsx --> CommandPalette["CommandPalette.tsx"]:::frontendStyle
            AppTsx --> DevMenu["@devtools alias"]:::frontendStyle
            TerminalPanel --> AiPanel["AiPanel.tsx"]:::frontendStyle
            EditorArea --> HighlightOverlay["HighlightOverlay.tsx"]:::frontendStyle
        end

        subgraph FE_Services ["Client Services"]
            AppTsx --> FileService["FileService.ts"]:::frontendStyle
            AppTsx --> EditorService["EditorService.ts"]:::frontendStyle
            AppTsx --> CaptureService["CaptureService.ts"]:::frontendStyle
            AppTsx --> RunService["RunService.ts"]:::frontendStyle
            AppTsx --> SceneService["SceneService.ts"]:::frontendStyle
            AppTsx --> RendererService["RendererService.ts"]:::frontendStyle
            AppTsx --> StateService["StateService.ts"]:::frontendStyle
            AppTsx --> NativeCommands["NativeCommands.ts"]:::frontendStyle
            AppTsx --> EngineProfiles["EngineProfiles.ts"]:::frontendStyle
            AppTsx --> Tokenizer["Tokenizer.ts"]:::frontendStyle
            AppTsx --> UILib["ui/UILib.ts"]:::frontendStyle
            AppTsx --> DevtoolsStub["devtools-stub/index.ts"]:::frontendStyle
            AiPanel --> AiService["AiService.ts"]:::frontendStyle
            AiPanel --> StateService
            SourceControl --> GitService["GitService.ts"]:::frontendStyle
            SettingsPanel --> AiService & FileService
            PropertiesBar --> RendererService & StateService
            ViewportTab --> RendererService & StateService
            EditorArea --> Tokenizer & TerminalTokenizer["TerminalTokenizer.ts"]:::frontendStyle
            Tokenizer --> TokenizerWorker["Tokenizer.worker.ts"]:::frontendStyle
            SystemService["SystemService.ts"]:::frontendStyle
        end

        subgraph FE_State ["Client State"]
            StateService --> StateManager["StateManager.ts"]:::frontendStyle --> ClientState["ClientState.ts"]:::frontendStyle
            PropertiesBar --> UseStateKey["useStateKey.ts"]:::frontendStyle --> ClientState
        end
    end
    subgraph Layer_Tauri_Bridge ["Tauri Bridge"]
        TauriInvoke["@tauri invoke"]:::configStyle
        TauriEvents["Tauri Events"]:::configStyle
        FileService & EditorService & CaptureService & RunService & SceneService & RendererService & AiService & SystemService --> TauriInvoke
        TauriInvoke --> TauriCommands["Command Dispatcher"]:::configStyle
        TauriCommands --> FileCommands["file: list/open/save/delete/rename/create/metadata/select"]:::configStyle
        TauriCommands --> TerminalCommands["terminal: run/capture/run file"]:::configStyle
        TauriCommands --> SceneCommands["scene: run/run live"]:::configStyle
        TauriCommands --> RendererCommands["renderer: load scene/live/camera/gizmo/selection/bounds"]:::configStyle
        TauriCommands --> AiCommands["AI: config/agent/approvals/sidecar"]:::configStyle
        TauriCommands --> SettingsCommands["settings: get/save"]:::configStyle
        TauriCommands --> SystemCommands["system: stats"]:::configStyle
    end
    subgraph Layer_Backend ["Rust Backend"]
        RustMain["src/main.rs"]:::backendStyle
        BackendDir -.-> RustMain
        RustMain --> CommandsMod["commands/mod.rs"]:::backendStyle
        RustMain --> AgentRuntime["agent_runtime/mod.rs"]:::backendStyle
        RustMain --> RendererMod["renderer/mod.rs"]:::backendStyle
        RustMain --> AppState["state/mod.rs"]:::backendStyle
        RustMain --> ApprovalState["commands/agent.rs (ApprovalState)"]:::backendStyle
        CommandsMod --> AppState & AgentCommands["commands/agent.rs"] & RendererMod
        FileCommands & TerminalCommands & RendererCommands --> AppState
        SettingsCommands --> SettingsJson["APPDATA/Nyx/settings.json"]:::configStyle
        SystemCommands --> SysMonitor["sysinfo monitor"]:::backendStyle
        CommandsMod --> SettingsJson & SysMonitor & Keyring["keyring API keys"]:::backendStyle
        AgentCommands --> AgentRuntime & Keyring
    end
    subgraph Layer_Renderer_Pipeline ["WGPU Engine"]
        RendererCommands --> RendererState["NyxRenderer SceneState"]:::backendStyle
        RendererMod --> Camera["camera.rs"] & Pipeline["pipeline.rs"] & SceneRenderer["scene.rs"] & Window["window.rs"] & Physics["physics/mod.rs"]:::backendStyle
        RendererState --> PhysicsWorld["PhysicsWorld"] & RenderLoop["render_loop"]:::backendStyle
        RenderLoop --> SceneRenderer
        SceneRenderer --> Shaders["shaders/*.wgsl (roblox/grid/gizmo)"]:::configStyle
        SceneRenderer --> ViewportWindow["Win32 child viewport"]:::externalStyle
        Physics --> NyxPhysics["nyx_physics.rs"] & RobloxPhysics["roblox_physics.rs"] & UnityPhysics["unity_physics.rs"] & UnrealPhysics["unreal_physics.rs"]:::backendStyle
    end
    subgraph Layer_Runtime_Execution ["Runtime Core"]
        SceneCommands --> RuntimeShims["nyx_runtime/* init"]:::runtimeStyle
        CommandsMod --> RuntimeShims
        PresetsDir --> RobloxPreset["roblox_object_test.luau"] & UnityPreset["unity_object_test.cs"] & UnrealPreset["unreal_object_test.cpp"]:::runtimeStyle
        RuntimeDir --> RobloxRuntime["roblox/init.lua"] & RobloxDemo["roblox/demo_scene.luau"] & UnityRuntime["unity/init.cs"] & UnrealRuntime["unreal/init.cpp"]:::runtimeStyle
        WorkspaceFiles["User Files (.luau/.lua/.cs/.cpp)"]:::externalStyle -.-> AppTsx
        WorkspaceFiles --> SceneRunner["run_scene/run_live_scene"] & FileRunner["run_file"]:::backendStyle
        RobloxPreset & UnityPreset & UnrealPreset & RobloxRuntime & UnityRuntime & UnrealRuntime & RobloxDemo --> SceneRunner
        SceneRunner --> ProfileResolver["resolve_scene_profile"]:::backendStyle
        ProfileResolver --> RobloxShim["roblox/init.lua"] & UnityShim["unity/init.cs"] & UnrealShim["unreal/init.cpp"]:::runtimeStyle
        RobloxShim & UnityShim & UnrealShim --> SceneCommandJson["SceneCommand JSON"]:::configStyle --> RendererService
    end
    subgraph Layer_AI_Engine ["AI Agent"]
        AiCommands --> AgentRuntime & ApprovalState
        AgentCommands --> Reqwest["reqwest API"] & WorkspaceTools["workspace tools"] & AgentTauriEvents["event broadcaster"]:::backendStyle
        Reqwest --> ProviderCloud["Anthropic/DeepSeek API"]:::externalStyle
        WorkspaceTools --> MemoryTools["Workspace/Memory/Obsidian"]:::toolStyle
        AgentRuntime -- Stream Delta --> AgentTauriEvents
        AgentTauriEvents -. Async Broadcast .-> TauriEvents
    end
    subgraph Layer_Build_Toolchain ["Build Automation"]
        Package --> PackageScripts["package.json scripts"]:::toolStyle
        PackageScripts --> Dev["dev (Vite)"] & Build["build (tsc+Vite)"] & Preview["preview"] & TauriCmd["tauri"] & Sidecars["build:sidecars"]:::toolStyle
        ScriptsDir --> StageSidecars["stage-sidecars.mjs"]:::toolStyle
        Sidecars --> StageSidecars
        Cargo --> CargoToml["Cargo.toml"]:::configStyle
        TauriCmd --> TauriConfig & CargoToml
        Build --> FrontendDist["dist/ bundle"]:::configStyle --> TauriCmd

        subgraph Cargo_Compilation ["Cargo outputs"]
            CargoToml --> MainBin["thazts-ide"] & KeymanBin["nyx-keyman"] & InstallerBin["nyx-installer"] & NyxCliBin["NyxCli"]:::backendStyle
            MainBin --> TauriApp["Desktop IDE"]:::backendStyle
            KeymanBin --> KeyStorage["Key assistant"]:::backendStyle
            InstallerBin --> InstallerUi["Windows installer"]:::backendStyle
            NyxCliBin --> CliAgent["Terminal agent"]:::backendStyle
        end

        StageSidecars --> KeymanBin & NyxCliBin
        KeymanBin & NyxCliBin --> ExtraBin["extra-bin sidecars"]:::configStyle --> TauriCmd
        RustMain --> BuildRs["build.rs"]:::backendStyle
        TauriApp --> LaunchKeyman["ai_launch_keyman"] & LaunchCli["ai_launch_nyx_cli"]:::backendStyle
        ToolsDir --> BuildInstaller["build-installer.ps1"]:::toolStyle
        BuildInstaller --> InstallerPayload["installer payload"]:::configStyle --> DistInstaller["dist-installer/"]:::toolStyle
    end
    AppState -. Update .-> TauriEvents -. Reactive .-> FrontendServices
    ClientState -. Action Loop .-> FrontendServices
    DevMenu -. Debug .-> DevtoolsStub