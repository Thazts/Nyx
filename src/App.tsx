import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { ActivityBar } from "./components/ActivityBar";
import { Sidebar } from "./components/Sidebar";
import { EditorArea } from "./components/EditorArea";
import { ViewportTab } from "./components/ViewportTab";
import { TerminalPanel } from "./components/TerminalPanel";
import { StatusBar } from "./components/StatusBar";
import { PropertiesBar } from "./components/PropertiesBar";
import { StartScreen } from "./components/StartScreen";
import { FileService } from "./services/FileService";
import { EditorService } from "./services/EditorService";
import { CaptureService } from "./services/CaptureService";
import { RunService } from "./services/RunService";
import { NativeCommands } from "./services/NativeCommands";
import { StateService } from "./services/StateService";
import { SceneService } from "./services/SceneService";
import { RendererService } from "./services/RendererService";
import { InferProfileFromPath } from "./services/EngineProfiles";
import { DevMenu } from "@devtools";
import { SourceControl } from "./components/SourceControl";
import { SettingsPanel, InitSettings } from "./components/SettingsPanel";
import { CommandPalette } from "./components/CommandPalette";
import { UILib, UsePanel } from "./ui/UILib";
import { DetectLanguage } from "./services/Tokenizer";
import { useStateKey } from "./state/useStateKey";
import "./styles/global.css";

StateService.Init();
InitSettings();

const RECENT_KEY = "nyx_recent_workspaces";
const MAX_RECENT = 5;

function GetRecentWorkspaces(): string[] {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); }
    catch { return []; }
}

function AddRecentWorkspace(Path: string): string[] {
    const Next = [Path, ...GetRecentWorkspaces().filter(P => P !== Path)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(Next));
    return Next;
}

interface FileEntry {
    Name: string;
    Path: string;
    IsDirectory: boolean;
    Children?: FileEntry[];
}

interface TabEntry {
    Path: string;
    Name: string;
    Content: string;
    DiskContent: string;
    Type?: 'file' | 'viewport';
    EngineProfile?: string;
}

interface FileMetadata {
    Size: number;
    Modified: string;
}

interface AiChangeEvent {
    Path: string;
}

const InitialCode = `-- Welcome to Nyx
-- Select a workspace folder to get started
`;

const CollectAllFolderPaths = (Entries: FileEntry[]): string[] => {
    const Paths: string[] = [];
    for (const E of Entries) {
        if (E.IsDirectory) {
            Paths.push(E.Path);
            if (E.Children) Paths.push(...CollectAllFolderPaths(E.Children));
        }
    }
    return Paths;
};

const FindEntry = (Entries: FileEntry[], Path: string): FileEntry | null => {
    for (const E of Entries) {
        if (E.Path === Path) return E;
        if (E.Children) {
            const Found = FindEntry(E.Children, Path);
            if (Found) return Found;
        }
    }
    return null;
};

const FlattenTree = (Entries: FileEntry[]): FileEntry[] =>
    Entries.flatMap(E => E.IsDirectory ? [E, ...FlattenTree(E.Children ?? [])] : [E]);

const SortTree = (Entries: FileEntry[]): FileEntry[] =>
    [...Entries]
        .sort((A, B) => {
            if (A.IsDirectory !== B.IsDirectory) return A.IsDirectory ? -1 : 1;
            return A.Name.localeCompare(B.Name, undefined, { sensitivity: "base" });
        })
        .map(E => E.IsDirectory && E.Children ? { ...E, Children: SortTree(E.Children) } : E);

const IsAbsolutePath = (Path: string): boolean =>
    /^[A-Za-z]:[\\/]/.test(Path) || Path.startsWith("\\\\") || Path.startsWith("/");

const NormalizePathKey = (Path: string): string =>
    Path.replace(/\\/g, "/").toLowerCase();

export const App: React.FC = () => {
    const [AppReady, SetAppReady] = useState(false);
    const DevMenuOpen = UsePanel("DevMenu");
    const [ActiveFile, SetActiveFile] = useState<string | null>(null);
    const [FileContent, SetFileContent] = useState(InitialCode);
    const [ActiveTabModified, SetActiveTabModified] = useState(false);
    const [TerminalOutput, SetTerminalOutput] = useState<string[]>([
        "Welcome to Nyx",
        "Select a workspace folder to begin",
    ]);
    const [CursorLine, SetCursorLine] = useState(1);
    const [CursorCol, SetCursorCol] = useState(1);
    const [SelectedEntry, SetSelectedEntry] = useState<FileEntry | null>(null);
    const [SelectedMetadata, SetSelectedMetadata] = useState<FileMetadata | null>(null);
    const [WorkspacePath, SetWorkspacePath] = useState<string | null>(null);
    const [FileTree, SetFileTree] = useState<FileEntry[]>([]);
    const [IsLoading, SetIsLoading] = useState(false);
    const [OpenTabs, SetOpenTabs] = useState<TabEntry[]>([]);
    const [CollapsedFolders, SetCollapsedFolders] = useState<Set<string>>(new Set());
    const [SwitchDir, SetSwitchDir] = useState<"up" | "down" | "none">("none");
    const [RunOutput, SetRunOutput] = useState<string[]>([]);
    const [IsRunning, SetIsRunning] = useState(false);
    const [SavedFlash, SetSavedFlash] = useState(false);
    const [ExternalContentVersion, SetExternalContentVersion] = useState(0);
    const AiChangedFiles = useStateKey<string[]>("AiChangedFiles");
    const [GitBranch, SetGitBranch]       = useState("—");
    const [RecentPaths, SetRecentPaths]   = useState<string[]>(() => GetRecentWorkspaces());
    const IsSourceControlOpen  = UsePanel("SourceControl");
    const IsSettingsOpen       = UsePanel("Settings");
    const IsCommandPaletteOpen = UsePanel("CommandPalette");
    const PrevActiveFileRef = useRef<string | null>(null);
    const AppRef = useRef<HTMLDivElement>(null);
    const ActiveFileRef = useRef<string | null>(null);
    const FileContentRef = useRef<string>(InitialCode);
    const DiskContentRef = useRef<string>(InitialCode);
    const LastKnownMtimeRef = useRef<string | null>(null);
    const LiveViewportTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const LiveViewportTokensRef = useRef<Map<string, number>>(new Map());
    const LastViewportInteractionRef = useRef(0);

    useEffect(() => {
        const PreventMenu = (E: MouseEvent) => E.preventDefault();
        document.addEventListener('contextmenu', PreventMenu);
        return () => document.removeEventListener('contextmenu', PreventMenu);
    }, []);

    useEffect(() => {
        return () => {
            LiveViewportTimersRef.current.forEach(Timer => clearTimeout(Timer));
            LiveViewportTimersRef.current.clear();
            LiveViewportTokensRef.current.clear();
        };
    }, []);

    useEffect(() => { ActiveFileRef.current = ActiveFile; }, [ActiveFile]);

    useEffect(() => {
        const HandleKeyDown = (E: KeyboardEvent) => {
            if (E.ctrlKey && E.key === 'a') {
                const HandleSecondKey = (E2: KeyboardEvent) => {
                    if (E2.key === 'c') {
                        SetCollapsedFolders(new Set(CollectAllFolderPaths(FileTree)));
                    }
                    window.removeEventListener('keydown', HandleSecondKey);
                };
                window.addEventListener('keydown', HandleSecondKey);
            }
        };
        window.addEventListener('keydown', HandleKeyDown);
        return () => window.removeEventListener('keydown', HandleKeyDown);
    }, [FileTree]);

    const HandleSave = useCallback(async () => {
        const Path = ActiveFileRef.current;
        if (!Path) return;
        const Content = FileContentRef.current;
        try {
            await FileService.SaveFile({ Path, Content });
            DiskContentRef.current = Content;
            SetOpenTabs(Prev => Prev.map(T => T.Path === Path
                ? { ...T, Content, DiskContent: Content }
                : T
            ));
            SetActiveTabModified(false);
            SetSavedFlash(true);
            setTimeout(() => SetSavedFlash(false), 1200);
            const Meta = await FileService.GetFileMetadata({ Path });
            LastKnownMtimeRef.current = Meta.Modified;
            SetSelectedMetadata(Meta);
        } catch (Err) {
            console.error("Save failed:", Err);
        }
    }, []);

    const HandleSaveFile = useCallback(async (Path: string) => {
        const IsActive = Path === ActiveFile;
        const Content    = IsActive ? FileContentRef.current  : OpenTabs.find(T => T.Path === Path)?.Content;
        const DiskContent = IsActive ? DiskContentRef.current : OpenTabs.find(T => T.Path === Path)?.DiskContent;
        if (Content === undefined || Content === DiskContent) return;
        try {
            await FileService.SaveFile({ Path, Content });
            if (IsActive) {
                DiskContentRef.current = Content;
                SetActiveTabModified(false);
            }
            SetOpenTabs(Prev => Prev.map(T => T.Path === Path
                ? { ...T, Content, DiskContent: Content }
                : T
            ));
            if (IsActive) {
                SetSavedFlash(true);
                setTimeout(() => SetSavedFlash(false), 1200);
                const Meta = await FileService.GetFileMetadata({ Path });
                LastKnownMtimeRef.current = Meta.Modified;
                SetSelectedMetadata(Meta);
            }
        } catch (Err) {
            console.error("Save failed:", Err);
        }
    }, [OpenTabs, ActiveFile]);

    const HandleSaveAll = useCallback(async () => {
        const ActiveContent = FileContentRef.current;
        const ToSave = OpenTabs.filter(T =>
            T.Path === ActiveFile
                ? ActiveContent !== DiskContentRef.current
                : T.Content !== T.DiskContent
        );
        if (ToSave.length === 0) return;
        await Promise.all(ToSave.map(T => {
            const Content = T.Path === ActiveFile ? ActiveContent : T.Content;
            return FileService.SaveFile({ Path: T.Path, Content }).catch(Err =>
                console.error(`Save failed: ${T.Path}`, Err)
            );
        }));
        SetOpenTabs(Prev => Prev.map(T => {
            if (T.Path === ActiveFile) return { ...T, Content: ActiveContent, DiskContent: ActiveContent };
            const Saved = ToSave.find(S => S.Path === T.Path);
            if (Saved) return { ...T, DiskContent: T.Content };
            return T;
        }));
        if (ToSave.some(T => T.Path === ActiveFile)) {
            DiskContentRef.current = ActiveContent;
            SetActiveTabModified(false);
            SetSavedFlash(true);
            setTimeout(() => SetSavedFlash(false), 1200);
        }
    }, [OpenTabs, ActiveFile]);

    useEffect(() => {
        const OnKeyDown = (E: KeyboardEvent) => {
            if ((E.ctrlKey || E.metaKey) && E.key === 's') {
                E.preventDefault();
                HandleSave();
            }
            if ((E.ctrlKey || E.metaKey) && E.key === 'f') {
                E.preventDefault();
                UILib.SetView("search");
                UILib.Show("Search");
            }
            if ((E.ctrlKey || E.metaKey) && E.key === 'p') {
                E.preventDefault();
                UILib.Toggle("CommandPalette");
            }
            if (E.key === 'F12') {
                E.preventDefault();
                UILib.Toggle("DevMenu");
            }
        };
        window.addEventListener('keydown', OnKeyDown);
        return () => window.removeEventListener('keydown', OnKeyDown);
    }, [HandleSave]);

    useEffect(() => {
        const viewportEl = document.querySelector('[data-viewport]') as HTMLElement | null;
        if (!viewportEl) return;

        const keysDown = new Set<string>();
        const MarkViewportInteraction = () => {
            LastViewportInteractionRef.current = performance.now();
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (!viewportEl.contains(e.target as Node)) return;
            MarkViewportInteraction();
            keysDown.add(e.key.toLowerCase());
            if (!keysDown.has('mouse2')) return;
            let forward = 0, right = 0, up = 0;
            if (keysDown.has('w')) forward += 1;
            if (keysDown.has('s')) forward -= 1;
            if (keysDown.has('a')) right   -= 1;
            if (keysDown.has('d')) right   += 1;
            if (keysDown.has('q')) up      -= 1;
            if (keysDown.has('e')) up      += 1;
            if (forward !== 0 || right !== 0 || up !== 0) {
                RendererService.CameraWasd({ Forward: forward, Right: right, Up: up }).catch(() => {});
            }
        };

        const onKeyUp = (e: KeyboardEvent) => {
            if (viewportEl.contains(e.target as Node)) MarkViewportInteraction();
            keysDown.delete(e.key.toLowerCase());
        };

        const onMouseDown = (e: MouseEvent) => {
            if (!viewportEl.contains(e.target as Node)) return;
            MarkViewportInteraction();
            if (e.button === 2) {
                keysDown.add('mouse2');
                RendererService.CameraRightMouse({ Down: true }).catch(() => {});
                e.preventDefault();
            }
        };

        const onMouseUp = (e: MouseEvent) => {
            if (viewportEl.contains(e.target as Node)) MarkViewportInteraction();
            if (e.button === 2) {
                keysDown.delete('mouse2');
                RendererService.CameraRightMouse({ Down: false }).catch(() => {});
            }
        };

        const onContextMenu = (e: MouseEvent) => {
            if (viewportEl.contains(e.target as Node)) {
                e.preventDefault();
            }
        };

        const onMouseMove = (e: MouseEvent) => {
            if (viewportEl.contains(e.target as Node)) MarkViewportInteraction();
        };

        const onWheel = (e: WheelEvent) => {
            if (viewportEl.contains(e.target as Node)) MarkViewportInteraction();
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mouseup', onMouseUp);
        window.addEventListener('contextmenu', onContextMenu);
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('wheel', onWheel);

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('contextmenu', onContextMenu);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('wheel', onWheel);
        };
    }, [ActiveFile]);

    useEffect(() => {
        const Poll = async () => {
            const Path = ActiveFileRef.current;
            if (!Path) return;
            try {
                const Meta = await FileService.GetFileMetadata({ Path });
                const PrevMtime = LastKnownMtimeRef.current;
                if (!PrevMtime || Meta.Modified === PrevMtime) return;
                if (FileContentRef.current !== DiskContentRef.current) return;
                LastKnownMtimeRef.current = Meta.Modified;
                const Content = await FileService.OpenFile({ Path });
                if (ActiveFileRef.current !== Path) return;
                DiskContentRef.current = Content;
                FileContentRef.current = Content;
                SetFileContent(Content);
                SetActiveTabModified(false);
                SetExternalContentVersion(V => V + 1);
                SetOpenTabs(Prev => Prev.map(T => T.Path === Path ? { ...T, Content, DiskContent: Content } : T));
                SetSelectedMetadata(Meta);
            } catch {
            }
        };
        const Id = setInterval(Poll, 2500);
        return () => clearInterval(Id);
    }, []);

    useEffect(() => {
        RendererService.SetOnTop({ OnTop: !DevMenuOpen }).catch(() => {});
    }, [DevMenuOpen]);

    useEffect(() => {
        if (!WorkspacePath) { SetGitBranch("—"); return; }
        CaptureService.Run("git branch --show-current", WorkspacePath)
            .then(Lines => { const B = Lines[0]?.trim(); SetGitBranch(B || "main"); })
            .catch(() => SetGitBranch("main"));
    }, [WorkspacePath]);

    const BuildFileTree = useCallback(async (RootPath: string): Promise<FileEntry[]> => {
        const Files = await FileService.ListFilesRecursive({ Path: RootPath });
        const RootName = RootPath.split("\\").pop() || RootPath.split("/").pop() || "workspace";
        const RootEntry: FileEntry = {
            Name: RootName,
            Path: RootPath,
            IsDirectory: true,
            Children: [],
        };

        for (const FilePath of Files) {
            const RelativePath = FilePath.replace(RootPath, "").replace(/^[\\/]/, "");
            const Parts = RelativePath.split(/[\\/]/);
            let Current = RootEntry;
            for (let I = 0; I < Parts.length; I++) {
                const Part = Parts[I];
                const IsLast = I === Parts.length - 1;
                const FullPath = RootPath + "\\" + Parts.slice(0, I + 1).join("\\");
                if (IsLast) {
                    Current.Children!.push({ Name: Part, Path: FullPath, IsDirectory: false });
                } else {
                    let Existing = Current.Children!.find(C => C.Name === Part && C.IsDirectory);
                    if (!Existing) {
                        Existing = { Name: Part, Path: FullPath, IsDirectory: true, Children: [] };
                        Current.Children!.push(Existing);
                    }
                    Current = Existing;
                }
            }
        }
        RootEntry.Children = SortTree(RootEntry.Children ?? []);
        return [RootEntry];
    }, []);

    const HandleOpenFolderFromStart = useCallback(async () => {
        try {
            const FolderPath = await FileService.SelectFolder();
            if (!FolderPath) return;
            SetIsLoading(true);
            StateService.Set({ Key: "AppStatus", Value: "loading" });
            const Tree = await BuildFileTree(FolderPath);
            SetFileTree(Tree);
            SetWorkspacePath(FolderPath);
            StateService.Set({ Key: "AiChangedFiles", Value: [] });
            StateService.Set({ Key: "WorkspacePath", Value: FolderPath });
            StateService.Set({ Key: "FileTree", Value: Tree });
            const SubFolders = CollectAllFolderPaths(Tree[0]?.Children ?? []);
            SetCollapsedFolders(new Set(SubFolders));
            SetIsLoading(false);
            StateService.Set({ Key: "AppStatus", Value: "idle" });
            SetTerminalOutput(Prev => [...Prev, `Workspace: ${FolderPath}`]);
            SetRecentPaths(AddRecentWorkspace(FolderPath));
            SetAppReady(true);
        } catch (Error) {
            console.error("Failed to load workspace:", Error);
            SetIsLoading(false);
            StateService.Set({ Key: "AppStatus", Value: "idle" });
        }
    }, [BuildFileTree]);

    const HandleSelectWorkspace = useCallback(async () => {
        try {
            const FolderPath = await FileService.SelectFolder();
            if (!FolderPath) return;
            SetIsLoading(true);
            StateService.Set({ Key: "AppStatus", Value: "loading" });
            const Tree = await BuildFileTree(FolderPath);
            SetFileTree(Tree);
            SetWorkspacePath(FolderPath);
            StateService.Set({ Key: "AiChangedFiles", Value: [] });
            StateService.Set({ Key: "WorkspacePath", Value: FolderPath });
            StateService.Set({ Key: "FileTree", Value: Tree });
            SetIsLoading(false);
            StateService.Set({ Key: "AppStatus", Value: "idle" });
            SetRecentPaths(AddRecentWorkspace(FolderPath));
            SetActiveFile(null);
            StateService.Set({ Key: "ActiveFile", Value: null });
            FileContentRef.current = InitialCode;
            DiskContentRef.current = InitialCode;
            SetFileContent(InitialCode);
            SetActiveTabModified(false);
            LiveViewportTimersRef.current.forEach(Timer => clearTimeout(Timer));
            LiveViewportTimersRef.current.clear();
            LiveViewportTokensRef.current.clear();
            SetOpenTabs([]);
            StateService.Set({ Key: "OpenTabs", Value: [] });
            const SubFolders = CollectAllFolderPaths(Tree[0]?.Children ?? []);
            SetCollapsedFolders(new Set(SubFolders));
            SetTerminalOutput(Prev => [...Prev, `Workspace: ${FolderPath}`]);
        } catch (Error) {
            console.error("Failed to select folder:", Error);
            SetIsLoading(false);
            StateService.Set({ Key: "AppStatus", Value: "idle" });
        }
    }, [BuildFileTree]);

    const HandleFileSelect = useCallback(async (Path: string) => {
        const Flat = FlattenTree(FileTree);
        const NewIndex = Flat.findIndex(E => E.Path === Path);
        const PrevIndex = PrevActiveFileRef.current
            ? Flat.findIndex(E => E.Path === PrevActiveFileRef.current)
            : -1;

        if (PrevIndex === -1 || NewIndex === PrevIndex) SetSwitchDir("none");
        else if (NewIndex > PrevIndex) SetSwitchDir("down");
        else SetSwitchDir("up");
        PrevActiveFileRef.current = Path;

        SetActiveFile(Path);
        {
            const Key = NormalizePathKey(Path);
            const Current = StateService.Get<string[]>({ Key: "AiChangedFiles" }) ?? [];
            const Next = Current.filter(P => NormalizePathKey(P) !== Key);
            if (Next.length !== Current.length) {
                StateService.Set({ Key: "AiChangedFiles", Value: Next });
            }
        }
        StateService.Set({ Key: "ActiveFile", Value: Path });
        const Entry = FindEntry(FileTree, Path);
        SetSelectedEntry(Entry);

        LastKnownMtimeRef.current = null;
        if (Entry && !Entry.IsDirectory) {
            try {
                const Meta = await FileService.GetFileMetadata({ Path });
                LastKnownMtimeRef.current = Meta.Modified;
                SetSelectedMetadata(Meta);
            } catch {
                SetSelectedMetadata(null);
            }
        } else {
            SetSelectedMetadata(null);
        }

        const ExistingTab = OpenTabs.find(T => T.Path === Path);
        if (ExistingTab) {
            FileContentRef.current = ExistingTab.Content;
            DiskContentRef.current = ExistingTab.DiskContent;
            SetFileContent(ExistingTab.Content);
            SetActiveTabModified(ExistingTab.Content !== ExistingTab.DiskContent);
            return;
        }

        try {
            const Content = await FileService.OpenFile({ Path });
            const FileName = Path.split("\\").pop()?.split("/").pop() || "untitled";
            FileContentRef.current = Content;
            DiskContentRef.current = Content;
            SetActiveTabModified(false);
            SetOpenTabs(Prev => {
                const Next = [...Prev, { Path, Name: FileName, Content, DiskContent: Content }];
                StateService.Set({ Key: "OpenTabs", Value: Next });
                return Next;
            });
            SetFileContent(Content);
        } catch {
            SetFileContent("// Could not load file");
        }
    }, [FileTree, OpenTabs]);

    const ResolveWorkspaceFilePath = useCallback((Path: string): string | null => {
        if (!WorkspacePath) return null;
        return IsAbsolutePath(Path) ? Path : `${WorkspacePath}\\${Path.replace(/^[\\/]/, "")}`;
    }, [WorkspacePath]);

    const MarkAiChangedFile = useCallback((Path: string) => {
        const Key = NormalizePathKey(Path);
        const Current = StateService.Get<string[]>({ Key: "AiChangedFiles" }) ?? [];
        if (Current.some(P => NormalizePathKey(P) === Key)) return;
        StateService.Set({ Key: "AiChangedFiles", Value: [...Current, Path] });
    }, []);

    const RenameAiChangedPath = useCallback((OldPath: string, NewPath: string) => {
        const OldKey = NormalizePathKey(OldPath);
        const Current = StateService.Get<string[]>({ Key: "AiChangedFiles" }) ?? [];
        const Next = Current.map(P => {
            const Key = NormalizePathKey(P);
            if (Key === OldKey) return NewPath;
            if (Key.startsWith(`${OldKey}/`)) return `${NewPath}${P.slice(OldPath.length)}`;
            return P;
        });
        StateService.Set({ Key: "AiChangedFiles", Value: Next });
    }, []);

    const ClearAiChangedPathTree = useCallback((Path: string) => {
        const Key = NormalizePathKey(Path);
        const Current = StateService.Get<string[]>({ Key: "AiChangedFiles" }) ?? [];
        const Next = Current.filter(P => {
            const Candidate = NormalizePathKey(P);
            return Candidate !== Key && !Candidate.startsWith(`${Key}/`);
        });
        if (Next.length !== Current.length) {
            StateService.Set({ Key: "AiChangedFiles", Value: Next });
        }
    }, []);

    const RefreshWorkspaceAfterAiChange = useCallback(async (ChangedPath: string) => {
        if (!WorkspacePath) return;
        const FullPath = ResolveWorkspaceFilePath(ChangedPath);
        if (!FullPath) return;
        MarkAiChangedFile(FullPath);

        try {
            const NewTree = await BuildFileTree(WorkspacePath);
            SetFileTree(NewTree);
            StateService.Set({ Key: "FileTree", Value: NewTree });
        } catch {
            // Keep the edit card usable even if a transient tree refresh fails.
        }

        try {
            const Content = await FileService.OpenFile({ Path: FullPath });
            const Meta = await FileService.GetFileMetadata({ Path: FullPath });

            SetOpenTabs(Prev => {
                const Next = Prev.map(Tab => {
                    if (Tab.Path !== FullPath || Tab.Content !== Tab.DiskContent) return Tab;
                    return { ...Tab, Content, DiskContent: Content };
                });
                StateService.Set({ Key: "OpenTabs", Value: Next });
                return Next;
            });

            if (ActiveFileRef.current === FullPath && FileContentRef.current === DiskContentRef.current) {
                FileContentRef.current = Content;
                DiskContentRef.current = Content;
                LastKnownMtimeRef.current = Meta.Modified;
                SetFileContent(Content);
                SetActiveTabModified(false);
                SetExternalContentVersion(V => V + 1);
                SetSelectedMetadata(Meta);
            }
        } catch {
            // Some write tools may target notes or paths outside the active workspace.
        }
    }, [BuildFileTree, MarkAiChangedFile, ResolveWorkspaceFilePath, WorkspacePath]);

    const HandleAiOpenFile = useCallback(async (Path: string) => {
        const FullPath = ResolveWorkspaceFilePath(Path);
        if (!FullPath) return;
        await HandleFileSelect(FullPath);
    }, [HandleFileSelect, ResolveWorkspaceFilePath]);

    useEffect(() => {
        let Cancelled = false;
        let Unlisten: (() => void) | null = null;

        listen<AiChangeEvent>("ai_change_applied", Event => {
            if (!Cancelled) {
                RefreshWorkspaceAfterAiChange(Event.payload.Path).catch(() => {});
            }
        }).then(Fn => {
            if (Cancelled) Fn();
            else Unlisten = Fn;
        }).catch(() => {});

        return () => {
            Cancelled = true;
            Unlisten?.();
        };
    }, [RefreshWorkspaceAfterAiChange]);

    const StopLiveViewport = useCallback((ViewportPath: string) => {
        const Timer = LiveViewportTimersRef.current.get(ViewportPath);
        if (Timer) clearTimeout(Timer);
        LiveViewportTimersRef.current.delete(ViewportPath);
        LiveViewportTokensRef.current.delete(ViewportPath);
    }, []);

    const HandleTabClose = useCallback((Path: string) => {
        if (Path.startsWith("viewport:")) StopLiveViewport(Path);
        // Sync active file content to its tab slot before any restructuring
        const SyncedContent = FileContentRef.current;

        SetOpenTabs(Prev => {
            const WithSynced = ActiveFile
                ? Prev.map(T => T.Path === ActiveFile ? { ...T, Content: SyncedContent } : T)
                : Prev;
            const NewTabs = WithSynced.filter(T => T.Path !== Path);
            StateService.Set({ Key: "OpenTabs", Value: NewTabs });

            if (Path === ActiveFile) {
                const LastTab = NewTabs[NewTabs.length - 1];
                if (LastTab) {
                    SetActiveFile(LastTab.Path);
                    StateService.Set({ Key: "ActiveFile", Value: LastTab.Path });
                    FileContentRef.current = LastTab.Content;
                    DiskContentRef.current = LastTab.DiskContent;
                    SetFileContent(LastTab.Content);
                    SetActiveTabModified(LastTab.Content !== LastTab.DiskContent);
                } else {
                    SetActiveFile(null);
                    StateService.Set({ Key: "ActiveFile", Value: null });
                    FileContentRef.current = InitialCode;
                    DiskContentRef.current = InitialCode;
                    SetFileContent(InitialCode);
                    SetActiveTabModified(false);
                }
            }
            return NewTabs;
        });
    }, [ActiveFile, StopLiveViewport]);

    const HandleTabSelect = useCallback((Path: string) => {
        const Tab = OpenTabs.find(T => T.Path === Path);
        if (!Tab) return;

        // Sync outgoing tab's content before switching away
        if (ActiveFile && ActiveFile !== Path) {
            const Current = FileContentRef.current;
            SetOpenTabs(Prev => Prev.map(T => T.Path === ActiveFile
                ? { ...T, Content: Current }
                : T
            ));
        }

        SetSwitchDir("none");
        SetActiveFile(Path);
        StateService.Set({ Key: "ActiveFile", Value: Path });
        if (Tab.Type === 'viewport') {
            FileContentRef.current = "";
            DiskContentRef.current = "";
            SetFileContent("");
            SetActiveTabModified(false);
        } else {
            FileContentRef.current = Tab.Content;
            DiskContentRef.current = Tab.DiskContent;
            SetFileContent(Tab.Content);
            SetActiveTabModified(Tab.Content !== Tab.DiskContent);
        }
    }, [OpenTabs, ActiveFile]);

    // No longer updates OpenTabs on every keystroke — syncs on tab switch/close instead
    const HandleContentChange = useCallback((Content: string) => {
        FileContentRef.current = Content;
        SetFileContent(Content);
        SetActiveTabModified(Content !== DiskContentRef.current);
    }, []);

    const HandleTerminalCommand = useCallback(async (Command: string) => {
        if (Command.trimStart().startsWith('$')) {
            const Parsed = NativeCommands.Parse(Command.trim());
            if (!Parsed) {
                SetTerminalOutput(Prev => [...Prev, `$ ${Command}`, 'Invalid native command syntax.  Try $help?']);
                return;
            }
            const Result = await NativeCommands.Execute(Parsed, {
                GetOpenFiles:         () => OpenTabs.map(T => T.Name),
                GetActiveFilePath:    () => ActiveFile,
                GetActiveFileName:    () => ActiveFile?.split(/[\\/]/).pop() ?? null,
                GetActiveFileContent: () => FileContentRef.current,
                GetWorkspacePath:     () => WorkspacePath,
                GetOpenFileContents:  () => OpenTabs.map(T => ({ Name: T.Name, Path: T.Path, Content: T.Content })),
            });
            if (Result.Action) {
                switch (Result.Action.Type) {
                    case "ClearTerminal": SetTerminalOutput([]); break;
                    case "Save":          await HandleSave(); break;
                    case "SaveAll":       await HandleSaveAll(); break;
                    case "OpenWorkspace": HandleSelectWorkspace(); break;
                }
            }
            if (Result.Lines.length > 0) SetTerminalOutput(Prev => [...Prev, `$ ${Command}`, ...Result.Lines]);
            return;
        }
        try {
            const Lines = await EditorService.RunTerminalCommand({ Command });
            SetTerminalOutput(Prev => [...Prev, ...Lines]);
        } catch {
            SetTerminalOutput(Prev => [...Prev, `$ ${Command}`, "Command failed"]);
        }
    }, [HandleSave, HandleSaveAll, HandleSelectWorkspace, OpenTabs, ActiveFile, WorkspacePath]);

    const HandleRun = useCallback(async () => {
        if (!ActiveFile || IsRunning || ActiveFile.startsWith("viewport:")) return;
        SetIsRunning(true);
        StateService.Set({ Key: "IsRunning", Value: true });
        try {
            const Lines = await RunService.RunFile({ Path: ActiveFile });
            SetRunOutput(Prev => {
                const Next = [...Prev, ...Lines];
                StateService.Set({ Key: "RunOutput", Value: Next });
                return Next;
            });
        } catch (Err) {
            SetRunOutput(Prev => {
                const Next = [...Prev, `err: ${Err}`];
                StateService.Set({ Key: "RunOutput", Value: Next });
                return Next;
            });
        } finally {
            SetIsRunning(false);
            StateService.Set({ Key: "IsRunning", Value: false });
        }
    }, [ActiveFile, IsRunning]);

    const HandleClearRunOutput = useCallback(() => {
        SetRunOutput([]);
        StateService.Set({ Key: "RunOutput", Value: [] });
    }, []);

    const StartLiveViewport = useCallback((SourcePath: string, Profile: string) => {
        const ViewportPath = `viewport:${SourcePath}`;
        StopLiveViewport(ViewportPath);
        const StartedAt = performance.now();
        const RunToken = StartedAt + Math.random();
        let Version = 0;
        LiveViewportTokensRef.current.set(ViewportPath, RunToken);

        const Schedule = (Delay: number) => {
            if (LiveViewportTokensRef.current.get(ViewportPath) !== RunToken) return;
            const Timer = setTimeout(Tick, Delay);
            LiveViewportTimersRef.current.set(ViewportPath, Timer);
        };

        const Tick = async () => {
            const Now = performance.now();
            if (ActiveFileRef.current !== ViewportPath) {
                Schedule(250);
                return;
            }
            if (Now - LastViewportInteractionRef.current < 140) {
                Schedule(80);
                return;
            }
            const TickStartedAt = performance.now();
            const CurrentVersion = ++Version;
            const Elapsed = (performance.now() - StartedAt) / 1000;
            try {
                const Result = await SceneService.RunLiveScene({ Path: SourcePath, Profile, Elapsed });
                if (!Result.Skipped && CurrentVersion === Version && LiveViewportTokensRef.current.get(ViewportPath) === RunToken) {
                    await RendererService.LoadLiveScene({ Commands: Result.Commands, Profile });
                }
            } catch {
            }
            const Cost = performance.now() - TickStartedAt;
            Schedule(Cost > 24 ? Math.min(120, Math.max(48, Cost)) : 33);
        };

        Schedule(33);
    }, [StopLiveViewport]);

    const HandleOpenViewport = useCallback(async (SourcePath: string) => {
        const ViewportPath = `viewport:${SourcePath}`;
        const FileName = SourcePath.split("\\").pop()?.split("/").pop() || "scene";
        const TabName = `[Scene] ${FileName}`;
        const Profile = InferProfileFromPath(SourcePath).Id;

        const AlreadyOpen = OpenTabs.find(T => T.Path === ViewportPath);
        if (!AlreadyOpen) {
            const NewTab: TabEntry = {
                Path: ViewportPath,
                Name: TabName,
                Content: "",
                DiskContent: "",
                Type: 'viewport',
                EngineProfile: Profile,
            };
            SetOpenTabs(Prev => {
                const Next = [...Prev, NewTab];
                StateService.Set({ Key: "OpenTabs", Value: Next });
                return Next;
            });
        }
        SetActiveFile(ViewportPath);
        StateService.Set({ Key: "ActiveFile", Value: ViewportPath });
        FileContentRef.current = "";
        DiskContentRef.current = "";
        SetFileContent("");
        SetActiveTabModified(false);

        try {
            const Result = await SceneService.RunScene({ Path: SourcePath, Profile });
            await RendererService.LoadScene({ Commands: Result.Commands, Profile });
            if (Profile === "roblox") {
                StartLiveViewport(SourcePath, Profile);
            }
            const Lines: string[] = [
                `▶ Scene: ${FileName}`,
                ...Result.Terminal,
                ...(Result.Errors.length > 0 ? Result.Errors.map(E => `err: ${E}`) : []),
                Result.Errors.length === 0
                    ? `✓ ${Result.Commands.length} object(s) loaded`
                    : `exit 1`,
            ];
            SetTerminalOutput(Prev => [...Prev, ...Lines]);
        } catch (Err) {
            SetTerminalOutput(Prev => [
                ...Prev,
                `▶ Scene: ${FileName}`,
                `err: ${Err}`,
            ]);
        }
    }, [OpenTabs, StartLiveViewport]);

    const HandleFolderToggle = useCallback((Path: string) => {
        SetCollapsedFolders(Prev => {
            const Next = new Set(Prev);
            if (Next.has(Path)) Next.delete(Path);
            else Next.add(Path);
            return Next;
        });
        const Entry = FindEntry(FileTree, Path);
        SetSelectedEntry(Entry);
        SetSelectedMetadata(null);
    }, [FileTree]);

    const HandleNewFile = useCallback(async (FileName: string, TargetDir: string) => {
        if (!WorkspacePath) return;
        const NewPath = `${TargetDir}\\${FileName}`;
        try {
            await FileService.SaveFile({ Path: NewPath, Content: "" });
            const NewTree = await BuildFileTree(WorkspacePath);
            SetFileTree(NewTree);
            StateService.Set({ Key: "FileTree", Value: NewTree });
            await HandleFileSelect(NewPath);
        } catch (Err) {
            SetTerminalOutput(Prev => [...Prev, `err: Could not create file; ${Err}`]);
        }
    }, [WorkspacePath, BuildFileTree, HandleFileSelect]);

    const HandleNewFolder = useCallback(async (FolderName: string, TargetDir: string) => {
        if (!WorkspacePath) return;
        const NewPath = `${TargetDir}\\${FolderName}`;
        try {
            await FileService.CreateFolder({ Path: NewPath });
            const NewTree = await BuildFileTree(WorkspacePath);
            SetFileTree(NewTree);
            StateService.Set({ Key: "FileTree", Value: NewTree });
        } catch (Err) {
            SetTerminalOutput(Prev => [...Prev, `err: Could not create folder; ${Err}`]);
        }
    }, [WorkspacePath, BuildFileTree]);

    const HandleRename = useCallback(async (OldPath: string, NewName: string) => {
        if (!WorkspacePath) return;
        try {
            const NewPath = await FileService.RenamePath({ Path: OldPath, NewName });
            RenameAiChangedPath(OldPath, NewPath);
            SetOpenTabs(Prev => {
                const Next = Prev.map(T =>
                    T.Path === OldPath ? { ...T, Path: NewPath, Name: NewName } : T
                );
                StateService.Set({ Key: "OpenTabs", Value: Next });
                return Next;
            });
            if (ActiveFile === OldPath) {
                SetActiveFile(NewPath);
                StateService.Set({ Key: "ActiveFile", Value: NewPath });
            }
            const NewTree = await BuildFileTree(WorkspacePath);
            SetFileTree(NewTree);
            StateService.Set({ Key: "FileTree", Value: NewTree });
        } catch (Err) {
            SetTerminalOutput(Prev => [...Prev, `err: Could not rename; ${Err}`]);
        }
    }, [WorkspacePath, BuildFileTree, ActiveFile, RenameAiChangedPath]);

    const HandleDelete = useCallback(async (Path: string) => {
        if (!WorkspacePath) return;
        try {
            await FileService.DeletePath({ Path });
            ClearAiChangedPathTree(Path);
            SetOpenTabs(Prev => {
                const Next = Prev.filter(T => !T.Path.startsWith(Path));
                StateService.Set({ Key: "OpenTabs", Value: Next });
                return Next;
            });
            if (ActiveFile && ActiveFile.startsWith(Path)) {
                SetActiveFile(null);
                StateService.Set({ Key: "ActiveFile", Value: null });
                FileContentRef.current = InitialCode;
                DiskContentRef.current = InitialCode;
                SetFileContent(InitialCode);
                SetActiveTabModified(false);
            }
            const NewTree = await BuildFileTree(WorkspacePath);
            SetFileTree(NewTree);
            StateService.Set({ Key: "FileTree", Value: NewTree });
            SetTerminalOutput(Prev => [...Prev, `Deleted: ${Path.split(/[\\/]/).pop()}`]);
        } catch (Err) {
            SetTerminalOutput(Prev => [...Prev, `err: Could not delete; ${Err}`]);
        }
    }, [WorkspacePath, BuildFileTree, ActiveFile, ClearAiChangedPathTree]);

    const HandleDevInjectScript = useCallback(async (FileName: string, Content: string) => {
        if (!WorkspacePath) return;
        const Path = `${WorkspacePath}\\${FileName}`;
        await FileService.SaveFile({ Path, Content });
        const NewTree = await BuildFileTree(WorkspacePath);
        SetFileTree(NewTree);
        StateService.Set({ Key: "FileTree", Value: NewTree });
        await HandleFileSelect(Path);
    }, [WorkspacePath, BuildFileTree, HandleFileSelect]);

    const HandleDevRunScene = useCallback(async (FileName: string, Content: string) => {
        if (!WorkspacePath) return;
        const Path = `${WorkspacePath}\\_nyx_${FileName}`;
        await FileService.SaveFile({ Path, Content });
        await HandleOpenViewport(Path);
    }, [WorkspacePath, HandleOpenViewport]);

    const AllWorkspaceFiles = useMemo(
        () => FlattenTree(FileTree).filter(E => !E.IsDirectory),
        [FileTree]
    );

    const PaletteCommands = useMemo(() => [
        { Id: "settings",  Label: "Open Settings",           Action: () => UILib.Show("Settings") },
        { Id: "scm",       Label: "Toggle Source Control",   Action: () => UILib.Toggle("SourceControl") },
        { Id: "save-all",  Label: "Save All Files",          Action: HandleSaveAll },
        { Id: "workspace", Label: "Open Workspace Folder",   Action: HandleSelectWorkspace },
    ], [HandleSaveAll, HandleSelectWorkspace]);

    const LangLabels: Record<string, string> = {
        luau: "Luau", typescript: "TypeScript", javascript: "JavaScript",
        rust: "Rust", css: "CSS", json: "JSON",
        python: "Python", html: "HTML", toml: "TOML",
        wgsl: "WGSL", glsl: "GLSL", markdown: "Markdown",
        yaml: "YAML", c: "C", cpp: "C++", go: "Go",
        bash: "Bash", sql: "SQL", csharp: "C#", java: "Java",
        xml: "XML", plain: "Plain Text",
    };
    const ActiveFileName = ActiveFile?.split(/[\\/]/).pop() ?? "";
    const DisplayLanguage = ActiveFile && !ActiveFile.startsWith("viewport:")
        ? (LangLabels[DetectLanguage(ActiveFileName)] ?? "Plain Text")
        : "—";

    // Unsaved count: active tab uses live ref, others use stale tab content
    const UnsavedCount = OpenTabs.filter(T =>
        T.Path === ActiveFile
            ? ActiveTabModified
            : T.Content !== T.DiskContent
    ).length;
    const AiChangedFileSet = useMemo(
        () => new Set(AiChangedFiles.map(NormalizePathKey)),
        [AiChangedFiles]
    );

    const HandleOpenRecent = useCallback(async (FolderPath: string) => {
        SetIsLoading(true);
        StateService.Set({ Key: "AppStatus", Value: "loading" });
        try {
            const Tree = await BuildFileTree(FolderPath);
            SetFileTree(Tree);
            SetWorkspacePath(FolderPath);
            StateService.Set({ Key: "AiChangedFiles", Value: [] });
            StateService.Set({ Key: "WorkspacePath", Value: FolderPath });
            StateService.Set({ Key: "FileTree", Value: Tree });
            const SubFolders = CollectAllFolderPaths(Tree[0]?.Children ?? []);
            SetCollapsedFolders(new Set(SubFolders));
            SetTerminalOutput(Prev => [...Prev, `Workspace: ${FolderPath}`]);
            SetRecentPaths(AddRecentWorkspace(FolderPath));
            SetAppReady(true);
        } catch {
            // folder may no longer exist — remove from recents
            const Next = GetRecentWorkspaces().filter(P => P !== FolderPath);
            localStorage.setItem(RECENT_KEY, JSON.stringify(Next));
            SetRecentPaths(Next);
        } finally {
            SetIsLoading(false);
            StateService.Set({ Key: "AppStatus", Value: "idle" });
        }
    }, [BuildFileTree]);

    if (!AppReady) {
        return (
            <div className="App" key="start">
                <StartScreen
                    OnOpenFolder={HandleOpenFolderFromStart}
                    OnContinue={() => SetAppReady(true)}
                    OnOpenRecent={HandleOpenRecent}
                    IsLoading={IsLoading}
                    RecentPaths={RecentPaths}
                />
            </div>
        );
    }

    return (
        <div className="App AppEnter" key="main" ref={AppRef}>
            <div className="Main">
                <ActivityBar />
                {WorkspacePath ? (
                    <Sidebar
                        Files={FileTree}
                        ActiveFile={ActiveFile}
                        OnFileSelect={HandleFileSelect}
                        CollapsedFolders={CollapsedFolders}
                        OnFolderToggle={HandleFolderToggle}
                        UnsavedCount={UnsavedCount}
                        OnSaveAll={HandleSaveAll}
                        OnNewFile={HandleNewFile}
                        OnNewFolder={HandleNewFolder}
                        OnRename={HandleRename}
                        OnDelete={HandleDelete}
                        AiChangedFiles={AiChangedFileSet}
                    />
                ) : (
                    <div className="NoWorkspacePanel">
                        {IsLoading ? (
                            <div className="NoWorkspaceLoading">
                                <img src="/Kitty.png" alt="" className="SpinningCat" style={{ width: 36, height: 36 }} />
                            </div>
                        ) : (
                            <button className="OpenFolderInline" onClick={HandleSelectWorkspace}>
                                Open Folder
                            </button>
                        )}
                    </div>
                )}
                <div className="EditorPanel">
                    <EditorArea
                        FileContent={FileContent}
                        FileName={ActiveFile?.split("\\").pop()?.split("/").pop() || "untitled"}
                        OnContentChange={HandleContentChange}
                        OnCursorChange={(Line, Col) => {
                            SetCursorLine(Line);
                            SetCursorCol(Col);
                        }}
                        OpenTabs={OpenTabs}
                        ActiveFile={ActiveFile}
                        OnTabClose={HandleTabClose}
                        OnTabSelect={HandleTabSelect}
                        OnSaveFile={HandleSaveFile}
                        SwitchDir={SwitchDir}
                        ShowSavedFlash={SavedFlash}
                        ActiveFileModified={ActiveTabModified}
                        ExternalContentVersion={ExternalContentVersion}
                        ViewportContent={
                            OpenTabs.find(T => T.Path === ActiveFile)?.Type === 'viewport'
                                ? <ViewportTab />
                                : undefined
                        }
                    />
                    <TerminalPanel
                        Output={TerminalOutput}
                        OnCommand={HandleTerminalCommand}
                        ActiveFile={ActiveFile}
                        FileContent={FileContent}
                        Workspace={WorkspacePath}
                        OnOpenFile={HandleAiOpenFile}
                    />
                </div>
                <PropertiesBar
                    SelectedEntry={SelectedEntry}
                    Metadata={SelectedMetadata}
                    ActiveFile={ActiveFile}
                    RunOutput={RunOutput}
                    IsRunning={IsRunning}
                    OnRun={HandleRun}
                    OnClearOutput={HandleClearRunOutput}
                    OnOpenViewport={HandleOpenViewport}
                />
            </div>
            <StatusBar
                Line={CursorLine}
                Column={CursorCol}
                Branch={GitBranch}
                Language={DisplayLanguage}
                Encoding="UTF-8"
            />
            {IsSourceControlOpen && (
                <SourceControl
                    WorkspacePath={WorkspacePath}
                    Branch={GitBranch}
                    OnClose={() => UILib.Hide("SourceControl")}
                />
            )}
            {IsSettingsOpen && (
                <SettingsPanel
                    OnClose={() => UILib.Hide("Settings")}
                />
            )}
            {IsCommandPaletteOpen && (
                <CommandPalette
                    OpenTabs={OpenTabs}
                    AllFiles={AllWorkspaceFiles}
                    ActiveFile={ActiveFile}
                    OnSelectFile={HandleFileSelect}
                    OnClose={() => UILib.Hide("CommandPalette")}
                    Commands={PaletteCommands}
                />
            )}
            {DevMenuOpen && (
                <DevMenu
                    WorkspacePath={WorkspacePath}
                    OpenTabsCount={OpenTabs.length}
                    ActiveFile={ActiveFile}
                    TerminalLineCount={TerminalOutput.length}
                    OnInjectScript={HandleDevInjectScript}
                    OnRunScene={HandleDevRunScene}
                    OnTerminalLog={(Lines: string[]) => SetTerminalOutput(Prev => [...Prev, ...Lines])}
                />
            )}
        </div>
    );
};
