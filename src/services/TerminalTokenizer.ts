export type TerminalTokenType =
    | 'plain'
    | 'error'
    | 'warning'
    | 'success'
    | 'filepath'
    | 'number'
    | 'string'
    | 'keyword'
    | 'funcname'
    | 'dim';

export interface TerminalToken {
    Type: TerminalTokenType;
    Text: string;
}

const ANSI_RE = /\x1b\[[0-9;]*[mGKHFJ]/g;

const EXTS =
    'tsx?|jsx?|rs|py|lua|luau|json|toml|css|scss|md|html|sh|bash|' +
    'yaml|yml|txt|lock|env|cfg|ini|xml|vue|svelte|go|java|kt|cpp?|h(?:pp)?|cs|rb|swift';
const PATTERNS: Array<{ Type: TerminalTokenType; Re: RegExp }> = [
    {
        Type: 'string',
        Re: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/,
    },

    {
        Type: 'filepath',
        Re: new RegExp(
            '(?:(?:[a-zA-Z]:[/\\\\]|\\.{0,2}[/\\\\])(?:[\\w.\\-]+[/\\\\])*[\\w.\\-]+\\.(?:' + EXTS + ')(?::\\d+(?::\\d+)?)?)' +
            '|' +
            '(?:[\\w.\\-]+(?:[/\\\\][\\w.\\-]+)+\\.(?:' + EXTS + ')(?::\\d+(?::\\d+)?)?)' +
            '|' +
            '(?:[\\w.\\-]+\\.(?:' + EXTS + '):\\d+(?::\\d+)?)',
            'i'
        ),
    },

    {
        Type: 'filepath',
        Re: new RegExp(
            '\\b[\\w.\\-]+\\.(?:' + EXTS + ')\\b',
            'i'
        ),
    },

    {
        Type: 'funcname',
        Re: /\b([a-zA-Z_]\w*)\s*\(\)/,
    },

    {
        Type: 'funcname',
        Re: /\b(?:fn|def|function|func|method)\s+([a-zA-Z_]\w*)/,
    },

    {
        Type: 'error',
        Re: /\b(?:error|failed|failure|fatal|panic|exception|abort|crash|err:)\b/i,
    },

    {
        Type: 'error',
        Re: /\b(?:E\d{4}|TS\d{4})\b/,
    },

    {
        Type: 'warning',
        Re: /\b(?:warning|warn|deprecated|caution|note:)\b/i,
    },

    {
        Type: 'success',
        Re: /\b(?:finished|compiling|compiled|built|running|passed|ok|success|done|installed|complete|ready|resolved|found)\b/i,
    },

    {
        Type: 'keyword',
        Re: /\bv?\d+\.\d+\.\d+(?:-[\w.]+)?\b/,
    },

    {
        Type: 'number',
        Re: /\b\d+(?:\.\d+)?(?:s|ms|kb|mb|gb|b)?\b/i,
    },
];

export function TokenizeLine(Line: string): TerminalToken[] {
    const Clean = Line.replace(ANSI_RE, '');
    if (Clean.length === 0) return [{ Type: 'plain', Text: '' }];
    if (Clean.startsWith('$ ')) {
        return [
            { Type: 'keyword', Text: '$ ' },
            ...TokenizeSegment(Clean.slice(2)),
        ];
    }
    if (/^\s*-->\s/.test(Clean)) {
        const Arrow = Clean.match(/^(\s*-->\s*)(.*)/);
        if (Arrow) {
            return [
                { Type: 'dim',   Text: Arrow[1] },
                ...TokenizeSegment(Arrow[2]),
            ];
        }
    }
    if (/^\s*\|\s*$/.test(Clean) || /^\s*=\s+/.test(Clean)) {
        return [{ Type: 'dim', Text: Clean }];
    }

    return TokenizeSegment(Clean);
}

function TokenizeSegment(Text: string): TerminalToken[] {
    const Tokens: TerminalToken[] = [];
    let Remaining = Text;

    while (Remaining.length > 0) {
        let BestMatch: RegExpExecArray | null = null;
        let BestType: TerminalTokenType = 'plain';
        let BestIndex = Remaining.length;

        for (const { Type, Re } of PATTERNS) {
            const M = Re.exec(Remaining);
            if (M !== null && M.index < BestIndex) {
                BestIndex = M.index;
                BestMatch = M;
                BestType = Type;
            }
        }

        if (BestMatch === null) {
            Tokens.push({ Type: 'plain', Text: Remaining });
            break;
        }

        if (BestIndex > 0) {
            Tokens.push({ Type: 'plain', Text: Remaining.slice(0, BestIndex) });
        }

        Tokens.push({ Type: BestType, Text: BestMatch[0] });
        Remaining = Remaining.slice(BestIndex + BestMatch[0].length);
    }

    return Tokens;
}
