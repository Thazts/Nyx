import React, { useEffect, useRef } from "react";
import styles from "../styles/SearchBar.module.css";

interface SearchBarProps {
    Term: string;
    ReplaceTerm: string;
    OnTermChange: (Term: string) => void;
    OnReplaceTermChange: (Term: string) => void;
    MatchCount: number;
    CurrentMatch: number;
    OnPrev: () => void;
    OnNext: () => void;
    OnReplace: () => void;
    OnReplaceAll: () => void;
    OnClose: () => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
    Term,
    ReplaceTerm,
    OnTermChange,
    OnReplaceTermChange,
    MatchCount,
    CurrentMatch,
    OnPrev,
    OnNext,
    OnReplace,
    OnReplaceAll,
    OnClose,
}) => {
    const InputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        InputRef.current?.focus();
        InputRef.current?.select();
    }, []);

    const HandleFindKeyDown = (E: React.KeyboardEvent<HTMLInputElement>) => {
        if (E.key === "Enter") {
            E.preventDefault();
            if (E.shiftKey) OnPrev(); else OnNext();
        }
        if (E.key === "Escape") OnClose();
    };

    const HandleReplaceKeyDown = (E: React.KeyboardEvent<HTMLInputElement>) => {
        if (E.key === "Enter") {
            E.preventDefault();
            if (E.ctrlKey || E.metaKey) OnReplaceAll(); else OnReplace();
        }
        if (E.key === "Escape") OnClose();
    };

    const CounterText = !Term
        ? ""
        : MatchCount === 0
        ? "No results"
        : `${CurrentMatch + 1} / ${MatchCount}`;

    const NoResults = !!Term && MatchCount === 0;

    return (
        <div className={styles.Container}>
            <div className={styles.Fields}>
                <input
                    ref={InputRef}
                    className={`${styles.Input} ${NoResults ? styles.InputNoResults : ""}`}
                    type="text"
                    value={Term}
                    onChange={(E) => OnTermChange(E.target.value)}
                    onKeyDown={HandleFindKeyDown}
                    placeholder="Find in file..."
                    spellCheck={false}
                />
                <input
                    className={styles.Input}
                    type="text"
                    value={ReplaceTerm}
                    onChange={(E) => OnReplaceTermChange(E.target.value)}
                    onKeyDown={HandleReplaceKeyDown}
                    placeholder="Replace with..."
                    spellCheck={false}
                />
            </div>
            <span className={`${styles.Counter} ${NoResults ? styles.CounterNoResults : ""}`}>
                {CounterText}
            </span>
            <div className={styles.Controls}>
                <button
                    className={styles.NavButton}
                    onClick={OnPrev}
                    disabled={MatchCount === 0}
                    title="Previous match (Shift+Enter)"
                >
                    ^
                </button>
                <button
                    className={styles.NavButton}
                    onClick={OnNext}
                    disabled={MatchCount === 0}
                    title="Next match (Enter)"
                >
                    v
                </button>
                <button
                    className={styles.ReplaceButton}
                    onClick={OnReplace}
                    disabled={MatchCount === 0}
                    title="Replace current match"
                >
                    Replace
                </button>
                <button
                    className={styles.ReplaceButton}
                    onClick={OnReplaceAll}
                    disabled={MatchCount === 0}
                    title="Replace all exact matches"
                >
                    All
                </button>
                <button className={styles.CloseButton} onClick={OnClose} title="Close (Esc)">
                    x
                </button>
            </div>
        </div>
    );
};
