import type { Token } from "./Tokenizer";

export type CompletionKind = "keyword" | "snippet" | "function" | "variable" | "type";

export interface CompletionItem {
    Label:     string;
    Insert:    string;
    Kind:      CompletionKind;
    Detail?:   string;
    CursorAt?: number;
}

export interface SignatureHelp {
    Label: string;
    Parameters: string[];
    ActiveParameter: number;
}

export function GetWordContext(Text: string, Offset: number): { Start: number; Prefix: string } {
    let S = Offset;
    while (S > 0 && /[A-Za-z0-9_$]/.test(Text[S - 1])) S--;
    return { Start: S, Prefix: Text.slice(S, Offset) };
}

function GetMemberContext(Text: string, Offset: number): { Target: string; Prefix: string } | null {
    const { Start, Prefix } = GetWordContext(Text, Offset);
    const Before = Text.slice(0, Start);
    const Match = /([A-Za-z_$][A-Za-z0-9_$]*)(::|[.:])$/.exec(Before);
    if (!Match) return null;
    return { Target: Match[1], Prefix };
}

type CI = CompletionItem;
const K = (L: string):                              CI => ({ Label: L, Insert: L, Kind: "keyword" });
const F = (L: string, I: string, D: string, C?: number): CI => ({ Label: L, Insert: I, Kind: "function", Detail: D, CursorAt: C });
const S = (L: string, I: string, D: string, C?: number): CI => ({ Label: L, Insert: I, Kind: "snippet",  Detail: D, CursorAt: C });
const V = (L: string, D?: string):                  CI => ({ Label: L, Insert: L, Kind: "variable", Detail: D });
const T = (L: string, D?: string):                  CI => ({ Label: L, Insert: L, Kind: "type",     Detail: D });

const Luau: CI[] = [
    K("local"), K("function"), K("end"), K("if"), K("then"), K("else"), K("elseif"),
    K("return"), K("for"), K("while"), K("do"), K("repeat"), K("until"), K("and"),
    K("or"), K("not"), K("nil"), K("true"), K("false"), K("in"), K("break"),
    K("continue"), K("self"), K("require"), K("type"), K("typeof"), K("export"),
    F("print",          "print()",          "(…)",              6),
    F("warn",           "warn()",           "(…)",              5),
    F("error",          "error()",          "(msg) → !",        6),
    F("assert",         "assert()",         "(v, msg)",         7),
    F("tostring",       "tostring()",       "(v) → string",     9),
    F("tonumber",       "tonumber()",       "(v) → number?",    9),
    F("pairs",          "pairs()",          "(t) → iterator",   6),
    F("ipairs",         "ipairs()",         "(t) → iterator",   7),
    F("pcall",          "pcall()",          "(f, …) → ok, …",   6),
    F("xpcall",         "xpcall()",         "(f, h, …)",        7),
    F("select",         "select()",         "(i, …) → …",       7),
    F("rawget",         "rawget()",         "(t, k) → v",       7),
    F("rawset",         "rawset()",         "(t, k, v)",        7),
    F("unpack",         "unpack()",         "(t) → …",          7),
    F("setmetatable",   "setmetatable()",   "(t, mt) → t",     13),
    F("getmetatable",   "getmetatable()",   "(t) → mt?",       13),
    V("coroutine",  "lib"), V("string", "lib"), V("table", "lib"),
    V("math",       "lib"), V("task",   "lib"),
    V("game",       "DataModel"), V("workspace", "Workspace"),
    V("script",     "LuaSourceContainer"),  V("Enum", "namespace"),
    T("Instance"), T("Vector3"), T("Vector2"), T("CFrame"),
    T("Color3"),   T("UDim2"),   T("TweenInfo"),
    S("function", "local function ()\n    \nend",         "local function…end",     16),
    S("if",       "if  then\n    \nend",                  "if…then…end",             3),
    S("ifelse",   "if  then\n    \nelse\n    \nend",      "if…then…else…end",        3),
    S("for",      "for i = 1,  do\n    \nend",            "for i=1,n do…end",       11),
    S("fori",     "for i, v in ipairs() do\n    \nend",   "for…ipairs",             20),
    S("forp",     "for k, v in pairs() do\n    \nend",    "for…pairs",              19),
    S("while",    "while  do\n    \nend",                  "while…do…end",           6),
    S("repeat",   "repeat\n    \nuntil ",                  "repeat…until",          18),
];

const Ts: CI[] = [
    K("const"), K("let"), K("var"), K("function"), K("class"), K("interface"),
    K("type"), K("import"), K("export"), K("from"), K("return"), K("if"), K("else"),
    K("for"), K("while"), K("do"), K("switch"), K("case"), K("break"), K("continue"),
    K("new"), K("typeof"), K("instanceof"), K("in"), K("of"), K("async"), K("await"),
    K("try"), K("catch"), K("finally"), K("throw"), K("true"), K("false"), K("null"),
    K("undefined"), K("extends"), K("implements"), K("readonly"), K("private"),
    K("public"), K("protected"), K("static"), K("void"), K("never"), K("any"),
    K("unknown"), K("enum"), K("namespace"), K("as"), K("this"), K("super"),
    K("default"), K("abstract"), K("declare"), K("keyof"), K("satisfies"),
    F("useState",        "useState()",                        "React hook",      9),
    S("useEffect",       "useEffect(() => {\n    \n}, [])",   "React hook",     22),
    S("useCallback",     "useCallback(() => {\n    \n}, [])", "React hook",     24),
    S("useMemo",         "useMemo(() => , [])",               "React hook",     14),
    F("useRef",          "useRef()",                          "React hook",      7),
    F("useContext",      "useContext()",                      "React hook",     11),
    F("useReducer",      "useReducer()",                      "React hook",     11),
    S("useLayoutEffect", "useLayoutEffect(() => {\n    \n}, [])", "React hook", 28),
    V("console",     "object"),
    S("function",  "function () {\n    \n}",               "function…{}",                                    10),
    S("const",     "const  = ",                             "const x =",                                      6),
    S("interface", "interface  {\n    \n}",                 "interface {}",                                  10),
    S("class",     "class  {\n    \n}",                     "class {}",                                       6),
    S("if",        "if () {\n    \n}",                      "if (…) {}",                                      4),
    S("ifelse",    "if () {\n    \n} else {\n    \n}",      "if…else",                                        4),
    S("for",       "for (let i = 0; i < ; i++) {\n    \n}", "for (let i…)",                                  20),
    S("forof",     "for (const  of ) {\n    \n}",           "for…of",                                        11),
    S("forin",     "for (const  in ) {\n    \n}",           "for…in",                                        11),
    S("while",     "while () {\n    \n}",                   "while (…) {}",                                   7),
    S("switch",    "switch () {\n    case :\n        break;\n    default:\n        break;\n}", "switch…case", 8),
    S("trycatch",  "try {\n    \n} catch (e) {\n    \n}",   "try…catch",                                     10),
    S("async",     "async () => {\n    \n}",                "async arrow",                                    7),
    S("arrow",     "() => ",                                "arrow fn",                                       1),
    S("type",      "type  = ",                               "type alias",                                    5),
];

const Rust: CI[] = [
    K("let"), K("mut"), K("fn"), K("pub"), K("use"), K("mod"), K("struct"), K("enum"),
    K("impl"), K("trait"), K("type"), K("where"), K("if"), K("else"), K("match"),
    K("for"), K("while"), K("loop"), K("return"), K("break"), K("continue"),
    K("true"), K("false"), K("self"), K("Self"), K("super"), K("crate"), K("const"),
    K("static"), K("ref"), K("move"), K("async"), K("await"), K("unsafe"),
    K("extern"), K("dyn"), K("in"), K("as"),
    { Label: "Option",  Insert: "Option<>",   Kind: "type",     Detail: "enum",   CursorAt: 7 },
    { Label: "Result",  Insert: "Result<, >", Kind: "type",     Detail: "enum",   CursorAt: 7 },
    { Label: "Vec",     Insert: "Vec<>",      Kind: "type",     Detail: "struct", CursorAt: 4 },
    { Label: "Box",     Insert: "Box<>",      Kind: "type",     Detail: "struct", CursorAt: 4 },
    T("String",  "struct"), T("str", "primitive"),
    F("Some",    "Some()",    "Option::Some",  5),
    F("Ok",      "Ok()",      "Result::Ok",    3),
    F("Err",     "Err()",     "Result::Err",   4),
    V("None",    "Option::None"),
    F("println", "println!()", "macro",         9),
    F("eprintln","eprintln!()","macro",        10),
    F("format",  "format!()", "macro",          8),
    F("vec",     "vec![]",    "macro",          5),
    S("fn",     "fn () {\n    \n}",          "fn…{}",      3),
    S("impl",   "impl  {\n    \n}",          "impl {}",    5),
    S("struct", "struct  {\n    \n}",        "struct {}",  7),
    S("enum",   "enum  {\n    ,\n}",         "enum {}",    5),
    S("trait",  "trait  {\n    \n}",         "trait {}",   6),
    S("match",  "match  {\n    _ => {}\n}",  "match {}",   6),
    S("if",     "if  {\n    \n}",            "if {}",      3),
    S("iflet",  "if let  = {\n    \n}",      "if let",     7),
    S("while",  "while  {\n    \n}",         "while {}",   6),
    S("for",    "for  in  {\n    \n}",       "for…in",     4),
    S("loop",   "loop {\n    \n}",           "loop {}",   10),
];

const Python: CI[] = [
    K("def"), K("class"), K("if"), K("elif"), K("else"), K("for"), K("while"),
    K("try"), K("except"), K("finally"), K("with"), K("import"), K("from"),
    K("return"), K("yield"), K("break"), K("continue"), K("pass"), K("and"),
    K("or"), K("not"), K("in"), K("is"), K("lambda"), K("del"), K("global"),
    K("nonlocal"), K("raise"), K("assert"), K("True"), K("False"), K("None"),
    K("async"), K("await"), K("as"), K("match"), K("case"),
    F("print",      "print()",       "builtin",  6),
    F("len",        "len()",         "builtin",  4),
    F("range",      "range()",       "builtin",  6),
    F("enumerate",  "enumerate()",   "builtin", 10),
    F("zip",        "zip()",         "builtin",  4),
    F("map",        "map()",         "builtin",  4),
    F("filter",     "filter()",      "builtin",  7),
    F("sorted",     "sorted()",      "builtin",  7),
    F("isinstance", "isinstance()",  "builtin", 11),
    F("type",       "type()",        "builtin",  5),
    F("super",      "super()",       "builtin",  6),
    T("list"), T("dict"), T("set"), T("tuple"), T("str"), T("int"), T("float"), T("bool"),
    V("self",   "instance"),
    S("def",    "def ():\n    ",                               "def…:",        4),
    S("class",  "class :\n    ",                               "class…:",      6),
    S("if",     "if :\n    ",                                  "if…:",         3),
    S("elif",   "elif :\n    ",                                "elif…:",       5),
    S("for",    "for  in :\n    ",                             "for…in:",      4),
    S("while",  "while :\n    ",                               "while…:",      6),
    S("with",   "with  as :\n    ",                            "with…as:",     5),
    S("try",    "try:\n    \nexcept Exception as e:\n    ",    "try…except:",  9),
    S("lambda", "lambda : ",                                    "lambda…:",    7),
    S("listcomp","[ for  in ]",                                "list comp",    2),
];

const LangMap: Record<string, CI[]> = {
    luau:       Luau,
    typescript: Ts,
    javascript: Ts,
    rust:       Rust,
    python:     Python,
};

const MemberMap: Record<string, Record<string, CI[]>> = {
    luau: {
        game: [
            F("GetService", "GetService()", "(className) -> Instance", 11),
            F("FindFirstChild", "FindFirstChild()", "(name) -> Instance?", 15),
            F("WaitForChild", "WaitForChild()", "(name) -> Instance", 13),
            V("Workspace", "Service"),
            V("Players", "Service"),
            V("ReplicatedStorage", "Service"),
            V("ServerScriptService", "Service"),
            V("RunService", "Service"),
        ],
        workspace: [
            F("FindFirstChild", "FindFirstChild()", "(name) -> Instance?", 15),
            F("WaitForChild", "WaitForChild()", "(name) -> Instance", 13),
            F("GetChildren", "GetChildren()", "() -> {Instance}", 12),
            F("GetDescendants", "GetDescendants()", "() -> {Instance}", 16),
            V("CurrentCamera", "Camera"),
            V("Terrain", "Terrain"),
        ],
        Instance: [
            F("new", "new()", "(className) -> Instance", 4),
            F("fromExisting", "fromExisting()", "(instance)", 13),
        ],
        Vector3: [
            F("new", "new()", "(x, y, z) -> Vector3", 4),
            F("zero", "zero", "Vector3"),
            F("one", "one", "Vector3"),
            F("xAxis", "xAxis", "Vector3"),
            F("yAxis", "yAxis", "Vector3"),
            F("zAxis", "zAxis", "Vector3"),
        ],
        string: [
            F("format", "format()", "(format, ...)", 7),
            F("split", "split()", "(s, sep)", 6),
            F("lower", "lower()", "(s)", 6),
            F("upper", "upper()", "(s)", 6),
            F("sub", "sub()", "(s, i, j?)", 4),
            F("find", "find()", "(s, pattern)", 5),
        ],
        table: [
            F("insert", "insert()", "(t, value)", 7),
            F("remove", "remove()", "(t, index?)", 7),
            F("find", "find()", "(t, value)", 5),
            F("sort", "sort()", "(t, comp?)", 5),
            F("clone", "clone()", "(t)", 6),
            F("clear", "clear()", "(t)", 6),
        ],
    },
    typescript: {
        console: [
            F("log", "log()", "(...data)", 4),
            F("warn", "warn()", "(...data)", 5),
            F("error", "error()", "(...data)", 6),
            F("table", "table()", "(data)", 6),
        ],
        React: [
            F("useState", "useState()", "(initialState)", 9),
            F("useEffect", "useEffect()", "(effect, deps?)", 10),
            F("useMemo", "useMemo()", "(factory, deps)", 8),
            F("useCallback", "useCallback()", "(callback, deps)", 12),
            F("useRef", "useRef()", "(initialValue)", 7),
        ],
        Math: [
            F("max", "max()", "(...values)", 4),
            F("min", "min()", "(...values)", 4),
            F("round", "round()", "(value)", 6),
            F("floor", "floor()", "(value)", 6),
            F("random", "random()", "() -> number", 7),
        ],
    },
    javascript: {},
    rust: {
        Option: [
            F("Some", "Some()", "(value)", 5),
            V("None", "variant"),
            F("is_some", "is_some()", "(&self) -> bool", 8),
            F("is_none", "is_none()", "(&self) -> bool", 8),
            F("unwrap_or", "unwrap_or()", "(default)", 10),
        ],
        Result: [
            F("Ok", "Ok()", "(value)", 3),
            F("Err", "Err()", "(error)", 4),
            F("is_ok", "is_ok()", "(&self) -> bool", 6),
            F("is_err", "is_err()", "(&self) -> bool", 7),
            F("unwrap_or", "unwrap_or()", "(default)", 10),
        ],
        Vec: [
            F("new", "new()", "() -> Vec<T>", 4),
            F("with_capacity", "with_capacity()", "(capacity)", 14),
        ],
    },
    python: {
        self: [
            V("__class__", "type"),
            F("__str__", "__str__()", "dunder", 8),
            F("__repr__", "__repr__()", "dunder", 9),
        ],
        list: [
            F("append", "append()", "(object)", 7),
            F("extend", "extend()", "(iterable)", 7),
            F("pop", "pop()", "(index=-1)", 4),
            F("sort", "sort()", "(key=None, reverse=False)", 5),
        ],
        dict: [
            F("get", "get()", "(key, default=None)", 4),
            F("items", "items()", "()"),
            F("keys", "keys()", "()"),
            F("values", "values()", "()"),
        ],
    },
};

MemberMap.javascript = MemberMap.typescript;

const SignatureMap: Record<string, Record<string, SignatureHelp>> = {
    luau: {
        print: { Label: "print(...)", Parameters: ["..."], ActiveParameter: 0 },
        warn: { Label: "warn(...)", Parameters: ["..."], ActiveParameter: 0 },
        "Vector3.new": { Label: "Vector3.new(x, y, z)", Parameters: ["x", "y", "z"], ActiveParameter: 0 },
        "Instance.new": { Label: "Instance.new(className, parent?)", Parameters: ["className", "parent?"], ActiveParameter: 0 },
        "game.GetService": { Label: "game:GetService(className)", Parameters: ["className"], ActiveParameter: 0 },
        "game:GetService": { Label: "game:GetService(className)", Parameters: ["className"], ActiveParameter: 0 },
    },
    typescript: {
        useState: { Label: "useState(initialState)", Parameters: ["initialState"], ActiveParameter: 0 },
        useEffect: { Label: "useEffect(effect, deps?)", Parameters: ["effect", "deps?"], ActiveParameter: 0 },
        useMemo: { Label: "useMemo(factory, deps)", Parameters: ["factory", "deps"], ActiveParameter: 0 },
        useCallback: { Label: "useCallback(callback, deps)", Parameters: ["callback", "deps"], ActiveParameter: 0 },
        "console.log": { Label: "console.log(...data)", Parameters: ["...data"], ActiveParameter: 0 },
    },
    javascript: {},
    rust: {
        println: { Label: "println!(format, ...)", Parameters: ["format", "..."], ActiveParameter: 0 },
        format: { Label: "format!(format, ...)", Parameters: ["format", "..."], ActiveParameter: 0 },
        Some: { Label: "Some(value)", Parameters: ["value"], ActiveParameter: 0 },
        Ok: { Label: "Ok(value)", Parameters: ["value"], ActiveParameter: 0 },
        Err: { Label: "Err(error)", Parameters: ["error"], ActiveParameter: 0 },
    },
    python: {
        print: { Label: "print(*objects, sep=' ', end='\\n')", Parameters: ["*objects", "sep", "end"], ActiveParameter: 0 },
        len: { Label: "len(object)", Parameters: ["object"], ActiveParameter: 0 },
        range: { Label: "range(start, stop, step)", Parameters: ["start", "stop", "step"], ActiveParameter: 0 },
        isinstance: { Label: "isinstance(object, classinfo)", Parameters: ["object", "classinfo"], ActiveParameter: 0 },
    },
};

SignatureMap.javascript = SignatureMap.typescript;

function FilterItems(Items: CI[], Prefix: string): CI[] {
    const PL = Prefix.toLowerCase();
    return Items
        .filter(Item => Prefix.length === 0 || Item.Label.toLowerCase().startsWith(PL))
        .sort((A, B) => {
            const A0 = A.Label.toLowerCase() === PL ? 0 : 1;
            const B0 = B.Label.toLowerCase() === PL ? 0 : 1;
            return (A0 - B0) || A.Label.localeCompare(B.Label);
        });
}

export function GetCompletions(
    Text:     string,
    Offset:   number,
    Language: string,
    Tokens:   Token[],
): CompletionItem[] {
    const { Prefix } = GetWordContext(Text, Offset);
    const MemberContext = GetMemberContext(Text, Offset);
    if (MemberContext) {
        const Members = MemberMap[Language]?.[MemberContext.Target] ?? [];
        return FilterItems(Members, MemberContext.Prefix).slice(0, 12);
    }

    if (Prefix.length < 2) return [];

    const PL   = Prefix.toLowerCase();
    const Seen = new Set<string>();
    const Out: CI[] = [];
    for (const Item of LangMap[Language] ?? []) {
        if (Item.Label.toLowerCase().startsWith(PL)) {
            Seen.add(Item.Label);
            Out.push(Item);
        }
    }
    for (const Tok of Tokens) {
        if (Tok.Type !== "Default" && Tok.Type !== "Function" && Tok.Type !== "Type") continue;
        const Idents = Tok.Value.match(/[A-Za-z_][A-Za-z0-9_]*/g);
        if (!Idents) continue;
        for (const W of Idents) {
            if (W.length < 3 || Seen.has(W)) continue;
            if (!W.toLowerCase().startsWith(PL))  continue;
            Seen.add(W);
            Out.push({
                Label:  W,
                Insert: W,
                Kind:   Tok.Type === "Function" ? "function"
                      : /^[A-Z]/.test(W)        ? "type"
                      :                           "variable",
            });
        }
    }
    Out.sort((A, B) => {
        const A0 = A.Label.toLowerCase() === PL ? 0 : 1;
        const B0 = B.Label.toLowerCase() === PL ? 0 : 1;
        return (A0 - B0) || A.Label.localeCompare(B.Label);
    });

    return Out.slice(0, 12);
}

export function GetSignatureHelp(Text: string, Offset: number, Language: string): SignatureHelp | null {
    let Depth = 0;
    let OpenIndex = -1;

    for (let I = Offset - 1; I >= 0; I--) {
        const Char = Text[I];
        if (Char === ")") Depth++;
        if (Char === "(") {
            if (Depth === 0) {
                OpenIndex = I;
                break;
            }
            Depth--;
        }
        if (Char === "\n" && Depth === 0) break;
    }

    if (OpenIndex < 0) return null;

    const Before = Text.slice(0, OpenIndex).trimEnd();
    const Match = /([A-Za-z_$][A-Za-z0-9_$]*(?:[.:][A-Za-z_$][A-Za-z0-9_$]*)?|[A-Za-z_$][A-Za-z0-9_$]*!)$/.exec(Before);
    if (!Match) return null;

    const RawName = Match[1].replace(/!$/, "");
    const Help = SignatureMap[Language]?.[RawName];
    if (!Help) return null;

    const ArgsText = Text.slice(OpenIndex + 1, Offset);
    let ArgDepth = 0;
    let ActiveParameter = 0;
    for (const Char of ArgsText) {
        if (Char === "(" || Char === "[" || Char === "{") ArgDepth++;
        if ((Char === ")" || Char === "]" || Char === "}") && ArgDepth > 0) ArgDepth--;
        if (Char === "," && ArgDepth === 0) ActiveParameter++;
    }

    return {
        ...Help,
        ActiveParameter: Math.min(ActiveParameter, Math.max(Help.Parameters.length - 1, 0)),
    };
}
