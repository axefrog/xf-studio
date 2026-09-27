# Static photo-mode expression editor: design

**Status: phase 1 built (27 September 2026, claude/expressions-p1; [phase 1 status](#phase-1-status)); phases 2–5 are designs.** The two phase-0 bridge commands `face.rig.read` and `photo.expression.index` are built and tested offline (§7) and wait for the next session's [expression checks](../runtime/runtime-bridge-test-card.md#expression-checks-r1-and-r2). The maintainer confirmed the interaction (handles plus an all-controls drawer, sculpting later) and static expressions first.

Facts come from the [facial expressions](../../knowledge/facial-expressions.md) and [facial animation](../../knowledge/facial-animation.md) knowledge pages, the [expressions evidence note](expressions-evidence.md), [the game's blink](game-blink.md), [photo mode from script](../../knowledge/photo-mode.md) and [runtime access](../../knowledge/runtime-access.md). Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[source]** engine, framework or tool source or decompiled scripts; **[resource]** extracted game or mod resources; **[wiki]** Modding Docs; **[runtime]** seen in the running game; **[offline]** measured or run here without the game; **[hypothesis]** not established. Anything without a grade is a **design choice**, and says so where it matters.

## 1. Summary

| Phase | What it delivers | Depends on | Effort |
|---|---|---|---|
| 0. Groundwork | Runtime answers R1–R3 through the bridge; control vocabulary intake from the player's rig and facial setup; solver latency measured | Next game session; bridge commands `face.rig.read` and `photo.expression.index` (§7) | S (2–3 agent days, plus one session) |
| 1. Model and preview | `expressions` feature module with its part, actions and Undo; start from rest or any installed expression; the controls drawer; exact live preview on the Studio's head through the external solver | Phase 0 vocabulary; the facial pose port (§5) | M (5–7 days) |
| 2. Region handles | About 15 on-face handles driving fixed control sets, with mirroring and per-control unlink | Phase 1 | M (4–6 days) |
| 3. Export | Clips, attachment, TweakXL records, the superset expression table and its precedence, Check/Build/verify, manifest; pipeline doc and diagrams updated | Phase 1; R3 decides the attachment route | L (7–10 days) |
| 4. In-game proof | R4–R5 through the bridge in a throwaway profile; an in-game preview command for authored expressions | Phase 3; a game session | M (3–4 days, plus one session) |
| 5. In-app solver | MIT solver written from the facial setup's data format, verified against the external one; removes the Python dependency from interactive editing | Phase 1's parity oracle | L (7–10 days) |
| Later | Male V preview, NPC puppets, sculpt mode (Option 3), animated faces and the idle designer | Maintainer decisions (questions 4, 5) | — |

The editor stores one thing: **a sparse vector of named main-pose control weights**. The preview solves that vector with the game's own facial setup; the export writes the same vector as a vanilla-shaped clip. Handles, the drawer and a later sculpt mode are three ways of editing the same vector, so preview and export can never disagree about what the user made.

## 2. What the design rests on

| Fact | Consequence for the design | Grade |
|---|---|---|
| A face clip drives 414 float tracks on the face skeleton: 13 envelopes, **141 main-pose weights**, 86 lipsync override weights, 141 lipsync pose outputs and 33 wrinkle outputs. Envelopes and override weights rest at 1, main poses at 0. | The stored vector covers the 141 main-pose weights only; everything else stays at the rig's reference values in preview and export. | [resource] |
| The solver clamps main-pose weights to 0–1. | Every control is edited and stored in 0–1; handles clamp at the ends. | [source] add-on `animation/facial/solver.py` at `7a4ee793` |
| Every vanilla photo-mode expression is a 2-frame clip whose 414 tracks are constants, 344 joints at reference; 22–42 main poses non-zero. Fourteen are `AdditiveFromRefPose`; `facial_sadness` is `Additive`. | An expression is exactly a constant vector; importing `facial_sadness` subtracts the reference values and yields the same main-pose weights. | [resource] |
| No vanilla expression keys a bone except the singing faces (Head, Neck, Neck1, Spine3). | Bone keys are out of scope; a start point that has them drops them and says so. | [resource] |
| Photo mode chooses an expression by `faceId` → `AnimFeature_PhotomodeFacial.facialPoseIndex` → `photomode_facial_poses.csv` row → clip by name in the photo-mode face rig's sets. | Export adds records, rows and clips; no graph change for static faces. | [resource] [source]; faceId = index [hypothesis] |
| The CSV and the two face graphs are single-owner files: ArchiveXL cannot merge 2D arrays; the first archive alphabetically (or first in a visible `archive/pc/mod/modlist.txt`) wins a path. | The Studio writes a superset table in an archive named to win (decision 2), and detects when it goes stale. | [source] [resource] |
| The reference setup's photo-mode menu shows **207 expressions** (attribute 28): 12 vanilla plus the Mega Pack's. The bridge's `photo.expression.set` applied one in game. | Start points and allocation must expect hundreds of rows; the bridge can already select an expression. | [runtime] |
| Every vanilla player `face_rig` names the **male** player facial setup; the Studio's bakes solve with the female head's own. The two differ in pose data. | The preview's facial setup is a recorded, switchable input; R1 decides the default (§5.4, question D1). | [resource]; engine use [hypothesis] |
| The Studio already solves game clips offline with the pinned, unmodified IO Suite solver run as an external program, and drives every same-named bone of the head, plate and detail skeletons from the solved rig (`src/game-blink.ts`, `src/idle-animation.ts`, `src/platform/scene/head-rig.ts`). | Preview reuses that binding machinery and that solver; only the solve moves from a one-off bake to on demand. | [source] |
| WolvenKit's `ImportAnims` keeps `trackKeys`/`constTrackKeys` float tracks and `AdditiveFromRefPose`, and writes the compressed buffer vanilla facial clips use. | Clips are built through WolvenKit from glTF; no custom `.anims` writer. | [source]; end to end untested |

## 3. Data model

### 3.1 The part

An expression is a **look-level part** of a new feature `expressions` in the [platform document model](../authoring/feature-module-platform.md#2-document-model). A preset (look) that carries an `expressions` part exports as one photo-mode expression; the preset's name is the menu label unless the part overrides it. A collection of expression presets is the user's expression set. Looks stay sparse: a look with eye makeup and no expression part exports no expression.

```ts
// features/expressions: xfs/expression-part-1 (design sketch)
type ExpressionPart = {
  label?: string;                         // photo-mode menu text; default: the preset name
  controls: Record<string, number>;       // sparse: control (track) name -> weight in (0, 1]; absent = 0
  links: Record<string, boolean>;         // per left/right pair ("eye_brows_raise_in"): mirrored edits; default true
  origin?: { kind: "rest" }
         | { kind: "installed"; clip: string; set: string; row?: number };   // where editing started (provenance only)
  bodyGenders?: ("female" | "male")[];    // default both (question 4)
};
```

- **By name, never by index.** Controls are stored by track name (`eye_l_brows_raise_in`), as the character part stores options by name ([platform §9](../authoring/feature-module-platform.md#9-how-module-2-plugs-in)). Build maps names to each target rig's `trackNames`.
- **Sparse and exact.** Zero weights are omitted; stored values are float32-representable so the clip round trip is exact. The codec rejects non-finite values and values outside 0–1.
- **Unknown names survive.** A control the current vocabulary lacks (another rig, a future game version) is kept verbatim, shown as "not available on this head" and omitted from export with a reported reason, never dropped on save.
- **Editor memory** (not in the part): the selected region, the drawer's open group and filter, and handle visibility.

### 3.2 The control vocabulary is game data

The vocabulary is read at intake from the player's own face skeleton (`trackNames`, `referenceTracks`) and facial setup (its track mapping 13/141/86/33 and pose info), not hard-coded: the main-pose block is whatever the setup's mapping says it is [resource: the mapping is identical in the female basehead and male player setups]. The engine derives from it:

- **Groups** for the drawer, by name prefix: brows, lids, gaze and pupils, nose and cheeks, lips, jaw, neck, head turn and tilt (`neck_[lr]_turn`, `head_neck_up_turn` and siblings, which are controls, not bone keys), ears, tongue [resource: the main-pose names in the rig's `trackNames`].
- **The mirror map**, by name: swap every standalone `l`/`r` token between underscores (`eye_l_brows_lower`↔`eye_r_brows_lower`, `head_neck_l_tilt`↔`head_neck_r_tilt`, `jaw_mid_shift_l`↔`jaw_mid_shift_r`, `tongue_mid_tip_l`↔`tongue_mid_tip_r`); gaze keeps its meaning (`eye_l_dir_in` mirrors to `eye_r_dir_in`, both toward the nose); centre controls (`lips_apart_up`, `jaw_mid_open`) mirror to themselves. The map is an involution, which a test enforces; a control whose partner is missing stays unlinked. [resource: the female basehead skeleton's 141 main-pose names, read from the local intake, follow this pattern throughout]
- **Friendly labels** ("Inner brow raise, left") from a small label table keyed by name, falling back to the raw name. The tongue group, the sticky-lip cutscene controls (`lips_corner_sticky`, `…_sticky_cutScene`), `face_gravity_*` and `sculp_mid_slide` sit under "Advanced": the preview cannot show the tongue well (§5.4) and the others have no evident expression use.

### 3.3 Start points: every installed expression, found the way the game finds it

"Start from" lists every expression the player's photo mode can show: the **winning** `photomode_facial_poses.csv` resolved through the Studio's normal archive precedence (`src/archive-precedence.ts`), each row's clip found by name among the sets the resolved photo-mode `face_rig` appearance holds (including ArchiveXL `animations:` and `.app` patches the resolver already applies), decoded to a vector. The Mega Pack's 202 faces therefore appear because its files win, not because the Studio knows the Mega Pack, as the [no per-mod adapters rule](../../AGENTS.md) requires. Decoding uses the clip's constant or first-frame values (static faces); an animated clip offers "start from frame…" later. Decoded vectors are cached locally with the rest of the resolver's game-derived data and never shipped.

### 3.4 Region handles (Option 2, pending confirmation)

Each handle is data: an anchor joint (where it sits on the face), one or two screen-space drag axes, and for each axis direction the controls it drives with a gain. Dragging sets those controls' weights from the drag distance, clamped to 0–1; a linked pair moves both sides. Proposed table (tuned in phase 2 against solved motion):

| Handle (per side where paired) | Drag | Controls |
|---|---|---|
| Inner brow | up / down / toward the nose | `eye_[lr]_brows_raise_in` / `…_lower` / `…_lateral` |
| Outer brow | up / down | `eye_[lr]_brows_raise_out` / `…_lower` |
| Upper lid | down / up | `eye_[lr]_blink` / `…_widen` |
| Lower lid | up | `eye_[lr]_oculi_squint_inner`, `…squint_outer_lower` (inner or outer by grab point) |
| Gaze target (one, both eyes) | 2D | `eye_[lr]_dir_up/dn/in/out` |
| Nose wing | up / in | `nose_[lr]_snear` / `…_compress` |
| Cheek | out / in | `cheek_[lr]_puff` / `…_suck` |
| Mouth corner | up / up-out / out / down | `lips_[lr]_corner_up` / `…_corner_sharp_up` / `…_corner_wide` / `…_corner_dn` |
| Upper lip (per side) | up / apart / together | `lips_[lr]_upper_raise` / `lips_apart_up` / `lips_together_up` |
| Lower lip (per side) | down / up | `lips_apart_dn` / `lips_[lr]_lower_raise`, `lips_chin_raise` |
| Jaw | down / sideways / forward | `jaw_mid_open` / `jaw_mid_shift_[lr]` / `jaw_mid_shift_fwd`, `…_back` |
| Neck | down (tense) | `neck_[lr]_platysma_flex` |

Compound controls without a natural direction (`lips_[lr]_funnel`, `lips_[lr]_purse`, `lips_puff_*`, `lips_tighten_*`, `jaw_mid_clench`, `neck_throat_open`) come from a secondary gesture on the nearest handle (Alt-drag, per the [input bindings](../authoring/input-bindings.md) rule that Shift always means a shape gesture) or the drawer. Exact control names are validated against the vocabulary at load; a handle whose controls are missing is hidden. Handles never write a control outside their table, so the drawer always shows the whole truth.

## 4. Feature module boundaries

The [architecture contract](../authoring/architecture-contract.md) and the [platform layout](../authoring/feature-module-platform.md#layout) decide where each piece lives. Proposed layout (none of it exists yet):

```
engines/facial-rig/            pure, reusable by expressions, the idle designer and body work later
  vocabulary.ts                trackNames + setup mapping -> controls, groups, mirror map, reference values
  vector.ts                    validation, clamping, mirroring, sparse <-> dense, float32 exactness
  decode.ts                    clip float tracks (constTrackKeys/trackKeys) -> vector, Additive -> delta
  clip.ts                      vector -> glTF animation with constTrackKeys (2 frames, AdditiveFromRefPose)
  handles.ts                   handle table evaluation (drag -> control weights), no Three
platform/api/facial.ts         FacialPosePort and FacialSolverPort types (below)
platform/scene/face-driver.ts  solved local deltas -> every same-named bone (generalised from GameBlink/IdleAnimation)
features/expressions/
  index.ts                     FeatureModule: part codec, editor codec, actions, targets, gestures, catalogues
  view/                        drawer, handle overlay, start-point picker, list labels (studio-ui rules)
  render/                      handle gizmos only; the face itself is posed through the facial pose port
  export/                      exporter "expressions/photo-mode-static-v1" (host only)
  verify/                      independent verifier (host only; no import of export/ or engines/facial-rig/clip)
host adapters                  FacialSolverPort over the external solver process (phase 1), in-app solver (phase 5)
```

**Engine.** Pure TypeScript, no Three, no host globals, guarded by the import-boundary test. It holds no feature data: the expressions feature hands it the vocabulary and handle table, as eye makeup hands the layered-makeup engine its region.

**Platform additions.** Posing the face is not a feature's job: the head rig already owns the idle and the blink, and all three write the same bones. The design adds one platform service, recorded as a platform extension in the [UI architecture boundary](../authoring/ui-architecture-boundary.md) (module #2's acceptance test in [platform §9](../authoring/feature-module-platform.md#9-how-module-2-plugs-in) did not foresee a face-posing feature):

```ts
// platform/api/facial.ts (sketch)
type ControlVector = Readonly<Record<string, number>>;
interface FacialPosePort {                 // on SceneHostPort
  vocabulary(): FacialVocabulary | undefined;             // from the rig the preview head uses
  hold(owner: FeatureId, vector: ControlVector): void;    // this feature's static face; solved and applied by the platform
  release(owner: FeatureId): void;
  readiness(): "ready" | "updating" | "blocked";          // blocked: no solver or no setup, with a plain reason
}
interface FacialSolverPort {               // device port; host adapters implement it
  solve(tracks: Float32Array, setup: SetupId, signal: AbortSignal): Promise<SolvedPose>;   // local rotation/translation per joint
}
```

The platform combines owners into one vector, solves it and applies it through the face driver; exactly one motion source owns the bones at a time, as `src/preview-motion.ts` already arranges for the idle and the blink (§5.3).

**Feature.** Owns the part, validation, Undo, handle gesture sessions and export. Actions (each with a descriptor, capability, Undo policy and history label, registered with the feature as owner, and added to the [action catalogue](../authoring/ui-action-catalogue.md)):

| Action | Target | Undo |
|---|---|---|
| `expressions/control.set` (name, value) | a control | part; slider drags are one gesture transaction |
| `expressions/handle.drag` | a handle | one transaction per drag; Escape restores |
| `expressions/pair.link` / `pair.unlink` | a left/right pair | part |
| `expressions/mirror` (left→right or right→left) | the look | part |
| `expressions/reset` (all, group or control) | scope | part |
| `expressions/startFrom` (rest or an installed expression) | the look | part; replaces the vector, keeps the label |
| `expressions/label.set` | the look | part |
| `expressions/genders.set` | the look | part |

Capabilities refuse with structured codes: `asset_unavailable` until the vocabulary loads, `invalid_value` for out-of-range values, `not_on_this_head` for unknown controls.

**View.** Talks only through the feature's facade: the drawer (grouped sliders, search, per-pair link toggles, numeric entry), the handle overlay (gizmos drawn by the feature renderer, picking inside its own objects), and the start-point picker. It never sees a solver, a bone or the writable part.

## 5. Live preview

### 5.1 Reusing the blink and idle pipeline

Today `src/game-blink.ts` and `src/idle-animation.ts` each take a solved rig (local rotation and translation per joint, from an offline bake), apply each joint's world delta to every same-named target bone's world bind, parent first, and re-seat the rig on the shown eye shape's joint binds. That covers the core head, the eye plate and every detail's own skeleton copy (brows, lashes of any mod, the eyes), and it restores the captured pose exactly [source]. The face driver is that binding logic lifted into the platform, taking a **solved pose** instead of a baked clip. The blink and idle keep working through it unchanged; their bakes remain until the live solver replaces them.

### 5.2 Solving on demand

- **Phase 1: the external solver, kept warm.** The host (localhost server, and the desktop app once [prepare idle and blink](../backlog/prepare-idle-and-blink.md) has fetched the pinned solver with consent) runs one long-lived solver process: the same pinned, unmodified IO Suite modules the bakes import, loaded once with the compiled facial setup, answering "solve these 414 tracks" requests over stdin/stdout. It stays a separate GPL-3.0 program; no code enters XF Studio [source: the bakes' licence rule].
- **Latency.** One frame is one call to the solver's runtime solve over about 140 poses, their in-betweens and 255 correctives on 266 joints. The bakes solve 663 idle frames in one run, but a single-frame round trip has not been timed [hypothesis: a few milliseconds per solve plus transport]. Phase 0 measures it; the design needs under about 30 ms for drags to feel live.
- **Drag loop.** Every handle or slider change updates the vector immediately; solve requests are latest-wins (a newer request cancels the pending one), and the viewport keeps showing the last **exact** pose until the new one arrives (readiness `updating`). There is no approximate linear preview presented as the real face: correctives make the rig non-linear.
- **Phase 5: the in-app solver.** An MIT implementation written from the facial setup's data format and the documented stages (envelopes and muzzles, limits, influences, upper/lower multipliers, in-betweens, correctives, local-delta blend), never ported from the add-on's code. The external solver becomes its **parity oracle**: the same vectors (every vanilla expression, random sparse vectors, blink and idle frames) must agree per joint within 1e-5 rad and 1e-6 m before the in-app solver replaces it, and then also replaces the baked blink and idle (which also fixes the brief's non-additive composition limit).

### 5.3 Composition with the other motion

- **Idle.** The idle's facial solve is not additive, so an expression and the idle cannot both own the face. Holding an expression while the idle plays is refused with a plain reason ("The creator idle is playing; pause it to see your expression"), the same pattern as the blink.
- **Blink over an expression.** The game's graph adds the look-at blink clips to the tracks **before** the facial solve (`BlendAdditive` on tracks, then `Sermo`) [resource]. The preview does the same: expression vector plus blink closure controls, clamped, solved together, so correctives respond as in game. With the baked blink this is not possible; with the live solver it is exact.
- **Gaze.** Photo mode's look-at controller and eye-direction tracks act after the clip [resource]. The preview shows the authored gaze controls only; the runtime checklist uses look-at off (attribute 15 = 0) so the game shows the same.

### 5.4 Parity limits

| Limit | Effect on the preview | Status |
|---|---|---|
| Which facial setup the engine uses for V (male player setup named by `face_rig`, or the female basehead's own) | Same controls, different pose data: the male blink turns the upper lid about 3° less | R1; the setup is a recorded input (question D1) |
| Wrinkle outputs (33 tracks) are not rendered | Furrows and crow's feet absent in the preview | Known; later shading work |
| No scale poses: the face part has none; the eye part's four scales are pupils | `eye_[lr]_pupil_narrow/wide` do nothing in the preview | [resource]; label those controls |
| Look-at, neck and head twist constraints and eye tracks after the clip | Game head and eyes may turn toward the camera | Test with look-at off |
| Eye-shape re-seat on morph joint binds | Per-shape lid pivot is a hypothesis; `h011` regresses | [hypothesis]; blink session tests it |
| Teeth and tongue rendering incomplete | Open-jaw and tongue controls look wrong inside the mouth | Advanced group; label |
| Solver LOD 0 | Photo-mode close-ups probably also solve at full detail | [hypothesis] |
| Portability across face shapes | The same vector on another V is expected to look equivalent | [hypothesis]; R4 on two shapes |
| Male V | The Studio has no male head preview; male clips export blind | Question 4 |
| Photo mode's 1 s cross-fade | Reproduced by the animated transition's default (§5.5): control weights blended linearly over 1 s before each frame's solve, where the graph blends its tracks | [resource]; not compared in game |

The preview is therefore labelled a **solved preview of the game's rig**, never "as in game", until R4 has compared them.

### 5.5 Animated transitions

Built 28 September 2026 (`claude/expression-transition`); offline evidence only. A change from one expression to another can play as motion instead of a cut, so its naturalness can be judged. The same machinery is meant for poses and for the planned timeline editor.

**What a person sees.** The Expression drawer's **Transitions** section, between Start from and Adjust all: **Animate changes** (a switch, off by default), **Duration** (0 to 3 s in 0.05 s steps, 1 s by default, reset to 1 s; at 0 s a change shows at once, which the switch's help says) and **Curve** (every curve of the easing catalogue as an icon-only Segmented strip that hugs its six icons, grouped by family with each gentle curve beside its strong one; each has its name and how it moves as its tooltip, and the chosen one is named at the right of the label line, as Duration's value is). While the switch is off, Duration and Curve keep their place and value, read as inactive (neutral slider fill, muted labels and readouts), and the reserved line under Curve says once why: "Turn on Animate changes to set these." Adjust all › Intensity's curves are the same control, frameless on its label line. Nothing moves between the states. A Replay button that replays the last change with the current settings is banked ([backlog](../backlog/README.md)).

**The default, 1 s Linear, is photo mode's own.** Photo mode's face graph swaps between two `AnimDatabase` states on `updateFacialPose` with a linear 1 s blend ([knowledge §3](../../knowledge/facial-expressions.md#3-photo-mode-expressions)) [resource]. The blend happens on the tracks before the `Sermo` solve, which is where the Studio blends too, so the first thing a person sees is the switch as the graph describes it; the other curves are there to judge motion the game doesn't make. Whether the game's blend looks like this in practice is a runtime question (knowledge open question 9).

**What animates and what doesn't.**

| Change | Behaviour | Why |
|---|---|---|
| Start from (a saved, natural or installed expression, or Rest), Reset all, a group's or a control's reset, Mirror, Flip, Undo, Redo, selecting another look | Eases from the face on screen to the new one | Whole-face jumps: the comparison the feature is for. Undo and Redo included, because stepping back and forth between two faces with the motion is the most direct A/B comparison. |
| A slider drag, a key step, a typed value, Adjust all › Intensity (anything inside an open form-control transaction) | The controls the edit changed follow at once; anything still easing keeps its own clock | The edit is already continuous and follows the hand; making it lag would make fine adjustment harder. Nothing else jumps. |
| A change nobody can see (no head yet, the solver starting, the idle playing), the first vector, 0 s, the switch off | Cuts | Nothing to watch; a hidden animation would only spend solves. Turning the switch off mid-way cuts to the target. |

A change mid-transition starts from the blended face on screen (`ValueTransition.ease` reads the value at that moment), so it never jumps. The rule is generic: the facial preview asks the composition whether a form control is open (`featureControlSnapshot`), not which action ran.

**How.** A **value-transition node** (`platform/core/value-transition.ts`, pure, clock-driven) sits between the combined face vector (the composition's face posers, `combineFacePoses`) and the solve in `FacialPreview`. It keeps the value shown, the target, the start time, the duration and the curve; `cut`, `ease` and `follow` retarget it; `valueAt(now)` blends each control weight linearly in eased time (`weightBlend`: absent is 0, float32, clamped to 0–1, zeros dropped). While it moves, the preview solves one frame about every 16.7 ms (`FRAME_MS`; the 5–8 ms round trip leaves room), through the same newest-wins solve as a drag; the last frame is the target's own exact solve. The blink composes into every frame exactly as for a still face (a held closure is in each solve; Play blink's clip carries on through the frames, `FacePose.continues`, instead of restarting). Ownership of the bones is unchanged (preview-motion.ts): the face driver holds each frame as it holds a still face, lent to a pose when one plays, so nothing rebinds and the PREV-144 drift can't return. Poses plug in as another source with their own `Blend` (a per-joint rotation blend) and their own setting.

**The setting** is the `transitions` family's one action, `transition.set {source, enabled?, seconds?, easing?}` ([catalogue](../authoring/ui-action-catalogue.md)), owned by `TransitionSettings` (`platform/core/transition-settings.ts`). It is view state of the subject's motion, like the blink: kept in the workspace's `preview.transitions` only once changed, never a look, an Undo step or an export, and available before the head loads. It is not a UI preference because the facial preview, on the application side, reads it; UI preferences are presentation state the application never reads. The views of one scene share one rig and one face, so like the idle it belongs to the scene and moves into the scene node with the other motion state in view-graph P3 ([view graph §6.5](../authoring/view-graph-design.md#65-phase-status)); a second scene with its own face gets its own node.

**The easing catalogue** (`platform/api/easing.ts`) is the Studio's one vocabulary of curves, shared by Adjust all › Intensity, the transition and, later, the timeline editor. Every curve is a cubic Bézier `[x1, y1, x2, y2]` from (0, 0) to (1, 1), x within 0–1 so it is a function of time, y free to overshoot. A stored curve (`EasingCurve`) is a preset's ID or `{ bezier }`, so a keyframe segment will store either and evaluate it with `ease(curve, t)`. The presets, in the order a picker shows them: Linear, Ease in (`x²`), Ease out, Strong ease out (cubic, a quick onset and a long settle, like a spontaneous reaction), Ease in-out (smoothstep) and Strong ease in-out (cubic, a deliberate change). Ease in, Ease out and Ease in-out are exactly Béziers with x controls at ⅓ and ⅔ and keep their closed forms, so Intensity's maths are unchanged. No bounce or elastic: a face doesn't move like that. Each curve's icon is its own Bézier, exactly (an exaggerated drawing showed holds the curves don't have), with a faint flat tick at each end, which a gentle curve runs into and a straight line meets at a corner; Linear also has a dot at each end, so it can't be taken for Ease in-out at 16 px.

**Deferred.** A Bézier handle editor (the timeline R&D designs curve editing; the model stores and validates custom curves already, `parseEasingCurve`), per-region timing (brows leading the mouth, as real onsets often do), a measured "natural" onset curve from reference footage, overshoot and anticipation curves (allowed by the model, clamped by the weight blend), and transitions for poses.

## 6. Export route

Exporter `expressions/photo-mode-static-v1` implements the [feature exporter contract](../authoring/feature-module-platform.md#6-export-mod-products-and-the-package-plan-pipe-12). The [Studio-to-mod pipeline](../authoring/studio-to-mod-pipeline.md) and its diagrams are updated, rendered and visually inspected in the same checkpoint that builds it.

### 6.1 Plan

For each eligible expression preset: a slug (`xfs_expr_<slug>`, unique in the collection, stable across rebuilds by preset UUID), the target genders, the allocated table index, and the controls mapped to each gender rig's `trackNames`. **Eligibility**: at least one non-zero control available on the target rig; otherwise the preset is omitted and Check, Build and the manifest all report it (partial-export rules).

### 6.2 Files

What an expression mod must contain, settled offline on 28 September 2026 (the phase-3 research check; sources below). R3 no longer blocks export: the attachment route is the one the Mega Pack already runs in game, with a distinct component name so it adds instead of replacing.

1. **Clips.** One set per body gender, `base\animations\xfs\expressions\<namespace>\xfs_expressions_female.anims` (male twin), naming that gender's photo-mode face skeleton, exactly as the vanilla `photomode_female_facial.anims` and `photomode_male_facial.anims` do. One entry per expression, written directly as a vanilla static face is laid out [resource: every vanilla static face decoded on 28 September]: `AdditiveFromRefPose`, 2 frames, duration 0.0333333351 s, `numJoints` 344, 1,032 constant joint keys (three per joint), 0 animated keys, `numTracks` and `numConstTrackKeys` 414, one constant key per track in track order, every track but the 141 main poses at 0 (the clip holds deltas), the main poses at the expression's weights; 19,824 bytes per clip. The joint-key block is copied from the gender's own vanilla `facial_neutral` in the player's files (identical in every vanilla static face). The clip data sits in the set's `animationDataChunks` at the clip's `dataAddress`, as WolvenKit reads it [source: WolvenKit `AnimationReader`; `animAnimationBufferCompressed.tempBuffer` is ignored on write], and WolvenKit's `deserialize` turns the set's JSON into the resource, so there is no glTF import step. Vanilla constant track keys carry odd values (1019–13368) in the second 16-bit field WolvenKit reads as a time; XF writes 0, what WolvenKit itself writes for a constant key at time 0 [hypothesis: the engine ignores it for a constant key].
2. **Attachment to the photo-mode face rig.** An ArchiveXL `resource: patch:` of `base\characters\head\player_base_heads\appearances\head\face_rig\h0_000__basehead_face_rig_photomode.app` with a patch `.app` holding the two appearances of that file (`h0_000_pwa__basehead__face_rig_photomode`, `h0_000_pma__basehead__face_rig_photomode`), each with **one new `entAnimationSetupExtensionComponent` named `xfs_expressions_<namespace>`** whose `controlBinding` binds to `face_rig` and whose `animations.gameplay` lists that gender's XF set (priority 128, as vanilla). ArchiveXL merges a patch appearance's components into the matching appearance by component **name and id**: a match replaces the component, anything else is added [source: ArchiveXL 1.27.3 `ResourcePatch/Extension.cpp` `MergeComponents`]. The Mega Pack re-declares `PhotomodeAnimations` with the vanilla set plus its own [resource], so two mods doing that replace each other's component; a separately named component adds beside both. The vanilla appearance already binds two extension components to `face_rig` (`man_face_base_animations`, `PhotomodeAnimations`) [resource], so a third is the vanilla shape. The patch is read from the appearance's `compiledData` package, which the patch file carries (the Mega Pack's does) [source] [resource]. Whether ArchiveXL's `animations:` entries with `component: face_rig` reach this rig (R3) is still open and is no longer needed.
3. **Menu records.** TweakXL, in `r6/tweaks/<archive>/<archive>.yaml`: `PhotoModeFaces.<clip>` with `$base: PhotoModeFaces.facial_neutral`, `faceId` = the allocated index and a literal `displayName` (the menu label), and `photo_mode.character.faceAnimations: [!append-once PhotoModeFaces.<clip>]`. The Mega Pack's 202 records use literal display names [resource], and its faces showed in the reference setup's photo-mode menu (207 entries through the bridge, 26 September) [runtime], so no localisation key is needed (question D3).
4. **The expression table** (§6.3).
5. **Names.** Namespace `xfs_x<first 12 hex digits of the set's ID>`; clip and record name `<namespace>_<first 12 hex digits of the saved expression's ID>`, so a clip keeps its name across renames and rebuilds, and the same saved expression in two sets never collides.
6. **Body genders.** Both by default: the female set on the female appearance, the male set on the male one, each against its own skeleton. The main-pose names are identical in both rigs [resource]; an expression using a control one rig lacks is left out with its reason. (The Mega Pack attaches its female-rig clips to male faces too [resource].)

Prior art: the Photomode Facial Expression Mega Pack (7912, 2.1.0.0; its `.xl`, patch `.app` and TweakXL file read from the reference MO2 setup, read-only) and the ArchiveXL and TweakXL sources. The Modding Docs have no authoring guide for new expressions (the custom facial expressions guide renames vanilla clips over existing slots) [wiki: `be2f44ee`, see the [evidence note](expressions-evidence.md#community-documentation-modding-docs-be2f44ee)].

### 6.3 The expression table and precedence (decision 2)

**Two tables, one choice per set** (design choice, 28 September; the maintainer may change the default). The table is one file per game, so a mod that is shared behaves differently from one built for the player's own setup:

| Table | What Build writes | Use |
|---|---|---|
| **For my game** (default) | The **effective** `photomode_facial_poses.csv` on the player's launch route (the host's prerequisite resolves it, ignoring this set's own earlier table), every row unchanged and in order, then one row per XF expression | Works beside the expression mods the player has (the Mega Pack's 202 faces keep working) |
| **For sharing** | The game's own table (from the base archives), then filler rows `facial_neutral` up to index 999, then the XF rows from 1000 | A mod to publish: it carries no other mod's rows (their names are that mod's content, and a user's version may differ). With another expression mod installed, whichever table wins decides which faces work, as between any two expression mods today; with the filler, a face the winning table lacks shows neutral, never another mod's face |

Each XF row is `Index`, `AnimationName` = the clip, `streamingContext` `photomode`, `FallbackAnimationName` `facial_neutral`, so a missing clip set degrades to a neutral face instead of nothing.

**Index allocation.** For my game: next index after the table's largest; for sharing: from 1000. Either way `Index` equals the row's position, so the table works whether the database looks rows up by the `Index` column or by position (R2). Indices follow the set's order and are recorded in the manifest.

**Winning the path.** The table travels in its own small **overlay archive** inside the product, because the product's main archive name (`xfs_c<collection>`) is fixed for stable identity. The overlay is `0<archive>_table.archive`: `0` sorts before every letter and `_` under the resolver's case-insensitive ordinal collation, so it beats `xBaebsae_…`. Check reads the other providers of the table path from the prerequisite and reports plainly when one would still sort first (a name starting with a digit or punctuation) or when a visible `archive/pc/mod/modlist.txt` decides the order. This is a platform export capability (a feature's extra archives), reusable for later features that must own a whole file.

**What the user sees** (plain words, one next step, per the "It just works" policy):

| Situation | Behaviour | Message (draft) |
|---|---|---|
| No other mod changes the table | Superset of the 15 vanilla rows | none |
| Another mod's table wins today (for example the Mega Pack's 217 rows) | Carry every row, add XF's, name the overlay to win | "Your expressions are added after the 217 from Photomode Facial Expression Mega Pack. XF Studio keeps that mod's expressions working by including them in its own list." |
| A visible `archive/pc/mod/modlist.txt` orders archives | Load order comes from that file, so naming cannot win; the Studio never edits it | "Your archive load order list decides which expression list wins. Move `<overlay>` above `<winner>` in it, then check again." |
| The carried table changes later (the other mod updates, or is removed) | The manifest records the carried table's hash; the installation watch notices the change and marks the installed product stale | "An expression mod changed since you built XF Looks. Rebuild so its new expressions keep working." (button: Rebuild) |
| XF uninstalled | The other mod's table wins again; nothing else breaks | none |
| Another mod also replaces the face graphs (the Mega Pack loops animated faces) | Static expressions need no graph; the graphs are left to whoever owns them | none |

The carried rows come from the resolved file, whoever made it: no mod is named in code, only in messages built from the resolver's provenance.

### 6.4 Product, naming and selector

- **Expression sets** (the maintainer's request, 28 September: "create and name distinct custom expression sets" and export one as a standalone mod). A set is a named, ordered list of **saved expressions** (part presets, [editor invariants](../authoring/editor-invariants.md#part-presets)), kept in the library beside them. A saved expression can be in several sets; deleting it leaves its place in a set marked missing, which export reports. The menu label is the saved expression's own label, else its name.
- **One mod per set.** A set exports as its own product, default name **"XF Expressions: <set name>"**, which the person can change per set. Export builds a package-only collection from the set (its ID, name, one look per member carrying that saved expression, a package plan naming the mod) and runs it through the platform's Check → Build → independent verifier → manifest unchanged, so a set and a look collection plan, verify and record alike. Looks in a look collection that carry an expressions part still join that collection's product as the platform merges features ("XF Looks" with eye makeup); the brand alone is "XF Expressions" (question 6).
- **No selector.** Expressions contribute choices to photo mode's existing list, matching the rule to add to vanilla option sets unless a custom selector is genuinely best.
- **Requirements.** ArchiveXL and TweakXL (current stable versions, detected, never installed or replaced by the Studio).
- **Files.** The product is the main archive and `.xl`, the table overlay archive and the TweakXL file. Build never installs it. The install host can place it: "Add to my mod manager" puts the overlay beside the main archive and the TweakXL file in `r6/tweaks/<archive>/`, in the mod's own MO2 folder or the game folder, each file hashed and named in the plan and the receipt ([pipeline](../authoring/studio-to-mod-pipeline.md#adding-a-built-mod-to-the-mod-manager)). The set panel doesn't offer that button yet, so a set's build offers Show in folder (copy `archive` and `r6` into the game folder or a mod manager, or zip them for a mod page).

### 6.5 Verification

The independent verifier unpacks the built archives and checks, without importing the exporter or the clip encoder:

- the table (unbundled from the overlay and serialised by WolvenKit) is a superset: every carried row identical and in order, every XF row present once, `Index` equal to position, no duplicate;
- every record in the TweakXL file has exactly one row whose `AnimationName` is its name, is appended once to `faceAnimations`, and names a clip present in the set its gender's patched appearance attaches to `face_rig`;
- each clip, read with the verifier's own decoder from the serialised set, is 2 frames, `AdditiveFromRefPose`, 344 joints, 1,032 constant joint keys equal to the template's, 414 constant tracks whose main poses equal the saved expression's weights exactly (float32, from the package-only snapshot) and every other track 0;
- the `.xl` patches exactly the photo-mode face rig with the product's patch file, and the patch adds one component per gender, named for the namespace, bound to `face_rig`;
- the manifest records `gameRenderingVerified: false` until R4/R5.

The verifier imports nothing from the exporter or the engine's clip writer.

## 7. The runtime bridge and in-game preview

The bridge already selects expressions through the photo-mode menu (`photo.expression.set`, [runtime]) and catches the photo-mode stand-in for `photo.subject` [source]. The design adds four commands to the [catalogue](../../projects/xf-runtime-bridge/tools/api/catalogue.ts), each defined once there, logged with a correlation ID, and (for writes) gated by `allow_writes`, reversible and stopped by the kill switch. The first two are built (claude/bridge-batch2, offline only; [bridge design §3.2](../runtime/runtime-bridge-design.md#32-protocol-1)): both are grounded in the decompiled 2.31 scripts, the component lookup going through `Entity.FindComponentByName` and the setup read property by property through the game's reflection, with anything missing or differently typed reported as `unreadable`. As built, `photo.expression.index` refuses an index the photo-mode expression list doesn't offer unless `unlisted: true` (sparse-index checks), and its undo is `photo.expression.set` with the menu's value, which re-applies the menu's expression. The other two are designs.

| Command | Class | What it does | Undo |
|---|---|---|---|
| `face.rig.read` | read | Finds photo-mode V's head item in `AttachmentSlots.TppHead` (`TransactionSystem.GetItemInSlot`) and lists every component: class, name, appearance path; for each `entAnimatedComponent` its `facialSetup`, `graph` and `rig` path hashes (read natively, which CET could not do for `rRef`s [source: CET converters]) and `animations.gameplay`/`cinematics` entries (priority, set hash); the same for `entAnimationSetupExtensionComponent`s. The Studio labels hashes with FNV-1a64 of known depot paths from its resolver. | — |
| `photo.expression.index` | write-photo | Applies `AnimFeature_PhotomodeFacial { facialPoseIndex }` with `AnimationControllerComponent.ApplyFeature` and pushes `updateFacialPose`, on the stand-in or its head item, for any index, including ones no menu option offers. Test profile only; research use. | the previous index (from the menu's current value) |
| `face.expression.stage` | write-photo | Test profile, and only with Red Hot Tools already installed there: copies a Studio-built **probe archive** (one reserved clip `xfs_expr_probe`, a table with one reserved row, attached as in §6.2) into `archive/pc/hot`, waits for the reload lines in the log, then applies the reserved index. Red Hot Tools moves hot archives into the mod folder, reloads the changed resources and calls ArchiveXL's reload [source: Red Hot Tools `b4d3415`, `ArchiveLoader.cpp`]; whether a reloaded clip set and table reach an open photo mode is untested [hypothesis]. | the previous index; the probe archive is removed at session end |
| `face.controls.apply` (later) | write-photo | Apply a control vector directly to the live face without a clip, for instant preview. No script-visible input exists: the photo-mode graph reads only the face index [resource]. Needs native reverse engineering (for example overriding the float tracks entering `Sermo`) | the neutral vector |

`face.expression.stage` is the practical "preview this in game" route: the Studio's **Preview in game** button builds the probe from the current vector (seconds, one WolvenKit import), stages it and selects it, then captures a fixed-camera screenshot beside the Studio's own render. It needs the maintainer to have Red Hot Tools in the test profile; the Studio detects it and never installs it.

## 8. Runtime questions R1–R5 through the bridge

These replace the CET console lines prepared in [session 3 Part D](../../experiments/022-session-3/README.md#part-d-expression-console-checks-optional). Each run starts from a manual save, in photo mode with V, close face framing (`photo.frame {target: "face"}`), look-at off (`photo.camera.set {look_at: 0}`), HUD hidden, and records the game, ArchiveXL, TweakXL and Red Hot Tools versions.

| # | Question | Bridge sequence | Evidence captured | Profile |
|---|---|---|---|---|
| R1 | Which facial setup, graph and sets the photo-mode `face_rig` uses after ArchiveXL | `face.rig.read` with the Mega Pack enabled (next session, [test card](../runtime/runtime-bridge-test-card.md#expression-checks-r1-and-r2)), then in a profile with it disabled | Both JSON results (hashes and labels); which of the two `face_rig`s (placeholder in `player_wa_tpp_head.ent`, or the photo-mode `.app`'s) is live | reference, then throwaway |
| R2 | Is faceId the database index, and which target takes the feature | `photo.state {options: true}`; `photo.expression.set` to "Static: Sleeping" (menu position 56, faceId 60); then `photo.expression.index` 56 and 60 on the stand-in, then on the head item; watch whether photo mode re-applies its own index | Capture per step (`capture.screenshot`, face region); which target changed the face; whether it held | reference |
| R3 | Does `animations:` with `component: face_rig` reach the photo-mode face, and does a higher-priority set shadow a vanilla clip name | Install a tiny test archive (a set whose `facial_happy` is a copy of vanilla `facial_surprised`, priority 200) in the throwaway profile; `photo.expression.set` Happy; `face.rig.read` | Capture: Happy looks surprised or not; the set listed on `face_rig`; ArchiveXL log "Merging animations from …" | throwaway |
| R4 | Does a WolvenKit-imported, Studio-authored expression play as the preview shows | Build two expressions (an exact copy of decoded Happy; the same with one control changed) into a throwaway product; for each: `photo.expression.set`, capture; repeat on a second eye shape via `cc.apply` | Fixed-camera captures against the Studio's render at matched framing | throwaway |
| R5 | Do superset-table rows and new records appear and play beside the Mega Pack's; can indices be sparse | The phase-3 Build on the throwaway profile with the Mega Pack enabled; `photo.state {options: true}`; select each XF face and two carried Mega Pack faces; then one sparse-index test table | Option list JSON; captures; logs | throwaway |

R1 and R2 need only the bridge and the installed mods, so they can join the next scheduled session (question 7). R3 needs one tiny test archive; R4–R5 need phase 3.

## 9. Tests

- **Engine (pure).** Vocabulary parse from a synthetic rig and setup fixture (no game data in Git); the mirror map is an involution and pairs every `_l_`/`_r_` control; clamping and float32 exactness; handle evaluation stays within its control list and 0–1; `decode(clip(v)) == v` exactly; `Additive` import subtracts reference.
- **Asset-backed, opt-in (local game files).** Decoding the 13 exported female vanilla expressions reproduces the evidence note's non-zero counts and strongest weights; a vector exported through WolvenKit and read back through `anim-export` equals the input.
- **Solver port.** Contract tests with a fake solver (cancellation, latest-wins, readiness, plain failure when the solver is missing or the setup is unknown); an opt-in parity oracle between the external solver and the phase-5 in-app solver.
- **Face driver.** The blink's existing checks carried over: exact restore, duplicate bone names across head and details, detail skeletons follow, the plate stays on the skin, finite vertices; plus expression + blink combined equals the solve of the summed vector.
- **Feature.** Part codec round trip and unknown-control preservation; every action's capability, Undo and gesture cancel; look history across eye makeup and expressions parts.
- **Export.** Deterministic plans; index allocation and reuse; superset property on a synthetic 217-row table (built for the test, not copied from any mod); TweakXL and `.xl` golden output; the verifier catching injected faults (missing row, duplicate index, altered carried row, clip name mismatch, wrong track count); overlay naming against mount plans (alphabetical, visible `modlist.txt`, ArchiveXL bundle group, case collation); stale-table detection from a changed installation stamp.
- **Boundaries.** Import-boundary rules for the new engine and feature; the presentation boundary for the view.
- **Browser.** A `?verify=1` flow: start from an installed expression, drag three handles, unlink a pair, Undo and Redo, reload, confirm the vector and the posed face persist; never in the active draft.
- **Runtime.** R1–R5 as above; captures kept as asset-free evidence where they show no game-derived private material.

## Phase 1 status

Built on 27 September 2026 in `claude/expressions-p1`. Nothing here has been compared with the game: the preview is a solved preview of the game's facial rig on the Studio's head.

**What exists.**

- **Engine** `engines/facial-rig/` (pure): `vocabulary.ts` (the rig's track names and reference values with the setup's `info.tracksMapping`: groups by name, the token-swap mirror map, labels, direction pairs), `vector.ts` (sparse float32 vectors, dense tracks with additive extras, mirroring), `anim-tracks.ts` (a clip's float keys from its compressed buffer, the vector a still face holds) and `pose.ts` (rig rests and solved deltas in glTF axes). The design's `decode.ts` is `anim-tracks.ts`; `clip.ts` and `handles.ts` wait for phases 3 and 2.
- **Feature** `features/expressions/`: part `xfs/expression-part-1` (`label?`, `controls`, `links`, `origin?`; the design's `bodyGenders` waits for export), six actions (`expression.setControl`, `linkPair`, `mirror`, `reset`, `startFrom`, `setLabel`; the [action catalogue](../authoring/ui-action-catalogue.md#part-presets-and-expressions)), the Studio module (`expressions`, Preview, hidden until shown from Modules) and the drawer (`view/drawer.ts`, composed only from the component library since UI-108: a GroupSection per region with its count and reset, a PairControl per left/right pair and a SliderWithValue per centre or direction control, weights shown as percentages with exact entry and reset, a SearchField over the controls, mirror and reset all, and Start from). It is bound by the application's generic handler; slider drags are one Undo step through the new generic feature control transaction.
- **Start points** found as the game finds them (`src/facial-catalogue.ts`, `src/facial-host.ts`): the winning `photomode_facial_poses.csv`, V's photo-mode face rig `…\appearances\head\face_rig\h0_000__basehead_face_rig_photomode.app` and every ArchiveXL patch of it, each set's clips by name, decoded at their first frame. On the reference setup this lists 217 rows (the Mega Pack's table wins by precedence), 15 from the base game and 202 from the pack, none missing [offline, 27 September].
- **Live preview** (§5.2): `tools/facial_solver_server.py` keeps the pinned IO Suite solver warm and answers JSON lines; `FacialHost` builds the frames (reference + vector + blink), serialises requests and answers a request still waiting `superseded` when a newer one from the same page arrives (pages take turns); a solve slower than 15 s stops the stuck solver and the next solve starts a new one, within a restart budget that refills over 10 minutes; a solver program that can't be started reads as not set up; `FacialPreview` (browser) keeps one solve in flight and solves the newest state next, shows "Updating…" only past 150 ms, and hands the pose to `platform/scene/face-driver.ts`, which drives every bone of the same name as the blink does. The face rig and setup come from the winning game files through WolvenKit (cached in the preview cache's `facial/`, kept within 768 MB and cleared by "Clear prepared game files"), not from a developer intake.
- **Readiness in plain words** with one next step: set the game folder (Game & tools), the solver isn't set up (the knowledge pages), the idle is playing (Stop the idle), a failure (Try again). Editing always works; without the solver the expression is still saved with the look.
- **Saved expressions** in the library: a `part_presets` table beside the released ones ([editor invariants](../authoring/editor-invariants.md#part-presets)), listed under Start from › Your saved expressions. Save expression… opens a value popover with a suggested name; a saved row's context menu (right-click, Shift+F10, its More button) and F2 and Delete rename it in place or delete it after a confirm popover (the library can't undo a delete).
- **Start from** is a SearchField over a TreeView grouped by source: Rest (a button above), Your saved expressions, **Natural (XF)** (the five samples of [natural expressions §4](natural-expressions.md#4-the-five-expressions), read from `data/expression-samples/` by `src/expression-samples.ts` and handed out with the facial host's state, so they show before the game files are read), the game, then each mod. One click or Enter starts; the row the expression started from is current. A saved expression or sample starts with its own links (`expression.startFrom {links}`), so its authored asymmetry survives the next edit.
- **Labels and groups** follow the measured motion ([natural expressions §3.2](natural-expressions.md#32-mapping-table)): the nostril flare and narrow the right way round, "Lower lip down", "Upper lip raise, inner", "Mouth corner back (dimple)", "lip seal" with a note, "Cheek raise (squint, lower outer)"; the ten neck and head turn and tilt correctives sit in the folded Advanced group with a note that the head doesn't move; the four modifier controls say which control they change.
- **Symmetry is one rule** ([natural expressions §10](natural-expressions.md#10-symmetry-opposing-pairs-and-gaze)): a linked pair sets its counterpart (skin mirrors; horizontal gaze maps in on one eye to out on the other, so the eyes never cross; lateral controls have none). Symmetric (the whole face, `expression.setLinks`), Mirror left/right and Flip face (`expression.mirror {from:"flip"}`, the mirror image) share it. Gaze starts linked.
- **Two-way controls**: the host's solver confirms opposing pairs (`FacialHostState.rig.axes`, 22 on the reference setup); the drawer shows each as one −100 to 100 % control (`expression.setAxis`, both ends in one step), gaze as a linked left/right pair per direction; a mixed pair (both ends set by a game expression) shows its net and keeps both raw weights until moved. A 2D gaze pad is specified for the design lead in natural expressions §10.
- **Controls that move nothing aren't offered.** When the solver starts, the host solves every control alone and on top of all the others at 0.25 (`findInert`) and reports those that move no joint in either and feed no wrinkle output (`FacialHostState.rig.inert`; `lips_corner_sticky` and both `…pupil_narrow` on the reference setup). The drawer hides them; a value one holds (from a vanilla start) is kept and cleared by Reset all. Chosen over showing them disabled: a disabled control offers nothing to do, and the rule is actionable UI.

**Decisions (phase 1).**

- **The idle wins while it plays** (§5.3): a held expression steps aside and comes back when it stops; the drawer says why and offers Stop the idle. Not auto-stopped: motion is the person's choice.
- **The blink composes before the solve** (§5.3), as the game adds blink tracks first: a held closure is one solve with the game's `additive__blink_normal__01` sampled at that closure; Play blink is that clip solved at 60 Hz with the expression added and played every 2.45 s. The baked blink is muted (`GameBlink.setMuted`) while an expression is held and takes the bones back when it is released.
- **Links default by pair kind:** mirror pairs start linked, direction pairs (jaw and mouth shifts, gaze, neck turn and tilt, tongue, face gravity) start unlinked, since linking opposite directions cancels or crosses them. The design said "default true" for all.
- **Eye shapes keep the base seat** (the idle's reading); the blink's per-shape seat is not applied to expressions yet.
- **The main view shows the look's expression.** The view graph's scene node is where a per-view expression input would go (P3); until then the root feeds the one scene (`STUDIO_FACE_POSES` in `compose/renderers.ts`, combined by `combineFacePoses`).
- **The solver is found** at `XFS_FACIAL_SOLVER` (localhost), XF Studio's tools folder (`io-suite/<pin>/`, where a consented download will put it) or a checkout beside the repository; Python at `XFS_PYTHON` or `python`. The desktop has no Python yet, so its preview says the solver isn't set up.

**Measured** (27 September, the maintainer's route, female head's own setup): the setup compiles in about 0.2 s; one solve takes 0.6–0.9 ms in the solver; a round trip from the page to the head's pose takes 5–8 ms median (5.7 ms over a scripted 30-step drag, max 6.3 ms) with a cold first solve up to 38 ms; the blink clip (31 frames) solves in about 11 ms. The host's JSON endpoint alone answers in about 3.5 ms. The design's "under about 30 ms" is met.

**Platform extensions** (recorded in the [boundary assessment](../authoring/ui-architecture-boundary.md#open-work)): the facial pose sink on the scene host (`face`), generic feature form-control transactions, `facial` and `presets` on the presentation port and the feature view context, and sparse live-feature exports.

**Left for later phases:** region handles (phase 2), export (phase 3), in-game proof (phase 4), the in-app solver (phase 5), the male head, eye-shape seats for expressions, a consented solver download for the desktop, and the component-library versions of four drawer pieces (a slider with numeric entry, a left/right pair control, a group expander, a search field).

## Phase 3 status

Built on 28 September 2026 in `claude/expression-export`. Nothing has been loaded in game; the session ask is in [next-sessions plan](../runtime/next-sessions-plan.md).

- **Sets** (`part-preset-sets.ts`, `part-preset-store.ts` `part_preset_sets`, `part-presets.ts` `partPresetSet.*`) and the **Expression sets** panel (`features/expressions/view/sets.ts`, from the component library): create, rename, delete; add, remove and reorder saved expressions; the mod's name and table choice; Check, Build and Show in folder; results per set with what was left out and why. The drawer's More menu opens it (it replaced the "Export to game" placeholder). Awaiting the UI/UX gate.
- **Exporter** `features/expressions/export/` (plan, writers) with the engine's clip writer `engines/facial-rig/clip.ts`, the **verifier** `features/expressions/verify/` (imports neither), and the host prerequisite `src/expressions-game-prerequisite.ts` on both hosts. Platform extensions: product extras (TweakXL files, overlay archives) and `resource: patch:` in `.xl` fragments ([pipeline](../authoring/studio-to-mod-pipeline.md#expression-sets-photo-mode-expression-mods)).
- **Measured** on the reference setup: a five-expression set builds and verifies in about 84 s; the clips round-trip through WolvenKit 9.0.1 and the Studio's decoder exactly; the table carried the Mega Pack's 217 rows.
- **UI review fixes** (28 September): rows show the name photo mode shows and rename it (the saved expression's name, its own label dropped); deleting a saved expression also takes it out of its sets, with Undo in the toast for as long as the page is open (`partPreset.restore`); a set whose expressions all fail shows a finished result with each reason and Start from it (the refusal now carries its omissions to the page); omissions name face movements in words, never control IDs; one note per result, the rest under Details; the build result ends with its next step (Show in folder).
- **Not done:** an "Add to my mod manager" button in the set panel (the install host already places products with TweakXL files and overlays; the button is a UI addition awaiting the UI track), the stale-table watch (§6.3), per-expression body genders, NPC puppets. Banked from the UI review: **Add to set** in a saved expression's menu in the Expression drawer, and step-by-step Build progress (reading your game files, writing, checking) in place of "Building…".

## 10. Open questions

The brief's remaining questions, with proposed defaults:

| # | Question | Proposed default |
|---|---|---|
| 2 | Editor interaction | Option 2: region handles plus the "all controls" drawer, with the sculpt solve (Option 3) as a later mode. Phase 1 ships the drawer alone, so the choice can still change before phase 2. |
| 4 | Male V and NPCs | Export both V body genders from the same vector by default, with the male preview marked as unavailable until a male head is prepared; do **not** add expressions to NPC photo-mode puppets in the first version (the Mega Pack patches 57 NPC apps; NPCs use other rigs and would need their own preview). |
| 5 | Creator idle replacement | Not part of this feature's first version; revisit with the idle designer, clearly labelled as the user's idle. |
| 6 | Name when split | "XF Expressions"; merged it is "XF Looks". |
| 7 | In-game test timing | Yes: R1 and R2 through the bridge in the next session; R3 when its test archive is ready. |

New design questions:

| # | Question | Proposed default |
|---|---|---|
| D1 | Which facial setup the preview solves with before R1 answers | Keep the female head's own setup (what the blink and idle use today), record the setup in every solved pose and export manifest, and switch everything together if R1 shows the male player setup is live. |
| D2 | Index band | Next free index until R2/R5; move to a high band if sparse indices work. |
| D3 | Menu label | Decided (phase 3): the saved expression's label, else its name, as a literal TweakXL `displayName` (the Mega Pack's route, shown in game); no localisation key. |
| D5 | Which table a set's mod carries | "For my game" by default (works beside the installed expression mods); "For sharing" for a mod to publish, which carries no other mod's rows (§6.3). The maintainer's call for a Nexus release: a shared mod and the Mega Pack can't both own the table. |
| D4 | Red Hot Tools for in-game preview | Use it only if the maintainer adds it to the test profile; without it, in-game preview is a rebuild and a game restart. |

## Related pages

[Expressions and idles brief](../backlog/expressions-and-idles-brief.md) · [Facial expressions](../../knowledge/facial-expressions.md) · [Facial animation and the blink](../../knowledge/facial-animation.md) · [Expressions evidence](expressions-evidence.md) · [The game's blink](game-blink.md) · [CC idle](cc-idle.md) · [Brow idle gap](brow-idle-gap.md) · [Photo mode from script](../../knowledge/photo-mode.md) · [Runtime access](../../knowledge/runtime-access.md) · [Runtime bridge design](../runtime/runtime-bridge-design.md) · [Feature-module platform](../authoring/feature-module-platform.md) · [Architecture contract](../authoring/architecture-contract.md) · [Mod loading](../../knowledge/mod-loading.md) · [Community credits](../../docs/community-credits.md)
