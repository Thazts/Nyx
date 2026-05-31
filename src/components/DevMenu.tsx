import React, { useState, useEffect, useRef, useCallback } from "react";
import { SystemService, SystemStats } from "../services/SystemService";
import { UILib } from "../ui/UILib";
import styles from "../styles/DevMenu.module.css";

const SCRIPTS = [
    {
        key: "grid",
        name: "Part Grid",
        desc: "5×5 grid of anchored parts",
        file: "DevGridTest.luau",
        code: `-- Nyx Dev: Part Grid Test
local workspace = game:GetService("Workspace")
for x = 0, 4 do
    for z = 0, 4 do
        local part = Instance.new("Part")
        part.Size = Vector3.new(2, 2, 2)
        part.Position = Vector3.new(x * 4, 1, z * 4)
        part.Anchored = true
        part.Parent = workspace
    end
end
print("Grid test: 25 parts loaded")`,
    },
    {
        key: "physics",
        name: "Physics Drop",
        desc: "10 unanchored parts + floor",
        file: "DevPhysicsTest.luau",
        code: `-- Nyx Dev: Physics Drop Test
local workspace = game:GetService("Workspace")
workspace:SetGravity(196.2)
for i = 1, 10 do
    local part = Instance.new("Part")
    part.Size = Vector3.new(2, 2, 2)
    part.Position = Vector3.new((i - 5) * 3, 10, 0)
    part.Anchored = false
    part.Parent = workspace
end
local floor = Instance.new("Part")
floor.Size = Vector3.new(40, 1, 40)
floor.Position = Vector3.new(0, 0, 0)
floor.Anchored = true
floor.Parent = workspace
print("Physics: 10 dynamic parts + floor")`,
    },
    {
        key: "lighting",
        name: "Lighting Rig",
        desc: "4 colored point lights on a platform",
        file: "DevLightingTest.luau",
        code: `-- Nyx Dev: Lighting Test
local workspace = game:GetService("Workspace")
local floor = Instance.new("Part")
floor.Size = Vector3.new(30, 1, 30)
floor.Position = Vector3.new(0, 0, 0)
floor.Anchored = true
floor.Parent = workspace
local defs = {
    { Color3.fromRGB(255,  80,  80), Vector3.new( 8, 4,  8) },
    { Color3.fromRGB( 80, 255,  80), Vector3.new(-8, 4,  8) },
    { Color3.fromRGB( 80,  80, 255), Vector3.new( 8, 4, -8) },
    { Color3.fromRGB(255, 220,  60), Vector3.new(-8, 4, -8) },
}
for _, d in ipairs(defs) do
    local p = Instance.new("Part")
    p.Size = Vector3.new(1, 1, 1)
    p.Position = d[2]
    p.Color = d[1]
    p.Anchored = true
    p.Parent = workspace
    local light = Instance.new("PointLight")
    light.Color = d[1]
    light.Brightness = 5
    light.Range = 18
    light.Parent = p
end
print("Lighting: 4 colored point lights")`,
    },
    {
        key: "stress100",
        name: "Stress 100",
        desc: "100 parts in a helix spiral",
        file: "DevStress100.luau",
        code: `-- Nyx Dev: Stress Test 100
local workspace = game:GetService("Workspace")
local N = 100
for i = 1, N do
    local t = i / N
    local angle = t * math.pi * 6
    local part = Instance.new("Part")
    part.Size = Vector3.new(1, 1, 1)
    part.Position = Vector3.new(
        math.cos(angle) * (t * 14),
        t * 20,
        math.sin(angle) * (t * 14)
    )
    part.Anchored = true
    part.Parent = workspace
end
print(string.format("Stress: %d parts", N))`,
    },
    {
        key: "stress500",
        name: "Stress 500",
        desc: "500 parts, heavy renderer load",
        file: "DevStress500.luau",
        code: `-- Nyx Dev: Stress Test 500
local workspace = game:GetService("Workspace")
local N = 500
for i = 1, N do
    local t = i / N
    local angle = t * math.pi * 20
    local part = Instance.new("Part")
    part.Size = Vector3.new(0.8, 0.8, 0.8)
    part.Position = Vector3.new(
        math.cos(angle) * (t * 24),
        t * 28,
        math.sin(angle) * (t * 24)
    )
    part.Anchored = true
    part.Parent = workspace
end
print(string.format("Stress: %d parts", N))`,
    },
    {
        key: "camera",
        name: "Camera Orbit",
        desc: "Overhead view aimed at origin",
        file: "DevCameraTest.luau",
        code: `-- Nyx Dev: Camera Test
local workspace = game:GetService("Workspace")
Camera:SetPosition(Vector3.new(20, 20, 20), Vector3.new(0, 0, 0))
local base = Instance.new("Part")
base.Size = Vector3.new(10, 1, 10)
base.Position = Vector3.new(0, 0, 0)
base.Anchored = true
base.Parent = workspace
local tower = Instance.new("Part")
tower.Size = Vector3.new(2, 8, 2)
tower.Position = Vector3.new(0, 4, 0)
tower.Anchored = true
tower.Parent = workspace
print("Camera: orbit view at (20,20,20) looking at origin")`,
    },
] as const;

type ScriptKey = typeof SCRIPTS[number]["key"];

export interface DevMenuProps {
    WorkspacePath:     string | null;
    OpenTabsCount:     number;
    ActiveFile:        string | null;
    TerminalLineCount: number;
    OnInjectScript:    (fileName: string, content: string) => Promise<void>;
    OnRunScene:        (fileName: string, content: string) => Promise<void>;
    OnTerminalLog:     (lines: string[]) => void;
}

type TabId = "viewport" | "scripts" | "monitor" | "inspector";

export const DevMenu: React.FC<DevMenuProps> = ({
    WorkspacePath,
    OpenTabsCount,
    ActiveFile,
    TerminalLineCount,
    OnInjectScript,
    OnRunScene,
    OnTerminalLog,
}) => {
    const [ActiveTab, SetActiveTab] = useState<TabId>("viewport");
    const [Stats, SetStats]         = useState<SystemStats | null>(null);
    const [MonitorLive, SetMonitorLive] = useState(false);
    const [BusyKey, SetBusyKey]     = useState<string | null>(null);
    const [Log, SetLog]             = useState<string[]>(["Dev tools opened; F12 to close"]);
    const [Pos, SetPos]             = useState({ x: Math.max(window.innerWidth - 500, 20), y: 40 });
    const DragStart                 = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
    const MonitorTimerId            = useRef<ReturnType<typeof setInterval> | null>(null);

    const PushLog = useCallback((msg: string) => {
        SetLog(Prev => [...Prev.slice(-4), msg]);
    }, []);

    const FetchStats = useCallback(async () => {
        try {
            const S = await SystemService.GetStats();
            SetStats(S);
        } catch {
        }
    }, []);

    useEffect(() => {
        if (ActiveTab === "monitor") FetchStats();
    }, [ActiveTab]);

    useEffect(() => {
        if (ActiveTab !== "monitor" || !MonitorLive) {
            if (MonitorTimerId.current) {
                clearInterval(MonitorTimerId.current);
                MonitorTimerId.current = null;
            }
            return;
        }
        MonitorTimerId.current = setInterval(FetchStats, 2000);
        return () => {
            if (MonitorTimerId.current) clearInterval(MonitorTimerId.current);
        };
    }, [ActiveTab, MonitorLive, FetchStats]);

    const HandleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        DragStart.current = { mx: e.clientX, my: e.clientY, px: Pos.x, py: Pos.y };
        const OnMove = (ev: MouseEvent) => {
            if (!DragStart.current) return;
            SetPos({
                x: Math.max(0, DragStart.current.px + ev.clientX - DragStart.current.mx),
                y: Math.max(0, DragStart.current.py + ev.clientY - DragStart.current.my),
            });
        };
        const OnUp = () => {
            DragStart.current = null;
            window.removeEventListener("mousemove", OnMove);
            window.removeEventListener("mouseup", OnUp);
        };
        window.addEventListener("mousemove", OnMove);
        window.addEventListener("mouseup", OnUp);
    }, [Pos.x, Pos.y]);

    const RunViewportTest = useCallback(async (key: ScriptKey) => {
        if (!WorkspacePath) { PushLog("err: No workspace open"); return; }
        const S = SCRIPTS.find(s => s.key === key)!;
        SetBusyKey(key);
        PushLog(`▶ Running ${S.name}...`);
        try {
            await OnRunScene(S.file, S.code);
            PushLog(`✓ ${S.name} loaded`);
            OnTerminalLog([`▶ Dev Test: ${S.name}`]);
        } catch (Err) {
            PushLog(`err: ${Err}`);
        } finally {
            SetBusyKey(null);
        }
    }, [WorkspacePath, OnRunScene, OnTerminalLog, PushLog]);

    const InjectScript = useCallback(async (key: ScriptKey) => {
        if (!WorkspacePath) { PushLog("err: No workspace open"); return; }
        const S = SCRIPTS.find(s => s.key === key)!;
        SetBusyKey(`inject_${key}`);
        PushLog(`Injecting ${S.file}...`);
        try {
            await OnInjectScript(S.file, S.code);
            PushLog(`✓ ${S.file} added to workspace`);
        } catch (Err) {
            PushLog(`err: ${Err}`);
        } finally {
            SetBusyKey(null);
        }
    }, [WorkspacePath, OnInjectScript, PushLog]);

    const DumpState = useCallback(() => {
        const ws = WorkspacePath ?? "(none)";
        const af = ActiveFile ? ActiveFile.split(/[\\/]/).pop() ?? ActiveFile : "(none)";
        OnTerminalLog([
            "Dev State Dump",
            `workspace:     ${ws}`,
            `active_file:   ${af}`,
            `open_tabs:     ${OpenTabsCount}`,
            `terminal_lines:${TerminalLineCount}`,
        ]);
        PushLog("✓ State dumped to terminal");
    }, [WorkspacePath, ActiveFile, OpenTabsCount, TerminalLineCount, OnTerminalLog, PushLog]);

    const BarPct = (used: number, total: number) =>
        total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

    const FmtMB = (mb: number) =>
        mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;

    const LogClass = (line: string) => {
        if (line.startsWith("✓")) return styles.LogSuccess;
        if (line.startsWith("err")) return styles.LogError;
        if (line.startsWith("▶")) return styles.LogInfo;
        return "";
    };

    return (
        <div className={styles.Panel} style={{ left: Pos.x, top: Pos.y }}>

            {}
            <div className={styles.Header} onMouseDown={HandleHeaderMouseDown}>
                <span className={styles.Badge}>DEV</span>
                <span className={styles.HeaderTitle}>Developer Tools</span>
                <span className={styles.KeyHint}>F12</span>
                <button className={styles.CloseBtn} onClick={() => UILib.Hide("DevMenu")} title="Close">✕</button>
            </div>

            {}
            <div className={styles.TabBar}>
                {(["viewport", "scripts", "monitor", "inspector"] as TabId[]).map(id => (
                    <button
                        key={id}
                        className={`${styles.Tab}${ActiveTab === id ? ` ${styles.TabActive}` : ""}`}
                        onClick={() => SetActiveTab(id)}
                    >
                        {id === "viewport" ? "Viewport" :
                         id === "scripts"  ? "Scripts"  :
                         id === "monitor"  ? "Monitor"  : "Inspector"}
                    </button>
                ))}
            </div>

            <div className={styles.Content}>

                {ActiveTab === "viewport" && (
                    <div className={styles.Section}>
                        <div className={styles.SectionLabel}>Run Test Scene in Viewport</div>
                        {!WorkspacePath ? (
                            <div className={styles.NoWorkspace}>Open a workspace first</div>
                        ) : (
                            <div className={styles.TestGrid}>
                                {SCRIPTS.map(S => (
                                    <button
                                        key={S.key}
                                        className={`${styles.TestBtn}${BusyKey === S.key ? ` ${styles.TestBtnBusy}` : ""}`}
                                        disabled={BusyKey !== null}
                                        onClick={() => RunViewportTest(S.key)}
                                    >
                                        <span className={styles.TestBtnName}>{S.name}</span>
                                        <span className={styles.TestBtnDesc}>{S.desc}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {ActiveTab === "scripts" && (
                    <div className={styles.Section}>
                        <div className={styles.SectionLabel}>Inject Luau Script into Workspace</div>
                        {!WorkspacePath ? (
                            <div className={styles.NoWorkspace}>Open a workspace first</div>
                        ) : (
                            SCRIPTS.map(S => (
                                <div className={styles.ScriptRow} key={S.key}>
                                    <div className={styles.ScriptInfo}>
                                        <div className={styles.ScriptName}>{S.name}</div>
                                        <div className={styles.ScriptDesc}>{S.desc}</div>
                                    </div>
                                    <div className={styles.ScriptActions}>
                                        <button
                                            className={`${styles.ActionBtn} ${styles.ActionBtnInject}`}
                                            disabled={BusyKey !== null}
                                            onClick={() => InjectScript(S.key)}
                                            title="Save to workspace and open in editor"
                                        >
                                            Inject
                                        </button>
                                        <button
                                            className={`${styles.ActionBtn} ${styles.ActionBtnRun}`}
                                            disabled={BusyKey !== null}
                                            onClick={() => RunViewportTest(S.key)}
                                            title="Run directly as viewport scene"
                                        >
                                            ▶ Run
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
                {ActiveTab === "monitor" && (
                    <>
                        <div className={styles.Section}>
                            <div className={styles.SectionLabel}>Resource Usage</div>
                            {!Stats ? (
                                <div className={styles.NoStats}>Fetching stats…</div>
                            ) : (
                                <div className={styles.StatBlock}>
                                    {/* CPU */}
                                    <div className={styles.StatRow}>
                                        <div className={styles.StatHeader}>
                                            <span className={styles.StatLabel}>CPU Usage</span>
                                            <span className={styles.StatValue}>{Stats.cpu_usage.toFixed(1)}%</span>
                                        </div>
                                        <div className={styles.BarTrack}>
                                            <div
                                                className={`${styles.BarFill}${Stats.cpu_usage > 80 ? ` ${styles.BarFillWarn}` : ""}`}
                                                style={{ width: `${Stats.cpu_usage.toFixed(1)}%` }}
                                            />
                                        </div>
                                    </div>
                                    <div className={styles.StatRow}>
                                        <div className={styles.StatHeader}>
                                            <span className={styles.StatLabel}>System RAM</span>
                                            <span className={styles.StatValue}>
                                                {FmtMB(Stats.memory_used_mb)} / {FmtMB(Stats.memory_total_mb)}
                                            </span>
                                        </div>
                                        <div className={styles.BarTrack}>
                                            <div
                                                className={`${styles.BarFill}${BarPct(Stats.memory_used_mb, Stats.memory_total_mb) > 85 ? ` ${styles.BarFillWarn}` : ""}`}
                                                style={{ width: `${BarPct(Stats.memory_used_mb, Stats.memory_total_mb)}%` }}
                                            />
                                        </div>
                                    </div>
                                    <div className={styles.StatRow}>
                                        <div className={styles.StatHeader}>
                                            <span className={styles.StatLabel}>Nyx Process RAM</span>
                                            <span className={styles.StatValue}>{FmtMB(Stats.process_memory_mb)}</span>
                                        </div>
                                        <div className={styles.BarTrack}>
                                            <div
                                                className={styles.BarFill}
                                                style={{ width: `${Math.min(100, BarPct(Stats.process_memory_mb * 4, Stats.memory_total_mb))}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className={styles.MonitorControls}>
                            <button
                                className={`${styles.LiveToggle}${MonitorLive ? ` ${styles.LiveToggleOn}` : ""}`}
                                onClick={() => SetMonitorLive(P => !P)}
                            >
                                <span className={`${styles.LiveDot}${MonitorLive ? ` ${styles.LiveDotOn}` : ""}`} />
                                <span className={`${styles.LiveLabel}${MonitorLive ? ` ${styles.LiveLabelOn}` : ""}`}>
                                    {MonitorLive ? "Live; 2s refresh" : "Live refresh OFF"}
                                </span>
                            </button>
                            <button className={styles.RefreshBtn} onClick={FetchStats}>
                                Refresh
                            </button>
                        </div>
                    </>
                )}
                {ActiveTab === "inspector" && (
                    <div className={styles.Section}>
                        <div className={styles.SectionLabel}>App State</div>
                        <div className={styles.InspectTable}>
                            <div className={styles.InspectRow}>
                                <div className={styles.InspectKey}>Workspace</div>
                                <div className={`${styles.InspectVal}${WorkspacePath ? "" : ` ${styles.InspectValDim}`}`}>
                                    {WorkspacePath ?? "not open"}
                                </div>
                            </div>
                            <div className={styles.InspectRow}>
                                <div className={styles.InspectKey}>Active File</div>
                                <div className={`${styles.InspectVal}${ActiveFile ? ` ${styles.InspectValAcc}` : ` ${styles.InspectValDim}`}`}>
                                    {ActiveFile ? ActiveFile.split(/[\\/]/).pop() ?? ActiveFile : "none"}
                                </div>
                            </div>
                            <div className={styles.InspectRow}>
                                <div className={styles.InspectKey}>Open Tabs</div>
                                <div className={`${styles.InspectVal}${OpenTabsCount > 0 ? ` ${styles.InspectValGreen}` : ""}`}>
                                    {OpenTabsCount}
                                </div>
                            </div>
                            <div className={styles.InspectRow}>
                                <div className={styles.InspectKey}>Terminal</div>
                                <div className={styles.InspectVal}>{TerminalLineCount} lines</div>
                            </div>
                            <div className={styles.InspectRow}>
                                <div className={styles.InspectKey}>Dev Menu</div>
                                <div className={`${styles.InspectVal} ${styles.InspectValGreen}`}>active</div>
                            </div>
                        </div>
                        <button className={styles.DumpBtn} onClick={DumpState}>
                            Dump State to Terminal
                        </button>
                    </div>
                )}

            </div>
            <div className={styles.LogFooter}>
                {Log.map((line, i) => (
                    <div key={i} className={`${styles.LogLine} ${LogClass(line)}`}>
                        {line}
                    </div>
                ))}
            </div>

        </div>
    );
};
