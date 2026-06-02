import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import styles from "../styles/CommandPalette.module.css";

interface FileItem {
    Path: string;
    Name: string;
}

interface BuiltinCommand {
    Id:     string;
    Label:  string;
    Action: () => void;
}

interface CommandPaletteProps {
    OpenTabs:     FileItem[];
    AllFiles:     FileItem[];
    ActiveFile:   string | null;
    OnSelectFile: (Path: string) => void;
    OnClose:      () => void;
    Commands:     BuiltinCommand[];
}

function FuzzyMatch(Haystack: string, Needle: string): boolean {
    if (!Needle) return true;
    const H = Haystack.toLowerCase();
    const N = Needle.toLowerCase();
    let Hi = 0;
    for (let Ni = 0; Ni < N.length; Ni++) {
        const Idx = H.indexOf(N[Ni], Hi);
        if (Idx === -1) return false;
        Hi = Idx + 1;
    }
    return true;
}

function FuzzyScore(Name: string, Query: string): number {
    const H = Name.toLowerCase();
    const N = Query.toLowerCase();
    if (H === N)            return 100;
    if (H.startsWith(N))   return 80;
    if (H.includes(N))     return 60;
    return 10;
}

type PaletteItem =
    | { Kind: "file"; Path: string; Name: string; IsOpen: boolean }
    | { Kind: "command"; Id: string; Label: string; Action: () => void };

export const CommandPalette: React.FC<CommandPaletteProps> = ({
    OpenTabs,
    AllFiles,
    ActiveFile,
    OnSelectFile,
    OnClose,
    Commands,
}) => {
    const [Query, SetQuery]               = useState("");
    const [SelectedIndex, SetSelectedIndex] = useState(0);
    const InputRef = useRef<HTMLInputElement>(null);
    const ListRef  = useRef<HTMLDivElement>(null);

    const OpenPaths = useMemo(() => new Set(OpenTabs.map(T => T.Path)), [OpenTabs]);

    const Items = useMemo((): PaletteItem[] => {
        const Q = Query.trim();

        const FileItems: PaletteItem[] = AllFiles
            .filter(F => !F.Path.startsWith("viewport:"))
            .filter(F => FuzzyMatch(F.Name, Q) || FuzzyMatch(F.Path, Q))
            .sort((A, B) => {
                const AOpen = OpenPaths.has(A.Path);
                const BOpen = OpenPaths.has(B.Path);
                if (AOpen !== BOpen) return AOpen ? -1 : 1;
                if (Q) return FuzzyScore(B.Name, Q) - FuzzyScore(A.Name, Q);
                return 0;
            })
            .map(F => ({ Kind: "file" as const, Path: F.Path, Name: F.Name, IsOpen: OpenPaths.has(F.Path) }));

        const CmdItems: PaletteItem[] = Commands
            .filter(C => FuzzyMatch(C.Label, Q))
            .map(C => ({ Kind: "command" as const, Id: C.Id, Label: C.Label, Action: C.Action }));

        return [...FileItems, ...CmdItems];
    }, [AllFiles, Commands, Query, OpenPaths]);

    useEffect(() => { SetSelectedIndex(0); }, [Query]);
    useEffect(() => { InputRef.current?.focus(); }, []);

    useEffect(() => {
        if (!ListRef.current) return;
        const El = ListRef.current.children[SelectedIndex] as HTMLElement | undefined;
        El?.scrollIntoView({ block: "nearest" });
    }, [SelectedIndex]);

    const Confirm = useCallback((Index: number) => {
        const Item = Items[Index];
        if (!Item) return;
        if (Item.Kind === "file") OnSelectFile(Item.Path);
        else Item.Action();
        OnClose();
    }, [Items, OnSelectFile, OnClose]);

    const HandleKeyDown = useCallback((E: React.KeyboardEvent) => {
        if (E.key === "Escape") { OnClose(); return; }
        if (E.key === "ArrowDown") {
            E.preventDefault();
            SetSelectedIndex(I => Math.min(I + 1, Items.length - 1));
        } else if (E.key === "ArrowUp") {
            E.preventDefault();
            SetSelectedIndex(I => Math.max(I - 1, 0));
        } else if (E.key === "Enter") {
            E.preventDefault();
            Confirm(SelectedIndex);
        }
    }, [Items.length, SelectedIndex, Confirm, OnClose]);

    return (
        <div className={styles.Backdrop} onClick={OnClose}>
            <div className={styles.Panel} onClick={E => E.stopPropagation()}>
                <div className={styles.InputRow}>
                    <svg className={styles.SearchIcon} width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="6.5" cy="6.5" r="4"/>
                        <path d="M14 14l-3-3"/>
                    </svg>
                    <input
                        ref={InputRef}
                        className={styles.Input}
                        value={Query}
                        onChange={E => SetQuery(E.target.value)}
                        onKeyDown={HandleKeyDown}
                        placeholder="Go to file or command..."
                        spellCheck={false}
                    />
                    <span className={styles.EscHint}>esc</span>
                </div>
                <div className={styles.List} ref={ListRef}>
                    {Items.length === 0 && (
                        <div className={styles.Empty}>No results</div>
                    )}
                    {Items.map((Item, I) => {
                        const IsActive  = Item.Kind === "file" && Item.Path === ActiveFile;
                        const IsOpen    = Item.Kind === "file" && Item.IsOpen && !IsActive;
                        const IsCmd     = Item.Kind === "command";
                        return (
                            <div
                                key={Item.Kind === "file" ? Item.Path : Item.Id}
                                className={`${styles.Item} ${I === SelectedIndex ? styles.Selected : ""} ${IsActive ? styles.ItemActive : ""}`}
                                onClick={() => Confirm(I)}
                                onMouseEnter={() => SetSelectedIndex(I)}
                            >
                                <span className={`${styles.ItemIcon} ${IsOpen || IsActive ? styles.ItemIconAccent : ""} ${IsCmd ? styles.ItemIconCmd : ""}`}>
                                    {IsCmd ? (
                                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="8" cy="8" r="2"/>
                                            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/>
                                        </svg>
                                    ) : (
                                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M4 2h5l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
                                            <path d="M9 2v4h4"/>
                                        </svg>
                                    )}
                                </span>
                                <div className={styles.ItemText}>
                                    <span className={styles.ItemLabel}>
                                        {Item.Kind === "file" ? Item.Name : Item.Label}
                                    </span>
                                    {Item.Kind === "file" && (
                                        <span className={styles.ItemSub}>{Item.Path}</span>
                                    )}
                                </div>
                                {IsActive && <span className={styles.BadgeActive}>active</span>}
                                {IsOpen   && <span className={styles.BadgeOpen}>open</span>}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
