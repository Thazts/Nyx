import { invoke } from "@tauri-apps/api/tauri";
import { SceneCommand } from "./EngineProfiles";

export interface ModelLoadResult {
    Commands: SceneCommand[];
    Terminal: string[];
    Errors:   string[];
}

export const ModelService = {
    async LoadModelFile(Config: { Path: string }): Promise<ModelLoadResult> {
        return invoke<ModelLoadResult>("load_model_file", { path: Config.Path });
    },
};
