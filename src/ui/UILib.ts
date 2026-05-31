import { useState, useEffect } from "react";

type VisibilitySubscriber = (Visible: boolean) => void;
type ViewSubscriber       = (View: string) => void;

interface PanelEntry {
    Visible:     boolean;
    Subscribers: Set<VisibilitySubscriber>;
}

const PanelRegistry  = new Map<string, PanelEntry>();
let   ActiveView     = "explorer";
const ViewSubscribers = new Set<ViewSubscriber>();

function NotifyPanel(Name: string): void {
    const Panel = PanelRegistry.get(Name);
    if (!Panel) return;
    Panel.Subscribers.forEach(Cb => Cb(Panel.Visible));
}

export const UILib = {
    Register(Name: string, InitialVisible: boolean): void {
        if (!PanelRegistry.has(Name)) {
            PanelRegistry.set(Name, { Visible: InitialVisible, Subscribers: new Set() });
        }
    },

    Show(Name: string): void {
        const Panel = PanelRegistry.get(Name);
        if (!Panel || Panel.Visible) return;
        Panel.Visible = true;
        NotifyPanel(Name);
    },

    Hide(Name: string): void {
        const Panel = PanelRegistry.get(Name);
        if (!Panel || !Panel.Visible) return;
        Panel.Visible = false;
        NotifyPanel(Name);
    },

    Toggle(Name: string): void {
        const Panel = PanelRegistry.get(Name);
        if (!Panel) return;
        Panel.Visible = !Panel.Visible;
        NotifyPanel(Name);
    },

    IsVisible(Name: string): boolean {
        return PanelRegistry.get(Name)?.Visible ?? false;
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

UILib.Register("DevMenu",  false);
UILib.Register("Terminal", true);
UILib.Register("Search",   false);

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
