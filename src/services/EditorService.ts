import { invoke } from "@tauri-apps/api/tauri";

export const EditorService = {
    async RunTerminalCommand(Config: { Command: string }): Promise<string[]> {
        return invoke<string[]>("run_terminal_command", { command: Config.Command });
    },
};
