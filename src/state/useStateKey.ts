import { useState, useEffect } from "react";
import { ClientState } from "./ClientState";

export function useStateKey<T>(Key: string): T {
    const [Value, SetValue] = useState<T>(() => ClientState.Get(Key) as T);
    useEffect(() => ClientState.Subscribe(Key, v => SetValue(v as T)), [Key]);
    return Value;
}

export const UseStateKey = useStateKey;
