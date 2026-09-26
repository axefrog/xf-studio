# Pose library for the full-body view: design study

**Status: design ready, 27 September 2026; nothing built.** It answers the [backlog entry](../backlog/README.md) asking for the full-body V in any photo-mode pose, vanilla or modded, from its own searchable panel with starred favourites. The facts it rests on are consolidated in [poses](../../knowledge/poses.md); this page adds the design, the phases, the risks and the questions. Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[source]**, **[resource]**, **[wiki]**, **[runtime]**, **[offline]** and **[hypothesis]**. No game session was run for this study. The evidence and its provenance are in the last section.

## 1. Summary

| Question | Answer |
|---|---|
| How does the game list poses? | TweakDB. `photo_mode.character.femalePoses` / `malePoses` are string arrays of `PhotoModePoses.*` record names (142 female and 143 male in 2.31). Each record names a clip (`animationName`), a category, a display text, a hold time and a few placement and filter fields. `poseCategories` orders the categories. No record carries an icon or an `.anims` path [resource]. |
| Where is the clip? | By name, among the animation sets of the photo-mode puppet's animated components (`player_wa_photomode_ep1.ent` with Phantom Liberty). This includes sets ArchiveXL appends. Every vanilla female pose clip is a 2-frame, 71-joint body clip on `woman_base.rig`, in the game's own compressed key format. It is not ACL [resource] [source]. |
| How do mods add poses? | Through the same two files. A TweakXL YAML adds pose and category records and appends them to the lists. An ArchiveXL `.xl` `animations:` entry adds the `.anims` set to the photo-mode entities, usually through ArchiveXL's `photomode_wa.ent` scope. The reference profile has 44 such packs, adding about 1,510 female entries. Everything is discoverable offline from files the game loads [resource]. |
| What is invisible to photo mode? | Appearance Menu Mod's custom-pose Lua files (a workspot entity plus clip names). Four installed packs are AMM-only; most AMM packs ship photo-mode records too. Poses added at runtime by CET or redscript are also invisible to photo mode [resource]. |
| How would the Studio play one? | Sample the clip once at the record's `animationTime` (0 for 2,052 of 2,079 mod records) and drive the body joints the way the creator idle's body clip already does. A static frame is what photo mode shows for nearly every pose [resource]. |
| Is a native decoder needed? | Not a native module. The key stream is a small, fixed layout: 12-byte keys with quantised values, plus float keys, inside the anim set's data chunks. A TypeScript decoder beside the existing native archive and CR2W reader is enough. Today's idle path decodes through WolvenKit's exporter (`anim-export`), not the IO Suite solver. The solver is only for faces [source] [resource]. |
| Performance | Listing is metadata only: TweakDB flats, a few dozen YAML and `.xl` files, and texts. A clip is about 3 KB and decodes on demand; sets are fetched lazily and cached by archive identity. About 1,650 poses for this profile's female V [resource; timing not measured]. |

**Two findings that shape the design:**

- **The game drives the body's helper joints with an animation graph.** The photo-mode puppet has a `deformations` animated component: `woman_base_deformations.rig` with `woman_base_deformations.animgraph`. The graph has 94 weighted point constraints, 78 aim constraints, 62 weighted orient constraints, 44 simple splines, 10 twist constraints and 90 `SimpleBounce` nodes, over 114 named helper joints (deltoids, knuckles, buttocks, knees, wrists) [resource]. The preview's rigid nearest-segment approximation was fine for the creator idle's small motion. Sitting, kneeling and raised-arm poses will show its limits at the shoulders, hips and knees. This mostly answers [body rendering open question 1](../../knowledge/body-rendering.md#open-questions).
- **Pose Selector's favourites are keyed by display text.** It stores the category text plus the pose text [source: its `favoriteKey`], and its README says a cross-category browser needs indexing beyond the menu's own list. The Studio already indexes offline, so it can key favourites by record ID and search across every category at once.

## 2. The file chain

| # | Link | Where and what | Grade |
|---|---|---|---|
| 1 | Pose list | `photo_mode.character.femalePoses` / `malePoses`: `array:String` flats of record names, in menu order within a category. The female list is chosen by the photo-mode puppet's body gender. | [resource] (REDmod `photomode.tweak`; compiled `tweakdb.bin` and `tweakdb_ep1.bin` agree: 142 / 143) |
| 2 | Category list | `photo_mode.character.poseCategories` → `PhotoModePoseCategory` records `{categoryName, displayName}`. Vanilla has `idleCategory`, `actionCategory` and `naturalCategory`, labelled with secondary text keys (`UI-PhotoMode-OptionCategoryIdle`…). | [resource] |
| 3 | Pose record | `PhotoModePose : PhotoModeItem`: `displayName` (vanilla `LocKey#27995`…; mods mostly literal text), `locked`, `animationName`, `animationTime`, `category`, `acceptedWeaponConfig` (default `POSE_HIDE_WEAPON`), `poseStateConfig` (default `POSE_STATE_GROUND`), `lookAtPreset`, `disableLookAtForGarmentTags`, `filterOutForGarmentTags`, `positionOffset`, `rotation`, `poseSize`, `allowMoveUpDown`. No icon field. | [resource] REDmod `schema.tweak` |
| 4 | Photo-mode puppet | `Character.Player_Puppet_Photomode.genders`: Female → `ep1\characters\entities\player\photo_mode\player_wa_photomode_ep1.ent` (tagged `[EP1]`), Male → `player_ma_photomode_ep1.ent`. ArchiveXL's bundled scope `photomode_wa.ent` lists both the base and the EP1 entity. Which entity a game without Phantom Liberty uses is inferred from the tag. | [resource] REDmod `player_photomode_record.tweak`; [source] ArchiveXL `PhotoModeScope.xl`; without EP1 [hypothesis] |
| 5 | Animation sets | The puppet's `root` animated component (`woman_base.rig`, `player_photomode.animgraph`, 39 set entries) and its `entAnimationSetupExtensionComponent`s. The vanilla pose sets are `photomode__female__idle.anims` (133 clips), `photomode__female__action.anims` (73), `photomode__v_female__natural.anims` (23) and two EP1 sets. ArchiveXL `animations:` entries are appended to each animated component whose owner template is a target, at `InitializeAnimations`. | [resource]; [source] ArchiveXL `Animation/Extension.cpp` |
| 6 | Clip lookup | By name among those sets. All 142 female records resolve (90 idle, 28 action, 24 natural). With duplicate names across sets, the choice by priority or order is untested. | [resource]; duplicate rule [hypothesis] ([wiki] says first match wins, for faces) |
| 7 | Clip | `animAnimation` with an `animAnimationBufferCompressed`. Vanilla poses: 2 frames, 0.033 s, 71 joints, 13 float tracks (body-part visibility, predictive look-at, foot IK), `Normal` type, no motion extraction; keys in the set's `animationDataChunks` at `dataAddress`. | [resource] |
| 8 | Playback in game | The body graph `player_photomode.animgraph` has a `MixerSlot`, a `WORKSPOT` graph slot with a `WorkspotHub`, a `FreezeFrame` feature, `PhotomodePoseCategory.poseCategoryIndex` switching the head and chest rotation nodes, foot IK nodes and look-at controllers. How the native menu starts the clip, and whether `animationTime` is a start or a hold time, are not traced. Pose Selector's per-character "freeze pose animation" means multi-frame poses do play over time. | [resource] graph; native start [hypothesis]; animated poses [source: PMPS README and time-dilation code] |
| 9 | Helper joints | The `deformations` component (§1) solves the muscle, twist and corrective joints from the main joints every frame. | [resource]; exact node semantics [hypothesis] |

## 3. How mods add poses, and what the Studio can see

| Route | What it writes | Seen by photo mode | Seen by an offline, data-driven Studio | Grade |
|---|---|---|---|---|
| **TweakXL + ArchiveXL** (the standard since game 2.0) | YAML: `PhotoModePoseCategories.<id>` (`$base: idleCategory`), `PhotoModePoses.<id>` (`$base: PhotoModePoses.idle_stand_01`), `!append-once` onto `femalePoses` / `malePoses` / `poseCategories` (and often NPC lists through a YAML anchor); `.xl` `animations:` with `entity: photomode_wa.ent` (or explicit entity paths) and `set: <path>.anims` | Yes | Yes, with the TweakXL and ArchiveXL rules (§4) | [resource] 44 packs on the reference profile |
| **Poses reusing another pack's sets** (e.g. the PMU pose add-ons) | Records only; the clips come from a core pack's `.xl` sets | Yes, when the core pack is installed | Yes: the clip lookup is global over the puppet's sets | [resource] |
| **Multi Pose Pack Framework** (legacy) | Whole replacement of the base `player_wa_photomode.ent` / `player_ma_photomode.ent`, adding empty numbered set slots (`photomode__female__idle__000…010.anims`, `…__backup`, `…__animation`) that pose packs fill by path | Only when the replaced entity is the one in use; with Phantom Liberty the V puppet is the EP1 entity, so it would not load | Yes, by archive precedence, as the game resolves it | [resource]; EP1 effect [hypothesis] |
| **Replacing a vanilla clip by name** (oldest route) | Same-named clip in a winning copy of a vanilla set | Yes | Yes, by archive precedence | [wiki] |
| **Appearance Menu Mod custom poses** | `AppearanceMenuMod/Collabs/Custom Poses/**.lua`: a Lua table `{modder, category, entity_path, anims = {["Woman Average"] = {...}, ...}}` naming a workspot entity whose sets hold the clips; AMM plays them through a workspot | **No** | Only with an AMM-specific reader. The clips are ordinary `.anims`, but the list is AMM's own format, not game data | [resource] 24 files in 23 packs, 656 "Woman Average" clips; 4 packs AMM-only |
| **Runtime additions** (CET `TweakDB:SetFlat`, redscript) | Records created while the game runs | Yes | No | [hypothesis]; none found installed |

**The rule.** Following [AGENTS.md](../../AGENTS.md) ("interpret game files the way the game does; no per-mod adapters"), the Studio lists exactly what the game's photo mode would list for this V. It uses the engine's and the core frameworks' rules (archive precedence, ArchiveXL scopes and `animations:`, TweakXL records and list operations), and never names a pack. The AMM route is a third-party framework's private format, so it is out unless the maintainer decides otherwise (question Q1).

## 4. Data-driven discovery

### 4.1 Inputs, all already located by the resolver

1. **The compiled TweakDB** (`tweakdb_ep1.bin` with Phantom Liberty) through `src/tweakdb-flats.ts`. Two small additions are needed: `array:String` (the pose lists are string arrays, which the reader skips today [offline: a patched copy read 142/143]) and `Vector3` (`positionOffset`, `rotation`).
2. **TweakXL files** from the effective `r6/tweaks` (MO2 VFS, Vortex or a manual install, the same sources the resolver already merges). A **generic TweakXL reader** follows TweakXL's own rules [source: TweakXL `TweakImporter.cpp`, `YamlReader.cpp`]:
   - file priority (first, normal, last), then path order;
   - records with `$type` / `$base` and field inheritance;
   - the list operations `!append`, `!append-once`, `!prepend`, `!remove` and their `-from` / `-all` variants;
   - `.tweak` RED syntax as a later step.

   The [clothing render](../../knowledge/clothing.md) needs the same reader; today clothing refuses TweakXL-only items ("an item a mod adds with TweakXL isn't read yet", `clothing-resolver.ts`). It must be one shared reader, not a pose-specific one.
3. **ArchiveXL `.xl` files**, already read by `src/archivexl-config.ts`. It gains `animations:` (`entity` path or list or scope, `set`, `priority`, `vars`, `component`), with scopes expanded as ArchiveXL does [source: `Animation/Config.cpp`].
4. **The puppet entity**, resolved like any other `.ent`, with archive precedence and ArchiveXL patches, from the gender's entity in step 1.
5. **Texts**, through `src/game-text.ts`: the game's onscreens plus ArchiveXL `localization`. A literal display name is shown as written, which is what the game appears to do (packs ship labels such as `01` or `bv_serene_f`) [hypothesis: the menu shows untranslatable CNames as is].

### 4.2 The pose entry

```ts
type PoseEntry = {
  id: string;               // TweakDB record name, e.g. "PhotoModePoses.idle_stand_01": the stable key (favourites, workspace)
  label: string;            // resolved display text
  category: { id: string; label: string; order: number };
  order: number;            // position in the gender's list (menu order)
  clip: { name: string; set: string /* depot path */; archive: string /* winning archive id */ } | null;
  time: number;             // animationTime
  placement: { offset: [number, number, number]; rotation: [number, number, number] };
  holds: string | null;     // acceptedWeaponConfig unless POSE_HIDE_WEAPON: a weapon or prop the Studio doesn't draw
  state: string;            // poseStateConfig (ground, air, car, bike, swimming…)
  hiddenForGarmentTags: string[];   // filterOutForGarmentTags
  lookAt: string | null;    // lookAtPreset
  source: { kind: "game" | "mod"; declaredBy: string | null };  // provenance from the resolver (mod-manager name or archive), never a special case
};
```

A record whose clip isn't found in the puppet's sets gets `clip: null`. It is not listed, and the diagnostics count it ("3 poses name animations that aren't installed"). That is the honest view of what the game can play [hypothesis: in game such a pose leaves V unchanged].

### 4.3 The clip index

- **Listing does not decode.** Whether each record's clip exists needs the clip names of each set. A set's names are in its CR2W exports, so the index costs one archive read and one CR2W parse per set. That is about 500 sets on this profile, each tens to hundreds of KB (the vanilla idle set is 159 KB for 133 clips).
- **Cached on disk** under the resolver's derived cache, keyed by the winning archive's identity (path, size and modified time) and the set path. Only changed archives are re-read.
- **Decoded on demand.** Choosing a pose decodes one clip (about 3 KB of keys) from its set, cached in memory. Stepping through a list with the keyboard stays instant.

## 5. Playing a pose on the full-body V

### 5.1 Decoding

- **Format** [source: WolvenKit `animAnimationBufferCompressed.cs` read-only at `11720772`; [resource]]:
  - Animated keys are 12 bytes each: normalised 16-bit time, then 16 bits of bone index (13 bits), component (2 bits: position, rotation, scale) and quaternion *w* sign, then three 16-bit values quantised to [−1, 1]. A rotation's *w* is rebuilt from *x*, *y* and *z*.
  - Raw and constant keys carry three float32 values.
  - Float-track keys come last.
  - The key block sits in the set's `animationDataChunks[unkIndex]` at `fsetInBytes`, or inline (possibly Oodle-compressed, which the native reader already handles).
- **Written from the format, not ported.** The decoder is written as a small MIT module from this description, in `native/`, beside the CR2W reader. No WolvenKit code is transliterated; WolvenKit is GPL-3.0 and is used as an external tool only. Its exporter (`anim-export`) serves as the **parity oracle**: the same clip through both must agree per joint within 1e-5.
- **Shared with expressions.** The [expression editor design](expression-editor-design.md#33-start-points-every-installed-expression-found-the-way-the-game-finds-it) needs the same decoder for face float tracks. Face clips sometimes use `animAnimationBufferSimd` (5 of 444 Mega Pack clips; three `ui_female_face` clips). Poses need the compressed format only: every body pose clip surveyed uses it. The SIMD reader comes later, with WolvenKit as the fallback.
- **Sampling.** Joint *j* at time *t*: its keys around *t*, linearly interpolated (slerp for rotations); a constant key otherwise; the rig's reference transform (`boneTransforms` of `woman_base.rig`, read natively) when the clip has no key. WolvenKit exports these keys with linear samplers [source]. Whether the engine interpolates splines is irrelevant for poses held at a key time. Scale is kept (`isScaleConstant` is 1 in the vanilla pose inspected).

### 5.2 Driving the body

- **Same composition as the idle.** The body clip's joints are the creator idle's joints: the same 71-joint `woman_base.rig`, with main joints matching the body meshes within 0.001 ([body rendering §4](../../knowledge/body-rendering.md#4-how-the-studio-draws-the-body)). So a pose is a **body source** for the idle's composition: a world delta per rig joint, then each target bone's world bind, parent first. Helper joints follow `nearestDriver` until phase 4.
- **One motion compositor** (lifting `preview-motion.ts`):
  - **Body source**, one of three: *Still* (bind pose), *Creator idle* (today's clip), or *Pose*.
  - **Face source**, one of: *rest*, the idle's face, the game blink, and later an expression (the expression design's facial pose port).
  - Choosing a pose sets the body source to *Pose*; the Preview panel's idle switch becomes the body source choice.
  - The face keeps whatever it had. With the idle's face on, V blinks and glances while holding the pose. That is more alive than photo mode, where only look-at blinks move the face (question Q5).
- **Root and placement.**
  - V's `Root` stays at the scene origin.
  - The clip's `Hips` and everything below come from the clip.
  - The record's `positionOffset` and `rotation` move the whole character, converted from game axes (Z up) the way the idle export already converts.
  - `Trajectory` and any motion extraction are ignored, so V stays in place. Photo mode likewise keeps the puppet at its spot [hypothesis].
- **Feet.** Pose clips carry foot IK tracks (`allowFeetIk`, `enableLeftFootIk`, …), and the game's graph has IK nodes that plant feet on terrain [resource]. The Studio has no terrain: feet stay where the clip puts them relative to `Root`, and the floor is `Root`'s height. A pose authored for stairs or a slope floats or sinks, as it would on flat ground in game.
- **Helper joints (phase 4).** Evaluate `woman_base_deformations.animgraph` itself: its point, orient, aim, twist and spline nodes are data. `SimpleBounce` is left at rest in a static pose. Parity: the in-game check G5 and captured shoulder and hip close-ups.
- **Clothing** is skinned to the same joints, so it follows the pose. Garment support (pushing cloth out over the body) is not implemented ([worn clothing](../../knowledge/clothing.md)), so crossed legs and folded arms may show the body through clothes where the game hides it.
- **Hair and dangles.**
  - Hair dangle joints follow the head rigidly in the preview. Hair keeps its rest shape relative to the head, and gravity is not simulated.
  - Upright poses look right. Lying, upside-down or strongly tilted poses will show hair hanging "up".
  - The game's dangle graphs (`hh_*_dangle.animgraph`) would be a later R&D track.
- **Props and weapons** (`acceptedWeaponConfig` other than `POSE_HIDE_WEAPON`: handguns, katanas, phones, cigarettes, pack-defined props like `POSE_PROP_CODPP_BEER_R`) are not drawn: V poses empty-handed. The entry says so (§6).
- **Animated poses (phase 5).** Records whose clip has more than 3 frames (e.g. Photo Mode Unlocker XL's `wp_hg_silver_*`, up to 361 frames) can play in a loop on the same clock as the idle, with Pause. The default is the held frame at `animationTime`.
- **Male V** uses `malePoses` and `man_base.rig`. That waits for the [masculine V plan](../character-customization/male-v-plan.md). Other-body poses are never retargeted.

### 5.3 Camera framing

- The whole-body view (`camera.body`) frames **the posed bounds**: the posed skeleton's joint positions padded by the body's radius, not the standing silhouette. A sitting or lying V fills the frame.
- Choosing a pose **does not move the camera**, so stepping through a list with the arrow keys stays steady. The whole-body view's own button and command re-frame, and so does the panel's "Frame V" action (question Q3).
- `bodyClipPlanes` extends to the posed bounds so a stretched arm never clips.

## 6. The pose panel

It is its own dockable panel, **Poses**, docked by default as a tab beside Character; it can float, tab and snap like every panel ([UI direction](../../AGENTS.md#architecture-contract)).

| Part | Behaviour |
|---|---|
| **Search** | One field at the top. It matches words in any order across the label, category, pack name, record ID and clip name, case- and accent-insensitive. Results are grouped by category with counts; empty groups are hidden. |
| **Categories** | Listed in `poseCategories` order. *Favourites* (starred) comes first and *Recent* (the last 12) second. Each category row shows its label and the pack it comes from, because many mod categories have raw labels such as `bv_serene_f`. Collapsed categories stay collapsed per user. |
| **Rows** | The label, then quiet badges for what the Studio can't show: *holds something* (weapon or prop), *vehicle* (`POSE_STATE_CAR`/`BIKE`), *moves* (animated). Double-click or Enter applies; a star button toggles the favourite. |
| **Favourites** | Persisted **per user**, not per workspace or recipe. A host-side document (`xfs/pose-preferences-1`, next to local settings; the desktop's user-data folder) holds favourite record IDs with a label snapshot, the recent list and collapsed categories. A favourite whose pack is gone stays in *Favourites* greyed, with "Not installed now" and a Remove action. |
| **Gender** | Automatic: the list for V's body gender, as photo mode does. No toggle (question Q8). |
| **Outfit filter** | By default the game's own rule: a pose whose `filterOutForGarmentTags` matches what V wears is hidden. A one-line, actionable note appears when that happens ("4 poses are hidden while V wears a coat. Show them"). Nothing appears when nothing is hidden (question Q4). |
| **Thumbnails** | None in the first release: no game data has icons, and rendering 1,650 full V thumbnails is expensive. Instead, moving through the list with the keyboard poses V live, which is the true preview. Phase 5 may add small stick-figure silhouettes drawn from the decoded skeleton, lazily and cached (question Q2). |
| **Keyboard** | In the search field, Down moves to the list. In the list, Up and Down move and pose V live; Enter keeps the pose and returns to search; Esc restores the pose held before the list took focus; F stars. A focus shortcut for the panel is added to the [input bindings contract](../authoring/input-bindings.md). Every action is also reachable with the mouse and the command palette. |
| **Clear** | "Stand still" (bind pose) and "Creator idle" are two fixed entries at the top of the list, so returning to the idle is one step. |
| **Empty and error states** | No game folder: "Poses come from your game. Choose your game folder in Game & tools" (button). A pack whose clips aren't installed: counted in the diagnostics, not shown as an error. |

**Content.** Poses are content-neutral: the panel lists every installed pose without judgement. What the body shows is governed only by the body's own censorship setting ([body rendering §3](../../knowledge/body-rendering.md#3-censorship-and-nudity-resource-source)), never by the pose.

## 7. Architecture

| Layer | Pieces | Notes |
|---|---|---|
| Adapters (pure, `native/` and readers) | `anim-set.ts` (CR2W anim set → clip index, clip decode, sampling); `tweakxl.ts` (shared TweakXL reader); `archivexl-config.ts` gains `animations:`; `tweakdb-flats.ts` gains `array:String`, `Vector3` | No Three, no host state; pure tests with synthetic fixtures (no game data in Git) |
| Domain service (host) | `pose-catalogue` (like `cc-catalogue-host.ts`): inputs from §4.1, output a read-only `PoseCatalogueSnapshot` (entries, categories, diagnostics), revisioned by the resolver's identity; `pose-preferences` store | Owns validation, caching and async policy |
| Application actions | `pose.select {id}`, `pose.clear {to: "still" \| "idle"}`, `pose.favourite {id, on}`, `pose.frame`; capabilities with plain refusal reasons ("Poses need your game folder") | Added to the [action catalogue](../authoring/ui-action-catalogue.md) and the boundary tests |
| Scene | A `BodyPosePort` on the scene host, sibling of the expression design's `FacialPosePort`: `setBodySource(still \| idle \| {clip samples})`; the compositor of §5.2 | Renderer owns the Three objects; no recipe access |
| Presentation | `studio-ui/panels/poses.ts` | Talks only through actions, snapshots and capabilities |
| Workspace | The current pose ID and body source are view state in the workspace, like the camera; not in recipes, Undo or exports | Question Q9 |

It is not a feature module: nothing is authored or exported. Authoring **new** poses and exporting an XF-branded pose pack would be one, a later domain that follows the same file chain in reverse (TweakXL records, an ArchiveXL `animations:` entry, a WolvenKit-imported `.anims`).

## 8. Phases and effort

| Phase | Scope | Depends on | Effort |
|---|---|---|---|
| **P0 Readers** | `anim-set.ts` compressed decoder and sampler with the WolvenKit parity oracle; `array:String` and `Vector3` flats; ArchiveXL `animations:` with scopes; the shared TweakXL reader (YAML records, inheritance, list operations, file priority) | — | 5–7 days (the TweakXL reader is about half and also unblocks clothing) |
| **P1 Catalogue** | Puppet entity, sets, clip index and cache, pose entries, labels, provenance, diagnostics; an opt-in asset-backed test on the local install (142 vanilla, all resolve) | P0 | 2–3 days |
| **P2 Playback** | Body source *Pose* in the compositor, placement offsets, posed-bounds framing and clip planes, face over pose | P1 | 2–3 days |
| **P3 Panel** | Poses panel, search, categories, favourites store, recent, keyboard, outfit filter, badges, actions and capabilities, boundary tests, `?verify=1` acceptance | P2 | 3–4 days |
| **P4 Deformation rig** | Evaluate `woman_base_deformations.animgraph` for the helper joints (constraints and splines; bounce at rest), replacing `nearestDriver` for the body; parity against in-game captures | P2, in-game G5 | 4–6 days (R&D) |
| **P5 Extras** | Animated poses (loop, pause), look-at preset (head to camera), skeleton silhouettes, SIMD clips | P3 | 3–5 days |

P0 to P3 is the first usable release: about two and a half weeks for one agent, or less with the TweakXL reader in parallel. P4 is the fidelity track.

## 9. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Duplicate clip names across sets (150 animation names are used by more than one mod record; names like `pose_01` are common) | The Studio shows a different clip than the game | Implement the engine's rule once G3 establishes it; until then priority, then load order, flagged [hypothesis] in code |
| TweakXL coverage (conditions, `$instances` templates, `.tweak` syntax, a malformed file: one of 46 pose YAML files failed a simple parse here) | Missing or extra poses | Report what couldn't be read in plain words in diagnostics; parity check against the menu's own list through the bridge (G1) |
| Helper-joint approximation until P4 | Visible creases or gaps at shoulders, hips and knees in strong poses | Say so in the Poses panel's help; P4 |
| Static hair and garments (no dangles, no garment support) | Hair "floats" in lying poses; body shows through clothes | Documented limits; later R&D |
| Props, weapons and vehicles not drawn | Empty-handed or seated-on-nothing poses | Badges; question Q7 |
| Whether `animationTime` is start or hold, and whether static poses loop | Wrong frame for the 27 non-zero records | G2 |
| Base versus EP1 puppet entity | Packs that target only the base entity show in the Studio but not in game, or the reverse | Follow the record's entity; G6 |
| Runtime-added poses | Invisible offline | Out of scope; the bridge could list the live menu later |
| Performance on very large installs | Slow first index | Lazy, cached index; listing never decodes |

## 10. In-game checks for the prepared session

Batch with the next session. Record the game version and the ArchiveXL, TweakXL and pose packs installed. The bridge's `photo.state` dump already reads the menu's option lists, which makes G1 automatic.

| # | Check | How | Decides |
|---|---|---|---|
| G1 | **The list matches** | Photo mode, V: dump attributes 5 (category) and 6 (pose) for every category with `photo.state`; the Studio exports its catalogue for the same profile | Counts, order and labels per category; which records the game drops |
| G2 | **Hold time and motion** | A vanilla quadruped pose with `animationTime` (e.g. on the cat), one mod record with `animationTime: 10`, one animated pose (Photo Mode Unlocker XL's `wp_hg_silver_01`): watch for 10 s, capture at 0 and 5 s | Whether `animationTime` is start or hold; whether animated poses loop |
| G3 | **Duplicate clip names** | Prepared offline: pick two installed packs whose sets share a clip name, apply the later pack's pose, capture | Which set wins |
| G4 | **Outfit filter** | V in a coat: is `idle_stand_01` (filtered for `Coat`) missing from the list? | The outfit filter default |
| G5 | **Helper joints** | Three poses (arms raised, kneeling, sitting cross-legged), V without clothing, close-ups of a shoulder, a hip and a knee under one light, against the Studio at the same framing | P4 priority and parity reference |
| G6 | **Entity** | With Phantom Liberty, read the photo-mode puppet's template path (the bridge's puppet probe) | Base versus EP1 entity |
| G7 | **Placement** | A swim pose (`positionOffset` z 0.35 / 0.85) against a standing pose, side view | Offset axes and sign |

## 11. Questions for the maintainer (with proposed defaults)

| # | Question | Proposed default |
|---|---|---|
| Q1 | List AMM-only custom poses (Lua collabs, invisible to photo mode)? | **No.** It would be a framework-specific adapter for a format the game doesn't load; four installed packs are AMM-only, and most AMM packs also ship photo-mode records. Revisit if AMM is to count as a core framework. |
| Q2 | Thumbnails? | **Not at first.** Live preview on keyboard selection instead; stick-figure silhouettes in P5 if wanted. |
| Q3 | Move the camera when a pose is chosen? | **No.** Keep the camera; "Frame V" and the whole-body view re-frame to the posed bounds. |
| Q4 | Follow the game's outfit filter (poses hidden while V wears a coat, collar or head cover)? | **Yes**, with the one-line "Show them" note when anything is hidden. |
| Q5 | The face during a pose: keep the creator idle's face (blinks, glances) or hold still like photo mode? | **Keep the idle's face** when it is on; the existing Face switch turns it off. |
| Q6 | Favourites per user (across workspaces and recipes), keyed by the pose record? | **Yes**, plus a Recent list. |
| Q7 | Poses that hold a weapon or prop, or ride a vehicle? | **Listed with a badge**; the Studio doesn't draw props. |
| Q8 | Offer the other body gender's poses? | **No**; they are authored on the other rig. |
| Q9 | Is the chosen pose part of a look or an export? | **No**, it is view state in the workspace, like the camera. Pose authoring and export would be a separate, later feature. |
| Q10 | Do the deformation-rig evaluator (P4) before the first release? | **After**: ship P0–P3 with the current helper-joint approximation, then P4 once G5 captures exist. |

## 12. Evidence and sources

All read-only. No installed file was changed, and nothing game-derived is committed.

| Source | Version / identity | Used for |
|---|---|---|
| Installed game | 2.31 | Archives and compiled TweakDB |
| REDmod TweakDB sources (`tools\redmod\tweaks\base\gameplay\static_data\`) | `database\photomode\poses.tweak` `972428eba1f033ef`, `posecategories.tweak` `fa3e97dcac1cc140`, `schema.tweak` `7a49bd729829463d`, `photomode.tweak` `59f5c82c158d713a`, `database\characters\player\player_photomode_record.tweak` `cde93f7a6ee9b40d` (SHA-256, first 16) | Record shapes, lists, puppet entities; 255 pose records (114 idle, 62 action, 76 natural, 3 other) |
| Compiled `tweakdb.bin`, `tweakdb_ep1.bin` | as installed | `femalePoses` 142, `malePoses` 143 (read with a scratch copy of `src/tweakdb-flats.ts` extended with `array:String`); pose record flats (`idle_stand_01`: `LocKey#27995`, category, time 0) |
| Game resources, intake of the [expressions study](expressions-evidence.md) | `photomode__female__idle.anims` `92241e5bdc7d297f`, `…__female__action.anims` `a005b98905230dfb`, `photomode__v_female__natural.anims` `e1e45e8671f7455a`, `woman_base_deformations.animgraph` `6ead74d604bae3bb`, `player_wa_photomode.ent`, `player_photomode.animgraph` `8063e1b6fe6dbceb`, `woman_base.rig` | Clip layout (all compressed, 2 frames, 71 joints; one clip is 116 animated + 4 raw + 112 constant keys, about 3 KB); set lists; graph nodes; the 71 rig joints and 13 tracks |
| WolvenKit CLI | 9.0.1, one `convert serialize` of `woman_base_deformations.animgraph` | Node census of the deformation graph |
| WolvenKit source | `11720772` (read only) | Compressed key layout, animation export and root-motion types |
| ArchiveXL source | `5474e34d` | `animations:` keys and merge; `PhotoModeScope.xl` |
| TweakXL source | `f8da6be` | File priorities, YAML tags and list operations |
| Reference MO2 profile | 920 enabled mods, read only | 44 packs with 1,907 pose records and 87 category records; list edits 1,510 female, 324 male, 86 category entries (mostly `!append-once`); display names literal in 1,902; `animationTime` non-zero in 27 of 2,079 records (all YAML records, including redefinitions); 45 mods whose `animations:` reach V's photo-mode entity (506 entries over all targets); 24 AMM custom-pose files in 23 mods |
| Photo Mode Pose Selector | 1.2.0 (`init.lua`, `README.md`) | Favourite keys, option capture, freeze and animated-pose evidence, the cross-category browser remark |
| Multi Pose Pack Framework | 1.0 (its `.ent` replacement, serialised in the expressions intake) | Legacy slot sets |
| AMM custom-pose files | Venus pose pack 1.0 (juztNea, per its pose file), and 23 others by count only | The Lua table format |

## Related pages

[Poses (knowledge)](../../knowledge/poses.md) · [Photo mode](../../knowledge/photo-mode.md) · [Facial expressions](../../knowledge/facial-expressions.md) · [Body rendering](../../knowledge/body-rendering.md) · [Expression editor design](expression-editor-design.md) · [CC idle](cc-idle.md) · [Idle controls design](idle-controls-design.md)
