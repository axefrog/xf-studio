# XF Studio makeup finishes and glitter

Owner doc for the finish part of **track 6** in the [ranked queue](README.md). Game export adapters for the remaining finishes depend on **track 4**, [materials and shader RE](materials-shader-re.md).

## Status (25 Sep 2026)

Finish menu: [seven familiar families](../materials/makeup-finish-taxonomy.md) — Matte, **Satin** (internal `regular`), Shimmer/pearl, **Metallic**/foil (never an alias for shimmer), Glitter, Glossy/wet look, Colour-shifting (duochrome/multichrome). The original four legacy classes are historical intent, not a cap.

| Finish | Browser preview | Game export (Check/Build) | In-game |
|---|---|---|---|
| Matte, Satin, Metallic | Provisional studies | **Supported** by the flat `mesh-decal-flat-v1` compiler; independently verified private candidates | **Not tested.** First smoke test prepared ([card](../authoring/first-makeup-runtime-preflight-2026-09-25.md)); Satin only if the five-preset candidate is staged |
| Shimmer | Game-matched model follows the export route; earlier layers keep the fine-facet study | **Experimental** `mesh-decal-faceted-v1` for game-matched layers ([design](../materials/finish-designs/shimmer.md)); earlier-model layers omitted with a reason | Not tested. [Finish board](../../experiments/016-finish-board/README.md) Board 2 prepared (verified offline, not installed); earlier fixtures [010](../../experiments/010-shimmer-game-adapter/README.md), [011](../../experiments/011-shimmer-plate-comparison/README.md) |
| Glitter | Opt-in models: `xfs/recipe-7` irregular raster, `recipe-8` direct-light UV-cell, `recipe-9` clustered, `recipe-10` denser fine speckle | **Guarded** — omitted with a warning ([design](../materials/finish-designs/glitter.md)) | Explicitly lossy recipe-driven decal fixture ([009](../../experiments/009-glitter-game-fixture/README.md)); stock particle decal rejected as facet shading. The finish board's coarse Shimmer stripe is a resolved-facet proxy |
| Glossy | Game-matched model: one lobe, no clear coat; earlier layers keep the clear-coat study | **Experimental** flat single lobe for game-matched layers ([design](../materials/finish-designs/glossy.md)) | Not tested; finish board Boards 1–2 |
| Colour-shifting | Game-matched model: Fresnel shift colour and strength; earlier layers keep the thin-film study | **Experimental** `mesh-decal-fresnel-v1`, one colour-shift pigment per preset ([design](../materials/finish-designs/colour-shifting.md)) | Not tested; finish board Boards 3–4 |

No glitter model has a proven REDengine mapping or photographic match. Recipe-10 increases visible close and face-scale glints but can look frosty. A generated candidate count is not a visible sparkle count.

### Open

1. Run the [finish board](../../experiments/016-finish-board/README.md) session, then tune or withdraw the experimental Glossy, Shimmer and Colour-shifting adapters from its evidence. Glitter's next candidate is the faceted route with coarse, independently coloured flakes ([design](../materials/finish-designs/glitter.md)).
2. Prove mixed-finish presets: flattening, real multilayered materials or coordinated components, without losing coverage or reflection behaviour ([multilayered assessment](../materials/multilayered-makeup-assessment.md)).
3. Glitter: continue browser/photo acceptance against the supplied references (irregular fine flakes, varied sizes, pigment visible between glints, stable filtering at editing distances, no unrelated flicker); then a bounded stock-material game candidate in a batched runtime comparison. **Do not lift the export guard on browser sparkle alone.**
4. Test island_dancer's full conceptual sequence (below) in an independently authored study.
5. Multichrome, and colour shift inside mixed presets (a second component), remain research.

## Rules

- Version the optical model when its appearance changes; older recipes keep their original look. Keep resource budgets, cancellation, disposal, migration and all game-export guards.
- Define intended looks clearly and validate against references; brand finish terms overlap. Satin is a soft sheen without distinct sparkles. Never present a finish name, thumbnail, metallic slider or browser-only result as a validated engine appearance.
- Batch game comparisons into one prepared session (the maintainer runs it); measure loading/cache cost as well as appearance.
- **Acceptance:** intentionally distinct useful finishes, a convincing glitter effect in game, documented resource/shader implementation, a useful browser preview and captured comparison evidence.

## Investigation deliverables (original brief, still valid)

1. Map REDengine material resources, inheritance, channel packing, render states and shader selection (`.mt`, `.mi`, shader cache). Shipped shaders were suggested as references; establish what is inspectable rather than assuming editable source. Now generalised as [track 4](materials-shader-re.md).
2. Search installed game/mod materials for useful sparkling cosmetics, flake paint, fabrics, jewellery; distinguish glints from emission, static speckle, rough metal or animated particles.
3. Design separate responses per finish. A glitter candidate supports sparse flake size/density/orientation, light/view-dependent glints, base pigment, roughness and coverage.
4. Browser approximation from the same masks/parameters with a reproducible light/camera study; handle minification, aliasing and temporal stability.
5. Package a small comparison matrix of finishes, palettes and overlap layers for one batched game session.

Evidence so far: [initial shader investigation](../materials/glitter-shader-investigation.md) (78 glitter programs extracted; the named FX shader is emissive with a different pipeline — a lead, not a cosmetic material), [Experiment 002](../../experiments/002-flake-material/README.md) (first reflective candidate), [Experiment 003](../../experiments/003-decal-material-import/README.md) and the [decal shader contract](../materials/mesh-decal-shader-contract.md), [REDengine glint feasibility](../materials/redengine-glint-feasibility.md), [implementation contract](../materials/glitter-implementation-contract.md), [fine-speckle study](../materials/fine-speckle-browser-study.md), [clustered study](../materials/clustered-direct-glint-study.md), [direct-glint checkpoint](../materials/direct-glint-browser-checkpoint.md), [visibility audit](../../experiments/007-irregular-glitter/visibility-audit.md), [lit-head findings](../../experiments/007-irregular-glitter/lit-head-findings.md), [glint oracle](../../experiments/007-irregular-glitter/glint-oracle-findings.md), [UV-cell pilot](../../experiments/007-irregular-glitter/uv-cell-glint-findings.md), [particle-decal audit](../../experiments/009-glitter-game-fixture/particle-decal-audit.md).

Legacy labels were **matte, regular, shimmer, glitter**. `D:/Dev/xf-omega/source/projects/xf-eye-artistry-ccxl/materials.ts` emits identical property sets for matte/regular and for shimmer/glitter; those names are not evidence of working distinct effects. Reimplement intended appearances cleanly. The wiki [materials overview](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/materials) and [multilayered guide](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/materials/multilayered) were supplied as research leads.

## Visual correction requested 23 September

Review found that the original glitter preview did not look like glitter: regularly spaced, similarly sized dark dots/rings with small highlights over a solid base. The supplied reference photographs set the target: irregular fine reflective flakes, varied apparent sizes and spacing, dense and sparse areas, pigment visible between glints, and highlights merging toward fine sheen at distance. The peach/copper reference is a more continuous reflective look; keep it as a related finish reference. Large soft circles in the close-up are partly photographic defocus — do not bake bokeh into flakes or force all highlights permanently bright. The irregular/direct models (recipe-7..10) are the response; the correction is not yet accepted.

All supplied images are preserved locally, originals unchanged; the [reference manifest](glitter-visual-references.json) records paths, hashes and unresolved photo authorship. Do not bundle them as application assets. [Reference review](../materials/glitter-reference-review.md).

## island_dancer's glitter graph

A copy of [island_dancer's Substance Designer glitter graph](../materials/island-dancer-glitter-graph.md) was supplied. island_dancer's intended sequence: triangle/square primitives, an axial gradient on each, heavily randomised tiling, then height-to-normal. For colour, convert the height-to-normal result to greyscale; Histogram Select maps its lighter range to colour A and darker range to colour B, then multiply-blend. Possible roughness/metalness maps from greyscale via Levels/Contrast (not wired in the supplied file). The axial gradient should tilt **some** flakes; vary gradient rotation with Perlin noise. A side-by-side comparison found the early polygon pilot's pieces too large and uniformly flat beside photographs with dense fine speckle plus occasional larger fragments. Study fine/coarse populations, broad tilt distribution and coherent gradient-orientation variation independently; test close, face-framed and moving views. Keep the original graph and maps local. Attribution is established through the maintainer who supplied it; reuse permission is not.

Related: [ArchiveXL strategy](../archive-xl/eye-artistry-strategy.md), [authoring requests](eye-artistry-authoring.md), [validation](../../docs/validation.md).
