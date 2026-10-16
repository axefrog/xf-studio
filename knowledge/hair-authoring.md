# Procedural hair authoring

Maturity: **Draft**. This page separates source-supported artist practices from the proposed Hair Lab computation. No generated groom has been built or observed in game. Related engine facts live in [hair shading](hair-shading.md) and [hair physics](hair-physics.md); implementation intent and budgets live in [Hair Lab design](../research/hair/hair-lab-design.md).

## Coverage and layers

**[wiki]** eagul's beginner Hair Tool tutorial, edited by mana vortex, builds a dense base with progressively more transparent outer layers. Its rationale is scalp coverage underneath and broken-up sheet edges above. It also reattaches pushed-out layer roots and introduces asymmetric tilt/noise after mirroring. These are modelling practices, not measured renderer limits. Source: Modding Docs commit `a54b08735a560bca7dd76b1e1dab1631e6aaae89`, `for-mod-creators-theory/3d-modelling/hair-modeling-beginner-tutorial/README.md`, Steps 1.1–1.8 ([public guide](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/3d-modelling/hair-modeling-beginner-tutorial)).

**[wiki, visually inspected]** The same clone's `.gitbook/assets/image (429).png` contains distinct dense, medium and very sparse atlas strips. `image (479).png` shows a layered bob in the editor, including overlapping crown and face-framing cards. Neither image proves runtime shading or a universal card-count budget.

**[source]** [GS CurveTools' curve attributes](https://gs-curvetools.readthedocs.io/en/latest/attributes.html), documentation labelled v2.0.0 and read 16 October 2026, separate orientation about a curve, twist along it, width/taper and curvature-based subdivision. This supports treating those as independent decisions rather than deriving all geometry from one width parameter; detailed image study remains open.

## Mechanics and identity

**[source]** [Macklin, Müller and Chentanez's XPBD paper](https://matthias-research.github.io/pages/publications/XPBD.pdf) describes compliant positional constraints with accumulated multipliers and time-step-scaled compliance. It provides a numerical foundation, not a complete hair model, scalp detector or contact solution.

**[hypothesis]** A stable logical root population can be evaluated at a smaller sample budget without changing membership. Branches must partition identities; convergence must reject overlapping inputs; termination must account for ended fibres. Child-to-parent chart transport must retain intrinsic root distance and phase. Hair Lab proposes pure validators and model-derived tests for these properties; they are not yet implementation evidence.

**[hypothesis]** A coarse field sweep can provide immediate editing feedback while a worker refines compliant attachment, length, bending and contact constraints. Its usefulness depends on measured full interaction latency and on results from front, side and rear, rather than solver timing alone.

## Open questions

- How reliably can a scalp boundary be derived from arbitrary resolved cap/head geometry without style-specific rules?
- Can the initial sample/constraint budget maintain length and contact while meeting a 500 ms warm action-to-frame target?
- Which installed atlas regions provide the best coverage at each layer, and where does filtered alpha make a geometric length differ from visible length?
- How much geometry and frame variation is required to avoid edge-on gaps while keeping overdraw low?
