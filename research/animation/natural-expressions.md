# Natural expressions: FACS on V's face rig

**Status: R&D, 27 September 2026 ([experiment 026](../../experiments/026-natural-expressions/README.md); the cheek range study of §9 is its follow-up).** Nothing here has been seen in the game. Every render is the Studio's solved preview of the game's facial rig on the female head's own facial setup, which is not proven to be the setup the engine uses for V ([facial expressions, open question 1](../../knowledge/facial-expressions.md#open-questions)). The wrinkle outputs are not rendered.

Evidence grades follow the [knowledge rules](../../knowledge/README.md), plus two used here: **[observed]** seen in the Studio's live preview while driving the control; **[literature]** a published finding, cited, not re-tested. **[offline]** marks numbers measured here with the pinned solver and the face skeleton's forward kinematics.

This note answers one question from the maintainer: vanilla photo-mode faces look fake (the smiles move only the lower face; the rest are half-baked and overdone). What does open facial-expression knowledge say, how does it map onto V's 141 main-pose controls, and can five sample emotions look natural? A second part tests whether MediaPipe blendshapes from a photo or webcam can drive V's face, and sketches the "Face capture" feature that would follow.

## 1. Summary

- **Why vanilla looks fake** (§5). The smiles leave the eyes almost open: `facial_happy` narrows the eye opening to 85 % and lifts the lower lid 0.8 mm, while the mouth corners rise 5.5 to 8.2 mm. Our warm smile has about the same mouth (6 mm) with the eyes at 62 to 65 % and the lower lid up 2.4 mm, which is what the Duchenne marker (AU6) looks like. The other vanilla faces drive many controls near their limits at once (`facial_furious` has 10 controls at 0.7 or more, `facial_whistling` 19), mix action units that contradict each other (surprise with lip purse, funnel and cheek suck; disgust with an open jaw), and lean on controls that move nothing in a still pose (neck correctives, `lips_tighten_*`) [offline].
- **The mapping** (§3). Most FACS action units have a clear counterpart among V's controls. Several control names describe their motion poorly, and seven controls move no joint on their own; four of those only modify a partner control, and three move nothing in any combination. The ten neck and head turn and tilt controls deform the neck and jaw-line skin but never turn or tilt the head, so they are correctives for body-driven head motion and don't belong in a still expression [offline] [observed].
- **Five samples** (§4), committed under [`data/expression-samples/`](../../projects/xf-studio/authoring/data/expression-samples/) in the editor's preset format: a warm smile, confusion, disgust, mild surprise, and thinking. Each is an FACS recipe at low to moderate intensity, with the upper face involved and slight asymmetry (strong asymmetry only where the expression is naturally one-sided). No control goes above 0.9, and only the smile's cheek raise goes above 0.6.
- **Cheek range** (§9). The rig can lift the malar cheek 9 to 10 mm, more than a broad real smile, but only by stacking the sneer and nasolabial deepener on the cheek raiser: AU6 alone lifts it 2.6 mm and mostly pushes it forward. `facial_happy` lifts it 3.4 mm under a mouth that, on a real face, comes with 4.4 to 5.6 mm (Fishman et al. 2022). The stiffness is vanilla under-driving AU6 plus the preview's missing wrinkles: the game has crow's-feet, nasolabial and nose wrinkle regions (`defaultfaceregions.regionset`) driven by the same controls, and no region for the lower-lid bulge. A cheek-lift recipe raises the warm smile's cheek rise by 29 % [offline] [literature] [resource].
- **Symmetry and gaze** (§10). The rig's gaze is anatomical (in = toward the nose on each eye), so a symmetric edit maps in on one eye to out on the other; skin mirrors; lateral controls have no counterpart. 22 opposing pairs, confirmed by solving, become two-way controls (gaze per eye, jaw, mouth shift, nostrils, neck, tongue); antagonist skin muscles stay separate [offline].
- **MediaPipe** (§6) is feasible and fast. Detection takes 7 to 12 ms a frame on the GPU and the warm solver's round trip 6 to 8 ms, so the estimated face-to-V latency is about 32 ms plus the camera's own delay. On V's own renders it recovers gaze, blinks, brow raises and smiles well (cosine 0.82 to 0.97 against the true vector), but it misses brow lowering, the nose wrinkle, the upper-lip raise and one-sided mouth movements (0.3 to 0.6). It is a good way to rough in a face, not a faithful copy. The web library uploads usage metrics to Google every minute; the prototype's Content Security Policy blocks that, and no request left the machine in the test.

## 2. Sources and licences

| Source | What we took | Licence or terms | How used |
|---|---|---|---|
| Facial Action Coding System: Ekman and Friesen (1978); Ekman, Friesen and Hager, *FACS Manual* (2002) | Action-unit definitions and the A–E intensity scale, as published descriptive knowledge | The manual is copyrighted; AU numbers and short descriptions are widely published | Cited; no manual text reproduced [literature] |
| EMFACS emotion prototypes (Ekman and Friesen), as reproduced across the FACS literature | Happiness 6+12; sadness 1+4+15; surprise 1+2+5B+26; fear 1+2+4+5+7+20+26; anger 4+5+7+23; disgust 9+15+16; contempt R12A+R14A | Published findings | Cited; starting points for §4 [literature] |
| Duchenne de Boulogne, *Mécanisme de la physionomie humaine* (1862); Ekman, Davidson and Friesen, "The Duchenne smile" (1990) | Felt smiles recruit the orbicularis oculi (AU6) with the zygomatic (AU12) | Published findings | Cited [literature] |
| Ekman, Hager and Friesen, ["The symmetry of emotional and deliberate facial actions"](https://pubmed.ncbi.nlm.nih.gov/7220762/) (1981) | Asymmetric smiles were more frequent in deliberate imitations than in spontaneous expressions | Published findings | Cited: keep spontaneous faces nearly symmetric [literature] |
| Rozin and Cohen, ["High frequency of facial expressions corresponding to confusion, concentration, and worry"](https://pubmed.ncbi.nlm.nih.gov/12899317/) (2003) | Confusion was the commonest reading of asymmetric expressions; narrowed (knitted) brows | Published findings | Cited [literature] |
| Glenberg, Schroeder and Robertson, ["Averting the gaze disengages the environment and facilitates remembering"](https://link.springer.com/article/10.3758/BF03211385) (1998) | People avert their gaze when thinking about moderately difficult questions | Published findings | Cited [literature] |
| Apple ARKit [`ARFaceAnchor.BlendShapeLocation`](https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation) | The 52 blendshape names and what each describes | Apple documentation (copyright Apple) | Names and meanings only |
| Google [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker): `@mediapipe/tasks-vision` 1.0.1 and `face_landmarker.task` (float16, dated 3 May 2023) | 52 ARKit-named blendshape scores from a face image, in the browser (WASM and WebGL) | Apache-2.0 (package metadata; the FaceMesh V2 and Blendshape V2 model cards say "Licensed under Apache License, Version 2.0") | Prototype only, run locally from `D:/Dev/tools/`; not committed or bundled |
| [ICT-FaceKit](https://github.com/ICT-VGL/ICT-FaceKit) (USC Institute for Creative Technologies) | Surveyed: an open face model with ARKit-style, left/right-split expression shapes | MIT (copyright 2020 USC ICT); the full ICT Face Model is under a separate licence | Not used |
| Casiez, Roussel and Vogel, "1€ Filter" (CHI 2012) | The adaptive low-pass filter used to smooth blendshapes | Published algorithm | Reimplemented in the prototype |
| Duchenne's photographs, Figures 7, 32, 45, 51 and 54 (Cleveland Museum of Art 2018.7–2018.11, via Wikimedia Commons) | Real-face test inputs for MediaPipe | CC0 | Local test input only, never committed |
| Fishman, Kiss, Zuker, Fialkov and Whyne, ["Measuring 3D facial displacement of increasing smile expressions"](https://doi.org/10.1016/j.bjps.2022.08.024) (*JPRAS*, 2022), on the Binghamton University 3D Facial Expression database | Cheek and mouth-corner displacement at four smile intensities (abstract only) | Published findings | Cited in §9.2 [literature] |
| DISFA, BP4D/BP4D+, CK+, AffectNet, FLAME, EMOCA | Nothing | Research-only or non-commercial licence agreements | Not downloaded or used |

## 3. FACS action units on V's controls

### 3.1 How the controls were read

[`control-atlas.ts`](../../experiments/026-natural-expressions/control-atlas.ts) solves each of the 141 main-pose controls alone at weights 0.5 and 1 through the Studio's warm solver, poses the face skeleton, and reports which skin joints move, how far and in which direction, in the face's own frame (left is V's left) [offline]. Contact sheets of single controls at 0.6 to 1 in the live preview confirmed the ambiguous ones [observed]. The raw atlas is game-derived and stays in the experiment's ignored `generated/` folder; the facts below are summaries.

General behaviour [offline]:

- **Nearly linear.** For most controls half the weight gives exactly half the motion. The exceptions bend by 10 to 22 %: `eye_[lr]_oculi_squint_outer_lower`, `lips_[lr]_funnel`, `lips_[lr]_purse`, `lips_suck_*`, `jaw_mid_open`, the neck turns and the tongue.
- **Additive where tested.** A smile corner (`lips_l_corner_up` 0.5) plus a cheek raise (`eye_l_oculi_squint_outer_lower` 0.6) solves to exactly the sum of the two (largest difference 0.00 mm). Correctives exist in the setup, so other pairs may not add up.
- **Ranges differ enormously.** At weight 1, `lips_[lr]_corner_up` moves the mouth corner 21 mm (12 mm out, 9 mm up, 15 mm back) and `lips_[lr]_purse` pushes the lips 17 mm forward, while `eye_[lr]_oculi_squint_inner` moves the lower lid 1.7 mm and `lips_[lr]_corner_sharp_up` lifts the corner 2.6 mm. A weight says nothing about visible size until it is multiplied by the control's range.

### 3.2 Mapping table

`S` is `l` or `r` (V's left or right). Intensities are the weights that read as FACS intensity C (marked) on V; A ≈ a fifth to a quarter of that, E ≈ the rig's full range.

| AU | FACS name | V's controls | Measured motion at weight 1 | Grade |
|---|---|---|---|---|
| 1 | Inner brow raiser | `eye_S_brows_raise_in` (C ≈ 0.45) | Inner brow and glabella up 5.6 mm | [observed] |
| 2 | Outer brow raiser | `eye_S_brows_raise_out` (C ≈ 0.45) | Outer brow and upper lid up 5 to 5.5 mm | [observed] |
| 4 | Brow lowerer | `eye_S_brows_lower` + `eye_S_brows_lateral` (C ≈ 0.4 each) | Lower: brow down 4.2 mm. Lateral: brow 6.8 mm **toward the nose** and 3 mm forward (the knit) | [observed] |
| 5 | Upper lid raiser | `eye_S_widen` (C ≈ 0.35) | Upper lid up 2.8 mm | [observed] |
| 6 | Cheek raiser | `eye_S_oculi_squint_outer_lower` (C ≈ 0.6; D 0.9) + `eye_S_oculi_squint_outer_upper` (0.4 of it) | Outer-lower: cheek up 1.8 and forward 3.7 mm, lower lid up 3.2 mm. Outer-upper: outer brow and upper lid down 3.6 to 4.6 mm | [observed] |
| 7 | Lid tightener | `eye_S_oculi_squint_inner` (C ≈ 0.4) | Lower lid up and in 1.7 mm | [observed] |
| 9 | Nose wrinkler | `nose_S_snear` (C ≈ 0.5) | Nasolabial cheek up 5.1, forward 4.1 mm; nose side up 5.4 mm; the brow drops 1.9 mm on the same side | [observed] |
| 10 | Upper lip raiser | `lips_S_upper_raise` (C ≈ 0.35); `lips_S_pull` for the inner part | Upper-raise: lip up 7.2 and out 6.3 mm. Pull: the upper lip nearer the middle up 5.2 mm, showing teeth | [observed] |
| 11 | Nasolabial deepener | `lips_S_nasolabialDeepener` (C ≈ 0.35) | Cheek beside the fold up 4.6, out 3.9, back 3.7 mm | [offline] |
| 12 | Lip corner puller | `lips_S_corner_up` (C ≈ 0.5) | Corner out 12, up 9, back 15 mm | [observed] |
| 13 | Sharp lip puller | `lips_S_corner_sharp_up` (C ≈ 0.5) | Corner straight up 2.6 mm | [observed] |
| 14 | Dimpler | `lips_S_corner_wide` (C ≈ 0.3) | Corner back 4.3, out 2.3 mm | [observed] |
| 15 | Lip corner depressor | `lips_S_corner_dn` (C ≈ 0.3) | Corner down 3 to 3.6 mm and back | [observed] |
| 16 | Lower lip depressor | `lips_S_lower_raise` (C ≈ 0.4), `lips_apart_dn` | Lower-raise: that side of the lower lip down 2.8, out 4.3, back 3.9 mm, parting from the upper lip. Apart-down: lower lip down 2.7 mm | [observed] |
| 17 | Chin raiser | `lips_chin_raise` (C ≈ 0.3) | Chin up 2.8, forward 1.3 mm | [observed] |
| 18 | Lip pucker | `lips_S_purse` | Lips forward 14 to 17 mm, toward the middle | [offline] |
| 20 | Lip stretcher | `lips_S_corner_stretch` (C ≈ 0.3), `lips_S_stretch` | Corner out 6 to 12 mm, back, slightly down | [observed] |
| 22 | Lip funneler | `lips_S_funnel` | Lips forward 13 mm, rounded | [offline] |
| 23 | Lip tightener | `lips_tighten_up`, `lips_tighten_dn` | **No joint moves** (alone, or on open lips, a smile or a pucker) | [offline]; no visible AU23 |
| 24 | Lip pressor | `lips_together_up`, `lips_together_dn` | Nothing on closed lips; with the jaw open 0.3 they bring the lips together (lower lip up 5.4, upper down 2.3 mm): a lip seal, ARKit's `mouthClose` | [offline] |
| 25 | Lips part | `lips_apart_up` + `lips_apart_dn` | Each lip 2.7 mm off the other | [observed] |
| 26 / 27 | Jaw drop / mouth stretch | `jaw_mid_open` (26 ≈ 0.1 to 0.2; 27 ≈ 0.8+) | Chin down 24, back 19 mm at 1 | [observed] |
| 28 | Lip suck | `lips_suck_up`, `lips_suck_dn` | Lip rolled in 7.9 / 9.2 mm | [offline] |
| 29 | Jaw thrust | `jaw_mid_shift_fwd` (`jaw_mid_shift_back` for the reverse) | 8.8 / 4.3 mm | [offline] |
| 30 | Jaw sideways | `jaw_mid_shift_l`, `jaw_mid_shift_r` | 10.7 mm to that side | [offline] |
| 31 | Jaw clencher | `jaw_mid_clench` | **No joint moves** | [offline] |
| 33–35 | Cheek blow, puff, suck | `cheek_S_puff`, `cheek_S_suck` | Cheek out 5.9 mm; in 2.3 mm | [offline] |
| 38 / 39 | Nostril dilator / compressor | `nose_S_breathe_in` / `nose_S_breathe_out`, `nose_S_compress` | Breathe-in moves the nostril 1.4 mm **outward** (a flare); breathe-out and compress move it inward | [offline] |
| 41–46 | Lid droop, slit, closed, blink, wink | `eye_S_blink` (droop ≈ 0.1 to 0.2) | Upper lid down 7.9 mm at 1 | [observed] |
| 51–56 | Head turn, up/down, tilt | none | `neck_*`, `head_neck_*` move neck and jaw-line skin up to 24 mm but leave the head, nose and brow where they are | [offline] [observed] |
| 61–64 | Eyes left, right, up, down | `eye_S_dir_in/out/up/dn` (left: `eye_l_dir_out` + `eye_r_dir_in`) | Pupil about 8 mm sideways, 4.5 up, 6 down at 1; the upper lid follows a downward look | [observed] |

Other findings:

- **Controls that move nothing alone** [offline]: `lips_tighten_up`, `lips_tighten_dn`, `jaw_mid_clench`, `lips_corner_sticky`, `eye_[lr]_pupil_narrow`, `neck_throat_adamsApple_up`, and `jaw_mid_close`, `lips_together_*` (which act only with an open jaw). Solved on top of each other control at 0.5, four of the first seven turn out to be **modifiers**: `lips_tighten_up`/`dn` change the same lip's seal or puff (2 mm), `jaw_mid_clench` changes `jaw_mid_close` (0.3 mm) and `neck_throat_adamsApple_up` works against `…adamsApple_dn` (1 mm). Only **`lips_corner_sticky` and both `eye_[lr]_pupil_narrow` move nothing in any combination**, in both the female and the male player setup, and none of the seven feeds a wrinkle output. The Expression drawer finds these with the solver when it starts (every control alone and on top of all the others at 0.25) and doesn't offer them.
- **Labels the drawer corrected** (the control names mislead): `nose_[lr]_breathe_in` is "Nostril flare (breathe in)" and `…breathe_out` the narrowing; `lips_[lr]_lower_raise` "Lower lip down"; `lips_[lr]_pull` "Upper lip raise, inner"; `lips_[lr]_corner_wide` "Mouth corner back (dimple)"; `lips_together_*` "lip seal", with a note that closed lips don't change; the AU6 control reads "Cheek raise (squint, lower outer)". The ten neck and head turn and tilt correctives moved to the folded Advanced group, each noting that the head itself doesn't move [offline] [observed].
- `sculp_mid_slide` lifts the glabella 4.3 mm and draws it back 3.1 mm; `face_gravity_*` shift the cheek and mouth mass 3 to 5 mm; neither has an FACS counterpart [offline].

### 3.3 ARKit and MediaPipe blendshapes to V

The prototype's [`mapping.js`](../../experiments/026-natural-expressions/face-capture/mapping.js) holds the table; it follows §3.2, with gains from the round trip in §6.3.

| Blendshape (per side where named) | V's controls |
|---|---|
| `browDown` | `eye_S_brows_lower` 0.8, `eye_S_brows_lateral` 0.6 |
| `browInnerUp` | both `eye_S_brows_raise_in` 1.2 |
| `browOuterUp` | `eye_S_brows_raise_out` 1 |
| `cheekPuff` | both `cheek_S_puff` 1 |
| `cheekSquint` | `eye_S_oculi_squint_outer_lower` 1, `…outer_upper` 0.35 |
| `eyeBlink` | `eye_S_blink` 1.8 (a closed V eye scores about 0.5) |
| `eyeLook{Down,In,Out,Up}` | `eye_S_dir_{dn,in,out,up}` 1 |
| `eyeSquint` | split by smile: with the mouth smiling it goes to AU6 (`…squint_outer_lower`, `…outer_upper`), otherwise to AU7 (`…squint_inner`) |
| `eyeWide` | `eye_S_widen` 1.5 |
| `jawForward`, `jawLeft`, `jawRight`, `jawOpen` | `jaw_mid_shift_fwd`, `…_l`, `…_r` 1; `jaw_mid_open` 0.8 |
| `mouthClose` | `lips_together_up`, `lips_together_dn` 1 |
| `mouthDimple`, `mouthFrown` | `lips_S_corner_wide`, `lips_S_corner_dn` 1 |
| `mouthFunnel`, `mouthPucker` | both `lips_S_funnel`, both `lips_S_purse` 1 |
| `mouthLeft`, `mouthRight` | `lips_mid_shift_l`, `…_r` 1 |
| `mouthLowerDown` | `lips_apart_dn` 0.5, `lips_S_lower_raise` 0.5 |
| `mouthPress` | `lips_tighten_*` 0.5 (no bone effect), `lips_suck_*` 0.1 |
| `mouthRollLower`, `mouthRollUpper` | `lips_suck_dn`, `lips_suck_up` 1 |
| `mouthShrugLower`, `mouthShrugUpper` | `lips_chin_raise` 1; `lips_mid_shift_up` 0.5 |
| `mouthSmile` | `lips_S_corner_up` 0.9, `…corner_sharp_up` 0.5, `lips_S_nasolabialDeepener` 0.4, `lips_apart_up` 0.3 |
| `mouthStretch` | `lips_S_corner_stretch` 0.8, `lips_S_stretch` 0.3 |
| `mouthUpperUp` | `lips_S_upper_raise` 1, `lips_apart_up` 0.3 |
| `noseSneer` | `nose_S_snear` 1 |
| `tongueOut` | not mapped |

**Sides.** On an unmirrored frame (what `getUserMedia` delivers; only the on-screen preview is mirrored), MediaPipe's *Left* is the subject's own left, as in ARKit. V looking to her left scored `eyeLookOutLeft` and `eyeLookInRight` 0.93, her left wink `eyeBlinkLeft` 0.51, and her left brow `browOuterUpLeft` 0.62 [offline]. No swap is needed.

## 4. The five expressions

Rendered on the maintainer's V in an isolated `?verify=1` workspace, front and three-quarter, with the closest vanilla face beside each (§7). The values are in the sample files; the tables give the recipe.

**Principles.** From the literature: felt emotion involves the upper face (AU6 in smiles, brows in confusion, surprise and disgust), and spontaneous expressions are nearly symmetric, since strong asymmetry marks deliberate expressions (Ekman et al. 1981) [literature]. Our own design choices: stay at FACS A to C (about a quarter to half of each control's range); combine the prototype's AUs and nothing that competes; make the left side a few per cent stronger on every pair; allow real one-sidedness only where the expression is one-sided by nature (a questioning brow, a sneer, a mouth pushed aside); and use no neck or head controls.

### 4.1 Warm smile: [`warm-smile.json`](../../projects/xf-studio/authoring/data/expression-samples/warm-smile.json)

| AU | Controls (left / right) |
|---|---|
| 6 cheek raiser (D) | squint outer-lower 0.9 / 0.85, outer-upper 0.35 / 0.3, blink 0.08, brows lower 0.06 |
| 7 lid tightener (A) | squint inner 0.3 / 0.26 |
| 12 lip corner puller (C) | corner up 0.6 / 0.54 |
| 13 sharp lip puller (B) | corner sharp up 0.36 / 0.3 |
| 14 dimpler (A) | corner wide 0.1 / 0.08 |
| 11 nasolabial deepener (B) | 0.35 / 0.3 |
| 10 upper lip raiser (A) | upper raise 0.15 / 0.12 |
| 25 + 26 (B, A) | apart up 0.5, apart down 0.2, jaw open 0.07 |

**Why it reads as genuine:** it is a Duchenne smile. The cheeks lift, the lower lids rise 2.4 mm and the eyes close to about 63 % of their opening, so the smile reaches the eyes. The mouth is moderate, with the upper teeth just showing. The two sides differ by 5 to 10 %.

### 4.2 Confusion: [`confusion.json`](../../projects/xf-studio/authoring/data/expression-samples/confusion.json)

| AU | Controls |
|---|---|
| 4 brow lowerer (C left, A right) | brows lower 0.55 / 0.1, brows lateral 0.5 / 0.3 |
| 1 + 2, right only (C) | outer raise 0.55, inner raise 0.3 |
| 7 (B left) | squint inner 0.4 / 0.15 |
| 5, right (A) | widen 0.1 |
| 14, one-sided (B) | right corner wide 0.3, mouth shift right 0.3 |
| 15, right (A) | corner down 0.1 |
| 17 (B) | chin raise 0.25 |

**Why:** confusion lives in the brows. A knitted, lowered brow (AU4) on one side and a raised one on the other makes the face ask a question. Rozin and Cohen found confusion was the commonest reading of asymmetric expressions [literature]. The closed mouth pushed to one side with a small chin raise keeps it puzzled rather than angry. The vanilla faces with knitted brows (`facial_furious`, `facial_pissed`) lower both brows at 0.8 to 1.

### 4.3 Disgust: [`disgust.json`](../../projects/xf-studio/authoring/data/expression-samples/disgust.json)

| AU | Controls |
|---|---|
| 9 nose wrinkler (C / B) | snear 0.55 / 0.35 |
| 10 upper lip raiser (B / A) | upper raise 0.4 / 0.22, left pull 0.1 |
| 4 (B) | brows lower 0.3 / 0.22, lateral 0.25 / 0.2 |
| 6 + 7 (B) | squint inner 0.4 / 0.3, outer-lower 0.3 / 0.18 |
| 15 (B) | corner down 0.25 / 0.3 |
| 17 (B) | chin raise 0.25 |
| 29 reversed (A) | jaw back 0.1 |

**Why:** the core of disgust is AU9 with AU10, the wrinkled nose and raised upper lip, here stronger on one side. The eyes narrow from below and the brows lower, so the upper face agrees with the mouth. The jaw stays shut. `facial_disgusted` opens it to 0.55 while pressing the lower lip up, which reads as an open-mouthed grimace or speech.

### 4.4 Mild surprise: [`mild-surprise.json`](../../projects/xf-studio/authoring/data/expression-samples/mild-surprise.json)

| AU | Controls |
|---|---|
| 1 (C) | inner raise 0.45 / 0.4 |
| 2 (B) | outer raise 0.4 / 0.45 |
| 5 (B) | widen 0.35 / 0.32 |
| 25 + 26 (B) | apart up 0.12, apart down 0.22, jaw open 0.14 |

**Why:** it is the surprise prototype (1 + 2 + 5 + 26) at low intensity and nothing else: both brows lift evenly, the eyes open to about 110 %, and the jaw drops a few millimetres. `facial_surprised` opens one eye to 125 % and the other to 117 %, barely drops the jaw (0.13), and adds cheek suck, lip purse and funnel, throat open, a jaw shift and cutscene lip controls.

### 4.5 Thinking deeply: [`thinking.json`](../../projects/xf-studio/authoring/data/expression-samples/thinking.json)

| AU | Controls |
|---|---|
| 4 (B) | brows lower 0.3 / 0.38, lateral 0.4 / 0.4 |
| 7 (B) | squint inner 0.3 |
| 61 + 63, eyes left and up (C) | left eye out 0.5, right eye in 0.5, both up 0.25 |
| 43 slight | blink 0.05 |
| 14, one-sided (B) | mouth shift left 0.4, left corner wide 0.3 |
| 17 + 28 (B, A) | chin raise 0.3, lower lip suck 0.1 |

**Why:** a concentration furrow (AU4 with AU7) and a glance up and away from the listener, which people do when they think about something difficult (Glenberg et al. 1998) [literature]. The mouth pushed sideways and pressed by the chin reads as private and unposed. In photo mode the camera look-at must be off, or the eyes will follow the camera. There is no vanilla thinking face; `facial_bored` is the nearest inward one.

## 5. Why vanilla looks fake, in numbers

[`region-balance.ts`](../../experiments/026-natural-expressions/region-balance.ts) solves each face and measures the eye opening (upper to lower lid at mid-lid), the lower lid's rise, the mouth corner's lift, how many controls sit at 0.7 or more, and the peak skin motion of the upper, middle and lower face [offline].

| Face | Controls (≥ 0.7) | Eye opening L / R | Lower lid rise | Corner lift L / R |
|---|---|---|---|---|
| `facial_happy` | 32 (2) | 85 / 85 % | 0.8 mm | 5.5 / 8.2 mm |
| `facial_charming` | 22 (1) | 100 / 94 % | 0.3 to 0.4 mm | 2.8 / 6.5 mm |
| `facial_pleased` | 27 (2) | 89 / 94 % | 0.4 to 0.7 mm | 4.9 / 2.2 mm |
| **XF warm smile** | 23 (2) | **62 / 65 %** | **2.4 mm** | 6.0 / 5.9 mm |
| `facial_surprised` | 32 (1) | 125 / 117 % | 0 | 0.4 / −0.3 mm |
| **XF mild surprise** | 9 (0) | 111 / 110 % | 0 | −1.4 / −1.3 mm |
| `facial_disgusted` | 34 (1) | 79 / 89 % | 0.8 to 1.5 mm | −0.8 / −3.2 mm |
| **XF disgust** | 17 (0) | 87 / 92 % | 0.6 to 0.9 mm | −0.3 / −0.4 mm |
| `facial_furious` | 32 (10) | 98 / 99 % | 1.1 to 1.2 mm | −2.4 / 0.3 mm |
| `facial_whistling` | 45 (19) | 79 / 76 % | −1 mm | −0.7 / −4.4 mm |

Reading the numbers, with the render comparison:

1. **The smiles don't reach the eyes.** All three vanilla smiles keep the eyes 85 to 100 % open. Their AU6 control is at 0.12 to 0.33 while the mouth controls sit at 0.3 to 0.86 of far larger ranges, and in `facial_happy` part of the upper-face motion is the outer brow coming down (`…squint_outer_upper` 0.34), not the cheek going up. Our smile has about the same mouth but narrows the eyes by a third. That is the Duchenne difference [offline] [literature].
2. **Overdriven.** `facial_furious` drives 10 controls at 0.7 or more at once, `facial_whistling` 19, `facial_pissed` 6 and `facial_scared` 5 (neck flex 0.98). Every sample here has none, except the smile's cheek raise [offline].
3. **Half-baked mixtures.** Surprise mixes seven action units that belong to other expressions. Disgust drops the jaw while pressing the lower lip, and its nose wrinkle is weak (0.45 / 0.22). Sadness (58 controls) leans on the cutscene sticky-lip controls [resource: the decoded vectors in the [expressions knowledge](../../knowledge/facial-expressions.md#what-a-vanilla-expression-is)].
4. **Controls that do nothing in a still face.** Several vanilla faces set `lips_tighten_*` or neck and head correctives (`facial_scared`'s neck controls at 0.56 to 0.98, `facial_furious`'s neck stretch). In this setup they move no bone, or they deform the neck without moving the head [offline].
5. **Lopsided smiles.** `facial_charming` lifts one corner 2.3 times the other and `facial_pleased` the reverse. Strong asymmetry is typical of deliberate smiles, so they read as smirks (Ekman et al. 1981) [literature].
6. **What the preview can't show.** The rig's 33 wrinkle outputs (crow's feet, the nose wrinkle, the forehead) are not rendered, and in real faces they carry much of AU6, AU9 and AU1+2. If the game renders them, vanilla faces may look better in game than in the preview, and so may ours [hypothesis].

## 6. MediaPipe: photo and webcam to V

### 6.1 The prototype

[`face-capture/`](../../experiments/026-natural-expressions/face-capture/) is a scratch page on its own port. A small Bun server serves the page, MediaPipe's official build and model from `D:/Dev/tools`, and proxies everything else to an isolated Studio server, so the Studio (`/?verify=1`, in an iframe) shares the page's origin. The pipeline per frame:

1. **Camera or test file.** The camera is used only after "Turn camera on". A "Camera on" badge shows whenever the stream is live and never shifts the layout, and "Turn camera off" stops every track.
2. **MediaPipe Face Landmarker**, VIDEO mode, GPU delegate with CPU fallback, one face, blendshapes on.
3. **1€ smoothing** per channel, then **neutral correction**: "Set my neutral face" subtracts the resting scores and re-stretches the remaining range.
4. **Mapping** (§3.3), with overall and upper-face strength sliders and a side swap.
5. **V's face**: the vector goes to the Studio through the expressions feature's own `expression.startFrom` action, at most every 40 ms and only when it changed; the live solver poses V.
6. **Capture this expression** posts the current vector as an expression preset to the verification library (`/api/verification/part-presets`). No picture is kept.

**Privacy.** Frames never leave the page: nothing is uploaded or stored unless the user captures, and a capture holds numbers only. The library itself is not silent. `@mediapipe/tasks-vision` 1.0.1 creates a metrics logger for every task that POSTs protobuf usage and performance data to `odml.pa.googleapis.com/v1/log` every 60 s [source: the bundle's code], which Google's [privacy notice](https://developers.google.com/edge/mediapipe/solutions/tasks#mediapipe_tasks_privacy_notice) describes as metrics about API performance and use, not input data. The notice makes the app responsible for consent, and the logger has no switch. The page's Content Security Policy (`connect-src 'self'`) blocks it. In the headless test the page made **no request off 127.0.0.1** [offline].

### 6.2 Speed

Headless Chrome with GPU (ANGLE D3D11) on the development PC, fake camera at 10 fps [offline]:

| Stage | Time |
|---|---|
| Face Landmarker, video frame 640 × 480 | 7 to 12 ms median, 11 to 24 ms 95th percentile (GPU) |
| Face Landmarker, still image | about 17 ms (V render), about 35 ms (1280 px photograph) |
| Smoothing, neutral correction and mapping | 0.1 ms |
| Studio solve round trip (page to posed head) | 6 to 8 ms median, 12 ms at most |
| **Estimated face to V** | **about 32 ms plus the camera's delay** (detection + mapping + solve + one 60 Hz frame) |

The fake camera capped the frame rate at 10 fps. A real camera at 30 fps would still leave most of each 33 ms frame free. Live-camera testing is the maintainer's: headless Chrome has no webcam.

### 6.3 Quality

**Round trip on V's own face.** V was rendered with a known vector, MediaPipe read the render, the mapping turned the scores back into a vector, and that was compared with the original (cosine similarity; 1 is perfect), after a neutral capture from V's rest render [offline]:

| Render | Cosine | What happened |
|---|---|---|
| Look left | 0.97 | Gaze is reliable (`eyeLookOutLeft` and `eyeLookInRight` 0.93) |
| XF warm smile | 0.96 | Smile and eye narrowing both recovered (after the smile-aware squint split) |
| Left brow raise | 0.87 | Outer raise found, inner raise under-read |
| `facial_happy`, `facial_charming` | 0.85, 0.83 | Smiles fine; the sharp corner and lip part missed |
| Left wink | 0.82 | A closed eye scores about 0.5, so blink is doubled |
| `facial_surprised`, XF mild surprise | 0.68, 0.44 | Brow raise found; `eyeWide` never fired on V |
| Thinking, `facial_pissed`, disgust, confusion | 0.59, 0.59, 0.41, 0.40 | Gaze found; **brow lowering, the nose wrinkle and the upper-lip raise scored about 0** |
| Left smirk, jaw left | 0.30, 0.00 | One-sided mouth corners and jaw shift not detected |

**Real faces.** On Duchenne's CC0 photographs MediaPipe fires strongly on exactly what it missed on V: Figure 32 (a natural laugh) scores `mouthSmile` 0.73 to 0.76, `eyeSquint` 0.49 to 0.67 and `browDown` 0.85 to 0.87 [offline]. Part of V's failure is therefore the synthetic domain: a smooth CG face with no wrinkles in the preview. Part is MediaPipe's own bias. On V's neutral face it reads `eyeSquint` 0.2 to 0.3, `browOuterUp` 0.2 to 0.3 and `mouthPucker` 0.2, so the neutral capture is required, not optional. The 1856 subject's resting brows also read as `browDown`.

**Verdict.** Feasible, fast and private once the metrics upload is blocked. It is good for roughing in gaze, blinks, brow raises, smiles and jaw opening, which is most of what makes a face feel alive, and it gives players a fun way in. It is not a faithful capture of subtle negative expressions or one-sided mouths, so the player finishes with the sliders (and later an AU layer, §8). Lip sync looks plausible (`jawOpen`, `mouthFunnel`, `mouthPucker`, `mouthClose` all map), but viseme quality is untested.

### 6.4 From prototype to a "Face capture" feature (proposal)

A capture **source** for the expressions feature, not a new feature. It follows the [architecture contract](../authoring/architecture-contract.md):

| Layer | Piece |
|---|---|
| Device adapter | `FaceCaptureDevice`: camera (`getUserMedia`) and MediaPipe in a worker (`VideoFrame` to an `OffscreenCanvas`), emitting blendshape frames with timestamps. It owns permission state and the metrics block (CSP on the localhost page; a request filter in the Electrobun webview). Frames never leave the worker. |
| Engine (pure) | `engines/facial-rig/retarget.ts`: the blendshape-to-control table as data, the smile-aware squint split, neutral correction, 1€ smoothing and gains. Tested against recorded blendshape fixtures, which are numbers, not faces. |
| Feature | New actions `expression.capture.start`, `…stop`, `…setNeutral` and `…snapshot`. A live session is one gesture transaction, so it adds no Undo steps; "Capture" commits one step ("Capture expression") and can save a preset. The catalogue and boundary tests grow with them. |
| Presentation | A "Face capture" section in the Expression drawer, built from the component library: a consent card (the plain-words camera explanation plus one primary button), the camera preview with a persistent, non-shifting "Camera on" badge, the shared slider with numeric entry for Strength, Upper face and Smoothing, a toggle for "Swap sides", and Capture. It is actionable only: no empty or informational panels. |
| Assets | `face_landmarker.task` (3.7 MB) and the WASM runtime (11.8 MB for the SIMD build) are downloaded on first use with consent, or bundled in the desktop app with the Apache-2.0 licence and notice. |
| Later: lip-sync testing | Record a take as blendshape frames over time (never video), retarget it to keyed control tracks, and play it on V through the animated-expression path. Audio alignment is its own design. |

Open decisions for the maintainer: bundle or download the model; whether the capture section should appear before phase 2's handles; and whether a take recorder belongs to the expression editor or the idle designer.

## 7. Renders

Private renders of the maintainer's V (game assets), kept in the worktree's ignored `projects/xf-studio/authoring/evidence/screenshots/natural-expressions/`:

- `final/<name>-front.png` and `final/<name>-tq.png` for `warm-smile`, `confusion`, `disgust`, `mild-surprise`, `thinking`, `rest` and the vanilla `facial_happy`, `facial_charming`, `facial_pleased`, `facial_disgusted`, `facial_surprised`, `facial_pissed` and `facial_bored`;
- `final/sheet-samples-front.png`, `final/sheet-samples-tq.png` (the five and rest), `final/compare-vanilla-front.png` and `final/compare-vanilla-tq.png` (each sample above its closest vanilla face);
- `probes/` single controls and the side probes (bald, front), with contact sheets `sheet-a.png` and `sheet-b.png`;
- `face-capture/camera-*.png` and `evaluation.json` (the prototype driving V from the fake camera).

## 8. Next steps

1. **An AU layer in the editor.** FACS-style sliders (about 30 AUs, per side where FACS has sides) as a view over the stored vector: each AU is a profile of control weights from §3.2, with intensity presets A to E. The part keeps storing controls, so preview and export are unchanged. AUs that share a control combine by clamped sum, the rig's own behaviour. Starting points: "Duchenne smile", "surprise", and the five samples as AU settings.
2. **Wrinkles in the preview** (§9.5), then the in-game close-up comparison. (The drawer labels, the Advanced group and the controls that move nothing are done.)
3. **In-game check** once export exists (phase 3): the warm smile against `facial_happy` in photo mode with look-at off, to see whether wrinkles render and whether the male player facial setup (R1) changes the look. Also check the thinking gaze with look-at off.
4. **Face capture**: a live-camera session with the maintainer (the prototype runs on a normal browser tab), then the feature in §6.4 if it feels right. Tune gains on real faces, not only V renders.
5. **Correctives and nonlinearity**: probe more AU pairs for non-additive correctives before an AU layer assumes they add up.

## 9. Cheek range: how far the upper cheek can move

The question: the cheeks look as if they can't move much ("over-injected with botox"). How much upper-cheek movement does the rig allow, how does that compare with real faces, and is the stiffness the rig's range, vanilla presets under-driving the cheek, or missing wrinkle shading?

**Method.** [`cheek-range.py`](../../experiments/026-natural-expressions/cheek-range.py) loads the face skeleton and facial setup and the pinned, unmodified solver directly (as the idle bake does), solves each cheek-related control at 0.25, 0.5, 0.75 and 1, combinations, the samples and five vanilla faces, poses the skeleton and measures the left side in the face's own frame. Regions are chosen by rest position, not by joint name, because the names mislead: several `jaw_nosabial` joints sit on the cheekbone and the `eye_check` rows run from the outer orbit down over it. The **malar cheek** (the "apple" over the cheekbone) is the cheek joints 7 to 47 mm below the eye centre; **rise** is the largest upward motion of any of them. It runs on the female head's own setup (the preview's) and on the male player setup that every vanilla player face rig references ([facial expressions §1](../../knowledge/facial-expressions.md#which-facial-setup-v-actually-uses)); the male setup's numbers are 5 to 15 % smaller and tell the same story [offline]. Skin follows joints through skin weights, so these are joint motions, a close proxy for the surface but not the surface itself.

### 9.1 What each control does to the cheek

At weight 1, left side, female setup [offline]:

| Control (AU) | Malar cheek: total / rise (mm) | Other regions (mm) | Notes |
|---|---|---|---|
| `eye_l_oculi_squint_outer_lower` (AU6) | 4.5 / 2.6 | lower lid 3.9 (rise 3.3), lateral orbit 2.7 | Rise is linear (0.65, 1.31, 1.96, 2.62 at the four weights); the total bends upward near 1. Mostly **forward**: its elevation is about 35°, where real cheeks rise at 51 to 59° (§9.2) |
| `nose_l_snear` (AU9) | 7.2 / **5.6** | nasolabial cheek 6.0, lower lid 2.0 | The strongest cheek raiser in the rig, but it also wrinkles the nose and lifts the lip |
| `lips_l_corner_up` (AU12) | 8.4 / 3.9 | mouth corner 21.5, lower mid-cheek 16.1 | Pulls the cheek out and back more than up |
| `lips_l_nasolabialDeepener` (AU11) | 4.9 / 2.8 | lower mid-cheek 7.1 | |
| `lips_l_upper_raise` (AU10) | 4.1 / 2.4 | lower mid-cheek 3.1 | |
| `lips_l_corner_sharp_up` (AU13), `eye_l_oculi_squint_inner` (AU7) | 1.2 / 1.0; 1.0 / 0.9 | | |
| `cheek_l_puff`, `face_gravity_*` | up to 2.8 / 0.8 at most | | Outward or sideways, not up |
| `eye_l_oculi_squint_outer_upper`, `sculp_mid_slide`, blink, widen | 0.6 or less / 0 | | No cheek lift |

**Combinations** [offline]:

- **Additive where they don't share correctives.** AU6 with AU12 at 1 solves to exactly the sum (8.6 mm, rise 4.2); AU6 with AU9 at 0.5 or AU11 at 0.5 too.
- **A corrective caps the full stack.** AU6, AU12, AU11 and AU9 all at 1 give 10.8 mm (rise 9.5) against 14.1 (rise 12.3) for the sum of the parts: a corrective takes back about 2.8 mm of rise (7 mm at one joint). Smaller correctives act on AU6 + AU7 + outer-upper (0.4 mm) and AU12 + AU13 (0.7 mm).
- **Weights clamp at 1.** AU6 at 2 solves exactly like AU6 at 1, so the ceiling of one control is its weight-1 pose.

So the rig *can* lift the malar cheek by 9 to 10 mm, but only by stacking the sneer, the nasolabial deepener and the smile on AU6; AU6 alone gives 2.6 mm of rise.

### 9.2 Real faces

Fishman, Kiss, Zuker, Fialkov and Whyne, ["Measuring 3D facial displacement of increasing smile expressions"](https://doi.org/10.1016/j.bjps.2022.08.024) (*JPRAS* 75(11), 2022), measured 100 adults of the Binghamton University 3D Facial Expression database at a neutral face and four smile intensities. From the abstract [literature]: the **maximum cheek displacement was 4.5, 5.7, 6.8 and 7.9 mm** for smile levels 1 to 4, moving outward and **upward at 51 to 59°**; the mouth corner moved 9.2, 11.4, 13.5 and 16.0 mm. The paper's exact cheek point was not read (the full text is paywalled), and its rise is our estimate from the stated angle: about 3.6 to 6.6 mm (total × sin 51–59°).

| Face | Mouth corner (mm) | Malar cheek total / rise (mm) | Real smile level with that mouth, and its cheek |
|---|---|---|---|
| `facial_happy` | 12.1 | 6.3 / **3.4** (mean rise 1.9) | Level 2 to 3: cheek 5.7 to 6.8, rise about 4.4 to 5.6 |
| XF warm smile | 13.4 | 7.8 / 4.3 (mean 3.0) | Level 3: cheek 6.8, rise about 5.3 to 5.8 |
| Warm smile, lifted cheeks (§9.4) | 13.5 | 8.3 / **5.5** (mean 3.7) | Level 3, on target |

The vanilla smile's cheek *total* is in range, but most of it is AU12 dragging the cheek outward and back; its **rise is about a third short** of a real smile with the same mouth [offline] [literature, our estimate].

### 9.3 Where the stiffness comes from

A mix, in this order for the preview:

1. **Vanilla presets under-drive AU6** [offline]. `facial_happy` sets the cheek raiser to 0.33 while its mouth controls sit at 0.5 to 0.86, and a third of its upper-face motion is the outer brow coming down (`…outer_upper` 0.34). The cheek rises like a level-1 smile under a level-2-to-3 mouth.
2. **Missing wrinkle shading** [resource] [hypothesis for the runtime link]. The game's skin shader bends the normal toward a stretch or squash wrinkle map inside UV rectangles, weighted by animation float tracks ([skin shader §5.6](../materials/shader-skin.md#56-the-wrinkle-driver-vertex-program)). The rectangles are in **`engine\materials\defaults\defaultfaceregions.regionset`** (the only `.regionset` in the base game): 33 regions whose names are exactly the facial setup's 33 wrinkle outputs (`eye_l_oculi_squint_outer_lowerWrnkl` …), each flagged stretch or squash, one to three rectangles each. Each wrinkle output is `1 − (1 − w)²` of one control, so it saturates early: `facial_happy` drives the crow's-feet regions (`…squint_outer_lower/upper`, squash, beside the eye) at 0.55 and the nasolabial fold (`lips_*_corner_up`, squash) at 0.76 to 0.82; the warm smile drives crow's feet at 0.98. The preview draws none of it, so a smiling V there has no crow's feet, no deepened fold and no nose lines. **No region covers the lower lid or the infraorbital bulge**, which is where a real AU6 bunches the skin, so even in game that part rests on geometry alone.
3. **The rig's range is not the limit for a natural smile, but AU6 alone is weak and forward-biased** [offline]. Reachable rise (9.5 mm) exceeds a broad real smile (about 6.6), yet a Duchenne lift needs AU6 plus a little AU9 and AU11, which vanilla faces don't combine.

Placing the 33 rectangles on the head's UV0 puts every region where its name says and left/right mirrored when the rectangle's Y/W bound U and X/Z bound V (crow's feet 52 mm either side of the midline at eye height, the nasolabial regions beside the mouth corners, the nose regions on the bridge); the other reading scatters them [offline, head mesh UVs]. The skin shader's listing names the axes the other way round, so a renderer must confirm the order against the vertex program before relying on it.

### 9.4 A better cheek lift

On top of the warm smile, per side (left / right), everything at 0.9 or below:

| AU | Control | Warm smile | Lifted cheeks |
|---|---|---|---|
| 6 | `eye_S_oculi_squint_outer_lower` | 0.9 / 0.85 | 0.9 / 0.88 |
| 9 | `nose_S_snear` | – | 0.25 / 0.2 |
| 11 | `lips_S_nasolabialDeepener` | 0.35 / 0.3 | 0.55 / 0.5 |
| 13 | `lips_S_corner_sharp_up` | 0.36 / 0.3 | 0.45 / 0.4 |

It raises the malar cheek's rise from 4.3 to 5.5 mm (+29 %; mean rise 3.0 to 3.7), the lower lid from 4.2 to 4.4 mm and the nasolabial cheek from 1.3 to 2.6 mm, with the mouth corner unchanged (13.4 to 13.5 mm) [offline]. A sneer of 0.3 gives 5.8 mm but starts to read as a nose wrinkle; 0.2 to 0.25 stays a smile. In the before and after renders the lifted cheek is fuller over the cheekbone and the fold beside the nose deeper, and neither shows a crease, which is the wrinkle gap of §9.3 [observed]. Renders (private, the default V in an isolated `?verify=1` workspace): `projects/xf-studio/authoring/evidence/screenshots/cheek-range/` (`facial_happy`, `warm-smile`, `warm-smile-lifted`, front and three-quarter, and `sheet-front.png`, `sheet-tq.png`).

### 9.5 Plan: wrinkles in the preview (scoped, not built)

Wrinkles are the largest missing visual cue in the preview, and everything they need is now located:

1. **Solver outputs.** `facial_solver_server.py` answers the 33 wrinkle outputs beside the joint deltas (the solver already computes them: `output_tracks` from the setup's wrinkle start); the host passes them with each solve.
2. **Regions.** The host reads `defaultfaceregions.regionset` through the resolver (a small CR2W: `regions[{name, isStretch, regionParts[{innerRegion, outerRegion}]}]`), matches regions to outputs by name, and sends them with the rig state; no region or rectangle is written into the Studio.
3. **Maps.** The head's resolved skin chain already names `Detailmap_Stretch`, `Detailmap_Squash`, `Bloodflow` and `BloodColor` ([saved-skin resource chain](../eye-artistry/saved-skin-resource-chain.md)); the character record exports them with the other skin textures.
4. **Shader.** `skin-material.ts` ports the vertex driver (per vertex: stretch and squash weights from the rectangles' trapezoid ramps times the outputs) and the pixel steps §5.1 step 2 (normal lerp) and §5.4 (blood flush, weight cubed). 33 regions of up to 3 rectangles fit in a uniform array; nothing changes at rest.
5. **Checks.** The UV axis order (§9.3) against the vertex listing; the warm smile and `facial_happy` close up with and without wrinkles; then an in-game photo-mode close-up of the same faces as the runtime comparison (whether the engine feeds these outputs to that shader for photo-mode faces is the [hypothesis](../../knowledge/facial-expressions.md#open-questions) the comparison settles).

## 10. Symmetry, opposing pairs and gaze

Two requests from using the drawer: a symmetric (mirror) editing mode where gaze doesn't go cross-eyed, and one control per movement that can go either way (an eye can't look in and out at once). Measured with the pinned solver on the female head's setup; the host repeats the check on whatever setup it solves with (`engines/facial-rig/relations.ts`) [offline].

**Gaze convention.** The rig's gaze is anatomical, per eye: `eye_l_dir_in` and `eye_r_dir_in` are exact mirror images (reflected motion matches at cosine 1.00), both turning the eye toward the nose. Both eyes at `…dir_in` 0.5 cross: the left pupil moves 4.3 mm toward V's right and the right pupil 4.3 mm toward her left. The left eye's `out` with the right eye's `in` (0.5 each) moves both pupils 4.2 to 4.3 mm toward V's left. So a symmetric edit must map **in on one eye to out on the other** for horizontal gaze, and copy vertical gaze straight [offline].

**One rule for symmetry.** Every control has a *counterpart*, what a linked edit also sets: the mirror image for skin (`eye_l_brows_lower` ↔ `eye_r_brows_lower`), the other eye's opposite direction for horizontal gaze (`eye_l_dir_in` ↔ `eye_r_dir_out`), the same direction for vertical gaze. Centre controls and lateral direction pairs (jaw, mouth shift, neck turn and tilt, face gravity, tongue) have none: a symmetric face can't lean to one side. Linking a pair (per pair, per group, or the whole face with **Symmetric**), **Mirror left → right** and **Mirror right → left** all use this rule. **Flip face** is the mirror image: every control onto its mirror, so a jaw shifted left shifts right and a look to V's left becomes one to her right (`jaw_mid_shift_l` moves the chin 10.1 mm to V's left) [offline].

**Opposing pairs.** Names propose opposites (a direction word swapped: in/out, up/dn, fwd/back, front/back; or the other side of a lateral pair); the solver keeps a pair when the two displacement fields point against each other (cosine over every joint below −0.45). On V's rig the confirmed pairs sit between −0.57 and −1.00 and every rejected proposal at −0.20 or above, so the threshold has a wide margin. A control joins at most one axis (the most opposed proposal wins: the tongue base's back pairs with front, −0.96, not forward, −0.77). Each confirmed pair is one **two-way control** from −1 to +1: the negative end takes `max(0, −v)`, the positive `max(0, v)`. Reading keeps both raw weights, so an installed expression that sets both ends (mixed) loses nothing until the control is moved; the drawer shows the net with a mixed state.

| Axis (negative ↔ positive) | Opposition | Oriented by |
|---|---|---|
| Gaze, each eye: look left ↔ right (left eye `out` ↔ `in`, right eye `in` ↔ `out`) | −0.76 | Motion: V's own left and right |
| Gaze, each eye: down ↔ up (`dn` ↔ `up`) | −0.78, −0.79 | Words |
| Nostril, each side: in ↔ out (`breathe_out` ↔ `breathe_in`) | −1.00 | Motion: inward/outward (breathe_in is the flare) |
| Jaw: left ↔ right; back ↔ forward | −0.96; −1.00 | Words (motion agrees) |
| Mouth: left ↔ right; down ↔ up (`lips_mid_shift_*`) | −0.89; −0.94 | Words (motion agrees) |
| Face gravity: left ↔ right; back ↔ forward | −0.72; −0.89 | Words (motion agrees) |
| Neck turn: left ↔ right; down ↔ up | −0.57; −0.76 | Words |
| Neck tilt: left ↔ right | −0.61 | Words |
| Head turn (neck skin): down ↔ up; head tilt: left ↔ right | −0.96; −0.91 | Words |
| Tongue base: left ↔ right, down ↔ up, back ↔ front; tongue tip: left ↔ right, down ↔ up | −0.74 to −0.96 | Words |

The neck and head correctives' largest skin motion can run against the head motion they are for (a right tilt's biggest joint motion goes left), so axes whose ends carry a world word keep the rig author's word; only in/out pairs are oriented by where they move. Pairs that stay separate (proposed by words, rejected by solving): brow raise inner/outer (+0.37), mouth corner up/down (+0.47 on one side), lip suck, puff and part up/down (+0.00 to +0.11), and the tongue twist and tongue base forward [offline]. Brow up/down and other antagonist skin muscles are deliberately not merged: they can act together (a worried brow raises the inner brow while the brows lower).

**For the design lead** (the model is in place; visuals are open): each eye has a horizontal and a vertical two-way gaze control, linked by default so both eyes look the same way. A 2D gaze pad would drag one point whose x is the horizontal axis and y the vertical, in V's own left/right (the pad should say whose left, since the viewer sees her mirrored); with the gaze link on, one point drives both eyes (the same values, which the rule turns into in on one eye and out on the other); with it off, two points. Values stay −1 to +1 per axis, `expression.setAxis` per axis, one Undo step per drag.

## Related pages

[Facial expressions](../../knowledge/facial-expressions.md) · [Facial animation](../../knowledge/facial-animation.md) · [Expression editor design](expression-editor-design.md) · [Expressions evidence](expressions-evidence.md) · [Experiment 026](../../experiments/026-natural-expressions/README.md) · [Community credits](../../docs/community-credits.md)
