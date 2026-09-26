# Knowledge-base audit, 27 September 2026

A hygiene pass over every page in [`knowledge/`](../knowledge/README.md) and the research pages they cite most, after the 26–27 September landings (body, clothing, eye ranks 4–5, brows phase 0, tattoos, CCXL piercings, shader study 1–5, the hair colour follow-up, the native reader in production, bridge batch 2, game crashes). Documentation only; no facts were added beyond what the cited pages already establish. Line numbers are those after the edit, in the audit commit.

Method: each page was read against the newer research it cites, with `git log` settling which statement was newer. `python tools/check_links.py` already checks `#anchors`; it reported no broken cross-reference before or after the pass.

## Changes

### Contradictions between pages

| Page and line | Change | Why |
|---|---|---|
| [eye-rendering.md](../knowledge/eye-rendering.md) L43, L127 | Iris roughness 0.157 → 0.155 | 80/255 × 0.4934 = 0.155, as the [eye reference](materials/shader-eye.md) and the [fact index](materials/shader-fact-index.md) state |
| [eye-rendering.md](../knowledge/eye-rendering.md) L30 | "Gradient materials set `BlickScale` 0.1" → "Sixteen of the 18" | The [eye reference](materials/shader-eye.md) counts 16 of 18 |
| [head-cc-rendering.md](../knowledge/head-cc-rendering.md) L140 | Eye rank "sub-ranks 1–3 done; 4–7 open" → "1–5 and 7 done; 6 open" | Contradicted its own §6 and [eye rendering §6.6](../knowledge/eye-rendering.md) |
| [eye-rendering.md](../knowledge/eye-rendering.md) L155 | Morph `baseTexture` rule "(gap)" → "carried and applied, §6.6" | Contradicted the same page's §6.6 |
| [head-cc-rendering.md](../knowledge/head-cc-rendering.md) L89; [fact index](materials/shader-fact-index.md) L63; [face-makeup.md](../knowledge/face-makeup.md) L44 | "The decal meshes carry their own 0.4 mm lift" narrowed: 0.40–0.41 mm for makeup, lip, freckle, pimple and cyberware meshes; scars 0.31 mm, facial tattoos about 0.2 mm, personal link 0.52 mm | [Head CC evidence](character-customization/head-cc-render-evidence.md) measurements and [tattoos §2](../knowledge/tattoos.md#2-face-tattoos) |
| [head-cc-render-evidence.md](character-customization/head-cc-render-evidence.md) L93 | Facial tattoo alpha: the tone sets colour at 0.6; face meshes 06–10 override with 0.7 | [Tattoos §4](../knowledge/tattoos.md#4-colour-and-material) (27 September) read the instances; the earlier line attributed the 0.7 to the tone |
| [mod-loading.md](../knowledge/mod-loading.md) L93; [archive-format.md](../knowledge/archive-format.md) L161 | An omitted `renderMask` counting as drawn is now graded [hypothesis], with the WolvenKit-fallback caveat | Stated as fact there, as [hypothesis] in archive-format open question 3 and the [native reader backlog](backlog/native-archive-reader.md) |
| [mod-loading.md](../knowledge/mod-loading.md) L3 | Installed ArchiveXL: 1.26.3 at the first run, updated to 1.27.3 on 25 September | [Toolchain](../docs/toolchain.md) and the bridge test card record 1.27.3 |
| [runtime-access.md](../knowledge/runtime-access.md) L73 | Kill-switch restore: unfreeze and save lock [runtime] (test card S7); menu restore [unverified] | The same page's §6 called the restore [runtime] while §5 called it [unverified] |
| [README.md](../knowledge/README.md) L61 (Topics, runtime access) | "No runtime evidence yet" → reads, photo-mode writes, creator apply, clock and kill switch seen in game on 26 September; autonomy batch and batch 2 offline only | [runtime-access.md](../knowledge/runtime-access.md) L3 and the [test card](runtime/runtime-bridge-test-card.md) |
| [README.md](../knowledge/README.md) L58 (Topics, clothing) | "Nothing built" → render plan phases 1–4 built | [clothing.md](../knowledge/clothing.md) §6 |
| [README.md](../knowledge/README.md) L59 (Topics, tooling) | Topic text no longer claims the Blender add-on and round trips | [tooling.md](../knowledge/tooling.md) L3 says they are not covered |
| [face-makeup.md](../knowledge/face-makeup.md) L62; [materials-and-shaders.md](../knowledge/materials-and-shaders.md) L525; [fact index](materials/shader-fact-index.md) L64; [decal reference](materials/shader-decal.md) L101 | Metallic blush roughness "≈ 0.51" → "≈ 0.51 if read raw, ≈ 0.22 if decoded" | Face makeup open question 1 holds it open; the other pages stated 0.51 as fact |

### Statements a newer finding overturned

| Page and line | Change | Why |
|---|---|---|
| [materials-and-shaders.md](../knowledge/materials-and-shaders.md) L3, L212, L570 | Session 2 (26 September) confirmed the 0.4 mm lift at an extreme close-up (0 mm breaks up, 0.1 and 0.4 mm clean) [runtime]; test ask 4 "built, not installed" → "partly run" | [Experiment 020 results](../experiments/020-session-2/README.md#results-26-september-2026-run-through-the-runtime-bridge-partial) |
| [materials-and-shaders.md](../knowledge/materials-and-shaders.md) L501, L549 (open question 7) | The `.hp` bake is decoded from the executable; only the `.gradient` atlas remains open; brows use a plain gradient texture, not an atlas | [Hair reference §7](materials/shader-hair.md#7-hp-profiles-and-their-resolution), [eyebrows](../knowledge/brows.md) |
| [materials-and-shaders.md](../knowledge/materials-and-shaders.md) L199 | "Reflection passes are not traced" → the ambient (probe) composite is traced for Eye and Hair; SSR and RT are not | [Eye reference §6.3](materials/shader-eye.md#63-ambient-probes), [hair reference §6.5](materials/shader-hair.md#65-environment-path) |
| [eye-rendering.md](../knowledge/eye-rendering.md) L104, L184, L299; [shader-eye.md](materials/shader-eye.md) L214, L358 | The eye gradient bake is no longer called "the hair-profile model"; whether the `CGradient` bake rescales stops like `.hp` is an open question; the eye atlas is not shared with `.hp` rows | The `.hp` bake (sort, rescale to 0–1, k/N, truncate) now differs from what the eye text assumed |
| [eye-rendering.md](../knowledge/eye-rendering.md) L213 | "halves today's over-bright highlight" → "halved the earlier" | Rank 4 is done |
| [glitter-in-game.md](../knowledge/glitter-in-game.md) L54, L74, L95 | Facet size is a recipe decision now that the UV window exists; "today's 1024 atlas" → the head-UV atlas used before the window; Shimmer facets are wide because of their authored cells | [Shimmer design](materials/finish-designs/shimmer.md), [experiment 019](../experiments/019-uv-window/README.md) |
| [glitter-in-game.md](../knowledge/glitter-in-game.md) L133 | Session 2 "pending" → partly run; the *Shimmer · strong* verdict waits for the light sweep | Experiment 020 results |
| [head-cc-rendering.md](../knowledge/head-cc-rendering.md) L15, L127, L129, L137, L139 | Every face shape is selectable in the Character panel; piercings left the old path on 26 September; **Hide my V's own makeup** exists; the screen-space SSS is decoded (not yet ported); rank 3 done except teeth | Character panel (26 September; Studio changelog), [skin reference §6.3](materials/shader-skin.md#63-blur-kernel-and-combine) |
| [head-cc-rendering.md](../knowledge/head-cc-rendering.md) L63, L147 (open question 1) | Hair option defaults are read from the executable; skin and eye register pairings are proposed [hypothesis] | [Hair shading §5](../knowledge/hair-shading.md#5-deferred-hair-light), skin and eye references |
| [cc-file-chain.md](../knowledge/cc-file-chain.md) L358, L378, L410–421 | Resolver reads natively first with WolvenKit per resource; Vortex needs no file adapter; R12 partly implemented for clothing; readiness table: skin wired (P1), creator selectors exist for every option | [Mod loading §6](../knowledge/mod-loading.md#6-implementation-and-reproduction), [Vortex §5](../knowledge/vortex.md#5-what-xf-studio-sees), [clothing §6](../knowledge/clothing.md#6-how-the-studio-draws-worn-clothing), [head CC rendering §6](../knowledge/head-cc-rendering.md#6-render-plan-ranked-by-visual-gain-per-effort) |
| [body-rendering.md](../knowledge/body-rendering.md) L69, L85–87 | Footwear now sets `lifted_feet`; §5 retitled "What clothing uses from the body" (the backlog link updated) | Clothing phases 1–4 merged |
| [runtime-access.md](../knowledge/runtime-access.md) L34, L99, L118 | The expression-selection check is R2 on the next test card; batch 2 items added to "built, untested"; script calls with a context are [runtime] in photo mode too, leaving only loading screens open | [Test card](runtime/runtime-bridge-test-card.md), [design](runtime/runtime-bridge-design.md) |
| [photo-mode.md](../knowledge/photo-mode.md) L34, L60 | Light switching from script is built but untested (only the attribute is [runtime]); the key route is built as `photo.open` | Runtime-access API table; bridge autonomy decisions |
| [clothing.md](../knowledge/clothing.md) L237 | Test asks no longer wait for a reader and resolver that exist | §6 |
| [creator-lighting.md](../knowledge/creator-lighting.md) L222 | The ladder validates the whole colour chain; the bake is decoded | Hair shading §3 |
| [facial-animation.md](../knowledge/facial-animation.md) L61 (open question 4) | Narrowed: the creator and photo-mode graphs' blink rule is known | [Facial expressions §2](../knowledge/facial-expressions.md#2-which-graph-drives-vs-face-where) |
| [hair-shading.md](../knowledge/hair-shading.md) L5, L114 | Brows: every vanilla and inspected CCXL brow (not just the save's) is a decal; the brow gradient is sampled at (`GradientMapUV`, 0.5) through a clamping sampler | [Eyebrows §3](../knowledge/brows.md) |

### Evidence grades

| Page and line | Change |
|---|---|
| [README.md](../knowledge/README.md) L27 | Legend: [offline] and [unverified] defined; other page-specific grades must be defined in the page header |
| [head-cc-rendering.md](../knowledge/head-cc-rendering.md) L3; [face-makeup.md](../knowledge/face-makeup.md) L3 | Headers said "no runtime evidence" while the pages carry [runtime] claims; now they name them |
| [materials-and-shaders.md](../knowledge/materials-and-shaders.md) L228; [head-cc-rendering.md](../knowledge/head-cc-rendering.md) L78 | "The legacy mod drew in game [runtime]" marked as having no capture on file |
| [hair-shading.md](../knowledge/hair-shading.md) L122 | Anecdotal [runtime] for the replacer's yellow hair → [hypothesis] until a capture is recorded |
| [creator-lighting.md](../knowledge/creator-lighting.md) L150 | Qualitative runtime check marked as having no capture on file |
| [cc-file-chain.md](../knowledge/cc-file-chain.md) L167, L451; [face-makeup.md](../knowledge/face-makeup.md) L66 | The consumer-group [runtime] claims now cite the [finish board results](../experiments/016-finish-board/README.md#runtime-results) |
| [runtime-access.md](../knowledge/runtime-access.md) L3 | The page's [runtime] claims now cite the test card's script-call check and first-session results |
| [materials-and-shaders.md](../knowledge/materials-and-shaders.md) L423 | `mesh_decal_emissive` behaviour [resource] → [source], with the over-skin caveat [hypothesis] |

### Links, labels and numbering

- [materials-and-shaders.md](../knowledge/materials-and-shaders.md) L570–572: in-game test asks renumbered (they ran 4, 6, 5), and the debug-views ask now points at open question 12, not 11.
- [README.md](../knowledge/README.md) L44: the materials row lists the decal and multilayered references.
- [tattoos.md](../knowledge/tattoos.md) L79: "texture-framework tattoos, §7" → §8.
- [tattoos.md](../knowledge/tattoos.md) L107, L161: ArchiveXL tag rules register only from an item definition's own `visualTags`, so vanilla clothing hides no tattoo that way ([clothing §4.3](../knowledge/clothing.md#43-masking-the-body-resource-source-wiki)); test ask 4 needs tagged mod garments.
- New links: runtime-access → [game crashes](../knowledge/game-crashes.md) (L3, L19, Related); archive-format L199 → clothing §4.1; facial-animation → facial expressions (L26, OQ1 probe, Related); brows L38 → the creator's eyes clip, L90 → the skin wrinkle driver; body-rendering → skin reference §3.2 and the masculine V plan; Related lines of clothing (Tattoos), head-cc-rendering (eyes, brows, face makeup, tattoos) and cc-file-chain (body, clothing, jewellery, archive formats, Vortex); hair-shading L5 → hair reference §9 (lashes).

### Research pages brought in line

- [Experiment 024](../experiments/024-ccxl-piercings/README.md) L3 and the [CCXL piercing feasibility](jewellery/ccxl-piercing-feasibility.md) L3: staged 26 September (files in place, not yet enabled), as the experiment's own Staging section says.
- [Runtime bridge design](runtime/runtime-bridge-design.md) L138, L215, L219, L263, L344, L361: the visible indicator, kill restore and window capture are [runtime] per test card S6–S7; photo-mode script calls work; `cc.apply` works.
- [Runtime bridge test card](runtime/runtime-bridge-test-card.md) L28–30: "next build … record its hashes before staging" → the staged `main` build (509f599) and its build record.
- [Bridge autonomy](backlog/bridge-autonomy.md) L15, L19: ranks 5 and 9 were decided on 26 September.
- [Clothing render backlog](backlog/clothing-render.md) L3, L11–17: merged into `main`; "What exists" relabelled as the pre-phase-1 starting point.
- [Preview fidelity backlog](backlog/preview-fidelity.md) L13, L24: hair light and bake now read from the executable; the creator graph's clip selection is decoded offline.
- [Brow idle gap](animation/brow-idle-gap.md) L41–45: checks 1, 3 and 4 marked done or partly done.
- [Brow editor design](brows/brow-editor-design.md) L10, L13, L273–275: the brow UV is not isometric; phase 0 is done; the §8 questions were decided in §7a.
- [Tattoos brief](character-customization/tattoos-brief.md) L40: glow and surface-writing ink carry the decal reference's and materials §2.4's caveats.

## Unresolved conflicts (open questions on both pages)

1. **Seam-fix part:** [body rendering](../knowledge/body-rendering.md) says the head's seam-fix part isn't drawn because it uses `metal_base.remt`; [head CC rendering §4](../knowledge/head-cc-rendering.md#4-eyes-lashes-brows-hair-and-beard) lists a body seam-fix proxy among the shadow-only chunks. Recorded as body open question 7 and head-CC open question 10. Checkable offline from the resolver cache's `renderMask`.
2. **Body textures on the reference profile:** body rendering §2 attributes them to the KS UV framework; the [head CC evidence](character-customization/head-cc-render-evidence.md) records an installed Arkhe body complexion package that replaces body albedos at their own paths. Body open question 6; an archive listing settles it.
3. **Absent `renderMask`:** the engine's default flags are unknown offline; both pages now grade the resolver's reading [hypothesis].
4. **Metallic blush roughness** (0.51 raw or 0.22 decoded): open in face makeup; now conditional on every page that quotes it.
5. **`CGradient` bake:** whether eye gradients rescale their stops like `.hp` is unknown; open on eye rendering (question 4) and the eye reference (question 3).

## Outside this pass (for the coordinator)

- `AGENTS.md` (expanded eye plate) still says the 0.4 mm default "awaits the experiment 017 session" (session 2 settled it) and that every vanilla face decal sits at 0.40 mm (scars and tattoos don't). Its brow-idle row could state the decoded clip selection. It is the maintainer's standing-rules file, so this pass left it unchanged.
- `docs/status.md`: NATIVE-01..17 → 01..25; no "What works" row for native-first resolving; the summary's list of knowledge pages predates about ten pages; "two read-only expression probes" (one is a reversible `write-photo` command).
- The dated records `research/eye-artistry/hair-colour-pipeline-2026-09-25.md` (retired `scene.ts` and brow manifest) and `research/character-customization/clothing-render-evidence.md` (predates native-first reading) are left as dated evidence.
