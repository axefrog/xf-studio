# Morph-specific smoothness and contact occupy separate eyelid regions

24 September 2026. **No safe replacement plate was found or selected.** The previous bounded finite correction failed both the all-static neighbor-smoothness and sampled contact gates. This follow-up identifies where those two failures overlap, so a future correction can be narrowly designed and independently checked. It reads the retained-weight game-derived files but changes no mesh, morph, Blender master, archive, or release asset.

The [reproducible diagnostic](morph_contact_boundary.py) independently reconstructs the pairwise necessary smoothness test from the head and converted plate GLBs. It evaluates Basis, all 105 individual morphs, and the reference save's five-morph combination (107 static cases); there are 4,642 plate edges. It also joins the certified edges to the already measured combined head-plus-plate exposed-contact detail at idle frames 0 and 25. The machine-readable [report](morph-contact-boundary.json) includes resource SHA-256 hashes, every witness, UV positions and explicit limits.

| Result | Measurement |
|---|---:|
| Edges on which **one base-only correction** cannot satisfy all 107 static neighbor limits | 25 / 4,642 |
| Connected groups of those edges | 13 |
| UV footprint | 15 left-side edges at U 0.4059–0.4340; 10 right-side edges at U 0.5669–0.5867; all at V 0.2300–0.2461 |
| Worst witness | plate edge 572–781, mapped head 2424–3017; `h041_eyes` versus `h201_eyes` |
| Worst pairwise excess over the summed allowed radii | 0.0000507447 mesh units |
| Minimum *uniform* neighbor-cap multiplier to eliminate these **pairwise** certificates | 1.8164× |
| Certificate edges incident to exposed **new non-adjacent** contact plate faces at frames 0 / 25 | 0 / 0 |
| Shortest plate-edge path from a certified vertex to those new contact faces at frame 25 | 7 hops |

The last three measurements have narrow meaning. Frame 0 has no exposed newly introduced non-adjacent face in this prior visibility subset. Frame 25 has two such plate faces, but neither is incident to the 25 incompatible edges. Two certified edges at frame 0 and three at frame 25 *do* touch some exposed contact face when source-adjacent/native contacts are included. Thus the static morph-smoothness obstruction and newly introduced folded-surface contact are related eyelid work, but editing only the 25 certified edges cannot be assumed to fix the exposed new contacts. The combined-scene ray subset covers two representative phases, not every pose or camera.

For the worst edge, the two morph-specific edge displacement vectors are 0.0001129014 apart; their allowed radii total 0.0000621567. Any fix retaining the current cap must alter the **combined relative morph-specific edge vectors** by at least the 0.0000507447 excess. An even split would be about 0.0000253724 per case, but there is no requirement that the two cases share the change equally. The 1.8164× figure is a necessary factor if the cap alone were relaxed uniformly; it is **not sufficient** to produce a smooth, contact-free plate, and relaxing the visual/geometry gate is not a remediation by itself. All 25 worst-pair witnesses involve eye morphs except one pair involving the saved combination. No original morph deltas or native skin bytes were changed here.

## Next bounded correction experiment

The next candidate must be **morph-aware and contact-aware**, rather than another common base offset. Build a diagnostic correction with separate small, smooth position deltas for the affected eye morphs in the two measured UV bands while retaining each original morph record, target name/order and all other attributes. In parallel, constrain the nearby *posed* plate triangles against their actual finite exposed head faces, including the non-adjacent contacts at frame 25 and opposite-side frame 490. Use the recorded 0.00025 total displacement and original `min(0.00005, quarter local source edge length)` neighbor limit as initial gates; do not silently relax them or delete coverage. Optimization objectives should distinguish displacement from the original mapped head surface, static neighbor smoothness, and triangle-to-triangle contact; a point-to-infinite-plane margin is only a screening condition.

Reject a numeric candidate before import if any of the 107 static shapes exceeds the displacement/smoothness limits, or any of the 73 preserved idle samples gains a new non-adjacent intersection. Include combined-scene visibility on survivors, not merely head-only face exposure. Only a survivor should go through WolvenKit import and independent checks for all 105 morphs, exact native skin bytes in **both** mesh and morph embedded base buffer, triangle correspondence, UV and shading preservation. It would still be a sampled offline candidate, not proof of continuous animation or game rendering. If the morph-aware field cannot meet these gates, compare a different decal-depth/geometry representation instead of enlarging the offset or erasing folded faces that are exposed in other poses.

The reconstruction is independent of the earlier optimizer and agrees with its 25-edge count and exact worst witness. It uses the project's earlier credited WolvenKit round-trip, native-weight transfer, Blender/Three.js animation samples and combined-scene ray audit; no additional third-party code, asset or technique was introduced. Central community records are maintained by the integrating agent.

Reproduce in the HQ layout with the ignored retained build present:

```powershell
python experiments/006-plate-clearance/research/finite_correction_verify.py
python experiments/006-plate-clearance/research/morph_contact_boundary.py
```
