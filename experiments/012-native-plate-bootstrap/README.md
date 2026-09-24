# Native head eye-plate bootstrap — 25 September 2026

**Status:** paused pending in-game evidence — the exact native-head cut is reproducible with native skin bytes retained, but every lifted clearance candidate has been rejected (most recently the packed candidate, on subframe idle contacts). Further fitting waits for the first in-game smoke test to show whether residual eyelid contacts are actually visible.

## Current state

- **Neutral cut: reproducible, no clearance.** The 3,010-triangle / 1,620-vertex cut is rebuilt from the installed 2.31 head. Native skin bytes are restored in both the mesh and morph buffers. Its surface coincides with the head, so it has no designed outward clearance.
- **Every correction so far is rejected.** Candidates were checked in this order (details in the dated sections below):
  - The [direct transfer](#native-topology-correction-transfer-diagnostic--25-september) of Experiment 006's candidate failed.
  - A [constrained repair](#constrained-native-repair-numeric-pass-packed-failure--25-september) passed numerically but failed after WolvenKit readback.
  - All [three readback-compensation trials](#measured-resource-readback-compensation-three-rejected-trials--25-september) failed.
  - A [localized packed candidate](#local-packed-resource-candidate-sampled-gate-passes--25-september) passed the 107 static / 73 pose / 664 frame sampled gates, with only +0.539 µm minimum slack. [120/240 Hz subframe sampling](#subframe-acceptance-rejects-the-packed-candidate--25-september) then found new finite contacts (15 across the full loop, two in the focused window), so it was rejected.
  - Four [bounded subframe fits](#bounded-subframe-correction-attempt--25-september) failed numerical screening, so no new resource round trip was made.
- **Nothing was promoted.** No plate reached the preview, packaging, the owned master, the game or MO2.
- **Why the work is paused.** Private Blender renders showed the subframe contact faces as mostly obscured or a thin edge. Those renders omit the eye, cards and game materials, so they cannot establish visibility. The first in-game smoke test uses the neutral [Experiment 004](../004-plate-import/README.md) plate ([runtime preflight card](../../research/authoring/first-makeup-runtime-preflight-2026-09-25.md)) and should show whether eyelid contacts are visible in practice. Any resumed attempt must meet the requirements in the final section.

## Original checkpoint

**Offline candidate, not an accepted preview plate.** This experiment reconstructs
the historical expanded eye cut from the installed Cyberpunk 2077 2.31 female
head. Running it needs no `.blend`, old Eye Artistry generator or maintainer-specific
authored file. The triangle selection is tracked as 105 inclusive ranges in
[`selection.json`](selection.json), while every generated GLB, JSON resource,
archive and binary remains under ignored `generated/`.

The selection was established once by matching all 3,010 triangles of the
owned `.010` cut to native head triangles using exact position plus both UV sets,
then checking winding and all 105 position morphs. This historical derivation is
provenance for the **selection**, not a required input to reproduce the output.
The source head mesh/morph JSON SHA-256 values in the selection file gate the
2.31 geometry revision. A different game/resource revision fails closed pending
a fresh correspondence and coverage audit.

## Reproduce privately

Prepare the two extracted installed-game resources and their WolvenKit serialized
JSON files using the existing [Experiment 004 intake](../004-plate-import/README.md).
The morph resource is
`base/characters/head/player_base_heads/player_female_average/h0_000_pwa__morphs.morphtarget`;
its `baseMesh.DepotPath` identifies the linked native mesh. Point `--extracted-root`
to the directory containing their depot paths. The commands below use named
placeholders for those prepared inputs and write only ignored output:

```powershell
$native = 'PATH_TO_EXTRACTED_ROOT'
$meshJson = 'PATH_TO_BASEHEAD_MESH_JSON'
$morphJson = 'PATH_TO_HEAD_MORPH_JSON'
$wk = 'PATH_TO_WolvenKit.CLI.exe'
$private = 'experiments/012-native-plate-bootstrap/generated'
python experiments/012-native-plate-bootstrap/export_head.py --extracted-root $native --native-morph-json $morphJson --wolvenkit $wk --output "$private/export"
python experiments/012-native-plate-bootstrap/derive.py --head-glb "$private/export/head.glb" --native-mesh-json $meshJson --native-morph-json $morphJson --output "$private/derived"
python experiments/012-native-plate-bootstrap/roundtrip.py --derived "$private/derived" --native-mesh-json $meshJson --native-morph-json $morphJson --wolvenkit $wk --output "$private/roundtrip"
```

The scripts require Python with NumPy, the project-local .NET morph importer,
and WolvenKit CLI. `export_head.py` builds the adapter, packs a private resolver
for the linked native mesh, and exports a bone-bound head GLB. `derive.py`
selects the pinned triangle IDs, compacts their vertices in ascending native
index order, and copies **every** base attribute and morph accessor byte from
the head GLB. It checks the selection, UV0, all morphs, nondegenerate base and
individual-morph triangles, open boundaries and source mesh/morph skin-row
agreement. It also verifies that every bound GLB vertex retains the native
head's bone-index order and normalized source weights before using its index
as the native packed-byte lookup. `roundtrip.py` creates private mesh/morph templates, imports the cut,
restores native packed skin bytes in both independent resource buffers, and
audits serialized output by source vertex and bone name. Import and final
resources are never packed into a distributable mod or installed.

## Measured local result

| Gate | Result |
|---|---|
| Native extracted mesh / morph SHA-256 | `e877b91a7b3f6bd678f0365d484a0dd32f7d7d4d6c13b213d2a7e73fcce874c6` / `3e10c3f75fbefb0a9ddcf907a6275ca8a30aad915ad34acadb817ae4c9297b9e` |
| Bound head / selected GLB SHA-256 | `0f14804b80b279d28ab84503c9595292e20e0141eee959e67fc63b805f12f730` / `0571c4da09595009dbc7e4e305518e95f18a58ba4c59bf51e97e7d56d0f060ea` |
| Selection | 3,010 native triangles, 1,620 native vertices, four components of 790/790/20/20, 226 boundary edges in six closed loops; no non-manifold edge |
| Surface | Minimum base triangle area `1.8677e-8`; minimum across the 105 individual morphs `2.0872e-9` mesh units² |
| Exact source accessors | UV0/UV1 and all 105 base-to-morph accessor arrays exactly copied into the derived GLB |
| Native skin after mesh/morph serialization | All eight index/weight slots equal their source head rows by bone name in **both** buffers; 1,595 vertices required weight-byte restoration after importer normalization |
| Bound GLB/source alignment | Bone-index slots exactly match native resource order; maximum normalized weight difference `9.55e-8` across the full head |
| Round trip | Triangle indices and both UV sets exact; max base position error `2.614e-6`, max morph position error `9.426e-6` mesh units; morph shading deltas exact |
| Private resource SHA-256 | mesh `3f7fc7c9d25b2a44c51bcd383db8b939c544332552cee98040151cd38054e0c1`; morph `fba40259949c924dcf716e7cbc4f2680984f0355a407915ceb7c1423c1946934` |

The independently checked private manifests are `generated/derived/derivation.json`
and `generated/roundtrip/roundtrip-report.json` in a fresh run. The local
validation used WolvenKit CLI 8.17.4, the project morph importer and the
previously extracted installed 2.31 head. It reproduced the same bound-head
SHA-256 as Experiment 006 and a deterministic selected GLB hash on repeat.

## Gate before preview use

This is an **exact neutral cut**: its surface coincides with the head and has
no designed outward clearance. Experiment 004 measured negative signed plane
distance after resource packing; [Experiment 006](../006-plate-clearance/README.md)
found residual and sometimes newly exposed eyelid contacts in offset variants.
The later quantization-aware candidate also failed a denser 664-frame idle
contact check. This experiment proves reproducible source geometry and native
skin retention; it does **not** prove a safe lifted surface, continuous posed
clearance, game shading or runtime rendering. Keep it out of production preview
and packaging until a clearance candidate passes the existing static, morph,
packed-resource and dense posed-contact gates. No game launch occurred.

WolvenKit and the existing project adapter are credited in
[`docs/community-credits.md`](../../docs/community-credits.md). The selected
triangle IDs are an authored coverage decision expressed against a game asset;
they do not embed game geometry. No extracted game resource is tracked.

## Native-topology correction transfer diagnostic — 25 September

The [transfer diagnostic](transfer_diagnostic.py) tests whether the earlier
rejected, morph-aware **packed** crease candidate can seed this exact native
cut. It reads that candidate, joins its 1,635 vertices to the native cut's
1,620 vertices by head vertex ID, and averages each duplicated vertex's base
and 105 morph residuals. This is a deterministic numeric proposal only. The
script asserts the pinned source hashes, exact native base/morph correspondence,
identical selected head faces, and matching 73-pose samples within the 664-frame
bake. It then checks the unchanged 0.00025 displacement limit, edge-specific
`min(0.00005, quarter source edge)` cap, and **finite** newly introduced
nonadjacent triangle contacts for all 107 static cases and the measured idle.

The [asset-free result](transfer-diagnostic.json) rejects the transfer. Thirteen
head vertices were duplicated in the prior import, and two versions of one
vertex differ by up to 0.00006975 in base offset (0.00007012 in a morph
offset). Collapsing them produces 328 neighbor-limit violations across seven
native edges; the worst exceeds its cap by 0.00000984. The transferred shell
introduces two static eye-morph contact pairs (`h031_eyes`, `h141_eyes`) around
head vertices 6461–6464. All 73 selected idle poses are clear, but the denser
664-frame bake reproduces three introduced pairs at frames 298–299. Those
are concrete failures of this transfer, **not** a proof that no native-topology
correction exists. The pairwise necessary smoothness test finds no base-only
incompatibility certificate among the seven failing edges; a constrained
morph-aware repair remains a separate experiment. No resource was imported or
promoted, and exact native skin bytes were not re-audited for this failed
numeric proposal.

With the ignored `derived/` output from the reproduction above, the retained
private 73-pose source build, prior rejected packed GLB, and optional dense
bake available, reproduce from the repository root:

```powershell
python experiments/012-native-plate-bootstrap/transfer_diagnostic.py `
  --head PATH_TO_PINNED_HEAD_GLB `
  --native experiments/012-native-plate-bootstrap/generated/derived/xfs_bootstrap_eye_plate.glb `
  --native-map experiments/012-native-plate-bootstrap/generated/derived/vertex-map.json `
  --prior-packed PATH_TO_REJECTED_PACKED_CREASE_GLB `
  --prior-map experiments/004-plate-import/head-shading-transfer.json `
  --poses PATH_TO_RETAINED_73_POSE_BUILD `
  --dense PATH_TO_664_FRAME_BAKE `
  --output experiments/012-native-plate-bootstrap/generated/transfer-report.json `
  --summary-output experiments/012-native-plate-bootstrap/transfer-diagnostic.json
```

The tracked summary contains identifiers, counts, margins and input hashes;
the ignored full report carries every failed static edge and pair. This used
only the previously credited project geometry/contact tools, NumPy and
game-derived inputs. No new external source informed the correction.

## Constrained native repair: numeric pass, packed failure — 25 September

A second bounded search started from the failed transfer above. It fitted one
shared base correction on the 12 endpoints of the seven failing native edges,
then fitted separate `h031_eyes` and `h141_eyes` corrections against their two
finite static triangle pairs. Two local `h091_eyes` fits addressed dense idle
frames 298–299 and the newly exposed frame-169 pair. The search kept the
**0.00025 total displacement** and every original per-edge cap. Its
[parameterized search scripts](repair_smooth_search.py) and the two [static](repair_static_contacts.py)
and [posed](repair_pose_contacts.py) finite-contact fits regenerate the ignored
numeric field; the [independent verifier](verify_repair.py) imports no optimizer.
The reproduced NPZ has SHA-256
`e17284d81dc2a2bd38f25be909e5ac7ba829a42321c056bf91cf366fcf6046d2`.

| Gate | Numeric field | Float32 import GLB | Final WolvenKit readback |
|---|---:|---:|---:|
| New static nonadjacent pairs, 107 cases | 0 | 0 | **1** (`h151_eyes`, plate 1123/head 2311) |
| Static neighbor violations | 0 | 0 | **14** |
| Minimum static neighbor slack | 0.100000 µm | 0.100008 µm | **−6.574152 µm** |
| New contact occurrences, 73 idle samples | 0 | 0 | **44** across 14 frames |
| New contact occurrences, 664 baked idle frames | 0 | 0 | **359** across 111 frames |
| Maximum static displacement | 0.0000869652 | 0.0000869652 | 0.0000904105 |

The [numeric](repair-numeric-evidence.json), [float32](repair-float32-evidence.json)
and [packed](repair-packed-evidence.json) summaries pin inputs and all measured
gates. Full per-case and per-frame reports remain ignored. The float32 GLB
retains the native triangle/UV/skin/shading accessors and all 105 morph names;
only position accessors were edited. The private resource round trip then
replaced source-native skin bytes in **both** buffers and independently checked
them in serialized mesh/morph JSON. Triangle order and both UV sets remained
exact; all morph identities survived. The resulting private mesh/morph SHA-256
values are `1ff943f670d1bb5ab2d90f91c4f0b019d572b5e719b3e8a29c38baf82b68205e`
and `9ebb3f496b304c30ee84d859100339dd9eb1948fddd1e7e6f52cd51cad63bf29`.
They are **rejected research outputs**, never preview or package inputs.

The failure arises **after** float32 GLB creation, during WolvenKit resource
serialization/readback. Maximum observed component differences from import GLB
to exported resource GLB were 2.241 µm in base positions and 9.425 µm in morph
position deltas. The [crossed-array diagnostic](quantization-attribution.json)
isolates their effects over the same 107 static cases and 73 poses:

| Readback arrays substituted into the passing float32 candidate | Static edge violations | Static new pairs | Posed pair occurrences |
|---|---:|---:|---:|
| Packed base only | 4 | 2 | 3 |
| Packed morph deltas only | 8 | 1 | 22 |
| Packed base and morph deltas | 14 | 1 | 44 |

These hybrid arrays are diagnostic counterfactuals, not resource builds. Both
readbacks contribute, and their combined effect is nonlinear. The largest
**observed** increase in an edge gap across the 107 cases is **12.590117 µm**
(`h091_eyes`, head edge 5558–5793); that edge had ample slack and did not fail.
The worst failed edge (`h111_eyes`, 6461–6464) gained **8.704263 µm** of gap
against **2.130110 µm** of float32 slack. A future search needs a measured
resource-stage margin: more than 12.590117 µm of input edge slack would cover
the largest increase in **this one serialization**, but this is not a guarantee
for another input or WolvenKit version and may be impossible on short edges.
Constrain both input and actual packed output, seek positive packed slack and
finite-triangle separation, and rerun the full static/73/664 gates. A 2 µm
prepack separating-axis target and 0.1 µm minimum edge slack were insufficient.
No cap, coverage or failure classification was relaxed to obtain the numeric
pass. Continuous-time motion, combined-scene visibility and game rendering
remain unproven even for a future packed survivor.

To reproduce the search, use the same ignored head/neutral/prior GLBs and
73/664 samples whose hashes appear in the evidence JSON. Run the three search
scripts in order: `repair_smooth_search.py` with `--head --native --native-map
--prior-packed --prior-map --scipy-path --output`,
`repair_static_contacts.py` with `--head --native --input --scipy-path --output`,
then `repair_pose_contacts.py` twice, first with `--frames 298 299
--expected-hits 3`, then `--frames 169 298 299 --expected-hits 1`; pass
`--head --native --input --prior-map --dense --scipy-path --output` each time.
Use [the verifier](verify_repair.py) on the final NPZ with `--candidate`, then
[prepare the private GLB](prepare_repair_import.py), run the existing
`roundtrip.py` into a new ignored directory, and verify its bound GLB with
`--packed-glb --roundtrip-report`. `quantization_attribution.py` takes the
float32 and packed GLBs for the crossed-array comparison. The named evidence
files include every exact input hash so a different local source fails review.

## Measured resource-readback compensation: three rejected trials — 25 September

The third bounded experiment used [the readback compensation script](repair_readback_compensation.py)
to modify only the private native cut's base and 105 morph **position**
accessors. Trial 1 subtracted the earlier measured WolvenKit import-to-readback
error from the passing numeric field. Trial 2 multiplied that correction by
1.2. Trial 3 adjusted trial 1's import by its newly measured error against the
same passing numeric target. The input GLBs kept exact native triangle order,
both UV sets, and all other source accessors, including shading and skin. Each
trial was separately imported as a mesh and morph resource, had exact native
skin bytes restored and independently audited in **both** serialized buffers,
then was exported and checked by `verify_repair.py` against all 107 static
cases, 73 selected idle poses, and 664 dense idle frames. The displacement,
edge caps, and finite-contact test were unchanged.

| Actual packed readback | New static pairs | Static edge violations | 73-pose new pairs | 664-frame new pairs |
|---|---:|---:|---:|---:|
| Earlier uncompensated candidate | 1 | 14 | 44 | 359 |
| 1.0× measured compensation | 0 | **1** (−0.291 µm slack) | 0 | **1**, frame 299 |
| 1.2× measured compensation | 0 | **3** (−3.413 µm) | 0 | **1**, frame 299 |
| Iterated correction from 1.0× | 0 | **9** (−2.908 µm) | 0 | **1**, frame 298 |

The best packed trial is close but still **fails** the unchanged gates. A
global scalar or blind error iteration is unstable at this serialization
resolution: both later trials worsened edge compliance and moved or retained
the dense contact. The [asset-free evidence](repair-readback-search.json) pins
every import GLB, packed GLB, private mesh and morph hash, along with the exact
input and gate counts. Full private per-case and per-frame reports remain in
ignored `generated/`. No candidate was promoted to the preview, package,
owned master, game, or MO2.

A subsequent attempt should fit **localized** readback-aware slack at the
remaining `h091_eyes` edge and the finite frame-298/299 witness, reserve a
strict positive packed margin on nearby short edges, and re-evaluate after
each actual mesh+morph serialization. The three failures do not establish an
impossibility result. Even a future sampled packed pass would still require
separate continuous-motion, combined-scene visual, and game-runtime review.

## Local packed-resource candidate: sampled gate passes — 25 September

A bounded follow-up found a **private offline candidate** that passes the
unchanged gate **after actual WolvenKit mesh+morph serialization/readback**.
The starting point was the 1.0× compensation trial above. The local
[`h091_eyes` fit](repair_local_packed.py) moved only 17 native-cut vertices'
one morph position field to separate the frame-298/299 finite witnesses;
its packed resource cleared all 664 dense frames but retained the short
head-275–278 edge breach. The [local base fit](repair_local_base_edge.py) then
worked against each measured packed result, constraining all 107 static
neighbor cases. The first base fit cleared edges but exposed one frame-298
finite contact. The second cleared that contact but created three packed edge
breaches. The final fit **froze head vertex 275** and adjusted neighboring
edge endpoints, retaining the contact separation while clearing the breaches.
One-axis and 10 µm proposed fits that failed local numeric contact checks
were not imported. The [hash-pinned evidence](repair-local-readback-evidence.json)
records all four actual packed trials and those discarded proposals.

| Independent gate on final actual readback | Result |
|---|---:|
| 107 static cases: new nonadjacent finite pairs / neighbor violations | **0 / 0** |
| Minimum static neighbor slack / maximum displacement | **+0.539 µm** / 0.0000870 mesh units |
| 73 selected idle poses: new finite pairs | **0** |
| 664 dense idle frames: new finite pairs | **0** |
| Mesh and morph-base native skin bytes / triangle order / UV0 and UV1 / 105 morph identities | **Verified** |

The final private mesh and morph SHA-256 values are
`ad744238134f3d72721047829efd823ace6cc7bce43b214506a15e4bc2e873ee`
and `d462fb41f5fdcb741158ff64de1cbcce061b2f313d932f1bb7aaa41c63f2651a`;
the exported readback GLB hash is
`8e9c76b445ec746904bd8d24bfdf93f78f09d7627ffc8b3d4b337d8b524c6499`.
Both native skin buffers passed the exact source-row audit. The input GLB
left triangles, UVs, skin and shading accessors untouched; only base and
morph **position** accessors changed. The measured WolvenKit normal/tangent
readback differences remain within the established round-trip audit bounds.
The final witness-specific packed margins are 2.907–4.176 µm for the repaired
edges and 3.574–4.440 µm of separating-axis clearance for the tracked
frame-298/299 finite triangle pairs.

The passing mesh, morph, GLB and full verifier reports remain under ignored
`generated/local-base-3-roundtrip/` in the isolated experiment worktree;
only code and asset-free evidence are tracked. To reproduce, use the exact
hashed neutral head, derived cut, prior packed/import pair, 73-pose build and
664-frame bake listed in the evidence. Run `repair_local_packed.py` against
the first compensated packed/import pair at 4 µm edge/contact targets. Then
run `repair_local_base_edge.py` successively against each preceding packed
and imported pair at: (1) 4 µm edge target, (2) 2 µm edge and 4 µm contact
targets with `--dense --prior-map`, and (3) `--all-failed --freeze-head 275`
with a 4 µm target. For **each** generated input, run `roundtrip.py` into a
new ignored output directory, followed by independent `verify_repair.py`
with `--packed-glb --roundtrip-report --poses --dense`; reject every failed
result. The numeric predicted field in each ignored import directory can be
checked separately with `verify_repair.py --candidate` but is not a substitute
for a resource readback. The private hashes and reports make the exact
passing artifact identifiable without tracking game-derived bytes.

**Acceptance remains limited.** The +0.539 µm minimum sampled edge slack is
narrow. The 107 static cases and 664 sampled frames cannot prove continuous
motion clearance, combined-scene appearance, or runtime rendering. No plate
was promoted to production preview, packaging, the owned master, the game,
or MO2. Those later gates need separate evidence before adoption.

## Subframe acceptance rejects the packed candidate — 25 September

The exact packed GLB above **fails** a finer idle check. The new
[`sample_plate_subframes.ts`](../../projects/xf-studio/authoring/tools/sample_plate_subframes.ts)
evaluates the same decoded body and facial clips through the existing
`IdleAnimation` and native-weight skin adapter at requested clip times. It
reconstructs the 1,620 native-cut affine skin matrices and all 7,186 head
vertices at each time. It does **not** linearly interpolate the 30 Hz baked
positions. The independent [subframe verifier](verify_idle_subframes.py) uses
the unchanged finite, nonadjacent `new_pairs` checker and a separate
finite-triangle separating-axis calculation. Every included original 30 Hz
head and affine sample agrees exactly with the prior bake (maximum component
error zero).

| Sweep | Samples | Original 30 Hz overlap | New contact occurrences |
|---|---:|---:|---:|
| Local frames 295–303, 240 Hz | 65 | 9/9 exact | **2** at 9.941667 s |
| Whole loop 0–22.1 s, 120 Hz | 2,653 | 664/664 exact | **15** across four times |

The full-loop contacts occur at 3.991667 s (seven pairs), 9.941667 s (two),
16.341667 s (three), and 16.350000 s (three). The 9.941667 s plate-face-795
pair penetrates by a measured separating-axis interval of 0.068 µm while its
native head source pair remains separated by 1.376 µm. The largest measured
candidate overlap in the sweep is 2.978 µm at 3.991667 s. These are newly
introduced nonadjacent **finite triangle** pairs under the same classification
as the earlier gates; they are not inferred from vertex proximity. The
previous 30 Hz static edge slack remains +0.539 µm, and the originally fitted
frame-298/299 witness pairs retain 3.574–4.686 µm of positive SAT separation
at their 30 Hz samples. Those positive margins did not protect neighboring
triangles between frames. [Asset-free evidence](subframe-contact-evidence.json)
records every contact time, face pair, native comparison, hashes and limits;
full private reports and samples remain ignored.

Three private Blender 5.0 Workbench renders show the head and false-colour
plate eye region at the three distinct contact intervals. At normal 1200×800
view the shell has no obvious large tear. The marked face is mostly obscured
at 3.991667 and 9.941667 s, and appears as a thin red edge at 16.341667 s.
The render omits eye globe, cards, textures and game materials, so it cannot
confirm visibility or appearance. Its PNGs are ignored; the evidence records
their hashes and the render script remains reproducible. No game or MO2 file
was changed.

To reproduce privately, use the exact hashed head, native map, clips and
passing packed candidate above. From `projects/xf-studio/authoring`, install
the pinned dependencies and run `sample_plate_subframes.ts` with arguments
`SOURCE_BUILD NATIVE_MAP ASSET_ROOT OUTPUT RATE_HZ FIRST_30HZ_FRAME
LAST_30HZ_FRAME`: first `240 295 303`, then `120 0 663`, writing to separate
ignored output directories. From the repository root, run
`verify_idle_subframes.py --head --native --native-map --prior-map --packed
--roundtrip-report --packed-verification --dense --subframes --output` on each
sample directory. It asserts the exact packed GLB/resource proof and 30 Hz
overlap before checking all subframes. The ignored diagnostic PNGs can be
recreated with `render_subframe_contacts.py` in Blender 5.0 using an absolute
ignored `--output` path.

**The candidate is rejected for acceptance and remains research-only.** The
120/240 Hz samples establish failure, not a complete continuous-time contact
inventory. The live REDengine graph, full visual context and game rendering
remain untested; no production plate was promoted. A next correction must
include between-frame finite-contact constraints for all three discovered
intervals and then rerun packed-resource, static, selected-pose, 30 Hz, and
subframe gates without relaxing the displacement or neighbor limits.

## Bounded subframe correction attempt — 25 September

The [local fit script](fit_subframe_contacts.py) tested four deterministic
packed-space `h091_eyes` proposals against the exact retained packed GLB.
It used the 15 measured 120 Hz contact pairs at ticks 479, 1193, 1961 and
1962, the unchanged static neighbor cap, and explicit positive target
margins. The fit uses the measured serialized geometry and head skin-affine
fields. It keeps base geometry and the other 104 morph fields fixed; it can
only write an import GLB after its numerical static and local subframe
screens pass.

The raw shortest-axis fit failed its contact constraints. A coherent-axis
fit cleared all 15 original contact constraints with +0.35 µm static edge
slack in its predicted field, but created 16 contacts on neighboring faces
at ticks 477, 479 and 1192–1196. Adding 14 of those neighboring witness pairs
made two further fits fail the numerical contact constraints; one also
violated six static edge checks across the eye and saved-V cases. The exact
options, private report hashes and measured values are in
[asset-free evidence](subframe-fit-negative-evidence.json). Private reports
remain under ignored `generated/subframe-fit-{1,2,3,4}-repro/`.

No proposal survived even the local numerical screen, so this bounded
attempt used **zero new WolvenKit round trips** and did not claim an
independent 107/73/664 or full 120/240 Hz pass. The original packed/import
pair and both serialized resource hashes remain preserved privately and
unchanged. No production, game, MO2, authored master or draft asset changed.
This result is a local `h091_eyes` fit obstruction, not a proof that all
corrections are impossible. A further attempt would have to coordinate the
adjacent 794–803/1227 faces and the old frame-298/299 witnesses, retain
native skin bytes in **both** resource buffers, allow for measured WolvenKit
readback shifts, and earn positive margins in the unchanged independent
static/73/664 and finer subframe gates before promotion.
