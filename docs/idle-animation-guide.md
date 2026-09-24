# Idle animation and future facial-expression tools

The useful discovery is that the character-creator idle has **separate body and facial animation**. That gives us a promising route to combining a head movement, an expression and eye behaviour, rather than treating every look as one inseparable animation.

This describes what we have actually decoded from your installed game as of 23 September 2026. It is a planning guide, not a promise that every idea below is already supported by the studio.

## What makes the head move?

An animation clip describes how bones move over time. The rig describes how those bones connect, and the mesh’s skin weights determine which vertices follow each bone. A gentle head turn can involve the upper spine, neck and head together; moving just one head object would miss that relationship.

We extracted the female UI animation set and its `ui_closeup_shot` clip. **Its body motion lasts about 12.33 seconds.** The set also contains full-body idles, transitions and shorter close-ups for eyes, nose, lips, chin and hair. The exact live character-creator animation graph and its selection/blending rules still need tracing, so the clip’s presence does not establish every detail of the game’s default presentation.

The studio can play this decoded body clip on its existing head, makeup, brows and lashes. It transfers movement by named bones while preserving their original attachment positions, then combines it with facial movement. Each eyeball now follows its own game eye joint, allowing the gaze to change.

## Why facial animation is a separate job

The matching facial clip is **about 22.07 seconds**, not the same duration as the body clip. My earlier 22-second description referred to this facial loop.

It contains 67 changing facial control tracks. These include left/right blinking, brow movement, squinting, breathing around the nose and movements around the lips. They are control values over time; they are not already a complete set of moving facial bones in the exported file.

The game’s facial setup and processing turn those controls into visible deformation. Playing an ordinary bone-animation export of the facial clip produces a static face because it leaves out that processing. The community’s **Cyberpunk Blender Add-on / IO Suite** provides a solver for these controls, including limits, intermediate poses and corrective combinations. Running that solver offline against the extracted setup gave us a 663-frame clip affecting 253 bones. The studio now plays this facial motion alongside the body clip, including eyelids, mouth and gaze. [Credits and source](community-credits.md#cyberpunk-blender-add-on-io-suite).

The facial clip is additive: our bake adds its track values to the rig’s reference values before solving. That restores the default control envelopes rather than treating every zero as “turn this part of the face off.” This is our current playback interpretation; the live game’s complete animation graph and blending still need checking.

The 105 facial customization shapes already in the studio are another system: they change V’s underlying face shape. They should remain intact while an expression plays. An expression editor must work across those face shapes, rather than baking everything into one particular V.

## What this suggests for the feature set

| Idea | Assessment |
|---|---|
| Play and pause an existing idle | Implemented, including exact paused-pose restoration on reload. Scrubbing and speed controls remain later work. |
| Freeze an animated expression at a chosen instant | A useful target for photo mode; game export and registration still need proving. |
| Combine one body idle with another facial expression | Promising because the source channels are separate. We must check timing, blend rules and which controls each clip owns. |
| Edit blink timing, gaze, a smile or individual brows | Suitable controls for a future editor after the facial setup is understood. Gaze and blinking need coordination to avoid unnatural results. |
| Author new idles and expressions | A reasonable research direction. Playback is only half the job: encoding, importing and selecting the result in game require separate validation. |
| Share expression presets across different Vs | A design goal, not yet guaranteed. Facial proportions, replacement heads and modded rigs can affect the result. |

## Constraints worth designing around

- **Loop boundaries matter.** A smooth movement can still jump when its last frame returns to its first.
- **Blending is not simply addition.** Two clips trying to control the same eyelid or jaw can exaggerate or cancel each other. We should expose intentional control groups and priorities.
- **Body and face have separate clocks.** Their different lengths may create variation when looped together; the game’s actual synchronization rules remain to be checked.
- **Playback support is not export support.** WolvenKit decoded these compressed clips, but warns that its exporter does not preserve their original SIMD compression on re-import. We must test newly authored output deliberately.
- **A convincing browser preview is useful, but does not prove game behaviour.** We can check timing, continuity, bone mapping and many deformation problems offline, then batch the remaining game checks.
- **Movement and skin detail are separate.** The current solver supplies translation/rotation, while wrinkle shading and scale-driven effects are not reproduced here. Teeth/tongue rendering and exact skin/eye materials are also unfinished, even though the face can now move.

Enable **Character-creator idle** in the viewport to preview the combined clips. **Pause idle** holds the current pose and **Resume idle** continues from there; makeup editing and camera movement stay available. Turn off **Head movement** to keep the head stationary while the face animates, or turn off **Facial movement** independently. These switches mute the two whole clip contributions; they are not fine-grained eye/mouth/brow masks. Both off gives the editing pose while the phase remains available. Disable idle to restore the editing pose and reset time/pause; subset choices are remembered. Pose/phase/settings restore on reload. The separate exploratory blink controls stay disabled whenever idle is enabled, including while paused. Expression authoring and custom idle authoring follow the feature discussion we have reserved before full-body tattoos. A promising future editor would preserve the meaningful facial controls rather than exposing hundreds of unrelated bone sliders.

Current control verification: 46 automated tests pass. The [real-asset check](../projects/xf-studio/authoring/evidence/idle-controls-offline-check.json) samples 222 phases for each of neutral and saved-face customization: structural head drift stays at numerical roundoff while gaze/jaw/lids vary, and pause/reset errors are zero. [Browser checks](../projects/xf-studio/authoring/evidence/idle-controls-browser-check.json) verify paused reload, framing, independent subsets and editing. These establish preview behavior, not live-game graph parity.

Evidence: [local animation intake](../projects/xf-studio/authoring/evidence/idle-intake.json), [facial bake](../projects/xf-studio/authoring/evidence/idle-face-bake.json), [offline playback checks](../projects/xf-studio/authoring/evidence/idle-offline-check.json), [clip exporter](../projects/xf-studio/tools/anim-export/Program.cs), [playback adapter](../projects/xf-studio/authoring/src/idle-animation.ts). Extracted game animation files remain local and are not included in GitHub.
