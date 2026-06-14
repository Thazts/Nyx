import React, { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from "react";
import styles from "../styles/EditorArea.module.css";
import { DetectLanguage, type Token } from "../services/Tokenizer";
import { GetCompletions, GetSignatureHelp, GetWordContext, type CompletionItem, type SignatureHelp } from "../services/Completer";
import { CompletionPopup } from "./CompletionPopup";
import { HighlightOverlay } from "./HighlightOverlay";
import { SearchBar } from "./SearchBar";
import { UILib, UsePanel } from "../ui/UILib";
import { GetClassicWelcome } from "./SettingsPanel";
import { PatchNotesList } from "./PatchNotesList";
import { RoadmapList } from "./RoadmapList";
import { UpdateLogPanel } from "./UpdateLogPanel";
import { GetFileLanguageColor } from "../services/LanguageMeta";

const OVERSCAN        = 80;
const FUZZY_THRESHOLD = 3_000;

const TabColorStyle = (Name: string): React.CSSProperties =>
    ({ "--tab-color": GetFileLanguageColor(Name) } as React.CSSProperties);

const LangComment: Record<string, string> = {
    luau:       '--',
    typescript: '//',
    javascript: '//',
    rust:       '//',
    css:        '//',
    json:       '//',
    python:     '#',
    toml:       '#',
    yaml:       '#',
    bash:       '#',
    wgsl:       '//',
    glsl:       '//',
    c:          '//',
    cpp:        '//',
    go:         '//',
    csharp:     '//',
    java:       '//',
    sql:        '--',
    kotlin:     '//',
    swift:      '//',
    dart:       '//',
    scala:      '//',
    hlsl:       '//',
    zig:        '//',
    ruby:       '#',
    php:        '//',
    elixir:     '#',
    haskell:    '--',
    graphql:    '#',
    dockerfile: '#',
    makefile:   '#',
    nim:        '#',
    vlang:      '//',
    red:        ';',
    j:          'NB.',
    apl:        '⍝',
    factor:     '!',
    idris:      '--',
    fsharp:     '//',
    erlang:     '%',
    racket:     ';',
    scheme:     ';',
    lisp:       ';',
    fortran:    '!',
    cobol:      '*>',
    ada:        '--',
    crystal:    '#',
    julia:      '#',
    lolcode:    'BTW',
};

const LangClosers: Record<string, string[]> = {
    luau:       ['end', 'until'],
    typescript: [], javascript: [], rust:     [], css:      [], json:     [],
    python:     [], toml:        [], yaml:    [], bash:     [], wgsl:     [],
    glsl:       [], c:           [], cpp:     [], go:       [], csharp:   [],
    java:       [], sql:         [], markdown:[], xml:      [], html:     [],
    ruby:       ['end'], elixir:  ['end'],
    crystal:    ['end'], julia:   ['end'],
};

interface BlockRule {
    Open:  RegExp;
    Close: string;
}

const LangBlocks: Record<string, BlockRule[]> = {
    luau: [
        { Open: /^if\b.*\bthen$/,        Close: 'end' },
        { Open: /^for\b.*\bdo$/,         Close: 'end' },
        { Open: /^while\b.*\bdo$/,       Close: 'end' },
        { Open: /^do$/,                  Close: 'end' },
        { Open: /\bfunction\b.*\)$/,     Close: 'end' },
        { Open: /^repeat$/,              Close: 'until' },
    ],
    ruby: [
        { Open: /^(def|class|module|case|begin)\b/, Close: 'end' },
        { Open: /^(if|unless|while|until|for)\b/,    Close: 'end' },
        { Open: /\bdo(\s*\|[^|]*\|)?$/,              Close: 'end' },
    ],
    crystal: [
        { Open: /^(def|class|module|struct|enum|case|begin|lib|macro)\b/, Close: 'end' },
        { Open: /^(if|unless|while|until|for)\b/,    Close: 'end' },
        { Open: /\bdo(\s*\|[^|]*\|)?$/,              Close: 'end' },
    ],
    julia: [
        { Open: /^(function|macro|if|for|while|begin|let|quote|try|module)\b/, Close: 'end' },
        { Open: /^(mutable\s+)?struct\b/,            Close: 'end' },
        { Open: /\bdo(\s+[A-Za-z0-9_, ]*)?$/,        Close: 'end' },
    ],
    elixir: [
        { Open: /\bdo$/,                             Close: 'end' },
    ],
    bash: [
        { Open: /\bthen$/,                           Close: 'fi' },
        { Open: /\bdo$/,                             Close: 'done' },
        { Open: /^case\b.*\bin$/,                    Close: 'esac' },
    ],
};

function ShouldAutoClose(Text: string, From: number, Indent: string, Closer: string): boolean {
    const CurNewline = Text.indexOf('\n', From);
    if (CurNewline === -1) return true;
    let P = CurNewline + 1;
    while (P <= Text.length) {
        const LineEnd = Text.indexOf('\n', P);
        const Stop = LineEnd === -1 ? Text.length : LineEnd;
        const Line = Text.slice(P, Stop);
        if (Line.trim() !== '') {
            const Lead = (Line.match(/^(\s*)/)?.[1] ?? '').length;
            if (Lead > Indent.length) return false; 
            if (Line.trim() === Closer && Lead === Indent.length) return false; 
            return true;                                                      
        }
        if (LineEnd === -1) break;
        P = Stop + 1;
    }
    return true;
}

const AutoClosePairs: Record<string, string> = {
    '(':  ')',
    '[':  ']',
    '{':  '}',
    '"':  '"',
    "'":  "'",
    '`':  '`',
};

interface SearchMatchEntry {
    Start: number;
    Len: number;
    Kind: 'exact' | 'fuzzy';
}

interface DiagnosticEntry {
    Line: number;
    Message: string;
    Severity: "warning" | "error";
}

function Levenshtein(A: string, B: string): number {
    const M = A.length, N = B.length;
    const Row = Array.from({ length: N + 1 }, (_, I) => I);
    for (let I = 1; I <= M; I++) {
        let Prev = Row[0];
        Row[0] = I;
        for (let J = 1; J <= N; J++) {
            const Tmp = Row[J];
            Row[J] = A[I - 1] === B[J - 1] ? Prev : 1 + Math.min(Prev, Row[J], Row[J - 1]);
            Prev = Tmp;
        }
    }
    return Row[N];
}
function LineFromOffset(Offsets: Int32Array, Pos: number): number {
    let Lo = 0, Hi = Offsets.length - 2;
    while (Lo < Hi) {
        const Mid = (Lo + Hi + 1) >> 1;
        if (Offsets[Mid] <= Pos) Lo = Mid;
        else Hi = Mid - 1;
    }
    return Lo;
}

function ComputeLH(): number {
    const Style = document.documentElement.style;
    return (parseFloat(Style.getPropertyValue("--editor-font-size"))   || 11.5) *
           (parseFloat(Style.getPropertyValue("--editor-line-height")) || 1.78);
}

function VisibleLineEnd(Line: string): number {
    return Line.trimEnd().length;
}

function BuildDirtyLines(Content: string, DiskContent: string | undefined): Set<number> {
    const Result = new Set<number>();
    if (DiskContent === undefined || Content === DiskContent) return Result;

    const A = DiskContent.split("\n");
    const B = Content.split("\n");
    const M = A.length, N = B.length;

    let Pre = 0;
    const MinLen = Math.min(M, N);
    while (Pre < MinLen && A[Pre] === B[Pre]) Pre++;

    let Suf = 0;
    while (Suf < MinLen - Pre && A[M - 1 - Suf] === B[N - 1 - Suf]) Suf++;

    const Ao = A.slice(Pre, M - Suf || M);
    const Bo = B.slice(Pre, N - Suf || N);
    const Am = Ao.length, Bm = Bo.length;

    if (Am === 0) {
        for (let J = 0; J < Bm; J++) Result.add(Pre + J + 1);
        return Result;
    }
    if (Bm === 0) return Result;

    if (Am * Bm > 250_000) {
        for (let I = 0; I < Math.max(Am, Bm); I++) {
            if ((Ao[I] ?? "") !== (Bo[I] ?? "")) Result.add(Pre + I + 1);
        }
        return Result;
    }
    const Dp: Int32Array[] = Array.from({ length: Am + 1 }, () => new Int32Array(Bm + 1));
    for (let I = Am - 1; I >= 0; I--) {
        for (let J = Bm - 1; J >= 0; J--) {
            Dp[I][J] = Ao[I] === Bo[J]
                ? Dp[I + 1][J + 1] + 1
                : Math.max(Dp[I + 1][J], Dp[I][J + 1]);
        }
    }
    let I = 0, J = 0;
    while (I < Am && J < Bm) {
        if (Ao[I] === Bo[J] && Dp[I][J] === Dp[I + 1][J + 1] + 1) {
            I++; J++;
        } else if (Dp[I + 1][J] >= Dp[I][J + 1]) {
            I++;
        } else {
            Result.add(Pre + J + 1);
            J++;
        }
    }
    while (J < Bm) { Result.add(Pre + J + 1); J++; }

    return Result;
}

function BuildDiagnostics(Content: string, Language: string): DiagnosticEntry[] {
    const Diagnostics: DiagnosticEntry[] = [];
    const Lines = Content.split("\n");
    const BracketPairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const BracketOpen = new Set(Object.keys(BracketPairs));
    const BracketClose = new Set(Object.values(BracketPairs));
    const Stack: Array<{ Char: string; Line: number }> = [];

    Lines.forEach((Line, Index) => {
        if (/\s+$/.test(Line)) {
            Diagnostics.push({
                Line: Index + 1,
                Message: "Trailing whitespace",
                Severity: "warning",
            });
        }

        let Quote: string | null = null;
        for (let I = 0; I < Line.length; I++) {
            const Char = Line[I];
            const Prev = Line[I - 1];
            if ((Char === "\"" || Char === "'" || Char === "`") && Prev !== "\\") {
                Quote = Quote === Char ? null : Quote ?? Char;
                continue;
            }
            if (Quote) continue;

            if (BracketOpen.has(Char)) {
                Stack.push({ Char, Line: Index + 1 });
            } else if (BracketClose.has(Char)) {
                const Last = Stack[Stack.length - 1];
                if (!Last || BracketPairs[Last.Char] !== Char) {
                    Diagnostics.push({
                        Line: Index + 1,
                        Message: `Unexpected '${Char}'`,
                        Severity: "error",
                    });
                } else {
                    Stack.pop();
                }
            }
        }
    });

    for (const Item of Stack.slice(-12)) {
        Diagnostics.push({
            Line: Item.Line,
            Message: `Unclosed '${Item.Char}'`,
            Severity: "error",
        });
    }

    if (Language === "json" && Content.trim()) {
        try {
            JSON.parse(Content);
        } catch (Thrown) {
            const Message = Thrown instanceof globalThis.Error ? Thrown.message : "Invalid JSON";
            const LineMatch = /position (\d+)/i.exec(Message);
            const Offset = LineMatch ? Number(LineMatch[1]) : 0;
            const Line = Content.slice(0, Offset).split("\n").length;
            Diagnostics.push({ Line, Message: "Invalid JSON", Severity: "error" });
        }
    }

    if (Language === "luau") {
        const Blocks: Array<{ Word: string; Line: number }> = [];
        Lines.forEach((Line, Index) => {
            const Clean = Line.replace(/--.*$/, "");
            const Words = Clean.match(/\b(function|if|do|for|while|repeat|end|until)\b/g) ?? [];
            for (const Word of Words) {
                if (Word === "do" && /\b(for|while)\b.*\bdo\b/.test(Clean)) continue;
                if (Word === "end" || Word === "until") {
                    Blocks.pop();
                } else {
                    Blocks.push({ Word, Line: Index + 1 });
                }
            }
        });
        for (const Block of Blocks.slice(-8)) {
            Diagnostics.push({
                Line: Block.Line,
                Message: `Missing close for '${Block.Word}'`,
                Severity: "warning",
            });
        }
    }

    return Diagnostics.slice(0, 80);
}

interface TabEntry {
    Path: string;
    Name: string;
    Content: string;
    DiskContent: string;
    Type?: 'file' | 'viewport';
}

interface EditorAreaProps {
    FileContent:          string;
    FileName:             string;
    OnContentChange:      (Content: string) => void;
    OnCursorChange?:      (Line: number, Col: number) => void;
    OpenTabs?:            TabEntry[];
    ActiveFile?:          string | null;
    OnTabClose?:          (Path: string) => void;
    OnTabSelect?:         (Path: string) => void;
    OnSaveFile?:          (Path: string) => void;
    SwitchDir?:           "up" | "down" | "none";
    ShowSavedFlash?:      boolean;
    ViewportContent?:     React.ReactNode;
    ActiveFileModified?:  boolean;
    ExternalContentVersion?: number;
}

export const EditorArea: React.FC<EditorAreaProps> = ({
    FileContent,
    FileName,
    OnContentChange,
    OnCursorChange,
    OpenTabs = [],
    ActiveFile,
    OnTabClose,
    OnTabSelect,
    OnSaveFile,
    SwitchDir = "none",
    ShowSavedFlash = false,
    ViewportContent,
    ActiveFileModified,
    ExternalContentVersion,
}) => {
    const IsSearchOpen = UsePanel("Search");
    const [SearchTerm, SetSearchTerm] = useState("");
    const [ReplaceTerm, SetReplaceTerm] = useState("");
    const [CursorLine, SetCursorLine] = useState(1);
    const [CursorCol, SetCursorCol] = useState(1);
    const [IsFocused, SetIsFocused] = useState(false);
    const [TabDir, SetTabDir] = useState<"left" | "right" | "none">("none");
    const [CurrentMatchIndex, SetCurrentMatchIndex] = useState(0);
    const [ClosingTabs, SetClosingTabs] = useState<Set<string>>(new Set());
    const [ShowUpdateLog, SetShowUpdateLog] = useState(false);
    const [ClassicWelcome, SetClassicWelcome] = useState(() => GetClassicWelcome());
    useEffect(() => {
        const Handler = () => SetClassicWelcome(GetClassicWelcome());
        window.addEventListener("nyx-settings-changed", Handler);
        return () => window.removeEventListener("nyx-settings-changed", Handler);
    }, []);
    const TextAreaRef       = useRef<HTMLTextAreaElement>(null);
    const LineNumbersRef    = useRef<HTMLDivElement>(null);
    const OverlayRef        = useRef<HTMLDivElement>(null);
    const SearchOverlayRef  = useRef<HTMLDivElement>(null);
    const EditorWrapperRef  = useRef<HTMLDivElement>(null);
    const TabsContainerRef  = useRef<HTMLDivElement>(null);
    const PrevTabIndexRef   = useRef<number>(-1);
    const PendingCursorRef  = useRef<{ Start: number; End: number } | null>(null);
    const [ScrollTopPx, SetScrollTopPx] = useState(0);
    const RafRef            = useRef<number | null>(null);
    const ScrollFadeRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
    const CharWidthRef      = useRef(7);
    const TokensPacketRef   = useRef<{ Tokens: Token[]; Start: number }>({ Tokens: [], Start: 0 });
    const [CompletionItems,  SetCompletionItems]  = useState<CompletionItem[]>([]);
    const [CompletionIndex,  SetCompletionIndex]  = useState(0);
    const [CompletionPos,    SetCompletionPos]    = useState<{ Top: number; Left: number }>({ Top: 0, Left: 0 });
    const CursorColRef      = useRef(1);
    const LineOffsetsRef    = useRef(new Int32Array(1));
    const ScrollTopPxRef    = useRef(0);
    const ActualScrollTopRef = useRef(0);
    const WorkerRef         = useRef<Worker | null>(null);
    const WorkerVersionRef  = useRef(0);
    const LhRef             = useRef(ComputeLH());
    const FileContentRef    = useRef(FileContent);
    const CursorLineRef     = useRef(1);
    const OnCursorChangeRef = useRef(OnCursorChange);
    const SearchJumpRef     = useRef({ IsOpen: false, Term: "" });

    const Lines    = useMemo(() => FileContent.split("\n"), [FileContent]);
    const Language = useMemo(() => DetectLanguage(FileName), [FileName]);
    const ActiveTabEntry = useMemo(
        () => OpenTabs.find(T => T.Path === ActiveFile),
        [OpenTabs, ActiveFile],
    );
    const DirtyLines = useMemo(
        () => BuildDirtyLines(FileContent, ActiveTabEntry?.DiskContent),
        [FileContent, ActiveTabEntry?.DiskContent],
    );
    const Diagnostics = useMemo(
        () => BuildDiagnostics(FileContent, Language),
        [FileContent, Language],
    );
    const DiagnosticsByLine = useMemo(() => {
        const ResultMap = new Map<number, DiagnosticEntry[]>();
        for (const Diagnostic of Diagnostics) {
            const Existing = ResultMap.get(Diagnostic.Line) ?? [];
            Existing.push(Diagnostic);
            ResultMap.set(Diagnostic.Line, Existing);
        }
        return ResultMap;
    }, [Diagnostics]);
    FileContentRef.current = FileContent;
    const [LH, SetLH] = useState(ComputeLH);
    LhRef.current = LH;
    CursorLineRef.current = CursorLine;
    OnCursorChangeRef.current = OnCursorChange;
    const ViewH    = TextAreaRef.current?.clientHeight ?? 600;
    const VisStart = Math.max(0, Math.floor((ScrollTopPx - 14) / LH) - OVERSCAN);
    const VisEnd   = Math.max(VisStart, Math.min(Lines.length, Math.ceil((ScrollTopPx - 14 + ViewH) / LH) + OVERSCAN + 1));
    const LineOffsets = useMemo(() => {
        const O = new Int32Array(Lines.length + 1);
        for (let i = 0; i < Lines.length; i++) O[i + 1] = O[i] + Lines[i].length + 1;
        return O;
    }, [Lines]);
    LineOffsetsRef.current = LineOffsets;

    const PreChars    = LineOffsets[VisStart] ?? 0;
    const VisEndChars = LineOffsets[Math.min(VisEnd, Lines.length)] ?? FileContent.length;
    const VisText                   = useMemo(() => FileContent.slice(PreChars, VisEndChars), [FileContent, PreChars, VisEndChars]);
    const [TokensPacket, SetTokensPacket] = useState<{ Tokens: Token[]; Start: number }>({ Tokens: [], Start: 0 });
    TokensPacketRef.current = TokensPacket;

    const TotalHeight = Math.max(0, Lines.length * LH + 28);

    const Matches = useMemo((): SearchMatchEntry[] => {
        if (!SearchTerm || SearchTerm.length < 1) return [];
        const Results: SearchMatchEntry[] = [];
        const Lower = FileContent.toLowerCase();
        const TermLower = SearchTerm.toLowerCase();
        const TLen = TermLower.length;
        const CoveredStarts = new Set<number>();

        let Idx = 0;
        while (Idx <= Lower.length - TLen) {
            const Found = Lower.indexOf(TermLower, Idx);
            if (Found === -1) break;
            Results.push({ Start: Found, Len: TLen, Kind: 'exact' });
            CoveredStarts.add(Found);
            Idx = Found + TLen;
        }

        if (TLen >= 3 && Lines.length < FUZZY_THRESHOLD) {
            const Threshold = Math.min(2, TLen <= 7 ? 1 : 2);
            const SeenWords = new Set<string>();
            const WordRx = /[a-zA-Z_][a-zA-Z0-9_]*/g;
            let WM: RegExpExecArray | null;
            while ((WM = WordRx.exec(FileContent)) !== null) {
                const WordLower = WM[0].toLowerCase();
                if (SeenWords.has(WordLower) || WordLower === TermLower) continue;
                SeenWords.add(WordLower);
                if (WordLower[0] !== TermLower[0]) continue;
                if (Math.abs(WordLower.length - TLen) > Threshold) continue;
                if (Levenshtein(WordLower, TermLower) <= Threshold) {
                    const Escaped = WM[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const AllRx = new RegExp(`\\b${Escaped}\\b`, 'gi');
                    let AM: RegExpExecArray | null;
                    while ((AM = AllRx.exec(FileContent)) !== null) {
                        if (!CoveredStarts.has(AM.index)) {
                            Results.push({ Start: AM.index, Len: AM[0].length, Kind: 'fuzzy' });
                            CoveredStarts.add(AM.index);
                        }
                    }
                }
            }
        }

        Results.sort((A, B) => A.Start - B.Start);
        const Deduped: SearchMatchEntry[] = [];
        let LastEnd = 0;
        for (const M of Results) {
            if (M.Start >= LastEnd) {
                Deduped.push(M);
                LastEnd = M.Start + M.Len;
            }
        }
        return Deduped;
    }, [FileContent, SearchTerm, Lines.length]);

    const MatchLineNumbers = useMemo(() => {
        const Offsets = LineOffsets;
        return Matches.map(M => LineFromOffset(Offsets, M.Start) + 1);
    }, [Matches, LineOffsets]);

    const DiagnosticLineNumbers = useMemo(
        () => Array.from(new Set(Diagnostics.map(Diagnostic => Diagnostic.Line))),
        [Diagnostics],
    );

    const DirtyLineNumbers = useMemo(
        () => Array.from(DirtyLines),
        [DirtyLines],
    );

    const Signature = useMemo<SignatureHelp | null>(() => {
        const Offset = (LineOffsets[CursorLine - 1] ?? 0) + Math.max(CursorCol - 1, 0);
        return GetSignatureHelp(FileContent, Offset, Language);
    }, [FileContent, Language, LineOffsets, CursorLine, CursorCol]);

    const SearchHighlights = useMemo((): React.ReactNode => {
        if (!SearchTerm || Matches.length === 0) return null;
        const Parts: React.ReactNode[] = [];
        let Pos = 0;
        Matches.forEach((Match, I) => {
            const { Start, Len, Kind } = Match;
            if (Start > Pos) Parts.push(<React.Fragment key={`p${I}`}>{FileContent.slice(Pos, Start)}</React.Fragment>);
            const IsActive = I === CurrentMatchIndex;
            const MarkClass = IsActive
                ? styles.SearchMatchActive
                : Kind === 'fuzzy'
                ? styles.SearchMatchFuzzy
                : styles.SearchMatch;
            Parts.push(
                <mark key={`m${I}`} className={MarkClass}>
                    {FileContent.slice(Start, Start + Len)}
                </mark>
            );
            Pos = Start + Len;
        });
        if (Pos < FileContent.length) Parts.push(<React.Fragment key="tail">{FileContent.slice(Pos)}</React.Fragment>);
        return Parts;
    }, [FileContent, SearchTerm, Matches, CurrentMatchIndex]);

    const SyncScrollPanels = useCallback((Top: number, Left?: number) => {
        ScrollTopPxRef.current = Top;
        ActualScrollTopRef.current = Top;
        SetScrollTopPx(Top);
        if (EditorWrapperRef.current) {
            EditorWrapperRef.current.style.setProperty("--cursor-top", `${14 + (CursorLineRef.current - 1) * LhRef.current - Top}px`);
        }
        if (LineNumbersRef.current)   LineNumbersRef.current.scrollTop = Top;
        if (OverlayRef.current)       OverlayRef.current.scrollTop = Top;
        if (SearchOverlayRef.current) SearchOverlayRef.current.scrollTop = Top;
        if (Left !== undefined) {
            if (OverlayRef.current)       OverlayRef.current.scrollLeft = Left;
            if (SearchOverlayRef.current) SearchOverlayRef.current.scrollLeft = Left;
        }
    }, []);

    const ScrollToOffset = useCallback((Start: number) => {
        const Textarea = TextAreaRef.current;
        if (!Textarea) return;
        const LinesBefore = LineFromOffset(LineOffsetsRef.current, Start);
        const ScrollTo = Math.max(0, LinesBefore * LhRef.current - Textarea.clientHeight / 3);
        Textarea.scrollTop = ScrollTo;
        SyncScrollPanels(ScrollTo, Textarea.scrollLeft);
    }, [SyncScrollPanels]);

    const JumpToMatch = useCallback((Idx: number) => {
        if (Matches.length === 0 || !TextAreaRef.current) return;
        SetCurrentMatchIndex(Idx);
        const { Start, Len } = Matches[Idx];
        ScrollToOffset(Start);
        TextAreaRef.current.focus();
        TextAreaRef.current.setSelectionRange(Start, Start + Len);
        UpdateCursorFromTextarea(TextAreaRef.current);
    }, [Matches, ScrollToOffset]);

    const HandleSearchNext = useCallback(() => {
        if (Matches.length === 0) return;
        JumpToMatch((CurrentMatchIndex + 1) % Matches.length);
    }, [Matches.length, CurrentMatchIndex, JumpToMatch]);

    const HandleSearchPrev = useCallback(() => {
        if (Matches.length === 0) return;
        JumpToMatch((CurrentMatchIndex - 1 + Matches.length) % Matches.length);
    }, [Matches.length, CurrentMatchIndex, JumpToMatch]);

    const HandleReplaceCurrent = useCallback(() => {
        const Textarea = TextAreaRef.current;
        if (!Textarea || Matches.length === 0) return;

        const Match = Matches[CurrentMatchIndex] ?? Matches[0];
        const Text = Textarea.value;
        const NewText = Text.slice(0, Match.Start) + ReplaceTerm + Text.slice(Match.Start + Match.Len);
        const CursorPos = Match.Start + ReplaceTerm.length;
        Textarea.value = NewText;
        OnContentChange(NewText);
        PendingCursorRef.current = { Start: CursorPos, End: CursorPos };
        SetCurrentMatchIndex(Math.min(CurrentMatchIndex, Math.max(Matches.length - 2, 0)));
    }, [Matches, CurrentMatchIndex, ReplaceTerm, OnContentChange]);

    const HandleReplaceAll = useCallback(() => {
        const Textarea = TextAreaRef.current;
        if (!Textarea || !SearchTerm) return;

        const Text = Textarea.value;
        const SearchLower = SearchTerm.toLowerCase();
        const TextLower = Text.toLowerCase();
        let Pos = 0;
        let Last = 0;
        let Changed = false;
        const Parts: string[] = [];

        while (Pos <= Text.length - SearchTerm.length) {
            const Found = TextLower.indexOf(SearchLower, Pos);
            if (Found === -1) break;
            Parts.push(Text.slice(Last, Found), ReplaceTerm);
            Pos = Found + SearchTerm.length;
            Last = Pos;
            Changed = true;
        }

        if (!Changed) return;
        Parts.push(Text.slice(Last));
        const NewText = Parts.join("");
        Textarea.value = NewText;
        OnContentChange(NewText);
        PendingCursorRef.current = { Start: 0, End: 0 };
        SetCurrentMatchIndex(0);
    }, [SearchTerm, ReplaceTerm, OnContentChange]);

    const HandleSearchClose = useCallback(() => {
        UILib.Hide("Search");
        UILib.SetView("explorer");
        SetSearchTerm("");
        SetReplaceTerm("");
    }, []);

    useEffect(() => {
        const ShouldJump =
            IsSearchOpen &&
            SearchTerm.length > 0 &&
            Matches.length > 0 &&
            (!SearchJumpRef.current.IsOpen || SearchJumpRef.current.Term !== SearchTerm);

        SearchJumpRef.current = { IsOpen: IsSearchOpen, Term: SearchTerm };
        SetCurrentMatchIndex(0);
        if (!ShouldJump || !TextAreaRef.current) return;
        const { Start, Len } = Matches[0];
        ScrollToOffset(Start);
        TextAreaRef.current.setSelectionRange(Start, Start + Len);
        UpdateCursorFromTextarea(TextAreaRef.current);
    }, [Matches, IsSearchOpen, SearchTerm, ScrollToOffset]);

    useLayoutEffect(() => {
        CursorLineRef.current = 1;
        ScrollTopPxRef.current = 0;
        ActualScrollTopRef.current = 0;
        SetCursorLine(1);
        SetCursorCol(1);
        SetScrollTopPx(0);
        if (TextAreaRef.current) {
            TextAreaRef.current.focus();
            TextAreaRef.current.setSelectionRange(0, 0);
            TextAreaRef.current.scrollTop = 0;
            TextAreaRef.current.scrollLeft = 0;
        }
        SyncScrollPanels(0, 0);
        OnCursorChangeRef.current?.(1, 1);
        SetCompletionItems([]);
    }, [ActiveFile, SyncScrollPanels]);

    useEffect(() => {
        const NewIndex = OpenTabs.findIndex(T => T.Path === ActiveFile);
        if (PrevTabIndexRef.current === -1 || NewIndex === -1) {
            SetTabDir("none");
        } else if (NewIndex > PrevTabIndexRef.current) {
            SetTabDir("right");
        } else if (NewIndex < PrevTabIndexRef.current) {
            SetTabDir("left");
        }
        PrevTabIndexRef.current = NewIndex;
    }, [ActiveFile, OpenTabs]);

    useLayoutEffect(() => {
        if (PendingCursorRef.current !== null && TextAreaRef.current) {
            const { Start, End } = PendingCursorRef.current;
            PendingCursorRef.current = null;
            TextAreaRef.current.selectionStart = Start;
            TextAreaRef.current.selectionEnd = End;
            UpdateCursorFromTextarea(TextAreaRef.current);
        }
    });
    useLayoutEffect(() => {
        const Textarea = TextAreaRef.current;
        if (!Textarea || Textarea.value === FileContent) return;

        const Start = Math.min(Textarea.selectionStart, FileContent.length);
        const End   = Math.min(Textarea.selectionEnd,   FileContent.length);
        Textarea.value = FileContent;
        Textarea.setSelectionRange(Start, End);
        UpdateCursorFromTextarea(Textarea);
    }, [ActiveFile, FileContent, ExternalContentVersion]);
    function UpdateCursorFromTextarea(Textarea: HTMLTextAreaElement) {
        const Pos     = Textarea.selectionDirection === "backward"
            ? Textarea.selectionStart
            : Textarea.selectionEnd;
        let LineNum: number;
        let ColNum: number;
        if (Textarea.value === FileContentRef.current) {
            const LineIdx = LineFromOffset(LineOffsetsRef.current, Pos);
            LineNum = LineIdx + 1;
            ColNum  = Pos - (LineOffsetsRef.current[LineIdx] ?? 0) + 1;
        } else {
            const Before = Textarea.value.slice(0, Pos);
            const LastNewline = Before.lastIndexOf("\n");
            LineNum = Before.split("\n").length;
            ColNum  = LastNewline === -1 ? Pos + 1 : Pos - LastNewline;
        }
        CursorLineRef.current = LineNum;
        CursorColRef.current  = ColNum;
        if (EditorWrapperRef.current) {
            EditorWrapperRef.current.style.setProperty("--cursor-top", `${14 + (LineNum - 1) * LhRef.current - ActualScrollTopRef.current}px`);
        }
        SetCursorLine(LineNum);
        SetCursorCol(ColNum);
        OnCursorChangeRef.current?.(LineNum, ColNum);
    }

    const UpdateCursor = useCallback(() => {
        const Textarea = TextAreaRef.current;
        if (!Textarea) return;
        UpdateCursorFromTextarea(Textarea);
    }, []);

    const DismissCompletions = useCallback(() => {
        SetCompletionItems([]);
    }, []);

    const UpdateCompletions = useCallback((Text: string, Offset: number, Lang: string) => {
        if (Offset !== TextAreaRef.current?.selectionStart) return; // stale
        const Items = GetCompletions(Text, Offset, Lang, TokensPacketRef.current.Tokens);
        SetCompletionItems(Items);
        SetCompletionIndex(0);
        if (Items.length > 0) {
            const LineStart = Text.lastIndexOf("\n", Offset - 1) + 1;
            const Col       = Offset - LineStart;
            const { Prefix } = GetWordContext(Text, Offset);
            const Top  = 14 + CursorLineRef.current * LhRef.current - ActualScrollTopRef.current;
            const Left = 46 + 20 + (Col - Prefix.length) * CharWidthRef.current;
            SetCompletionPos({ Top, Left });
        }
    }, []);

    const AcceptCompletion = useCallback((Item: CompletionItem) => {
        const Textarea = TextAreaRef.current;
        if (!Textarea) return;
        const Text   = Textarea.value;
        const Offset = Textarea.selectionStart;
        const { Start } = GetWordContext(Text, Offset);
        const NewText   = Text.slice(0, Start) + Item.Insert + Text.slice(Offset);
        const CursorPos = Start + (Item.CursorAt ?? Item.Insert.length);
        Textarea.value  = NewText;
        OnContentChange(NewText);
        PendingCursorRef.current = { Start: CursorPos, End: CursorPos };
        SetCompletionItems([]);
    }, [OnContentChange]);

    const HandleTextAreaChange = useCallback((E: React.ChangeEvent<HTMLTextAreaElement>) => {
        OnContentChange(E.target.value);
        UpdateCursorFromTextarea(E.target);
        const Offset = E.target.selectionStart;
        const Text   = E.target.value;
        const Char   = Text[Offset - 1] ?? "";
        if (/[A-Za-z0-9_$.:]/.test(Char)) {
            UpdateCompletions(Text, Offset, Language);
        } else {
            DismissCompletions();
        }
    }, [OnContentChange, Language, UpdateCompletions, DismissCompletions]);

    const HandleKeyDown = useCallback((E: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const Textarea = TextAreaRef.current;
        if (!Textarea) { UpdateCursor(); return; }

        const Text  = Textarea.value;
        const Start = Textarea.selectionStart;
        const End   = Textarea.selectionEnd;
        if (CompletionItems.length > 0) {
            if (E.key === "ArrowDown") {
                E.preventDefault();
                SetCompletionIndex(I => (I + 1) % CompletionItems.length);
                return;
            }
            if (E.key === "ArrowUp") {
                E.preventDefault();
                SetCompletionIndex(I => (I - 1 + CompletionItems.length) % CompletionItems.length);
                return;
            }
            if (E.key === "Tab" || (E.key === "Enter" && !E.shiftKey)) {
                E.preventDefault();
                AcceptCompletion(CompletionItems[CompletionIndex]);
                return;
            }
            if (E.key === "Escape") {
                E.preventDefault();
                DismissCompletions();
                return;
            }
            if (E.key === "ArrowLeft" || E.key === "ArrowRight" ||
                E.key === " " || E.key === "." || E.key === "(" ||
                E.key === ")" || E.key === "{" || E.key === "}" ||
                E.key === "[" || E.key === "]" || E.key === ";" ||
                E.key === "," || E.key === ":" || E.key === "\n") {
                DismissCompletions();
            }
        }

        if (E.key === 'Escape' && IsSearchOpen) {
            HandleSearchClose();
            return;
        }

        if (E.key === 'Backspace' && Start === End && Start > 0) {
            const Before = Text[Start - 1];
            const After  = Text[Start];
            if (
                (Before === '(' && After === ')') ||
                (Before === '[' && After === ']') ||
                (Before === '{' && After === '}') ||
                (Before === '"' && After === '"') ||
                (Before === "'" && After === "'") ||
                (Before === '`' && After === '`')
            ) {
                E.preventDefault();
                const NewText = Text.slice(0, Start - 1) + Text.slice(Start + 1);
                Textarea.value = NewText;
                OnContentChange(NewText);
                PendingCursorRef.current = { Start: Start - 1, End: Start - 1 };
                return;
            }
        }

        if (E.key === 'Backspace' && Start === End) {
            const LineStart = Text.lastIndexOf('\n', Start - 1) + 1;
            const BeforeCursor = Text.slice(LineStart, Start);
            if (BeforeCursor.length > 0 && /^ +$/.test(BeforeCursor) && BeforeCursor.length % 4 === 0) {
                E.preventDefault();
                const NewText = Text.slice(0, Start - 4) + Text.slice(Start);
                Textarea.value = NewText;
                OnContentChange(NewText);
                PendingCursorRef.current = { Start: Start - 4, End: Start - 4 };
                return;
            }
        }

        if ((E.key === '}' || E.key === ']' || E.key === ')') && Start === End) {
            const LineStart = Text.lastIndexOf('\n', Start - 1) + 1;
            const BeforeCursor = Text.slice(LineStart, Start);
            if (/^ +$/.test(BeforeCursor) && BeforeCursor.length >= 4) {
                E.preventDefault();
                const NewIndent = BeforeCursor.slice(0, BeforeCursor.length - 4);
                const NewText = Text.slice(0, LineStart) + NewIndent + E.key + Text.slice(Start);
                const NewPos = LineStart + NewIndent.length + 1;
                Textarea.value = NewText;
                OnContentChange(NewText);
                PendingCursorRef.current = { Start: NewPos, End: NewPos };
                return;
            }
        }

        if ((E.key === ')' || E.key === ']' || E.key === '}') && Start === End && Text[Start] === E.key) {
            E.preventDefault();
            Textarea.selectionStart = Start + 1;
            Textarea.selectionEnd   = Start + 1;
            UpdateCursor();
            return;
        }

        if (E.key.length === 1 && !E.ctrlKey && !E.altKey && !E.metaKey && Start === End) {
            const Closers = LangClosers[Language] ?? [];
            if (Closers.length > 0) {
                const LineStart = Text.lastIndexOf('\n', Start - 1) + 1;
                const BeforeCursor = Text.slice(LineStart, Start);
                const PotentialLine = BeforeCursor + E.key;
                const Trimmed = PotentialLine.trimStart();
                const LeadingSpaces = PotentialLine.length - Trimmed.length;
                if (LeadingSpaces >= 4 && Closers.includes(Trimmed)) {
                    E.preventDefault();
                    const NewIndent = ' '.repeat(LeadingSpaces - 4);
                    const NewText = Text.slice(0, LineStart) + NewIndent + Trimmed + Text.slice(Start);
                    const NewPos = LineStart + NewIndent.length + Trimmed.length;
                    Textarea.value = NewText;
                    OnContentChange(NewText);
                    PendingCursorRef.current = { Start: NewPos, End: NewPos };
                    return;
                }
            }
        }

        if (E.key.length === 1 && !E.ctrlKey && !E.altKey && !E.metaKey) {
            const Closer = AutoClosePairs[E.key];
            if (Closer !== undefined) {
                const IsSymmetric = E.key === Closer;

                if (IsSymmetric && Start === End && Text[Start] === E.key) {
                    E.preventDefault();
                    Textarea.selectionStart = Start + 1;
                    Textarea.selectionEnd   = Start + 1;
                    UpdateCursor();
                    return;
                }

                if (Start !== End) {
                    E.preventDefault();
                    const Selected = Text.slice(Start, End);
                    const NewText = Text.slice(0, Start) + E.key + Selected + Closer + Text.slice(End);
                    Textarea.value = NewText;
                    OnContentChange(NewText);
                    PendingCursorRef.current = { Start: Start + 1, End: End + 1 };
                    return;
                }

                E.preventDefault();
                const NewText = Text.slice(0, Start) + E.key + Closer + Text.slice(End);
                Textarea.value = NewText;
                OnContentChange(NewText);
                PendingCursorRef.current = { Start: Start + 1, End: Start + 1 };
                return;
            }
        }

        if (E.key === '/' && E.ctrlKey && !E.shiftKey && !E.altKey) {
            E.preventDefault();
            const CommentStr = (LangComment[Language] ?? '//') + ' ';
            const CommentTrim = CommentStr.trimEnd();

            const FirstLineStart = Text.lastIndexOf('\n', Start - 1) + 1;
            const ScanFrom = Math.max(Start, FirstLineStart);
            const NextNewline = Text.indexOf('\n', ScanFrom);
            const BlockEnd = NextNewline === -1 ? Text.length : NextNewline;

            const LineArr = Text.slice(FirstLineStart, BlockEnd).split('\n');
            const AllCommented = LineArr.every(L => {
                const T = L.trimStart();
                return T.length === 0 || T.startsWith(CommentTrim);
            });

            let Delta0 = 0;
            let DeltaTotal = 0;
            const NewLines = LineArr.map((L, I) => {
                const Leading = L.length - L.trimStart().length;
                const T = L.trimStart();
                if (T.length === 0) return L;
                let D: number;
                let R: string;
                if (AllCommented) {
                    if (T.startsWith(CommentStr)) {
                        D = -CommentStr.length; R = L.slice(0, Leading) + T.slice(CommentStr.length);
                    } else {
                        D = -CommentTrim.length; R = L.slice(0, Leading) + T.slice(CommentTrim.length);
                    }
                } else {
                    D = CommentStr.length; R = L.slice(0, Leading) + CommentStr + T;
                }
                if (I === 0) Delta0 = D;
                DeltaTotal += D;
                return R;
            });

            const NewText = Text.slice(0, FirstLineStart) + NewLines.join('\n') + Text.slice(BlockEnd);
            Textarea.value = NewText;
            OnContentChange(NewText);
            if (Start === End) {
                const P = Math.max(FirstLineStart, Start + Delta0);
                PendingCursorRef.current = { Start: P, End: P };
            } else {
                PendingCursorRef.current = {
                    Start: Math.max(FirstLineStart, Start + Delta0),
                    End: Math.max(Start, End + DeltaTotal),
                };
            }
            return;
        }

        if (E.key === 'd' && E.ctrlKey && !E.shiftKey && !E.altKey) {
            E.preventDefault();
            if (Start === End) {
                const LineStart = Text.lastIndexOf('\n', Start - 1) + 1;
                const LineEnd = Text.indexOf('\n', Start);
                const Line = Text.slice(LineStart, LineEnd === -1 ? Text.length : LineEnd);
                let NewText: string;
                let NewPos: number;
                if (LineEnd === -1) {
                    NewText = Text + '\n' + Line;
                    NewPos = Text.length + 1 + (Start - LineStart);
                } else {
                    NewText = Text.slice(0, LineEnd + 1) + Line + '\n' + Text.slice(LineEnd + 1);
                    NewPos = LineEnd + 1 + (Start - LineStart);
                }
                Textarea.value = NewText;
                OnContentChange(NewText);
                PendingCursorRef.current = { Start: NewPos, End: NewPos };
            } else {
                const Selected = Text.slice(Start, End);
                const NewText = Text.slice(0, End) + Selected + Text.slice(End);
                Textarea.value = NewText;
                OnContentChange(NewText);
                PendingCursorRef.current = { Start: End, End: End + Selected.length };
            }
            return;
        }

        if ((E.key === 'ArrowUp' || E.key === 'ArrowDown') && E.altKey && !E.ctrlKey && !E.shiftKey) {
            E.preventDefault();
            const FirstLineStart = Text.lastIndexOf('\n', Start - 1) + 1;
            const ScanFrom = Math.max(End > 0 ? End - 1 : 0, FirstLineStart);
            const LastLineEnd = Text.indexOf('\n', ScanFrom);
            const BlockEnd = LastLineEnd === -1 ? Text.length : LastLineEnd;
            const Block = Text.slice(FirstLineStart, BlockEnd);

            if (E.key === 'ArrowUp') {
                if (FirstLineStart === 0) return;
                const PrevLineEnd = FirstLineStart - 1;
                const PrevLineStart = Text.lastIndexOf('\n', PrevLineEnd - 1) + 1;
                const PrevLine = Text.slice(PrevLineStart, PrevLineEnd);
                const NewText = Text.slice(0, PrevLineStart) + Block + '\n' + PrevLine + Text.slice(BlockEnd);
                const Shift = -(PrevLine.length + 1);
                Textarea.value = NewText;
                OnContentChange(NewText);
                PendingCursorRef.current = { Start: Start + Shift, End: End + Shift };
            } else {
                if (BlockEnd === Text.length) return;
                const NextLineStart = BlockEnd + 1;
                const NextLineEnd = Text.indexOf('\n', NextLineStart);
                const NextLine = Text.slice(NextLineStart, NextLineEnd === -1 ? Text.length : NextLineEnd);
                const ActualNextEnd = NextLineEnd === -1 ? Text.length : NextLineEnd;
                const NewText = Text.slice(0, FirstLineStart) + NextLine + '\n' + Block + Text.slice(ActualNextEnd);
                const Shift = NextLine.length + 1;
                Textarea.value = NewText;
                OnContentChange(NewText);
                PendingCursorRef.current = { Start: Start + Shift, End: End + Shift };
            }
            return;
        }

        if (E.key === 'Tab') {
            E.preventDefault();

            if (E.shiftKey) {
                const FirstLineStart = Text.lastIndexOf('\n', Start - 1) + 1;
                const LastLineEnd = Text.indexOf('\n', End);
                const BlockEnd = LastLineEnd === -1 ? Text.length : LastLineEnd;
                const Block = Text.slice(FirstLineStart, BlockEnd);
                const BlockLines = Block.split('\n');
                let RemovedFirst = 0;
                const Dedented = BlockLines.map((L, I) => {
                    const Remove = Math.min(4, L.length - L.trimStart().length);
                    if (I === 0) RemovedFirst = Remove;
                    return L.slice(Remove);
                }).join('\n');
                const NewText = Text.slice(0, FirstLineStart) + Dedented + Text.slice(BlockEnd);
                const Removed = Block.length - Dedented.length;
                Textarea.value = NewText;
                OnContentChange(NewText);
                PendingCursorRef.current = {
                    Start: Math.max(FirstLineStart, Start - RemovedFirst),
                    End: Math.max(Start - RemovedFirst, End - Removed),
                };
            } else if (Start === End) {
                const NewText = Text.slice(0, Start) + '    ' + Text.slice(End);
                Textarea.value = NewText;
                OnContentChange(NewText);
                PendingCursorRef.current = { Start: Start + 4, End: Start + 4 };
            } else {
                const FirstLineStart = Text.lastIndexOf('\n', Start - 1) + 1;
                const LastLineEnd = Text.indexOf('\n', End - 1);
                const BlockEnd = LastLineEnd === -1 ? Text.length : LastLineEnd;
                const Block = Text.slice(FirstLineStart, BlockEnd);
                const BlockLines = Block.split('\n');
                const Indented = BlockLines.map(L => '    ' + L).join('\n');
                const NewText = Text.slice(0, FirstLineStart) + Indented + Text.slice(BlockEnd);
                const Added = BlockLines.length * 4;
                Textarea.value = NewText;
                OnContentChange(NewText);
                PendingCursorRef.current = { Start: Start + 4, End: End + Added };
            }
            return;
        }

        if (E.key === 'Enter') {
            E.preventDefault();

            const LineStart = Text.lastIndexOf('\n', Start - 1) + 1;
            const CurrentLine = Text.slice(LineStart, Start);
            const Indent = CurrentLine.match(/^(\s*)/)?.[1] ?? '';
            const Trimmed = CurrentLine.trimEnd();
            const Bare = Trimmed.trimStart();

            let BlockClose: string | null = null;
            for (const Rule of (LangBlocks[Language] ?? [])) {
                if (Rule.Open.test(Bare)) { BlockClose = Rule.Close; break; }
            }

            if (BlockClose && Start === End && ShouldAutoClose(Text, End, Indent, BlockClose)) {
                const Inner = Indent + '    ';
                const NewText = Text.slice(0, Start) + '\n' + Inner + '\n' + Indent + BlockClose + Text.slice(Start);
                const NewPos = Start + 1 + Inner.length;
                Textarea.value = NewText;
                OnContentChange(NewText);
                PendingCursorRef.current = { Start: NewPos, End: NewPos };
                return;
            }

            const OpensBlock =
                BlockClose !== null ||
                /[\{\(\[]$/.test(Trimmed) ||
                /\b(then|do|else|elseif|repeat|function)(\s*\(.*\))?\s*$/.test(Trimmed) ||
                /:\s*$/.test(Trimmed);

            const NewIndent = OpensBlock ? Indent + '    ' : Indent;

            const CharAfter = Text[End];
            const IsBetween = OpensBlock && (CharAfter === '}' || CharAfter === ')' || CharAfter === ']');

            let NewText: string;
            let NewPos: number;

            if (IsBetween) {
                NewText = Text.slice(0, Start) + '\n' + NewIndent + '\n' + Indent + Text.slice(End);
                NewPos = Start + 1 + NewIndent.length;
            } else {
                NewText = Text.slice(0, Start) + '\n' + NewIndent + Text.slice(End);
                NewPos = Start + 1 + NewIndent.length;
            }

            Textarea.value = NewText;
            OnContentChange(NewText);
            PendingCursorRef.current = { Start: NewPos, End: NewPos };
            return;
        }

        UpdateCursor();
    }, [UpdateCursor, OnContentChange, Language, IsSearchOpen, HandleSearchClose,
        CompletionItems, CompletionIndex, AcceptCompletion, DismissCompletions]);

    const HandleMouseUp = useCallback(() => {
        const Textarea = TextAreaRef.current;
        if (Textarea) UpdateCursorFromTextarea(Textarea);
    }, []);

    const HandleTextAreaMouseDown = useCallback(() => {
    }, []);

    const HandleTextAreaMouseMove = useCallback(() => {
    }, []);

    const HandleLineNumberClick = useCallback((LineIndex: number) => {
        const Textarea = TextAreaRef.current;
        if (!Textarea) return;
        const LineStart = LineOffsetsRef.current[LineIndex] ?? 0;
        const LineEnd   = LineStart + VisibleLineEnd(Lines[LineIndex] ?? "");
        Textarea.focus();
        Textarea.setSelectionRange(LineEnd, LineEnd);
        UpdateCursor();
    }, [Lines, UpdateCursor]);

    const HandleFocus = useCallback(() => SetIsFocused(true), []);
    const HandleBlur  = useCallback(() => SetIsFocused(false), []);

    const HandleTextAreaScroll = useCallback(() => {
        const Textarea = TextAreaRef.current;
        if (!Textarea) return;

        Textarea.classList.add(styles.Scrolling);
        if (ScrollFadeRef.current !== null) clearTimeout(ScrollFadeRef.current);
        ScrollFadeRef.current = setTimeout(() => {
            ScrollFadeRef.current = null;
            TextAreaRef.current?.classList.remove(styles.Scrolling);
        }, 800);

        const NewScrollTop = Textarea.scrollTop;
        ActualScrollTopRef.current = NewScrollTop;

        if (LineNumbersRef.current) {
            LineNumbersRef.current.scrollTop = NewScrollTop;
        }
        if (OverlayRef.current) {
            OverlayRef.current.scrollTop  = NewScrollTop;
            OverlayRef.current.scrollLeft = Textarea.scrollLeft;
        }
        if (SearchOverlayRef.current) {
            SearchOverlayRef.current.scrollTop  = NewScrollTop;
            SearchOverlayRef.current.scrollLeft = Textarea.scrollLeft;
        }
        if (EditorWrapperRef.current && LhRef.current > 0) {
            EditorWrapperRef.current.style.setProperty("--cursor-top", `${14 + (CursorLineRef.current - 1) * LhRef.current - NewScrollTop}px`);
        }
        if (LhRef.current > 0) {
            const OldLine = Math.floor((ScrollTopPxRef.current - 14) / LhRef.current);
            const NewLine = Math.floor((NewScrollTop - 14) / LhRef.current);
            if (NewLine !== OldLine && RafRef.current === null) {
                RafRef.current = requestAnimationFrame(() => {
                    RafRef.current = null;
                    const Latest = ActualScrollTopRef.current;
                    ScrollTopPxRef.current = Latest;
                    SetScrollTopPx(Latest);
                });
            }
        }
    }, []);
    useEffect(() => {
        return () => {
            if (RafRef.current !== null) {
                try { cancelAnimationFrame(RafRef.current); } catch (e) {}
                RafRef.current = null;
            }
            if (ScrollFadeRef.current !== null) {
                clearTimeout(ScrollFadeRef.current);
                ScrollFadeRef.current = null;
            }
        };
    }, []);
    useEffect(() => {
        const Observer = new MutationObserver(() => SetLH(ComputeLH()));
        Observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
        return () => Observer.disconnect();
    }, []);
    useEffect(() => {
        const W = new Worker(new URL('../services/Tokenizer.worker.ts', import.meta.url), { type: 'module' });
        WorkerRef.current = W;
        W.onmessage = (E: MessageEvent<{ Version: number; Tokens: Token[]; VisStart: number }>) => {
            if (E.data.Version !== WorkerVersionRef.current) return;
            SetTokensPacket({ Tokens: E.data.Tokens, Start: E.data.VisStart });
        };
        return () => {
            W.terminate();
            WorkerRef.current = null;
        };
    }, []);
    useEffect(() => {
        if (!WorkerRef.current) return;
        WorkerVersionRef.current++;
        WorkerRef.current.postMessage({ Version: WorkerVersionRef.current, Text: VisText, Lang: Language, VisStart });
    }, [VisText, Language]);

    useEffect(() => {
        if (TextAreaRef.current) TextAreaRef.current.focus();
    }, []);

    useEffect(() => {
        const Measure = () => {
            const C = document.createElement("canvas");
            const X = C.getContext("2d");
            if (!X) return;
            const Fs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--editor-font-size")) || 11.5;
            X.font = `400 ${Fs}px 'JetBrains Mono', monospace`;
            const W = X.measureText("x").width;
            if (W > 0) CharWidthRef.current = W;
        };
        if (document.fonts?.ready) {
            document.fonts.ready.then(Measure);
        } else {
            Measure();
        }
    }, []);

    useEffect(() => {
        if (TabsContainerRef.current && ActiveFile) {
            const ActiveTab = TabsContainerRef.current.querySelector(`[data-path="${CSS.escape(ActiveFile)}"]`);
            if (ActiveTab) {
                ActiveTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            }
        }
    }, [ActiveFile]);

    const HandleTabCloseClick = useCallback((E: React.MouseEvent, Path: string) => {
        E.stopPropagation();
        SetClosingTabs(Prev => new Set(Prev).add(Path));
    }, []);

    const HandleTabExitEnd = useCallback((Path: string) => {
        SetClosingTabs(Prev => {
            const Next = new Set(Prev);
            Next.delete(Path);
            return Next;
        });
        OnTabClose?.(Path);
    }, [OnTabClose]);

    const EditorAnimClass = (() => {
        if (SwitchDir === "down") return styles.SlideFromBelow;
        if (SwitchDir === "up") return styles.SlideFromAbove;
        if (TabDir === "right") return styles.SlideFromRight;
        if (TabDir === "left") return styles.SlideFromLeft;
        return styles.FadeIn;
    })();

    const ActiveTabIsViewport = ActiveTabEntry?.Type === 'viewport';

    return (
        <div className={`${styles.Container} ${IsFocused ? styles.Focused : ""}`}>
            <div className={styles.Tabs} ref={TabsContainerRef}>
                {OpenTabs.map((Tab) => {
                    const IsClosing = ClosingTabs.has(Tab.Path);
                    const IsModified = Tab.Type !== 'viewport' && (
                        Tab.Path === ActiveFile
                            ? (ActiveFileModified ?? Tab.Content !== Tab.DiskContent)
                            : Tab.Content !== Tab.DiskContent
                    );
                    const IsViewport = Tab.Type === 'viewport';
                    return (
                        <div
                            key={Tab.Path}
                            data-path={Tab.Path}
                            className={`${styles.Tab} ${Tab.Path === ActiveFile ? styles.ActiveTab : ""} ${IsClosing ? styles.TabClosing : ""} ${Tab.Path === ActiveFile && ShowSavedFlash && !IsViewport ? styles.TabSaved : ""} ${IsModified ? styles.TabModified : ""} ${IsViewport ? styles.ViewportTab : ""}`}
                            style={IsViewport ? undefined : TabColorStyle(Tab.Name)}
                            onClick={() => !IsClosing && OnTabSelect?.(Tab.Path)}
                            onAnimationEnd={IsClosing ? () => HandleTabExitEnd(Tab.Path) : undefined}
                        >
                            <span
                                className={styles.TabDot}
                                onClick={IsModified ? (E) => { E.stopPropagation(); OnSaveFile?.(Tab.Path); } : undefined}
                                title={IsModified ? "Click to save" : undefined}
                            />
                            <span>{Tab.Name}</span>
                            <button
                                className={styles.TabClose}
                                onClick={(E) => HandleTabCloseClick(E, Tab.Path)}
                            >
                                ×
                            </button>
                        </div>
                    );
                })}
            </div>
            {OpenTabs.length === 0 && !ActiveFile && !ClassicWelcome ? (
                <div className={styles.WelcomePanel}>
                    <div className={styles.WelcomeHeader}>
                        <span className={styles.WelcomeTitle}>Welcome to Nyx</span>
                        <span className={styles.WelcomeVersion}>v0.3.0</span>
                    </div>
                    <div className={styles.WelcomeDivider} />
                    <div className={styles.WelcomeWhatsNew}>
                        <div className={styles.WelcomeNotice}>
                            <span className={styles.WelcomeNoticeKicker}>Temporary</span>
                            <span className={styles.WelcomeNoticeTitle}>Agentic mode limited</span>
                            <p className={styles.WelcomeNoticeBody}>
                                Agentic mode runs many chained API calls to work on its own, and on
                                <strong> OpenAI</strong> and <strong>Anthropic</strong> those tokens add up faster
                                than we can sustain right now. So for those two providers Agentic is paused — they
                                still run <strong>Supervised</strong> and <strong>Autonomous</strong> as normal.
                            </p>
                            <p className={styles.WelcomeNoticeBody}>
                                <strong>DeepSeek</strong> is inexpensive enough to keep every mode, including Agentic,
                                so it's unaffected. We're reworking agentic mode to bring its cost down and will lift
                                the limit on OpenAI and Anthropic as soon as it's ready.
                            </p>
                            <span className={styles.WelcomeNoticeEta}>
                                Est. ~1 week (around June 21), a rough target, not a firm date
                            </span>
                        </div>
                        <div className={styles.WelcomeChangelog}>
                            <div className={styles.WelcomeChangelogLabel}>What's New</div>
                            <PatchNotesList />
                        </div>
                    </div>
                    <div className={styles.WelcomeDivider} />
                    <div className={styles.WelcomeChangelog}>
                        <div className={styles.WelcomeChangelogLabel}>Coming Up</div>
                        <RoadmapList />
                    </div>
                    <button className={styles.ViewLogBtn} onClick={() => SetShowUpdateLog(true)}>
                        View full update log
                    </button>
                </div>
            ) : ActiveTabIsViewport ? (
                <div className={styles.ViewportContainer}>
                    {ViewportContent}
                </div>
            ) : (
                <>
                    <div className={styles.Breadcrumb}>
                        <span>workspace</span>
                        <span className={styles.Sep}>›</span>
                        <span>{FileName}</span>
                    </div>
                    {IsSearchOpen && (
                        <SearchBar
                            Term={SearchTerm}
                            ReplaceTerm={ReplaceTerm}
                            OnTermChange={SetSearchTerm}
                            OnReplaceTermChange={SetReplaceTerm}
                            MatchCount={Matches.length}
                            CurrentMatch={CurrentMatchIndex}
                            OnPrev={HandleSearchPrev}
                            OnNext={HandleSearchNext}
                            OnReplace={HandleReplaceCurrent}
                            OnReplaceAll={HandleReplaceAll}
                            OnClose={HandleSearchClose}
                        />
                    )}
                    <div
                        className={`${styles.EditorWrapper} ${EditorAnimClass}`}
                        ref={EditorWrapperRef}
                        key={ActiveFile ?? "empty"}
                        style={{
                            '--cursor-line': CursorLine - 1,
                            '--cursor-top': `${14 + (CursorLineRef.current - 1) * LhRef.current - ActualScrollTopRef.current}px`,
                            '--cursor-height': `${LH}px`,
                        } as React.CSSProperties}
                    >
                        <div className={styles.CurrentLineHighlight} />
                        <div
                            className={styles.LineNumbers}
                            ref={LineNumbersRef}
                            style={{
                                '--line-number-cursor-top': `${14 + (CursorLine - 1) * LH}px`,
                                '--line-number-cursor-height': `${LH}px`,
                            } as React.CSSProperties}
                        >
                            <div className={styles.LineNumberCursor} aria-hidden />
                            <div style={{ height: `${VisStart * LH}px` }} aria-hidden />
                            {Lines.slice(VisStart, VisEnd).map((_, I) => {
                                const LineNumber = VisStart + I + 1;
                                const LineDiagnostics = DiagnosticsByLine.get(LineNumber) ?? [];
                                const HasError = LineDiagnostics.some(Diagnostic => Diagnostic.Severity === "error");
                                const HasWarning = LineDiagnostics.length > 0 && !HasError;
                                const IsDirty = DirtyLines.has(LineNumber);
                                const Title = LineDiagnostics.map(Diagnostic => Diagnostic.Message).join("\n") || undefined;
                                return (
                                    <div
                                        key={VisStart + I}
                                        className={`${styles.LineNum} ${LineNumber === CursorLine ? styles.ActiveLine : ""} ${IsDirty ? styles.DirtyLine : ""} ${HasError ? styles.ErrorLine : ""} ${HasWarning ? styles.WarningLine : ""}`}
                                        onClick={() => HandleLineNumberClick(VisStart + I)}
                                        title={Title}
                                    >
                                        {IsDirty && <span className={styles.DirtyMarker} aria-hidden />}
                                        {LineDiagnostics.length > 0 && <span className={styles.DiagnosticMarker} aria-hidden />}
                                        {LineNumber}
                                    </div>
                                );
                            })}
                            <div style={{ height: `${(Lines.length - VisEnd) * LH}px` }} aria-hidden />
                        </div>
                        <div className={styles.CodeArea}>
                            <HighlightOverlay
                                Tokens={TokensPacket.Tokens}
                                ClassName={styles.Overlay}
                                ScrollRef={OverlayRef}
                                TotalHeight={TotalHeight}
                                VisStart={TokensPacket.Start}
                                LH={LH}
                            />
                            {CompletionItems.length > 0 && (
                                <CompletionPopup
                                    Items={CompletionItems}
                                    SelectedIndex={CompletionIndex}
                                    Top={CompletionPos.Top}
                                    Left={CompletionPos.Left}
                                    MaxTop={EditorWrapperRef.current?.clientHeight ?? 600}
                                    ItemHeight={LH}
                                    OnSelect={AcceptCompletion}
                                />
                            )}
                            {Signature && CompletionItems.length === 0 && (
                                <div
                                    className={styles.SignatureHelp}
                                    style={{
                                        top: 14 + CursorLineRef.current * LhRef.current - ActualScrollTopRef.current,
                                        left: 46 + 20 + Math.max(CursorColRef.current - 1, 0) * CharWidthRef.current,
                                    }}
                                >
                                    <span className={styles.SignatureName}>{Signature.Label}</span>
                                    <span className={styles.SignatureParams}>
                                        {Signature.Parameters.map((Param, I) => (
                                            <span
                                                key={`${Param}_${I}`}
                                                className={I === Signature.ActiveParameter ? styles.SignatureParamActive : styles.SignatureParam}
                                            >
                                                {Param}
                                            </span>
                                        ))}
                                    </span>
                                </div>
                            )}
                            <textarea
                                ref={TextAreaRef}
                                className={styles.TextArea}
                                defaultValue={FileContent}
                                onChange={HandleTextAreaChange}
                                onKeyDown={HandleKeyDown}
                                onMouseDown={HandleTextAreaMouseDown}
                                onMouseMove={HandleTextAreaMouseMove}
                                onMouseUp={HandleMouseUp}
                                onFocus={HandleFocus}
                                onBlur={HandleBlur}
                                onScroll={HandleTextAreaScroll}
                                spellCheck={false}
                                wrap="off"
                            />
                            {IsSearchOpen && SearchHighlights && (
                                <div className={styles.SearchOverlay} ref={SearchOverlayRef} aria-hidden>
                                    {SearchHighlights}
                                </div>
                            )}
                        </div>
                        {(MatchLineNumbers.length > 0 || DiagnosticLineNumbers.length > 0 || DirtyLineNumbers.length > 0) && (
                            <div className={styles.SearchScrollTrack}>
                                {DirtyLineNumbers.map((Line, I) => (
                                    <div
                                        key={`d${I}`}
                                        className={styles.DirtyScrollDot}
                                        style={{ top: `${((Line - 1) / Math.max(Lines.length - 1, 1)) * 100}%` }}
                                    />
                                ))}
                                {DiagnosticLineNumbers.map((Line, I) => (
                                    <div
                                        key={`x${I}`}
                                        className={styles.DiagnosticScrollDot}
                                        style={{ top: `${((Line - 1) / Math.max(Lines.length - 1, 1)) * 100}%` }}
                                        title={(DiagnosticsByLine.get(Line) ?? []).map(Diagnostic => Diagnostic.Message).join("\n")}
                                    />
                                ))}
                                {MatchLineNumbers.map((Line, I) => (
                                    <div
                                        key={I}
                                        className={`${
                                            I === CurrentMatchIndex
                                                ? styles.SearchScrollDotActive
                                                : Matches[I].Kind === 'fuzzy'
                                                ? styles.SearchScrollDotFuzzy
                                                : styles.SearchScrollDot
                                        }`}
                                        style={{ top: `${((Line - 1) / Math.max(Lines.length - 1, 1)) * 100}%` }}
                                        onClick={() => JumpToMatch(I)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
            <UpdateLogPanel IsOpen={ShowUpdateLog} OnClose={() => SetShowUpdateLog(false)} />
        </div>
    );
};
