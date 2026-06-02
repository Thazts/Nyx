import React, { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { AiService, AiMessage, AiProvider } from "../services/AiService";
import styles from "../styles/AiPanel.module.css";

type MsgItem      = { Kind: "message";   Role: "user" | "assistant"; Content: string };
type ToolItem     = { Kind: "tool_call"; Id: string; Name: string; Input: Record<string, unknown>; Status: "running" | "done" | "error"; Result?: string };
type ApprovalItem = { Kind: "approval";  Id: string; Name: string; Input: Record<string, unknown> };
type StreamItem   = MsgItem | ToolItem | ApprovalItem;

interface AiPanelProps {
    ActiveFile:  string | null;
    FileContent: string;
    Workspace:   string | null;
}

function FormatToolInput(_name: string, input: Record<string, unknown>): string {
    if (input.path)    return String(input.path);
    if (input.command) return String(input.command);
    if (input.pattern) return String(input.pattern);
    if (input.query)   return String(input.query);
    if (input.title)   return String(input.title);
    return Object.entries(input).map(([k, v]) => `${k}: ${v}`).join(", ");
}

function ToolIcon(name: string): string {
    if (name.includes("read"))    return "◎";
    if (name.includes("write"))   return "✎";
    if (name.includes("list"))    return "≡";
    if (name.includes("search"))  return "⌕";
    if (name.includes("command")) return "▶";
    if (name.includes("memory"))  return "◈";
    if (name.includes("obsidian")) return "◆";
    return "○";
}

export const AiPanel: React.FC<AiPanelProps> = ({ ActiveFile, Workspace }) => {
    const [Stream,      SetStream]    = useState<StreamItem[]>([]);
    const [ApiHistory,  SetApiHistory] = useState<AiMessage[]>([]);
    const [Input,       SetInput]     = useState("");
    const [Streaming,   SetStreaming] = useState(false);
    const [Provider,    SetProvider]  = useState<AiProvider>("anthropic");
    const [Mode,        SetMode]      = useState<"supervised" | "autonomous">("supervised");
    const [Config,      SetConfig]    = useState<{ AnthropicKeySet: boolean; DeepseekKeySet: boolean } | null>(null);
    const [Error,       SetError]     = useState<string | null>(null);

    const ScrollRef    = useRef<HTMLDivElement>(null);
    const AssistantBuf = useRef("");
    const UnsubsRef    = useRef<(() => void)[]>([]);

    useEffect(() => {
        AiService.GetConfig().then(SetConfig).catch(() => {});
        AiService.GetAppSettings().then(S => {
            SetProvider(S.DefaultProvider);
            SetMode(S.AiMode);
        }).catch(() => {});
        return () => UnsubsRef.current.forEach(fn => fn());
    }, []);

    useEffect(() => {
        if (ScrollRef.current) {
            ScrollRef.current.scrollTop = ScrollRef.current.scrollHeight;
        }
    }, [Stream]);

    const AvailableProviders: AiProvider[] = Config
        ? (["anthropic", "deepseek"] as AiProvider[]).filter(P =>
            P === "anthropic" ? Config.AnthropicKeySet : Config.DeepseekKeySet)
        : [];

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
        AssistantBuf.current = "";

        UnsubsRef.current.forEach(fn => fn());
        UnsubsRef.current = [];

        const unsubs: (() => void)[] = [];

        unsubs.push(await listen<string>("ai_token", E => {
            AssistantBuf.current += E.payload;
            const Buf = AssistantBuf.current;
            SetStream(Prev => {
                const Copy = [...Prev];
                for (let I = Copy.length - 1; I >= 0; I--) {
                    const Item = Copy[I];
                    if (Item.Kind === "message" && Item.Role === "assistant") {
                        Copy[I] = { Kind: "message", Role: "assistant", Content: Buf };
                        break;
                    }
                }
                return Copy;
            });
        }));

        unsubs.push(await listen<{ id: string; name: string; input: Record<string, unknown> }>("ai_tool_call", E => {
            SetStream(Prev => [...Prev, {
                Kind: "tool_call", Id: E.payload.id, Name: E.payload.name,
                Input: E.payload.input, Status: "running",
            }]);
        }));

        unsubs.push(await listen<{ id: string; name: string; result: string; error: boolean }>("ai_tool_result", E => {
            SetStream(Prev => Prev.map(Item =>
                Item.Kind === "tool_call" && Item.Id === E.payload.id
                    ? { ...Item, Status: E.payload.error ? "error" : "done", Result: E.payload.result }
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
            const FinalContent = AssistantBuf.current;
            if (FinalContent) {
                SetApiHistory([...NextHistory, { Role: "assistant", Content: FinalContent }]);
            } else {
                SetApiHistory(NextHistory);
            }
            AssistantBuf.current = "";
            SetStreaming(false);
            unsubs.forEach(fn => fn());
            UnsubsRef.current = [];
        }));

        unsubs.push(await listen<string>("ai_error", E => {
            SetError(E.payload);
            SetStreaming(false);
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
            AssistantBuf.current = "";
            unsubs.forEach(fn => fn());
            UnsubsRef.current = [];
        }));

        UnsubsRef.current = unsubs;

        AiService.StartAgent(Provider, NextHistory, Workspace, Mode).catch((Err: unknown) => {
            SetError(String(Err));
            SetStreaming(false);
            unsubs.forEach(fn => fn());
            UnsubsRef.current = [];
        });
    }, [Input, Streaming, ApiHistory, Provider, Mode, Workspace, AvailableProviders]);

    const HandleKeyDown = useCallback((E: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (E.key === "Enter" && !E.shiftKey) {
            E.preventDefault();
            HandleSend();
        }
    }, [HandleSend]);

    const HandleClear = useCallback(() => {
        UnsubsRef.current.forEach(fn => fn());
        UnsubsRef.current = [];
        AssistantBuf.current = "";
        SetStream([]);
        SetApiHistory([]);
        SetStreaming(false);
        SetError(null);
    }, []);

    const HandleApprove = useCallback((Approve: boolean) => {
        AiService.RespondToTool(Approve).catch(() => {});
    }, []);

    const HandleProviderChange = useCallback((P: AiProvider) => {
        SetProvider(P);
        AiService.GetAppSettings().then(S =>
            AiService.SaveAppSettings({ ...S, DefaultProvider: P })
        ).catch(() => {});
    }, []);

    const HandleModeToggle = useCallback(() => {
        const Next = Mode === "supervised" ? "autonomous" : "supervised";
        SetMode(Next);
        AiService.GetAppSettings().then(S =>
            AiService.SaveAppSettings({ ...S, AiMode: Next })
        ).catch(() => {});
    }, [Mode]);

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
                    className={`${styles.ModeBtn}${Mode === "autonomous" ? ` ${styles.ModeBtnAuto}` : ""}`}
                    onClick={HandleModeToggle}
                    title={Mode === "supervised" ? "Supervised: writes/commands need approval" : "Autonomous: AI executes all tools without asking"}
                >
                    {Mode === "supervised" ? "supervised" : "autonomous"}
                </button>

                {ActiveFile && (
                    <span className={styles.ContextBadge} title={ActiveFile}>
                        {ActiveFile.split(/[\\/]/).pop()}
                    </span>
                )}

                <button className={styles.ClearBtn} onClick={HandleClear} title="Clear conversation">
                    Clear
                </button>
            </div>

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
                                    <span className={styles.ToolName}>{Item.Name}</span>
                                    <span className={styles.ToolArg}>{FormatToolInput(Item.Name, Item.Input)}</span>
                                    <span className={styles.ToolStatus}>
                                        {Item.Status === "running" ? "…" : Item.Status === "done" ? "✓" : "✗"}
                                    </span>
                                </div>
                                {Item.Result && Item.Status !== "done" && (
                                    <div className={styles.ToolResult}>{Item.Result.slice(0, 120)}</div>
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
                    disabled={Streaming}
                />
                <button
                    className={`${styles.SendBtn}${Streaming ? ` ${styles.SendBtnBusy}` : ""}`}
                    onClick={HandleSend}
                    disabled={Streaming || !Input.trim()}
                >
                    {Streaming ? "…" : "↑"}
                </button>
            </div>
        </div>
    );
};
