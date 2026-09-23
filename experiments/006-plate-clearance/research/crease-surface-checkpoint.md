# Crease fan: a shallow morph correction passes the numeric gates

24 September 2026. **Research only.** No Blender master, mesh/morph resource,
archive or installed game file was changed. The candidate below is an ignored
numeric array, not an accepted plate replacement. Its resource round-trip,
exact native skin bytes in both buffers, full 105-morph preservation, visual
shading and continuous-time animation still need verification.

The coupled candidate previously left six new non-adjacent plate/head triangle
contacts at sampled idle frames 120 and 170. Five affected plate faces share
crease vertex 119. The full fan has eight faces, with UV boundary vertices
`118, 120, 321, 322, 525, 130, 128, 121` and signed UV area
`1.043081283569336e-5`. The residual area is tiny in texture space, but a
topology change can still substantially alter its 3D shape.

## Topology alternative tested

The [reproducible probe](crease_surface_probe.py) enumerated 42 UV-valid
triangulations of that boundary after removing the central vertex. It kept
all boundary UVs and their inherited head/skin/morph vertex correspondence.
Thirteen triangulations had zero **new non-adjacent** contacts across all 107
static shapes and 73 sampled poses in the generalized finite-triangle check.
They were not acceptable geometry: sampling the old center and each spoke
midpoint at the same UVs found at least `0.0007860576` asset units of maximum
surface-position change across those cases. This is over three times the current
`0.00025` vertex-displacement ceiling, even before checking shading and
intermediate UV points. The no-center retessellation would bridge across the
eyelid fold and discard inherited local shape. The [candidate table](crease_surface_probe_summary.json)
retains all triangulations and their contact/deviation results; none was
converted into a resource.

## Smaller correction found

The prior one-vertex trial required vertex 119 to be wholly on one side of two
head planes with extra clearance. That was a **sufficient**, not necessary,
condition for finite triangles to separate. It pushed `h091_eyes` by roughly
`(-1.50e-5, -3.89e-5, -0.42e-5)` and traded the original six contacts for
eight at frames 25/169.

Instead, the [split-center feasibility scan](crease_split_center_summary.json)
tested 20,126 deterministic small `h091_eyes` deltas, including the segment
from zero to the previous trial and reproducible seeded perturbations.
12,833 met the per-shape displacement and incident-edge limits for
`h091_eyes` and saved V. Each fan face independently has a legal vector that
avoids the four head triangles implicated at frames 25, 120, 169 and 170.
More usefully, 1,871 tested legal vectors cleared **all eight faces together**
at those four sampled frames, so a split vertex or seam is unnecessary for
that local conflict.

The selected *interior* vector maximizes the minimum tested local shape slack
among those 1,871 sampled vectors:

```text
target: h091_eyes morph, plate vertex 119, existing topology/UV/weights
delta: (-0.0000190805108919832, -0.0000124713219949611,
        -0.00000481252201385206) asset units
minimum sampled local displacement/neighbor slack: 0.0000164873718504898
numeric NPZ SHA-256: 3600f54e9a53e3b95dc456ae8cfccbf0611d8f762146ebb5f13e7f5b25fffb34
local ignored path: experiments/006-plate-clearance/generated/morph-aware/crease-interior-center.npz
```

The existing **independent** [107/73 verifier](coupled_morph_verify.py), not
the search probe, reports for that exact SHA: zero new non-adjacent static
contacts, zero new non-adjacent posed contacts, zero static displacement
violations and zero static neighbor violations. Its maximum static
displacement remains `0.0001080851`; its maximum neighbor difference remains
at the original `0.00005` limit elsewhere. The [full case report](crease_interior_verify_summary.json)
records every tested shape and pose. Rounding this delta to `0.1` microunit
and perturbing each axis independently by `±1` microunit also passes all four
numeric gates in [seven separate full runs](crease_numeric_robustness_summary.json).
This is evidence of local numeric tolerance, not a guarantee about resource
packing or unsampled animation phases. Several simpler pure-Y alternatives
removed contacts but **violated neighbor limits** and must not be used.

## Remaining release gate

Regenerate the ignored candidate from the deterministic probe or copy it
from the isolated worktree; verify its SHA before use. Convert a separate
resource candidate while retaining original topology, UVs, all 105 morphs
and native skin bytes in both the mesh and morph embedded base buffer. Then
independently rerun the static/posed tests on round-tripped resources, inspect
the crease under animated eyelid closure and fine makeup at close range, and
check unsampled phases before touching the owned master. The numeric result
does not prove game rendering or supply a reason for a game launch yet.

Reproduction after the ignored build and numeric inputs from the preceding
reports are present:

```powershell
python experiments/006-plate-clearance/research/crease_surface_probe.py
python experiments/006-plate-clearance/research/coupled_morph_verify.py `
  --candidate experiments/006-plate-clearance/generated/morph-aware/crease-interior-center.npz `
  --sha256 3600f54e9a53e3b95dc456ae8cfccbf0611d8f762146ebb5f13e7f5b25fffb34 `
  --output experiments/006-plate-clearance/research/crease_interior_verify_summary.json
python experiments/006-plate-clearance/research/crease_numeric_robustness.py
```

This probe used only project tools and the already credited local source
extractions; no additional community code or asset informed it.
