const AppRegistryKey = {
    WorkspacePath: null,    // string | null
    ActiveFile:    null,    // string | null
    AppStatus:     "idle",  // "idle" | "loading" | "error"
    IsRunning:     false,
} as const;

const EditorRegistryKey = {
    TerminalOutput: [],  // string[]
    RunOutput:      [],  // string[]
    OpenTabs:       [],  // TabEntry[]
    FileTree:       [],  // FileEntry[]
} as const;

const RendererRegistryKey = {
    GizmoMode:      "move",  // "move" | "rotate" | "scale"
    SelectedPartId: null,    // string | null
    ViewportActive: false,   // boolean
} as const;

const APP_KEYS      = ["WorkspacePath", "ActiveFile", "AppStatus", "IsRunning"] as const;
const EDITOR_KEYS   = ["TerminalOutput", "RunOutput", "OpenTabs", "FileTree"] as const;
const RENDERER_KEYS = ["GizmoMode", "SelectedPartId", "ViewportActive"] as const;

const _keyMap: Record<string, Record<string, unknown>> = {};

for (const K of APP_KEYS)      _keyMap[K] = AppRegistryKey as unknown as Record<string, unknown>;
for (const K of EDITOR_KEYS)   _keyMap[K] = EditorRegistryKey as unknown as Record<string, unknown>;
for (const K of RENDERER_KEYS) _keyMap[K] = RendererRegistryKey as unknown as Record<string, unknown>;

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
    },
};
