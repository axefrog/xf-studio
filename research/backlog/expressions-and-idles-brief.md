# Facial expressions and idles: design brief

**Status: research and discussion brief, 26 September 2026. Nothing is built.** Facial expressions and idles are later feature 5 in the [queue](README.md#later-features--discuss-with-the-maintainer-before-building-each). Each later feature is discussed with the maintainer before any editor, solver or exporter work starts; the existing creator-idle preview is not permission to build an expression editor. The facts behind this brief are on the [facial expressions](../../knowledge/facial-expressions.md) knowledge page, with provenance in the [evidence note](../animation/expressions-evidence.md). The rig and blink mechanics are written up in [Facial animation and the blink](../../knowledge/facial-animation.md).

The ambition, in substance: (1) let users build new photo-mode expressions by pulling the face around like a rubber model on top of the game's own facial controls, and add them to photo mode's expression list; (2) find out whether new idles are possible, given that the game appears to have only one.

## What the research established

| Finding | Grade |
|---|---|
| **An expression is a small vector of named controls.** Every vanilla photo-mode expression is a 2-frame `AdditiveFromRefPose` clip whose 414 float tracks are constants; 22–42 of about 140 artist controls (brows, lids, squints, gaze, nose, lips, jaw, neck) are non-zero. No bone is keyed except in the singing faces. | [resource] |
| **Photo mode picks expressions through a lookup table.** `PhotoModeFace` record (`faceId`) → `AnimFeature_PhotomodeFacial.facialPoseIndex` → the face graph's `AnimDatabase` on `photomode_facial_poses.csv` (Index → clip name) → a clip of that name in the face rig's animation sets, added on the reference pose, then look-at, blinks and the facial solver. Changing expression cross-fades over 1 s. | [resource] [source]; faceId = index is [hypothesis] |
| **Adding expressions is proven by a popular mod** (the Photomode Facial Expression Mega Pack, 202 extra faces, enabled in the reference profile): TweakXL records appended to `faceAnimations`, clips attached by an ArchiveXL `.app` patch, and **whole-file replacements** of the CSV and (to loop animated faces) both photo-mode face graphs. | [resource] |
| **Those two replacements are single-owner files.** ArchiveXL can merge animation sets and patch entities, apps and meshes, but not 2D arrays or animation graphs; the first archive alphabetically wins a path. Two expression mods therefore cannot both add rows. | [source] [resource] |
| **The game's "one idle" is the creator's.** The creator and inventory face graph loops `ui_closeup_shot` (22.07 s) and plays a one-shot showcase clip when a section (eyes, nose, lips, jaw, hair) is opened; transitions are hard-wired graph states driven by `AnimFeature_Paperdoll` flags set from the camera slot. | [resource] [source] |
| **Photo mode has no idle at all.** Its "Idle" category is a pose category; every vanilla pose is a 2–3 frame static body pose, and the face holds a static expression. Only look-at and gaze-triggered blinks move. The Mega Pack's animated faces loop only because it overrides the face graphs. | [resource] |
| **NPCs have many facial idles** (20 looping emotion idles per body type, 21–29 s), used by NPC reactions and AMM; no path was found that loops one on V outside scenes. | [resource]; V outside scenes [hypothesis] |
| **The female V's face rig references the male player facial setup** in every vanilla `face_rig` component; its pose data differ from the female setup the Studio's idle bake uses. | [resource]; runtime use [hypothesis] |
| **WolvenKit can write the clip shape we need**: glTF float-track extras (`trackKeys`, `constTrackKeys`) and `AdditiveFromRefPose` survive `ImportAnims`, encoded as the compressed buffer vanilla facial clips use. | [source]; untested end to end |

## Feasibility per vector and route

| Vector | Route | Verdict | Why |
|---|---|---|---|
| **New photo-mode expressions (static)** | TweakXL `PhotoModeFaces.xfs_*` records appended to `faceAnimations`; clips on the photo-mode face rig; CSV rows | **Feasible, high confidence** | Every step is shown working by the Mega Pack. The only hard part is the single-owner CSV (see the plan). Static faces need no graph override. |
| **New photo-mode expressions (animated, looping)** | As above plus looping face graphs | **Feasible, with a second single-owner file** | Needs `isLooped` on the two `AnimDatabase` nodes, which only a whole graph replacement gives. Coexists with the Mega Pack only if one side's graph wins and both want the same change. |
| **Replace a vanilla expression** | Same-named clip, by file replacement or by shadowing in a higher-priority set | Feasible; not recommended as the product route | Globally replaces a vanilla face for every character; exclusive. |
| **Live preview in game** | CET or the XF bridge applying `PhotomodeFacial` / `updateFacialPose`, or AMM-style `FacialReaction` | Useful for experiments, not distribution | Still needs a clip of the right name in a loaded set; good for testing indices and blends. |
| **Replace the creator idle** | A per-user `ui_closeup_shot` with the same name: replace `ui_female_face.anims`, or shadow it at higher priority with ArchiveXL `animations:` on `face_rig` | **Feasible, medium confidence** | Same clip format as the one we already decode and solve. Shadowing is untested; replacement also changes the inventory preview, which shares the clip. Must be labelled as the user's own idle, never as the game idle. |
| **Several selectable creator idles** | New graph states or a new selector | **Not feasible now** | States and transitions are baked into the paperdoll graph; there is no graph patching and no WolvenKit graph editor. A whole-graph replacement is possible in principle but fragile across game updates. |
| **A "photo-mode idle"** | An animated, looping expression (face) with a static body pose | **Feasible as animated expressions** | This is exactly what the Mega Pack's animated faces are. A moving body in photo mode is unproven (vanilla poses are static; whether multi-frame poses animate is a runtime question). |
| **A gameplay idle for V** | Scene or reaction systems | **Unknown, low priority** | V's face in gameplay is rarely seen, driven by scenes, and has no lipsync; no vanilla path for a looping V face idle was found. |

## The expression editor: design options

All three options edit the **same stored object**: a named vector of main-pose weights (plus optional gaze), saved in the Studio library, previewed through a facial solver, and exported as a vanilla-shaped clip. They differ in how the user moves the face. All three start from a face at rest or from a decoded vanilla expression ("start from Happy"), and all mirror left/right by default with a per-control unlink.

### Option 1: control board

Grouped, labelled sliders for the ~140 controls (brows, lids, gaze, nose and cheeks, lips, jaw, neck, tongue), with presets and symmetry links.

- Exact, predictable, trivially exportable, cheap to build and test.
- Least like a rubber head: 40 lip sliders are a wall, and names such as `nasolabialDeepener` mean nothing to most users.

### Option 2: region handles (recommended default)

Handles sit on the face in the viewport: each brow (inner, outer), each lid, each mouth corner, the upper and lower lip, the jaw, the nose wings, the cheeks and the eyes' gaze target. Dragging a handle along a direction drives a small, fixed set of controls: brow up → `raise_in`/`raise_out`, brow down → `lower`, brow toward the nose → `lateral`; mouth corner up/out → `corner_up`/`corner_sharp_up`/`corner_wide`, down → `corner_dn`; jaw handle → `jaw_mid_open`/`shift`/`fwd`; gaze target → `eye_dir_*`. Handle travel is clamped at the control's 0–1 range, so the face cannot leave what the game can play. The control board stays available as an "all controls" drawer.

- Feels like pulling the face, yet every result is exactly the stored vector, so preview and export agree.
- Mapping tables are hand-authored per region (about 15 handles), testable offline against the solver's bone motion, and reusable for idle keyframes.
- Some compound controls (lip funnel, puff, snear) need secondary gestures (a modifier drag or a radial menu) rather than a direction.

### Option 3: free sculpt with an inverse solve

The user grabs any surface point and drags; the Studio solves for the control weights that best move that point there (bounded least squares over the facial setup's pose deltas, with a sparsity term so it prefers few controls), re-solving as the drag continues.

- The most "rubber" and the least vocabulary; still always game-valid, because it only moves within the rig's controls.
- Ambiguous (many control mixes fit one drag) and harder to make predictable; correctives and in-betweens make the solve non-linear, so it needs an iterative solver and careful regularisation. Best as a later "sculpt" mode layered on Option 2.

A fourth idea, keying bones directly and exporting bone deltas, is rejected for now: the photo-mode graph adds the clip on the reference pose **before** the facial solver, which overwrites face bones from tracks [hypothesis], and bone keys would bypass correctives, wrinkles and face-shape portability.

**Recommendation:** Option 2 as the default interaction, with the Option 1 drawer for precision and Option 3 as a later sculpt mode. It gives the rubber-head feel without leaving the space the game can reproduce.

### The solver underneath

The preview must solve controls into bone motion interactively. Today the Studio runs the Cyberpunk Blender add-on's solver offline (GPL-3.0) to bake the creator idle; an interactive editor needs an **in-app solver**. XF Studio is MIT-licensed, so that solver has to be written from the facial setup's data format and the documented stages, not ported from the add-on's code. The stages (envelopes, limits, influences, upper/lower multipliers, in-betweens, correctives, local-delta blend, wrinkle outputs) are well understood and cheap: about 140 poses over 266 joints per frame. The offline bake doubles as the reference for verifying it frame by frame.

It must also use **the facial setup the game uses**. The vanilla `face_rig` components point at the male player setup for both genders, while the Studio's bake used the female basehead setup; which one the engine solves with is the first runtime question below.

## An idle designer

An idle is the same object over time: keyframed control vectors (and gaze) on a timeline, looped.

- **Timeline and curves**: per-control keys with ease curves, a pose library to drop in (vanilla expressions, the user's own), and a "hold with life" helper that adds small drifts. Anything procedural is labelled as authored motion, never as the game's idle.
- **Loop closure**: first and last frames equal, tangents matched; a boundary check like the one the creator-idle research used.
- **Blinks and gaze as layers**: vanilla graphs already add blinks on gaze changes, and the creator idle bakes its own blinks as tracks. The designer should author blinks and gaze on their own layers so a user can decide whether to bake them, and so the export can leave them out where the graph adds its own.
- **Body alongside**: the creator body clip (12.33 s) and face clip (22.07 s) loop independently; the designer previews the face with a chosen body clip, as the current preview does, and exports only the face unless a body route is proven.
- **Export**: a 30 fps `AdditiveFromRefPose` float-track clip of the same shape as `ui_closeup_shot` or an animated photo-mode face.

## Export and registration plan

This extends the [Studio-to-mod pipeline](../authoring/studio-to-mod-pipeline.md); when it is built, that contract document and its diagrams are updated in the same checkpoint.

1. **Clips.** For each authored expression, write one `.anims` entry per body gender against that gender's face skeleton: 2 frames, `AdditiveFromRefPose`, 344 joints at reference, 414 constant tracks (animated faces and idles keyed at 30 fps). Names: `xfs_expr_<slug>`. Build through WolvenKit's animation import (as `.anims.glb`) from an existing vanilla set as the template; Check verifies the decoded result against the authored vector.
2. **Attach to the photo-mode face rig.** Preferred: ArchiveXL `animations:` with `component: face_rig` on the photo-mode head, which merges sets without touching any `.app`. Fallback: an ArchiveXL `.app` patch that adds a separately named animation-setup component (`xfs_PhotomodeAnimations`), so it never replaces the Mega Pack's or vanilla's `PhotomodeAnimations`. The runtime session decides between them.
3. **Menu records.** TweakXL `PhotoModeFaces.xfs_<slug>` (`$base: PhotoModeFaces.facial_neutral`, `displayName`, `faceId`) appended once to `photo_mode.character.faceAnimations`.
4. **The CSV.** Resolve the **winning** `photomode_facial_poses.csv` among the user's installed mods (the resolver's normal archive precedence), then write a superset: every existing row unchanged, plus XF rows at the next free indices, with `FallbackAnimationName` `facial_neutral` so a missing set degrades to a neutral face instead of nothing. faceIds are allocated from that resolved table at Build time and recorded in the manifest. This follows the "interpret the game's files, no per-mod adapters" rule: the Mega Pack is just whichever CSV wins, not a special case.
5. **Precedence.** The XF archive must win the CSV path. With first-alphabetical-wins, an archive named `XF…` loses to `xBaebsae_…`; the archive name that wins, and whether that is acceptable, is a decision for the maintainer. If XF cannot win, Check must say plainly which installed mod owns the expression table and what the user can do.
6. **Looping (animated faces only).** Same approach for the two face graphs: resolve the winner; if it already loops (the Mega Pack's does), leave it; otherwise ship a copy of the winner with `isLooped` set. Static expressions skip this step entirely.
7. **Creator idle (if approved).** A user idle is written as `ui_closeup_shot` in a higher-priority set on `face_rig` if shadowing works, else as a per-user replacement of `ui_female_face.anims`/`ui_male_face.anims` that keeps every other vanilla clip. Check reports that the inventory preview shares it.
8. **Branding and packaging.** Expressions join the one XF-branded mod by default; the name is the maintainer's call. Omitted details follow the partial-export rules; nothing is presented as game-tested until a session confirms it.

## Runtime questions for one batched session

Prepared as a single session, after the offline pieces exist. The first three can use existing mods and a CET console, before any XF build exists.

| # | Question | How | Evidence to capture |
|---|---|---|---|
| R1 | Which facial setup does the photo-mode `face_rig` use, and which animation sets does it hold after ArchiveXL? | CET (or the XF bridge once it runs): find the photo-mode puppet, read its `face_rig` component's `facialSetup`, `graph`, `rig` and `animations.gameplay`; also dump its sibling animation-setup components | Printed paths, before and after enabling the Mega Pack |
| R2 | Is faceId the database index, and can indices be sparse? | CET: apply `AnimFeature_PhotomodeFacial { facialPoseIndex }` with `ApplyFeature("PhotomodeFacial", …)` and push `updateFacialPose` on the photo-mode puppet, for vanilla indices and a Mega Pack index | Screenshots per index; ArchiveXL/CET logs |
| R3 | Does ArchiveXL `animations:` with `component: face_rig` reach the photo-mode face, and does a higher-priority set shadow a vanilla clip name? | A tiny test archive: a set holding one clip named `facial_happy` (actually a copy of vanilla `facial_surprised`) at priority 200 | Does "Happy" look surprised? ArchiveXL log lines "Merging animations from …" |
| R4 | Does a WolvenKit-imported, Studio-authored 2-frame expression play exactly as the preview shows? | One expression exported both as a copy of a decoded vanilla vector and with one control changed | Matched fixed-camera screenshots against the preview |
| R5 | Can a new row in a superset CSV and a new `PhotoModeFaces` record appear in the list and play, alongside the Mega Pack's rows? | The Build from plan steps 1–5 on a throwaway MO2 profile | List screenshot; face screenshot; logs |
| R6 | Does a shadowed or replaced `ui_closeup_shot` play in the creator, and what does the inventory preview show? | One authored idle, labelled as such | Short capture of both screens |
| R7 | Do the look-at blinks stack with blinks baked into an expression? | Mega Pack face with baked lid closure, move the look-at target | Capture |
| R8 | Do multi-frame body poses animate in photo mode? | An existing animated pose, if any installed pack has one; otherwise defer | Capture |

Runtime-bridge experiments worth adding to its phase 2: a read-only `face_rig` dump (R1), a write-gated "apply photo-mode facial index" call (R2), and later "apply this control vector" for live preview in game.

## Questions for the maintainer

1. **Scope of the first version**: static expressions only, or animated/looping faces too? Static needs no graph override and has the cleanest registration.
2. **Editor interaction**: is Option 2 (region handles plus a controls drawer) the right default, with sculpt later?
3. **Precedence with other expression mods**: the XF expression table must win a single-owner file. Is it acceptable for the Studio to name its archive so it sorts first, carrying the other mods' rows forward, or should it instead tell the user which mod owns the table and stop?
4. **Male V and NPCs**: export for both body genders by default (same vector, two skeletons)? Should expressions also be offered to NPC photo-mode puppets, as the Mega Pack does?
5. **Creator idle replacement**: is a user-authored idle that replaces the creator's close-up loop (and the inventory preview's) wanted, given it is the only idle slot the game offers?
6. **Mod naming**: expressions join the combined XF mod by default; what should the expressions part be called if split out?
7. **In-game test timing**: R1–R3 need only a CET console and existing mods; should they join the next scheduled session?

## Blink-track notes (for the coordinator)

The face graphs blink only on look-at transitions (`generic_facial_additives.anims`: fast, half, slow, tiny, normal); both genders' `face_rig` components reference the male player facial setup; several expressions hold partial lid closure. Details in the [evidence note](../animation/expressions-evidence.md#notes-for-the-blink-track).
