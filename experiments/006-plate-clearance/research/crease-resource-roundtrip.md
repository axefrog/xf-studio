# Crease-interior candidate: serialized resource gate fails

24 September 2026. The exact ignored numeric candidate from the [crease-surface checkpoint](crease-surface-checkpoint.md), SHA-256 `3600f54e9a53e3b95dc456ae8cfccbf0611d8f762146ebb5f13e7f5b25fffb34`, was converted into **separate** `.mesh` and `.morphtarget` resources and exported again. This was an offline study. The owned Blender master, experiment-005 package, game installation and MO2 were not changed. The candidate is **not accepted**: resource packing introduces new finite triangle contacts and breaks static neighbor limits.

## Independent readback

The [conversion script](../roundtrip_crease.py) applies the NPZ base and all 105 morph corrections to the native-weight geometry/0.00005 source GLB, imports a mesh and morph resource, restores original head skin bytes in **both** resource buffers, and exports the retained morph. The [separate verifier](../verify_crease_roundtrip.py) decodes the final serialized buffers by vertex layout, compares all eight skin slots by original head bone **name** and vertex mapping, then checks the exported GLB rather than trusting the conversion log. It also checks the original pre-import GLB to isolate packing effects.

| Gate | Result |
|---|---|
| Mesh skin bytes against native head | Exact for 1,635 mapped vertices; eight slots each |
| Morph embedded base-buffer skin bytes against native head | Exact for the same 1,635 vertices |
| Exported per-bone weights against bound head | Maximum difference `0` |
| Triangle topology and both UV sets | 3,010 triangles and both UV arrays exact against pre-import GLB; every plate face maps to its original head face |
| Morphs and lighting deltas | All 105 names retained; existing nonzero normal/tangent deltas unchanged |
| Position roundtrip | Maximum base component error `2.611429e-6`; morph component error `9.425217e-6` asset units |
| Static displacement budget | Pass, maximum `0.0001077260` against `0.00025` |
| Static neighbor limit | **Fail:** 18 over-limit edges across 13 of 107 cases; maximum neighbor difference `0.0000561547` (the main cap is `0.00005`, with shorter edges capped more tightly) |
| New nonadjacent finite contacts | **Fail:** two in 107 static cases; five occurrences in 73 sampled poses |

The pre-import float32 GLB has **zero** new static and posed contacts, but four edge-limit violations across `h091_eyes`, `h171_eyes` and saved V. Thus even before resource import the numeric candidate's exact neighbor margin is too tight for float32 storage. After serialization, there are 18 edge violations across `h061_eyes`, `h071_eyes`, `h081_eyes`, `h091_eyes`, `h111_eyes`, `h121_eyes`, `h141_eyes`, `h151_eyes`, `h154_jaw`, `h161_eyes`, `h164_jaw`, `h171_eyes` and saved V.

The serialized static contacts are `h201_eyes` plate face 711 against head faces 2312 and 2313. Sampled idle contacts are frame 25: plate face 792 against head faces 2419, 2420 and 2423; frame 169: face 792 against 2423; frame 170: face 793 against 2421. All are **new nonadjacent** pairs after excluding shared-source-vertex faces and native head self-contacts. The corresponding pre-import checks find none of these pairs. Full 107-case and 73-pose rows, including exact pair IDs and all checks, remain in the ignored `verification.json` identified below.

The 73 poses use the previously validated exact affine reconstruction of the decoded idle adapter (`fixed_skin_manifest.json` records reconstruction error `1.12e-15`) applied to the **exported** base and saved-five-morph positions. The restored native skin bytes make those fixed transforms applicable to this candidate. These sampled poses are not a continuous-animation proof or REDengine runtime rendering. The raw-versus-packed comparison isolates a serialization failure without attributing it to skin changes.

## Reproduction and retained evidence

From the isolated worktree, with the ignored HQ source build and game-derived JSON still present:

```powershell
python experiments/006-plate-clearance/roundtrip_crease.py `
  --candidate D:/Dev/cp2077-modding-hq/experiments/006-plate-clearance/generated/morph-aware/crease-interior-center.npz `
  --sha256 3600f54e9a53e3b95dc456ae8cfccbf0611d8f762146ebb5f13e7f5b25fffb34 `
  --source-build D:/Dev/cp2077-modding-hq/experiments/006-plate-clearance/generated/build-1790134714546030800
python experiments/006-plate-clearance/verify_crease_roundtrip.py `
  --build experiments/006-plate-clearance/generated/roundtrip-crease-1790201076652677900 `
  --output experiments/006-plate-clearance/generated/roundtrip-crease-1790201076652677900/verification.json
```

The preserved ignored run is `experiments/006-plate-clearance/generated/roundtrip-crease-1790201076652677900/`. Its SHA-256 identifiers are:

| Output | SHA-256 |
|---|---|
| Final `.mesh` | `d3132b47e050d740904569e07ff70fba58e92808479b6ad1d3ecce4908a1ee1c` |
| Final `.morphtarget` | `4426a98f3e96f9363550a0465cf410106c9f8fcf89b237fb0d3ddf7ccad12027` |
| Exported bound GLB | `7822b8179e6a33634a06a91a752e5dd4a953d494666b1b05b81d64b42ef59b62` |
| Full ignored `verification.json` | `87496924dda15c6cd79d20c195d3b4239e96c95adfd9b9163b145f4eee94fb8a` |

The next candidate needs explicit **post-packing** slack in both neighbor and finite-contact gates. This trial does not justify replacing the master or launching the game. It uses the already credited WolvenKit/Blender IO Suite/local head inputs from experiment 004/006; no new external source or asset was introduced.
