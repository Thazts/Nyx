import { invoke } from "@tauri-apps/api/tauri";

export const CaptureService = {
    async Run(Command: string, Cwd: string): Promise<string[]> {
        return await invoke<string[]>("capture_command", { command: Command, cwd: Cwd });
    },
};
