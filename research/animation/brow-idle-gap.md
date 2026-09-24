# Reported missing brow-region idle motion

23 September 2026. A user report describes movement above the eyes in the game's character creator that appears absent in the studio. This bounded offline audit does **not** reproduce or explain the visual discrepancy conclusively. Keep the investigation with the eyebrow fidelity work after makeup, as requested; no app, source asset or game installation changed here.

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

This demonstrates nonzero facial-only deformation of the actual brow cards, without inherited head bobbing. It argues against a wholly omitted accessory rig or a completely static eyebrow component. It does not establish visual equivalence, correct magnitude, shader fidelity or the user's current control settings. This probe used neutral customization morphs and the CPU skinning path already shared by the existing offline acceptance checks; it did not inspect GPU pixels or the working draft.

## A concrete missing component: dynamic wrinkle shading

The external IO Suite facial solver returns rotation deltas, translation deltas **and processed output tracks**. `authoring/tools/bake_idle_face.py` currently discards the third return value. Upstream `solver.py::_stage_wrinkles` calculates wrinkle outputs before returning them; the bake exports only bone rotation/translation.

Do not infer wrinkle inactivity from the raw animation's wrinkle channels, which are constant here: they are solver outputs. Re-evaluating the pinned external solver at 221 evenly spaced phases across the whole 22.066668-second clip gives these processed brow wrinkle ranges:

| Output | Range |
|---|---:|
| Left / right inner brow raise | 0.00230229 / 0.00245219 |
| Left / right outer brow raise | 0 / 0.16405505 |
| Left / right brow lower | 0.00004959 / 0.00004959 |
| Left / right lateral brow | 0 / 0 |

Thus the current pipeline demonstrably omits changing brow-region shading signals that the solver already makes available. Their exact influence on the game's skin normal/roughness maps, and whether this explains the reported movement, are **not yet established**. The signal is not a missing geometric brow animation by itself. Scale handling is also a previously documented limitation, but this audit did not establish that missing scale contributes materially to this report.

## Next useful checks

1. Add explicit brow target and brow-card trajectory checks to the future idle acceptance report; existing tests singled out eyes, jaw, lips and lids and would not expose a brow-only regression.
2. Compare paused matched phases with fixed camera/head movement disabled, retaining the reference save's face. Measure exposed forehead/brow skin as well as cards. This separates accessory motion, skin deformation and changing highlights without requesting a game launch.
3. Trace the selected head skin material's wrinkle inputs and masks, and retain the processed solver tracks in an experimental bake. First establish encoding and influence before implementing browser shading or claiming that wrinkle support fixes the report.
4. If the geometric motion remains weaker than an eventual matched game reference, trace actual character-creator clip selection/layering and facial setup. Do not amplify animation arbitrarily or add synthetic brow motion under the default-idle label.
5. Add a matched game comparison to the existing batched runtime session only when offline diagnostics are ready. No standalone launch is needed for this report now.

## Evidence and provenance

Source paths: [existing extraction/bake research](cc-idle.md), [bake adapter](../../projects/xf-studio/authoring/tools/bake_idle_face.py), [playback adapter](../../projects/xf-studio/authoring/src/idle-animation.ts), [current offline verification](../../projects/xf-studio/authoring/tools/verify_idle.ts). The numerical probes were read-only commands against the current ignored local assets; figures above are recorded observations rather than a new permanent test harness.

Community learning/tool use: [Cyberpunk Blender Add-on / IO Suite](https://github.com/WolvenKit/Cyberpunk-Blender-add-on), pinned commit `7a4ee793c36d9615946fe87ec9d42cde7568021d`, specifically `i_scene_cp77_gltf/animation/facial/solver.py` and its processed wrinkle outputs. The original unmodified numerical modules were executed offline again; no upstream implementation was copied. Existing WolvenKit extraction and Three.js adapter dependencies remain as credited in [the central learning record](../../docs/community-credits.md). The parent task updates that shared record before the checkpoint.

## New game reference changes the diagnostic emphasis

Two in-game eye/brow close-ups were subsequently supplied, annotated with red comparison marks. The apparent brow-to-eye gap and brow contour change between the frames. This is stronger evidence of a missing/under-applied geometric expression than the original text report; a wrinkle-shading-only explanation is inadequate. The images do not isolate bone versus corrective deformation or establish matched camera, gaze or exact clip phases, so no numerical displacement or definitive cause is inferred from them.

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

The four-second eyes clip contains much stronger, bilateral brow movement. It is a plausible **feature-close-up expression candidate**, especially given the supplied eye close-up references, but its name and range do not prove that it is part of the default idle shown in those frames. Looping or blending it into the existing idle by guesswork would mislabel the result. The next source check is the character-creator UI controller/animation graph or an instrumented runtime observation of the selected clip. The source `facial-animations.md` guide in the modding-docs clone currently has only an `entAnimatedComponent` introduction and an unfilled screenshot placeholder; the illustrated community guide on scene/dialogue animation relationships is about a different path and supplies no proof for UI clip selection. Thus no graph claim is inferred from either.

The offline acceptance harness now checks both brow-joint matrices and all 390 brow-card vertex trajectories with body motion muted, for neutral and saved facial morph selections. It measures neutral minimum/median/maximum path-bounding diagonals of 0.00008333 / 0.00030952 / 0.00113206 scene units and saved-face values of 0.00008291 / 0.00029687 / 0.00121135. This catches a regression that disconnects the brow cards, while leaving the reported geometric disparity explicitly unresolved. It also preserves the original pause, reset and face-only checks. [Machine-readable result](../../projects/xf-studio/authoring/evidence/idle-controls-offline-check.json).

## 25 September: reproducible processed-wrinkle probe

The [read-only probe](../../projects/xf-studio/authoring/tools/probe_idle_wrinkles.py) now makes the previously ad hoc wrinkle measurement reproducible. From the repository root, with the same ignored intake and pinned IO Suite checkout, run:

```powershell
python projects/xf-studio/authoring/tools/probe_idle_wrinkles.py --intake D:/Dev/cp2077-modding-hq/research/consumers/cc-idle --addon D:/Dev/Cyberpunk-Blender-add-on --output projects/xf-studio/authoring/evidence/idle-wrinkle-probe.json
```

It refuses changed intake hashes or modified/unpinned solver modules. It samples the **actual current studio default** `ui_closeup_shot` facial float tracks at 30 Hz, adds rig reference values as in the existing bake, and records the unmodified solver's processed output rather than the raw, mostly constant wrinkle inputs. [The asset-free report](../../projects/xf-studio/authoring/evidence/idle-wrinkle-probe.json) contains every one of 33 output indices, source-control indices, extrema and times. The source rig/setup/face GLB SHA-256 values match `idle-face-bake.json` (`454e38a2…`, `aae907a8…`, `372bd962…`). The face archive source hash remains `9fe289d1…` as recorded above; the probe does not extract it anew.

| Processed channel | Source control | Range | Peak or minimum time |
|---|---|---:|---:|
| Left/right inner raise, indices 381/382 | 13/14, `eye_[lr]_brows_raise_in` | 0.00230229 / 0.00245219 | maxima 3.53 s |
| Left/right outer raise, 383/384 | 15/16, `eye_[lr]_brows_raise_out` | 0 / 0.16462380 | right maximum 10.57 s |
| Left/right lower, 385/386 | 17/18, `eye_[lr]_brows_lower` | 0.00004959 each, over a ~0.6477 baseline | minima 7.37 s |
| Left/right lateral, 387/388 | 19/20, `eye_[lr]_brows_lateral` | 0 / 0 | static |
| Left/right outer lower squint, 389/390 | 27/28, `eye_[lr]_oculi_squint_outer_lower` | 0.51 / 0.5775 | see JSON |

The 30 Hz right outer-raise range is slightly above the earlier 221-phase result (0.16405505) because this sample lands closer to its peak. `_stage_wrinkles` in the pinned solver takes the post-control source, applies `1−(1−x)^2`, clips it to [0,1], then writes the output segment. This is a processed **signal**, not a geometric displacement or a measured normal-map intensity. The 0.6477 lower-brow baseline is nearly static, so a nonzero absolute value alone is not evidence of changing shading.

The saved D05 material chain already identifies inherited face detail, **wrinkle stretch and squash normal maps**, and a bloodflow mask in [the source trace](../eye-artistry/saved-skin-resource-chain.md). The inspected installed 2.31 `skin` G-buffer variant samples the optional wrinkle normals through registers 20/21 and blends their reconstructed RG normals before tangent-basis conversion; see [shader-channel evidence](../eye-artistry/saved-skin-shader-and-winner.md). This establishes material capacity for wrinkle-driven surface detail in the inspected variant. **No offline binding yet connects facial output index 381–413 to either normal map, a spatial mask, or an influence parameter on this head**, and effective runtime material/clip selection remains unobserved. The current preview does not render these outputs.

The two [user-supplied game frames](../backlog/preview-fidelity-references.json) visibly change the brow contour and brow-to-eye spacing, while the eyebrow pixels and lighting also change. The solver output could contribute to **shading appearance**, especially around the right outer brow, but it cannot by itself move a card or skin silhouette and therefore cannot fully explain that apparent geometric change. Since the frames have no recorded matched camera, phase, or active UI animation layer, their difference cannot be assigned to this 10.57-second event. The exact next discriminator is a matched fixed-camera game/studio phase pair with head motion disabled and clip/layer IDs captured from the live character-creator graph; compare brow-card landmarks and skin contour first, then hold geometry fixed while checking whether wrinkle normal/mask response changes the remaining pixel difference. This can join a later batched runtime session; no game launch was used here.
