import { CaptureService } from "./CaptureService";

export interface GitFileEntry {  // { StagedStatus, WorkingStatus, Path }
    StagedStatus:  string;
    WorkingStatus: string;
    Path:          string;
}

export interface GitStatus {
    Staged:    GitFileEntry[];
    Unstaged:  GitFileEntry[];
    Untracked: GitFileEntry[];
}

function ParsePorcelain(Lines: string[]): GitStatus {
    const Staged: GitFileEntry[]    = [];
    const Unstaged: GitFileEntry[]  = [];
    const Untracked: GitFileEntry[] = [];

    for (const Line of Lines) {
        if (Line.startsWith("err:") || Line.length < 3) continue;
        const X    = Line[0];
        const Y    = Line[1];
        const Path = Line.slice(3).trim();
        const Entry: GitFileEntry = { StagedStatus: X, WorkingStatus: Y, Path };

        if (X === "?" && Y === "?") {
            Untracked.push(Entry);
        } else {
            if (X !== " ") Staged.push(Entry);
            if (Y !== " " && Y !== "?") Unstaged.push(Entry);
        }
    }

    return { Staged, Unstaged, Untracked };
}

export const GitService = {
    async Status(Cwd: string): Promise<GitStatus> {
        const Lines = await CaptureService.Run("git status --porcelain", Cwd);
        return ParsePorcelain(Lines);
    },

    async Stage(Cwd: string, Path: string): Promise<void> {
        await CaptureService.Run(`git add "${Path}"`, Cwd);
    },

    async StageAll(Cwd: string): Promise<void> {
        await CaptureService.Run("git add -A", Cwd);
    },

    async Unstage(Cwd: string, Path: string): Promise<void> {
        await CaptureService.Run(`git restore --staged "${Path}"`, Cwd);
    },

    async UnstageAll(Cwd: string): Promise<void> {
        await CaptureService.Run("git restore --staged .", Cwd);
    },

    async Discard(Cwd: string, Path: string): Promise<void> {
        await CaptureService.Run(`git restore "${Path}"`, Cwd);
    },

    async Commit(Cwd: string, Message: string): Promise<string[]> {
        const Safe = Message.replace(/"/g, '\\"').replace(/\n/g, " ");
        return CaptureService.Run(`git commit -m "${Safe}"`, Cwd);
    },
};
