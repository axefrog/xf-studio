# Plate clearance under facial deformation

**Status:** superseded by [Experiment 012](../012-native-plate-bootstrap/README.md) — offset and morph-aware corrections of the owned cut reduced eyelid contacts but never removed them (the last post-packing candidate failed the dense 664-frame idle gate). Clearance work continued on the native-head reconstruction in 012. In-game evidence then showed the coincident plate breaking up close up, and packaging now lifts the plate 0.4 mm like the vanilla face decals ([experiment 017](../017-plate-depth/README.md)); the fitted candidates here were not adopted. The sections below are the historical record, oldest first; their "next" steps were carried into 012.

**Result: useful candidates and a repeatable contact test, but no release offset selected.** The unchanged cut-out has packing-related overlaps. Offsets improve it greatly, yet small eyelid folds/corners still contact the head. A positive distance at every corresponding vertex does not prove that the triangles between them stay outside the skin.

**Latest improvement:** native skin bytes now survive conversion in both the mesh and the morph resource's embedded base buffer. Exported weights match the original head exactly, instead of differing by up to 0.004329. The paired idle comparison isolates the correction from geometry/morph changes; residual eyelid contacts remain. Visibility tests show that some contacts are exposed, and a constrained-offset audit rejects an unbounded local extrusion as a universal solution. Details below.

The original cut-out is sound in the aspect examined here: **all 3,010 plate triangles map exactly to head triangles** using the established position/UV correspondence. No original Blender file or owned neutral master was modified. Nothing was installed into the game or MO2, and experiment 005 still uses its neutral control.

## What was tested

- Two amounts, `0.00005` and `0.0001` in mesh units. No uniform object scaling.
- **Shading-normal method:** offset the base along the game's lighting normal and adjust each position morph for its corresponding morphed normal.
- **Geometry-normal method:** use angle-weighted normals calculated from the full head's triangles for each shape. Preserve the game's normal/tangent data for shading; alter only base and morph positions.
- Actual WolvenKit mesh/morph import and GLB export, retaining all 105 shapes, UVs, 122 weighted bones and eight influences. A local resolver archive also lets the head export retain its original game weights and bind transforms; its geometry and all morph arrays are checked against the earlier unbound reference.
- 107 static cases: Basis, all 105 individual shapes, and the reference save's five-shape combination.
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
bun projects/xf-studio/authoring/tools/sample_plate_clearance.ts
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

The [posed-correction probe](research/corrective-next-step.md) now separates transported-offset errors from folded-surface contacts. Recomputed post-animation normals reduce closure contacts from 167/161 to 67/65, but even constrained diagnostic oracles retain 43/45 pairs. A 5× bounded oracle clears the first pose only. These are diagnostic constructions, not deliverable resources. The [fixed pre-skin feasibility study](fixed_feasibility.md) has now completed: 1,625 vertices meet the 0.00005 margin within a total 0.00025 displacement, seven require more movement, and three have certified opposing constraints. Independent verification reconstructs every constraint without an optimizer; all ten failures have checked certificates and no case is unresolved. This rejects the all-incident-plane fixed-shell model under these bounds, not every possible collision-free representation. No candidate was imported. Next inspect those marked crease/corner regions to distinguish exposed occluders from native internal folds before deliberately revising the constraints or representation. Preserve original coverage, native weights and the subsequent non-adjacent/visibility checks.

Use the now-classified exposed contacts to investigate a bounded correction that preserves useful makeup coverage. Keep original skin bytes in both resource buffers; do not treat a global larger offset, unconstrained extrusion, or broad deletion as a validated remedy. Preserve the neutral and constant-offset comparisons. Sampling does not cover every custom morph combination or every possible animation phase; triangle contacts are not a continuous collision proof or a global signed-volume test on this open head surface. Game depth/blending behavior remains separate and should be checked with the eventual batched material/selector session.

Source foundations: [plate intake and conversion](../004-plate-import/README.md), [idle extraction and solver provenance](../../research/animation/cc-idle.md), and [community credits](../../docs/community-credits.md). WolvenKit provides serialization/packing and resolver behavior; the Cyberpunk Blender IO Suite produced the facial bake; Three.js and our full-influence adapter supply the offline animated samples. Contact classification and offset construction are new project code.

## Failure-region classification follow-up

The [73-pose incident-face visibility audit](research/fixed-failure-classification.md) finds all 40 failure-region faces become exposed. Sixteen of 30 certificate entries are exposed at their decisive pose; vertices 5631, 5981 and 6471 retain entirely exposed failure certificates at the original margin/bound. Permanently deleting these faces or simply dropping hidden constraints is therefore not a validated remedy. The note defines the next explicit exposure-aware margin benchmark and subsequent finite-surface/contact gates, including previously untested active frame 490. No plate was changed.

## Exposure-aware margin follow-up

[Denser visibility and mixed-margin feasibility](research/visibility_margin.md) retain all original geometry and native weights. Of 2,920 tested face/poses, 2,901 are exposed and 19 sampled-hidden; ten cases previously classified hidden become exposed with wider views. Mixed positive/zero constraints permit three additional independent vertex corrections at the original margin, six at 0.00004 or 0.000025, but four severe crease vertices remain certified failures. Independent verification passes all 30 cases and rechecks the original 1,625 feasible vectors. No geometry was synthesized or imported. Next investigate finite-triangle distances and actual contacts with an explicit local orientation policy; further shrinking supporting-plane margins is not a promising correction strategy.

[Finite-triangle diagnosis](research/finite-contact.md) now compares closest points, signed local distance and actual local triangle contacts at the four severe vertices plus the opposite-side frame-490 control. Fourteen sampled plane failures project outside their finite face, confirming that the supporting-plane model can overconstrain a point. The two existing offsets nevertheless retain 65 distinct new nonadjacent contact pairs in these sampled neighborhoods/poses. No candidate or master changed; full all-pose/static/neighbor/import gates remain pending.

[A bounded finite-surface correction trial](research/finite-correction.md) now checks one exposed-face-guided, smoothly tapered numeric field across all 73 poses and 107 static cases. It stays below 0.00025 displacement but increases new nonadjacent pose contacts and fails static neighbor smoothness. An independent pairwise certificate shows 25 edges cannot satisfy the all-static neighbor limit by changing base positions alone while all 105 morph position deltas remain fixed. No mesh/morph resource was imported or promoted; a morph-aware correction or a different representation remains research work.

[The morph/contact boundary map](research/morph-contact-boundary.md) places those 25 incompatible edges in 13 narrow eyelid UV groups, identifies the worst `h041_eyes` / `h201_eyes` edge witness and joins them to the previously ray-tested exposed contact faces. None of the certified edges directly touches the new non-adjacent exposed contact faces in the frame-0/25 subset; the closest at frame 25 is seven plate edges away. This is diagnostic localization, not a corrected plate. It makes explicit that a future morph-aware smoothness edit also needs a separate finite-triangle contact objective and all existing acceptance gates.

[The morph-aware numeric follow-up](research/morph-aware-checkpoint.md) now removes the 25 static edge incompatibilities without loosening the original caps. A contact-guided local step cuts new nonadjacent contacts to seven pairs across 107 static cases and 48 occurrences across 73 sampled idle poses, but still fails both finite-contact gates. No conversion or replacement plate was selected; the original master remains intact.

[The finite-pair follow-up](research/finite-pair-followup.md) uses actual intersecting triangle pairs and independently checks its bounded morph-aware numeric field. It reduces new nonadjacent contacts to four static pairs and 14 sampled-pose occurrences while satisfying the 107-shape displacement and neighbor budgets. Both finite-contact gates still fail; no resource was imported or master changed.

[The coupled eye-morph follow-up](research/coupled-morph-optimization.md) clears all four static pairs and the original two failing idle phases within the same shape budgets, but independent full sampling finds six new pairs at frames 120 and 170. Expanded local constraints did not yield an accepted field. No resource or master was changed.

[The crease-interior resource roundtrip](research/crease-resource-roundtrip.md) converted the later numerically clear candidate with exact native skin bytes in **both** serialized buffers, unchanged topology/UVs and all 105 morphs. Independent post-packing checks nevertheless found two new static contacts, five sampled-pose contact occurrences and 18 static neighbor-limit violations. The candidate remains rejected; the owned master and game installation remain unchanged.

[The post-packing crease follow-up](research/postpack-crease-checkpoint.md) finds a separate research candidate whose imported resources retain native skin bytes and pass all 107 static / 73 sampled-pose contact and neighbor gates. Minimum measured neighbor slack is 1.129 µm before import and 1.244 µm afterward; formerly failing pair gaps are at least 2.118 / 1.412 µm. A nearby input crosses a packing-bin threshold and sharply reduces packed edge slack, so this is not a released master. No asset was installed or promoted.

**Denser idle gate fails:** [all 664 baked 30 Hz frames](research/dense-idle-contact-gate.md) reproduce the original 73 head poses and affine skin matrices exactly, but reveal three new nonadjacent plate/head contacts at previously unsampled frames 298–299. Separate finite-triangle axes confirm overlap while the native head face pairs remain separated. The post-packing candidate remains research only and must not replace the owned master.
