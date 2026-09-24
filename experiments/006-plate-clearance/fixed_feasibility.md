# Fixed pre-skin correction: bounded feasibility result

23 September 2026. **The proposed all-incident-plane shell cannot satisfy the requested margin across these 73 idle poses within the displacement budget.** This is useful negative evidence, not a failed import: no mesh, morph resource, original source, owned master or existing evidence was changed. A different collision-free surface construction is not ruled out.

The experiment follows [the next-step proposal](research/corrective-next-step.md). It uses the retained-native-weight build `generated/build-1790134714546030800`, Nathan's five customization morphs, all 1,635 mapped vertices and the existing 73 sample phases. The desired minimum signed incident-plane distance is **0.00005** mesh units; total fixed displacement from the saved head surface is bounded by **0.00025**. This is a total displacement budget, not an additional 0.00025 on top of the old candidate.

## Verified transport

The new authoring tool `tools/export_plate_skin_matrices.ts` explicitly accumulates all eight original weight influences into a per-vertex affine transform and exports its effective 3×3 linear part. Its independent reconstruction is checked against `getVertexPosition`, the retained head samples and three directly skinned basis perturbations per vertex per frame. The new head-only sampler maps 254 bones; this count is not the four-rig sampler's 1,016 or the browser's 387.

| Check | Maximum world-space error |
|---|---:|
| Explicit affine transform versus existing CPU skin adapter | 1.111e-15 |
| Retained head samples versus newly sampled positions | 0 |
| Three 0.00025 basis perturbations versus direct skin adapter | 1.111e-15 |
| Independent Python reconstruction from exported matrices | 1.111e-15 |
| Existing 0.00005 converted plate reconstructed using head transport | 8.895e-16 |

The asserted transport tolerance is 1e-10. This validates the model's affine reconstruction and native-weight consistency; it does not validate REDengine's shader or animation graph.

For each incident head face at each pose, `N` is its freshly computed geometric normal and `M` the exported linear skin transform. The fixed local correction `d` is constrained by `N M d >= 0.00005`. Using `q = d / 0.00005` gives a well-conditioned problem with a norm bound of five. No posed lighting normals are substituted for triangle normals.

## Result

| Classification | Vertices |
|---|---:|
| Feasible across all samples within the bound | 1,625 |
| Positive margin feasible, but requires more than the bound | 7 |
| Opposing constraints certify failure within the bound | 3 |
| Unresolved numerical cases | 0 |

SciPy's SLSQP proposes minimum-norm solutions. Feasibility is then tested directly. Over-budget cases retain nonnegative dual weights yielding an independently checked norm lower bound. Opposing-plane cases retain nonnegative linear-combination certificates: their sum exceeds five times the magnitude of the combined pulled-back normal, contradicting any correction inside the allowed ball. This remains a finite-bound conclusion; a tiny floating-point residual is not presented as a symbolic proof of impossibility at arbitrarily large displacement.

`fixed_verify.py` imports no optimizer and reconstructs constraints separately before checking every accepted vector and each rejected case's certificate. It also bounds the best relaxed uniform margin from above and below. The maximum upper/lower gap is **1.908e-15 in margin-ratio units**. All checks pass. Synthetic tests cover flat, orthogonal, redundant, rotated, opposing and known over-budget constraints.

The difficult vertices are concentrated in a few eyelid-crease/corner regions. These are original exported head `TEXCOORD_0` values, **not screen coordinates or a presumed editor V convention**:

| Head vertex (plate vertex) | UV | Required displacement / 0.00005 | Best achievable margin / requested margin within bound |
|---|---|---:|---:|
| 266 (109) | 0.371094, 0.249512 | 52.7192 | 0.094842 |
| 275 (118) | 0.372314, 0.250000 | Opposing constraints | effectively 0 |
| 276 (119) | 0.372070, 0.251465 | 9.29795 | 0.537753 |
| 277 (120) | 0.373047, 0.250488 | Opposing constraints | effectively 0 |
| 278 (121) | 0.371094, 0.250977 | 5.24977 | 0.952423 |
| 805 (321) | 0.373779, 0.251465 | Opposing constraints | effectively 0 |
| 806 (322) | 0.373535, 0.251465 | 8.47497 | 0.589973 |
| 5631 (1267) | 0.571289, 0.244629 | 5.01814 | 0.996386 |
| 5981 (1452) | 0.581055, 0.232910 | 6.18340 | 0.808617 |
| 6471 (1606) | 0.568848, 0.244629 | 5.43592 | 0.919808 |

For example, head vertex 266 would require about 0.002636 units for the original margin—more than ten times the allowed displacement. Within the bound, its uniform margin must drop to about 0.000004742. In contrast, vertex 5631 misses the margin by only about 1.807e-7 units. These small and severe failures should not be conflated.

Four vertices—276, 278, 806 and 5631—satisfy the budget when **each pose is solved independently**, yet fail when a single correction must serve the whole loop. That directly demonstrates the limitation of an oracle that changes displacement every frame. Vertices 275 and 277 already have opposing incident constraints in particular single poses; 805 has individually over-budget closure poses and opposing constraints when combined across time. [The machine-readable summary](fixed_summary.json) records active planes, frames, per-pose classifications, input hashes and relaxation bounds.

## Smoothness and why no import follows

A conservative proposed neighbor budget is `min(0.00005, 0.25 × original edge length)`. The unconstrained minimum-norm field violates this on 230 of 4,642 plate edges, with a maximum difference of 0.002636. This is a diagnostic audit of the unconstrained proposals, **not a smoothness-feasible candidate**. Infeasible vertices' optimizer values are retained only for diagnosis; they are not treated as accepted offsets.

A coupled smoothness solve was not run: the independent-vertex model is already a relaxation of that problem, and ten certified failures rule out satisfying the stricter coupled version. Smoothing, capping, dropping triangles or replacing failed points with normals would conceal the failure. Accordingly, there is no candidate to send through all-pose triangle contacts, visibility, WolvenKit import or the 105-morph audit at this checkpoint. All original coverage remains intact.

This failure is specific to demanding positive clearance from **every incident face plane at every sampled pose**. That local construction is more restrictive than general collision avoidance; it does not prove that every possible small authored crease correction or different decal depth strategy must fail. A next useful investigation is to inspect these small marked regions and distinguish faces that genuinely occlude exposed makeup from native internal folds, then choose a new constraint/representation deliberately. Any selective constraint relaxation needs the full non-adjacent contact and visibility checks, rather than calling a positive local plane distance a rendering guarantee.

## Reproduction and provenance

From HQ:

```powershell
python -m pip install -r experiments/006-plate-clearance/fixed_requirements.txt --target experiments/006-plate-clearance/generated/fixed_python
& 'C:/Users/Nathan/.bun/bin/bun.exe' projects/xf-studio/authoring/tools/export_plate_skin_matrices.ts
python experiments/006-plate-clearance/fixed_feasibility.py
python experiments/006-plate-clearance/fixed_verify.py
```

All affine matrices, per-vertex displacement proposals and detailed constraint certificates are ignored local output under the preserved build. `fixed_summary.json` is metadata and the compact failing-vertex report. No external mesh or animation payload is added to the repository. Inputs and the full report digest are in the summary, including the two source animation digests. This study covers one saved shape and finite samples only; neither continuous motion nor other customization combinations is proven.

The existing credited foundations remain WolvenKit, Cyberpunk Blender IO Suite and Three.js. New dependency use is **SciPy 1.18.1** (SLSQP, nonnegative least squares and HiGHS linear programming through its public API) and **NumPy 2.5.3** for matrix arithmetic; see [SciPy](https://scipy.org/) and [NumPy](https://numpy.org/). Their locally installed package metadata/licenses identify the SciPy and NumPy developers and bundled solver notices. They are research tooling in an ignored target directory, not bundled application dependencies; no optimizer implementation was copied. The certificates and experiment construction are project code. Central provenance is maintained by the integrating agent.
