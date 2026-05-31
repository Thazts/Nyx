import React from "react";
import type { Token, TokenType } from "../services/Tokenizer";

interface HighlightOverlayProps {
    Tokens: Token[];
    ClassName: string;
    ScrollRef: React.RefObject<HTMLDivElement>;
}

const Colours: Record<TokenType, string> = {
    Keyword:  "var(--kw)",
    String:   "var(--str)",
    Number:   "var(--num)",
    Comment:  "var(--cmt)",
    Function: "var(--fn)",
    Type:     "var(--ty)",
    Operator: "var(--op)",
    Default:  "var(--txt)",
};

export const HighlightOverlay: React.FC<HighlightOverlayProps> = ({ Tokens, ClassName, ScrollRef }) => {
    return (
        <div className={ClassName} ref={ScrollRef} aria-hidden="true">
            {Tokens.map((T, I) => (
                <span
                    key={I}
                    style={{
                        color: Colours[T.Type],
                        fontStyle: T.Type === "Comment" ? "italic" : undefined,
                    }}
                >
                    {T.Value}
                </span>
            ))}
        </div>
    );
};
