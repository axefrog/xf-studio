# Deformation rig evaluator, preview idles and body fidelity: evidence

27 September 2026. The evidence behind [V's body in motion](../../knowledge/body-animation.md): what was read, how, and the measurements. No game session was run; everything here is offline. Private inputs (the reference profile's V, extracted resources and exports) stay local and ignored; nothing game-derived is committed.

## The report it answers

On the reference profile's V in the whole-body view, compared with the game's inventory screen in the same stance:

- the idle stance differed;
- the torso's sides were pinched in under the ribs;
- the toes were crushed and bent;
- the nails floated off the fingers.

Private captures: `projects/xf-studio/authoring/evidence/screenshots/body-fidelity/` (`before-*`, `rig-*`, `nails-*`, `after-<idle>-*`), taken censored (the game's underwear cover on) on an isolated `?verify=1` server with the reference MO2 route read only.

## Sources

| Source | Identity (SHA-256, first 16) | Used for |
|---|---|---|
| `base\characters\base_entities\woman_base\deformations_rigs\woman_base_deformations.animgraph` | `6ead74d604bae3bb` | The 420-node chain, node census and parameters (read natively and with WolvenKit 9.0.1 `convert serialize`) |
| `…\woman_base_deformations.rig` | `5fba228bb4b47a50` | 181 joints, parents, `aPoseLS`/`aPoseMS`, `boneTransforms` (appendix layout below) |
| `…\woman_base_breasts.animgraph` | `d0d03693e44a8286` | Its node kinds (dangles, drag, dyng constraints, blends, a static switch) |
| `base\gameplay\anim_graphs\player_paperdoll.animgraph` | `2ab093eafee97290` | State machines, states, looping clips, `Paperdoll` flags (WolvenKit JSON; the native reader refuses its `curveData:Float` values) |
| `base\animations\ui\female\ui_female.anims` | `3ebd3a9a77e1e5ea` | Clip names, lengths, buffer formats (native), and each preview clip exported with tools/anim-export |
| `base\animations\ui\female\ui_female_face.anims` | `9fe289d1eea33df4` | Face clips (`ui_fullbody_shot` 22.07 s, `ui_inventory_pickup` 12.1 s, …) |
| `base\characters\entities\player\player_wa_tpp.ent` | `613596feda8ab3a1` | The puppet's animated components and control bindings |
| `…\player_base_bodies\appearances\l0_000_base__cs_flat.app` | `8362742ca1cac4af` | The flat feet's component (a plain garment component; nothing adjusts the pose) |
| REDmod `player_menu_record.tweak`, `player_inventory_record.tweak` | as installed (2.31) | The creator and inventory puppets and the creator's appearance `character_creation` |
| Creator resource (merged, resolver cache) | as installed | `character_creation` lists `lifted_feet` |
| A nails morph mod's `a0_000_pwa_base__nails_l.morphtarget` | as installed on the reference profile | The embedded base blob's skin stream |

## animRig's appendix

After the properties, an `animRig` export holds `i16` parent indexes (one per `boneNames` entry), then one `QsTransform` per bone: translation (4 × f32), rotation (i, j, k, r) and scale (4 × f32), 50 bytes per bone in all. This was established against WolvenKit's serialization of `woman_base_deformations.rig`: the parents are identical, and the transforms and `aPoseMS` match within 1e-6. The native reader decodes it and refuses any other size (`tests/native-rig.test.ts`).

## The reference-pose check

The main joints were set to the rig's A pose and the graph run with the semantics of [knowledge §3](../../knowledge/body-animation.md#3-the-deformation-rig). A Python prototype and the TypeScript port (`deformation-rig.ts`) agree:

| Helper joints on input | Joints off the A pose (> 0.5 mm or > 1°) |
|---|---|
| `aPoseLS` | 2 of 181: `l/r_deltoid_top_bot_out_JNT`, 1.98°, 0 mm |
| `boneTransforms` (another pose) | 4: the two above, and `l/r_leg_buttock_mscl_JNT` at 2.1° |

On the way there, the semantics that did not reproduce the reference were:

- **`SimpleBounce`** with the measured channel taken from `channelEntries`: 61 joints off, up to 573 m. Read correctly, `targetTransformChannel` is the measure and the entries are the outputs.
- **A track output as a distance:** the splines driven by the track moved 90 mm. It is the same `offset + multiplier × X` value times the output's multiplier, which gives `defaultProgress`, 0.75, at rest.

Cost: compiling takes about 5 ms; one evaluation about 0.3 ms (100 in 27 to 30 ms) in Bun on the development machine. The host's rig step took 0.3 s on the reference route.

## Waist measurement

The reference V's body morph target (the full export, eight chunks) was posed at t = 0 in two ways: with the Studio's nearest-segment helpers, and with the graph. For the vertices weighted more than 0.25 to each joint pair, the table gives the inward move of the lateral coordinate in `Spine3`'s frame, relative to the bind pose in `Spine3`'s rest frame (mean / max, mm):

| Joints | Close-up, nearest | Close-up, graph | Inventory, nearest | Inventory, graph |
|---|---|---|---|---|
| latissimus (98 vertices) | 38.4 / 53.6 | 11.3 / 24.2 | 43.7 / 66.7 | 17.3 / 36.3 |
| scapula A bottom (64) | 19.2 / 53.6 | 11.4 / 24.6 | 33.4 / 66.7 | 22.6 / 40.7 |
| chest front C bottom (99) | 16.4 / 34.7 | 6.4 / 28.0 | 15.9 / 37.5 | 6.8 / 29.5 |

Under the nearest-segment rule, the latissimus joint (at 1.41 m, 0.077 m from the upper arm's segment) went with `LeftArm`. The rig parents it to `Spine3`, and the graph sets its position between its own end point and the back deltoid.

## Feet measurement

The flat feet mesh and the body's own feet chunk were posed by each preview clip at t = 0. The table gives the height above the floor (m, minimum / mean) of the left heel (vertices with z > 0.1 in the export's axes) and toes (z < −0.06):

| Clip | Flat heel | Flat toes | Lifted heel | Lifted toes |
|---|---|---|---|---|
| `ui_closeup_shot` | −0.047 / −0.027 | 0.012 / 0.025 | −0.006 / 0.014 | 0.001 / 0.010 |
| `ui_fullbody_shot` | −0.051 / −0.031 | 0.009 / 0.024 | −0.009 / 0.010 | −0.001 / 0.008 |
| `UI_full_shot` | 0.014 / 0.034 | 0.014 / 0.026 | 0.054 / 0.079 | 0.002 / 0.011 |
| `ui_gender_selection` | −0.039 / −0.019 | −0.036 / −0.023 | 0.002 / 0.025 | −0.047 / −0.038 |

In both meshes' exports, the joints (`LeftFoot`, `LeftToeBase`) match the rig's rest within 1e-4. So the difference is the geometry each mesh was modelled in, not the skin.

## The nails' skin

The morph target's base blob has one render chunk with 1,120 vertices. Its stream 0 (16 bytes per vertex) holds the position (`Short4N`), `PS_SkinIndices` (`UByte4`: indices 0 to 4, one per vertex) and `PS_SkinWeights` (`UByte4N`: 255, 0, 0, 0). The target entry names five bones: `LeftHandThumb2`, `LeftHandIndex3`, `LeftHandMiddle3`, `LeftHandRing3`, `LeftHandPinky3`. The dequantised positions equal the exported GLB's in the (x, z, −y) axes within 6e-8.

- **With the game folder:** `WolvenKit.CLI export <raw>.morphtarget -gp <game>` writes a skin of those five joints.
- **Without it:** the first export (PIPE-106) wrote the GLB without a skin.

## Commands

- Clip exports: `AnimExport.exe ui_female.anims woman_base.rig <clip> body-<clip>.glb`.
- Catalogue and faces: `tools/prepare_body_idles.py` (see [CC idle](cc-idle.md#the-games-other-preview-idles)).
- Graph serialization: `WolvenKit.CLI convert serialize <file> -o <dir>`.
- Everything ran under `tools/memory_guard.py` (at most 2 GB).
