# Editor Scroll Performance — Profiling Guide

## Opening DevTools in Tauri

Run the dev build, then open the renderer DevTools in either of two ways:

- Right-click anywhere in the window → **Inspect Element**
- Add `devtools: true` to `tauri.conf.json` `windows` config to open it automatically

---

## Recording a Scroll Profile

1. **Performance tab → Record** (circle button, or `Ctrl+E`)
2. Open a large file (3 000+ lines, or paste one into the editor)
3. Scroll rapidly through the file for 3–5 seconds
4. **Stop** the recording

### What to look for

**Main thread** (top lane):

| What you see | Good | Needs work |
|---|---|---|
| Task length during scroll | < 2 ms each | Long yellow bars (> 16 ms) |
| "Scripting" breakdown | Mostly `SetScrollTopPx` / React render | `Tokenize` appearing here |
| Layout/Paint events | Minimal; no forced reflow | Repeated `Recalculate Style` + `Layout` |

**Worker thread** (appears below Main as "Worker"):

| What you see | Meaning |
|---|---|
| `nyx:tokenize [lang]` spans | Off-thread tokenization time |
| Span width < 5 ms | Fast; typical for a ~130-line visible window |
| Spans < 16 ms apart | Worker keeping up with scroll speed |

If `nyx:tokenize` spans are missing from the Worker lane, the worker failed to initialise — check the Console for errors.

---

## Measuring GC Pressure

Frequent garbage collection appears as grey **GC event** bars in the Main thread lane. To get a detailed allocation picture:

1. **Memory tab → Allocation instrumentation on timeline → Start**
2. Scroll the editor for a few seconds
3. **Stop**

Look at the timeline's blue allocation bars. If you see:

```
Scripting:  8 ms
GC:        35 ms
```

the cost is allocations, not computation. Common causes in the editor:

- Large string slices (`FileContent.slice(0, N)`) — eliminated in the optimised build
- Tokenizer producing thousands of `{ Type, Value }` objects per tick — now off-thread

After the optimisations, GC events on the main thread during scroll should be rare and < 1 ms each.

---

## Confirming the Optimisations Worked

Run a before/after comparison by temporarily reverting individual changes and re-recording:

| Optimisation | Before | After |
|---|---|---|
| Worker tokenisation | `Tokenize()` in Main thread scripting | `nyx:tokenize` in Worker lane only |
| LH caching | 2× `getPropertyValue` calls per render | Zero DOM reads during scroll |
| Scroll re-render guard | Re-render every RAF tick | Re-render only when line index changes |
| translateY overlay | Two O(file-size) string allocations + textContent writes per tick | No string allocations for overlay |

---

## Quick Checklist

- [ ] No `Tokenize` calls visible in Main thread flame chart during scroll
- [ ] `nyx:tokenize [lang]` spans appear in Worker lane
- [ ] Main thread tasks during scroll are < 2 ms
- [ ] GC events during scroll are infrequent (< 1 per second)
- [ ] No `Layout` events forced by overlay textContent writes
