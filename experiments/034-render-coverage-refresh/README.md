# 034: render coverage refresh (30 September 2026)

**Status:** offline measurements for the [render coverage audit](../../research/character-customization/render-coverage.md) refresh and the [render gap plans](../../research/character-customization/render-gap-plans.md) (§1–2), and offline checks of the plans' first implementation (§3–4, same day). Nothing here has runtime evidence. Evidence grades follow the [knowledge rules](../../knowledge/README.md).

Run from `projects/xf-studio/authoring`, under the memory guard (each fits in 2–3 GB; peak 0.6 GB):

```
<python> ../../../tools/memory_guard.py --limit 2 -- bun ../../../experiments/034-render-coverage-refresh/measure_breath.ts [--json <private file>]
<python> ../../../tools/memory_guard.py --limit 2 -- bun ../../../experiments/034-render-coverage-refresh/coverage_walk.ts <cached cc-catalogue-*.json>
<python> ../../../tools/memory_guard.py --limit 2 -- bun ../../../experiments/034-render-coverage-refresh/check_aperture.ts [--fixture <private file>]
<python> ../../../tools/memory_guard.py --limit 3 -- bun ../../../experiments/034-render-coverage-refresh/check_arms.ts <sav.dat>... [--fixture <private file>]
```

`game-files.ts` reads base-game resources straight from the installed archives with XF Studio's own readers, as [experiment 031](../031-photo-mode-facial-setup/README.md) does. Outputs are numbers only; the JSON is game-derived and stays private.

## 1. The idle's breaths under each facial setup (PREV-147)

**Question.** PREV-147 (V looks to grit her teeth when the idle parts her lips) was measured on 27 September with the female head's own facial setup. Since 29 September the preview solves with the male player setup the face rig names ([experiment 031](../031-photo-mode-facial-setup/README.md)). Does that change the breaths, and do the solver's open alternatives change them?

**Method.** [`measure_breath.ts`](measure_breath.ts) solves `ui_closeup_shot` (the creator's close-up loop) and `ui_expose_teeth` (the teeth page loop) from `base\animations\ui\female\ui_female_face.anims` at 30 Hz on the female face skeleton with XF Studio's own solver, once per setup, and once more on the male setup for each of the solver specification's alternatives E1 (`faceEnvelope` gates), E2 (`muzzleLips` mutes envelope type 1), C1 (the corrective flag ignored) and I1 (the second influence pass only with lipsync) ([facial solver spec §7](../../research/animation/facial-solver-spec.md#7-where-the-io-suite-may-differ-from-the-game)). Per frame, in the rest pose's world axes relative to `Head`:

- the jaw's turn: `mid_J_jaw_JNT` against its rest, in degrees;
- the midline parting: the mean height of the upper lip's midline joints (`[lr]_J_mug_lip_up_0_JNT`) minus the lower lip's (`[lr]_J_mug_lip_dn_0_JNT`), change from rest, in millimetres ("outer"); the same for the inside joints (`…_inside_0_JNT`, "inner");
- a lower-incisor proxy: the rest midpoint of the lower lip's inside joints carried by the jaw's motion alone, its drop in millimetres.

Sources (base game): the skeleton `h0_000_pwa_c__basehead_skeleton.rig` (SHA-256 `61a72dc0…7777`), the female setup (`ed5670ee…352c`), the male player setup (`96819998…fac1`), `ui_female_face.anims` (`9fe289d1…2f8c`).

**Results** [offline, XF Studio's solver; joint level, not a mesh raycast]:

| `ui_closeup_shot` | Female setup (27 September's measurement) | Male player setup (the preview since 29 September) |
|---|---:|---:|
| Jaw turn at 2.4 / 14.4 s | 0.65° / 0.88° | 0.65° / 0.88° |
| Outer parting at 2.4 / 14.4 s | 3.36 / 3.51 mm | 2.75 / 2.91 mm |
| Inner parting at 2.4 / 14.4 s | 4.87 / 5.04 mm | 3.49 / 3.60 mm |
| Largest outer parting (at 14.53 s) | 3.70 mm | 3.03 mm |
| Upper lip up / lower lip down at 14.4 s | 1.82 / 1.69 mm | 1.30 / 1.61 mm |
| Lower-incisor proxy drop at 14.4 s | 1.23 mm | 1.19 mm |
| Time per 22.07 s loop with the lips parted ≥ 1 mm | 6.9 s | 6.7 s |

- **The setup the preview now uses parts the lips less:** about 0.6 mm (18 %) less at the outer lip and 1.4 mm (28 %) less at the inner lip during both breaths. The jaw is identical, since the jaw poses don't differ between the setups. The upper lip still rises and the lower lip still drops by similar amounts around incisal edges that barely move, so the window stays centred on the bite: both rows still show, in a window about 0.6 mm shorter [offline; the 27 September mesh measurement found the window 0.3–0.5 mm taller than the outer joint parting].
- **None of the solver's open alternatives changes the breaths.** E1, E2, C1 and I1 each give the male setup's numbers to 0.01 mm. Only I1 changes the teeth page's loop (jaw 2.15° → 3.64°, parting +1.2 mm). So the idle's parting over a nearly closed bite is what the game's clip, rig and setup data give under every reading the specification leaves open.
- **The lips part for about a third of the loop.** Parting of 1 mm or more lasts 6.7 s of every 22 s, so what the mouth interior looks like is on screen often, not only at the two breaths.

**What it means for PREV-147.** The geometry has now been checked under both setups and every open solver reading: the preview's bite is the game data's. The remaining candidates are how the mouth interior is lit ([render gap plans §1](../../research/character-customization/render-gap-plans.md#1-teeth-and-the-mouth-interior-prev-147)) and an engine behaviour the offline data don't show (the paperdoll graph's blend of the face clip).

## 2. Coverage walk

**Method.** [`coverage_walk.ts`](coverage_walk.ts) projects every option of the host's cached creator catalogues (feminine 1,341 options, masculine 666, cached on 26 September on the reference installation with its CCXL mods) through the Studio's current coverage rules (`catalogueCoverage`, `src/cc-render-coverage.ts`). The cached catalogues predate the `targets` and `emitsNothing` fields, so the script derives them as `cc-catalogue.ts` does.

**Results** [offline, the Studio's own rules]:

| Body | Visible head rows | Visible body and arm rows | Hidden options not drawn |
|---|---|---|---|
| Feminine | 628 drawn, 280 conditional (face decals, drawn once resolved), 2 not drawn | 34 drawn, 2 not drawn | 286 head (first-person hair twins, proxies, photo-mode rig, quest bruises), 27 arms (every holster state but the default, first-person arms), 15 body |
| Masculine | 215 drawn, 263 conditional, 1 not drawn | 32 drawn | 72 head, 17 arms |

- The visible rows not drawn are the first-person neck (`neck`, group `FPP`; correct), the first-person body tattoo and nipple switchers (correct), and one CCXL hair pack's cap option whose appearance lists no consumer group (`hair_color` slot, no `hairs` group). Whether the game draws such an option through another route is unread [hypothesis]; nothing else in the pack is affected.
- The masculine beard: 13 part rows and 57 colour rows are conditional. They settle to drawn only where a part is a decal (the stubble); the beard cards (`hair.mt`) are not drawn.
- Arm cyberware: every holster state except the default is not drawn, for both bodies.

## 3. The lip-aperture reading (PREV-147 step A)

**Question.** Does the Studio's aperture reading (`src/mouth-aperture.ts`), which picks the lip joints from the facial setup's `JointRegions`, the jaw's ancestry and the rest heights instead of joint names, reproduce §1's by-name measurement?

**Method.** [`check_aperture.ts`](check_aperture.ts) solves `ui_closeup_shot` with the male player setup at 30 Hz with XF Studio's own solver and bake (the frames the host serves the page), and reads each frame's aperture with `mouthLipJoints` and `posedParting`. `--fixture` writes the rest, the regions and three frames (0, 2.4 and 14.4 s) for the unit test (`tests/mouth-aperture.test.ts`; game-derived, private, in the ignored `data/private-fixtures/`). Same sources and hashes as §1.

**Results** [offline]:

| | Value |
|---|---|
| Joints chosen | upper `l_J_mug_lip_up_0_JNT`, `r_J_mug_lip_up_0_JNT`; lower `l_J_mug_lip_dn_0_JNT`, `r_J_mug_lip_dn_0_JNT`; frame `Head` (its local +x is the rest's up) |
| Rest parting (the lips' own thickness) | 7.33 mm |
| Aperture at 0 / 2.4 / 14.4 s | 0 / 2.75 / 2.91 mm |
| Largest (at 14.53 s) | 3.03 mm |
| Time per loop at 1 mm or more | 6.7 s |
| Frames below zero | none |

The region rule picks the same joints §1 named and gives §1's numbers to 0.01 mm. In the mouth region the midline also holds rings of joints above and below the lips (`mouth_rowA_0`, `rowB_0`, `rowA_6`) and the inside joints; the rule separates them by what carries them (the lower lip's joints ride on the jaw, the inside joints hang off the outer ones) and by rest height (the lowest head-carried joint and the highest jaw-carried one on each side).

## 4. The arm cyberware chain (render gap plans §5)

**Question.** Does the Studio's chain (the save's `ArmsCW` item → `holsteredItem` → `appearanceName` → the creator resource's `perspectiveInfo`) name the holster state a save's equipped arm cyberware selects, from the game's own data?

**Method.** [`check_arms.ts`](check_arms.ts) reads each save's loadout with `save-loadout.ts`, follows the item through the installed compiled TweakDB (`tweakdb_ep1.bin`, `clothing-host.ts` `holsteredAppearance`) and the save's body gender's creator resource from the base archives (`arm-cyberware.ts` `armsStateFor`), and lists the arms options the save itself stores in that group. Run on three of the reference machine's own saves (their folder names only are printed); `--fixture` writes the first armed save's chain for `tests/arm-cyberware.test.ts` (save- and game-derived, private). The TweakDB IDs were also checked directly: `Items.StrongArms` → `holstered_strong`, `Items.MantisBlades` → `holstered_mantis`, `Items.w_melee_004__fists_a` → `holstered_default`, each holstered item with `entityName` `holstered_arms`.

**Results** [offline]:

| Save | Equipped `ArmsCW` item | State | Group | Options the save stores in the group |
|---|---|---|---|---|
| EndGameSave-13 | 179425979353 | `holstered_strong` | `holstered_strong_tpp` | `holstered_data`, `h_strong_arms_colors_base_tpp`, `h_strong_arms_colors_cyberware01_tpp` |
| EndGameSave-0 | 175635779345 | `holstered_nanowire` | `holstered_nanowire_tpp` | `holstered_data`, `nails_color_tpp`, `h_monowire_arms_colors_base_tpp` |
| AutoSave-12 | none | `holstered_default` | `holstered_default_tpp` | `holstered_data`, `nails_color_tpp`, `h_default_arms_colors_tpp` |

- The chain lands on a group the save itself resolved, with the state's two halves for Gorilla Arms (the skin half and the cyberware half), as §5 of the plans expects.
- The Monowire state is one option, as the plans' §5 table records from the reference save ("one option only").
- The nails option sits in every state but Gorilla Arms, as the body rendering page records.
