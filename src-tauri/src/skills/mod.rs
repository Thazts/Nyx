pub struct Skill {
    pub id:      &'static str,
    pub label:   &'static str,
    pub domain:  &'static str,
    pub when:    &'static str,
    content: &'static str,
}

pub struct SkillBlock {
    pub label:          &'static str,
    pub domain:         &'static str,
    pub content:        String,
    pub classification: u8,
}

pub struct ResolveResult {
    pub loaded:  Vec<SkillBlock>,
    pub blocked: Vec<(String, &'static str)>,
}

fn ParseClassificationOwned(content: &str) -> (u8, String) {
    for (marker, class) in &[("$1!", 1u8), ("$2!", 2u8), ("$3!", 3u8)] {
        if let Some(rest) = content.strip_prefix(marker) {
            return (*class, rest.trim_start_matches(['\r', '\n']).to_string());
        }
    }
    (3, content.to_string())
}

fn ScanForInjection(content: &str) -> Option<&'static str> {
    let lower = content.to_lowercase();
    let triggers: &[(&str, &'static str)] = &[
        ("ignore previous instructions",        "instruction override"),
        ("ignore the above instructions",       "instruction override"),
        ("ignore all previous",                 "instruction override"),
        ("disregard the above",                 "instruction override"),
        ("disregard all previous",              "instruction override"),
        ("forget everything above",             "instruction override"),
        ("forget all previous instructions",    "instruction override"),
        ("override your instructions",          "instruction override"),
        ("override this system prompt",         "instruction override"),
        ("supersede this system prompt",        "instruction override"),
        ("you are now",                         "identity override"),
        ("your new role is",                    "identity override"),
        ("your true identity",                  "identity override"),
        ("pretend you are",                     "identity override"),
        ("act as if you are",                   "identity override"),
        ("new persona:",                        "identity override"),
        ("<system>",                            "prompt injection marker"),
        ("[system]",                            "prompt injection marker"),
        ("[system prompt]",                     "prompt injection marker"),
        ("<|im_start|>",                        "prompt injection marker"),
        ("<|endoftext|>",                       "prompt injection marker"),
        ("### instruction",                     "prompt injection marker"),
    ];
    for (trigger, category) in triggers {
        if lower.contains(trigger) {
            return Some(category);
        }
    }
    None
}

fn SkillsDir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("skills")))
        .unwrap_or_else(|| std::path::PathBuf::from("skills"))
}

pub fn LoadContent(skill: &Skill) -> String {
    let path = SkillsDir().join(format!("{}.md", skill.label));
    match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => skill.content.to_string(),
    }
}

pub static FENGSHUI_PROTOCOL: Skill = Skill {
    id:      "fengshui_protocol",
    label:   "FengshuiProtocol",
    domain:  "visual design and frontend UI",
    when:    "designing, reviewing, or debugging any UI layout, CSS, animations, component styling, or visual hierarchy",
    content: include_str!("../../skills/FengshuiProtocol.md"),
};

pub static SELF_HELP: Skill = Skill {
    id:      "self_help",
    label:   "SelfHelp",
    domain:  "Nyx project knowledge and support",
    when:    "answering questions about Nyx, its architecture, technology choices, design decisions, or where to get help",
    content: include_str!("../../skills/SelfHelp.md"),
};

pub static LUA_LUAU: Skill = Skill {
    id:      "lua_luau",
    label:   "LuaLuau",
    domain:  "Lua and Luau programming, including Roblox development patterns",
    when:    "writing, reviewing, or debugging Lua or Luau code, especially in a Roblox context",
    content: include_str!("../../skills/LuaLuau.md"),
};

pub static VIEWPORT_MANUAL: Skill = Skill {
    id:      "viewport_manual",
    label:   "ViewportManual",
    domain:  "Nyx viewport — opening, engine detection, physics profiles, and runtime scripting",
    when:    "working with the Nyx viewport, opening scenes, writing viewport scripts, or understanding physics profiles and engine modes",
    content: include_str!("../../skills/ViewportManual.md"),
};

pub static ALL: &[&Skill] = &[&FENGSHUI_PROTOCOL, &SELF_HELP, &LUA_LUAU, &VIEWPORT_MANUAL];

pub fn Resolve(ids: &[String]) -> ResolveResult {
    let mut loaded  = Vec::new();
    let mut blocked = Vec::new();
    for id in ids {
        match ALL.iter().find(|s| s.id == id.as_str()) {
            None => {}
            Some(skill) => {
                let raw = LoadContent(skill);
                let (classification, content) = ParseClassificationOwned(&raw);
                match ScanForInjection(&content) {
                    None         => loaded.push(SkillBlock { label: skill.label, domain: skill.domain, content, classification }),
                    Some(reason) => blocked.push((id.clone(), reason)),
                }
            }
        }
    }
    ResolveResult { loaded, blocked }
}
