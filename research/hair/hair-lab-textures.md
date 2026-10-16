# Hair Lab procedural strand textures

Experimental offline track; no preview wiring, packaging or game evidence. The coordinator's strand-texture brief approves a pure description-to-atlas boundary. This work does not register a graph capability or run generation on the page thread. The later consumer must own worker demand, revision matching and cancellation through the existing Hair Lab process.

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

The [decoded hair shader](../../knowledge/hair-shading.md) reads alpha, ID and gradient as linear red channels. Flow is sRGB (`isGamma=1`). With `FlowStrength=1`, its decoded coefficients are `max(2*linear(R)-1, .01)` along mesh tangent and `max(2*linear(G)-1, .01)` along bitangent; blue is unused. Encode through the inverse sRGB transfer function, then measure the quantised decoded direction.

**Representability limit:** both decoded coefficients are positive. Mixed-sign UV tangents cannot be reproduced exactly at strength 1; reversing an unoriented fibre axis does not solve a mixed-sign pair. The encoder projects onto the supported cone and reports angular error rather than silently claiming exact signed flow. Shallow fine waves keep that error small. A generic signed normal-map encoding is incorrect here.

`mirrored` is explicit region metadata and a bake option: true means the consumer supplies a mesh tangent opposite increasing image U, while bitangent still follows increasing V. The encoder then solves for that basis. UVs stay unchanged. A plain UV reflection with a consistently recomputed tangent frame reflects both the alpha silhouette and decoded direction, leaving their relative angular error unchanged; it is useful for diversity, not this clamp. Changing the tangent sign can fit a predominantly negative strip. It cannot fit both signs of a single wavy strip. Each region reports its current and flipped RMS error and a recommended basis; the result reports the best possible RMS when choosing one basis per region. A consumer must not interpret this flag as merely flipping UVs.

Coverage measurements use the shader's cutoff remap followed by its time-resolved dither function. The three-layer k-buffer does not turn card overlap into independent coverage events; this atlas measures a single flat card. Mips stay within aligned padded cells, scalar attributes use alpha weighting, and Flow filters in decoded linear space. Compensation measures four bilinear subtexel positions per texel, applies the shader's cutoff/dither remap **after** filtering and solves an alpha scale against base-level filtered coverage. Quantisation and clipping happen before filtering. Every mip records target, raw filtered coverage, corrected coverage and scale; saturation is explicit when no scale can reach the target. Texel-centre coverage, alpha mean and visible-weighted ID/gradient/specular-shift histograms are separate measurements.

Independent mips stop before cells lose their one-texel gutters or alignment; smaller levels cannot keep unrelated regions separate. The default atlas provides levels 0–3. A consumer must clamp sampling to `maxSafeMip`, repack for a wider distance range or provide a separately designed far representation. These buffers are not a ready-to-export full game mip chain. The bilinear quadrature is an offline estimate of spatially integrated coverage, not TAA/DLSS or anisotropic filtering proof.

For the later renderer, UVs are image coordinates with root at the smaller V and `flipY=false`. Use the returned **content** UV rectangle, not the cell. Alpha/ID/gradient read red in the game; a Three.js adapter using `alphaMap` must account for that API's green-channel read, for example by expanding scalar bytes to RGB. Upload the supplied mips rather than asking a renderer to average alpha without compensation. Generation remains worker work; none of this module is imported by an ordinary flag-off page.

`defaultHairAtlas(size)` supplies an editable description; `generateHairAtlas(description, signal)` produces the complete result synchronously in a worker/offline process. `hairAtlasSteps(description, signal)` exposes the same work as a resumable generator; its final return value is the atlas. `sampleAtlasFibres` and `rasterAtlasFibres` expose the shared sample/bake boundary for independent fixtures. Callers may supply several descriptions or workers; there is no singleton or hidden cache. Output map dimensions belong to each mip, and `regions` contains content/cell rectangles, UVs, card type, variation, fibre count, measured density, basis metadata and every mip's coverage record.

## Validation plan

Model-derived tests precede implementation: byte determinism; seed variation and stable region identity; channel agreement at crossings; fibre-distance gradient on a curved, shortened fibre; tip taper; gamma Flow roundtrip and signed-direction limitation; region isolation; per-mip coverage at several densities; malformed and excessive inputs; abort before/during generation. Offline probes compare region coverage and covered-pixel ID/gradient histograms with a vanilla long-hair atlas resolved through the generic base-only installation route. A flat CPU card uses the same profile, material, normal, camera and lights with the Studio's pure hair model for both map sets. Aggregate similarity is a sanity check, not image equivalence or rendering proof.

Target: 2048 squared, four maps in a few seconds in a worker, with timing separated from PNG encoding and vanilla resource reading. Tests and real-data probes run under a 1 GB memory guard. Generated images remain ignored in `authoring/build/hair-lab-wip/`; no vanilla pixels are committed.

## Results and remaining gates

The kernel, model-derived tests and three offline tools are implemented. The track changes no authored recipes, resource names, export eligibility, package building or promotion, so the Studio-to-mod pipeline remains unchanged. Preview integration, compression and game mips, multi-card k-buffer behaviour and in-game appearance need later validation. No browser, game, mod manager or existing draft was operated.

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

The following are offline single-card measurements at AlphaCutoff 0. Distribution errors are total variation on 16 visibility-weighted bins (0 identical, 1 disjoint); means are linear map values. The pure colour-model probe also records the ID-derived specular-shift histogram. Original fibre pixels are not copied or fitted; the default parameters were tuned against aggregate region statistics and inspected silhouettes.

| Region | Vanilla coverage | Generated coverage | ID mean error | Gradient mean error | ID / gradient histogram error |
|---|---:|---:|---:|---:|---:|
| Dense A | .568 | .568 | +.003 | −.016 | .082 / .085 |
| Dense B | .495 | .498 | +.003 | −.000 | .103 / .118 |
| Clump A | .304 | .308 | +.003 | −.014 | .092 / .085 |
| Clump B | .242 | .241 | +.019 | −.013 | .179 / .102 |
| Wisp A | .187 | .185 | −.004 | −.013 | .159 / .141 |
| Wisp B | .186 | .183 | +.031 | +.008 | .211 / .126 |
| Wisp C | .185 | .187 | +.008 | +.008 | .310 / .100 |
| Wisp D | .151 | .153 | −.047 | +.006 | .295 / .161 |
| Flyaway singles | .058 | .060 | +.054 | +.019 | .785 / .392 |
| Short wisp A | .111 | .110 | +.017 | +.007 | .144 / .231 |
| Short wisp B | .140 | .136 | +.017 | +.006 | .119 / .213 |
| Short clump | .282 | .257 | −.001 | −.007 | .098 / .073 |
| Short dense | .484 | .493 | −.001 | +.002 | .114 / .122 |
| Short flyaway set | .089 | .094 | −.005 | +.009 | .180 / .085 |

Coverage is within .026 in every cell; gradient means are within .020. Dense/clump distributions are close, while the four-fibre flyaway region **does not pass a close-distribution claim**. Four constant IDs cannot fill a 16-bin histogram like a lower-resolution filtered map; that explains part of the difference, not all of it. Wisp ID histograms also remain looser than the dense strips. These residuals are recorded rather than remapping gradient away from intrinsic distance or adding unrelated pixel noise to ID. A stricter all-region histogram match remains an R&D gate.

All default safe mips preserve the measured bilinear coverage within .000081 absolute. Tests also cover cutoffs 0 and .33 and dense/sparse populations, with .001 tolerance, plus an independent checkerboard calculation that distinguishes filtering before cutoff from averaging already resolved coverage. This does not validate compressed `.xbm` mips or the game's temporal pipeline.

### Flat-card colour sanity check

[CPU probe](../../projects/xf-studio/authoring/tools/hair-atlas-peek.ts): both atlas sets use the resolved vanilla brown profile through `src/hair-colour-model.ts`, identical local light `(0.25, 0.18, 0.9513674)`, view/normal `(0,0,1)`, environment irradiance .25, no vertex shadow and the decoded vanilla light defaults. The flat atlas is sampled into a 512² diagnostic view. PNGs use display exposure 4; measurements remain linear before that exposure.

Visible-weighted mean lit RGB is generated `(0.019705, 0.017079, 0.014384)` versus vanilla `(0.020459, 0.017785, 0.014947)`, about 3.7–4.0% lower. Sampled view coverage is .28576 versus .28985. This supports comparable aggregate colour response under one declared light, not image equivalence, perceptual approval or game proof. The probe exercises albedo, ID roughness, Flow direction, per-strand highlight shift, local light and environment together.

### Flow basis experiment

Default shallow-wave population: arc-length-weighted angular RMS 3.96°, maximum 27.04°, with 49.78% of sampled length outside the positive coefficient cone. Choosing the better of two tangent bases independently for each region lowers RMS to 3.81°. Thus most of the benefit comes from keeping texture deviations small; a single mirrored choice adds little for balanced waves. These errors weight source polyline length, not visible raster area.

A separate consistently negative diagonal fixture improves from about 17.3° to less than 0.6° when baked for the flipped tangent basis. Reflecting both its image coordinates and decoded direction leaves the original angular error unchanged. Tests check both statements. No geometry or game shader was changed.

### Time, memory and reproducibility

[Worker benchmark](../../projects/xf-studio/authoring/tools/hair-atlas-bench.ts), Bun 1.4.2, three sequential jobs on one offline worker: approximately .83–1.05 s generation, median .97 s; request through transferable-buffer delivery .83–1.05 s. Map-buffer payload is **33,423,360 bytes (31.875 MiB)** for four maps and levels 0–3. The three output hashes match: `8227a102ec45e3b25f2eb18dd54331e3a5c804c132d4293c4ff4ef2870292cd8`. Peak guarded process memory was .6 GB under the 1 GB limit. The slowest resumable batch was about 56 ms cold, 41 ms on the next job and 28 ms warm: this is a worker kernel, not a page-thread call or a demonstrated 50 ms end-to-end interaction.

Four base PNGs total about 1.70 MiB at zlib level 3; encoding takes about .14 s separately. The CPU shade/reference reconstruction takes about 2.3 s separately. No GPU upload or browser startup is included. The adapter must publish matching request identity, yield to service abort messages or terminate its own worker, honour mip/basis metadata and preserve the experiment flag boundary.

Validation: 111 targeted tests pass across atlas, colour model, cards, model catalogue, lifecycle and architecture boundary suites under the 1 GB guard; targeted TypeScript checking passes. The full authoring suite was not run within this track's 1 GB allocation. Repository link/privacy checks and explicit link/privacy/whitespace scans of the six new text files pass. Peeks and JSON reports live under `authoring/build/hair-lab-wip/` with the `atlas-` prefix; no generated or extracted images are tracked.

Visual inspection of the four final maps confirms the long dense-to-sparse row, short variants, tapered ends and shared attribute paths. Transparent attributes are deliberately extended throughout each cell, explaining the large flat ID/gradient areas away from fibres. The generated short clump is visibly more split and compact than the reference; aggregate coverage/colour similarity does not establish the same silhouette. The two flat shaded views remain visibly different in strand placement, as expected for independent synthesis.
