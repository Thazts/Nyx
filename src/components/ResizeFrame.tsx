import React from "react";
import { appWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import styles from "../styles/ResizeFrame.module.css";

type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_W = 480;
const MIN_H = 320;

async function BeginResize(E: React.MouseEvent, Dir: Dir): Promise<void> {
    E.preventDefault();
    E.stopPropagation();

    const [PhysPos, PhysSz, Scale] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.outerSize(),
        appWindow.scaleFactor(),
    ]);

    const StartL = PhysPos.x / Scale;
    const StartT = PhysPos.y / Scale;
    const StartW = PhysSz.width / Scale;
    const StartH = PhysSz.height / Scale;
    const StartX = E.screenX;
    const StartY = E.screenY;

    let Pending = false;
    let LastDx = 0, LastDy = 0;

    const Apply = () => {
        Pending = false;
        const Dx = LastDx;
        const Dy = LastDy;

        let L = StartL, T = StartT, W = StartW, H = StartH;

        if (Dir.includes("e")) W = Math.max(MIN_W, StartW + Dx);
        if (Dir.includes("s")) H = Math.max(MIN_H, StartH + Dy);
        if (Dir.includes("w")) {
            W = Math.max(MIN_W, StartW - Dx);
            L = StartL + StartW - W;
        }
        if (Dir.includes("n")) {
            H = Math.max(MIN_H, StartH - Dy);
            T = StartT + StartH - H;
        }

        Promise.all([
            appWindow.setPosition(new LogicalPosition(Math.round(L), Math.round(T))),
            appWindow.setSize(new LogicalSize(Math.round(W), Math.round(H))),
        ]).catch(() => {});
    };

    const OnMove = (Mv: MouseEvent) => {
        LastDx = Mv.screenX - StartX;
        LastDy = Mv.screenY - StartY;
        if (!Pending) {
            Pending = true;
            requestAnimationFrame(Apply);
        }
    };

    const OnUp = () => {
        document.removeEventListener("mousemove", OnMove);
        document.removeEventListener("mouseup", OnUp);
    };

    document.addEventListener("mousemove", OnMove);
    document.addEventListener("mouseup", OnUp);
}

const H = (Dir: Dir, Cls: string) => (
    <div className={Cls} onMouseDown={E => BeginResize(E, Dir).catch(() => {})} />
);

export const ResizeFrame: React.FC = () => (
    <div className={styles.Frame}>
        {H("n",  styles.N)}
        {H("s",  styles.S)}
        {H("e",  styles.E)}
        {H("w",  styles.W)}
        {H("ne", styles.NE)}
        {H("nw", styles.NW)}
        {H("se", styles.SE)}
        {H("sw", styles.SW)}
    </div>
);
