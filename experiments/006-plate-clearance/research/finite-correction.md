# Bounded finite-surface correction trial: rejected

23 September 2026. The [finite-triangle diagnosis](finite-contact.md) showed that some infinite supporting-plane failures are outside the actual face, but the existing offsets still create exposed-region contacts. This trial constructs **one** local counterfactual correction from the nearest sampled-exposed head faces at crease vertices 266, 275, 277, 805 and opposite-side vertex 5981. It is deliberately tested before any mesh or morph import. **It fails contact and static smoothness gates; no replacement plate or game resource was produced.**

The construction starts from the retained-native-weight 0.00005 converted plate. For each seed, it pulls an exposed posed face normal back through that vertex's verified eight-weight affine skin matrix, adds a 0.00002–0.0001 displacement tapered by plate-edge geodesic distance, caps the total saved-shape pre-skin displacement at **0.00025**, and solves a graph-smoothed field. The first field satisfying `min(0.00005, quarter source edge length)` on all 4,642 saved-shape edges uses smoothing coefficient 1. Its maximum displacement is **0.0000974370** and maximum neighbor difference **0.0000420134**. This produces a 1,635-vertex numeric field; the field is not serialized into a resource. The underlying source conversion already has exact native head skin bytes in both its mesh and morph base buffer, and 105 morph targets. The counterfactual applies only a base-position change, leaving those source bytes, morph deltas, topology, UV and shading untouched mathematically. A new converted resource would still require an independent byte and round-trip audit if a future field passes geometry.

The candidate uses the exact sampled-head positions and affine skin matrices, then checks all **73** preserved idle poses against every head triangle. Separately, it evaluates Basis, each of the **105** morphs and Nathan's saved five-morph combination: **107 static cases**. Every static case is checked for total displacement, neighbor smoothness and whole-plate/head triangle contacts. [The report](finite_correction_summary.json) contains the case-level counts, input hashes, seed choices and gate results.

| Gate or measure | Observed result |
|---|---:|
| 73 pose samples checked | Yes |
| 107 static cases checked | Yes |
| Static displacement over 0.00025 | None |
| Static cases with neighbor-limit violations | 102 / 107 |
| Static cases with new nonadjacent contacts | 5 / 107 |
| Poses with new nonadjacent contacts | 6 / 73 |
| New nonadjacent pose-pair occurrences, existing 0.00005 offset → trial | 51 → 59 |
| All plate/head contact-pair occurrences, existing offset → trial | 1,626 → 2,844 |

The remaining new nonadjacent pose contacts occur at frames 25, 120, 169, 170, 480 and **490**; the worst frame has 14. Contact pairs are compared with the corresponding source-head triangles, so native head self-intersections and source adjacency are separated from newly introduced nonadjacent contacts. No head-only face exposure count is substituted for visibility of a combined head-plus-plate intersection. The candidate already fails the geometric contact gate, so it was not promoted to the expensive combined-scene visibility or import stage.

There is a stronger **representation-specific** static result. If the 105 morph position deltas remain exactly unchanged and only the base positions receive one fixed correction, that same edge correction must work in every static morph case. Two case-specific edge displacement vectors farther apart than the sum of their permitted neighbor radii make this impossible, regardless of the correction. An independent verifier reconstructs this pairwise necessary condition directly from the retained GLBs, importing no optimizer. **25 of 4,642 edges have such certificates.** The largest is plate edge 572–781 (mapped head vertices 2424–3017): morphs `h041_eyes` and `h201_eyes` require edge vectors **0.0001129014** apart, while their two allowed radii sum to **0.0000621567**, a gap of **0.0000507447**. Changing only the base positions cannot make both cases pass. This does **not** prove that carefully authored changes to morph position deltas or a different representation are infeasible; those would need to preserve the intended 105 morph behaviors and pass fresh import/deformation checks.

The result rejects this field and the base-only, unchanged-morph strategy under the stated all-static neighbor criterion. It does not prove no finite correction exists. The existing master, released assets, UV coverage, shading, native skin bytes and morph resources remain untouched. Continuous animation, arbitrary morph combinations and game rendering remain outside these finite offline samples.

## Reproduce

Run from the HQ layout with the ignored experiment-006 build and its existing SciPy target available:

```powershell
python experiments/006-plate-clearance/research/finite_correction_probe.py
python experiments/006-plate-clearance/research/finite_correction_verify.py
```

The probe includes synthetic triangle and incompatible-edge controls. The independent verifier checks all 107 cases and all 4,642 edges without SciPy optimization. Both scripts use already credited project geometry, NumPy/SciPy and retained Cyberpunk asset tooling. The integrating parent maintains central provenance.
