type Listener = (Value: unknown) => void;

const _store: Record<string, unknown> = {};
const _listeners: Record<string, Set<Listener>> = {};
const _knownKeys = new Set<string>();

export const ClientState = {
    Init(Values: Record<string, unknown>): void {
        for (const [Key, Value] of Object.entries(Values)) {
            _knownKeys.add(Key);
            _store[Key] = Value;
            this._notify(Key, Value);
        }
    },

    Get(Key: string): unknown {
        if (!_knownKeys.has(Key)) {
            console.warn(`ClientState.Get: unknown key "${Key}"`);
            return undefined;
        }
        return _store[Key];
    },

    Set(Key: string, Value: unknown): void {
        if (!_knownKeys.has(Key)) {
            console.warn(`ClientState.Set: unknown key "${Key}"`);
            return;
        }
        _store[Key] = Value;
        this._notify(Key, Value);
    },

    Subscribe(Key: string, Callback: Listener): () => void {
        if (!_knownKeys.has(Key)) {
            console.warn(`ClientState.Subscribe: unknown key "${Key}"`);
            return () => {};
        }
        if (!_listeners[Key]) {
            _listeners[Key] = new Set();
        }
        _listeners[Key].add(Callback);
        return () => this.Unsubscribe(Key, Callback);
    },

    Unsubscribe(Key: string, Callback: Listener): void {
        const listeners = _listeners[Key];
        if (listeners) {
            listeners.delete(Callback);
        }
    },

    _notify(Key: string, Value: unknown): void {
        const listeners = _listeners[Key];
        if (listeners) {
            for (const L of listeners) {
                L(Value);
            }
        }
    },
};
