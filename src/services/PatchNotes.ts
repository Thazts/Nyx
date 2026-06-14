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
    { Tag: "active",   Text: "Bug fixes in the new renderer surface"              },
    { Tag: "active",   Text: "Updating and expanding the renderer and scene APIs" },
    { Tag: "active",   Text: "Fixing an FPS regression in the viewport"           },
    { Tag: "longterm", Text: "Godot engine integration"                           },
];

export const PATCH_NOTES: PatchEntry[] = [
    {
        Version: "0.3.2",
        Date: "14/6/2026",
        Unix: 1781395200,
        Major: true,
        Focus: "PERF",
        Changes: [
            { Tag: "new",    Text: "Started work on Charon, a new subsystem for syncing files between engines and Nyx" },
            { Tag: "new",    Text: "Added smooth 60 FPS tweens to the runtime"                                         },
            { Tag: "fix",    Text: "Fixed several renderer bugs, including how complex objects are rendered"           },
            { Tag: "perf",   Text: "Reduced stuttering and frame rate drops in the viewport"                           },
            { Tag: "change", Text: "Improved the Unity and Unreal runtime shims"                                       },
            { Tag: "change", Text: "Restricted Agentic mode on OpenAI and Anthropic; DeepSeek keeps every mode"        },
        ],
    },
    {
        Version: "0.3.0",
        Date: "11/6/2026",
        Unix: 1781136000,
        Major: true,
        Focus: "NEW",
        Changes: [
            { Tag: "new",    Text: "Notes panel with task tracking and optional GitHub Issues sync"               },
            { Tag: "new",    Text: "Search and replace across the editor and sidebar"                             },
            { Tag: "new",    Text: "3D object file support, drag-drop or open .obj, .fbx, .gltf, .glb, and more" },
            { Tag: "new",    Text: "Complex object loading with multi-mesh, material, and hierarchy support"      },
            { Tag: "new",    Text: "Ask rate limit timer keeps agentic AI flows alive during API cooldowns"       },
            { Tag: "new",    Text: "Completion engine with multi-language support"                                },
            { Tag: "change", Text: "Refined AI features with improved context and response handling"              },
            { Tag: "change", Text: "Refined animation system with smoother and more consistent transitions"       },
        ],
    },
    {
        Version: "0.2.2",
        Date: "8/6/2026",
        Unix: 1780876800,
        Major: true,
        Focus: "NEW",
        Changes: [
            { Tag: "new",    Text: "Find and replace in the search bar and editor area"                                                       },
            { Tag: "new",    Text: "Diagnostics for unmatched brackets, invalid JSON, Luau missing closes, and trailing whitespace"           },
            { Tag: "new",    Text: "Diagnostic and dirty-line gutter markers with scroll-track indicators"                                    },
            { Tag: "new",    Text: "Member completions for Luau/Roblox, TypeScript/JavaScript, Rust, and Python contexts"                     },
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
            { Tag: "change", Text: "Rewrote AI integration layer with improved context handling"                        },
            { Tag: "new",    Text: "OpenAI provider support alongside existing backends"                                },
            { Tag: "perf",   Text: "Chunked streaming for providers with tight input/output token limits"               },
            { Tag: "perf",   Text: "Reduced redundant prompt tokens on repeated AI edits"                               },
            { Tag: "new",    Text: "Expanded viewport API surface; object parenting, transforms, and material bindings" },
            { Tag: "fix",    Text: "Viewport scene reload no longer flickers on live Luau edits"                        },
            { Tag: "perf",   Text: "Renderer command batching for larger scenes"                                        },
        ],
    },
];
