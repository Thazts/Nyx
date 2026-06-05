import { invoke } from "@tauri-apps/api/tauri";
import { StateManager } from "../state/StateManager";

interface BackendStateSnapshot {
    WorkspacePath: string | null;
    OpenFiles: string[];
    ActiveFile: string | null;
    TerminalOutput: string[];
    RunOutput: string[];
    IsRunning: boolean;
    SceneProfile: string | null;
    SelectedPartId: string | null;
    GizmoMode: string;
    ViewportVisible: boolean;
    AiActivity: string | null;
    AiPendingApproval: string | null;
}

export const StateService = {
    Init(): void {
        StateManager.init();
    },

    Set(Config: { Key: string; Value: unknown }): void {
        StateManager.set(Config.Key, Config.Value);
    },

    Get<T>(Config: { Key: string }): T {
        return StateManager.get(Config.Key) as T;
    },

    Patch(Config: { Key: string; SubKey: string; Value: unknown }): void {
        StateManager.setIn(Config.Key, Config.SubKey, Config.Value);
    },

    async SyncBackend(): Promise<void> {
        const Snapshot = await invoke<BackendStateSnapshot>("get_app_state_snapshot");
        this.Set({ Key: "WorkspacePath", Value: Snapshot.WorkspacePath });
        this.Set({ Key: "ActiveFile", Value: Snapshot.ActiveFile });
        this.Set({ Key: "TerminalOutput", Value: Snapshot.TerminalOutput });
        this.Set({ Key: "RunOutput", Value: Snapshot.RunOutput });
        this.Set({ Key: "IsRunning", Value: Snapshot.IsRunning });
        this.Set({ Key: "ViewportProfile", Value: Snapshot.SceneProfile });
        this.Set({ Key: "SelectedPartId", Value: Snapshot.SelectedPartId });
        this.Set({ Key: "GizmoMode", Value: Snapshot.GizmoMode });
        this.Set({ Key: "ViewportActive", Value: Snapshot.ViewportVisible });
        this.Set({ Key: "AiActivity", Value: Snapshot.AiActivity });
        this.Set({ Key: "AiPendingApproval", Value: Snapshot.AiPendingApproval });
    },
};
