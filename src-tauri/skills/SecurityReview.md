$2!
# Security Review

Apply this when reviewing code, a design, or a change for security. A security review is not a linter pass and it is not a checklist you tick off. It is an adversarial exercise: you take what exists and you attack it with *what-ifs* until the dangerous ones stop having good answers. The what-ifs that have no clean answer are your findings.

This skill describes how to run that exercise well, what good security actually looks like, and how to report it so it gets fixed.

---

## The Core Method: Attack With What-Ifs

A real attacker does not read your code politely top to bottom. They ask "what happens if I do the thing you didn't expect?" Your job in a review is to be that attacker against your own system, on purpose, before someone else is.

So the loop is:

1. **Pick a thing.** A function, a boundary, a piece of data, a privilege.
2. **Ask "what if" against it.** What if this input is hostile? What if this escapes where it's supposed to live? What if this runs twice, or never, or out of order?
3. **Trace the answer honestly.** Follow it through the real code. Don't stop at "that probably can't happen" — prove it can't, or admit it can.
4. **If the answer is bad and you can't rule it out, it's a finding.** If the answer is "the system stops it here, structurally," note *why* and move on.

The skill is in generating good what-ifs. Examples in the spirit of this codebase:

- *What if the Lua script leaks out of the scene renderer?* — Can a script reach the filesystem, the network, the host process, other scenes? Is the sandbox a real boundary or just a convention?
- *What if a tool result the AI reads contains instructions instead of data?* — Does the model treat it as data, and more importantly, even if it doesn't, what's the worst the tooling lets it do?
- *What if `path` is `../../../../Windows/System32`?* — Does the workspace confinement canonicalize before or after it trusts the path?
- *What if the file doesn't exist yet?* — Does the "write" path validate differently from the "read" path, and is the weaker check the one that matters?
- *What if two of these run at once?* — Race between check and use (TOCTOU), shared mutable state, a lock that's held in one path and not another.

Generate these by walking the boundaries, not the features. Features are what the system is *supposed* to do; boundaries are where it breaks.

---

## Where To Aim The What-Ifs

Good what-ifs cluster around a handful of places. Walk these deliberately.

### Trust Boundaries
Every place data or control crosses from "I control this" to "I don't" (or vice versa). User input, file contents, network responses, IPC messages, command output, anything an embedded script or model produces. **The single most productive question in any review is: where is the boundary, and what crosses it?** Most real vulnerabilities are a boundary that someone forgot was a boundary.

### Inputs
For every input: what's the worst legal value? The worst *illegal* value that still gets through? Empty, enormous, negative, unicode, path separators, null bytes, control characters, deeply nested, self-referential. Don't ask "is it validated" — ask "what does the validation actually reject, and what slips past it?"

### Privilege & Capability
What can this code do that the caller shouldn't be able to reach? Filesystem, process spawning, network, credentials, other users' data. Then: can the caller *steer* it there? A function that runs a command is only as safe as the narrowest thing it will agree to run.

### State & Sequencing
What if it runs out of order, twice, concurrently, or partway and then fails? Check-then-act gaps, partial writes that leave a half-valid state, cleanup that doesn't run on the error path, locks that protect one access pattern but not another.

### Secrets & Sensitive Data
Where do keys, tokens, and PII live, and where do they *travel*? Logs, error messages, crash dumps, the clipboard, telemetry, a tool result that gets fed back into a model's context. A secret in an error string is still a leaked secret.

### Failure Modes
What does it do when something goes wrong? Fail closed (deny) or fail open (allow)? An auth check that returns `true` on an unexpected error is worse than no check, because it looks like one.

---

## What Good Security Actually Looks Like (Opinions)

These are the principles I weigh findings against. They're opinionated on purpose.

**Bound the blast radius; assume the layer above will fail.** You will not make any single layer perfect. Assume the input validator misses something, assume the model gets jailbroken, assume the sandbox has a hole. The question that matters is: *when* that happens, how much damage is possible? Security that survives a failed assumption is the only kind worth trusting. A jailbroken model that still can't read outside the workspace is a win even though the jailbreak "succeeded."

**Know which layer you own.** Some risks are genuinely yours and some belong to a component you don't control. If you ship tooling on top of a model, the model's susceptibility to a clever prompt is largely the model's property — you can nudge it, you cannot guarantee it. What *is* yours is the capability layer: making sure that even a fully-cooperating-with-the-attacker model can't do anything catastrophic. Spend your effort where you own the outcome. Don't build elaborate detection for a risk whose real fix is "remove the dangerous capability."

**Prefer structural mitigations over detection.** A check that *prevents* a class of bug (a type that can't represent an invalid state, a path that's canonicalized and confined, a capability that simply isn't granted) beats a check that *detects* known-bad patterns. Blocklists are porous by nature — they catch yesterday's attack. Use detection as defense-in-depth, never as the boundary.

**Fail closed.** When in doubt, deny. Default-deny allowlists beat default-allow blocklists. Errors should land in the safe state, not the permissive one.

**Least privilege, narrow interfaces.** Code should be able to do the smallest thing that satisfies its job. A narrow interface ("write this file inside the workspace") is reviewable; a broad one ("run this string") is a permanent liability you have to re-audit forever.

**Don't do security theater.** A mitigation that looks reassuring but doesn't actually raise the cost of the attack is worse than nothing, because it spends trust and attention. If a control is defense-in-depth, *say so* and don't treat it as the boundary. Be honest about what a measure does and doesn't buy.

**Severity is impact × reachability.** A scary bug an attacker can't reach is low priority. A boring bug on the front door is high. Always rate a finding by both: how bad is it if exploited, and how hard is it to actually trigger?

---

## Running The Review

1. **Map the boundaries first.** Before reading logic, sketch where untrusted data enters and where privileged actions happen. This is your attack map.
2. **Walk each boundary with what-ifs.** Generate the hostile scenarios. Trace each through the real code — open the files, follow the calls. A what-if you didn't trace to ground is a guess, not a finding.
3. **Separate proven from suspected.** Say plainly which findings you confirmed by reading the code and which are hypotheses you couldn't fully rule out. Don't dress up a hunch as a confirmed hole, and don't bury a real one in hedging.
4. **Rate each finding** by impact and reachability.
5. **Propose the structural fix** where one exists, not just a patch over the symptom.

---

## Reporting Findings

For each finding, give:

- **What:** the issue, in one line.
- **Where:** `file:line` — concrete, clickable.
- **The what-if:** the scenario that exposes it ("if an attacker passes X, then Y because Z").
- **Impact × reachability:** how bad, and how hard to trigger. Be honest if reachability is low.
- **Fix:** the recommended change, structural where possible.

End with an honest bottom line: what's solid, what's the highest-priority thing to fix, and what you *couldn't* fully verify. A review that pretends to be complete when it isn't is itself a security risk — it creates false confidence. If you ran out of time or hit something you couldn't trace, say so.
