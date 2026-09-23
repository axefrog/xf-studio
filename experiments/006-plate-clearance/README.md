# Plate clearance under facial deformation

**Result: useful candidates and a repeatable contact test, but no release offset selected.** The unchanged cut-out has packing-related overlaps. Offsets improve it greatly, yet small eyelid folds/corners still contact the head. A positive distance at every corresponding vertex does not prove that the triangles between them stay outside the skin.

**Latest improvement:** native skin bytes now survive conversion in both the mesh and the morph resource's embedded base buffer. Exported weights match the original head exactly, instead of differing by up to 0.004329. The paired idle comparison isolates the correction from geometry/morph changes; residual eyelid contacts remain. Visibility tests show that some contacts are exposed, and a constrained-offset audit rejects an unbounded local extrusion as a universal solution. Details below.

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

## Native skin-byte preservation

The authored cut-out's normalized weights match the native head within 1.2e-7. Conversion introduced a 0.004329 maximum difference in 1,606 of 1,635 exported vertices. WolvenKit source explains the extra quantization: exporting normalizes the packed byte weights, then importing rounds the normalized floats to a new byte distribution. Our [retention adapter](retain_head_weights.py) transfers the original bytes through the established vertex mapping, remaps bone indices by name, and asserts that every non-skin byte remains unchanged. Both the standalone mesh and the morph file's independent base buffer need this treatment; a mesh-only trial did not correct exported morph weights.

The new geometry/0.00005 and geometry/0.0001 trials pass resource round-trips and the original 107 static checks. Original head-to-plate weights now agree **exactly** in the exported morph GLBs. [Paired comparison](skin-comparison.json) verifies identical non-skin attributes, all 105 morph arrays, triangle indices, source animation and head poses. Across 73 idle samples the correction changes plate positions by at most 0.00001788 mesh units. This is a real conversion-fidelity fix, but not the main cause of the corner contacts:

| Amount | Maximum contact pairs before / after retention | Samples improved / worsened / equal |
|---|---:|---:|
| 0.00005 | 169 / 167 | 7 / 0 / 66 |
| 0.0001 | 163 / 161 | 3 / 1 / 69 |

The sampled head/plate comparison does not prove the game's shader skinning formula. Keeping the same original packed bytes avoids depending on that formula being the exporter's normalization. Future cut-out builds should retain both buffers. Earlier controls and experiment 005 remain unchanged, and no corrected candidate has been installed or selected for release.

## Contact visibility and local-offset limits

[Visibility evidence](contact-visibility.json) samples nine points on each actual intersection segment from front, left/right 30-degree and above/below 20-degree views. Blender BVHs test the head alone and opaque head plus plate. Geometry is recentered before float32 ray queries. Thirteen representative candidate/pose cases cover first-pose and maximum-contact/eyelid-closure cases from three preserved builds, not the entire continuous animation. All segments were resolved. The exposed-contact counts are unchanged between 1e-7 and 1e-6 visibility tolerances.

With retained weights, geometry/0.00005 exposes 12 of 14 contact pairs in the first pose and 104 of 167 at frame 25. Geometry/0.0001 exposes 6 of 14 and 67 of 161, respectively. At closure, three/five exposed non-adjacent pairs are newly introduced contacts rather than contacts already found within the native head. These are geometric exposure results; texture coverage, game culling, depth precision and transparency still determine actual visible pixels. Per-contact/per-view details remain in each ignored build, with hashes in the summary.

[Constrained-offset audit](constrained-offset-audit.json) solves for the shortest per-vertex displacement outside all adjoining triangle planes. The neutral case has finite solutions below 3.42 times the requested offset. Across 107 static cases, however, several eye shapes have unresolved constraints or require large movements; one reaches 151 times the requested amount. The saved five-shape combination also has two vertices above the experimental four-times movement budget. No such extrusion was applied. The solver reports unresolved cases explicitly and tests plane, corner, redundant, incompatible and rotated synthetic constraints. It cannot solve non-adjacent folds or guarantee animated clearance even where local constraints succeed.

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

For the native-weight variant, use `build.py --method geometry --preserve-head-weights`, then the same static/sampling/posed/analysis sequence above and `compare.py`. `compare_skin_trials.py` checks the latest retained-weight trial against the most recent completed geometry control. `constrained_offset.py` runs the local-plane audit without changing resources. Run the visibility study after preserving the compared reports:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --disable-autoexec --python experiments/006-plate-clearance/contact_visibility.py
```

Optional diagnostic renders, using only generated sampled geometry:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.0/blender.exe' --background --factory-startup --disable-autoexec --python experiments/006-plate-clearance/render_contacts.py
```

Blue is the offset plate, grey is the head, red marks contacting plate triangles. These renders are geometry diagnostics, not game materials or a claim of visible in-game artifacts. Game-derived images stay under the ignored build directory.

## Next evidence needed

Use the now-classified exposed contacts to investigate a bounded correction that preserves useful makeup coverage. Keep original skin bytes in both resource buffers; do not treat a global larger offset, unconstrained extrusion, or broad deletion as a validated remedy. Preserve the neutral and constant-offset comparisons. Sampling does not cover every custom morph combination or every possible animation phase; triangle contacts are not a continuous collision proof or a global signed-volume test on this open head surface. Game depth/blending behavior remains separate and should be checked with the eventual batched material/selector session.

Source foundations: [plate intake and conversion](../004-plate-import/README.md), [idle extraction and solver provenance](../../research/animation/cc-idle.md), and [community credits](../../docs/community-credits.md). WolvenKit provides serialization/packing and resolver behavior; the Cyberpunk Blender IO Suite produced the facial bake; Three.js and our full-influence adapter supply the offline animated samples. Contact classification and offset construction are new project code.
