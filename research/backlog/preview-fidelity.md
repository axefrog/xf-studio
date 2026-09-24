# Preview fidelity and persistent workspace

Owner doc for **track 2** in the [ranked queue](README.md): character detail rendering completeness.

## Status (25 Sep 2026)

**Top feature priority (Nathan, repeatedly):** correct **brow, lash and hair colours**, then render **all** character-customisation details in the viewport. None of the colour items is solved; the preview uses study approximations with honest labels.

| Item | State |
|---|---|
| Brow shape and colour | **Open.** Material path corrected from the compiled shader (`(p + (1-p)·s·0.7)²` coverage from primary/secondary alpha plus the saved gradient), loaded through an exact-hash local manifest; a study approximation, not engine parity. Shape audit found no basis to thin geometry. The effective gradient has an Alliekat override candidate. Next gate: matched in-game capture (included on the [smoke-test card](../authoring/first-makeup-runtime-preflight-2026-09-25.md)). [Study](../eye-artistry/brow-lash-fidelity.md), [texture audit](../eye-artistry/brow-texture-audit.md), [shape](../eye-artistry/brow-shape-followup.md), [mip gate](../eye-artistry/brow-lash-mip-gate.md), [gradient equivalence](../eye-artistry/brown-ombre-gradient-equivalence.md) |
| Lash colour | **Open.** A materially different Alliekat `brown_liquorice.hp` candidate collides with the vanilla profile currently pinned; resolve the effective source before calibrating. [Collision audit](../eye-artistry/brown-liquorice-profile-overlap.md), [lash follow-up](../eye-artistry/lash-material-followup.md) |
| Hair colour and material | **Open.** Optional saved-V hair renders (MELUMINARY geometry, strand alpha) with an approximate dark-brown material; the saved `38_ash_brown` comes from island_dancer's Hair Profiles CCXL (`ash_brown.hp`, gradients, cap mask) and is not reproduced. Physics held at rest. [Hair preview](../eye-artistry/saved-v-hair-preview.md), [profile resolution](../eye-artistry/saved-hair-profile-resolution.md) |
| Render **all** CC details | **Open.** Currently: head (old Blender-master skin tile, not the saved `skin_type_05` chain), expanded plate, eyes (saved Kala diffuse), brows, lashes, hair, vanilla/PRC piercings. Missing or approximate: saved skin material, teeth/mouth parts, cyberware/skin overlays, other CC categories. Depends on [materials RE](materials-shader-re.md) and [CC controls](cc-controls-and-presets.md). |
| 1. Resolve the actual modded eyes | **Done for the captured choice** (Kala's Eyes Standalone V2 via nutboy's Unique Eyes to CCXL; exact app hash + definition, verified PNG digest, fallback). **Open:** `eye.mt` normal (RG + reconstructed Z), roughness (R × `RoughnessScale`), refraction/bubble parity, and a generalised resolver. [Resolution](../eye-artistry/modded-eye-resolution.md), [optics audit](../eye-artistry/eye-lip-optics-audit.md) |
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

Nathan's side-by-side game/Studio comparison shows apparently thinner, darker eyebrows in game. Reproduce the saved brow and lash colours. The matched references are Arkhe brows 18 (`10_brown_ombre`) and Soft Natural lashes (`05_brown_liquorice`); matching a reference hash does not prove the effective mesh, textures or material overrides match runtime.

Trace the saved appearance through effective MO2 winners, app/mesh/material/texture chains and colour parameters or gradients. Compare alpha interpretation, clipping/blending, mip filtering and shader semantics as well as geometry, head morphs, pose and camera/lighting. **Do not thin the mesh by eye** to conceal a material or resource-resolution error. Keep before/after evidence, credit mod authors for concrete lessons, and batch remaining game-side questions into the prepared session. This is existing-preview fidelity, not the later eyebrow authoring feature.

### Missing brow-area idle movement

Nathan observes movement above the eyes in the game idle that appears weaker or absent in the Studio. Treat it as a fidelity gap, not proof of a missing bone track. Compare brow/accessory rig transport, face-bake bone motion, correctives, scale channels and wrinkle/material effects; record observed motion separately from hypotheses.

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
