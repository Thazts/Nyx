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

    async RunLiveScene(Config: { Path: string; Profile: string; Elapsed: number }): Promise<RunSceneResult> {
        return invoke<RunSceneResult>("run_live_scene", {
            path:    Config.Path,
            profile: Config.Profile,
            elapsed: Config.Elapsed,
        });
    },
};
