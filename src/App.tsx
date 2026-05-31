import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { RunService } from "./services/RunService";
import { NativeCommands } from "./services/NativeCommands";
import { StateManager } from "./state/StateManager";
import { SceneService } from "./services/SceneService";
import { RendererService } from "./services/RendererService";
import { DevMenu } from "./components/DevMenu";
import { UILib, UsePanel } from "./ui/UILib";
import { invoke } from "@tauri-apps/api/tauri";
import "./styles/global.css";

StateManager.init();

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

export const App: React.FC = () => {
    const [AppReady, SetAppReady] = useState(false);
    const DevMenuOpen = UsePanel("DevMenu");
    const [ActiveFile, SetActiveFile] = useState<string | null>(null);
    const [FileContent, SetFileContent] = useState(InitialCode);
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
    const PrevActiveFileRef = useRef<string | null>(null);
    const AppRef = useRef<HTMLDivElement>(null);
    const ActiveFileRef = useRef<string | null>(null);
    const FileContentRef = useRef<string>(InitialCode);
    const DiskContentRef = useRef<string>(InitialCode);
    const LastKnownMtimeRef = useRef<string | null>(null);

    useEffect(() => {
        const PreventMenu = (E: MouseEvent) => E.preventDefault();
        document.addEventListener('contextmenu', PreventMenu);
        return () => document.removeEventListener('contextmenu', PreventMenu);
    }, []);

    useEffect(() => { ActiveFileRef.current = ActiveFile; }, [ActiveFile]);
    useEffect(() => { FileContentRef.current = FileContent; }, [FileContent]);

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
            SetOpenTabs(Prev => Prev.map(T => T.Path === Path ? { ...T, DiskContent: Content } : T));
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
        const Tab = OpenTabs.find(T => T.Path === Path);
        if (!Tab || Tab.Content === Tab.DiskContent) return;
        try {
            await FileService.SaveFile({ Path, Content: Tab.Content });
            SetOpenTabs(Prev => Prev.map(T => T.Path === Path ? { ...T, DiskContent: T.Content } : T));
            if (Path === ActiveFile) {
                DiskContentRef.current = Tab.Content;
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
        const Unsaved = OpenTabs.filter(T => T.Content !== T.DiskContent);
        if (Unsaved.length === 0) return;
        await Promise.all(Unsaved.map(Tab =>
            FileService.SaveFile({ Path: Tab.Path, Content: Tab.Content }).catch(Err =>
                console.error(`Save failed: ${Tab.Path}`, Err)
            )
        ));
        SetOpenTabs(Prev => Prev.map(T =>
            Unsaved.some(U => U.Path === T.Path) ? { ...T, DiskContent: T.Content } : T
        ));
        const ActiveUnsaved = Unsaved.find(T => T.Path === ActiveFile);
        if (ActiveUnsaved) {
            DiskContentRef.current = ActiveUnsaved.Content;
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

        const onKeyDown = (e: KeyboardEvent) => {
            if (!viewportEl.contains(e.target as Node)) return;
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
                invoke('renderer_camera_wasd', { forward, right, up }).catch(() => {});
            }
        };

        const onKeyUp = (e: KeyboardEvent) => {
            keysDown.delete(e.key.toLowerCase());
        };

        const onMouseDown = (e: MouseEvent) => {
            if (!viewportEl.contains(e.target as Node)) return;
            if (e.button === 2) {
                keysDown.add('mouse2');
                invoke('renderer_camera_right_mouse', { down: true }).catch(() => {});
                e.preventDefault();
            }
        };

        const onMouseUp = (e: MouseEvent) => {
            if (e.button === 2) {
                keysDown.delete('mouse2');
                invoke('renderer_camera_right_mouse', { down: false }).catch(() => {});
            }
        };

        const onContextMenu = (e: MouseEvent) => {
            if (viewportEl.contains(e.target as Node)) {
                e.preventDefault();
            }
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('mousedown', onMouseDown);
        window.addEventListener('mouseup', onMouseUp);
        window.addEventListener('contextmenu', onContextMenu);

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('contextmenu', onContextMenu);
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
                SetFileContent(Content);
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
            StateManager.set("AppStatus", "loading");
            const Tree = await BuildFileTree(FolderPath);
            SetFileTree(Tree);
            SetWorkspacePath(FolderPath);
            StateManager.set("WorkspacePath", FolderPath);
            StateManager.set("FileTree", Tree);
            const SubFolders = CollectAllFolderPaths(Tree[0]?.Children ?? []);
            SetCollapsedFolders(new Set(SubFolders));
            SetIsLoading(false);
            StateManager.set("AppStatus", "idle");
            SetTerminalOutput(Prev => [...Prev, `Workspace: ${FolderPath}`]);
            SetAppReady(true);
        } catch (Error) {
            console.error("Failed to load workspace:", Error);
            SetIsLoading(false);
            StateManager.set("AppStatus", "idle");
        }
    }, [BuildFileTree]);

    const HandleSelectWorkspace = useCallback(async () => {
        try {
            const FolderPath = await FileService.SelectFolder();
            if (!FolderPath) return;
            SetIsLoading(true);
            StateManager.set("AppStatus", "loading");
            const Tree = await BuildFileTree(FolderPath);
            SetFileTree(Tree);
            SetWorkspacePath(FolderPath);
            StateManager.set("WorkspacePath", FolderPath);
            StateManager.set("FileTree", Tree);
            SetIsLoading(false);
            StateManager.set("AppStatus", "idle");
            SetActiveFile(null);
            StateManager.set("ActiveFile", null);
            SetFileContent(InitialCode);
            SetOpenTabs([]);
            StateManager.set("OpenTabs", []);
            const SubFolders = CollectAllFolderPaths(Tree[0]?.Children ?? []);
            SetCollapsedFolders(new Set(SubFolders));
            SetTerminalOutput(Prev => [...Prev, `Workspace: ${FolderPath}`]);
        } catch (Error) {
            console.error("Failed to select folder:", Error);
            SetIsLoading(false);
            StateManager.set("AppStatus", "idle");
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
        StateManager.set("ActiveFile", Path);
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
            DiskContentRef.current = ExistingTab.DiskContent;
            SetFileContent(ExistingTab.Content);
            return;
        }

        try {
            const Content = await FileService.OpenFile({ Path });
            const FileName = Path.split("\\").pop()?.split("/").pop() || "untitled";
            DiskContentRef.current = Content;
            SetOpenTabs(Prev => {
                const Next = [...Prev, { Path, Name: FileName, Content, DiskContent: Content }];
                StateManager.set("OpenTabs", Next);
                return Next;
            });
            SetFileContent(Content);
        } catch {
            SetFileContent("// Could not load file");
        }
    }, [FileTree, OpenTabs]);

    const HandleTabClose = useCallback((Path: string) => {
        SetOpenTabs(Prev => {
            const NewTabs = Prev.filter(T => T.Path !== Path);
            StateManager.set("OpenTabs", NewTabs);
            if (Path === ActiveFile) {
                const LastTab = NewTabs[NewTabs.length - 1];
                if (LastTab) {
                    SetActiveFile(LastTab.Path);
                    StateManager.set("ActiveFile", LastTab.Path);
                    SetFileContent(LastTab.Content);
                } else {
                    SetActiveFile(null);
                    StateManager.set("ActiveFile", null);
                    SetFileContent(InitialCode);
                }
            }
            return NewTabs;
        });
    }, [ActiveFile]);

    const HandleTabSelect = useCallback((Path: string) => {
        const Tab = OpenTabs.find(T => T.Path === Path);
        if (Tab) {
            SetSwitchDir("none");
            SetActiveFile(Path);
            StateManager.set("ActiveFile", Path);
            if (Tab.Type === 'viewport') {
                SetFileContent("");
                DiskContentRef.current = "";
            } else {
                SetFileContent(Tab.Content);
                DiskContentRef.current = Tab.DiskContent;
            }
        }
    }, [OpenTabs]);

    const HandleContentChange = useCallback((Content: string) => {
        SetFileContent(Content);
        SetOpenTabs(Prev => Prev.map(T => T.Path === ActiveFile ? { ...T, Content } : T));
    }, [ActiveFile]);

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
                GetActiveFileContent: () => FileContent,
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
    }, [HandleSave, HandleSaveAll, HandleSelectWorkspace, OpenTabs, ActiveFile, FileContent, WorkspacePath]);

    const HandleRun = useCallback(async () => {
        if (!ActiveFile || IsRunning || ActiveFile.startsWith("viewport:")) return;
        SetIsRunning(true);
        StateManager.set("IsRunning", true);
        try {
            const Lines = await RunService.RunFile({ Path: ActiveFile });
            SetRunOutput(Prev => {
                const Next = [...Prev, ...Lines];
                StateManager.set("RunOutput", Next);
                return Next;
            });
        } catch (Err) {
            SetRunOutput(Prev => {
                const Next = [...Prev, `err: ${Err}`];
                StateManager.set("RunOutput", Next);
                return Next;
            });
        } finally {
            SetIsRunning(false);
            StateManager.set("IsRunning", false);
        }
    }, [ActiveFile, IsRunning]);

    const HandleClearRunOutput = useCallback(() => {
        SetRunOutput([]);
        StateManager.set("RunOutput", []);
    }, []);

    const HandleOpenViewport = useCallback(async (SourcePath: string) => {
        const ViewportPath = `viewport:${SourcePath}`;
        const FileName = SourcePath.split("\\").pop()?.split("/").pop() || "scene";
        const TabName = `[Scene] ${FileName}`;
        const Profile = 'roblox';

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
                StateManager.set("OpenTabs", Next);
                return Next;
            });
        }
        SetActiveFile(ViewportPath);
        StateManager.set("ActiveFile", ViewportPath);
        SetFileContent("");

        try {
            const Result = await SceneService.RunScene({ Path: SourcePath, Profile });
            await RendererService.LoadScene({ Commands: Result.Commands, Profile });
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
    }, [OpenTabs]);

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
            StateManager.set("FileTree", NewTree);
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
            StateManager.set("FileTree", NewTree);
        } catch (Err) {
            SetTerminalOutput(Prev => [...Prev, `err: Could not create folder; ${Err}`]);
        }
    }, [WorkspacePath, BuildFileTree]);

    const HandleRename = useCallback(async (OldPath: string, NewName: string) => {
        if (!WorkspacePath) return;
        try {
            const NewPath = await FileService.RenamePath({ Path: OldPath, NewName });
            SetOpenTabs(Prev => {
                const Next = Prev.map(T =>
                    T.Path === OldPath ? { ...T, Path: NewPath, Name: NewName } : T
                );
                StateManager.set("OpenTabs", Next);
                return Next;
            });
            if (ActiveFile === OldPath) {
                SetActiveFile(NewPath);
                StateManager.set("ActiveFile", NewPath);
            }
            const NewTree = await BuildFileTree(WorkspacePath);
            SetFileTree(NewTree);
            StateManager.set("FileTree", NewTree);
        } catch (Err) {
            SetTerminalOutput(Prev => [...Prev, `err: Could not rename; ${Err}`]);
        }
    }, [WorkspacePath, BuildFileTree, ActiveFile]);

    const HandleDelete = useCallback(async (Path: string) => {
        if (!WorkspacePath) return;
        try {
            await FileService.DeletePath({ Path });
            SetOpenTabs(Prev => {
                const Next = Prev.filter(T => !T.Path.startsWith(Path));
                StateManager.set("OpenTabs", Next);
                return Next;
            });
            if (ActiveFile && ActiveFile.startsWith(Path)) {
                SetActiveFile(null);
                StateManager.set("ActiveFile", null);
                SetFileContent(InitialCode);
            }
            const NewTree = await BuildFileTree(WorkspacePath);
            SetFileTree(NewTree);
            StateManager.set("FileTree", NewTree);
            SetTerminalOutput(Prev => [...Prev, `Deleted: ${Path.split(/[\\/]/).pop()}`]);
        } catch (Err) {
            SetTerminalOutput(Prev => [...Prev, `err: Could not delete; ${Err}`]);
        }
    }, [WorkspacePath, BuildFileTree, ActiveFile]);

    const HandleDevInjectScript = useCallback(async (FileName: string, Content: string) => {
        if (!WorkspacePath) return;
        const Path = `${WorkspacePath}\\${FileName}`;
        await FileService.SaveFile({ Path, Content });
        const NewTree = await BuildFileTree(WorkspacePath);
        SetFileTree(NewTree);
        StateManager.set("FileTree", NewTree);
        await HandleFileSelect(Path);
    }, [WorkspacePath, BuildFileTree, HandleFileSelect]);

    const HandleDevRunScene = useCallback(async (FileName: string, Content: string) => {
        if (!WorkspacePath) return;
        const Path = `${WorkspacePath}\\_nyx_${FileName}`;
        await FileService.SaveFile({ Path, Content });
        await HandleOpenViewport(Path);
    }, [WorkspacePath, HandleOpenViewport]);

    if (!AppReady) {
        return (
            <div className="App">
                <StartScreen
                    OnOpenFolder={HandleOpenFolderFromStart}
                    OnContinue={() => SetAppReady(true)}
                    IsLoading={IsLoading}
                />
            </div>
        );
    }

    return (
        <div className="App" ref={AppRef}>
            <div className="Main">
                <ActivityBar />
                {WorkspacePath ? (
                    <Sidebar
                        Files={FileTree}
                        ActiveFile={ActiveFile}
                        OnFileSelect={HandleFileSelect}
                        CollapsedFolders={CollapsedFolders}
                        OnFolderToggle={HandleFolderToggle}
                        UnsavedCount={OpenTabs.filter(T => T.Content !== T.DiskContent).length}
                        OnSaveAll={HandleSaveAll}
                        OnNewFile={HandleNewFile}
                        OnNewFolder={HandleNewFolder}
                        OnRename={HandleRename}
                        OnDelete={HandleDelete}
                    />
                ) : (
                    <div className="NoWorkspacePanel">
                        {IsLoading ? (
                            <div className="NoWorkspaceLoading">
                                <img src="/media/Kitty.png" alt="" className="SpinningCat" style={{ width: 36, height: 36 }} />
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
                        ViewportContent={
                            OpenTabs.find(T => T.Path === ActiveFile)?.Type === 'viewport'
                                ? <ViewportTab />
                                : undefined
                        }
                    />
                    <TerminalPanel
                        Output={TerminalOutput}
                        OnCommand={HandleTerminalCommand}
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
                Language="Luau"
                Encoding="UTF-8"
            />
            {DevMenuOpen && (
                <DevMenu
                    WorkspacePath={WorkspacePath}
                    OpenTabsCount={OpenTabs.length}
                    ActiveFile={ActiveFile}
                    TerminalLineCount={TerminalOutput.length}
                    OnInjectScript={HandleDevInjectScript}
                    OnRunScene={HandleDevRunScene}
                    OnTerminalLog={Lines => SetTerminalOutput(Prev => [...Prev, ...Lines])}
                />
            )}
        </div>
    );
};
