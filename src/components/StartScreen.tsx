import React from "react";
import styles from "../styles/StartScreen.module.css";

interface StartScreenProps {
    OnOpenFolder:  () => void;
    OnContinue:    () => void;
    OnOpenRecent:  (Path: string) => void;
    IsLoading:     boolean;
    RecentPaths:   string[];
}

const FolderIcon = () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 4.5V12a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8.5L7 3.5H3a1 1 0 00-1 1z"/>
    </svg>
);

export const StartScreen: React.FC<StartScreenProps> = ({ OnOpenFolder, OnContinue, OnOpenRecent, IsLoading, RecentPaths }) => {
    return (
        <div className={styles.Container}>
            <div className={styles.Glow} />
            <div className={styles.GridDots} />
            <div className={styles.DecoLine} />
            <div className={styles.DecoLine} />

            <div className={styles.Content}>
                {IsLoading ? (
                    <div className={styles.LoadingState}>
                        <img src="/media/Kitty.png" alt="" className={styles.LoadingCat} />
                        <span className={styles.LoadingLabel}>Building workspace...</span>
                    </div>
                ) : (
                    <>
                        <div className={styles.Brand}>
                            <div className={styles.BrandRow}>
                                <span className={styles.BrandDot} />
                                <h1 className={styles.Title}>Nyx</h1>
                            </div>
                            <p className={styles.Tagline}>code editor · v0.1.0</p>
                        </div>

                        <div className={styles.Actions}>
                            <button className={styles.PrimaryBtn} onClick={OnOpenFolder}>
                                <FolderIcon />
                                Open Folder
                            </button>
                            <button className={styles.GhostBtn} onClick={OnContinue}>
                                Continue without folder
                            </button>
                        </div>

                        {RecentPaths.length > 0 && (
                            <div className={styles.Recent}>
                                <span className={styles.RecentLabel}>Recent</span>
                                {RecentPaths.map(P => {
                                    const Name = P.split(/[\\/]/).pop() ?? P;
                                    const Dir  = P.slice(0, P.length - Name.length - 1);
                                    return (
                                        <button key={P} className={styles.RecentItem} onClick={() => OnOpenRecent(P)}>
                                            <span className={styles.RecentName}>{Name}</span>
                                            <span className={styles.RecentPath}>{Dir}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
