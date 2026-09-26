# Brow editor design

**Status: research proposal, 26 September 2026. Nothing is built.** This is the design the [brows and cheeks brief](../backlog/brows-and-cheeks-brief.md#decisions-26-september-2026) asked for in decision 7: how XF Studio should build its eyebrow editor, starting from the eyebrow editor of an earlier first-party character-creator project and adapted to the game. It follows the brief's decisions: symmetric texture styles on the vanilla brow strip first (option A), per-side and larger brows later (option B), colour from the creator's row, and 2048 × 1024 textures by default with a 1024 × 512 option. The game facts come from [eyebrows](../../knowledge/brows.md) and [hair shading §6](../../knowledge/hair-shading.md#6-brow-decal-colour-blend-mesh_decal_double_diffusemt). The earlier project was only read; nothing from it is copied into this repository, and the implementation here would be written from scratch.

Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[source]** compiled programs or tool source, **[resource]** extracted game or mod resources, **[hypothesis]** not yet established. Nothing here has runtime evidence.

## Summary

- **The earlier editor** authored brows as **fields rather than strokes**. A brow is an outline polygon on a flattened skin chart, any number of density centres (each with directional falloff "spokes"), and a separate set of flow controls. Each flow control carries direction, length, curvature, lift, how closely hairs follow the flow, variation, thickness and taper, and these blend smoothly across the brow. Individual hairs are *generated*, never drawn: a seeded, stratified set of candidate roots is accepted against the density field, and each root grows a curve by tracing the flow field across the skin. Hairs were drawn as 3D ribbons with an exact per-pixel coverage filter. There was no texture output: a planned "baked far view" was never built.
- **Here the output is the game's brow texture set**, not 3D hair: `_d` (hair coverage and tone), `_ds` (soft underlay) and `_n` (hair relief) on the one shared vanilla brow strip, tinted in game by the creator's colour gradient. That makes the earlier model a better fit than it was in its own project. The vanilla brow UV is already a flat, nearly isometric chart shared by both brows, so the hardest parts of the earlier work (surface charts, tracing across 3D triangles, depth and contact filtering) fall away. What remains is a deterministic 2D groom rasterised into textures.
- **Proposed shape:** a new pure engine, `engines/strand-field/` (fields, root sampling, curve tracing, texture rasterisation). It is reusable later for lashes, stubble, body hair and hairlines. The feature module `features/eyebrows/` supplies the part, actions, chart editor, preview renderer and a CCXL exporter that joins the vanilla `eyebrows` row. It does not reuse the layered-makeup engine, whose shapes-and-finishes model does not describe hair; brow *makeup* (tint, gel, brow-bone highlight) stays in eye makeup, which already reaches the brow region.
- **Colour:** the authored `_d` RGB is **greyscale tone** (per-hair and root-to-tip lightness around the level that reproduces the gradient colour exactly), so every creator colour and installed hair-colour pack applies unchanged. Lightness variation, including a lightness ombre along the brow, survives the gradient. Only hue changes need the opt-in "authored colours" mode, which gives up the colour row.
- **Effort:** about 3½ to 4½ weeks of agent work for the symmetric first version (six phases, §5). Phase 0 is a day of offline fact-finding that should run before anything else.

## 1. The earlier editor

An earlier first-party project built a general 3D character creator: a browser studio on its own head mesh, derived from an open-source research head model, with no connection to Cyberpunk 2077. Its brow work ran from late August to mid-September 2026 (inspected read-only at commit `f6546acf86bfb6b446d67f9bd293ea165bdbf399`; the brow source files are clean at that commit). The editor is under `apps/creator/app/head-lab/native/` (`native-brow-*.ts` and `brow-fields/`), with its direction in `docs/research/FACIAL_EYEBROW_FIELD_GROOM_DIRECTION_V2.md` and results in `docs/reviews/20260907-*brow*` to `20260912-brow-placement-checkpoint.md`. The field model was the maintainer's own proposal in that project, recovered and rebuilt after a fixed "study brow" proved too rigid.

### 1.1 Authoring model

It had three generations:

1. **Fixed groom (v1).** A seeded 32 × 12 lattice with jitter over a fitted arch, about 96, 192 or 384 hairs per brow as **exact nested prefixes** (farthest-point order, so a denser profile only adds hairs), each stored as a triangle and barycentric root plus six surface guide points. It proved attachment and rendering, but not creative control.
2. **Field groom (the editor worth reusing).** The authority is a declarative field document; hairs are always regenerated from it:

   | Element | Contents | Behaviour |
   |---|---|---|
   | Outline | Polygon on the brow chart, at least 3 points | Must be simple (self-crossing is rejected rather than guessed) and inside the supported skin patch, checked edge by edge, not just at vertices. A soft `edgeFade` band blends density to zero inside the edge. |
   | Density centres | `position`, `amount` 0–1, two or more falloff spokes `{angle, radius}` | Radius is where density reaches **zero** (compact support), interpolated smoothly and periodically between spokes, so a sharp upper edge and a soft lower or tail edge are independent. Profile `amount · exp(−2r²/(1−r²))`: flat at the centre, smooth to zero at the edge. Centres combine as `1 − Π(1 − dᵢ)`, so overlaps saturate instead of summing. |
   | Flow controls | `position`, influence `radius`, `angle`, `length` (≤ 20 mm), `curvature`, `lift`, `adherence` ("follow flow"), `disorder` ("natural variation"), `thicknessScale`, `tipTaper` | Gaussian-weighted blend of unit direction vectors and scalars. Where directions cancel, the point reports "no flow" explicitly (orange dot) instead of inventing a direction. |
   | Per-side style | `fields`, integer `seed`, `densityPerMm2` (0–12), hair `radiusMm`, linear RGB `colour` | One per brow. |

   Density and flow are **independent**: editing one never moves the other.
3. **Placement.** Height and arch sliders are *relative* edits that warp the stored fields: an area-preserving vertical shear with a smooth arch profile peaking at 68 % along the brow. Flow directions follow the warp's derivative and falloff spokes keep their moved endpoints. After a reload the sliders read zero again. A least-squares inverse recovers the current height and arch from the outline, so repeated edits never accumulate error.

### 1.2 Data format

A JSON field document, schema `version: 1`, pinned to a chart ID (`native-brow-surface-chart-v1`), saved inside the character document with its own side and seed. Parsing is strict: exact key sets, finite numbers inside declared ranges, unique control IDs, falloff spokes sorted and never sharing an angle, and a side-specific domain check. Unsupported or incomplete records throw with a plain message. The standalone editor could export and import the field document as text.

### 1.3 Interaction

- A flattened chart in SVG over a small false-colour density canvas, with flow arrows sampled on a grid, whose opacity shows flow coherence.
- Draggable handles: outline points (gold), density centres (blue) with their spokes shown when selected, flow centres (lilac) with a direction handle.
- Mouse targets are 20 px regardless of zoom and visible dots 7–9 px. A drag starts only after 3 px of movement and keeps the grab offset. A drag ends if no button is down, so a lost release can't turn hovering into edits.
- Keyboard: focus a handle and nudge it with the arrow keys; every nudge is one Undo step.
- Buttons: add or remove density and flow controls, insert or remove outline points, add a falloff spoke in the widest gap. Every field has an exact numeric input. Undo/Redo is one entry per gesture.
- **Symmetry:** "Mirror to left/right" copies one brow's settings to the other, and "Edit both brows" pairs every later edit (remembered per device). Both charts run medial to lateral, so mirroring copies coordinates with **no flip**. The seed is mixed with the side, so mirrored settings still grow different individual hairs: natural twins, not clones.
- A resizable sidebar (320–840 px) gave the editor room; the maintainer confirmed the prototype and resizer were useful.

### 1.4 Generation and rendering

- **Roots.** A per-side candidate bank is generated once per seed: each skin triangle is split into cells until a cell holds at most one candidate at the maximum density, then one uniform random point per cell (stratified, not blue noise). Each candidate carries a fixed random `acceptanceVariate`, and a root is accepted when `variate < densityPerMm2 · cellArea · density(p)`. Consequences: raising density or widening a falloff **only adds hairs**, lowering removes them, and no other root moves. Areas are measured once on the neutral head, so an expression stretches the same follicles rather than resampling them. A minimum-distance variant was rejected because it lost 30–40 % of the requested count.
- **Curves.** Starting from the root, the tracer steps about 0.35 mm at a time across the chart using the true surface metric (midpoint integration). The direction blends the root's flow with the local flow by `adherence`, then adds curvature × distance along the hair and a smooth, spatially correlated variation term scaled by `disorder`. Radius tapers as `1 − taper·t^1.5`, and lift rises quadratically. A hair that leaves the patch or meets cancelling flow is reported as a failure with its reason, never silently dropped.
- **Drawing.** Four-sided tubes were rejected for speckling. The replacement draws camera-facing strips whose fragment shader integrates the strip over a square pixel: the exact trapezoid convolution of a pixel footprint projected onto the strip normal, with an extra pixel of padding. It was verified against an independent polygon-clipping oracle to within about 1/255. Shading was a simple diffuse proxy with no fibre scattering or hair shadows.
- **Caching.** Candidate bank per seed; density weights keyed by outline, fade and density controls; accepted roots keyed by density rate; curves keyed by flow, seed and radius; a colour change reuses the curves. An edit to one brow never re-evaluates the head.

### 1.5 What worked and what was left unfinished

Worked (per its reviews): the independent density and flow model, directional falloff, deterministic and stable roots, explicit failure reporting, mirror and paired editing with a single Undo entry, height and arch without drift, the exact pixel coverage filter, and strict document validation with recovery messages.

Left unfinished or rejected:

- The default groom looked **too uniformly combed**. At higher density the parallel flow produced "a narrow, uniform ribbon". The recorded next step was separate upper and lower flow populations and crossing hairs, seen in the reference crops.
- The planned per-region property fields (spacing, sweep, **clumping**, pigment gradients) stayed at "planned".
- The **baked distant view** (colour, direction, coverage and roughness into a texture from the same field, without doubled pigment) was never built.
- The design-continuity UI pass stayed blocked, so the handle-only interface was never reviewed as a product.
- Performance: the first 576-hair generation took about 293 ms, explicitly "not a smooth-drag admission", with a hard preview cap of 8,192 hairs.
- Hairs faded against steeply sloped skin (a depth-before-filter ordering flaw). Lashes were never admitted.
- The stratified sampler kept measurable anisotropy, and the placement warp approximates sheared flow supports as circles.
- Focus moved to skin and lighting before the brow was refined.

### 1.6 Fixtures and references

- Unit tests: `apps/creator/tests/native-brow-{fields,groom,chart,placement}.test.mjs`. They check known values at density centres and supports, spoke interpolation and wrap-around, density/flow independence, thickness and taper blending, rejection of malformed documents, deterministic roots, and placement inverses.
- Six private photographic brow crops, supplied as references (in the project's ignored `reference-images/eyebrows/20260907-user-fields/`). Their written notes describe fine hairs with a soft edge; long overlapping shafts; a whole-eye view for judging overall weight; a dense body with irregular crossings; a dark centre with fine edge hairs (density and pigment are separate controls); and a sparse brow with long crossing hairs and visible skin. They show **crossing shafts** and upright medial hairs, not one local direction plus noise. They are private reference material and are only described here.
- An earlier generated 16-example photographic brow sheet (qualitative scale and flow only), which exposed jagged tips and a straight "transplant row" at the front edge.

## 2. What changes in this context

| Concern | Earlier project | XF Studio brows |
|---|---|---|
| Output | 3D strands drawn live | Three textures per style on one shared mesh ([eyebrows §1](../../knowledge/brows.md#1-the-chain-at-a-glance)) [resource] |
| Chart | Flattened chart of 458 head triangles per side, needing domain, collapse and seam checks | The brow's own UV, already flat, shared by both brows, u not flipped [resource]. 72.8 mm per unit along the brow and 34.2 across, so a 2048 × 1024 texel is about 0.036 × 0.033 mm, nearly square [resource] |
| Surface tracing | Across 3D triangles with a smooth frame | In 2D texture space with a per-triangle metric (§3.3) |
| Contact and depth | A real unsolved problem | Gone: the decal is lifted 0.35 mm and blended by the game |
| Colour | Linear RGB per brow | Gradient from the creator's colour row via ArchiveXL's `@brows` material; the texture supplies tone only [resource] [source] |
| Symmetry | Two charts, mirror or pair | One shared UV area: symmetric by construction until option B adds per-side UVs |
| Deformation | Barycentric roots follow edits and expressions | The mesh is skinned to the face rig and carries the head's morphs; the texture needs nothing [resource] |
| Far view | Unbuilt bake | The texture *is* the bake. Mips are ours to author (§3.5) |

## 3. Proposed design

### 3.1 Module shape

| Piece | Location | Owns |
|---|---|---|
| Engine | `engines/strand-field/` (pure, no DOM) | Field schema and evaluator, candidate bank and acceptance, curve tracer, texture rasteriser and encoder, mip builder. Takes a `StrandChart` (the metric chart and its outline domain) as input, just as layered makeup takes a `LayeredMakeupRegion`. Holds no brow data of its own. |
| Feature core | `features/eyebrows/` | Part codec `xfs/brow-part-1`, actions, editor memory (selection, active handle), gesture provider, targets, catalogue (starter styles) |
| View | `features/eyebrows/view/` | Chart panel, inspector, starter-style browser, hint and cursor entries in the input-binding table |
| Renderer | `features/eyebrows/render/` | Draws the vanilla brow mesh for the V's body gender with the authored textures, superseding the V's own brows |
| Exporter and verifier | `features/eyebrows/export/`, `verify/` | CCXL brow styles joining the vanilla `eyebrows` row, default brand "XF Brow Artistry" |

Why a new engine rather than the layered-makeup engine: the layered engine composes shapes with finishes into a colour and material stack. A brow is a population of hairs whose coverage, tone and relief all come from one groom. Forcing hairs into layers would add a second authority for the same brow, which is the double-pigment problem the earlier direction warned against. The two engines stay complementary: eye makeup keeps brow tint, gel and brow-bone highlight over any brow. A per-style **powder or pencil fill** belongs to the groom (a field-driven soft term, §3.5), not to a makeup layer.

### 3.2 Part schema (sketch)

```ts
type BrowPart = {
  schema: "xfs/brow-part-1";
  chart: "vanilla-brow-uv-1";             // the shared strip; option B adds "brow-per-side-uv-1" / "head-uv0-brow-cut-1"
  sides: { mode: "symmetric"; style: BrowStyle }            // v1
       | { mode: "per-side"; left: BrowStyle; right: BrowStyle; linked: boolean };  // option B
  resolution: "2048x1024" | "1024x512";  // default 2048x1024
  colour: { mode: "creator-row"; previewColour?: string }   // colour name for preview only; not exported
        | { mode: "authored"; stops: … };                   // opt-in, loses the colour row
};
type BrowStyle = {
  fields: StrandFields;                  // outline, edgeFade, density[], flow[]: the earlier model (§1.1)
  seed: number;                          // uint32
  densityPerMm2: number;                 // expected hairs per mm² at full field strength
  hairWidthMm: number;                   // root width
  tone: { base: number; variation: number; rootToTip: number; along?: Knots };   // greyscale, §3.6
  powder: { amount: number; softnessMm: number };           // field-driven underlay, §3.5
  relief: { strength: number };          // normal-map strength
};
```

The part stores the whole brow as data, never pixels: a style is a few kilobytes, the history can split it into chunks cleanly, and textures are regenerated deterministically. Coordinates are in **millimetres in the chart**, not UV units, so a style can move to a different chart (per-side UVs, a head-UV cut) with a change of metric, and no numbers need re-tuning.

### 3.3 The chart: the brow UV with a real metric

- The chart is the brow's UV area, oriented medial to lateral, and the working plane is millimetres (the mean scale is 72.8 × 34.2 mm per UV unit [resource]). Phase 0 measures the **per-triangle Jacobian** of the vanilla female strip (positions against UVs) and stores it as a small table. Tracing uses it so that a 6 mm hair is 6 mm on the face wherever the UV stretches, and root density is per face-mm² (the earlier project's "fixed neutral area" idea). If the strip proves isometric within a few per cent, a constant scale is enough, and the table becomes a check instead.
- **Both genders share the textures but not the UV footprint.** The male strip spans u 0.029–0.924, v 0.111–0.955, against the female's u 0.022–0.985, v 0.162–0.979 [resource]. The chart panel draws both footprints and the vanilla content box (u 0.05–0.86, v 0.20–0.67 [resource]) as guides. The domain check refuses outlines outside the intersection of both footprints, with a plain message ("Keep the brow inside the area both body types show"). The preview draws the V's own body gender.
- The chart has one boundary, no seams and no concavity to guard, so the earlier edge-by-edge domain test carries over directly.

### 3.4 Generation

Adopt the earlier pipeline almost unchanged, in 2D:

1. **Candidate bank per seed.** Split the chart into cells by metric area so that each cell holds at most one candidate at the maximum density (12/mm²; one brow's share of the strip, about 1,250 mm², gives about 15,000 candidates). Place one candidate per cell with a fixed acceptance variate. The random numbers come from integer hashing only.
2. **Acceptance** `variate < densityPerMm2 · cellArea · density(p)`: monotone, stable roots, nested densities.
3. **Curves** traced by midpoint steps of about 0.25 mm through the flow field with adherence, curvature, taper and variation. Lift has no meaning on a flat decal, so it becomes a **tip fade**: lifted tips show less of the skin-plane silhouette, and the relief term tilts them (§3.5).
4. **Crossing populations.** New here, and addressing the earlier "combed ribbon" failure and the reference crops. Each flow control gets an optional `layer` (upper or lower) and each root is assigned to a layer by a smooth split across the brow. The two layers flow at different angles and cross, as real brows do: lower hairs rise up and out, upper hairs lie down and out.
5. **Clumping** (the earlier planned field): nearby tips are pulled toward a shared clump centre, with strength from a per-control scalar.

Failures are reported per root with a reason, and the chart shows them. They are not silent.

Determinism: the whole pipeline must give **byte-identical textures** in the browser preview and on the export host, because the host builds from the part. The earlier project hit this exact trap (Node and browser `Math.sin` differing in the last bit) and its variation term used `Math.sin`. Here, acceptance thresholds and variation use integer hashes and polynomial noise, transcendental functions stay out of any comparison that decides whether a hair exists, and a golden test pins texture hashes.

### 3.5 Texture outputs and encoding

The engine produces physical **area coverage** `C` per texel (each hair a tapered strip, box-filtered over the texel with the earlier project's exact trapezoid footprint filter, ported from a shader to a worker rasteriser), plus per-texel tone and hair direction. Overlapping hairs combine as `1 − Π(1 − cᵢ)`. The encoder then maps that to what the game's double-diffuse program expects.

| Map | Content | Encoding | Grade |
|---|---|---|---|
| `_d` alpha | Hair coverage plus the powder term | The program squares coverage *after* filtering: `(p + (1−p)·s·k)²` [source]. With `s = 0` the encoder writes `p = √C`, so what shows in game equals the area actually covered. With a nonzero powder underlay it solves `p = (√C − s·k)/(1 − s·k)`, clamped. | Formula [source]; that this inversion is what looks right in game is [hypothesis], test ask 2 |
| `_d` RGB | Greyscale tone (§3.6) | sRGB-tagged (`isGamma` 1), so the encoder targets *linear* values | [resource] |
| `_ds` alpha | Powder underlay | Vanilla ships 64 × 32; we would ship 256 × 128 (a soft term needs little resolution). **Caution:** the secondary term is tinted by the material's constant `SecondaryDiffuseColor`, not the gradient [source, via the [brow material study](../eye-artistry/brow-lash-fidelity.md)], so heavy powder would stay brown for a blonde brow. The default is therefore `_ds` = 0, with powder folded into `_d` alpha through the inversion so that it follows the colour row. `_ds` stays available for an explicit "tinted underlay" option. | [source] |
| `_n` RG | Hair relief | Each hair as a cylinder lying on the skin: the normal tilts across the hair's width perpendicular to its direction, weighted by coverage, and is flat elsewhere (the program's reoriented blend fades flat texels out). Strength goes into the style's `NormalAlpha` (vanilla 0.4, Arkhe 0.8). Tangent-frame handedness on the brow strip is checked in phase 0 and in game with an arrow test pattern. | Encoding [resource]; frame [hypothesis] |
| Roughness | – | v1 keeps the vanilla `roughmetal` constant (≈ 0.5), so no style texture is needed. A later **brow gel** finish could supply a `RoughnessTexture` (glossy hairs), a natural link to the finish menu's Glossy family. | [resource]; gel [hypothesis] |

**Mips.** Because the program squares *after* filtering, a plain box mip of `p` darkens nothing but thins the brow at a distance: the mean of `p`, squared, is less than the mean of `p²`. The exporter therefore builds its own chain from the linear coverage: level `n` holds `√(mean C)` over its footprint, which preserves each level's mean on-screen coverage. Arkhe's installed chain is a plain box reduction [resource] ([mip gate](../eye-artistry/brow-lash-mip-gate.md)), so this is an improvement to test, not a copy (test ask 2).

**Sizes and format.** At 2048 × 1024, BC7 with mips is about 2.7 MiB per map, about 5.4 MiB per style for `_d` and `_n`; at 1024 × 512 it is about 0.7 MiB per map. Arkhe ships uncompressed RGBA chains (about 10.7 MiB per map) [resource]. The Studio should use BC7 for `_d` and the normal-map compression the vanilla `_n` uses (phase 0 confirms the format). Hair edges at 0.035 mm per texel survive BC7; a side-by-side check of the encoded result is part of phase 1.

### 3.6 Colour

- **Creator's row (default, decision 2).** The program's colour is gradient × `GradientMapIntensity` × primary RGB [source]. The style's own `.mi` (ArchiveXL's `BrowsBaseMaterial`) keeps the vanilla intensity of 2, and the tone map is centred on linear 0.5, which reproduces each gradient colour exactly. Per-hair tone variation (a few hairs lighter or darker), root-to-tip lightening and a **lightness ombre along the brow** (for example a softer, lighter front and a defined tail) are all greyscale, so they survive every colour, including installed hair-colour packs that patch the brow scope. Arkhe's style-18 `_d` has identical greyscale RGB channels [resource] ([texture audit](../eye-artistry/brow-texture-audit.md)), which confirms that mods ship tone this way.
- **Preview colour.** The preview uses the V's current `eyebrows color` choice. If the V has no brow colour (brows Off), it preselects the brow colour whose name matches the V's hair colour (decision 2). This is a preview convenience stored in `previewColour`, not exported.
- **Authored colours (opt-in).** Hue changes along the brow need colour baked into `_d` RGB with `UseGradientMap` 0, and the colour row no longer applies [resource]. The inspector explains the trade in one line before it is switched on. It is not in v1.

### 3.7 Symmetric now, per-side later

v1 stores one `BrowStyle` (`mode: "symmetric"`): the vanilla strip cannot show anything else. The per-side mode is already in the schema so that option B is an addition, not a migration:

- **Per-side UVs** (a UV-only variant of the vanilla strip) or a **head-UV0 brow cut** (option B in the brief) supply a chart per side. Both are charts with a metric, so styles transfer in millimetres.
- The editor gets the earlier project's **Mirror to other side** and **Edit both brows** (linked) controls, with the same "no flip" rule for medial-to-lateral charts and a side-mixed seed, so linked brows grow natural twins rather than clones.
- The first per-side step reuses a symmetric style on both sides and then diverges, so users start from what they had.

### 3.8 Editor and gestures

- **The chart panel** (a new `brow` viewport scope beside `head` and `uv`) shows the brow texture area with the live coverage preview, and on request the density heatmap, flow arrows and failure dots. It also shows both body types' footprints and the vanilla content box. Handles are the earlier set (outline points, density centres and spokes, flow centres and directions), with 20 px targets, the 3 px drag threshold, grab-offset drags and arrow-key nudges. Each drag or nudge is one platform gesture transaction: Escape restores the start, one Undo entry.
- **Input bindings** go through the typed table ([input bindings](../authoring/input-bindings.md)). Shift keeps its Studio meaning of a shape gesture: Shift-drag on the outline or a density centre rotates it, and Shift-wheel scales a density centre's spokes together. Ctrl-drag pans the chart, as in the UV map. Right-click on a handle opens only actions that apply to that handle (remove this control, add a spoke, insert an outline point).
- **Comb brush (new here).** Drag across the chart to comb: the stroke becomes a small chain of flow controls along its path, directions taken from the stroke. This answers the earlier project's pending UI review, where every flow point had to be placed and aimed by hand. The data stays the same sparse controls, so combed brows remain editable with handles.
- **On-head editing.** A pick on the brow mesh maps through its UV to the chart, so handles can also be dragged on the face. The diagnostic views (density, flow) show on the head for free by swapping the preview's `_d` for a false-colour texture, which replaces the earlier project's separately built skin-mounted overlay.
- **Starter styles.** A handful of built-in field documents (soft natural, defined arch, straight, full, sparse, fine tail), each an ordinary style the user edits. They are defined in the Studio, not taken from vanilla or mod textures.
- **Guidance.** Density and flow are unfamiliar terms. The first-run tour spotlights one density centre ("where hairs grow, and how thickly") and one flow control ("which way they lie"), following the Studio's actionable-hint rule.

### 3.9 Preview in the Studio viewport

- The brow renderer draws the **vanilla brow mesh for the V's body gender** (loaded through the host's detail loader), attached to the head with facial shapes and rig (`attach(…, { morphs, rig })`). It supersedes the V's own brow component (`supersede` the `eyebrows_color` slot) and feeds the authored textures to the platform's double-diffuse adapter.
- The preview renders the **encoded** textures, the same bytes the exporter writes, through the game's formula (squared coverage, gradient × intensity × RGB, square-root blend), so the encoding is what gets judged, not an internal buffer.
- **Prerequisite:** the adapter still draws no brow normal and a fixed roughness of 0.8 ([eyebrows §5](../../knowledge/brows.md#5-what-the-studio-draws-today)). Moving brows onto the face-decal family's double-diffuse member (`src/face-decal-material.ts`, which already writes both) is required before the preview can show relief or match brow gloss.
- **Quality.** While dragging, the renderer rasterises at 1024 × 512; when the pointer settles it rasterises at the style's resolution, in the worker, with the Studio's complete-bundle rule (never a half-updated texture set). Readiness is reported through the platform.

### 3.10 Export

The route is the one two installed mods and ArchiveXL's own brow framework use ([eyebrows §4](../../knowledge/brows.md#4-how-mods-add-brows)) [resource] [source]:

- A CCXL resource declares a switcher named `eyebrows` whose new choices activate appearance options in slot `eyebrows_color` (link `eyebrows color`, 35 colour definitions). ArchiveXL merges them after the vanilla styles in the same row. Options go into the `TPP`, `TPP_photomode` and `character_customization` head groups.
- **One mesh per style** in ArchiveXL's `player_{wa,ma}_brows` scope, defining only `black_carbon`, with the dynamic `@context`/`@brows` material pair. Every colour, including installed packs, then comes from ArchiveXL (the scopes guide warns that several styles in one mesh block later colour extension).
- Geometry: take the vanilla strip through ArchiveXL resource copy and patch, as Arkhe does, rather than shipping game geometry bytes. Both genders use the same texture set. Which of the two geometry routes (copy/patch or full geometry, as Even More Brows ships) is simpler for our verifier is decided in phase 5.
- Resources live under `…/<key>/eyebrows/` with `xfs_` names. The product plan puts eyebrows in the default "XF Looks" product with eye makeup, or in its own "XF Brow Artistry" mod when split (decision 6).
- The independent verifier checks: switcher and option names and groups, one mesh per style, the `black_carbon` and `@brows` pair, texture sizes, formats and complete mip chains, and that texture hashes match the plan. It cannot claim the result renders; that stays a runtime question.

### 3.11 Performance budget

A dense brow is about 1,500 hairs of about 25 segments. At 2048 × 1024 each segment touches roughly 60 texels, so a full rasterisation is a few million simple operations: tens of milliseconds in a worker, well under the layered engine's preview budgets ([raster performance](../authoring/raster-performance.md)). The earlier cache tiers keep drags cheap: candidate bank per seed; density weights per outline and density edit; accepted roots per density rate; curves per flow edit; tone-only edits skip tracing and re-encode. The earlier project's 293 ms first run and 8,192-hair cap came from 3D surface tracing and GPU buffer rebuilds, which this design does not have. Budget gate for phase 3: a drag at 1024 × 512 settles within one frame budget on the reference machine, and the 2048 × 1024 settle completes in under 150 ms.

## 4. Ideas taken from the earlier project, and what is new

| Taken from the earlier project | New for this context |
|---|---|
| Field authority: outline, density centres with directional compact falloff, independent flow controls with per-control hair shape | Chart is the game's brow UV, measured in millimetres with a per-triangle metric; both body types' footprints as guides and domain |
| Saturating density mixture `1 − Π(1 − d)`; explicit "no flow" instead of invented directions | Output is a texture set; the game's squared-coverage formula is inverted (`p = √C`) and a coverage-preserving mip chain is built |
| Stratified candidate bank with fixed acceptance variates: stable, nested roots | Greyscale tone model that keeps the creator's colour row, including a lightness ombre |
| Curve tracing with adherence, curvature, taper and correlated variation | Powder folded into primary coverage because the secondary tint is constant |
| Exact trapezoid pixel-footprint coverage for thin strips (ported from a shader to the rasteriser) | Hair-relief normal map from the strands; brow-gel roughness as a later finish |
| Mirror and linked editing, no flip for medial-to-lateral charts, side-mixed seeds | Crossing upper and lower flow layers and clumping, answering the earlier "combed ribbon" failure |
| Relative height and arch warps with a least-squares inverse | Comb brush that writes ordinary flow controls |
| Strict schema validation with plain messages; failures reported per hair | Byte-identical preview and export (integer hashing, no transcendentals in decisions) |
| Handle ergonomics: 20 px targets, 3 px threshold, grab offset, drag ends without a button, arrow nudges | On-head picking and diagnostics through the brow UV; platform gestures and the typed input table |
| Cache tiers keyed by what each edit changes | CCXL export into the vanilla `eyebrows` row via ArchiveXL's brow scope, one mesh per style |

## 5. Phased plan

| Phase | Work | Effort (agent days) | Gate |
|---|---|---|---|
| 0. Facts | From local extracts, offline: vanilla strip per-triangle metric and UV orientation (which end is medial); male/female footprint overlap; vanilla `_d` RGB levels and `_n` format and compression; the double-diffuse program's secondary-term weighting and the tangent-frame convention; the `NormalAlphaTex` default (brows open question 4) | 1 | Findings recorded in [eyebrows](../../knowledge/brows.md) |
| 1. Engine | `engines/strand-field/`: schema and parser, evaluator, bank and acceptance, tracer, worker rasteriser, encoder (`p = √C`, tone, relief), coverage-preserving mips; golden hashes; the earlier test list rewritten for this engine plus coverage-oracle tests | 4–5 | Pure tests; one golden style byte-stable in browser and host |
| 2. Feature core | `features/eyebrows/`: part codec, actions and capabilities, gestures, targets, starter styles; catalogue and capability inventory entries | 2–3 | Boundary and registry tests; Undo and Escape semantics |
| 3. Preview | Port additions (§6); double-diffuse adapter with normal and roughness writes; brow renderer with supersede, morphs and rig; worker scheduling and quality tiers | 3–4 | `?verify=1` flow; frame-budget gate (§3.11); screenshot parity for V without an XF brow |
| 4. Editor | Chart panel and scope, handles, comb brush, inspector, diagnostics on the chart and the head, starter-style browser, tour step | 4–5 | `?verify=1` interaction checks (drag, nudge, Escape, Undo, reload) |
| 5. Export | Exporter (plan, inventory, `.xl`, BC7 and mips, both genders), independent verifier, package-plan membership, pipeline document update with visual diagram review | 3–4 | Check and Build agree; verifier passes; prepared runtime session (§7) |
| Later | Option B (per-side and larger brows), authored-colour mode, brow-gel roughness, the engine's reuse for lashes, stubble and hairlines | – | Separate discussion |

In total about 17–22 agent days for the symmetric first version. Phases 1 and 2 can run in parallel once the schema is fixed. Phase 3's adapter work (brow normal and roughness) is useful on its own for preview fidelity and can start at once.

## 6. Platform gaps to record

Adding the module should touch only `compose/` lists. Step 7 deliberately left these port additions "for the first feature that needs them", and brows need them:

- `details` on the scene port, so the renderer can load the vanilla brow mesh for the V's body gender through the host's detail loader.
- A way to build a material through the platform's adapter for a template with the feature's own textures (the double-diffuse adapter with texture overrides), so no feature re-implements an engine shader.
- `jobs` (the raster worker) and `textures` (budget) on the port, plus `sync` and `readiness` on the renderer.
- The authoring core edits one live feature today; a second authored feature needs its own live document (already identified as core work for module #2).

These should be recorded in the [boundary assessment](../authoring/ui-architecture-boundary.md) when phase 3 starts, not worked around inside the feature.

## 7. Open facts and runtime test asks

Offline, in phase 0: the facts in the phase 0 row above.

Runtime, batched into the session that tests the first build (these extend the brief's [runtime list](../backlog/brows-and-cheeks-brief.md#runtime-questions-to-batch-into-a-future-session), items 1, 2 and 4):

1. **Colour row with tone.** One XF style with a strong per-hair lightness variation and a lighter front. Cycle five creator colours, including black and platinum: the tone pattern must persist and the hue follow each colour.
2. **Coverage encoding and mips.** Two copies of one style, one with `p = √C` and coverage-preserving mips, one with a plain `p = C` box chain. Compare the creator close-up and a photo-mode shot at 1.5–2 m: which matches the Studio preview's density at both distances.
3. **Relief orientation.** A test style whose hairs point in known directions, under a side light: highlights must fall on the lit side of each hair on both brows.
4. **Body types.** The same style on a male and a female V: the brow stays inside both footprints.
5. **Powder tint** (only if `_ds` is used): a blonde brow with a strong underlay, to confirm whether the underlay stays brown.

## 7a. Decisions (26 September 2026)

- XF styles appear in the creator's eyebrow row as **"XF <look name>"**.
- The **comb brush** is in the first version, beside the handles.
- About **six starter styles** ship as editable starting points.
- Brows are **baked textures** on the vanilla brow mesh (`_d`, `_n`, optional `_ds`); the strand model is the authoring model only, never game geometry.

## 8. Questions for the maintainer

Sensible defaults are chosen above; these are the choices that are genuinely his:

1. **Row labels.** How XF styles are labelled in the creator's brow row: the look's name as authored, or "XF 1, XF 2, …" (the brief's question 6, still open). Default proposal: the look's name, prefixed "XF".
2. **Comb brush in v1**, or handles only, as in the earlier editor, with the brush as a follow-up. Default proposal: include it; it is small and it is what makes flow editing approachable.
3. **Starter styles.** Is a small built-in set (about six) wanted, or should every brow start from one default? Default proposal: six.

## Provenance

- The earlier first-party project was inspected read-only at commit `f6546acf86bfb6b446d67f9bd293ea165bdbf399`, with its brow sources clean at that commit. Files read: `apps/creator/app/head-lab/native/` `native-brow-{fields,field-groom,style,sampling,curves,placement,surface,chart,groom}.ts`, `native-brow-style-controls.tsx`, `native-document.ts` (mirroring), `brow-fields/brow-field-editor.tsx`; tests `apps/creator/tests/native-brow-*.test.mjs`; `docs/contracts/FACIAL_EYEBROW_GROOM_V1.md`, `docs/research/FACIAL_EYEBROW_FIELD_GROOM_DIRECTION_V2.md`, the brow reviews dated 7–12 September 2026, `CHANGELOG.md` and `project-tracker.json` brow entries. None of its code ran, and none was copied. Its private reference crops were not opened or copied; they are described from its own written notes. Its head chart derives from an Apache-2.0 research head model, and no part of that model or chart is used here. As first-party material, it is not a community credit. A separate note, the [rendering reference](../eye-artistry/charactercreator-rendering-reference.md), covers the same project's lighting and skin work.
- Game and mod facts are cited to [eyebrows](../../knowledge/brows.md), [hair shading](../../knowledge/hair-shading.md), [materials and shaders §4.5](../../knowledge/materials-and-shaders.md#45-mesh_decal-family-post_gbuffer-all-standard-class-meshskinned-available), the [evidence note](../character-customization/brows-cheeks-evidence.md), the [brow texture audit](../eye-artistry/brow-texture-audit.md) and the [mip gate](../eye-artistry/brow-lash-mip-gate.md). The mods and guides involved (Arkhe, Even More Brows, the CCXL eyebrows guide and ArchiveXL) are already credited in [community credits](../../docs/community-credits.md).

## Related

[Brows and cheeks brief](../backlog/brows-and-cheeks-brief.md) · [Eyebrows](../../knowledge/brows.md) · [Feature-module platform](../authoring/feature-module-platform.md) · [Architecture contract](../authoring/architecture-contract.md) · [Input bindings](../authoring/input-bindings.md) · [Preview quality](../authoring/preview-quality-contract.md) · [Jewellery construction set](../jewellery/construction-set-design.md) (the preceding feature's proposal)
