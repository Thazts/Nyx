import { invoke } from "@tauri-apps/api/tauri";

export interface SystemStats {
    cpu_usage:         number;
    memory_used_mb:    number;
    memory_total_mb:   number;
    process_memory_mb: number;
}

export const SystemService = {
    async GetStats(): Promise<SystemStats> {
        return invoke<SystemStats>("get_system_stats");
    },
};
