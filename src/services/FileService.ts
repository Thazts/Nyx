import { invoke } from "@tauri-apps/api/tauri";

export const FileService = {
    async ListFiles(Config: { Path: string }): Promise<string[]> {
        return invoke<string[]>("list_files", { path: Config.Path });
    },

    async ListFilesRecursive(Config: { Path: string }): Promise<string[]> {
        return invoke<string[]>("list_files_recursive", { path: Config.Path });
    },

    async OpenFile(Config: { Path: string }): Promise<string> {
        return invoke<string>("open_file", { path: Config.Path });
    },

    async SaveFile(Config: { Path: string; Content: string }): Promise<void> {
        await invoke<void>("save_file", { path: Config.Path, content: Config.Content });
    },

    async SelectFolder(): Promise<string> {
        return invoke<string>("select_folder");
    },

    async GetFileMetadata(Config: { Path: string }): Promise<{ Size: number; Modified: string }> {
        const Result = await invoke<{ size: number; modified: string }>("get_file_metadata", { path: Config.Path });
        return { Size: Result.size, Modified: Result.modified };
    },

    async DeletePath(Config: { Path: string }): Promise<void> {
        return invoke("delete_path", { path: Config.Path });
    },

    async RenamePath(Config: { Path: string; NewName: string }): Promise<string> {
        return invoke<string>("rename_path", { path: Config.Path, newName: Config.NewName });
    },

    async CreateFolder(Config: { Path: string }): Promise<void> {
        return invoke("create_folder", { path: Config.Path });
    },
};
