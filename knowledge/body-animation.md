# V's body in motion: the preview puppets, their idles and the deformation rig

**Maturity: Draft.** Consolidated on 27 September 2026 from the installed 2.31 game (the REDmod TweakDB sources, the player and preview entities, `player_paperdoll.animgraph`, `ui_female.anims`, `woman_base.rig`, `woman_base_deformations.rig` and `.animgraph`, the body, feet and nails resources), the decompiled scripts, WolvenKit 9.0.1 and the Studio's own offline measurements on the reference profile's V. Nothing here has runtime evidence yet. Grades follow the [knowledge rules](README.md): **[source]** engine, framework or tool source or decompiled scripts, **[resource]** extracted game or mod resources, **[wiki]** Modding Docs, **[runtime]** running game, **[offline]** our own tool runs and measurements, **[hypothesis]** not yet established. Hashes, commands and the numbers behind each claim are in the [deformation rig evaluator evidence](../research/animation/deformation-rig-evaluator.md).

This page answers which puppet shows V in the creator and the inventory, which idles those screens play on her body, how the game moves the body's helper joints under any pose, and why a clip belongs with a feet state. How the body is assembled is in [body rendering](body-rendering.md); photo-mode poses in [poses](poses.md); the face's idles in [facial expressions](facial-expressions.md#5-the-character-creator-idle).

## 1. The preview puppets

| Screen | TweakDB record | Female entity | Appearance | Grade |
|---|---|---|---|---|
| Character creator | `Character.Player_Puppet_Menu` | `base\characters\entities\player\player_wa_tpp.ent` | `character_creation` | [resource] REDmod `player_menu_record.tweak` |
| Inventory | `Character.Player_Puppet_Inventory` | `ep1\characters\entities\player\player_wa_tpp_ep1.ent` (`[EP1]`) | as V is dressed | [resource] REDmod `player_inventory_record.tweak` |
| Gender selection | (the creator's first screen) | `base\gameplay\gui\fullscreen\main_menu\gender_selection_female.ent` | — | [resource] listed in the creator's UI resources; its puppet setup unread |

`player_wa_tpp.ent` has three animated components [resource]: `root` (`woman_base.rig`, `player_paperdoll.animgraph`, with `ui_female.anims` through `TPP Player Animation Setup`), `deformations` (`woman_base_deformations.rig` and `.animgraph`, its control binding naming `root`) and `breasts` (`woman_base_breasts.rig` and `.animgraph`, bound to `deformations`). The photo-mode puppet has the same `deformations` component ([poses §4](poses.md#4-how-photo-mode-plays-a-pose)).

## 2. The preview idles

The paperdoll body graph picks a clip per screen from `AnimFeature_Paperdoll`, which the preview controllers set from the camera slot [source: `entityPreviewGameController.script`]. Its state machines and screen switches loop these clips of `ui_female.anims` [resource]:

| Studio entry | Clip (body) | Length | Graph state and flags | Face loop | Feet it's authored for |
|---|---|---:|---|---|---|
| Creator close-up | `ui_closeup_shot` | 12.33 s | state machine `closeup` (`characterCreation_Head`, `_Eyes`, `_Nose`, `_Lips`, `_Jaw`, `_Hair` pick one-shots from it) | `ui_closeup_shot` (22.07 s) | the creator puppet's lifted feet |
| Creator full body | `ui_fullbody_shot` | 15.73 s | state machine `fullbody` (after the one-shot `ui_closeup_to_fullbody`) | `ui_fullbody_shot` (22.07 s) | lifted |
| Creator nails | `ui_expose_hand_loop` | 4.70 s | state `loop` (`characterCreation_Nails`: `ui_expose_hand_start` → loop → `_end`) | none in the face set | lifted |
| Gender selection | `ui_gender_selection` | 15.63 s | played directly by the screens' switch | none in the face set | not established |
| Inventory | `UI_full_shot` | 11.07 s | state `Idle` (`inventoryScreen`; `_Legs` and `_Chest` play `ui_check_pants` / `ui_check_jacket` once) | `ui_closeup_shot` after the one-shot `ui_inventory_pickup` ([facial expressions §5](facial-expressions.md#5-the-character-creator-idle)) | V's own (flat when barefoot) |

- **One-shots, not idles:** `ui_check_boots`, `ui_check_pants`, `ui_check_jacket`, `ui_closeup_to_fullbody`, `ui_fullbody_to_closeup`, the section showcases, `ui_expose_hand_start` and `_end` [resource].
- **Weapon idles:** 53 looping clips (`handgun_idle`, `katana_idle`, …) play in the inventory's weapon view with the held weapon [resource]; the Studio draws no weapon, so it doesn't offer them.
- **`ui_expose_teeth`** is in the set but not in the body graph [resource].
- **The inventory idle** is the relaxed standing loop the in-game inventory shows: the hips turned about 40° from the camera, the head turned back towards it by 0 to 12° as the weight shifts, the left foot turned out [offline: `UI_full_shot` sampled at seven phases].
- **What the Studio used before** was the close-up body clip on every framing, including the whole-body view [source: the Studio].

## 3. The deformation rig

The main rig (`woman_base.rig`, 71 joints) is what every body clip keys. Every body mesh is also skinned to some of the 114 helper joints (deltoids, latissimus, scapula and chest muscles, twist joints of the thighs, calves, upper arms and wrists, knuckles, elbows, buttocks, groin, knees) that no clip keys [resource]. `woman_base_deformations.rig` holds them (181 joints) with their parents: the latissimus, scapula and chest joints under `Spine3`, the knee and calf joints under `LeftLeg`, the elbow and wrist joints under `LeftForeArm` [resource]. The body meshes are bound in the rig's `aPoseMS` (within 0.26 mm and 0.8°); its `boneTransforms` are another pose [offline].

**The graph** is one linear chain of 420 nodes: the reference pose and the shared main pose, into model space, then the constraints, then back to local space [resource]. The chain's node kinds and what the Studio infers they compute [hypothesis, checked as below]:

| Node | Count | Computes |
|---|---:|---|
| `StackTransformsExtender` / `…Shrinker` | 7 each | Adds temporary transforms (`_GRP`), each at its parent times its reference offset; the shrinker removes them |
| `TwistConstraint` | 10 | The twist of B relative to A about A's front axis; each output joint turns by `positiveScale` or `negativeScale` of it about its own axis (the thigh keeps 10 % of the thigh's twist near the hip; the wrist joints take 37, 65 and 73 % of the hand's) |
| `PointConstraint` | 46 | The weighted mean of its sources' positions (`preprocessedWeights`); rotation kept |
| `OrientConstraint` | 31 | Its sources' rotations blended in turn by `preprocessedWeights`; position kept |
| `AimConstraint_ObjectUp` / `_ObjectRotationUp` | 78 / 14 | Turns `forwardAxisLS` at the target, `upAxisLS` towards the up object (or the up object's rotated `upTransformVector`) |
| `SetBoneTransform` | 72 | The joint at its source times the offset (`WholeTransform`) |
| `SimpleSpline` | 44 | The joint on the quadratic curve start → middle → end at `defaultProgress`, or at a float track's value |
| `SimpleBounce` | 90 | A measure: X of the end in the start's space; `offset + (multiplier or negativeMultiplier) × X`, written into each output's channels (position, Euler rotation or scale, each scaled) in its parent's space, or into a float track. It drives muscle bulges and slides, not only jiggle; its delay and smoothing are dynamics |
| `TranslationLimit` | 8 | Clamps the joint's position in its parent's space |

**The check:** with the main joints in the A pose, these semantics give back the A pose for 179 of the 181 rig joints within 0.5 mm and 1°, and for the other two (`l/r_deltoid_top_bot_out_JNT`) within 2°. That holds whatever the helper joints held on input, so every helper joint is fully determined by the graph [offline]. The twist sign, the bounce slopes and the spline's curve only act away from the A pose, where no capture has checked them yet.

**The breasts rig** is a simulation (dangles, drag, collision ellipsoids, blends and a static switch on a visual tag) [resource]; it isn't a constraint chain and the Studio leaves it out. At rest its joints keep the pose the deformation rig gives them [hypothesis].

**How the Studio uses it** [source: the Studio]:

1. The host reads the player entity (`PLAYER_ENTITIES`, with every ArchiveXL patch) and takes each animated component bound to another animated component. It compiles each rig and graph, read natively, into a program (`deformation-rig.ts`) and serves it beside the character record (`rigs`).
2. The idle (`idle-animation.ts`) runs each program on the clip's pose every frame, about 0.3 ms. It drives each joint a program solves through a virtual driver. Without a program, helper joints fall back to the rig segment nearest them (`nearestDriver`).
3. **What it fixes:** under the nearest-segment fallback, the latissimus, scapula and chest-side joints turned with the upper arm, so lowering the arms from the bind pose pulled the torso's sides in under the ribs. With the rig, the vertices mostly weighted to them move in by 11 mm on average in the close-up idle, against 38 mm before (17 against 44 in the inventory idle) [offline: the reference V's body posed both ways].

## 4. Feet states and the idles

The creator resource has two feet groups, `flat_feet` (the garment mesh `l0_000_pwa_base__cs_flat.mesh`) and `lifted_feet` (the body's own chunks 5–7 through `l0_000_base__full.app`) [resource]. The flat mesh is modelled flat, with its sole near the floor, around a skeleton whose foot is raised: the ankle stands 11.8 cm above the floor in the A pose. The lifted feet are modelled with the heel 5 to 8 cm up [resource]. So a clip suits one feet state:

| Clip | Ankle | Flat feet posed | Lifted feet posed |
|---|---:|---|---|
| `ui_closeup_shot`, `ui_fullbody_shot` | 6 cm; the foot turns 21° while the toes turn 5° | heel 5 cm through the floor, toes bent up by about 16° | flat on the floor |
| `UI_full_shot` (inventory) | 11.7 cm, as in the A pose | flat on the floor | heel raised, as inside a shoe |
| `ui_gender_selection` | 6.5 cm | heel and toes below the floor | toes below the floor |

[offline: each clip sampled at t = 0, both meshes skinned]

This agrees with the puppets:

- The creator puppet's appearance, `character_creation`, is a body group that lists `lifted_feet` [resource], so the creator's idles pose lifted feet flat.
- The inventory and gameplay use `flat_feet` when no footwear is worn [wiki: ArchiveXL's `{feet}` table], and the inventory idle keeps the foot where the flat mesh was modelled.

**What the Studio does** [source: the Studio]:

- While a creator idle plays, the character request says `puppet: "creator"` (`xfs/character-request-8`), and the host draws V's bare feet as that group lists them (`bodyStateFor`).
- With the inventory idle, or Still (the bind pose, where the flat mesh stands flat), the feet follow the footwear.
- Footwear always lifts them.

**Before this:** a barefoot V wore flat feet under the close-up clip, so her heels sank through the floor and her toes bent: the crushed feet of the report [offline].

## 5. The nails' skin

A nails morph mod ships `a0_000_pwa_base__nails_l.morphtarget` and `_r`, each with an embedded base mesh of 1,120 vertices, and each vertex is skinned wholly to one fingertip joint (`LeftHandThumb2`, `LeftHandIndex3`, `…Middle3`, `…Ring3`, `…Pinky3`) [resource: the base blob's `PS_SkinIndices`/`PS_SkinWeights` stream]. WolvenKit 9.0.1 writes that skin when it exports the morph target with the game folder, and leaves it out without it [offline]. The Studio's first export runs without the game folder (PIPE-106), which is why the nails came out rigid and were bound whole to one bone at their centre (`rigid-body-part`), floating beside the fingers. A morph target whose GLB has no skin is now exported again from its own raw copy with the game folder (`MorphTargetSkin`), so the nails follow the fingertips as in the game [source: the Studio]. This answers [body rendering open question 5](body-rendering.md#open-questions): the morph-target export, not the mod.

## Open questions

1. What does each helper joint look like in game in strong poses (raised arms, kneeling, sitting)? The graph's semantics are checked at the A pose only; the twist sign and the bounce slopes act away from it (capture ask 2).
2. Does the gender-selection screen's puppet use lifted feet, and does it stand on a raised floor (its clip puts even the lifted toes 4 cm under the Studio's floor)?
3. Does the game evaluate `SimpleBounce` smoothing towards the static value the Studio uses, and is the breasts simulation at rest identical to the deformation rig's output?
4. Which face clip plays with the nails and gender-selection loops? The face set has neither, and the Studio keeps the close-up's face.

## In-game test asks

Batch with the next session. Record the game version, ArchiveXL, and the body, UV and nails mods in use.

1. **Inventory idle against the Studio.** Inventory, V without clothing (underwear on), the default camera: capture three phases a few seconds apart. Compare with the Studio's whole-body view with the Body source on Inventory: stance, arm spread, gaze direction, flat feet.
2. **Helper joints.** Photo mode, arms raised and a kneeling pose: close-ups of a shoulder, the torso's side under the ribs and a knee, against the Studio (when poses can play there).
3. **Creator feet.** Creator, body page, full-body view, barefoot: the feet must stand flat (the lifted mesh under the creator's clip), as the Studio's Creator full body entry shows them.
4. **Nails.** Creator nails section with long nails: each nail must sit on its fingertip through the hand loop.

## Related pages

[Body rendering](body-rendering.md) · [Photo-mode poses](poses.md) · [Facial expressions](facial-expressions.md) · [Worn clothing](clothing.md) · [Pose library design](../research/animation/pose-library-design.md) · [CC idle](../research/animation/cc-idle.md) · [Deformation rig evaluator evidence](../research/animation/deformation-rig-evaluator.md)
