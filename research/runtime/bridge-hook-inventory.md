# Runtime bridge hook inventory

**Status:** 30 September 2026, written for XF Runtime Bridge 0.7. Every game hook or capability the research, designs, friction logs and backlog have said we'd want, ranked, with what 0.7 builds. Nothing here has been seen in game yet: 0.7 is built and tested offline only, and its [session-8 checks](runtime-bridge-test-card.md#session-8-checks-bridge-07) prove it. Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[source]** read in decompiled 2.31 scripts or framework source, **[runtime]** seen in game, **[hypothesis]** not yet established.

## How the ranking works

- **Value** is to the 1.0 bar or to queued in-game work: a hook that unblocks a prepared capture or removes a player step in the next sittings ranks above one a later feature will need.
- **Reads before writes.** The agent's own view of the game (AGENTS.md) comes first, then reversible writes under the existing write classes, each answering with its undo.
- **Risk** counts what a wrong call costs: a script-only read is low; a write that reaches a save, or a native hook on the render thread, is higher and ships off or behind a class.
- **Session 7's findings** (30 September, bridge 0.6.1) rank at the top where they are bugs or player friction: the finish-before-widening rule puts fixes first.

Write classes are the bridge's own ([design §4](runtime-bridge-design.md#4-safety-model)): `read`, `notify`, `write-photo`, `write-world`, `write-character`, `write-inventory`, `write-save`, `write-showroom`, `write-player`, `act-player`, `control`. Every write answers `undo {method, params}` or `undo: null` with a note.

## The ranked list

| # | Hook | Speculated in | Value | Feasibility (route, layer, risk) | Class and undo | 0.7 |
|---|---|---|---|---|---|---|
| 1 | **Safe reads of world objects** (what V looks at, NPC names) | Session 7 crash: `player_state` looking at a door ended in `exe+0x60a893` ([game crashes §2.4](../../knowledge/game-crashes.md#24-a-string-operator-with-a-null-operand-session-7)) | High: `player_state` and `scene_read` crashed or could crash | The world-object rule: only entity-level natives on objects of unknown type, the record name only after a cast to `gamePuppetBase` or `VehicleObject`, no display-name or interaction natives; the HUD prompt read from the `UIInteractions` blackboard instead. redscript, low | read | **Built** |
| 2 | **Scene tiers instead of `IsEntityInScene`** | Session 7: moves refused in V's apartment (tier 2) and on a walkway in The Pickup (tier 1) | High: every player move refused in ordinary play | The player state machine's high level (`gamePSMHighLevel`, `GameplayTier`) plus `IsEntityInDialogue` [source] `highLevelTransitions.script`, `orphans.script:3105, 6685`. redscript, low | read (player.state `tier`, `staged_scene`) | **Built** (with main's hot fix) |
| 3 | **In-game answers: Ready, Yes, No, choices; comments** | Session 7: the maintainer can't see the chat with the game in front; [friction log, session 5](../../experiments/032-sessions-5-6/README.md#7-friction-logs) ("relays in-game observations by typing in chat") | High: every "ask" row in a session | `ui.message {level: "ask", choices}`; the ink panel shows a key per answer and Codeware's raw key callback (`Input/Key`) answers; the CET window has buttons and a comment box; natives `XFBridge_Answer`, `XFBridge_Comment` push `answer` and `comment` events; `session.wait` blocks on them. Low | notify / read; nothing to undo | **Built** |
| 4 | **Arm cyberware read** (`cyberware.state`) | [Render gap plans §5, capture C6](../character-customization/render-gap-plans.md#5-arm-cyberware); [N10.1](next-sessions-plan.md#n10-inventory-cyberware-bare-body-clothing) | High: the arms' holster state is the one body group the preview can't choose | `EquipmentSystemPlayerData` slots per area, `WeaponItem_Record.HolsteredItem().AppearanceName()`, the `RightArm` and `WeaponRight` attachment slots, the `NoArmsCW` tag [source] `equipmentSystem.script:2543-2617`, `orphans.script:15553`. redscript, low | read | **Built** |
| 5 | **Arm cyberware equip and draw** (`cyberware.equip`, `cyberware.unequip`, `player.action weapon.arms`) | C6: "the bridge can't equip cyberware yet"; N10.1 | High: removes the ripperdoc trip from C6 and N10 | The ripperdoc's own `EquipRequest` / `UnequipRequest` [source] `ripperdoc.script:1231-1443`; `RequestActiveMeleeware` for the drawn arms [source] `quickSlotsManager.script:471`. redscript, medium: changes V's stats until undone, reaches a save (the save lock holds) | write-inventory; the earlier item back, or the slot emptied and an added item removed; weapon.holster | **Built** |
| 6 | **UI state for agents** (`ui.state`) | AGENTS.md (the agent's own view); session 4's teeth frames lost to the CET overlay ([render gap plans §8](../character-customization/render-gap-plans.md#8-capture-requests-one-prepared-session)); the overlay study's yield rule | High: pre-capture checks and knowing what is on screen | Blackboards `UI_System`, `UIGameData`, `UIInteractions`; the CET layer reports its overlay (`XFBridge_CetOverlay`); the plugin adds the XF panels and the overlay host. Low | read; captures warn when CET's overlay is open | **Built** |
| 7 | **XF ImGui overlay host, P0** | [Overlay feasibility §8](imgui-overlay-feasibility.md#8-the-minimal-first-prototype-and-its-test-card-planned-only); backlog "Queued R&D: in-game overlay" | Medium-high: the base for in-game tools (answer buttons with a mouse in P1, gizmos, the lighting controller) | A chained detour on `GpuApi::Present` through RED4ext's hooking API, drawing on the engine's direct queue; `ResizeBackbuffer` and the render shutdown hooked; refused in HDR; the XF Studio theme generated from the Studio's tokens. RED4ext native, render thread: medium-high, contained by off-by-default, the refusal checks and a structured-exception guard | read (`overlay.state`); notify (`overlay.hide` for captures) | **Built (P0)** |
| 8 | **World state** (`world.state`: clock, rain, weather state, quest facts, photo mode's scene rows) | [Design §7.5](runtime-bridge-design.md#75-world-and-player) (weather); [quests and story §3](../../knowledge/quests-and-story.md#3-a-minimal-quest-recipe) (facts) | Medium: session records, weather-dependent captures | Vanilla `TimeSystem`, `WeatherSystem` rain; Codeware `GetWeatherState` / `GetEnvironmentDefinition`; `QuestsSystem.GetFactStr`. redscript, low | read | **Built** |
| 9 | **Streaming and sector probes** (`world.probe`, observe only) | [Player control §2.2](player-control-design.md#22-moving-v) (far jumps); [world and streaming §3.3](../../knowledge/world-and-streaming.md#33-the-runtime-bridge); autonomy rank 8 (a studio spot) | Medium: choosing a spot before a teleport, glide or showroom | `NavigationSystem.IsNavmeshStreamedInLocation`, `FindPointInSphereOnlyHumanNavmesh`, static rays. redscript, low | read | **Built** |
| 10 | **Weather set** (`world.weather.set`) | Design §7.5 and §8 step 4; in-game possibilities 21 | Medium: repeatable light conditions for parity captures | Codeware `SetWeather` / `ResetWeather` (holding a state stops the cycle) [source] Codeware `src/App/World/WeatherSystemEx.cpp`. redscript + Codeware, low-medium (a save keeps it) | write-world; the earlier state with the cycle on; the kill switch restores | **Built** |
| 11 | **Photo mode's scene rows** (`photo.scene.set`: surrounding NPCs, weather, game speed) | [Autonomy rank 7, B10](../backlog/bridge-autonomy.md#ranked-features); [N7 7.3](next-sessions-plan.md#n7-photo-mode-parity-eye-and-skin-light-the-repeats) | Medium: clean frames in public places | Menu attributes 54, 69, 71 through `ForceValue`, as every photo-mode write [runtime] keys from the first session's menu dump. Low | write-photo; the rows' earlier values; gone with photo mode | **Built** |
| 12 | **Save-slot metadata** (`game.saves`) | [Design §7.4](runtime-bridge-design.md#74-menus-appearance-and-saves) (list saves); save editor study | Medium: picking the safety save by its details, session records | `RequestSavesForLoad` then the load menu's `OnSaveMetadataReady` (`SaveMetadataInfo`) [source] `loadGameMenu.script:2-25, 110, 412`. redscript, low | read | **Built** |
| 13 | **Photo-mode framing from a far drone camera** | Session 7: `framing_bound` at 8 m | Medium: face frames failed | Camera preset 1 brings the drone back near V before the lens starts (tools side). Low | write-photo; the earlier preset in the undo | **Built** |
| 14 | **Projection check** (eyes on screen in photo mode) | Session 7: `eyes_on_screen` wrong under the drone camera | Medium: showroom placement checks | Two points on the camera's axis must project together, or the model uses the camera's pose and field of view (tools side). Low | read | **Built** |
| 15 | **Captures and sheets** (sweep into sheet; rig-off without a manifest) | Session 7 findings 3 and 4 | Low-medium: friction | Tools side | read / write-showroom | **Built** |
| 15a | **XF map pins that show** (in the world, on the minimap, at the right height) | Session 7 finding 11 (F3 failed) | Low-medium (a temporary test feature) | The quest system's dynamic mappin type at an exact point, as Appearance Menu Mod's markers use it; a head's pin at its eyes, not bound to the entity. redscript, low | write-world; world.pin.clear | **Built** (proof in session 8 G5) |
| 15b | **Showroom heads in free space** | Session 7 finding 12 | Medium: a head inside a wall wastes a capture | `world.probe`'s new `clearance_m` (eight level rays) and `sight_from`; a blocked head steps back or sideways (tools side). Low | write-showroom (existing undo) | **Built** |
| 15c | **The busy state and its readout agree; a look ends on the player's input** | Session 7 findings 13 and 14 (G5, E2) | Medium | `psm_detail` adds the locomotion state and `on_ground`; a look behaviour watches the player's input as a glide does (design §4.2) | read; write-player (existing) | **Built** |
| 16 | **Equipment-EX outfit equip** | Session 7 finding 5 (refused, version "unknown") | Medium: B-group rows | Version from the global `EquipmentEx::Version;`; the item's own outfit slot passed; the call's status told apart from the answer; the outfit read back. redscript + Codeware reflection, low | write-inventory (existing undo) | **Built** (proof in session 8) |
| 17 | **Review findings RB-93..95**, then the 0.7.0 deep review's RB-96..118 | [Code-health ledger](../authoring/code-health.md) | Low (each Low) | The delayed wardrobe restore checks the script gate and the phase; the save's holds read again in the save's own step; Equipment-EX's API looked up once per session | — | **Built** |
| 18 | **Lighting mirror and a movable key light** (`lights.mirror.*`, `lights.read`) | [Lighting mirror §5.1](lighting-mirror-design.md#51-commands); autonomy rank 10; B5; session 6 friction (a light-rig controller) | Medium-high, but the Studio-matched rig is banked until 1.0 | Codeware static entities with a light component built at assembly (World Builder's route), a host `.ent` archive to build with WolvenKit. Medium | write-photo; clear removes every mirrored light | Not built: needs the host archive and a WolvenKit build; the showroom's rigs already cover the key light for now |
| 19 | **Input channel** (jump, select a dialogue choice) | [Player control §2.5](player-control-design.md#25-synthetic-input); `input.probe` | Medium | The functional-test system's fake input (native handlers located by `input.probe`), or Raw Input; high risk without session 7's probe answers | act-player | Not built: waits for session 7's `input.probe` record |
| 20 | **Overlay interact mode (P1)** | Overlay feasibility §8 P1 | Medium: mouse answers and XF controls without CET | Window subclass, raw-mouse routing, `ForceCursor("XF")`, the CET yield native. Medium | notify | Not built: after P0's session |
| 21 | **Reference NPC beside V** | Autonomy rank 12; in-game possibilities 18 | Low-medium | Photo Mode Ex's characters, or Codeware `DynamicEntitySystem` with a friendly attitude. Medium (AI, persistence) | write-world or a new spawn class; despawn | Not built |
| 22 | **Face controls and live expression** (`face.expression.stage`, `face.controls.apply`) | [Expression editor §7](../animation/expression-editor-design.md#7-the-runtime-bridge-and-in-game-preview); pose editor L3 | Medium, after 1.0 | The live-pose carrier route extended to face clips | write-photo | Not built |
| 23 | **Hide the game's HUD for captures** (non-persistent) | Design §7.5 ("Hide the HUD") | Low-medium: normal-play captures | Codeware's HUD layer visibility. Low | notify-like (display only) | Not built |
| 24 | **Open photo mode without focus** | Session 5 friction; [photo mode §2.3](../../knowledge/photo-mode.md#23-routes-to-the-full-photo-mode) | Medium | No provably safe in-process route yet | write-photo | Not built (research) |
| 25 | **World node hide** (preview a planned deletion) | World and streaming §3.3 | Low, after 1.0 | Codeware `WorldStateSystem.ToggleNode` | write-world | Not built |
| 26 | **ReShade capture add-on** (before-effects frames) | [Design §7.2](runtime-bridge-design.md#72-reshade-optional-layer) | Medium for calibration | Needs the maintainer's decision on ReShade as an optional dependency | read | Not built (decision) |
| 27 | **Launch and exit the game** | [Design §7.6](runtime-bridge-design.md#76-input-launch-and-exit) | Low | Decided: attach only | — | Not built (decision) |

## What 0.7 contains

| Command | Class | What it does |
|---|---|---|
| `cyberware.state` | read | Areas, slots and items; the arms' holster chain and the right-arm and weapon slots; humanity |
| `cyberware.equip`, `cyberware.unequip` | write-inventory | The ripperdoc's own requests; the slot read back; undo |
| `player.action {name: "weapon.arms"}` | write-player | The arm cyberware's weapon drawn; undo weapon.holster |
| `world.state` | read | Clock, rain, weather state and list, quest facts, photo mode's scene rows |
| `world.probe` | read | Streaming, walkable ground, ground and ceiling at points or a ring around V |
| `world.weather.set` | write-world | Hold a weather state or give it back to the cycle; undo; kill switch restores |
| `ui.state` | read | Menus, popups, photo UI, tier, prompt, CET overlay, XF panels, pending question, overlay host |
| `game.saves` | read | The save list with metadata, newest first |
| `photo.scene.set` | write-photo | Surrounding NPCs, weather and game-speed rows; undo |
| `overlay.state` | read | The ImGui host's state (plugin method `overlay.hide`, notify, hides it for captures) |
| `session.wait` | read (tools) | Blocks until an answer, a comment or another event kind |
| `ui.message {level: "ask", choices}` | notify | Answer keys in the ink panel, buttons in the CET window; 600 characters; the newest question pinned |

Changed: `player.state` (`look_at` by the world-object rule, `hud_prompt`, `tier`, `staged_scene`), `scene.read` (NPC `record` instead of a display name), `photo.frame` (`reseat_camera`), `capture.sheet` (`sweep`), `showroom.light` (`rig: "none"` without a manifest), `capture.*` (the overlay host hidden, a warning when CET's overlay is open), the ink panel (placement from the layer's own size, answer keys).

## Safety notes for the new writes

- **Cyberware** goes through the equipment system's own requests; nothing is equipped outside normal play, in combat, a tier 3-5 scene or while the arm weapon is drawn; the game's requirement check comes before any change, an item V lacks is added only with `add_if_missing`, a copy V can't equip is taken out again, and only the bridge's copy is removed. The save lock is taken first and `game.save` refuses while the cyberware differs from before the bridge's first change. The kill switch puts the slots back and removes the added copies (0.7.0 review, RB-101, RB-102, RB-112); the session still ends by loading its save.
- **The weather** is held by Codeware's `SetWeather`, which stops the game's cycle; the undo and the kill switch set the earlier state and turn the cycle on again. It is refused in a story scene (tiers 3 to 5), counts as the bridge's only once the game took it, and `game.save` refuses while it is held (RB-102, RB-110). A quest or mod that held the weather itself would need to hold it again after the undo; the answer says so.
- **Photo mode's rows** go with photo mode, like every write-photo change.
- **The overlay host** never unhooks at run time; `[overlay] enabled = false` (the default) attaches nothing. It refuses in HDR, on an unexpected back-buffer format, queue, device or window, at the first present and after every resize; turns itself off after any exception or failed Dear ImGui check on the render thread; bakes its glyphs once (no upload wait while drawing); and releases everything at the render shutdown (0.7.0 review, RB-97..100, RB-105..108). Captures hide it; it yields while CET's overlay is open.

## Session 8's findings: bridge 0.8, part A

Session 8 (write-up: `experiments/036-session-8` on `main`) proved most of 0.7 in game; what it found is fixed in 0.8's part A (offline, 30 September 2026; [design §3.8](runtime-bridge-design.md#38-bridge-08-part-a-session-8s-findings)), each with a test and a [session-9 row](runtime-bridge-test-card.md#session-9-checks-bridge-08-part-a).

| Finding | Fix | Row |
|---|---|---|
| Ink panel cut off top right at 21:9; center unsupported; no plate | Placed inside the visible part of the HUD canvas (cover scaling), nine anchors, default top left 40/360; plate sized from the body; kept on top | B1-B3 |
| Blank gaps (ink), "?" (CET) for missing glyphs | One mark (U+00A4) on every surface; CET gets a transliterated Latin-1 copy | B4 |
| Comment box: send with Ctrl+Enter | Ctrl+Enter sends (Send disabled while empty, tooltip) | C2 |
| Ready/Yes/No on every question | Only the answers given; one Done by default | A3 |
| World pins drew nowhere | The game's icon kept; AMM's marker data; drawn_by per view; head pins 0.25 m above the eyes | F1 |
| `eyes_on_screen` wrong under the drone camera | Photo camera's pose and field of view in photo mode; a lateral check elsewhere | G1 |
| A look not broken by the mouse | Raw mouse/stick (Codeware `Input/Axis`) and camera drift end it | D2 |
| `game.saves` without details outside the Load menu | Each save's details asked the Load menu's way | H1 |
| `on_ground` true mid-jump; refusal didn't name the state | The state machine's flag; `player_busy: locomotion:Jump` in plain words | D1 |
| Arms drawn after photo mode refused changes | Changes holster first (the game had them in the weapon slot) | E1 |
| `wardrobe_state` Head hidden under Equipment-EX | Areas reconciled with the outfit's parts | H2 |
| Sweep frames showed the overlay host | Sweeps and bursts hide it like `capture_screenshot` | G2 |
| `moved_for_space` null when clear | `space_check`: checked, clearance, moved | G3 |
| Load from the main menu | `game.load` latest and by name through the menu's own paths | I1-I2 |
| Overlay refused under DLSS frame generation | Streamline's proxies resolved to their native objects | J1-J2 |
| Blades deployed in photo mode's default pose | A game behaviour ([photo mode §14](../../knowledge/photo-mode.md#14-arm-cyberware-vs-weapon-slot-and-the-cameras-projection)) | E2 |
| 600-character cap | Checked whole on every surface (unit test) | B5 |
| The UI review's 14 items | Status wording, colours, themed label, one question, diagnostics setting, window layout, answered line, stopped text, truncation, frame-generation line, F-keys (F9 is quick load, so F11 stays) | A1-A2, B, C |

## 0.8.12 live-direction toolkit

Built offline on 24 October 2026 ([design §3.21](runtime-bridge-design.md#321-bridge-0812-the-live-direction-toolkit)); the `write-dm` class (`dm`), the -writes package only. Every hook below is a script call or a wrap in `redscript-dm/XFRuntimeBridgeDm.reds`; no new native (27). Grades: **[source]** read in the 2.31 scripts or Codeware; **[offline]** exercised by the self-test host's simulated world. None has run in game ([card](runtime-bridge-test-card.md#dm-toolkit-stacked-onto-session-18)).

| Hook | Game side | Risk | Status |
|---|---|---|---|
| Props, vehicles, lights brought in | Codeware `DynamicEntitySystem`, both persist flags off, tag `xfs_dm`; a vehicle from its record, a prop from a template path | Medium: entity lifetime; never saved; removed at the release and on a load | [source], [offline] |
| Doors | `DoorControllerPS` quest actions (`ForceOpen`, `ForceClose`, `ForceLock`, `ForceUnlock`, `ForceSeal`, `ForceUnseal`) built as `GetQuestActionByName` builds them, queued through the persistency system | Medium: the state is saved with the world, so the change is held under the save lock until it is put back or undone by hand | [source], [offline] |
| Vehicle state and radio | `VehicleQuestChangeDoorStateEvent` on the vehicle's PS; `VehicleQuestToggleEngineEvent`, `VehicleLightQuestToggleEvent`, `VehicleRadioEvent` on the entity | Medium: a door's lock cannot be read back (kept held) | [source], [offline] |
| Sound | `AudioSystem.Play` and `Stop`; `GameObject.PlayVoiceOver` | Low | [source], [offline] |
| A real call | `questTriggerCallRequest` through `PhoneSystem.QueueRequest` for an active journal contact; state polled from the fact `phonecall_<contact>_with_player`; words as timed subtitle lines | High if misused: an unknown contact runs the HUD's null-contact calls (session 7), so it is refused | [source], [offline] |
| A message toast | `PhoneMessageNotificationViewData` on the HUD phone controller (`AddNewNotificationData`) | Low | [source], [offline] |
| A tracker with our words | A wrap of `QuestTrackerGameController` and its tracked-mappin container; `QuestTrackerObjectiveLogicController.SetData` with plain strings; never the journal | Medium: the game redraws the row after a pin change, so ours is drawn again | [source], [offline] |
| Banners, toasts, subtitles | `UI_Notifications` blackboard (warning, onscreen); `JournalNotificationQueue` toasts; `UIGameData.ShowDialogLine` | Low | [source], [offline] |
| Light steering | `LightComponent.SetColor`, `SetIntensity`, `SetRadius`, `SetFlickerParams`; `gameLightComponent.SetAngles`, `ToggleLight`, found with `Entity.GetComponents` (Codeware) | Low | [source], [offline] |
| Watchers | Polled on the game thread's tick: position, `TargetingSystem` look-at, weapon and combat state, vehicle, the clock; the `UIInteractions` blackboard (`LastAttemptedChoice`, `SelectedIndex`, `DialogChoiceHubs`) listened to only while a watcher wants it and unregistered at detach | Medium: a listener left on a blackboard a load destroyed is a crash risk | [source], [offline] |

Left out, with the mechanism each would need: a dedicated light carrier (a WolvenKit-built empty entity holding a light component, or Codeware reflection adding one); an exact radio station on a radio device (only the vehicle radio has an exact-station event); a journal-free caller or reading card (a new ink widget, and the UI review); the shard popup (a native call with a null entry); the experience toast (a wrap of one more HUD controller); a sound at a world point (an empty emitter entity template). The dialogue pick is inferred, not read [hypothesis].

## Related

[Runtime bridge design](runtime-bridge-design.md) · [test card](runtime-bridge-test-card.md) · [overlay feasibility](imgui-overlay-feasibility.md) · [next sessions plan](next-sessions-plan.md) · [bridge autonomy](../backlog/bridge-autonomy.md) · [runtime access](../../knowledge/runtime-access.md)
