# Character-creator idle: local playback investigation

23 September 2026. This delivers a useful browser playback slice; it does not prove exact equivalence to the live character-creator controller. The request explicitly includes mouth, eye direction and other facial changes in the idle, so body movement alone was insufficient.

## Inputs and processing

Local ignored intake root: `research/consumers/cc-idle/`. Original installed game resources remain unchanged.

| Resource | Role |
|---|---|
| `base/animations/ui/female/ui_female.anims` | `ui_closeup_shot`, Normal, about 12.33 s; also full-body/gender-selection and feature-close-up clips |
| `base/animations/ui/female/ui_female_face.anims` | `ui_closeup_shot`, AdditiveFromRefPose, about 22.07 s; 414 float tracks, 67 changing |
| `base/characters/base_entities/woman_base/woman_base.rig` | Body hierarchy and reference transforms |
| `base/characters/head/player_base_heads/player_female_average/h0_000_pwa_c__basehead/h0_000_pwa_c__basehead_skeleton.rig` | Facial hierarchy, track names and reference track values |
| Same head directory, `h0_000_pwa_c__basehead_rigsetup.facialsetup` | Face/eye/tongue poses, control envelopes, limits and correctives |

WolvenKit CLI 8.17.4 unbundles these resources; `convert serialize` produces the `.rig.json` and `.facialsetup.json` in the intake `json/` directory. Create output directories first and check actual files, since some CLI conversion errors return a successful process exit code.

Build `projects/xf-studio/tools/anim-export/AnimExport.csproj` with .NET 9. Its CLI takes **input.anims input.rig clip-name output.glb**. Export the body/face close-up clips with their respective rigs into `raw/idle-body.glb` and `raw/idle-face.glb` under the intake root. The exporter calls the installed WolvenKit libraries; its project declares the local installation dependency. The ordinary face GLB has static joint channels: its changing float tracks require facial processing.

Run from HQ:

```powershell
python projects/xf-studio/authoring/tools/prepare_idle.py
python projects/xf-studio/authoring/tools/bake_idle_face.py --addon D:/Dev/Cyberpunk-Blender-add-on
```

The second adapter executes the external Cyberpunk IO Suite numerical modules at pinned commit `7a4ee793c36d9615946fe87ec9d42cde7568021d`. It neither registers the Blender UI nor copies its solver into the browser. Additive float tracks are added to the rig's `referenceTracks`, then solved at 30 Hz with highest-detail settings. The resulting bone-local rotation/translation deltas are converted into glTF axes and composed after reference transforms. No procedural replacement expression is injected.

Local output: `authoring/public/assets/cc-idle-body.glb` (~1.5 MB), `cc-idle-face.glb` (~4.94 MB), and `cc-idle-binding.json`. The facial bake contains 663 frames affecting 253 bones. Input/output hashes and solver provenance are in [body intake](../../projects/xf-studio/authoring/evidence/idle-intake.json) and [face bake](../../projects/xf-studio/authoring/evidence/idle-face-bake.json). These game-derived binaries are excluded from Git and releases.

## The game's other preview idles

The close-up clip was the only one prepared until 27 September. `tools/prepare_body_idles.py` prepares the rest of the preview screens' loops the same way, from the same intake root ([V's body in motion §2](../../knowledge/body-animation.md#2-the-preview-idles)):

1. It extracts `player_paperdoll.animgraph`, `ui_female.anims`, `ui_female_face.anims`, `woman_base.rig` and the face skeleton rig with WolvenKit when they're missing, and serializes the graph.
2. It lists every looping body clip in a state machine state, plus the looping clips the preview screens' switch plays directly. That gives the creator's close-up, full body and nails loops, gender selection, and the inventory's `UI_full_shot`; it leaves out the 53 held-weapon idles.
3. It exports each body clip with `tools/anim-export` into `raw/body-<clip>.glb` and serves it as `public/assets/cc-idle-body-<clip>.glb` (the close-up keeps `cc-idle-body.glb`).
4. It bakes the face clip the face graph loops with each where the face set has one: `bake_idle_face.py --clip ui_fullbody_shot` writes `cc-idle-face-ui_fullbody_shot.glb`. The inventory loops the close-up face after a one-shot pickup.
5. It adds the close-up **with the eyes section open** (`closeup-eyes`, "Creator close-up, eyes section"): the close-up body clip, and a face baked as the section's showcase `ui_closeup_shot_eyes` once, then one pass of the close-up loop (`bake_idle_face.py --intro-clip ui_closeup_shot_eyes --intro-glb <raw> --name ui_closeup_shot_eyes_section`, written as `cc-idle-face-eyes-section.glb`). The showcase is blended in from the loop over 0.5 s and the loop back in over 0.5 s, linearly in track space before the solve, as the face graph's transitions blend [resource: 0.5 s transitions; linear track blending is a hypothesis]. The catalogue entry's `face.loopFrom` (4.5 s) tells the Studio to play the face once up to there and loop from there, so the showcase plays each time the idle starts or the entry is chosen, and never repeats inside the loop ([facial animation §6](../../knowledge/facial-animation.md#6-the-idles-upper-face)). The showcase is typed `Additive` but stores deltas (its envelope tracks add 0), so the bake adds it onto the reference tracks like the loop, and refuses an `Additive` clip whose envelopes hold absolute values. [Bake evidence](../../projects/xf-studio/authoring/evidence/idle-face-bake-eyes-section.json).
6. It writes `public/assets/cc-idle-catalogue.json` (`idle-catalogue.ts`), and hashes and the catalogue to [the catalogue evidence](../../projects/xf-studio/authoring/evidence/idle-catalogue.json).

Run from HQ (after the close-up's two steps above):

```powershell
python projects/xf-studio/authoring/tools/prepare_body_idles.py --wolvenkit <WolvenKit.CLI.exe> --game <game folder> --anim-export projects/xf-studio/tools/anim-export/bin/Debug/net9.0/AnimExport.exe --addon D:/Dev/Cyberpunk-Blender-add-on
```

To add only the eyes section to a catalogue prepared earlier (the intake's `raw/eyes-face.glb` or `raw/face-ui_closeup_shot_eyes.glb` already exported), run `python projects/xf-studio/authoring/tools/prepare_body_idles.py --eyes-section-only`.

**In the Studio**, the Motion panel's **Body** field is Still or one of these idles (`motion.setIdleClip`). The clips share the body and face rigs' joint names, so switching only swaps the clips on the same rigs (`IdleAnimation.setClips`), with the phase carried over. An older preparation without a catalogue shows the close-up alone. The creator's idles stand V on the creator puppet's lifted feet (`puppet: "creator"` in the character request); the inventory's on her own ([§4](../../knowledge/body-animation.md#4-feet-states-and-the-idles)).

## Browser composition and verification

The preview head's bones have world-oriented bindings rather than the decoded clips' hierarchy. For each target, apply its facial world delta first, then the nearest body-ancestor world delta, to its saved world bind transform. Convert the result into its actual target-parent space. This avoids replacing attachment transforms or applying parent movement twice. The two clips retain separate loop clocks.

The original eyeballs were unskinned. The preview now gives each disconnected eye one influence at the corresponding `l_J_eye_JNT` / `r_J_eye_JNT` pivot. A triangle-crossing check rejects geometry that cannot be split into the two rigid attachment groups. Disabling idle restores the exact captured local transforms, resets the clock, and enables the Blink controls again. Those play the game's own blink, solved with the same pipeline from `generic_facial_additives.anims` ([the game's blink](game-blink.md)); the idle's face clip blinks by itself, so the two never run together.

From `projects/xf-studio/authoring`, run `bun tools/verify_idle.ts`, `bun test`, `bun run check`, and `bun run build`. [Offline report](../../projects/xf-studio/authoring/evidence/idle-offline-check.json) verifies movement in gaze, jaw, lip and eyelid controls over the facial loop, finite skinned head/plate/brow/lash positions, shared bone transforms agreeing within about 1e-7, and zero restore error. The local asset check covers 385 existing head/detail bones; the browser additionally has two new eyeball joints, giving 387 mappings with zero unmapped.

Browser verification in the isolated `?verify=1` page: actual moving head/facial preview rendered; eyes stayed attached; makeup guides followed the posed surface; toggle disabled the Blink controls, then restored them and the editing pose; recipe comparison was unchanged and console had no warnings/errors. The main working draft/tab was not edited. No game launch was required.

## Remaining fidelity questions

- The creator's face graph and its selection rules are now traced offline ([facial expressions §5](../../knowledge/facial-expressions.md#5-the-character-creator-idle)): `ui_closeup_shot` is the looping close-up face clip, and section one-shots play when a creator section opens. The body graph's selection is traced too ([V's body in motion §2](../../knowledge/body-animation.md#2-the-preview-idles)); runtime confirmation remains open. The vanilla `face_rig` components reference the male player facial setup rather than the female basehead setup this bake uses; which one the engine solves with is untested.
- The external solver currently supplies rotation/translation; scale arrays and wrinkle shading are not reproduced. Teeth/tongue rendering and final skin/eye materials remain incomplete.
- The two clips are looped independently in the studio. A boundary inspection found small nonzero endpoint differences (largest face rotation boundary about 0.0078 rad at the eyes); exact game blending may hide these. No artificial boundary correction has been introduced.
- Check all supported face shapes and modded rigs. Preserving customization morphs does not prove every closed-eyelid contact or posed surface intersection. Eye-shape morph targets carry their own joint binds; the blink re-seats the rig on them, the idle does not yet ([facial animation §4](../../knowledge/facial-animation.md#4-eye-shapes-move-the-joints-too)).
- The female face-rig entity names the male player facial setup; the bake uses the female head's own. Which one the engine uses is untested ([facial animation §3](../../knowledge/facial-animation.md#3-which-facial-setup-v-uses)).
- SIMD animation re-import does not preserve original compression in the current WolvenKit export path. Future expression authoring needs separate import/export and game registration validation.

Community contribution: [Cyberpunk Blender Add-on / IO Suite and WolvenKit credits](../../docs/community-credits.md). User-oriented explanation: [idle guide](../../docs/idle-animation-guide.md).
