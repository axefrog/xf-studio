# Idle playback controls — bounded implementation design

23 September 2026. Research/design only; no playback implementation changed in this pass. Scope is the existing real close-up preview, not expression authoring or game export.

## Recommended first controls

- Keep **Character-creator idle** as enable/disable. Disable restores the captured editing pose and resets time, as it does now.
- Add **Pause / Resume**. Pause keeps idle enabled, holds elapsed time and the current pose, and keeps the competing exploratory blink disabled. Resume continues from exactly that phase.
- Add **Head movement** and **Facial movement**, both enabled by default. Turning Head movement off removes the body-clip contribution while facial animation—including gaze, mouth and eyelids—continues. Turning Facial movement off removes the solved facial contribution while the body clip continues. Both off presents the bind pose while retaining the playback phase; it is not the reset operation.
- Preserve these settings and elapsed time in the existing workspace. No change to recipes, collection files or exported makeup is needed.

Use “Head movement” as the accessible UI term, but describe it internally as the **whole body-clip contribution**: spine/neck/head jointly drive the visible head. Muting only the bone named `Head` would leave inherited bobbing and could separate face details.

## What local evidence establishes

The current [adapter](../../projects/xf-studio/authoring/src/idle-animation.ts) already composes two independently looped sources. Its elapsed time is shared, but the body and facial mixers sample `elapsed % theirOwnDuration`. Each target bone receives:

`bodyWorldDelta × facialWorldDelta × targetWorldBind`

The result is then converted into the actual target-parent space. That is the appropriate separation point: use identity instead of the muted contribution. Continue evaluating every bound target in parent-before-child order; skipping targets would leave their previous transforms behind. Eyes, head, makeup, brows and lashes must use the same selection.

Read-only inspection of the local derived GLBs found 213 body channels on 71 nodes, including `Root`, `Spine3`, `Neck`, `Neck1` and `Head`; the face bake has 506 rotation/translation channels on 253 nodes. The face bake has no channels on those five structural body nodes, `face_root_JNT` or `jaw_root_JNT`. Its eye rotations and `mid_J_jaw_JNT` rotation/translation do vary. Thus removing the body contribution is supported by this particular decoded asset, rather than guessed from naming. This does not establish the game controller's complete layering behavior.

The bake and clip provenance are already recorded in [CC idle research](cc-idle.md), [face bake evidence](../../projects/xf-studio/authoring/evidence/idle-face-bake.json), and the [user guide](../../docs/idle-animation-guide.md). The face bake uses Cyberpunk Blender Add-on / IO Suite at `7a4ee793c36d9615946fe87ec9d42cde7568021d`; no new external source or copied code was introduced by this design review.

## Exact integration points

| Location | Change and invariant |
|---|---|
| `authoring/src/idle-animation.ts`: `update`, `setEnabled`, `seek` | Introduce paused and body/facial contribution state. Split time advancement from pose application, or guard only elapsed advancement. Seek must still apply immediately while paused. Contribution changes must reapply at the same time. Disable clears elapsed and paused state and restores exact captured locals; preserve subset preferences for the next enable. Repeated identical enable calls should not accidentally restart playback. |
| Same file: per-binding matrix composition | Start delta at identity; multiply body delta only when Head movement is enabled, then face delta only when Facial movement is enabled. Preserve current multiplication order, bind transforms and parent-space conversion. Do not try to mute via mixer weight alone or omit update calls, which could retain a previously sampled pose. |
| `authoring/src/scene.ts`: animation loop | Continue choosing the idle path whenever idle is enabled, including while paused or both contributions are muted. Otherwise the exploratory blink branch would overwrite paused eyelids. Rendering, camera control, picking and surface-guide updates continue normally. |
| Same file: `setIdle`, `idleFrameOffset`, `cameraState`, `restoreCamera` | Add scene wrappers for playback/contribution settings. Recompute the existing neutral-space framing offset when body contribution changes; remove the old offset before adding the new one. Pause must never call `setIdle` or move the camera. Preserve the user's orbit/pan. Share one deterministic offset convention between enabling, restoration and subset changes; do not derive a new phase-dependent offset on reload if the stored camera was normalized against a phase-zero offset. |
| `authoring/src/workspace-state.ts`: preview type/defaults/parser | Add default `idlePaused=false`, `idleBody=true`, `idleFace=true`; old stored workspaces keep their current behavior. Validate booleans, normalize paused=false when idle is disabled. Retain finite nonnegative idleTime validation and the existing schema/key. |
| `authoring/src/main.ts`: snapshot, idle handlers, restore, diagnostics | Save settings with time; restore subset flags before sampling the saved phase, then pause, then restore the neutral-space camera. Use a centralized motion-control refresh for disabled states/labels. Pause/subsets must not dispatch the current reset handler. Extend diagnostics to distinguish enabled/paused/body/face; report actual target motion when checking muted contributions, because driver clips may still be sampled. |
| `authoring/public/index.html` | Pause/Resume button plus the two named checkboxes near the existing idle toggle. Disable unavailable controls clearly when assets fail. Keep user preferences recoverable rather than rewriting them on load failure. |

The existing `setTime` loop approach already clamps frame increments to 0.1 seconds. Preserve that suspension policy unless deliberately changing it; resume should not accumulate all wall time spent paused or in a suspended tab. Sanitize non-finite delta inputs while touching the clock boundary.

## Meaningful verification

1. Extend `tests/idle-animation.test.ts` with a body rotation plus asymmetric facial translation. At a nonzero time, pause, apply multiple updates, and assert identical time and target matrices; resume by a known interval and compare to a direct seek. Repeat past both loop boundaries.
2. At the same phase, compare all four body/face combinations against independently expected world transforms. Assert a structural Head target is stationary in facial-only mode while eye/jaw/lip/lid targets vary. Include nested target bones and duplicate bone names across head/details, guarding against inherited motion applied twice or stale transforms after muting.
3. Disable from paused and muted combinations; assert exact original local position/quaternion/scale and zero clock. Re-enable starts at zero with chosen subset preferences. Seek while paused changes the held pose but does not resume.
4. Add workspace tests for old records, valid new settings, malformed fields, disabled+paused normalization and round-trip restoration of phase/subsets. Preserve recipes, per-preset history and saved-V morph choices.
5. Extend the asset-backed offline check with facial-only sampling across the full 22.07-second facial loop: fixed structural Head world transform, varying gaze/jaw/lids, finite vertices, consistent duplicate-rig transforms, exact reset. Keep all eight skin weights and customization morphs unchanged. Record output separately from the existing historical report.
6. Isolated browser check: pause a visibly non-neutral pose; orbit/pan and edit a layer without moving the expression; reload and verify held phase, settings and framing; resume; toggle body off while face continues; toggle face off; disable and restore exploratory blink. Check surface handles still track the actual deformed mesh. Do not alter Nathan's active draft.

## Limits and next groups

The two coarse contributions are safe to expose first because they are actually separate sources. Finer switches such as eyes-only, mouth-only or brows-only should not be implemented by simply excluding bone names: the solved facial bake contains inherited transforms and corrective interactions. Research control-track groups before solving, or use explicitly validated local-space pose masks with clear limits. That work belongs to the later expression feature discussion.

Body/facial toggles are preview composition options, not evidence the same switches exist in the game. Exact animation-graph selection/synchronization, wrinkle shading and scale-driven effects remain unverified. Muting a contribution may visibly change the pose immediately; that is intentional selection behavior, distinct from Pause holding the current pose.
