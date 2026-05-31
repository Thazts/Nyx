import { CaptureService } from "./CaptureService";

export type CommandSuffix = '!' | '/' | '?' | '@';

export interface ParsedCommand {
    Name:   string;
    Suffix: CommandSuffix;
    Args:   string[];
}

export interface NativeSnapshot {
    GetOpenFiles:         () => string[];
    GetActiveFilePath:    () => string | null;
    GetActiveFileName:    () => string | null;
    GetActiveFileContent: () => string;
    GetWorkspacePath:     () => string | null;
    GetOpenFileContents:  () => Array<{ Name: string; Path: string; Content: string }>;
}

export type NativeAction =
    | { Type: "ClearTerminal" }
    | { Type: "Save" }
    | { Type: "SaveAll" }
    | { Type: "OpenWorkspace" }

export interface NativeResult {
    Lines:   string[];
    Action?: NativeAction;
}

export const NativeCommands = {
    Parse(Input: string): ParsedCommand | null {
        const Match = Input.trim().match(/^\$([a-zA-Z_][a-zA-Z0-9_]*)([!/?@])(.*)$/);
        if (!Match) return null;
        return {
            Name:   Match[1].toLowerCase(),
            Suffix: Match[2] as CommandSuffix,
            Args:   Match[3].trim().split(/\s+/).filter(Boolean),
        };
    },

    async Execute(Cmd: ParsedCommand, Snap: NativeSnapshot): Promise<NativeResult> {
        const Key = `${Cmd.Name}${Cmd.Suffix}`;

        switch (Key) {

            case 'clear!':
            case 'cls!':
                return { Lines: [], Action: { Type: "ClearTerminal" } };

            case 'save!':
                return { Lines: ["Saved current file."], Action: { Type: "Save" } };

            case 'saveall!':
                return { Lines: ["Saved all open files."], Action: { Type: "SaveAll" } };

            case 'workspace/':
                return { Lines: [], Action: { Type: "OpenWorkspace" } };

            case 'files?': {
                const Files = Snap.GetOpenFiles();
                return {
                    Lines: Files.length > 0 ? Files.map(F => `  ${F}`) : ['  No open files.'],
                };
            }

            case 'stats?': {
                const Content = Snap.GetActiveFileContent();
                const Name    = Snap.GetActiveFileName();
                if (!Name) return { Lines: ['No active file.'] };
                const Lines = Content.split('\n').length;
                const Words = Content.split(/\s+/).filter(Boolean).length;
                const Chars = Content.length;
                return {
                    Lines: [
                        `  ${Name}`,
                        `  Lines : ${Lines}`,
                        `  Words : ${Words}`,
                        `  Chars : ${Chars}`,
                    ],
                };
            }

            case 'linecount?': {
                const Content = Snap.GetActiveFileContent();
                const Name    = Snap.GetActiveFileName();
                if (!Name) return { Lines: ['No active file.'] };
                return { Lines: [`  ${Content.split('\n').length} lines, ${Name}`] };
            }

            case 'copy!': {
                const Content = Snap.GetActiveFileContent();
                const Name    = Snap.GetActiveFileName();
                if (!Name) return { Lines: ['No active file.'] };
                await navigator.clipboard.writeText(Content);
                const Lines = Content.split('\n').length;
                return { Lines: [`Copied ${Lines} line${Lines !== 1 ? 's' : ''} to clipboard.`] };
            }

            case 'copypath!': {
                const Path = Snap.GetActiveFilePath();
                if (!Path) return { Lines: ['No active file.'] };
                await navigator.clipboard.writeText(Path);
                return { Lines: ['Copied path to clipboard.'] };
            }

            case 'copyname!': {
                const Name = Snap.GetActiveFileName();
                if (!Name) return { Lines: ['No active file.'] };
                await navigator.clipboard.writeText(Name);
                return { Lines: ['Copied filename to clipboard.'] };
            }

            case 'find?': {
                const Term = Cmd.Args.join(' ');
                if (!Term) return { Lines: ['Usage: $find? <term>'] };
                const Results: string[] = [];
                for (const File of Snap.GetOpenFileContents()) {
                    File.Content.split('\n').forEach((Line, I) => {
                        if (Line.toLowerCase().includes(Term.toLowerCase())) {
                            Results.push(`  ${File.Name}:${I + 1}  ${Line.trim()}`);
                        }
                    });
                }
                return {
                    Lines: Results.length > 0
                        ? [`Found ${Results.length} match${Results.length !== 1 ? 'es' : ''} for "${Term}":`, ...Results]
                        : [`No matches for "${Term}" in open files.`],
                };
            }

            case 'grep?': {
                const Pattern = Cmd.Args.join(' ');
                if (!Pattern) return { Lines: ['Usage: $grep? <pattern>'] };
                const Cwd = Snap.GetWorkspacePath();
                if (!Cwd) return { Lines: ['No workspace open.'] };
                try {
                    const Lines = await CaptureService.Run(
                        `git grep -n --ignore-case "${Pattern.replace(/"/g, '\\"')}"`,
                        Cwd
                    );
                    return {
                        Lines: Lines.length > 0
                            ? [`Matches for "${Pattern}":`, ...Lines.map(L => `  ${L}`)]
                            : [`No matches for "${Pattern}".`],
                    };
                } catch {
                    return { Lines: ['err: grep failed; is this a git repo?'] };
                }
            }

            case 'gitstatus?': {
                const Cwd = Snap.GetWorkspacePath();
                if (!Cwd) return { Lines: ['No workspace open.'] };
                const Lines = await CaptureService.Run('git status --short', Cwd);
                return { Lines: Lines.length > 0 ? Lines : ['  Working tree clean.'] };
            }

            case 'gitdiff?': {
                const Cwd  = Snap.GetWorkspacePath();
                if (!Cwd) return { Lines: ['No workspace open.'] };
                const Path = Snap.GetActiveFilePath();
                const GitCmd = Path ? `git diff "${Path}"` : 'git diff';
                const Lines = await CaptureService.Run(GitCmd, Cwd);
                return { Lines: Lines.length > 0 ? Lines : ['  No changes.'] };
            }

            case 'gitlog?': {
                const Cwd = Snap.GetWorkspacePath();
                if (!Cwd) return { Lines: ['No workspace open.'] };
                return { Lines: await CaptureService.Run('git log --oneline -12', Cwd) };
            }

            case 'gitbranch?': {
                const Cwd = Snap.GetWorkspacePath();
                if (!Cwd) return { Lines: ['No workspace open.'] };
                return { Lines: await CaptureService.Run('git branch', Cwd) };
            }

            case 'gitadd!': {
                const Cwd  = Snap.GetWorkspacePath();
                if (!Cwd) return { Lines: ['No workspace open.'] };
                const Path = Snap.GetActiveFilePath();
                if (!Path) return { Lines: ['No active file.'] };
                const Lines = await CaptureService.Run(`git add "${Path}"`, Cwd);
                return { Lines: Lines.length > 0 ? Lines : [`Staged ${Snap.GetActiveFileName() ?? 'file'}.`] };
            }

            case 'gitaddall!': {
                const Cwd = Snap.GetWorkspacePath();
                if (!Cwd) return { Lines: ['No workspace open.'] };
                const Lines = await CaptureService.Run('git add .', Cwd);
                return { Lines: Lines.length > 0 ? Lines : ['Staged all changes.'] };
            }

            case 'gitcommit!': {
                const Cwd     = Snap.GetWorkspacePath();
                if (!Cwd) return { Lines: ['No workspace open.'] };
                const Message = Cmd.Args.join(' ');
                if (!Message) return { Lines: ['Usage: $gitcommit! <message>'] };
                return {
                    Lines: await CaptureService.Run(
                        `git commit -m "${Message.replace(/"/g, '\\"')}"`,
                        Cwd
                    ),
                };
            }

            case 'gitpull!': {
                const Cwd = Snap.GetWorkspacePath();
                if (!Cwd) return { Lines: ['No workspace open.'] };
                return { Lines: await CaptureService.Run('git pull', Cwd) };
            }

            case 'gitpush!': {
                const Cwd = Snap.GetWorkspacePath();
                if (!Cwd) return { Lines: ['No workspace open.'] };
                return { Lines: await CaptureService.Run('git push', Cwd) };
            }

            case 'help?':
                return {
                    Lines: [
                        'Suffix legend:  ! action   / workspace   ? query   @ config',
                        '',
                        'Terminal',
                        '  $clear!             clear terminal output',
                        '',
                        'Files',
                        '  $save!              save current file',
                        '  $saveall!           save all open files',
                        '  $files?             list open files',
                        '  $stats?             line / word / char count',
                        '  $linecount?         line count only',
                        '',
                        'Clipboard',
                        '  $copy!              copy current file content',
                        '  $copypath!          copy current file path',
                        '  $copyname!          copy current file name',
                        '',
                        'Search',
                        '  $find? <term>       search in open files',
                        '  $grep? <pattern>    git grep in workspace',
                        '',
                        'Git',
                        '  $gitstatus?         git status --short',
                        '  $gitdiff?           diff current file (or all)',
                        '  $gitlog?            last 12 commits',
                        '  $gitbranch?         list branches',
                        '  $gitadd!            stage current file',
                        '  $gitaddall!         stage all changes',
                        '  $gitcommit! <msg>   commit with message',
                        '  $gitpull!           git pull',
                        '  $gitpush!           git push',
                        '',
                        '  $workspace/         open workspace picker',
                        '  $help?              show this help',
                    ],
                };

            default:
                return { Lines: [`Unknown native command: $${Cmd.Name}${Cmd.Suffix}   (try $help?)`] };
        }
    },
};
