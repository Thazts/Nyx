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
    kt: "kotlin", kts: "kotlin",
    swift: "swift",
    dart: "dart",
    rb: "ruby",
    php: "php",
    hlsl: "hlsl", hlsli: "hlsl", fx: "hlsl",
    graphql: "graphql", gql: "graphql",
    zig: "zig",
    scala: "scala", sc: "scala",
    ex: "elixir", exs: "elixir",
    hs: "haskell",
    dockerfile: "dockerfile",
    makefile: "makefile", mk: "makefile", mak: "makefile",
    nim: "nim", nims: "nim", nimble: "nim",
    v: "vlang", vsh: "vlang", vv: "vlang",
    red: "red", reds: "red",
    ijs: "j",
    apl: "apl", aplf: "apl", dyalog: "apl",
    factor: "factor",
    idr: "idris", lidr: "idris",
    ml: "ocaml", mli: "ocaml",
    fs: "fsharp", fsi: "fsharp", fsx: "fsharp",
    erl: "erlang", hrl: "erlang",
    rkt: "racket",
    scm: "scheme", ss: "scheme",
    lisp: "lisp", cl: "lisp",
    f: "fortran", f90: "fortran", f95: "fortran", f03: "fortran",
    f08: "fortran", for: "fortran",
    cob: "cobol", cbl: "cobol", cpy: "cobol",
    adb: "ada", ads: "ada",
    cr: "crystal",
    jl: "julia",
    bf: "brainfuck", b: "brainfuck",
    ws: "whitespace",
    lol: "lolcode", lols: "lolcode",
    bef: "befunge", b93: "befunge", befunge: "befunge",
    chef: "chef",
};

export function DetectLanguage(FileName: string): string {
    const Base = FileName.split(/[\\/]/).pop()?.toLowerCase() ?? FileName.toLowerCase();
    if (Base === "dockerfile") return "dockerfile";
    if (Base === "makefile" || Base === "gnumakefile") return "makefile";
    const Ext = Base.split(".").pop()?.toLowerCase() ?? "";
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

const KotlinKeywords = new Set([
    "fun", "val", "var", "class", "object", "interface", "data", "sealed",
    "enum", "open", "abstract", "override", "public", "private", "protected",
    "internal", "companion", "init", "constructor", "this", "super", "return",
    "if", "else", "when", "for", "while", "do", "break", "continue", "in",
    "is", "as", "try", "catch", "finally", "throw", "import", "package",
    "typealias", "by", "get", "set", "lateinit", "lazy", "suspend", "inline",
    "reified", "vararg", "out", "where", "null", "true", "false", "Unit",
    "Int", "String", "Boolean", "Long", "Double", "Float", "Char", "Any",
    "List", "Map", "Set", "Array",
]);

const CurlyTriplePattern = /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>"""[\s\S]*?"""|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<number>0x[0-9a-fA-F_]+|0b[01_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?[fFlLdDuU]*)|(?<ident>@[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_$][A-Za-z0-9_$]*)|(?<op>[+\-*/%&|^!~<>=?.,:;@(){}[\]])/g;

function TokeniseKotlin(Source: string): Token[] {
    return TokeniseWithPattern(Source, CurlyTriplePattern, KotlinKeywords);
}

const SwiftKeywords = new Set([
    "func", "let", "var", "class", "struct", "enum", "protocol", "extension",
    "init", "deinit", "self", "Self", "super", "return", "if", "else",
    "guard", "switch", "case", "default", "for", "while", "repeat", "break",
    "continue", "in", "where", "as", "is", "try", "catch", "throw", "throws",
    "rethrows", "defer", "do", "import", "typealias", "associatedtype",
    "public", "private", "fileprivate", "internal", "open", "static", "final",
    "override", "mutating", "nonmutating", "lazy", "weak", "unowned", "inout",
    "indirect", "convenience", "required", "some", "any", "nil", "true",
    "false", "async", "await", "actor", "Int", "String", "Bool", "Double",
    "Float", "Void", "Array", "Dictionary", "Optional",
]);

function TokeniseSwift(Source: string): Token[] {
    return TokeniseWithPattern(Source, CurlyTriplePattern, SwiftKeywords);
}

const DartKeywords = new Set([
    "void", "var", "final", "const", "dynamic", "class", "abstract", "extends",
    "implements", "with", "mixin", "enum", "typedef", "return", "if", "else",
    "switch", "case", "default", "for", "while", "do", "break", "continue",
    "in", "is", "as", "new", "this", "super", "try", "catch", "finally",
    "throw", "rethrow", "import", "export", "library", "part", "show", "hide",
    "async", "await", "yield", "sync", "get", "set", "static", "factory",
    "operator", "late", "required", "covariant", "external", "true", "false",
    "null", "int", "double", "num", "bool", "String", "List", "Map", "Set",
    "Future", "Stream",
]);

function TokeniseDart(Source: string): Token[] {
    return TokeniseWithPattern(Source, CurlyTriplePattern, DartKeywords);
}

const ScalaKeywords = new Set([
    "def", "val", "var", "class", "object", "trait", "extends", "with",
    "case", "match", "if", "else", "for", "while", "do", "yield", "return",
    "try", "catch", "finally", "throw", "import", "package", "new", "this",
    "super", "override", "abstract", "final", "sealed", "implicit", "lazy",
    "private", "protected", "public", "type", "given", "using", "enum",
    "then", "true", "false", "null", "Unit", "Int", "String", "Boolean",
    "Long", "Double", "Float", "List", "Map", "Option", "Some", "None",
]);

function TokeniseScala(Source: string): Token[] {
    return TokeniseWithPattern(Source, CurlyTriplePattern, ScalaKeywords);
}

const HlslKeywords = new Set([
    "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4",
    "int", "int2", "int3", "int4", "uint", "uint2", "uint3", "uint4", "bool",
    "half", "double", "void", "struct", "cbuffer", "tbuffer", "register",
    "return", "if", "else", "for", "while", "do", "switch", "case", "default",
    "break", "continue", "discard", "in", "out", "inout", "uniform", "static",
    "const", "sampler", "sampler2D", "SamplerState", "SamplerComparisonState",
    "Texture1D", "Texture2D", "Texture3D", "TextureCube", "Texture2DArray",
    "RWTexture2D", "Buffer", "StructuredBuffer", "RWStructuredBuffer",
    "ByteAddressBuffer", "technique", "pass", "true", "false", "matrix",
    "vector", "numthreads", "groupshared", "precise", "row_major", "column_major",
    "SV_Position", "SV_Target", "SV_TARGET", "SV_POSITION", "SV_VertexID",
    "SV_InstanceID", "SV_DispatchThreadID", "SV_GroupID", "SV_GroupThreadID",
    "POSITION", "NORMAL", "TEXCOORD", "COLOR", "TANGENT", "BINORMAL",
]);

function TokeniseHlsl(Source: string): Token[] {
    return TokeniseWithPattern(Source, CPattern, HlslKeywords);
}

const ZigKeywords = new Set([
    "const", "var", "fn", "pub", "struct", "enum", "union", "error", "if",
    "else", "while", "for", "switch", "return", "break", "continue", "defer",
    "errdefer", "try", "catch", "orelse", "unreachable", "comptime", "inline",
    "export", "extern", "async", "await", "suspend", "resume", "nosuspend",
    "test", "and", "or", "null", "undefined", "true", "false", "void", "bool",
    "type", "anytype", "anyerror", "anyopaque", "usize", "isize",
    "u8", "u16", "u32", "u64", "u128", "i8", "i16", "i32", "i64", "i128",
    "f16", "f32", "f64", "f128", "noreturn",
]);

const ZigPattern = /(?<comment>\/\/[^\n]*)|(?<string>\\\\[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<number>0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?)|(?<ident>@[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*)|(?<op>[+\-*/%&|^!~<>=?.,:;(){}[\]])/g;

function TokeniseZig(Source: string): Token[] {
    return TokeniseWithPattern(Source, ZigPattern, ZigKeywords);
}

const RubyKeywords = new Set([
    "def", "end", "class", "module", "if", "elsif", "else", "unless", "case",
    "when", "then", "while", "until", "for", "in", "do", "begin", "rescue",
    "ensure", "raise", "return", "yield", "break", "next", "redo", "retry",
    "and", "or", "not", "nil", "true", "false", "self", "super", "require",
    "require_relative", "include", "extend", "attr_accessor", "attr_reader",
    "attr_writer", "lambda", "proc", "puts", "print", "new", "loop",
]);

const RubyPattern = /(?<comment>#[^\n]*)|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|:[A-Za-z_][A-Za-z0-9_]*[?!]?)|(?<number>0x[0-9a-fA-F_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?)|(?<ident>@@?[A-Za-z_][A-Za-z0-9_]*|\$[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*[?!]?)|(?<op>[+\-*/%&|^~<>=!?.,:;(){}[\]])/g;

function TokeniseRuby(Source: string): Token[] {
    return TokeniseWithPattern(Source, RubyPattern, RubyKeywords);
}

const PhpKeywords = new Set([
    "function", "class", "interface", "trait", "extends", "implements",
    "abstract", "final", "public", "private", "protected", "static", "const",
    "var", "return", "if", "else", "elseif", "switch", "case", "default",
    "for", "foreach", "while", "do", "break", "continue", "as", "new",
    "clone", "this", "self", "parent", "try", "catch", "finally", "throw",
    "namespace", "use", "echo", "print", "isset", "unset", "empty", "list",
    "array", "null", "true", "false", "instanceof", "global", "require",
    "require_once", "include", "include_once", "fn", "match", "enum",
    "readonly", "yield",
]);

const PhpPattern = /(?<comment>\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<number>0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?)|(?<ident>\$[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*)|(?<op>[+\-*/%&|^!~<>=?.,:;@(){}[\]])/g;

function TokenisePhp(Source: string): Token[] {
    return TokeniseWithPattern(Source, PhpPattern, PhpKeywords);
}

const ElixirKeywords = new Set([
    "def", "defp", "defmodule", "defmacro", "defmacrop", "defstruct",
    "defprotocol", "defimpl", "defdelegate", "defguard", "do", "end", "fn",
    "if", "else", "unless", "case", "cond", "with", "for", "when", "and",
    "or", "not", "in", "nil", "true", "false", "raise", "try", "rescue",
    "catch", "after", "import", "alias", "require", "use", "receive",
    "quote", "unquote",
]);

const ElixirPattern = /(?<comment>#[^\n]*)|(?<string>"""[\s\S]*?"""|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|:[A-Za-z_][A-Za-z0-9_]*[?!]?|:"[^"]*")|(?<number>0x[0-9a-fA-F_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?)|(?<ident>@[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*[?!]?)|(?<op>[+\-*/%&|^~<>=!?.,:;(){}[\]])/g;

function TokeniseElixir(Source: string): Token[] {
    return TokeniseWithPattern(Source, ElixirPattern, ElixirKeywords);
}

const HaskellKeywords = new Set([
    "module", "where", "import", "data", "type", "newtype", "class",
    "instance", "deriving", "do", "let", "in", "case", "of", "if", "then",
    "else", "infix", "infixl", "infixr", "foreign", "default", "as",
    "hiding", "qualified",
]);

const HaskellPattern = /(?<comment>--[^\n]*|\{-[\s\S]*?-\})|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)')|(?<number>0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?)|(?<ident>[A-Za-z_][A-Za-z0-9_']*)|(?<op>[+\-*/%&|^~<>=!?.,:;(){}[\]@$])/g;

function TokeniseHaskell(Source: string): Token[] {
    return TokeniseWithPattern(Source, HaskellPattern, HaskellKeywords);
}

const GraphqlKeywords = new Set([
    "query", "mutation", "subscription", "type", "input", "enum", "interface",
    "union", "scalar", "schema", "fragment", "on", "implements", "directive",
    "extend", "true", "false", "null",
]);

const GraphqlPattern = /(?<comment>#[^\n]*)|(?<string>"""[\s\S]*?"""|"(?:[^"\\]|\\.)*")|(?<number>-?\d+\.?\d*(?:[eE][+-]?\d+)?)|(?<ident>\$[A-Za-z_][A-Za-z0-9_]*|@[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*)|(?<op>[(){}\[\]:=!|&.,])/g;

function TokeniseGraphql(Source: string): Token[] {
    return TokeniseWithPattern(Source, GraphqlPattern, GraphqlKeywords);
}

const DockerfileKeywords = new Set([
    "FROM", "RUN", "CMD", "LABEL", "MAINTAINER", "EXPOSE", "ENV", "ADD",
    "COPY", "ENTRYPOINT", "VOLUME", "USER", "WORKDIR", "ARG", "ONBUILD",
    "STOPSIGNAL", "HEALTHCHECK", "SHELL", "AS",
]);

const DockerfilePattern = /(?<comment>#[^\n]*)|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<number>\d+)|(?<ident>\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|[A-Za-z_][A-Za-z0-9_]*)|(?<op>[=:\\(){}[\]])/g;

function TokeniseDockerfile(Source: string): Token[] {
    return TokeniseWithPattern(Source, DockerfilePattern, DockerfileKeywords);
}

const MakefileKeywords = new Set([
    "ifeq", "ifneq", "ifdef", "ifndef", "else", "endif", "include",
    "sinclude", "define", "endef", "export", "unexport", "override",
    "vpath", ".PHONY", ".DEFAULT", ".PRECIOUS", ".SECONDARY", ".SUFFIXES",
    ".INTERMEDIATE", ".NOTPARALLEL",
]);

const MakefilePattern = /(?<comment>#[^\n]*)|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?<number>\d+)|(?<ident>\$[({][A-Za-z_][A-Za-z0-9_]*[)}]|\.[A-Z]+|[A-Za-z_][A-Za-z0-9_\-]*)|(?<op>[=:+?@(){}|<>])/g;

function TokeniseMakefile(Source: string): Token[] {
    return TokeniseWithPattern(Source, MakefilePattern, MakefileKeywords);
}

const NimKeywords = new Set([
    "addr", "and", "as", "asm", "bind", "block", "break", "case", "cast",
    "concept", "const", "continue", "converter", "defer", "discard",
    "distinct", "div", "do", "elif", "else", "end", "enum", "except",
    "export", "finally", "for", "from", "func", "if", "import", "in",
    "include", "interface", "is", "isnot", "iterator", "let", "macro",
    "method", "mixin", "mod", "nil", "not", "notin", "object", "of", "or",
    "out", "proc", "ptr", "raise", "ref", "return", "shl", "shr", "static",
    "template", "try", "tuple", "type", "using", "var", "when", "while",
    "xor", "yield", "echo", "result", "true", "false",
    "int", "float", "string", "bool", "char", "seq", "array", "uint",
    "int8", "int16", "int32", "int64", "float32", "float64", "byte", "void",
]);

const NimPattern = /(?<comment>#\[[\s\S]*?\]#|#[^\n]*)|(?<string>"""[\s\S]*?"""|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)')|(?<number>0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?(?:'?[iuf]\d+)?)|(?<ident>[A-Za-z_][A-Za-z0-9_]*)|(?<op>[+\-*/%&|^!~<>=?.,:;@(){}[\]])/g;

function TokeniseNim(Source: string): Token[] {
    return TokeniseWithPattern(Source, NimPattern, NimKeywords);
}

const VKeywords = new Set([
    "fn", "mut", "pub", "struct", "enum", "interface", "union", "type",
    "const", "module", "import", "if", "else", "match", "for", "in", "is",
    "as", "or", "return", "break", "continue", "go", "spawn", "defer",
    "unsafe", "none", "true", "false", "sizeof", "typeof", "isreftype",
    "__global", "shared", "lock", "rlock", "select", "assert", "asm",
    "static", "volatile", "atomic", "nil",
    "int", "i8", "i16", "i32", "i64", "u8", "u16", "u32", "u64", "f32",
    "f64", "bool", "string", "rune", "byte", "voidptr", "any", "map",
    "chan", "thread", "isize", "usize",
]);

const VPattern = /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(?<number>0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?)|(?<ident>@?[A-Za-z_][A-Za-z0-9_]*|\$[A-Za-z_][A-Za-z0-9_]*)|(?<op>[+\-*/%&|^!~<>=?.,:;(){}[\]])/g;

function TokeniseV(Source: string): Token[] {
    return TokeniseWithPattern(Source, VPattern, VKeywords);
}

const RedKeywords = new Set([
    "func", "function", "does", "has", "if", "either", "unless", "case",
    "switch", "while", "until", "loop", "repeat", "foreach", "forall",
    "forever", "break", "continue", "return", "exit", "print", "prin",
    "probe", "do", "make", "context", "object", "none", "true", "false",
    "on", "off", "yes", "no", "all", "any", "not", "and", "or", "xor",
    "reduce", "compose", "append", "insert", "remove", "find", "select",
]);

const RedPattern = /(?<comment>;[^\n]*)|(?<string>\{[^{}]*\}|"(?:[^"^]|\^.)*")|(?<number>[+\-]?\d+\.?\d*(?:[eE][+-]?\d+)?%?)|(?<ident>[A-Za-z_][A-Za-z0-9_!?*+\-]*:|\/[A-Za-z_][A-Za-z0-9_!?*+\-]*|[A-Za-z_][A-Za-z0-9_!?*+\-]*)|(?<op>[=<>+\-*/(){}\[\]])/g;

function TokeniseRed(Source: string): Token[] {
    const Raw = TokeniseWithPattern(Source, RedPattern, RedKeywords);
    return Raw.map(T => {
        if (T.Type === "Default" || T.Type === "Function" || T.Type === "Type") {
            if (/:$/.test(T.Value)) return { ...T, Type: "Type" as TokenType };
            if (/^\//.test(T.Value)) return { ...T, Type: "Function" as TokenType };
        }
        return T;
    });
}

const JKeywords = new Set([
    "if.", "do.", "else.", "elseif.", "end.", "for.", "while.", "whilst.",
    "select.", "case.", "fcase.", "try.", "catch.", "catchd.", "catcht.",
    "throw.", "return.", "assert.", "break.", "continue.", "goto.", "label.",
]);

const JPattern = /(?<comment>NB\.[^\n]*)|(?<string>'(?:[^']|'')*')|(?<number>_?\d+\.?\d*(?:[eE_]\d+)?)|(?<ident>[A-Za-z][A-Za-z0-9_]*[.:]?)|(?<op>[+\-*/%&|^!~<>=?,;@#$\[\](){}]|[.:])/g;

function TokeniseJ(Source: string): Token[] {
    return TokeniseWithPattern(Source, JPattern, JKeywords);
}

const AplKeywords = new Set([
    ":If", ":Else", ":ElseIf", ":EndIf", ":While", ":EndWhile", ":Repeat",
    ":Until", ":For", ":EndFor", ":Select", ":Case", ":CaseList",
    ":EndSelect", ":Trap", ":EndTrap", ":Return", ":Continue", ":Leave",
    ":GoTo", ":Namespace", ":EndNamespace", ":Class", ":EndClass", ":With",
    ":EndWith", ":Hold", ":EndHold", ":Section", ":EndSection",
]);

const AplPattern = /(?<comment>⍝[^\n]*)|(?<string>'(?:[^']|'')*')|(?<number>¯?\d+\.?\d*(?:[eE]¯?\d+)?)|(?<ident>:[A-Za-z]+|⎕[A-Za-z]*|[A-Za-z_∆⍙][A-Za-z0-9_∆⍙]*)|(?<op>[←→+\-×÷⌈⌊∣⍳⍸∊⍷⌽⊖⍉↑↓⊂⊃⌷⍋⍒⍱⍲∧∨~≠=≤≥<>≡≢⊢⊣⍺⍵¨⍨⍣⍤⍥⍞⍠⍢∇⋄∘⍟⌹⊥⊤⍕⍎!?*|.,;:(){}\[\]/\\])/g;

function TokeniseApl(Source: string): Token[] {
    return TokeniseWithPattern(Source, AplPattern, AplKeywords);
}

const FactorKeywords = new Set([
    "USING:", "USE:", "IN:", "GENERIC:", "GENERIC#", "M:", "TUPLE:",
    "SYMBOL:", "SYMBOLS:", "CONSTANT:", "PREDICATE:", "MIXIN:", "INSTANCE:",
    "SLOT:", "HOOK:", "MACRO:", "MEMO:", "DEFER:", "FORGET:", "PRIMITIVE:",
    "C-TYPE:", "<PRIVATE", "PRIVATE>", ":", ";",
    "if", "when", "unless", "cond", "case", "while", "until", "each", "map",
    "filter", "reduce", "dup", "drop", "swap", "over", "rot", "nip", "tuck",
    "pick", "2dup", "call", "dip", "keep", "bi", "tri", "t", "f",
]);

const FactorPattern = /(?<comment>(?:#!|!)(?=\s|$)[^\n]*)|(?<string>"(?:[^"\\]|\\.)*")|(?<number>[+\-]?\d+(?:\.\d+)?(?=\s|$))|(?<op>[(){}\[\]])|(?<ident>[^\s(){}\[\]]+)/g;

function TokeniseFactor(Source: string): Token[] {
    return TokeniseWithPattern(Source, FactorPattern, FactorKeywords);
}

const IdrisKeywords = new Set([
    "module", "where", "import", "data", "record", "interface",
    "implementation", "do", "let", "in", "case", "of", "if", "then", "else",
    "with", "mutual", "namespace", "using", "parameters", "total", "partial",
    "covering", "public", "export", "private", "infixl", "infixr", "infix",
    "prefix", "auto", "impossible", "rewrite", "proof", "Type", "claim",
    "provide", "syntax", "pattern", "term", "forall",
]);

const IdrisPattern = /(?<comment>--[^\n]*|\{-[\s\S]*?-\})|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)')|(?<number>0x[0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?)|(?<ident>[A-Za-z_][A-Za-z0-9_']*)|(?<op>[+\-*/%&|^~<>=!?.,:;(){}[\]@$])/g;

function TokeniseIdris(Source: string): Token[] {
    return TokeniseWithPattern(Source, IdrisPattern, IdrisKeywords);
}

const OcamlKeywords = new Set([
    "let", "rec", "in", "fun", "function", "match", "with", "type", "module",
    "struct", "sig", "end", "open", "include", "if", "then", "else", "begin",
    "val", "and", "or", "not", "mutable", "ref", "of", "when", "as", "try",
    "raise", "exception", "class", "object", "method", "inherit", "new",
    "lazy", "assert", "while", "do", "done", "for", "to", "downto", "true",
    "false", "unit", "int", "float", "string", "bool", "list", "array",
    "option", "Some", "None", "external", "functor", "constraint", "nonrec",
]);

const OcamlPattern = /(?<comment>\(\*[\s\S]*?\*\))|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)')|(?<number>0x[0-9a-fA-F_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?)|(?<ident>[A-Za-z_][A-Za-z0-9_']*)|(?<op>[+\-*/%&|^~<>=!?.,:;@(){}[\]])/g;

function TokeniseOcaml(Source: string): Token[] {
    return TokeniseWithPattern(Source, OcamlPattern, OcamlKeywords);
}

const FsharpKeywords = new Set([
    "let", "rec", "in", "fun", "function", "match", "with", "type", "module",
    "namespace", "open", "if", "then", "else", "elif", "begin", "end", "val",
    "member", "and", "or", "not", "mutable", "ref", "of", "when", "as", "try",
    "raise", "exception", "class", "struct", "interface", "inherit", "new",
    "lazy", "assert", "while", "do", "done", "for", "to", "downto", "true",
    "false", "yield", "return", "use", "async", "abstract", "override",
    "static", "internal", "public", "private", "inline", "int", "float",
    "string", "bool", "list", "array", "option", "Some", "None", "unit",
    "seq", "default", "delegate", "downcast", "upcast", "rec", "extern",
]);

const FsharpPattern = /(?<comment>\/\/[^\n]*|\(\*[\s\S]*?\*\))|(?<string>"""[\s\S]*?"""|@"(?:[^"]|"")*"|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)')|(?<number>0x[0-9a-fA-F_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?[uLfm]*)|(?<ident>[A-Za-z_][A-Za-z0-9_']*)|(?<op>[+\-*/%&|^~<>=!?.,:;@(){}[\]])/g;

function TokeniseFsharp(Source: string): Token[] {
    return TokeniseWithPattern(Source, FsharpPattern, FsharpKeywords);
}

const ErlangKeywords = new Set([
    "after", "begin", "case", "catch", "cond", "end", "fun", "if", "let",
    "of", "receive", "try", "when", "and", "andalso", "or", "orelse", "not",
    "band", "bor", "bxor", "bnot", "bsl", "bsr", "div", "rem", "xor",
    "module", "export", "import", "define", "include", "include_lib",
    "record", "behaviour", "behavior", "spec", "type", "callback", "ifdef",
    "ifndef", "endif", "undef", "compile", "vsn",
]);

const ErlangPattern = /(?<comment>%[^\n]*)|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\$\\?.)|(?<number>\d+#[0-9a-zA-Z]+|\d+\.?\d*(?:[eE][+-]?\d+)?)|(?<ident>[A-Za-z_][A-Za-z0-9_@]*)|(?<op>[+\-*/<>=!?.,:;(){}[\]|])/g;

function TokeniseErlang(Source: string): Token[] {
    return TokeniseWithPattern(Source, ErlangPattern, ErlangKeywords);
}

const LispPattern = /(?<comment>;[^\n]*|#\|[\s\S]*?\|#)|(?<string>"(?:[^"\\]|\\.)*")|(?<number>[+\-]?\d+\.?\d*(?:[eE][+-]?\d+)?)|(?<ident>#[tf]|#\\.|[A-Za-z_+\-*/<>=!?][A-Za-z0-9_+\-*/<>=!?.]*)|(?<op>[(){}\[\]'`,@])/g;

const RacketKeywords = new Set([
    "define", "lambda", "λ", "let", "let*", "letrec", "let-values", "if",
    "cond", "case", "when", "unless", "begin", "set!", "quote", "quasiquote",
    "unquote", "and", "or", "not", "do", "else", "define-syntax",
    "syntax-rules", "define-struct", "struct", "require", "provide", "module",
    "for", "for/list", "for/fold", "match", "define-values", "parameterize",
    "values", "call/cc", "error", "displayln", "printf", "#t", "#f", "null",
    "cons", "car", "cdr", "list", "map", "filter", "foldl", "foldr",
    "true", "false",
]);

function TokeniseRacket(Source: string): Token[] {
    return TokeniseWithPattern(Source, LispPattern, RacketKeywords);
}

const SchemeKeywords = new Set([
    "define", "lambda", "let", "let*", "letrec", "if", "cond", "case", "when",
    "unless", "begin", "set!", "quote", "quasiquote", "unquote", "and", "or",
    "not", "do", "else", "define-syntax", "syntax-rules",
    "call-with-current-continuation", "call/cc", "dynamic-wind", "delay",
    "force", "values", "error", "display", "newline", "write", "list",
    "cons", "car", "cdr", "map", "for-each", "apply", "#t", "#f",
]);

function TokeniseScheme(Source: string): Token[] {
    return TokeniseWithPattern(Source, LispPattern, SchemeKeywords);
}

const LispKeywords = new Set([
    "defun", "defvar", "defparameter", "defconstant", "defmacro", "defclass",
    "defmethod", "defgeneric", "defstruct", "defpackage", "lambda", "let",
    "let*", "flet", "labels", "if", "cond", "case", "when", "unless", "progn",
    "prog1", "setf", "setq", "loop", "do", "dolist", "dotimes", "return",
    "return-from", "block", "tagbody", "go", "quote", "function", "and", "or",
    "not", "nil", "t", "car", "cdr", "cons", "list", "mapcar", "format",
    "in-package", "declaim", "declare", "the", "values", "multiple-value-bind",
    "handler-case", "funcall", "apply", "lambda",
]);

function TokeniseLisp(Source: string): Token[] {
    return TokeniseWithPattern(Source, LispPattern, LispKeywords);
}

const FortranKeywords = new Set([
    "program", "end", "subroutine", "function", "module", "use", "implicit",
    "none", "integer", "real", "double", "precision", "complex", "character",
    "logical", "dimension", "parameter", "allocatable", "pointer", "target",
    "intent", "in", "out", "inout", "if", "then", "else", "elseif", "endif",
    "do", "while", "enddo", "select", "case", "default", "where", "forall",
    "call", "return", "stop", "continue", "contains", "interface", "type",
    "class", "public", "private", "save", "common", "data", "goto", "print",
    "write", "read", "open", "close", "format", "allocate", "deallocate",
    "nullify", "present", "true", "false", "result", "recursive", "pure",
    "elemental", "optional", "only", "kind", "len",
]);

const FortranPattern = /(?<comment>![^\n]*)|(?<string>"(?:[^"]|"")*"|'(?:[^']|'')*')|(?<number>\d+\.?\d*(?:[dDeE][+-]?\d+)?(?:_\w+)?)|(?<ident>[A-Za-z][A-Za-z0-9_]*)|(?<op>[+\-*/%<>=.,:;()[\]])/g;

function TokeniseFortran(Source: string): Token[] {
    const Raw = TokeniseWithPattern(Source, FortranPattern, new Set<string>());
    return Raw.map(T => {
        if (T.Type === "Default" || T.Type === "Function" || T.Type === "Type") {
            if (FortranKeywords.has(T.Value.toLowerCase())) return { ...T, Type: "Keyword" as TokenType };
        }
        return T;
    });
}

const CobolKeywords = new Set([
    "identification", "division", "program-id", "environment",
    "configuration", "section", "input-output", "file-control", "data",
    "working-storage", "linkage", "procedure", "pic", "picture", "value",
    "move", "to", "add", "subtract", "multiply", "divide", "compute",
    "display", "accept", "perform", "until", "varying", "times", "if",
    "else", "end-if", "evaluate", "when", "end-evaluate", "go", "stop",
    "run", "call", "using", "open", "close", "read", "write", "fd", "select",
    "assign", "occurs", "redefines", "copy", "goback", "exit", "initialize",
    "string", "unstring", "inspect", "set", "search", "sort", "merge", "by",
    "giving", "from", "into", "of", "is", "equal", "greater", "less", "than",
    "not", "and", "or", "zero", "spaces", "comp", "comp-3", "binary",
    "filler", "with", "no", "advancing", "at", "end",
]);

const CobolPattern = /(?<comment>\*>[^\n]*)|(?<string>"(?:[^"]|"")*"|'(?:[^']|'')*')|(?<number>[+\-]?\d+\.?\d*)|(?<ident>[A-Za-z][A-Za-z0-9\-]*)|(?<op>[.,;()=<>+\-*/])/g;

function TokeniseCobol(Source: string): Token[] {
    const Raw = TokeniseWithPattern(Source, CobolPattern, new Set<string>());
    return Raw.map(T => {
        if (T.Type === "Default" || T.Type === "Function" || T.Type === "Type") {
            if (CobolKeywords.has(T.Value.toLowerCase())) return { ...T, Type: "Keyword" as TokenType };
        }
        return T;
    });
}

const AdaKeywords = new Set([
    "procedure", "function", "package", "body", "is", "begin", "end",
    "declare", "if", "then", "else", "elsif", "case", "when", "loop",
    "while", "for", "in", "out", "exit", "return", "with", "use", "type",
    "subtype", "record", "array", "of", "range", "new", "access", "constant",
    "null", "others", "and", "or", "not", "xor", "mod", "rem", "abs",
    "raise", "exception", "task", "entry", "accept", "select", "delay",
    "abort", "goto", "pragma", "generic", "private", "limited", "renames",
    "separate", "true", "false", "all", "do", "terminate", "requeue",
    "protected", "overriding", "aliased", "synchronized", "interface",
    "tagged", "abstract", "reverse", "delta", "digits", "at",
]);

const AdaPattern = /(?<comment>--[^\n]*)|(?<string>"(?:[^"]|"")*"|'(?:[^'\\]|\\.)')|(?<number>\d+#[0-9a-fA-F_]+#|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?)|(?<ident>[A-Za-z][A-Za-z0-9_]*)|(?<op>[+\-*/<>=.,:;()|&])/g;

function TokeniseAda(Source: string): Token[] {
    const Raw = TokeniseWithPattern(Source, AdaPattern, new Set<string>());
    return Raw.map(T => {
        if (T.Type === "Default" || T.Type === "Function" || T.Type === "Type") {
            if (AdaKeywords.has(T.Value.toLowerCase())) return { ...T, Type: "Keyword" as TokenType };
        }
        return T;
    });
}

const CrystalKeywords = new Set([
    "def", "end", "class", "module", "struct", "enum", "if", "elsif", "else",
    "unless", "case", "when", "while", "until", "for", "in", "do", "begin",
    "rescue", "ensure", "raise", "return", "yield", "break", "next",
    "require", "include", "extend", "property", "getter", "setter", "true",
    "false", "nil", "self", "super", "abstract", "private", "protected",
    "macro", "lib", "fun", "type", "alias", "of", "as", "uninitialized",
    "with", "out", "pointerof", "sizeof", "typeof", "Int32", "Int64",
    "String", "Bool", "Float64", "Array", "Hash", "Nil", "Char", "Symbol",
]);

function TokeniseCrystal(Source: string): Token[] {
    return TokeniseWithPattern(Source, RubyPattern, CrystalKeywords);
}

const JuliaKeywords = new Set([
    "function", "end", "if", "elseif", "else", "while", "for", "in", "do",
    "begin", "let", "return", "break", "continue", "struct", "mutable",
    "abstract", "primitive", "type", "module", "baremodule", "using",
    "import", "export", "const", "global", "local", "macro", "quote", "try",
    "catch", "finally", "throw", "where", "true", "false", "nothing",
    "missing", "and", "or", "isa", "new", "Int", "Int64", "Float64", "String",
    "Bool", "Vector", "Matrix", "Array", "Dict", "Symbol", "Char",
]);

const JuliaPattern = /(?<comment>#=[\s\S]*?=#|#[^\n]*)|(?<string>"""[\s\S]*?"""|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)')|(?<number>0x[0-9a-fA-F_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?(?:im)?)|(?<ident>@[A-Za-z_][A-Za-z0-9_!]*|[A-Za-z_][A-Za-z0-9_!]*)|(?<op>[+\-*/%&|^~<>=!?.,:;(){}[\]])/g;

function TokeniseJulia(Source: string): Token[] {
    return TokeniseWithPattern(Source, JuliaPattern, JuliaKeywords);
}

// --- Easter-egg esolangs: small, mostly-dead, but fun to see lit up. ---

function TokeniseBrainfuck(Source: string): Token[] {
    const Result: Token[] = [];
    const Pattern = /(?<loop>[\[\]])|(?<io>[.,])|(?<cmd>[+\-<>])|(?<other>[^+\-<>.,\[\]]+)/g;
    let M: RegExpExecArray | null;
    while ((M = Pattern.exec(Source)) !== null) {
        const G = M.groups ?? {};
        if (G.loop !== undefined)      Result.push({ Type: "Keyword",  Value: M[0] });
        else if (G.io !== undefined)   Result.push({ Type: "Function", Value: M[0] });
        else if (G.cmd !== undefined)  Result.push({ Type: "Operator", Value: M[0] });
        else                           Result.push({ Type: "Comment",  Value: M[0] });
    }
    return Result;
}

function TokeniseWhitespace(Source: string): Token[] {
    const Result: Token[] = [];
    const Pattern = /(?<code>[ \t]+)|(?<nl>\n)|(?<comment>[^ \t\n]+)/g;
    let M: RegExpExecArray | null;
    while ((M = Pattern.exec(Source)) !== null) {
        const G = M.groups ?? {};
        if (G.code !== undefined)     Result.push({ Type: "Operator", Value: M[0] });
        else if (G.nl !== undefined)  Result.push({ Type: "Keyword",  Value: M[0] });
        else                          Result.push({ Type: "Comment",  Value: M[0] });
    }
    return Result;
}

function TokeniseBefunge(Source: string): Token[] {
    const Result: Token[] = [];
    const Pattern = /(?<string>"[^"]*")|(?<number>\d)|(?<flow>[><^v?@_|#])|(?<op>[+\-*/%!`:\\$.,&~gp{}])|(?<other>[^"0-9><\^v?@_|#+\-*/%!`:\\$.,&~gp{}]+)/g;
    let M: RegExpExecArray | null;
    while ((M = Pattern.exec(Source)) !== null) {
        const G = M.groups ?? {};
        if (G.string !== undefined)      Result.push({ Type: "String",   Value: M[0] });
        else if (G.number !== undefined) Result.push({ Type: "Number",   Value: M[0] });
        else if (G.flow !== undefined)   Result.push({ Type: "Keyword",  Value: M[0] });
        else if (G.op !== undefined)     Result.push({ Type: "Operator", Value: M[0] });
        else                             Result.push({ Type: "Default",  Value: M[0] });
    }
    return Result;
}

const LolcodeKeywords = new Set([
    "HAI", "KTHXBYE", "VISIBLE", "GIMMEH", "ITZ", "HAS", "A", "I", "R", "AN",
    "SUM", "OF", "DIFF", "PRODUKT", "QUOSHUNT", "MOD", "BIGGR", "SMALLR",
    "BOTH", "EITHER", "WON", "NOT", "SAEM", "DIFFRINT", "MAEK", "IS", "NOW",
    "O", "RLY", "YA", "NO", "WAI", "MEBBE", "OIC", "WTF", "OMG", "OMGWTF",
    "IM", "IN", "YR", "OUTTA", "UPPIN", "NERFIN", "TIL", "WILE", "HOW", "IZ",
    "FOUND", "MKAY", "GTFO", "NOOB", "WIN", "FAIL", "TROOF", "NUMBR",
    "NUMBAR", "YARN", "BUKKIT", "SMOOSH", "U", "SAY", "SO", "IF", "ALL", "ANY",
]);

const LolcodePattern = /(?<comment>OBTW[\s\S]*?TLDR|BTW\b[^\n]*)|(?<string>"[^"]*")|(?<number>-?\d+\.?\d*)|(?<ident>[A-Za-z_][A-Za-z0-9_]*)|(?<op>[!?,])/g;

function TokeniseLolcode(Source: string): Token[] {
    return TokeniseWithPattern(Source, LolcodePattern, LolcodeKeywords);
}

const ChefVerbs = new Set([
    "take", "put", "fold", "add", "remove", "combine", "divide", "liquefy",
    "liquify", "stir", "mix", "clean", "pour", "refrigerate", "serve",
    "serves", "ingredients", "method", "recipe", "until", "heat", "cook",
    "bake", "set", "aside", "from", "into", "the", "to", "with", "for",
]);

const ChefMeasures = new Set([
    "g", "kg", "pinch", "pinches", "ml", "l", "dash", "dashes", "cup",
    "cups", "teaspoon", "teaspoons", "tablespoon", "tablespoons", "heaped",
    "level", "minutes", "hours",
]);

const ChefPattern = /(?<number>\d+)|(?<ident>[A-Za-z][A-Za-z'\-]*)|(?<op>[.,;:()])/g;

function TokeniseChef(Source: string): Token[] {
    const Raw = TokeniseWithPattern(Source, ChefPattern, new Set<string>());
    return Raw.map(T => {
        if (T.Type === "Default" || T.Type === "Function" || T.Type === "Type") {
            const Low = T.Value.toLowerCase();
            if (ChefVerbs.has(Low))    return { ...T, Type: "Keyword" as TokenType };
            if (ChefMeasures.has(Low)) return { ...T, Type: "Type" as TokenType };
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
        case "kotlin":     return TokeniseKotlin(Source);
        case "swift":      return TokeniseSwift(Source);
        case "dart":       return TokeniseDart(Source);
        case "scala":      return TokeniseScala(Source);
        case "hlsl":       return TokeniseHlsl(Source);
        case "zig":        return TokeniseZig(Source);
        case "ruby":       return TokeniseRuby(Source);
        case "php":        return TokenisePhp(Source);
        case "elixir":     return TokeniseElixir(Source);
        case "haskell":    return TokeniseHaskell(Source);
        case "graphql":    return TokeniseGraphql(Source);
        case "dockerfile": return TokeniseDockerfile(Source);
        case "makefile":   return TokeniseMakefile(Source);
        case "nim":        return TokeniseNim(Source);
        case "vlang":      return TokeniseV(Source);
        case "red":        return TokeniseRed(Source);
        case "j":          return TokeniseJ(Source);
        case "apl":        return TokeniseApl(Source);
        case "factor":     return TokeniseFactor(Source);
        case "idris":      return TokeniseIdris(Source);
        case "ocaml":      return TokeniseOcaml(Source);
        case "fsharp":     return TokeniseFsharp(Source);
        case "erlang":     return TokeniseErlang(Source);
        case "racket":     return TokeniseRacket(Source);
        case "scheme":     return TokeniseScheme(Source);
        case "lisp":       return TokeniseLisp(Source);
        case "fortran":    return TokeniseFortran(Source);
        case "cobol":      return TokeniseCobol(Source);
        case "ada":        return TokeniseAda(Source);
        case "crystal":    return TokeniseCrystal(Source);
        case "julia":      return TokeniseJulia(Source);
        case "brainfuck":  return TokeniseBrainfuck(Source);
        case "whitespace": return TokeniseWhitespace(Source);
        case "lolcode":    return TokeniseLolcode(Source);
        case "befunge":    return TokeniseBefunge(Source);
        case "chef":       return TokeniseChef(Source);
        default:           return TokenisePlain(Source);
    }
}
