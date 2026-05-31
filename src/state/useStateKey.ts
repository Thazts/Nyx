import { useState, useEffect } from "react";
import { StateManager } from "./StateManager";

export function useStateKey<T>(Key: string): T {
    const [Value, SetValue] = useState<T>(() => StateManager.get(Key) as T);
    useEffect(() => StateManager.subscribe(Key, v => SetValue(v as T)), [Key]);
    return Value;
}
