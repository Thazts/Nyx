import React, { useEffect, useRef, useState, useCallback, memo } from "react";
import styles from "../styles/TerminalPanel.module.css";
import { TokenizeLine, TerminalTokenType } from "../services/TerminalTokenizer";
import { UILib, UsePanel } from "../ui/UILib";
import { AiPanel } from "./AiPanel";

const TOK_CLASS: Record<TerminalTokenType, string> = {
    plain:    '',
    error:    styles.TokError,
    warning:  styles.TokWarning,
    success:  styles.TokSuccess,
    filepath: styles.TokFilepath,
    funcname: styles.TokFuncname,
    number:   styles.TokNumber,
    string:   styles.TokString,
    keyword:  styles.TokKeyword,
    dim:      styles.TokDim,
};

const TermLine = memo(({ Line }: { Line: string }) => (
    <>
        {TokenizeLine(Line).map((Token, I) =>
            Token.Type === 'plain'
                ? <React.Fragment key={I}>{Token.Text}</React.Fragment>
                : <span key={I} className={TOK_CLASS[Token.Type]}>{Token.Text}</span>
        )}
    </>
));

type BottomTab = "terminal" | "ai";

interface TerminalPanelProps {
    Output:      string[];
    OnCommand:   (Command: string) => void;
    ActiveFile:  string | null;
    FileContent: string;
    Workspace:   string | null;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ Output, OnCommand, ActiveFile, FileContent, Workspace }) => {
    const IsOpen = UsePanel("Terminal");
    const InputRef = useRef<HTMLInputElement>(null);
    const OutputRef = useRef<HTMLDivElement>(null);
    const [IsInputFocused, SetIsInputFocused] = useState(false);
    const [Height, SetHeight] = useState(220);
    const [IsDragging, SetIsDragging] = useState(false);
    const [BottomTab, SetBottomTab] = useState<BottomTab>("terminal");
    const IsResizing = useRef(false);

    useEffect(() => {
        if (OutputRef.current) {
            OutputRef.current.scrollTop = OutputRef.current.scrollHeight;
        }
    }, [Output]);

    const HandleDragStart = useCallback((E: React.MouseEvent) => {
        E.preventDefault();
        IsResizing.current = true;
        SetIsDragging(true);
        const StartY = E.clientY;
        const StartHeight = Height;

        const OnMouseMove = (MoveEvent: MouseEvent) => {
            if (!IsResizing.current) return;
            const Delta = StartY - MoveEvent.clientY;
            const NewHeight = Math.max(80, Math.min(window.innerHeight * 0.72, StartHeight + Delta));
            SetHeight(NewHeight);
        };

        const OnMouseUp = () => {
            IsResizing.current = false;
            SetIsDragging(false);
            document.removeEventListener("mousemove", OnMouseMove);
            document.removeEventListener("mouseup", OnMouseUp);
        };

        document.addEventListener("mousemove", OnMouseMove);
        document.addEventListener("mouseup", OnMouseUp);
    }, [Height]);

    const HandleKeyDown = useCallback((E: React.KeyboardEvent<HTMLInputElement>) => {
        if (E.key === "Enter" && InputRef.current) {
            OnCommand(InputRef.current.value);
            InputRef.current.value = "";
        }
    }, [OnCommand]);

    const HandleFocus = useCallback(() => SetIsInputFocused(true), []);
    const HandleBlur  = useCallback(() => SetIsInputFocused(false), []);

    return (
        <div
            className={`${styles.Container} ${IsOpen ? styles.Open : ""} ${IsDragging ? styles.Dragging : ""} ${IsInputFocused ? styles.Focused : ""}`}
            style={{ height: IsOpen ? Height : 30 }}
        >
            <div className={styles.DragHandle} onMouseDown={HandleDragStart} />
            <div className={styles.Header}>
                <button
                    className={`${styles.TabBtn}${BottomTab === "terminal" ? ` ${styles.TabBtnActive}` : ""}`}
                    onClick={() => SetBottomTab("terminal")}
                >Terminal</button>
                <button
                    className={`${styles.TabBtn}${BottomTab === "ai" ? ` ${styles.TabBtnActive}` : ""}`}
                    onClick={() => SetBottomTab("ai")}
                >AI</button>
                <button className={styles.Toggle} onClick={() => UILib.Toggle("Terminal")}>
                    {IsOpen ? "▼" : "▲"}
                </button>
            </div>
            {BottomTab === "terminal" ? (
                <>
                    <div className={styles.Output} ref={OutputRef}>
                        {Output.map((Line, I) => (
                            <div key={I} className={styles.Line}>
                                <TermLine Line={Line} />
                            </div>
                        ))}
                    </div>
                    <div className={styles.InputRow}>
                        <span className={styles.Prompt}>$</span>
                        <input
                            ref={InputRef}
                            className={styles.Input}
                            type="text"
                            onKeyDown={HandleKeyDown}
                            onFocus={HandleFocus}
                            onBlur={HandleBlur}
                            placeholder="Type a command..."
                        />
                    </div>
                </>
            ) : (
                <AiPanel ActiveFile={ActiveFile} FileContent={FileContent} Workspace={Workspace} />
            )}
        </div>
    );
};
