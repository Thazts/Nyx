import { invoke } from "@tauri-apps/api/tauri";

export type AiProvider = "anthropic" | "deepseek";

export interface AiMessage {
    Role:    "user" | "assistant";
    Content: string;
}

export interface AiConfigStatus {
    AnthropicKeySet: boolean;
    DeepseekKeySet:  boolean;
}

export interface AppSettings {
    DefaultProvider:    AiProvider;
    ObsidianVaultPath:  string | null;
    AiMode:             "supervised" | "autonomous";
}

export const AiService = {
    GetConfig: () =>
        invoke<{ anthropic_key_set: boolean; deepseek_key_set: boolean }>("ai_get_config").then(R => ({
            AnthropicKeySet: R.anthropic_key_set,
            DeepseekKeySet:  R.deepseek_key_set,
        })),

    LaunchKeyman: () => invoke<void>("ai_launch_keyman"),

    GetAppSettings: () =>
        invoke<{ default_provider: string; obsidian_vault_path: string | null; ai_mode: string }>(
            "get_app_settings"
        ).then(R => ({
            DefaultProvider:   R.default_provider as AiProvider,
            ObsidianVaultPath: R.obsidian_vault_path,
            AiMode:            (R.ai_mode || "supervised") as "supervised" | "autonomous",
        })),

    SaveAppSettings: (S: Partial<AppSettings>) =>
        invoke<void>("save_app_settings", {
            settings: {
                default_provider:    S.DefaultProvider,
                obsidian_vault_path: S.ObsidianVaultPath ?? null,
                ai_mode:             S.AiMode ?? "supervised",
            },
        }),

    StartAgent: (
        Provider:  AiProvider,
        Messages:  AiMessage[],
        Workspace: string | null,
        Mode:      "supervised" | "autonomous",
    ) =>
        invoke<void>("ai_start_agent", {
            provider:  Provider,
            messages:  Messages.map(M => ({ role: M.Role, content: M.Content })),
            workspace: Workspace,
            mode:      Mode,
        }),

    RespondToTool: (Approve: boolean) =>
        invoke<void>("ai_tool_respond", { approve: Approve }),
};
