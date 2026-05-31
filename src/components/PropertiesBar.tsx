import React, { useState, useCallback, useRef, useEffect } from "react";
import styles from "../styles/PropertiesBar.module.css";
import { StateManager } from "../state/StateManager";
import { useStateKey } from "../state/useStateKey";
import { RendererService } from "../services/RendererService";

interface FileEntry {
    Name: string;
    Path: string;
    IsDirectory: boolean;
    Children?: FileEntry[];
}

interface FileMetadata {
    Size: number;
    Modified: string;
}

interface PropertiesBarProps {
    SelectedEntry: FileEntry | null;
    Metadata?: FileMetadata | null;
    ActiveFile?: string | null;
    RunOutput?: string[];
    IsRunning?: boolean;
    OnRun?: () => void;
    OnClearOutput?: () => void;
    OnOpenViewport?: (Path: string) => void;
}

const FormatSize = (Bytes: number): string => {
    if (Bytes < 1024) return `${Bytes} B`;
    if (Bytes < 1024 * 1024) return `${(Bytes / 1024).toFixed(1)} KB`;
    return `${(Bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const GetAncestors = (Path: string): { Parent: string | null; Grandparent: string | null } => {
    const Parts = Path.split(/[\\/]/).filter(P => P.length > 0);
    return {
        Parent:      Parts.length >= 2 ? Parts[Parts.length - 2] : null,
        Grandparent: Parts.length >= 3 ? Parts[Parts.length - 3] : null,
    };
};

const GetLineClass = (Line: string, S: typeof styles): string => {
    if (Line.startsWith("▶")) return S.LineRun;
    if (Line.startsWith("err:")) return S.LineErr;
    if (Line.startsWith("exit") || Line.startsWith("No runner") || Line.startsWith("failed")) return S.LineExit;
    return S.Line;
};

const SupportedExts = new Set(["lua", "luau", "py", "js"]);
const ViewportExts  = new Set(["lua", "luau"]);

export const PropertiesBar: React.FC<PropertiesBarProps> = ({
    SelectedEntry,
    Metadata,
    ActiveFile,
    RunOutput = [],
    IsRunning = false,
    OnRun,
    OnClearOutput,
    OnOpenViewport,
}) => {
    const GizmoMode    = useStateKey<string>("GizmoMode");
    const SelectedPart = useStateKey<string | null>("SelectedPartId");
    const [Width, SetWidth] = useState(180);
    const [SplitHeight, SetSplitHeight] = useState(320);
    const IsResizingWidth = useRef(false);
    const IsResizingSplit = useRef(false);
    const OutputRef   = useRef<HTMLDivElement>(null);
    const DebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [PartData, SetPartData] = useState<Record<string, unknown> | null>(null);

    useEffect(() => {
        const IsVP = !!ActiveFile && ActiveFile.startsWith("viewport:");
        if (!IsVP || !SelectedPart) { SetPartData(null); return; }
        RendererService.GetPart({ Id: SelectedPart })
            .then(d => SetPartData(d as Record<string, unknown> | null))
            .catch(() => SetPartData(null));
    }, [SelectedPart, ActiveFile]);

    const HandlePropChange = useCallback((
        Field: "Position" | "Size" | "CFrame",
        Key: string,
        RawValue: string,
    ) => {
        const Num = parseFloat(RawValue);
        if (isNaN(Num) || !SelectedPart) return;
        SetPartData(prev => {
            if (!prev) return prev;
            const obj = (prev[Field] as Record<string, number>) ?? {};
            return { ...prev, [Field]: { ...obj, [Key]: Num } };
        });
        if (DebounceRef.current) clearTimeout(DebounceRef.current);
        DebounceRef.current = setTimeout(() => {
            SetPartData(cur => {
                if (!cur || !SelectedPart) return cur;
                const pos = cur["Position"] as Record<string, number> | undefined;
                const siz = cur["Size"]     as Record<string, number> | undefined;
                const cf  = cur["CFrame"]   as Record<string, number> | undefined;
                RendererService.SetPartProperties({
                    Id:       SelectedPart,
                    Position: pos ? { X: pos.X ?? 0, Y: pos.Y ?? 0, Z: pos.Z ?? 0 } : undefined,
                    Size:     siz ? { X: siz.X ?? 1, Y: siz.Y ?? 1, Z: siz.Z ?? 1 } : undefined,
                    Rotation: cf  ? { RX: cf.RX ?? 0, RY: cf.RY ?? 0, RZ: cf.RZ ?? 0 } : undefined,
                }).catch(console.error);
                return cur;
            });
        }, 150);
    }, [SelectedPart]);

    useEffect(() => {
        if (OutputRef.current) {
            OutputRef.current.scrollTop = OutputRef.current.scrollHeight;
        }
    }, [RunOutput]);

    const HandleWidthDrag = useCallback((E: React.MouseEvent) => {
        E.preventDefault();
        IsResizingWidth.current = true;
        const StartX = E.clientX;
        const StartWidth = Width;
        const OnMove = (Ev: MouseEvent) => {
            if (!IsResizingWidth.current) return;
            SetWidth(Math.max(140, Math.min(400, StartWidth - (Ev.clientX - StartX))));
        };
        const OnUp = () => {
            IsResizingWidth.current = false;
            document.removeEventListener("mousemove", OnMove);
            document.removeEventListener("mouseup", OnUp);
        };
        document.addEventListener("mousemove", OnMove);
        document.addEventListener("mouseup", OnUp);
    }, [Width]);

    const HandleSplitDrag = useCallback((E: React.MouseEvent) => {
        E.preventDefault();
        IsResizingSplit.current = true;
        const StartY = E.clientY;
        const StartHeight = SplitHeight;
        const OnMove = (Ev: MouseEvent) => {
            if (!IsResizingSplit.current) return;
            SetSplitHeight(Math.max(60, Math.min(520, StartHeight + (Ev.clientY - StartY))));
        };
        const OnUp = () => {
            IsResizingSplit.current = false;
            document.removeEventListener("mousemove", OnMove);
            document.removeEventListener("mouseup", OnUp);
        };
        document.addEventListener("mousemove", OnMove);
        document.addEventListener("mouseup", OnUp);
    }, [SplitHeight]);

    const ActiveExt = ActiveFile?.split(".").pop()?.toLowerCase() ?? "";
    const IsViewportTab  = !!ActiveFile && ActiveFile.startsWith("viewport:");
    const CanRun         = !!ActiveFile && SupportedExts.has(ActiveExt) && !IsViewportTab;
    const CanOpenViewport = !!ActiveFile && ViewportExts.has(ActiveExt) && !ActiveFile.startsWith("viewport:");

    let PropertiesBody: React.ReactNode;
    const SetGizmoMode = useCallback((Mode: string) => {
        StateManager.set("GizmoMode", Mode);
        RendererService.SetGizmoMode({ Mode }).catch(() => {});
    }, []);

    if (IsViewportTab) {
        PropertiesBody = (
            <div className={styles.ViewportControls}>
                <div className={styles.ViewportControlLabel}>Selection</div>
                <div className={SelectedPart ? styles.SelectedInfo : styles.SelectedInfoEmpty}>
                    {SelectedPart ? SelectedPart : "Nothing selected"}
                </div>
                <div className={styles.ViewportControlLabel}>Transform</div>
                <div className={styles.GizmoModeRow}>
                    <button
                        className={`${styles.GizmoBtn} ${GizmoMode === "move" ? styles.GizmoBtnActive : ""}`}
                        onClick={() => SetGizmoMode("move")}
                        title="Move [W]"
                    >
                        ⬡ Move
                    </button>
                    <button
                        className={`${styles.GizmoBtn} ${GizmoMode === "rotate" ? styles.GizmoBtnActive : ""}`}
                        onClick={() => SetGizmoMode("rotate")}
                        title="Rotate [E]"
                    >
                        ↺ Rotate
                    </button>
                    <button
                        className={`${styles.GizmoBtn} ${GizmoMode === "scale" ? styles.GizmoBtnActive : ""}`}
                        onClick={() => SetGizmoMode("scale")}
                        title="Scale [R]"
                    >
                        ⊞ Scale
                    </button>
                </div>
                {PartData && (
                    <div className={styles.PartInspector}>
                        {(["Position", "Size"] as const).map(Field => {
                            const obj = (PartData[Field] as Record<string, number>) ?? {};
                            return (
                                <div key={Field} className={styles.InspectorGroup}>
                                    <div className={styles.ViewportControlLabel}>{Field}</div>
                                    {(["X", "Y", "Z"] as const).map(Axis => (
                                        <label key={Axis} className={styles.InspectorRow}>
                                            <span className={styles.AxisLabel}>{Axis}</span>
                                            <input
                                                className={styles.InspectorInput}
                                                type="number"
                                                step={Field === "Size" ? 0.1 : 0.5}
                                                defaultValue={parseFloat((obj[Axis] ?? 0).toFixed(3))}
                                                key={`${SelectedPart}-${Field}-${Axis}`}
                                                onChange={E => HandlePropChange(Field, Axis, E.target.value)}
                                            />
                                        </label>
                                    ))}
                                </div>
                            );
                        })}
                        <div className={styles.InspectorGroup}>
                            <div className={styles.ViewportControlLabel}>Rotation (deg)</div>
                            {(["RX", "RY", "RZ"] as const).map(Key => {
                                const cf  = (PartData["CFrame"] as Record<string, number>) ?? {};
                                const Deg = parseFloat(((cf[Key] ?? 0) * 180 / Math.PI).toFixed(2));
                                return (
                                    <label key={Key} className={styles.InspectorRow}>
                                        <span className={styles.AxisLabel}>{Key.slice(1)}</span>
                                        <input
                                            className={styles.InspectorInput}
                                            type="number"
                                            step={1}
                                            defaultValue={Deg}
                                            key={`${SelectedPart}-CFrame-${Key}`}
                                            onChange={E => {
                                                const D = parseFloat(E.target.value);
                                                if (!isNaN(D)) HandlePropChange("CFrame", Key, String(D * Math.PI / 180));
                                            }}
                                        />
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    } else if (!SelectedEntry) {
        PropertiesBody = <div className={styles.Empty}>Select a file or folder</div>;
    } else {
        const Type = SelectedEntry.IsDirectory ? "Directory" : "File";
        const FileSize = SelectedEntry.IsDirectory ? "-" : (Metadata ? FormatSize(Metadata.Size) : "-");
        const Modified = Metadata ? Metadata.Modified : "-";
        const { Parent, Grandparent } = GetAncestors(SelectedEntry.Path);

        const Rows = [
            { Label: "Name",        Value: SelectedEntry.Name },
            { Label: "Type",        Value: Type },
            { Label: "Parent",      Value: Parent      ?? "-" },
            { Label: "Grandparent", Value: Grandparent ?? "-" },
            { Label: "Path",        Value: SelectedEntry.Path },
            { Label: "Size",        Value: FileSize },
            { Label: "Modified",    Value: Modified },
            ...(SelectedEntry.IsDirectory && SelectedEntry.Children
                ? [{ Label: "Children", Value: `${SelectedEntry.Children.length} items` }]
                : []),
        ];

        PropertiesBody = (
            <div className={styles.PropertiesContent}>
                {Rows.map((Row, I) => (
                    <div className={styles.Row} key={Row.Label} style={{ animationDelay: `${I * 40}ms` }}>
                        <span className={styles.Label}>{Row.Label}</span>
                        <span className={styles.Value} key={Row.Value}>
                                {Row.Value.split("").map((Ch, I) => (
                                    <span key={I} className={styles.Char} style={{ animationDelay: `${I * 10}ms` }}>{Ch}</span>
                                ))}
                            </span>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className={styles.Container} style={{ width: Width }}>
            <div className={styles.PropertiesSection} style={{ height: SplitHeight }}>
                <div className={styles.Header}>{IsViewportTab ? "Viewport" : "Properties"}</div>
                {PropertiesBody}
            </div>

            <div className={styles.SplitHandle} onMouseDown={HandleSplitDrag} />

            <div className={styles.OutputSection}>
                <div className={styles.OutputHeader}>
                    <span className={styles.OutputTitle}>Output</span>
                    <div className={styles.OutputControls}>
                        {CanOpenViewport && (
                            <button
                                className={styles.ViewportButton}
                                onClick={() => ActiveFile && OnOpenViewport?.(ActiveFile)}
                                title="Open in 3D Viewport"
                            >
                                ⬡
                            </button>
                        )}
                        <button
                            className={`${styles.RunButton} ${IsRunning ? styles.Running : ""}`}
                            onClick={OnRun}
                            disabled={!CanRun || IsRunning}
                            title={CanRun ? "Run file" : "No runner for this file type"}
                        >
                            {IsRunning ? "…" : "▶"}
                        </button>
                        <button
                            className={styles.ClearButton}
                            onClick={OnClearOutput}
                            disabled={RunOutput.length === 0}
                            title="Clear output"
                        >
                            ✕
                        </button>
                    </div>
                </div>
                <div className={styles.OutputContent} ref={OutputRef}>
                    {RunOutput.length === 0
                        ? <span className={styles.OutputEmpty}>Run a file to see output</span>
                        : RunOutput.map((Line, I) => (
                            <div key={I} className={GetLineClass(Line, styles)}>{Line}</div>
                        ))
                    }
                </div>
            </div>

            <div className={styles.ResizeHandle} onMouseDown={HandleWidthDrag} />
        </div>
    );
};
