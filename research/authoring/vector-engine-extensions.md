# Vector engine extensions: text, gradients, strokes, compound shapes and mottle

**Status:** design for discussion, 27 September 2026; nothing built. The vector features are designed once, for eye makeup, [Nail Salon](../nails/nail-salon-design.md) and later decal features such as [tattoos](../character-customization/tattoos-brief.md). They extend the layered-makeup engine (`projects/xf-studio/authoring/src/engines/layered-makeup/`) without changing what any existing recipe looks like. Code paths below are relative to that folder unless stated.

It follows the [feature-module platform](feature-module-platform.md) (§2 migration on read, per-model versioning), the [architecture contract](architecture-contract.md) (domain owns validation, Undo and persistence; typed actions; grow the catalogue) and the engine's contracts: [projected tangents](projected-tangent-controls.md), [directional softness](directional-softness-contract.md), [shape gestures](shape-gesture-contract.md), [raster performance](raster-performance.md) and the [editor invariants](editor-invariants.md).

## Contents

- [0. Summary](#0-summary)
- [1. Where the engine is today](#1-where-the-engine-is-today)
- [2. Surface spaces: where a shape lives](#2-surface-spaces-where-a-shape-lives)
- [3. Text shapes](#3-text-shapes)
- [4. Compound shapes, the shape library and shape operations](#4-compound-shapes-the-shape-library-and-shape-operations)
- [5. Fills: solid and gradient](#5-fills-solid-and-gradient)
- [6. The stroke model](#6-the-stroke-model)
- [7. Mottle: skin-like breakup for eye makeup](#7-mottle-skin-like-breakup-for-eye-makeup)
- [8. Data model, migration and actions](#8-data-model-migration-and-actions)
- [9. Phases and effort](#9-phases-and-effort)
- [10. Export constraints per material route](#10-export-constraints-per-material-route)
- [11. Risks](#11-risks)
- [12. Questions, with proposed defaults](#12-questions-with-proposed-defaults)

## 0. Summary

| Feature | In one line |
|---|---|
| **Surface spaces** | A layer is authored in a canvas (head UV, a nail in millimetres, a hand strip, later a body region), and the region maps canvas to texture UV; the engine evaluates in canvas space |
| **Text** | Live, editable text the player types, with font, size, tracking, leading, alignment and layout (point, box, along a path, one cluster per slot), taking fills, strokes and effects like any shape. Glyphs become Bézier compound shapes at evaluation time; bundled open (SIL OFL) fonts plus the player's own fonts, identified by file hash |
| **Compound shapes** | Several closed or open contours per layer with a fill rule, so letters have holes and shapes have cut-outs; a shape library of editable Bézier shapes; clip-to-layer and knockout as cheap raster-time operations; true vector booleans deferred |
| **Fills** | Solid (today's) or gradient: linear, radial, **edge** (by distance inside the shape) and along-path, with independent colour stops and opacity stops, interpolated in OKLab |
| **Strokes** | On open or closed paths: per-point **before** and **after** segment settings (width, visibility, cap) in path direction, so tapers, width changes and gaps are defined at points; alignment centre, inside or outside; joins; feather; optional dashes |
| **Mottle** | An optional per-layer effect that modulates coverage with a seeded, tileable, skin-scale noise (pores and clumps, optional streaks) inside the shared coverage evaluator. So it is baked into the exported texture and shown identically in the preview, at no in-game cost |
| **Compatibility** | Every new field is optional; absent means today's exact arithmetic, byte for byte. A structural part bump (`xfs/eye-makeup-part-3`) is written only when a layer uses a new structure, and Mottle is a registered layer model (`mottle-1`) |

**Plan.** V1 (spaces, compound shapes, gradients) 6–7 days, V2 strokes 6–7, V3 text 7–9, V4 mottle 2–3: about **21–26 agent-days** (§9).

## 1. Where the engine is today

Read on 27 September 2026 from `recipe.ts`, `bezier-path.ts`, `preset-compiler.ts`, `region.ts`, `layer-models.ts` and `finish-export.ts`:

- **A layer is one closed contour** of 3–24 points (`points`), Catmull–Rom or Bézier (`pathMode`, handles per point). It has one colour (`color`, hex), `opacity`, a global `feather` or per-point feathers (`softness`), per-point pigment `weight` with a strength mode, up to 8 warp fields, and a `symmetry` flag mirrored by the region's `Mirror`.
- **Coverage** (`coverageAt`) inverse-warps the sample, finds inside/outside by crossing parity and the nearest edge of the tessellated polygon, and returns `smoothstep(½ ± d/feather) × weight × opacity`. The raster path (`prepareRasterCoverage`) is an exact, bounds-culled copy; the scalar loop stays as the independent reference.
- **One evaluator serves everything**: the mask worker (preview), PNG export and the material compiler (`raster`, `rasterWindow`, `layerCoverageSampler`). Masks are white RGB with coverage in alpha.
- **The compiler** (`accumulate`) composites layers bottom to top in the destination encoding (sqrt-linear colour, roughness, metalness, coverage, normal XY). Colour is **constant per layer**.
- **Regions** (`LayeredMakeupRegion`) supply the mirror, fine-Glitter scope, texture grids, wording, starter and new-layer shapes and the layer model registry. The engine holds no region.
- **Open requests** this design absorbs: "multiple contours/holes per layer" ([authoring requests](../backlog/eye-artistry-authoring.md)).

## 2. Surface spaces: where a shape lives

Today canvas and texture are the same (head UV). The extensions separate them:

```ts
// region.ts (sketch)
export type SurfaceSpace = {
  readonly id: string;                     // "head-uv", "nail:L3", "strip:L", "body:forearm-l"
  readonly units: "uv" | "mm";
  readonly toUv: Affine2 | ((p: Vec2) => Vec2);        // canvas → texture UV
  readonly fromUv: Affine2 | ((uv: Vec2) => Vec2 | null);
  readonly clip?: Polygon;                  // canvas outline (a nail island), null = none
  readonly mmPerUnit?: number;              // physical scale where known (mottle, legibility)
  readonly texelMm?: number;                // export texel size (legibility and mottle floors)
};
export interface LayeredMakeupRegion { /* … existing … */ readonly spaces?: readonly SurfaceSpace[]; }
```

- **Eye makeup**: one space, `head-uv`, identity, with `mmPerUnit` from the plate window. It is exactly today's behaviour; `spaces` absent means this.
- **Nails**: a space per nail (millimetres, a per-island affine frame), per hand strip, and the normalised "every nail" canvas that repeats through each nail's frame ([Nail Salon §3.1](../nails/nail-salon-design.md#31-canvases-nail-hand-strip-both-hands)).
- **Tattoos (later)**: body-region canvases in millimetres.
- **Evaluation**: a texel's UV maps back to canvas coordinates (`fromUv`), is evaluated there, and is clipped by `clip`. Feather, widths, font sizes and mottle grain are in canvas units, so millimetres on nails and tattoos. The existing UV bounds (`MIN_FEATHER` and so on) stay the head-UV space's bounds, and a millimetre space has its own.
- **On-skin proportions for text on the face.** Head UV is not uniform in millimetres around the eyes, so text authored in UV would look stretched on the skin. A text layer on `head-uv` is laid out in millimetres in a **local tangent chart** at its anchor, the UV-to-surface derivative of the plate triangle under it, which the [projected tangent controls](projected-tangent-controls.md) already compute. It is then mapped to UV through that first-order map, per glyph for text along a path. The result is stored as parameters, never as baked UV points, so it stays editable.

## 3. Text shapes

The maintainer's clarification (27 September): **editable text**. Players type any text and pick font, size, spacing, alignment and layout (along a path, across nails and so on), with fills, strokes and effects like any shape. There are no preset words or text options.

### 3.1 Model

```ts
type TextGeometry = {
  kind: "text";
  text: string;                               // up to 256 grapheme clusters
  font: FontRef;                              // §3.3
  size: number;                               // cap height in canvas units (mm on nails, on-skin mm on the face)
  tracking: number;                           // extra spacing, em/1000 (letter-spacing; "S C R E W" can be tracking or spaces)
  leading: number;                            // line height, multiple of size
  align: "start" | "centre" | "end" | "justify";
  caseTransform?: "upper" | "lower" | "none";
  kerning: boolean;                           // font kerning on (default)
  layout:
    | { kind: "point"; anchor: Vec2; angle: number }                    // one or more lines from an anchor
    | { kind: "box"; frame: Rect; angle: number; wrap: boolean; valign: "top" | "middle" | "bottom" }
    | { kind: "path"; path: Contour; offset: number; side: "left" | "right"; baseline: "alphabetic" | "centre";
        stretch?: "none" | "fit" }                                      // text on a Bézier path
    | { kind: "slots"; slots: string[] | "all"; per: "cluster" | "word"; fit: "smallest" | "each" | "fixed";
        rotate: "slot-axis" | "horizontal" };                           // one cluster per slot (nails)
  glyphTransforms?: { index: number; dx?: number; dy?: number; angle?: number; scale?: number }[];  // per-glyph nudges
};
```

- **Live.** The stored layer holds only the text and its parameters. Glyph outlines, shaping and layout are a memoised derived node keyed by (font hash, text, parameters, space). An edit re-lays out the text; it never destroys it.
- **Fill, stroke and effects** are the layer's, as for any shape (§5–§7): a gradient across the whole text box, a stroke on every glyph outline, mottle on the result. Per-character colour is done by splitting the text into layers ("Split to letters"), not by rich text in v1 (question VQ4).
- **Convert to shapes** turns the current layout into a compound Bézier layer (§4). It is explicit, undoable and loses the ability to retype.
- **Warp fields and symmetry** apply to text as to any layer (after layout, in canvas space). A symmetric text layer on the face mirrors its geometry, which would mirror the letters, so mirrored text is offered as "Mirror position, keep letters readable" by default: the reflected copy is laid out again at the reflected anchor.

### 3.2 Shaping and outlines

| Choice | Proposal | Why |
|---|---|---|
| Parser and shaper | **opentype.js** (MIT) in the worker: glyph outlines, `kern`/GPOS pair kerning, basic ligatures | Pure JS, small, runs in the raster worker; enough for Latin and similar scripts |
| Upgrade path | **harfbuzzjs** (HarfBuzz as WebAssembly, MIT), behind the same `shape(text, font) → positioned glyphs` interface | Complex scripts (Arabic, Indic), full OpenType features; about 1 MB, so load it only when a font or text needs it |
| Outline conversion | TrueType quadratics become cubics exactly (degree elevation: `c1 = p0 + ⅔(q − p0)`, `c2 = p2 + ⅔(q − p2)`); CFF outlines are already cubic | The engine's Bézier tessellator (`tessellateBezier`, tolerance `BEZIER_TOLERANCE`) handles them unchanged |
| Fill rule | Non-zero for glyphs (TrueType and CFF convention), even-odd available for authored compound shapes | §4 |
| Colour and emoji fonts | Not supported (bitmap or layered colour glyphs). Monochrome outline symbol fonts work like any font | Keeps text one vector geometry |

### 3.3 Fonts: licensing, bundling and the player's own fonts

- **Bundled fonts: SIL Open Font License only.** The OFL allows bundling fonts with software, embedding them and using them in any output. Rasterised output is unrestricted. Renaming is required only for modified versions (reserved font names), and fonts may not be sold on their own. Each bundled font ships with its licence text and gets a credit entry when it lands. Proposed starter set, about 12 families and 2–3 MB as WOFF2 in the desktop app and site:
  - display: Orbitron, Audiowide, Oxanium, Rajdhani, Bebas Neue, Monoton;
  - script: Pacifico, Great Vibes;
  - pixel and mono: Press Start 2P, Share Tech Mono;
  - text: Inter or Noto Sans;
  - symbols: Noto Emoji (monochrome outlines), which also feeds the shape library.

  The exact list is a question (VQ1). Every candidate's licence file must be checked at acquisition, not assumed.
- **The player's own fonts.** The desktop host lists installed font files (the Windows fonts folders) and serves one on request. Use is local: the recipe stores a `FontRef`, never font data:
  ```ts
  type FontRef = { family: string; style: string; postscriptName: string; sha256: string; source: "bundled" | "local" };
  ```
- **A missing font** is shown in plain words: "This look uses 'Foo Sans', which isn't on this computer. The text shows in Inter until you install it or pick another font." The fallback is **never** exported silently. Check omits the layer with that reason (partial export) unless the player chooses "Use the fallback" or "Convert to shapes". A font whose hash differs (another version) is treated as missing, with "Use this version" one click away, because metrics can differ and exports must be reproducible.
- **Sharing.** A portable recipe with a local font opens elsewhere with the fallback notice. "Convert to shapes" before sharing is suggested in the export dialog, not forced. Converting a commercial font's glyphs into shared shapes may breach that font's licence, so the dialog says the player is responsible for their own fonts, in one plain sentence.

### 3.4 Layouts in use

| Layout | Eye makeup | Nails | Tattoos (later) |
|---|---|---|---|
| Point / box | A word under the brow or on the cheekbone, in on-skin millimetres | A word on one nail | Script on a forearm |
| Along a path | Following the lash line or the wing of a liner (the path is an ordinary editable contour, which can share a stroke's path) | Around a nail's curve | Along a spine or a band |
| Slots | — | One cluster per nail across a hand or both hands ([Nail Salon §3.3](../nails/nail-salon-design.md#33-text-across-nails)) | — |

**Legibility hint.** Each space knows its export texel size, so the editor warns when strokes of a glyph fall under about 2 texels. On the eye plate (0.13 mm per texel), cap heights under about 1.5 mm read as a smudge in game: "Letters this small won't be readable in game; 1.6 mm is the smallest that holds its shape at this texture size." Nail texels are finer (about 0.09 mm at 512²).

## 4. Compound shapes, the shape library and shape operations

- **Compound geometry**: a list of contours, each open or closed, Bézier or Catmull–Rom, with a fill rule (non-zero or even-odd). Coverage extends naturally:
  - inside is the winding number (non-zero) or crossing parity (even-odd) over all closed contours' edges;
  - distance is the nearest edge over all contours;
  - open contours contribute only strokes (§6), never fill.

  The existing smoothstep of signed distance over feather is unchanged, so a single closed contour evaluates byte-identically to today's layer.
- **Limits**: up to 32 contours and 512 points per layer, against 24 points today, bounded by an edge budget for the worker (tessellated edges ≤ 16,384). An **edge grid** makes this affordable: a uniform grid over the layer's bounds, with each cell listing the edges within the largest feather or half stroke width. The raster path queries only its cell; the scalar reference keeps the full loop for tests, as `coverageAt` does today.
- **Shape library**: star (points, inner radius), heart, butterfly, flame, lightning, drop, sparkle, crescent and polygon. Each inserts an ordinary editable compound Bézier layer at a chosen size; parametric shapes keep their parameters until the first point edit ("Edit points" converts them). Library shapes are authored in the repository as small JSON, or taken from bundled OFL symbol fonts.
- **Shape operations, cheap first:**
  - **Clip to layer below** (like a clipping mask): coverage × the lower layer's coverage, evaluated at raster time. Nearly free, fully editable.
  - **Knockout**: subtract another layer's coverage (`c × (1 − c_other)`), also at raster time.
  - **Holes** come from compound contours and the fill rule.
  - **Destructive vector booleans** (union, subtract, intersect producing new outlines) are deferred. Robust Bézier booleans are hard; flattening to polygons (for example with Clipper2) would lose the curves and handles players edit. They are revisited if authoring sessions ask for them (question VQ5).

## 5. Fills: solid and gradient

```ts
type Paint =
  | { kind: "solid"; color: Hex }                                           // today's colour
  | { kind: "gradient"; shape: GradientShape; stops: ColorStop[]; alpha: OpacityStop[];
      interpolate: "oklab" | "srgb" | "linear"; extend: "pad" | "repeat" | "reflect"; dither: boolean };
type GradientShape =
  | { kind: "linear"; from: Vec2; to: Vec2 }
  | { kind: "radial"; centre: Vec2; radius: Vec2 /* ellipse */; angle: number; focus?: Vec2 }
  | { kind: "edge"; depth: number }            // t = distance inside the shape / depth: edge colour → centre colour
  | { kind: "path"; path: "own" | Contour };   // t = arc length along a path (strokes; a liner that changes colour)
type ColorStop = { at: number; color: Hex; mid?: number };      // mid: the 50 % point between this stop and the next
type OpacityStop = { at: number; opacity: number; mid?: number };
```

- **Colour stops and opacity stops are independent**, as in Illustrator and Photoshop: a colour ramp from rose to plum can fade out at one end without adding colour stops. Each pair of stops has a midpoint. Up to 16 stops each.
- **Edge gradients** are new and cheap, because the evaluator already has the distance to the edge. They give a makeup artist's blend (a deeper colour at the crease edge fading to a lighter centre) and a nail's rim.
- **Along-path gradients** colour a stroke or text along its path's arc length: a liner that shifts from black to teal toward the wing.
- **Interpolation** in OKLab by default, which keeps midtones from going muddy (Ottosson 2020 is already in the [credits](../../docs/community-credits.md)). sRGB is available for matching other tools.
- **Dithering** (a blue-noise offset under half a quantisation step) is on by default for 8-bit export, so long, subtle ramps don't band. It is deterministic by seed.
- **Where gradients apply**: fills and strokes. `opacity` stays the layer's overall multiplier. A layer's `color` remains the solid paint when `fill` is absent, which is today's layer.
- **Editor**: handles on canvas (the start and end of linear, the centre, radii and focus of radial, the depth of edge), and a stop bar with colour and opacity rows, drag to move, click to add, drag off to remove, Alt-drag to duplicate. It uses the shared colour picker.

## 6. The stroke model

A stroke paints a band along a path: every contour of the layer, open or closed.

```ts
type Stroke = {
  paint: Paint;                    // solid or gradient (including along-path)
  opacity: number;
  width: number;                   // default width in canvas units
  align: "centre" | "inside" | "outside";   // closed contours; on open ones inside = left of path direction
  join: "round" | "miter" | "bevel"; miterLimit: number;
  caps: { start: Cap; end: Cap };  // open contours' ends, unless a point overrides them
  feather: number;                 // the band's own edge softness (smoothstep width), like the fill's
  dash?: { lengths: number[]; offset: number; caps: Cap };  // optional
  order: "above-fill" | "below-fill";
};
type Cap = "butt" | "round" | "square" | { kind: "taper"; length: number } | { kind: "point"; length: number };
// On each point, in path direction: the segment arriving (before) and the segment leaving (after).
type PointStroke = {
  before?: { width?: number; visible?: boolean; cap?: Cap };
  after?:  { width?: number; visible?: boolean; cap?: Cap };
};
```

- **Per point, before and after.** Each point can set the stroke of the segment that **arrives** and the one that **leaves**, following the path direction:
  - Width interpolates along a segment from the previous point's `after` width to the next point's `before` width. Different `before` and `after` widths make a step at the point; equal widths make a smooth profile.
  - `visible: false` on a segment makes a gap. The cap at each side of the gap comes from that point's `before.cap` (the incoming segment ends) and `after.cap` (the outgoing one starts). So a stroke can end, and restart with a different cap, at any point.
  - An open contour's ends use `caps.start` and `caps.end` unless the end point overrides them.
- **Width profile** is therefore the points' widths. No separate profile curve is needed in v1; "Smooth widths" (interpolation along arc length through the points) is an option. A taper cap narrows to zero over its length, the eyeliner wing.
- **Alignment** offsets the band against the signed distance: centre `[−w/2, w/2]`, inside `[−w, 0]`, outside `[0, w]` (negative inside). On open contours the sign comes from the path direction.
- **Feather** softens the band's edges with the engine's smoothstep. The fill's per-point softness and the stroke's feather are independent. Per-point stroke feathers (like directional softness) are a later option.
- **Evaluation**: the tessellated polyline carries each sample's segment and parameter (`tessellateBezier` already does), so each sample gets an interpolated width and visibility. Per texel:
  1. Find the nearest visible edge in the edge grid.
  2. Take its interpolated half width and alignment.
  3. Compute the band coverage `smoothstep` of `(halfWidth − |d − offset|) / feather`.
  4. Handle caps geometrically at segment ends: butt clips at the end normal; square extends by half the width; round uses distance to the end point; taper and point shrink the width over the cap length.
  5. Handle joins at interior points: round is the natural result of nearest-edge distance; miter and bevel are extra half-plane tests at convex corners.
- **Stroke and fill in one layer** share the layer's finish and are composited inside the layer (stroke above or below fill) before the layer joins the stack. Different finishes for stroke and fill ("chrome outline on crème") are two layers; "Split stroke to its own layer" does it in one action.
- **Open paths are new** for the engine. A layer may now be a lone open path with a stroke: an eyeliner line, a lash-line smudge, a signature. It has no fill.

## 7. Mottle: skin-like breakup for eye makeup

**The request.** Makeup seen close up, especially mascara and lash-line product, is not a uniform film. It sits unevenly on skin texture and in pores and clumps. The request is a cheap, optional mottle.

### 7.1 Where it applies

**In the shared coverage evaluator**, as a per-layer effect. It is therefore:

- **baked into the exported texture**: the decal's alpha, and colour where mottle also varies colour. The game draws what it always draws, so the in-game cost is **zero**: no new texture, template, parameter or shader;
- **shown identically in the preview**, because the preview's mask worker uses the same evaluator. A preview-only shader effect was rejected: it would show players something their export doesn't contain.

### 7.2 The noise

- A **seeded, tileable noise tile** per (model version, seed), 512², generated once in the worker and cached (a few tens of milliseconds, 1 MB as floats or 256 KB as bytes). It has two components:
  - **pores**: inverted cellular (Worley F1) noise, small pits where product collects or skips;
  - **clumps**: 2–3 octaves of value noise, a patchy build-up.
- **Skin-aligned scale.** Grain is set in **millimetres on the skin** and converted through the space's `mmPerUnit`, so pores are the same physical size wherever the layer sits. It is floored at 2 export texels (about 0.26 mm on the eye plate): anything finer would vanish in the texture and its mips.
- **Streaks** (optional): anisotropic stretch at an angle, or **along the stroke normal** for stroke layers, which gives mascara-like strands off a lash-line stroke.

### 7.3 The arithmetic

```
n       = tile(canvasPos / grain)                 // 0..1, mean 0.5, pores and clumps mixed by `clumping`
w       = where == "edges" ? 4·c·(1 − c) : c       // edges: breakup only in the soft edge; everywhere: whole shape
c'      = saturate(c + amount · w · (n − 0.5) · 2)
```

- It is **mean-preserving** away from clamping: at a distance, or down the mip chain, a mottled layer averages to the same coverage as an unmottled one. Turning mottle on changes texture, not overall strength.
- "Edges" (the default) keeps the centre of a shape solid and breaks up only its soft edge, the realistic look of powder and smudged liner. "Everywhere" gives an allover patchy film (cream products, mascara on the lash line).
- **Optional colour variation**: `amount × (n − 0.5)` applied to lightness, off by default, for pigment build-up.
- **Optional shine variation** (later): pits a little rougher, only where the route carries roughness per texel.

### 7.4 Controls

| Control | Range | Default |
|---|---|---|
| Mottle (on or off) | — | Off |
| Amount | 0–1 | 0.35 |
| Grain | 0.25–3 mm (floored by texel size) | 0.6 mm |
| Clumping | 0 (pores) – 1 (clumps) | 0.4 |
| Where | Edges / Everywhere | Edges |
| Streaks | Off / Angle / Along stroke | Off |
| Seed | integer, with "shuffle" | derived from the layer ID |

Presets set these at once: **Powder** (edges, fine, pores), **Cream** (everywhere, low amount, clumps), **Mascara smudge** (along stroke, streaky, high amount), **Sponge** (for nails' ombré). On nails the same effect gives sponge-applied gradients.

### 7.5 Cost

| Where | Cost |
|---|---|
| Tile | Generated once per seed and version, cached in the worker |
| Per covered texel | One bilinear tile read plus a few operations, about 5–10 ns in the worker; about 5–10 ms more for a million covered texels, well within the [raster performance](raster-performance.md) budget |
| Texel skip | Mottle changes only texels with 0 < c. Fully outside texels stay culled; fully inside texels are evaluated only in "everywhere" mode |
| Export | No extra textures; the alpha channel already exists |
| Game | None |

### 7.6 Versioning

Mottle is a **layer model**, `mottle-1`, in a new model slot `effects`, validated by the region's `LayerModelRegistry`, exactly as Glitter models are. If its arithmetic ever changes appearance, it gets a new model ID ("version the model whenever appearance changes"). A layer without `effects` is byte-identical to today's.

## 8. Data model, migration and actions

### 8.1 Layer additions (all optional)

```ts
export type Layer = {
  /* … today's fields unchanged: id, name, enabled, color, finish, flakes, optics, opacity, feather, symmetry,
     pathMode, points, fields, strength, softness … */
  space?: string;                         // absent: the region's first space (head UV for eye makeup)
  geometry?: CompoundGeometry | TextGeometry | LibraryGeometry;   // absent: today's single contour in `points`
  fill?: Paint | { kind: "none" };        // absent: { kind: "solid", color }
  stroke?: Stroke;                        // absent: no stroke
  clip?: { mode: "clip-below" | "knockout"; layer: string };
  effects?: { mottle?: MottleSettings & { model: "mottle-1" } };
};
export type Point = { /* u, v, weight, feather?, handles? */ stroke?: PointStroke };
```

### 8.2 Migration on read

| Input | Reader | In memory | Written as |
|---|---|---|---|
| `xfs/eye-makeup-part-2` and every older portable form | Unchanged readers; new fields absent | Layers with today's meaning | Unchanged |
| A part whose layers use `geometry`, `fill`, `stroke`, `clip`, `space` or point strokes | `xfs/eye-makeup-part-3` reader (a structural bump, as the platform reserves bumps for structure) | Extended layers | `part-3` only when a layer needs it; otherwise the oldest schema that holds the content exactly (the platform's rule) |
| Mottle | Model registry, `effects` slot | — | Any part version that allows model blocks: a model, not a structural change |
| Portable recipe files | `xfs/recipe-12` for part-3 content; "Export recipe" writes the oldest recipe schema that holds it | — | — |

**Parity gates** (as in [platform §2](feature-module-platform.md#migration-on-read-with-no-appearance-change)):

- every fixture recipe produces byte-identical `raster()` masks at 512, 1K and 2K and identical `compileFlatPreset` output through the extended evaluator;
- a single closed contour stored as `geometry: compound` with one contour produces the same bytes as the legacy form;
- an unknown geometry kind or paint kind is a newer build's (`NewerDataError`), never dropped.

### 8.3 Compiler and preview

- **Per-texel paint.** `accumulate` takes a paint sampler per layer instead of a constant colour. A solid paint keeps the constant path exactly, so its bytes are unchanged.
- **Preview masks.** Solid layers keep white-RGB-plus-alpha masks and the stack shader's uniform colour. A layer with a gradient fill or a stroke with its own paint gets an **RGBA paint raster** (colour premultiplied by coverage) from the same worker, and the stack shader's per-layer mode says which it is. The worker's cache key gains the paint and geometry.
- **Text in the worker.** Fonts load in the worker (bundled from the app, local ones through the host), shaping and outlines are memoised by (hash, text, parameters), and a font still loading shows the fallback with a small "loading font" note, never a flash of wrong layout in export.

### 8.4 Actions and capabilities (grow the catalogue)

New typed actions, each with a capability check, one Undo entry per gesture, and boundary tests:

| Group | Actions |
|---|---|
| Geometry | `layer.addShape` (library), `layer.addText`, `layer.addPath` (open), `contour.add`/`remove`, `geometry.setFillRule`, `layer.convertToShapes`, `layer.splitToLetters`, `layer.moveToSpace` |
| Text | `text.setContent`, `text.setFont`, `text.setMetrics` (size, tracking, leading), `text.setAlign`, `text.setLayout`, `text.nudgeGlyph` |
| Paint | `fill.set`, `gradient.setShape`, `gradient.addStop`/`moveStop`/`removeStop`/`setStop` (colour and opacity rows) |
| Stroke | `stroke.set`, `point.setStroke` (before or after: width, visibility, cap), `stroke.split` |
| Effects | `effect.mottle.set`, `effect.mottle.preset` |
| Operations | `layer.setClip` |

Refusals are plain: "This font isn't on this computer", "Text is limited to 256 characters", "A layer can hold up to 512 points".

## 9. Phases and effort

Effort in agent-days, after the view graph's module work (the editor panels). Each phase leaves `main` green with the parity gates.

| # | Phase | Scope | Gates | Effort |
|---|---|---|---|---|
| V1 | Spaces, compound shapes, gradients | `SurfaceSpace` in regions (identity for eye makeup); compound geometry and fill rules; edge grid; shape library; clip and knockout; `Paint` with linear, radial and edge gradients, stops, OKLab, dithering; per-texel paint in compiler and preview; part-3 reader and writer | Byte-identical fixtures; scalar-vs-raster parity for compound shapes and gradients; `?verify=1` gradient editing | 6–7 |
| V2 | Strokes | Open paths; stroke band evaluation, alignment, caps, joins, feather, dashes; per-point before and after; along-path gradients; split stroke | Geometric tests per cap and join; width-interpolation exactness at equal widths; `?verify=1` eyeliner wing | 6–7 |
| V3 | Text | opentype.js in the worker; bundled OFL fonts with licence files and credits; local fonts through the host; `FontRef` by hash; point, box, path and slots layouts; on-skin proportions; convert and split; legibility hint; missing-font flows | Deterministic outlines per font hash; round trips; `?verify=1` typing, font switch, text on path, fallback | 7–9 |
| V4 | Mottle | `effects` model slot; `mottle-1`; tile cache; controls and presets | Mean preservation within tolerance; determinism by seed; export equals preview mask | 2–3 |

**Total about 21–26 days.** V4 can go first on its own (it touches only the evaluator and the model registry). Nails need V1 and V3 at minimum; eye makeup gains from each phase as it lands.

## 10. Export constraints per material route

Every feature flattens to rasters per material route, and the vector model is authoring-side only. What each route can carry ([finish export](../../projects/xf-studio/authoring/src/engines/layered-makeup/finish-export.ts), [decal reference](../materials/shader-decal.md), [metal and glass reference](../materials/shader-metal-glass.md)):

| Route | Per-texel colour (gradients, text, strokes) | Per-texel roughness and metalness | Notes |
|---|---|---|---|
| Eye makeup **flat** (`mesh_decal`) | Yes | Yes | Everything in this design compiles; mottle goes into alpha |
| Eye makeup **faceted** (Shimmer) | Yes | Yes, plus the facet normal map | As flat |
| Eye makeup **fresnel** (Colour-shifting) | Base colour is a 16² uniform texture on head UV today; per-texel base colour would need a head-UV-size map (no UV transform in that template) | Per draw | v1: solid paint only in a Colour-shifting preset; gradients are omitted with a plain reason |
| Eye makeup **glitter** | No route (the Glitter finish stays preview-only) | — | Unchanged guard |
| Nails **`metal_base`** | Yes | Yes, plus normal | Everything compiles ([Nail Salon §4](../nails/nail-salon-design.md#4-material-and-finishes)) |
| Tattoos (later) | Decal or overlay routes per the tattoos brief | — | — |

- **Resolution.** Text and thin strokes are limited by the export grid, not the vector model. The legibility hint (§3.4) uses the space's texel size.
- **Antialiasing.** The feather floor per space is at least one export texel, so edges never alias in the texture. Mips are built from the final raster, as today.
- **Determinism.** The same recipe, font hashes and seeds give byte-identical rasters on every machine, as today's exports do.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Edge counts from text blow the raster budget | Edge grid, point and edge caps, cooperative cancellation (as today); measure on a 30-letter path text at 2K before V3 merges |
| Font licences misread | OFL only for bundling, licence file checked per font at acquisition, credits entry; local fonts never shipped |
| Different font versions change a look | `FontRef` by SHA-256; a hash mismatch is a missing font with a one-click accept |
| On-skin proportions look wrong on strongly curved UV | Per-glyph charts for path text; a "UV proportions" toggle for authors who want raw UV |
| Mottle reads as noise, not skin | Presets tuned against close-up references; off by default; the in-game session compares Powder and Mascara smudge at close range |
| Byte-identity regressions for old recipes | Parity gates on every phase; the legacy single-contour path kept as the fast path |

## 12. Questions, with proposed defaults

| # | Question | Proposed default |
|---|---|---|
| VQ1 | Which fonts to bundle? | About 12 OFL families across display, script, pixel, text and symbols (§3.3), chosen with a quick visual board |
| VQ2 | Allow the player's installed fonts? | Yes, local only, identified by hash, with a plain notice when sharing |
| VQ3 | Text on the face: on-skin proportions by default? | Yes; raw UV as an option |
| VQ4 | Rich text (per-character colour or font inside one text layer)? | Not in v1; "Split to letters" instead |
| VQ5 | True vector booleans (union, subtract, intersect)? | Deferred; clip and knockout cover most uses without losing editability |
| VQ6 | Mottle default when on: edges or everywhere? | Edges, with the Powder preset |
| VQ7 | Gradient interpolation default? | OKLab |
| VQ8 | Stroke and fill with different finishes in one layer? | No: split into two layers with one action |

## Related

[Nail Salon design](../nails/nail-salon-design.md) · [Feature-module platform](feature-module-platform.md) · [Selectors design](selectors-design.md) · [Path and falloff design](path-and-falloff-design.md) · [Directional softness](directional-softness-contract.md) · [Projected tangents](projected-tangent-controls.md) · [Shape gestures](shape-gesture-contract.md) · [Raster performance](raster-performance.md) · [Decal reference](../materials/shader-decal.md) · [Tattoos brief](../character-customization/tattoos-brief.md)
