# Photo-mode complete snapshots (work in progress)

**Status: WIP R&D (27 September 2026), paused for quota.** The goal is photo-mode "complete snapshots" that restore everything, unlike vanilla's three save slots, which lose details. The feature is planned as the first plugin on the XF Core runtime base, working name **XF Photo Mode**, succeeding Photo Mode Tools on its Nexus page. XF Core's own design is on `claude/xf-core-design`. This page holds the first offline findings. The design, the prior-art survey, the look-at research and the test plan are still to be written (see *Next*).

Grades follow the [knowledge rules](../../knowledge/README.md). **[offline]** marks our own reading of the maintainer's local saves, done read-only with the Studio's save container codec (`projects/xf-studio/authoring/src/engines/save/container.ts`). **[hypothesis]** marks anything not yet established.

## 1. Where vanilla keeps the three slots

- **The slots live in the save file, not in the game's settings** [offline]. Every 2.x save has the root nodes `photoModeSystem`, `PhotoMode_Settings`, `PhotoMode_QuestRequest`, `PhotoMode_NewStickersEditor`, `PhotoMode_LightSettings` and (from 2.3) `PhotoMode_OutfitWeather`. The slot contents change from one save to the next in time order: a quick save from 26 September 2026 has three filled slots, and older saves from other playthroughs have empty ones.
  - **Consequence:** a slot saved in photo mode survives only if the game is saved afterwards. Loading an earlier save brings back that save's slots, and each save or character has its own three. Saving works like this by design, but it is one way details "get lost" [offline; the player-visible effect is a hypothesis until tested].
- **Saving and loading are native.** The menu passes the hold actions `PhotoMode_SaveSettings` and `PhotoMode_LoadSettings` to the native `OnHoldComplete(attributeKey, action)`. No script decides what is saved or restored [source] 2.31 `photoModeMenuController.script` (lines 835–846 of the decompiled file).
- `photoModeSystem` is a VLQ count followed by that many 8-byte TweakDBIDs (18 in the latest save), probably the unlocked photo-mode items (`UnlockPhotoModeItem`) [offline layout; meaning hypothesis].

## 2. What a slot holds (`PhotoMode_Settings`, 2.31)

The node holds a u32 count (3), then three slot records, then a **second** array of three records that is empty in every save seen. Array counts inside a record are the save format's packed integers (VLQ). A record contains, in order [offline, decoded from three filled 2.31 slots and three filled 2.21 slots]:

| Field | Encoding | Notes |
|---|---|---|
| Label | Save string | The date and time of saving, e.g. `25/09/2026 17:22:31`; empty in an unused slot |
| **Attribute values** | VLQ count, then that many float32 values, indexed by attribute key | **94 in 2.3x (keys 0–93), 69 in 2.21 (keys 0–68):** exactly the vanilla key range of that game version. Values seen match the menu: key 1 FOV (24, 35), 5 pose category, 6 pose, 9 close/far (−0.17), 15 look-at camera, 16 camera type, 27 character visible, 33 autofocus, 42 camera speed, 54 surrounding NPCs, 70 time of day (1321 = 22:01), **74–76 look-at body part and angles** (e.g. 2, 30, 42), 83–91 colour balance |
| Stickers | VLQ count (10), then 10 × 16 bytes | All zero in every slot seen |
| Pose category | i32 | Repeats key 5; −1 in an unused slot |
| **Pose identity** | Save string `<animationName>__<time>` | e.g. `solo_pose1__0.000000`, `aw_psrp_01__0.000000`, `CrossArms__0.000000` (mod poses): the pose by clip name, not only by list index |
| Camera | 7 float32 | Probably pitch and yaw in degrees (roll 0), a position relative to V in metres, and the FOV again. The values are small (e.g. −0.80, −1.66, 0, 1.55, 1.67, 0.04, 24), so the camera is stored **relative to V**, not in world space [offline; meaning hypothesis] |

What this means for the complaint:

- **Not stored at all** [offline]: anything keyed above the vanilla range. That covers every Photo Mode Ex attribute: V's pitch and roll (3421, 3422), control scheme and snap to terrain (3401, 3402), the NPC appearance and extra NPC placement rows (3431–3433). It also covers everything other mods add (AMM props and NPCs, CharLi or spawned lights, IK and limb tweaks) and anything the bridge sets outside the menu. On the reference profile, V's pitch and roll come from Photo Mode Ex, which fits "head position lost" if the maintainer used those rows [hypothesis].
- **Stored, but only one value per key** [offline]: the NPC rows (55–57, 60–62, 65, 66) have one value each. Photo mode has three NPC slots, so at most the selected NPC's values can come back. The other two NPCs are lost, unless `PhotoMode_OutfitWeather`'s three inner entries per slot are per-NPC data [hypothesis].
- **Stored, possibly overridden on load** [hypothesis]: look-at body part and angles (74–77), expression (28) and V's yaw and offsets (7, 8, 9, 37) are in the slot. If the maintainer's head and eye direction still don't come back, the likely cause is ordering. Applying the pose re-applies the pose record's own `lookAtPreset`, `positionOffset` and `rotation`, which could reset look-at and placement after the slot values are set. This is the first thing to check in game.
- **Pose by index:** keys 5 and 6 are list indices, and they shift whenever pose packs are added or removed. The stored clip name gives the native loader a way to find the pose again, but whether it uses the name is not known [hypothesis].
- **Old game versions:** the attribute count grew from 69 to 94 between 2.21 and 2.3, and the light record shrank. A slot saved under an older version keeps only the keys that version had [offline].

## 3. Lights and the other per-slot nodes

- **`PhotoMode_LightSettings`** holds three slots of three light records, then three 42-byte entries per slot (containing a 0x34 byte and a u64 −1) [offline].
  - The 2.3x light record is 58 bytes. The values seen, all defaults, include 0.5, 180, 135, 45, a bool, 10, 500 and 10000: colour, cone angles, brightness and range in the engine's units [hypothesis].
  - **In 2.21 the record was about 110 bytes and included a world position and rotation**, e.g. (−570.0, 805.2, 26.9). No 2.3x save seen has a non-default light, so whether 2.3x slots still store light positions is open.
- **`PhotoMode_OutfitWeather`** (2.3+): three slots, each with an inner count of 3 and entries holding 1.0 values. The outfit and weather semantics are not decoded [hypothesis].
- **`PhotoMode_NewStickersEditor`**: three slots of 10 sticker indices (−1 = empty) [offline].

## 4. The look-at freeze trick (interim)

- **What the two mods do** [source]:
  - The legacy Photo Mode Tools init script sets `GameOptions.SetFloat("LookAt", "MaxIterationsCount", …)` to 1.0 on init. Its freeze toggle switches between 0.9 and 1.0, and restore and shutdown write 3.0. It never reads the value that was there first.
  - Appearance Menu Mod writes the same values (`Release/bin/x64/plugins/cyber_engine_tweaks/mods/AppearanceMenuMod/Modules/tools.lua:484-491`).
- **CET passes the float through unchanged** [source] CET `9a8522f` `src/scripting/GameOptions.cpp:107-110, 133-145, 264-278`.
  - It calls the engine's own option setter with the float type and logs an error if the engine refuses it. So the idea that CET truncates 0.9 to 0 is ruled out.
  - The option is an engine config variable with a value, minimum, maximum and default (`GameOptions.h:3-56`, `OptionsPatch.cpp:9-38`). It is not in `engine/config` [resource, negative search], and CET never writes it to disk.
- **Why 0.9 freezes** [hypothesis]: the engine rounds the value down to an iteration count (or tests it against 1). Below 1 the look-at solver doesn't run, and the last look-at pose holds. The option is global by construction, so it affects every character's look-at until reset. Whether 3.0 is the engine default is unconfirmed; `GameOptions.Print("LookAt", "MaxIterationsCount")` in game would show the type, value and default.
- **Interim ranking:**
  1. Actor-scoped, if the in-game test passes: a `LookAtAddEvent` with a static target on the photo-mode stand-in, with per-part weights for eyes, head and chest; or "look at camera" off plus `AnimFeature_PhotomodeBodyPartRotate` for the head. Poses open questions 8 and 10 must be answered in game first.
  2. Otherwise the global option, fully managed: read the original before the first write, apply it only while photo mode is open, and restore the original on exit, save load, CET reload or shutdown, session end and the kill switch.
- Still open: other freeze mods on the reference profile, the script and TweakDB side (`LookatPreset` records, attributes 15 and 74–77), and Photo Mode Ex.

## 5. Direction so far (to be expanded)

- **Snapshot = the full state, read live through XF Core:** every menu attribute including modded keys (the bridge's `photo.state` already lists 92 items with values); V's stand-in transform, head slot and look-at (`photo.subject`); the camera transform; lights; NPCs; and plugin-owned state (spawned lights from the shared light host).
- **Restore in dependency order, with waits.** The first draft is: camera type and character; pose category, a few ticks, then pose (as `photo.pose.set` already does); wait for the pose; expression; V's placement; look-at part and angles; NPCs; lights (select, wait, set, as Photo Mode Preferences does); environment and effects; camera last. The exact waits come from the first session.
- **Storage:** named snapshot files outside the game and its saves, with a thumbnail, in a versioned format (`xfp/photo-snapshot-1`). The lights section is the lighting mirror's `xfs/lighting-setup-1`, so a Studio lighting setup and a snapshot's lights are the same data. Partial restore works per section (pose, camera, lights, environment, effects, NPCs).
- **Safety:** attach-only, nothing written into saves, frameworks never touched. The plugin never writes the vanilla slots.

## Next (when resumed)

1. Finish the prior-art survey: Photo Mode Ex's per-save values and native save/load addresses, AMM, Photo Mode Preferences' ordering, other installed photo-mode mods. Credit what teaches us.
2. Look-at: what the global `LookAt/MaxIterationsCount` trick does, the mods that freeze head and eyes, and the actor-scoped replacement. Write it into `knowledge/photo-mode.md`.
3. The full design: the XF Core services the plugin needs (see below), phases and effort, questions for the maintainer.
4. The first session's test plan: build a detailed setup, capture it with our tool and with a vanilla slot, reload both, and diff the attribute tables and the decoded save slot.
5. Move §1–3 into a knowledge page section once reviewed, and add backlog entries.

## Services XF Photo Mode needs from XF Core (first list)

- **Studio link:** the bridge's command API and permission classes (`read`, `write-photo`), write gate, undo and kill switch.
- **Photo-mode model:** read and write menu attributes by key, including modded keys, with validation against the menu's own options. Also a phase/event feed (photo mode opened or closed, save loaded, CET reload) and the stand-in and camera catch (`photo.subject`).
- **Snapshot store:** a per-user data folder outside the game and saves, with versioned JSON, thumbnails from a capture, and listing, rename and delete.
- **Sequencer:** scripted apply with tick waits and per-step confirmation, for the restore order.
- **CET overlay framework:** a panel host for the in-game UI (the test builds' Reconnect panel is the seed).
- **Light host:** the spawned light entity shared with XF Lighting, the lighting mirror's route.
- **Settings guard:** capture and restore of any global engine option a plugin changes (for example the look-at option) on photo-mode enter and exit and on every session transition.
