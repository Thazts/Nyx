import React, { useState, useEffect, useCallback, useRef } from "react";
import styles from "../styles/SourceControl.module.css";
import { GitService, GitStatus, GitFileEntry } from "../services/GitService";

interface SourceControlProps {
    WorkspacePath: string | null;
    Branch:        string;
    OnClose:       () => void;
}

function StatusBadge({ Code }: { Code: string }) {
    const Cls =
        Code === "M" ? styles.StatusM :
        Code === "A" ? styles.StatusA :
        Code === "D" ? styles.StatusD :
        Code === "R" ? styles.StatusR :
                       styles.StatusQ;
    return <span className={`${styles.StatusBadge} ${Cls}`}>{Code === "?" ? "?" : Code}</span>;
}

function FileLabel({ Path }: { Path: string }) {
    const Parts = Path.replace(/\\/g, "/").split("/");
    const Name  = Parts.pop() ?? Path;
    const Dir   = Parts.length > 0 ? Parts.join("/") + "/" : "";
    return (
        <span className={styles.FileName}>
            {Name}
            {Dir && <span className={styles.FileDir}>{Dir}</span>}
        </span>
    );
}

const RefreshIcon = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13.5 2.5A7 7 0 1 0 14.5 8"/>
        <path d="M10 2.5h3.5v3.5"/>
    </svg>
);

const CloseIcon = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M3 3l10 10M13 3L3 13"/>
    </svg>
);

const PlusIcon = () => (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M8 3v10M3 8h10"/>
    </svg>
);

const MinusIcon = () => (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M3 8h10"/>
    </svg>
);

const DiscardIcon = () => (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 2.5A5.5 5.5 0 1 0 13.5 6"/>
        <path d="M7.5 2.5h3v3"/>
    </svg>
);

export const SourceControl: React.FC<SourceControlProps> = ({ WorkspacePath, Branch, OnClose }) => {
    const [Status, SetStatus]     = useState<GitStatus | null>(null);
    const [Loading, SetLoading]   = useState(false);
    const [CommitMsg, SetCommitMsg] = useState("");
    const [Error, SetError]       = useState<string | null>(null);
    const MsgRef = useRef<HTMLTextAreaElement>(null);

    const Refresh = useCallback(async () => {
        if (!WorkspacePath) return;
        SetLoading(true);
        SetError(null);
        try {
            const S = await GitService.Status(WorkspacePath);
            SetStatus(S);
        } catch (E) {
            SetError(String(E));
        } finally {
            SetLoading(false);
        }
    }, [WorkspacePath]);

    useEffect(() => { Refresh(); }, [Refresh]);

    const HandleStage = useCallback(async (Entry: GitFileEntry) => {
        if (!WorkspacePath) return;
        await GitService.Stage(WorkspacePath, Entry.Path);
        Refresh();
    }, [WorkspacePath, Refresh]);

    const HandleUnstage = useCallback(async (Entry: GitFileEntry) => {
        if (!WorkspacePath) return;
        await GitService.Unstage(WorkspacePath, Entry.Path);
        Refresh();
    }, [WorkspacePath, Refresh]);

    const HandleDiscard = useCallback(async (Entry: GitFileEntry) => {
        if (!WorkspacePath) return;
        await GitService.Discard(WorkspacePath, Entry.Path);
        Refresh();
    }, [WorkspacePath, Refresh]);

    const HandleStageAll = useCallback(async () => {
        if (!WorkspacePath) return;
        await GitService.StageAll(WorkspacePath);
        Refresh();
    }, [WorkspacePath, Refresh]);

    const HandleUnstageAll = useCallback(async () => {
        if (!WorkspacePath) return;
        await GitService.UnstageAll(WorkspacePath);
        Refresh();
    }, [WorkspacePath, Refresh]);

    const HandleCommit = useCallback(async () => {
        if (!WorkspacePath || !CommitMsg.trim()) return;
        SetLoading(true);
        try {
            await GitService.Commit(WorkspacePath, CommitMsg.trim());
            SetCommitMsg("");
            Refresh();
        } catch (E) {
            SetError(String(E));
            SetLoading(false);
        }
    }, [WorkspacePath, CommitMsg, Refresh]);

    const HasStaged = (Status?.Staged.length ?? 0) > 0;

    return (
        <>
            <div className={styles.Backdrop} onClick={OnClose} />
            <div className={styles.Panel}>
                <div className={styles.Header}>
                    <div className={styles.HeaderLeft}>
                        <span className={styles.Title}>Source Control</span>
                        {Branch && <span className={styles.Branch}>{Branch}</span>}
                    </div>
                    <div className={styles.HeaderActions}>
                        <button
                            className={styles.IconBtn}
                            onClick={Refresh}
                            title="Refresh"
                        >
                            <span className={Loading ? styles.Spinning : undefined}>
                                <RefreshIcon />
                            </span>
                        </button>
                        <button className={styles.IconBtn} onClick={OnClose} title="Close">
                            <CloseIcon />
                        </button>
                    </div>
                </div>

                {!WorkspacePath ? (
                    <div className={styles.NoWorkspace}>
                        Open a workspace folder to use source control.
                    </div>
                ) : (
                    <>
                        <div className={styles.CommitArea}>
                            <textarea
                                ref={MsgRef}
                                className={styles.CommitInput}
                                placeholder="Commit message"
                                value={CommitMsg}
                                onChange={E => SetCommitMsg(E.target.value)}
                                onKeyDown={E => {
                                    if (E.ctrlKey && E.key === "Enter") HandleCommit();
                                }}
                                spellCheck={false}
                            />
                            <button
                                className={styles.CommitBtn}
                                onClick={HandleCommit}
                                disabled={!HasStaged || !CommitMsg.trim() || Loading}
                            >
                                Commit {HasStaged ? `(${Status!.Staged.length})` : ""}
                            </button>
                        </div>

                        {Error && <div className={styles.ErrorBanner}>{Error}</div>}

                        <div className={styles.Scroll}>
                            <div className={styles.Section}>
                                <div className={styles.SectionHeader}>
                                    <span className={styles.SectionTitle}>Staged</span>
                                    <div className={styles.HeaderActions}>
                                        <span className={styles.SectionCount}>{Status?.Staged.length ?? 0}</span>
                                        {HasStaged && (
                                            <button className={styles.SmallBtn} onClick={HandleUnstageAll} title="Unstage all">
                                                <MinusIcon />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {Status?.Staged.length === 0 && (
                                    <div className={styles.EmptyHint}>No staged changes</div>
                                )}
                                {Status?.Staged.map((E, I) => (
                                    <div key={I} className={styles.FileRow}>
                                        <StatusBadge Code={E.StagedStatus} />
                                        <FileLabel Path={E.Path} />
                                        <button className={styles.FileAction} onClick={() => HandleUnstage(E)} title="Unstage">
                                            <MinusIcon />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div className={styles.Section}>
                                <div className={styles.SectionHeader}>
                                    <span className={styles.SectionTitle}>Changes</span>
                                    <div className={styles.HeaderActions}>
                                        <span className={styles.SectionCount}>{Status?.Unstaged.length ?? 0}</span>
                                        {(Status?.Unstaged.length ?? 0) > 0 && (
                                            <button className={styles.SmallBtn} onClick={HandleStageAll} title="Stage all">
                                                <PlusIcon />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {Status?.Unstaged.length === 0 && (
                                    <div className={styles.EmptyHint}>No unstaged changes</div>
                                )}
                                {Status?.Unstaged.map((E, I) => (
                                    <div key={I} className={styles.FileRow}>
                                        <StatusBadge Code={E.WorkingStatus} />
                                        <FileLabel Path={E.Path} />
                                        <button className={styles.FileAction} onClick={() => HandleDiscard(E)} title="Discard changes">
                                            <DiscardIcon />
                                        </button>
                                        <button className={styles.FileAction} onClick={() => HandleStage(E)} title="Stage">
                                            <PlusIcon />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div className={styles.Section}>
                                <div className={styles.SectionHeader}>
                                    <span className={styles.SectionTitle}>Untracked</span>
                                    <div className={styles.HeaderActions}>
                                        <span className={styles.SectionCount}>{Status?.Untracked.length ?? 0}</span>
                                    </div>
                                </div>
                                {Status?.Untracked.map((E, I) => (
                                    <div key={I} className={styles.FileRow}>
                                        <StatusBadge Code="?" />
                                        <FileLabel Path={E.Path} />
                                        <button className={styles.FileAction} onClick={() => HandleStage(E)} title="Stage">
                                            <PlusIcon />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </>
    );
};
