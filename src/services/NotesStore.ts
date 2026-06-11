import { useState, useEffect } from "react";

const STORAGE_KEY = "nyx_notes";

export interface GitHubIssue {
    Number:   number;
    Title:    string;
    Priority: 0 | 1 | 2;
    Checked:  boolean;
}

interface GitHubConfig {
    Repo:   string;
    Token?: string;
}

export interface NotesState {
    Items:   string[];
    Checked: boolean[];
    Issues:  GitHubIssue[];
    GitHub?: GitHubConfig;
}

type Subscriber = (State: NotesState) => void;

function Load(): NotesState {
    try {
        const Raw = localStorage.getItem(STORAGE_KEY);
        if (!Raw) return { Items: [], Checked: [], Issues: [] };
        const P = JSON.parse(Raw);
        return {
            Items:   Array.isArray(P.Items)   ? P.Items   : [],
            Checked: Array.isArray(P.Checked) ? P.Checked : [],
            Issues:  Array.isArray(P.Issues)  ? P.Issues  : [],
            GitHub:  P.GitHub ?? undefined,
        };
    } catch {
        return { Items: [], Checked: [], Issues: [] };
    }
}

function Persist(S: NotesState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
}

let State: NotesState = Load();
const Subscribers = new Set<Subscriber>();

function Notify(): void {
    Subscribers.forEach(Cb => Cb(State));
}

async function FetchIssues(Repo: string, Token?: string): Promise<GitHubIssue[]> {
    const Headers: Record<string, string> = {
        Accept: "application/vnd.github.v3+json",
    };
    if (Token) Headers.Authorization = `Bearer ${Token}`;

    const Res = await fetch(
        `https://api.github.com/repos/${Repo}/issues?state=open&per_page=100`,
        { headers: Headers }
    );
    if (!Res.ok) throw new Error(`GitHub ${Res.status}: ${Res.statusText}`);

    const Data = await Res.json() as any[];

    const Priority = (Labels: any[]): 0 | 1 | 2 => {
        const Names = Labels.map((L: any) => (L.name as string).toLowerCase());
        if (Names.some(N => N === "bug" || N.includes("critical") || N.includes("high"))) return 0;
        if (Names.some(N => N === "enhancement" || N.includes("feature") || N.includes("medium"))) return 1;
        return 2;
    };

    return Data
        .filter(I => !I.pull_request)
        .map(I => ({
            Number:   I.number  as number,
            Title:    I.title   as string,
            Priority: Priority(I.labels as any[]),
            Checked:  State.Issues.find(E => E.Number === (I.number as number))?.Checked ?? false,
        }))
        .sort((A, B) => A.Priority - B.Priority || A.Number - B.Number);
}

export const NotesStore = {
    GetState(): NotesState { return State; },

    Subscribe(Cb: Subscriber):   void { Subscribers.add(Cb); },
    Unsubscribe(Cb: Subscriber): void { Subscribers.delete(Cb); },

    Add(Text: string): void {
        const Lines = Text.split("\n").map(L => L.trim()).filter(Boolean);
        if (Lines.length === 0) return;
        State = {
            ...State,
            Items:   [...State.Items,   ...Lines],
            Checked: [...State.Checked, ...Lines.map(() => false as boolean)],
        };
        Persist(State);
        Notify();
    },

    Toggle(Index: number): void {
        const NewChecked = [...State.Checked];
        NewChecked[Index] = !NewChecked[Index];
        State = { ...State, Checked: NewChecked };
        Persist(State);
        Notify();
    },

    Delete(Index: number): void {
        State = {
            ...State,
            Items:   State.Items.filter((_,   I) => I !== Index),
            Checked: State.Checked.filter((_, I) => I !== Index),
        };
        Persist(State);
        Notify();
    },

    ToggleIssue(Num: number): void {
        State = {
            ...State,
            Issues: State.Issues.map(I =>
                I.Number === Num ? { ...I, Checked: !I.Checked } : I
            ),
        };
        Persist(State);
        Notify();
    },

    DeleteIssue(Num: number): void {
        State = {
            ...State,
            Issues: State.Issues.filter(I => I.Number !== Num),
        };
        Persist(State);
        Notify();
    },

    SetGitHub(Config: GitHubConfig): void {
        State = { ...State, GitHub: Config };
        Persist(State);
        Notify();
    },

    ClearGitHub(): void {
        State = { ...State, GitHub: undefined, Issues: [] };
        Persist(State);
        Notify();
    },

    async SyncGitHub(): Promise<void> {
        if (!State.GitHub?.Repo) throw new Error("No repo configured");
        const Issues = await FetchIssues(State.GitHub.Repo, State.GitHub.Token);
        State = { ...State, Issues };
        Persist(State);
        Notify();
    },
};

export function GetTopTask(S: NotesState): string | null {
    const TopIssue = [...S.Issues]
        .sort((A, B) => A.Priority - B.Priority || A.Number - B.Number)
        .find(I => !I.Checked);
    if (TopIssue) return `#${TopIssue.Number} — ${TopIssue.Title}`;
    const Idx = S.Checked.findIndex(C => !C);
    return Idx >= 0 ? S.Items[Idx] : null;
}

export function UseNotes(): NotesState {
    const [Notes, SetNotes] = useState<NotesState>(() => NotesStore.GetState());
    useEffect(() => {
        SetNotes(NotesStore.GetState());
        const Cb = (S: NotesState) => SetNotes({
            Items:   [...S.Items],
            Checked: [...S.Checked],
            Issues:  [...S.Issues],
            GitHub:  S.GitHub,
        });
        NotesStore.Subscribe(Cb);
        return () => NotesStore.Unsubscribe(Cb);
    }, []);
    return Notes;
}

export function UseShowTaskHint(): boolean {
    const Read = (): boolean => {
        try {
            const Raw = localStorage.getItem("nyx_settings");
            return Raw ? (JSON.parse(Raw).ShowTaskHint ?? true) : true;
        } catch { return true; }
    };
    const [Show, SetShow] = useState(Read);
    useEffect(() => {
        const Handle = () => SetShow(Read());
        window.addEventListener("nyx-settings-changed", Handle);
        return () => window.removeEventListener("nyx-settings-changed", Handle);
    }, []);
    return Show;
}
