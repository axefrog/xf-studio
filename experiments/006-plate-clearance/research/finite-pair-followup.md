# Finite-pair morph-aware plate search: rejected numeric field

24 September 2026. This bounded follow-up uses the native-weight-retained `geometry-0.00005000` source conversion and the prior morph-aware numeric field. **No owned master, game-derived mesh/morph binary, archive, or releasable plate was changed.** The trial remains an ignored numeric `.npz` field.

The previous local rescue pushed vertices toward an intersected head face's infinite winding plane. This search instead computes separating translations from the **two actual finite triangles** in each new non-adjacent contact pair: both face normals and all nine edge-cross-edge axes are considered, and the shortest interval-separating translation is tested. Corrections are pulled through the sampled skin matrices, tapered across one plate edge, and accepted only if exact triangle-contact counts improve while the original 0.00025 displacement and per-edge `min(0.00005, quarter source edge)` limits remain satisfied in **all 107 static shapes**. Three static eye morphs may receive their own small position corrections. A final probe tried single face-vertex movements for the remaining static contacts; none improved within the gates. Triangle topology, UVs and all 105 morph records are retained mathematically.

| Independent finite-triangle gate | Prior morph-aware rescue | This numeric trial |
|---|---:|---:|
| New non-adjacent static contact pairs, 107 shapes | 7 | 4 |
| New non-adjacent posed contact occurrences, 73 idle samples | 48 | 14 |
| Static displacement violations | 0 | 0 |
| Static neighbor-limit violations | 0 | 0 |

The independent verifier measures a maximum static displacement of **0.00010808505** and a maximum static neighbor gap of **0.00004898817**. Only `h031_eyes` and `h141_eyes` receive additional morph-position corrections relative to the prior numeric rescue; no non-eye target changes. The ignored numeric field's SHA-256 is `16b805128b406abe6ef1729c081b9df551253c2a1a3a221f4d1137f9f5438083`.

The four residual static pairs are all in `h171_eyes`. The posed occurrences are confined to sampled frames 25 and 169, seven at each; frames 120 and 170 clear in this candidate. These are exact finite triangle contacts against the full head, excluding source-adjacent pairs and head intersections already native to the corresponding source triangles. The [independent verifier](finite_pair_verify.py) reconstructs every shape and pose from the original GLBs plus the stored field; its [complete report](finite_pair_verify_summary.json) records every case and gate. The [search report](finite_pair_search_summary.json) lists all remaining face pairs and their shortest local separating translations.

The two finite-contact gates still **fail**, so the numeric field is not accepted for resource import. The original source conversion's native skin bytes were previously verified in both its mesh and morph base buffer, but this numeric field has not been packed into a candidate resource. There is therefore no candidate round-trip, UV/shading serialization, or new native-byte comparison to claim. Combined-scene visibility is also withheld: a partially improved field is not a replacement plate. The inability of these local finite-axis steps to clear the folds is **not** an infeasibility proof. The search can be trapped by shared-vertex coupling and a discrete contact objective. A broader constrained optimization or a decal-depth representation remains open.

Reproduce from this worktree with the existing ignored experiment-006 source build at the path in the reports:

```powershell
python experiments/006-plate-clearance/research/finite_pair_search.py --passes 8 --pairwise --vertexwise
python experiments/006-plate-clearance/research/finite_pair_verify.py
```

The first command writes only an ignored numeric field under `experiments/006-plate-clearance/generated/morph-aware/`; the tracked reports carry its SHA-256 and source hashes. Neither command launches the game or modifies the owned Blender master. The 73 samples do not prove continuous-animation or runtime rendering behavior. This uses the project's existing WolvenKit/GLB extraction, NumPy, contact checker and skin matrices; no new outside code, asset or community technique was introduced.
