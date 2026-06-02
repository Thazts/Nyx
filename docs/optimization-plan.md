# Editor Scrolling Optimization Plan

Date: 2026-06-02

## Goal
Reduce scroll stutter and frame drops when opening and interacting with very large files by minimizing main-thread work and costly layout/paint updates.

## Summary of root causes
- Heavy synchronous work on the main thread (tokenization/lexing) during scroll.
- Large string writes and DOM updates per frame (pre/post textContent updates).
- Layout/measure thrashing (reading/writing `clientHeight`/`scrollTop` repeatedly).
- Large spacer elements that require full layout/paint.
- Excessive allocations (temporary strings/arrays) on hot paths.

## Prioritized Action Plan
1. Offload tokenization to a Web Worker
   - Move `Tokenize(VisText, Language)` into a worker.
   - Worker: receive visible slice, return tokens asynchronously.
   - Main thread: render tokens only when worker responds; keep UI responsive while tokens load.
   - Minimal message pattern:
     ```js
     // main
     worker.postMessage({ id, text: visText, lang });
     // worker
     onmessage = e => postMessage({ id: e.data.id, tokens: Tokenize(e.data.text, e.data.lang) });
     ```

### Worker versioning and cancellation

This is probably worth doing. Rapid scrolling can enqueue multiple tokenization requests; older requests may finish after newer ones and cause flicker when stale tokens render. Add a lightweight versioning/cancellation scheme:

1. Include a `version` (or `requestId`) and visible range in each worker request:

```js
// main
worker.postMessage({
   version: currentVersion,
   start: visStart,
   end: visEnd,
   text: visText
});
```

2. Worker returns tokens annotated with the same `version`.

3. Ignore stale responses on the main thread:

```js
// main, on worker message
if (msg.version !== currentVersion) return; // stale, ignore
renderTokens(msg.tokens);
```

Without this, you can get the following interleaving which causes flicker:

```
scroll
scroll
scroll
worker finishes old job
old tokens render
worker finishes new job
new tokens render
```

Versioning/cancellation prevents stale token sets from overwriting newer renders and keeps the UI visually stable during fast interactions.


2. Avoid updating large text nodes on every RAF tick
   - Only update `PreRef.textContent` and `PostRef.textContent` when `VisStart`/`VisEnd` actually change.
   - Cache previous `VisStart/VisEnd` values and skip updates when unchanged.

3. Use translateY for virtualized content instead of huge spacer heights
   - Render only visible content inside a small inner container.
   - Position the inner container with `transform: translateY(VisStart * lineHeight)` to avoid layout.
   - This is the approach used by `react-window`/`react-virtualized`.

4. Batch DOM reads and writes; tighten RAF usage
   - Read `scrollTop`/`clientHeight` once per RAF and reuse.
   - Compute `VisStart/VisEnd` from cached `LH` (line height) computed on mount or settings change.
   - Avoid calling `getComputedStyle` or `parseFloat` in hot paths.

5. Reduce allocations on hot paths
   - Reuse arrays or typed arrays where possible.
   - Avoid repeated slicing of large strings during scroll; derive visible slices by index ranges.

6. Profile to confirm bottleneck before/after changes
   - Use Chrome/Edge DevTools Performance recording.
   - Look for long scripting tasks (tokenize) vs layout/paint costs.

## Tactical patches to apply (small, incremental)
- Create `src/services/tokenizer.worker.ts` and wire a tiny message protocol.
- In `EditorArea`, call the worker for `VisText` and render tokens from worker result.
- In `HighlightOverlay`, replace full pre/post text writes with a small inner container translated by `VisStart*LH`.
- Add guards to skip `textContent` updates unless `VisStart/VisEnd` changed.
- Cache line height `LH` on mount and update on settings changes.

## When to use existing libraries
- If you prefer fewer maintenance burdens, adopt `react-window` for list virtualization. For a code editor overlay (token-based), tailor-made solution + worker is recommended.

## Testing & Validation
- Automate a smoke test that opens a large file and records smooth scroll (manual verification initially).
- Profile before/after and confirm main-thread scripting time reduced and frame times under 16ms.

## Measure GC pressure

Given the heavy string operations in the editor, it's important to measure GC pressure as part of profiling. Specifically capture an Allocation Timeline:

```
Performance
→ Memory
→ Allocation Timeline
```

If you see a pattern like:

```
Scripting: 8ms
Garbage Collection: 35ms
```

then the issue is likely temporary allocations rather than the raw computation time. Common culprits are `substring().split()` and other string-heavy operations that churn memory and force frequent GC pauses. Optimize by reducing allocations (reuse buffers, avoid large intermediate strings, or move heavy string work off-thread).

## Next steps I can take
- Implement the Web Worker and main-thread glue (I can scaffold this).
- Replace the spacer with a translateY inner container in `HighlightOverlay` / `EditorArea`.
- Add a short profiling README with instructions to capture performance traces.


---

Notes: keep changes incremental; verify performance after each step to isolate improvements.
