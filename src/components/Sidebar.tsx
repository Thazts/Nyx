import React, { useState, useCallback, useRef, useEffect } from "react";
import styles from "../styles/Sidebar.module.css";

interface FileEntry {
    Name: string;
    Path: string;
    IsDirectory: boolean;
    Children?: FileEntry[];
}

interface CtxMenu {
    Entry: FileEntry;
    X: number;
    Y: number;
    IsRoot: boolean;
}

interface PendingCreate {
    Type: "file" | "folder";
    TargetDir: string;
}

interface PendingRename {
    Path: string;
    Name: string;
}

const SortEntries = (Entries: FileEntry[]): FileEntry[] =>
    [...Entries].sort((A, B) => {
        if (A.IsDirectory !== B.IsDirectory) return A.IsDirectory ? -1 : 1;
        return A.Name.localeCompare(B.Name, undefined, { sensitivity: "base" });
    });

const ParentDir = (Path: string): string =>
    Path.slice(0, Math.max(Path.lastIndexOf("\\"), Path.lastIndexOf("/")));

interface SidebarProps {
    Files: FileEntry[];
    ActiveFile: string | null;
    OnFileSelect: (Path: string) => void;
    CollapsedFolders?: Set<string>;
    OnFolderToggle?: (Path: string) => void;
    UnsavedCount?: number;
    OnSaveAll?: () => void;
    OnNewFile?: (FileName: string, TargetDir: string) => void;
    OnNewFolder?: (FolderName: string, TargetDir: string) => void;
    OnRename?: (OldPath: string, NewName: string) => void;
    OnDelete?: (Path: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    Files,
    ActiveFile,
    OnFileSelect,
    CollapsedFolders = new Set(),
    OnFolderToggle,
    UnsavedCount = 0,
    OnSaveAll,
    OnNewFile,
    OnNewFolder,
    OnRename,
    OnDelete,
}) => {
    const [ClickedPath, SetClickedPath]             = useState<string | null>(null);
    const [CollapsingFolders, SetCollapsingFolders] = useState<Set<string>>(new Set());
    const [Width, SetWidth]                         = useState(190);
    const [CtxMenu, SetCtxMenu]                     = useState<CtxMenu | null>(null);
    const [PendingCreate, SetPendingCreate]         = useState<PendingCreate | null>(null);
    const [PendingRename, SetPendingRename]         = useState<PendingRename | null>(null);

    const IsResizing      = useRef(false);
    const CreateInputRef  = useRef<HTMLInputElement>(null);
    const RenameInputRef  = useRef<HTMLInputElement>(null);
    const CreateValueRef  = useRef("");
    const RenameValueRef  = useRef("");
    const SkipCreateBlur  = useRef(false);
    const SkipRenameBlur  = useRef(false);

    const RootDir = Files[0]?.Path ?? "";

    useEffect(() => {
        if (PendingCreate) {
            CreateValueRef.current = "";
            setTimeout(() => CreateInputRef.current?.focus(), 30);
        }
    }, [PendingCreate]);

    useEffect(() => {
        if (PendingRename) {
            RenameValueRef.current = PendingRename.Name;
            setTimeout(() => {
                CreateInputRef.current; // noop, keep react happy
                RenameInputRef.current?.focus();
                RenameInputRef.current?.select();
            }, 30);
        }
    }, [PendingRename]);

    useEffect(() => {
        if (!CtxMenu) return;
        const Dismiss = () => SetCtxMenu(null);
        document.addEventListener("mousedown", Dismiss);
        return () => document.removeEventListener("mousedown", Dismiss);
    }, [CtxMenu]);

    const StartCreate = useCallback((Type: "file" | "folder", TargetDir: string) => {
        if (CollapsedFolders.has(TargetDir)) OnFolderToggle?.(TargetDir);
        SetPendingCreate({ Type, TargetDir });
        SetCtxMenu(null);
    }, [CollapsedFolders, OnFolderToggle]);

    const CommitCreate = useCallback(() => {
        if (SkipCreateBlur.current) { SkipCreateBlur.current = false; return; }
        const Name = CreateValueRef.current.trim();
        if (Name && PendingCreate) {
            if (PendingCreate.Type === "file") OnNewFile?.(Name, PendingCreate.TargetDir);
            else                               OnNewFolder?.(Name, PendingCreate.TargetDir);
        }
        SetPendingCreate(null);
    }, [PendingCreate, OnNewFile, OnNewFolder]);

    const CancelCreate = useCallback(() => {
        SkipCreateBlur.current = true;
        SetPendingCreate(null);
    }, []);

    const StartRename = useCallback((Entry: FileEntry) => {
        SetPendingRename({ Path: Entry.Path, Name: Entry.Name });
        SetCtxMenu(null);
    }, []);

    const CommitRename = useCallback(() => {
        if (SkipRenameBlur.current) { SkipRenameBlur.current = false; return; }
        const NewName = RenameValueRef.current.trim();
        if (NewName && PendingRename && NewName !== PendingRename.Name) {
            OnRename?.(PendingRename.Path, NewName);
        }
        SetPendingRename(null);
    }, [PendingRename, OnRename]);

    const CancelRename = useCallback(() => {
        SkipRenameBlur.current = true;
        SetPendingRename(null);
    }, []);

    const CtxAction = useCallback((Action: "new-file" | "new-folder" | "rename" | "delete") => {
        if (!CtxMenu) return;
        const { Entry } = CtxMenu;
        const TargetDir = Entry.IsDirectory ? Entry.Path : ParentDir(Entry.Path);
        if (Action === "new-file")   StartCreate("file",   TargetDir);
        if (Action === "new-folder") StartCreate("folder", TargetDir);
        if (Action === "rename")     StartRename(Entry);
        if (Action === "delete")     { OnDelete?.(Entry.Path); SetCtxMenu(null); }
    }, [CtxMenu, StartCreate, StartRename, OnDelete]);

    const HandleMouseDown = useCallback((E: React.MouseEvent) => {
        E.preventDefault();
        IsResizing.current = true;
        const StartX = E.clientX;
        const StartW = Width;
        const OnMove = (ME: MouseEvent) => {
            if (!IsResizing.current) return;
            SetWidth(Math.max(120, Math.min(400, StartW + ME.clientX - StartX)));
        };
        const OnUp = () => {
            IsResizing.current = false;
            document.removeEventListener("mousemove", OnMove);
            document.removeEventListener("mouseup",   OnUp);
        };
        document.addEventListener("mousemove", OnMove);
        document.addEventListener("mouseup",   OnUp);
    }, [Width]);

    const HandleClick = useCallback((Path: string) => {
        SetClickedPath(Path);
        OnFileSelect(Path);
        setTimeout(() => SetClickedPath(null), 300);
    }, [OnFileSelect]);

    const HandleFolderClick = useCallback((Path: string) => {
        if (CollapsedFolders.has(Path)) {
            OnFolderToggle?.(Path);
        } else {
            SetCollapsingFolders(Prev => new Set(Prev).add(Path));
        }
    }, [CollapsedFolders, OnFolderToggle]);

    const HandleCollapseEnd = useCallback((Path: string) => {
        SetCollapsingFolders(Prev => { const N = new Set(Prev); N.delete(Path); return N; });
        OnFolderToggle?.(Path);
    }, [OnFolderToggle]);

    const NamingRow = (Depth: number, Type: "file" | "folder") => (
        <div className={styles.NamingRow} style={{ paddingLeft: `${12 + Depth * 16}px` }}>
            <span className={styles.Icon}>
                {Type === "folder" ? (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 4.5V12a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8.5L7 3.5H3a1 1 0 00-1 1z"/>
                    </svg>
                ) : (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 2h6l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
                        <path d="M10 2v4h4" opacity=".65"/>
                    </svg>
                )}
            </span>
            <input
                ref={CreateInputRef}
                className={styles.NamingInput}
                defaultValue=""
                onChange={E => { CreateValueRef.current = E.target.value; }}
                onKeyDown={E => {
                    if (E.key === "Enter")  { E.preventDefault(); CommitCreate(); }
                    if (E.key === "Escape") { E.preventDefault(); CancelCreate(); }
                }}
                onBlur={CommitCreate}
                placeholder={Type === "folder" ? "folder-name" : "filename.luau"}
                spellCheck={false}
            />
        </div>
    );

    const RenderEntry = (Entry: FileEntry, Depth: number): React.ReactNode => {
        const IsActive      = Entry.Path === ActiveFile;
        const IsClicked     = Entry.Path === ClickedPath;
        const IsCollapsed   = CollapsedFolders.has(Entry.Path);
        const IsCollapsing  = CollapsingFolders.has(Entry.Path);
        const ShowChildren  = Entry.IsDirectory && !IsCollapsed && Entry.Children;
        const IsRenaming    = PendingRename?.Path === Entry.Path;
        const IsCreateHere  = PendingCreate?.TargetDir === Entry.Path;

        const FolderSvg = (collapsed: boolean) => (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                className={collapsed ? styles.CollapsedIcon : styles.ExpandedIcon}>
                <path d="M2 4.5V12a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8.5L7 3.5H3a1 1 0 00-1 1z"/>
            </svg>
        );

        const FileSvg = () => (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 2h6l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
                <path d="M10 2v4h4" opacity=".65"/>
            </svg>
        );

        return (
            <div key={Entry.Path}>
                {IsRenaming ? (
                    <div className={styles.NamingRow} style={{ paddingLeft: `${12 + Depth * 16}px` }}>
                        <span className={styles.Icon}>
                            {Entry.IsDirectory ? FolderSvg(false) : FileSvg()}
                        </span>
                        <input
                            ref={RenameInputRef}
                            className={styles.NamingInput}
                            defaultValue={Entry.Name}
                            onChange={E => { RenameValueRef.current = E.target.value; }}
                            onKeyDown={E => {
                                if (E.key === "Enter")  { E.preventDefault(); CommitRename(); }
                                if (E.key === "Escape") { E.preventDefault(); CancelRename(); }
                            }}
                            onBlur={CommitRename}
                            spellCheck={false}
                        />
                    </div>
                ) : (
                    <div
                        className={`${styles.Item} ${IsActive ? styles.Active : ""} ${IsClicked ? styles.Clicked : ""}`}
                        style={{ paddingLeft: `${12 + Depth * 16}px` }}
                        onClick={() => Entry.IsDirectory ? HandleFolderClick(Entry.Path) : HandleClick(Entry.Path)}
                        onContextMenu={E => {
                            E.preventDefault();
                            E.stopPropagation();
                            SetCtxMenu({ Entry, X: E.clientX, Y: E.clientY, IsRoot: Entry.Path === RootDir });
                        }}
                    >
                        <span className={styles.Icon}>
                            {Entry.IsDirectory ? FolderSvg(IsCollapsed && !IsCollapsing) : FileSvg()}
                        </span>
                        <span className={styles.Name}>{Entry.Name}</span>
                    </div>
                )}
                {(ShowChildren || IsCollapsing) && Entry.Children && (
                    <div
                        className={`${styles.ChildrenContainer} ${IsCollapsing ? styles.Collapsing : ""}`}
                        onAnimationEnd={IsCollapsing ? () => HandleCollapseEnd(Entry.Path) : undefined}
                    >
                        {IsCreateHere && PendingCreate && NamingRow(Depth + 1, PendingCreate.Type)}
                        {SortEntries(Entry.Children).map(Child => RenderEntry(Child, Depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className={styles.Container} style={{ width: Width }}>
            <div className={styles.Header}>
                <span>Explorer</span>
                <button
                    className={styles.NewFileButton}
                    onClick={() => StartCreate("file", RootDir)}
                    title="New file"
                >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M8 3v10M3 8h10"/>
                    </svg>
                </button>
            </div>

            <div className={styles.List}>
                {SortEntries(Files).map(Entry => RenderEntry(Entry, 0))}
            </div>

            {UnsavedCount > 0 && (
                <div className={styles.Footer}>
                    <button className={styles.SaveAllButton} onClick={OnSaveAll} title="Save all modified files">
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 13h12M8 3v7M5 7l3 3 3-3"/>
                        </svg>
                        Save All
                        <span className={styles.SaveCount}>{UnsavedCount}</span>
                    </button>
                </div>
            )}

            <div className={styles.ResizeHandle} onMouseDown={HandleMouseDown} />

            {CtxMenu && (
                <div
                    className={styles.ContextMenu}
                    style={{ left: CtxMenu.X, top: CtxMenu.Y }}
                    onMouseDown={E => E.stopPropagation()}
                >
                    <div className={styles.ContextMenuItem} onClick={() => CtxAction("new-file")}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 2h6l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/>
                            <path d="M8 9v4M6 11h4"/>
                        </svg>
                        New File
                    </div>
                    <div className={styles.ContextMenuItem} onClick={() => CtxAction("new-folder")}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 4.5V12a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8.5L7 3.5H3a1 1 0 00-1 1z"/>
                            <path d="M8 8v3M6.5 9.5h3"/>
                        </svg>
                        New Folder
                    </div>
                    {!CtxMenu.IsRoot && (
                        <>
                            <div className={styles.ContextMenuSep} />
                            <div className={styles.ContextMenuItem} onClick={() => CtxAction("rename")}>
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M2 12.5l7-7 2 2-7 7H2v-2z"/>
                                    <path d="M10 4l2 2"/>
                                </svg>
                                Rename
                            </div>
                            <div className={`${styles.ContextMenuItem} ${styles.ContextMenuDanger}`} onClick={() => CtxAction("delete")}>
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 5h10M6 5V3h4v2M5 5l.8 8h4.4l.8-8"/>
                                </svg>
                                Delete
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
