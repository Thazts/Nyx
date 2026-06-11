import { ClientState } from "./ClientState";

const AppRegistryKey = {
    AppReady:      false,
    WorkspacePath: null,    // string | null
    RecentPaths:   [],      // string[]
    ActiveFile:    null,    // string | null
    AppStatus:     "idle",  // "idle" | "loading" | "error"
    IsLoading:     false,
    IsRunning:     false,
} as const;

const EditorRegistryKey = {
    TerminalOutput:         [],    // string[]
    RunOutput:              [],    // string[]
    OpenTabs:               [],    // TabEntry[]
    FileTree:               [],    // FileEntry[]
    FileContent:            "",
    DiskContent:            "",
    ActiveTabModified:      false,
    CollapsedFolders:       [],    // string[]
    SelectedEntry:          null,  // FileEntry | null
    SelectedMetadata:       null,  // FileMetadata | null
    CursorLine:             1,
    CursorCol:              1,
    SavedFlash:             false,
    ExternalContentVersion: 0,
    GitBranch:              "-",
    DisplayLanguage:        "-",
} as const;

const RendererRegistryKey = {
    GizmoMode:               "move",  // "move" | "rotate" | "scale"
    SelectedPartId:          null,    // string | null
    SelectedFace:            null,    // { PartId, FaceIndex } | null
    ViewportActive:          false,
    ViewportPath:            null,    // string | null
    ViewportProfile:         null,    // string | null
    LastViewportInteraction: 0,
} as const;

const AiRegistryKey = {
    AiProvider:        "anthropic",
    AiMode:            "supervised", // "supervised" | "autonomous" | "agentic"
    AiActivity:        null,   // AgentActivityEvent | null
    AiStreaming:       false,
    AiPendingApproval: null,   // ToolCall | null
    AiLastChange:      null,   // AiChangeEvent | null
    AiChangedFiles:    [],     // string[]
    AiTaskSlice:       null,   // TaskSlice | null
} as const;

const SettingsRegistryKey = {
    AnthropicKeySet:   false,
    DeepseekKeySet:    false,
    ObsidianVaultPath: "",
} as const;

const APP_KEYS      = ["AppReady", "WorkspacePath", "RecentPaths", "ActiveFile", "AppStatus", "IsLoading", "IsRunning"] as const;
const EDITOR_KEYS   = ["TerminalOutput", "RunOutput", "OpenTabs", "FileTree", "FileContent", "DiskContent", "ActiveTabModified", "CollapsedFolders", "SelectedEntry", "SelectedMetadata", "CursorLine", "CursorCol", "SavedFlash", "ExternalContentVersion", "GitBranch", "DisplayLanguage"] as const;
const RENDERER_KEYS = ["GizmoMode", "SelectedPartId", "SelectedFace", "ViewportActive", "ViewportPath", "ViewportProfile", "LastViewportInteraction"] as const;
const AI_KEYS       = ["AiProvider", "AiMode", "AiActivity", "AiStreaming", "AiPendingApproval", "AiLastChange", "AiChangedFiles", "AiTaskSlice"] as const;
const SETTINGS_KEYS = ["AnthropicKeySet", "DeepseekKeySet", "ObsidianVaultPath"] as const;

const _keyMap: Record<string, Record<string, unknown>> = {};

for (const K of APP_KEYS)      _keyMap[K] = AppRegistryKey as unknown as Record<string, unknown>;
for (const K of EDITOR_KEYS)   _keyMap[K] = EditorRegistryKey as unknown as Record<string, unknown>;
for (const K of RENDERER_KEYS) _keyMap[K] = RendererRegistryKey as unknown as Record<string, unknown>;
for (const K of AI_KEYS)       _keyMap[K] = AiRegistryKey as unknown as Record<string, unknown>;
for (const K of SETTINGS_KEYS) _keyMap[K] = SettingsRegistryKey as unknown as Record<string, unknown>;

const _store: Record<string, unknown> = {};
const _listeners: Record<string, Set<(value: unknown) => void>> = {};

export const StateManager = {
    get(Key: string): unknown {
        if (!_keyMap[Key]) {
            console.warn(`StateManager.get: unknown key "${Key}"`);
            return undefined;
        }
        return _store[Key];
    },

    set(Key: string, Value: unknown): void {
        if (!_keyMap[Key]) {
            console.warn(`StateManager.set: unknown key "${Key}"`);
            return;
        }
        _store[Key] = Value;
        ClientState.Set(Key, Value);
        _listeners[Key]?.forEach(fn => fn(Value));
    },

    getIn(Key: string, SubKey: string): unknown {
        const obj = this.get(Key);
        if (typeof obj === "object" && obj !== null && SubKey in (obj as Record<string, unknown>)) {
            return (obj as Record<string, unknown>)[SubKey];
        }
        console.warn(`StateManager.getIn: key "${Key}" or subkey "${SubKey}" not found`);
        return undefined;
    },

    setIn(Key: string, SubKey: string, Value: unknown): void {
        const obj = this.get(Key);
        if (typeof obj === "object" && obj !== null) {
            (obj as Record<string, unknown>)[SubKey] = Value;
            ClientState.Set(Key, obj);
            _listeners[Key]?.forEach(fn => fn(obj));
        } else {
            console.warn(`StateManager.setIn: key "${Key}" is not an object`);
        }
    },

    subscribe(Key: string, Fn: (value: unknown) => void): () => void {
        if (!_listeners[Key]) _listeners[Key] = new Set();
        _listeners[Key].add(Fn);
        return () => _listeners[Key]?.delete(Fn);
    },

    init(): void {
        for (const K of APP_KEYS)      _store[K] = (AppRegistryKey as Record<string, unknown>)[K];
        for (const K of EDITOR_KEYS)   _store[K] = (EditorRegistryKey as Record<string, unknown>)[K];
        for (const K of RENDERER_KEYS) _store[K] = (RendererRegistryKey as Record<string, unknown>)[K];
        for (const K of AI_KEYS)       _store[K] = (AiRegistryKey as Record<string, unknown>)[K];
        for (const K of SETTINGS_KEYS) _store[K] = (SettingsRegistryKey as Record<string, unknown>)[K];
        ClientState.Init(_store);
    },
};
