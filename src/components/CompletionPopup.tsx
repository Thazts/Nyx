import React from "react";
import styles from "../styles/CompletionPopup.module.css";
import type { CompletionItem, CompletionKind } from "../services/Completer";

interface Props {
    Items:         CompletionItem[];
    SelectedIndex: number;
    Top:           number;
    Left:          number;
    MaxTop:        number;
    ItemHeight:    number;
    OnSelect:      (Item: CompletionItem) => void;
}

const KindIcon: Record<CompletionKind, string> = {
    keyword:  styles.IconKeyword,
    snippet:  styles.IconSnippet,
    function: styles.IconFunction,
    variable: styles.IconVariable,
    type:     styles.IconType,
};

const KindLabel: Record<CompletionKind, string> = {
    keyword:  "kw",
    snippet:  "snip",
    function: "fn",
    variable: "var",
    type:     "ty",
};

const POPUP_MAX_H = 260;

export const CompletionPopup: React.FC<Props> = ({
    Items, SelectedIndex, Top, Left, MaxTop, ItemHeight, OnSelect,
}) => {
    const PopupRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const El = PopupRef.current?.querySelector(`[data-idx="${SelectedIndex}"]`) as HTMLElement | null;
        El?.scrollIntoView({ block: "nearest" });
    }, [SelectedIndex]);

    const FinalTop = Top + POPUP_MAX_H > MaxTop ? Top - ItemHeight - POPUP_MAX_H : Top;

    return (
        <div
            ref={PopupRef}
            className={styles.Popup}
            style={{ top: FinalTop, left: Left }}
            onMouseDown={(E) => E.preventDefault()}
        >
            {Items.map((Item, I) => (
                <div
                    key={I}
                    data-idx={I}
                    className={`${styles.Item} ${I === SelectedIndex ? styles.ItemActive : ""}`}
                    onMouseDown={(E) => { E.preventDefault(); OnSelect(Item); }}
                >
                    <span className={`${styles.Icon} ${KindIcon[Item.Kind]}`} />
                    <span className={styles.Label}>{Item.Label}</span>
                    {Item.Detail
                        ? <span className={styles.Detail}>{Item.Detail}</span>
                        : <span className={styles.KindTag}>{KindLabel[Item.Kind]}</span>
                    }
                </div>
            ))}
        </div>
    );
};
