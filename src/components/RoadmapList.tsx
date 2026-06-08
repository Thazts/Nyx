import React from "react";
import { ROADMAP } from "../services/PatchNotes";
import styles from "../styles/RoadmapList.module.css";

const ActiveItems   = ROADMAP.filter(I => I.Tag === "active");
const LongtermItems = ROADMAP.filter(I => I.Tag === "longterm");

export const RoadmapList: React.FC = () => {
    let Idx = 0;
    return (
        <div className={styles.List}>
            <div className={styles.Group}>
                <span className={styles.GroupLabel} style={{ "--i": Idx++ } as React.CSSProperties}>In Progress</span>
                {ActiveItems.map((Item) => {
                    const I = Idx++;
                    return (
                        <div key={I} className={styles.Item} style={{ "--i": I } as React.CSSProperties}>
                            <span className={`${styles.Tag} ${styles.Tag_active}`}>wip</span>
                            <span className={styles.ItemText}>{Item.Text}</span>
                        </div>
                    );
                })}
            </div>
            <div className={styles.Group}>
                <span className={styles.GroupLabel} style={{ "--i": Idx++ } as React.CSSProperties}>Long-Term</span>
                {LongtermItems.map((Item) => {
                    const I = Idx++;
                    return (
                        <div key={I} className={styles.Item} style={{ "--i": I } as React.CSSProperties}>
                            <span className={`${styles.Tag} ${styles.Tag_longterm}`}>plan</span>
                            <span className={`${styles.ItemText} ${styles.ItemText_longterm}`}>{Item.Text}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
