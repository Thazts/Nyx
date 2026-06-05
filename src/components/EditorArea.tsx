import React, { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from "react";
import styles from "../styles/EditorArea.module.css";
import { DetectLanguage, type Token } from "../services/Tokenizer";
import { HighlightOverlay } from "./HighlightOverlay";
import { SearchBar } from "./SearchBar";
import { UILib, UsePanel } from "../ui/UILib";

const OVERSCAN        = 80;
const FUZZY_THRESHOLD = 3_000;

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
};

const LangClosers: Record<string, string[]> = {
    luau:       ['end', 'until'],
    typescript: [], javascript: [], rust:     [], css:      [], json:     [],
    python:     [], toml:        [], yaml:    [], bash:     [], wgsl:     [],
    glsl:       [], c:           [], cpp:     [], go:       [], csharp:   [],
    java:       [], sql:         [], markdown:[], xml:      [], html:     [],
};

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
    const [CursorLine, SetCursorLine] = useState(1);
    const [, SetCursorCol] = useState(1);
    const [IsFocused, SetIsFocused] = useState(false);
    const [TabDir, SetTabDir] = useState<"left" | "right" | "none">("none");
    const [CurrentMatchIndex, SetCurrentMatchIndex] = useState(0);
    const [ClosingTabs, SetClosingTabs] = useState<Set<string>>(new Set());
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
    const [VisTokens, SetVisTokens] = useState<Token[]>([]);

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

    // O(matches * log n) instead of O(matches * n)
    const MatchLineNumbers = useMemo(() => {
        const Offsets = LineOffsets;
        return Matches.map(M => LineFromOffset(Offsets, M.Start) + 1);
    }, [Matches, LineOffsets]);

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

    const HandleSearchClose = useCallback(() => {
        UILib.Hide("Search");
        UILib.SetView("explorer");
        SetSearchTerm("");
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

    // Cursor position via O(log n) binary search on LineOffsets
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

    const HandleTextAreaChange = useCallback((E: React.ChangeEvent<HTMLTextAreaElement>) => {
        OnContentChange(E.target.value);
        UpdateCursorFromTextarea(E.target);
    }, [OnContentChange]);

    const HandleKeyDown = useCallback((E: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const Textarea = TextAreaRef.current;
        if (!Textarea) { UpdateCursor(); return; }

        const Text  = Textarea.value;
        const Start = Textarea.selectionStart;
        const End   = Textarea.selectionEnd;

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

            const OpensBlock =
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
    }, [UpdateCursor, OnContentChange, Language, IsSearchOpen, HandleSearchClose]);

    const HandleMouseUp = useCallback(() => {
        const Textarea = TextAreaRef.current;
        if (Textarea) UpdateCursorFromTextarea(Textarea);
    }, []);

    const HandleTextAreaMouseDown = useCallback(() => {
        // Let browser handle clicks natively
    }, []);

    const HandleTextAreaMouseMove = useCallback(() => {
        // Let browser handle drag natively
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

        // Update cursor position CSS
        if (EditorWrapperRef.current && LhRef.current > 0) {
            EditorWrapperRef.current.style.setProperty("--cursor-top", `${14 + (CursorLineRef.current - 1) * LhRef.current - NewScrollTop}px`);
        }
        if (LhRef.current > 0) {
            const OldLine = Math.floor((ScrollTopPxRef.current - 14) / LhRef.current);
            const NewLine = Math.floor((NewScrollTop - 14) / LhRef.current);
            if (NewLine !== OldLine) {
                ScrollTopPxRef.current = NewScrollTop;
                SetScrollTopPx(NewScrollTop);
            }
        }
    }, []);
    useEffect(() => {
        return () => {
            if (RafRef.current !== null) {
                try { cancelAnimationFrame(RafRef.current); } catch (e) {}
                RafRef.current = null;
            }
        };
    }, []);

    // Sync overlays when virtual window changes
    useEffect(() => {
        if (LineNumbersRef.current) {
            LineNumbersRef.current.scrollTop = ScrollTopPx;
        }
        if (OverlayRef.current) {
            OverlayRef.current.scrollTop = ScrollTopPx;
        }
        if (SearchOverlayRef.current) {
            SearchOverlayRef.current.scrollTop = ScrollTopPx;
        }
    }, [ScrollTopPx]);

    // Recompute LH when font-size or line-height settings change (style attr on <html>)
    useEffect(() => {
        const Observer = new MutationObserver(() => SetLH(ComputeLH()));
        Observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
        return () => Observer.disconnect();
    }, []);

    // Worker lifecycle — create once, terminate on unmount
    useEffect(() => {
        const W = new Worker(new URL('../services/Tokenizer.worker.ts', import.meta.url), { type: 'module' });
        WorkerRef.current = W;
        W.onmessage = (E: MessageEvent<{ Version: number; Tokens: Token[] }>) => {
            if (E.data.Version !== WorkerVersionRef.current) return;
            SetVisTokens(E.data.Tokens);
        };
        return () => {
            W.terminate();
            WorkerRef.current = null;
        };
    }, []);

    // Dispatch tokenisation to worker whenever the visible text or language changes
    useEffect(() => {
        if (!WorkerRef.current) return;
        WorkerVersionRef.current++;
        WorkerRef.current.postMessage({ Version: WorkerVersionRef.current, Text: VisText, Lang: Language });
    }, [VisText, Language]);

    useEffect(() => {
        if (TextAreaRef.current) TextAreaRef.current.focus();
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

    const ActiveTabIsViewport = OpenTabs.find(T => T.Path === ActiveFile)?.Type === 'viewport';

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
            {ActiveTabIsViewport ? (
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
                            OnTermChange={SetSearchTerm}
                            MatchCount={Matches.length}
                            CurrentMatch={CurrentMatchIndex}
                            OnPrev={HandleSearchPrev}
                            OnNext={HandleSearchNext}
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
                            {Lines.slice(VisStart, VisEnd).map((_, I) => (
                                <div
                                    key={VisStart + I}
                                    className={`${styles.LineNum} ${VisStart + I + 1 === CursorLine ? styles.ActiveLine : ""}`}
                                    onClick={() => HandleLineNumberClick(VisStart + I)}
                                >
                                    {VisStart + I + 1}
                                </div>
                            ))}
                            <div style={{ height: `${(Lines.length - VisEnd) * LH}px` }} aria-hidden />
                        </div>
                        <div className={styles.CodeArea}>
                            <HighlightOverlay
                                Tokens={VisTokens}
                                ClassName={styles.Overlay}
                                ScrollRef={OverlayRef}
                                TotalHeight={TotalHeight}
                                VisStart={VisStart}
                                LH={LH}
                            />
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
                            {IsSearchOpen && MatchLineNumbers.length > 0 && (
                            <div className={styles.SearchScrollTrack}>
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
        </div>
    );
};
