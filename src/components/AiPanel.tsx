import React, { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { AiService, AiMessage, AiMode, AiProvider, AiQuestionRequest } from "../services/AiService";
import { StateManager } from "../state/StateManager";
import { useStateKey } from "../state/useStateKey";
import styles from "../styles/AiPanel.module.css";

type MsgItem        = { Kind: "message";    Id: string; Role: "user" | "assistant"; Content: string };
type ToolItem       = { Kind: "tool_call";  Id: string; Name: string; Input: Record<string, unknown>; Status: "running" | "done" | "error"; Result?: string; Expanded: boolean };
type ApprovalItem   = { Kind: "approval";   Id: string; Name: string; Input: Record<string, unknown> };
type ChangeItem     = { Kind: "change"; Change: AiChangeEvent };
type QuestionItem   = { Kind: "question";   Request: AiQuestionRequest; Status: "waiting" | "answered"; Result?: string };
type RateLimitItem  = { Kind: "rate_limit"; Id: string; SecondsLeft: number; TotalSeconds: number; AutoContinue: boolean; Ticking: boolean; Resolved: boolean };
type StreamItem     = MsgItem | ToolItem | ApprovalItem | ChangeItem | QuestionItem | RateLimitItem;
type TaskStatus   = "pending" | "active" | "done";
type TaskStep     = { Label: string; Status: TaskStatus };
type TaskSliceStatus = "active" | "replanned" | "blocked" | "complete";
type TaskSlice = { Id: string; Status: TaskSliceStatus; Reason?: string; Steps: TaskStep[] };

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

function RateLimitClock({ SecondsLeft, TotalSeconds }: { SecondsLeft: number; TotalSeconds: number }) {
    const R = 20;
    const Circumference = 2 * Math.PI * R;
    const DashOffset = Circumference * (1 - SecondsLeft / TotalSeconds);
    const HandAngle = (TotalSeconds - SecondsLeft) * (360 / TotalSeconds);
    return (
        <svg width="52" height="52" viewBox="0 0 52 52" className={styles.RateLimitClockSvg}>
            <circle cx="26" cy="26" r={R} fill="none" stroke="var(--brd)" strokeWidth="2.5" />
            <circle
                cx="26" cy="26" r={R} fill="none"
                stroke="var(--acc)" strokeWidth="2.5"
                strokeDasharray={Circumference}
                strokeDashoffset={DashOffset}
                strokeLinecap="round"
                transform="rotate(-90 26 26)"
                style={{ transition: "stroke-dashoffset 0.55s cubic-bezier(0.34,1.56,0.64,1)" }}
            />
            <line
                x1="26" y1="26" x2="26" y2="9"
                stroke="var(--acc)" strokeWidth="2" strokeLinecap="round"
                style={{
                    transformOrigin: "26px 26px",
                    transform: `rotate(${HandAngle}deg)`,
                    transition: "transform 0.55s cubic-bezier(0.34,1.56,0.64,1)",
                }}
            />
            <circle cx="26" cy="26" r="2.5" fill="var(--acc)" />
            <text x="26" y="44" textAnchor="middle" fill="var(--txt3)" fontSize="8" fontWeight="600" fontFamily="inherit">
                {SecondsLeft}s
            </text>
        </svg>
    );
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
        case "search_memories": return Query ? `Searching memories for ${String(Query)}` : "Searching memories";
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

type SkillId = "fengshui_protocol" | "self_help" | "lua_luau" | "viewport_manual" | "security_review";
type SkillDefinition = {
    Id: SkillId;
    Label: string;
    Classification: 1 | 2 | 3;
    Hidden: boolean;
    Description: string;
};

const AVAILABLE_SKILLS: readonly SkillDefinition[] = [
    { Id: "fengshui_protocol", Label: "FengshuiProtocol", Classification: 2 as const, Hidden: false, Description: "Advanced frontend design and visual composition protocol" },
    { Id: "self_help",         Label: "SelfHelp",         Classification: 2 as const, Hidden: false, Description: "Nyx project knowledge: design decisions, tech choices, and how to get help" },
    { Id: "lua_luau",          Label: "Lua/Luau",         Classification: 2 as const, Hidden: false, Description: "Lua and Luau language reference including Roblox development patterns" },
    { Id: "viewport_manual",   Label: "ViewportManual",   Classification: 2 as const, Hidden: true,  Description: "Nyx viewport manual; auto-activates on viewport topics" },
    { Id: "security_review",   Label: "SecurityReview",   Classification: 2 as const, Hidden: false, Description: "Adversarial what-if security review: attack code/designs to surface vulnerabilities and harden trust boundaries" },
] as const;

const SKILL_INTENT_PATTERNS: Partial<Record<SkillId, RegExp>> = {
    fengshui_protocol: /\b(css|styles?|layout|design|ui|component|colou?r|button|flex|grid|padding|margin|border|shadow|animation|font|typography|theme|dark\s*mode|light\s*mode|responsive|hover|gradient|radius|spacing|visual|appearance|look|aesthetic|card|panel|sidebar|toolbar|icon|badge|chip|modal|tooltip|navbar|header|footer)\b/i,
    lua_luau:          /\b(lua|luau|roblox|rbx|script|localscript|modulescript|remotevent|remotefunc|bindable|datastore|workspace|runservice|heartbeat|humanoid|basepart|instance|require|pcall|coroutine|metatab|__index|__newindex|ipairs|pairs|tostring|tonumber)\b/i,
    self_help:         /\b(what\s+is\s+nyx|how\s+does\s+nyx|nyx\s+(ide|app|project)|timmy|thazts|tech\s+stack|why\s+(tauri|wgpu|rust|react)|report\s+(bug|issue)|github\.com\/thazts|architecture|technology\s+choice|how\s+do\s+i\s+(get\s+help|report|configure))\b/i,
    viewport_manual:   /\b(viewport|open_viewport|3d\s+scene|physics\s+profile|roblox_physics|unity_physics|unreal_physics|scene\s+file|\.luau|engine\s+mode|engine\s+target|wgpu\s+render|nyx\s+scene)\b/i,
};

const CHANGE_CARD_PREVIEW_LIMIT = 8;
const HISTORY_TEXT_LIMIT = 80000;
const HISTORY_TOOL_RESULT_LIMIT = 2000;
const CHAT_ABOUT_THIS = "Chat about this";
const AI_DISCLOSURE_KEY = "nyx_ai_disclosure_ack_v1";
const AGENTIC_UI_INSTRUCTION = [
    "[Nyx UI coordination]",
    "Create one plan for the user's full request, then execute it in slices of four consecutive plan steps.",
    "Report checklist state only with this exact protocol:",
    "[NYX_SLICE id=1 status=active]",
    "- [-] First step label",
    "- [ ] Second step label",
    "- [ ] Third step label",
    "- [ ] Fourth step label",
    "[/NYX_SLICE]",
    "Valid status values are active, complete, blocked, and replanned.",
    "For blocked or replanned, include a quoted reason attribute, for example status=replanned reason=\"Discovery changed the next useful action\".",
    "For the same slice id, keep labels stable and update only checkbox states unless status=replanned has a reason.",
    "Do not replace card 1 with the next task. Move the active marker to card 2, 3, then 4. Start a new slice id only after the previous four are complete, blocked, or explicitly replanned.",
    "After completing each meaningful step, call create_memory. The UI uses that checkpoint to mark the active card done and move to the next card.",
].join("\n");

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

function CleanTaskLabel(value: string): string {
    return value
        .replace(/\s+/g, " ")
        .replace(/^\*\*(.+)\*\*$/, "$1")
        .replace(/^__(.+)__$/, "$1")
        .replace(/[.:-]\s*$/, "")
        .trim()
        .slice(0, 72);
}

function SliceSignature(slice: TaskSlice | null): string {
    if (!slice) return "";
    return [
        slice.Id,
        slice.Status,
        slice.Reason ?? "",
        ...slice.Steps.map(Step => `${Step.Status}:${Step.Label}`),
    ].join("|");
}

function TaskSliceStepSummary(slice: TaskSlice): string {
    if (slice.Status === "complete") return "Complete";
    if (slice.Status === "blocked") return "Blocked";
    if (slice.Status === "replanned") return "Replanned";

    const ActiveIndex = slice.Steps.findIndex(Step => Step.Status === "active");
    if (ActiveIndex >= 0) return `Step ${ActiveIndex + 1} of ${slice.Steps.length}`;

    const DoneCount = slice.Steps.filter(Step => Step.Status === "done").length;
    return `${DoneCount} of ${slice.Steps.length}`;
}

function TaskLabelsChanged(a: TaskSlice, b: TaskSlice): boolean {
    return a.Steps.some((Step, Index) => Step.Label !== b.Steps[Index]?.Label);
}

function ParseTaskStatus(value: string): TaskStatus {
    const Status = value.trim().toLowerCase();
    if (Status === "x" || Status === "done" || Status === "complete" || Status === "completed") {
        return "done";
    }
    if (Status === "-" || Status === "~" || Status === "active" || Status === "now" || Status === "current") {
        return "active";
    }
    return "pending";
}

function ParseSliceStatus(value: string | undefined): TaskSliceStatus | null {
    switch ((value ?? "").trim().toLowerCase()) {
        case "active": return "active";
        case "replanned": return "replanned";
        case "blocked": return "blocked";
        case "complete": return "complete";
        default: return null;
    }
}

function ParseSliceAttributes(value: string): Record<string, string> {
    const Result: Record<string, string> = {};
    const Re = /(\w+)=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s\]]+)/g;
    let Match: RegExpExecArray | null;
    while ((Match = Re.exec(value)) !== null) {
        const Key = Match[1].toLowerCase();
        let Raw = Match[2].trim();
        if ((Raw.startsWith("\"") && Raw.endsWith("\"")) || (Raw.startsWith("'") && Raw.endsWith("'"))) {
            Raw = Raw.slice(1, -1).replace(/\\"/g, "\"").replace(/\\'/g, "'");
        }
        Result[Key] = Raw;
    }
    return Result;
}

function ExtractSliceSteps(content: string, Lenient = false): TaskStep[] | null {
    const Steps: TaskStep[] = [];
    for (const Line of content.split(/\r?\n/)) {
        const Checkbox = Line.match(/^\s*(?:[-*]\s*|\d+[\).]\s*)?\[([^\]]*)\]\s+(.+)$/);
        if (!Checkbox) continue;

        const Label = CleanTaskLabel(Checkbox[2]);
        if (!Label) continue;

        Steps.push({
            Label,
            Status: ParseTaskStatus(Checkbox[1]),
        });
    }

    if (Lenient) return Steps.length > 0 ? Steps : null;
    return Steps.length === 4 ? Steps : null;
}

function ExtractTaskSlice(content: string): TaskSlice | null {
    const Blocks: TaskSlice[] = [];
    const Re = /\[NYX_SLICE([^\]]*)\]([\s\S]*?)\[\/NYX_SLICE\]/gi;
    let Match: RegExpExecArray | null;

    while ((Match = Re.exec(content)) !== null) {
        const Attrs = ParseSliceAttributes(Match[1]);
        const Id = Attrs.id?.trim();
        const Status = ParseSliceStatus(Attrs.status);
        const Reason = Attrs.reason?.trim();
        const Steps = ExtractSliceSteps(Match[2]);

        if (!Id || !Status || !Steps) continue;
        if ((Status === "blocked" || Status === "replanned") && !Reason) continue;

        Blocks.push({
            Id,
            Status,
            Reason: Reason || undefined,
            Steps,
        });
    }

    const LastClose = content.lastIndexOf("[/NYX_SLICE]");
    const LastOpen  = content.lastIndexOf("[NYX_SLICE");
    if (LastOpen > LastClose) {
        const Partial = /\[NYX_SLICE([^\]]*)\]([\s\S]*)$/.exec(content.slice(LastOpen));
        if (Partial) {
            const Attrs  = ParseSliceAttributes(Partial[1]);
            const Id     = Attrs.id?.trim();
            const Status = ParseSliceStatus(Attrs.status);
            const Reason = Attrs.reason?.trim();
            const Steps  = ExtractSliceSteps(Partial[2], true);

            const ReasonRequired = Status === "blocked" || Status === "replanned";
            if (Id && Status && Steps && (!ReasonRequired || Reason)) {
                return { Id, Status, Reason: Reason || undefined, Steps };
            }
        }
    }

    return Blocks.length > 0 ? Blocks[Blocks.length - 1] : null;
}

function ReconcileTaskSlice(next: TaskSlice, current: TaskSlice | null): TaskSlice {
    const NextSlice = next.Status === "complete"
        ? { ...next, Steps: next.Steps.map(Step => ({ ...Step, Status: "done" as TaskStatus })) }
        : next;

    if (!current || current.Id !== NextSlice.Id || NextSlice.Status === "replanned") {
        return NextSlice;
    }

    if (current.Status === "complete" && NextSlice.Status === "active" && TaskLabelsChanged(current, NextSlice)) {
        return NextSlice;
    }

    return {
        ...NextSlice,
        Steps: current.Steps.map((Step, Index) => ({
            ...Step,
            Status: MergeTaskStatus(Step.Status, NextSlice.Steps[Index]?.Status ?? Step.Status),
        })),
    };
}

function TaskStatusRank(status: TaskStatus): number {
    switch (status) {
        case "pending": return 0;
        case "active": return 1;
        case "done": return 2;
    }
}

function MergeTaskStatus(current: TaskStatus, next: TaskStatus): TaskStatus {
    return TaskStatusRank(next) > TaskStatusRank(current) ? next : current;
}

function AdvanceTaskSliceFromCheckpointValue(slice: TaskSlice | null): TaskSlice | null {
    if (!slice || slice.Status !== "active") return null;

    const ActiveIndex = slice.Steps.findIndex(Step => Step.Status === "active");
    const StepIndex = ActiveIndex >= 0
        ? ActiveIndex
        : slice.Steps.findIndex(Step => Step.Status === "pending");

    if (StepIndex < 0) {
        return {
            ...slice,
            Status: "complete",
            Reason: undefined,
            Steps: slice.Steps.map(Step => ({ ...Step, Status: "done" })),
        };
    }

    const NextPendingIndex = slice.Steps.findIndex((Step, Index) =>
        Index > StepIndex && Step.Status !== "done"
    );

    return {
        ...slice,
        Status: NextPendingIndex >= 0 ? "active" : "complete",
        Reason: undefined,
        Steps: slice.Steps.map((Step, Index) => {
            if (Index <= StepIndex) {
                return { ...Step, Status: "done" };
            }
            if (Index === NextPendingIndex) {
                return { ...Step, Status: "active" };
            }
            return { ...Step, Status: Step.Status === "done" ? "done" : "pending" };
        }),
    };
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
    const [Config,      SetConfig]    = useState<{ AnthropicKeySet: boolean; DeepseekKeySet: boolean; OpenaiKeySet: boolean } | null>(null);
    const [Error,       SetError]     = useState<string | null>(null);
    const [Activity,    SetActivity]  = useState<AiActivityEvent>({ Kind: "idle", Label: "Idle" });
    const [QuestionDrafts, SetQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
    const [DisclosureOpen, SetDisclosureOpen] = useState(() => !HasAcknowledgedAiDisclosure());
    const [ActiveSkills,   SetActiveSkills]   = useState<Set<SkillId>>(new Set());
    const TaskSlice = useStateKey<TaskSlice | null>("AiTaskSlice");

    const ScrollRef    = useRef<HTMLDivElement>(null);
    const AssistantAllRaw = useRef("");
    const AssistantSegmentRaw = useRef("");
    const AssistantSegmentVisible = useRef("");
    const CurrentAssistantMessageIdRef = useRef<string | null>(null);
    const NextStreamIdRef = useRef(1);
    const TypeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const UnsubsRef    = useRef<(() => void)[]>([]);
    const TurnActionLogRef = useRef<string[]>([]);
    const TaskSliceRef = useRef<TaskSlice | null>(TaskSlice ?? null);
    const TaskSignatureRef = useRef(SliceSignature(TaskSlice ?? null));

    useEffect(() => {
        AiService.GetConfig().then(SetConfig).catch(() => {});
        AiService.GetAppSettings().then(S => {
            SetProvider(S.DefaultProvider);
            StateManager.set("AiProvider", S.DefaultProvider);
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

    const NewStreamId = useCallback((Prefix: string) => {
        const Id = `${Prefix}_${Date.now()}_${NextStreamIdRef.current}`;
        NextStreamIdRef.current += 1;
        return Id;
    }, []);

    const SetTaskSliceIfChanged = useCallback((NextSlice: TaskSlice) => {
        const Slice = ReconcileTaskSlice(NextSlice, TaskSliceRef.current);
        const Signature = SliceSignature(Slice);
        if (TaskSignatureRef.current === Signature) return;
        TaskSignatureRef.current = Signature;
        TaskSliceRef.current = Slice;
        StateManager.set("AiTaskSlice", Slice);
    }, []);

    const UpdateTaskSliceFromText = useCallback((Content: string) => {
        const Slice = ExtractTaskSlice(Content);
        if (!Slice) return;
        SetTaskSliceIfChanged(Slice);
    }, [SetTaskSliceIfChanged]);

    const AdvanceTaskSliceFromCheckpoint = useCallback(() => {
        const NextSlice = AdvanceTaskSliceFromCheckpointValue(TaskSliceRef.current);
        if (!NextSlice) return;
        SetTaskSliceIfChanged(NextSlice);
    }, [SetTaskSliceIfChanged]);

    const SetAssistantMessage = useCallback((Content: string) => {
        const MessageId = CurrentAssistantMessageIdRef.current;
        if (!MessageId) return;

        SetStream(Prev => {
            return Prev.map(Item =>
                Item.Kind === "message" && Item.Id === MessageId
                    ? { ...Item, Content }
                    : Item
            );
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
            const Raw = AssistantSegmentRaw.current;
            const Visible = AssistantSegmentVisible.current;
            if (Visible.length >= Raw.length) return;

            const Remaining = Raw.length - Visible.length;
            const Step = Remaining > 320 ? 18 : Remaining > 120 ? 10 : 4;
            const Next = Raw.slice(0, Visible.length + Math.min(Remaining, Step));
            AssistantSegmentVisible.current = Next;
            SetAssistantMessage(Next);
        }, 24);
    }, [SetAssistantMessage]);

    const FlushAssistantSegment = useCallback(() => {
        const MessageId = CurrentAssistantMessageIdRef.current;
        if (!MessageId) return;

        StopTypewriter();
        if (AssistantSegmentRaw.current.length > 0) {
            AssistantSegmentVisible.current = AssistantSegmentRaw.current;
            SetAssistantMessage(AssistantSegmentRaw.current);
        } else {
            SetStream(Prev => Prev.filter(Item =>
                !(Item.Kind === "message" && Item.Id === MessageId)
            ));
        }
        CurrentAssistantMessageIdRef.current = null;
        AssistantSegmentRaw.current = "";
        AssistantSegmentVisible.current = "";
    }, [SetAssistantMessage, StopTypewriter]);

    const AvailableProviders: AiProvider[] = Config
        ? (["anthropic", "deepseek", "openai"] as AiProvider[]).filter(P =>
            P === "anthropic" ? Config.AnthropicKeySet :
            P === "deepseek"  ? Config.DeepseekKeySet  :
            Config.OpenaiKeySet)
        : [];

    useEffect(() => {
        if (Mode === "agentic" && Provider !== "deepseek") {
            SetMode("autonomous");
            AiService.SaveAppSettings({ AiMode: "autonomous" }).catch(() => {});
        }
    }, [Mode, Provider]);

    useEffect(() => {
        if (!Config || AvailableProviders.length === 0) return;

        const ProviderHasKey = Provider === "anthropic"
            ? Config.AnthropicKeySet
            : Provider === "deepseek"
            ? Config.DeepseekKeySet
            : Config.OpenaiKeySet;
        if (ProviderHasKey) return;

        const NextProvider = AvailableProviders[0];
        SetProvider(NextProvider);
        StateManager.set("AiProvider", NextProvider);
        AiService.SaveAppSettings({ DefaultProvider: NextProvider }).catch(() => {});
    }, [Config, Provider, AvailableProviders]);

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
        StateManager.set("AiProvider", Provider);
        AiService.SaveAppSettings({ DefaultProvider: Provider }).catch(() => {});

        const UserMsg: AiMessage = {
            Role: "user",
            Content: Mode === "agentic" ? `${Text}\n\n${AGENTIC_UI_INSTRUCTION}` : Text,
        };
        const NextHistory = [...ApiHistory, UserMsg];
        const AssistantId = NewStreamId("assistant");
        CurrentAssistantMessageIdRef.current = AssistantId;

        SetStream(Prev => [
            ...Prev,
            { Kind: "message", Id: NewStreamId("user"), Role: "user",      Content: Text },
            { Kind: "message", Id: AssistantId,         Role: "assistant", Content: "" },
        ]);
        SetStreaming(true);
        AssistantAllRaw.current = "";
        AssistantSegmentRaw.current = "";
        AssistantSegmentVisible.current = "";
        TurnActionLogRef.current = [];
        TaskSignatureRef.current = "";
        TaskSliceRef.current = null;
        StateManager.set("AiTaskSlice", null);
        StopTypewriter();
        SetActivity({ Kind: "thinking", Label: "Thinking" });

        UnsubsRef.current.forEach(fn => fn());
        UnsubsRef.current = [];

        const unsubs: (() => void)[] = [];

        unsubs.push(await listen<AiActivityEvent>("ai_activity", E => {
            SetActivity(E.payload);
        }));

        unsubs.push(await listen<string>("ai_token", E => {
            if (!CurrentAssistantMessageIdRef.current) {
                const NextAssistantId = NewStreamId("assistant");
                CurrentAssistantMessageIdRef.current = NextAssistantId;
                AssistantSegmentRaw.current = "";
                AssistantSegmentVisible.current = "";
                SetStream(Prev => [...Prev, {
                    Kind: "message",
                    Id: NextAssistantId,
                    Role: "assistant",
                    Content: "",
                }]);
            }

            AssistantAllRaw.current += E.payload;
            AssistantSegmentRaw.current += E.payload;
            UpdateTaskSliceFromText(AssistantAllRaw.current);
            StartTypewriter();
        }));

        unsubs.push(await listen<{ id: string; name: string; input: Record<string, unknown> }>("ai_tool_call", E => {
            FlushAssistantSegment();
            TurnActionLogRef.current.push(
                `tool_call ${E.payload.id}: ${E.payload.name} ${JsonForHistory(E.payload.input)}`
            );
            SetStream(Prev => [...Prev, {
                Kind: "tool_call", Id: E.payload.id, Name: E.payload.name,
                Input: E.payload.input, Status: "running", Expanded: false,
            }]);
        }));

        unsubs.push(await listen<{ id: string; name: string; result: string; error: boolean }>("ai_tool_result", E => {
            TurnActionLogRef.current.push(
                `tool_result ${E.payload.id}: ${E.payload.name} ${E.payload.error ? "error" : "ok"}\n${ClipForHistory(E.payload.result, HISTORY_TOOL_RESULT_LIMIT)}`
            );
            if (Mode === "agentic" && E.payload.name === "create_memory" && !E.payload.error) {
                AdvanceTaskSliceFromCheckpoint();
            }
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
            FlushAssistantSegment();
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
            FlushAssistantSegment();
            SetStream(Prev => [...Prev, {
                Kind: "approval", Id: E.payload.id, Name: E.payload.name, Input: E.payload.input,
            }]);
        }));

        unsubs.push(await listen<string>("ai_tool_denied", E => {
            SetStream(Prev => Prev.map(Item => {
                if (Item.Kind !== "approval" || Item.Id !== E.payload) return Item;
                const Replaced: ToolItem = { Kind: "tool_call", Id: Item.Id, Name: Item.Name, Input: Item.Input, Status: "error", Result: "Denied by user", Expanded: false };
                return Replaced;
            }));
        }));

        unsubs.push(await listen<{ wait_seconds: number; auto_continue: boolean }>("ai_rate_limit", E => {
            const Id = `rate_limit_${Date.now()}`;
            const Item: RateLimitItem = {
                Kind: "rate_limit", Id,
                SecondsLeft: E.payload.wait_seconds,
                TotalSeconds: E.payload.wait_seconds,
                AutoContinue: E.payload.auto_continue,
                Ticking: E.payload.auto_continue,
                Resolved: false,
            };
            SetStream(Prev => [...Prev, Item]);
        }));

        unsubs.push(await listen<{ seconds_remaining: number }>("ai_rate_limit_tick", E => {
            SetStream(Prev => {
                let Idx = -1;
                for (let J = Prev.length - 1; J >= 0; J--) {
                    if (Prev[J].Kind === "rate_limit") { Idx = J; break; }
                }
                if (Idx < 0) return Prev;
                const Copy = [...Prev];
                const Item = Copy[Idx] as RateLimitItem;
                Copy[Idx] = {
                    ...Item,
                    SecondsLeft: E.payload.seconds_remaining,
                    Ticking: true,
                    Resolved: E.payload.seconds_remaining === 0,
                };
                return Copy;
            });
        }));

        unsubs.push(await listen<void>("ai_done", () => {
            const FinalContent = AssistantAllRaw.current;
            FlushAssistantSegment();
            const HistoryContent = ActionLogMessage(FinalContent, TurnActionLogRef.current);
            if (HistoryContent) {
                SetApiHistory([...NextHistory, { Role: "assistant", Content: HistoryContent }]);
            } else {
                SetApiHistory(NextHistory);
            }
            AssistantAllRaw.current = "";
            AssistantSegmentRaw.current = "";
            AssistantSegmentVisible.current = "";
            CurrentAssistantMessageIdRef.current = null;
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
                const CurrentId = CurrentAssistantMessageIdRef.current;
                return CurrentId
                    ? Copy.filter(Item => !(Item.Kind === "message" && Item.Id === CurrentId && !Item.Content))
                    : Copy;
            });
            AssistantAllRaw.current = "";
            AssistantSegmentRaw.current = "";
            AssistantSegmentVisible.current = "";
            CurrentAssistantMessageIdRef.current = null;
            TurnActionLogRef.current = [];
            SetActivity({ Kind: "error", Label: "Error" });
            unsubs.forEach(fn => fn());
            UnsubsRef.current = [];
        }));

        UnsubsRef.current = unsubs;

        const EffectiveSkills = AVAILABLE_SKILLS
            .filter(Skill =>
                Skill.Classification === 1 ||
                (Skill.Classification === 2 && (ActiveSkills.has(Skill.Id) || SKILL_INTENT_PATTERNS[Skill.Id]?.test(Text))) ||
                (Skill.Classification === 3 && ActiveSkills.has(Skill.Id))
            )
            .map(Skill => Skill.Id);

        AiService.StartAgent(Provider, NextHistory, Workspace, Mode, EffectiveSkills).catch((Err: unknown) => {
            SetError(String(Err));
            SetStreaming(false);
            StopTypewriter();
            CurrentAssistantMessageIdRef.current = null;
            unsubs.forEach(fn => fn());
            UnsubsRef.current = [];
        });
    }, [Input, Streaming, ApiHistory, Provider, Mode, Workspace, ActiveSkills, AvailableProviders, NewStreamId, UpdateTaskSliceFromText, AdvanceTaskSliceFromCheckpoint, StartTypewriter, StopTypewriter, FlushAssistantSegment]);

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
        AssistantAllRaw.current = "";
        AssistantSegmentRaw.current = "";
        AssistantSegmentVisible.current = "";
        CurrentAssistantMessageIdRef.current = null;
        TurnActionLogRef.current = [];
        TaskSignatureRef.current = "";
        TaskSliceRef.current = null;
        StateManager.set("AiTaskSlice", null);
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
        StateManager.set("AiProvider", P);
        AiService.SaveAppSettings({ DefaultProvider: P }).catch(() => {});
    }, []);

    const HandleSkillToggle = useCallback((Id: SkillId) => {
        SetActiveSkills(Prev => {
            const Next = new Set(Prev);
            if (Next.has(Id)) {
                Next.delete(Id);
            } else {
                Next.add(Id);
            }
            return Next;
        });
    }, []);

    const HandleModeToggle = useCallback(() => {
        const Cycle: AiMode[] = Provider === "deepseek"
            ? ["supervised", "autonomous", "agentic"]
            : ["supervised", "autonomous"];
        const CurrentIndex = Cycle.indexOf(Mode);
        const Next = Cycle[(CurrentIndex + 1) % Cycle.length] ?? "supervised";
        SetMode(Next);
        AiService.GetAppSettings().then(S =>
            AiService.SaveAppSettings({ ...S, AiMode: Next })
        ).catch(() => {});
    }, [Mode, Provider]);

    const HandleOpenNyxCli = useCallback(() => {
        AiService.LaunchNyxCli(Workspace).catch((Err: unknown) => {
            SetError(String(Err));
        });
    }, [Workspace]);

    const HandleToolToggle = useCallback((Id: string) => {
        SetStream(Prev => Prev.map(Item =>
            Item.Kind === "tool_call" && Item.Id === Id
                ? { ...Item, Expanded: !Item.Expanded }
                : Item
        ));
    }, []);

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
                    {(["anthropic", "deepseek", "openai"] as AiProvider[]).map(P => {
                        const HasKey = P === "anthropic" ? Config?.AnthropicKeySet : P === "deepseek" ? Config?.DeepseekKeySet : Config?.OpenaiKeySet;
                        const Label  = P === "anthropic" ? "Anthropic" : P === "deepseek" ? "DeepSeek" : "OpenAI";
                        return (
                            <button
                                key={P}
                                className={`${styles.ProviderBtn}${Provider === P ? ` ${styles.ProviderBtnActive}` : ""}${!HasKey ? ` ${styles.ProviderBtnDim}` : ""}`}
                                onClick={() => HandleProviderChange(P)}
                                title={!HasKey ? `No ${P} key configured` : undefined}
                            >
                                {Label}
                            </button>
                        );
                    })}
                </div>

                <button
                    className={`${styles.ModeBtn}${Mode !== "supervised" ? ` ${styles.ModeBtnAuto}` : ""}`}
                    onClick={HandleModeToggle}
                    title={
                        Mode === "supervised" ? "Supervised: writes/commands need approval" :
                        Mode === "autonomous"
                            ? `Autonomous: file tools run directly; shell commands need approval${Provider !== "deepseek" ? " — Agentic is DeepSeek-only (cost)" : ""}`
                            : "Agentic: sliced autonomous work; shell commands need approval"
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

            <div className={styles.SkillsRow}>
                {AVAILABLE_SKILLS.filter(Skill => !Skill.Hidden).map(Skill => {
                    const AlwaysOn = Skill.Classification === 1;
                    const Active   = AlwaysOn || ActiveSkills.has(Skill.Id);
                    const Title    = AlwaysOn
                        ? `${Skill.Description} - always active`
                        : Skill.Classification === 2
                            ? `${Skill.Description} - auto-activates on matching requests`
                            : Skill.Description;
                    return (
                        <button
                            key={Skill.Id}
                            className={`${styles.SkillChip}${Active ? ` ${styles.SkillChipActive}` : ""}${AlwaysOn ? ` ${styles.SkillChipAlways}` : ""}`}
                            onClick={AlwaysOn ? undefined : () => HandleSkillToggle(Skill.Id)}
                            title={Title}
                            aria-pressed={Active}
                        >
                            {Skill.Label}
                        </button>
                    );
                })}
            </div>

            <div className={`${styles.ActivityStrip} ${Streaming ? styles.ActivityStripActive : ""}`}>
                <span className={styles.ActivityDot} />
                <span className={styles.ActivityLabel}>{Streaming ? Activity.Label : "Ready"}</span>
            </div>

            {Mode === "agentic" && TaskSlice && (
                <div className={styles.TaskHeader} aria-label="Agent checklist">
                    <div className={styles.TaskHeaderTitle}>
                        <span>Agent checklist</span>
                        <span>
                            Slice {TaskSlice.Id} | {TaskSliceStepSummary(TaskSlice)}
                        </span>
                    </div>
                    {TaskSlice.Reason && (
                        <div className={styles.TaskReason}>{TaskSlice.Reason}</div>
                    )}
                    <div className={styles.TaskStepGrid}>
                        {TaskSlice.Steps.map((Step, Index) => (
                            <div
                                key={`${Index}_${Step.Label}`}
                                aria-current={Step.Status === "active" ? "step" : undefined}
                                className={`${styles.TaskStep} ${
                                    Step.Status === "done" ? styles.TaskStepDone :
                                    Step.Status === "active" ? styles.TaskStepActive :
                                    styles.TaskStepPending
                                }`}
                            >
                                <span className={styles.TaskStepMark} aria-hidden="true" />
                                <span className={styles.TaskStepLabel}>{Step.Label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

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
                                Supervised mode asks before writes and commands. Autonomous and agentic modes can execute file actions
                                <span className={styles.DisclosureHot}> without</span> those approval prompts, but shell commands still ask.
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
                        const IsError = Item.Status === "error";
                        const IsLong = !!Item.Result && Item.Result.length > 360;
                        const VisibleResult = IsLong && !Item.Expanded
                            ? Item.Result!.slice(0, 360) + "…"
                            : Item.Result;
                        return (
                            <div key={I} className={`${styles.ToolCard} ${IsError ? styles.ToolCardError : Item.Status === "done" ? styles.ToolCardDone : styles.ToolCardRunning}`}>
                                <div className={styles.ToolCardHeader}>
                                    <span className={styles.ToolIcon}>{ToolIcon(Item.Name)}</span>
                                    <span className={styles.ToolAction}>{ToolActionLabel(Item.Name, Item.Input) || "Running action"}</span>
                                    <span className={styles.ToolName}>{Item.Name}</span>
                                    <span className={styles.ToolStatus}>{StatusLabel(Item.Status)}</span>
                                </div>
                                {RenderToolResult(Item.Name, VisibleResult, IsError)}
                                {IsLong && (
                                    <button
                                        className={styles.ToolResultToggle}
                                        onClick={() => HandleToolToggle(Item.Id)}
                                    >
                                        {Item.Expanded ? "Show less" : "Show full"}
                                    </button>
                                )}
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

                    if (Item.Kind === "rate_limit") {
                        const ShowButtons = !Item.AutoContinue && !Item.Ticking;
                        return (
                            <div key={I} className={`${styles.RateLimitCard} ${Item.Resolved ? styles.RateLimitCardResolved : ""}`}>
                                <div className={styles.RateLimitBody}>
                                    <RateLimitClock SecondsLeft={Item.SecondsLeft} TotalSeconds={Item.TotalSeconds} />
                                    <div className={styles.RateLimitText}>
                                        <div className={styles.RateLimitTitle}>
                                            {Item.Resolved ? "Resuming task…" : "Rate limit reached"}
                                        </div>
                                        <div className={styles.RateLimitDesc}>
                                            {Item.Resolved
                                                ? "Retrying the request now."
                                                : Item.Ticking
                                                    ? `Retrying in ${Item.SecondsLeft}s…`
                                                    : "The API rate limit was hit. Wait 60 s then retry?"}
                                        </div>
                                        {ShowButtons && (
                                            <div className={styles.RateLimitActions}>
                                                <button
                                                    className={styles.RateLimitContinueBtn}
                                                    onClick={() => AiService.RespondToRateLimit(true)}
                                                >
                                                    Wait &amp; continue
                                                </button>
                                                <button
                                                    className={styles.RateLimitCancelBtn}
                                                    onClick={() => AiService.RespondToRateLimit(false)}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
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
