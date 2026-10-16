# Hair Lab prototype

Status: **model proposed for coordinator review; implementation has not started**. Hair Lab is an optional experiment, outside the first public release's requirements. The approved target is an interactive, loosely wavy, mid-back groom on the user's own V. The authored representation is a strand-budget volume graph. Curves are derived evaluation samples, never authored guides.

The [model catalogue](../../projects/xf-studio/models/README.md) contains the proposed types, actions, request, driver, process, operators, runtime, source, panel and end-to-end flow. Every new model is `target`; none claims working implementation. The [architecture contract](../authoring/architecture-contract.md), [feature platform](../authoring/feature-module-platform.md) and [input bindings](../authoring/input-bindings.md) apply.

## M1 review boundary

Approve the model before implementation. This checkpoint changes no product code. The next checkpoint implements the flag, module, pure evaluator, worker and diagnostic rendering together. M1 must show the generated groom on V, restore resolved hair when disabled and pass the scenarios below; a model or a solver alone does not complete M1.

| Concern | Proposed M1 contract |
|---|---|
| Experiment preferences | Platform-owned, library-persisted settings node, associated with the existing preferences node; generic experiment-ID to boolean map, absent means off. Present Hair Lab under Experimental features in Settings using existing components. No feature imports or registration while disabled. |
| Verification override | `?verify=1&experiment.hair-lab=1` enables it only in the isolated verification workspace; `0` forces off. Overrides are session inputs, never persisted. Unknown experiments are ignored. |
| Activation | Enabling makes the module available. Its panel's Hair Lab toggle activates replacement for its bound scene and groom. Closing/hiding the module withdraws demand. Enabling alone does not hide normal hair. |
| Ownership | `features/hair-lab/` owns domain, view and render adapters; platform composition owns conditional loading and generic settings. No feature rules in startup or UI. |
| Storage | A separate `xfs/hair-groom-part-1` document envelope backed by authored graph entries, referenced by the lab session. It never enters the character, save or existing makeup draft. Geometry is derived and discardable. |
| History | Edits target the groom node and use the platform look history over that document alone. Activation and preferences have no Undo. M1 controls: Length, Waves, Volume. |
| Character replacement | Use the existing scene port's `supersede([{slot: "hair"}])` only after a complete matching diagnostic result is attached. Deactivation, loss of demand, failure or abort withdraws replacement. Never edit the selected hairstyle key. |
| Scene geometry | Add the smallest generic, read-only geometry observation needed for attachment/contact: character and topology revisions, head/cap/ear/body surface references and head-space transforms. Three objects stay in scene adapters. |
| Work | One generation request per scene/groom/surface revision. Coarse output first; refinement in a worker. Abort old requests on edits, V changes, flag changes or panel withdrawal. Reject late results by full request identity. |
| Feedback | In-place progress: Shaping hair, Settling hair, Ready. Failure restores resolved hair and offers Try again. Incomplete geometry is never presented as Ready. |
| M1 display | Explicit diagnostic ribbons/strands, not a claim to finished card hair. The same evaluated trajectories will feed M2's exportable cards. |

The generic platform loader has its own request, driver, process and registration runtime; it does not require loading Hair Lab to discover the opt-in preference. Disabling withdraws contributions and aborts all work immediately. Previously imported JavaScript may remain in the browser's module cache until reload; a page started with the flag off never imports it. Collapsing a panel does not deactivate the lab; hiding its module or explicitly turning Hair Lab off does, because this is an independent preview session rather than content in the ordinary look.

Integration work required: the current action registry, renderer factory list and module composition are static; none already provides live optional registration. Extend those generic boundaries to accept contribution snapshots from the experiment driver, validate the complete proposed registry before publication and withdraw adapters under the old registration token. A failed load must leave ordinary contributions intact. The current scene port also lacks plain cap/body contact geometry, so the proposed character-geometry source is a platform addition, not permission for a feature to read scene internals. These are M1 work, not capabilities claimed by this model checkpoint.

## Authored data and identity

The groom stores a root-population seed and budget, a surface binding, volume graph, field expressions, fibre properties and solver configuration. A root ID is derived from the population seed and its population index, independently of preview density. Each evaluated root also has its scalp triangle and barycentric attachment. Morphing moves attachments without changing identity. A changed topology invalidates the binding and requires explicit rebinding; it must never silently move roots to unrelated triangles.

The initial graph is root population → one volume → natural termination. Its logical population defaults to 60,000 fibres; M1 solves a deterministic nested subset, initially 256 samples. These numbers are prototype budgets, not counts measured from the reference character. Length defaults to 0.55 m of intrinsic fibre length; visible extent depends on roots, waves and drape. Tune silhouette against the supplied references before calling it mid-back.

A volume carries an incoming membership and material coordinates, with length, wave and spread fields. Branches partition incoming identities with a deterministic selection map. Convergence accepts only disjoint identities, unions them and retains individual roots, consumed length and phase. Termination records ended identities; it never reallocates their budget. The validator rejects cycles, duplicate IDs, overlapping convergence, missing outlets, invalid units, negative/non-finite lengths and references to absent nodes. Branch/convergence conservation is tested in M1 even though interactive sectioning belongs to M3. Ties, braids and twist operators remain later structural work.

## Fields and coordinates

Fields are expression data, evaluated only at requested sample points. Each declares a value unit (`m`, `rad`, `ratio` or a named physical compliance unit) and a chart. Sample coordinates include stable follicle ID, root UV, child cross-section coordinates, intrinsic distance from root and distance from volume entrance. Cross-section plus distance is a three-dimensional material chart, not an ordinary scalp bitmap.

Transport first maps a child's sample back through its identity mapping into the parent's chart; then it evaluates the parent expression and combines local layers in order. It must not substitute the child's raw UV for the parent's UV. Distance from the root and wave phase survive every branch and convergence. Transport and evaluation are pure, with no raster allocation.

Supported expression intent: constant, ramp, deterministic identity variation, smoothstep threshold, multiply, override, masked blend, soft minimum and soft maximum. Multiply requires a dimensionless multiplier; min/max/blend require matching units. Soft extrema use a smoothness in the same units as their operands. Masks are clamped to [0,1]. Zero-width thresholds and singular transforms are validation failures. Display/painting may materialise a field later, but images are not authoritative in M1.

## Scalp and contact

Prefer V's resolved cap surface as a hairline/coverage boundary and project it onto the actual head surface; never seed roots on the cap's card vertices or extend them across the face. If no usable cap exists, derive a conservative anatomical scalp patch from the head geometry and head frame, exclude front face/ears/neck, and label that boundary as estimated. Record which method was used. No saved hairstyle-specific intake or geometry table is permitted.

Area-weighted deterministic sampling produces barycentric roots inside eligible triangles. The population surface binding fixes candidate ordering and topology so preview sample counts cannot change roots. Root emergence uses the local scalp tangent and part field; it is not simply a permanently outward skin normal. An inferred central part is the initial default, with user-made major sections added in M3.

Contact uses the actual head and ear surfaces in head coordinates, with shoulder/neck capsules fitted from the available body geometry. A missing body gives head-only contact with an explicit limitation in the panel's status. Capsules must not be described as clothing collision. Surface acceleration structures are derived once per geometry revision in the worker. Contact checks cover particles and intervening segments; endpoint-only tests can let a long segment pass through the head. M1 records minimum clearance, maximum segment error and remaining penetration rather than declaring convergence from iteration count.

## Coarse sweep and drape

The immediate sweep integrates the volume's preferred flow and rest curvature, sampling Length, Waves and Volume. It is a geometric stand-in, not physical drape. It produces a limited preview while a worker refines the same identities.

Refinement follows the compliant-constraint update in [XPBD by Macklin, Müller and Chentanez](https://matthias-research.github.io/pages/publications/XPBD.pdf). Use fixed deterministic steps and constraint ordering, root attachments, length constraints, bending relative to rest curvature, head/ear/shoulder contact and limited bundle separation. Compliance is scaled by the squared time step and constraint multipliers are accumulated within the step. Pin weights and inverse mass must participate in constraint gradients. Record residuals after contact; do not silently lengthen strands to remove penetration.

The derived samples represent a volume at several root/cross-section positions. They are not one centreline with a radius. Initial solve budget: 256 paths × 24 intervals, 12 fixed steps × 8 constraint iterations. Solver limits are data, so a smaller verification fixture exercises identical rules. This is a static styling solve; it does not implement the game's Dyng motion. Rest-shape edits persist; future Clip adds a hold, while temporary pushes remain session-only. Automatic fine splits retain deterministic lineage and stay fixed throughout a gesture; M1 has no automatic topology changes during editing.

## Artist rules and procedural decisions

Sources describe artists' workflows; the computation column is our proposed translation, not a claim those sources implement this model. The beginner tutorial was reread from the local Modding Docs clone at `a54b08735a560bca7dd76b1e1dab1631e6aaae89`, guide `for-mod-creators-theory/3d-modelling/hair-modeling-beginner-tutorial/README.md`, by eagul, edited by mana vortex. Its illustrations below are editor examples, not runtime proof.

| Artist rule and inspected evidence | Our computation | Stage |
|---|---|---|
| Attach roots to the scalp; keep major control shapes simple. [eagul, Steps 1–1.3](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/3d-modelling/hair-modeling-beginner-tutorial) | Derive scalp support from head/cap geometry; store fields and section membership, derive numerical samples. Do not adopt the tutorial's grid/extrusion machinery. | M1 |
| Dense lower layers hide scalp; progressively lighter outer layers disguise hard sheet edges. Tutorial image `.gitbook/assets/image (429).png` visually shows separate dense, medium and sparse atlas strips; `image (479).png` shows overlapping bob cards. | Partition a card allocation into coverage, volume and silhouette layers; choose atlas regions by measured alpha density, with independent geometric coverage checks. | M2, not implemented |
| Align tilt to the source surface; vary outer tilt to avoid thin front views. Tutorial Steps 1.1 and 1.4; [GS CurveTools attributes](https://gs-curvetools.readthedocs.io/en/latest/attributes.html) distinguish orientation, twist, width and curvature subdivision. | Transport a root frame along each evaluated path; separate field-driven twist from continuity correction; bound deterministic variation by layer. | M2, pending orientation-image review |
| Push later layers above the first while reattaching roots; vary spacing and lengths. Tutorial Steps 1.6–1.8. | Root-preserving offsets with along-length ramps; stable membership-based spacing and tip variation, followed by contact/coverage checks. | M2, pending detailed geometry study |
| Check shaded hair during modelling and fix clipping or thin areas. Tutorial Step 1.5. | Inspect front, side, rear and three-quarter captures on V using the actual hair adapter and supplied reference silhouettes. | M2 quality gate |

Card width, subdivision, overlap optimisation, atlas-box boundaries, flyaway placement, cap filling and chain placement are **not designed yet**. Before each implementation, extend this table with the relevant hand-authoring process and inspect its images. M2 references installed vanilla long-hair resources through the generic resolver and existing `hair.mt` adapter; V's `.hp` stays authoritative. Never commit extracted textures. Root-to-tip attributes use intrinsic fibre distance, never world height.

## Verification and budgets

All budgets are proposals until measured. End-to-end timing starts at action dispatch and ends at the first frame showing the matching result, with geometry preparation, queue time, generation, upload and shader readiness reported separately. A fast solver alone is not a fast interaction.

| Boundary | Initial budget |
|---|---|
| Flag off | Zero Hair Lab imports, workers, geometry extraction or extra asset requests; no module/menu/panel registrations |
| Action feedback | Selection/value/progress updated in the same cycle |
| Coarse first frame | At most 50 ms for already prepared surfaces; coarse generation at most 8 ms on page thread |
| Refined first frame | Target at most 500 ms warm; report misses with the largest measured stage |
| Page responsiveness | No Hair Lab page task over 50 ms; worker jobs abort/yield at bounded iteration batches |
| Working memory | At most 128 MiB incremental CPU buffers and 16 MiB diagnostic GPU buffers initially; full suites under a 6 GB guard |

Model-derived scenarios, to be written before product implementation after review:

1. Start with default preferences and visit every shell menu: no lab imports/requests or contributions. Enable the flag, activate, edit, deactivate, reload; normal hair and original character/save/draft bytes are preserved throughout.
2. Verification override on/off never changes ordinary preferences. Unknown flags and malformed overrides cannot activate modules. Toggle off during dynamic import, geometry preparation, solve and GPU attachment; no stale activation is possible.
3. One seeded population evaluated at two preview budgets has nested identical IDs and attachment coordinates. Branch then disjoint convergence preserves identity and intrinsic distances; duplicate/overlapping membership is refused; termination accounts for every ended fibre.
4. A non-identity child chart yields the same inherited values as direct parent evaluation. Check composition order, unit mismatch, mask bounds, soft boundaries, phase continuity and invalid transforms.
5. Same inputs produce identical coarse/solved arrays. Root error stays within 1 micrometre; final segment length error target is under 2%; contact clearance target is at least 0.5 mm with penetration reported. Check long segments crossing a head, contact plus attachment, degenerate geometry and extreme allowed values.
6. Change V or groom while a result is outstanding. Only the matching revision can attach; old work is aborted, buffers are released, and restored normal hair is never hidden by a stale result. Repeat with two lab scenes to exclude implicit singleton state.
7. Worker crash, missing geometry and invalid scalp produce a plain message plus Try again; normal hair remains. A second editing action pre-empts the first solve. Undo/Redo restores document entries and reproducible output without rewriting historical entries.
8. Capture every added UI state in light/dark at narrow/wide widths and the groom from four views in an isolated workspace. Compare supplied photos read-only; do not put those photos or paths in public evidence.

## Evidence and remaining gates

Observed offline: the scene API already exposes per-feature hair supersession and read-only head anchors. The existing module layout separates core, view and render contributions. The local artist tutorial's atlas and layered-bob illustrations were visually inspected at this checkpoint. Solver, root coverage, actual V attachment, timing, cards and interactive behaviour are unimplemented hypotheses. No game was run, no package was built and no assets were copied.

The first implementation gate is coordinator model review. Subsequent gates are model-derived tests, diagnostic M1 on V, M2 shaded-card quality, then M3 styling. Export is a build-only stretch goal and never implies installation or runtime proof. Do not use primitive-correspondence slice meshes or face-extrusion strand generation.

Checkpoint verification, 16 October 2026: the catalogue's 17 validation tests pass, including schemas, model references and its generated index. The existing authoring suite passes 3,023 tests with 135 skipped and zero failures across 397 files, in 353.38 s, under a 6 GB memory guard (2.7 GB peak). Optional browser probes were disabled after the initial run timed out launching headless Chrome; installation/NumPy oracles were unavailable. An initial unrelated timing assertion passed in a focused 40-test rerun. Tracked-document link/privacy checks and separate checks of all 26 new text files pass. These results validate model syntax and the unchanged product baseline; they do not test a Hair Lab implementation.
