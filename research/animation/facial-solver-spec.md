# Facial solver: behavioural specification

> **Clean-room statement.** This specification was written from reading the Cyberpunk IO Suite, the WolvenKit organisation's Cyberpunk 2077 Blender add-on ([GitHub](https://github.com/WolvenKit/Cyberpunk-Blender-add-on), commit `7a4ee793c36d9615946fe87ec9d42cde7568021d`, add-on version 2.1.0, declared `GPL-3.0-or-later` in its `blender_manifest.toml`), as a behavioural reference, and from reading the game's own facial setup and rig data. It describes what that solver computes, in our own words and standard notation. It contains no code from the IO Suite, and no function in it is a transliteration of the add-on's code. An engineer implementing XF Studio's solver works from this document and the game data only, and checks the result against the IO Suite run as an external black box (§9). The IO Suite is credited in the [community credits](../../docs/community-credits.md).

**Status: specification, 28 September 2026; implemented the same day** (`src/engines/facial-rig/solver.ts`, [implementation notes](#10-implementation-notes)): every group of §9 passes against the IO Suite. Nothing here has runtime evidence. Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[resource]** read from the game's files, **[reference]** the IO Suite's behaviour (a community reading of the engine, not the engine), **[hypothesis]** not established. Where the IO Suite's behaviour may differ from the game's, §7 says so; the implementation reproduces the IO Suite first (it is the only oracle we have) and keeps each doubtful choice behind a named option.

Background: [facial animation §1](../../knowledge/facial-animation.md#1-from-control-values-to-moving-bones), [facial expressions §1](../../knowledge/facial-expressions.md#1-the-face-is-driven-by-controls-not-bones), [expression editor design, phase 5](expression-editor-design.md).

## Contents

1. [Purpose and scope](#1-purpose-and-scope)
2. [Conventions](#2-conventions)
3. [Inputs](#3-inputs)
4. [The solve, stage by stage](#4-the-solve-stage-by-stage)
5. [Numerical details](#5-numerical-details)
6. [Worked examples](#6-worked-examples)
7. [Where the IO Suite may differ from the game](#7-where-the-io-suite-may-differ-from-the-game)
8. [The implementer's interface](#8-the-implementers-interface)
9. [Test vectors](#9-test-vectors)
10. [Implementation notes](#10-implementation-notes)

## 1. Purpose and scope

The facial solver turns one vector of face **control values** (float tracks on the face rig) into a **local rotation and translation delta for each face joint**, plus a small set of **output tracks** (wrinkle weights) the skin shader reads. The Studio needs it in the app, without Python, for the creator idle's face, the game's blink and the live Expression editor.

In scope: everything between "absolute track values for one instant" and "local joint transforms and wrinkle weights for that instant". Out of scope: sampling clips into track values (§3.3 says what the solver expects), skinning, eye-shape joint seats ([facial animation §4](../../knowledge/facial-animation.md#4-eye-shapes-move-the-joints-too)) and binding the result to meshes (the Studio's face driver already does that).

## 2. Conventions

| Topic | Convention | Grade |
|---|---|---|
| Axes | REDengine: right-handed, **Z up**. The Studio converts to glTF (Y up) only at the end, by mapping a vector (x, y, z) to (x, z, −y) and a quaternion (x, y, z, w) to (x, z, −y, w), the basis WolvenKit's rig export uses | [resource] |
| Units | Translations in **metres** (a typical pose moves a joint 0.1 to 5 mm, i.e. 0.0001 to 0.005). Control values are unitless, mostly 0 to 1; the JALI strengths run 0 to 2 | [resource] |
| Rotations | **Quaternions only.** No stage uses Euler angles, degrees or radians. Angles quoted in our pages ("the upper lid turns 37°") are derived for people to read. The degrees mistake found in the body deformation rig ([deformation rig evaluator](deformation-rig-evaluator.md)) has no counterpart here; do not introduce an angle anywhere in the solve | [resource] [reference] |
| Quaternion storage | The game's JSON stores a quaternion as `i, j, k, r`; read it as (x, y, z, w) with w = `r`. The solver works in (x, y, z, w) | [resource] |
| Quaternion product | Hamilton product. For a = (**a**, a_w), b = (**b**, b_w): a ⊗ b = (a_w **b** + b_w **a** + **a** × **b**, a_w b_w − **a** · **b**). "Apply b after a in a's frame" is a ⊗ b | standard |
| Indices | Track indices are positions in the rig's `trackNames` (0-based). Joint indices are positions in the rig's `boneNames` (0-based). Every "track" a facial-setup table names is such a rig track index, except where §3.2 says it is an in-between index or a corrective index | [resource] |
| clamp01(x) | min(1, max(0, x)) | — |
| ε_w | The weight threshold, **0.001**. Its comparisons differ by stage (≤ in some, < in one); §5.6 lists them | [reference] |

## 3. Inputs

### 3.1 The face rig (`.rig`)

The face skeleton the setup was authored for (female V: `h0_000_pwa_c__basehead_skeleton.rig`, 344 joints, 414 tracks) [resource]. Fields used:

| Field | Use |
|---|---|
| `boneNames` | Joint order and names; the solver's output is indexed by it |
| `boneParentIndexes` | Hierarchy for forward kinematics after the solve (−1 for the root) |
| `boneTransforms` | Rest pose per joint: `QsTransform` with `Rotation` (i, j, k, r), `Translation` (X, Y, Z, W; W ignored) and `Scale` (X, Y, Z, W; W ignored), local to the parent |
| `trackNames` | Track order; must be at least as long as the setup's track segments (§3.3) |
| `referenceTracks` | Rest value of every track: the vector a face clip's additive values are added to |

Not used by the solve: `levelOfDetailStartIndices`, `aPoseLS`/`aPoseMS`, `referencePoseMS`, `parts`, `ikSetups`, `distanceCategoryToLodMap`. On the female head rig every joint any pose moves (266) has an identity rest rotation and unit rest scale [resource], which makes the composition question of §4.13 moot for that rig.

### 3.2 The facial setup (`.facialsetup`)

The setup that turns controls into poses (`animFacialSetup`, `version` 8 on the 2.31 game). V's face rig entity names the male player setup, and the Studio currently uses the female head's own; which one the engine uses is open ([facial animation §3](../../knowledge/facial-animation.md#3-which-facial-setup-v-uses)). Both have the same structure. Everything the solve needs is in **`bakedData`** plus the two pose buffers; a setup without `bakedData` cannot be solved (refuse it in plain words) [reference].

**Root fields.**

| Field | Meaning |
|---|---|
| `info.tracksMapping` | `numEnvelopes` (13), `numMainPoses` (141), `numLipsyncOverrides` (86), `numWrinkles` (33): the track segment sizes (§3.3) |
| `info.face` / `info.eyes` / `info.tongue` | Per-part counts (`numAllMainPoses`, `numAllMainPosesInbetweens`, `numAllCorrectives`, `numGlobalLimits`, …) for validation, and `wrinkleStartingIndex`: the first output track of that part's wrinkle block |
| `posesInfo.<part>` | Per-part pose buffer counts (`numMainPoses` = in-betweens, `numMainTransforms`, `numMainScales`, `numCorrectivePoses`, …) for validation |
| `usedTransformIndices` | The joints the setup can move (266). Informational: every pose transform's joint is in it |
| `bakedData.Data.LipsyncOverridesIndexMapping` | `numLipsyncOverrides` entries; entry i is the **track index** that lipsync override track i scales (§4.6) |
| `bakedData.Data.JointRegions` | One region per rig joint (0 eyes, 1 nose, 2 mouth, 3 jaw, 4 ear, 255 none). Not used by the solve; used by the Studio's eye-shape seats |
| `faceCorrectiveNames`, `tongueCorrectiveNames` | Names of the face and tongue correctives, by corrective index (useful for diagnostics and test names; the eyes part has none) |
| `useFemaleAnimSet`, `rig`, `inputRig` | Not used by the solve |

**Per-part baked tables** (`bakedData.Data.Face`, `.Eyes`, `.Tongue`). Each part is solved independently, in a fixed order (§4.1). Counts below are the female head setup's (face / eyes / tongue) [resource].

| Table | Entry fields | Meaning |
|---|---|---|
| `EnvelopesPerTrackMapping` (121 / 12 / 18) | `Track`, `Envelope`, `LevelOfDetail` | The main-pose tracks this part uses, each with its envelope type (which muzzle mutes it, §4.3) and the coarsest LOD at which it still acts |
| `GlobalLimits` (68 / 0 / 18) | `Track`, `Envelope`, `Min`, `Mid`, `Max`, `IsCachable` | Speech limits: a cap on a track's weight, chosen by a JALI strength (§4.4). `IsCachable` unused |
| `InfluencedPoses` (31 / 0 / 4) + `InfluenceIndices` (60 / 0 / 4) | `Track`, `NumInfluences`, `Type` | A track reduced by the sum of other tracks; its `NumInfluences` influencer track indices are the next unread entries of `InfluenceIndices` (§4.5) |
| `UpperLowerFace` (121 / 12 / 18) | `Track`, `Part`, `Unknown` | Which face-scaling multiplier applies to the track: 0 none, 1 upper face, 2 lower face (§4.6). `Unknown` unused |
| `LipsyncPosesSides` (121 / 12 / 18) | `Track`, `Side` | Tracks that receive an added lipsync pose value (§4.8). `Side` (0 mid, 1 left, 2 right) is unused by the IO Suite |
| `AllMainPoses` (121 / 12 / 18) | `Track`, `NumInbetweens`, `Unknown` | The part's main poses in order; each owns `NumInbetweens` consecutive entries of the two lists below and of the pose buffer. `Unknown` unused |
| `AllMainPosesInbetweens` (133 / 12 / 21) | float | In-between thresholds τ, `NumInbetweens` per main pose, ascending, the last one 1.0 (always, in the vanilla setups) |
| `AllMainPosesInbetweenScopeMultipliers` (12 / 0 / 3) | float | σ, `NumInbetweens − 1` per main pose (none for a single in-between): σ_j = 1 / (τ_{j+1} − τ_j), stored precomputed |
| `GlobalCorrectiveEntries` (632 / 0 / 4) | `Index`, `Track`, `Unknown` | Corrective `Index` is driven by main track `Track`. `Unknown` is 0 or 1 (§4.11) |
| `InbetweenCorrectiveEntries` (48 / 0 / 4) | `Index`, `Track`, `Unknown` | Corrective `Index` is driven by **in-between pose index** `Track` of this part (a position in the part's pose buffer, not a rig track) |
| `CorrectiveInfluencedPoses` (13 / 0 / 0) + `CorrectiveInfluenceIndices` (23 / 0 / 0) | `Index`, `NumInfluences`, `Type` | Corrective `Index` reduced by the sum of other correctives' weights; its influencers (corrective indices) are the next unread entries of `CorrectiveInfluenceIndices` (§4.12) |
| `Wrinkles` (33 / 33 / 33) | track index | Source track of each wrinkle output; output i goes to track `wrinkleStartingIndex + i` (§4.14) |

Entries of the two corrective-entry tables are grouped by `Index` for evaluation but keep their file order within a corrective. Every corrective in the vanilla setups has at least one entry.

**Pose buffers** (`mainPosesData.Data.<Part>`, `correctivePosesData.Data.<Part>`), each with three lists:

| List | Fields | Meaning |
|---|---|---|
| `Poses` | `TransformIdx`, `NumTransforms`, `ScaleIdx`, `IsScale`, `Flag1`, `Flag2`, `Flag3` | One entry per **in-between** (main buffer: 133 / 12 / 21) or per corrective (255 / 0 / 4). Its transforms are `Transforms[TransformIdx … TransformIdx + NumTransforms − 1]` |
| `Transforms` | `Bone`, `Rotation` (i, j, k, r), `Translation` (X, Y, Z), `JointRegion`, `Unknown` | A joint (rig joint index) and its rotation and translation **delta at full weight** |
| `Scales` | quaternion-typed: `i, j, k` per-axis values, `r` = 1 | Scale data for poses with `IsScale` = 1 (§7, item S1). The IO Suite ignores it |

Main pose i with in-betweens j = 0 … n_i − 1 uses main-buffer pose **b(i, j) = (n_0 + … + n_{i−1}) + j**. Each in-between's transforms are a complete pose at that in-between's threshold, not a difference from the previous in-between [reference: the IO Suite previews a control at 1.0 by showing its last in-between's pose alone].

### 3.3 The track vector

The solver takes **absolute** values for all tracks (414 on the female head). The tracks come in five consecutive segments, sized by `info.tracksMapping` [resource]:

| Segment | Range (female head) | Count | Role in the solve |
|---|---|---:|---|
| Envelopes | 0–12 | 13 | Global inputs, at fixed positions (below) |
| Main poses | 13–153 | 141 | Inputs; the controls (`eye_l_blink` = 21, `jaw_mid_open` = 82, …) |
| Lipsync overrides | 154–239 | 86 | Inputs; `…AnimOverrideWeight` |
| Lipsync pose outputs | 240–380 | 141 | **Inputs** despite the name: added to main track m at position m − 13 + 240 (§4.8) |
| Wrinkles | 381–413 | 33 | Outputs (§4.14); input values are ignored and overwritten |

The sum of the segment sizes must not exceed the rig's track count; refuse the pair otherwise.

**Envelope positions** (the IO Suite reads them by position; the implementation should read them by position too and check the names at compile time) [resource: female head `trackNames`]:

| Pos. | Name | Rest (`referenceTracks`) | Read by the IO Suite? | Clamp |
|---:|---|---:|---|---|
| 0 | `faceEnvelope` | 1 | **No** (§7, E1) | — |
| 1 | `upperFace` | 1 | Yes: upper-face multiplier | 0–1 |
| 2 | `lowerFace` | 1 | Yes: lower-face multiplier | 0–1 |
| 3 | `antiStretch` | 0 | No | — |
| 4 | `lipSyncEnvelope` | **0** | Yes: gates limits and overrides | 0–1 |
| 5, 6 | `lipSyncLeftEnvelope`, `lipSyncRightEnvelope` | 1 | No | — |
| 7 | `jaliJaw` | 1 | Yes: limit strength (envelope 0) | 0–2 |
| 8 | `jaliLips` | 1 | Yes: limit strength (envelope 1) | 0–2 |
| 9 | `muzzleLips` | 0 | Yes: how far limits pull (§4.4) | 0–1 |
| 10 | `muzzleEyes` | 0 | Yes: mutes envelope type 2 | 0–1 |
| 11 | `muzzleBrows` | 0 | Yes: mutes envelope type 3 | 0–1 |
| 12 | `muzzleEyeDirections` | 0 | Yes: mutes envelope type 4 | 0–1 |

Our earlier pages said "envelopes rest at 1"; only positions 0–2 and 5–8 do. Override weights rest at 1, main poses and lipsync pose outputs at 0. A few neck and gravity main tracks rest at tiny non-zero values (up to 4.5 × 10⁻⁶), which the envelope threshold zeroes [resource].

**How callers build the vector** (not the solver's job, stated so tests agree): for an `AdditiveFromRefPose` face clip, value = `referenceTracks[k]` + the clip's value for track k at that time (constant tracks give their constant, keyed tracks are interpolated linearly between keys; absent tracks add 0). An expression vector likewise adds its control weights to the reference. The Studio's clip sampling already does this ([CC idle](cc-idle.md)).

### 3.4 Face-scaling and global inputs

"Face scaling" is the pair `upperFace` / `lowerFace` (positions 1 and 2): each main track whose `UpperLowerFace.Part` is 1 or 2 is multiplied by the matching value after the first influence pass (§4.6). On the female setup, part 1 covers the 21 brow, inner and outer squint, nose compress and breathe, and `sculp_mid_slide` tracks; part 2 covers 57 mouth tracks; part 0 (unscaled) covers the blink, widen, gaze, jaw, neck, ears, cheek puff and suck and face-gravity tracks [resource]. Both multipliers are clamped to 0–1, so face scaling can only reduce motion. The JALI strengths (positions 7, 8) scale the speech limits; the muzzles mute groups of controls. Nothing else scales the face: poses carry no scale that the IO Suite applies (§7, S1).

### 3.5 Compile-time validation

Before the first solve, check and refuse in plain words when any fails: `bakedData` present; version 8 (warn, don't refuse, on another version); segment sum ≤ rig track count; the envelope names at positions 0–12; every per-part list's length matches its `info.<part>` count; `AllMainPosesInbetweens` has Σ n_i entries and the scope list Σ (n_i − 1); every part's main pose buffer has Σ n_i poses and its corrective buffer as many poses as correctives; thresholds ascending; every `Bone` below the rig's joint count; every in-between corrective reference below the part's in-between count; `LipsyncOverridesIndexMapping` has `numLipsyncOverrides` entries, each a main-segment track.

## 4. The solve, stage by stage

### 4.1 State and order

- **I**: the input vector (read-only during the solve).
- **O**: the working track buffer, one value per track, **shared by all parts** and initialised to a copy of I.
- Per joint j: a rotation delta **q_j** initialised to identity (0, 0, 0, 1) and a translation delta **t_j** initialised to (0, 0, 0).
- Solve LOD λ (the Studio uses 0) and LOD fade φ (the Studio uses 0).

The parts are solved **in the order tongue, eyes, face**, each running stages 4.2 to 4.14 in order against the same O, q and t [reference]. Because each part begins by rewriting its own main tracks from I (§4.3), a track two parts share (`jaw_mid_open` is in the tongue and the face; the gaze tracks in the eyes and the face) is re-derived from the input by each part; tracks a part does not map keep whatever earlier parts left in O. The solve resets all state first, so its result depends on I, λ and φ only.

### 4.2 Globals

At the start of each part, read from O (which still equals I at positions 0–12, since no part maps them): u = clamp01(O[1]), l = clamp01(O[2]), e = clamp01(O[4]), J_jaw = clamp(O[7], 0, 2), J_lips = clamp(O[8], 0, 2), m_lips = clamp01(O[9]), m_eyes = clamp01(O[10]), m_brows = clamp01(O[11]), m_dir = clamp01(O[12]).

### 4.3 Envelopes (muzzles and LOD)

For each `EnvelopesPerTrackMapping` entry (track k, type τ, LOD L):

w = clamp01(**I**[k]) · f(τ) · g(L), then w ← 0 if w ≤ ε_w; set O[k] ← w,

where the muzzle factor f is 1 − m_eyes for type 2, 1 − m_brows for type 3, 1 − m_dir for type 4, and 1 for types 0, 1 and 5; and the LOD factor g is 0 if L < λ, 1 − φ if L = λ, and 1 if L > λ [reference]. At λ = 0, φ = 0 the LOD factor is always 1.

Envelope types on the female face, by the tracks they hold [resource]: 0 jaw and `lips_corner_sticky` (16); 1 nose sneer and most lip controls (54); 2 blink and widen (4); 3 brows (10); 4 gaze (8); 5 squints, nose compress and breathe and the rest (29). The eyes part maps its pupils as type 2 and its gaze as type 4; the tongue maps everything as type 0. **Note that no envelope type is muted by `muzzleLips`** in the IO Suite; it acts only in §4.4 (§7, E2).

### 4.4 Speech limits

Skipped entirely unless e ≠ 0 (exactly zero after clamping; at rest e = 0, so this stage does nothing unless a lip-sync clip raises `lipSyncEnvelope`). For each `GlobalLimits` entry (track k, envelope ν, Min, Mid, Max), in order:

1. Strength s = J_jaw if ν = 0, J_lips if ν = 1, otherwise 1.
2. Cap c(s): the piecewise-linear curve through (0, Min), (1, Mid), (2, Max). For s ≤ 1, c = Min + s (Mid − Min), clamped to the interval between Min and Mid; for s > 1, c = Mid + (s − 1)(Max − Mid), clamped to the interval between Mid and Max.
3. If O[k] > c: O[k] ← O[k] + m_lips (c − O[k]). Otherwise unchanged.

So a limit bites only when both `lipSyncEnvelope` and `muzzleLips` are raised; `muzzleLips` = 1 pulls the weight all the way down to the cap. Female face limits use ν = 1 (52) and ν = 0 (16); the tongue's 18 limits all have Min = Mid = Max = 0 [resource].

### 4.5 Track influences (first pass)

For each `InfluencedPoses` entry, **in file order, updating O in place** (a later entry sees an earlier entry's result):

1. w = O[k]. If w ≤ 0, skip the entry (leave O[k] as is).
2. S = Σ O[i] over the entry's influencer tracks.
3. If S ≥ 1: w ← 0. Otherwise by `Type`: 0 (linear) w ← min(w, 1 − S); 1 (exponential) w ← w (1 − S²); 2 (organic) w ← w (1 − S)². Any other type leaves w unchanged.
4. O[k] ← w.

On the female face 26 influences are linear and 5 exponential (the jaw moves suppressed by `jaw_mid_close`); none is organic [resource]. Examples: `eye_l_widen` is reduced by `eye_l_blink` + `eye_l_dir_up`; `eye_l_brows_lower` and `…lateral` by `eye_l_brows_raise_out`; `lips_l_funnel` by six lip controls.

### 4.6 Upper and lower face

For each `UpperLowerFace` entry (track k, part p): O[k] ← clamp01(O[k] · M_p) with M_0 = 1, M_1 = u, M_2 = l. (Even part 0 entries are clamped, which changes nothing here since earlier stages keep main tracks within 0–1.)

### 4.7 Lipsync overrides

Skipped unless e ≠ 0. For each override i (0 … numLipsyncOverrides − 1): with k = `LipsyncOverridesIndexMapping`[i] and v = **I**[overrideStart + i], O[k] ← O[k] · (1 + e (v − 1)). No clamp. At v = 1 (rest) nothing changes; a lip-sync clip lowering v mutes the expression's mouth.

The IO Suite runs this stage inside every part's pass, over all 86 overrides, on the shared buffer. For joint output this equals applying it **once per part to the tracks that part maps**, because each part rewrites its own tracks from I first (§4.3) and a part's poses are blended before the next part runs; only the leftover values of tongue tracks in O differ, and nothing reads them afterwards on the vanilla setups. An implementation may apply it per part to that part's mapped tracks; the processed-track comparison in §9 must then skip tongue tracks after the tongue pass.

### 4.8 Lipsync poses

For each `LipsyncPosesSides` entry (track k): O[k] ← clamp01(O[k] + **I**[k − n_E + p_LP]), where n_E is the envelope count (13) and p_LP the first lipsync-pose-output track (240), so track 21 receives input track 248. This is **not** gated by `lipSyncEnvelope`, and `Side` is ignored (§7, L2).

### 4.9 Track influences (second pass)

Exactly §4.5 again, on the updated O. Linear influences give the same result twice when their influencers have not changed; **exponential and organic ones compound** (a jaw open under `jaw_mid_close` = S ends up scaled by (1 − S²)², not (1 − S²)) [reference] (§7, I1).

### 4.10 In-betweens

Produces a weight β_b for every pose b of the part's main buffer, all starting at 0. For each main pose i (track k, n in-betweens with thresholds τ_0 < … < τ_{n−1} and multipliers σ_0 … σ_{n−2}), let w = O[k]:

- If w < ε_w: leave its in-betweens at 0.
- If n = 1: β_{b(i,0)} = w.
- Else if w ≤ τ_0: β_{b(i,0)} = w · σ_0.
- Else if w ≥ τ_{n−1}: β_{b(i,n−1)} = 1.
- Else find the segment j with τ_j ≤ w < τ_{j+1}; with x = (w − τ_j) σ_j: β_{b(i,j)} = 1 − x and β_{b(i,j+1)} = x.

At most two in-betweens of a control are non-zero, and they cross-fade linearly between thresholds. The first segment (0 to τ_0) fades the first in-between in with **the first gap's multiplier σ_0**, not 1/τ_0. The two agree whenever τ_0 equals the first gap, which holds for every multi-in-between control on the female face (9 at 0.5 / 1.0, `neck_throat_adamsApple_up` at 0.2 / 0.4 / 0.7 / 1.0) but not for the tongue's `tongue_mid_base_fwd` (0.5 / 0.8 / 1.0): there β reaches 0.5 × 3.33 = 1.67 at w = 0.5 and drops to 1 just above it [resource] [reference] (§7, B1). Reproduce this for parity.

### 4.11 Corrective weights

For each corrective c of the part, start with γ_c = 1:

1. For each of its `GlobalCorrectiveEntries` in file order: if the entry's `Unknown` > λ, set γ_c = 0 and stop; otherwise γ_c ← γ_c · clamp01(O[Track]).
2. If γ_c > 0, for each of its `InbetweenCorrectiveEntries` in file order: if `Unknown` > λ, set γ_c = 0 and stop; otherwise γ_c ← γ_c · clamp01(β_{Track}) (β of that in-between pose; 0 if the index is out of range).

A corrective is therefore the product of its drivers' processed weights (a combination shape that grows with every driver). The in-between entries let a corrective follow one in-between of a multi-in-between control: for example `jaw_mid_open1__lips_together_up__Corr` follows in-between 0 of `jaw_mid_open` (the 0.5 pose) and `jaw_mid_open0__…` in-between 1 (the 1.0 pose) [resource].

The IO Suite treats `Unknown` as a minimum LOD. On the female face three global entries and two in-between entries have `Unknown` = 1, so at λ = 0 correctives 104 `lips_together_dn__Corr`, 111 `jaw_mid_open0__lips_together_up__Corr` and 112 `jaw_mid_open0__lips_together_dn__Corr` **never fire** in the IO Suite (§7, C1). Reproduce this for parity.

### 4.12 Corrective influences

For each `CorrectiveInfluencedPoses` entry, **in file order, updating γ in place**: let γ = γ_Index. If γ ≤ ε_w, skip. Let S = Σ γ over the entry's influencer correctives (their current values). Then, with bit 0 and bit 1 of `Type`:

| `Type` | Bits | Result |
|---:|---|---|
| 0 | none | 0 if S ≥ 1, else min(γ, 1 − S) |
| 1 | bit 0 | 0 if S ≥ 1, else γ (1 − S²) |
| 2 | bit 1 | γ (1 − S) |
| 3 | bits 0 and 1 | γ (1 − S)² |

and finally γ_Index ← max(0, result). Types 2 and 3 have no S ≥ 1 cut-off: type 2 floors at 0, but type 3 grows back when S exceeds 1 (γ (1 − S)² is 0.25 γ at S = 1.5) [reference] (§7, C2). The female face uses all four types (3, 4, 4 and 2 entries); for example the blink's corrective suppresses `eye_l_brows_raise_in__eye_l_dir_dn__Corr` (type 0), and `lips_suck_dn__Corr` suppresses the lip-seal and upper-raise combinations [resource].

### 4.13 Pose blending

Main poses first, then correctives, each buffer in pose order. For each pose b with weight β_b (main) or γ_c (corrective) greater than ε_w, and for each of its transforms (joint j, rotation Δq, translation Δt), with w that weight:

1. **Translation, additive:** t_j ← t_j + w Δt.
2. **Rotation, composed then blended:** r = q_j ⊗ Δq (the pose's rotation applied after everything so far, in the joint's frame). If w ≥ 1 − 10⁻⁵, q_j ← r. Otherwise q_j ← nlerp(q_j, r, w):
   - if q_j · r < 0, negate r (shortest arc);
   - m = q_j + w (r − q_j);
   - if |m| ≥ 10⁻⁸, q_j ← m / |m|; otherwise q_j is left unchanged.

Because q_j is a unit quaternion, nlerp(q, q ⊗ Δq, w) equals q ⊗ nlerp(identity, Δq, w), with the shortest-arc sign taken from Δq's w: each pose's rotation is **scaled toward identity by normalised linear interpolation and then post-multiplied**. The result depends on pose order, so keep it. Translations of all poses simply add up (no normalisation of weights across poses).

Scale data (`IsScale`, `Scales`) is not applied (§7, S1). The eyes part's gaze poses turn `l_J_eye_JNT` / `r_J_eye_JNT` (up about 21°, down 30°, in and out 40° at full weight); its pupil poses are scale poses whose transforms are identity, except that `…pupil_wide` also moves the pupil joint 1.15 mm [resource].

### 4.14 Wrinkles

For each i of the part's `Wrinkles`: O[wrinkleStartingIndex + i] ← clamp01(1 − (1 − O[Wrinkles[i]])²). The source is the control's **processed** track weight after §4.9 (not an in-between weight). On the female setup all three parts list the same 33 sources and the same start (381), so the face pass, which runs last, decides the values [resource] [reference].

### 4.15 Results and the final joint transforms

The solve returns, for every rig joint, (q_j, t_j), and the buffer O. Of O, the wrinkle segment is the meaningful output; the lipsync pose output segment is passed through unchanged from I; the main segment holds the face pass's processed weights, which are useful for debugging (§9).

A joint's **local** transform (relative to its parent) is its rest transform followed by the delta, as the IO Suite applies it (a pose-bone delta after the rest) [reference]:

- rotation: q_rest ⊗ q_j;
- translation: t_rest + R(q_rest)(s_rest ⊙ t_j), where R(q) rotates a vector by q and ⊙ is the per-axis product;
- scale: s_rest.

Joints that no pose touched keep their rest. World transforms follow from `boneParentIndexes` in the usual way. On the female head rig every posed joint has identity rest rotation and unit scale, so this reduces to rotation q_j and translation t_rest + t_j (§7, T1). Convert to glTF axes last (§2).

## 5. Numerical details

### 5.1 Blend spaces

- **Tracks** are scalars combined by clamping, products and sums in plain linear space.
- **Translations** add linearly (weighted sum of deltas, no normalisation).
- **Rotations** accumulate by sequential post-multiplication, each pose's delta first scaled toward identity by nlerp. This is not slerp: the two agree exactly at w = 0.5, but elsewhere nlerp lags slerp by up to 0.08° for a 40° delta and 0.27° for a 60° one, well above the parity tolerance, so parity requires nlerp.
- **Correctives** are ordinary poses blended after all main poses of the same part: they are additive corrections on top, not overrides.

### 5.2 Additive versus override

Everything in the solve is additive on the joint side: nothing replaces a joint's transform. On the track side, influences, limits, muzzles, face scaling and overrides reduce weights (multiplicatively or by min), and lipsync poses add. The solver itself is not additive over its inputs: because of clamps, influences and correctives, solve(a + b) ≠ solve(a) + solve(b) in general, so the blink over an expression must be solved as one summed, clamped vector (as the game's graph adds the blink clip's tracks before the solve, [expression editor design §5](expression-editor-design.md)).

### 5.3 Normalisation

Only in nlerp (§4.13), with the 10⁻⁸ guard. Pose rotations in the file are unit quaternions to float32 precision; do not renormalise them at load (the IO Suite does not, and parity at 10⁻⁵ rad would still hold, but keep the data as stored). A weight of 1 (or within 10⁻⁵ of it) takes the composed product without normalising.

### 5.4 Precision

The IO Suite stores tracks, weights and pose data as 32-bit floats and does some scalar arithmetic in 64-bit. Store compiled data and results in `Float32Array`s and compute in JavaScript doubles; the differences stay far inside the tolerances of §9.4. Compare quaternions up to sign (q and −q are the same rotation).

### 5.5 Units and angles

Metres and unit quaternions throughout; no angle unit exists in the solve. If an implementation ever needs an angle (a diagnostic, a gizmo), it must name the unit in the variable and convert explicitly at the boundary.

### 5.6 Thresholds and clamps, in one place

| Where | Rule |
|---|---|
| Envelopes | weight ≤ 0.001 becomes 0 |
| Influences | entry skipped when the weight ≤ 0 |
| In-betweens | control skipped when the weight **<** 0.001 |
| Corrective influences | entry skipped when the corrective weight ≤ 0.001 |
| Pose blending | pose skipped when its weight ≤ 0.001; weights ≥ 1 − 10⁻⁵ take the full product |
| nlerp | result of norm < 10⁻⁸ discarded (previous rotation kept) |
| Clamps | inputs clamped 0–1 at the envelope stage; face scaling and lipsync poses clamp 0–1; corrective drivers clamped 0–1 as they multiply; JALI strengths 0–2; wrinkles 0–1; overrides and limits unclamped |

## 6. Worked examples

All on the female head setup at rest (the reference vector) with λ = 0 [resource, derived by hand from §4].

1. **Neutral.** Every main track rests at 0 or below 0.001, so every weight is 0: all joints identity and zero, all wrinkles 0.
2. **Left blink at 1.0** (`eye_l_blink`, track 21, +1). Envelope type 2 with m_eyes = 0: weight 1. `eye_l_widen` is 0, so its influence changes nothing. Upper/lower part 0: unchanged. One in-between: β = 1, so the blink pose's rotations are taken whole. `eye_l_blink__Corr` gets γ = 1 but has no transforms in this setup. The blink is not a wrinkle source. Result: exactly the blink pose's 30 joints, about 37° at the upper lid root ([facial animation §2](../../knowledge/facial-animation.md#2-how-a-blink-closes-the-eye)).
3. **Jaw open at 0.75.** In-betweens at 0.5 and 1.0, σ_0 = 2: segment 0, x = (0.75 − 0.5) × 2 = 0.5, so the 0.5 and 1.0 poses each get 0.5. Its wrinkle output is 1 − 0.25² = 0.9375.
4. **Widen 1.0 with blink 0.6.** Linear influence: widen ← min(1, 1 − 0.6) = 0.4, then the second pass gives the same 0.4.
5. **Jaw open 1.0 with jaw close 0.5.** Exponential influence twice: 1 × (1 − 0.25) × (1 − 0.25) = 0.5625.

## 7. Where the IO Suite may differ from the game

The IO Suite is a careful community reading, and its idle and blink look right in our previews, but it is not the engine and none of its choices has runtime evidence. Each item below is a place where its behaviour is a choice we cannot confirm offline. The implementation reproduces the IO Suite by default and names each alternative as an option (§8), so a runtime test can switch it.

| Id | IO Suite behaviour | Why it is doubtful | What would settle it |
|---|---|---|---|
| E1 | `faceEnvelope`, `antiStretch` and the left/right lipsync envelopes are never read | The names suggest `faceEnvelope` gates the whole face and the side envelopes weight lipsync poses by `LipsyncPosesSides.Side` | A clip or bridge probe setting `faceEnvelope` to 0 in game |
| E2 | No envelope type is muted by `muzzleLips`; types 2/3/4 are muted by the eye, brow and eye-direction muzzles | The 1:1 name pattern suggests type 1 (lips) would be muted by `muzzleLips` | A lip-sync scene with the muzzle raised, compared with a solve |
| L1 | Limits apply only when `lipSyncEnvelope` > 0, and pull by `muzzleLips` | Plausible (limits are for speech) but unconfirmed | As E2 |
| L2 | Lipsync pose outputs are added ungated and side-blind | See E1 | As E1 |
| I1 | Influences run twice; exponential and organic ones compound | A second pass may be meant only for the lipsync additions | Compare a jaw open plus jaw close pose in game |
| U1 | `UpperLowerFace.Part` 1 is upper, 2 is lower | The IO Suite's own data loader names these values differently (0 lower, 1 upper, 2 lipsync); the solver's reading fits the data (part 1 holds brows and squints, part 2 the mouth) [resource] | Lower `upperFace` in game |
| B1 | The first in-between segment uses σ_0 | 1/τ_0 would be continuous; only `tongue_mid_base_fwd` differs on the vanilla setups | Tongue pose at 0.5 in game (low priority) |
| C1 | A corrective entry's `Unknown` = 1 means "only at LOD ≥ 1", which disables three lip correctives at LOD 0 | The field may mean something else (a sign or inversion flag); a single-control corrective (`lips_together_dn__Corr`) that never fires at full detail is odd | Lip seal down at 1 in game, close-up, compared with both solves |
| C2 | Corrective influence types by bit (bit 0 quadratic, bit 1 no cut-off), with type 3 regrowing past S = 1 | The data loader names the four values differently (by speed, linear correction, both, simple) | Low priority: vanilla sums rarely pass 1 |
| S1 | Scale poses are ignored: the pupil narrow and wide poses (per-axis scale values −0.4 and +0.6 on the pupil joint) and one tongue pose | The game surely applies them (pupil dilation); a plausible reading is scale = 1 + w · value per axis, but that is a hypothesis. This is why the Studio's inert-control check reports both `…pupil_narrow` controls as moving nothing | Pupil narrow and wide at 1 in game, close-up on the eye |
| Q1 | Rotations blend by sequential nlerp with post-multiplication, in pose order | The engine may blend in another order or form (for example a weighted sum of deltas normalised once) | Only visible in strong combinations; compare the cheek-stack and vanilla expressions in game |
| T1 | Delta applied after the rest, translation in the joint's rest frame | Moot for the female head rig (identity rest rotations and unit scales on every posed joint); matters only for a rig that breaks that | Check any new rig's posed joints at compile time and warn |
| W1 | Wrinkle weight 1 − (1 − w)² of the processed control weight | The curve and the source (processed weight rather than raw) are the IO Suite's reading | The skin shader's wrinkle inputs, read through the bridge |
| V1 | Solved with the female head's own setup | The face rig entity names the male player setup ([facial animation §3](../../knowledge/facial-animation.md#3-which-facial-setup-v-uses)) | Runtime check R1 on the [test card](../runtime/runtime-bridge-test-card.md#expression-checks-r1-and-r2) |

Fields nobody reads (`Flag1`–`Flag3` of poses, `JointRegion` and `Unknown` of transforms, `IsCachable`, the `Unknown` of main poses and upper/lower entries) may carry engine behaviour the IO Suite does not model [hypothesis].

## 8. The implementer's interface

### 8.1 Placement and purity

A pure TypeScript module with no Three.js, DOM, worker, file or network access, owned by the Expressions domain and consumed through the editor design's `FacialSolverPort` ([expression editor design §5](expression-editor-design.md)) as its in-app implementation. It takes parsed game data and numbers and returns numbers; loading the rig and setup through WolvenKit stays in the host, as it does today. Its results depend only on its arguments.

### 8.2 Functions

```ts
/** Validate and flatten a rig and facial setup (their WolvenKit JSON RootChunks) into typed arrays. Throws FacialSetupError with a plain reason. */
compileFacialRig(rig: RigJson, setup: FacialSetupJson, options?: FacialCompileOptions): CompiledFacialRig;

/** Scratch and result buffers for one solve at a time, allocated once per compiled rig. */
createFacialPose(rig: CompiledFacialRig): FacialPose; // { rotations: Float32Array(4·J), translations: Float32Array(3·J), tracks: Float32Array(T) }

/** Solve one instant. Writes every value of `out` (no dependence on its previous contents); returns `out`. Allocates nothing. */
solveFace(rig: CompiledFacialRig, tracks: Float32Array, out: FacialPose, options?: FacialSolveOptions): FacialPose;

/** Solve many instants (a clip or a test batch) into one set of frame-major arrays. */
solveFaceFrames(rig: CompiledFacialRig, frames: Float32Array /* F·T */, out?: FacialFrames): FacialFrames;

/** Local transforms per joint: rest followed by the solved delta (§4.15), REDengine axes; optionally glTF axes. */
composeLocalPose(rig: CompiledFacialRig, pose: FacialPose, out: Float32Array /* 10·J: t xyz, q xyzw, s xyz */, axes?: "red" | "gltf"): Float32Array;
```

`CompiledFacialRig` exposes, read-only: `jointNames`, `parentIndices`, `trackNames`, `referenceTracks` (a fresh copy on request), `trackIndex(name)`, the segment ranges, the per-part main-pose tracks and in-between thresholds (for UIs that show in-between marks), the corrective names, and `posedJoints`. It keeps the rest transforms for `composeLocalPose`.

`FacialSolveOptions`: `lod` (default 0), `lodFade` (0), and `trace?: FacialTrace` which, when given, receives each part's processed track weights after every stage, its in-between weights and its corrective weights before and after influences (debugging against the oracle; off in production, and the only path allowed to allocate).

`FacialCompileOptions.compat`: the §7 alternatives, each defaulting to the IO Suite's behaviour: `faceEnvelope: "ignore" | "gate"`, `lipsMuzzle: "limits" | "envelope"`, `influencePasses: 2 | "second-only-if-lipsync"`, `firstInbetweenSegment: "firstGap" | "threshold"`, `correctiveFlag: "minLod" | "ignore"`, `scalePoses: "ignore" | "apply"` (with `"apply"` also adding scale to `FacialPose`). Parity tests run the defaults; an in-game test can flip one at a time.

### 8.3 Data layout

Flatten each part at compile time into compressed-row arrays: envelope entries (track, factor slot, LOD), limits, influences (row starts into a flat influencer array), upper/lower multipliers, lipsync pose sources, main poses (track, first in-between, count, thresholds, multipliers), corrective drivers (two row-start tables), corrective influences, and each pose buffer as row starts into flat `Int16Array` joints, `Float32Array` rotations (x, y, z, w) and translations. No objects, maps or closures in the solve loop.

### 8.4 Performance budget

- **60 solves per second on the page** with room to spare: **median ≤ 0.5 ms, 99th percentile ≤ 1.5 ms** per `solveFace` on the maintainer's machine for any vector, including the worst case of every face control at 1 (about 25,000 transform updates across 388 face poses, plus the tongue and eyes). The IO Suite takes 0.6 to 0.9 ms in NumPy; the Studio's page-to-pose round trip through it is 5 to 8 ms ([expression editor design §5](expression-editor-design.md)).
- **No allocation per solve** (reused typed arrays), so no garbage-collection pauses during drags or clip playback.
- **Compile ≤ 50 ms** for the female setup (the IO Suite compiles in about 0.2 s).
- A clip is solved frame by frame on demand at playback rate; pre-solving the whole idle (663 frames) should take under 0.5 s where a cache is wanted.
- Measure with the Studio's own bench pattern and record the numbers in the [performance track](../backlog/performance.md). Main-thread solving is expected to fit; move it to a worker only if measurement says so.

## 9. Test vectors

### 9.1 Oracle and harness

The oracle is the pinned, unmodified IO Suite at commit `7a4ee793`, run as a separate program through our own `projects/xf-studio/authoring/tools/facial_solver_server.py`, exactly as the live preview ran it before XF Studio's own solver replaced it. The implementer uses it strictly as a black box through its line protocol and never reads the IO Suite:

- Start: `python projects/xf-studio/authoring/tools/facial_solver_server.py --addon <IO Suite checkout> --rig <rig .json> --setup <facialsetup .json>` (WolvenKit JSON of the two files; the local intake at `research/consumers/cc-idle/json/` holds the female head's, SHA-256 `454e38a2…` for the rig and `aae907a8…` for the setup, and the Studio's preview cache `facial/` holds the resolved ones). Use the full Python interpreter path and run it under the memory guard (`tools/memory_guard.py --limit 1 -- …`), as AGENTS.md requires.
- It prints one ready line: `{"ready": true, "joints": 344, "tracks": 414, "compileMs": …}`.
- Request, one line: `{"id": n, "frames": [[414 absolute track values], …]}`.
- Answer, one line: `{"id": n, "ms": …, "q": base64, "t": base64}`: little-endian float32, frame-major, `q` as (x, y, z, w) per joint and `t` as (x, y, z) per joint, REDengine axes, the solve's raw **deltas** (not composed with rest).
- **Processed tracks** (our own MIT wrapper): an optional request field `"outputs": true` also returns `"o"`, the solve's processed track buffer (float32, frames × 414), which the wrinkle and processed-weight comparisons use. Added in the wrapper's request handling only.

The harness (new, ours, TypeScript) builds every vector from the reference tracks plus named control values (by `trackNames`), sends them in batches of up to 256 frames, stores inputs and oracle answers as a local fixture, and compares `solveFace` against it. Fixtures are game-derived: keep them in an ignored location (the preview cache or `experiments/<id>/generated/`), never commit them; the committed test skips with a plain message when the fixture or the game data is missing.

### 9.2 Cases

All on the female head setup unless stated, λ = 0, each vector = reference tracks plus the listed values.

| Group | Cases | Count |
|---|---|---:|
| A. Baseline | Neutral (reference exactly); all tracks 0 (envelopes off too); one control at 0.0009, 0.001 and 0.0011 (threshold edges); reference plus 10⁻⁶ on every main track | 6 |
| B. Each main pose alone | Every main control of the three parts (121 face, 12 eyes, 18 tongue; `jaw_mid_open` counts once per part but is one vector) at **0.5 and 1.0** | 302 |
| C. In-between thresholds | Each multi-in-between control (the 9 at 0.5 / 1.0, `neck_throat_adamsApple_up`, `tongue_mid_base_fwd`) at 0.001, 0.0011, τ_0 / 2, each τ_k and τ_k ± 10⁻⁴, and every segment midpoint; `tongue_mid_base_fwd` at 0.25, 0.5 and 0.5001 shows the B1 jump | ≈ 122 |
| D. Influences | Widen 1 with blink 0.3, 0.6, 1.0; widen 1 with gaze up 0.5; brows lower 1 with outer raise 0.4; jaw open 1 with jaw close 0.25, 0.5, 1.0 (compounding); left funnel 1 with purse 0.5 and suck 0.7 (sum over 1); corner wide with four influencers; tongue base up with its influencer | 12 |
| E. Face scaling | A fixed vector (brows raise 1, inner squint 1, lip corners up 1, jaw open 0.5, blink 0.5) at upperFace × lowerFace ∈ {0, 0.5, 1}²; plus upperFace 1.5 and −0.5 (clamps) | 11 |
| F. Muzzles | Each of `muzzleEyes` (blink 1, widen 1), `muzzleBrows` (brow raises 1), `muzzleEyeDirections` (gaze 1), `muzzleLips` (corners up 1, no lipsync) at 0.5 and 1.0 | 8 |
| G. Lip sync | With `lipSyncEnvelope` 1, `muzzleLips` 1 and lip corners up 1 plus jaw open 1: `jaliJaw` and `jaliLips` each at 0, 0.5, 1, 1.5, 2 (10); `muzzleLips` 0.5 (2); `lipSyncEnvelope` 0 with `muzzleLips` 1 (limits off) (1); override weights 0 and 0.5 at `lipSyncEnvelope` 0.5 and 1 (3); lipsync pose outputs 0.4 on corners up at main 0 and 0.8 (clamp) and on the blink (3); tongue controls with `muzzleLips` 1 (all-zero limits) (1) | 20 |
| H. Correctives | For **every corrective** (255 face, 4 tongue): its global drivers at 1.0, and at 0.6; drivers that are in-between entries set by putting the owning control at that in-between's threshold. Named extras: squint inner plus outer lower; gaze down plus in; blink 1 with inner brow raise 1 and gaze down 1 (corrective influence type 0); jaw open 0.5 and 1.0 with lip seal up 1 (in-between correctives, and the C1 correctives 111/112); lip seal down 1 alone (C1 corrective 104); `lips_suck_dn` 1 with lip seal down and both upper raises (types 1–3); jaw open 0.5 with chin raise and its six influencers (type 2, sum over 1) | 518 + 12 |
| I. The blink | Each eye 0.1 … 1.0 in steps of 0.1 (20); both eyes together, same steps (10); blink 1 with widen 1, with gaze down 1, with gaze up 1, with outer squint 0.5 (4); the game's `additive__blink_normal__01` at 60 Hz (31 frames) and the Closure scrub's 21 steps, sampled as the blink bake samples them | 34 + 52 frames |
| J. Creator idle | `ui_closeup_shot` at 30 Hz (663 frames) and `ui_closeup_shot_eyes` at 30 Hz (121 frames), built from the clips as §3.3 says (the idle bake's samples) | 784 frames |
| K. Smile and cheek | Both lip corners up 1; the same with sharp corners up 0.8; with cheek raise (`…squint_outer_lower`) 1; the cheek-range stack (cheek raise, corners up, nasolabial deepener and sneer all at 1, which fires `lips_l_corner_up__lips_r_corner_up__Corr` and the upper-raise correctives and is where the preview's exaggerated cheek shows); the stack with jaw open 0.5; the warm smile sample from `data/expression-samples/`; `facial_happy` and `facial_charming` | 8 |
| L. Vanilla expressions | The 15 female photo-mode expressions, decoded as [facial expressions §3](../../knowledge/facial-expressions.md#what-a-vanilla-expression-is) describes (`research/animation/probes/decode_face_pose_vectors.py`) | 15 |
| M. Random | Seeded: 1,000 sparse vectors (3 to 12 controls, uniform 0–1); 200 dense vectors (all 141 main controls); 100 with random globals (envelopes 0–1.2, JALI 0–2.2, muzzles 0–1, lipsync envelope 0–1, overrides 0–1, lipsync pose outputs 0–0.5) | 1,300 |
| N. Robustness | Values −1 and 2 on every main track; 10⁶ on one; the implementation (not the oracle) refuses NaN and wrong-length vectors | 6 |
| O. Second setup | The male player setup `h0_001_ma_c__player_rigsetup.facialsetup` on the same rig: neutral, every main control at 1.0, the blink steps, every tenth idle frame | ≈ 229 |

**Total: about 2,600 constructed vectors plus about 840 clip frames, about 3,440 solves.** The whole batch takes seconds in the oracle.

### 9.3 Generating the named inputs

- Control names come from the rig's `trackNames`; corrective drivers from `GlobalCorrectiveEntries` / `InbetweenCorrectiveEntries` (group H is generated from the setup, not hand-listed).
- Clip frames (groups I and J) come from the same local intakes the blink and idle bakes use (`research/consumers/game-blink`, `research/consumers/cc-idle`); sample them with the Studio's TypeScript clip reader (§3.3), then send those absolute frames to the oracle, so both sides solve identical inputs.
- Group L's vectors come from the decoded photo-mode clips; group K's warm smile from its committed preset.

### 9.4 Tolerances and reporting

Per joint and frame: rotation difference 2 · acos(|q_ours · q_oracle|) ≤ **10⁻⁵ rad**; translation difference ≤ **10⁻⁶ m**; processed tracks and wrinkles ≤ **10⁻⁶** absolute (tongue tracks exempt after the tongue pass if overrides are applied per part, §4.7). These are the editor design's gates. Report the worst joint, frame and case per group, and the stage where a trace first diverges from the oracle's processed tracks. The in-app solver may replace the external one, and then the blink and idle bakes, only when every group passes.

## 10. Implementation notes

XF Studio's solver (`projects/xf-studio/authoring/src/engines/facial-rig/solver.ts`, MIT) was written from §1–§8 and the game's files only; the IO Suite was never read, and its solver was used as a black box through the wrapper (§9.1). This section records what the specification left open and how it was settled, and the result.

### 10.1 Decisions

1. **ε_w is compared as float32.** A control of exactly 0.001 is zeroed by the envelope stage (w ≤ ε) in the oracle, while the float32 input 0.001 (0.00100000005) exceeds the double 0.001. Every comparison with ε_w therefore uses `Math.fround(0.001)`; 0.0009 and 0.0011 behave as §5.6 says either way. Found by groups A and C (13 cases failed with the double threshold, none with the float32 one).
2. **Lipsync overrides run over all overrides in every part's pass** (§4.7's IO Suite order, not the per-part shortcut), so the processed tracks match the oracle's everywhere and no tongue exemption is needed in §9.4.
3. **The working buffer O is a `Float32Array`**, rewritten at every stage; weights, products and quaternion arithmetic are doubles; joint accumulators are doubles written to float32 at the end. The worst differences against the oracle stay three orders below the gates (below).
4. **Corrective-entry bits.** The native reader shows that a corrective entry's second u16 holds the driver in bits 4–15 and `Unknown` in bits 0–3 ([archive formats §13](../../knowledge/archive-format.md#13-facial-setups-facialsetup)); the solver reads `Unknown` as the number WolvenKit's JSON shows.
5. **Unknown upper/lower parts** (a `Part` above 2, none in the vanilla setups) scale by 1, with a compile warning.
6. **The §7 alternatives** are compile options (`FacialCompileOptions.compat`) with these meanings where §8.2 named only the switch: `faceEnvelope: "gate"` multiplies every mapped control by clamp01(`faceEnvelope`) at the envelope stage; `lipsMuzzle: "envelope"` also mutes envelope type 1 by 1 − `muzzleLips` (the limits are unchanged); `influencePasses: "second-only-if-lipsync"` runs §4.9 only when a lipsync pose adds a non-zero value to a control of that part; `firstInbetweenSegment: "threshold"` uses w / τ₀; `correctiveFlag: "ignore"` never zeroes a corrective for its flag; `scalePoses: "apply"` returns per-joint scales 1 + Σ w · value per axis (a hypothesis, S1) and `composeLocalPose` multiplies them into the rest scale.
7. **T1** is a compile warning (`warnings`) when a posed joint has a turned or scaled rest; the composition follows §4.15 either way.

### 10.2 Parity (28 September 2026)

`bun tools/facial-solver-oracle.ts --generate` built the §9.2 cases from the rig, the setup and the game's clips (read with XF Studio's own reader; the clip groups sampled as §3.3 says), asked the oracle in batches of 256 frames with `"outputs": true`, and replayed every input through `solveFace` compiled from XF Studio's own reading of the same files. Every case passes all three gates:

| Group | Cases (frames) | Worst rotation | Worst translation | Worst track |
|---|---:|---:|---:|---:|
| A baseline | 6 | 9.6 × 10⁻¹¹ rad | 0 | 2.5 × 10⁻⁸ |
| B each pose | 282 | 6.0 × 10⁻⁸ | 2.3 × 10⁻¹⁰ m | 0 |
| C in-betweens | 132 | 8.9 × 10⁻⁸ | 4.7 × 10⁻¹⁰ | 2.5 × 10⁻⁸ |
| D influences | 54 | 1.6 × 10⁻⁷ | 1.9 × 10⁻⁹ | 3.0 × 10⁻⁸ |
| E face scaling | 11 | 2.1 × 10⁻⁷ | 2.1 × 10⁻⁹ | 0 |
| F muzzles | 8 | 1.5 × 10⁻⁷ | 2.3 × 10⁻¹⁰ | 0 |
| G lip sync | 20 | 2.7 × 10⁻⁷ | 2.1 × 10⁻⁹ | 6.0 × 10⁻⁸ |
| H correctives | 527 | 7.0 × 10⁻⁷ | 4.0 × 10⁻⁹ | 0 |
| I blink | 36 (86) | 2.3 × 10⁻⁷ | 9.4 × 10⁻¹⁰ | 7.5 × 10⁻⁸ |
| J creator idle | 2 (784) | 3.0 × 10⁻⁷ | 1.3 × 10⁻⁹ | 8.9 × 10⁻⁸ |
| K smile and cheek | 8 | 2.2 × 10⁻⁷ | 2.3 × 10⁻⁹ | 7.5 × 10⁻⁸ |
| L vanilla expressions | 13 | 5.1 × 10⁻⁷ | 3.9 × 10⁻⁹ | 8.9 × 10⁻⁸ |
| M random | 1,300 | 1.6 × 10⁻⁶ | 1.6 × 10⁻⁸ | 1.6 × 10⁻⁷ |
| N robustness | 6 | 7.7 × 10⁻⁷ | 6.7 × 10⁻⁹ | 0 |
| O male setup | 153 (219) | 1.1 × 10⁻⁷ | 7.0 × 10⁻¹⁰ | 8.5 × 10⁻⁸ |

2,558 cases, 3,456 frames. Group D adds, beyond the named cases, every influenced control at 1 with each influencer at 0.4 and, where it has two, with two influencers summing past 1; group H covers all 259 correctives at 1.0 and 0.6; K and L together hold the 15 vanilla expressions. The fixture is game-derived and stays local (`data/facial-oracle/`); `tests/facial-solver-oracle.test.ts` replays it where it exists and is skipped in CI.

### 10.3 Performance (the maintainer's machine, Bun 1.4.2)

`bun tools/facial-solver-bench.ts`: compile 2.6 ms median (the female setup, from documents already read); native reading of the rig and setup 64 ms. `solveFace`, 5,000 runs after warm-up: neutral 0.003 ms median (p99 0.010), a blink 0.008 (0.011), a sparse expression 0.008 (0.015), dense random 0.091 (0.140), every control at 1 0.032 (0.051). The idle's 663 frames solve in 9 ms. The budget (0.5 ms median, 1.5 ms p99, compile ≤ 50 ms, idle ≤ 0.5 s) is met with a wide margin, so no native module was built.

