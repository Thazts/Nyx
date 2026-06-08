$2!
# FengshuiProtocol — Visual Design System

Apply these rules to every UI you produce. They override default instincts and fix the most common AI design failures.

---

## 1. Regions Before Elements

Map the viewport into named zones before placing anything. Do not start with elements.

- **Background zone**, root canvas; must always have an explicit background-color
- **Navigation zone**, sidebar, topbar, or rail; runs full height or width of its axis
- **Content zone**, main area; gets flex:1 or grid to fill remaining space
- **Action zone**, buttons, inputs, toolbars anchored to a defined surface

Never place an element without assigning it to a region. A button floating in empty space has no region; that is an unfinished design, not a placeholder. Define zones first in CSS using Grid or Flexbox on the root layout, then populate them.

**Common failure to avoid:** stacking everything vertically in the center of a blank page. That is a document, not an app. Assign elements to regions; regions tile the viewport.

**Sides-filling rule:** After defining regions, the second most common failure is leaving both sides of the page empty with all content collapsed into a narrow center column. Wide viewports must use their width. Apply these patterns:
- App layouts with navigation: sidebar (fixed width) + content area (flex: 1, full remaining width). Do not center the content inside the content area unless it is long-form reading text.
- Dashboard or card layouts: CSS Grid with `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`, cards fill the row.
- Two-column layouts: `display: grid; grid-template-columns: 1fr 1fr` or `2fr 1fr` — use the full width, not a 600px centered box.
- Full-bleed sections: hero, banner, and section backgrounds should span `width: 100%`, not a max-width container.
- Reserve `max-width` containers only for long-form prose columns (body copy beyond ~70ch becomes hard to read). For everything else, fill the space.

---

## 2. Weight and Balance

Every visual element has weight: large is heavy, small is light; high-contrast and bold text are heavier; saturated color is heavier than muted.

**The top-center cluster with empty bottom is the most common AI layout failure.** A big heading, a card, then nothing — top-heavy and visually abandoned.

Rules:
- Heavy content at the top must be counterbalanced by anchored content filling the remaining height
- The page must not end halfway down; content zone always fills remaining viewport height (min-height: 100vh or flex: 1 on the root)
- Spread controls spatially across the canvas — one centered button surrounded by empty space is not a design
- Balance is not symmetry; a wide content area can balance a narrow sidebar

---

## 3. Type Scale

All font sizes derive from one scale. Never write arbitrary pixel sizes.

**Base: 16px · Ratio: 1.25 (Major Third)**

Define on :root:

```css
:root {
    --text-xs:  13px;
    --text-sm:  16px;
    --text-md:  20px;
    --text-lg:  25px;
    --text-xl:  31px;
    --text-2xl: 39px;
    --text-3xl: 49px;
}
```

Use only these values for font-size. Never write 14px, 18px, 22px, 28px, 36px — those are off-scale and produce visual jank between heading sizes.

Line height: 1.3 for display text (lg and above), 1.5 for body (sm/md), 1.4 for UI labels (xs).

---

## 4. Motion

Three tiers. Know which applies before adding any animation.

**Tier 1, Micro (always include; feels wrong if absent)**
- Hover: `transition: background 120ms ease-out, color 120ms ease-out, border-color 120ms ease-out`
- Focus ring: `transition: box-shadow 100ms ease`
- Button press: `transform: scale(0.97)` on `:active` — no transition, instant feel is correct
- Selection/active state color changes: 120ms ease

**Tier 2, Contextual (on meaningful content or state changes)**
- Panel entering: `opacity 0→1` + `transform: translateX(-8px)→0`, 220ms `cubic-bezier(0.2, 0, 0, 1)`
- Dialog/overlay: opacity 0→1, 180ms ease; backdrop 150ms ease
- List item appearing: opacity 0→1 + translateY(4px)→0, 200ms ease-out, stagger 30ms per item
- Height expand (accordion): 250ms ease-out
- Loading shimmer: 1.4s infinite linear gradient sweep

**Tier 3, Decorative (only for Rich & layered or Editorial registers)**
- Floating background elements, hero gradient animation, entrance animations on first load (once only, under 400ms)
- Use sparingly; decorative motion must serve the design, not demonstrate capability

**Never use:**
- Bounce easing on hover (cheap and toylike)
- Marquee or auto-scrolling text
- Spinning animations on non-loading elements
- Animation on every scroll event (motion sickness risk)
- Spinner-only loading without skeleton content structure

---

## 5. Entrance and Presence

Nothing should simply appear. The moment any element becomes visible — on page load, when content loads dynamically, when a panel opens, when items are added to a list — it must animate in. Static appearance (opacity instantly 1, no transform, no transition) reads as broken or undesigned. This is one of the clearest signals that a UI was generated rather than designed.

**Page load**
The root content container fades and lifts in on mount: `opacity 0 → 1` + `transform: translateY(10px) → translateY(0)`, 280ms ease-out, triggered once via a CSS class added after mount. Major sections can stagger by 40ms each.

**Panels and drawers**
Always animate from their natural edge. A left sidebar slides from `translateX(-100%)`. A right panel slides from `translateX(100%)`. A bottom sheet slides from `translateY(100%)`. Duration: 240ms `cubic-bezier(0.2, 0, 0, 1)`. Never fade a panel that has a clear directional origin.

**Modals and overlays**
Fade in `opacity 0 → 1` + `scale(0.96) → scale(1)`, 180ms ease-out. Backdrop fades separately at 150ms ease. On dismiss, reverse the animation before removing from DOM — use `animationend` or a CSS class toggle. A modal that simply disappears on close is unfinished.

**Dynamic list items**
Items that appear after load (API data, filtered results, new entries) animate in: `opacity 0 → 1` + `translateY(6px) → 0`, 200ms ease-out, stagger 25ms per item. Never have items pop in at full opacity simultaneously.

**Images and media**
Fade in on load: `opacity 0 → 1`, 220ms ease. For below-fold content use IntersectionObserver to trigger the entrance when the element enters the viewport.

**Skeleton to content**
Show a skeleton immediately, then cross-fade to real content: skeleton fades out as content fades in, 180ms ease. Never flash from skeleton to content in a single frame.

**Exits mirror entries**
Elements that leave should animate out before DOM removal. Modals scale down and fade. Panels slide back. List items shrink and fade. Use `animation-fill-mode: forwards` and remove after `animationend`.

**What broken looks like:** opacity: 1 with no transition on dynamic content; elements that appear full-size and full-opacity in one frame; content that jumps layout when siblings load; a modal that vanishes instantly on close.

---

## 6. Design Register — Ask Before Building

Before writing any code for a new interface, use ask_user with these three questions. Ask once at the start of the design session. Do not ask mid-implementation.

Question 1: "What visual style should this use?"
- Minimal & refined (clean, generous whitespace, restrained color)
- Rich & layered (depth, gradients, subtle textures, expressive motion)
- Editorial & typographic (type-driven, refined serif, publication feel)
- Technical & dense (compact, data-forward, monospace elements)

Question 2: "What color direction?"
- Dark theme
- Light theme
- System preference (prefers-color-scheme)

Question 3: "How much motion?"
- Subtle (Tier 1 only)
- Expressive (Tier 1 + 2, selective Tier 3)
- None (static only)

Commit to the answers and execute. Do not re-ask mid-task.

---

## 7. No Emojis

Never use emoji characters (🔥 ✅ 📁 ⚡ etc.) in UI text, button labels, navigation items, headings, tooltips, or any visible interface copy. Emojis make interfaces look unofficial and unserious. Use SVG icons or CSS-defined symbols when iconography is needed.

---

## 8. Spatial Grid

All spacing values (padding, margin, gap) must be multiples of 8:

`4 · 8 · 16 · 24 · 32 · 40 · 48 · 64 · 80 · 96px`

4px is acceptable for micro-spacing inside tight components. Never use arbitrary values like 7px, 11px, 18px, 22px for spacing — the grid creates consistency automatically.

---

## 9. Design Materials

Named material references for aesthetic direction. When the user names a material or the design register implies one, apply its full set of properties consistently — surface, type, motion, color, and detail together. A material applied halfway reads as neither itself nor anything else.

---

### Paper
Evokes: study, documentation, editorial credibility, the weight of reference.
Surfaces: off-white or cream (#f5f0e8, #fdf8f0), matte, no gloss or glow. Slight warmth in the white.
Typography: serif — EB Garamond, Cormorant Garamond, Libre Baskerville. Body text in near-black (#1a1a1a). Generous line height (1.6+). Generous margins.
Motion: minimal. Slow fades only. Nothing bouncy or energetic. The paper does not move.
Colors: warm neutrals throughout. One ink-dark accent. No bright or saturated color.
Details: subtle drop shadow on cards suggesting physical lift off the page. Horizontal rules as section dividers. Justified or left-aligned text blocks, never centered prose.

---

### Chrome
Evokes: precision instruments, premium technology, polished hardware, Apple-era sheen.
Surfaces: metallic gradient panels (silver-to-white or dark-steel), high contrast, glass-like reflections implied by gradient overlays.
Typography: tight geometric sans — Inter, Geist, DM Sans. Tight letter-spacing on headings (-0.02em). Numbers in tabular figures.
Motion: smooth, fluid, satisfying physics. `cubic-bezier(0.4, 0, 0.2, 1)`. Long easing tails. Hover states shift a subtle gradient to simulate light reflection.
Colors: steel greys, cool whites, near-black. One accent that reads like polished metal — deep blue, gunmetal, or silver-white.
Details: 1px highlight on card top edges (`border-top: 1px solid rgba(255,255,255,0.15)`). Radial gradient overlay for the sheen on primary surfaces. Background uses very subtle noise or grain texture to avoid flat plastic feel.

---

### Neon
Evokes: cyberpunk, night city, arcades, underground culture, electric energy.
Surfaces: deep dark background mandatory — near-black with a blue or purple tint (#080810, #0a0a0f, #0d0b1a). Content floats on darkness.
Typography: monospace or condensed geometric — JetBrains Mono, Geist Mono, Rajdhani, Orbitron. Uppercase or compressed headings. Glow on accent text.
Motion: flicker (subtle keyframe opacity pulse on accent elements: 100%→95%→100%, 3s infinite), hard cuts between states, pulse animations on active/live indicators.
Colors: one or two saturated neon accents against the dark base — electric cyan (#00f5ff), hot pink (#ff0090), acid green (#39ff14), or violet (#c800ff). Never mix more than two neon hues. The rest is dark neutral.
Details: `text-shadow: 0 0 10px currentColor, 0 0 30px currentColor` on neon text. `box-shadow: 0 0 16px rgba(0,245,255,0.4)` on active/focused elements. Optional scanline texture overlay at low opacity (3–5%).

---

### Glass
Evokes: airiness, modernity, premium translucence, depth without physical weight.
Surfaces: `backdrop-filter: blur(20px) saturate(1.8)`, semi-transparent panels (rgba(255,255,255,0.08) on dark; rgba(255,255,255,0.6) on light). The content behind bleeds through and becomes part of the palette.
Typography: clean light-weight sans — Inter, Plus Jakarta Sans, Nunito. Medium or regular weight. Content must remain legible against variable backgrounds.
Motion: blur-in on overlays appearing (`backdrop-filter` transitions, 200ms ease). Smooth entry from edge. Elements glide.
Colors: palette is largely defined by what shows through the glass. Accent is typically a cool blue, soft purple, or clean white. Avoid heavy saturated fills on glass panels.
Details: 1px border with `rgba(255,255,255,0.12)` for edge catch on glass panels. Inner glow: `box-shadow: inset 0 1px 0 rgba(255,255,255,0.1)`. Works best over a rich, colorful or blurred background image.

---

### Velvet
Evokes: luxury, theatre, occasions, richness, warmth, the feeling of something precious.
Surfaces: deep jewel-tone backgrounds — midnight navy (#0d0d2b), burgundy (#2d0a1a), forest dark (#0a1a0f). Rich, heavy darkness.
Typography: elegant serif — Playfair Display, DM Serif Display, Fraunces. Gold, champagne, or cream text (#c9a84c, #e8d5a3, #f5ede0). Generous tracking on headings.
Motion: slow and sensuous. Long transitions (300–450ms), ease-in-out. Nothing abrupt or fast. The velvet does not rush.
Colors: jewel tones with gold or champagne accent. Deep shadows throughout. Avoid cool greys — they break the warmth.
Details: subtle vignette on backgrounds (radial gradient darkening at edges). Heavy typographic kerning on display text. Thick decorative borders or frame elements. Dividers as ornamental rules.

---

### Concrete
Evokes: industrial, structural, brutalist architecture, matter-of-fact, unadorned honesty.
Surfaces: muted warm greys and off-browns (#3a3732, #5a5550, #2a2420). Raw, textured, matte.
Typography: bold grotesque — Montserrat Heavy, Raleway Bold, DM Sans Bold. Uppercase labels. No serifs. No decorative elements.
Motion: minimal to none. If motion is used, it is abrupt — hard cuts or instant slides, no easing curves.
Colors: grey and warm neutral spectrum with one rust or terracotta accent (#c4612a, #b85c38). No soft pastels, no gradients.
Details: thick exposed borders. Heavy drop shadows (hard, not blurred: `box-shadow: 4px 4px 0 #1a1512`). Visible grid lines. No decorative elements — every element is functional or it is removed.

---

### Ink
Evokes: print media, high-contrast publication, editorial authority, newspaper and book craft.
Surfaces: pure white (#ffffff) or warm off-white. Black (#0a0a0a) as the dominant visual mass.
Typography: editorial serif — EB Garamond, Libre Baskerville, Crimson Text. Display headings at --text-2xl or --text-3xl with tight leading (1.1). Running text at --text-sm, leading 1.6.
Motion: none, or a single slow fade (300ms ease). Ink does not animate. Every pixel is deliberate and still.
Colors: black and white are the palette. One red (#c0392b) or deep navy (#1a2a4a) accent maximum. Never more than one accent color.
Details: letterpress sensibility — tight leading on headings, generous margin, horizontal ruled lines as section breaks. Hanging punctuation where possible. Drop caps for opening paragraphs.

---

### Matte
Evokes: focused calm, product utility, tasteful restraint, things that get out of their own way.
Surfaces: flat solid fills, zero gradients, zero gloss. Each surface is one color.
Typography: clean readable sans — Inter, Figtree, DM Sans. Regular weight for body, semibold for hierarchy. Nothing decorative.
Motion: Tier 1 only — hover states, focus rings, active states. Nothing more. The design communicates through proportion and color, not motion.
Colors: desaturated but not grey. Carefully chosen palette of 3–4 hues. One purposeful accent (dusty blue #4a7fa5, sage green #6b8f71, terracotta #c4612a). The rest are neutrals.
Details: spacing and proportion carry everything. Shadows only when functionally necessary (indicating elevation for a dropdown or modal). No decorative borders, no textures, no gradients.

---

## 10. Depth and Shadow

A flat 2D screen can read as physically layered if shadows are used with discipline. Used correctly, shadow is the primary tool for communicating elevation, focus, and material weight. Used carelessly, it muddies the design and makes everything look equally heavy or equally flat.

---

### What "3D" means on a 2D screen

There is no actual depth — but the eye accepts the illusion when the design commits to a consistent internal logic. The rules of that logic:

**Establish a light source and never violate it.** All shadows in the interface must be consistent with a single implied light direction — typically top-center or slightly top-left. If one card casts a shadow downward and another casts it to the right, the light source is contradictory and the illusion collapses. Pick a direction and apply it everywhere.

**Think in Z-axis layers.** Every element lives at one of a small number of perceived heights above the background canvas:
- Layer 0 — background canvas (the page itself)
- Layer 1 — surface elements (cards, panels, sections — slightly above the canvas)
- Layer 2 — floating elements (dropdowns, popovers, sticky headers — clearly above the surface)
- Layer 3 — overlays (modals, drawers, command palettes — highest perceived elevation)

An element's shadow must match its layer. A modal with a card-level shadow looks like it is sitting on the page, not above it. A card with a modal-level shadow looks like it is about to detach from the screen.

**Shadow size equals elevation.** Low elevation: small offset, tight blur, high opacity. High elevation: large offset, large blur, lower opacity. The shadow spreads out and softens as the element rises away from the surface — exactly as real shadows do when the object moves away from the ground.

**Overlapping creates depth for free.** An element that visually overlaps another is automatically perceived as in front of it. Use this before adding shadow. Shadow reinforces overlap; it does not replace it.

**Do not add shadow to flat content.** Body text, labels, icons, and static layout containers do not float — they are part of the surface. Adding shadow to them creates visual noise and undermines the elevation hierarchy. Shadow belongs only on elements that are genuinely elevated: cards, modals, dropdowns, floating action buttons, tooltips.

---

### How to use shadows correctly

**Use two shadow layers, not one.** A single `box-shadow` reads as synthetic. Real shadow has two components: a tight contact shadow (directly beneath the element, sharp and dark) and a diffuse ambient shadow (spread out, soft, lighter). Combining them creates physical weight.

Three elevation presets to use consistently:

Layer 1 — card/panel (resting on the surface):
```css
box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.10),
    0 4px 12px rgba(0, 0, 0, 0.07);
```

Layer 2 — dropdown/popover/sticky header (floating above the surface):
```css
box-shadow:
    0 4px 8px rgba(0, 0, 0, 0.12),
    0 12px 28px rgba(0, 0, 0, 0.10);
```

Layer 3 — modal/drawer/command palette (highest elevation):
```css
box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.18),
    0 24px 64px rgba(0, 0, 0, 0.14);
```

**Never use pure black shadows.** `rgba(0,0,0,X)` produces grey mud. Shadows in reality pick up color from the environment — they are never truly neutral. Even on a dark neutral background, shadows should lean slightly cool (blue-black or purple-black) rather than pure black.

**Inset shadows create recessed surfaces.** Use `box-shadow: inset 0 2px 6px rgba(0,0,0,0.15)` on text inputs, wells, and pressed button states. The inner shadow tells the eye the surface goes inward rather than outward — the inverse of elevation.

**Hard shadows (no blur) are a deliberate style choice.** `box-shadow: 4px 4px 0 #1a1a1a` with zero blur creates a graphic, brutalist, flat-3D effect. This belongs to the Concrete material and similar registers. Never use zero-blur shadows in Glass, Chrome, Velvet, or any soft material — the hard edge breaks the surface logic.

**On hover, raise the element.** Increase the offset and blur, and lighten the shadow slightly. This is one of the most satisfying micro-interactions available in CSS — the card visibly lifts toward the cursor.

```css
.Card {
    box-shadow: 0 2px 8px rgba(0,0,0,0.10), 0 6px 20px rgba(0,0,0,0.07);
    transform: translateY(0);
    transition: box-shadow 180ms ease, transform 180ms ease;
}
.Card:hover {
    box-shadow: 0 6px 16px rgba(0,0,0,0.14), 0 16px 40px rgba(0,0,0,0.10);
    transform: translateY(-2px);
}
```

---

### How to use coloured shadows correctly

A coloured shadow is a shadow whose hue is derived from the element itself — not neutral grey or black. It makes the element appear to radiate its color into the space below it, which is how real light and real materials behave. Used at the right moment, it transforms a flat accent color into something that feels luminous and physical.

**Derive the shadow color from the element's accent.** Take the primary color of the element. Darken it significantly and desaturate it slightly. For a pink button at `#e879a0`, the shadow might be `rgba(180, 60, 100, 0.35)`. For an electric cyan element at `#00f5ff`, the shadow might be `rgba(0, 180, 200, 0.40)`. Never use the accent color at full saturation and brightness as a shadow — it will look fluorescent and wrong.

**Use coloured shadows only on focal elements.** The primary CTA, the selected card, the active tab, the focused input — these are the elements worth drawing attention to. If every element has a coloured shadow, the effect cancels out and everything looks busy. Reserve it for the one or two things in the layout that matter most.

**Two patterns that work reliably:**

Focus/selected glow — for active states, focused inputs, selected items:
```css
box-shadow:
    0 0 0 3px rgba(accent-hue, 0.20),   /* rim ring */
    0 4px 16px rgba(accent-dark, 0.30); /* depth shadow */
```

Neon/luminous glow — for Neon material and editorial hero elements:
```css
box-shadow:
    0 0 12px rgba(accent, 0.50),   /* tight glow */
    0 0 40px rgba(accent, 0.20);   /* ambient spread */
```

The two-layer glow (tight + spread) is critical. A single-layer glow looks like a CSS mistake. Two layers creates a realistic light diffusion gradient.

**Dark themes amplify coloured shadow.** Against a dark background, coloured shadow needs less opacity to read clearly — the contrast is high. On light themes, coloured shadows need to be subtler (reduce opacity by roughly half) or they look like a hue mistake rather than an intentional effect.

**Never use RGB primaries directly as shadow color.** `rgba(255, 0, 0, 0.5)` as a shadow looks broken, not designed. Always shift the hue slightly and reduce brightness. The shadow should look like the light from the element is bleeding out — not like the element is being lit by a coloured spotlight from below.

**Do not apply coloured shadow to structural chrome.** Navigation rails, borders, layout containers, and text elements do not benefit from coloured shadow. It creates confusion about what is elevated and what is interactive. Coloured shadow is a signal of importance and interactivity — use it only where that signal is true.
