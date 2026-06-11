import React, { useState, useCallback, useRef } from "react";
import styles from "../styles/ActivityBar.module.css";
import { UILib, UsePanel, UseView } from "../ui/UILib";

const ExplorerIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="5" height="5" rx="1"/>
        <rect x="9" y="2" width="5" height="5" rx="1"/>
        <rect x="2" y="9" width="5" height="5" rx="1"/>
        <rect x="9" y="9" width="5" height="5" rx="1"/>
    </svg>
);

const SearchIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6.5" cy="6.5" r="4"/>
        <path d="M14 14l-3-3"/>
    </svg>
);

const SourceControlIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="4" cy="4" r="1.5"/>
        <circle cx="4" cy="12" r="1.5"/>
        <circle cx="12" cy="4" r="1.5"/>
        <path d="M4 5.5v5"/>
        <path d="M5.5 4h3a2 2 0 012 2v1.5"/>
    </svg>
);

const ExtensionsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 8h3v3H2zM2 3h3v3H2zM7 3h3v3H7z"/>
        <path d="M10 6h2a2 2 0 012 2v5H7v-5a2 2 0 012-2h1"/>
    </svg>
);

const SceneIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2l5.2 3v6L8 14l-5.2-3V5L8 2z"/>
        <path d="M8 2v12M2.8 5l5.2 3 5.2-3"/>
    </svg>
);

const NotesIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="12" height="12" rx="2"/>
        <path d="M5 6h6M5 8.5h6M5 11h4"/>
    </svg>
);

const SettingsIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="2"/>
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/>
    </svg>
);

const Views = [
    { Id: "explorer",       Label: "Explorer",       Icon: ExplorerIcon },
    { Id: "search",         Label: "Search",         Icon: SearchIcon },
    { Id: "source-control", Label: "Source Control", Icon: SourceControlIcon },
    { Id: "extensions",     Label: "Extensions",     Icon: ExtensionsIcon },
    { Id: "scene",          Label: "Scene",          Icon: SceneIcon },
];

interface ActivityBarProps {
    HasWorkspace?: boolean;
}

export const ActivityBar: React.FC<ActivityBarProps> = ({ HasWorkspace = false }) => {
    const ActiveView = UseView();
    const IsNotesOpen = UsePanel("Notes");
    const [ClickedId, SetClickedId] = useState<string | null>(null);
    const [Width, SetWidth] = useState(44);
    const IsResizing = useRef(false);
    const ShowLabels = Width >= 64;

    const HandleResizeStart = useCallback((E: React.MouseEvent) => {
        E.preventDefault();
        IsResizing.current = true;
        const StartX = E.clientX;
        const StartWidth = Width;

        const OnMouseMove = (MoveEvent: MouseEvent) => {
            if (!IsResizing.current) return;
            const Delta = MoveEvent.clientX - StartX;
            const NewWidth = Math.max(44, Math.min(180, StartWidth + Delta));
            SetWidth(NewWidth);
        };

        const OnMouseUp = () => {
            IsResizing.current = false;
            document.removeEventListener("mousemove", OnMouseMove);
            document.removeEventListener("mouseup", OnMouseUp);
        };

        document.addEventListener("mousemove", OnMouseMove);
        document.addEventListener("mouseup", OnMouseUp);
    }, [Width]);

    const HandleClick = useCallback((Id: string) => {
        SetClickedId(Id);
        if (Id === "search") {
            UILib.Toggle("Search");
            UILib.SetView("search");
        } else if (Id === "source-control") {
            UILib.Toggle("SourceControl");
            UILib.SetView("source-control");
        } else {
            UILib.Hide("Search");
            UILib.SetView(Id);
        }
        setTimeout(() => SetClickedId(null), 300);
    }, []);

    const HandleNotesClick = useCallback(() => {
        SetClickedId("notes");
        UILib.Toggle("Notes");
        setTimeout(() => SetClickedId(null), 300);
    }, []);

    return (
        <div
            className={`${styles.Container} ${ShowLabels ? styles.Wide : ""}`}
            style={{ width: Width }}
        >
            {Views.map((View) => (
                <button
                    key={View.Id}
                    className={`${styles.Item} ${ActiveView === View.Id ? styles.Active : ""} ${ClickedId === View.Id ? styles.Clicked : ""}`}
                    onClick={() => HandleClick(View.Id)}
                    title={ShowLabels ? undefined : View.Label}
                >
                    <span className={styles.Icon}>
                        <View.Icon />
                    </span>
                    {ShowLabels && <span className={styles.Label}>{View.Label}</span>}
                </button>
            ))}
            {HasWorkspace && (
                <button
                    className={`${styles.Item} ${IsNotesOpen ? styles.Active : ""} ${ClickedId === "notes" ? styles.Clicked : ""}`}
                    onClick={HandleNotesClick}
                    title={ShowLabels ? undefined : "Notes"}
                >
                    <span className={styles.Icon}>
                        <NotesIcon />
                    </span>
                    {ShowLabels && <span className={styles.Label}>Notes</span>}
                </button>
            )}
            <div className={styles.Spacer} />
            <button className={styles.Item} onClick={() => UILib.Toggle("Settings")} title={ShowLabels ? undefined : "Settings"}>
                <span className={styles.Icon}>
                    <SettingsIcon />
                </span>
                {ShowLabels && <span className={styles.Label}>Settings</span>}
            </button>
            <div className={styles.ResizeHandle} onMouseDown={HandleResizeStart} />
        </div>
    );
};
