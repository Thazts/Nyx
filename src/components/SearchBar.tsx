import React, { useEffect, useRef } from "react";
import styles from "../styles/SearchBar.module.css";

interface SearchBarProps {
    Term: string;
    OnTermChange: (Term: string) => void;
    MatchCount: number;
    CurrentMatch: number;
    OnPrev: () => void;
    OnNext: () => void;
    OnClose: () => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
    Term,
    OnTermChange,
    MatchCount,
    CurrentMatch,
    OnPrev,
    OnNext,
    OnClose,
}) => {
    const InputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        InputRef.current?.focus();
        InputRef.current?.select();
    }, []);

    const HandleKeyDown = (E: React.KeyboardEvent<HTMLInputElement>) => {
        if (E.key === "Enter") {
            E.preventDefault();
            if (E.shiftKey) OnPrev(); else OnNext();
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
            <input
                ref={InputRef}
                className={`${styles.Input} ${NoResults ? styles.InputNoResults : ""}`}
                type="text"
                value={Term}
                onChange={(E) => OnTermChange(E.target.value)}
                onKeyDown={HandleKeyDown}
                placeholder="Find in file…"
                spellCheck={false}
            />
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
                    ↑
                </button>
                <button
                    className={styles.NavButton}
                    onClick={OnNext}
                    disabled={MatchCount === 0}
                    title="Next match (Enter)"
                >
                    ↓
                </button>
                <button className={styles.CloseButton} onClick={OnClose} title="Close (Esc)">
                    ×
                </button>
            </div>
        </div>
    );
};
