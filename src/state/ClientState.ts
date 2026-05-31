type Listener = (Value: unknown) => void;

const _store: Record<string, unknown> = {};
const _listeners: Record<string, Listener[]> = {};

export const ClientState = {
    Get(Key: string): unknown {
        return _store[Key];
    },

    Set(Key: string, Value: unknown): void {
        _store[Key] = Value;
        this._notify(Key, Value);
    },

    Subscribe(Key: string, Callback: Listener): void {
        if (!_listeners[Key]) {
            _listeners[Key] = [];
        }
        _listeners[Key].push(Callback);
    },

    Unsubscribe(Key: string, Callback: Listener): void {
        const listeners = _listeners[Key];
        if (listeners) {
            _listeners[Key] = listeners.filter((L) => L !== Callback);
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
