export type TokenType = "Keyword" | "String" | "Number" | "Comment" | "Function" | "Type" | "Operator" | "Default";

export interface Token {
    Type: TokenType;
    Value: string;
}

const ExtMap: Record<string, string> = {
    lua: "luau", luau: "luau",
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript",
    rs: "rust",
    css: "css",
    json: "json",
};

export function DetectLanguage(FileName: string): string {
    const Ext = FileName.split(".").pop()?.toLowerCase() ?? "";
    return ExtMap[Ext] ?? "plain";
}

function TokeniseWithPattern(
    Source: string,
    Pattern: RegExp,
    Keywords: Set<string>
): Token[] {
    const Result: Token[] = [];
    let LastIndex = 0;
    let Match: RegExpExecArray | null;

    Pattern.lastIndex = 0;

    while ((Match = Pattern.exec(Source)) !== null) {
        // Emit gap as Default
        if (Match.index > LastIndex) {
            Result.push({ Type: "Default", Value: Source.slice(LastIndex, Match.index) });
        }

        const Raw = Match[0];
        const G = Match.groups ?? {};

        if (G.comment !== undefined) {
            Result.push({ Type: "Comment", Value: Raw });
        } else if (G.string !== undefined) {
            Result.push({ Type: "String", Value: Raw });
        } else if (G.number !== undefined) {
            Result.push({ Type: "Number", Value: Raw });
        } else if (G.ident !== undefined) {
            if (Keywords.has(Raw)) {
                Result.push({ Type: "Keyword", Value: Raw });
            } else {
                const After = Source.slice(Match.index + Raw.length).trimStart();
                if (After.startsWith("(")) {
                    Result.push({ Type: "Function", Value: Raw });
                } else if (/^[A-Z]/.test(Raw)) {
                    Result.push({ Type: "Type", Value: Raw });
                } else {
                    Result.push({ Type: "Default", Value: Raw });
                }
            }
        } else if (G.op !== undefined) {
            Result.push({ Type: "Operator", Value: Raw });
        } else {
            Result.push({ Type: "Default", Value: Raw });
        }

        LastIndex = Match.index + Raw.length;
    }

    if (LastIndex < Source.length) {
        Result.push({ Type: "Default", Value: Source.slice(LastIndex) });
    }

    return Result;
}

const LuauKeywords = new Set([
    "local", "function", "end", "if", "then", "else", "elseif", "return",
    "for", "while", "do", "repeat", "until", "and", "or", "not", "nil",
    "true", "false", "in", "break", "continue", "self", "require",
    "type", "typeof", "export",
]);

const LuauPattern = /(?<comment>--\[\[[\s\S]*?\]\]|--[^\n]*)|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[\[[\s\S]*?\]\])|(?<number>0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?)|(?<ident>[A-Za-z_][A-Za-z0-9_]*)|(?<op>[+\-*/%^#&|~<>=~.,:;(){}[\]])/g;

function TokeniseLuau(Source: string): Token[] {
    return TokeniseWithPattern(Source, LuauPattern, LuauKeywords);
}

const TsKeywords = new Set([
    "const", "let", "var", "function", "class", "interface", "type",
    "import", "export", "from", "return", "if", "else", "for", "while",
    "do", "switch", "case", "break", "continue", "new", "typeof",
    "instanceof", "in", "of", "async", "await", "try", "catch", "finally",
    "throw", "true", "false", "null", "undefined", "extends", "implements",
    "readonly", "private", "public", "protected", "static", "void", "never",
    "any", "unknown", "enum", "namespace", "as", "this", "super", "default",
    "abstract", "declare", "keyof", "infer", "satisfies",
]);

const TsPattern = /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<number>0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?n?)|(?<ident>[A-Za-z_$][A-Za-z0-9_$]*)|(?<op>[+\-*/%&|^~<>=!?.,:;(){}[\]])/g;

function TokeniseTs(Source: string): Token[] {
    return TokeniseWithPattern(Source, TsPattern, TsKeywords);
}

const RustKeywords = new Set([
    "let", "mut", "fn", "pub", "use", "mod", "struct", "enum", "impl",
    "trait", "type", "where", "if", "else", "match", "for", "while",
    "loop", "return", "break", "continue", "true", "false", "self",
    "Self", "super", "crate", "const", "static", "ref", "move",
    "async", "await", "unsafe", "extern", "dyn", "in", "as", "Box",
    "Option", "Result", "Some", "None", "Ok", "Err", "Vec", "String",
]);

const RustPattern = /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>"(?:[^"\\]|\\.)*"|r#*"[\s\S]*?"#*|'(?:[^'\\]|\\.)*')|(?<number>0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64)?)|(?<ident>[A-Za-z_][A-Za-z0-9_]*)|(?<op>[+\-*/%&|^!<>=?.,:;(){}[\]])/g;

function TokeniseRust(Source: string): Token[] {
    return TokeniseWithPattern(Source, RustPattern, RustKeywords);
}
const CssKeywords = new Set<string>();

const CssPattern = /(?<comment>\/\*[\s\S]*?\*\/)|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<number>#[0-9a-fA-F]{3,8}|-?\d+\.?\d*(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?)|(?<ident>@[a-zA-Z-]+|[a-zA-Z-]+(?=\s*:)|[a-zA-Z-]+)|(?<op>[:{};,()\[\]])/g;

function TokeniseCss(Source: string): Token[] {
    const Tokens = TokeniseWithPattern(Source, CssPattern, CssKeywords);
    return Tokens.map((T, I) => {
        if (T.Type === "Default" && /^@[a-zA-Z]/.test(T.Value)) {
            return { ...T, Type: "Keyword" as TokenType };
        }
        if (T.Type === "Default" && I < Tokens.length - 1) {
            const Next = Tokens[I + 1];
            if (Next && Next.Value.trimStart().startsWith(":")) {
                return { ...T, Type: "Function" as TokenType };
            }
        }
        return T;
    });
}

const JsonPattern = /(?<comment>\/\/[^\n]*)|(?<string>"(?:[^"\\]|\\.)*")|(?<number>-?\d+\.?\d*(?:[eE][+-]?\d+)?)|(?<ident>true|false|null)|(?<op>[{}\[\]:,])/g;

function TokeniseJson(Source: string): Token[] {
    const Raw = TokeniseWithPattern(Source, JsonPattern, new Set(["true", "false", "null"]));
    return Raw.map((T, I) => {
        if (T.Type === "String") {
            for (let J = I + 1; J < Raw.length; J++) {
                const V = Raw[J].Value;
                if (V.trim() === "") continue;
                if (V.trimStart().startsWith(":")) {
                    return { ...T, Type: "Type" as TokenType };
                }
                break;
            }
        }
        return T;
    });
}

function TokenisePlain(Source: string): Token[] {
    return [{ Type: "Default", Value: Source }];
}

export function Tokenize(Source: string, Language: string): Token[] {
    switch (Language) {
        case "luau":       return TokeniseLuau(Source);
        case "typescript": return TokeniseTs(Source);
        case "javascript": return TokeniseTs(Source);
        case "rust":       return TokeniseRust(Source);
        case "css":        return TokeniseCss(Source);
        case "json":       return TokeniseJson(Source);
        default:           return TokenisePlain(Source);
    }
}
