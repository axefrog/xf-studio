# Plate clearance under facial deformation

**Result: useful candidates and a repeatable contact test, but no release offset selected.** The unchanged cut-out has packing-related overlaps. Offsets improve it greatly, yet small eyelid folds/corners still contact the head. A positive distance at every corresponding vertex does not prove that the triangles between them stay outside the skin.

The original cut-out is sound in the aspect examined here: **all 3,010 plate triangles map exactly to head triangles** using the established position/UV correspondence. No original Blender file or owned neutral master was modified. Nothing was installed into the game or MO2, and experiment 005 still uses its neutral control.

## What was tested

- Two amounts, `0.00005` and `0.0001` in mesh units. No uniform object scaling.
- **Shading-normal method:** offset the base along the game's lighting normal and adjust each position morph for its corresponding morphed normal.
- **Geometry-normal method:** use angle-weighted normals calculated from the full head's triangles for each shape. Preserve the game's normal/tangent data for shading; alter only base and morph positions.
- Actual WolvenKit mesh/morph import and GLB export, retaining all 105 shapes, UVs, 122 weighted bones and eight influences. A local resolver archive also lets the head export retain its original game weights and bind transforms; its geometry and all morph arrays are checked against the earlier unbound reference.
- 107 static cases: Basis, all 105 individual shapes, and Nathan's five-shape combination.
- 73 sampled poses across 22.1 seconds of the current decoded body/facial idle adapter. Sampling includes every ten frames and upper/lower eyelid surface-joint distance extrema found at 30 Hz. All 1,016 bones across the four source rigs map. This is not execution of the REDengine animation graph.
- Full-head triangle contact queries in those samples, including coplanar cases. Synthetic cases exercise narrow-phase behavior; a small all-pairs comparison checks that spatial pruning does not lose candidates. Degenerate triangles are separately reported.

## Measurements

| Offset method / amount | Worst static distance to corresponding lighting-normal plane | Contacting plate triangles in first idle sample | Maximum triangle contact pairs in sampled idle |
|---|---:|---:|---:|
| No offset control | −0.00001552 | 1,204 | 2,730 |
| Shading / 0.00005 | +0.00003589 | 32 | 182 |
| Shading / 0.0001 | +0.00008598 | 21 | 196 |
| Geometry / 0.00005 | −0.00005179 | 6 | 169 |
| Geometry / 0.0001 | −0.00010395 | 6 | 163 |

The last two negative static values occur because geometric and lighting normals can point in opposing directions in some individual eye shapes. They must not be hidden by reporting only the favorable saved-V combination. Both offset methods retain contacts in every sampled pose; the counts above distinguish plate triangles from triangle *pairs*.

Contacts concentrate in the upper eyelid crease and eye corners, rather than across the broad makeup area. Some closed-eye non-adjacent contacts already occur between the original head's own triangles; others are introduced by the offset. For example, geometry/0.00005 at frame 25 has 19 non-adjacent pairs already intersecting in the head and 12 newly intersecting pairs. Increasing the offset is therefore not a sufficient repair. The [contact classification](contact-analysis.json) and diagnostic renders distinguish these cases.

The geometry method adds morph records at vertices that previously needed no lighting delta. The packed shifted 10-bit format then represents an intended zero normal/tangent component as approximately `±1/1023`. The verifier permits **only** this observed new-zero-record quantization (maximum vector error 0.001693); all original nonzero lighting deltas must remain exact. Position morph error remains below 0.00001237. This is distinct from the large clipped-lighting problem previously fixed in experiment 004.

If the geometry-based approach is retained after the contact investigation, also review tiny offset-only deltas before packing: avoid introducing unnecessary morph records for changes below useful resource precision. That optimization must be measured separately, without discarding original head deformation or claiming those lighting deltas are already exact.

## Reproduction

From HQ, run the sequence below for `shading`, then repeat with `geometry`:

```powershell
python experiments/006-plate-clearance/build.py --method shading
python experiments/006-plate-clearance/verify_static.py
& 'C:/Users/Nathan/.bun/bin/bun.exe' projects/xf-appearance-studio/authoring/tools/sample_plate_clearance.ts
python experiments/006-plate-clearance/verify_posed.py
python experiments/006-plate-clearance/analyze_contacts.py
python experiments/006-plate-clearance/compare.py --archive-only
```

Then run `python experiments/006-plate-clearance/compare.py` to summarize both preserved runs. [Comparison](comparison.json) retains hashes and build locations. Build directories are unique and ignored; reports are source-controlled metadata. [Latest build](latest-build.json) deliberately remains unapproved for clearance.

Optional diagnostic renders, using only generated sampled geometry:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --disable-autoexec --python experiments/006-plate-clearance/render_contacts.py
```

Blue is the offset plate, grey is the head, red marks contacting plate triangles. These renders are geometry diagnostics, not game materials or a claim of visible in-game artifacts. Game-derived images stay under the ignored build directory.

## Next evidence needed

Classify which remaining contacts are render-visible rather than naturally occluded folds, then investigate a local constrained offset or boundary correction without gratuitously reducing makeup coverage. Preserve the neutral and constant-offset comparisons. Sampling does not cover every custom morph combination or every possible animation phase; triangle contacts are not a continuous collision proof or a global signed-volume test on this open head surface. Game depth/blending behavior remains separate and should be checked with the eventual batched material/selector session.

Source foundations: [plate intake and conversion](../004-plate-import/README.md), [idle extraction and solver provenance](../../research/animation/cc-idle.md), and [community credits](../../docs/community-credits.md). WolvenKit provides serialization/packing and resolver behavior; the Cyberpunk Blender IO Suite produced the facial bake; Three.js and our full-influence adapter supply the offline animated samples. Contact classification and offset construction are new project code.
