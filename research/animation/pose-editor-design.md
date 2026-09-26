# Pose editor and live posing: design study

**Status: design proposal, 27 September 2026; nothing built.** It answers the request for a pose editor in two parts: **(A)** design poses in the Studio and export them as photo-mode poses, and **(B)** pose V live from the Studio and see it in the running game, with far more freedom than the photo-mode menu gives. Part B is an R&D target, so this page surveys the routes and ranks them. It builds on the [pose library design](pose-library-design.md), which reads, decodes and plays every installed photo-mode pose; the editor reuses that decoder, catalogue and body pose port. Facts are consolidated in [poses](../../knowledge/poses.md). Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[source]**, **[resource]**, **[wiki]**, **[runtime]**, **[offline]** and **[hypothesis]**. Anything without a grade is a design choice. No game session was run for this study; the sources are listed in §12.

## 1. Summary

| Question | Answer |
|---|---|
| What is a pose, as the game sees it? | A clip on `woman_base.rig` (71 joints, 13 float tracks), held on V's photo-mode puppet, plus a TweakDB record that names it. The clip keys only the 71 main joints. A second graph on the puppet, `woman_base_deformations.animgraph`, drives the 114 helper joints from them every frame, so an authored pose never keys a helper joint [resource]. |
| What does the editor store? | A **sparse map of local joint rotations** (plus the hips' translation) keyed by joint name. FK gizmos, IK handles, mirroring, hand presets and "start from an installed pose" are all ways of editing that one map, so preview and export cannot disagree. |
| How does an authored pose reach photo mode? | The same route every pose pack uses: an `.anims` set with one 2-frame clip per pose, attached to the photo-mode puppets through an ArchiveXL `animations:` entry with the `photomode_wa.ent` scope; TweakXL pose and category records appended to the pose lists; an ArchiveXL localisation file for the labels. It ships as part of the merged XF mod, or split as **XF Poses** [resource] [source] [wiki]. |
| Can the game already bend a pose at runtime? | **Yes, in part, with vanilla script APIs.** The photo-mode body graph runs *after* the pose clip: head and chest rotation nodes (±90°, fed by six `AnimFeature_PhotomodeBodyPartRotate` features), two look-at controllers (eyes, head, chest, and a hand), terrain foot IK, and two-bone IK for both arms and both legs with position, orientation and pole inputs (`ikLeftArm`, `ikRightArm`, `ikLeftLeg`, `ikRightLeg`). Scripts reach these through `IKTargetAddEvent`, `LookAtAddEvent` and `AnimationControllerComponent.ApplyFeature` [resource] [source]. Whether an external IK target reaches the pose branch is untested [hypothesis]. |
| Recommended live-posing route | **L1, a live carrier clip:** ship a reserved XF pose in the test profile whose every joint is stored as a constant key, select it in photo mode, and have the bridge overwrite those constant keys in the loaded clip. The whole body changes on the next evaluated frame, with no graph change and no engine hook. RED4ext.SDK already documents the loaded buffer's key spans [source]; whether the engine samples them live is the first experiment's question. Fallbacks: **L2**, hot reload of a rebuilt set (10–30 s round trip), and **L3**, the procedural IK and look-at channels above, which work on top of *any* pose. |
| First experiment | One supervised session: a test package with the carrier pose, three bridge commands (`photo.pose.set`, read-only `pose.live.read`, then `pose.live.apply` behind its own switch), and a stepwise checklist that stops at the first mismatch (§7.4). |
| Effort | Editor A: about four weeks for one agent after the pose library's P0–P2 (E1–E5). Live posing: an experiment of 3–4 days plus a session, then 4–6 days for the Studio's "Live in game" link if L1 holds (§9). |

## 2. Capability baseline

The first usable release, in order of value:

1. **Start from any pose** the pose library lists (vanilla or modded), or from the standing bind pose.
2. **FK rotation** of any of the 71 joints with a rotate gizmo (view, local and parent axes), numeric entry, and a joint outliner.
3. **Limb IK**: drag a hand or a foot, with a pole (elbow or knee) handle; pins that hold a hand or foot in place while the rest moves.
4. **Grounding**: a floor at the scene origin, "drop to floor", feet planted while the hips move, and the game's foot-snap IK chosen per pose on export.
5. **Mirroring**: copy one side to the other, or flip the whole pose.
6. **Hands**: finger curl and spread per finger and per hand, a few built-in hand shapes, and "borrow the hands" from any installed pose.
7. **Undo and redo** for every edit; one gesture is one step.
8. **An authored pose library** in the collection, shown beside the game's poses in the Poses panel.
9. **Export** as photo-mode poses in the XF mod, with Check, Build, an independent verifier and a manifest.
10. **In-game proof** through the bridge (§8), then **live posing** (§7) once its experiment succeeds.

Deferred: animated poses, male V, props, poses for NPC photo-mode characters, and a physics or muscle solve of the helper joints in the preview (the pose library's P4 improves that for every pose at once).

## 3. The rig

### 3.1 Joints and naming [resource]

`base\characters\base_entities\woman_base\woman_base.rig` has 71 joints. Names are the game's own, used verbatim as keys:

| Group | Joints |
|---|---|
| Root and hips | `Root`, `Trajectory` (motion, ignored), `Hips`, `reference_joint` (ignored) |
| Spine and head | `Spine`, `Spine1`, `Spine2`, `Spine3`, `Neck`, `Neck1`, `Head`, `LeftEye`, `RightEye` |
| Arms (per side) | `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand`, `WeaponLeft` (a socket, not posed) |
| Fingers (per side) | metacarpals `LeftInHandThumb`, `…Index`, `…Middle`, `…Ring`, `…Pinky`; then `LeftHandThumb1–2` and `LeftHandIndex1–3`, `…Middle1–3`, `…Ring1–3`, `…Pinky1–3` |
| Legs (per side) | `LeftUpLeg`, `LeftLeg`, `LeftFoot`, `LeftHeel`, `LeftToeBase` |

Every left joint has a right twin whose name swaps `Left`↔`Right`, which is what the mirror map reads (§4.4). The male rig `man_base.rig` has the same layout [resource: pose library intake].

**Float tracks** (13): body-part visibility (`headBodyPartVis`, `leftArmBodyPartVis`, `rightArmBodyPartVis`, `legsBodyPartVis`), predictive look-at direction (`predictiveLookAtDirectionX/Y/Z`), foot IK switches (`allowFeetIk`, `enableLeftFootIk`, `enableRightFootIk`) and `footStepOffsetX/Y/Z` [resource].

### 3.2 Limits

- **The rig carries no posing limits** [resource]. Its only angle data is the ragdoll description: 22 bodies with swing and twist ranges (for example the forearm −30…55° and −40…25°, the upper arm ±6°, the head ±20°). These are physics tuning, relative to capsule frames, and far tighter than anatomy in places, so they are **not** used as posing limits.
- **The Studio's limits are its own data**: a small table of soft anatomical ranges per joint (swing cone and twist), shown as a coloured arc on the gizmo and a warning badge when exceeded, never a clamp unless the user turns "natural limits" on (question Q8).
- **The game's own limits after the clip:** head and chest rotation nodes clamp at ±90°; the arm IK hinges at 165° (left) and 180° (right) [resource: graph nodes #34–#45, #992, #999].

### 3.3 Helper joints

- Body meshes are also skinned to 114 helper joints (deltoids, wrist twists, knuckles, knees, buttocks) that no pose clip keys. In game, the `deformations` component's graph solves them from the main joints every frame with point, orient, aim, twist and spline constraints plus 90 bounce nodes [resource] ([poses §4](../../knowledge/poses.md#4-how-photo-mode-plays-a-pose)).
- **Consequence for authoring:** the editor keys only the 71 joints, exactly as the game expects. What it cannot do is show the game's helper result: until the pose library's P4 evaluates the deformation graph, the preview moves each helper rigidly with its nearest main joint. Strong poses (arms overhead, deep knee bends, twisted wrists) will look worse in the preview than in game at the shoulders, knees and wrists.
- **Mitigation:** a "fidelity" note in the editor for joints whose helpers the preview approximates, and the in-game check PE4 (§8) to calibrate. Helper joints are not editable: a clip on `woman_base.rig` cannot address them.

### 3.4 Spaces and axes

The game is Z-up and the Studio's scene is Y-up; the idle and pose library already convert game axes the same way [source: `src/idle-animation.ts`]. The editor edits **local** rotations (parent space) because that is what clips store; the gizmo presents local, parent or view axes. The sagittal (mirror) plane is derived from the rest pose: the model-space axis along which each Left/Right pair's rest positions differ in sign, not a hard-coded axis.

## 4. The editor

### 4.1 Document model

A pose is a **document part** of a new feature `poses`, carried by a preset of its own kind in the collection (a look carries makeup, a pose preset carries a pose). The collection's pose presets are the user's authored pose library.

```ts
// features/poses: xfs/pose-part-1 (design sketch)
type PosePart = {
  label?: string;                                  // menu text; default: the preset name
  rig: "woman_base" | "man_base";                  // the rig the rotations are authored on
  joints: Record<string, [number, number, number, number]>;  // sparse: joint -> local rotation quaternion (x, y, z, w), game axes; absent = rest
  hips?: [number, number, number];                 // Hips local translation (metres, game axes); absent = rest
  footSnap: "auto" | "on" | "off";                 // game foot-snap IK on export (§4.5)
  category?: string;                               // XF category id; default: the product's one category
  origin?: { kind: "rest" } | { kind: "installed"; record: string; clip: string };   // provenance of the start point only
  expression?: string;                             // optional link to an expression preset (§4.7)
};
```

- **By name, never by index.** Joints are stored by rig name; export maps names to the target rig's bone indices. A joint the rig lacks is kept verbatim, shown as "not on this body" and left out of export with a reason, never dropped on save.
- **Sparse and exact.** Joints at rest are omitted; stored quaternions are normalised and float32-representable, so the clip round trip is exact to the compressed format's quantisation (§5.3). The codec rejects non-finite values and non-unit quaternions.
- **Editor memory** (not in the part): the selected joint, gizmo space, pins, IK handle positions, outliner state.

### 4.2 FK tools

- **Picking**: click a bone in the viewport (bones drawn as thin shapes over the body, on a toggle) or a row in the joint outliner (grouped as in §3.1, with search).
- **Rotate gizmo**: three rings plus a free-rotate ball, in local, parent or view space; the Studio's existing gizmo conventions apply ([input bindings](../authoring/input-bindings.md): Shift always means a shape gesture, so constrained or fine rotation uses Ctrl or Alt).
- **Numeric entry**: Euler angles in a chosen order for reading and typing, stored as a quaternion.
- **Chain selection**: select a joint and its children (whole arm, whole hand); rotate spine joints together with a falloff (Spine to Spine3 share the turn).
- **Reset** a joint, a chain, a side or everything to rest; **copy and paste** rotations between joints, sides and poses.

### 4.3 IK tools

- **Two-bone analytic IK** for each limb (upper arm, forearm, hand; thigh, shin, foot), with a pole handle for the elbow or knee and an end orientation handle for the hand or foot. It is the Studio's own solver in a pure engine module, not the game's. Its output is ordinary FK rotations written into the part, so export needs nothing special.
- **Pins**: pin a hand or foot to its current world position; moving the hips, spine or the other limbs re-solves pinned limbs. Pins are editor memory, not part of the pose.
- **Spine and neck**: a look target for the head (turns `Neck`, `Neck1`, `Head` with a falloff) and a chest target (spreads over `Spine1`…`Spine3`).
- **Limits** are respected by the solver when "natural limits" is on.

### 4.4 Mirroring

- **Name map**: swap `Left`↔`Right` in every joint name (an involution, enforced by a test); centre joints map to themselves.
- **Reflection**: a local rotation mirrors by reflecting its model-space rotation across the sagittal plane (§3.4) and converting back to the twin's local frame; the hips translation mirrors its lateral component.
- **Actions**: mirror left to right, right to left, or flip the whole pose; mirror a selected chain only.

### 4.5 Grounding

- **The floor** is the plane through `Root`, as in the pose library's playback: photo mode places the puppet with `Root` on the ground [hypothesis, check PE3].
- **Drop to floor** moves the hips so the lowest contact point (heels, toes, knees, hands or hips, whichever is lowest on the posed body) touches the floor.
- **Planted feet**: while the hips move, pinned feet stay on the floor through the leg IK.
- **Contacts** are shown as markers where the posed body touches or crosses the floor.
- **The game's foot-snap IK.** Pose clips carry `allowFeetIk`, `enableLeftFootIk` and `enableRightFootIk`, and the graph has a terrain snap request for both legs after the pose [resource: graph node #32, rig tracks]. The community documents that foot snap glues feet to the floor, which suits standing poses and breaks poses whose feet are meant to be off the ground [wiki: "Removing Foot Snap IK from Poses/Animations"]. The part's `footSnap` sets the three tracks on export: `auto` turns it on only when both feet are within 2 cm of the floor in the authored pose, and off otherwise.

### 4.6 Hands

- **Controls**: per finger, curl (drives joints 1–3 together with a fixed ratio) and spread (joint 1 only); per hand, a fist amount and a relax amount. Controls write ordinary rotations.
- **Built-in shapes**: relaxed, open, fist, point, pinch and grip, authored in the Studio as data (our own content, no game data).
- **Borrow hands**: copy the finger joints of either hand from any installed pose the pose library lists, with its record ID as provenance.

### 4.7 Face with the pose

A photo-mode pose record has no face: the expression is a separate menu choice (attribute 28) [resource] ([facial expressions](../../knowledge/facial-expressions.md#3-photo-mode-expressions)). So:

- **In the Studio** a pose preset may link an expression preset from the [expression editor](expression-editor-design.md); the preview shows both.
- **On export** the linked expression is exported by the expressions feature under the same label, so the player picks the pose and the matching face in photo mode (question Q5). The pose feature never writes face data.
- **Look direction**: the eyes follow photo mode's look-at unless it is off; the in-game checks run with look-at off.

### 4.8 Where the editor lives in the UI

A **Pose** editor panel (dockable, floating, tabbable like every panel) beside the pose library's **Poses** panel: the outliner, the selected joint's controls, hand controls, grounding and mirror actions. Gizmos and IK handles draw in the viewport through the feature's renderer. The Poses panel gains a *Yours* group (the collection's pose presets) and an "Edit a copy" action on any game pose.

## 5. Export

### 5.1 File chain

| # | Link | What the exporter writes | Grade |
|---|---|---|---|
| 1 | Clip | One clip per pose, named `xfs_pose_<slug>`: 2 frames (0.033 s, the vanilla shape), `Normal`, no motion extraction, every authored joint as constant keys, the rest at the rig's reference; float tracks: body-part visibility 1, the three foot IK switches from `footSnap`, predictive look-at and foot-step offsets at the vanilla values | Vanilla shape [resource]; that the engine plays such a clip identically [hypothesis until PE2] |
| 2 | Set | One set per rig, `<product key>\poses\xfs_poses_female.anims` (male twin later), built by WolvenKit's animation import from a glTF the Studio writes, spliced into a template set taken from the player's own files and **emptied of every vanilla clip** first, so no game content ships | Import route [wiki: the pose-making guide; source: WolvenKit `ImportAnims`]; emptying the template is our rule |
| 3 | Attachment | ArchiveXL `.xl`: `animations: - entity: photomode_wa.ent, set: <path>` (male: `photomode_ma.ent`). The scope lists the base and Phantom Liberty puppets | [source] ArchiveXL `PhotoModeScope.xl`, `Animation/Config.cpp`; [wiki] the ArchiveXL pose guide |
| 4 | Labels | ArchiveXL `localization: onscreens:` with keys `xfs_pose_<slug>` and `xfs_pose_category_<product>` | [wiki] the ArchiveXL pose guide; standard ArchiveXL [source] |
| 5 | Category | TweakXL `PhotoModePoseCategories.xfs_<product>` (`$base` the vanilla `idleCategory` record, `displayName` the category key), `!append-once` onto `photo_mode.character.poseCategories` | [resource] 87 mod category records on the reference profile follow this shape |
| 6 | Records | TweakXL `PhotoModePoses.xfs_pose_<slug>` (`$base: PhotoModePoses.idle_stand_01`, `animationName: xfs_pose_<slug>`, `category`, `displayName` the pose key, `animationTime: 0`), `!append-once` onto `photo_mode.character.femalePoses` | [resource] every one of 1,907 mod records uses this base |
| 7 | Garment rules | Inherited from `idle_stand_01` unless the user changes them: `filterOutForGarmentTags` hides the pose while V wears a coat, collar or head cover. The exporter clears the inherited filter by default, so an XF pose is never hidden (question Q9) | [resource]; hiding in the menu [hypothesis, pose library G4] |

### 5.2 Naming, product and requirements

- **Product**: poses join the collection's one XF mod by default ("XF Looks" when it also carries makeup); a collection of only poses, or poses split out, builds **"XF Poses"** ([package plan](../authoring/feature-module-platform.md#package-plan-merged-by-default-splittable-by-the-user)). Names freeze at the first successful Build.
- **Resources**: every clip, record and key starts `xfs_`; slugs are unique in the collection and stable across rebuilds by preset UUID. The `xfs_` prefix also keeps XF clips out of the duplicate-name problem the pose library found (150 names shared across mod records).
- **No selector**: poses add choices to photo mode's existing list.
- **Requirements**: ArchiveXL and TweakXL, current stable versions, detected and never installed or replaced by the Studio. The wiki's 2.2 guide lists Photo Mode Ex as a dependency of its tutorial pack, which also targets NPC characters [wiki]; a V-only pose is expected not to need it [hypothesis, PE1 checks it on a profile without it if the maintainer wishes].

### 5.3 Eligibility, Check, Build and verification

- **Eligible** pose presets have at least one joint away from rest on the target rig; others are omitted and reported by Check, Build and the manifest (partial-export rules).
- **Quantisation**: WolvenKit may store a joint as a 16-bit animated key rather than a float constant. Check reports the worst per-joint angular error the planned encoding would introduce (under 0.01° expected for constant keys [hypothesis]).
- **The independent verifier** unpacks the built archive and, without importing the exporter:
  - decodes the set with the pose library's decoder and with WolvenKit's `anim-export` as the oracle, and checks every clip against its planned rotations within the quantisation bound;
  - checks the set holds only `xfs_` clips, and its data chunks only their keys;
  - checks that every record's `animationName` exists in the set and every clip has one record, that the category exists and is appended once, and that the `.xl` scope and set path match;
  - records `gameRenderingVerified: false` until PE2.
- **Pipeline documentation**: the [Studio-to-mod pipeline](../authoring/studio-to-mod-pipeline.md) and its diagrams are updated, rendered and visually inspected in the checkpoint that builds the exporter, as the contract requires.

## 6. Architecture

| Layer | Pieces | Notes |
|---|---|---|
| Engine (pure, `engines/body-rig/`) | rig vocabulary (names, parents, rest pose, mirror map, sagittal axis), pose math (local ↔ model space, sparse ↔ dense, float32 exactness), two-bone IK, grounding, mirroring, hand controls, soft limits | No Three and no host state; reused later by body customisation and animated poses |
| Shared adapters | the pose library's `anim-set.ts` decoder and sampler; a clip **writer** to glTF (joint rotations to a 2-frame animation) | The writer mirrors the expression design's `clip.ts` |
| Platform | the pose library's `BodyPosePort` gains an *authored* body source: `setBodySource({kind: "pose", joints, hips})` | One motion compositor owns the body bones, as `src/preview-motion.ts` arranges today |
| Feature `features/poses/` | part and editor codecs, actions, Undo, gesture sessions, catalogue contribution (the *Yours* group), exporter `poses/photo-mode-static-v1`, independent verifier | Registered as a feature module on the [platform](../authoring/feature-module-platform.md) |
| View | Pose panel, outliner, gizmo and handle overlay, hand controls | Talks only through the feature's facade, snapshots and capabilities |
| Live link (later) | a device port over the bridge client (`pose.live.apply` and friends, §7) | Session state, never in the document |

**Actions** (each with a descriptor, capability, Undo policy and history label, added to the [action catalogue](../authoring/ui-action-catalogue.md) and the boundary tests): `poses/joint.rotate`, `poses/ik.drag`, `poses/hips.move`, `poses/reset`, `poses/mirror`, `poses/hand.set`, `poses/hand.borrow`, `poses/startFrom`, `poses/dropToFloor`, `poses/footSnap.set`, `poses/label.set`, `poses/expression.link`. Refusals use structured codes: `asset_unavailable` until the rig loads, `invalid_value`, `not_on_this_body`.

**View graph.** The view graph design being written in parallel (`research/authoring/view-graph-design.md`, not yet on `main`) separates what is shown from what is authored. In its terms:

- **A pose shown in the viewport is view state**: which body source the view holds (still, idle, a game pose, an authored pose) lives in the workspace like the camera, as the pose library already proposes. Browsing game poses never touches the document or Undo.
- **A pose asset is a document part**: editing an authored pose changes the `poses` part of its preset; the view shows it because the view is bound to the selected preset.
- **Undo scope**: part-level history per preset, as for looks. One drag (gizmo, IK handle, slider) is one transaction; Escape restores the pre-drag pose. Pins, handle positions and gizmo space are editor memory and not undone. Switching the viewed pose is not undoable (view state).
- **The live link** mirrors the viewed authored pose into the game (§7). It is a session capability with its own on/off state, never persisted in the document.

## 7. Live posing: route survey

### 7.1 What the game offers after the pose clip

The photo-mode body graph (`base\gameplay\anim_graphs\player_photomode.animgraph`, on the puppet's `root` component) runs, from the pose source to the output [resource: graph tree, node ids in brackets]:

1. The pose source: a `MixerSlot` over the `WORKSPOT` graph slot (a looping `idle_stand` or the `WorkspotHub`) [#49–#53]. Which of the two plays the chosen pose is not traced [hypothesis].
2. `PoseCorrection` [#48].
3. **Head and chest rotation**: six `RotateBone` nodes on `Head` and `Spine`, X/Y/Z, ±90°, each fed by a float input `RotateHeadX`…`RotateChestZ` / `rotateDegree`, declared as six `AnimFeature_PhotomodeBodyPartRotate` features [#34–#45].
4. **Terrain foot IK**: `AddSnapToTerrainIkRequest` with a hips request over the `ikLeftLeg` and `ikRightLeg` chains [#32].
5. **Look-at**: two `LookAtController`s; bool, vector, int and float inputs for `Eyes`, `Head`, `Chest`, `LeftHand` and `RightHand` (`isEnabled`, `target`, `mode`, `suppress`) [#27, #29].
6. **Limb IK**: `AddIkRequest` for all four chains, then `Ik2` for the arms (`LeftArm`→`LeftForeArm`→`LeftHand`, hinge Z, max 165°/180°) and `Ik2Constraint` for the legs, driven by inputs per chain: `isEnabled`, `position`, `rotation` (quaternion), `poleVector`, `weightPosition`, `weightRotation`, `poleVectorOverideWeight` [#983, #992, #999].
7. An eyes override blend, then the output.

Script-visible levers [source: 2.31 decompiled scripts]:

- `IKTargetAddEvent` (`bodyPart` = chain name, `SetStaticTarget`, `SetStaticOrientationTarget`, `request` weights, transitions and priority) and `IKTargetRemoveEvent`, queued on the entity; the game's climbing code uses them with `ikLeftArm` and `ikRightArm` (`locomotionTransitions.script`, `CreateIKConstraint`).
- `LookAtAddEvent` with `bodyPart` `Eyes`, `LeftHand` (an AI shield aims a hand at a target, `aiLookats.script`) and extra parts (`Head`, `Chest`) with weights; AMM uses the same event to aim NPC eyes, head and chest [source: AMM `Modules/util.lua`].
- `AnimationControllerComponent.ApplyFeature(obj, name, feature)`, `SetInputFloat/Bool/Int/Vector` (public statics) and `SetInputQuaternion` (private native); the events `AnimInputSetterAnimFeature`, `…Float`, `…Vector` and others.
- The engine side of this is the animation controller's `IKTargetController` and `LookAtController`, whose layouts RED4ext.SDK documents [source: SDK `entAnimationControllerComponent.hpp`].

### 7.2 The routes

| Route | How | Feasibility | Risk | Latency | Bridge needs | Cheapest proof |
|---|---|---|---|---|---|---|
| **L1 Live carrier clip** (the requested "transient clip in memory", made concrete) | A reserved pose `xfs_live_carrier` ships in a test package: a set whose clip stores **every** joint's rotation (and the hips' translation) as a constant key (`KeyFrameConst`: 13-bit joint index, 2-bit channel, the *w* sign, three float32 values). The bridge finds the loaded set by depot path (resource loader token, as Red Hot Tools does) or through the puppet's `root` component, walks to the clip's `animAnimationBufferCompressed`, and overwrites its constant keys with the Studio's pose. | Plausible. The SDK lays out the loaded buffer with spans over compressed, raw and constant keys and the track keys [source: SDK `animAnimationBufferCompressed.hpp`, `animKeyFrames.hpp`]. Whether evaluation reads those spans every frame, or copies or caches them at selection or load, is the open question [hypothesis]. | Medium. Writes only into our own clip; a wrong layout could corrupt it (read-only verification first, and every write validated). Tearing within one joint for one frame is possible from a main-thread write while animation jobs sample; writing only unit quaternions and, if needed, A/B carriers limit it. Nothing reaches a save: the puppet and its sets are photo-mode only [hypothesis]. | One frame after the write, plus the pipe (tens of ms) | `photo.pose.set` (select a pose by record through the menu's option data), `pose.live.read` (read), `pose.live.apply` (write-photo, behind a new `allow_live_pose` switch, -writes build only; undo restores the carrier's own keys) | §7.4 |
| **L2 Hot reload** | The Studio builds the pose into a small set (one WolvenKit import, seconds), stages it in `archive/pc/hot` for Red Hot Tools, which reloads changed resources and calls `ArchiveXL.Reload`; then the pose is re-selected or photo mode re-opened. | High for "rebuild and see". Red Hot Tools forgets reloaded resources from the loader and resource bank but keeps live references only for widget libraries, so a set already held by the puppet stays old [source: RHT `ArchiveLoader.cpp:273-330`]; ArchiveXL merges sets when an animated component initialises [source: ArchiveXL `Animation/Extension.cpp:18, 85`]. So a fresh puppet, i.e. re-entering photo mode, is expected to be needed [hypothesis]. | Low; the shared mechanism the expression design's `face.expression.stage` proposes. Needs Red Hot Tools in the test profile only. | 10–30 s (import, reload, re-enter, re-select) | `pose.stage` (write-photo; copies the probe archive, waits for the reload log lines, re-opens photo mode and selects the pose); shares `face.expression.stage`'s machinery | Stage one rebuilt probe; re-select without leaving; then leave and re-enter |
| **L3 Procedural channels** | Drive the graph's own post-pose nodes: IK targets for hands and feet (`IKTargetAddEvent` per chain with a world position and orientation), look-at for eyes, head, chest and a hand (`LookAtAddEvent`), and head and chest rotation (`ApplyFeature` with `AnimFeature_PhotomodeBodyPartRotate`, declared as a native class in redscript). | High for script calls; whether the IK requests reach the pose branch of this graph (the arm `AddIkRequest`s sit inside switches) is untested [hypothesis]. Covers limbs, head, chest and gaze only; no fingers, no spine shape. | Low: vanilla events and features, reversible with `IKTargetRemoveEvent` and a zero feature. | One frame | `pose.ik.set` / `pose.ik.clear`, `pose.lookat.set`, `pose.rotate.set` (write-photo) | Queue an IK target 20 cm above the right hand on a vanilla standing pose; capture |
| **L4 Native pose override** | A RED4ext hook after the root graph evaluates (or on the skinning update) that overwrites local transforms of chosen joints each frame. | Possible in principle; no public address for any such function (the only animation address in the public libraries is `AnimatedComponent::InitializeAnimations`, which ArchiveXL hooks) [source]. Needs disassembly and a pattern per game build. | High: crashes if wrong, thread timing with animation jobs, maintenance each patch. | One frame | A native module in the plugin, a `pose.override.*` family | Only after L1 fails or proves too limited |
| **L5 Graph-driven pose** | A patched photo-mode graph (or an extra animated component) with a `QuaternionInput` → `RotateBoneByQuaternion` per joint, fed by an XF `AnimFeature` whose 71 quaternion fields match the graph's input names, applied from redscript. | Plausible: the node types exist [source: SDK], features map to graph inputs by group and name [resource: this graph's inputs]. But the graph is a single-owner file, and whether a second component's output can override the root's main joints is unknown. | Medium: owning `player_photomode.animgraph` conflicts with any mod that replaces it; authoring a graph through WolvenKit JSON is laborious. | One frame | `pose.feature.apply` (write-photo) | Only if L1 fails and L4 is unwelcome |
| **L6 Mods' techniques** | AMM plays clips on characters through a workspot (`PlayInDeviceSimple` + `SendJumpToAnimEnt`) and aims NPC eyes, head and chest with `LookAtAddEvent`; Photo Mode Pose Selector freezes a character with individual time dilation. No studied mod poses joints freely. | Informs L3 and L1's freeze step | — | — | — | — |

Rejected: driving the ragdoll to pose V (unstable, physics-owned), and retargeting through the photo-mode NPC characters (other rigs).

### 7.3 Recommendation

1. **L1 first.** It is the only route that gives the whole body, fingers included, at interactive speed without owning a game file or hooking the engine, and its first test is read-only. If the engine samples the spans live, the Studio's "Live in game" toggle streams the edited pose at up to 30 updates a second (latest wins).
2. **L3 alongside, in the same session.** It needs only vanilla events, works on top of any installed pose, and gives in-game handles for hands, feet, head and gaze even if L1 fails.
3. **L2 as the dependable fallback and the export pipeline's end-to-end proof.** Seconds, not frames, but certain.
4. **L4 and L5 stay research options**, revisited only if L1 turns out to be cached per selection or per load.

A variant worth measuring in L1's session: if the engine caches the sampled pose per selection, re-selecting the carrier after each write (`photo.pose.set` twice) may still give sub-second updates without a reload.

### 7.4 First experiment plan (one supervised session)

**Prepared offline:**

- A **test package** "XF Live Pose (test)", for the test profile only and never the distribution: the carrier set (clip `xfs_live_carrier`, all 71 rotations and the hips' translation as constant keys, each set slightly off the rig's reference so the importer cannot drop it), the record `PhotoModePoses.xfs_live_carrier` in the category `PhotoModePoseCategories.xfs_live` ("XF Live"), the `.xl` entry on `photomode_wa.ent`, and a label file. The package's verifier confirms that every joint has a constant rotation key.
- **Bridge batch** (plugin, redscript, catalogue, self-test; the usual write gate, save lock, logging, undo and kill switch):
  - `photo.pose.set {record}` (write-photo): selects a pose through menu attributes 5 and 6 with the option data the menu set up, as `photo.expression.set` does. It also serves the pose library's G1–G3.
  - `pose.live.read {set, clip}` (read): locates the loaded set and clip, returns frame and key counts, whether the spans are non-null and inside the set's data, and the decoded constant keys, plus a hash to compare with the Studio's offline decode. It refuses (`layout_unrecognised`) when the counts disagree with the header.
  - `pose.live.apply {joints, hips}` (write-photo, `allow_live_pose = true` only): validates finite unit quaternions and joint names, requires the carrier to be the selected pose, keeps the carrier's original keys for undo, and writes on the main thread in the plugin's update.
  - L3: `pose.ik.set {chain, position, orientation, weight}`, `pose.ik.clear`, `pose.lookat.set {part, target}`, `pose.rotate.set {head|chest, x, y, z}`.

**Session steps** (start from the safety save, test profile with the -writes build; `photo.open`, `photo.frame {target: "full-body"}`, look-at off, menu hidden; record the game, ArchiveXL, TweakXL and bridge versions):

| # | Step | Captures | Decides |
|---|---|---|---|
| LP1 | `photo.state {options: true}`: is "XF Live" listed with one pose? `photo.pose.set xfs_live_carrier` | Full body | The export route works at all (also PE1) |
| LP2 | `pose.live.read` and compare with the offline decode | JSON | The SDK layout holds on this build; **stop here if it doesn't** |
| LP3 | `pose.live.apply` bending the right elbow 30° | `capture.burst` 10 frames at 50 ms | Whether the spans are sampled live, and after how many frames |
| LP4 | If nothing changed: `photo.pose.set` another pose, then the carrier again; then leave and re-enter photo mode | One each | Cached per selection or per load (then L2 or the re-select variant) |
| LP5 | 20 small increments at 10 Hz | Burst of 40 frames | Stability and tearing |
| LP6 | Freeze the puppet (`SetIndividualTimeDilation` 0), apply, unfreeze | One each | Whether time dilation stops evaluation (and thus updates) |
| LP7 | Undo; then the kill switch after another apply | One each | Restore paths |
| LP8 | On a vanilla standing pose: `pose.ik.set ikRightArm` 20 cm above the hand; `pose.lookat.set Eyes` to a point left of V; `pose.rotate.set head y 30` | One each | Whether L3's channels act in the pose branch |
| LP9 | Exit photo mode, load the safety save | — | Nothing persists |

## 8. In-game checks for exported poses

Batch into one prepared session after phase E4; record versions and installed pose packs.

| # | Check | How | Decides |
|---|---|---|---|
| PE1 | **Listed** | `photo.state {options: true}`: the XF category and every exported pose appear for female V, with the right labels, in the Studio's order | The records, category and localisation chain |
| PE2 | **Matches the Studio** | Three poses (asymmetric standing, sitting on the floor, arms raised) with `photo.pose.set`, `photo.frame {target: "full-body"}`, look-at off, front and side captures against the Studio at matched framing | Export fidelity; `gameRenderingVerified` |
| PE3 | **Grounding** | A pose with `footSnap` on and one off, on flat ground and on a slope or stairs; a seated pose | The floor convention and the `auto` rule |
| PE4 | **Helper joints** | Close-ups of a shoulder, a knee and a wrist on the arms-raised pose against the Studio | The preview's approximation; P4 priority |
| PE5 | **Coexistence** | With the reference profile's pose packs enabled: no vanilla or mod pose lost; ArchiveXL's log shows the XF set merged | No conflicts |
| PE6 | **Outfit** | V in a coat: the XF poses are still listed | The cleared garment filter |
| PE7 | **Save safety** | Leave photo mode, save, load: nothing changed | Poses stay photo-mode only |

## 9. Phases and effort

| Phase | Scope | Depends on | Effort |
|---|---|---|---|
| **E0** Shared groundwork | The pose library's P0–P2: decoder, catalogue, body pose port | — | (pose library) |
| **E1** Model and FK | `engines/body-rig` vocabulary, mirror map and space maths; the `poses` feature part, codec, actions and Undo; outliner, rotate gizmo, numeric entry, reset, copy and paste, mirroring; start from an installed pose; the *Yours* group | E0 | 6–8 days |
| **E2** IK and grounding | Two-bone IK with poles, pins, head and chest targets, soft limits, floor, drop to floor, planted feet, contact markers | E1 | 5–7 days |
| **E3** Hands and face | Finger controls, built-in shapes, borrowed hands; the expression link | E1; expression editor phase 1 for the link | 3–4 days |
| **E4** Export | glTF clip writer, emptied template set, WolvenKit import, TweakXL, `.xl` and labels, Check, Build, verifier, manifest; pipeline doc and diagrams | E1 | 6–8 days |
| **E5** In-game proof | PE1–PE7 through the bridge | E4, `photo.pose.set` | 1–2 days plus a session |
| **L0** Live experiment | Test package, `photo.pose.set`, `pose.live.read`, `pose.live.apply`, the L3 commands; §7.4 | Bridge batch process | 3–4 days plus a session |
| **L1** Live link | The Studio's "Live in game" toggle: a device port over the bridge client, latest-wins streaming, a plain status line, undo on disconnect; or the L2 route if L1 is cached | L0 result, E1 | 4–6 days |
| **L-later** | L4 or L5, only if needed | L0 result | 2+ weeks of R&D |

E1–E5 is about four weeks for one agent; E2 and E3 can run in parallel with E4. L0 can start as soon as the bridge has room for a batch, independent of E1.

## 10. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Helper joints approximated in the preview | Authored strong poses look different in game at the shoulders, knees and wrists | Fidelity note; PE4; the pose library's P4 |
| WolvenKit import encodes some joints as quantised keys | Small angle errors | Check reports the bound; the verifier decodes and compares |
| The template set carries vanilla clips | Game content redistributed | Empty it before import; the verifier refuses any non-`xfs_` clip or foreign data |
| Foot snap moves feet the user placed | Floating or glued feet | `footSnap` per pose with an `auto` rule; PE3 |
| The inherited garment filter hides XF poses | "My pose is missing" | Cleared by default (Q9); PE6 |
| L1's spans are not sampled live, or differ on a later game build | No live posing through L1 | Read-only check first; L2 and the re-select variant as fallbacks; the layout check runs on every connection |
| L1 tearing or a bad write | A frame of broken skinning, at worst a crash in photo mode | Validated unit quaternions only; main-thread writes; A/B carriers if tearing shows; test profile and safety save only |
| L3 IK targets ignored in the pose branch | No in-game handles | Known after LP8; L1 covers the whole body anyway |
| Male V | No male preview; male export blind | Female first (Q1) |

## 11. Questions for the maintainer (with proposed defaults)

| # | Question | Proposed default |
|---|---|---|
| Q1 | Body genders in the first release? | **Female V only**; male export once a male preview exists ([masculine V plan](../character-customization/male-v-plan.md)). |
| Q2 | Also add XF poses to the female NPC photo-mode lists (they share `woman_base.rig`)? | **No** at first; a per-product option later. |
| Q3 | Categories: one per product or user-defined? | **One category per product** named after it (e.g. "XF Poses"), renameable; user-defined categories later. |
| Q4 | Default for the game's foot snap? | **Auto**: on when both feet rest on the floor in the authored pose, off otherwise; overridable per pose. |
| Q5 | Pose plus face: export the linked expression under the same label? | **Yes**, as two photo-mode choices the player picks together; the pose never carries face data. |
| Q6 | Approve the live carrier experiment (a new kind of write: into the memory of our own loaded clip), behind its own `allow_live_pose` switch in the test profile's -writes build? | **Yes**, test profile and safety save only, read-only step first. |
| Q7 | Add Red Hot Tools to the test profile for the hot-reload fallback (shared with the expression design's D4)? | **Yes if convenient**; not needed for L1 or L3. |
| Q8 | Joint limits: warnings or clamps? | **Warnings** by default; "natural limits" clamps on request. |
| Q9 | Clear the inherited garment filter so XF poses are never hidden by V's outfit? | **Yes**; the user can re-enable it per pose. |
| Q10 | Animated (multi-frame) poses? | **Later**: static poses first; the part is shaped so keyframes can be added. |
| Q11 | Placement fields (`positionOffset`, `rotation`) on records? | **Unused**: placement is baked into the hips, so the record keeps vanilla defaults. |
| Q12 | Edit with V dressed or undressed by default? | **As the current look**, with the existing Clothing and Body toggles. |

## 12. Evidence and sources

All read-only. No game was run, no installed file changed, and nothing game-derived is committed.

| Source | Version / identity | Used for |
|---|---|---|
| Photo-mode body graph `player_photomode.animgraph` | 2.31, the expressions intake's WolvenKit serialisation (`research/consumers/expressions/json/xf/`, private), walked with `research/animation/probes/animgraph_tree.py` | Pipeline order, node census, inputs and features (§7.1) |
| `player_wa_photomode_ep1.ent` | same intake | The puppet's `root`, `deformations` and `shadow` animated components |
| `woman_base.rig` | same intake (`json/vanilla/`) | 71 joints and parents, 13 tracks, foot IK setups, 22 ragdoll bodies and their limits |
| Game scripts | 2.31 `final.redscripts` decompiled with redscript-cli 0.5.31 (private scratch) | `AnimationControllerComponent` natives and statics; `IKTargetAddEvent`, `IKTargetRemoveEvent`, `IKTargetRequest`, `AnimTargetAddEvent`, `LookAtAddEvent`; the climbing IK and AI shield look-at uses; `AnimInputSetter*` events; `PhotoModePlayerEntityComponent` |
| [RED4ext.SDK](https://github.com/wopss/RED4ext.SDK) | `ad727771` | `animAnimationBufferCompressed.hpp`, `animKeyFrames.hpp`, `animAnimSet.hpp`, `animRig.hpp`, `entAnimationControllerComponent.hpp`, generated `ent/AnimatedComponent.hpp`, `anim/AnimNode_*` layouts (`RotateBoneByQuaternion`, `QuaternionInput`, `Ik2`, `AddIkRequest`, `SetBoneTransform`), `AnimFeature_PhotomodeBodyPartRotate.hpp` |
| [Red Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools) (MIT) | `b4d3415` | `src/App/Archives/ArchiveLoader.cpp`: resource invalidation (widget libraries only keep live references), `ArchiveXL.Reload` |
| [ArchiveXL](https://github.com/psiberx/cp2077-archive-xl) | `5474e34d` | `Animation/Extension.cpp` (merge at `InitializeAnimations`), `Red/Addresses/Library.hpp` (the only public animation address) |
| [Appearance Menu Mod](https://github.com/MaximiliumM/appearancemenumod) | `5427235` | `Modules/util.lua` (look-at with extra parts, anim-feature events), `Modules/anims.lua` (workspot playback) |
| Cyberpunk Modding Docs | `be2f44ee` | `modding-guides/animations/animations/archivexl-adding-photo-mode-poses/README.md` (manavortex: `.xl`, localisation, scopes), `poses-animations-make-your-own/README.md` (manavortex, updated by LadyLea; templates by xbaebsae and Angy: WolvenKit splices glTF animations into an existing set), `removing-foot-snap-ik-from-poses-animations.md` (author not identified: foot snap IK behaviour), `updating-photomode-pose-packs-for-2.3.md` (nutboy, Zwei Valerie: NPC pose lists) |
| Pose library intake | as in the [pose library design](pose-library-design.md#12-evidence-and-sources) | Record shapes, clip layout, the reference profile's pose packs |

## Related pages

[Poses (knowledge)](../../knowledge/poses.md) · [Pose library design](pose-library-design.md) · [Expression editor design](expression-editor-design.md) · [Photo mode](../../knowledge/photo-mode.md) · [Runtime access](../../knowledge/runtime-access.md) · [Body rendering](../../knowledge/body-rendering.md) · [Runtime bridge design](../runtime/runtime-bridge-design.md) · [Feature-module platform](../authoring/feature-module-platform.md) · [Community credits](../../docs/community-credits.md)
