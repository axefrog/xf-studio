# 031: the photo-mode facial setup against the female head's own (design D1)

**Status:** offline comparison and Studio render comparison run on 29 September 2026; the preview now solves with the setup V's face rig names (design D1). Evidence grades follow the [knowledge rules](../../knowledge/README.md).

**Question.** Session 4's R1 found the live photo-mode face solving with the male player setup `base\characters\head\pma\h0_001_ma_c__player\h0_001_ma_c__player_rigsetup.facialsetup`, on the female skeleton, for a feminine V [runtime] ([experiment 029 §3.5](../029-session-4/README.md#35-n7-photo-mode-expressions-parity-eye-and-skin-light)). The Studio solved with the female head's own `h0_000_pwa_c__basehead_rigsetup.facialsetup`. Do the two differ, and does it show on the face?

**Method.** [`compare_setups.ts`](compare_setups.ts) reads both setups, the female skeleton, the photo-mode face rig `.app` and the vanilla female photo-mode clips straight from the 2.31 base archives with XF Studio's own readers (native archive reader, resource reader, anim-set reader), compares the setups table by table and pose by pose, and solves the same control vectors with each setup on the female skeleton with XF Studio's own solver (the one the preview runs). Joint measures are over the skinned `_JNT` joints, in millimetres; "fold gap" is the distance between `r_J_jaw_nosabial_rowA_1` and `rowB_1` (8.04 mm at rest), whose closing is the smile's bunching beside the nose ([facial correctives tuning](../../research/animation/facial-correctives-tuning.md)); "malar" is `r_J_eye_check_rowD_0`, the cheek under the eye. The numbers are game-derived and stay local (`--json` writes them).

```
cd projects/xf-studio/authoring
python ../../../tools/memory_guard.py --limit 2 -- bun ../../../experiments/031-photo-mode-facial-setup/compare_setups.ts
```

Sources (base game, `archive\pc\content\`): the female setup and the male setup in `basegame_4_appearance.archive` (SHA-256 `ed5670ee…352c` and `96819998…fac1`), the skeleton in `basegame_4_animation.archive` (`61a72dc0…7777`), the photo-mode face rig `h0_000__basehead_face_rig_photomode.app` (`d1acf06d…0283`).

## Results

**Which setup the face rig names** [resource, read with XF Studio's reader]. The photo-mode face rig's two `face_rig` components both name the male player setup (hash `7508524370571000797`, the `6833a322173f7bdd` session 4 read live), one with the female skeleton and one with another rig. So the resource agrees with what the game did.

**Structure: identical except the correctives' order** [resource].

| Part of the setup | Female against male |
|---|---|
| Track mapping (13 envelopes, 141 main poses, 86 overrides, 33 wrinkles), part info, lipsync override map, joint regions | Identical |
| Envelopes, limits, influences, upper/lower-face scaling, lipsync sides, main poses and their in-betweens and scope multipliers, wrinkle sources (face, eyes and tongue parts) | Identical |
| Correctives (255 face) | 254 have the same name and the same driving controls and in-betweens in both; they are stored in a different order (215 at the same index), which is why the entry tables differ row by row. One pair differs: the female setup has `lips_r_purse1__lips_r_funnel1__Corr`, the male `lips_l_purse0__lips_l_funnel0__Corr` |
| Tongue and eye correctives | Identical tables |
| `useFemaleAnimSet` | 1 in the female setup, 0 in the male |

**Pose data: different** [resource]. The main face poses' 133 in-between poses: 77 move a different joint list, 8 are identical, and among those with the same joints the largest difference is 18.8° and 7.4 mm (male translation magnitude 0.91–1.15 times the female's, 10th to 90th percentile). Face correctives: 238 of 255 move a different joint list; largest difference 17.7° and 4.5 mm. Eye poses differ by at most 0.03°; tongue poses by up to 4.3° and 2.9 mm.

**Solved on the female skeleton** [offline, XF Studio's solver]:

| Controls | Largest joint difference (mm) | Mean (mm) | Fold-gap closure, female / male | Malar lift, female / male (mm) |
|---|---:|---:|---|---|
| Smile (`lips_[lr]_corner_up`) 0.5 | 2.6 | 0.21 | 47 % / 38 % | 0.66 / 0.84 |
| Smile 0.7 | 3.6 | 0.30 | 56 % / 46 % | 0.92 / 1.18 |
| Smile 1 | 5.0 | 0.43 | 46 % / 44 % | 1.32 / 1.69 |
| Smile 0.7 with cheek raise 0.5 | 3.6 | 0.32 | 54 % / 44 % | 1.59 / 1.86 |
| Cheek raise (`eye_[lr]_oculi_squint_outer_lower`) 1 | 1.0 | 0.09 | — | 1.91 / 2.33 |
| Blink 1 | 4.3 | 0.16 | — | — |
| Jaw open 0.5 | 2.0 | 0.20 | — | — |
| `facial_happy` | 2.7 | 0.32 | 41 % / 36 % | 1.76 / 2.22 |
| `facial_charming` | 2.2 | 0.24 | 44 % / 37 % | 1.21 / 1.54 |

Over the 15 vanilla female photo-mode expressions with a pose (`photomode_female_facial.anims`), the largest joint difference is 1.6–5.8 mm (median 2.8 mm; `facial_whistling` the most, 5.8 mm) and the mean 0.2–0.9 mm; the male setup's largest movement is 0.75–1.31 times the female's (median 0.99).

**Reading.**
- **It is visible.** Differences of 2–6 mm at the lips, lids and cheeks are a clearly different expression at face framing, so the preview showed a face the game doesn't make.
- **The smile bunches less and lifts the cheek more** with the setup the game uses: at the weights smiles use most (0.5–0.7) the fold beside the nose closes about 9 points less, and the malar cheek rises about 25–30 % more. The lump is still there (38–46 % closure): it is a trait of the game's rig, as the maintainer's photo-mode experience says ([session 4 N13](../029-session-4/README.md#34-n13-cheek-check)), but the preview had it stronger than the game.
- The earlier note that "the male setup moves 5–15 % less" came from a different measure (cheek range through the IO Suite) and doesn't hold for every joint: the male setup moves the malar cheek more and the fold less.

## What changed

- The facial host solves with the setup V's photo-mode face rig names for the female skeleton (`readFaceRigSetup`, `facial-host.ts` `faceSetup`), read from the winning `.app` and its ArchiveXL patches, so a mod that re-points the face rig is followed without any mod-specific code. The blink, the held expressions and the idle all share that compiled face, and every solved pose records the setup's file name. `XFS_FACIAL_SETUP=female-head` (localhost only) solves with the female head's own setup for comparisons; it is also the fallback when the rig names no setup the game has.
- The expression export is unaffected: it writes control vectors, and the one setup input it reads (the track mapping) is identical in both setups.

## In the Studio: render comparison

[`render_compare.ts`](render_compare.ts) starts two isolated, disposable-data Studio servers from this checkout (the default, and one with `XFS_FACIAL_SETUP=female-head`), renders the same vectors on the reference V in a headless Chrome with [experiment 026's `expression-look.ts`](../026-natural-expressions/expression-look.ts) (hair off, idle off, fixed cameras, front and three-quarter), and [`render_sheet.py`](render_sheet.py) compares the frames. Each server reported the setup it solved with (`h0_001_ma_c__player_rigsetup.facialsetup` and `h0_000_pwa_c__basehead_rigsetup.facialsetup`). The renders are private (the player's own game assets, `projects/xf-studio/authoring/evidence/screenshots/facial-setup-d1/`, with `sheet.png`) [observed in the browser]:

| Expression | View | Mean difference (0–255) | Pixels differing by more than 8 |
|---|---|---:|---:|
| Smile 0.5 | front / three-quarter | 0.99 / 0.60 | 2.9 % / 1.8 % |
| Smile 0.7 | front / three-quarter | 1.17 / 0.74 | 3.8 % / 2.3 % |
| Smile 0.7 with cheek raise 0.5 | front / three-quarter | 1.45 / 0.91 | 4.6 % / 2.7 % |

Where it shows: the mouth parting and the lips' outline (the lip corners sit differently), the cheek's silhouette in three-quarter view, and, with the cheek raise, the lower lids. At a close face framing under the Studio's light the change is subtle rather than striking: the two faces read as the same expression with a slightly different mouth line and cheek contour. The installed `facial_happy` and `facial_charming` weren't rendered (the servers hadn't read the installed expressions when the renders asked for them); the joint numbers above cover them.

## Still to take

- In game, whether the creator and gameplay faces use the same setup (the creator and gameplay face rig `.app` files name it too [resource]; `face.rig.read` there answers it).
- The smile lump's size in game against the preview, now with the same setup, at a matched lens and light ([facial animation, question 10](../../knowledge/facial-animation.md#open-questions)).
