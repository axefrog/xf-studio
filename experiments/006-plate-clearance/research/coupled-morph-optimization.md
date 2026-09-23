# Coupled eye-morph finite-contact optimization: no accepted plate

24 September 2026. This bounded numeric follow-up starts from the ignored finite-pair field (SHA-256 `16b805128b406abe6ef1729c081b9df551253c2a1a3a221f4d1137f9f5438083`). It changes no owned Blender master, game mesh/morph resource, archive or release asset. The source `geometry-0.00005000` conversion already has exact native head skin bytes in **both** its mesh and embedded morph base buffer; the field below remains numeric and has not undergone resource packing.

The prior field had four new non-adjacent static triangle contacts in `h171_eyes` and 14 sampled-pose contacts at frames 25 and 169. [The bounded solver](coupled_morph_opt.py) jointly constrains all measured finite-triangle pairs within each affected eye morph. For each pair it tests a separating axis from the two face normals and nine edge-cross-edge axes. The solver minimizes the local morph-position change subject to linear finite-pair separation and the original nonlinear **0.00025 total displacement** and **`min(0.00005, quarter source edge)` neighbor** limits. It optimizes over 60 local vertices of `h171_eyes` and 38 of `h091_eyes`; the latter edit acts on the saved-V eye morph across sampled skin matrices. Topology, UVs, all 105 morph target names/order and other target records stay inherited from the source numerically.

| Independent full check | Starting finite-pair field | Combined two-morph field |
|---|---:|---:|
| New non-adjacent static contacts, 107 shapes | 4 | **0** |
| New non-adjacent contact occurrences, 73 poses | 14 | **6** |
| Static displacement / neighbor violations | 0 / 0 | **0 / 0** |

The [independent verifier](coupled_morph_verify.py) reconstructed all 107 shapes and 73 saved idle samples directly from the original GLBs, stored numeric changes and original pose matrices. The combined field's SHA-256 is `928c6cf5b454d23b5209f21ef5ec559533a3481df50c8064dda579cd140f5f17`. Its maximum static displacement is `0.00010808505`; the largest neighbor gap reaches `0.00005000000`, the cap for those edges. The [case-level report](coupled_morph_verify_summary.json) records every gate and the six residual pairs:

| Idle frame | Plate face | Head face | Mapped source-head face |
|---:|---:|---:|---:|
| 120 | 799 | 1989 | 1993 |
| 120 | 800 | 1989 | 1994 |
| 120 | 801 | 1989 | 1995 |
| 120 | 803 | 1989 | 1997 |
| 120 | 1227 | 1989 | 2421 |
| 170 | 1227 | 1987 | 2421 |

All six involve the tight plate neighborhood around vertex 119. The edit that clears frames 25/169 exposes contacts at frames 120/170, which were clear in the starting field. A second constrained pass carried the successful separation axes forward and added these six pairs. It could not satisfy all selected constraints within the original shape limits. Alternate outward/normal axes and neighborhoods expanded from two to four edge rings also failed. The [optimization report](coupled_morph_opt_summary.json) retains solver status, axis choices, exact targeted counts and hashes. These finite-axis assignments are sufficient ways to separate selected pairs, **not a proof that every possible geometry correction is infeasible**; the nonlinear solver can also stop short of a feasible solution. The bounded search ends here rather than widening the approved shape caps or deleting coverage.

The combined numeric result fails the posed finite-contact gate, so it is **not approved for import or use**. Its original topology/UV and 105 records are retained at the array level only; no candidate resource round-trip, independent packed native-skin-byte check, combined-scene visibility or game rendering claim follows. A reasonable next representation study is head-surface projection or a decal depth strategy that does not require one continuously offset eyelid shell. It needs its own coverage, depth/material and deformation validation; this experiment does not establish that REDengine will render it correctly.

Reproduce in this worktree with the ignored source build retained at the path in the reports:

```powershell
python experiments/006-plate-clearance/research/coupled_morph_opt.py
python experiments/006-plate-clearance/research/coupled_morph_verify.py
```

The input finite-pair `.npz` was copied from HQ into this worktree's ignored `experiments/006-plate-clearance/generated/morph-aware/` folder with the hash above. New numeric variants are ignored there too; tracked reports contain their hashes. The work uses the already credited WolvenKit/GLB extraction, NumPy/SciPy, authored contact checker and sampled skin matrices. No new community source, external code or third-party asset was introduced.
