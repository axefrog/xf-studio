# Glitter reference review and next prototype

23 September 2026. Read-only review of the five preserved images, the current flake baker, the browser material adapter, installed Three.js 0.186.0 shader chunks, and our inspected REDengine decal contract. No production material, saved recipe, game asset or original photograph changed. This is a proposed experiment, not a completed glitter correction or measured optical reconstruction.

## What the references actually show

The [reference manifest](../backlog/glitter-visual-references.json) records the unchanged originals, ignored local copies, hashes and unresolved creator attribution. All five local images were opened during this review.

- **Studio screenshot:** conspicuous repeated circular dark centres and bright rims form approximately regular rows over an almost uninterrupted cyan area. The circles have little apparent size variation. This reads more like a patterned coated surface than the irregular fine glitter Nathan supplied.
- **Purple/gold references 1 and 2:** many fine, irregularly spaced bright fragments, some larger visible fragments, varied brightness and local density. Purple pigment remains visible between them. Gold/pale and occasional other-coloured highlights are distinct from the purple base. The closer reference contains large soft circles toward defocused areas; those circles are not reliable measurements of flake shape or size.
- **Copper reference 3:** a more continuous foil-like reflective band, still broken up by skin/eyelid structure. Useful for the transition toward dense metallic sheen; it should not force all glitter into one dense finish.
- **Pink reference 4:** sparse fine gold highlights over gradients, with larger spaces between groups. It supports an independently controllable sparse overlay as well as the denser purple examples.

A still photograph does not establish facet normals, physical dimensions, metalness, roughness, camera response or the split between particles and lighting. These observations are visual design constraints. In particular, a permanent bright-dot texture would reproduce highlights only for one lighting/view configuration, not the reflective behaviour we need.

## Concrete causes in the current code

Sources: [`finish.ts`](../../projects/xf-studio/authoring/src/finish.ts), [`makeup-stack.ts`](../../projects/xf-studio/authoring/src/makeup-stack.ts), and the installed Three.js shader chunks named below.

1. **The placement retains a lattice.** Each occupied cell contains exactly one circular facet. Its centre moves only ±0.15 cell from the centre, so neighbouring cells retain large structured empty corridors. At the default 1024 bake and 128 cells per axis, the spacing is eight texels and jitter only ±1.2 texels. Randomly omitting cells does not remove the grid in occupied neighbours.
2. **The radius distribution is narrow and the silhouette is always circular.** Glitter radii are 0.21–0.30 cell: 1.68–2.4 texels at that default bake. Diameter varies only by a factor of 1.43. The nominal occupied disk area is about 13.4% of the atlas at default density 0.65, before raster edge filtering (computed as `0.65 * pi * E[radiusInCells²]`). This explains why a high-sounding 65% density is not 65% flake coverage. The density control is currently cell occupancy probability.
3. **Facet centres suppress the same cyan pigment that colours their reflection.** The surface map sets covered glitter texels toward metalness 0.95 and roughness 0.2; uncovered texels tend toward metalness 0 and roughness 0.7. Installed Three.js `lights_physical_fragment.glsl.js` multiplies diffuse contribution by `1-metalness`, and mixes the specular colour toward diffuse RGB as metalness rises. A highly metallic facet that is not reflecting the light/view can therefore be darker than the diffuse base. Dark facets are not inherently invalid, but many similar dark disks dominate this particular candidate.
4. **Soft disk edges also rotate normals.** The baker blends a tilted facet normal toward flat according to disk coverage and renormalizes it. A one-texel edge is substantial relative to a roughly two-texel radius. Together with changing roughness and metalness, that creates a continuous rim of intermediate shading directions around a flat centre. This is a plausible contributor to rings, not a proven sole cause. A controlled normal/metalness/roughness ablation is needed before attributing the whole artifact to normals.
5. **Flake coverage is not layer opacity.** The packed red channel records flake coverage for research; `makeup-stack.ts` binds that image only as roughness/metalness maps. Three.js reads green/blue respectively. The complete cyan shape remains covered by the separate procedural alpha canvas. There is no independently coloured gold/silver flake layer: every facet uses the layer's colour. The supplied gold-over-purple references cannot be matched simply by making this cyan pattern finer.
6. **The current mip chain cannot retain an orientation distribution.** Ordinary mipmapping averages encoded normal vectors and scalar roughness/metalness. The tangent normal shader then normalizes its sampled normal. This retains a mean direction but loses the spread of unresolved normals. Three.js's inspected `geometryRoughness` uses derivatives of `nonPerturbedNormal`; it does not recover the baked flake-normal variance. Anisotropy improves oblique texture sampling, but does not solve this lost distribution. Subpixel glints can disappear, merge incorrectly or alias even if placement is improved.

There is no animated noise or emission in this baker. Stable view-dependent changes should follow stationary facet positions and actual light/view movement. With the camera, lighting, pose and render settings frozen, the same material inputs must not randomly change across frames.

## Proposed stable irregular-flake construction

Keep a versioned, deterministic **UV-space flake catalogue**, evaluated at any texture resolution. Generate centres, shape, orientation and colour choices from seed plus stable flake IDs, independently of output pixels. Sampling the same seed at 1024 and 2048 must describe the same flakes, not a different random pattern.

Use a full-area random point process with variable occupancy rather than one almost-centred disk per cell. A spatial grid can still accelerate lookup, but its cells should be an invisible implementation detail: allow variable counts, full-cell centre positions and shapes crossing bucket boundaries. Initially use independent samples; only add a minimum-distance constraint if overlap is visually excessive, since a strong exclusion radius can itself make spacing unnaturally even. A low-frequency coverage envelope can provide sparse/dense patches, but should not introduce a second visible repeating tile.

Sample a bounded distribution dominated by small flakes with fewer larger flakes, plus varied aspect ratio and angle. Rounded polygons/short irregular fragments or ellipses are suitable initial hypotheses. Changing shape alone is insufficient: subpixel filtering and orientation still determine what the camera sees. Do not trace or copy shapes from the reference photos. Keep each flake internally approximately planar; do not replace flat facets with radial bump domes.

Separate these concepts in the prototype's data, even before exposing all controls:

| Property | What it controls | What it must not become |
|---|---|---|
| Base pigment colour/coverage | Colour between flakes and overall makeup footprint | A baked lighting result |
| Flake reflectance colour and covered fraction | Pale, gold or coloured fragments over that pigment | A global tint that necessarily recolours the base |
| Flake size distribution and spatial density | Fine versus chunky, sparse versus dense | Density labelled as area coverage when it is only candidate probability |
| Facet orientation distribution | Which stationary flakes can catch a light/view | A per-frame random sparkle animation |
| Facet roughness | Breadth of each reflection | A brightness mask masquerading as reflection |
| Unresolved variance/filtering | How fine flakes merge with distance | Arbitrary sharpening or fixed bright dots |

For an initial single-PBR approximation, the maps may describe a flake replacing the covered fraction of pigment locally. It still cannot exactly represent two independently lit BRDF lobes within one texel. A custom browser glitter lobe might eventually do better, but must remain explicitly separate from the engine-compatible map approximation until a corresponding game technique is proved.

## What can map to the inspected game material

The [mesh-decal contract](mesh-decal-shader-contract.md) establishes inputs for the selected compiled `mesh_decal` variant, not runtime glitter quality:

- A deterministic flake field can supply normal XY, roughness, metalness, colour and independent coverage inputs. Export linear BC5 XY normals; roughness and metalness must be separate red-channel maps rather than the browser's G/B packing. Preserve the existing sign/mode comparison because tangent conventions and normal composition have not been visually validated in-game.
- Colour/surface coverage is squared after the inspected contrast/mask operations. The current square-root diffuse-alpha encoding compensates only at texel centres. Normal coverage has a separate input path. Generate these from the actual desired contribution, not by sharing one alpha byte and assuming all channels mean the same thing.
- The decal writes material properties to G-buffer targets; Three.js shades each transparent plate separately. Shared maps are useful inputs for comparison, not equivalent compositing models. Flakes over another finish especially expose this difference.
- Ordinary maps can provide resolved reflective facets. They do not prove support for an explicit per-pixel distribution of many subpixel normals, independent coloured reflection lobes, sparkle sampling, or exact energy-preserving filtered glitter. Investigate shader/material families further only if the shared-map candidate cannot meet the target.
- The named `metal_base_glitter` FX shader is not a shortcut: our [previous inspection](glitter-shader-investigation.md) found emission-related logic and different depth/blend behaviour. Do not replace a soft decal with it merely because of its name.
- The current `mesh-decal-flat-v1` preset compiler deliberately rejects glitter and disables normal contribution. Preserve that rejection until an optical adapter can compile the candidate faithfully enough for a labelled game experiment. A browser improvement alone is not installable glitter support.

Custom normal/roughness mip generation is a useful separate investigation. Keeping an unnormalized mean or normal second moments can estimate lost angular spread; mapping that estimate into roughness is a model requiring validation, not a universal formula. First record moment/coverage statistics at each mip. Then compare a proposed filtered model against high-resolution supersampled renders. The XBM import path must preserve or reproducibly generate the intended mip chain; base-level compression success does not prove this.

## Bounded next prototype and evidence

Implement **one opt-in versioned flake distribution candidate**, retaining the old baker as the visual control and old recipes unchanged. Use the same plate, one fixed authored shape, fixed seed, camera, lights, exposure and pose. Keep the ordinary PBR adapter initially so placement changes can be distinguished from a renderer rewrite.

1. Produce a four-column ablation: existing candidate; irregular placement/size only; that candidate with gentler facet spread and tested reflectance mix; same candidate with base/flake colour separation. A zero-normal and a zero-metalness diagnostic can additionally isolate the ring mechanism without being proposed as the finished glitter material.
2. Bake 1024 and 2048 from the same flake catalogue, including coverage, normal, roughness, metalness and proposed colour maps. Report generated flake count, effective covered area, radius quantiles, seed, field bounds and input hashes. Calibrate a sparse and a dense preset against the visual intent, without calling their parameters measurements of the photographs.
3. Render close eye, normal editing distance and further distance, at ordinary and narrow FOV with matched framing. Sweep light angle separately from view angle, then run the existing idle with a fixed camera/light. Record the authored material and each exact preview setting alongside screenshots/video.
4. Before changing filtering, capture the current mip failure mode. Compare downsampled high-resolution reference renders against native lower-resolution renders and report mean energy, high-percentile highlights and pixel error by scale. A later variance-aware mip candidate must improve this measured comparison rather than simply look brighter.

Proposed acceptance criteria for that prototype—not claims about present output:

- Byte-identical bakes for identical inputs; stationary UV catalogue across resolutions; seed changes affect placement but not target aggregate density outside a documented statistical range. Zero density restores the base material and unperturbed normal.
- No dominant horizontal/vertical cell-grid peak in coverage-map autocorrelation relative to the existing candidate; inspect the coverage map separately from lighting. Report metrics rather than hiding a grid with camera blur.
- No clipped flake edges at spatial bucket boundaries. Finite normalized base-level normals, bounded channels, and coverage accounting include overlapping fragments without order-dependent random changes.
- Visually: varied fine fragments, visible pigment between them, sparse/dense options, and no repeated dark ring/stud pattern at ordinary editing distance. The copper reference's continuous foil tendency remains distinct from sparse glitter.
- With idle/pose, camera and lighting all frozen, 120 repeated render captures have identical material inputs and no unexplained temporal sparkle. Controlled view/light sweeps show highlights moving between stationary facets rather than a texture animation.
- Report minification errors and worst cases rather than declaring them solved by mipmaps. No obviously persistent flashing grid or full-flake on/off popping during slow view movement; if finer flakes are below the available representation's capacity, retain that limitation and move to the filtering study.
- Existing matte/satin/metallic coverage and recipe round trips remain unchanged. Unsupported game glitter export still fails explicitly until its adapter exists.

## Provenance for the parent checkpoint

Extend the existing **Makeup photography references — attribution unresolved** entry with this review link and the specific lessons: distinguish irregular fine flakes, independent gold/pale glints over base pigment, dense foil-like reflection, and photographic defocus. The manifest already preserves paths/hashes and the unresolved `yangyangbabyi` watermark lead. This remains local visual inspiration only; no asset reuse or permission to redistribute photos.

Extend **Three.js — mrdoob and contributors**, installed 0.186.0, source/dependency learning. The local files `src/renderers/shaders/ShaderChunk/{lights_physical_fragment,normal_fragment_maps,roughnessmap_fragment,metalnessmap_fragment}.glsl.js` establish metalness reducing diffuse contribution, reflectance tint mixing, G/B map reads, sampled-normal normalization and geometric roughness using `nonPerturbedNormal`. These observations identify why a high-metalness disk can darken and why ordinary mipmaps do not preserve flake-normal spread. Source link: https://github.com/mrdoob/three.js/tree/r186/src/renderers/shaders/ShaderChunk . No shader implementation copied into the project.

The existing CDPR/WolvenKit shader-cache and material-contract provenance remains applicable; this review reused our pinned findings rather than decoding a new shader or learning from a new external mod. Proposed distribution mathematics, ablations and acceptance criteria are project-authored. No additional external-source claims were needed.
