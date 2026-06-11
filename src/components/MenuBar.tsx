import React, { useState, useEffect, useCallback, useRef } from "react";
import { appWindow } from "@tauri-apps/api/window";
import styles from "../styles/MenuBar.module.css";
import { MenuService } from "../services/MenuService";
import { UILib } from "../ui/UILib";

type ItemDef =
    | { Kind: "item"; Label: string; Shortcut?: string; Action?: string; NativeKey?: string; Danger?: boolean }
    | { Kind: "sep" };

interface MenuDef {
    Id:    string;
    Label: string;
    Items: ItemDef[];
}

const Menus: MenuDef[] = [
    {
        Id: "file", Label: "File",
        Items: [
            { Kind: "item", Label: "Open Folder...", Action: "file.open-folder" },
            { Kind: "sep" },
            { Kind: "item", Label: "Save",     Action: "file.save",     Shortcut: "Ctrl+S" },
            { Kind: "item", Label: "Save All", Action: "file.save-all", Shortcut: "Ctrl+Shift+S" },
            { Kind: "sep" },
            { Kind: "item", Label: "Close Tab",      Action: "file.close-tab" },
            { Kind: "item", Label: "Close All Tabs", Action: "file.close-all" },
            { Kind: "sep" },
            { Kind: "item", Label: "Exit", Action: "file.exit", Danger: true },
        ],
    },
    {
        Id: "edit", Label: "Edit",
        Items: [
            { Kind: "item", Label: "Undo", NativeKey: "z", Shortcut: "Ctrl+Z" },
            { Kind: "item", Label: "Redo", NativeKey: "y", Shortcut: "Ctrl+Y" },
            { Kind: "sep" },
            { Kind: "item", Label: "Cut",   NativeKey: "x", Shortcut: "Ctrl+X" },
            { Kind: "item", Label: "Copy",  NativeKey: "c", Shortcut: "Ctrl+C" },
            { Kind: "item", Label: "Paste", NativeKey: "v", Shortcut: "Ctrl+V" },
            { Kind: "sep" },
            { Kind: "item", Label: "Find", Action: "edit.find", Shortcut: "Ctrl+F" },
            { Kind: "sep" },
            { Kind: "item", Label: "Select All", NativeKey: "a", Shortcut: "Ctrl+A" },
        ],
    },
];

interface MenuBarProps {
    HasWorkspace: boolean;
}

export const MenuBar: React.FC<MenuBarProps> = ({ HasWorkspace }) => {
    const [OpenMenu, SetOpenMenu] = useState<string | null>(null);
    const WrapRef = useRef<HTMLDivElement>(null);
    const PrevFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        MenuService.Register("file.exit", () => appWindow.close().catch(() => {}));
        MenuService.Register("edit.find", () => {
            UILib.SetView("search");
            UILib.Show("Search");
        });
    }, []);

    useEffect(() => {
        if (!OpenMenu) return;
        const OnDown = (E: MouseEvent) => {
            if (!WrapRef.current?.contains(E.target as Node)) SetOpenMenu(null);
        };
        document.addEventListener("mousedown", OnDown);
        return () => document.removeEventListener("mousedown", OnDown);
    }, [OpenMenu]);

    useEffect(() => {
        if (!OpenMenu) return;
        const OnKey = (E: KeyboardEvent) => {
            if (E.key === "Escape") SetOpenMenu(null);
        };
        document.addEventListener("keydown", OnKey);
        return () => document.removeEventListener("keydown", OnKey);
    }, [OpenMenu]);
    useEffect(() => {
        if (!HasWorkspace) SetOpenMenu(null);
    }, [HasWorkspace]);

    const HandleTrigger = useCallback((MenuId: string) => {
        PrevFocusRef.current = document.activeElement as HTMLElement;
        SetOpenMenu(P => P === MenuId ? null : MenuId);
    }, []);

    const HandleHover = useCallback((MenuId: string) => {
        if (OpenMenu && OpenMenu !== MenuId) SetOpenMenu(MenuId);
    }, [OpenMenu]);

    const HandleItemClick = useCallback((Item: ItemDef) => {
        SetOpenMenu(null);
        if (Item.Kind !== "item") return;

        if (Item.Action) {
            MenuService.Execute(Item.Action);
            return;
        }

        if (Item.NativeKey) {
            const Target = PrevFocusRef.current;
            if (!Target || Target === document.body) return;
            Target.focus();
            Target.dispatchEvent(new KeyboardEvent("keydown", {
                key:        Item.NativeKey,
                ctrlKey:    true,
                bubbles:    true,
                cancelable: true,
            }));
        }
    }, []);

    if (!HasWorkspace) return null;

    return (
        <div
            ref={WrapRef}
            className={styles.MenuBar}
            onMouseDown={E => E.stopPropagation()}
            onDoubleClick={E => E.stopPropagation()}
        >
            {Menus.map(Menu => (
                <div key={Menu.Id} className={styles.MenuWrapper}>
                    <button
                        className={`${styles.Trigger} ${OpenMenu === Menu.Id ? styles.TriggerOpen : ""}`}
                        onClick={() => HandleTrigger(Menu.Id)}
                        onMouseEnter={() => HandleHover(Menu.Id)}
                    >
                        {Menu.Label}
                    </button>
                    {OpenMenu === Menu.Id && (
                        <div className={styles.Dropdown}>
                            {Menu.Items.map((Item, I) =>
                                Item.Kind === "sep" ? (
                                    <div key={I} className={styles.Sep} />
                                ) : (
                                    <button
                                        key={I}
                                        className={`${styles.Item} ${Item.Danger ? styles.ItemDanger : ""}`}
                                        onClick={() => HandleItemClick(Item)}
                                    >
                                        <span className={styles.ItemLabel}>{Item.Label}</span>
                                        {Item.Shortcut && (
                                            <span className={styles.ItemShortcut}>{Item.Shortcut}</span>
                                        )}
                                    </button>
                                )
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};
