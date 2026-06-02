import React, { useState, useEffect, useCallback, useRef } from "react";
import styles from "../styles/SettingsPanel.module.css";
import { AiService } from "../services/AiService";

interface Settings {
    FontSize:   number;
    LineHeight: number;
    Accent:     string;
}

const Defaults: Settings = {
    FontSize:   11.5,
    LineHeight: 1.78,
    Accent:     "#D4B0CC",
};

const FontSizes   = [10, 11, 11.5, 12, 13, 14];
const LineHeights = [1.5, 1.6, 1.78, 2.0];

const AccentPresets = [
    { Label: "Mauve",    Value: "#D4B0CC", Cls: styles.SwatchMauve    },
    { Label: "Teal",     Value: "#94C4BE", Cls: styles.SwatchTeal     },
    { Label: "Amber",    Value: "#D4B87A", Cls: styles.SwatchAmber    },
    { Label: "Blue",     Value: "#A0B8D8", Cls: styles.SwatchBlue     },
    { Label: "Lavender", Value: "#B8A0D8", Cls: styles.SwatchLavender },
    { Label: "Sage",     Value: "#A0C4A4", Cls: styles.SwatchSage     },
];

function LoadSettings(): Settings {
    try {
        const Raw = localStorage.getItem("nyx_settings");
        return Raw ? { ...Defaults, ...JSON.parse(Raw) } : { ...Defaults };
    } catch {
        return { ...Defaults };
    }
}

function SaveSettings(S: Settings): void {
    localStorage.setItem("nyx_settings", JSON.stringify(S));
}

function ApplySettings(S: Settings): void {
    const Root = document.documentElement;
    Root.style.setProperty("--editor-font-size",    `${S.FontSize}px`);
    Root.style.setProperty("--editor-line-height",  `${S.LineHeight}`);
    Root.style.setProperty("--editor-whitespace",   "pre");
    Root.style.setProperty("--editor-overflow-x",   "auto");
    Root.style.setProperty("--acc", S.Accent);
    Root.style.setProperty("--kw",  S.Accent);
    const M = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(S.Accent);
    if (M) {
        const R = parseInt(M[1], 16);
        const G = parseInt(M[2], 16);
        const B = parseInt(M[3], 16);
        Root.style.setProperty("--acc08",       `rgba(${R},${G},${B},.08)`);
        Root.style.setProperty("--acc04",       `rgba(${R},${G},${B},.042)`);
        Root.style.setProperty("--shadow-glow", `0 0 12px rgba(${R},${G},${B},0.15)`);
    }
}

export function InitSettings(): void {
    ApplySettings(LoadSettings());
}

interface SettingsPanelProps {
    OnClose: () => void;
}

const CloseIcon = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M3 3l10 10M13 3L3 13"/>
    </svg>
);

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ OnClose }) => {
    const [S, SetS] = useState<Settings>(LoadSettings);

    const [AnthropicKeySet,   SetAnthropicKeySet]   = useState(false);
    const [DeepseekKeySet,    SetDeepseekKeySet]    = useState(false);
    const [Configuring,       SetConfiguring]       = useState(false);
    const [ObsidianPath,      SetObsidianPath]      = useState("");
    const [AiMode,            SetAiMode]            = useState<"supervised" | "autonomous">("supervised");
    const PollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const RefreshKeyStatus = useCallback(() => {
        AiService.GetConfig().then(C => {
            SetAnthropicKeySet(C.AnthropicKeySet);
            SetDeepseekKeySet(C.DeepseekKeySet);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        RefreshKeyStatus();
        AiService.GetAppSettings().then(S => {
            SetObsidianPath(S.ObsidianVaultPath ?? "");
            SetAiMode(S.AiMode);
        }).catch(() => {});
        return () => { if (PollRef.current) clearTimeout(PollRef.current); };
    }, []);

    const HandleConfigureKeys = useCallback(async () => {
        SetConfiguring(true);
        try { await AiService.LaunchKeyman(); } catch { /* keyman path missing in dev */ }
        PollRef.current = setTimeout(() => {
            RefreshKeyStatus();
            SetConfiguring(false);
        }, 6000);
    }, [RefreshKeyStatus]);

    const HandleSaveAiSettings = useCallback(async () => {
        await AiService.SaveAppSettings({
            ObsidianVaultPath: ObsidianPath.trim() || null,
            AiMode,
        });
    }, [ObsidianPath, AiMode]);

    const HandleModeToggle = useCallback(() => {
        const Next = AiMode === "supervised" ? "autonomous" : "supervised";
        SetAiMode(Next);
    }, [AiMode]);

    useEffect(() => { ApplySettings(S); SaveSettings(S); }, [S]);

    const SetFontSize = useCallback((V: number) => SetS(Prev => ({ ...Prev, FontSize: V })), []);
    const SetLineHeight = useCallback((V: number) => SetS(Prev => ({ ...Prev, LineHeight: V })), []);
    const SetAccent = useCallback((V: string) => SetS(Prev => ({ ...Prev, Accent: V })), []);

    const HandleReset = useCallback(() => {
        SetS({ ...Defaults });
    }, []);

    const FsIdx  = FontSizes.indexOf(S.FontSize);
    const LhIdx  = LineHeights.indexOf(S.LineHeight);

    return (
        <>
            <div className={styles.Backdrop} onClick={OnClose} />
            <div className={styles.Panel}>
                <div className={styles.Header}>
                    <span className={styles.Title}>Settings</span>
                    <button className={styles.CloseBtn} onClick={OnClose} title="Close">
                        <CloseIcon />
                    </button>
                </div>

                <div className={styles.Scroll}>
                    <div className={styles.Section}>
                        <div className={styles.SectionTitle}>Editor</div>

                        <div className={styles.Row}>
                            <div>
                                <div className={styles.Label}>Font Size</div>
                                <div className={styles.Hint}>{S.FontSize}px</div>
                            </div>
                            <div className={styles.Stepper}>
                                <button
                                    className={styles.StepBtn}
                                    onClick={() => FsIdx > 0 && SetFontSize(FontSizes[FsIdx - 1])}
                                    disabled={FsIdx <= 0}
                                >−</button>
                                <span className={styles.StepValue}>{S.FontSize}</span>
                                <button
                                    className={styles.StepBtn}
                                    onClick={() => FsIdx < FontSizes.length - 1 && SetFontSize(FontSizes[FsIdx + 1])}
                                    disabled={FsIdx >= FontSizes.length - 1}
                                >+</button>
                            </div>
                        </div>

                        <div className={styles.Row}>
                            <div>
                                <div className={styles.Label}>Line Height</div>
                                <div className={styles.Hint}>{S.LineHeight}</div>
                            </div>
                            <div className={styles.Stepper}>
                                <button
                                    className={styles.StepBtn}
                                    onClick={() => LhIdx > 0 && SetLineHeight(LineHeights[LhIdx - 1])}
                                    disabled={LhIdx <= 0}
                                >−</button>
                                <span className={styles.StepValue}>{S.LineHeight}</span>
                                <button
                                    className={styles.StepBtn}
                                    onClick={() => LhIdx < LineHeights.length - 1 && SetLineHeight(LineHeights[LhIdx + 1])}
                                    disabled={LhIdx >= LineHeights.length - 1}
                                >+</button>
                            </div>
                        </div>

                    </div>

                    <div className={styles.Section}>
                        <div className={styles.SectionTitle}>Appearance</div>
                        <div className={styles.Label}>Accent Color</div>
                        <div className={styles.Swatches}>
                            {AccentPresets.map(P => (
                                <div
                                    key={P.Value}
                                    className={`${styles.Swatch} ${P.Cls} ${S.Accent === P.Value ? styles.SwatchActive : ""}`}
                                    title={P.Label}
                                    onClick={() => SetAccent(P.Value)}
                                />
                            ))}
                        </div>
                    </div>

                    <div className={styles.Section}>
                        <div className={styles.SectionTitle}>AI</div>

                        <div className={styles.KeyRow}>
                            <span className={styles.Label}>Anthropic</span>
                            <span className={`${styles.KeyStatus}${AnthropicKeySet ? ` ${styles.KeyStatusOk}` : ""}`}>
                                {AnthropicKeySet ? "configured" : "not set"}
                            </span>
                        </div>

                        <div className={styles.KeyRow}>
                            <span className={styles.Label}>DeepSeek</span>
                            <span className={`${styles.KeyStatus}${DeepseekKeySet ? ` ${styles.KeyStatusOk}` : ""}`}>
                                {DeepseekKeySet ? "configured" : "not set"}
                            </span>
                        </div>

                        <div className={styles.AiActions}>
                            <button
                                className={`${styles.ConfigureBtn}${Configuring ? ` ${styles.ConfigureBtnBusy}` : ""}`}
                                onClick={HandleConfigureKeys}
                                disabled={Configuring}
                            >
                                {Configuring ? "Waiting…" : "Configure Keys"}
                            </button>
                            <button className={styles.RefreshBtn} onClick={RefreshKeyStatus}>
                                Refresh
                            </button>
                        </div>

                        <div className={styles.Row} style={{ marginTop: 16 }}>
                            <div className={styles.Label}>Default Mode</div>
                            <button
                                className={`${styles.Toggle} ${AiMode === "autonomous" ? styles.ToggleOn : ""}`}
                                onClick={HandleModeToggle}
                                title={AiMode === "supervised" ? "Supervised — writes/commands need approval" : "Autonomous — AI executes everything"}
                            >
                                <div className={styles.ToggleThumb} />
                            </button>
                        </div>
                        <div className={styles.Hint} style={{ marginBottom: 12 }}>
                            {AiMode === "supervised" ? "Supervised — file writes & commands need approval" : "Autonomous — AI executes all tools without asking"}
                        </div>

                        <div className={styles.Label} style={{ marginBottom: 8 }}>Obsidian Vault Path</div>
                        <input
                            className={styles.VaultInput}
                            type="text"
                            value={ObsidianPath}
                            onChange={E => SetObsidianPath(E.target.value)}
                            placeholder="C:\Users\you\Obsidian\MyVault"
                            onBlur={HandleSaveAiSettings}
                        />
                    </div>

                    <div className={styles.Section}>
                        <button className={styles.ResetBtn} onClick={HandleReset}>
                            Reset to defaults
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};
