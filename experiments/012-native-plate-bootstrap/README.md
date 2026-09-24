# Native head eye-plate bootstrap — 25 September 2026

**Offline candidate, not an accepted preview plate.** This experiment reconstructs
the historical expanded eye cut from the installed Cyberpunk 2077 2.31 female
head. Running it needs no `.blend`, old Eye Artistry generator or Nathan-specific
authored file. The triangle selection is tracked as 105 inclusive ranges in
[`selection.json`](selection.json), while every generated GLB, JSON resource,
archive and binary remains under ignored `generated/`.

The selection was established once by matching all 3,010 triangles of Nathan's
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
