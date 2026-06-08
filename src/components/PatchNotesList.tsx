import React from "react";
import { PATCH_NOTES } from "../services/PatchNotes";
import styles from "../styles/PatchNotesList.module.css";

const TAG_LABELS: Record<string, string> = {
    new: "new", fix: "fix", change: "upd", perf: "perf",
};

export const PatchNotesList: React.FC = () => {
    let Idx = 0;
    return (
        <div className={styles.List}>
            {PATCH_NOTES.map(Entry => (
                <div key={Entry.Version} className={styles.Block}>
                    <div className={styles.BlockHeader} style={{ "--i": Idx++ } as React.CSSProperties}>
                        <span className={styles.BlockVersion}>v{Entry.Version}</span>
                        <span className={styles.BlockDate}>{Entry.Date}</span>
                        <span className={styles.BlockUnix}>· {Entry.Unix}</span>
                    </div>
                    <div className={styles.Changes}>
                        {Entry.Changes.map((Change) => {
                            const I = Idx++;
                            return (
                                <div key={I} className={styles.Change} style={{ "--i": I } as React.CSSProperties}>
                                    <span className={`${styles.Tag} ${styles[`Tag_${Change.Tag}`]}`}>
                                        {TAG_LABELS[Change.Tag]}
                                    </span>
                                    <span className={styles.ChangeText}>{Change.Text}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
};
