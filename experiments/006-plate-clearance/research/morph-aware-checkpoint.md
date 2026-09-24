# Morph-aware plate correction: static barrier removed, finite contacts remain

24 September 2026. **No new plate was selected, imported, or substituted for the owned master.** This is a bounded numeric experiment on the native-weight-retained `geometry-0.00005000` conversion. It changes no tracked or ignored game-derived mesh, morph resource, Blender master, archive or release asset. The source conversion has independently verified exact native skin bytes in both its mesh and embedded morph-base buffer; a future converted candidate would need that audit again.

The earlier [boundary certificate](morph-contact-boundary.md) proved that a base-position-only correction cannot satisfy the fixed smoothness budget on 25 eyelid edges across the 107 static shapes. The [numeric construction](morph_aware_probe.py) first builds a bounded, smoothly varying rest-space separation from the prior finite-face-guided field. It then changes only the eye morph records that violate the static edge limit, making their plate position deltas match the mapped original head deltas. This restores the head-cut plate's intended morph correspondence for those targets while preserving all 105 target names/order, the original triangles, UVs and all other target attributes. No topology or makeup coverage is deleted. The saved-V combination is tested separately. The [independent verifier](morph_aware_verify.py) reconstructs the candidate from the original GLBs and checks all 107 static cases and 73 retained idle samples without importing the field constructor.

| Gate/measure | Morph-aware field | Finite-contact-guided local trial |
|---|---:|---:|
| Eye morph target position records changed / 105 retained | 17 | 19 |
| Maximum numeric base separation field | 0.00009744 | 0.00009423 |
| Maximum separation difference on a plate edge | 0.00004201 | 0.00004509 |
| Static shapes over the original 0.00025 displacement cap | 0 / 107 | 0 / 107 |
| Static shapes over their original `min(0.00005, quarter local source edge)` limit | 0 / 107 | 0 / 107 |
| New nonadjacent finite-triangle contacts across 107 static shapes | 10 | **7** |
| New nonadjacent finite-triangle contacts across 73 sampled idle poses | 73 | **48** |

The initial field removes all 25 base-only edge incompatibilities but does **not** resolve clearance. Its ten static new-contact pairs are in `h031_eyes`, `h141_eyes`, `h171_eyes` and `h201_eyes`; posed pairs occur in ten sampled frames. The [finite-contact trial](morph_contact_rescue.py) pulls plate vertices toward the actual intersected head face's winding-positive half-space through each sampled skin matrix, smooths the displacement across plate edges, and accepts only steps that lower the critical contact count without breaching the field magnitude/edge budgets. Two improving steps reduce its critical-case count from 83 to 55; the next tested steps cannot lower it further within those budgets. Two additional eye target records need correction after this local displacement change, bringing the changed target count to 19. The independent full verifier confirms seven static new contacts (`h031_eyes`: two, `h141_eyes`: one, `h171_eyes`: four) and 48 posed new contacts (frame 25: 14, 120: 10, 169: 14, 170: 10). The original displacement and neighbor limits pass throughout. The finite-contact gates **fail**, so no resource import or master edit follows.

The local half-space heuristic is not an infeasibility proof. A supporting plane can be too restrictive where its projection misses a finite triangle, and a single winding-positive push can trade one folded-surface intersection for another. The bounded result establishes a useful separation: morph-specific deltas can remove the static edge certificate without relaxing shape gates, while the remaining finite contacts require a different objective. The next candidate should optimize **actual finite triangle separation** across the four surviving idle phases and three static eye shapes, allowing small case-specific eye morph corrections rather than forcing every eye target to the same shell field. Preserve the 0.00025/neighbor caps and all coverage, then rerun the full 73-pose/107-static checks, combined-scene contact visibility, 105-morph round-trip, triangle/UV/shading correspondence, and exact native skin-byte checks in both resource buffers. If finite constraints conflict under those bounds, compare a decal depth/material representation instead of increasing the offset or deleting exposed plate triangles.

The [initial report](morph_aware_summary.json), [contact-guided history](morph_contact_rescue_summary.json), and [full follow-up report](morph_aware_rescue_summary.json) record counts, input hashes, target names and rejected gates. The numeric `.npz` fields are ignored local diagnostic outputs; they are not game assets. Report paths to tracked local files are workspace-relative, while the existing ignored source build remains at its recorded HQ path. A fresh clone without the private game-derived source build cannot reproduce this experiment. Sampled poses are not continuous-animation or in-game proof.

Reproduce from a workspace with the retained ignored experiment-006 build:

```powershell
python experiments/006-plate-clearance/research/morph_aware_probe.py
python experiments/006-plate-clearance/research/morph_contact_rescue.py
python experiments/006-plate-clearance/research/morph_aware_probe.py --rescue
python experiments/006-plate-clearance/research/morph_aware_verify.py
python experiments/006-plate-clearance/research/morph_aware_verify.py --rescue
```

This experiment uses the project's already credited WolvenKit/GLB extraction, Blender/Three.js pose samples, NumPy/SciPy solvers and locally authored triangle contact code; it introduces no new community source, third-party code, or asset reuse. The integrating agent maintains the central learning-credit record.
