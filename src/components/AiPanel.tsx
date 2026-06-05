import React, { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { AiService, AiMessage, AiMode, AiProvider, AiQuestionRequest } from "../services/AiService";
import styles from "../styles/AiPanel.module.css";

type MsgItem      = { Kind: "message";   Role: "user" | "assistant"; Content: string };
type ToolItem     = { Kind: "tool_call"; Id: string; Name: string; Input: Record<string, unknown>; Status: "running" | "done" | "error"; Result?: string };
type ApprovalItem = { Kind: "approval";  Id: string; Name: string; Input: Record<string, unknown> };
type ChangeItem   = { Kind: "change"; Change: AiChangeEvent };
type QuestionItem = { Kind: "question"; Request: AiQuestionRequest; Status: "waiting" | "answered"; Result?: string };
type StreamItem   = MsgItem | ToolItem | ApprovalItem | ChangeItem | QuestionItem;

type QuestionDraft = {
    Choices: Record<string, string>;
    Messages: Record<string, string>;
};

interface AiActivityEvent {
    Kind: string;
    Label: string;
}

interface AiChangeEvent {
    Id: string;
    ToolCallId: string;
    Path: string;
    Kind: "create" | "edit" | "overwrite" | string;
    Status: "pending" | "applied" | "reverted" | "failed" | string;
    Before?: string;
    After?: string;
    Preview: {
        StartLine: number;
        Removed: number;
        Added: number;
        Lines: string[];
    };
}

interface AiPanelProps {
    ActiveFile:  string | null;
    FileContent: string;
    Workspace:   string | null;
    OnOpenFile:  (Path: string) => void | Promise<void>;
}

function FormatToolInput(_name: string, input: Record<string, unknown>): string {
    if (input.path)    return String(input.path);
    if (input.command) return String(input.command);
    if (input.pattern) return String(input.pattern);
    if (input.query)   return String(input.query);
    if (input.title)   return String(input.title);
    return Object.entries(input).map(([k, v]) => `${k}: ${v}`).join(", ");
}

function ToolActionLabel(name: string, input: Record<string, unknown>): string {
    const Path = input.path ? String(input.path) : "";
    const Command = input.command ? String(input.command) : "";
    const Query = input.pattern || input.query || input.title;

    switch (name) {
        case "read_file": return Path ? `Reading file ${Path}` : "Reading file";
        case "read_file_range": return Path ? `Reading lines from ${Path}` : "Reading file range";
        case "list_directory": return Path ? `Listing directory ${Path}` : "Listing directory";
        case "list_tree": return Path ? `Scanning tree ${Path}` : "Scanning project tree";
        case "find_files": return Query ? `Finding files for ${String(Query)}` : "Finding files";
        case "search_files": return Query ? `Searching files for ${String(Query)}` : "Searching files";
        case "grep": return Query ? `Grepping for ${String(Query)}` : "Grepping workspace";
        case "summarize_file": return Path ? `Summarizing file ${Path}` : "Summarizing file";
        case "write_file": return Path ? `Writing file ${Path}` : "Writing file";
        case "edit_file": return Path ? `Editing file ${Path}` : "Editing file";
        case "insert_after": return Path ? `Inserting into ${Path}` : "Inserting into file";
        case "insert_before": return Path ? `Inserting into ${Path}` : "Inserting into file";
        case "append_to_file": return Path ? `Appending to ${Path}` : "Appending to file";
        case "replace_range": return Path ? `Replacing lines in ${Path}` : "Replacing lines";
        case "remove_range": return Path ? `Removing lines from ${Path}` : "Removing lines";
        case "run_command": return Command ? `Running cmd: ${Command}` : "Running command";
        case "run_powershell": return Command ? `Running PowerShell: ${Command}` : "Running PowerShell";
        case "create_memory": return Query ? `Writing memory ${String(Query)}` : "Writing memory";
        case "list_memories": return "Listing memories";
        case "read_memory": return Query ? `Reading memory ${String(Query)}` : "Reading memory";
        case "read_obsidian": return Path ? `Reading note ${Path}` : "Reading note";
        case "search_obsidian": return Query ? `Searching notes for ${String(Query)}` : "Searching notes";
        case "write_obsidian": return Path ? `Writing note ${Path}` : "Writing note";
        default: return name.replace(/_/g, " ");
    }
}

function StatusLabel(status: ToolItem["Status"]): string {
    switch (status) {
        case "running": return "Running";
        case "done": return "Done";
        case "error": return "Failed";
    }
}

function ToolIcon(name: string): string {
    if (name.includes("read"))    return "◎";
    if (name.includes("edit"))    return "✎";
    if (name.includes("write"))   return "✎";
    if (name.includes("list"))    return "≡";
    if (name.includes("search"))  return "⌕";
    if (name.includes("command") || name.includes("powershell")) return "▶";
    if (name.includes("memory"))  return "◈";
    if (name.includes("obsidian")) return "◆";
    return "○";
}

function IsChangeTool(name: string): boolean {
    return name === "write_file"
        || name === "edit_file"
        || name === "insert_after"
        || name === "insert_before"
        || name === "append_to_file"
        || name === "replace_range"
        || name === "remove_range"
        || name === "write_obsidian";
}

const CHANGE_CARD_PREVIEW_LIMIT = 8;
const HISTORY_TEXT_LIMIT = 80000;
const HISTORY_TOOL_RESULT_LIMIT = 2000;
const CHAT_ABOUT_THIS = "Chat about this";
const AI_DISCLOSURE_KEY = "nyx_ai_disclosure_ack_v1";

function HasAcknowledgedAiDisclosure(): boolean {
    try {
        return localStorage.getItem(AI_DISCLOSURE_KEY) === "yes";
    } catch {
        return false;
    }
}

function AcknowledgeAiDisclosure(): void {
    try {
        localStorage.setItem(AI_DISCLOSURE_KEY, "yes");
    } catch {
    }
}

function ClipForHistory(value: string, limit = HISTORY_TEXT_LIMIT): string {
    if (value.length <= limit) return value;

    const head = Math.floor(limit * 0.55);
    const tail = Math.floor(limit * 0.35);
    const omitted = value.length - head - tail;
    return `${value.slice(0, head)}\n\n[...${omitted} characters omitted...]\n\n${value.slice(-tail)}`;
}

function JsonForHistory(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function ActionLogMessage(finalContent: string, entries: string[]): string {
    if (entries.length === 0) return finalContent;

    const body = [
        finalContent.trim(),
        "[Nyx session action log]",
        "This hidden log records tool actions and file snapshots from this assistant turn. Use it as conversation context for follow-up requests such as restore, undo, or continue.",
        ...entries,
    ].filter(Boolean).join("\n\n");

    return ClipForHistory(body, HISTORY_TEXT_LIMIT * 2);
}

function ChangeForHistory(change: AiChangeEvent): string {
    const preview = change.Preview.Lines.join("\n");
    const before = change.Before ?? "";
    const after = change.After ?? "";

    return [
        `file_change ${change.Id}`,
        `path: ${change.Path}`,
        `kind: ${change.Kind}`,
        `status: ${change.Status}`,
        `preview:\n${preview}`,
        `before_content:\n${ClipForHistory(before)}`,
        `after_content:\n${ClipForHistory(after)}`,
    ].join("\n");
}

function CountPreviewLines(result: string): number {
    return result.split("\n").filter(Line =>
        Line.startsWith("+ ") || Line.startsWith("- ") || Line.startsWith("change:") || Line.startsWith("...")
    ).length;
}

function RenderToolResult(name: string, result?: string, error?: boolean): React.ReactNode {
    if (!result) {
        return <div className={styles.ToolResultMuted}>Waiting for result...</div>;
    }
    if (!error && IsChangeTool(name)) {
        const Lines = result.split("\n");
        const Header = Lines[0] ?? "Changed";
        return (
            <div className={styles.ChangePreview}>
                <div className={styles.ChangeTitle}>{Header}</div>
                <div className={styles.ChangeMeta}>
                    Change preview is shown in the change card below.
                    {CountPreviewLines(result) > 0 ? ` ${CountPreviewLines(result)} preview line(s) available.` : ""}
                </div>
            </div>
        );
    }
    return <div className={styles.ToolResult}>{result.slice(0, 1200)}</div>;
}

export const AiPanel: React.FC<AiPanelProps> = ({ ActiveFile, Workspace, OnOpenFile }) => {
    const [Stream,      SetStream]    = useState<StreamItem[]>([]);
    const [ApiHistory,  SetApiHistory] = useState<AiMessage[]>([]);
    const [Input,       SetInput]     = useState("");
    const [Streaming,   SetStreaming] = useState(false);
    const [Provider,    SetProvider]  = useState<AiProvider>("anthropic");
    const [Mode,        SetMode]      = useState<AiMode>("supervised");
    const [Config,      SetConfig]    = useState<{ AnthropicKeySet: boolean; DeepseekKeySet: boolean } | null>(null);
    const [Error,       SetError]     = useState<string | null>(null);
    const [Activity,    SetActivity]  = useState<AiActivityEvent>({ Kind: "idle", Label: "Idle" });
    const [QuestionDrafts, SetQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
    const [DisclosureOpen, SetDisclosureOpen] = useState(() => !HasAcknowledgedAiDisclosure());

    const ScrollRef    = useRef<HTMLDivElement>(null);
    const AssistantRaw = useRef("");
    const AssistantVisible = useRef("");
    const TypeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const UnsubsRef    = useRef<(() => void)[]>([]);
    const TurnActionLogRef = useRef<string[]>([]);

    useEffect(() => {
        AiService.GetConfig().then(SetConfig).catch(() => {});
        AiService.GetAppSettings().then(S => {
            SetProvider(S.DefaultProvider);
            SetMode(S.AiMode);
        }).catch(() => {});
        return () => {
            UnsubsRef.current.forEach(fn => fn());
            if (TypeTimerRef.current) {
                clearInterval(TypeTimerRef.current);
                TypeTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (ScrollRef.current) {
            ScrollRef.current.scrollTop = ScrollRef.current.scrollHeight;
        }
    }, [Stream]);

    const SetAssistantMessage = useCallback((Content: string) => {
        SetStream(Prev => {
            const Copy = [...Prev];
            for (let I = Copy.length - 1; I >= 0; I--) {
                const Item = Copy[I];
                if (Item.Kind === "message" && Item.Role === "assistant") {
                    Copy[I] = { Kind: "message", Role: "assistant", Content };
                    break;
                }
            }
            return Copy;
        });
    }, []);

    const StopTypewriter = useCallback(() => {
        if (TypeTimerRef.current) {
            clearInterval(TypeTimerRef.current);
            TypeTimerRef.current = null;
        }
    }, []);

    const StartTypewriter = useCallback(() => {
        if (TypeTimerRef.current) return;
        TypeTimerRef.current = setInterval(() => {
            const Raw = AssistantRaw.current;
            const Visible = AssistantVisible.current;
            if (Visible.length >= Raw.length) return;

            const Remaining = Raw.length - Visible.length;
            const Step = Remaining > 320 ? 18 : Remaining > 120 ? 10 : 4;
            const Next = Raw.slice(0, Visible.length + Math.min(Remaining, Step));
            AssistantVisible.current = Next;
            SetAssistantMessage(Next);
        }, 24);
    }, [SetAssistantMessage]);

    const AvailableProviders: AiProvider[] = Config
        ? (["anthropic", "deepseek"] as AiProvider[]).filter(P =>
            P === "anthropic" ? Config.AnthropicKeySet : Config.DeepseekKeySet)
        : [];

    const HandleDisclosureAccept = useCallback(() => {
        AcknowledgeAiDisclosure();
        SetDisclosureOpen(false);
    }, []);

    const HandleSend = useCallback(async () => {
        const Text = Input.trim();
        if (!Text || Streaming) return;

        if (AvailableProviders.length === 0) {
            SetError("No API key configured. Use Settings → AI → Configure Keys.");
            return;
        }

        SetError(null);
        SetInput("");

        const UserMsg: AiMessage = { Role: "user", Content: Text };
        const NextHistory = [...ApiHistory, UserMsg];

        SetStream(Prev => [
            ...Prev,
            { Kind: "message", Role: "user",      Content: Text },
            { Kind: "message", Role: "assistant",  Content: "" },
        ]);
        SetStreaming(true);
        AssistantRaw.current = "";
        AssistantVisible.current = "";
        TurnActionLogRef.current = [];
        StopTypewriter();
        SetActivity({ Kind: "thinking", Label: "Thinking" });

        UnsubsRef.current.forEach(fn => fn());
        UnsubsRef.current = [];

        const unsubs: (() => void)[] = [];

        unsubs.push(await listen<AiActivityEvent>("ai_activity", E => {
            SetActivity(E.payload);
        }));

        unsubs.push(await listen<string>("ai_token", E => {
            AssistantRaw.current += E.payload;
            StartTypewriter();
        }));

        unsubs.push(await listen<{ id: string; name: string; input: Record<string, unknown> }>("ai_tool_call", E => {
            TurnActionLogRef.current.push(
                `tool_call ${E.payload.id}: ${E.payload.name} ${JsonForHistory(E.payload.input)}`
            );
            SetStream(Prev => [...Prev, {
                Kind: "tool_call", Id: E.payload.id, Name: E.payload.name,
                Input: E.payload.input, Status: "running",
            }]);
        }));

        unsubs.push(await listen<{ id: string; name: string; result: string; error: boolean }>("ai_tool_result", E => {
            TurnActionLogRef.current.push(
                `tool_result ${E.payload.id}: ${E.payload.name} ${E.payload.error ? "error" : "ok"}\n${ClipForHistory(E.payload.result, HISTORY_TOOL_RESULT_LIMIT)}`
            );
            SetStream(Prev => Prev.map(Item =>
                Item.Kind === "tool_call" && Item.Id === E.payload.id
                    ? { ...Item, Status: E.payload.error ? "error" : "done", Result: E.payload.result }
                    : Item
            ));
        }));

        unsubs.push(await listen<AiChangeEvent>("ai_change_applied", E => {
            TurnActionLogRef.current.push(ChangeForHistory(E.payload));
            SetStream(Prev => [...Prev, { Kind: "change", Change: E.payload }]);
        }));

        unsubs.push(await listen<AiQuestionRequest>("ai_question_request", E => {
            const Choices: Record<string, string> = {};
            for (const Question of E.payload.Questions) {
                Choices[Question.Id] = Question.Options[0]?.Label ?? CHAT_ABOUT_THIS;
            }
            SetQuestionDrafts(Prev => ({
                ...Prev,
                [E.payload.Id]: { Choices, Messages: {} },
            }));
            SetStream(Prev => [...Prev, {
                Kind: "question", Request: E.payload, Status: "waiting",
            }]);
        }));

        unsubs.push(await listen<{ Id: string; Result: string }>("ai_question_answered", E => {
            TurnActionLogRef.current.push(`question_answer ${E.payload.Id}\n${E.payload.Result}`);
            SetStream(Prev => Prev.map(Item =>
                Item.Kind === "question" && Item.Request.Id === E.payload.Id
                    ? { ...Item, Status: "answered", Result: E.payload.Result }
                    : Item
            ));
        }));

        unsubs.push(await listen<{ id: string; name: string; input: Record<string, unknown> }>("ai_tool_approval_needed", E => {
            SetStream(Prev => [...Prev, {
                Kind: "approval", Id: E.payload.id, Name: E.payload.name, Input: E.payload.input,
            }]);
        }));

        unsubs.push(await listen<string>("ai_tool_denied", E => {
            SetStream(Prev => Prev.map(Item => {
                if (Item.Kind !== "approval" || Item.Id !== E.payload) return Item;
                const Replaced: ToolItem = { Kind: "tool_call", Id: Item.Id, Name: Item.Name, Input: Item.Input, Status: "error", Result: "Denied by user" };
                return Replaced;
            }));
        }));

        unsubs.push(await listen<void>("ai_done", () => {
            const FinalContent = AssistantRaw.current;
            StopTypewriter();
            AssistantVisible.current = FinalContent;
            SetAssistantMessage(FinalContent);
            const HistoryContent = ActionLogMessage(FinalContent, TurnActionLogRef.current);
            if (HistoryContent) {
                SetApiHistory([...NextHistory, { Role: "assistant", Content: HistoryContent }]);
            } else {
                SetApiHistory(NextHistory);
            }
            AssistantRaw.current = "";
            AssistantVisible.current = "";
            TurnActionLogRef.current = [];
            SetStreaming(false);
            SetActivity({ Kind: "done", Label: "Done" });
            unsubs.forEach(fn => fn());
            UnsubsRef.current = [];
        }));

        unsubs.push(await listen<string>("ai_error", E => {
            SetError(E.payload);
            SetStreaming(false);
            StopTypewriter();
            SetStream(Prev => {
                const Copy = [...Prev];
                for (let I = Copy.length - 1; I >= 0; I--) {
                    const Item = Copy[I];
                    if (Item.Kind === "message" && Item.Role === "assistant" && !Item.Content) {
                        Copy.splice(I, 1);
                        break;
                    }
                }
                return Copy;
            });
            AssistantRaw.current = "";
            AssistantVisible.current = "";
            TurnActionLogRef.current = [];
            SetActivity({ Kind: "error", Label: "Error" });
            unsubs.forEach(fn => fn());
            UnsubsRef.current = [];
        }));

        UnsubsRef.current = unsubs;

        AiService.StartAgent(Provider, NextHistory, Workspace, Mode).catch((Err: unknown) => {
            SetError(String(Err));
            SetStreaming(false);
            StopTypewriter();
            unsubs.forEach(fn => fn());
            UnsubsRef.current = [];
        });
    }, [Input, Streaming, ApiHistory, Provider, Mode, Workspace, AvailableProviders, StartTypewriter, StopTypewriter, SetAssistantMessage]);

    const HandleKeyDown = useCallback((E: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (E.key === "Enter" && !E.shiftKey) {
            E.preventDefault();
            HandleSend();
        }
    }, [HandleSend]);

    const HandleClear = useCallback(() => {
        UnsubsRef.current.forEach(fn => fn());
        UnsubsRef.current = [];
        StopTypewriter();
        AssistantRaw.current = "";
        AssistantVisible.current = "";
        TurnActionLogRef.current = [];
        SetStream([]);
        SetApiHistory([]);
        SetQuestionDrafts({});
        SetStreaming(false);
        SetError(null);
        SetActivity({ Kind: "idle", Label: "Idle" });
    }, [StopTypewriter]);

    const HandleApprove = useCallback((Approve: boolean) => {
        AiService.RespondToTool(Approve).catch(() => {});
    }, []);

    const HandleQuestionChoice = useCallback((RequestId: string, QuestionId: string, Choice: string) => {
        SetQuestionDrafts(Prev => {
            const Draft = Prev[RequestId] ?? { Choices: {}, Messages: {} };
            return {
                ...Prev,
                [RequestId]: {
                    ...Draft,
                    Choices: { ...Draft.Choices, [QuestionId]: Choice },
                },
            };
        });
    }, []);

    const HandleQuestionMessage = useCallback((RequestId: string, QuestionId: string, Message: string) => {
        SetQuestionDrafts(Prev => {
            const Draft = Prev[RequestId] ?? { Choices: {}, Messages: {} };
            return {
                ...Prev,
                [RequestId]: {
                    ...Draft,
                    Messages: { ...Draft.Messages, [QuestionId]: Message },
                },
            };
        });
    }, []);

    const HandleQuestionSubmit = useCallback((Request: AiQuestionRequest) => {
        const Draft = QuestionDrafts[Request.Id];
        if (!Draft) return;

        const Answers = Request.Questions.map(Question => {
            const Choice = Draft.Choices[Question.Id] || Question.Options[0]?.Label || CHAT_ABOUT_THIS;
            const Message = Draft.Messages[Question.Id]?.trim();
            return {
                Id: Question.Id,
                Question: Question.Question,
                Choice,
                Message: Message || null,
            };
        });

        AiService.RespondToQuestion(Answers).catch((Err: unknown) => {
            SetError(String(Err));
        });
    }, [QuestionDrafts]);

    const HandleProviderChange = useCallback((P: AiProvider) => {
        SetProvider(P);
        AiService.GetAppSettings().then(S =>
            AiService.SaveAppSettings({ ...S, DefaultProvider: P })
        ).catch(() => {});
    }, []);

    const HandleModeToggle = useCallback(() => {
        const Next: AiMode =
            Mode === "supervised" ? "autonomous" :
            Mode === "autonomous" ? "agentic" :
            "supervised";
        SetMode(Next);
        AiService.GetAppSettings().then(S =>
            AiService.SaveAppSettings({ ...S, AiMode: Next })
        ).catch(() => {});
    }, [Mode]);

    const HandleOpenNyxCli = useCallback(() => {
        AiService.LaunchNyxCli(Workspace).catch((Err: unknown) => {
            SetError(String(Err));
        });
    }, [Workspace]);

    const HandleOpenChange = useCallback((Path: string) => {
        Promise.resolve(OnOpenFile(Path)).catch((Err: unknown) => {
            SetError(String(Err));
        });
    }, [OnOpenFile]);

    const NoKey = Config !== null && AvailableProviders.length === 0;

    return (
        <div className={styles.Panel}>
            <div className={styles.Toolbar}>
                <div className={styles.ProviderGroup}>
                    {(["anthropic", "deepseek"] as AiProvider[]).map(P => {
                        const HasKey = P === "anthropic" ? Config?.AnthropicKeySet : Config?.DeepseekKeySet;
                        return (
                            <button
                                key={P}
                                className={`${styles.ProviderBtn}${Provider === P ? ` ${styles.ProviderBtnActive}` : ""}${!HasKey ? ` ${styles.ProviderBtnDim}` : ""}`}
                                onClick={() => HandleProviderChange(P)}
                                title={!HasKey ? `No ${P} key configured` : undefined}
                            >
                                {P === "anthropic" ? "Anthropic" : "DeepSeek"}
                            </button>
                        );
                    })}
                </div>

                <button
                    className={`${styles.ModeBtn}${Mode !== "supervised" ? ` ${styles.ModeBtnAuto}` : ""}`}
                    onClick={HandleModeToggle}
                    title={
                        Mode === "supervised" ? "Supervised: writes/commands need approval" :
                        Mode === "autonomous" ? "Autonomous: AI executes all tools without asking" :
                        "Agentic: autonomous execution with sliced planning and memory checkpoints"
                    }
                >
                    {Mode}
                </button>

                {ActiveFile && (
                    <span className={styles.ContextBadge} title={ActiveFile}>
                        {ActiveFile.split(/[\\/]/).pop()}
                    </span>
                )}

                <button className={styles.CliBtn} onClick={HandleOpenNyxCli} title="Open in NyxCli">
                    NyxCli
                </button>

                <button className={styles.CliBtn} onClick={() => SetDisclosureOpen(true)} title="Review AI disclosure">
                    Safety
                </button>

                <button className={styles.ClearBtn} onClick={HandleClear} title="Clear conversation">
                    Clear
                </button>
            </div>

            <div className={`${styles.ActivityStrip} ${Streaming ? styles.ActivityStripActive : ""}`}>
                <span className={styles.ActivityDot} />
                <span className={styles.ActivityLabel}>{Streaming ? Activity.Label : "Ready"}</span>
            </div>

            {DisclosureOpen && (
                <div className={styles.DisclosureBackdrop}>
                    <div className={styles.DisclosureDialog} role="dialog" aria-modal="true" aria-labelledby="ai-disclosure-title">
                        <div className={styles.DisclosureKicker}>Before you use AI</div>
                        <div id="ai-disclosure-title" className={styles.DisclosureTitle}>Know what Nyx AI can do</div>
                        <div className={styles.DisclosureBody}>
                            <p>
                                Nyx does <span className={styles.DisclosureHot}>not</span> host or proxy the AI. Your configured
                                provider receives the <span className={styles.DisclosureAccent}>prompt</span>, conversation context,
                                and tool results needed to answer.
                            </p>
                            <p>
                                The agent can <span className={styles.DisclosureAccent}>read and search</span> your workspace,
                                inspect files, <span className={styles.DisclosureHot}>edit files</span>, run shell or PowerShell
                                commands, use configured notes and memory, and ask clarifying questions.
                            </p>
                            <p>
                                Supervised mode asks before writes and commands. Autonomous and agentic modes can execute allowed actions
                                <span className={styles.DisclosureHot}> without</span> those approval prompts.
                                <span className={styles.DisclosureWarn}> Do not paste secrets</span> unless you intend to send them
                                to the selected provider.
                            </p>
                            <p>
                                Nyx tries to protect against <span className={styles.DisclosureAccent}>prompt injection</span> in tool
                                results and workspace content, but that is <span className={styles.DisclosureHot}>not</span> verification
                                that every action is safe. Review risky edits, commands, and unexpected instructions before proceeding.
                            </p>
                        </div>
                        <div className={styles.DisclosureActions}>
                            <button className={styles.DisclosurePrimary} onClick={HandleDisclosureAccept}>
                                I understand
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className={styles.Messages} ref={ScrollRef}>
                {Stream.length === 0 && (
                    <div className={styles.Empty}>
                        {NoKey
                            ? "Configure a key via Settings → AI → Configure Keys."
                            : "Ask anything. The agent can read files, search code, write notes, and more."}
                    </div>
                )}

                {Stream.map((Item, I) => {
                    if (Item.Kind === "message") {
                        return (
                            <div key={I} className={`${styles.Message} ${Item.Role === "user" ? styles.MessageUser : styles.MessageAssistant}`}>
                                <div className={styles.MessageBubble}>
                                    {Item.Content || (Streaming && I === Stream.length - 1
                                        ? <span className={styles.Thinking}>▋</span>
                                        : "")}
                                </div>
                            </div>
                        );
                    }

                    if (Item.Kind === "tool_call") {
                        return (
                            <div key={I} className={`${styles.ToolCard} ${Item.Status === "error" ? styles.ToolCardError : Item.Status === "done" ? styles.ToolCardDone : styles.ToolCardRunning}`}>
                                <div className={styles.ToolCardHeader}>
                                    <span className={styles.ToolIcon}>{ToolIcon(Item.Name)}</span>
                                    <span className={styles.ToolAction}>{ToolActionLabel(Item.Name, Item.Input) || "Running action"}</span>
                                    <span className={styles.ToolName}>{Item.Name}</span>
                                    <span className={styles.ToolStatus}>{StatusLabel(Item.Status)}</span>
                                </div>
                                {RenderToolResult(Item.Name, Item.Result, Item.Status === "error")}
                            </div>
                        );
                    }

                    if (Item.Kind === "change") {
                        return (
                            <div key={I} className={styles.AiChangeCard}>
                                <div className={styles.AiChangeHeader}>
                                    <span className={styles.AiChangeStatus}>{Item.Change.Status}</span>
                                    <span className={styles.AiChangePath}>{Item.Change.Path}</span>
                                    <span className={styles.AiChangeKind}>{Item.Change.Kind}</span>
                                    <button
                                        className={styles.AiChangeOpen}
                                        onClick={() => HandleOpenChange(Item.Change.Path)}
                                        title="Open changed file"
                                    >
                                        Open
                                    </button>
                                </div>
                                <div className={styles.AiChangeMeta}>
                                    line {Item.Change.Preview.StartLine} | -{Item.Change.Preview.Removed} +{Item.Change.Preview.Added}
                                </div>
                                <div className={styles.AiChangePreview}>
                                    {Item.Change.Preview.Lines.slice(0, CHANGE_CARD_PREVIEW_LIMIT).map((Line, LineIndex) => (
                                        <div
                                            key={LineIndex}
                                            className={
                                                Line.startsWith("+ ") ? styles.ChangeAdd :
                                                Line.startsWith("- ") ? styles.ChangeRemove :
                                                styles.ChangeMeta
                                            }
                                        >
                                            {Line}
                                        </div>
                                    ))}
                                    {Item.Change.Preview.Lines.length > CHANGE_CARD_PREVIEW_LIMIT && (
                                        <div className={styles.ChangeMeta}>
                                            [+{Item.Change.Preview.Lines.length - CHANGE_CARD_PREVIEW_LIMIT} more lines]
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    }

                    if (Item.Kind === "question") {
                        const Draft = QuestionDrafts[Item.Request.Id];
                        const Waiting = Item.Status === "waiting";
                        return (
                            <div key={I} className={styles.QuestionCard}>
                                <div className={styles.QuestionHeader}>
                                    <span className={styles.QuestionTitle}>Clarification needed</span>
                                    <span className={styles.QuestionStatus}>{Item.Status}</span>
                                </div>
                                {Item.Request.Questions.map(Question => {
                                    const Choice = Draft?.Choices[Question.Id] || Question.Options[0]?.Label || CHAT_ABOUT_THIS;
                                    const IsChat = Choice.toLowerCase() === CHAT_ABOUT_THIS.toLowerCase();
                                    return (
                                        <div key={Question.Id} className={styles.QuestionBlock}>
                                            <div className={styles.QuestionText}>{Question.Question}</div>
                                            <div className={styles.QuestionOptions}>
                                                {Question.Options.map(Option => (
                                                    <button
                                                        key={Option.Label}
                                                        className={`${styles.QuestionOption}${Choice === Option.Label ? ` ${styles.QuestionOptionActive}` : ""}`}
                                                        onClick={() => HandleQuestionChoice(Item.Request.Id, Question.Id, Option.Label)}
                                                        disabled={!Waiting}
                                                        title={Option.Description || undefined}
                                                    >
                                                        <span>{Option.Label}</span>
                                                        {Option.Description && <small>{Option.Description}</small>}
                                                    </button>
                                                ))}
                                            </div>
                                            {IsChat && Waiting && (
                                                <textarea
                                                    className={styles.QuestionChatInput}
                                                    value={Draft?.Messages[Question.Id] ?? ""}
                                                    onChange={E => HandleQuestionMessage(Item.Request.Id, Question.Id, E.target.value)}
                                                    placeholder="Add context for this question"
                                                    rows={2}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                                {Waiting ? (
                                    <button
                                        className={styles.QuestionSubmit}
                                        onClick={() => HandleQuestionSubmit(Item.Request)}
                                        disabled={!Draft}
                                    >
                                        Submit answers
                                    </button>
                                ) : (
                                    <div className={styles.QuestionResult}>{Item.Result}</div>
                                )}
                            </div>
                        );
                    }

                    if (Item.Kind === "approval") {
                        return (
                            <div key={I} className={styles.ApprovalCard}>
                                <div className={styles.ApprovalText}>
                                    <span className={styles.ToolIcon}>{ToolIcon(Item.Name)}</span>
                                    <span>AI wants to run <strong>{Item.Name}</strong></span>
                                    <span className={styles.ToolArg}>{FormatToolInput(Item.Name, Item.Input)}</span>
                                </div>
                                <div className={styles.ApprovalActions}>
                                    <button className={styles.ApproveBtn} onClick={() => HandleApprove(true)}>Allow</button>
                                    <button className={styles.DenyBtn}    onClick={() => HandleApprove(false)}>Deny</button>
                                </div>
                            </div>
                        );
                    }

                    return null;
                })}

                {Error && <div className={styles.ErrorRow}>{Error}</div>}
            </div>

            <div className={styles.InputRow}>
                <textarea
                    className={styles.Input}
                    value={Input}
                    onChange={E => SetInput(E.target.value)}
                    onKeyDown={HandleKeyDown}
                    placeholder="Ask something… (Enter to send, Shift+Enter for newline)"
                    rows={1}
                    disabled={Streaming || DisclosureOpen}
                />
                <button
                    className={`${styles.SendBtn}${Streaming ? ` ${styles.SendBtnBusy}` : ""}`}
                    onClick={HandleSend}
                    disabled={Streaming || DisclosureOpen || !Input.trim()}
                >
                    {Streaming ? "…" : "↑"}
                </button>
            </div>
        </div>
    );
};
