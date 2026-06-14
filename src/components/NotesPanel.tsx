import React, { useState, useCallback, useRef, useEffect } from "react";
import styles from "../styles/NotesPanel.module.css";
import { NotesStore, UseNotes } from "../services/NotesStore";
import { UsePanelDismiss } from "../ui/UILib";

const TrashIcon = () => (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 5h10M7 5V3h2v2M5 5l1 8h4l1-8"/>
    </svg>
);

const CloseIcon = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M3 3l10 10M13 3L3 13"/>
    </svg>
);

const CheckIcon = () => (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 5l3 3 4-5"/>
    </svg>
);

const GitHubIcon = () => (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
    </svg>
);

const ChevronIcon = () => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M2 3.5l3 3 3-3"/>
    </svg>
);

const SyncIcon = () => (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13.5 2.5A7 7 0 1 0 14.5 9"/>
        <path d="M14.5 2.5v4h-4"/>
    </svg>
);

const PriorityDot = ({ Level }: { Level: 0 | 1 | 2 }) => (
    <span
        className={styles.PriorityDot}
        style={{
            background: Level === 0 ? "#c97070" : Level === 1 ? "#c4a83a" : "transparent",
            border: Level === 2 ? "1.5px solid var(--txt3)" : "none",
        }}
    />
);

export const NotesPanel: React.FC = () => {
    const { Closing, Dismiss, HandleAnimationEnd } = UsePanelDismiss("Notes");
    const Notes = UseNotes();
    const [Input,      SetInput]      = useState("");
    const [GhOpen,     SetGhOpen]     = useState(false);
    const [Repo,       SetRepo]       = useState(Notes.GitHub?.Repo  ?? "");
    const [Token,      SetToken]      = useState(Notes.GitHub?.Token ?? "");
    const [Syncing,    SetSyncing]    = useState(false);
    const [SyncError,  SetSyncError]  = useState<string | null>(null);
    const InputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        InputRef.current?.focus();
    }, []);

    const HandleKeyDown = useCallback((E: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (E.key === "Enter" && !E.shiftKey) {
            E.preventDefault();
            const Text = Input.trim();
            if (!Text) return;
            NotesStore.Add(Text);
            SetInput("");
        }
    }, [Input]);

    const HandleAdd = useCallback(() => {
        const Text = Input.trim();
        if (!Text) return;
        NotesStore.Add(Text);
        SetInput("");
        InputRef.current?.focus();
    }, [Input]);

    const HandleSync = useCallback(async () => {
        const RepoTrimmed = Repo.trim();
        if (!RepoTrimmed) return;
        NotesStore.SetGitHub({ Repo: RepoTrimmed, Token: Token.trim() || undefined });
        SetSyncing(true);
        SetSyncError(null);
        try {
            await NotesStore.SyncGitHub();
            SetGhOpen(false);
        } catch (E) {
            SetSyncError(E instanceof Error ? E.message : "Sync failed");
        } finally {
            SetSyncing(false);
        }
    }, [Repo, Token]);

    const HandleClearGitHub = useCallback(() => {
        NotesStore.ClearGitHub();
        SetRepo("");
        SetToken("");
        SetSyncError(null);
    }, []);

    const PendingCount = Notes.Items.filter((_, I) => !Notes.Checked[I]).length
        + Notes.Issues.filter(I => !I.Checked).length;

    const SortedIssues = [...Notes.Issues].sort((A, B) => A.Priority - B.Priority || A.Number - B.Number);
    const IsConfigured = !!Notes.GitHub?.Repo;
    const HasContent   = Notes.Items.length > 0 || SortedIssues.length > 0;

    return (
        <>
            <div className={`${styles.Backdrop} ${Closing ? styles.Closing : ""}`} onClick={Dismiss} />
            <div className={`${styles.Panel} ${Closing ? styles.Closing : ""}`} onAnimationEnd={HandleAnimationEnd}>
                <div className={styles.Header}>
                    <div className={styles.HeaderLeft}>
                        <span className={styles.Title}>Notes</span>
                        {PendingCount > 0 && (
                            <span className={styles.PendingBadge}>{PendingCount} left</span>
                        )}
                    </div>
                    <div className={styles.HeaderActions}>
                        <button className={styles.IconBtn} onClick={Dismiss} title="Close">
                            <CloseIcon />
                        </button>
                    </div>
                </div>

                <div className={styles.List}>
                    {SortedIssues.length > 0 && (
                        <>
                            <div className={styles.GroupHeader}>
                                <span className={styles.GroupIcon}><GitHubIcon /></span>
                                <span className={styles.GroupLabel}>GitHub Issues</span>
                                <button
                                    className={styles.ReSyncBtn}
                                    onClick={HandleSync}
                                    disabled={Syncing}
                                    title="Re-sync"
                                >
                                    <SyncIcon />
                                </button>
                            </div>
                            {SortedIssues.map(Issue => (
                                <div key={Issue.Number} className={`${styles.Item} ${Issue.Checked ? styles.ItemDone : ""}`}>
                                    <button
                                        className={`${styles.Checkbox} ${Issue.Checked ? styles.CheckboxDone : ""}`}
                                        onClick={() => NotesStore.ToggleIssue(Issue.Number)}
                                        aria-label={Issue.Checked ? "Mark undone" : "Mark done"}
                                    >
                                        {Issue.Checked && <CheckIcon />}
                                    </button>
                                    <PriorityDot Level={Issue.Priority} />
                                    <span className={styles.IssueNum}>#{Issue.Number}</span>
                                    <span className={styles.ItemText}>{Issue.Title}</span>
                                    <button
                                        className={styles.DeleteBtn}
                                        onClick={() => NotesStore.DeleteIssue(Issue.Number)}
                                        title="Dismiss"
                                    >
                                        <TrashIcon />
                                    </button>
                                </div>
                            ))}
                            {Notes.Items.length > 0 && <div className={styles.GroupDivider} />}
                        </>
                    )}

                    {Notes.Items.length > 0 && SortedIssues.length > 0 && (
                        <div className={styles.GroupHeader}>
                            <span className={styles.GroupLabel}>My Notes</span>
                        </div>
                    )}

                    {Notes.Items.map((Item, I) => (
                        <div key={I} className={`${styles.Item} ${Notes.Checked[I] ? styles.ItemDone : ""}`}>
                            <button
                                className={`${styles.Checkbox} ${Notes.Checked[I] ? styles.CheckboxDone : ""}`}
                                onClick={() => NotesStore.Toggle(I)}
                                aria-label={Notes.Checked[I] ? "Mark undone" : "Mark done"}
                            >
                                {Notes.Checked[I] && <CheckIcon />}
                            </button>
                            <span className={styles.ItemText}>{Item}</span>
                            <button
                                className={styles.DeleteBtn}
                                onClick={() => NotesStore.Delete(I)}
                                title="Remove"
                            >
                                <TrashIcon />
                            </button>
                        </div>
                    ))}

                    {!HasContent && (
                        <div className={styles.Empty}>
                            No notes yet.<br />Add something below to get started.
                        </div>
                    )}
                </div>
                <div className={styles.GitHubSection}>
                    <button
                        className={`${styles.GitHubToggle} ${GhOpen ? styles.GitHubToggleOpen : ""}`}
                        onClick={() => SetGhOpen(O => !O)}
                    >
                        <span className={styles.GitHubToggleIcon}><GitHubIcon /></span>
                        <span className={styles.GitHubToggleLabel}>
                            {IsConfigured ? Notes.GitHub!.Repo : "Connect GitHub"}
                        </span>
                        <span className={`${styles.GitHubChevron} ${GhOpen ? styles.GitHubChevronOpen : ""}`}>
                            <ChevronIcon />
                        </span>
                    </button>

                    {GhOpen && (
                        <div className={styles.GitHubForm}>
                            <input
                                className={styles.GitHubInput}
                                type="text"
                                placeholder="owner/repo"
                                value={Repo}
                                onChange={E => SetRepo(E.target.value)}
                                onKeyDown={E => E.key === "Enter" && HandleSync()}
                                spellCheck={false}
                            />
                            <input
                                className={styles.GitHubInput}
                                type="password"
                                placeholder="Token (optional, for private repos)"
                                value={Token}
                                onChange={E => SetToken(E.target.value)}
                            />
                            {SyncError && (
                                <div className={styles.SyncError}>{SyncError}</div>
                            )}
                            <div className={styles.GitHubActions}>
                                {IsConfigured && (
                                    <button className={styles.ClearBtn} onClick={HandleClearGitHub}>
                                        Disconnect
                                    </button>
                                )}
                                <button
                                    className={styles.SyncBtn}
                                    onClick={HandleSync}
                                    disabled={Syncing || !Repo.trim()}
                                >
                                    {Syncing ? "Syncing…" : "Sync Issues"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className={styles.InputArea}>
                    <textarea
                        ref={InputRef}
                        className={styles.Input}
                        value={Input}
                        onChange={E => SetInput(E.target.value)}
                        onKeyDown={HandleKeyDown}
                        placeholder={"Add a note...\n(Enter to add, Shift+Enter for line break)"}
                        rows={2}
                    />
                    <button
                        className={styles.AddBtn}
                        onClick={HandleAdd}
                        disabled={!Input.trim()}
                    >
                        Add
                    </button>
                </div>
            </div>
        </>
    );
};
