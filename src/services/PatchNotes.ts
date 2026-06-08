export interface PatchChange {
    Tag: "new" | "fix" | "change" | "perf";
    Text: string;
}

export interface PatchEntry {
    Version: string;
    Date: string;
    Unix: number;
    Major: boolean;
    Focus: "NEW" | "FIX" | "PERF" | "CHANGE";
    Changes: PatchChange[];
}

export interface RoadmapItem {
    Tag: "active" | "longterm";
    Text: string;
}

export const ROADMAP: RoadmapItem[] = [
    { Tag: "active",   Text: "Better viewport support for Unity and Unreal engines" },
    { Tag: "active",   Text: "Bug fixes across Unity and Unreal viewport integration" },
    { Tag: "active",   Text: "Physics parity, making each engine behave closer to native" },
    { Tag: "active",   Text: "Improved gizmo and object editing tools" },
    { Tag: "longterm", Text: "Godot engine integration" },
];

export const PATCH_NOTES: PatchEntry[] = [
    {
        Version: "0.2.2",
        Date: "8/6/2026",
        Unix: 1780876800,
        Major: true,
        Focus: "NEW",
        Changes: [
            { Tag: "new",    Text: "Find and replace in the search bar and editor area" },
            { Tag: "new",    Text: "Diagnostics for unmatched brackets, invalid JSON, Luau missing closes, and trailing whitespace" },
            { Tag: "new",    Text: "Diagnostic and dirty-line gutter markers with scroll-track indicators" },
            { Tag: "new",    Text: "Member completions for Luau/Roblox, TypeScript/JavaScript, Rust, and Python contexts" },
            { Tag: "new",    Text: "Signature help for common calls: print(), Vector3.new(), useState(), console.log(), println!(), and more" },
            { Tag: "new",    Text: "Unsaved diff gutter based on disk content with completion support for Luau, TypeScript, Rust, and Python" },
        ],
    },
    {
        Version: "0.2.0",
        Date: "1/6/2026",
        Unix: 1780272000,
        Major: true,
        Focus: "CHANGE",
        Changes: [
            { Tag: "change", Text: "Rewrote AI integration layer with improved context handling" },
            { Tag: "new",    Text: "OpenAI provider support alongside existing backends" },
            { Tag: "perf",   Text: "Chunked streaming for providers with tight input/output token limits" },
            { Tag: "perf",   Text: "Reduced redundant prompt tokens on repeated AI edits" },
            { Tag: "new",    Text: "Expanded viewport API surface; object parenting, transforms, and material bindings" },
            { Tag: "fix",    Text: "Viewport scene reload no longer flickers on live Luau edits" },
            { Tag: "perf",   Text: "Renderer command batching for larger scenes" },
        ],
    },
];
