# Plate depth and finish gloss: diagnostic candidate

**Status:** built and verified offline on 25 September 2026; **not installed or staged**, not seen in game. It answers the three defects from the first photo-mode session of the [finish board](../016-finish-board/README.md#runtime-results) in one prepared session: close-up breakup (question 1), uniform gloss (question 2) and weak Shimmer (question 3).

Evidence grades as in the [knowledge base](../../knowledge/materials-and-shaders.md): **[observed]** measured here from installed files, **[resource]** installed game or mod resources, **[source]** compiled programs or tool source, **[runtime]** seen in game, **[hypothesis]** not yet established.

## 1. Close-up breakup: the plate sat on the skin; vanilla decals sit 0.40 mm above it

**Symptom [runtime].** In photo mode the makeup was clean at normal and medium distance and broke into skin-coloured, angular patches close up (private screenshots `5.png` close, `7.png` between, `6.png` medium, same preset). The patches follow triangle-sized shapes.

**The LOD part of the hypothesis is refuted [resource].** The 2.31 female head `h0_000_pwa_c__basehead.mesh` has **one** LOD (`lodLevelInfo [0]`, `renderLODs [0]`, one chunk with `lodMask 1`). The vanilla face decals also have one LOD. No lower head LOD takes over at distance.

**The coincidence part is confirmed, and vanilla does it differently [resource].** The built-in plate is an exact cut of the head: same vertex bytes, so it lies *on* the skin. Every vanilla face decal measured is the head's own vertices pushed out along the head's vertex normals by **0.40 mm** ([`measure_offsets.py`](measure_offsets.py), [asset-free numbers](offset-evidence.json)):

| Vanilla decal (female, 2.31) | Vertices | Signed distance to the head, median (min … max) | Best normal offset (median residual) |
|---|---:|---|---|
| `hx_000_pwa_c__basehead_makeup_eyes_01` | 1,152 | +0.399 mm (+0.126 … +0.407) | 0.40 mm (5 µm) |
| `…_makeup_lips_01` | 693 | +0.400 mm (−0.40 where the lips meet … +0.406) | 0.40 mm (5 µm) |
| `…_makeup_freckles_01` (2 chunks) | 1,333 | +0.399 mm (+0.264 … +0.406) | 0.40 mm (5 µm) |
| `…_pimples_01` (2 chunks) | 192 | +0.397 mm (+0.337 … +0.405) | 0.40 mm (25 µm) |

The offset survives the face shapes. Across all 105 morph targets the eye-makeup decal's median stays at +0.399 mm; its morph deltas are best explained as the head's deltas plus 0.4 mm × the change of each target's normal (median residual 15 µm with geometric normals, 21 µm with the stored shading normals, 39 µm if the head's deltas were copied unchanged). Where eye shapes close the lids, the vanilla decal also ends up under the opposite lid (worst −0.47 mm in `h171`, 54 vertex-target cases in total), so vanilla accepts contact where the lids meet.

**Mods reuse that geometry [resource].** The legacy eye-makeup generator's build in MO2 (`XF Eye Artistry CCXL - Dev`, which rendered in game) and the community mod *Limerence X AllieKat Winterkissed AXL Eyeshadows* both ship the vanilla eye-makeup mesh and morph target byte for byte, so both sit 0.40 mm out. XF Studio's built-in plate was the first to sit at 0.

**No other depth mechanism exists in the data [resource].** Vanilla eye makeup and the plate have the same mesh-level fields apart from geometry, bones and materials (no rendering-plane or decal flag exists on meshes or these components). `mesh_decal.mt`'s `post_gbuffer` pass tests depth `GreaterEqual` (reversed Z) without writing it, with rasterizer `offsetMode OFFSET_DecalBias` (enum value 3 in RED4ext.SDK). The bias values live in engine code and are unknown. The shader's `DepthThreshold` (default 0.5) only discards decal pixels far from the scene depth; it does not resolve coincident surfaces [source].

**Why only close up [hypothesis].** A coincident decal wins only by the pass's depth bias. With a floating-point depth buffer that bias is roughly relative (a fixed number of depth units), and its slope-scaled part shrinks as triangles grow on screen, so the world-space mismatch it can absorb shrinks as the camera approaches. Any small difference between how the head and the plate reach the rasterizer (different vertex programs, vertex factory 30 against 4, skinning and morph evaluation order) then shows as per-triangle patches close up. The 0.40 mm offset is far larger than such differences at any photo-mode distance.

**Root cause:** the plate had no outward offset, unlike every vanilla face decal [resource + runtime symptom]; the close-up-only mechanism is [hypothesis]. Confirming test: *Depth A* against *Depth D* below.

**Fix (implemented, production default).** Build now lifts the packaged plate by **0.4 mm** ([`plate-lift.ts`](../../projects/xf-studio/authoring/src/plate-lift.ts)):

- Base positions become p + 0.4 mm × n, with n the head's stored shading normal.
- Each morph row's position delta gains 0.4 mm × (normalize(n + Δn) − n), so the offset follows every target's own shading normal like the vanilla decals. No morph rows are added.
- Skin indices and weights, normals, tangents, UVs, colour, triangle order and every morph normal/tangent delta stay the head's bytes, in the mesh and in the morph's base buffer alike (the skin-byte rule holds). The two buffers receive identical bytes.
- The head's position quantization still covers the lifted plate. 24 of 105 targets need a slightly wider delta range, so their deltas are re-encoded (largest error 7.5 µm); positions are within 2.8 µm of the intended lift.
- The built-in plate cache keeps the exact head cut. The lift is an export step, so the preview, the plate verifier and the head-surface correspondence of the cached plate are unchanged.

The independent package verifier restates the rule in its own decoder ([`plate-geometry.ts`](../../projects/xf-studio/authoring/src/mod-verifier/plate-geometry.ts)): the mesh, morph base and morph blobs must equal the plate input as whole objects apart from the fields the lift changes, which it re-derives (chunk offsets, buffer sizes, morph counts, starts and mapping); the head's position quantization must be unchanged and a re-quantized target's range must be exactly its lifted deltas; every non-position byte must equal the input; each chunk's positions must be the input lifted along its normals within half a quantization step (and 0.01 mm), every morph row the lifted input delta (within half a step and 0.02 mm); and mesh and morph base must be identical.

**Contact with the lids.** Measured on the neutral pose and all 105 morph targets (not the dense idle or subframe gates of experiments [006](../006-plate-clearance/README.md) and [012](../012-native-plate-bootstrap/README.md), which were not rerun):

| Lift | Neutral signed distance, min / median | Vertex-target cases under the head (105 targets) | Worst targets |
|---|---|---:|---|
| 0 (first session) | 0 / 0 | 0 (coincident) | — |
| 0.1 mm | +0.012 / +0.100 mm | 61 | `h111`, `h061` at −0.10 mm (lids meet) |
| 0.2 mm | +0.022 / +0.200 mm | 62 | `h111`, `h061` at −0.20 mm |
| 0.4 mm | −0.094 / +0.400 mm | 302 | `h111`, `h061` at −0.40 mm |
| vanilla eye makeup | +0.126 / +0.399 mm | 54 (1,152 vertices) | `h171` −0.47 mm |

At 0.4 mm three neutral-pose vertices at each inner eye corner, on the lash line, end up to 0.09 mm under the head; vanilla eye makeup covers less of the corner and has none. Whether that is visible is part of the test card.

## 2. Uniform gloss: the roughness reaches the lighting; the finish values are glossier than skin

**The chain is intact [source] [observed].**

1. The roughness XBMs are linear BC4 (`TCM_QualityR`, `isGamma 0`), with every mip level checked texel by texel by the verifier.
2. The decal writes GBuffer2.y = saturate(`RoughnessScale` × R + `RoughnessBias`) with surface alpha `RoughnessMetalnessAlpha` × coverage (decompiled `16098255505177109230`).
3. The all-classes global light (`…Clustered_11111111`, `6606735909222169407`) uses GBuffer2.y for Subsurface (skin) pixels too: Burley diffuse plus **two GGX lobes** at roughness × `roughness0` and × `roughness1` from the pixel's skin-profile kernel, summed and scaled by (1 + lobeMix)/2. With the default profile (`roughness0` 0.966, `roughness1` 1.597, `lobeMix` 1), skin specular is up to twice a Standard lobe.
4. The SSS combine (`7703933925853799832`) adds that specular unchanged; a pixel with metalness above 0.1 skips SSS entirely.
5. GBuffer2.z, which every decal blends to 1/3, feeds only the Foliage branch's back-light transmission. The knowledge page's claim that it dilutes skin translucency was wrong and is corrected.

**The values are the problem [resource] [hypothesis for the look].** Bare eyelid skin under the makeup reads roughness R ≈ 0.57–0.66 in the pale head's `h0_000_wa_c__basehead_rm01.xbm`. Vanilla eye makeup writes **0.50** (`engine\textures\editor\roughmetal.xbm`, R 0.502, at surface alpha 1) and breaks its coverage with a noise secondary mask (`noise_decal_d01`, ×30 UV, influence 1). XF Studio's Satin (0.38), Glossy (0.12) and Metallic (0.27, metal 0.65) are all glossier than bare skin; only Matte (0.88) is rougher. Through skin's doubled lobes, Satin and Metallic read shiny. Metallic also loses SSS, which makes skin read hard and plastic.

**Contributing, not yet separable offline:**

- The close-up breakup mixes skin and decal per triangle. Board 6's "angular highlight shapes" match that pattern [hypothesis].
- Local lights, such as photo-mode lights, can shift roughness per light: r′ = saturate(r + k(byte/127.5 − 1)) [source mechanism; values unknown].
- Reflection passes (probes, SSR, ray tracing) were not examined [hypothesis].

**No pipeline defect was found, so production values are unchanged.** The candidate carries a calibrated alternative (*Gloss D*, all roughness +0.12: Matte 1.00, Satin 0.50 = vanilla eye makeup, Glossy 0.24, Metallic 0.39) and two controls that separate the causes: *Gloss B* writes no surface (skin roughness and metalness stay), and *Gloss C* forces roughness 1 and metalness 0. If the session confirms D, the finish table in [`finish-export.ts`](../../projects/xf-studio/authoring/src/engines/layered-makeup/finish-export.ts) should move by the same amount. The preview, now lit with the skin's light, reproduces the glossy read for Satin, Glossy and Metallic but not for Matte, and predicts that D alone softens highlight peaks without changing the broad sheen much ([materials §6](../../knowledge/materials-and-shaders.md#6-makeup-finish-implications)).

## 3. Shimmer strength: two parameter changes

Board 2's fine Shimmer (128 cells, tilt 0.65, facets up to 15°) had a mean mode-1 normal alpha of 0.19 at the base level, 0.12 at 256 px and nearly 0 by 32 px. At face distance the facets average away and leave a slightly broader gloss, as seen. *Shimmer · strong* keeps the route and changes two knobs:

- **64 cells:** facets twice as wide survive two more mip levels.
- **Tilt 1.0:** up to 0.4 rad (about 23°), so nearly every facet clears the ~11.5° mode-1 gate.

Density goes from 0.65 to 0.8. It sits beside Board 2's fine stripe and a Satin control.

## Pipeline changes (for review)

- **Lift** at Build ([`plate-lift.ts`](../../projects/xf-studio/authoring/src/plate-lift.ts)), described above; recorded in `build.json` (`plateLift`), the verifier report (`plateGeometry`), and in Check, `manifest.json` and the build result as `plateLiftsMm`, with each preset's knobs in its identity (`presets[].diagnostics`).
- **Diagnostic knobs**, never shown or saved by the Studio ([`export-diagnostics.ts`](../../projects/xf-studio/authoring/src/export-diagnostics.ts)). An exported collection file may carry `diagnostics` (`xfs/export-diagnostics-1`) keyed by preset ID:
  - `plateLiftMm`: 0–1 mm;
  - `surface`: overrides of a flat preset's `RoughnessScale`/`RoughnessBias`/`MetalnessScale`/`MetalnessBias`/`RoughnessMetalnessAlpha`.
- **How the knobs are built.** The package filter keeps the knobs for the presets it packages; the Studio's own collection parser drops them.
  - Distinct lifts become one plate render chunk each, laid out like vanilla multi-chunk decals. Every appearance binds its own chunk and binds the others to `xfs_hidden`, a `mesh_decal` instance with all three target alphas 0, so hidden chunks write nothing.
  - A surface override gets its own flat material entry (`@flat_<fnv1a32>`).
- **Verifier:** restates the production lift (0.4 mm), the lift geometry, the chunk bindings, the hidden material and each override, and requires the plan's knobs to equal the packaged collection's.

## Candidate

[`depth-candidate.collection.json`](depth-candidate.collection.json), generated by [`make-candidate.ts`](make-candidate.ts). One selector (label **XF**), Off plus ten presets, all in the finish board's plum (`#6d4a7e`):

| # | Preset | Look | Plate | Surface |
|---|---|---|---|---|
| 1 | Depth A · 0 mm control | Satin lid + Matte under-eye band, both eyes | 0 mm (first session) | production |
| 2 | Depth B · +0.1 mm | same | 0.1 mm | production |
| 3 | Depth C · +0.2 mm | same | 0.2 mm | production |
| 4 | Depth D · +0.4 mm | same | **0.4 mm (new default)** | production |
| 5 | Gloss A · as before | Board 1 stripes: left Matte · Satin · Glossy, right Metallic · Glossy · Matte | 0.4 mm | production |
| 6 | Gloss B · skin rough | same | 0.4 mm | surface alpha 0 (skin keeps its roughness and metalness) |
| 7 | Gloss C · all rough | same | 0.4 mm | roughness 1, metalness 0 everywhere |
| 8 | Gloss D · rough +0.12 | same | 0.4 mm | roughness +0.12 (Matte 1.00, Satin 0.50, Glossy 0.24, Metallic 0.39) |
| 9 | Shimmer · strong | left Satin · fine Shimmer (Board 2) · **strong Shimmer**; right mirrored | 0.4 mm | faceted route |
| 10 | Metal ramp · lifted | Board 6 (Satin + metalness ramp, and five steps) | 0.4 mm | production |

Built 25 September 2026 from the authoring directory with WolvenKit CLI 9.0.1, game 2.31 and the built-in plate (mesh `58081caf…ed26`, morph `b8b7c055…0131`, cache key `d7563f9f…23bd8`); it passed the independent verifier:

| Item | Value |
|---|---|
| Collection JSON SHA-256 | `2ec81e674a0caef81d1d400a00b6792b53dbb25f3b67784ad6f74d9b6dcec4b3` |
| Packaged snapshot SHA-256 | `45585d502479c324ea5f7bb7bc76ce8fa85cd988f455604c4f916e34c4ffacd4` (no omissions) |
| `xfs_c0170d3e01f014a519c3e0000000000c0.archive` | 1,122,304 bytes, SHA-256 `5d8dc02b48f4b94ade6db1d606ab55ab8fbbeb3d210f92384d808670822990a2` (the index records build times; members are the stable identity) |
| `.archive.xl` | 286 bytes, SHA-256 `8727722574d90f3a6e0948ffacc56e3f2809416b23662850872c34e2c805d60b` |
| Plate members | mesh `05eef62b99efd88cc3573a25a3197dab9118c8c645b034b6605d500217b19584`, morph `575b8a1e99af72dbb615185f1907d06d5cc9c618e8a46efcafb063d363c8af82` |
| Verified | 35 members; 4 plate chunks (0 / 0.1 / 0.2 / 0.4 mm), 1,620 vertices each, 105 targets, 292,656 morph rows; largest position error 2.8 µm, morph delta error 7.5 µm; non-position bytes exact; 6 material entries (`@preset`, `@faceted`, three `@flat_…`, `xfs_hidden`); 31 textures |
| Manifest | `installed: false`, `gameRenderingVerified: false` |

The private output is in the ignored `projects/xf-studio/dist/` and `build/` of the `plate-depth` worktree. Rebuild from the collection rather than copying it. A rebuild of the finish board with the new default also passed (archive `0bb0edc9…b345`, one chunk at 0.4 mm, 21 members).

## In-game test card

One session, female V with the default head, the same MO2 profile route as last time. Keep the ArchiveXL log. Please note the game version and whether ray or path tracing is on.

1. **Stage and check.** Stage this candidate instead of the finish board (it is **not** staged yet). In the character creator or at a mirror, the XF selector lists Off plus ten presets, and every preset name fits beside the label. The ArchiveXL log shows no material errors.
2. **Depth, close up** (the question that matters most). Set *Depth A · 0 mm control*. In photo mode, frame the eyes as in `5.png` (eyes fill the frame). Screenshot. Repeat the same framing for *Depth B*, *C* and *D*.
   - Expected: A breaks into patches as before; D is solid.
   - Note the smallest lift that is solid.
   - On D, look at the inner eye corners on the lash line for skin poking through.
3. **Depth, motion.** On *Depth D*, pull back to the `6.png` framing, then watch a blink and a slow head turn in photo mode (or the creator idle). Look for makeup lifting off the lid, a visible edge or shell, or skin showing at the lid crease or corners when the eyes close.
4. **Gloss.** Same close framing and light for *Gloss A*, *B*, *C* and *D*. Then one light sweep, or a camera orbit if the light is fixed.
   - A: last session's finishes, now lifted. Do Matte and Satin still look glossy?
   - B: skin's own shine under colour. If A and B look alike, the written roughness is not what you see.
   - C: everything fully rough. If C still looks glossy, the gloss comes from something other than the makeup's roughness (lights or reflections).
   - D: the proposed calibration. Do Matte, Satin and Glossy now read as three distinct finishes, with Satin a soft sheen?
   - Metallic (right outer stripe): does it look plastic compared with its neighbours?
5. **Shimmer.** *Shimmer · strong*, close framing, light sweep: do the strong stripes (left inner, right outer) flash in points while the fine stripe and the Satin control stay smoother? Then face framing: is strong Shimmer still distinguishable from Satin?
6. **Metal ramp.** *Metal ramp · lifted*, soft side light: are last session's angular highlight shapes gone? Is there a visible seam along the ramp (left lid) or between the 0.098 and 0.149 steps (right lid)?

Please send the screenshots named by step and preset, one line per step, the ArchiveXL log and the versions.

## Reproduce

Extract the head and vanilla decals with WolvenKit (`unbundle` from `basegame_4_appearance.archive`, then `convert serialize`) into the ignored `research/consumers/plate-depth/raw/json/`. Serialize the built-in plate into `raw/platejson/` and the mod meshes into `raw/modjson/`. Then run:

```powershell
python experiments/017-plate-depth/measure_offsets.py --json research/consumers/plate-depth/raw/json --plate-json research/consumers/plate-depth/raw/platejson --mod-json research/consumers/plate-depth/raw/modjson --output experiments/017-plate-depth/offset-evidence.json
bun experiments/017-plate-depth/make-candidate.ts
# from projects/xf-studio/authoring
bun tools/build_collection_package.ts --collection ../../../experiments/017-plate-depth/depth-candidate.collection.json --plate <plate>/resources --plate-manifest <plate>/plate-manifest.json --wolvenkit <WolvenKit.CLI.exe> --gamepath <game> --diagnostics
```

Input SHA-256: head mesh `e877b91a…74c6` and morph `3e10c3f7…9b7e` (the audited 2.31 revision); eye-makeup mesh `b2597cfa…ec88` and morph `1bde3fff…d8b7`; legacy mod mesh `93600007…e686`; Winterkissed mesh `759ce74a…a8a2b`. The decoders ([`redmesh.py`](redmesh.py)) follow WolvenKit's `MeshTools`/`MorphTargetTools` formats; the light, SSS and decal programs were decompiled with dxil-spirv and SPIRV-Cross ([shader method](../../research/materials/shader-system/README.md)).

## Limits

- The lift has not been through the dense idle, subframe and finite-triangle contact gates of experiments 006/012; it follows the vanilla construction instead, and vanilla accepts contact where the lids meet.
- The mechanism behind "only close up" and the `OFFSET_DecalBias` values are unconfirmed.
- The gloss explanation is a calibration hypothesis; photo-mode light parameters and reflection passes were not traced.
- Hidden chunks and diagnostic materials are candidate-only; a normal collection builds one chunk and the unchanged materials.
