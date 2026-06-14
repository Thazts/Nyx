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
const List = (Items: string): string[] => Items.trim().split(/\s+/).filter(Boolean);
const KW = (Items: string): CI[] => List(Items).map(K);
const TY = (Items: string): CI[] => List(Items).map(Item => T(Item));

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

const C: CI[] = [
    K("int"), K("char"), K("float"), K("double"), K("void"), K("long"),
    K("short"), K("unsigned"), K("signed"), K("const"), K("static"),
    K("extern"), K("volatile"), K("register"), K("auto"), K("if"), K("else"),
    K("for"), K("while"), K("do"), K("return"), K("break"), K("continue"),
    K("switch"), K("case"), K("default"), K("goto"), K("struct"), K("union"),
    K("enum"), K("typedef"), K("sizeof"), K("inline"), K("restrict"),
    K("NULL"), K("true"), K("false"),
    F("printf",   "printf()",   "(fmt, …) → int",     7),
    F("scanf",    "scanf()",    "(fmt, …) → int",     6),
    F("fprintf",  "fprintf()",  "(stream, fmt, …)",   8),
    F("sprintf",  "sprintf()",  "(buf, fmt, …)",      8),
    F("malloc",   "malloc()",   "(size) → void*",     7),
    F("calloc",   "calloc()",   "(n, size) → void*",  7),
    F("realloc",  "realloc()",  "(ptr, size)",        8),
    F("free",     "free()",     "(ptr)",              5),
    F("memcpy",   "memcpy()",   "(dst, src, n)",      7),
    F("memset",   "memset()",   "(dst, c, n)",        7),
    F("strlen",   "strlen()",   "(s) → size_t",       7),
    F("strcmp",   "strcmp()",   "(a, b) → int",       7),
    F("strcpy",   "strcpy()",   "(dst, src)",         7),
    F("fopen",    "fopen()",    "(path, mode)",       6),
    F("fclose",   "fclose()",   "(stream)",           7),
    S("include",  "#include <>",                  "#include <…>",  10),
    S("define",   "#define ",                     "#define",        8),
    S("main",     "int main(int argc, char **argv) {\n    \n    return 0;\n}", "int main()", 38),
    S("if",       "if () {\n    \n}",             "if (…) {}",       4),
    S("ifelse",   "if () {\n    \n} else {\n    \n}", "if…else",     4),
    S("for",      "for (int i = 0; i < ; i++) {\n    \n}", "for loop", 20),
    S("while",    "while () {\n    \n}",          "while (…) {}",    7),
    S("switch",   "switch () {\n    case :\n        break;\n    default:\n        break;\n}", "switch", 8),
    S("struct",   "struct  {\n    \n};",          "struct {}",       7),
    S("func",     "void () {\n    \n}",           "function",        5),
];

const Cpp: CI[] = [
    ...C.filter(I => I.Kind === "keyword"),
    K("class"), K("namespace"), K("template"), K("typename"), K("new"),
    K("delete"), K("try"), K("catch"), K("throw"), K("public"), K("private"),
    K("protected"), K("virtual"), K("override"), K("final"), K("explicit"),
    K("using"), K("nullptr"), K("bool"), K("this"), K("operator"), K("friend"),
    K("mutable"), K("constexpr"), K("decltype"), K("noexcept"),
    T("std", "namespace"), T("string"), T("vector"), T("map"),
    V("cout", "std::ostream"), V("cin", "std::istream"), V("endl", "manipulator"),
    S("include",   "#include <>",                       "#include <…>",  10),
    S("cout",      "std::cout << ",                     "cout <<",        13),
    S("main",      "int main() {\n    \n    return 0;\n}", "int main()",   17),
    S("class",     "class  {\npublic:\n    \n};",        "class {}",        6),
    S("for",       "for (int i = 0; i < ; i++) {\n    \n}", "for loop",     20),
    S("foreach",   "for (auto& x : ) {\n    \n}",        "range-for",      15),
    S("if",        "if () {\n    \n}",                   "if (…) {}",       4),
    S("while",     "while () {\n    \n}",                "while (…) {}",    7),
    S("trycatch",  "try {\n    \n} catch (const std::exception& e) {\n    \n}", "try…catch", 10),
    S("template",  "template <typename T>\n",            "template<…>",    19),
    S("namespace", "namespace  {\n    \n}",              "namespace {}",   10),
];

const Go: CI[] = [
    K("func"), K("var"), K("const"), K("type"), K("struct"), K("interface"),
    K("map"), K("chan"), K("if"), K("else"), K("for"), K("range"), K("switch"),
    K("case"), K("default"), K("return"), K("break"), K("continue"), K("go"),
    K("defer"), K("select"), K("import"), K("package"), K("fallthrough"),
    K("goto"), K("true"), K("false"), K("nil"),
    T("string"), T("int"), T("int64"), T("float64"), T("bool"), T("byte"),
    T("rune"), T("error"), T("any"),
    F("make",    "make()",     "(T, …) → T",       5),
    F("new",     "new()",      "(T) → *T",         4),
    F("len",     "len()",      "(v) → int",        4),
    F("cap",     "cap()",      "(v) → int",        4),
    F("append",  "append()",   "(s, …) → []T",     7),
    F("copy",    "copy()",     "(dst, src) → int", 5),
    F("delete",  "delete()",   "(m, k)",           7),
    F("panic",   "panic()",    "(v)",              6),
    F("recover", "recover()",  "() → any",         8),
    V("fmt", "package"), V("os", "package"), V("err", "error"),
    S("func",     "func () {\n    \n}",               "func…{}",         5),
    S("main",     "func main() {\n    \n}",           "func main()",    18),
    S("if",       "if  {\n    \n}",                   "if {}",           3),
    S("iferr",    "if err != nil {\n    return err\n}", "if err != nil", 30),
    S("for",      "for  {\n    \n}",                  "for {}",          4),
    S("forrange", "for i, v := range  {\n    \n}",    "for…range",      18),
    S("struct",   "type  struct {\n    \n}",          "type…struct",     5),
    S("interface","type  interface {\n    \n}",       "type…interface",  5),
    S("method",   "func ()  {\n    \n}",              "method",          5),
    S("switch",   "switch  {\n    \n}",               "switch",          7),
];

const Csharp: CI[] = [
    K("class"), K("interface"), K("struct"), K("enum"), K("namespace"),
    K("using"), K("var"), K("const"), K("public"), K("private"),
    K("protected"), K("internal"), K("static"), K("readonly"), K("abstract"),
    K("virtual"), K("override"), K("sealed"), K("new"), K("this"), K("base"),
    K("return"), K("if"), K("else"), K("for"), K("foreach"), K("while"),
    K("do"), K("switch"), K("case"), K("default"), K("break"), K("continue"),
    K("try"), K("catch"), K("finally"), K("throw"), K("true"), K("false"),
    K("null"), K("void"), K("async"), K("await"), K("typeof"), K("is"),
    K("as"), K("get"), K("set"), K("record"), K("partial"),
    T("int"), T("string"), T("bool"), T("double"), T("float"), T("object"),
    T("List"), T("Dictionary"), T("Task"),
    V("Console", "class"),
    S("class",     "public class \n{\n    \n}",                "class {}",      13),
    S("method",    "public void ()\n{\n    \n}",               "method",        12),
    S("main",      "static void Main(string[] args)\n{\n    \n}", "Main()",      38),
    S("if",        "if ()\n{\n    \n}",                         "if (…) {}",      4),
    S("ifelse",    "if ()\n{\n    \n}\nelse\n{\n    \n}",       "if…else",        4),
    S("for",       "for (int i = 0; i < ; i++)\n{\n    \n}",   "for loop",      20),
    S("foreach",   "foreach (var item in )\n{\n    \n}",       "foreach",       21),
    S("while",     "while ()\n{\n    \n}",                     "while (…) {}",    7),
    S("trycatch",  "try\n{\n    \n}\ncatch (Exception e)\n{\n    \n}", "try…catch", 10),
    S("prop",      "public  { get; set; }",                   "auto property",  7),
    S("namespace", "namespace \n{\n    \n}",                   "namespace {}",  10),
];

const Java: CI[] = [
    K("class"), K("interface"), K("enum"), K("abstract"), K("extends"),
    K("implements"), K("new"), K("this"), K("super"), K("return"), K("if"),
    K("else"), K("for"), K("while"), K("do"), K("switch"), K("case"),
    K("default"), K("break"), K("continue"), K("try"), K("catch"), K("finally"),
    K("throw"), K("throws"), K("static"), K("final"), K("public"), K("private"),
    K("protected"), K("void"), K("null"), K("true"), K("false"), K("import"),
    K("package"), K("instanceof"), K("var"), K("record"),
    T("int"), T("long"), T("double"), T("float"), T("boolean"), T("char"),
    T("String"), T("Object"), T("List"), T("Map"), T("Integer"),
    V("System", "class"),
    S("class",     "public class  {\n    \n}",                        "class {}",   13),
    S("main",      "public static void main(String[] args) {\n    \n}", "main()",    46),
    S("method",    "public void () {\n    \n}",                        "method",     12),
    S("sout",      "System.out.println();",                           "println",    19),
    S("if",        "if () {\n    \n}",                                 "if (…) {}",   4),
    S("ifelse",    "if () {\n    \n} else {\n    \n}",                  "if…else",     4),
    S("for",       "for (int i = 0; i < ; i++) {\n    \n}",            "for loop",   20),
    S("foreach",   "for ( item : ) {\n    \n}",                        "for-each",    5),
    S("while",     "while () {\n    \n}",                              "while (…) {}", 7),
    S("trycatch",  "try {\n    \n} catch (Exception e) {\n    \n}",    "try…catch",  10),
];

const Sql: CI[] = [
    K("SELECT"), K("FROM"), K("WHERE"), K("JOIN"), K("LEFT"), K("RIGHT"),
    K("INNER"), K("OUTER"), K("FULL"), K("ON"), K("GROUP"), K("BY"),
    K("ORDER"), K("HAVING"), K("LIMIT"), K("OFFSET"), K("UNION"), K("ALL"),
    K("DISTINCT"), K("AS"), K("AND"), K("OR"), K("NOT"), K("NULL"), K("IS"),
    K("IN"), K("LIKE"), K("BETWEEN"), K("EXISTS"), K("INSERT"), K("INTO"),
    K("VALUES"), K("UPDATE"), K("SET"), K("DELETE"), K("CREATE"), K("TABLE"),
    K("DROP"), K("ALTER"), K("ADD"), K("COLUMN"), K("INDEX"), K("VIEW"),
    K("PRIMARY"), K("KEY"), K("FOREIGN"), K("REFERENCES"), K("UNIQUE"),
    K("DEFAULT"), K("CASE"), K("WHEN"), K("THEN"), K("ELSE"), K("END"),
    K("ASC"), K("DESC"), K("WITH"),
    F("COUNT",    "COUNT()",    "(expr) → int",          6),
    F("SUM",      "SUM()",      "(expr)",                4),
    F("AVG",      "AVG()",      "(expr)",                4),
    F("MAX",      "MAX()",      "(expr)",                4),
    F("MIN",      "MIN()",      "(expr)",                4),
    F("COALESCE", "COALESCE()", "(…) → first non-null",  9),
    F("CAST",     "CAST()",     "(expr AS type)",        5),
    F("CONCAT",   "CONCAT()",   "(…)",                   7),
    F("UPPER",    "UPPER()",    "(s)",                   6),
    F("LOWER",    "LOWER()",    "(s)",                   6),
    S("select",      "SELECT  FROM ",               "SELECT…FROM",   7),
    S("selectwhere", "SELECT  FROM  WHERE ",        "SELECT…WHERE",  7),
    S("insert",      "INSERT INTO  ()\nVALUES ();", "INSERT INTO",  12),
    S("update",      "UPDATE  SET  WHERE ;",        "UPDATE…SET",    7),
    S("delete",      "DELETE FROM  WHERE ;",        "DELETE FROM",  12),
    S("create",      "CREATE TABLE  (\n    \n);",   "CREATE TABLE", 13),
    S("join",        "JOIN  ON ",                   "JOIN…ON",       5),
];

const Bash: CI[] = [
    K("if"), K("then"), K("else"), K("elif"), K("fi"), K("for"), K("while"),
    K("do"), K("done"), K("case"), K("esac"), K("in"), K("function"),
    K("return"), K("exit"), K("local"), K("export"), K("readonly"), K("unset"),
    K("shift"), K("true"), K("false"), K("source"), K("select"), K("until"),
    F("echo",   "echo ",    "(…)",       5),
    F("read",   "read ",    "(var)",     5),
    F("printf", "printf ",  "(fmt, …)",  7),
    F("test",   "test ",    "(expr)",    5),
    V("PATH", "env"), V("HOME", "env"), V("PWD", "env"), V("USER", "env"),
    S("if",      "if [[  ]]; then\n    \nfi",            "if…fi",       6),
    S("ifelse",  "if [[  ]]; then\n    \nelse\n    \nfi", "if…else…fi",  6),
    S("for",     "for i in ; do\n    \ndone",           "for…done",     9),
    S("while",   "while [[  ]]; do\n    \ndone",         "while…done",   9),
    S("case",    "case  in\n    )\n        ;;\n    *)\n        ;;\nesac", "case…esac", 5),
    S("func",    "() {\n    \n}",                        "function",     0),
    S("shebang", "#!/usr/bin/env bash\n",               "shebang",     20),
];

const Glsl: CI[] = [
    K("attribute"), K("uniform"), K("varying"), K("in"), K("out"), K("inout"),
    K("precision"), K("highp"), K("mediump"), K("lowp"), K("if"), K("else"),
    K("for"), K("while"), K("do"), K("return"), K("break"), K("continue"),
    K("discard"), K("struct"), K("const"), K("layout"), K("flat"), K("smooth"),
    T("void"), T("bool"), T("int"), T("uint"), T("float"),
    T("vec2"), T("vec3"), T("vec4"), T("ivec2"), T("ivec3"), T("ivec4"),
    T("mat2"), T("mat3"), T("mat4"), T("sampler2D"), T("samplerCube"),
    F("texture",    "texture()",    "(sampler, uv) → vec4", 8),
    F("normalize",  "normalize()",  "(v) → v",             10),
    F("dot",        "dot()",        "(a, b) → float",       4),
    F("cross",      "cross()",      "(a, b) → vec3",        6),
    F("mix",        "mix()",        "(a, b, t)",            4),
    F("clamp",      "clamp()",      "(x, lo, hi)",          6),
    F("length",     "length()",     "(v) → float",          7),
    F("pow",        "pow()",        "(x, y)",               4),
    F("max",        "max()",        "(a, b)",               4),
    F("min",        "min()",        "(a, b)",               4),
    F("floor",      "floor()",      "(x)",                  6),
    F("abs",        "abs()",        "(x)",                  4),
    F("smoothstep", "smoothstep()", "(e0, e1, x)",         11),
    F("reflect",    "reflect()",    "(I, N)",               8),
    V("gl_Position", "builtin"), V("gl_FragCoord", "builtin"), V("gl_FragColor", "builtin"),
    S("main",    "void main() {\n    \n}",               "void main()", 18),
    S("if",      "if () {\n    \n}",                     "if (…) {}",    4),
    S("for",     "for (int i = 0; i < ; i++) {\n    \n}", "for loop",   20),
    S("uniform", "uniform  ;",                           "uniform",      8),
];

const Wgsl: CI[] = [
    K("var"), K("let"), K("fn"), K("struct"), K("if"), K("else"), K("for"),
    K("while"), K("loop"), K("return"), K("break"), K("continue"), K("const"),
    K("switch"), K("case"), K("default"), K("override"), K("discard"),
    T("f32"), T("i32"), T("u32"), T("bool"), T("f16"),
    T("vec2f"), T("vec3f"), T("vec4f"), T("vec2"), T("vec3"), T("vec4"),
    T("mat3x3f"), T("mat4x4f"), T("array"), T("ptr"), T("atomic"),
    T("sampler"), T("texture_2d"),
    F("textureSample", "textureSample()", "(t, s, uv) → vec4", 14),
    F("normalize",     "normalize()",     "(v) → v",          10),
    F("dot",           "dot()",           "(a, b) → f32",      4),
    F("cross",         "cross()",         "(a, b)",            6),
    F("mix",           "mix()",           "(a, b, t)",         4),
    F("clamp",         "clamp()",         "(x, lo, hi)",       6),
    F("length",        "length()",        "(v) → f32",         7),
    F("pow",           "pow()",           "(x, y)",            4),
    F("max",           "max()",           "(a, b)",            4),
    F("min",           "min()",           "(a, b)",            4),
    F("floor",         "floor()",         "(x)",               6),
    F("abs",           "abs()",           "(x)",               4),
    F("smoothstep",    "smoothstep()",    "(e0, e1, x)",      11),
    S("fn",       "fn () {\n    \n}",                              "fn…{}",        3),
    S("vertex",   "@vertex\nfn () {\n    \n}",                     "@vertex fn",  11),
    S("fragment", "@fragment\nfn () -> @location(0) vec4f {\n    \n}", "@fragment fn", 13),
    S("compute",  "@compute @workgroup_size(1)\nfn () {\n    \n}", "@compute fn",  31),
    S("struct",   "struct  {\n    \n}",                            "struct {}",    7),
    S("if",       "if  {\n    \n}",                                "if {}",        3),
    S("for",      "for (var i = 0; i < ; i++) {\n    \n}",         "for loop",    20),
];

const Css: CI[] = [
    K("important"), K("inherit"), K("initial"), K("unset"), K("auto"), K("none"),
    K("flex"), K("grid"), K("block"), K("inline"), K("absolute"), K("relative"),
    K("fixed"), K("sticky"), K("hidden"), K("visible"),
    S("display",          "display: ;",          "property",  9),
    S("position",         "position: ;",         "property", 10),
    S("width",            "width: ;",            "property",  7),
    S("height",           "height: ;",           "property",  8),
    S("margin",           "margin: ;",           "property",  8),
    S("padding",          "padding: ;",          "property",  9),
    S("color",            "color: ;",            "property",  7),
    S("background",       "background: ;",       "property", 12),
    S("background-color", "background-color: ;", "property", 18),
    S("border",          "border: ;",            "property",  8),
    S("border-radius",   "border-radius: ;",     "property", 15),
    S("font-size",       "font-size: ;",         "property", 11),
    S("font-weight",     "font-weight: ;",       "property", 13),
    S("font-family",     "font-family: ;",        "property", 13),
    S("text-align",      "text-align: ;",        "property", 12),
    S("flex-direction",  "flex-direction: ;",    "property", 16),
    S("justify-content", "justify-content: ;",   "property", 17),
    S("align-items",     "align-items: ;",       "property", 13),
    S("gap",             "gap: ;",               "property",  5),
    S("grid-template-columns", "grid-template-columns: ;", "property", 23),
    S("transition",      "transition: ;",        "property", 12),
    S("transform",       "transform: ;",         "property", 11),
    S("opacity",         "opacity: ;",           "property",  9),
    S("overflow",        "overflow: ;",          "property", 10),
    S("z-index",         "z-index: ;",           "property",  9),
    S("box-shadow",      "box-shadow: ;",        "property", 12),
    S("cursor",          "cursor: ;",            "property",  8),
    S("media",           "@media () {\n    \n}",  "@media",    8),
    S("keyframes",       "@keyframes  {\n    \n}", "@keyframes", 11),
];

const Html: CI[] = [
    ...KW("html head body main section article aside nav header footer div span p a img button form input label select option textarea script style link meta title h1 h2 h3 h4 h5 h6 ul ol li table thead tbody tr th td canvas svg video audio source"),
    ...KW("class id href src alt type name value placeholder role aria-label data-testid rel target width height disabled checked selected"),
    S("doctype", "<!DOCTYPE html>\n", "HTML doctype", 15),
    S("html", "<html lang=\"en\">\n<head>\n    <meta charset=\"UTF-8\">\n    <title></title>\n</head>\n<body>\n    \n</body>\n</html>", "document", 101),
    S("div", "<div>\n    \n</div>", "<div>", 10),
    S("section", "<section>\n    \n</section>", "<section>", 14),
    S("a", "<a href=\"\"></a>", "anchor", 9),
    S("img", "<img src=\"\" alt=\"\">", "image", 10),
    S("button", "<button type=\"button\"></button>", "button", 29),
    S("form", "<form>\n    \n</form>", "form", 11),
    S("input", "<input type=\"text\" name=\"\">", "input", 26),
];

const Xml: CI[] = [
    ...KW("xml version encoding standalone stylesheet schema element attribute namespace xmlns id ref type name value"),
    S("decl", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n", "XML declaration", 39),
    S("element", "<element>\n    \n</element>", "element", 14),
    S("empty", "<element />", "empty element", 9),
    S("comment", "<!--  -->", "comment", 5),
    S("cdata", "<![CDATA[\n\n]]>", "CDATA", 10),
];

const Json: CI[] = [
    K("true"), K("false"), K("null"),
    S("object", "{\n    \n}", "object", 6),
    S("array", "[\n    \n]", "array", 6),
    S("pair", "\"\": ", "property", 1),
    S("string", "\"\"", "string", 1),
];

const Toml: CI[] = [
    K("true"), K("false"),
    S("table", "[table]\n", "table", 1),
    S("arraytable", "[[table]]\n", "array table", 2),
    S("key", "key = ", "key/value", 6),
    S("string", "key = \"\"", "string value", 7),
    S("array", "key = []", "array value", 7),
    S("datetime", "key = 1979-05-27T07:32:00Z", "datetime value", 6),
];

const Yaml: CI[] = [
    K("true"), K("false"), K("null"), K("yes"), K("no"), K("on"), K("off"),
    S("doc", "---\n", "document start", 4),
    S("key", "key: ", "mapping", 5),
    S("list", "- ", "list item", 2),
    S("block", "key: |\n  ", "literal block", 8),
    S("folded", "key: >\n  ", "folded block", 8),
    S("anchor", "&name ", "anchor", 6),
    S("alias", "*name", "alias", 5),
];

const Markdown: CI[] = [
    S("h1", "# ", "heading 1", 2),
    S("h2", "## ", "heading 2", 3),
    S("h3", "### ", "heading 3", 4),
    S("link", "[]()", "link", 1),
    S("image", "![]()", "image", 2),
    S("code", "```\n\n```", "code fence", 4),
    S("table", "| Column | Column |\n| --- | --- |\n|  |  |", "table", 2),
    S("quote", "> ", "blockquote", 2),
    S("task", "- [ ] ", "task item", 6),
];

const Kotlin: CI[] = [
    ...KW("fun val var class object interface data sealed enum open abstract override public private protected internal companion init constructor this super return if else when for while do break continue in is as try catch finally throw import package typealias by get set lateinit lazy suspend inline reified vararg out where null true false"),
    ...TY("Unit Int String Boolean Long Double Float Char Any List Map Set Array"),
    F("println", "println()", "builtin", 8),
    F("print", "print()", "builtin", 6),
    S("fun", "fun () {\n    \n}", "function", 4),
    S("main", "fun main() {\n    \n}", "main", 18),
    S("class", "class  {\n    \n}", "class", 6),
    S("data", "data class ()", "data class", 11),
    S("when", "when () {\n    else -> \n}", "when", 6),
    S("if", "if () {\n    \n}", "if", 4),
    S("for", "for (item in ) {\n    \n}", "for-in", 14),
];

const Swift: CI[] = [
    ...KW("func let var class struct enum protocol extension init deinit self Self super return if else guard switch case default for while repeat break continue in where as is try catch throw throws rethrows defer do import typealias associatedtype public private fileprivate internal open static final override mutating nonmutating lazy weak unowned inout indirect convenience required some any nil true false async await actor"),
    ...TY("Int String Bool Double Float Void Array Dictionary Optional"),
    F("print", "print()", "builtin", 6),
    S("func", "func () {\n    \n}", "function", 5),
    S("main", "@main\nstruct App {\n    static func main() {\n        \n    }\n}", "@main", 50),
    S("struct", "struct  {\n    \n}", "struct", 7),
    S("class", "class  {\n    \n}", "class", 6),
    S("if", "if  {\n    \n}", "if", 3),
    S("guard", "guard  else {\n    return\n}", "guard", 6),
    S("for", "for item in  {\n    \n}", "for-in", 12),
    S("switch", "switch  {\ncase :\n    break\ndefault:\n    break\n}", "switch", 7),
];

const Dart: CI[] = [
    ...KW("void var final const dynamic class abstract extends implements with mixin enum typedef return if else switch case default for while do break continue in is as new this super try catch finally throw rethrow import export library part show hide async await yield sync get set static factory operator late required covariant external true false null"),
    ...TY("int double num bool String List Map Set Future Stream"),
    F("print", "print()", "builtin", 6),
    S("main", "void main() {\n  \n}", "main", 16),
    S("class", "class  {\n  \n}", "class", 6),
    S("method", "void () {\n  \n}", "method", 5),
    S("if", "if () {\n  \n}", "if", 4),
    S("for", "for (var i = 0; i < ; i++) {\n  \n}", "for", 20),
    S("foreach", "for (final item in ) {\n  \n}", "for-in", 19),
    S("trycatch", "try {\n  \n} catch (e) {\n  \n}", "try/catch", 8),
];

const Scala: CI[] = [
    ...KW("def val var class object trait extends with case match if else for while do yield return try catch finally throw import package new this super override abstract final sealed implicit lazy private protected public type given using enum then true false null"),
    ...TY("Unit Int String Boolean Long Double Float List Map Option Some None"),
    F("println", "println()", "Predef", 8),
    F("print", "print()", "Predef", 6),
    S("def", "def (): Unit = {\n  \n}", "method", 4),
    S("main", "@main def main(): Unit = {\n  \n}", "main", 29),
    S("class", "class  {\n  \n}", "class", 6),
    S("object", "object  {\n  \n}", "object", 7),
    S("match", "match {\n  case  => \n}", "match", 15),
    S("for", "for item <-  do\n  ", "for", 13),
];

const Hlsl: CI[] = [
    ...KW("struct cbuffer tbuffer register return if else for while do switch case default break continue discard in out inout uniform static const sampler sampler2D technique pass true false matrix vector numthreads groupshared precise row_major column_major"),
    ...TY("float float2 float3 float4 float2x2 float3x3 float4x4 int int2 int3 int4 uint uint2 uint3 uint4 bool half double void SamplerState Texture1D Texture2D Texture3D TextureCube Texture2DArray RWTexture2D Buffer StructuredBuffer RWStructuredBuffer ByteAddressBuffer"),
    F("mul", "mul()", "(x, y)", 4),
    F("normalize", "normalize()", "(v)", 10),
    F("dot", "dot()", "(a, b)", 4),
    F("cross", "cross()", "(a, b)", 6),
    F("lerp", "lerp()", "(a, b, t)", 5),
    F("saturate", "saturate()", "(x)", 9),
    F("clamp", "clamp()", "(x, lo, hi)", 6),
    F("Sample", "Sample()", "(sampler, uv)", 7),
    V("SV_Position", "semantic"), V("SV_Target", "semantic"),
    S("cbuffer", "cbuffer  : register(b0)\n{\n    \n};", "constant buffer", 8),
    S("main", "float4 main() : SV_Target\n{\n    \n}", "pixel shader", 33),
    S("numthreads", "[numthreads(, , )]\nvoid main(uint3 id : SV_DispatchThreadID)\n{\n    \n}", "compute shader", 12),
];

const Zig: CI[] = [
    ...KW("const var fn pub struct enum union error if else while for switch return break continue defer errdefer try catch orelse unreachable comptime inline export extern async await suspend resume nosuspend test and or null undefined true false"),
    ...TY("void bool type anytype anyerror anyopaque usize isize u8 u16 u32 u64 u128 i8 i16 i32 i64 i128 f16 f32 f64 f128 noreturn"),
    F("@import", "@import(\"\")", "builtin", 9),
    F("@panic", "@panic(\"\")", "builtin", 8),
    S("fn", "fn () void {\n    \n}", "function", 3),
    S("main", "pub fn main() !void {\n    \n}", "main", 26),
    S("struct", "const  = struct {\n    \n};", "struct", 6),
    S("if", "if () {\n    \n}", "if", 4),
    S("for", "for () |item| {\n    \n}", "for", 5),
    S("switch", "switch () {\n    else => {},\n}", "switch", 8),
];

const Ruby: CI[] = [
    ...KW("def end class module if elsif else unless case when then while until for in do begin rescue ensure raise return yield break next redo retry and or not nil true false self super require require_relative include extend attr_accessor attr_reader attr_writer lambda proc new loop"),
    F("puts", "puts ", "Kernel", 5),
    F("print", "print ", "Kernel", 6),
    F("p", "p ", "Kernel", 2),
    S("def", "def \n  \nend", "method", 4),
    S("class", "class \n  \nend", "class", 6),
    S("module", "module \n  \nend", "module", 7),
    S("if", "if \n  \nend", "if", 3),
    S("unless", "unless \n  \nend", "unless", 7),
    S("each", ".each do |item|\n  \nend", "each block", 15),
    S("begin", "begin\n  \nrescue => e\n  \nend", "begin/rescue", 8),
];

const Php: CI[] = [
    ...KW("function class interface trait extends implements abstract final public private protected static const var return if else elseif switch case default for foreach while do break continue as new clone this self parent try catch finally throw namespace use echo print isset unset empty list array null true false instanceof global require require_once include include_once fn match enum readonly yield"),
    F("var_dump", "var_dump()", "builtin", 9),
    F("print_r", "print_r()", "builtin", 8),
    F("count", "count()", "builtin", 6),
    F("array_map", "array_map()", "builtin", 10),
    S("php", "<?php\n\n", "open tag", 6),
    S("function", "function ()\n{\n    \n}", "function", 10),
    S("class", "class \n{\n    \n}", "class", 6),
    S("if", "if () {\n    \n}", "if", 4),
    S("foreach", "foreach ($items as $item) {\n    \n}", "foreach", 29),
    S("trycatch", "try {\n    \n} catch (Throwable $e) {\n    \n}", "try/catch", 10),
];

const Elixir: CI[] = [
    ...KW("def defp defmodule defmacro defmacrop defstruct defprotocol defimpl defdelegate defguard do end fn if else unless case cond with for when and or not in nil true false raise try rescue catch after import alias require use receive quote unquote"),
    F("IO.puts", "IO.puts()", "IO", 8),
    F("IO.inspect", "IO.inspect()", "IO", 11),
    S("defmodule", "defmodule  do\n  \nend", "module", 10),
    S("def", "def () do\n  \nend", "function", 4),
    S("defp", "defp () do\n  \nend", "private function", 5),
    S("case", "case  do\n  _ -> \nend", "case", 6),
    S("cond", "cond do\n  true -> \nend", "cond", 18),
    S("with", "with  <-  do\n  \nend", "with", 5),
];

const Haskell: CI[] = [
    ...KW("module where import data type newtype class instance deriving do let in case of if then else infix infixl infixr foreign default as hiding qualified"),
    ...TY("Int Integer Float Double Bool Char String Maybe Either IO"),
    F("print", "print ", "Prelude", 6),
    F("putStrLn", "putStrLn ", "Prelude", 9),
    S("module", "module Main where\n\n", "module", 19),
    S("main", "main :: IO ()\nmain = do\n  ", "main", 25),
    S("data", "data  = \n  deriving (Show, Eq)", "data type", 5),
    S("case", "case  of\n  _ -> ", "case", 6),
    S("let", "let  = \nin ", "let", 4),
];

const Graphql: CI[] = [
    ...KW("query mutation subscription type input enum interface union scalar schema fragment on implements directive extend true false null"),
    ...TY("ID String Int Float Boolean"),
    S("query", "query  {\n  \n}", "query", 6),
    S("mutation", "mutation  {\n  \n}", "mutation", 9),
    S("subscription", "subscription  {\n  \n}", "subscription", 13),
    S("type", "type  {\n  \n}", "type", 5),
    S("input", "input  {\n  \n}", "input", 6),
    S("fragment", "fragment  on  {\n  \n}", "fragment", 9),
    S("field", "field: Type", "field", 7),
];

const Dockerfile: CI[] = [
    ...KW("FROM RUN CMD LABEL MAINTAINER EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS"),
    S("from", "FROM ", "base image", 5),
    S("run", "RUN ", "run command", 4),
    S("copy", "COPY  .", "copy", 5),
    S("workdir", "WORKDIR /app", "workdir", 12),
    S("env", "ENV  ", "environment", 4),
    S("entrypoint", "ENTRYPOINT []", "entrypoint", 12),
    S("cmd", "CMD []", "command", 5),
    S("node", "FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nCMD [\"npm\", \"start\"]", "Node image", 96),
];

const Makefile: CI[] = [
    ...KW("ifeq ifneq ifdef ifndef else endif include sinclude define endef export unexport override vpath .PHONY .DEFAULT .PRECIOUS .SECONDARY .SUFFIXES .INTERMEDIATE .NOTPARALLEL"),
    V("CC", "variable"), V("CFLAGS", "variable"), V("LDFLAGS", "variable"), V("SHELL", "variable"),
    S("target", "target:\n\t", "target", 8),
    S("phony", ".PHONY: \n", "phony target", 8),
    S("var", "NAME := ", "variable", 8),
    S("ifeq", "ifeq (,)\n\nendif", "conditional", 6),
    S("define", "define \n\nendef", "define", 7),
];

const Nim: CI[] = [
    ...KW("addr and as asm bind block break case cast concept const continue converter defer discard distinct div do elif else end enum except export finally for from func if import in include interface is isnot iterator let macro method mixin mod nil not notin object of or out proc ptr raise ref return shl shr static template try tuple type using var when while xor yield true false"),
    ...TY("int float string bool char seq array uint int8 int16 int32 int64 float32 float64 byte void"),
    F("echo", "echo ", "builtin", 5),
    S("proc", "proc () =\n  ", "procedure", 5),
    S("func", "func ():  =\n  ", "function", 5),
    S("type", "type\n   = object\n    ", "object type", 7),
    S("if", "if :\n  ", "if", 3),
    S("for", "for item in :\n  ", "for-in", 12),
    S("case", "case \nof :\n  \nelse:\n  ", "case", 5),
];

const Vlang: CI[] = [
    ...KW("fn mut pub struct enum interface union type const module import if else match for in is as or return break continue go spawn defer unsafe none true false sizeof typeof isreftype __global shared lock rlock select assert asm static volatile atomic nil"),
    ...TY("int i8 i16 i32 i64 u8 u16 u32 u64 f32 f64 bool string rune byte voidptr any map chan thread isize usize"),
    F("println", "println()", "builtin", 8),
    F("print", "print()", "builtin", 6),
    S("fn", "fn () {\n    \n}", "function", 3),
    S("main", "fn main() {\n    \n}", "main", 16),
    S("struct", "struct  {\n    \n}", "struct", 7),
    S("if", "if  {\n    \n}", "if", 3),
    S("for", "for  {\n    \n}", "for", 4),
    S("match", "match  {\n    else {}\n}", "match", 6),
];

const Red: CI[] = [
    ...KW("func function does has if either unless case switch while until loop repeat foreach forall forever break continue return exit print prin probe do make context object none true false on off yes no all any not and or xor reduce compose append insert remove find select"),
    S("func", "func [] [\n    \n]", "function", 6),
    S("if", "if  [\n    \n]", "if", 3),
    S("either", "either  [\n    \n][\n    \n]", "either", 7),
    S("foreach", "foreach item  [\n    \n]", "foreach", 14),
    S("object", "make object! [\n    \n]", "object", 15),
];

const J: CI[] = [
    ...KW("if. do. else. elseif. end. for. while. whilst. select. case. fcase. try. catch. catchd. catcht. throw. return. assert. break. continue. goto. label."),
    S("if", "if.  do.\n  \nend.", "if block", 4),
    S("for", "for_i.  do.\n  \nend.", "for block", 7),
    S("verb", "name =: 3 : 0\n\n)", "explicit verb", 8),
    S("monad", "name =: 3 : 'y'", "monad", 8),
    S("dyad", "name =: 4 : 'x y'", "dyad", 8),
];

const Apl: CI[] = [
    ...KW(":If :Else :ElseIf :EndIf :While :EndWhile :Repeat :Until :For :EndFor :Select :Case :CaseList :EndSelect :Trap :EndTrap :Return :Continue :Leave :GoTo :Namespace :EndNamespace :Class :EndClass :With :EndWith :Hold :EndHold :Section :EndSection"),
    S("if", ":If \n    \n:EndIf", "if block", 4),
    S("for", ":For item :In \n    \n:EndFor", "for block", 14),
    S("class", ":Class \n    \n:EndClass", "class", 7),
    S("namespace", ":Namespace \n    \n:EndNamespace", "namespace", 11),
];

const Factor: CI[] = [
    ...KW("USING: USE: IN: GENERIC: GENERIC# M: TUPLE: SYMBOL: SYMBOLS: CONSTANT: PREDICATE: MIXIN: INSTANCE: SLOT: HOOK: MACRO: MEMO: DEFER: FORGET: PRIMITIVE: C-TYPE: <PRIVATE PRIVATE> : ; if when unless cond case while until each map filter reduce dup drop swap over rot nip tuck pick 2dup call dip keep bi tri t f"),
    S("word", ": name ( -- )\n    \n;", "word", 3),
    S("using", "USING:  ;\n", "vocab imports", 7),
    S("in", "IN: ", "vocab", 4),
    S("tuple", "TUPLE: name ;", "tuple", 7),
];

const Idris: CI[] = [
    ...KW("module where import data record interface implementation do let in case of if then else with mutual namespace using parameters total partial covering public export private infixl infixr infix prefix auto impossible rewrite proof Type claim provide syntax pattern term forall"),
    ...TY("Int Integer String Char Bool List Maybe Either IO Nat Type"),
    S("module", "module Main\n\n", "module", 13),
    S("main", "main : IO ()\nmain = do\n  ", "main", 24),
    S("data", "data  = ", "data type", 5),
    S("record", "record  where\n  constructor Mk\n  ", "record", 7),
    S("case", "case  of\n  _ => ", "case", 6),
];

const Ocaml: CI[] = [
    ...KW("let rec in fun function match with type module struct sig end open include if then else begin val and or not mutable ref of when as try raise exception class object method inherit new lazy assert while do done for to downto true false external functor constraint nonrec"),
    ...TY("unit int float string bool list array option Some None"),
    F("print_endline", "print_endline ", "Stdlib", 14),
    S("let", "let  = ", "let binding", 4),
    S("letrec", "let rec  =\n  ", "recursive binding", 8),
    S("module", "module  = struct\n  \nend", "module", 7),
    S("type", "type  = ", "type", 5),
    S("match", "match  with\n| _ -> ", "match", 6),
];

const Fsharp: CI[] = [
    ...KW("let rec in fun function match with type module namespace open if then else elif begin end val member and or not mutable ref of when as try raise exception class struct interface inherit new lazy assert while do done for to downto true false yield return use async abstract override static internal public private inline default delegate downcast upcast extern"),
    ...TY("int float string bool list array option Some None unit seq"),
    F("printfn", "printfn ", "Core", 8),
    S("let", "let  = ", "let binding", 4),
    S("module", "module \n\n", "module", 7),
    S("type", "type  =\n  ", "type", 5),
    S("match", "match  with\n| _ -> ", "match", 6),
    S("async", "async {\n    \n}", "async block", 12),
];

const Erlang: CI[] = [
    ...KW("after begin case catch cond end fun if let of receive try when and andalso or orelse not band bor bxor bnot bsl bsr div rem xor module export import define include include_lib record behaviour behavior spec type callback ifdef ifndef endif undef compile vsn"),
    F("io:format", "io:format()", "io", 10),
    S("module", "-module().\n-export([]).\n", "module", 8),
    S("export", "-export([/]).", "export", 10),
    S("fun", "name() ->\n    ok.", "function", 4),
    S("case", "case  of\n    _ -> ok\nend", "case", 6),
    S("receive", "receive\n    _ -> ok\nafter 5000 -> timeout\nend", "receive", 12),
];

const Racket: CI[] = [
    ...KW("define lambda let let* letrec let-values if cond case when unless begin set! quote quasiquote unquote and or not do else define-syntax syntax-rules define-struct struct require provide module for for/list for/fold match define-values parameterize values call/cc error displayln printf #t #f null cons car cdr list map filter foldl foldr true false"),
    S("define", "(define  )", "define", 8),
    S("lambda", "(lambda ()\n  )", "lambda", 9),
    S("let", "(let ([  ])\n  )", "let", 8),
    S("module", "#lang racket\n\n", "racket module", 14),
    S("cond", "(cond\n  [else ])", "cond", 15),
];

const Scheme: CI[] = [
    ...KW("define lambda let let* letrec if cond case when unless begin set! quote quasiquote unquote and or not do else define-syntax syntax-rules call-with-current-continuation call/cc dynamic-wind delay force values error display newline write list cons car cdr map for-each apply #t #f"),
    S("define", "(define  )", "define", 8),
    S("lambda", "(lambda ()\n  )", "lambda", 9),
    S("let", "(let (( ))\n  )", "let", 7),
    S("cond", "(cond\n  (else ))", "cond", 15),
];

const Lisp: CI[] = [
    ...KW("defun defvar defparameter defconstant defmacro defclass defmethod defgeneric defstruct defpackage lambda let let* flet labels if cond case when unless progn prog1 setf setq loop do dolist dotimes return return-from block tagbody go quote function and or not nil t car cdr cons list mapcar format in-package declaim declare the values multiple-value-bind handler-case funcall apply"),
    S("defun", "(defun  ()\n  )", "function", 7),
    S("let", "(let (( ))\n  )", "let", 7),
    S("defclass", "(defclass  ()\n  ())", "class", 10),
    S("loop", "(loop for  in \n      do )", "loop", 11),
];

const Fortran: CI[] = [
    ...KW("program end subroutine function module use implicit none integer real double precision complex character logical dimension parameter allocatable pointer target intent in out inout if then else elseif endif do while enddo select case default where forall call return stop continue contains interface type class public private save common data goto print write read open close format allocate deallocate nullify present true false result recursive pure elemental optional only kind len"),
    S("program", "program \n  implicit none\n  \nend program", "program", 8),
    S("subroutine", "subroutine ()\n  implicit none\n  \nend subroutine", "subroutine", 12),
    S("function", "function () result(res)\n  implicit none\n  \nend function", "function", 10),
    S("do", "do i = 1, \n  \nend do", "do loop", 11),
    S("if", "if () then\n  \nend if", "if", 4),
];

const Cobol: CI[] = [
    ...KW("identification division program-id environment configuration section input-output file-control data working-storage linkage procedure pic picture value move to add subtract multiply divide compute display accept perform until varying times if else end-if evaluate when end-evaluate go stop run call using open close read write fd select assign occurs redefines copy goback exit initialize string unstring inspect set search sort merge by giving from into of is equal greater less than not and or zero spaces comp comp-3 binary filler with no advancing at end"),
    S("program", "IDENTIFICATION DIVISION.\nPROGRAM-ID. .\nPROCEDURE DIVISION.\n    \nSTOP RUN.", "program", 39),
    S("display", "DISPLAY .", "display", 8),
    S("if", "IF \n    \nEND-IF.", "if", 3),
    S("perform", "PERFORM  UNTIL \n    \nEND-PERFORM.", "perform", 8),
];

const Ada: CI[] = [
    ...KW("procedure function package body is begin end declare if then else elsif case when loop while for in out exit return with use type subtype record array of range new access constant null others and or not xor mod rem abs raise exception task entry accept select delay abort goto pragma generic private limited renames separate true false all do terminate requeue protected overriding aliased synchronized interface tagged abstract reverse delta digits at"),
    S("procedure", "procedure  is\nbegin\n   \nend ;", "procedure", 11),
    S("function", "function  return  is\nbegin\n   \nend ;", "function", 10),
    S("package", "package  is\n   \nend ;", "package", 9),
    S("if", "if  then\n   \nend if;", "if", 3),
    S("loop", "for  in  loop\n   \nend loop;", "for loop", 5),
];

const Crystal: CI[] = [
    ...KW("def end class module struct enum if elsif else unless case when while until for in do begin rescue ensure raise return yield break next require include extend property getter setter true false nil self super abstract private protected macro lib fun type alias of as uninitialized with out pointerof sizeof typeof"),
    ...TY("Int32 Int64 String Bool Float64 Array Hash Nil Char Symbol"),
    F("puts", "puts ", "Kernel", 5),
    S("def", "def \n  \nend", "method", 4),
    S("class", "class \n  \nend", "class", 6),
    S("module", "module \n  \nend", "module", 7),
    S("if", "if \n  \nend", "if", 3),
    S("case", "case \nwhen \n  \nend", "case", 6),
];

const Julia: CI[] = [
    ...KW("function end if elseif else while for in do begin let return break continue struct mutable abstract primitive type module baremodule using import export const global local macro quote try catch finally throw where true false nothing missing and or isa new"),
    ...TY("Int Int64 Float64 String Bool Vector Matrix Array Dict Symbol Char"),
    F("println", "println()", "Base", 8),
    F("print", "print()", "Base", 6),
    S("function", "function ()\n    \nend", "function", 10),
    S("module", "module \n\nend", "module", 7),
    S("struct", "struct \n    \nend", "struct", 8),
    S("if", "if \n    \nend", "if", 3),
    S("for", "for item in \n    \nend", "for-in", 13),
];

const Lolcode: CI[] = [
    ...KW("HAI KTHXBYE VISIBLE GIMMEH ITZ HAS A I R AN SUM OF DIFF PRODUKT QUOSHUNT MOD BIGGR SMALLR BOTH EITHER WON NOT SAEM DIFFRINT MAEK IS NOW O RLY YA NO WAI MEBBE OIC WTF OMG OMGWTF IM IN YR OUTTA UPPIN NERFIN TIL WILE HOW IZ FOUND MKAY GTFO NOOB WIN FAIL TROOF NUMBR NUMBAR YARN BUKKIT SMOOSH U SAY SO IF ALL ANY"),
    S("program", "HAI 1.2\n    \nKTHXBYE", "program", 12),
    S("visible", "VISIBLE \"\"", "print", 9),
    S("var", "I HAS A  ITZ ", "variable", 8),
    S("if", "O RLY?\nYA RLY\n    \nNO WAI\n    \nOIC", "conditional", 15),
    S("loop", "IM IN YR LOOP UPPIN YR I TIL BOTH SAEM I AN \n    \nIM OUTTA YR LOOP", "loop", 47),
    S("function", "HOW IZ I  YR \n    \nIF U SAY SO", "function", 9),
];

const LangMap: Record<string, CI[]> = {
    luau:       Luau,
    typescript: Ts,
    javascript: Ts,
    rust:       Rust,
    python:     Python,
    c:          C,
    cpp:        Cpp,
    go:         Go,
    csharp:     Csharp,
    java:       Java,
    sql:        Sql,
    bash:       Bash,
    glsl:       Glsl,
    wgsl:       Wgsl,
    css:        Css,
    html:       Html,
    xml:        Xml,
    json:       Json,
    toml:       Toml,
    yaml:       Yaml,
    markdown:   Markdown,
    kotlin:     Kotlin,
    swift:      Swift,
    dart:       Dart,
    scala:      Scala,
    hlsl:       Hlsl,
    zig:        Zig,
    ruby:       Ruby,
    php:        Php,
    elixir:     Elixir,
    haskell:    Haskell,
    graphql:    Graphql,
    dockerfile: Dockerfile,
    makefile:   Makefile,
    nim:        Nim,
    vlang:      Vlang,
    red:        Red,
    j:          J,
    apl:        Apl,
    factor:     Factor,
    idris:      Idris,
    ocaml:      Ocaml,
    fsharp:     Fsharp,
    erlang:     Erlang,
    racket:     Racket,
    scheme:     Scheme,
    lisp:       Lisp,
    fortran:    Fortran,
    cobol:      Cobol,
    ada:        Ada,
    crystal:    Crystal,
    julia:      Julia,
    lolcode:    Lolcode,
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
    cpp: {
        std: [
            T("string"), T("vector"), T("map"), T("set"), T("array"),
            V("cout", "ostream"), V("cin", "istream"), V("endl", "manipulator"),
            F("make_shared", "make_shared<>()", "(…) → shared_ptr", 12),
            F("make_unique", "make_unique<>()", "(…) → unique_ptr", 12),
            F("move", "move()", "(x) → x&&", 5),
            F("sort", "sort()", "(begin, end)", 5),
            F("find", "find()", "(begin, end, v)", 5),
        ],
    },
    go: {
        fmt: [
            F("Println", "Println()", "(…) → (int, error)", 9),
            F("Printf", "Printf()", "(fmt, …)", 8),
            F("Print", "Print()", "(…)", 7),
            F("Sprintf", "Sprintf()", "(fmt, …) → string", 9),
            F("Errorf", "Errorf()", "(fmt, …) → error", 8),
        ],
        os: [
            F("Open", "Open()", "(name) → (*File, error)", 6),
            F("Create", "Create()", "(name) → (*File, error)", 8),
            F("Exit", "Exit()", "(code)", 6),
            V("Args", "[]string"),
            V("Stdout", "*File"),
            V("Stderr", "*File"),
        ],
    },
    csharp: {
        Console: [
            F("WriteLine", "WriteLine()", "(value)", 10),
            F("Write", "Write()", "(value)", 6),
            F("ReadLine", "ReadLine()", "() → string", 9),
            F("ReadKey", "ReadKey()", "() → ConsoleKeyInfo", 8),
        ],
    },
    java: {
        System: [
            V("out", "PrintStream"),
            V("err", "PrintStream"),
            F("currentTimeMillis", "currentTimeMillis()", "() → long", 18),
            F("exit", "exit()", "(status)", 5),
            F("arraycopy", "arraycopy()", "(src, …)", 10),
        ],
        out: [
            F("println", "println()", "(x)", 8),
            F("print", "print()", "(x)", 6),
            F("printf", "printf()", "(fmt, …)", 7),
        ],
    },
    ruby: {
        File: [
            F("open", "open()", "(path, mode?)", 5),
            F("read", "read()", "(path)", 5),
            F("write", "write()", "(path, data)", 6),
            F("exist?", "exist?()", "(path) -> bool", 7),
        ],
        Array: [
            F("new", "new()", "(size = 0)", 4),
            F("[]", "[]", "literal"),
        ],
        Hash: [
            F("new", "new()", "()", 4),
            F("[]", "[]", "literal"),
        ],
    },
    php: {
        DateTime: [
            F("createFromFormat", "createFromFormat()", "(format, datetime)", 17),
            F("getLastErrors", "getLastErrors()", "()", 14),
        ],
        self: [
            V("class", "class name"),
        ],
        parent: [
            V("class", "class name"),
        ],
    },
    elixir: {
        IO: [
            F("puts", "puts()", "(chardata)", 5),
            F("inspect", "inspect()", "(item, opts)", 8),
            F("read", "read()", "(device, line_or_chars)", 5),
        ],
        Enum: [
            F("map", "map()", "(enumerable, fun)", 4),
            F("filter", "filter()", "(enumerable, fun)", 7),
            F("reduce", "reduce()", "(enumerable, acc, fun)", 7),
        ],
    },
    julia: {
        Base: [
            F("println", "println()", "(xs...)", 8),
            F("print", "print()", "(xs...)", 6),
            F("length", "length()", "(collection)", 7),
            F("push!", "push!()", "(collection, item)", 6),
        ],
    },
    hlsl: {
        Texture2D: [
            F("Sample", "Sample()", "(sampler, location)", 7),
            F("Load", "Load()", "(location)", 5),
            F("GetDimensions", "GetDimensions()", "(...)", 14),
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
    c: {
        printf: { Label: "printf(format, ...)", Parameters: ["format", "..."], ActiveParameter: 0 },
        malloc: { Label: "malloc(size)", Parameters: ["size"], ActiveParameter: 0 },
        memcpy: { Label: "memcpy(dest, src, n)", Parameters: ["dest", "src", "n"], ActiveParameter: 0 },
        memset: { Label: "memset(dest, c, n)", Parameters: ["dest", "c", "n"], ActiveParameter: 0 },
    },
    cpp: {
        printf: { Label: "printf(format, ...)", Parameters: ["format", "..."], ActiveParameter: 0 },
    },
    go: {
        make: { Label: "make(T, size)", Parameters: ["T", "size"], ActiveParameter: 0 },
        append: { Label: "append(slice, elems...)", Parameters: ["slice", "elems..."], ActiveParameter: 0 },
        "fmt.Println": { Label: "fmt.Println(a ...any)", Parameters: ["a ...any"], ActiveParameter: 0 },
        "fmt.Printf": { Label: "fmt.Printf(format, a ...any)", Parameters: ["format", "a ...any"], ActiveParameter: 0 },
    },
    csharp: {
        "Console.WriteLine": { Label: "Console.WriteLine(value)", Parameters: ["value"], ActiveParameter: 0 },
    },
    java: {
        "out.println": { Label: "System.out.println(x)", Parameters: ["x"], ActiveParameter: 0 },
        "out.printf": { Label: "System.out.printf(format, args)", Parameters: ["format", "args"], ActiveParameter: 0 },
    },
    glsl: {
        mix: { Label: "mix(x, y, a)", Parameters: ["x", "y", "a"], ActiveParameter: 0 },
        clamp: { Label: "clamp(x, minVal, maxVal)", Parameters: ["x", "minVal", "maxVal"], ActiveParameter: 0 },
        texture: { Label: "texture(sampler, coord)", Parameters: ["sampler", "coord"], ActiveParameter: 0 },
        smoothstep: { Label: "smoothstep(edge0, edge1, x)", Parameters: ["edge0", "edge1", "x"], ActiveParameter: 0 },
    },
    wgsl: {
        mix: { Label: "mix(e1, e2, e3)", Parameters: ["e1", "e2", "e3"], ActiveParameter: 0 },
        clamp: { Label: "clamp(e, low, high)", Parameters: ["e", "low", "high"], ActiveParameter: 0 },
        textureSample: { Label: "textureSample(t, s, coords)", Parameters: ["t", "s", "coords"], ActiveParameter: 0 },
    },
    kotlin: {
        println: { Label: "println(message)", Parameters: ["message"], ActiveParameter: 0 },
        print: { Label: "print(message)", Parameters: ["message"], ActiveParameter: 0 },
    },
    swift: {
        print: { Label: "print(items, separator, terminator)", Parameters: ["items", "separator", "terminator"], ActiveParameter: 0 },
    },
    dart: {
        print: { Label: "print(object)", Parameters: ["object"], ActiveParameter: 0 },
    },
    scala: {
        println: { Label: "println(x)", Parameters: ["x"], ActiveParameter: 0 },
        print: { Label: "print(x)", Parameters: ["x"], ActiveParameter: 0 },
    },
    hlsl: {
        mul: { Label: "mul(x, y)", Parameters: ["x", "y"], ActiveParameter: 0 },
        lerp: { Label: "lerp(x, y, s)", Parameters: ["x", "y", "s"], ActiveParameter: 0 },
        saturate: { Label: "saturate(x)", Parameters: ["x"], ActiveParameter: 0 },
        "Texture2D.Sample": { Label: "Texture2D.Sample(sampler, location)", Parameters: ["sampler", "location"], ActiveParameter: 0 },
    },
    ruby: {
        puts: { Label: "puts(*objects)", Parameters: ["objects"], ActiveParameter: 0 },
        print: { Label: "print(*objects)", Parameters: ["objects"], ActiveParameter: 0 },
        "File.open": { Label: "File.open(path, mode)", Parameters: ["path", "mode"], ActiveParameter: 0 },
    },
    php: {
        var_dump: { Label: "var_dump(value, ...values)", Parameters: ["value", "values"], ActiveParameter: 0 },
        print_r: { Label: "print_r(value, return = false)", Parameters: ["value", "return"], ActiveParameter: 0 },
        count: { Label: "count(value)", Parameters: ["value"], ActiveParameter: 0 },
    },
    elixir: {
        "IO.puts": { Label: "IO.puts(chardata)", Parameters: ["chardata"], ActiveParameter: 0 },
        "IO.inspect": { Label: "IO.inspect(item, opts)", Parameters: ["item", "opts"], ActiveParameter: 0 },
        "Enum.map": { Label: "Enum.map(enumerable, fun)", Parameters: ["enumerable", "fun"], ActiveParameter: 0 },
    },
    julia: {
        println: { Label: "println(xs...)", Parameters: ["xs"], ActiveParameter: 0 },
        print: { Label: "print(xs...)", Parameters: ["xs"], ActiveParameter: 0 },
        length: { Label: "length(collection)", Parameters: ["collection"], ActiveParameter: 0 },
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
