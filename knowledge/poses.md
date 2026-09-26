# Photo-mode poses

**Maturity: Draft.** This page covers how Cyberpunk 2077 lists and plays V's photo-mode poses, how mods add them, what a pose clip holds, and what the game does to the body's helper joints under a pose. It was consolidated on 27 September 2026 from the installed 2.31 game (the REDmod TweakDB sources, the compiled TweakDB, photo-mode resources), the WolvenKit, ArchiveXL and TweakXL sources, and the installed pose packs and pose tools on the reference MO2 profile. Sections 6–8 (the rig for posing, the graph after the pose clip, and changing a pose at runtime) come from the pose editor study of the same day: the photo-mode body graph's node tree, the decompiled 2.31 scripts, RED4ext.SDK's animation layouts, and the Red Hot Tools, ArchiveXL and AMM sources. Nothing here has runtime evidence of its own. Grades follow the [knowledge rules](README.md): **[source]** engine, framework or tool source or decompiled scripts, **[resource]** extracted game or mod resources, **[wiki]** Modding Docs, **[runtime]** running game, **[offline]** our own tool runs, **[hypothesis]** not yet established. Hashes, versions and counts are in the [pose library design](../research/animation/pose-library-design.md#12-evidence-and-sources) and the [pose editor design](../research/animation/pose-editor-design.md#12-evidence-and-sources), which also hold the Studio's designs built on these facts.

Photo-mode faces (expressions) are a separate chain, covered in [facial expressions](facial-expressions.md#3-photo-mode-expressions). How to drive the photo-mode menu from script is in [photo mode](photo-mode.md).

## 1. The chain

| Step | What | Grade |
|---|---|---|
| Lists | `photo_mode.character.femalePoses` and `malePoses` are `string[]` flats (compiled as `array:String`) of `PhotoModePoses.*` record names: 142 female and 143 male in 2.31, identical in `tweakdb.bin`, `tweakdb_ep1.bin` and the REDmod sources. NPC puppets have their own lists (`judyPoses`, `panamPoses`… 53 in all). | [resource] |
| Categories | `photo_mode.character.poseCategories` orders `PhotoModePoseCategory { categoryName, displayName }` records. Vanilla has `idleCategory` (Idle), `actionCategory` (Action) and `naturalCategory` (Natural, added in 2.3), labelled by secondary keys (`UI-PhotoMode-OptionCategoryIdle`…). | [resource] |
| Record | `PhotoModePose : PhotoModeItem` (see §2). 255 vanilla records: 114 idle, 62 action, 76 natural, 3 others. | [resource] REDmod `database\photomode\schema.tweak`, `poses.tweak` |
| Puppet | `Character.Player_Puppet_Photomode.genders`: the female entity is `ep1\characters\entities\player\photo_mode\player_wa_photomode_ep1.ent` (tagged `[EP1]`), the male `…\player_ma_photomode_ep1.ent`. ArchiveXL's bundled scope `photomode_wa.ent` (and `_ma`, `_mb`, `_mm`, `_cat`, `_iguana`) lists the base and EP1 entities of every photo-mode character. | [resource]; [source] ArchiveXL `bundle/source/resources/PhotoModeScope.xl` |
| Sets | The puppet's `root` animated component (`woman_base.rig`, `base\gameplay\anim_graphs\player_photomode.animgraph`) and its `entAnimationSetupExtensionComponent`s list the sets. The vanilla female pose sets are `base\animations\ui\photomode\photomode__female__idle.anims` (133 clips), `…\photomode__female__action.anims` (73), `…\photomode__v_female__natural.anims` (23) and two EP1 sets of 2 each. Not every clip is listed as a V pose (90 of the idle set's 133 are). | [resource] |
| Lookup | The record's `animationName` is found by name among those sets. All 142 female records resolve: 90 in idle, 28 in action, 24 in natural. How a duplicate name across sets is settled (priority, then order?) is untested; for faces, the wiki says the first match wins. | [resource]; rule [hypothesis] |
| Clip | 2 frames (0.033 s), 71 joints, 13 float tracks, `Normal`, `animAnimationBufferCompressed`, no motion extraction, for every vanilla V pose. The natural poses are 2 or 3 frames. | [resource] |

## 2. The pose record

| Field | Meaning | Default and use | Grade |
|---|---|---|---|
| `displayName` | Menu text | Vanilla `LocKey#…`; mod packs mostly literal text (1,902 of 1,907 mod records), e.g. `01`, `03` | [resource] |
| `locked` | Hidden until unlocked | false everywhere | [resource] |
| `animationName` | Clip name | — | [resource] |
| `animationTime` | Time into the clip | 0; vanilla uses it for 17 records (quadruped poses, e.g. 6.64 s); 27 of 2,079 mod records. Start or hold time is untested | [resource]; meaning [hypothesis] |
| `category` | Category record | Inherited from `PhotoModePoseIdle` / `…Action` / `…Natural` | [resource] |
| `acceptedWeaponConfig` | What V holds | `POSE_HIDE_WEAPON`; vanilla also has handguns, rifles, guitar, microphone, cigarette; packs define their own props (`POSE_PROP_CODPP_BEER_R`, `POSE_PHONE`, …) | [resource] |
| `poseStateConfig` | Where the pose is allowed | `POSE_STATE_GROUND`; also ground-and-air, crouch, flat, car, bike, swimming, ladder, walk, sprint | [resource] |
| `lookAtPreset` | Look-at behaviour | `LookatPreset.PhotoMode_LookAtCamera` (166 records), `…_Head_Only` (41), none (48) | [resource] |
| `disableLookAtForGarmentTags`, `filterOutForGarmentTags` | Garment rules | e.g. look-at off with `Collar` / `HelmetFull`; pose hidden with `Coat`, `HeadCover`, `Collar` | [resource]; hiding in the menu [hypothesis] |
| `positionOffset`, `rotation` | Placement of the puppet | Vanilla swim poses `(0, 0, 0.35)` and `(0, 0, 0.85)`; two records `(0, 1.35, 0)`; two rotations of 45° | [resource]; axes [hypothesis] |
| `poseSize`, `allowMoveUpDown` | Placement limits | — | [resource] |

No field names an icon, an `.anims` file or a workspot [resource]: the menu is a text list.

## 3. What a pose clip holds

- **Rig.** `base\characters\base_entities\woman_base\woman_base.rig`: 71 joints (`Root`, `Trajectory`, `Hips`, `reference_joint`, `Spine`…) and 13 float tracks: `headBodyPartVis`, `leftArmBodyPartVis`, `rightArmBodyPartVis`, `legsBodyPartVis`, `predictiveLookAtDirectionX/Y/Z`, `allowFeetIk`, `enableLeftFootIk`, `enableRightFootIk`, `footStepOffsetX/Y/Z`. There are no face tracks, in vanilla or in any inspected pack. The male rig is `man_base.rig`, with the same layout [resource].
- **The compressed buffer is not ACL** [source: WolvenKit `WolvenKit.RED4/Types/ClassesExt/CustomData/animAnimationBufferCompressed.cs` at `11720772`] [resource]:
  - It is a flat key list. Each animated key is 12 bytes: time normalised to 16 bits, then 16 bits holding the joint index (13 bits), the component (2 bits: position, rotation or scale) and the rotation's *w* sign, then three values quantised to 16 bits over [−1, 1].
  - A rotation's *w* is rebuilt from *x*, *y* and *z*.
  - "Raw" and constant keys store three float32 values.
  - Float-track keys follow as time or index plus a float32.
  - The key block is in the set's `animationDataChunks[unkIndex]` at `fsetInBytes`, `zeInBytes` long (`dataAddress`), or inline, possibly Oodle-compressed.
  - One vanilla pose is 116 animated, 4 raw and 112 constant keys plus 13 constant track keys, about 3 KB; the 133-clip idle set is 159 KB.
- **SIMD.** The other format, `animAnimationBufferSimd`, appears in a few face clips (three in `ui_female_face.anims`, 5 of 444 in the Mega Pack). No body pose clip surveyed uses it [resource].
- **Longer clips.** Some packs ship multi-frame poses with motion extraction, e.g. Photo Mode Unlocker XL's `wp_hg_silver_*`: 141 to 361 frames, some with a motion-extraction block [resource]. Photo Mode Pose Selector's per-character "freeze pose animation" shows that such poses play over time in photo mode [source].

## 4. How photo mode plays a pose

- **Selection is native.** The menu's attributes 5 (category) and 6 (pose) hold option data. `PhotoModePose_Record` is script-readable (`AnimationName()`, `AnimationTime()`, `PositionOffset()`…), but no script starts a clip [source: 2.31 decompiled `orphans.script`].
- **The body graph** `player_photomode.animgraph` has:
  - one `MixerSlot` (two normal, two additive and two override entries);
  - a `WORKSPOT` graph slot with a `WorkspotHub`;
  - the features `PhotomodePoseCategory` (an `IntInput` `poseCategoryIndex` driving a switch over the head and chest rotation nodes) and six `AnimFeature_PhotomodeBodyPartRotate` (head and chest X/Y/Z);
  - `FreezeFrame`, foot IK request nodes and look-at controllers;
  - 85 `SkAnim` nodes (weapon idles, a default standing idle) [resource].

  Which slot plays the chosen clip is not traced [hypothesis: the mixer slot].
- **Photo mode has no body idle**: static pose clips hold. Only look-at and the gaze-triggered blinks move. Community tools freeze even those with `SetIndividualTimeDilation` [resource] ([facial expressions §4](facial-expressions.md#4-photo-mode-poses-and-idles)).
- **The helper joints are a second graph.** The puppet also has an animated component `deformations` with `woman_base_deformations.rig` and `base\characters\base_entities\woman_base\deformations_rigs\woman_base_deformations.animgraph` [resource]. It drives 114 named muscle, twist and corrective joints from the main skeleton, which is why body meshes carry joints the pose clip doesn't key: deltoids, `l_Wrist_0_JNT`…, knuckles, the latissimus, buttocks, knees and calves. The graph has these nodes:

  | Node | Count |
  |---|---:|
  | `PointConstraint_WeightedTransform` | 94 |
  | `SimpleBounce` | 90 |
  | `AimConstraint_ObjectUp` | 78 |
  | `SetBoneTransform` | 72 |
  | `OrientConstraint_WeightedTransform` | 62 |
  | `PointConstraint` | 46 |
  | `SimpleSpline` | 44 |
  | `OrientConstraint` | 31 |
  | `AimConstraint_ObjectRotationUp` | 14 |
  | `TwistConstraint` | 10 |
  | `TranslationLimit` | 8 |

  The shadow component has its own rig (`shadow_rig_wa`) [resource]. The Studio's preview approximates these joints rigidly ([body rendering §4](body-rendering.md#4-how-the-studio-draws-the-body)).

## 5. How mods add poses

| Route | Mechanism | Photo mode | Grade |
|---|---|---|---|
| TweakXL + ArchiveXL | YAML records `PhotoModePoses.<id>` (`$base: PhotoModePoses.idle_stand_01`) and `PhotoModePoseCategories.<id>` (`$base: idleCategory`), `!append-once` onto the gender lists and `poseCategories` (often reused on NPC lists through a YAML anchor); `.xl` `animations:` entries (`entity`: a path, a list or a scope such as `photomode_wa.ent`; `set`; optional `priority`, `vars`, `component`), which ArchiveXL appends to every animated component of a matching entity when it initialises (by owner template path, or component name plus path) | Yes | [resource]; [source] ArchiveXL `Extensions/Animation/Config.cpp`, `Extension.cpp` (`5474e34d`); TweakXL `YamlReader.cpp` (`f8da6be`) |
| Records reusing another pack's sets | A pack of records only; the clips come from a "core" pack's sets | Yes, with the core pack | [resource] |
| Multi Pose Pack Framework (legacy) | Replaces the base `player_wa_photomode.ent` / `player_ma_photomode.ent` whole, adding empty numbered set slots (`photomode__female__idle__000.anims` … `__010`, `…__backup`, `…__animation`) that packs fill by path | Only while the base entity is the puppet; the EP1 puppet (§1) makes it inert with Phantom Liberty | [resource]; EP1 effect [hypothesis] |
| Vanilla clip replacement | A same-named clip in a winning copy of a vanilla set | Yes (global, exclusive) | [wiki] |
| Appearance Menu Mod custom poses | Lua data files under `AppearanceMenuMod/Collabs/Custom Poses/`: `return { modder, category, entity_path, anims = { ["Woman Average"] = {...}, ["Player Woman"] = {...}, … } }`, naming a workspot entity whose sets hold the clips; AMM plays them through a workspot (`PlayInDeviceSimple`, `SendJumpToAnimEnt`) | **No**: AMM-only | [resource]; [source] AMM `Modules/anims.lua` |
| Runtime records (CET, redscript) | `TweakDB` writes at runtime | Yes, invisible to offline readers | [hypothesis] |

**On the reference profile** (920 enabled mods) [resource]:

- 44 packs add 1,907 pose records and 87 category records. They append about 1,510 entries to `femalePoses`, 324 to `malePoses` and 86 to `poseCategories`. Every record uses `$base: PhotoModePoses.idle_stand_01`.
- 45 mods' `animations:` entries reach V's photo-mode entity.
- 23 mods ship AMM custom-pose files. Four are AMM-only; their 24 files list 656 "Woman Average" clips.
- 150 animation names are used by more than one mod record.
- A female V's menu would offer about 1,650 poses in about 90 categories.

**Pose tools.** Photo Mode Pose Selector reads the lists the native menu builds (`OnSetupOptionSelector`), offers search, favourites, arrow-key stepping and per-character freeze, and stores favourites in SQLite keyed by the category text plus the pose text. Its README notes that a cross-category browser would need indexing beyond the menu's list [source: its `init.lua`, `README.md` 1.2.0]. Photo Mode Unlocker XL adds 31 categories and 199 full records of its own [resource].

## 6. The rig for posing

- **Joints** [resource]: `woman_base.rig`'s 71 joints are `Root`, `Trajectory`, `Hips`, `reference_joint`; the spine `Spine`…`Spine3`, `Neck`, `Neck1`, `Head` and the two eyes; per side the shoulder, arm, forearm and hand, a weapon socket, five metacarpals (`LeftInHandThumb`…`LeftInHandPinky`), two thumb and three joints for each other finger (`LeftHandIndex1–3`…), and the thigh, shin, foot, heel and toe. Every left joint's twin swaps `Left` for `Right` in its name.
- **No posing limits.** The rig's only angle data is its ragdoll description: 22 bodies with swing and twist ranges relative to their capsules (the upper arm ±6°, the forearm −30…55° and −40…25°, the head ±20°). They are physics tuning, not anatomical limits [resource].
- **IK setups**: the rig lists two-bone foot setups for each leg (`LeftUpLeg` → `LeftLeg` → `LeftFoot`, hinge Z) [resource].
- **What a pose can key**: only these 71 joints. The 114 helper joints the body meshes are also skinned to are solved by the `deformations` graph (§4), so a pose never addresses them [resource].

## 7. What the body graph does after the pose clip

The photo-mode body graph runs, from the pose source to its output [resource: its node tree]:

1. The pose source: a `MixerSlot` over the `WORKSPOT` graph slot, whose inputs are a looping `idle_stand` and a `WorkspotHub`. Which of the two plays a chosen pose is not traced [hypothesis].
2. `PoseCorrection`.
3. **Head and chest rotation**: six `RotateBone` nodes on `Head` and `Spine` (X, Y, Z; ±90°), each fed by a float input `RotateHeadX`…`RotateChestZ` / `rotateDegree`; the graph declares them as six `AnimFeature_PhotomodeBodyPartRotate` features (one float, `rotateDegree`) [resource] [source: RED4ext.SDK generated type].
4. **Terrain foot IK**: an `AddSnapToTerrainIkRequest` whose hips request uses the `ikLeftLeg` and `ikRightLeg` chains. Clips switch it with the float tracks `allowFeetIk`, `enableLeftFootIk` and `enableRightFootIk` [resource]. The community documents that it glues feet to the floor, and removes it per pose in WolvenKit when a pose's feet should leave the ground [wiki: "Removing Foot Snap IK from Poses/Animations"].
5. **Look-at**: two `LookAtController`s, with inputs for `Eyes`, `Head`, `Chest`, `LeftHand` and `RightHand` (`isEnabled`, `target`, `mode`, `suppress`) [resource].
6. **Limb IK**: `AddIkRequest` for the four chains, then `Ik2` for each arm (`LeftArm` → `LeftForeArm` → `LeftHand`, hinge Z, at most 165° left and 180° right) and `Ik2Constraint` for each leg, with inputs per chain: `isEnabled`, `position`, `rotation` (a quaternion), `poleVector`, `weightPosition`, `weightRotation` and `poleVectorOverideWeight` [resource].
7. An override blend for the eyes, then the output.

So head, chest, gaze, feet and all four limbs can be bent **on top of any pose**. Whether the external IK requests reach the branch that plays poses is untested [hypothesis].

## 8. Changing a pose at runtime

| Lever | What it reaches | Grade |
|---|---|---|
| `IKTargetAddEvent` queued on the entity: `bodyPart` (the chain, e.g. `ikRightArm`), `SetStaticTarget(position)`, `SetStaticOrientationTarget(quaternion)`, or entity targets; `request` weights, transitions and priority; removed with `IKTargetRemoveEvent` | The limb IK chains (§7); the game's climbing code uses it for both hands | [source] 2.31 `ikTargetEvents.script`, `orphans.script` (`IKTargetRequest`, `AnimTargetAddEvent`), `locomotionTransitions.script` (`CreateIKConstraint`) |
| `LookAtAddEvent` with `bodyPart` `Eyes`, `LeftHand` or `RightHand` and extra parts (`Head`, `Chest`) with weights and suppression | The look-at controllers; an AI shield aims a hand this way; AMM aims NPC eyes, head and chest this way | [source] 2.31 `aiLookats.script`; AMM `Modules/util.lua` |
| `AnimationControllerComponent.ApplyFeature(obj, name, feature)`; public `SetInputFloat/Bool/Int/Vector`; private native `SetInputQuaternion`; the `AnimInputSetter…` events | Any graph input by group and name, e.g. `RotateHeadY` with `AnimFeature_PhotomodeBodyPartRotate` | [source] 2.31 `animationControllerComponent.script` |
| The loaded clip's key data | RED4ext.SDK lays out `animAnimationBufferCompressed` with spans over its compressed, raw and constant joint keys and its track keys, and the 14-byte constant key (13-bit joint index, 2-bit channel, the rotation's *w* sign, three float32 values). Whether evaluation reads these spans every frame is untested | [source] SDK `animAnimationBufferCompressed.hpp`, `animKeyFrames.hpp`; per-frame use [hypothesis] |
| Hot reload | Red Hot Tools reloads changed archives, forgets their resources from the loader and resource bank, keeps live references only for widget libraries, and calls `ArchiveXL.Reload`. ArchiveXL merges animation sets when an animated component initialises. So a set the puppet already holds is expected to stay old until a new puppet is made (re-entering photo mode) | [source] Red Hot Tools `ArchiveLoader.cpp`; ArchiveXL `Animation/Extension.cpp`; the puppet part [hypothesis] |
| Engine hooks | The only animation function address in the public address libraries is `AnimatedComponent::InitializeAnimations` (ArchiveXL hooks it); a hook on graph evaluation would need new reverse engineering | [source] ArchiveXL `Red/Addresses/Library.hpp` |

How the Studio plans to use these levers is in the [pose editor design](../research/animation/pose-editor-design.md#7-live-posing-route-survey).

## Open questions

1. How does the native menu start a pose clip (mixer slot or workspot), and is `animationTime` a start or a hold time? Do static 2-frame poses loop?
2. Which set wins when two sets hold the same clip name: `priority`, component order, ArchiveXL append order?
3. Is a pose whose `filterOutForGarmentTags` matches V's outfit hidden from the menu, or only disabled?
4. In which axes and space do `positionOffset` and `rotation` apply?
5. Does a game without Phantom Liberty use the base `player_wa_photomode.ent` for V, and does a pack that targets only one of the two entities show in the other?
6. What does the deformation graph compute for each helper joint, and how far is the Studio's rigid approximation from it in strong poses?
7. Does the engine sample a loaded clip's constant keys every frame, so that writing them changes a held pose live, or does it copy or cache them per selection or per load?
8. Do `IKTargetAddEvent` targets and `LookAtAddEvent` hand targets act on the photo-mode puppet while it holds a pose?
9. After a hot reload, does re-selecting a pose pick up a reloaded set, or only a newly created puppet?
10. Does individual time dilation 0 on the puppet stop its graph from evaluating?

The prepared in-game checks for 1–6 are G1–G7 in the [pose library design](../research/animation/pose-library-design.md#10-in-game-checks-for-the-prepared-session); 7–10 are steps LP1–LP9 of the [pose editor design](../research/animation/pose-editor-design.md#74-first-experiment-plan-one-supervised-session).

## Related pages

[Photo mode](photo-mode.md) · [Facial expressions](facial-expressions.md) · [Body rendering](body-rendering.md) · [Mod loading](mod-loading.md) · [Archive format](archive-format.md) · [Pose library design](../research/animation/pose-library-design.md) · [Pose editor design](../research/animation/pose-editor-design.md)
