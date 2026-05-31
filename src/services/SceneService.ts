import { invoke } from "@tauri-apps/api/tauri";
import { SceneCommand } from "./EngineProfiles";

export interface RunSceneResult {
    Commands: SceneCommand[];
    Terminal: string[];
    Errors:   string[];
}

export const SceneService = {
    async RunScene(Config: { Path: string; Profile: string }): Promise<RunSceneResult> {
        return invoke<RunSceneResult>("run_scene", {
            path:    Config.Path,
            profile: Config.Profile,
        });
    },
};
