import React, { useCallback, useState, useEffect, useRef } from "react";
import { appWindow } from "@tauri-apps/api/window";
import styles from "../styles/TitleBar.module.css";
import { UseNotes, UseShowTaskHint, GetTopTask } from "../services/NotesStore";
import { UILib } from "../ui/UILib";
import { MenuBar } from "./MenuBar";

const MinimizeIcon = () => (
    <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
        <rect width="10" height="1" rx="0.5"/>
    </svg>
);

const MaximizeIcon = () => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
        <rect x="0.5" y="0.5" width="9" height="9" rx="1"/>
    </svg>
);

const CloseIcon = () => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
        <path d="M1 1l8 8M9 1L1 9"/>
    </svg>
);

interface TitleBarProps {
    HasWorkspace?: boolean;
}

export const TitleBar: React.FC<TitleBarProps> = ({ HasWorkspace = false }) => {
    const Notes    = UseNotes();
    const ShowHint = UseShowTaskHint();
    const TopTask  = GetTopTask(Notes);

    const [DisplayedTask, SetDisplayedTask] = useState<string | null>(TopTask);
    const [LeavingTask,   SetLeavingTask]   = useState<string | null>(null);
    const [EntryKey,      SetEntryKey]      = useState(0);
    const CurTaskRef = useRef<string | null>(TopTask);
    const PrevTopRef = useRef<string | null>(TopTask);
    const TimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (TopTask === PrevTopRef.current) return;
        PrevTopRef.current = TopTask;
        if (TimerRef.current) clearTimeout(TimerRef.current);
        SetLeavingTask(CurTaskRef.current);
        CurTaskRef.current = TopTask;
        SetDisplayedTask(TopTask);
        SetEntryKey(K => K + 1);
        TimerRef.current = setTimeout(() => SetLeavingTask(null), 280);
    }, [TopTask]);

    const HandleMinimize = useCallback(() => {
        appWindow.minimize().catch(() => {});
    }, []);

    const HandleMaximize = useCallback(async () => {
        const IsMax = await appWindow.isMaximized().catch(() => false);
        if (IsMax) appWindow.unmaximize().catch(() => {});
        else       appWindow.maximize().catch(() => {});
    }, []);

    const HandleClose = useCallback(() => {
        appWindow.close().catch(() => {});
    }, []);

    const HandleNotesClick = useCallback(() => {
        UILib.Toggle("Notes");
    }, []);

    const HandleDragMouseDown = useCallback((E: React.MouseEvent) => {
        if (E.button !== 0) return;
        const Target = E.target as HTMLElement;
        if (Target.closest("button")) return;
        appWindow.startDragging().catch(() => {});
    }, []);

    const MaxHintChars = 60;
    const ClipText = (T: string | null) =>
        T && T.length > MaxHintChars ? T.slice(0, MaxHintChars - 1) + "…" : T;
    const ShownTask   = ClipText(DisplayedTask);
    const ShownLeaving = ClipText(LeavingTask);

    const ShowCard = HasWorkspace && ShowHint && (DisplayedTask !== null || LeavingTask !== null);

    return (
        <div className={styles.TitleBar} onMouseDown={HandleDragMouseDown} onDoubleClick={HandleMaximize}>
            <div className={styles.Left}>
                <span className={styles.AppName}>Nyx</span>
            </div>
            <MenuBar HasWorkspace={HasWorkspace} />
            {ShowCard && (
                <>
                    <div className={styles.HintSep} />
                    <button className={styles.NotesHint} onClick={HandleNotesClick}>
                        <span className={styles.NotesDot} />
                        <span className={styles.TaskClip}>
                            {ShownLeaving !== null && (
                                <span className={styles.TaskLeave}>{ShownLeaving}</span>
                            )}
                            {ShownTask !== null && (
                                <span key={EntryKey} className={styles.TaskEnter}>{ShownTask}</span>
                            )}
                        </span>
                    </button>
                </>
            )}
            <div className={styles.Spacer} />
            <div className={styles.Controls}>
                <button className={styles.WinBtn} onClick={HandleMinimize} aria-label="Minimize">
                    <MinimizeIcon />
                </button>
                <button className={styles.WinBtn} onClick={HandleMaximize} aria-label="Maximize">
                    <MaximizeIcon />
                </button>
                <button className={`${styles.WinBtn} ${styles.CloseBtn}`} onClick={HandleClose} aria-label="Close">
                    <CloseIcon />
                </button>
            </div>
        </div>
    );
};
