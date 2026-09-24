# Reported missing brow-region idle motion

23 September 2026. Nathan reports movement above the eyes in the game's character creator that appears absent in the studio. This bounded offline audit does **not** reproduce or explain the visual discrepancy conclusively. Keep the investigation with the eyebrow fidelity work after makeup, as requested; no app, source asset or game installation changed here.

## What is present

The current facial bake does contain brow movement. Direct binary accessor inspection of `authoring/public/assets/cc-idle-face.glb` finds rotation and translation channels on 26 brow joints, and all 26 have nonzero time variation. The brows asset has those 26 joints; the head has 27, including an additional midline row-D joint. The largest individual brow translation-component range is about 0.000532 scene units at `r_J_eye_brows_rowA_2_JNT`. These are local-channel ranges, not total surface displacement.

The selected source close-up clip is asymmetric and subtle: decoded additive float tracks in `research/consumers/cc-idle/raw/idle-face.glb` have right outer-brow raise range 0.0860108, while left outer-brow raise is constant. Inner raise ranges are about 0.00115 and 0.00123. A visually subtle brow result is therefore compatible with the chosen clip; the clip's exact relationship to the live character-creator graph remains unverified.

A read-only Bun harness used the actual `IdleAnimation`, `extendSkin` and `restoreFirstWeights` adapters with the current head/brow assets. It muted the body contribution and sampled 221 phases from 0 to 22 seconds. Results:

| Check | Result |
|---|---:|
| Brow-named bindings across head and accessory | 53 |
| Missing facial drivers among those bindings | 0 |
| Unmapped target bones | 0 |
| Brow card vertices checked | 390 |
| Minimum / median / maximum per-vertex trajectory bounding-box diagonal | 0.00008333 / 0.00030952 / 0.00113206 scene units |
| Maximum shared brow world-delta mismatch between rigs | 2.67e-15 |

This demonstrates nonzero facial-only deformation of the actual brow cards, without inherited head bobbing. It argues against a wholly omitted accessory rig or a completely static eyebrow component. It does not establish visual equivalence, correct magnitude, shader fidelity or the user's current control settings. This probe used neutral customization morphs and the CPU skinning path already shared by the existing offline acceptance checks; it did not inspect GPU pixels or Nathan's draft.

## A concrete missing component: dynamic wrinkle shading

The external IO Suite facial solver returns rotation deltas, translation deltas **and processed output tracks**. `authoring/tools/bake_idle_face.py` currently discards the third return value. Upstream `solver.py::_stage_wrinkles` calculates wrinkle outputs before returning them; the bake exports only bone rotation/translation.

Do not infer wrinkle inactivity from the raw animation's wrinkle channels, which are constant here: they are solver outputs. Re-evaluating the pinned external solver at 221 evenly spaced phases across the whole 22.066668-second clip gives these processed brow wrinkle ranges:

| Output | Range |
|---|---:|
| Left / right inner brow raise | 0.00230229 / 0.00245219 |
| Left / right outer brow raise | 0 / 0.16405505 |
| Left / right brow lower | 0.00004959 / 0.00004959 |
| Left / right lateral brow | 0 / 0 |

Thus the current pipeline demonstrably omits changing brow-region shading signals that the solver already makes available. Their exact influence on the game's skin normal/roughness maps, and whether this is what Nathan noticed, are **not yet established**. The signal is not a missing geometric brow animation by itself. Scale handling is also a previously documented limitation, but this audit did not establish that missing scale contributes materially to this report.

## Next useful checks

1. Add explicit brow target and brow-card trajectory checks to the future idle acceptance report; existing tests singled out eyes, jaw, lips and lids and would not expose a brow-only regression.
2. Compare paused matched phases with fixed camera/head movement disabled, retaining Nathan's saved face. Measure exposed forehead/brow skin as well as cards. This separates accessory motion, skin deformation and changing highlights without requesting a game launch.
3. Trace the selected head skin material's wrinkle inputs and masks, and retain the processed solver tracks in an experimental bake. First establish encoding and influence before implementing browser shading or claiming that wrinkle support fixes the report.
4. If the geometric motion remains weaker than an eventual matched game reference, trace actual character-creator clip selection/layering and facial setup. Do not amplify animation arbitrarily or add synthetic brow motion under the default-idle label.
5. Add a matched game comparison to the existing batched runtime session only when offline diagnostics are ready. No standalone launch is needed for this report now.

## Evidence and provenance

Source paths: [existing extraction/bake research](cc-idle.md), [bake adapter](../../projects/xf-studio/authoring/tools/bake_idle_face.py), [playback adapter](../../projects/xf-studio/authoring/src/idle-animation.ts), [current offline verification](../../projects/xf-studio/authoring/tools/verify_idle.ts). The numerical probes were read-only commands against the current ignored local assets; figures above are recorded observations rather than a new permanent test harness.

Community learning/tool use: [Cyberpunk Blender Add-on / IO Suite](https://github.com/WolvenKit/Cyberpunk-Blender-add-on), pinned commit `7a4ee793c36d9615946fe87ec9d42cde7568021d`, specifically `i_scene_cp77_gltf/animation/facial/solver.py` and its processed wrinkle outputs. The original unmodified numerical modules were executed offline again; no upstream implementation was copied. Existing WolvenKit extraction and Three.js adapter dependencies remain as credited in [the central learning record](../../docs/community-credits.md). The parent task updates that shared record before the checkpoint.

## New game reference changes the diagnostic emphasis

Nathan subsequently supplied two in-game eye/brow close-ups, annotated with red comparison marks. The apparent brow-to-eye gap and brow contour change between the frames. This is stronger evidence of a missing/under-applied geometric expression than the original text report; a wrinkle-shading-only explanation is inadequate. The images do not isolate bone versus corrective deformation or establish matched camera, gaze or exact clip phases, so no numerical displacement or definitive cause is inferred from them.

Preserved unchanged copies and SHA-256 hashes are in [the reference manifest](../backlog/preview-fidelity-references.json), labels `brow-idle-frame-1` and `brow-idle-frame-2`. Prioritize live graph/clip/layer selection, facial track weights, setup/corrective coverage and deformation magnitude alongside the skin-wrinkle omission. Nonzero brow-card movement in the current offline clip is not evidence that this supplied in-game motion is reproduced.

## 24 September: compare the other source close-up clips

The same installed `base/animations/ui/female/ui_female_face.anims` (SHA-256 `9fe289d1eea33df4242cc37ce2b175d3b0c94342df66e4bd5be1d7f599982f8c`) contains separately named close-up clips for eyes, chin, hair, lips and nose. I exported each with the existing read-only WolvenKit `anim-export` adapter and the same female head rig, then inspected decoded glTF float-track keys. The temporary GLBs remain ignored under this worktree's `research/consumers/cc-idle/raw/`. Their names, durations and track ranges come from the game files; **this does not establish which clip the live character-creator graph selects or how it blends clips**.

| Facial clip | Length | Left/right inner raise range | Left/right outer raise range | Left/right lower range |
|---|---:|---:|---:|---:|
| `ui_closeup_shot` (current studio default) | 22.07 s | 0.00115 / 0.00123 | 0 / 0.08601 | 0.00004 / 0.00004, around a constant 0.4064 baseline |
| `ui_closeup_shot_eyes` | 4.00 s | 0.76649 / 0.76538 | 0.74188 / 0.73528 | 0.32199 / 0.32199 |
| `ui_closeup_shot_chin` | 10.00 s | 0.07902 / 0.08416 | 0 / 0 | 0.42078 / 0.42078 |
| `ui_closeup_shot_hair` | 5.17 s | 0.07902 / 0.08416 | 0 / 0 | 0.42077 / 0.42077 |
| `ui_closeup_shot_lips` | 5.33 s | 0.07902 / 0.08416 | 0 / 0 | 0.56664 / 0.53117 |
| `ui_closeup_shot_nose` | 5.67 s | 0.07786 / 0.08413 | 0 / 0 | 0.42077 / 0.42077 |

The four-second eyes clip contains much stronger, bilateral brow movement. It is a plausible **feature-close-up expression candidate**, especially given Nathan's eye close-up references, but its name and range do not prove that it is part of the default idle shown in those frames. Looping or blending it into the existing idle by guesswork would mislabel the result. The next source check is the character-creator UI controller/animation graph or an instrumented runtime observation of the selected clip. The source `facial-animations.md` guide in the modding-docs clone currently has only an `entAnimatedComponent` introduction and an unfilled screenshot placeholder; the illustrated community guide on scene/dialogue animation relationships is about a different path and supplies no proof for UI clip selection. Thus no graph claim is inferred from either.

The offline acceptance harness now checks both brow-joint matrices and all 390 brow-card vertex trajectories with body motion muted, for neutral and saved facial morph selections. It measures neutral minimum/median/maximum path-bounding diagonals of 0.00008333 / 0.00030952 / 0.00113206 scene units and saved-face values of 0.00008291 / 0.00029687 / 0.00121135. This catches a regression that disconnects the brow cards, while leaving Nathan's observed geometric disparity explicitly unresolved. It also preserves the original pause, reset and face-only checks. [Machine-readable result](../../projects/xf-studio/authoring/evidence/idle-controls-offline-check.json).
