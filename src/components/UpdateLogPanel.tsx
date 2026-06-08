import React from "react";
import { PATCH_NOTES } from "../services/PatchNotes";
import styles from "../styles/UpdateLogPanel.module.css";

interface UpdateLogPanelProps {
    IsOpen: boolean;
    OnClose: () => void;
}

const FormatShortDate = (Date: string): string => {
    const [D, M, Y] = Date.split("/");
    return `${D.padStart(2, "0")}/${M.padStart(2, "0")}/${Y.slice(2)}`;
};

export const UpdateLogPanel: React.FC<UpdateLogPanelProps> = ({ IsOpen, OnClose }) => (
    <>
        {IsOpen && <div className={styles.Backdrop} onClick={OnClose} />}
        <div className={`${styles.Panel} ${IsOpen ? styles.PanelOpen : ""}`}>
            <div className={styles.Header}>
                <span className={styles.HeaderTitle}>Update Log</span>
                <button className={styles.CloseBtn} onClick={OnClose}>×</button>
            </div>
            <div className={styles.List}>
                {PATCH_NOTES.map(Entry => (
                    <div key={Entry.Version} className={styles.EntryRow}>
                        <div className={styles.DotCol}>
                            {Entry.Major && <span className={styles.MajorDot} />}
                        </div>
                        <div className={styles.EntryData}>
                            <span className={`${styles.Focus} ${styles[`Focus_${Entry.Focus}`]}`}>
                                {Entry.Focus}
                            </span>
                            <span className={styles.EntryUnix}>{Entry.Unix}</span>
                            <span className={styles.EntrySep}>·</span>
                            <span className={styles.EntryDate}>{FormatShortDate(Entry.Date)}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    </>
);
