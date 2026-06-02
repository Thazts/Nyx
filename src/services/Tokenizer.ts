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
    py: "python",
    html: "html", htm: "html",
    toml: "toml",
    wgsl: "wgsl",
    glsl: "glsl", vert: "glsl", frag: "glsl",
    md: "markdown",
    yaml: "yaml", yml: "yaml",
    c: "c", h: "c",
    cpp: "cpp", hpp: "cpp", cc: "cpp", hxx: "cpp",
    go: "go",
    sh: "bash", bash: "bash",
    sql: "sql",
    cs: "csharp",
    java: "java",
    xml: "xml",
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

// ── Luau ──────────────────────────────────────────────────────────────────────

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

// ── TypeScript / JavaScript ───────────────────────────────────────────────────

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

// ── Rust ──────────────────────────────────────────────────────────────────────

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

// ── CSS ───────────────────────────────────────────────────────────────────────

const CssKeywords = new Set<string>();

const CssPattern = /(?<comment>\/\*[\s\S]*?\*\/)|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<number>#[0-9a-fA-F]{3,8}|-?\d+\.?\d*(?:px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|rad|fr|ch|ex|pt|pc|cm|mm|in)?)|(?<ident>@[a-zA-Z-]+|[a-zA-Z-]+(?=\s*:)|[a-zA-Z-]+)|(?<op>[:{};,()\[\]])/g;

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

// ── JSON ──────────────────────────────────────────────────────────────────────

const JsonPattern = /(?<comment>\/\/[^\n]*)|(?<string>"(?:[^"\\]|\\.)*")|(?<number>-?\d+\.?\d*(?:[eE][+-]?\d+)?)|(?<ident>true|false|null)|(?<op>[{}\[\]:,])/g;

function TokeniseJson(Source: string): Token[] {
    const Raw = TokeniseWithPattern(Source, JsonPattern, new Set(["true", "false", "null"]));
    return Raw.map((T, I) => {
        if (T.Type === "String") {
            for (let J = I + 1; J < Raw.length; J++) {
                const V = Raw[J].Value;
                if (V.trim() === "") continue;
                if (V.trimStart().startsWith(":")) return { ...T, Type: "Type" as TokenType };
                break;
            }
        }
        return T;
    });
}

// ── Python ────────────────────────────────────────────────────────────────────

const PythonKeywords = new Set([
    "def", "class", "if", "elif", "else", "for", "while", "try", "except",
    "finally", "with", "import", "from", "return", "yield", "break", "continue",
    "pass", "and", "or", "not", "in", "is", "lambda", "del", "global",
    "nonlocal", "raise", "assert", "True", "False", "None", "async", "await",
    "as", "match", "case",
]);

const PythonPattern = /(?<comment>#[^\n]*)|(?<string>"""[\s\S]*?"""|'''[\s\S]*?'''|f"""[\s\S]*?"""|f'''[\s\S]*?'''|r"""[\s\S]*?"""|r'''[\s\S]*?'''|f"(?:[^"\\]|\\.)*"|f'(?:[^'\\]|\\.)*'|r"(?:[^"\\]|\\.)*"|r'(?:[^'\\]|\\.)*'|b"(?:[^"\\]|\\.)*"|b'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<number>0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?j?)|(?<ident>[A-Za-z_][A-Za-z0-9_]*)|(?<op>[+\-*/%@&|^~<>=!?.,:;(){}[\]])/g;

function TokenisePython(Source: string): Token[] {
    return TokeniseWithPattern(Source, PythonPattern, PythonKeywords);
}

// ── HTML ──────────────────────────────────────────────────────────────────────

const HtmlTagKeywords = new Set([
    "div", "span", "p", "a", "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "table", "tr", "td", "th", "thead", "tbody", "tfoot",
    "form", "input", "button", "select", "option", "textarea", "label",
    "header", "footer", "main", "nav", "section", "article", "aside",
    "img", "video", "audio", "canvas", "svg", "path", "script", "style",
    "link", "meta", "title", "head", "body", "html", "br", "hr", "pre",
    "code", "em", "strong", "b", "i", "u", "s", "blockquote", "figure",
    "figcaption", "details", "summary", "dialog", "template", "slot",
    "iframe", "embed", "object", "param", "source", "track", "picture",
    "map", "area", "col", "colgroup", "caption", "optgroup", "fieldset",
    "legend", "datalist", "output", "progress", "meter", "time", "mark",
    "ruby", "rt", "rp", "bdi", "bdo", "wbr", "address", "cite", "abbr",
    "dfn", "kbd", "samp", "var", "sub", "sup", "small", "del", "ins",
    "q", "menu", "noscript",
]);

function TokeniseHtml(Source: string): Token[] {
    const Result: Token[] = [];
    let I = 0;
    const N = Source.length;

    while (I < N) {
        if (Source.startsWith("<!--", I)) {
            const End = Source.indexOf("-->", I + 4);
            const EndI = End === -1 ? N : End + 3;
            Result.push({ Type: "Comment", Value: Source.slice(I, EndI) });
            I = EndI;
            continue;
        }
        if (Source.startsWith("<!", I)) {
            const End = Source.indexOf(">", I);
            const EndI = End === -1 ? N : End + 1;
            Result.push({ Type: "Comment", Value: Source.slice(I, EndI) });
            I = EndI;
            continue;
        }
        if (Source[I] === "<") {
            Result.push({ Type: "Operator", Value: "<" });
            I++;
            if (I < N && Source[I] === "/") { Result.push({ Type: "Operator", Value: "/" }); I++; }
            const NameStart = I;
            while (I < N && /[a-zA-Z0-9\-]/.test(Source[I])) I++;
            const Name = Source.slice(NameStart, I);
            if (Name) {
                Result.push({ Type: HtmlTagKeywords.has(Name.toLowerCase()) ? "Keyword" : "Function", Value: Name });
            }
            while (I < N && Source[I] !== ">") {
                if (I < N && Source[I] === "/" && I + 1 < N && Source[I + 1] === ">") break;
                const C = Source[I];
                if (C === '"' || C === "'") {
                    const Q = C; const S = I++;
                    while (I < N && Source[I] !== Q) { if (Source[I] === "\\") I++; I++; }
                    if (I < N) I++;
                    Result.push({ Type: "String", Value: Source.slice(S, I) });
                } else if (C === "=") {
                    Result.push({ Type: "Operator", Value: "=" }); I++;
                } else if (/[a-zA-Z]/.test(C)) {
                    const AS = I;
                    while (I < N && /[a-zA-Z0-9\-:_.]/.test(Source[I])) I++;
                    Result.push({ Type: "Type", Value: Source.slice(AS, I) });
                } else {
                    Result.push({ Type: "Default", Value: C }); I++;
                }
            }
            if (I < N && Source[I] === "/" && I + 1 < N && Source[I + 1] === ">") {
                Result.push({ Type: "Operator", Value: "/>" }); I += 2;
            } else if (I < N && Source[I] === ">") {
                Result.push({ Type: "Operator", Value: ">" }); I++;
            }
            continue;
        }
        if (Source[I] === "&") {
            const S = I;
            while (I < N && Source[I] !== ";" && Source[I] !== " " && Source[I] !== "\n") I++;
            if (I < N && Source[I] === ";") I++;
            Result.push({ Type: "Number", Value: Source.slice(S, I) });
            continue;
        }
        const TextStart = I;
        while (I < N && Source[I] !== "<" && Source[I] !== "&") I++;
        if (I > TextStart) Result.push({ Type: "Default", Value: Source.slice(TextStart, I) });
    }
    return Result;
}

// ── TOML ──────────────────────────────────────────────────────────────────────

const TomlKeywords = new Set(["true", "false", "inf", "nan", "+inf", "-inf"]);

const TomlPattern = /(?<comment>#[^\n]*)|(?<string>"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'[^']*')|(?<number>0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?|\+?-?\d+\.?\d*(?:[eE][+-]?\d+)?)|(?<ident>[a-zA-Z_][a-zA-Z0-9_\-.]*)|(?<op>[={}\[\].,])/g;

function TokeniseToml(Source: string): Token[] {
    const Raw = TokeniseWithPattern(Source, TomlPattern, TomlKeywords);
    return Raw.map((T, I) => {
        if (T.Type === "Default" || T.Type === "Function") {
            for (let J = I + 1; J < Raw.length; J++) {
                const V = Raw[J].Value;
                if (V.trim() === "") continue;
                if (V === "=") return { ...T, Type: "Type" as TokenType };
                break;
            }
        }
        return T;
    });
}

// ── WGSL ──────────────────────────────────────────────────────────────────────

const WgslKeywords = new Set([
    "var", "let", "fn", "struct", "if", "else", "for", "while", "loop",
    "return", "break", "continue", "true", "false", "const", "type",
    "override", "alias", "discard", "switch", "case", "default",
    "fallthrough", "enable", "diagnostic", "requires",
    "workgroup", "uniform", "storage", "read", "write", "read_write",
    "private", "function", "handle",
    "vertex", "fragment", "compute",
    "f32", "f16", "i32", "u32", "bool", "void",
    "vec2", "vec3", "vec4", "vec2f", "vec3f", "vec4f",
    "vec2i", "vec3i", "vec4i", "vec2u", "vec3u", "vec4u",
    "vec2h", "vec3h", "vec4h",
    "mat2x2", "mat2x3", "mat2x4", "mat3x2", "mat3x3", "mat3x4",
    "mat4x2", "mat4x3", "mat4x4",
    "mat2x2f", "mat3x3f", "mat4x4f",
    "array", "ptr", "atomic",
    "sampler", "sampler_comparison",
    "texture_1d", "texture_2d", "texture_2d_array", "texture_3d",
    "texture_cube", "texture_cube_array", "texture_multisampled_2d",
    "texture_depth_2d", "texture_depth_cube", "texture_depth_2d_array",
    "texture_storage_1d", "texture_storage_2d", "texture_storage_2d_array",
    "texture_storage_3d",
]);

const WgslPattern = /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>"(?:[^"\\]|\\.)*")|(?<number>0x[0-9a-fA-F]+|0[iu]|[0-9]+\.[0-9]*(?:[eE][+-]?[0-9]+)?[fh]?|[0-9]+[eE][+-]?[0-9]+[fh]?|[0-9]+[iu]?|[0-9]+[fh])|(?<ident>[A-Za-z_][A-Za-z0-9_]*)|(?<op>[+\-*/%&|^!<>=?.,:;@(){}[\]])/g;

function TokeniseWgsl(Source: string): Token[] {
    return TokeniseWithPattern(Source, WgslPattern, WgslKeywords);
}

// ── GLSL ──────────────────────────────────────────────────────────────────────

const GlslKeywords = new Set([
    "attribute", "uniform", "varying", "in", "out", "inout",
    "precision", "highp", "mediump", "lowp", "if", "else",
    "for", "while", "do", "return", "break", "continue", "discard",
    "struct", "const", "layout", "flat", "smooth", "centroid",
    "invariant", "coherent", "volatile", "restrict", "readonly", "writeonly",
    "void", "bool", "int", "uint", "float", "double",
    "bvec2", "bvec3", "bvec4", "ivec2", "ivec3", "ivec4",
    "uvec2", "uvec3", "uvec4", "vec2", "vec3", "vec4",
    "dvec2", "dvec3", "dvec4",
    "mat2", "mat3", "mat4", "mat2x2", "mat2x3", "mat2x4",
    "mat3x2", "mat3x3", "mat3x4", "mat4x2", "mat4x3", "mat4x4",
    "sampler2D", "sampler3D", "samplerCube", "sampler2DShadow",
    "sampler2DArray", "sampler2DArrayShadow",
    "isampler2D", "isampler3D", "isamplerCube",
    "usampler2D", "usampler3D", "usamplerCube",
    "true", "false",
    "gl_Position", "gl_FragCoord", "gl_FragColor", "gl_VertexID",
    "gl_InstanceID", "gl_FrontFacing", "gl_PointSize", "gl_PointCoord",
    "gl_FragDepth", "gl_ClipDistance",
    "#version", "#extension", "#define", "#ifdef", "#ifndef", "#endif", "#else", "#elif", "#include",
]);

const GlslPattern = /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>"(?:[^"\\]|\\.)*")|(?<number>0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?[fFuU]*)|(?<ident>#[a-zA-Z]+|[A-Za-z_][A-Za-z0-9_]*)|(?<op>[+\-*/%&|^!<>=?.,:;(){}[\]])/g;

function TokeniseGlsl(Source: string): Token[] {
    return TokeniseWithPattern(Source, GlslPattern, GlslKeywords);
}

// ── Markdown ──────────────────────────────────────────────────────────────────

function TokeniseMarkdown(Source: string): Token[] {
    const Result: Token[] = [];
    const Lines = Source.split("\n");
    let InCodeBlock = false;
    let CodeFence = "";

    for (let L = 0; L < Lines.length; L++) {
        const Line = Lines[L];
        const Suffix = L < Lines.length - 1 ? "\n" : "";

        if (!InCodeBlock && /^(`{3,}|~{3,})/.test(Line)) {
            const M = Line.match(/^(`{3,}|~{3,})/);
            InCodeBlock = true;
            CodeFence = M![1];
            Result.push({ Type: "String", Value: Line + Suffix });
            continue;
        }
        if (InCodeBlock) {
            if (Line.startsWith(CodeFence)) InCodeBlock = false;
            Result.push({ Type: "String", Value: Line + Suffix });
            continue;
        }
        if (/^#{1,6}(\s|$)/.test(Line)) {
            Result.push({ Type: "Keyword", Value: Line + Suffix });
            continue;
        }
        if (/^>\s?/.test(Line)) {
            Result.push({ Type: "Comment", Value: Line + Suffix });
            continue;
        }
        if (/^[-*_]{3,}\s*$/.test(Line)) {
            Result.push({ Type: "Operator", Value: Line + Suffix });
            continue;
        }
        TokeniseMdInline(Line + Suffix, Result);
    }
    return Result;
}

function TokeniseMdInline(Line: string, Result: Token[]): void {
    const InlineRx = /(?<code>`[^`]+`)|(?<bold>\*\*(?:[^*]|\*(?!\*))+\*\*|__(?:[^_]|_(?!_))+__)|(?<italic>\*(?:[^*])+\*|_(?:[^_])+_)|(?<img>!\[[^\]]*\]\([^)]*\))|(?<link>\[[^\]]*\]\([^)]*\))|(?<bullet>^[\s]*[-*+]\s|^[\s]*\d+\.\s)/gm;
    let Last = 0;
    let M: RegExpExecArray | null;
    InlineRx.lastIndex = 0;
    while ((M = InlineRx.exec(Line)) !== null) {
        if (M.index > Last) Result.push({ Type: "Default", Value: Line.slice(Last, M.index) });
        const G = M.groups ?? {};
        if (G.code !== undefined)   Result.push({ Type: "String",   Value: M[0] });
        else if (G.bold !== undefined)   Result.push({ Type: "Keyword",  Value: M[0] });
        else if (G.italic !== undefined) Result.push({ Type: "Function", Value: M[0] });
        else if (G.img !== undefined)    Result.push({ Type: "Number",   Value: M[0] });
        else if (G.link !== undefined)   Result.push({ Type: "Type",     Value: M[0] });
        else if (G.bullet !== undefined) Result.push({ Type: "Operator", Value: M[0] });
        Last = M.index + M[0].length;
    }
    if (Last < Line.length) Result.push({ Type: "Default", Value: Line.slice(Last) });
}

// ── YAML ──────────────────────────────────────────────────────────────────────

const YamlKeywords = new Set(["true", "false", "null", "yes", "no", "on", "off", "~"]);

const YamlPattern = /(?<comment>#[^\n]*)|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[|>][-+]?(?:\n(?:  [^\n]*))+)|(?<number>-?\d+\.?\d*(?:[eE][+-]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+)|(?<ident>[&*][a-zA-Z_][a-zA-Z0-9_]*|[a-zA-Z_][a-zA-Z0-9_\-. /]*)|(?<op>[:{}\[\],\-])/g;

function TokeniseYaml(Source: string): Token[] {
    const Raw = TokeniseWithPattern(Source, YamlPattern, YamlKeywords);
    return Raw.map((T, I) => {
        if ((T.Type === "Default" || T.Type === "Function") && /^[a-zA-Z_]/.test(T.Value)) {
            for (let J = I + 1; J < Raw.length; J++) {
                const V = Raw[J].Value;
                if (V === " " || V === "\t") continue;
                if (V === ":") return { ...T, Type: "Type" as TokenType };
                break;
            }
        }
        if (T.Type === "Default" && /^[&*]/.test(T.Value)) {
            return { ...T, Type: "Function" as TokenType };
        }
        return T;
    });
}

// ── C ─────────────────────────────────────────────────────────────────────────

const CKeywords = new Set([
    "int", "char", "float", "double", "void", "long", "short", "unsigned",
    "signed", "const", "static", "extern", "volatile", "register", "auto",
    "if", "else", "for", "while", "do", "return", "break", "continue",
    "switch", "case", "default", "goto", "struct", "union", "enum", "typedef",
    "sizeof", "NULL", "true", "false", "inline", "restrict",
    "#include", "#define", "#ifdef", "#ifndef", "#endif", "#else", "#elif",
    "#pragma", "#error", "#warning", "#undef", "#if",
]);

const CPattern = /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<number>0x[0-9a-fA-F]+[uUlL]*|0[0-7]+[uUlL]*|\d+\.?\d*(?:[eE][+-]?\d+)?[fFlL]?)|(?<ident>#[a-zA-Z]+|[A-Za-z_][A-Za-z0-9_]*)|(?<op>[+\-*/%&|^!~<>=?.,:;(){}[\]])/g;

function TokeniseC(Source: string): Token[] {
    return TokeniseWithPattern(Source, CPattern, CKeywords);
}

// ── C++ ───────────────────────────────────────────────────────────────────────

const CppKeywords = new Set([
    ...CKeywords,
    "class", "namespace", "template", "typename", "new", "delete", "try",
    "catch", "throw", "public", "private", "protected", "virtual", "override",
    "final", "explicit", "using", "nullptr", "bool", "this", "operator",
    "friend", "mutable", "constexpr", "consteval", "constinit", "decltype",
    "noexcept", "static_assert", "thread_local", "concept", "requires",
    "co_await", "co_return", "co_yield", "export", "import", "module",
    "and", "or", "not", "xor", "bitand", "bitor", "compl", "and_eq",
    "or_eq", "xor_eq", "not_eq",
]);

function TokeniseCpp(Source: string): Token[] {
    return TokeniseWithPattern(Source, CPattern, CppKeywords);
}

// ── Go ────────────────────────────────────────────────────────────────────────

const GoKeywords = new Set([
    "func", "var", "const", "type", "struct", "interface", "map", "chan",
    "if", "else", "for", "range", "switch", "case", "default", "return",
    "break", "continue", "go", "defer", "select", "import", "package",
    "true", "false", "nil", "make", "new", "len", "cap", "append",
    "copy", "delete", "close", "panic", "recover", "print", "println",
    "error", "any", "byte", "rune", "string", "bool",
    "int", "int8", "int16", "int32", "int64",
    "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
    "float32", "float64", "complex64", "complex128",
    "fallthrough", "goto",
]);

const GoPattern = /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>`[^`]*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<number>0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?i?)|(?<ident>[A-Za-z_][A-Za-z0-9_]*)|(?<op>[+\-*/%&|^!<>=?.,:;(){}[\]])/g;

function TokeniseGo(Source: string): Token[] {
    return TokeniseWithPattern(Source, GoPattern, GoKeywords);
}

// ── Bash ──────────────────────────────────────────────────────────────────────

const BashKeywords = new Set([
    "if", "then", "else", "elif", "fi", "for", "while", "do", "done",
    "case", "esac", "in", "function", "return", "exit", "local", "export",
    "readonly", "unset", "shift", "true", "false", "echo", "read",
    "source", "select", "until", "time", "declare", "typeset", "set",
    "eval", "exec", "test", "alias", "unalias", "trap",
]);

const BashPattern = /(?<comment>#[^\n]*)|(?<string>"(?:[^"\\]|\\.|\$\{[^}]*\}|\$[a-zA-Z_][a-zA-Z0-9_]*)*"|'[^']*'|`[^`]*`)|(?<number>-?\d+\.?\d*)|(?<ident>\$\{[^}]*\}|\$[a-zA-Z_][a-zA-Z0-9_]*|\$[@*#?$!0-9\-]|\[\[|\]\]|[A-Za-z_][A-Za-z0-9_]*)|(?<op>[(){};|&<>!=])/g;

function TokeniseBash(Source: string): Token[] {
    const Tokens = TokeniseWithPattern(Source, BashPattern, BashKeywords);
    return Tokens.map(T => {
        if (T.Type === "Default" && /^\$/.test(T.Value)) return { ...T, Type: "Function" as TokenType };
        if (T.Type === "Default" && (T.Value === "[[" || T.Value === "]]")) return { ...T, Type: "Operator" as TokenType };
        return T;
    });
}

// ── SQL ───────────────────────────────────────────────────────────────────────

const SqlKeywordSet = new Set([
    "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER",
    "FULL", "CROSS", "ON", "GROUP", "BY", "ORDER", "HAVING", "LIMIT",
    "OFFSET", "UNION", "ALL", "DISTINCT", "AS", "AND", "OR", "NOT",
    "NULL", "IS", "IN", "LIKE", "ILIKE", "BETWEEN", "EXISTS", "ANY",
    "SOME", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
    "CREATE", "TABLE", "DROP", "ALTER", "ADD", "COLUMN", "INDEX",
    "VIEW", "DATABASE", "SCHEMA", "SEQUENCE", "PRIMARY", "KEY",
    "FOREIGN", "REFERENCES", "UNIQUE", "CHECK", "CONSTRAINT", "DEFAULT",
    "CASE", "WHEN", "THEN", "ELSE", "END", "IF", "BEGIN", "COMMIT",
    "ROLLBACK", "TRANSACTION", "PROCEDURE", "FUNCTION", "TRIGGER",
    "RETURNS", "RETURN", "DECLARE", "WITH", "RECURSIVE", "ASC", "DESC",
    "NULLS", "FIRST", "LAST", "FETCH", "NEXT", "ROWS", "ROW", "ONLY",
    "OVER", "PARTITION", "WINDOW", "FILTER", "WITHIN",
    "COUNT", "SUM", "AVG", "MAX", "MIN", "COALESCE", "NULLIF", "CAST",
    "CONVERT", "ISNULL", "IFNULL", "NVL", "CONCAT", "SUBSTRING",
    "LENGTH", "UPPER", "LOWER", "TRIM", "REPLACE", "ROUND", "FLOOR",
    "CEILING", "CEIL", "ABS", "NOW", "CURRENT_DATE", "CURRENT_TIME",
    "CURRENT_TIMESTAMP", "EXTRACT", "DATE", "TIME", "TIMESTAMP",
    "TRUE", "FALSE", "AUTO_INCREMENT", "IDENTITY", "SERIAL",
]);

const SqlPattern = /(?<comment>--[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(?<number>\d+\.?\d*(?:[eE][+-]?\d+)?)|(?<ident>[A-Za-z_][A-Za-z0-9_]*)|(?<op>[+\-*/%=<>!,;.()\[\]])/g;

function TokeniseSql(Source: string): Token[] {
    const Raw = TokeniseWithPattern(Source, SqlPattern, new Set<string>());
    return Raw.map(T => {
        if (T.Type === "Default" || T.Type === "Function" || T.Type === "Type") {
            if (SqlKeywordSet.has(T.Value.toUpperCase())) return { ...T, Type: "Keyword" as TokenType };
        }
        return T;
    });
}

// ── C# ────────────────────────────────────────────────────────────────────────

const CsharpKeywords = new Set([
    "class", "interface", "struct", "enum", "namespace", "using", "var",
    "const", "public", "private", "protected", "internal", "static",
    "readonly", "abstract", "virtual", "override", "sealed", "new",
    "this", "base", "return", "if", "else", "for", "foreach", "while",
    "do", "switch", "case", "default", "break", "continue", "try", "catch",
    "finally", "throw", "true", "false", "null", "void", "int", "string",
    "bool", "float", "double", "decimal", "object", "char", "byte",
    "short", "long", "uint", "ulong", "ushort", "sbyte", "async", "await",
    "yield", "typeof", "is", "as", "in", "out", "ref", "params", "get",
    "set", "value", "event", "delegate", "operator", "implicit", "explicit",
    "checked", "unchecked", "fixed", "unsafe", "stackalloc", "lock",
    "where", "partial", "record", "with", "init", "required", "file",
    "scoped", "global", "when", "and", "or", "not",
]);

const CsharpPattern = /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>@"(?:[^"]|"")*"|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<number>0x[0-9a-fA-F_]+[uUlL]*|\d[\d_]*\.?[\d_]*[fFdDmMuUlL]*)|(?<ident>[A-Za-z_][A-Za-z0-9_]*)|(?<op>[+\-*/%&|^!~<>=?.,:;(){}[\]])/g;

function TokeniseCsharp(Source: string): Token[] {
    return TokeniseWithPattern(Source, CsharpPattern, CsharpKeywords);
}

// ── Java ──────────────────────────────────────────────────────────────────────

const JavaKeywords = new Set([
    "class", "interface", "enum", "abstract", "extends", "implements",
    "new", "this", "super", "return", "if", "else", "for", "while", "do",
    "switch", "case", "default", "break", "continue", "try", "catch",
    "finally", "throw", "throws", "static", "final", "public", "private",
    "protected", "void", "int", "long", "short", "byte", "float", "double",
    "char", "boolean", "null", "true", "false", "import", "package",
    "instanceof", "synchronized", "volatile", "transient", "native",
    "strictfp", "assert", "const", "goto", "var", "record", "sealed",
    "permits", "yield", "non", "when",
]);

function TokeniseJava(Source: string): Token[] {
    return TokeniseWithPattern(Source, TsPattern, JavaKeywords);
}

// ── XML ───────────────────────────────────────────────────────────────────────

function TokeniseXml(Source: string): Token[] {
    const Result: Token[] = [];
    let I = 0;
    const N = Source.length;

    while (I < N) {
        if (Source.startsWith("<!--", I)) {
            const End = Source.indexOf("-->", I + 4);
            const EndI = End === -1 ? N : End + 3;
            Result.push({ Type: "Comment", Value: Source.slice(I, EndI) });
            I = EndI;
            continue;
        }
        if (Source.startsWith("<![CDATA[", I)) {
            const End = Source.indexOf("]]>", I + 9);
            const EndI = End === -1 ? N : End + 3;
            Result.push({ Type: "String", Value: Source.slice(I, EndI) });
            I = EndI;
            continue;
        }
        if (Source.startsWith("<?", I)) {
            const End = Source.indexOf("?>", I + 2);
            const EndI = End === -1 ? N : End + 2;
            Result.push({ Type: "Comment", Value: Source.slice(I, EndI) });
            I = EndI;
            continue;
        }
        if (Source[I] === "<") {
            Result.push({ Type: "Operator", Value: "<" }); I++;
            if (I < N && Source[I] === "/") { Result.push({ Type: "Operator", Value: "/" }); I++; }
            const NameStart = I;
            while (I < N && /[a-zA-Z0-9\-:_.]/.test(Source[I])) I++;
            const Name = Source.slice(NameStart, I);
            if (Name) Result.push({ Type: "Function", Value: Name });
            while (I < N && Source[I] !== ">") {
                if (Source[I] === "/" && I + 1 < N && Source[I + 1] === ">") break;
                const C = Source[I];
                if (C === '"' || C === "'") {
                    const Q = C; const S = I++;
                    while (I < N && Source[I] !== Q) I++;
                    if (I < N) I++;
                    Result.push({ Type: "String", Value: Source.slice(S, I) });
                } else if (C === "=") {
                    Result.push({ Type: "Operator", Value: "=" }); I++;
                } else if (/[a-zA-Z]/.test(C)) {
                    const AS = I;
                    while (I < N && /[a-zA-Z0-9\-:_.]/.test(Source[I])) I++;
                    Result.push({ Type: "Type", Value: Source.slice(AS, I) });
                } else {
                    Result.push({ Type: "Default", Value: C }); I++;
                }
            }
            if (I < N && Source[I] === "/" && I + 1 < N && Source[I + 1] === ">") {
                Result.push({ Type: "Operator", Value: "/>" }); I += 2;
            } else if (I < N && Source[I] === ">") {
                Result.push({ Type: "Operator", Value: ">" }); I++;
            }
            continue;
        }
        if (Source[I] === "&") {
            const S = I;
            while (I < N && Source[I] !== ";") I++;
            if (I < N) I++;
            Result.push({ Type: "Number", Value: Source.slice(S, I) });
            continue;
        }
        const TextStart = I;
        while (I < N && Source[I] !== "<" && Source[I] !== "&") I++;
        if (I > TextStart) Result.push({ Type: "Default", Value: Source.slice(TextStart, I) });
    }
    return Result;
}

// ── Plain ─────────────────────────────────────────────────────────────────────

function TokenisePlain(Source: string): Token[] {
    return [{ Type: "Default", Value: Source }];
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export function Tokenize(Source: string, Language: string): Token[] {
    switch (Language) {
        case "luau":       return TokeniseLuau(Source);
        case "typescript": return TokeniseTs(Source);
        case "javascript": return TokeniseTs(Source);
        case "rust":       return TokeniseRust(Source);
        case "css":        return TokeniseCss(Source);
        case "json":       return TokeniseJson(Source);
        case "python":     return TokenisePython(Source);
        case "html":       return TokeniseHtml(Source);
        case "toml":       return TokeniseToml(Source);
        case "wgsl":       return TokeniseWgsl(Source);
        case "glsl":       return TokeniseGlsl(Source);
        case "markdown":   return TokeniseMarkdown(Source);
        case "yaml":       return TokeniseYaml(Source);
        case "c":          return TokeniseC(Source);
        case "cpp":        return TokeniseCpp(Source);
        case "go":         return TokeniseGo(Source);
        case "bash":       return TokeniseBash(Source);
        case "sql":        return TokeniseSql(Source);
        case "csharp":     return TokeniseCsharp(Source);
        case "java":       return TokeniseJava(Source);
        case "xml":        return TokeniseXml(Source);
        default:           return TokenisePlain(Source);
    }
}
