import { useState, useEffect, useCallback } from "react";
import type { AnimationEvent } from "react";

type VisibilitySubscriber = (Visible: boolean, Closing: boolean) => void;
type ViewSubscriber       = (View: string) => void;

interface PanelEntry {
    Visible:     boolean;
    Closing:     boolean;
    Animated:    boolean;
    Subscribers: Set<VisibilitySubscriber>;
}

const PanelRegistry  = new Map<string, PanelEntry>();
let   ActiveView     = "explorer";
const ViewSubscribers = new Set<ViewSubscriber>();

function NotifyPanel(Name: string): void {
    const Panel = PanelRegistry.get(Name);
    if (!Panel) return;
    Panel.Subscribers.forEach(Cb => Cb(Panel.Visible, Panel.Closing));
}

export const UILib = {
    Register(Name: string, InitialVisible: boolean, Animated = false): void {
        if (!PanelRegistry.has(Name)) {
            PanelRegistry.set(Name, { Visible: InitialVisible, Closing: false, Animated, Subscribers: new Set() });
        }
    },

    Show(Name: string): void {
        const Panel = PanelRegistry.get(Name);
        if (!Panel || (Panel.Visible && !Panel.Closing)) return;
        Panel.Visible = true;
        Panel.Closing = false;
        NotifyPanel(Name);
    },

    // Animated panels stay mounted and flip Closing so their exit animation can play;
    // the panel calls FinishHide on animation end. Non-animated panels hide instantly.
    Hide(Name: string): void {
        const Panel = PanelRegistry.get(Name);
        if (!Panel || !Panel.Visible) return;
        if (Panel.Animated) {
            if (Panel.Closing) return;
            Panel.Closing = true;
            NotifyPanel(Name);
        } else {
            Panel.Visible = false;
            NotifyPanel(Name);
        }
    },

    FinishHide(Name: string): void {
        const Panel = PanelRegistry.get(Name);
        if (!Panel) return;
        Panel.Visible = false;
        Panel.Closing = false;
        NotifyPanel(Name);
    },

    Toggle(Name: string): void {
        const Panel = PanelRegistry.get(Name);
        if (!Panel) return;
        if (Panel.Visible && !Panel.Closing) UILib.Hide(Name);
        else UILib.Show(Name);
    },

    IsVisible(Name: string): boolean {
        return PanelRegistry.get(Name)?.Visible ?? false;
    },

    IsClosing(Name: string): boolean {
        return PanelRegistry.get(Name)?.Closing ?? false;
    },

    Subscribe(Name: string, Cb: VisibilitySubscriber): void {
        PanelRegistry.get(Name)?.Subscribers.add(Cb);
    },

    Unsubscribe(Name: string, Cb: VisibilitySubscriber): void {
        PanelRegistry.get(Name)?.Subscribers.delete(Cb);
    },

    SetView(Id: string): void {
        if (ActiveView === Id) return;
        ActiveView = Id;
        ViewSubscribers.forEach(Cb => Cb(ActiveView));
    },

    GetView(): string {
        return ActiveView;
    },

    SubscribeView(Cb: ViewSubscriber): void {
        ViewSubscribers.add(Cb);
    },

    UnsubscribeView(Cb: ViewSubscriber): void {
        ViewSubscribers.delete(Cb);
    },
};

UILib.Register("DevMenu",          false);
UILib.Register("Terminal",         true);
UILib.Register("Search",           false);
UILib.Register("SourceControl",    false, true);
UILib.Register("Settings",         false, true);
UILib.Register("CommandPalette",   false);
UILib.Register("Notes",            false, true);

export function UsePanel(Name: string): boolean {
    const [Visible, SetVisible] = useState(() => UILib.IsVisible(Name));
    useEffect(() => {
        SetVisible(UILib.IsVisible(Name));
        const Cb: VisibilitySubscriber = (V) => SetVisible(V);
        UILib.Subscribe(Name, Cb);
        return () => UILib.Unsubscribe(Name, Cb);
    }, [Name]);
    return Visible;
}

export function UseView(): string {
    const [View, SetView] = useState(() => UILib.GetView());
    useEffect(() => {
        const Cb: ViewSubscriber = (V) => SetView(V);
        UILib.SubscribeView(Cb);
        return () => UILib.UnsubscribeView(Cb);
    }, []);
    return View;
}

interface PanelDismiss {
    Closing:            boolean;
    Dismiss:            () => void;
    HandleAnimationEnd: (E: AnimationEvent<HTMLElement>) => void;
}

// Drives an animated overlay panel's exit. `Closing` flips true the moment a hide is
// requested through *any* path (close button, backdrop, or the activity-bar toggle), so
// apply it to the panel's class to swap SlideIn → SlideOut. Route the panel root's
// onAnimationEnd through HandleAnimationEnd to finalize the unmount once the exit plays.
export function UsePanelDismiss(Name: string): PanelDismiss {
    const [Closing, SetClosing] = useState(() => UILib.IsClosing(Name));
    useEffect(() => {
        SetClosing(UILib.IsClosing(Name));
        const Cb: VisibilitySubscriber = (_Visible, IsClosing) => SetClosing(IsClosing);
        UILib.Subscribe(Name, Cb);
        return () => UILib.Unsubscribe(Name, Cb);
    }, [Name]);
    const Dismiss = useCallback(() => UILib.Hide(Name), [Name]);
    const HandleAnimationEnd = useCallback((E: AnimationEvent<HTMLElement>) => {
        if (E.target === E.currentTarget && UILib.IsClosing(Name)) UILib.FinishHide(Name);
    }, [Name]);
    return { Closing, Dismiss, HandleAnimationEnd };
}
