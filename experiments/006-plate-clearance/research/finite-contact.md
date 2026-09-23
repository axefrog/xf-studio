# Finite-triangle diagnosis of the crease failures

23 September 2026. This read-only diagnostic examines head vertices 266, 275, 277, 805 and the opposite-side control 5981 at idle frames 25, 120, 169, 170, 300, 410, 490 and 590. It uses the retained-native-weight experiment-006 build, source head/plate correspondence, and the two existing 0.00005/0.0001 offset conversions. **Neither conversion is accepted as a replacement plate.** No master, mesh, morph, or game resource was edited.

[The detailed report](finite_contact_summary.json) records, for every point/pose/conversion, the exact nearest head face ID, closest point, unsigned distance, winding-local signed distance, closest region and sampled face exposure. It also records finite closest points and signed infinite-plane distances for the active failure-certificate faces. The source candidate is the unoffset mapped head surface. All-pairs point/triangle distances independently check the AABB shortlist for every query; a separate active-set scalar oracle checks 3,600 synthetic point/triangle cases. Local incident plate/head triangle pairs use the existing segment/coplanar contact code, excluding source-adjacent and pre-existing head intersections when counting new nonadjacent pairs.

| Observation | Result |
|---|---:|
| Nearest-head point queries | 120 |
| Nearest head faces sampled exposed / hidden | 108 / 12 |
| Active certificate plane measurements with negative signed plane distance despite a positive finite distance outside that face | 14 |
| Distinct new nonadjacent contact pairs across sampled frames and the two offsets | 65 |
| Contact-pair occurrences joined to these five vertex neighborhoods | 87 |
| Head-face exposure of those joined occurrences | 81 exposed / 6 sampled hidden |

The 14 plane/finite disagreements are a direct example of infinite-plane overconstraint, not proof that the corresponding plate triangles clear the head. At frame 25, vertex 266 with the 0.00005 offset is **−0.0000470633** behind face 2424's supporting plane, although its nearest point on that finite face is **0.0000481039** away and the perpendicular projection falls outside the face. Face 2424 is sampled exposed. The offset conversions still produce 65 distinct new nonadjacent contact pairs in these local regions and sampled frames. A positive vertex-to-face distance cannot substitute for the triangle-to-triangle test.

Frame 490 checks the opposite-side control missed by the earlier two-frame contact visibility study. Vertex 5981's 0.00005 conversion is nearest exposed head face 3671 at **+0.0000465212** winding-local signed distance, below the original **0.00005** margin. Its two original active certificate faces, 3666 and 3668, are also sampled exposed; their supporting-plane distances are only **+0.00000697574** and **+0.00000632371**. The 0.0001 conversion is farther from the nearest face at that vertex, but this point result does not validate the complete plate.

The sign follows the nearest triangle's winding. The head is open and folds over itself, so this is **not** a global inside/outside classification. At an edge or vertex, nearest-face ties can change the local sign; unsigned distance and actual triangle contacts carry the stronger geometric evidence. Exposure uses the 50 camera directions and 25 strict-interior samples per face/view from the preceding head-only audit. Blender 5.0 BVH classified 33 additional face/poses (27 exposed, six sampled hidden); the rest inherit the existing audit. A head face being exposed does not prove its head-plus-plate intersection segment is visible. The exact point/contact report permits follow-up combined-scene rays on any proposed full correction.

The existing **0.00025 total pre-skin displacement budget** and conservative neighboring-vertex smoothness limit of `min(0.00005, quarter original edge length)` remain acceptance gates. No new correction field was produced, so neither gate is satisfied or waived here. Before promotion, a single candidate must pass all **73 poses**, **107 static cases**, complete nonadjacent-contact and exposure checks, 105-morph import/round-trip, and identical native skin bytes in both the mesh and morph base buffer. These eight sampled poses and one saved-V shape are diagnostic only; they do not prove continuous animation or game rendering.

## Reproduce

Run from the HQ layout. The scripts read the ignored build path recorded in `fixed_summary.json`; detailed asset buffers remain ignored at that location. The tracked report contains only selected point measurements, face IDs, counts and hashes.

```powershell
python experiments/006-plate-clearance/research/finite_contact.py
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --disable-autoexec --python experiments/006-plate-clearance/research/finite_contact_visibility.py
```

The second script must finish without a Python traceback; Blender may return process code zero even after a script exception. Both scripts use project-authored geometry checks and already credited Blender, NumPy and Cyberpunk asset tooling. The integrating parent maintains central tool-use provenance.
