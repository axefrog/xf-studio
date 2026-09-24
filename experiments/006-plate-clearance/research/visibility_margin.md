# Exposure-aware fixed correction: smaller margins still fail at four crease vertices

23 September 2026. The proposed two-tier diagnostic is complete. It does **not** produce an acceptable replacement plate: four vertices still have independently verified failure certificates at every tested positive margin, including 0.000025 with the unchanged total displacement bound of 0.00025. No geometry, master, imported resource or historical experiment output was modified.

This follows [the failure classification](fixed-failure-classification.md) and retains build `generated/build-1790134714546030800`, all native skin weights, the reference save's five captured customization morphs and all 73 preserved idle poses. It changes only the diagnostic right-hand sides of the incident-plane constraints: exposed or ambiguous face/poses require the specified positive clearance; sampled-hidden face/poses require nonnegative clearance. It never deletes faces or ignores their constraints completely.

## Denser visibility evidence

The Blender head-only BVH is rebuilt and recentered for each pose. Sampling covers the original five camera directions plus a 45-camera yaw/pitch grid (yaw −60° to +60° in 15° steps; pitch −30° to +30° in 15° steps), at the same distance of 0.35 from the fixed reference centre. This is 50 camera entries, with overlapping directions retained deliberately as old controls. Every face receives 25 strictly interior barycentric samples: the original four plus an eighth-step interior lattice. Frame 490 and every other earlier certificate pose remain included.

A sample is exposed when winding faces the camera and first-hit depth differs from the target depth by at most 1e-7 units. No hit, anomalous negative gaps, grazing samples at the surface, depth differences within 2e-6, or near-degenerate triangles are conservatively ambiguous. Any exposed or ambiguous sample gives that entire face/pose a positive-margin constraint. This is a sampled, conservative diagnostic classification, not proof of visibility from every possible camera or proof that the remaining faces are permanently invisible.

| Classification of 40 × 73 face/poses | Count |
|---|---:|
| Exposed | 2,901 |
| Ambiguous without a confirmed exposed sample | 0 |
| Sampled-hidden | 19 |
| Previously sampled-hidden, now exposed | 10 |

The ten newly exposed cases retain reproducible witness camera/sample indices, hit face IDs and depth gaps in [the metadata summary](visibility_margin_summary.json). All their first hit faces equal the queried face. A significant change is head triangle **2424 at frame 25**: the wider view set exposes it from yaw +60°, and it participates in the severe crease failure at vertex 266. Sparse front views had hidden that part of the contradiction. Head triangle 1990 at frames 25 and 169 and several opposite-side crease faces also become exposed. No previously exposed classification is lost.

## Two-tier feasibility result

The solver uses a fixed correction transported by each vertex's original eight-weight linear skin matrix. In units of 0.00005, the conditions are `A q >= b` and `||q|| <= 5`. The entries of `b` are either the tested margin divided by 0.00005 or zero. Accepted proposals must pass direct primal checks. Rejected proposals retain nonnegative weights `lambda` satisfying `b·lambda > 5 ||Aᵀ lambda||`, which contradicts any vector within the displacement ball.

| Positive margin | Newly feasible among the old ten failures | Total independently feasible vertices | Remaining certified failures |
|---|---:|---:|---|
| 0.00005 | 3 | 1,628 / 1,635 | 266, 275, 277, 805, 5631, 5981, 6471 |
| 0.00004 | 6 | 1,631 / 1,635 | 266, 275, 277, 805 |
| 0.000025 | 6 | 1,631 / 1,635 | 266, 275, 277, 805 |

Vertices **276, 278 and 806** become feasible at the original positive margin, with displacement norms 0.0002263235, 0.0002421249 and 0.0002065589 respectively. The three modest opposite-side failures **5631, 5981 and 6471** become feasible at 0.00004. All six are diagnostic independent-vertex vectors, not a smooth, collision-checked surface.

The required negative controls at 5631, 5981 and 6471 retain their original rejecting certificates at margin 0.00005. With denser visibility, the original certificates at 266, 275 and 805 also reject the two-tier problem. The independent verifier reconstructs geometry normals and matrix products separately, checks all 15 accepted vectors and 15 failure certificates, and rechecks the 1,625 original feasible vectors directly before using monotonicity for the totals above. It imports no optimizer. Maximum accepted inequality violation is only 6.884e-15 in normalized units; the smallest verified certificate separation is 0.00361439, comfortably above the explicit 1e-8 separation threshold. These are floating-point checks, not exact symbolic arithmetic.

At the smallest margin, the four remaining failures localize the next investigation:

| Head vertex | Active frame / triangle pairs | Exposure in this sample |
|---|---|---|
| 266 | 25/2424, 169/2425 | Both exposed |
| 275 | 25/2424, 170/1989, 300/1992, 410/2425 | All exposed |
| 277 | 25/1992, 120/1991, 120/1992, 170/1989 | Three sampled-hidden zero-margin planes; one exposed positive plane |
| 805 | 25/1991, 120/1991, 169/1993, 590/1990 | Three sampled-hidden zero-margin planes; one exposed positive plane |

The first two failures cannot be blamed exclusively on hidden supporting planes. The latter two demonstrate that retaining even nonnegative clearance against folded hidden planes can oppose positive clearance against an exposed plane. Simply halving the requested positive margin does not repair this construction.

## What this changes next

Stop iterating the same infinite-plane model with smaller margins or more permissive hidden-face rules. The evidence supports a bounded **finite-triangle** diagnostic in the marked crease regions: measure nearest points and actual plate/head triangle contacts under trial fixed corrections, determine which head triangle provides the exposed outer surface in each pose/view, and compare that finite-surface objective to the rejected supporting-plane constraints. Preserve original topology and native skin bytes. An open, self-folding head mesh has no automatic global signed-inside test; the new objective must explicitly state its local orientation and exposure policy.

This result does not prove a finite-surface correction exists. Nor does a feasible per-vertex vector establish acceptable neighbor smoothness, non-adjacent contacts, preserved UV coverage, continuous-time animation, other facial customizations or game rendering. A promising construction must still pass the existing neighbor budget, all-pose contact/visibility audit including frame 490, all 107 static cases, 105-morph import/round-trip, both native skin buffers and the batched game comparison. No such candidate was synthesized or imported here because this relaxation still fails.

## Reproduction and provenance

Run from HQ, with the existing ignored fixed-solver NumPy/SciPy environment installed as described in [fixed feasibility](../fixed_feasibility.md):

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --disable-autoexec --python experiments/006-plate-clearance/research/visibility_margin_sample.py
python experiments/006-plate-clearance/research/visibility_margin_solve.py
python experiments/006-plate-clearance/research/visibility_margin_verify.py
```

Detailed visibility observations and solver vectors/certificates stay under the ignored build as `visibility_margin_samples.json` and `visibility_margin_solutions.json`. The tracked summary contains metadata, case identifiers and hashes, not vertex/animation payloads. The solver runs synthetic mixed-positive/zero, opposing, over-budget, feasible and all-zero right-hand-side checks before processing the real inputs.

This is project-authored diagnostic work using the already credited **Blender 5.0 BVH**, **NumPy 2.5.3**, **SciPy 1.18.1**, WolvenKit-derived geometry, and Cyberpunk Blender IO Suite / Three.js sampled deformation. No external implementation or new asset source was copied. Extend the existing tool-use credit entries with this exposure-aware benchmark and independent certificate verification; the integrating parent maintains the central record.
