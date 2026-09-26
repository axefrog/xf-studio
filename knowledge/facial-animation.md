# Facial animation and the blink

**Maturity: Draft.** Consolidated from the installed 2.31 facial rig, facial setups, morph targets and face animation sets, read offline with WolvenKit and the Cyberpunk Blender Add-on's facial solver on 23 to 26 September 2026. Nothing here has runtime evidence of its own. Evidence grades follow the [knowledge rules](README.md): **[source]** engine, framework or tool source, **[resource]** extracted game or mod resources, **[wiki]** Modding Docs, **[runtime]** running game, **[hypothesis]** not yet established. Measurements, hashes and commands are in [the game's blink](../research/animation/game-blink.md) and [character-creator idle](../research/animation/cc-idle.md).

This page answers how V's face is animated, and in particular how a blink closes the eyes, and what the Studio reproduces.

## 1. From control values to moving bones

**Clip** (float tracks over time) → added to the rig's `referenceTracks` → **414 control values** → **`.facialsetup`** (envelopes, limits, influences, inbetweens, main poses, correctives) → **solver** → local rotation and translation per joint → **`.rig`** (344 joints) → skinning of the head, eye, brows, lashes and face decals.

- A face clip animates **controls**, not bones: float tracks such as `eye_l_blink` (track 21), `eye_r_blink` (22), `eye_l_dir_dn` (114) or `jaw_mid_open`. The female head rig has 414 tracks and 344 joints [resource].
- Face clips are mostly `AdditiveFromRefPose`: their values add to the rig's `referenceTracks`, which switch the envelopes on (`faceEnvelope`, `upperFace`, `lowerFace` = 1) [resource]. Playing such a clip as bone animation gives a static face [resource].
- The `.facialsetup` turns controls into joint motion in stages: envelopes (with muzzles), global limits, influences between poses, upper/lower-face scaling, lipsync overrides, inbetween poses, correctives that fire on combinations of poses, then wrinkle outputs. Poses are local rotation/translation deltas applied after each joint's rest; the face part has no scale poses [resource, source: the IO Suite solver].
- The Studio runs the add-on's pinned, unmodified solver offline as an external tool and plays the result; its code is never copied into the app (it is GPL-3.0) [source].

## 2. How a blink closes the eye

| Fact | Detail | Grade |
|---|---|---|
| Controls | `eye_l_blink` / `eye_r_blink`, one per eye; 0 open, 1 closed | [resource] |
| Main poses | Face part poses 8 and 9, a single inbetween at 1.0 (the weight is the control value), envelope `muzzleEyes` (LOD 1), no limit, not scaled by upper/lower face; each suppresses its side's `eye_*_widen` | [resource] |
| What moves | 30 joints per side: the upper and lower lid roots, upper rows A–D, lower rows A–B, the inner corner, three `eye_nose_rowA`, the eye's wetness root, three nasolabial joints. The lid roots sit exactly on the eye joint, so the lids **turn about the eye centre**: about 37° at the upper root, up to 58° at an upper row | [resource] |
| Lashes | The `eye_lid_lashes_*` joints hang under the lid rows and have no pose of their own: they follow the lid through the hierarchy | [resource] |
| Correctives | 38 face correctives name a blink. `eye_[lr]_blink__Corr` fires with every blink but carries no transforms in the female setup; the rest combine the blink with gaze, squints or brows and act only when those move too | [resource] |
| Timing, gameplay | `generic_facial_additives.anims` holds `additive__blink_fast/half/normal/slow/tiny__01` (0.33 to 0.57 s) and eyes-closed clips. The normal blink reaches 1.0 at 0.10 s and is open again by about 0.33 s, adding a little outer squint, brow lower, widen, gaze down and pupil dilation | [resource] |
| When they play | The creator and photo-mode face graphs have no periodic blink; the additive blink clips play when the gaze moves ([facial expressions §2](facial-expressions.md#2-which-graph-drives-vs-face-where)) | [resource] |
| Creator idle | The close-up idle's face clip has nine blinks of its own (peaks 0.51 to 0.97, about 0.4 s each, both eyes identical), on average 2.45 s apart | [resource] |

## 3. Which facial setup V uses

The female face-rig entity names the **male** player setup (`h0_001_ma_c__player_rigsetup.facialsetup`), while a female setup (`h0_000_pwa_c__basehead_rigsetup.facialsetup`) sits beside the female skeleton [resource]. Both have the same structure (121 face main poses, 255 correctives) but different pose data: the male blink turns the upper lid less (upper root 33.6° against 37.0°) [resource]. Solved on the female head offline, the female setup closes the neutral eye completely and the male one leaves 2 to 6 % of it in view [resource, measured offline]. Which setup the engine solves V's face with is **untested** [hypothesis either way]. The Studio uses the female head's own setup.

## 4. Eye shapes move the joints too

- Each morph target carries **its own joint binds** (`boneRigMatrices`) beside its vertex offsets. They belong to a preset head: the five region targets of one number (`h091_eyes`, `h092_nose`, …) share them [resource].
- The facial setup's `JointRegions` assigns every joint a region: 0 eyes (132 joints: lids, brows, eye joints), 1 nose, 2 mouth, 3 jaw, 4 ear, 255 none [resource].
- The 21 eye shapes translate the eye region's skinned joints without turning them; the eye joint moves 0.9 to 3.9 mm [resource]. The unskinned lid roots, which carry the blink's big turn, are listed by no target [resource].
- A community fix, the Facial Customisation Rig Fix, renames six ear joints in every morph target to stop eye clipping, which only makes sense if the engine uses these binds at runtime [resource; runtime effect a hypothesis].
- **Reading adopted by the Studio** [hypothesis]: an eye shape re-seats the eye-region joints on its binds, the facial poses act about the moved pivots, and the unskinned lid roots follow the eye joint. Nothing in the game files or at runtime confirms it; it was chosen because it closes the four measured shapes best on the whole, not on every shape. Measured offline at full closure (share of the open eye in view from the front, left / right, [the game's blink](../research/animation/game-blink.md#eye-shapes-morph-specific-joint-binds)) [measured offline]:
  - the base shape closes completely either way;
  - `h211` closes completely, where turning about the base centre leaves 16 / 18 %;
  - `h091` keeps a slit about 1 mm high (7.5 / 4.8 %), where turning about the base centre leaves 22 / 17 %;
  - **`h011` gets worse**: 10.2 / 5.5 % re-seated against 3.6 / 0 % about the base centre.

  `h111` was not measured offline; the slit on it was seen only in the browser [observed in the browser]. How the engine blends five region targets' binds, what it does with joints no target lists, and whether the game's own blink closes these shapes fully are open.

## 5. The Studio's blink

- **Source.** An offline bake (`tools/bake_game_blink.py`) solves the game's `additive__blink_normal__01` clip with the female head's setup, the same way the idle is baked. The **Closure** slider scrubs that clip's closing half (0 to 0.10 s, 21 solved steps); **Play blink** plays the whole clip at its own speed, repeating every 2.45 s (the idle's average spacing, a Studio choice). Closure 0 is the exact editing pose; the clip's first frame looks about 1° down. The asset is made locally from the player's game files and never shipped; it records the rig and facial setup it was solved with, and the Studio refuses it, in plain words, when it is missing, damaged, or made for a head whose joints sit more than 0.1 mm from the preview head's [source].
- **Eye shapes.** The blink re-seats its rig on the shown eye shape's joint binds, the hypothesis in §4, with its `h011` regression. The idle still turns the lids about the base centres. A modded eye shape the bake has no binds for keeps the base seat [source].
- **Everything follows the lids.** The solved rig drives every bone of the same name: the core head, the eye plate and each resolved detail's own skeleton copy (brows, lashes of any mod, the eye). Offline on the real head at full closure, the upper-lash roots stay within about 0.6 mm (median) of the lid skin, where the retired synthetic study left them about 6 mm behind; the plate stays exactly on the skin [source, measured offline].
- **No push-through.** The retired study drove the upper lid 3.4 mm through the lower one; the solved lids meet with about half a millimetre of overlap [measured offline].
- **The idle.** The idle blinks by itself and the facial solve is not additive, so the blink controls are off while the idle plays; turning the idle on returns the blink to the editing pose [source].
- **Makeup coverage on closed lids.** On save B's eye shape (`h111`) a strip of the upper lid that hides under the crease while the eye is open comes into view when it closes and shows bare skin inside the drawn makeup: it appears to lie outside the eye plate's footprint [observed in the browser; cause a hypothesis]. If the game deforms the lid the same way, exported makeup has the same gap on closed eyes.

## Open questions

1. Which facial setup does the engine solve V's face with: the female head's own or the male player setup the face-rig entity names? A probe is prepared (the bridge's `face.rig.read`, check R1 on the [test card](../research/runtime/runtime-bridge-test-card.md#expression-checks-r1-and-r2); a CET fallback in [experiment 022](../experiments/022-session-3/README.md#part-d-expression-console-checks-optional)).
2. How does the engine combine the joint binds of V's five region targets, and what happens to joints no target lists (the lid roots)?
3. Does the game's blink close every eye shape completely, or does it leave the slit the preview shows on `h091` and `h011` (measured offline) and `h111` (seen in the browser)? Does `h011` close fully in game, as it does about the base centre?
4. What counts as a gaze change for the look-at controller's blinks, and what drives blinks in gameplay outside the creator and photo-mode graphs? (Those graphs play the additive blink clips on gaze changes, with minimum intervals, and have no periodic blink: [facial expressions §2](facial-expressions.md#2-which-graph-drives-vs-face-where).)
5. Does the closed lid on deep-set shapes uncover skin outside the eye plate in game?

## In-game test asks

Batch into one prepared session; record the game version and the face-rig and morph mods installed.

1. **Blink closure on four eye shapes.** In the creator (or photo mode with eyes closed), capture frontal close-ups of a fully closed blink for eye shapes 01 (base), 10 (`h091`), 12 (`h111`) and the shape whose morph is `h011`: is any eye visible between the lids? Compare with the Studio at Closure 100 %. `h011` decides between the per-shape seat and the base centre.
2. **Lashes on closed lids.** Same captures: do the upper lashes lie along the closed lid line as in the Studio?
3. **Makeup on closed lids.** With an XF Eye Artistry look covering the upper lid, close the eyes on eye shape 12: does bare skin show between the crease and the lashes?

## Related pages

[Facial expressions and idles](facial-expressions.md) · [Character-creator idle](../research/animation/cc-idle.md) · [The game's blink](../research/animation/game-blink.md) · [Brow idle gap](../research/animation/brow-idle-gap.md) · [CC file chain](cc-file-chain.md) · [Eye rendering](eye-rendering.md) · [Brows](brows.md) · [Tooling](tooling.md)
