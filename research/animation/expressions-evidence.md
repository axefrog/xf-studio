# Facial expressions and idles: evidence note

26 September 2026. Offline, read-only study behind the [facial expressions knowledge page](../../knowledge/facial-expressions.md) and the [expressions and idles brief](../backlog/expressions-and-idles-brief.md). No game or MO2 launch, no installed file changed. Extracted and serialised files stay in the ignored intake `research/consumers/expressions/` (`extracted/`, `json/`, `raw/`); only names, hashes, structures and measured values are recorded here.

## Sources and versions

| Source | Version / identity | Used for |
|---|---|---|
| Installed game | 2.31 (`bin\x64\Cyberpunk2077.exe` dated 16 September 2025, 59,945,608 bytes) | Archives, compiled scripts and TweakDB |
| Compiled scripts | `r6\cache\final.redscripts` SHA-256 `2119046f…ee86`, decompiled with redscript-cli 0.5.31 `decompile -f` | `PhotoModeFace_Record`, `PhotoModePose_Record`, `AnimFeature_PhotomodeFacial`, `AnimFeature_Paperdoll`, `entityPreviewGameController.script`, `photoModePlayerEntity.script`, `photoModeMenuController.script` |
| TweakDB sources | REDmod tools shipped with the game (`tools\redmod\tweaks`, dated 12 September 2025): `database\photomode\faces.tweak` `d7b19b92…`, `schema.tweak` `7a49bd72…`, `poses.tweak` `972428eb…`, `posecategories.tweak`, `static_data\photomode.tweak` `59f5c82c…`, `database\items\base_values.tweak` | Record shapes and vanilla lists |
| Compiled TweakDB | `tweakdb.bin` `918f0acf…`, `tweakdb_ep1.bin` `89c7ee67…`, read with the Studio's `src/tweakdb-flats.ts` | The 15 `PhotoModeFaces.*.displayName` flats exist in both blobs with the REDmod values |
| WolvenKit CLI | 9.0.1 (`unbundle`, `convert serialize`) | Extraction and JSON |
| Clip exporter | `projects/xf-studio/tools/anim-export` (existing build) | Face clips to GLB with float-track extras |
| WolvenKit source | Local clone at `11720772` (9.0.2 nightly 2026-09-19) | `ModTools.ImportAnims` float-track and animation-type handling |
| ArchiveXL source | `v1.27.3`, commit `5474e34d` | `animations:` keys and merge rule; resource-patch types; `PhotoModeScope.xl` |
| Modding Docs clone | `be2f44eed8419342ec13f72ed9cab008e9f7b289` | Community workflows (below) |
| Cyberpunk Blender add-on | `7a4ee793c36d9615946fe87ec9d42cde7568021d` (same as the Studio's pin) | Facial solver stages, `trackKeys` round trip |
| Installed mods (MO2, profile with all of these enabled) | See [mods inspected](#mods-inspected) | Registration routes |

## Game resources

| Resource | SHA-256 (first 16) | Finding |
|---|---|---|
| `base\animations\anim_motion_database\photomode_facial_poses.csv` | `25c645cd6eb9d2ee` | 15 rows: `Index`, `AnimationName`, `streamingContext` (`photomode`), `FallbackAnimationName` (= own name); Index 0–14 = neutral, charming, furious, bored, pissed, pleased, disgusted, happy, scared, surprised, sadness, whistling, singing_01–03 |
| `base\animations\facial\_facial_graphs\player_woman_photomode_sermo.animgraph` | `60fe33be25296c77` | `animFeatures`: `AnimFeature_PhotomodeFacial` `PhotomodeFacial`. Spine (root to leaf): `Sermo` ← `EyesTracksLookAt` ×2 ← `SetTrackRange`/`FloatTrackModifier`/`SimpleBounce`/`TwistConstraint` (neck, head tilt/turn) ← `Switch` ← `LookAtController` (`isFacial` 1) ← `RotationLimit` Head/Neck1/Neck ← `BlendOverride` (eyes, add) ← `FacialSharedMetaPose` ← `FacialMixerSlot` ← `BlendAdditive` (`AGAT_Local`, `AGBT_Add`, weight 1) with base `SharedMetaPose`←`ReferencePoseTerminator` and added `StateMachine` (states 0 and 1, each `AnimDatabase` on the CSV with `IntInput` `PhotomodeFacial.facialPoseIndex`, `isLooped` 0; transitions 0→1 and 1→0 on `ExternalEvent updateFacialPose`, linear 1 s). Look-at blink definitions: `additive__blink_fast__01`, `…half__01` (delay 0.15, min transition 0.85), `…slow__01` (delay 0.25, min 5) |
| `…\player_man_photomode_sermo.animgraph` | `d93a65ba2ebda1d2` | Male twin |
| `…\player_woman_paperdoll_sermo.animgraph` | `1e631615513459ba` | Creator/inventory face graph; 14 features including `AnimFeature_Paperdoll`. Close-up `StateMachine` states: 0 closeup, 1 eyes, 2 chin, 3 lips, 4 nose, 5–8 closeup, 9 hair, 10 closeup; default 0. Transitions (target ← condition): 0→1 on `characterCreation_Eyes`=1; 1→7 on `eyes_anim_done`; 7→0 on Eyes=0 **and** `Timed 15`; same pattern for lips (0→3→8→0), nose (0→4→6→0), jaw/chin (0→2→5→0), hair (0→9→10→0); all 0.5 s. Outer switches select fullbody (`ui_fullbody_shot`, `ui_closeup_to_fullbody`), `ui_expose_hand` (Nails), `ui_expose_teeth` (Teeth), inventory (`ui_inventory_pickup` then `ui_closeup_shot`) and gender selection. Same look-at blink definitions as photo mode |
| `base\gameplay\anim_graphs\player_photomode.animgraph` | `8063e1b6fe6dbceb` | Body graph of the photo-mode puppet: 73 features incl. `AnimFeature_PhotomodePoseCategory` and six `AnimFeature_PhotomodeBodyPartRotate`; one `MixerSlot`, one `GraphSlot`, one `WorkspotHub`, 85 `SkAnim` (weapon idles, `idle__neutral__female(__default)`, `idle_stand`) |
| `base\animations\ui\photomode\photomode_female_facial.anims` | `48fa59b30d9c0e2f` | 15 clips, rig `base\characters\head\pwa\h0_000_pwa_c__basehead\h0_000_pwa_c__basehead_skeleton.rig` (`44e6474e…`); all 2 frames, 0.033 s, 344 joints, 414 tracks; 14 `AdditiveFromRefPose`, `facial_sadness` `Additive`; `animAnimationBufferCompressed` |
| `…\photomode_male_facial.anims` | `5fb0079689fb30d0` | Same layout; rig `h0_001_ma_c__player_skeleton.rig` |
| `…\photomode__v_female__facial.anims` | `fe1467887d5f8475` | 0 clips (the male `photomode__v__facial.anims` too) |
| `…\photomode__female__idle.anims` | `92241e5bdc7d297f` | 133 body clips, all 2 frames, `Normal`, 71 joints, 13 tracks; `photomode__v_female__natural.anims` 23 clips of 2–3 frames |
| `base\animations\ui\female\ui_female_face.anims` | `9fe289d1eea33df4` | `ui_closeup_shot`, `ui_fullbody_shot` 22.07 s and `ui_inventory_pickup` 12.10 s and `ui_expose_teeth` 10.00 s (`AdditiveFromRefPose`); `ui_closeup_shot_eyes/nose/chin/hair/lips` 4.00–10.00 s (`Additive`) |
| `base\animations\facial\female_average\interactive_scene\generic_average_female_facial_idle.anims` | `2bc9adaa6f7baf53` | 20 NPC emotion idles, 21.17–28.77 s (one 3 s `idle__dead__female`), `AdditiveFromRefPose`, rig `h0_000_wa_c__basehead_skeleton.rig` |
| `base\animations\facial\generic\interactive_scene\generic_facial_additives.anims` | `89e7c37bef6353ef` | Blinks `additive__blink_fast__01` 0.333 s, `…tiny…` 0.367, `…normal…` 0.500, `…half…` 0.533, `…slow…` 0.567 (`AdditiveFromRefPose`, male player rig) |
| `…\face_rig\h0_000__basehead_face_rig.app` | `bb35ca140b8f6871` | Appearances `h0_000_pwa/pma__basehead__face_rig`: `face_rig` graph = paperdoll sermo; `ui_animations` sets `ui_female_face.anims` (and a weapon-variable copy); `man_face_base_animations` with 60 generic facial sets |
| `…\face_rig\h0_000__basehead_face_rig_photomode.app` | `d1acf06d3f5ca88c` | `face_rig` graph = photomode sermo; `PhotomodeAnimations` = `photomode_female_facial.anims` + `photomode__v_female__facial.anims` (priority 128) |
| `ep1\…\face_rig\h0_000__basehead_face_rig_ep1.app` | `92d544d07301b9c6` | As the gameplay app |
| All three apps, both genders: `face_rig.facialSetup` | | `base\characters\head\pma\h0_001_ma_c__player\h0_001_ma_c__player_rigsetup.facialsetup` (`96819998…`; its rig `h0_001_ma_c__player_skeleton.rig` `91efc561…`) |
| Facial setup comparison | | Versus the female `h0_000_pwa_c__basehead_rigsetup.facialsetup` used by the Studio's idle bake: `info` (track mapping 13/141/86/33), `usedTransformIndices` (266), `inputRig`, `tongueCorrectiveNames`, `version` identical; `mainPosesData`, `correctivePosesData`, `faceCorrectiveNames`, `posesInfo`, `bakedData` and `rig` differ; `useFemaleAnimSet` 0 vs 1 |
| `ep1\characters\entities\player\photo_mode\player_wa_photomode_ep1.ent` | `958b2d8ba5e56046` | Body graph `player_photomode.animgraph`; body sets include `ui_female.anims`, `photomode__female__idle/action.anims`, `photomode__v_female__natural.anims`, EP1 idle/action sets |
| `base\characters\head\pwa\player_wa_tpp_head.ent` | `be4e2f48b50ca902` | TPP head item entity; the photo-mode head is the item `Items.PlayerWaPhotomodeHead` (`PlayerWaTppHead` with appearance `TPP_photomode`), given to the photo-mode puppet in `PhotoModePlayerEntityComponent.SetupInventory` |

### Decoded expression vectors

`decode_face_pose_vectors.py` over the 13 female expression GLBs (singing_02/03 not exported). Values are the clip's largest-magnitude value per track; for `AdditiveFromRefPose` clips these add to reference values (envelopes and override weights 1, main poses 0).

| Clip | Type | Non-zero tracks | Largest controls |
|---|---|---:|---|
| facial_neutral | FromRefPose | 2 | `eye_[lr]_dir_dn` 0.0093 |
| facial_charming | FromRefPose | 22 | `lips_r_corner_sharp_up` 0.73, `lips_r_corner_up` 0.4695, `lips_l_corner_up` 0.3173, `lips_apart_up` 0.25, `eye_r_oculi_squint_inner` 0.22 |
| facial_furious | FromRefPose | 32 | `eye_[lr]_oculi_squint_inner` 0.9, `nose_l_snear` 0.8634, `eye_[lr]_brows_lower` 0.8564, `…lateral` 0.8405, `jaw_mid_shift_fwd` 0.78 |
| facial_bored | FromRefPose | 35 | `lips_together_up/dn` 0.9, `eye_r_brows_raise_in` 0.6434, `lips_puff_up` 0.6, `eye_[lr]_blink` 0.18 |
| facial_pissed | FromRefPose | 24 | `eye_r_brows_lower` 1, `eye_[lr]_brows_lateral` 1, inner squints 0.85, `eye_l_brows_lower` 0.7773 |
| facial_pleased | FromRefPose | 27 | `lips_together_up/dn` 1, `lips_l_nasolabialDeepener` 0.41, `lips_l_corner_up` 0.355 |
| facial_disgusted | FromRefPose | 34 | `lips_together_dn` 1, `jaw_mid_open` 0.5532, `eye_l_oculi_squint_outer_lower` 0.53, `nose_l_snear` 0.447 |
| facial_happy | FromRefPose | 32 | `lips_apart_up` 0.86, `lips_r_corner_sharp_up` 0.82, `lips_r/l_corner_up` 0.5699/0.5127, outer squints 0.33–0.34 |
| facial_scared | FromRefPose | 33 | `neck_[lr]_platysma_flex` 0.98, `eye_[lr]_widen` 0.8, `eye_r/l_brows_raise_in` 0.7562/0.6527 |
| facial_surprised | FromRefPose | 32 | `eye_l_widen` 0.8, `eye_l_brows_raise_in/out` 0.62/0.60, `neck_throat_open` 0.6, `eye_r_widen` 0.57 |
| facial_sadness | Additive | 134 (41 main poses) | envelopes and override weights 1; `lips_together_dn` 0.7534, `eye_[lr]_brows_raise_in` 0.71, `lips_chin_raise` 0.66, brows lateral 0.58 |
| facial_whistling | FromRefPose | 42 | funnel, puff, apart, sticky corners 1.0; `eye_l_dir_out`/`eye_r_dir_in` 0.8069 |
| facial_singing_01 | FromRefPose | 59 | brows lower, blink, left snear 1.0; `jaw_mid_open` 0.5495 |

The Mega Pack survey found the joint keys of every vanilla expression identical to `facial_neutral` except the singing clips, which also move Head/Neck/Neck1/Spine3.

## Mods inspected

All installed and enabled in the reference MO2 profile; read-only. Versions and Nexus IDs from each `meta.ini`.

| Mod | Version, Nexus ID | Mechanism observed |
|---|---|---|
| Photomode Facial Expression Mega Pack - Masc and Fem | 2.1.0.0, 7912 (files prefixed `xBaebsae_`) | 202 `PhotoModeFaces.*` records (faceId 15–216, `$base: facial_neutral`), 195 appended to `faceAnimations` with `!append-once` (including the vanilla singing faces); whole replacements of `photomode_facial_poses.csv` (217 rows) and both photo-mode face graphs (only changes: `isLooped` 0→1 on both `AnimDatabase` nodes, and a `MathExpressionPose` `tokenData` padded 15→741 entries); ArchiveXL `resource.patch` of `h0_000__basehead_face_rig_photomode.app` and of 57 NPC photo-mode apps with a `PhotomodeAnimations` component listing the vanilla set plus 15 new sets (444 clips, 206 `facial_*`); clips authored on the female basehead skeleton and attached to male faces too. Clip types: `AdditiveFromRefPose` 159–166, `AdditiveWithoutFirstFrame` 37, `Additive` 3; static clips 1–2 frames, animated 0.9–33.7 s; 144 clips bake blink tracks |
| Action Pose Pack - Archive XL (F and M) | f1.01, 8698 | `.xl` `animations:` on explicit photo-mode entities; category `$base: idleCategory`, poses `$base: idle_stand_01` |
| Ziva Photoshoot Posepack Archive XL | 1.4.0.0, 8463 | `animations:` on the `photomode_wa.ent` scope; plus an AMM collab Lua and workspot |
| Dancy - Pose Pack | 2.2.0.0, 18007 | 20 explicit `animations:` entries; 71 pose records |
| Photo Mode Unlocker XL | 2.3.1.0, 4319 | Pose/limit unlocks through TweakXL anchors; no faces |
| Multi Pose Pack Framework | 1.0.0.0, 4098 | Legacy whole replacement of the player photo-mode entities |
| PhotoMode-EX | 1.4.0.0, 18839 | Native plugin (custom characters, look-at, rotation); no face handling in its scripts |
| Photo Mode Pose Selector | 1.2.0.0, 32633 | CET overlay: attribute keys (V expression 28, NPC expression 56), `OnSetupOptionSelector` / `OnForceAttributeVaulue`, freezing via `SetIndividualTimeDilation` |
| Natural Poses Unlocked - 2.3 Poses Retargets and Fixes | 2.31.0.0, 22839 | Scoped pose sets |
| Appearance Menu Mod | 2.12.5.0, 790 | Expressions: `ReactionManager:ResetFacial(0)`, then `AnimFeature_FacialReaction{category, idle}` via `ApplyFeature("FacialReaction", …)` (`Modules/tools.lua:2377-2393`, 19 built-in pairs in `init.lua:2832-2856`); poses via workspots (`Modules/anims.lua:350-371`) |
| Facial Customisation Rig Fix - No more clipping Eyes | 4.2.1.0, 7179 | Replaces the `facialcustom` sets and 51 morph targets; patches every player entity with an `entFacialCustomizationComponent` |
| Morphtarget and AnimRig Additions | 1.2.0.0, 4673 | Extra morph/rig slots for head items; not an expression route |

Across all 1,000 installed mod folders only the Mega Pack touches `PhotoModeFaces`, `faceAnimations`, the facial CSV or the face graphs; 45 mods use ArchiveXL `animations:`.

## Community documentation (Modding Docs `be2f44ee`)

| Page | Credit line | What it established |
|---|---|---|
| `modding-guides/animations/facial-animations/custom-facial-expressions.md` (duplicate under `animations/animations/`) | mana vortex, March 2024 | No authoring guide exists; the documented method renames vanilla facial clips over the photo-mode or AMM slots; first name match wins |
| `modding-guides/animations/facial-animations/README.md` | Simarilius, based on info from Loomy and John CO | Dialogue face-clip lookup chain (image `.gitbook/assets/image (547).png`) |
| `for-mod-creators-theory/references-lists-and-overviews/cheat-sheet-head/cheat-sheet-facial-expressions.md` | AMM table courtesy of Maximilium, Pinkydude and Vitum | Photo-mode and AMM expression keys |
| `…/cheat-sheet-photo-mode.md` | manavortex, January 2024 | Photo-mode animation files and pose names |
| `modding-guides/animations/animations/archivexl-adding-photo-mode-poses/README.md` and its 2.2/2.3 update pages | manavortex; nutboy; nutboy and Zwei Valerie | Pose registration (images `archivexl_photomode_anim.png`, `archivexl_photomode_yaml_1..3.png`) |
| `…/poses-animations-make-your-own/README.md` | mana vortex, updated by LadyLea; process and templates by xbaebsae / Angy | Blender → WolvenKit Import Tool (Anims) workflow (image `animations_blender_wolvenkit_import.png`) |
| `modding-guides/npcs/fixing-eye-clipping-in-npvs-by-replacing-facial-rigs.md` | saltypigloaf | `face_rig` component fields (image `wiki_component.png`); vanilla V always uses rig 000 |
| `modding-guides/quest/generating-vanilla-lipsync-animation-sets.md` | Akiway | V has no lipsync |

Screenshots inspected are editor illustrations, not runtime proof.

## Commands

```powershell
# from research/consumers/expressions
WolvenKit.CLI unbundle "<game>\archive\pc\content" -o extracted -r "(photomode.*\.anims$)|(\.animgraph$)|anim_motion_database|face_rig.*\.app$"
WolvenKit.CLI convert serialize <file> -o json/xf
redscript-cli decompile -i "<game>\r6\cache\final.redscripts" -o raw/scripts -f
AnimExport.exe extracted/.../photomode_female_facial.anims <face skeleton .rig> <clip> raw/pm-faces/<clip>.glb
python research/animation/probes/animgraph_tree.py json/xf/<graph>.animgraph.json
python research/animation/probes/decode_face_pose_vectors.py raw/pm-faces json/xf/h0_000_pwa_c__basehead_skeleton.rig.json
```

## Notes for the blink track

- Both player face graphs blink **only on look-at transitions** (definitions above); no periodic blink node was found.
- The female and male player `face_rig` components reference the male player facial setup, whose main-pose and corrective data differ from the female basehead setup used by the Studio's bake.
- Several photo-mode expressions hold constant partial lid closure (bored 0.18, sadness 0.13, whistling ~0.5, singing_01 1.0); the Mega Pack bakes blinks into 144 clips.
- The creator's section one-shots (`ui_closeup_shot_eyes` and siblings) are `Additive`, not `AdditiveFromRefPose`; with main-pose references at 0 and weights clamped, adding reference values changes only saturating envelope/override tracks.
