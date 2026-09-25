# The game's blink in the preview

26 September 2026. Replaces the preview's synthetic "eyelid study" (hand-picked translations of the lid bones) with the game's own blink, solved from V's facial rig offline. The consolidated answer is on the knowledge page [facial animation](../../knowledge/facial-animation.md); this page keeps the evidence, the measurements and the choices made. No game launch was used.

## Why the old study was wrong

The report: the slider did not close the way V's eyes close, did not carry the lashes, and cut through the face around the lids. Offline, on the real derived head (neutral shape, [check](../../projects/xf-studio/authoring/evidence/game-blink-offline-check.json)):

- **Shape.** It slid the `eye_lid_(lashes_)?(up|dn)_row*` bones straight down by fixed distances. The game turns the lid rows about the eye centre (the lid root joints sit exactly on the eye joint) and moves 30 joints per side, including the inner corner, the nose side and the eye's wetness root.
- **Intersections.** At 100 % the old upper-lid margin ended 3.35 to 3.59 mm *below* the lower-lid margin (it pushed through it) on every eye shape measured.
- **Lashes.** The study moved only the bones present when the scene was built, the core head's. Every resolved lash and brow mesh has its own skeleton copy (`character-detail-loader.ts`), which it never touched: the upper-lash roots were left about 6 mm behind the closed lid.

## Sources and intake (local, ignored)

| Resource | SHA-256 | Role |
|---|---|---|
| `base\animations\facial\generic\interactive_scene\generic_facial_additives.anims` | `89e7c37b…` | 25 additive clips, 5 of them blinks; authored on the male player rig |
| `base\characters\head\player_base_heads\player_female_average\h0_000_pwa_c__basehead\h0_000_pwa_c__basehead_rigsetup.facialsetup` (serialized) | JSON `aae907a8…` | The female head's facial setup, solved with (as the idle bake) |
| `base\characters\head\pma\h0_001_ma_c__player\h0_001_ma_c__player_rigsetup.facialsetup` | `96819998…` | The setup the female face-rig entity names; solved only for comparison |
| `…\player_female_average\h0_000_pwa__morphs.morphtarget` / `he_000_pwa__morphs.morphtarget` | `3e10c3f7…` / `42a19b6a…` | Head and eye morph targets, for the per-shape joint binds (same hashes as the preview core's sources) |
| `base\animations\ui\female\ui_female_face.anims` | `9fe289d1…` | The character-creator idle's face clip (blink timing inside it) |

WolvenKit CLI 9.0.1 unbundled them from the installed 2.31 `archive/pc/content` into `research/consumers/game-blink/extracted/` and serialized them to `json/` (regexes with `.` for the path separators; backslashes in a `-r` pattern are mangled by the shell). The existing `anim-export` adapter exported `additive__blink_{fast,slow,normal,tiny,half}__01` and `additive__eyes_closed__01` with the **female** head rig to `raw/*.glb`. That is valid because the male player rig and the female head rig have identical bone lists (344) and track lists (414); only their reference track values differ, and the clips are `AdditiveFromRefPose`, so they add to the female rig's references.

The five blink clips' blink tracks (both eyes; values are the decoded keys):

| Clip | Length | Peak `eye_l_blink` | Peak time | Other controls it moves |
|---|---:|---:|---:|---|
| `additive__blink_fast__01` | 0.33 s | 0.956 | 0.133 s | brows lower/lateral, outer squints, gaze down, pupil wide |
| `additive__blink_half__01` | 0.53 s | 0.642 | 0.133 s | as fast |
| `additive__blink_normal__01` | 0.50 s | **1.000** | **0.100 s** | brows lower 0.049, widen 0.065, outer squint lower 0.076 / upper 0.061, gaze down 0.018 → 0.081, pupil wide 0.161 |
| `additive__blink_slow__01` | 0.57 s | 1.000 | 0.133 s | as normal |
| `additive__blink_tiny__01` | 0.37 s | 0.249 | 0.100 s | brows lower, outer squints, gaze down |
| `additive__eyes_closed__01` | 0.97 s | 1 (constant) | — | gaze down 0.312 (constant) |

The creator idle's own face clip carries nine blinks with identical left/right curves: onsets 0.73, 3.87, 5.53, 7.63, 8.37, 9.83, 11.93, 14.97 and 20.30 s, peaks 0.51 to 0.97, each about 0.4 s long (fast close in about 0.1 s, slower open). Their mean spacing, (20.30 − 0.73) / 8 ≈ 2.45 s, is the Studio's Play blink repeat. A parallel study of the creator and photo-mode face graphs found no periodic blink node in either and blink clips from these additives playing when the gaze moves (`research/animation/expressions-evidence.md` on the `claude/rnd-expressions` branch, not yet merged when this was written).

## The bake

[`tools/bake_game_blink.py`](../../projects/xf-studio/authoring/tools/bake_game_blink.py) runs the same pinned, unmodified IO Suite solver modules as the idle bake (commit `7a4ee793…`, imported from its checkout, never copied), with the rig's reference tracks plus the clip's keys, at LOD 0, and packs local rotation/translation after the rest pose into glTF axes exactly as `bake_idle_face.py` does. It writes one local GLB (`public/assets/game-blink.glb`, about 0.7 MB, never tracked or shipped) and the asset-free [bake report](../../projects/xf-studio/authoring/evidence/game-blink-bake.json):

- `additive__blink_normal__01` solved at 60 Hz (31 frames), for Play blink;
- `eye_blink_closure`: the same clip's closing half, 0 to 0.1 s, solved at 21 evenly spaced instants, time axis 0 to 1, for the slider (the coordinator's steer: scrub the game's own blink rather than one control). Its first frame is about 1° from the rest pose (the clip starts with the gaze 1.8 % down), so the Studio shows the exact editing pose at closure 0;
- per eye shape, the moved eye-region joints' binds (`asset.extras.shapes`, below).

Run from the repository root after the intake above:

```powershell
python projects/xf-studio/authoring/tools/bake_game_blink.py --addon D:/Dev/Cyberpunk-Blender-add-on --idle-intake <cc-idle intake>
cd projects/xf-studio/authoring; bun tools/verify_blink.ts
```

`--setup`, `--output` and `--evidence` bake a comparison (the male setup below) without touching the Studio's asset.

## What the setup says about a blink

From the serialized female setup ([bake report](../../projects/xf-studio/authoring/evidence/game-blink-bake.json) `poses`, `blinkCorrectives`) [resource]:

- `eye_l_blink` / `eye_r_blink` are tracks 21/22, face-part main poses 8/9, one inbetween at threshold 1.0 (the pose weight is the control value), envelope type 2 (`muzzleEyes`, LOD 1), no global limit, upper/lower-face part 0 (not scaled by either), and each influences its side's `eye_*_widen` (a blink suppresses widening).
- Each pose moves 30 joints: both lid roots, upper rows A–D, lower rows A–B, the inner corner, three `eye_nose_rowA`, the wetness root, and three nose/jaw nasolabial joints. The largest local turns at full closure are about 37° at `l_J_eye_lid_up_root_1_JNT` and 58° at `l_J_eye_lid_up_rowA_0_JNT`.
- 38 face correctives name a blink. `eye_[lr]_blink__Corr` fires linearly with the blink but has **zero** transforms in this setup; the others combine the blink with gaze (27–29 transforms), squints (18–41) or brows (24–40), so they act only when those controls move too. The normal clip fires 16 of them at weights up to 0.08.
- The solver has no scale: the face part has no scale poses (the eyes part's four scales are pupils).

## Which facial setup

The female face-rig entity (`h0_000_pwa__basehead_face_rig.ent`) names the **male** player setup, `h0_001_ma_c__player_rigsetup.facialsetup` ([experiment 015 trace](../../experiments/015-native-eye-assembly/source-graph-trace.md)), while a female setup sits beside the female skeleton. Same pose counts (121 face main poses, 255 correctives), different data: at full blink the male setup turns the upper lid root 33.6° against 37.0° and the upper rows B 17–21° against 28–33°. Solved on the female head, offline, the male setup leaves 2.4 % / 5.6 % of the neutral eye in view where the female one closes it completely, and 21 % / 20 % on `h091`. The Studio solves with the female head's own setup. Which one the engine uses for V is a runtime question.

## Eye shapes: morph-specific joint binds

Every morph target carries its own `boneRigMatrices`. They are per *preset head*: the five region targets of one number (`h011_eyes`, `h012_nose`, … `h015_ear`) have identical matrices, and an eyes target moves jaw joints too [resource]. The facial setup's `JointRegions` assigns each joint a region: 0 eyes (132 joints, lids, brows, eye joints), 1 nose (15), 2 mouth (60), 3 jaw (67), 4 ear (6), 255 none (64) [resource]. Converted with the same basis change as the rig (checked on the `Head` joint to 4 × 10⁻⁷), the 21 eye targets translate 116 eye-region joints (no rotation), the eye joint by 0.89 to 3.94 mm. The lid and wetness root joints are unskinned, listed by no target, and sit exactly on the eye joint.

The preview had ignored these binds, so the lids turned about the base eye centre while the eye shape had moved the eye. Reading adopted, as a hypothesis: an eye shape re-seats the eye-region joints on its binds (the idle and blink local poses then act about the moved pivots), and the unskinned roots follow the eye joint. [`game-blink.ts`](../../projects/xf-studio/authoring/src/game-blink.ts) `setShape` does this for the blink only. Measured exposed eyeball at full closure, left / right, share of the open eye seen from the front:

| Eye shape | Rig on the base eye centre | Roots stay | Roots follow their lid rows | **Roots follow the eye joint (used)** |
|---|---:|---:|---:|---:|
| neutral | 0 / 0 | 0 / 0 | 0 / 0 | **0 / 0** |
| `h011` | 3.6 % / 0 | 3.2 % / 0 | 10.8 % / 6.5 % | **10.2 % / 5.5 %** |
| `h091` | 22.0 % / 16.8 % | 14.5 % / 12.0 % | 6.7 % / 5.0 % | **7.5 % / 4.8 %** |
| `h211` | 16.3 % / 18.1 % | 10.3 % / 12.3 % | 0 / 0 | **0 / 0** |

(The "stays" and "rows" columns are from the pure blink pose before the slider switched to the normal clip; the clip changes these figures by under a percentage point.) The adopted rule is best on the sum but not everywhere; the remaining exposure on `h011`/`h091` is a slit about 1 mm high along the lid line (7 to 16 mm²), the same "narrow lower strip" experiment 015 found in the idle. Nothing here establishes the engine's rule: how it blends the binds of five active region targets, what it does with unlisted joints, and whether the game's own blink closes these shapes completely are the next in-game comparison.

## Offline check

[`tools/verify_blink.ts`](../../projects/xf-studio/authoring/tools/verify_blink.ts) (report: [game-blink-offline-check.json](../../projects/xf-studio/authoring/evidence/game-blink-offline-check.json)) builds the real derived head, plate and eye, the vanilla lashes (`MorphTargetSkinnedMesh3637`), a resolved lash mod (`icxrus_softnaturaleyelashes`) and the vanilla brows, binds them to the blink by name, and for the neutral shape and `h011`/`h091`/`h211` measures: eyeball visible along the front view (0.25 mm ray grid), the upper-to-lower lid-margin distance and any crossing, how far the upper-lash roots, brows and plate drift from the head skin they sit on, and finite vertices; plus 2.5 s of Play blink and an exact restore. Neutral shape, full closure:

| | Retired study | Solved game blink |
|---|---:|---:|
| Eyeball left in view (L / R) | 0 / 0 | 0 / 0 |
| Upper margin past the lower margin (L / R) | 3.35 / 3.44 mm | 0.52 / 0.41 mm |
| Median lid-margin gap (L / R) | 1.81 / 1.85 mm | 0.84 / 0.86 mm |
| Upper-lash root drift, median (vanilla / mod) | 6.17 / 6.69 mm | 0.55 / 0.66 mm |
| Brow drift, max | 2.83 mm | 0.03 mm |
| Plate (makeup) drift | 0 | 0 |

The retired study also hid the eye, but only by driving the upper lid 3.4 mm through the lower one, with the lashes left in the air. A half-millimetre overlap of the two soft margins at full closure is expected from the rig itself. Zero non-finite samples and an exact restore on all shapes. A cut-down version runs in `bun test` when the local assets exist (`tests/game-blink-assets.test.ts`).

## Browser check

[`tools/blink-look.ts`](../../projects/xf-studio/authoring/tools/blink-look.ts) drives an isolated `?verify=1` workspace (throwaway Chrome profile, disposable data) through the default V, the reference save and save B at 0/50/100 %, a Play blink frame and the idle toggle, and records surface picks over the lids with the blink held. Captures stay in the ignored `authoring/evidence/screenshots/game-blink/`. Results are summarised in the knowledge page's Studio section and in the branch report.

## Limits

- Offline geometry and a browser renderer; nothing here is runtime evidence.
- The blink and the idle are not blended: the idle already blinks (its own tracks), and solving both together would need the solver at runtime (the correctives are not additive). The blink controls are off while the idle plays, as before.
- The per-shape joint binds are applied to the blink only; the idle still turns the lids about the base centres.
- Modded eye shapes without binds in the bake use the base seat.

Community learning and tools: [Cyberpunk Blender Add-on / IO Suite](../../docs/community-credits.md#cyberpunk-blender-add-on-io-suite) (solver, run unmodified as an external tool), [WolvenKit](../../docs/community-credits.md#wolvenkit) (extraction, serialization, animation export).
