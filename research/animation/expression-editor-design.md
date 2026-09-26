# Static photo-mode expression editor: design

**Status: design proposal, 26 September 2026. Nothing is built.** This turns the [expressions and idles brief](../backlog/expressions-and-idles-brief.md) into a phased build plan for its first scope: **static photo-mode expressions**, authored in XF Studio and exported additively beside other installed expression mods. It follows the brief's decisions of 26 September (static first; the Studio's expression table wins and carries other installed mods' rows forward, explained in plain words). The editor interaction assumes the brief's Option 2 (region handles plus an "all controls" drawer) **pending the maintainer's confirmation** (question 2 below). Animated faces, idles and a sculpt mode are later phases and only shaped here so they are not designed out.

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
| Photo mode's 1 s cross-fade | Irrelevant for a held static face | [resource] |

The preview is therefore labelled a **solved preview of the game's rig**, never "as in game", until R4 has compared them.

## 6. Export route

Exporter `expressions/photo-mode-static-v1` implements the [feature exporter contract](../authoring/feature-module-platform.md#6-export-mod-products-and-the-package-plan-pipe-12). The [Studio-to-mod pipeline](../authoring/studio-to-mod-pipeline.md) and its diagrams are updated, rendered and visually inspected in the same checkpoint that builds it.

### 6.1 Plan

For each eligible expression preset: a slug (`xfs_expr_<slug>`, unique in the collection, stable across rebuilds by preset UUID), the target genders, the allocated table index, and the controls mapped to each gender rig's `trackNames`. **Eligibility**: at least one non-zero control available on the target rig; otherwise the preset is omitted and Check, Build and the manifest all report it (partial-export rules).

### 6.2 Files

1. **Clips.** One set per gender, `…/<key>/expressions/xfs_expressions_female.anims` (male twin), against that gender's face skeleton: one entry per expression, 2 frames, `AdditiveFromRefPose`, 344 joints at reference, 414 constant tracks carrying reference + vector (so a delta of the vector). Built as `.anims.glb` with `constTrackKeys` and imported with WolvenKit, using the vanilla `photomode_female_facial.anims` from the player's own files as the template set and rig reference [source: `ModTools.ImportAnims`].
2. **Attachment to the photo-mode face rig.** Preferred: ArchiveXL `animations:` entries with `component: face_rig`, which merge sets without touching any `.app`. Fallback: an ArchiveXL `.app` patch adding a separately named animation-setup component (`xfs_PhotomodeAnimations`) to `h0_000__basehead_face_rig_photomode.app`, never replacing the vanilla or Mega Pack `PhotomodeAnimations`. R3 decides; until then Build refuses with "waiting for an in-game check" rather than guessing.
3. **Menu records.** TweakXL: `PhotoModeFaces.xfs_expr_<slug>` with `$base: PhotoModeFaces.facial_neutral`, `faceId` = the allocated index, and `displayName` through an ArchiveXL onscreens localisation key (`xfs_expr_<slug>`), appended once to `photo_mode.character.faceAnimations` [resource: the Mega Pack's route; the localisation route is standard ArchiveXL, its use in the photo-mode list is a hypothesis].
4. **The expression table** (§6.3).

### 6.3 The expression table and precedence (decision 2)

**Resolve, carry, append.** At Check, the resolver finds the **effective** `photomode_facial_poses.csv` for the player's launch route, ignoring the Studio's own earlier output. Build writes a superset: every existing row byte-for-byte unchanged, in order, then one row per XF expression (`Index`, `AnimationName` = `xfs_expr_<slug>`, `streamingContext` `photomode`, `FallbackAnimationName` `facial_neutral`, so a missing clip set degrades to a neutral face instead of nothing).

**Index allocation.** Next free index after the resolved table's largest, recorded per preset in the manifest and reused on rebuild while it stays free. If R2/R5 show the database looks rows up by the `Index` column and tolerates gaps, allocation moves to a high band (from 50000, inside `photo.expression.set`'s accepted range) so a later update of another mod that appends rows cannot collide with XF's [design choice pending R2/R5].

**Winning the path.** The table travels in its own small **overlay archive** inside the product, because the product's main archive name (`xfs_c<collection>`) is fixed for stable identity. Check computes the overlay's name from the resolver's mount plan so it sorts before every other provider of the path under the resolver's collation (for example `0xfs_c<collection>_tables.archive` beats `xBaebsae_…`), and re-runs the precedence rules on the planned install to prove the XF table wins. This is a platform export capability ("single-owner overlays"), reusable for later features that must own a whole file.

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

- **Merged by default.** Expressions join the collection's one product. With eye makeup the product is **"XF Looks"**; a collection with only expressions builds **"XF Expressions"** (the feature's default brand, per the [package plan](../authoring/feature-module-platform.md#package-plan-merged-by-default-splittable-by-the-user)), which is also the name when the user splits expressions out. The brand is a proposed default (question 6); names freeze at first successful Build.
- **No selector.** Expressions contribute choices to photo mode's existing list, matching the rule to add to vanilla option sets unless a custom selector is genuinely best.
- **Requirements.** ArchiveXL and TweakXL (current stable versions, detected, never installed or replaced by the Studio).

### 6.5 Verification

The independent verifier unpacks the built archives and checks, without importing the exporter or the clip encoder:

- the table is a superset: every carried row byte-identical and in order, every XF row present once, no duplicate `Index`;
- every `PhotoModeFaces.xfs_expr_*` record's `faceId` has exactly one row, whose clip name exists in an XF set attached to `face_rig`;
- each clip decodes (through WolvenKit's export and the `anim-export` tool) to 2 frames, `AdditiveFromRefPose`, 344 joints at reference and 414 constant tracks whose main-pose deltas equal the planned vector exactly (float32), with envelopes and override weights at reference;
- the overlay archive wins the table path on the planned install (resolver re-run);
- the manifest records `gameRenderingVerified: false` until R4/R5.

## 7. The runtime bridge and in-game preview

The bridge already selects expressions through the photo-mode menu (`photo.expression.set`, [runtime]) and catches the photo-mode stand-in for `photo.subject` [source]. The design adds four commands to the [catalogue](../../projects/xf-runtime-bridge/tools/api/catalogue.ts), each defined once there, logged with a correlation ID, and (for writes) gated by `allow_writes`, reversible and stopped by the kill switch.

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
| R1 | Which facial setup, graph and sets the photo-mode `face_rig` uses after ArchiveXL | `face.rig.read` with the Mega Pack enabled, then in a profile with it disabled | Both JSON results (hashes and labels); which of the two `face_rig`s (placeholder in `player_wa_tpp_head.ent`, or the photo-mode `.app`'s) is live | reference, then throwaway |
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
| D3 | Menu label | The preset name, through an ArchiveXL localisation key; the user can override it per expression. |
| D4 | Red Hot Tools for in-game preview | Use it only if the maintainer adds it to the test profile; without it, in-game preview is a rebuild and a game restart. |

## Related pages

[Expressions and idles brief](../backlog/expressions-and-idles-brief.md) · [Facial expressions](../../knowledge/facial-expressions.md) · [Facial animation and the blink](../../knowledge/facial-animation.md) · [Expressions evidence](expressions-evidence.md) · [The game's blink](game-blink.md) · [CC idle](cc-idle.md) · [Brow idle gap](brow-idle-gap.md) · [Photo mode from script](../../knowledge/photo-mode.md) · [Runtime access](../../knowledge/runtime-access.md) · [Runtime bridge design](../runtime/runtime-bridge-design.md) · [Feature-module platform](../authoring/feature-module-platform.md) · [Architecture contract](../authoring/architecture-contract.md) · [Mod loading](../../knowledge/mod-loading.md) · [Community credits](../../docs/community-credits.md)
