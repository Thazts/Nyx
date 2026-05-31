import { invoke } from "@tauri-apps/api/tauri";

export const RunService = {
    async RunFile(Config: { Path: string }): Promise<string[]> {
        return await invoke<string[]>("run_file", { path: Config.Path });
    },
};
