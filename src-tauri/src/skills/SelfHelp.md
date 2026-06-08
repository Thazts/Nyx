$1!
# Nyx Self-Help Knowledge Base

This document is a reference for answering user questions about Nyx, its purpose, design decisions, technology choices, and how to get help. All information reflects the intent and reasoning of Thazts, the solo creator of Nyx.

---

## What is Nyx?

Nyx is a desktop IDE designed to centralise the workflow of game developers and 3D artists into a single environment. The problem it solves is a common one in game development: people end up context-switching between a code editor (such as VS Code), a 3D tool (such as Blender), and a game engine (such as Roblox Studio or Unreal Engine). Nyx aims to put code editing, 3D work, and viewport testing all in one place, eliminating that fragmentation.

---

## Who is Nyx For?

Nyx targets developers who value convenience and feel held back by the fragmentation described above, developers who regularly move between multiple tools and want a unified workspace. It is particularly useful for game developers and 3D artists who write code as part of their creative process.

---

## The Timmy Principle

The guiding philosophy behind Nyx's UX and feature design is called the Timmy Principle. Timmy is a hypothetical tech-illiterate user, someone who gets lost in too many dialogs, frustrated by cryptic errors, and confused by unnecessary complexity. A "Timmy-safe" application is one that is blatant, simple, and never makes the user worry about things they don't need to worry about.

Applied to Nyx: while Nyx's users are developers (not literal Timmys), the spirit still applies. Complexity should be hidden where it doesn't need to be visible. Things should just work. Simplicity benefits everyone.

---

## The Name

The name Nyx came to Thazts at 3am. The project already had a clear visual accent colour (#D4B0CC, a soft purple), and that colour led to the thought of a Greek goddess. Nyx is the goddess of night in Greek mythology. The name stuck.

---

## Technology Stack

### Tauri
Tauri was chosen because it is Thazts's home tech stack. Rust is their primary language, and visual design mockups naturally live in web technologies. Electron was rejected because of its inconsistent behaviour and reliability issues. A fully native approach was considered but deprioritised; building a polished native UI is slower and harder to execute well, and speed of development matters for a solo project.

### wgpu (Renderer)
The renderer uses wgpu rather than three.js or a webview-based approach. The webview is significantly less efficient and less customisable than a hand-tuned renderer. The decision between three.js and wgpu came down to engine fidelity: three.js would have been easier to set up but would have required abstracting away engine-specific behaviour. Nyx wants to stay true to the identity of each engine it supports, which requires direct control over how the viewport renders. wgpu provides that.

### Win32 Child HWND
The renderer uses a Win32 child window (HWND) rather than rendering inside the webview. The primary reason is future architecture: if a user ever wants to pop the viewport out into a separate window, a child HWND supports that cleanly whereas a webview-embedded approach would not.

### Luau / Scripting
Nyx's scripting support started with Luau (Roblox's Lua fork) because Thazts is a multi-year Roblox developer and that is the environment they have the deepest experience with. Roblox support was built first so that the foundations could be established on familiar ground. Minor support for C# and C++ in the viewport exists, and support for additional languages and engines will follow. The architecture is designed to expand.

### Rust (Backend)
Rust is Thazts's preferred backend language. It enforces thinking about cause and effect at compile time, which acts as a safety layer for a developer who describes themselves as forgetful. It delivers C++ level performance while making data ownership and memory safety explicit. It is the core of the Tauri backend.

### React (UI)
React was chosen for the frontend because of its large ecosystem and its compatibility with the Thazts App Framework. It is not a particularly ideological choice; it works well and has the support infrastructure the project needs.

---

## Architecture Decisions

### Custom Renderer
A custom renderer was built because Thazts values owning the tools they ship and because of engine identity. Supporting many different game engines in the future requires the ability to deeply customise how each one renders. A shared generic renderer would compromise that. Going custom trades short-term effort for long-term flexibility.

### Thazts App Framework
The Thazts App Framework is an adapted personal coding framework that originated in Roblox development. It focuses on strict data flow, modularity, and clear ownership of state. When it was brought into general software development, Rust with a Tauri layer became the natural foundation.

**One-way data flow** is enforced strictly because when data is passed forward through multiple layers without clear ownership rules, it becomes ambiguous who is responsible for it, especially in languages like Luau where these rules are never enforced by the compiler. The framework resolves this by making data flow in one direction only.

**CSS Modules** are used because they are convenient and cover everything needed without introducing unnecessary complexity.

**No direct `invoke` calls from components** prevents duplicated logic. All data a component needs is either in the StateManager or in the services layer. Components consume state; they do not perform backend operations directly.

---

## AI Integration

### Why AI is Built In
AI is built into Nyx as a first-class feature because the Timmy Principle applies here too; simplicity benefits everyone. Having AI available without setup friction makes it accessible. It is entirely optional: you do not need to configure an API key to use Nyx. A build that excludes AI entirely may be offered in the future for users who prefer it.

### The Skill System
The skill system was added after observing that many models perform poorly at specific domains, particularly frontend design and visual consistency. A skill is essentially a reusable style guide or knowledge document that can be attached to a chat session. Users can build their own skills. The system is conceptually similar to Claude's own skill/tool system; it layers domain-specific guidance on top of the base model.

### Supported Models
Currently Nyx supports Anthropic and DeepSeek. DeepSeek has been the most explored integration and is the one the agent system is most thoroughly tested against. Anthropic support is less fully explored. The integration architecture is intentionally generic, designed so that adding new model providers is straightforward. Support for additional providers will continue as long as they offer API access with standard packaging.

### The Agent and Task Cards
The agent works by generating a high-level plan and then splitting execution into slices of four steps each. Each step is completed in a single request, which triggers the next. If a plan requires more than four steps, it is split into multiple slices that queue sequentially. This structure exists because agents need to handle long-horizon tasks without losing context or coherence. The task card UI reflects this structure; it surfaces the current slice, its four steps, and their completion status in real time as the agent works.

---

## Getting Help & Reporting Issues

- **GitHub repository:** https://github.com/Thazts/Nyx
- **Bug reports and feature requests:** https://github.com/Thazts/Nyx/issues/new
- Both bugs and feature requests go through GitHub Issues. There is no Discord or official forum, and there are no current plans to create one.

---

## Contributing

Nyx is open source under the MIT licence. Contributions are welcome via the GitHub repository. Thazts is currently the sole developer and prefers to remain so unless the project grows to a scale that makes solo maintenance unmanageable. Trusted contributors may be added in the future.

For coding standards: the project uses an opinionated PascalCase convention throughout. The full Thazts App Framework rules are not required knowledge for contributors, but following PascalCase and keeping code clean and modular will align with the project's standards.

---

## Project Status

Nyx has been in active development for approximately two months as of mid-2026. A significant portion of development happened before the first public commit, so the git history understates the actual work done. Development pace is described as sustained and fast, steady sprinting. The project is a solo effort and is currently in active early development.

The definition of "complete" for Nyx would include: support for multiple game engines with easy linking and export, a polished and bug-free code editor, and an established community. That is a long-horizon goal and Thazts intends to continue developing Nyx well past that point.

The one regret named so far: integrating the viewport too early in the development process, prioritising breadth of features over depth and stability of each one.

---

## About Thazts

Thazts is a developer whose background is primarily in Roblox. While few games have been published publicly, the long-term aspiration is to be a game creator; Nyx exists largely for Thazts's own convenience as someone who works across code, 3D, and engines. They care about building tools that are clean, structured, and useful to others. They like PascalCase, and find structure within chaos. They take pride in work that helps people.
