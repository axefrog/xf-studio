# Preview fidelity and persistent workspace

Owner doc for **track 2** in the [ranked queue](README.md): character detail rendering completeness.

## Status (25 Sep 2026)

**Top feature priority (repeatedly requested):** correct **brow, lash and hair colours**, then render **all** character-customisation details in the viewport. The colour pipeline now follows the decoded 2.31 `hair.mt` and hair-light programs ([hair shading](../../knowledge/hair-shading.md)); its lighting now uses the game's vanilla hair options, and parity still waits on the [refined capture](../eye-artistry/hair-calibration-2026-09-25.md#refined-capture-request).

| Item | State |
|---|---|
| Brow shape and colour | **Source-grounded, awaiting capture.** Colour and coverage from the compiled double-diffuse decal (`(p + (1-p)·s·0.7)²`), now blended like the engine's `sqrt`-encoded G-buffer over the skin albedo under each brow vertex; not engine parity. Shape audit found no basis to thin geometry. The effective gradient has an Alliekat override candidate. Next gate: matched in-game capture (included on the [smoke-test card](../authoring/first-makeup-runtime-preflight-2026-09-25.md)). [Study](../eye-artistry/brow-lash-fidelity.md), [texture audit](../eye-artistry/brow-texture-audit.md), [shape](../eye-artistry/brow-shape-followup.md), [mip gate](../eye-artistry/brow-lash-mip-gate.md), [gradient equivalence](../eye-artistry/brown-ombre-gradient-equivalence.md) |
| Lash colour | **Source-grounded, awaiting capture.** Albedo from the `hair.mt` overlay arithmetic; the provider of `brown_liquorice.hp` is chosen by a generic rule (mod over base, a source-supported expectation) and listed with its alternative (base: golden-tan, mod: dark red-brown). Lit by the decoded hair light. [Collision audit](../eye-artistry/brown-liquorice-profile-overlap.md), [lash follow-up](../eye-artistry/lash-material-followup.md) |
| Hair colour and material | **Source-grounded, awaiting capture.** Strands of any resolved hairstyle (the save's or the default V's, vanilla or CCXL; the reference save's is `ash_brown.hp`) go through the decoded base-colour pass (truncated profile lookup, overlay, vertex-red shadow) and the decoded Marschner-style hair light; option-driven light constants and the profile bake colour space are hypotheses. Cap uses a provisional recolor; physics held at rest. [Hair preview](../eye-artistry/saved-v-hair-preview.md), [profile resolution](../eye-artistry/saved-hair-profile-resolution.md) |
| Matched lighting for colour calibration | **Implemented as a preset, awaiting capture.** The creator and the mirror share one render-to-texture scene: a black box, 15 spot lights (female; 14 male), a 15° camera, fixed exposure and a LogC3 grading LUT. The Studio's **Character creator** lighting preset reproduces it: the rig for V's body sex, black surround, hair lit through `LocalLight` intensities, the grading LUT the installation resolves to by archive precedence (Nova LUT 3.0 on the reference install), and creator face and hair camera pages. The capture must fit the exposure scalar and choose the intensity form and cone reading (both switchable); `tools/calibrate-creator-capture.ts` computes the fit and the pass marks. No shadows yet. [Creator lighting](../../knowledge/creator-lighting.md#9-the-studios-creator-lighting-preset), [evidence](../character-customization/creator-lighting-evidence.md) |
| Skin type, tone and complexion mods | **Source-grounded, awaiting capture (P1).** The head's skin comes from the resolved `skin.mt` chain of the shown V on the launch route (any skin type and tone, complexion replacers, ArchiveXL appearance patches and their overlays), through the decompiled surface arithmetic; lighting uses the skin profile's two lobes and a wrap stand-in for subsurface scattering. Open: the `TintColor` encoding (test ask 8), the SSS path itself, emissive skin. [Head CC rendering §6](../../knowledge/head-cc-rendering.md#6-render-plan-ranked-by-visual-gain-per-effort) |
| Render **all** CC details | **Open.** Currently: head and skin (resolved for any V since P1), expanded plate, eyes (saved Kala diffuse), brows, lashes and hair (resolved for any V since P0; [head CC rendering](../../knowledge/head-cc-rendering.md#6-render-plan-ranked-by-visual-gain-per-effort)), vanilla/PRC piercings. Missing or approximate: head decals (makeup, lips, cheeks, scars, tattoos, cyberware), teeth/mouth parts, the eye chain, other CC categories. Depends on [materials RE](materials-shader-re.md) and [CC controls](cc-controls-and-presets.md). |
| 1. Resolve the actual modded eyes | **Done for the captured choice** (Kala's Eyes Standalone V2 via nutboy's Unique Eyes to CCXL; exact app hash + definition, verified PNG digest, fallback). **Open, now specified:** the full eye chain (refracted iris projection, cornea and iris normals, Eye-class light, gradient colours, wetness shell, all 71 colours and CCXL eyes through the resolver) is decoded offline with a ranked implementation plan in [eye rendering](../../knowledge/eye-rendering.md#6-implementation-spec-for-the-preview); none of it is built yet. [Resolution](../eye-artistry/modded-eye-resolution.md), [optics audit](../eye-artistry/eye-lip-optics-audit.md) |
| 2. Adjustable FOV | **Done** (vertical FOV, persisted) |
| 3. Persist all UI/preview state across reload | **Done** (validated workspace incl. selections, camera, lighting, motion, imported V; separate `?verify=1` storage). Panel state is now the dock layout preference. |
| 4. Renderer fidelity and SSS (waxy eyes, white lip seam) | **Open.** Offline audits: eye maps/UVs/channels wrong in the preview; the lip seam is not in the colour tile, and SSS has not been enabled because the study page lacks a diffuse/ownership pass. Diagnose each artefact; SSS alone is not a fix. [Optics audit](../eye-artistry/eye-lip-optics-audit.md), [diffuse SSS gate](../../projects/xf-studio/authoring/evidence/diffuse-sss-gate-2026-09-24.md), [lip ownership gate](../../projects/xf-studio/authoring/evidence/render-fidelity-ownership-gate-2026-09-25.md) |
| 5. Imported V lost on reload | **Done** (decoded appearance and morph selection persist) |
| Missing brow-area idle movement | **Open, diagnosed in part.** Brow joints animate in the current bake; the default `ui_closeup_shot` deforms brow cards slightly, `ui_closeup_shot_eyes` has much stronger bilateral brow tracks, and processed wrinkle outputs are omitted. Do not loop or substitute the separate clip as default idle without evidence of the game's live UI graph. [Audit](../animation/brow-idle-gap.md) |
| Matte flicker at narrow FOV / distance | **Fixed** by a zoom-dependent 1–5 mm near plane (depth precision). Unmeasured poses/GPUs and true geometric intersections remain limits. |
| Preview quality 512/1K/2K/4K | **Done.** [Contract](../authoring/preview-quality-contract.md). Export quality and further renderer options remain future work. |
| wgpu / ray tracing | Assessed; keep the browser renderer for now. [Assessment](wgpu-renderer-assessment.md) |

## Requirements that remain open

### Brow thickness and brow/lash colours

A supplied side-by-side game/Studio comparison shows apparently thinner, darker eyebrows in game. Reproduce the saved brow and lash colours. The matched references are Arkhe brows 18 (`10_brown_ombre`) and Soft Natural lashes (`05_brown_liquorice`); matching a reference hash does not prove the effective mesh, textures or material overrides match runtime.

Trace the saved appearance through effective MO2 winners, app/mesh/material/texture chains and colour parameters or gradients. Compare alpha interpretation, clipping/blending, mip filtering and shader semantics as well as geometry, head morphs, pose and camera/lighting. **Do not thin the mesh by eye** to conceal a material or resource-resolution error. Keep before/after evidence, credit mod authors for concrete lessons, and batch remaining game-side questions into the prepared session. This is existing-preview fidelity, not the later eyebrow authoring feature.

### Missing brow-area idle movement

The maintainer observes movement above the eyes in the game idle that appears weaker or absent in the Studio. Treat it as a fidelity gap, not proof of a missing bone track. Compare brow/accessory rig transport, face-bake bone motion, correctives, scale channels and wrinkle/material effects; record observed motion separately from hypotheses.

### Renderer fidelity

Study the actual game skin/eye shaders, textures and parameter semantics (SSS, roughness, normal maps, eye layers, lip/mouth seam). Diagnose the waxy eyes and bright lip seam independently. Use matched camera/lighting and keep honest labels for unverified parity. Pride in presentation and careful detail are explicit priorities.

### Generalised resource resolution

Saved choices must resolve through effective game/mod resources, including CCXL additions and overrides; a vanilla-looking saved name is not proof of vanilla pixels. Generalise through provider-neutral MO2/Vortex/manual source adapters ([portable mod-source discovery](jewellery-and-customization.md#portable-mod-source-discovery)).

## User-supplied references

Read-only references supplied with these requests (not instructions embedded in images). Preserved copies live under ignored `research/consumers/preview-fidelity/raw/`; [the reference manifest](preview-fidelity-references.json) records source/copy hashes; originals are unchanged:

- Eye close-up: `a local clipboard image (personal Temp path withheld)`.
- Lip seam close-up: `a local clipboard image (personal Temp path withheld)`.
- Brow comparison: `research/consumers/preview-fidelity/raw/brow-comparison.png`, plus an additional comparison and two idle frames.
- Four matte-flicker images.

Related: [saved-V assembly](../eye-artistry/save-import.md), [authoring requests](eye-artistry-authoring.md), [idle guide](../../docs/idle-animation-guide.md), [validation workflow](../../docs/validation.md). Use local/offline evidence first and batch remaining game captures.
