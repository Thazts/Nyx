import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import styles from "../styles/EditorArea.module.css";
import { Tokenize, DetectLanguage } from "../services/Tokenizer";
import { HighlightOverlay } from "./HighlightOverlay";
import { SearchBar } from "./SearchBar";
import { UILib, UsePanel } from "../ui/UILib";

const LangComment: Record<string, string> = {
    luau:       '--',
    typescript: '//',
    javascript: '//',
    rust:       '//',
    css:        '//',
    json:       '//',
};

const LangClosers: Record<string, string[]> = {
    luau:       ['end', 'until'],
    typescript: [],
    javascript: [],
    rust:       [],
    css:        [],
    json:       [],
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

interface TabEntry {
    Path: string;
    Name: string;
    Content: string;
    DiskContent: string;
    Type?: 'file' | 'viewport';
}

interface EditorAreaProps {
    FileContent:      string;
    FileName:         string;
    OnContentChange:  (Content: string) => void;
    OnCursorChange?:  (Line: number, Col: number) => void;
    OpenTabs?:        TabEntry[];
    ActiveFile?:      string | null;
    OnTabClose?:      (Path: string) => void;
    OnTabSelect?:     (Path: string) => void;
    OnSaveFile?:      (Path: string) => void;
    SwitchDir?:       "up" | "down" | "none";
    ShowSavedFlash?:  boolean;
    ViewportContent?: React.ReactNode;
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
}) => {
    const IsSearchOpen = UsePanel("Search");
    const [SearchTerm, SetSearchTerm] = useState("");
    const [CursorLine, SetCursorLine] = useState(1);
    const [, SetCursorCol] = useState(1);
    const [IsFocused, SetIsFocused] = useState(false);
    const [TabDir, SetTabDir] = useState<"left" | "right" | "none">("none");
    const [CurrentMatchIndex, SetCurrentMatchIndex] = useState(0);
    const [ClosingTabs, SetClosingTabs] = useState<Set<string>>(new Set());
    const [IsScrolling, SetIsScrolling] = useState(false);
    const TextAreaRef = useRef<HTMLTextAreaElement>(null);
    const LineNumbersRef = useRef<HTMLDivElement>(null);
    const OverlayRef = useRef<HTMLDivElement>(null);
    const SearchOverlayRef = useRef<HTMLDivElement>(null);
    const TabsContainerRef = useRef<HTMLDivElement>(null);
    const PrevTabIndexRef = useRef<number>(-1);
    const ScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const PendingCursorRef = useRef<{ Start: number; End: number } | null>(null);

    const Lines = useMemo(() => FileContent.split("\n"), [FileContent]);
    const Language = useMemo(() => DetectLanguage(FileName), [FileName]);
    const Tokens = useMemo(() => Tokenize(FileContent, Language), [FileContent, Language]);

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

        if (TLen >= 3) {
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
    }, [FileContent, SearchTerm]);

    const MatchLineNumbers = useMemo(() =>
        Matches.map(M => FileContent.slice(0, M.Start).split('\n').length)
    , [Matches, FileContent]);

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

    const JumpToMatch = useCallback((Idx: number) => {
        if (Matches.length === 0 || !TextAreaRef.current) return;
        SetCurrentMatchIndex(Idx);
        const { Start, Len } = Matches[Idx];
        const LH = 1.78 * 11.5;
        const LinesBefore = FileContent.slice(0, Start).split('\n').length - 1;
        const ScrollTo = Math.max(0, LinesBefore * LH - TextAreaRef.current.clientHeight / 3);
        TextAreaRef.current.scrollTop = ScrollTo;
        if (LineNumbersRef.current)   LineNumbersRef.current.scrollTop = ScrollTo;
        if (OverlayRef.current)       OverlayRef.current.scrollTop = ScrollTo;
        if (SearchOverlayRef.current) SearchOverlayRef.current.scrollTop = ScrollTo;
        TextAreaRef.current.focus();
        TextAreaRef.current.setSelectionRange(Start, Start + Len);
    }, [Matches, FileContent]);

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
        SetCurrentMatchIndex(0);
        if (!IsSearchOpen || Matches.length === 0 || !SearchTerm || !TextAreaRef.current) return;
        const { Start, Len } = Matches[0];
        const LH = 1.78 * 11.5;
        const LinesBefore = FileContent.slice(0, Start).split('\n').length - 1;
        const ScrollTo = Math.max(0, LinesBefore * LH - TextAreaRef.current.clientHeight / 3);
        TextAreaRef.current.scrollTop = ScrollTo;
        if (LineNumbersRef.current)   LineNumbersRef.current.scrollTop = ScrollTo;
        if (OverlayRef.current)       OverlayRef.current.scrollTop = ScrollTo;
        if (SearchOverlayRef.current) SearchOverlayRef.current.scrollTop = ScrollTo;
        TextAreaRef.current.setSelectionRange(Start, Start + Len);
    }, [Matches]);

    useEffect(() => {
        SetCursorLine(1);
        SetCursorCol(1);
        if (OnCursorChange) OnCursorChange(1, 1);
    }, [ActiveFile]);

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

    useEffect(() => {
        if (PendingCursorRef.current !== null && TextAreaRef.current) {
            const { Start, End } = PendingCursorRef.current;
            PendingCursorRef.current = null;
            TextAreaRef.current.selectionStart = Start;
            TextAreaRef.current.selectionEnd = End;
        }
    });

    const UpdateCursor = useCallback(() => {
        const Textarea = TextAreaRef.current;
        if (!Textarea) return;
        const Pos = Textarea.selectionStart;
        const Text = Textarea.value;
        const Before = Text.substring(0, Pos);
        const LineNum = Before.split("\n").length;
        const LastNewline = Before.lastIndexOf("\n");
        const ColNum = LastNewline === -1 ? Pos + 1 : Pos - LastNewline;
        SetCursorLine(LineNum);
        SetCursorCol(ColNum);
        if (OnCursorChange) OnCursorChange(LineNum, ColNum);
    }, [OnCursorChange]);

    const HandleKeyDown = useCallback((E: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const Textarea = TextAreaRef.current;
        if (!Textarea) { UpdateCursor(); return; }

        const Text = Textarea.value;
        const Start = Textarea.selectionStart;
        const End = Textarea.selectionEnd;

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
                    OnContentChange(NewText);
                    PendingCursorRef.current = { Start: Start + 1, End: End + 1 };
                    return;
                }

                E.preventDefault();
                const NewText = Text.slice(0, Start) + E.key + Closer + Text.slice(End);
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
                OnContentChange(NewText);
                PendingCursorRef.current = { Start: NewPos, End: NewPos };
            } else {
                const Selected = Text.slice(Start, End);
                const NewText = Text.slice(0, End) + Selected + Text.slice(End);
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
                const Lines = Block.split('\n');
                let RemovedFirst = 0;
                const Dedented = Lines.map((L, I) => {
                    const Remove = Math.min(4, L.length - L.trimStart().length);
                    if (I === 0) RemovedFirst = Remove;
                    return L.slice(Remove);
                }).join('\n');
                const NewText = Text.slice(0, FirstLineStart) + Dedented + Text.slice(BlockEnd);
                const Removed = Block.length - Dedented.length;
                OnContentChange(NewText);
                PendingCursorRef.current = {
                    Start: Math.max(FirstLineStart, Start - RemovedFirst),
                    End: Math.max(Start - RemovedFirst, End - Removed),
                };
            } else if (Start === End) {
                const NewText = Text.slice(0, Start) + '    ' + Text.slice(End);
                OnContentChange(NewText);
                PendingCursorRef.current = { Start: Start + 4, End: Start + 4 };
            } else {
                const FirstLineStart = Text.lastIndexOf('\n', Start - 1) + 1;
                const LastLineEnd = Text.indexOf('\n', End - 1);
                const BlockEnd = LastLineEnd === -1 ? Text.length : LastLineEnd;
                const Block = Text.slice(FirstLineStart, BlockEnd);
                const Lines = Block.split('\n');
                const Indented = Lines.map(L => '    ' + L).join('\n');
                const NewText = Text.slice(0, FirstLineStart) + Indented + Text.slice(BlockEnd);
                const Added = Lines.length * 4;
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

            OnContentChange(NewText);
            PendingCursorRef.current = { Start: NewPos, End: NewPos };
            return;
        }

        UpdateCursor();
    }, [UpdateCursor, OnContentChange, Language, IsSearchOpen, HandleSearchClose]);

    const HandleMouseUp = useCallback(() => {
        UpdateCursor();
    }, [UpdateCursor]);

    const HandleFocus = useCallback(() => SetIsFocused(true), []);
    const HandleBlur = useCallback(() => SetIsFocused(false), []);

    const HandleTextAreaScroll = useCallback(() => {
        const Textarea = TextAreaRef.current;
        const LineNumbers = LineNumbersRef.current;
        const Overlay = OverlayRef.current;
        if (Textarea && LineNumbers) {
            LineNumbers.scrollTop = Textarea.scrollTop;
        }
        if (Textarea && Overlay) {
            Overlay.scrollTop = Textarea.scrollTop;
            Overlay.scrollLeft = Textarea.scrollLeft;
        }
        if (Textarea && SearchOverlayRef.current) {
            SearchOverlayRef.current.scrollTop = Textarea.scrollTop;
            SearchOverlayRef.current.scrollLeft = Textarea.scrollLeft;
        }
        SetIsScrolling(true);
        if (ScrollTimerRef.current) clearTimeout(ScrollTimerRef.current);
        ScrollTimerRef.current = setTimeout(() => SetIsScrolling(false), 400);
    }, []);

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
                    const IsModified = Tab.Type !== 'viewport' && Tab.Content !== Tab.DiskContent;
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
                    <div className={`${styles.EditorWrapper} ${EditorAnimClass}`} key={ActiveFile ?? "empty"}>
                        <div className={styles.LineNumbers} ref={LineNumbersRef}>
                            {Lines.map((_, I) => (
                                <div
                                    key={I}
                                    className={`${styles.LineNum} ${I + 1 === CursorLine ? styles.ActiveLine : ""}`}
                                >
                                    {I + 1}
                                </div>
                            ))}
                        </div>
                        <div className={styles.CodeArea}>
                            {SearchHighlights && (
                                <div className={styles.SearchOverlay} ref={SearchOverlayRef} aria-hidden>
                                    {SearchHighlights}
                                </div>
                            )}
                            <HighlightOverlay
                                Tokens={Tokens}
                                ClassName={styles.Overlay}
                                ScrollRef={OverlayRef}
                            />
                            <textarea
                            ref={TextAreaRef}
                            className={`${styles.TextArea} ${IsScrolling ? styles.Scrolling : ""}`}
                            value={FileContent}
                            onChange={(E) => OnContentChange(E.target.value)}
                            onKeyDown={HandleKeyDown}
                            onMouseUp={HandleMouseUp}
                            onFocus={HandleFocus}
                            onBlur={HandleBlur}
                            onScroll={HandleTextAreaScroll}
                            spellCheck={false}
                        />
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
