# Hair Lab procedural strand textures

Experimental offline track; no preview wiring, packaging or game evidence. The coordinator's strand-texture brief approves a pure description-to-atlas boundary. This work does not register a graph capability or run generation on the page thread. The later consumer must own worker demand, revision matching and cancellation through the existing Hair Lab process.

The approved continuation adds an isolated strip texture set for consumption: every selectable region gets its own complete mip chain through 1×1, using its content rectangle as the texture domain. It reuses the existing resolved hair material/profile, remaps atlas UVs in the new texture adapter and supplies Flow through a new renderer hook. The existing shared material files remain untouched. A single atlas texel cannot preserve several regions' different coverages; region isolation is the mathematical boundary for arbitrary-distance sampling. No claim is made about the game's actual distance-to-streaming policy; a complete chain covers every possible requested mip.

Export implication: the current preview proposal has four textures per selected region (56 for all 14 strips), rather than four textures for the whole atlas. A future exporter must either keep those separate material/texture sets, use a supported array strategy, or design a separate far representation for a shared atlas. The current content crops have non-power-of-two dimensions; cooking constraints, block padding, texture counts and UV transforms need an export decision and compression validation. This track builds no exporter.

ID sampling reproduces scalar filtering evident in the vanilla resource: a finite-resolution ID bake with a neutral background, followed by a monotone visibility-weighted distribution curve. The curve is declared as aggregate histogram data, never copied texture pixels or added pixel noise. Fibre IDs remain constant in the synthetic sample; edge values are filtered mixtures derived from that sample. Tests cover determinism, constant fields, distribution error, full-chain isolation/coverage, region selection, shader input shape and abort-owned adapter resources.

## Artist decisions and evidence

Read on 17 October 2026. These sources describe artist workflows, not the Cyberpunk shader's encoding. No source code, presets or texture assets are reused.

| Artist decision and source | Our computation |
|---|---|
| [eagul's beginner tutorial](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/3d-modelling/hair-modeling-beginner-tutorial), edited by mana vortex: dense lower cards, progressively lighter outer cards, several variants of similar density | Explicit region table with dense, clump, wisp and single types; density is measured, not inferred from a type name. Long strips and a shorter second row are supported. |
| [Hair Strand Designer, Polytricity](https://polytricity.artstation.com/store/j7PY/hair-strand-designer-v1-7-0-full-perpetual-license-free-demo-and-sample-set): strand count, width, spacing, length, waviness and taper; seeded regeneration and multiple map outputs | Seeded fibre population; each fibre owns its identity, centreline, width profile and intrinsic coordinate. Map passes read the same visible fibre sample. |
| [HairTG-Cards 2, Eyosido](https://eyosido.com/hairtg-cards): row/column designs, shared and local parameters, density/length progressions and separate geometry/texturing stages | Data-only region specifications, explicit padded rectangles and independent type metadata; texture fine waves/frizz do not replace macro-curl geometry. |
| [Hair Tool baking, Bartosz Styperek](https://joseconseco.github.io/HairTool_3_Documentation/texture_baking.html): generate strands, add noise and clumping, remove strands for thickness, trim lengths, bake opacity/random ID/root/flow from that groom | Sample fibres once, vary count and length, attract children to clump centres, apply continuous fine noise; jointly rasterise coverage, constant fibre ID, cumulative-distance gradient and tangent. |
| [GS CurveTools attributes](https://gs-curvetools.readthedocs.io/en/latest/attributes.html): independent width/taper, twist and curvature subdivision | Keep fibre width profile separate from centreline shape and tessellation. Region UVs and geometry orientation remain explicit consumer responsibilities. |
| [SideFX Bake Texture](https://www.sidefx.com/docs/houdini/nodes/out/baketexture.html): multiple output planes from the same high-resolution objects, projected to low-resolution UVs | One deterministic visible sample supplies all attributes. No independently seeded image noise passes. |
| [Epic's groom cards documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/setting-up-cards-and-meshes-for-grooms-in-unreal-engine): coverage, tangent and root/coordinate/seed attributes have explicit texture layouts | Publish channel and colour-space metadata. Unreal packing is a workflow reference only; generated channels follow `hair.mt`. |

Local Modding Docs revision: `a54b08735a560bca7dd76b1e1dab1631e6aaae89`; guide `for-mod-creators-theory/3d-modelling/hair-modeling-beginner-tutorial/README.md`, attribution in Summary. Inspected `.gitbook/assets/image (429).png`: two dense long strips at left, several lighter clumps/wisps and singles at right, with shorter variants below. This is an editor atlas example, not runtime proof.

Also inspected Hair Tool's `img/hair_bake_passes.jpg` at the linked documentation site: the same changing-density clumps recur across its map panels. Inspected Epic's `groom-textures-default-layout.png` linked from its cards page: Coverage R8, Tangent RGB8 and Attributes RootUV/CoordU/Seed RGB8 are separate slots. The publicly served pages were read on the date above; no exact source revision is supplied by those pages. The Hair Strand Designer store page labels its older product V1.84.0.2; HairTG describes version 2. These are workflow evidence, not claims about current installed tool versions. Houdini's consulted page identifies Bake Texture 3.0 in the Houdini 22.0 documentation.

## Data and numerical contract

The [pure module](../../projects/xf-studio/authoring/src/features/hair-lab/textures.ts) accepts a versioned atlas description: dimensions, seed, cutoff and region rectangles with gutters; each region declares fibre count, width, clumps, length variation, fine wave/frizz, taper, an optional intrinsic width envelope and an ID quantile distribution. It returns tightly packed scalar R8 alpha/ID/gradient, RGB8 Flow, mip levels, per-region UV rectangles/type metadata and coverage/direction diagnostics. All buffers are owned by the caller, transferable and rebuildable. No filesystem, random source, clock, renderer or graph imports are present. An optional `AbortSignal` is checked between resumable batches; a worker adapter must yield between batches if it needs message-driven cancellation. Progress distinguishes fibre sampling, rasterisation, measurement, attribute padding, mip filtering and mip compensation; mip progress also names its level.

The intermediate synthetic fibre sample consists of polylines in atlas pixel coordinates with cumulative normalised arc length, a constant ID and width at each vertex. The strip coordinate is monotone; macro curls and backtracking belong in geometry. ID quantiles are stratified and independently shuffled so a low fibre count does not accidentally shift a whole card's roughness. A deterministic painter ordering chooses one foreground fibre for attributes at crossings; coverage is the union of a 4-by-4 subpixel silhouette mask. All three attributes use the same foreground fibre, even at a partly covered crossing. This is a finite supersampling bake, not an analytic fibre intersection or depth renderer. Attribute padding extends into transparent texels within each region, never across another region's gutter. Root and tip widths taper to zero; roots and tips may end at different image rows. The gradient follows the sampled polyline, never atlas height.

Optional [ID sampling](../../projects/xf-studio/authoring/src/features/hair-lab/strand-id-filter.ts) box-bakes the scalar fibre ID over alpha onto a declared neutral background, then bilinearly reconstructs it. The default 2K chart uses a four-pixel footprint, matching the reference ID map's 512² resolution, and neutral byte 104 (the most frequent uncovered reference ID). A monotone empirical CDF maps these filtered values to declared 16-bin visibility-weighted targets. The [default targets](../../projects/xf-studio/authoring/src/features/hair-lab/strand-id-targets.ts) are aggregate measurements of the private reference below, rounded to six decimals and normalised at use; no spatial values are stored. This is calibration against the reference, not a held-out validation claim. Without this step four constant fibre IDs produce only four spikes. A truly constant field cannot be split by the curve; its unattainable histogram error stays explicit. Other maps are untouched.

The [decoded hair shader](../../knowledge/hair-shading.md) reads alpha, ID and gradient as linear red channels. Flow is sRGB (`isGamma=1`). With `FlowStrength=1`, its decoded coefficients are `max(2*linear(R)-1, .01)` along mesh tangent and `max(2*linear(G)-1, .01)` along bitangent; blue is unused. Encode through the inverse sRGB transfer function, then measure the quantised decoded direction.

**Representability limit:** both decoded coefficients are positive. Mixed-sign UV tangents cannot be reproduced exactly at strength 1; reversing an unoriented fibre axis does not solve a mixed-sign pair. The encoder projects onto the supported cone and reports angular error rather than silently claiming exact signed flow. Shallow fine waves keep that error small. A generic signed normal-map encoding is incorrect here.

`mirrored` is explicit region metadata and a bake option: true means the consumer supplies a mesh tangent opposite increasing image U, while bitangent still follows increasing V. The encoder then solves for that basis. UVs stay unchanged. A plain UV reflection with a consistently recomputed tangent frame reflects both the alpha silhouette and decoded direction, leaving their relative angular error unchanged; it is useful for diversity, not this clamp. Changing the tangent sign can fit a predominantly negative strip. It cannot fit both signs of a single wavy strip. Each region reports its current and flipped RMS error and a recommended basis; the result reports the best possible RMS when choosing one basis per region. A consumer must not interpret this flag as merely flipping UVs.

Coverage measurements use the shader's cutoff remap followed by its time-resolved dither function. The three-layer k-buffer does not turn card overlap into independent coverage events; this atlas measures a single flat card. Mips stay within aligned padded cells, scalar attributes use alpha weighting, and Flow filters in decoded linear space. Compensation measures four bilinear subtexel positions per texel, applies the shader's cutoff/dither remap **after** filtering and solves an alpha scale against base-level filtered coverage. Quantisation and clipping happen before filtering. Every mip records target, raw filtered coverage, corrected coverage and scale; saturation is explicit when no scale can reach the target. Texel-centre coverage, alpha mean and visible-weighted ID/gradient/specular-shift histograms are separate measurements.

Shared atlas mips stop before cells lose their one-texel gutters or alignment; the default chart provides levels 0–3. For rendering, [prepareHairAtlasStrips](../../projects/xf-studio/authoring/src/features/hair-lab/strand-strips.ts) crops each content domain and builds its own complete chain to 1×1. Odd dimensions use area integration, positive sub-byte alpha footprints survive quantisation, and transparent attributes retain padding. Each level's compensation measures clamped bilinear sampling over that strip alone. The original uncorrected alpha mass drives attribute filtering; repeated alpha compensation never compounds it. `hairAtlasStripSteps` exposes resumable batches. The shared chart is still unsuitable for arbitrary-distance sampling; use the isolated chains. Bilinear quadrature is an offline estimate, not TAA/DLSS or anisotropic filtering proof.

For the renderer, UVs are image coordinates with root at the smaller V and `flipY=false`. Use the returned **content** UV rectangle, not the cell. The existing hair shader replaces Three's ordinary green alpha-map read with red, so scalar RedFormat inputs work for this colour pass. The new adapter uploads supplied mips rather than requesting ordinary averaged alpha. Shadow materials are outside this proposal. Generation remains worker work; none of these modules is registered or imported by the ordinary flag-off composition.

`defaultHairAtlas(size)` supplies an editable description; `generateHairAtlas(description, signal)` produces the complete result synchronously in a worker/offline process. `hairAtlasSteps(description, signal)` exposes the same work as a resumable generator; its final return value is the atlas. `sampleAtlasFibres` and `rasterAtlasFibres` expose the shared sample/bake boundary for independent fixtures. Callers may supply several descriptions or workers; there is no singleton or hidden cache. Output map dimensions belong to each mip, and `regions` contains content/cell rectangles, UVs, card type, variation, fibre count, measured density, basis metadata and every mip's coverage record.

## Validation plan

Model-derived tests precede implementation: byte determinism; seed variation and stable region identity; channel agreement at crossings; fibre-distance gradient on a curved, shortened fibre; tip taper; gamma Flow roundtrip and signed-direction limitation; region isolation; per-mip coverage at several densities; malformed and excessive inputs; abort before/during generation. Offline probes compare region coverage and covered-pixel ID/gradient histograms with a vanilla long-hair atlas resolved through the generic base-only installation route. A flat CPU card uses the same profile, material, normal, camera and lights with the Studio's pure hair model for both map sets. Aggregate similarity is a sanity check, not image equivalence or rendering proof.

Target: 2048 squared, four maps in a few seconds in a worker, with timing separated from PNG encoding and vanilla resource reading. Tests and real-data probes run under a 1 GB memory guard. Generated images remain ignored in `authoring/build/hair-lab-wip/`; no vanilla pixels are committed.

## Results and remaining gates

The kernel, isolated strip preparation, opt-in preview adapter and offline tools are implemented. The track changes no authored recipes, export eligibility, package building or promotion, so the Studio-to-mod pipeline remains unchanged. Live preview wiring, GPU shader compilation, compression/cooking, multi-card k-buffer behaviour and in-game appearance need later validation. No browser, game, mod manager or existing draft was operated.

### Reference acquisition

[Reference tool](../../projects/xf-studio/authoring/tools/hair-atlas-reference.ts): the generic resolver's base-only direct route, native reader only, female hairstyle 01, `hh_033_wa__player.mesh`, material `brown_liquorice_cards`, resolved profile `brown_liquorice.hp`, explicit AlphaCutoff 0. No installed mod route or per-mod intake is used. Archive winner for all four maps is `basegame_4_appearance.archive`; native reader identity `xfs-native:4:f93d8181d2fc:oodle:4f73be5d986b2b11`. Resource names below share `base\characters\common\hair\textures\`.

| Input / filename | Mip 0 | Format / gamma | Extracted-resource SHA-256 |
|---|---|---|---|
| Alpha / `hh_long01_alpha01_r.xbm` | 1024² | BC4 / false | `b6c5555790bd58e0f705a5ff64b587dfff6fc9135ba79af3546dcde0c21ed60b` |
| ID / `hh_long01_id01_r.xbm` | 512² | BC4 / false | `c0753cf72d54f3827984b061a32989af988ea5fc3a01c2e2aefe186e9b88e87b` |
| Gradient / `hh_long01_grad01_r.xbm` | 512² | BC4 / false | `c2f0fbe86c738b1a1863cd81f0bc3844f809d1ba2b63faa0d6fbc3867e2945c3` |
| Flow / `hh_long01_flow01_d.xbm` | 512² | BC7 / true | `bebe16607ac9057634f23b2f46a0b2236c4258589b68aed605c4d2c7b500efb0` |

The decoded alpha was inspected, as was the gradient. It has the same dense-to-sparse organisation as the tutorial illustration, with nine long columns and five shorter regions below. These are not independent demonstrations of a workflow's rendering quality. The comparison uses manually selected strip cells; it does not claim to recover the artist's original UV-box metadata. The lower-resolution vanilla maps are bilinearly reconstructed into the common 2048² chart, with Flow decoded before interpolation. All decoded content and full provenance remain in the ignored build folder.

### Coverage and distributions

Single-card measurements at AlphaCutoff 0. Coverage here is texel-centre temporal coverage; mip targets use bilinear quadrature separately. ID errors are total variation on 16 visibility-weighted bins (0 identical, 1 disjoint). Fibre counts describe our synthetic population, not a recovered count of native strands.

| Region | Synthetic fibres | Vanilla coverage | Generated coverage | ID histogram error | Gradient mean error |
|---|---:|---:|---:|---:|---:|
| Dense A | 170 | .568 | .568 | .013 | −.016 |
| Dense B | 155 | .495 | .498 | .027 | −.000 |
| Clump A | 75 | .304 | .308 | .033 | −.014 |
| Clump B | 39 | .242 | .241 | .036 | −.013 |
| Wisp A | 42 | .187 | .187 | .048 | −.016 |
| Wisp B | 40 | .186 | .188 | .059 | +.006 |
| Wisp C | 40 | .185 | .188 | .065 | +.004 |
| Wisp D / curl | 36 | .151 | .155 | .058 | +.004 |
| Flyaway singles | 8 | .058 | .059 | .046 | +.020 |
| Short wisp A | 160 | .111 | .113 | .048 | +.008 |
| Short wisp B / curl | 200 | .140 | .141 | .089 | +.008 |
| Short clump | 300 | .282 | .257 | .040 | −.007 |
| Short dense | 155 | .484 | .493 | .018 | +.002 |
| Short flyaway set | 36 | .089 | .091 | .098 | +.008 |

Long wisp populations increased from 21–26 to 36–42 fibres, long singles from 4 to 8, short wisps from 110/145 to 160/200, and short singles from 24 to 36. Thinner widths preserve the reference's outer-card coverage instead of simply making thicker opaque strips. Long wisps now span .155–.188 against .151–.187; flyaways are .059 against .058. These are norms of the inspected atlas and tutorial density progression, not a universal artist count standard. The short clump remains .026 below its reference and has a different silhouette.

All default ID histogram errors are below .099, with means within .0011. Re-running the original four-fibre fixture at its original width .02 gives **.06665**, versus .785 before filtered ID calibration. Reducing both count and width can still leave too few distinct scalar samples; the returned distribution error exposes that limitation. Gradient remains intrinsic distance, never remapped to fit a histogram; the flyaway gradient histogram still differs by about .394 despite a mean within .020. Distribution matching establishes comparable inputs to colour, roughness and specular shift, not identical spatial correlations or unseen-seed accuracy.

### Complete strip mip chains

Every default long strip has 11 levels, every short strip 9, ending at 1×1. All 14 preserve their own density beyond shared-atlas level 3; dense A and singles reach different final alpha bytes, 126 and 15. Largest absolute coverage error over every level is **.002351 at cutoff 0** and **.003539 at cutoff .33**, with no saturated levels. These match the expected uniform-byte quantisation bound (about .002372 and .003540 respectively). Coverage is measured after quantisation, bilinear filtering, cutoff remap and temporal dither resolution, not from average alpha.

Tests include dense and sparse NPOT strips, odd dimensions, independent constant ID fields, stable region selection, both cutoffs and abort between preparation batches. The [real-data probe](../../projects/xf-studio/authoring/tools/hair-atlas-compare.ts) repeats the 2K measurements. The `.33` oracle runs separately with `--cutoff-probe` to fit the 1 GB budget. No distance-to-streaming policy was inferred: complete chains cover the smallest mip any such policy can request. Fractional LODs use trilinear sampling in the visual probe; the per-level bound does not prove arbitrary anisotropic filtering or the game's temporal result.

### Offline card colour and lighting check

The [comparison tool](../../projects/xf-studio/authoring/tools/hair-atlas-compare.ts) renders six separate, gently cupped/bowed cards: dense, clump, wisp, flyaway, curl and short curl. Generated and vanilla maps share geometry, original atlas UVs, brown_liquorice profile, material and lights. Both sides use the same isolated mip policy; the comparison does not claim to reproduce native cooked mip behaviour. Near cards are 345 pixels long (short card 180); far cards are 64/32. Sampling is trilinear with 2×2 spatial supersampling. Albedo, roughness, Flow direction, ID specular shift, local direct light and environment use the Studio's pure hair colour/lighting maths.

Light directions are normalised `(0.3, .25, 1)` and `(−.3, .25, −1)`, view `(0,0,1)`, environment irradiance .12, exposure 4, no vertex shadow. The back case uses the same exposure; it is intentionally much darker. The six generated/native visible-weighted red-light ratios range from .948–1.023 front-lit and .937–1.008 back-lit. For dense A, front-lit mean linear RGB is generated `(.014135, .011980, .009924)` versus vanilla `(.014670, .012421, .010253)`. The full report retains all RGB channels and coverage per card.

`atlas-07-compare.png` was inspected at 1536×1120: labels and near/far groups are readable, types are distinct, generated wisps have more evenly spaced fine fibres while native wisps show stronger bundled silhouettes; flyaway crossings differ. Similar colour and integrated density do not make these spatial patterns equivalent. The previous flat-atlas probe also remains reproducible: mean RGB generated `(.020026, .017387, .014691)` versus vanilla `(.020459, .017785, .014947)` under its documented single light. These are CPU comparisons without GPU compilation, shadows, overlapping cards/k-buffer, compressed generated maps, TAA history or game evidence.

### Flow basis and scoped shader proposal

Default shallow waves: arc-length-weighted angular RMS **4.06°**, maximum **26.02°**, 49.98% of sampled length outside the positive coefficient cone. Choosing the better tangent basis per region lowers RMS to **3.91°**. A consistently negative diagonal fixture improves from about 17.3° to below .6° with the flipped tangent basis. Reflecting both image and frame leaves relative error unchanged. These are source-polyline measurements, not raster visibility weights.

The shared preview currently uses only `normalize(tbn[1])`. The new [adapter proposal](../../projects/xf-studio/authoring/src/hair-atlas-preview-adapter.ts) calls the existing hair-strand material adapter, then hooks only that new material. Its formula is exactly §4 of [hair shading](../../knowledge/hair-shading.md): sRGB texture sampling first, the asymmetric FlowStrength arithmetic and both `.01` clamps, then normalisation in the tangent frame. A source-token guard fails closed if the shared shader moves. No shared preview file was edited.

`--flow-proposal` renders the same vanilla cards with the current bitangent-only rule and with decoded Flow, saved as `atlas-08-flow-proposal.png`. Coverage is identical. Visible-weighted red changes −.33% to −5.21% front-lit and −.13% to +3.73% back-lit, largest on the flyaway/short curves. Both were visually inspected. This confirms the scoped proposal moves its direction computation toward the decoded game arithmetic; it does **not** establish a whole-hairstyle visual improvement in game. Central integration must verify actual GPU compilation and batch a vanilla hairstyle regression with the next approved runtime session before applying Flow globally.

Patch note for the main adapter: keep this opt-in hook scoped to generated cards for now. A future shared change must request Flow with colour-space decoding, preserve the scalar-map data reads and resolved FlowStrength, and replace only the lighting strand direction. Do not alter coverage or the profile bake along with that change.

## Exact consumption call

Worker-side, behind the Hair Lab experiment's existing demand/cancellation process:

```ts
const atlas = generateHairAtlas(description, signal);
const prepared = prepareHairAtlasStrips(atlas, signal);
// Transfer each alpha/id/gradient/flow ArrayBuffer in prepared.strips[*].levels[*].
```

On the renderer side, composition joins the pure feature result and the structural scene adapter:

```ts
// In src/compose/ (the feature renderer itself never imports scene internals).
import { selectHairAtlasStrip } from "../features/hair-lab/strand-strips";
import { createHairAtlasPreview } from "../hair-atlas-preview-adapter";

const strip = selectHairAtlasStrip(prepared, {
  kind: "wisp", lengthClass: "long", mirrored: false,
}, cardIndex);
if (!strip) throw Error("Requested card strip is unavailable");
const preview = createHairAtlasPreview(prepared, renderLifetimeSignal);
mesh.material = preview.createMaterial(strip.key, resolvedHairChunk, mesh, adapterContext);
```

Create one `preview` scope per atlas/render lifetime, reuse it across cards, and group cards by strip/material. The returned strip table supplies `key`, `kinds` (dense/clump/wisp/flyaway, plus curl when applicable), `lengthClass`, `mirrored`, fibre count, measured density, original `atlasUV`, levels and coverage diagnostics. Selection is deterministic modulo the matching candidates and returns null instead of silently changing type/length/basis. The default chart bakes the normal basis; descriptions may explicitly bake mirrored variants.

Keep mesh UVs inside `strip.atlasUV`; the alpha texture matrix remaps that content rectangle to isolated 0–1 coordinates for all samplers. Supply indexed card geometry with positions and UVs; the adapter computes missing normals/tangents once. Existing tangents must follow ordinary increasing U: this proposal applies the `mirrored` T sign in its shader hook, so do not also flip that tangent in geometry. A future game exporter would need the equivalent basis in its mesh, because it cannot use this preview hook. Bitangent stays unchanged. All supplied mips are uploaded, clamp-to-edge, flipY false, scalar RedFormat/NoColorSpace and Flow RGBA/SRGBColorSpace. `preview.textures(key)` is also a `ChunkTextures` port for callers that need the raw texture inputs; calling the old adapter with that port alone still omits Flow.

The adapter uses a structural input type and imports no feature, keeping the scene/feature boundary one-way. It reuses the resolved HairProfile and other material scalars, but sets AlphaCutoff on a copied chunk to the generation cutoff: coverage compensation depends on it. Authored chunk data is never mutated. Three materials, profile textures and lazy per-region map caches belong to the supplied AbortSignal. Abort releases them once; geometry remains caller-owned. No UI, feature registration, startup or graph implementation changes are included. The main process must retain request identity, yield between generator batches to service abort messages (or terminate its worker), and discard stale results before creating renderer resources.

Upload provenance: inspected installed Three.js 0.186.0, `src/renderers/webgl/WebGLTextures.js` manual DataTexture mip upload and colour-space/internal-format selection. Mipmap arrays include level 0; Flow expands RGB bytes to RGBA for sRGB upload. No Three.js source was copied.

## Future game texture settings — no exporter

Native-reader inspection of the four reference `.xbm` headers confirms these settings and listed complete mip tables:

| Parameter | Channels read | isGamma | Native compression | Reference size / mip count | Generated storage before cooking |
|---|---|---:|---|---|---|
| Strand_Alpha | R coverage | 0 | TCM_QualityR / BC4 UNORM | 1024² / 11 through 1×1 | R8 linear, compensated alpha |
| Strand_ID | R scalar identity | 0 | TCM_QualityR / BC4 UNORM | 512² / 10 through 1×1 | R8 linear |
| Strand_Gradient | R intrinsic distance | 0 | TCM_QualityR / BC4 UNORM | 512² / 10 through 1×1 | R8 linear |
| Flow | R/G direction coefficients; B unused | 1 | TCM_QualityColor / BC7 sRGB | 512² / 10 through 1×1 | RGB8 sRGB (RGBA only for Three upload) |

A complete 2048² texture has 12 levels; a strip has `1 + floor(log2(max(width,height)))`. Keep all levels; do not rebuild alpha mips with ordinary averaging after compensation. Use the colour encoding above, not normal-map compression or a signed tangent map. The current direction encoder assumes material FlowStrength 1; other strengths are decoded faithfully by the adapter but require an appropriate bake if silhouette agreement is required.

The reference header/layout reader is the repository's native `xbm-texture.ts`; its compression mapping and mip tables are observed resource facts, not a guarantee that any cooker preserves hand-authored mip chains. A future exporter must validate that preservation, decode every compressed mip again, repeat coverage/distribution/Flow-error measurements, and check NPOT/block padding and UV remapping. Complete shared-atlas mips cannot preserve unlike neighbouring card densities; choose separate strips (up to 56 texture resources here) or explicitly design a far representation. No package settings, resources or pipeline routes were changed on this track.

### Time, memory and reproducibility

[Worker benchmark](../../projects/xf-studio/authoring/tools/hair-atlas-bench.ts), Bun 1.4.2, three sequential jobs on one offline worker: **1.16–1.65 s generation**, median **1.20 s**, plus **.44–.54 s** strip preparation. Request through transferable delivery is **1.61–2.17 s**. Atlas payload levels 0–3: **33,423,360 bytes**; all isolated strip maps/chains: **30,959,022 bytes**; retaining both: **64,382,382 bytes**. A consumer may discard the shared atlas after strip preparation. All three combined hashes match `c55333b59792fc535ac790841607f9a5c8520a6072bb92f31284daf915d16fa7`. Peak guard usage was **.9 GB under a 1 GB limit**. Maximum resumable batch was 130.5 ms; this is worker work, not an instant page-thread call.

The four base PNGs total 2,590,375 bytes, about .16 s encoding separately; the flat colour/reference probe takes about 2.35 s. The near/far front/back CPU comparison takes about 8.5 s including generation, reference reconstruction, full-chain preparation and an original-four-fibre oracle. Its peak is .9 GB. The separate full 2K cutoff-.33 oracle takes 1.67 s and .6 GB. One combined run containing both full comparisons and a second cutoff atlas was guard-killed at 1.1 GB; splitting that oracle into its own process fixed the bounded-memory workflow. No guard limit was raised. GPU upload and browser performance remain unmeasured.

An offline adapter probe constructs all 56 DataTextures from a full 2K result in 10.1 ms. Supplied upload payload is 36,118,859 bytes, including RGBA Flow; scalar maps reference the prepared buffers, while Flow expansion adds 20,639,348 retained bytes. Generation, strip preparation and this adapter probe together peak at .6 GB. This measures CPU texture construction only, not GPU upload or rendering.

Validation: **103 focused tests pass across eight files**, 12,837 assertions, under the 1 GB guard (peak .4 GB); targeted TypeScript checking passes. Suites cover atlas, ID filtering, full strips, preview adapter, colour model, cards/domain fixtures, lifecycle and architecture boundaries. The full authoring suite was not run within this track's 1 GB allocation. Repository link/privacy checks and explicit untracked-text link/privacy/whitespace checks pass. All PNGs and reports stay ignored under `authoring/build/hair-lab-wip/`; no generated or extracted images are committed.
