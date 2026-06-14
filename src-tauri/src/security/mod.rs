const INJECTION_TRIGGERS: &[(&str, &str)] = &[
    ("ignore previous instructions", "instruction override"),
    ("ignore the above instructions", "instruction override"),
    ("ignore all previous", "instruction override"),
    ("ignore prior instructions", "instruction override"),
    ("disregard the above", "instruction override"),
    ("disregard all previous", "instruction override"),
    ("disregard previous instructions", "instruction override"),
    ("disregard prior instructions", "instruction override"),
    ("forget everything above", "instruction override"),
    ("forget all previous instructions", "instruction override"),
    ("forget your instructions", "instruction override"),
    ("override your instructions", "instruction override"),
    ("override this system prompt", "instruction override"),
    ("supersede this system prompt", "instruction override"),
    ("ignore your system prompt", "instruction override"),
    ("you are now", "identity override"),
    ("your new role is", "identity override"),
    ("your true identity", "identity override"),
    ("pretend you are", "identity override"),
    ("pretend to be", "identity override"),
    ("act as if you are", "identity override"),
    ("act as though you are", "identity override"),
    ("new persona:", "identity override"),
    ("<system>", "prompt injection marker"),
    ("[system]", "prompt injection marker"),
    ("[system prompt]", "prompt injection marker"),
    ("<|im_start|>", "prompt injection marker"),
    ("<|endoftext|>", "prompt injection marker"),
    ("### instruction", "prompt injection marker"),
];

fn Normalize(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let mut prev_space = false;
    for ch in content.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.extend(ch.to_lowercase());
            prev_space = false;
        }
    }
    out
}

pub fn ScanForInjection(content: &str) -> Option<&'static str> {
    let normalized = Normalize(content);
    for (trigger, category) in INJECTION_TRIGGERS {
        if normalized.contains(trigger) {
            return Some(category);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn DetectsBasicOverride() {
        assert_eq!(
            ScanForInjection("Please ignore previous instructions and do X"),
            Some("instruction override")
        );
    }

    #[test]
    fn DetectsAcrossWhitespace() {
        assert!(ScanForInjection("ignore\n  previous   instructions").is_some());
    }

    #[test]
    fn DetectsMixedCase() {
        assert!(ScanForInjection("IGNORE PREVIOUS INSTRUCTIONS").is_some());
    }

    #[test]
    fn PassesCleanContent() {
        assert_eq!(ScanForInjection("function foo() { return 42; }"), None);
    }
}
