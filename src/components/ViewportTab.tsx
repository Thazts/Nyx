import React, { useRef, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { RendererService } from "../services/RendererService";
import { StateManager } from "../state/StateManager";
import styles from "../styles/ViewportTab.module.css";

type GizmoMode = "move" | "rotate" | "scale";

export const ViewportTab: React.FC = () => {
    const AnchorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const Anchor = AnchorRef.current;
        if (!Anchor) return;

        const ReportBounds = (): Promise<void> => {
            const Rect = Anchor.getBoundingClientRect();
            const Dpr  = window.devicePixelRatio || 1;
            return RendererService.SetBounds({
                X:      Math.round(Rect.left   * Dpr),
                Y:      Math.round(Rect.top    * Dpr),
                Width:  Math.round(Rect.width  * Dpr),
                Height: Math.round(Rect.height * Dpr),
            });
        };

        StateManager.set("ViewportActive", true);
        ReportBounds().then(() => RendererService.SetVisible({ Visible: true }));

        const RO = new ResizeObserver(ReportBounds);
        RO.observe(Anchor);
        window.addEventListener("resize", ReportBounds);
        return () => {
            RO.disconnect();
            window.removeEventListener("resize", ReportBounds);
            RendererService.SetVisible({ Visible: false });
            StateManager.set("ViewportActive", false);
        };
    }, []);
    useEffect(() => {
        const unlisten = listen<string | null>("vp-selected", (event) => {
            StateManager.set("SelectedPartId", event.payload ?? null);
        });
        return () => { unlisten.then(f => f()); };
    }, []);
    useEffect(() => {
        const OnKeyDown = (E: KeyboardEvent) => {
            const Tag = (document.activeElement as HTMLElement)?.tagName;
            if (Tag === "TEXTAREA" || Tag === "INPUT") return;
            const k = E.key.toLowerCase();

            const SetMode = (m: GizmoMode) => {
                StateManager.set("GizmoMode", m);
                RendererService.SetGizmoMode({ Mode: m }).catch(() => {});
            };
            if (k === "w") SetMode("move");
            if (k === "e") SetMode("rotate");
            if (k === "r") SetMode("scale");
            if (k === "f") RendererService.FrameSelected().catch(() => {});

            if (k === "delete" || k === "backspace") {
                const PartId = StateManager.get("SelectedPartId") as string | null;
                if (PartId) {
                    RendererService.DeletePart({ Id: PartId })
                        .then(() => StateManager.set("SelectedPartId", null))
                        .catch(() => {});
                }
            }

            if ((E.ctrlKey || E.metaKey) && k === "z") {
                E.preventDefault();
                RendererService.Undo()
                    .then(() => StateManager.set("SelectedPartId", null))
                    .catch(() => {});
            }
            if ((E.ctrlKey || E.metaKey) && (k === "y" || (E.shiftKey && k === "z"))) {
                E.preventDefault();
                RendererService.Redo()
                    .then(() => StateManager.set("SelectedPartId", null))
                    .catch(() => {});
            }
        };

        window.addEventListener("keydown", OnKeyDown);
        return () => window.removeEventListener("keydown", OnKeyDown);
    }, []);

    return (
        <div
            ref={AnchorRef}
            className={styles.Container}
        />
    );
};
