# XF Photo Mode: complete snapshots

**Status: R&D design (27 September 2026). Nothing is built, and nothing has run in game.** The complaint: photo mode's three save slots "don't actually save everything". After setting a pose and then fine-tuning head position, eye direction and other details, restoring the slot loses about half of them. This page designs **complete snapshots** as the first plugin on the XF Core runtime base, working name **XF Photo Mode**. It succeeds Photo Mode Tools on its Nexus page, and Photo Mode Tools stays independent of XF Studio. XF Core's own architecture is designed on `claude/xf-core-design`; §6 lists what this plugin needs from it.

The graded facts are in [knowledge/photo-mode.md §9–10](../../knowledge/photo-mode.md#9-the-three-save-slots). Grades follow the [knowledge rules](../../knowledge/README.md). **[offline]** marks our read-only decoding of the maintainer's local saves with the Studio's save container codec.

## In brief

- **The vanilla slots lose things for five reasons** [offline] [source]:
  1. They are **stored in the save file**, so they belong to one save and are lost if the game isn't saved afterwards.
  2. They store **only the vanilla attribute keys** (94 floats in 2.3x), so every Photo Mode Ex row is dropped: V's pitch and roll, NPC pitch, roll and appearance.
  3. They hold **one value per key for three NPCs**.
  4. Look-at, expression and placement are stored, but **the pose's own setup (`UpdatePoseDependents`) can reset them** if the replay doesn't wait for the pose [hypothesis for the slot load itself].
  5. Poses are partly **stored by list index**, and the indices shift when pose packs change.
- **Feasible.** XF Core's native side can read and write any attribute, modded keys included, with the same native `GetAttributeValue`/`SetAttributeValue` calls Photo Mode Ex uses. The bridge already reads the menu (`photo.state`), V's stand-in and the camera (`photo.subject`), sets poses with waits (`photo.pose.set`) and drives lights. A snapshot records all of that, **plus the resulting state** (the stand-in's transform and the camera's world transform). The restore then replays in dependency order, waits for each stage to settle, and **verifies the result against the recorded state**, retrying a stage that was reset.
- **Snapshots are files, not slots:** unlimited, named, with a thumbnail, outside the game and its saves. They restore in part (pose, camera, lights, look-at, NPCs, environment, effects), carry between saves and characters where that makes sense, and share their lights section with the lighting mirror (`xfs/lighting-setup-1`).
- **Head and eye freeze:** replace the global `LookAt/MaxIterationsCount` trick with a per-character freeze (individual time dilation that follows the frozen world, proven in Photo Mode Pose Selector). Keep the global option only as a guarded fallback (§4).
- **Effort:** about 9–12 agent-days to a first release (S0–S3), plus two supervised sessions (§8). There are ten questions for the maintainer, each with a proposed default (§9).

## 1. What the vanilla slots keep

| Setting | Stored in the slot? | Restored reliably? | Grade |
|---|---|---|---|
| Pose category and pose | Yes: keys 5 and 6 (list indices), plus the clip name `<animationName>__<time>` | Indices shift with pose packs; the clip-name fallback is unknown | [offline]; restore [hypothesis] |
| Pose time (`animationTime`) | Probably, as the `__<time>` suffix | Unknown | [offline]; meaning [hypothesis] |
| V's yaw, left/right, close/far, up/down (7, 8, 9, 37) | Yes | Pose application may reset them | [offline]; [hypothesis] |
| V's pitch and roll (Photo Mode Ex 3421, 3422) | **No** | — | [offline] [source] |
| Look at camera (15), look-at part and angles (74–77) | Yes | Pose application resets look-at state | [offline]; [source] native character fields; reset on load [hypothesis] |
| Expression (28) | Yes | Probably reset with the pose | [offline]; [hypothesis] |
| Eye direction beyond the menu (IK, look-at events) | **No** | — | [offline] |
| Camera type, FOV, roll, DOF, focus, aperture (16, 1, 2, 26, 33, 3, 4) | Yes | Unknown | [offline] |
| Camera transform | Yes: 7 floats, relative to V [hypothesis] | Follows V's placement; unknown | [offline] |
| Effects, colour balance, vignette, grain, aberration (10–14, 24, 25, 64, 84–93) | Yes | Unknown | [offline] |
| Stickers and frames (35, 22, 34) | Yes (sticker node, 10 per slot) | Unknown | [offline] |
| Photo-mode lights 1–3 (43–53) | In `PhotoMode_LightSettings`: 3 records per slot | Positions stored in 2.21; open in 2.3x | [offline] |
| Time of day, weather, game speed (70, 69, 71) | Yes (keys); `PhotoMode_OutfitWeather` also exists | Unknown | [offline] |
| Character visible, outfit (27, 83) | Yes | Unknown | [offline] |
| NPC characters 1–3 (55–57, 60–62, 65, 66) | One value per key: at most one NPC | The other NPCs are lost | [offline] |
| NPC pitch, roll, appearance (Photo Mode Ex 3431–3433) | **No** | — | [offline] [source] |
| AMM props and NPCs, CharLi or other spawned lights | **No** | — | [offline] |
| Photo Mode Ex control scheme, snap to terrain, DOF (3401, 3402) | No; Photo Mode Ex keeps these per save itself | Placement shifts with the scheme | [source] |

## 2. Prior art

| Mod | What it saves or restores | What we take | Grade |
|---|---|---|---|
| **Vanilla slots** | 3 per save, in the save file, vanilla keys only (§1) | The failure list; the camera stored relative to V | [offline] |
| **Photo Mode Pose Selector** (cjsu, 1.2.0) | **Saved positions** for V and NPCs (yaw, left/right, near/far, up/down) in SQLite. It captures each character by switching the menu page and selection and waiting for fresh values, then restores the original page. It freezes one character by time dilation, auto-releases on pose, category or expression changes, and re-applies V's look-at 3 frames (0.05 s) after events that reset it. It also keeps pose favourites | Per-character capture by page switching; settle waits; the per-character freeze; look-at re-application after a reset | [source] `init.lua:19-32, 72-73, 329-400, 976-996, 1469-1760` |
| **Photo Mode Preferences** (cjsu, 0.1.1) | Re-applies preferred settings when photo mode opens. For lights: select, wait two frames, set, then restore the selection | Light ordering; its lesson that re-applying on open can race other changes | [source] `init.lua:772-810` |
| **Photo Mode Ex** (psiberx, MIT, `dd1245b`) | Its own per-save state (`alternativeControls`, `snapToTerrain`, `depthOfField`); pitch and roll kept in a per-character map that is not persisted | The native attribute calls, the character layout (relative position, rotation, look-at fields, spawn transform) and the address-library IDs; the reason slots miss its rows | [source] |
| **Appearance Menu Mod** | Saved locations (JSON), props, lights and NPCs; the global look-at option | The global option's values; spawned-entity handling | [source] |
| **CharLi** (FreakaZ, +FlowerD per its script headers) | Light rigs, removed when a save loads | Following the stand-in (already in the lighting mirror) | [installed] |
| **Photo Mode Tools** (legacy, this project's predecessor) | Only the look-at freeze through the global option | Replaced by §4 | [source] |

Credits are in [community credits](../../docs/community-credits.md).

## 3. Capturing and restoring through XF Core

### 3.1 The snapshot (`xfp/photo-snapshot-1`)

One JSON file per snapshot, in a user data folder XF Core provides (never the game folder, a save or the mod manager's folders), with a PNG thumbnail beside it. Sections:

| Section | Contents | Source |
|---|---|---|
| `meta` | Name, time, game and plugin versions, the attribute key map with labels, the character (gender, V or Johnny), the save's player name only if the user opts in | `bridge.info`, `photo.state` |
| `pose` | Category and pose **by record id and clip name** (`PhotoModePoses.*`, `animationName`, `animationTime`), with the menu indices only as a hint; the stand-in's freeze state | `photo.state` + the pose list's option data |
| `placement` | V's attribute values (7, 8, 9, 37, 3421, 3422), **plus the result**: the stand-in's world transform and its transform relative to photo mode's spawn point (native `spawnPosition`/`spawnOrientation`) | `photo.subject`, native character fields |
| `look` | 15 and 74–77, the expression (28 and the face index), plus the result: the head and eye world directions | `photo.subject` (head slot); the eye bones [hypothesis] |
| `camera` | Type, FOV, roll, DOF, focus, aperture, collision; the camera's world transform and its transform relative to V | `photo.subject` |
| `npcs[3]` | For each NPC slot: character record, appearance (3433), pose, expression, placement values and result transforms, captured by selecting each NPC as Photo Mode Pose Selector does | menu page switching |
| `lights` | The three photo-mode lights (43–53) and any XF-hosted lights, as `xfs/lighting-setup-1` with native values | `lights.read` (lighting mirror L1/L2) |
| `environment` | Time, weather, game speed, surrounding NPCs | keys 69–71, 54 |
| `effects` | Exposure, contrast, highlights, vignette, grain, aberration, colour balance, effect, stickers, frame, aspect ratio, black bars | the remaining keys |
| `unknown` | Every other attribute the menu reports, by key and label, so a new mod's rows are kept generically | `photo.state` |

Keys are stored with their **labels and option texts**, and restore matches options by record or text before index. That keeps snapshots valid when pose packs or row-adding mods change. There is no per-mod code: Photo Mode Ex rows are just keys the menu reports.

### 3.2 Restore order

Each stage writes, waits for its effect, then **verifies against the recorded result** and retries once. A stage that still differs is reported in plain words ("V's head turned back when the pose applied; restored it again"), never silently skipped.

1. **Preflight:** photo mode is open (XF Photo Mode never opens it itself in the release build), the character matches or the user accepted a mismatch, and the menu's options are listed.
2. **Camera type and character visibility** (16, 27).
3. **Pose:** category, 3 ticks, then pose (`photo.pose.set`'s sequence). Wait until the pose attribute reads back and 3 frames have passed (Photo Mode Pose Selector's settle time), because `UpdatePoseDependents` runs here and resets look-at and placement.
4. **Expression** (28), then wait 2 frames.
5. **Placement:** yaw, left/right, close/far, up/down, pitch, roll. Verify the stand-in's transform against the recorded result. If the spawn point differs (another location), keep the recorded offsets relative to the spawn point.
6. **Look-at:** 15, then 74–77, and wait 3 frames. Verify the head direction and re-apply once if the pose reset it.
7. **Freeze** the stand-in if the snapshot was frozen (§4).
8. **NPCs**, one slot at a time: select, then pose, expression, placement and look-at in the same order.
9. **Lights:** select, 2 frames, set, restore the selection; XF-hosted lights through the light host.
10. **Environment**, then **effects**.
11. **Camera last**, because it is relative to V: FOV, roll, DOF, then the world transform when the camera entity can be placed (knowledge/photo-mode.md §4, open question 4), otherwise the relative values. Verify by projecting V's head, as `photo.frame` does.

The exact tick counts come from the first session (T5). The sequencer takes them from data, not code.

### 3.3 Partial restore and portability

- **Partial:** any subset of sections. A pose-only restore keeps the current camera and lights; a camera-only restore keeps V. The dependencies are explicit: restoring look-at alone after a pose change still waits for the pose to settle.
- **Between saves and places:** placement and camera are stored relative to V and to photo mode's spawn point, so a snapshot works anywhere with enough space. World-absolute restore (the same street corner) is an option that needs a teleport, and is off by default.
- **Between characters:** a pose carries if the other body gender's list has the same record; otherwise the restore reports it and leaves the pose alone. Expressions carry by face record. NPC sections need the same NPC records (Photo Mode Ex's extra characters are records too).
- **Sharing:** a snapshot file is plain JSON with no save data or personal paths, so it can be shared. Thumbnails are the user's own capture.

### 3.4 Safety

- Attach-only; the maintainer or player starts the game. XF Photo Mode acts only while photo mode is open.
- **It never writes the vanilla slots or any save.** Snapshots live outside the game; the per-character freeze and look-at changes vanish when photo mode closes.
- It never touches the user's frameworks: CET, RED4ext, redscript, Codeware and Photo Mode Ex are detected and reported, never installed or changed. Photo Mode Ex rows are used when present.
- A global engine option (the look-at fallback) is changed only through XF Core's settings guard (§4).
- Bounded: at most 256 attributes per snapshot, files at most 1 MB, and thumbnails downscaled.

## 4. Head and eye freeze

The findings are in [knowledge §10](../../knowledge/photo-mode.md#10-holding-the-head-and-eyes). Ranked plan:

1. **Per-character freeze (proper route).** On the photo-mode stand-in (and each NPC puppet on request), `SetIndividualTimeDilation(n"xf_photo_freeze", 1.0, 0.0, n"None", n"None", false, false)` makes the character follow the frozen world's dilation. That stops its graph, so look-at and blinks hold. Release with the same call and `ignoreGlobalDilation = true`, never with `UnsetIndividualTimeDilation` (which would also drop another mod's reason [hypothesis]). Release automatically before a pose, category or expression change and re-freeze after the settle. Release on photo-mode exit, save load, CET reload and the kill switch. It is proven in Photo Mode Pose Selector [source]; our own session must confirm it doesn't affect the other characters (T7).
2. **Exact head and eye direction:** snapshot 74–77 and re-apply them after the pose settles (§3.2 stage 6). For a direction the menu can't express, `LookAtAddEvent` with a static target, or the head rotation inputs; both are research until [poses](../../knowledge/poses.md) open question 8 is answered.
3. **Global option, guarded (fallback only, if 1 fails in game).** XF Core's settings guard reads `LookAt/MaxIterationsCount` before the first write. It writes 0 only while photo mode is open and a freeze is requested, and restores the **original** value (not a hard-coded 3.0) on unfreeze, photo-mode exit, save load, CET reload or shutdown, session end and the kill switch. It records the original value in a small crash-recovery file, so the next start restores it if the game died mid-freeze. It is off by default and labelled "freezes every character's gaze".

## 5. Where the UI lives

- **In game (first):** a panel in the CET overlay, built on XF Core's overlay framework, shown only in photo mode. It has a list of snapshots (thumbnail, name, date, character), **Save snapshot** (named automatically from the pose and time, and renameable), **Restore** with section checkboxes (all ticked by default), rename, delete (with undo until the panel closes), and **Freeze gaze**. Progress shows in place while a restore runs ("Pose… placement… camera"), and a stage that needed a retry says so in plain words. A hotkey saves a snapshot without opening the overlay.
- **In XF Studio (later):** a snapshot browser over the Studio link. The Studio lists and edits the same files, restores through the bridge, and turns a snapshot's lights into a Studio lighting setup (the same data). The Studio is one more client; the plugin works without it.
- **Independence:** XF Photo Mode depends on XF Core only, never on XF Studio.

## 6. Services needed from XF Core

| Service | Why | Exists today as |
|---|---|---|
| Photo-mode model: read and write attributes by key (modded keys included), options with labels and data, select page and NPC | Capture and restore everything, generically | `photo.state`, `photo.camera.set`, `photo.pose.set`; native `Get/SetAttributeValue` to add |
| Subject and camera reads: stand-in and NPC puppet transforms, head slot, camera world transform, spawn point | Record results, verify stages, relative placement | `photo.subject`; the native character fields to add |
| Event feed: photo mode opened or closed, save loaded, CET reload, session end | Freeze release, guard restores, UI visibility | Partly (game phase) |
| Sequencer: steps with frame and time waits, read-back checks, retries, cancel | The restore order | `photo.pose.set`'s internal sequence; generalise |
| Snapshot store: user data folder, versioned JSON, thumbnails, list, rename, delete, import and export | Files outside the game | New |
| Capture: a thumbnail of the game view without the menu | Snapshot thumbnails | `photo.hud.hide` + `capture` (tools side); an in-game capture to add |
| CET overlay framework | The in-game panel | The test builds' Reconnect panel |
| Light host | XF-hosted lights in snapshots, shared with XF Lighting | Lighting mirror L2 |
| Settings guard | Capture and restore any global engine option | New (look-at fallback) |
| Write gate, undo, kill switch, permission classes (`read`, `write-photo`) | Safety | Existing bridge |
| Studio link | The later Studio browser | Existing bridge pipe and MCP |

## 7. First game-session test plan

**Before the session (agent side):** S0 and S1 built (the read-only snapshot capture and the save-slot decoder as a tool); a session script `photo-snapshots-1.json`; a disposable save at an open outdoor spot; Photo Mode Ex present (it is on the reference profile). The evidence manifest is `xfp/snapshot-session-1`: every capture's snapshot JSON and SHA-256, `photo.state` dumps, `photo.subject` reads, the build commit, the CET, RED4ext, Photo Mode Ex and game versions, and the decoded save slot before and after.

**Player checklist:** load the disposable save, open photo mode with the photo-mode key, and say when ready. The script stops at each *ask*.

| Step | What happens | What it answers |
|---|---|---|
| T1 | `game.options.read`; `GameOptions.Print("LookAt", "MaxIterationsCount")` via the CET layer | The option's type, value and default |
| T2 | The script builds a detailed setup: a mod pose, expression, yaw 30°, left/right and up/down offsets, pitch and roll (Photo Mode Ex), look-at eyes with angles, FOV 35, DOF on, two NPCs with poses and placements, light 1 on and coloured, time 21:00, grain 0 | A known reference state |
| T3 | Capture A: our snapshot. *Ask:* save to vanilla slot 1 (hold the save key on the slot) | Both captures of the same state |
| T4 | The script resets everything (camera preset, pose, NPCs off). *Ask:* load vanilla slot 1. Then capture B (our read of what the slot restored) | **The diff A vs B: exactly what the vanilla slot loses** |
| T5 | Reset again; restore snapshot A with our sequencer, logging each stage's read-back and retries. Capture C | The diff A vs C (our restore); stage timings; which stages the pose resets |
| T6 | *Ask:* quick save. The tools decode the save's `PhotoMode_Settings` and `PhotoMode_LightSettings` and compare them with A | The slot layout's field meanings (camera floats, light positions in 2.3x, the second array, `OutfitWeather`) |
| T7 | Freeze gaze (per-character route), move the camera around V, capture twice; check that NPC 1's gaze still follows. Change the pose (auto-release and re-freeze). Then the global option at 0.9 with the guard, the same checks, exit photo mode and read the option back | The freeze routes; whether the global option affects NPCs; the guard's restore |
| T8 | Restore snapshot A partially: camera only, then pose only | Partial restore and its dependencies |
| T9 | Load the safety save; read the option and confirm no XF state remains | Cleanup |

**Success:** A vs C matches within 1 cm and 0.5° for V and the NPCs, within 0.5° for the camera, and exactly for every other attribute. Any stage needing a retry is recorded with its cause. The A vs B diff is written into knowledge §9 as runtime evidence.

## 8. Phases and effort

| Phase | Scope | Effort |
|---|---|---|
| S0 | Offline: the snapshot schema and types, the save-slot decoder as a tool (`PhotoMode_*` nodes → table) with tests on the local saves, sequencer data format | S, 1–1.5 days |
| S1 | Read-only capture through the bridge: all attributes with labels, subject and camera results, NPC capture by page switching, light reads, the diff tool | M, 2–3 days |
| — | **Session 1** (§7, about 40 minutes) | Maintainer |
| S2 | Restore: the sequencer with read-back checks and retries, partial restore, the per-character freeze, the settings guard fallback | M, 3–4 days |
| S3 | XF Photo Mode on XF Core: the CET overlay panel, snapshot store, thumbnails, hotkey, packaging as a plugin | M, 3 days (after XF Core's overlay and store exist) |
| — | **Session 2:** the release candidate in normal use | Maintainer |
| S4 | Studio browser; lights as Studio setups; world-absolute restore with teleport; camera entity placement | M–L, later |

S0–S3 is about 9–12 agent-days and two sessions.

## 9. Questions for the maintainer

| # | Question | Proposed default |
|---|---|---|
| 1 | XF Photo Mode as XF Core's first plugin, released on the Photo Mode Tools Nexus page as its successor? | Yes |
| 2 | Freeze gaze by the per-character route, with the global option only as a guarded fallback? | Yes |
| 3 | Where do snapshot files live: a user data folder XF Core owns (for example under the user's documents), or beside the mod in the game folder? | XF Core's user data folder, never the game folder, so mod managers and game updates never touch them |
| 4 | Store placement and camera relative to V (works anywhere), or world-absolute (same spot, needs a teleport)? | Relative; world-absolute as an option later |
| 5 | Capture NPCs by switching the menu's selection (brief visible flicker of the menu page)? | Yes; the page is put back afterwards |
| 6 | Should XF Photo Mode ever write the vanilla slots (for example "copy to slot 1")? | No |
| 7 | Include the save's player name or location in snapshot metadata? | No by default (shareable files); optional |
| 8 | Is a CET overlay acceptable for the first UI, or should it wait for a native photo-mode page? | CET overlay first |
| 9 | Keep a snapshot's pose if the pose pack is missing (report it and restore the rest)? | Yes |
| 10 | Ship S0–S1 in the test builds only, before the plugin exists? | Yes |

## Related

[knowledge/photo-mode.md](../../knowledge/photo-mode.md) · [knowledge/poses.md](../../knowledge/poses.md) · [knowledge/photo-mode-lights.md](../../knowledge/photo-mode-lights.md) · [lighting mirror design](lighting-mirror-design.md) · [runtime bridge design](runtime-bridge-design.md) · [save editor design](../save/save-editor-design.md) · [Photo Mode Tools](../../projects/xf-photo-mode-tools/README.md)
