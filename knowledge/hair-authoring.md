# Procedural hair authoring

Maturity: **Draft**. This page separates source-supported artist practices from offline Hair Lab measurements. Generated cards and diagnostic clump cores now run on V in the Studio; fidelity remains rough and no generated groom has in-game proof. Related engine facts live in [hair shading](hair-shading.md) and [hair physics](hair-physics.md); implementation and budgets live in [Hair Lab design](../research/hair/hair-lab-design.md).

## Coverage and layers

**[wiki]** eagul's beginner Hair Tool tutorial, edited by mana vortex, builds a dense base with progressively more transparent outer layers. Its rationale is scalp coverage underneath and broken-up sheet edges above. It also reattaches pushed-out layer roots and introduces asymmetric tilt/noise after mirroring. These are modelling practices, not measured renderer limits. Source: Modding Docs commit `a54b08735a560bca7dd76b1e1dab1631e6aaae89`, `for-mod-creators-theory/3d-modelling/hair-modeling-beginner-tutorial/README.md`, Steps 1.1–1.8 ([public guide](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/3d-modelling/hair-modeling-beginner-tutorial)).

**[wiki, visually inspected]** The same clone's `.gitbook/assets/image (429).png` contains distinct dense, medium and very sparse atlas strips. `image (479).png` shows a layered bob in the editor, including overlapping crown and face-framing cards. Neither image proves runtime shading or a universal card-count budget.

**[source]** [GS CurveTools' curve attributes](https://gs-curvetools.readthedocs.io/en/latest/attributes.html), documentation labelled v2.0.0 and read 16 October 2026, separate orientation about a curve, twist along it, width/taper and curvature-based subdivision. This supports treating those as independent decisions rather than deriving all geometry from one width parameter; detailed image study remains open.

## Mechanics and identity

**[resource, offline preview]** The resolved `hh_long01` atlas has separate horizontal banks for long strips and short tufts. Treating each column as a full-height strip mixes the banks and causes rectangular smears toward generated tips. Detect the banks before strip bounds, align alpha taper with card tips, and determine root direction from each region of `Strand_Gradient`. The generated preview uses the existing hair adapter and V's colour profile; this does not establish game export.

**[offline preview]** Clump-centre averaging must respect collision routing. Gathering fibres that pass on opposite sides of a shoulder can put a derived card inside the body; contact projection then stretches it into a large triangular sheet. Limit the gathering displacement against contact before generating ribbon geometry. Card edges require their own check even when every solved path passes.

**[offline preview, tests]** A worker-local groom-depth field can serve both clump diagnostics and card self-shadow. The current approximation indexes swept covariance ellipsoids, counts depth in each clump once and adds head/body proximity. Exposed and buried samples, overlap, determinism and bounds have asset-free tests. Baking about 60,000 card vertices costs approximately 103 ms in the measured full-character preview. The generated card material enables the existing red-channel self-shadow at strength 0.65 without changing V's profile. This improves depth readability; it does not hide inadequate coverage, broad flat cards or poor root-to-tip flow. Those remain visible in the five-style blind comparison.

**[source]** [Macklin, Müller and Chentanez's XPBD paper](https://matthias-research.github.io/pages/publications/XPBD.pdf) describes compliant positional constraints with accumulated multipliers and time-step-scaled compliance. It provides a numerical foundation, not a complete hair model, scalp detector or contact solution.

**[offline tests]** The implemented logical root population preserves sampled identities across preview budgets. Graph validation checks partitions, overlapping convergence and termination accounting. Child-to-parent field transport preserves intrinsic distance and phase. These are model-derived software tests, not game rendering evidence.

**[hypothesis]** A coarse field sweep can provide immediate editing feedback while a worker refines compliant attachment, length, bending and contact constraints. Its usefulness depends on measured full interaction latency and on results from front, side and rear, rather than solver timing alone.

## Scalp and contact findings

**[resource, offline preview]** The inspected vanilla caps for female choices 01, 24 and 28 use the same 746-vertex surface with different masks. Projecting the mask through cap UVs seeds a head-topology density map. Geometry alone misses hairline softness and fine strokes. Crown-connected UV islands alone are also insufficient: their temple seam produced a rectangular coverage notch. The scalp chart remains head-bound when the selected hairstyle changes. Exact resources and inspected images are recorded in the [design study](../research/hair/hair-lab-design.md#scalp-and-contact).

**[offline test]** A signed distance derived from the nearest triangle's normal can misclassify a point beyond an acute closed edge. An asset-free capped-dome regression reproduces that failure. The current collision candidate uses oriented scanline occupancy and a Euclidean distance transform, closing narrow voxel gaps. Fine head and coarser body grids sample the same union solid so the neck join has no internal collision lid. This is a grid approximation, not an exact geometric or engine collider.

**[source]** [Felzenszwalb and Huttenlocher (2012)](https://cs.brown.edu/people/pfelzens/papers/dt-final.pdf), Sections 2.1–2.2, derive a separable squared Euclidean distance transform from lower envelopes of parabolas. An independent implementation and exhaustive anisotropic-grid oracle support the collision prototype. Source code from the authors' download is not used.

**[offline tests]** Scalar styling edits now take previous matching solved paths as explicit continuation input. This preserves a route around a shoulder or ear instead of selecting a fresh route on every edit. Cold reset determinism is tested separately. A cut retains its terminated intrinsic length and tip-plane constraint during warm edits; very short terminal samples are merged before solving.

## Open questions

- How reliably can a scalp boundary be derived from arbitrary resolved cap/head geometry without style-specific rules?
- Can the initial sample/constraint budget maintain length and contact while meeting a 500 ms warm action-to-frame target?
- Which installed atlas regions provide the best coverage at each layer, and where does filtered alpha make a geometric length differ from visible length?
- How much geometry and frame variation is required to avoid edge-on gaps while keeping overdraw low?
