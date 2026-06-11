import { invoke } from "@tauri-apps/api/tauri";
import { SceneCommand } from "./EngineProfiles";

export interface RunSceneResult {
    Commands: SceneCommand[];
    Terminal: string[];
    Errors:   string[];
    Skipped?: boolean;
}

export const SceneService = {
    async RunScene(Config: { Path: string; Profile: string }): Promise<RunSceneResult> {
        return invoke<RunSceneResult>("run_scene", {
            path:    Config.Path,
            profile: Config.Profile,
        });
    },

    async StartLiveScene(Config: { Path: string; Profile: string }): Promise<void> {
        return invoke("start_live_scene", {
            path:    Config.Path,
            profile: Config.Profile,
        });
    },

    async StopLiveScene(Config: { Path?: string } = {}): Promise<void> {
        return invoke("stop_live_scene", { path: Config.Path ?? null });
    },
};
