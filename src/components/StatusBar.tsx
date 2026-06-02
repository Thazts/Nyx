import React, { useState, useCallback } from "react";
import styles from "../styles/StatusBar.module.css";
import { UILib } from "../ui/UILib";

interface StatusBarProps {
    Line:     number;
    Column:   number;
    Branch:   string;
    Language: string;
    Encoding: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
    Line,
    Column,
    Branch,
    Language,
    Encoding,
}) => {
    const [IsButtonClicked, SetIsButtonClicked] = useState(false);

    const HandleButtonClick = useCallback(() => {
        SetIsButtonClicked(true);
        UILib.Toggle("Terminal");
        setTimeout(() => SetIsButtonClicked(false), 200);
    }, []);

    return (
        <div className={styles.Container}>
            <div className={styles.Left}>
                <span className={styles.Item}>{Branch}</span>
                <span className={styles.Item}>{Language}</span>
            </div>
            <div className={styles.Right}>
                <span className={styles.Item}>Ln {Line}, Col {Column}</span>
                <span className={styles.Item}>{Encoding}</span>
                <button
                    className={`${styles.Button} ${IsButtonClicked ? styles.ButtonClicked : ""}`}
                    onClick={HandleButtonClick}
                >
                    Terminal
                </button>
            </div>
        </div>
    );
};
