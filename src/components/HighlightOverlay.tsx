import React from "react";
import type { Token, TokenType } from "../services/Tokenizer";

interface HighlightOverlayProps {
    Tokens:       Token[];
    ClassName:    string;
    ScrollRef:    React.RefObject<HTMLDivElement>;
    TotalHeight?: number;
    VisStart:     number;
    LH:           number;
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

export const HighlightOverlay: React.FC<HighlightOverlayProps> = ({
    Tokens, ClassName, ScrollRef, TotalHeight, VisStart, LH,
}) => {
    return (
        <div className={ClassName} ref={ScrollRef} aria-hidden="true">
            {TotalHeight !== undefined && (
                <div style={{ position: 'relative', height: `${TotalHeight}px` }}>
                    <div style={{ position: 'absolute', top: `${VisStart * LH}px`, left: 0, right: 0 }}>
                        {Tokens.map((T, I) => (
                            <span
                                key={I}
                                style={{
                                    color: Colours[T.Type],
                                }}
                            >
                                {T.Value}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
