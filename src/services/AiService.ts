import { invoke } from "@tauri-apps/api/tauri";

export type AiProvider = "anthropic" | "deepseek";
export type AiMode = "supervised" | "autonomous" | "agentic";

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
    AiMode:             AiMode;
}

export interface AiQuestionOption {
    Label: string;
    Description?: string;
}

export interface AiQuestion {
    Id: string;
    Question: string;
    Options: AiQuestionOption[];
}

export interface AiQuestionRequest {
    Id: string;
    Questions: AiQuestion[];
}

export interface AiQuestionAnswer {
    Id: string;
    Question: string;
    Choice: string;
    Message?: string | null;
}

export const AiService = {
    GetConfig: () =>
        invoke<{ anthropic_key_set: boolean; deepseek_key_set: boolean }>("ai_get_config").then(R => ({
            AnthropicKeySet: R.anthropic_key_set,
            DeepseekKeySet:  R.deepseek_key_set,
        })),

    LaunchKeyman: () => invoke<void>("ai_launch_keyman"),

    LaunchNyxCli: (Workspace: string | null) =>
        invoke<void>("ai_launch_nyx_cli", { workspace: Workspace }),

    GetAppSettings: () =>
        invoke<{ default_provider: string; obsidian_vault_path: string | null; ai_mode: string }>(
            "get_app_settings"
        ).then(R => ({
            DefaultProvider:   R.default_provider as AiProvider,
            ObsidianVaultPath: R.obsidian_vault_path,
            AiMode:            (R.ai_mode || "supervised") as AiMode,
        })),

    SaveAppSettings: async (S: Partial<AppSettings>) => {
        const Current = await AiService.GetAppSettings().catch(() => ({
            DefaultProvider:   "anthropic" as AiProvider,
            ObsidianVaultPath: null,
            AiMode:            "supervised" as AiMode,
        }));

        return invoke<void>("save_app_settings", {
            settings: {
                default_provider:    S.DefaultProvider ?? Current.DefaultProvider,
                obsidian_vault_path: S.ObsidianVaultPath !== undefined ? S.ObsidianVaultPath : Current.ObsidianVaultPath,
                ai_mode:             S.AiMode ?? Current.AiMode,
            },
        });
    },

    StartAgent: (
        Provider:  AiProvider,
        Messages:  AiMessage[],
        Workspace: string | null,
        Mode:      AiMode,
    ) =>
        invoke<void>("ai_start_agent", {
            provider:  Provider,
            messages:  Messages.map(M => ({ role: M.Role, content: M.Content })),
            workspace: Workspace,
            mode:      Mode,
        }),

    RespondToTool: (Approve: boolean) =>
        invoke<void>("ai_tool_respond", { approve: Approve }),

    RespondToQuestion: (Answers: AiQuestionAnswer[]) =>
        invoke<void>("ai_question_respond", { response: { Answers } }),
};
