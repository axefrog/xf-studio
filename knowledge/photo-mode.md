# Photo mode and the character creator from script

**Maturity: Draft.** How Cyberpunk 2077's photo mode and the in-game character creator (the mirror's appearance screen) can be opened, driven and left from script, and which techniques from published photo-mode mods an automated test session can reuse. Consolidated on 26 September 2026 from the decompiled 2.31 script bundle (redscript-cli 0.5.31), the game's input configuration, RED4ext.SDK and the pre-2.3 RTTI dump, the source of photo-mode, camera and lighting mods (installed releases, and public repositories where they exist), and the XF Runtime Bridge's first in-game session. Claims marked [runtime] were seen in the bridge's sessions (26 and 28 September 2026: sessions 1, 3 and 4, game 2.31, a heavily modded test profile); everything else waits for a game session. Grades follow the [knowledge rules](README.md). The bridge itself is described in [runtime access](runtime-access.md).

This page answers: *what can a bridge do by itself in photo mode and the creator, and what still needs the player's hands?*

## Sources

| Source | Version studied | Used for |
|---|---|---|
| Game scripts (decompiled bundle) | 2.31 | Photo-mode menu, cursor, creator menus and menu scenarios |
| Game input configuration (`r6/config/inputContexts.xml`, `inputUserMappings.xml`) | 2.31 | The photo-mode key and its action |
| [RED4ext.SDK](https://github.com/WopsS/RED4ext.SDK) generated types; `red-dump-json` RTTI dump | `ad727771`; `a8e52990` (pre-2.3) | Native photo-mode types, quest node fields |
| [Photo Mode Ex](https://github.com/psiberx/cp2077-photomode-ex) (psiberx, MIT) | source `v1.4.1` (`dd1245b1`); installed 1.4.0 | Native photo-mode system hooks, extra characters, attribute sync |
| [Codeware](https://github.com/psiberx/cp2077-codeware) | `v1.20.4` (`613a1cb8`) | `QuestsSystem.ExecuteNode`, photo-mode imports |
| [Cyber Engine Tweaks](https://github.com/maximegmd/CyberEngineTweaks) | `v1.37.1-9` (`9a8522f`) | How CET writes script properties |
| [Appearance Menu Mod](https://github.com/MaximiliumM/appearancemenumod) (AMM) | installed 2.12.5; repository `5427235` has the same Lua | Cursor hiding, spawned camera and lights, teleport, NPCs, time, weather |
| Character Customization Anywhere (Nexus 3930) | 1.2 | Opening the creator from anywhere |
| CharLi – Character Lighting Suite for Photomode (Nexus 8176) | 2.2a | Spawned light rigs that follow V |
| Photo Mode Unlocker XL (Nexus 4319), Portrait Enhancer for Photo Mode (8237) | 2.3.1, 2.2 | Photo-mode TweakDB flats: limits, restrictions, camera presets |
| Photo Mode Pose Selector (32633), Photo Mode Preferences (32736), Customisable Photo Mode UI (32815) | 1.2.0, 0.1.1, 0.2 | Menu attributes, light selection, page sync, photo-mode ink tree |
| Photomode NPCs Extended (18837), Photomode Facial Expression Mega Pack (7912), Multi Pose Pack Framework (4098) | 1.2, 2.1, 1.0 | Extra photo-mode characters, expressions and pose loading |

Installed-mod citations give paths inside each mod's folder in the mod manager (for MO2, `mods/<mod name>/`). Nothing was extracted from any archive. Who made each mod and what it taught us is in the [community credits](../docs/community-credits.md).

## 1. The short answers

| Question | Answer | Grade |
|---|---|---|
| Can a script open the full photo mode the way the player's key does? | **No script-visible route found.** The key sends the input action `TogglePhotoMode`, which native code handles. `PhotoModeSystem` exposes only five script functions, none of which opens it. Codeware's quest-node route opens a **restricted** photo mode (§2). The practical routes are sending the player's own photo-mode key to the game window, or a native call that still needs reverse engineering. The key works with `SendInput`, but only with the game window in front, and bringing it forward catches whatever the player is typing elsewhere (session 4), so the bridge (0.4.2) sends it only while the game is already in front. | [source] [resource]; restricted result and the key [runtime] |
| Can a script open the character creator anywhere? | **Yes, from the pause menu:** open the pause menu and switch its scenario to `MenuScenario_CharacterCustomizationMirror`, which is what Character Customization Anywhere does (§3.1). Switching straight from the idle scenario, away from a mirror, left the creator half open (session 4), so the bridge's `cc.open` uses CCA's route since 0.4.2. | [source]; CCA's route [runtime]; the idle route's failure [runtime]; the bridge's CCA route [offline] |
| Can a script confirm or cancel the creator? | **Yes, through the menu's own functions:** Confirm calls `ReFinalizeState()`, and Back then "confirm" calls `CancelFinalizedStateUpdate()`. The menu has no autosave of its own (§3.3). | [source] |
| Can the photo-mode camera be placed exactly? | **Partly.** The camera PRESET attribute puts the camera at a TweakDB-defined offset from V. Moving the camera entity itself is a lead, not established (§4). | [resource] [runtime]; exact placement [hypothesis] |
| Can photo-mode lights be switched and moved? | **Switched and shaded, yes:** attribute 44 is on/off (seen in the first session's menu dump; switching it from script is built but untested). **Moved, not through the menu.** Spawned light entities, as CharLi and AMM use, can be placed exactly (§5). | [runtime] menu; [source] |
| Can the photo-mode mouse cursor be hidden? | **Yes:** make the cursor controller play its `Hide` context, as AMM does (§6). | [source] |
| Can a scripted creator change update the row's label? | **Yes:** drive the change through the row's own controller, or push the updated option back into it (§7). | [source] |

## 2. Opening photo mode

### 2.1 What the player's key does

- The photo-mode key is the input action **`TogglePhotoMode`**, mapped by default to `IK_N` and the left thumbstick press (`TogglePhotoModeButton`), in the `PhotoMode` input context that gameplay contexts include [resource] `inputContexts.xml:77, 115, 847-849`, `inputUserMappings.xml:2066-2069`.
- **No script handles it.** The decompiled 2.31 scripts never name `TogglePhotoMode`. AMM only *reacts* to the key: it observes `PlayerPuppet.OnAction` for `TogglePhotoMode` and `ExitPhotoMode` button releases [source] AMM `init.lua:698-705`. Opening happens natively.
- **The script-visible system is small:** `PhotoModeSystem` has `IsPhotoModeActive`, `CanPhotoModeBeEnabled`, `IsExitLocked`, `UnlockPhotoModeItem` and `GetCameraLocation(WorldPosition)`, and nothing that opens photo mode [source] 2.31 `orphans.script:18453-18464`; `red-dump-json` `gamePhotoModeSystem.json`.
- **Native functions exist but aren't the entry point.** Photo Mode Ex reaches the native `PhotoModeSystem::Activate(system) -> bool` through the address library (hash `2593396187`), together with `Deactivate`, `Finalize`, `SetAttributeValue` and about 20 others. It only **hooks** `Activate` to register extra characters when photo mode starts, and never calls it [source] PMEx `src/Red/PhotoMode.hpp:100-118`, `src/Red/Addresses/Library.hpp:19-43`, `PhotoModeExService.cpp:71, 247-274`. `Activate` looks like a setup step inside the opening sequence rather than the opening itself, so calling it alone would probably skip the camera and menu setup [hypothesis].
- **What blocks the key:** the status-effect tag `NoPhotoMode` (AMM removes `GameplayRestriction.NoPhotoMode` every frame when its photo-mode enhancements are on) [source] AMM `init.lua:1531-1534`, and `CanPhotoModeBeEnabled()` (combat, scenes, some vehicles) [source].

### 2.2 Why the quest node gives a restricted photo mode

The bridge's first route built the game's own quest node `questOpenPhotoMode_NodeType` (fields `factName`, `forceFppMode`, `alwaysAllowTPP`, `lockExitUntilScreenshot` [resource] SDK `quest/OpenPhotoMode_NodeType.hpp:21-24`) with `alwaysAllowTPP = true` and `forceFppMode = false`, and ran it through Codeware's `QuestsSystem.ExecuteNode`. Codeware runs a single node in the root quest phase with a fresh quest context [source] Codeware `src/App/Quest/QuestsSystemEx.hpp:9-26`.

- **Result:** photo mode opened, but first-person only. The camera-type list offered only *First-person Perspective*, the V tab was unavailable, and field-of-view writes changed nothing. Opened with the player's key in the same place, the menu had *Drone*, and every attribute worked [runtime] first session, step 9, and the two `photo.state` dumps.
- **Not the TweakDB restriction lists.** The profile already had `photo_mode.general.onlyFPPPhotoModeInPlayerStates` and `onlyFPPPhotoModeForStatusEffectsWithTags` emptied by Photo Mode Unlocker XL, and AMM empties the first too [resource] PMU `r6/tweaks/SILVER_PMU_2_3_XL.yaml:27-28`; [source] AMM `init.lua:821`. So the restriction follows the quest-node route itself.
- **Why:** the node is the tool that quests use for their scripted photo moments, and the native handler appears to apply its own restricted setup whatever the two flags say [hypothesis]. Varying `factName` or `lockExitUntilScreenshot` is unlikely to help, and is not worth a session on its own.

### 2.3 Routes to the full photo mode

| Route | How | Risk | Grade |
|---|---|---|---|
| **Send the player's key to the game** | Read the effective binding (the default `IK_N`, or the player's rebinding) and send that key press to the game window. `photo.exit` closes photo mode through the menu, so only opening needs the key. | The game must have focus: `SendInput` with the game in front opened the full photo mode in session 4 (21 of 23 opens; the command log). Bringing the window forward (`SetForegroundWindow`) catches the player's typing: in session 4 the maintainer was typing in another program when `photo.open` pulled the game in front, the keystrokes reached the game and the next open answered `photo_not_allowed`. So since 0.4.2 the bridge sends only while the game is already the foreground window and otherwise refuses without touching any window (`focus: bring_to_front` restores the old route and warns). Whether posted window messages (`route: postmessage`, which never changes focus) reach the game is untested. It is input injection, so it targets only the game window and is allowlisted and logged. | `SendInput` [runtime]; focus stealing [runtime] session 4; `postmessage` [hypothesis] |
| Native entry point | Find the native function the `TogglePhotoMode` handler calls (the caller of `Activate`) in the address library or by disassembly, and call it on the main thread from the plugin | Needs reverse engineering. A wrong call crashes, and the address must be refreshed per game build. Re-checked for 0.4.2 (28 September 2026): the 2.31 scripts still have no handler or event that opens photo mode (the `PhotoMode` blackboard has only `IsActive` and `PlayerHealthState`; the menu only reacts to `OnPhotoModeFailedToOpenEvent`), the installed mods that name `TogglePhotoMode` (AMM, LUT Switcher, Photo Mode Pose Selector) only observe the key, and Photo Mode Ex only hooks `Activate`. Nothing offline shows a call that is safe, so the key stays the default | [source] [hypothesis] |
| Quest node | As above | Opens only the restricted photo mode | [runtime] |

## 3. Opening, confirming and leaving the character creator

### 3.1 How Character Customization Anywhere opens it

A 38-line CET mod [source] `bin/x64/plugins/cyber_engine_tweaks/mods/characterCustomizationAnywhere/init.lua`:

1. **It captures the in-game menu controller:** `Observe('gameuiInGameMenuGameController', 'RegisterGlobalBlackboards', …)` stores `self` (`:5-7`). This is why the mod says to reload a save if the hotkey does nothing.
2. **On its hotkey it opens the pause menu:** `inGameMenu:SpawnMenuInstanceEvent('OnOpenPauseMenu')`, and sets a flag (`:30-38`), which is the same event the game's own pause key sends [source] 2.31 `inGameMenuGameController.script:210`.
3. **It redirects the pause menu:** `Override("MenuScenario_PauseMenu", "OnEnterScenario", …)` calls `this:SwitchToScenario("MenuScenario_CharacterCustomizationMirror")` instead of opening the pause menu while the flag is set (`:9-16`).
4. **It supplies the creator's menu data:** `Override("MenuScenario_CharacterCustomizationMirror", "OnCCOPuppetReady", …)` opens the menus `player_puppet` and `character_customization` with a new `MorphMenuUserData` (`:18-27`).

The vanilla mirror scenario does the same thing when it gets its data: `OnEnterScenario` marks the data `m_updatingFinalizedState = true` and opens `character_customization_scenes`, and `OnCCOPuppetReady` opens `player_puppet` and `character_customization` [source] 2.31 `inGameScenarios.script:217-247`.

**A 2.31 caveat.** CCA writes the fields `optionsListInitialized`, `updatingFinalizedState`, `editMode` and `currMenuName`, but in 2.31 they are `m_optionsListInitialized`, `m_updatingFinalizedState`, `m_editMode` and `m_currMenuName` [source] 2.31 `orphans.script:52919-52927`. CET stores a write to an unknown property on the Lua object and never reaches the game object [source] CET `src/reverse/Type.cpp:58-63, 260-277`, `RTTIHelper.cpp:949-975`. So CCA's own field writes don't reach the game on 2.31. **In game its F12 still gives a creator whose Confirm keeps the look** [runtime, session 4, 28 September 2026]: the bridge read `edit_mode` `NewGame` with `updating_finalized_state` true, and `cc.confirm` kept a real change (`changes` 1, `closed_with: "confirm"`). Every preset of that session's finish sweep, confirmed this way, showed in photo mode afterwards. The vanilla mirror scenario's `OnEnterScenario` sets `m_updatingFinalizedState` itself, which explains it; the edit mode stays the default `NewGame`, so every row is editable ([experiment 029](../experiments/029-session-4/README.md#31-preflight-bridge-041)).

**The bridge's route since 0.4.2 is CCA's** [source; in game unverified]: `cc.open` raises the pause menu's own event `OnOpenPauseMenu` through the menu-event blackboard (the in-game menu controller's `OnTriggerMenuEvent` makes the same `SpawnMenuInstanceEvent` call CCA makes, `inGameMenuGameController.script:294`), and a wrap of `MenuScenario_PauseMenu.OnEnterScenario` switches to the mirror's scenario with a new `MorphMenuUserData` carrying the edit tag instead of opening the pause menu, only when the bridge asked in the last three seconds and the pause menu came from normal play (`prevScenario` `MenuScenario_Idle`; the credits picker's Back and the debug hub also enter the pause menu [source] 2.31 `pauseScenario.script:31`, `debugHubMenu.script:170`); any other pause opens the pause menu as usual, and so does a request the moment no longer allows (combat, a scene tier above 2, a vehicle or a stand-in player, re-checked as the pause menu opens). Since 0.5.1 the plugin makes that decision (unit-tested), and a request withdrawn after its event (a timeout, the kill switch) says the pause menu may still open. **Which edit tag** [hypothesis]: 0.4.2 passes HairDresser (or Ripperdoc), but CCA's F12, the route proven in session 4, ran in `NewGame`, and 0.4.1's stuck creator was HairDresser too, so the edit mode's world freeze, not the idle route, may have caused the stuck state. `cc.open` (0.5.1) takes `edit_mode: "new_game"` to open exactly as CCA's F12 did; session 5 tries both. Because the data goes with the switch, the vanilla `OnEnterScenario` and `OnCCOPuppetReady` open the creator in the edit-V's-look mode without CCA's override of `OnCCOPuppetReady`. **Why:** in session 4 (28 September 2026) the batch-3 route below, used away from a mirror, left the creator's backdrop half open over gameplay with its busy flag stuck, and only loading a save recovered it, while CCA's F12 opened the creator in the same places [runtime]. Which native step the pause menu adds (the menu instance, its preview world) is not established [hypothesis].

**The batch-3 route (0.3.0-0.4.1, replaced)** [source]: no pause menu and no wrapped vanilla function. The bridge adds its own event to the idle scenario (`@addMethod(MenuScenario_Idle) protected cb func OnXFBridgeOpenCreator()`, the way Mod Settings adds its pause-menu event) and raises it through the game's menu-event blackboard (`MenuEventBlackboard.MenuEventToTrigger`, set to `None` first, as `GameObject.TriggerMenuEvent` does; the in-game menu controller turns the name into a scenario event) [source] 2.31 `gameObject.script:2480-2490`, `inGameMenuGameController.script:76, 294`. The event does something only when the bridge asked for it in the last three seconds (a flag on its registry), and checks the moment again; it then calls `SwitchToScenario(n"MenuScenario_CharacterCustomizationMirror", data)` with a new `MorphMenuUserData` carrying an edit tag. The vanilla `OnEnterScenario` sets `m_updatingFinalizedState = true`, and `OnCCOPuppetReady` passes the same data to the creator, so it opens in the mirror's edit-V's-look mode and Confirm keeps the look. Before asking, the bridge refuses outside normal play, in combat, in a vehicle, with a scene tier above 2, where photo mode isn't allowed, or while the game locks saving for combat, a scene, a tier or a moving platform; it takes its save lock and asks only once the game reports saving locked. A request the menu never picks up (another menu open) is withdrawn after the wait, and the kill switch withdraws a pending one; a screen already open stays open for the player to leave.

**Scene tiers.** `GameplayTier` runs from 1 (full gameplay) through 2 (staged gameplay), 3 (limited), 4 (first-person cinematic) to 5 (cinematic) [source] 2.31 `orphans.script:3105-3112`. V's apartment reports **tier 2** in normal play: session 3 found every `cc.open` there refused at tier 2 while Character Customization Anywhere's F12 worked [runtime] 28 September 2026. The game's own rule for changing clothes blocks tiers 3 to 5 only (`InventoryGPRestrictionHelper.BlockedBySceneTier`: the high-level state above 2) [source] `inventoryItemData.script:842-847`, and CCA checks no tier at all [source] its `init.lua`. So the bridge (0.4) accepts tiers 1 and 2 and refuses 3 and above.

**Away from a mirror the mirror scenario doesn't finish** [runtime, session 4]. In V's apartment, 0.4.1's `cc.open` answered `opened: true` (`HairDresser`), but the creator's backdrop stayed half-open over gameplay, the busy flag stayed set (`cc.confirm` refused `busy`), the game never returned to gameplay, and only loading a save recovered. Character Customization Anywhere's route (the pause-menu redirect) worked all session in the same room. So the bridge should open the creator through that route when the mod is installed, and keep its own event for a mirror.

### 3.2 Edit modes

`MorphMenuUserData.m_editMode` is `gameuiCharacterCustomizationEditTag`: `NewGame` (0, the default), `HairDresser` (1) or `Ripperdoc` (2) [source] 2.31 `orphans.script:8175-8179`. In any mode other than `NewGame`, the creator freezes the world and V with time dilation 0 under the reason `VendorStash` and restores it on close; `NewGame` enables the voice switcher; `HairDresser` hides some randomiser options [source] `characterCreationBodyMorphMenu.script:222-224, 262-264, 881-883, 1107-1117`; `characterCreationPunkRandomizerMenu.script:380`. Which mode the in-world mirror passes has not been traced.

**The mode decides which rows can change.** The menu calls `ApplyEditTag(mode)` before listing options, and each option carries `editTags` [source] `characterCreationBodyMorphMenu.script:878`. In the vanilla female CCO, `hairstyle`, `eyes_color`, `eyebrows`, `piercings` (and its colour options), `makeupEyes` and `teeth` carry all three tags, while `eyes` (the eye shape), `nose`, `skin_type` and `cyberware` carry `NewGame` and `Ripperdoc` only [resource] `female_cco.inkcharcustomization`; XF Eye Artistry's rows carry all three. So `cc.open` offers `mode: "mirror"` (`HairDresser`) and `mode: "ripperdoc"` (`Ripperdoc`, which adds the face-shape, skin and cyberware rows), and since 0.5.1 `edit_mode: "new_game"` (`NewGame`, every row, no world freeze; what CCA's F12 ran as in session 4, where Confirm still kept the look because `m_updatingFinalizedState` was true, §3.1).

**The creator's camera** moves by body region, not page: the base menu's protected native `RequestCameraChange(slot, delayed)` with the slots `GetSlotName` returns (`UI_Skin`, `UI_Hairs`, `UI_Eyes`, `UI_Teeth`, `UI_Nose`, `UI_Lips`, `UI_Jaw`, `UI_HeadPreview`, `UI_FingerNails`, `UI_Preview`, and `m_defaultPreviewSlot` on open) [source] `characterCreationMenu.script:73`, `characterCreationBodyMorphMenu.script:1075-1105`. Hovering a row and a row's own change both request that row's slot (`OnHoverOverOption`, `OnSliderChange`), so `cc.apply` through the row moves the camera to the option's region; an option outside the eyes, hair, teeth, nose, lips and jaw lists (an XF row, for example) goes to `UI_HeadPreview`. `cc.page` requests a slot directly, which makes the `cc-eyes` crop's eyes zoom (`UI_Eyes`) reproducible after an XF row change [source]; whether `UI_Eyes` is the zoom the crop was measured on is [hypothesis].

### 3.3 What Confirm and Back do

| Action | Call chain | Grade |
|---|---|---|
| **Confirm** (the Next button, or the `one_click_confirm` action when no colour picker or confirmation box is open) | `ConfirmCustomizedCharacter()` → if `m_updatingFinalizedState`: `ReFinalizeState()` on the customisation system → event `OnReFinalizeStateCompleteEvent` → `NextMenu()` → `OnAccept` → the scenario's `GotoIdleState()` → `MenuScenario_Idle`. In new-game mode it only calls `NextMenu()`. | [source] `characterCreationBodyMorphMenu.script:272-277, 427-429, 701-712, 768-773`; `characterCreationMenu.script:118-124`; `inGameScenarios.script:212-214, 238-240` |
| **Back** | The first press shows a confirmation box; confirming it runs `ConfirmBackConfirmation()` → `CancelFinalizedStateUpdate()` → event → `OnOutro()` and `OnCancel` → idle. | [source] same file `:682-699, 431-434, 752-767` |
| **Autosave** | No creator or mirror code requests an autosave. The script callers of `RequestAutoSave` and `RequestCheckpoint` are vendors, ripperdocs, perks, fast travel and delayed `AutoSaveEvent`s. Whether the native `ReFinalizeState` saves is not established. | [source] 2.31 `inGameScenarios.script:260-276`, `gameObject.script:2651-2672`, `fastTravelSystem.script:234, 611-620`; native [hypothesis] |

**The busy flag.** A row's change (its arrows, or `cc.apply` through the row) sets the menu's `m_busySwitchingAppearance` to `SWAPPING` in `OnSliderChange`, and only the system's `OnAppearanceAppliedEvent` sets it back to `AVAILABLE` (presets and randomise have their own completion events) [source] `characterCreationBodyMorphMenu.script:303-313, 382-386, 473-483`. While it is set, Confirm, the presets and randomise do nothing (`OnRelease` returns early, `:268-271`). **Selecting the value a row already shows applies nothing, so the completion event never comes and the flag stays set for good**: session 3 re-applied skin type 0 over 0 at 04:14:44, and every later change and Confirm was refused until the player backed out [runtime] plugin log, 28 September 2026 (the change before it, 3 to 0, had cleared normally). The bridge (0.4) never sends a same-value change, wraps `OnSliderChange` so a same-value change puts the flag back, clears a flag left set with nothing pending as stale, and answers `cc.confirm` with nothing changed on the screen by closing it with Back ("nothing to confirm").

To leave safely from script, call the menu's own `ConfirmBackConfirmation()` (discard) or `ConfirmCustomizedCharacter()` (keep) on the captured `characterCreationBodyMorphMenu`, never `ReFinalizeState` directly. The menu's own path also runs its outro and scenario change [source]. Keeping a look finalises it into V's state in the running game; a test session that loads its save at the end undoes that.

## 4. Camera placement

| Technique | What it gives | Grade |
|---|---|---|
| **Camera PRESET** (attribute 23: *Customization*, then *Preset 1*–*9*) | Moves the camera to a fixed offset from the edited character. Each preset is a TweakDB record `photo_mode.std_preset_1`…`_9` with `dist`, `pitchDeg`, `yawDeg`, `rollDeg`, `distUpDown`, `distLeftRight` and `fov`. Portrait Enhancer for Photo Mode overrides all nine, for example preset 1 = distance −1.8, pitch −13°, up/down 0.07, FOV 33, and says some presets need about 10 m of free space in front of V. | attribute [runtime] (the menu dump); records [resource] `r6/Tweaks/Portrait_Enhancer/PortraitEnhancer.tweak:1-101`; relative to the character [hypothesis] |
| **Camera limits** | `photo_mode.camera.min_dist`/`max_dist`, `max_dist_left_right`, `max_dist_up_down`, `min_fov`/`max_fov`, `min_roll`/`max_roll`; PMU widens them to ±1000 m, 1–120° and ±180°. `photo_mode.character.max_position_adjust` widens V's own offsets. | [resource] PMU `SILVER_PMU_2_3_XL.yaml:12-23` |
| **Collision** | Attribute 39 (*Full collision*) and the `collisionRadius…`/`collisionHeight…` flats (PMU zeroes them). The camera sitting inside a wall in a small bathroom is a collision and spawn-point effect. | [runtime] [resource] |
| **The camera entity** | The native menu sends `PhotomodeCameraSwitchedEvent { camera: wref<Entity> }` to the light indicator controller, which keeps it in `m_currentCamera`. Wrapping `PhotomodeLightIndicatorController.OnSetActiveCamera` hands a script the photo-mode camera entity, so its world transform can be read, and perhaps set with `TeleportationFacility.Teleport`, unless photo mode re-derives it every frame. | event [source] 2.31 `photoModeLightIndicatorController.script:47-49`, `orphans.script:53445-53448`; setting it [hypothesis] |
| **Camera position (read)** | `PhotoModeSystem.GetCameraLocation(out WorldPosition)`, shown by the menu's debug location text | [source] `photoModeCameraLocation.script` |
| **Framing V instead of the camera** | V's offsets relative to where photo mode placed her: attributes 7 (yaw), 3421 (pitch), 3422 (roll), 8 (left/right), 9 (close/far), 37 (up/down), ±5 m in 0.01 steps with Photo Mode Ex. Framing presets built from these depend on where the drone camera spawned. | [runtime] first session, step 12 |
| **A free camera outside photo mode** | AMM spawns `base\entities\cameras\simple_free_camera.ent` with `exEntitySpawner.Spawn`, polls `FindEntityByID`, takes its `camera` component and calls `Activate(blend, false)`, `SetFOV`, `SetLocalOrientation`; it moves it with `TeleportationFacility.Teleport` and restores the FPP camera with `GetFPPCameraComponent():Activate()`. Exact position; orientation is the entity's (from V's yaw at spawn) times the component's local rotation. Outside photo mode V must wear the third-person head (AMM swaps the `TppHead` slot item) or the face doesn't render. It loses photo mode's lights, poses and expressions. | [source] AMM `Modules/camera.lua:13, 59-139, 283-373`, `Modules/tools.lua:650-734` |

**What session 3 showed** (28 September 2026, test profile) [runtime]:
- **The XF presets were overridden.** Portrait Enhancer for Photo Mode sets all nine presets in a `.tweak` file, and its presets 5-9 roll the camera 90 degrees (`rollDeg = 90`); preset 7 arrived with its field of view 28 and roll 90, not the XF values [resource] `r6/Tweaks/Portrait_Enhancer/PortraitEnhancer.tweak`. TweakXL reads tweak files in directory order, except that a file name starting with `^` is read last and one starting with `_`, `#`, `$` or `!` first [source] TweakXL 1.11.4 `TweakImporter.cpp:22-80, 178-188`, so the bridge now stages its presets as `^xf_photo_mode_presets.yaml`, and `photo.frame` levels the camera (roll 0) after selecting any preset.
- **A read straight after a change is one frame stale.** After `photo.camera.set` changes V's placement or the field of view, a `photo.subject` read about 20 ms later reports the new menu value but V's stand-in and the camera where they were before; the next read shows the change. Session 3's framing measured every probe against the previous step and drove V to the ends of the ±5 m range (`no_response`) [runtime] plugin log 03:29:18-03:30:43. Framing now reads until the world has taken each change.
- **V's placement axes are fixed in the world for the session**, not turned with V's rotation slider: left/right moved V along the same world direction at rotation 10 and at -35 [runtime] same log. They need not be the camera's axes, so framing measures each axis's screen response (left/right, close/far, up/down) and uses whichever moves V across the screen.

**What session 4 showed** (28 September 2026, bridge 0.4.1) [runtime; [experiment 029](../experiments/029-session-4/README.md#45-r2-and-parity-e5e7-what-the-json-gives)]:
- **Framing converges** on the first try with the camera level, but it **starts from the current pose**.
- **V's close/far placement sets the camera's distance**, about 1 m minus the value: framing the face converged at about 66 degrees with close/far 0.75 (about 35 cm, a selfie lens that inflates the nose and cheeks) and at about 9 degrees with close/far -1.2 (about 2.2 m, a portrait lens). The framer only changes the field of view, so the distance comes from where the frame starts; `photo.frame` (0.4.2) starts face and eyes frames from the portrait pose (field of view 22, close/far -1.2). The eyes framing converged at 38° and 0.39 m.
- **Repeated frames drifted** because the framer left its close/far probe (+0.05) in place whenever it centred with left/right: over a sweep of yaw frames close/far went from 0.1 to 0.9 and the field of view from 22 to 92 degrees, then close/far became the sideways axis and ran to -5, and the next frames sat at 3 degrees with the camera behind a wall while answering converged. Since 0.4.2 the probe is put back, each frame starts from its lens's pose, and a frame that would leave the lens's bounds is refused.
- **V's rotation (key 7) runs -180 to 180** with Photo Mode Ex, so framing can turn V's back to the camera (`yaw_offset` up to ±180, the back-lit ear check).
- **The bridge's yaw offset isn't the yaw attribute.** `photo.frame`'s `yaw_offset` of ±30 set V's yaw (attribute 7) to ∓36–38°, ±15 to ∓18.5°, and 45 to −56°: opposite in sign, and the attribute about 1.25 times larger.

**Recommendation:** make framing deterministic in two steps. First put V somewhere known with open space (teleport, §8). Then pick a camera preset whose numbers the test profile controls, and fine-tune with V's offsets. Test whether the preset is relative to V's spawn and survives collision before relying on it (open question 4).

## 5. Lights

The light component itself, what scripts can change on it, CharLi in detail, the spawning routes and how a Studio lighting setup maps onto game lights are on [photo-mode and spawned lights](photo-mode-lights.md); the mirror built on them is designed in [research/runtime/lighting-mirror-design.md](../research/runtime/lighting-mirror-design.md).

### 5.1 Photo-mode lights

| Attribute | Meaning | Grade |
|---|---|---|
| 43 | Light number (1–3); selects which light the other rows edit | [runtime] |
| **44** | **State: Off / On** | [runtime] first session |
| 45 | Type: Spot / Ambient (listed on page 0 with value −1) | [runtime] |
| 46 | Shadow Off / On | [runtime] |
| 47, 48 | Brightness 0–100, range 0–100 | [runtime] |
| 49, 50 | Inner and outer cone angle, 15–175° | [runtime] |
| 51, 52, 53 | Hue 0–360, saturation, luminance | [runtime] |

- **Lights reset every time photo mode opens**, so a session sets them each time [runtime].
- **Select, wait, then set.** Photo Mode Preferences sets attribute 43 to a light, waits two frames (about 0.03 s), sets the values, then puts the selection back [source] `PhotoModePreferences/init.lua:772-810`; the bridge waits three ticks.
- **No attribute places a light: photo mode puts it where the camera is when it switches on,** and it stays in the world there: in session 3 light 1 lit V only when it was switched on after framing, and the maintainer saw its reflection outside a window once the camera had moved on [runtime] 28 September 2026. Switching it off and on again after framing re-places it at the camera (the bridge's `photo.light.set {place: {camera: true}}`), but in session 3 even that lit V unreliably (face mean about 18 against 72 once), so a direct placement is the next step.
- **`ResetCurrentLightButton` (`IK_R`) is native only:** no 2.31 script names it or `PhotomodeLightResetEvent` [source] decompiled bundle; only the input configuration maps it [resource] `inputUserMappings.xml`. Using it would mean sending a second key, which the approval for `photo.open` (the photo-mode key only) doesn't cover.
- **Where `place.azimuth` points** [source] (the bridge's `XFPhoto.PlaceLight`): azimuth turns V's stand-in's forward direction (`GetWorldForward`) counter-clockwise seen from above, so 0 is in front of V's face, 90 V's left and 180 straight behind the head, whatever the camera does. After `photo.frame` the camera sits at azimuth `yaw_offset` from V's facing, which is why azimuth 180 with the camera at V's side put the light behind the head, blocked from the camera's view (session 4's ear check) [runtime].
- **The light's entity is reachable from script:** the light indicator keeps one screen projection per light, and `PhotomodeLightIndicatorController.GetProjection(index).GetEntity()` returns the entity each follows [source] `photoModeLightIndicatorController.script:18-66`, `orphans.script:51645-51690`; the entity is a `gamePhotomodeLightObject`, a game object [source] SDK `game/PhotomodeLightObject.hpp`, so `TeleportationFacility.Teleport` accepts it. The bridge (0.4) moves it about V's head this way and reads its position back a few frames later (`held`). **Photo mode keeps it there** [runtime, session 4]:
- **Placement about V works.** A light placed at an azimuth, elevation and distance around V's head answered `held: true` and lit the face well. That session's finish sweep lit every preset the same way this way: azimuth 25°, elevation 20°, 1 m, brightness 45, hue and saturation 0.
- **Re-placing at the camera doesn't.** Switching the light off and on again after framing (`place: {camera: true}`) didn't light the face.
- **Brightness 60 at 1 m overexposes the face; 45 doesn't.**

**Lighting decides how a face reads in photo mode.** In session 4, faces and expressions that look right in the Studio read noticeably worse in game except under near-perfect lighting. A lighting rig that the bridge applies to match the Studio's lighting is banked ([backlog](../research/backlog/README.md); [lighting mirror design](../research/runtime/lighting-mirror-design.md)).
- **The light type row (attribute 45) isn't in 2.31's menu** on the test profile: setting it answered "not in the menu" while 44 and 46-53 worked [runtime] session 3. The bridge skips it with a note. Photo-mode lights are native `gamePhotomodeLightObject` entities with a `gamePhotomodeLightComponent` (an `entLightComponent`), and the menu receives `PhotomodeLightInitializedEvent { light: wref<Entity> }` and projects each light's position for its on-screen indicator [source] SDK generated types; 2.31 `orphans.script:53440-53443`, `photoModeLightIndicatorController.script`. Getting hold of these entities to move them is a lead [hypothesis].

### 5.2 Spawned lights (CharLi and AMM)

Both mods spawn their own light entities and control them through the light component, in or out of photo mode:

| Step | CharLi | AMM | Grade |
|---|---|---|---|
| Templates | Its own `base\charli\*.ent` (spot, area, point) in `charli.archive` | Its own `base\amm_props\entity\ambient_{point,spot,area}_light_controllable[_shadows].ent` | [source] |
| Spawn | `exEntitySpawner.Spawn(template, transform, 2)` at V's position plus an offset and Euler rotation, then poll `Game.FindEntityByID` (up to 10 tries) | `exEntitySpawner.Spawn(template, transform, app, record)` | [source] CharLi `cl.glow.lua:1465-1470, 297-330, 485-490`; AMM `Modules/props.lua:1838, 1901` |
| Follow V | Watches the puppet's position and yaw each update and moves every light with `TeleportationFacility.Teleport(entity, position, angles)`. In photo mode it follows the photo-mode puppet, caught with `ObserveAfter('PhotoModePlayerEntityComponent', 'SetupInventory')` → `self.fakePuppet`. | Moves with `Teleport` | [source] CharLi `init.lua:33-35`, `cl.core.lua:27-42, 1567-1630`, `cl.glow.lua:1477-1479` |
| Control | `FindComponentByName(name)`, then `SetColor(Color)`, `SetIntensity`, `SetRadius`, `SetAngles(inner, outer)`, `ToggleLight(bool)` | Finds components whose class contains `LightComponent`; same setters. Local shadows can't be switched at run time, so AMM respawns the `_shadows` variant. | [source] CharLi `cl.glow.lua:1562-1688`; AMM `Modules/light.lua:310-327, 375-455, 506-514, 571-589` |
| Remove | `GetEntity():Destroy()` with a destruction poll; everything on CET shutdown | `Dispose()` | [source] CharLi `cl.glow.lua:333-366, 1490`, `cl.core.lua:1646-1655` |

`exEntitySpawner` is a CET function. From redscript, Codeware's `DynamicEntitySystem` is the equivalent (AMM spawns NPCs with it) [source] AMM `Modules/spawn.lua:3-25, 602-612`. A third route sets every light field, not only those with a setter: World Builder spawns an empty entity through Codeware's `StaticEntitySystem` and adds a light component built from data as the entity assembles ([photo-mode lights §3](photo-mode-lights.md#3-spawning-lights-from-a-mod)). None of these mods' templates may be reused (no open licence, [provenance follow-ups](../research/provenance-followups.md)), so a bridge rig needs its own light entity.

**A scripted light sweep** follows from this: spawn one spot light, then for each step set its position on a circle around V's head (fixed radius and height, azimuth in steps), aim it at the head, wait a frame and capture. With photo-mode lights alone, a sweep can vary brightness, colour and cone but not direction.

## 6. The photo-mode cursor

- **The cursor is its own game controller.** `CursorGameController` shows and hides the cursor by playing a context animation through `ProcessCursorContext(context, data, force)`, where the contexts include `Show` and `Hide` [source] 2.31 `cursorGameController.script:120-175, 343-359`.
- **AMM's technique:** override `CursorGameController.ProcessCursorContext` to keep a reference to the controller and replace any context with `Hide` while its setting is on; toggling calls `ProcessCursorContext("Hide"/"Show", nil)` on the kept controller. It applies this when photo mode opens [source] AMM `init.lua:443-451`, `Modules/tools.lua:4419-4432, 4533-4535`. In redscript the same is a `@wrapMethod(CursorGameController)` on `ProcessCursorContext` plus a flag, and the kill switch clears the flag [hypothesis].
- **Not the menu fade.** Fading the menu (`OnFadeVisibility`) hides the menu, not the cursor; the first session's captures showed the cursor [runtime].
- **The bridge's version** [offline]: `photo.hud.hide` sets a flag that our `@wrapMethod(CursorGameController)` on `ProcessCursorContext` reads (every context becomes `Hide`, but only while photo mode is active, so no other menu can inherit a hidden cursor); the wrap notes each cursor controller it sees and replays each one's own state when the flag changes. Photo mode opening or closing, any bridge status read outside photo mode, an idle disconnect and the kill switch clear the flag (`projects/xf-runtime-bridge/redscript/XFRuntimeBridgeActions.reds`). The next session checks it with the pointer over V's face.
- Other candidates, not tested: the native `PhotoModeCursorStateChangedEvent { cursorEnabled, keepCursorPosition }` (imported by Codeware), the menu layer's `inkMenuLayer_SetCursorVisibility.Init(false)` event, or moving the Windows cursor out of the capture region before a capture [source] Codeware `scripts/Base/Imports/PhotoModeCursorStateChangedEvent.reds`; 2.31 `entityPreviewGameController.script:201-209`; effect [hypothesis].

## 7. Keeping the creator's rows in step with scripted changes

- **A row applies its own change.** Each option row is a `characterCreationBodyMorphOption`. Its `SetSelectedSwitcherOption`, `SetSelectedAppearanceDefinition` and `SetSelectedMorphName(info, index, force)` set the row's label text and fire `OnSliderChange`, to which the menu responds by calling `ApplyChangeToOption(option, index)`, moving the preview camera to that body region and marking itself busy [source] 2.31 `characterCreationBodyMorphListItem.script:365-391, 422-470`; `characterCreationBodyMorphMenu.script:473-483`.
- **A direct system call bypasses the row.** The menu only refreshes rows when the system sends `OnOptionUpdated` or `OnAppearanceSwitched` (for linked options); it then calls `UpdateOption(i, lookup, new)` → the row's `SetOption(newOption)` [source] same menu `:388-464`. A bare `ApplyChangeToOption` from outside leaves the label stale unless the system sends one of those events.
- **So the bridge has two options** [source; behaviour in game untested]:
  1. **Drive the row** (preferred): find the row whose option's `info.uiSlot` matches, and call its `SetSelected…(info, index, true)`. That is what the arrows do, so label, camera and busy state stay consistent.
  2. **Refresh after the fact:** re-read the option from `GetUnitedOptions` and call the menu's `UpdateOption` for each row, or the row's `SetOption`. `SetOption` passes `force = true`, so it re-sends `OnSliderChange`; the repeated `ApplyChangeToOption` with the same index should do nothing further.
- **The bridge drives the row** [offline]: `cc.apply` finds the row by `uiSlot` and calls `SetSelectedAppearanceDefinition`, `SetSelectedMorphName` or `SetSelectedSwitcherOption` (or the colour row's `SetSelectedAppearanceDefinitionColor`) with `force = true`, and uses the bare system call only when no row shows the option; the result says which (`route`).
- **Colour rows** (`characterCreationBodyMorphColorOption`) have their own `SetOption` and a picker path that also ends in `ApplyChangeToOption` [source] `characterCreationBodyMorphMenu.script:804-830`.
- **For photo mode the same idea already works:** `GetMenuItem(key).ForceValue(value, true)` updates the row and the system together. Photo Mode Pose Selector and Photo Mode Preferences fall back to `OnForceAttributeVaulue` [source] PMPS `init.lua:787-814`, PMP `init.lua:616-630`. Photo Mode Ex rebuilds a whole option list and its label with the native `FireSetupOptionSelectorEvent` [source] PMEx `PhotoModeExService.cpp:1031-1054`.

## 8. Other levers for automated sessions

### 8.1 Photo-mode attributes worth knowing

The full menu on this install had 92 items [runtime] (the first session's `photo.state` dump):

| Page | Attributes |
|---|---|
| Camera (0) | 16 camera type (FPP / Drone), **23 preset**, 1 FOV (1–120 with PMU), 26 depth of field, 33 autofocus, 3 focus distance, 4 aperture, 2 roll, 39 full collision, 40 aspect ratio, 73 black bars, 42 camera speed; 3401 control scheme and 3402 snap to terrain (Photo Mode Ex) |
| Environment (1) | **69 weather**, **70 time of day** (0–1440 minutes), **71 game speed** (0–1), 72 frame skip |
| V (2) | 38 character, **27 character visible**, 5 pose category, 6 pose, 83 outfit preset, 32 muzzle flash, **28 facial expression** (207 with the Mega Pack, 210 with one three-face XF set; the option's value is its position in the list, not the face table index: menu 56 "Static: Sleeping" was index 60 in session 4 [runtime]), 15 look at camera, 74–77 look-at body part and angles, 7/3421/3422 yaw/pitch/roll, 8/9/37 left-right/close-far/up-down |
| Characters (3) | **54 surrounding NPCs**, 55 characters (spawn), 68 edit character, 3433 appearance (Photo Mode Ex), 56/65/57 NPC expression, category and pose, 60–62/66 and 3431/3432 NPC placement |
| Lights (4) | 43–53, see §5.1 |
| Effects (5), colour balance (6) | 10 exposure, 11 contrast, 24 highlights, 12 vignette, **13 chromatic aberration**, **25 grain**, 14/64 effect; 84–93 colour balance |
| Stickers and frames (7), saved settings (8) | 35, 22, 34; 29–31 |

Attribute numbers can shift with the game version and with mods that add rows; the bridge validates each one against the options the menu set up.

### 8.2 World, NPCs and V

| Need | Technique | Grade |
|---|---|---|
| Put V in a known open spot | `GetTeleportationFacility().Teleport(player, position, EulerAngles(0, 0, yaw))`; AMM keeps named spots as JSON (`x`, `y`, `z`, `w`, `yaw`) | [source] AMM `Modules/tools.lua:1785, 1825-1856` |
| Time and weather | In photo mode: attributes 69–71 (the bridge's `world.time.set` refuses there, `not_in_gameplay` [runtime] session 4, so the time attribute is the route in photo mode). In gameplay: `TimeSystem.SetGameTimeByHMS`, Codeware `WeatherSystem.SetWeather(name, blend, priority)` / `ResetWeather` | [runtime] menu; [source] AMM `Modules/tools.lua:3606-3609, 3813-3817` |
| Freeze the world | `TimeSystem.SetTimeDilation(reason, 0)` and `SetTimeDilationOnLocalPlayerZero` (the creator's own freeze); AMM clamps 0 to 1e-13 for slow motion | [source] §3.2; AMM `Modules/tools.lua:3747-3798` |
| Hide NPCs | In photo mode: attribute 54 off. In gameplay: AMM disposes NPCs within 20 m found with `TargetingSystem` (`TSQ_NPC`) | [runtime]; [source] AMM `Modules/tools.lua:2201-2203`, `Modules/util.lua:806-822` |
| Keep NPCs harmless | `SetAttitudeTowards(player, AIA_Friendly)`, `GodModeSystem.AddGodMode(id, Immortal, …)`; V `SetInvisible(true)` | [source] AMM `Modules/director.lua:1426-1428`, `Modules/util.lua:906-916`, `Modules/tools.lua:539-543` |
| Freeze one character | `TimeDilationHelper.SetIndividualTimeDilation(entity, reason, 0)` (AMM, Photo Mode Pose Selector) | [source] AMM `Modules/tools.lua:2448-2473`; PMPS `init.lua:335-345` |
| Catch the photo-mode V puppet | Wrap `PhotoModePlayerEntityComponent.SetupInventory` and keep `fakePuppet` (record `Character.Player_Puppet_Photomode`) | [source] PMPS `r6/scripts/PhotoModePoseSelector/PhotoModeVTargetBridge.reds:55-73`; CharLi `init.lua:33-35` |
| A reference NPC beside V | Photo Mode Ex turns every `Character` record with `persistentName: PhotomodePuppet`, an entity template and an icon into a photo-mode character (Photomode NPCs Extended adds 208 this way); spawn with attribute 55 and place with 60–62/66; three NPC slots. Outside photo mode: Codeware `DynamicEntitySystem.CreateEntity(spec)` (AMM). | [source] PMEx `PhotoModeExService.cpp:102-245`, `src/Red/PhotoMode.hpp:96`; [resource] NPCs Extended yaml; AMM `Modules/spawn.lua:20-25, 602-670` |
| Poses and expressions | In photo mode: attributes 5/6 and 28 (an expression's option data is its **position in the menu list, not its `faceId`**: with the Mega Pack "Static: Sleeping" is option 56 and faceId 60 [runtime] session 4; the table index reaches the face only through the stand-in, [facial expressions §3](facial-expressions.md#the-chain)). Outside: AMM plays poses through a workspot entity (`PlayInDeviceSimple` + `SendJumpToAnimEnt`) and NPC expressions through `AnimFeature_FacialReaction`; see [facial expressions](facial-expressions.md). How the pose lists, records and clips fit together is in [poses](poses.md) | [runtime] [source] AMM `Modules/anims.lua:344-407`, `Modules/tools.lua:2368-2395` |
| A calmer look-at | `GameOptions.SetFloat("LookAt", "MaxIterationsCount", …)` slows or freezes the look-at-camera turn for every character until reset | [source] AMM `Modules/tools.lua:484-491` |
| Hide the photo-mode menu, not the game | The ink tree under `inkPhotoModeLayer` (`options_panel`, `input_panel`, `others`) can be hidden widget by widget, as Customisable Photo Mode UI does on each `OnShow` | [source] `r6/scripts/CustomisablePhotoModeUI.reds:3-11, 49-107` |

**Persistence to watch:** AMM's HUD toggle changes the player's real `/interface/hud/*` settings, and the look-at option is global; any bridge use must record and restore them [source] AMM `init.lua:1353-1367`. Photo Mode Ex keeps some values per save (§9.4) [source].

## 9. The three save slots

Vanilla photo mode's "saved settings" page (attributes 29–31) keeps three slots. Players report that restoring a slot loses details they set. What follows was decoded from the maintainer's local 2.21 and 2.31 saves, read-only with the Studio's save container codec, and cross-read with Photo Mode Ex's native layouts. **[offline]** marks our reading of those saves. The design built on it is in [photo-mode snapshots](../research/runtime/photo-snapshots-design.md).

### 9.1 Where the slots live

- **In the save file**, in five root nodes: `PhotoMode_Settings` (the slots), `PhotoMode_LightSettings`, `PhotoMode_OutfitWeather` (2.3 and later), `PhotoMode_NewStickersEditor` and `PhotoMode_QuestRequest`, next to `photoModeSystem` [offline]. `photoModeSystem` is a count and 8-byte TweakDBIDs, probably the unlocked photo-mode items [hypothesis].
  - So the slots belong to one save. A slot written after the last save is gone once an earlier save loads, and each save and character has its own three [offline; the in-game effect is a hypothesis until tested].
- **Save and load are native.** The menu passes the hold actions `PhotoMode_SaveSettings` and `PhotoMode_LoadSettings` with the slot's attribute key to the native `OnHoldComplete(attributeKey, actionName)`. No script sees what is stored [source] 2.31 `photoModeMenuController.script:134, 831-854`.
- The native system reads and writes attribute values through `PhotoModeSystem::GetAttributeValue`, `SetAttributeValue(key, value, apply)` and `ProcessAttribute`. These are in the address library (IDs 818420519, 815536999, 2433030483), next to `UpdatePoseDependents` (231086722), `UpdateCategoryDependents` (3893174133), `ApplyPuppetTransforms` (2694650124) and `SetRelativePosition`/`SyncRelativePosition` (1847598004, 4175827669). A slot load is probably a replay of the stored values through these [source] Photo Mode Ex `src/Red/Addresses/Library.hpp:19-43`, `src/Red/PhotoMode.hpp`; replay [hypothesis].

### 9.2 What a slot holds

`PhotoMode_Settings` is a u32 count (3) and three slot records, then a second array of three records that is empty in every save seen (its purpose is unknown). Counts inside a record are the save's packed integers (VLQ). Each record holds, in order [offline]:

| Field | Encoding | What it holds |
|---|---|---|
| Label | Save string | The date and time of saving; empty for an unused slot |
| **Attribute values** | Count, then float32 × count, indexed by attribute key | **94 values in 2.3x (keys 0–93), 69 in 2.21 (keys 0–68):** the vanilla key range of that version. Values in real slots match the menu: FOV (1), pose category and pose (5, 6), V's close/far (9), look at camera (15), camera type (16), expression (28), look-at body part and angles (74–76), time of day (70), colour balance (83–91) |
| Stickers | Count (10), then 10 × 16 bytes | Zero in every slot seen |
| Pose category | i32 | Repeats key 5; −1 when unused |
| **Pose** | Save string `<animationName>__<time>` | e.g. `solo_pose1__0.000000`, `CrossArms__0.000000`: the pose by clip name as well as by list index |
| Camera | 7 × float32 | Small values, e.g. (−0.80, −1.66, 0, 1.55, 1.67, 0.04, 24), with the FOV last. Probably pitch and yaw in degrees and a position **relative to V** [hypothesis] |

- **`PhotoMode_LightSettings`**: three slots of three light records, then three 42-byte entries per slot [offline]. The 2.21 record (about 110 bytes) held each light's **world position and rotation**, e.g. (−570.0, 805.2, 26.9). The 2.3x record is 58 bytes, and every 2.3x save seen has default lights, so whether positions are still stored is open.
- **`PhotoMode_OutfitWeather`**: three slots, each with three inner entries (per NPC slot? [hypothesis]). Not decoded.
- **`PhotoMode_NewStickersEditor`**: three slots of 10 sticker indices, −1 for empty [offline].

### 9.3 Why details get lost

| Cause | What it hits | Grade |
|---|---|---|
| **Keys outside the vanilla range are never stored** | Every Photo Mode Ex row: V's pitch and roll (3421, 3422), NPC pitch, roll and appearance (3431–3433), control scheme, snap to terrain, adjustable steps. Photo Mode Ex keeps them in its own per-character map (`s_characterAddons`), which the native slot never reads. Also everything other mods add (AMM props and NPCs, spawned lights) and anything changed outside the menu | [offline] save layout; [source] Photo Mode Ex `PhotoModeExService.cpp:32-36, 666-716` |
| **One value per key for three NPCs** | The NPC rows (55–57, 60–62, 65, 66) edit whichever NPC is selected, and the slot has one value per key. Photo Mode Pose Selector has to switch the menu page and selection to read each NPC's placement for the same reason | [offline]; [source] Photo Mode Pose Selector `init.lua:1644-1760` |
| **Stored, but reset by the pose** | Changing a pose runs `UpdatePoseDependents`, which applies the pose record's `lookAtPreset`, `positionOffset` and `rotation` and resets the character's look-at state (`allowLookAtCamera`, `lookAtCameraPreset`, `lootAtCameraState` on the native character). If the replay sets look-at (74–77), expression (28) or placement (7, 8, 9, 37) before the pose finishes applying, the pose can overwrite them. Photo Mode Pose Selector re-applies V's look-at 3 frames (0.05 s) after events that reset it, which fits this reading | [source] Photo Mode Ex `PhotoMode.hpp` character layout, `PhotoModeExService.cpp:380-400`; Photo Mode Pose Selector `init.lua:72-73, 976-996`; the reset on slot load [hypothesis] |
| **Placement depends on the control scheme** | Photo Mode Ex's alternative controls rewrite the character's `relativePosition`, so a slot saved under one scheme may land elsewhere under the other | [source] Photo Mode Ex `PhotoModeExService.cpp:455, 560, 570` (`FixRelativePosition`); effect [hypothesis] |
| **Pose lists shift** | Keys 5 and 6 are list indices, which move when pose packs change. Whether the loader falls back to the stored clip name is unknown | [offline]; [hypothesis] |
| **Per-save storage** | Loading an earlier save, or switching characters, brings a different set of slots | [offline] |

### 9.4 Persistence in Photo Mode Ex

Photo Mode Ex stores `alternativeControls`, `snapToTerrain` and `depthOfField` per save in its own persistent state (`PhotoModeExPS : PersistentState`, fetched from the persistency system when photo mode starts). Its pitch and roll values are not persisted [source] `src/App/PhotoMode/PhotoModeExPS.hpp`, `PhotoModeExService.cpp:272`.

## 10. Holding the head and eyes

### 10.1 The global look-at option

- **What mods do:** the legacy Photo Mode Tools script and AMM both call `GameOptions.SetFloat("LookAt", "MaxIterationsCount", …)`. 0.9 "freezes" the head and eyes, 1.0 lets them move, and 3.0 is written back as the "restore" value. Neither reads the original value first [source] legacy `photo_mode_tools/init.lua:2-22`; AMM `Release/bin/x64/plugins/cyber_engine_tweaks/mods/AppearanceMenuMod/Modules/tools.lua:484-491`.
- **CET passes the float through unchanged** to the engine's option setter, typed as a float, and logs an error if the engine refuses it. So the freeze is not CET truncating 0.9 to 0 [source] CET `9a8522f` `src/scripting/GameOptions.cpp:107-110, 133-145, 264-278`.
- **It is an engine config variable**, registered at the engine's option init as CET's option patches are. It is not in `engine/config`, and CET never writes it to disk, so it resets when the game restarts [source] CET `GameOptions.h:3-56`, `OptionsPatch.cpp:9-38`; [resource] negative search of `engine/config`; reset [hypothesis].
- **Why below 1 freezes** [hypothesis]: the engine takes the whole part as the look-at solver's iteration count. At 0 the solver stops and the last look-at pose holds. The option is global, so while it is below 1 every character's look-at holds, including NPCs and in scenes. Whether 3.0 is the engine default is unconfirmed; `GameOptions.Print("LookAt", "MaxIterationsCount")` in game shows the type, value and default.

### 10.2 Actor-scoped levers on the photo-mode stand-in

| Lever | What it does | Grade |
|---|---|---|
| **Individual time dilation, following the world's** | Photo Mode Pose Selector freezes one character with `SetIndividualTimeDilation(n"PMPSPhotoMode", 1.0, 0.0, n"None", n"None", false, false)` and releases it with the same call and `ignoreGlobalDilation = true`. The stand-in normally ignores the frozen world's dilation, and this makes it follow it, so its graph (look-at and blinks) stops. It releases the freeze automatically when a pose, category or expression changes, and on shutdown | [source] Photo Mode Pose Selector `init.lua:19-26, 329-400`; 2.31 `orphans.script:11871-11873` |
| Look-at attributes | 15 (look at camera) and 74–77 (body part: upper body 0, head 1, eyes 2; angles) are menu rows, stored in slots, and reset by pose changes (§9.3) | [runtime] menu; [source] Photo Mode Pose Selector `init.lua:27-32` |
| `LookAtAddEvent` / `LookAtRemoveEvent` | A static target with per-part weights (eyes, head, chest) queued on the stand-in; untested on a posed stand-in ([poses](poses.md) open question 8) | [source]; effect [hypothesis] |
| `AnimFeature_PhotomodeBodyPartRotate` | The graph's head and chest rotation inputs (`RotateHeadX`…), on top of any pose | [resource] [source] ([poses §7](poses.md#7-what-the-body-graph-does-after-the-pose-clip)); effect [hypothesis] |

**Recommendation.** Freeze with individual time dilation, which is scoped to one character, already works in a published mod, and releases by name. Hold an exact direction by restoring look-at part and angles after the pose settles (§9.3). Keep the global option only as a fallback behind a settings guard: read the original value, apply only while photo mode is open, and restore the original on exit, save load, CET reload or shutdown, session end and the kill switch.

## Open questions

1. What does the native `TogglePhotoMode` handler call, and can a plugin call it safely? Does a posted key press (`photo.open` with `route: postmessage`, which never changes focus) reach the game? `SendInput` with focus does [runtime].
2. ~~Does Character Customization Anywhere's Confirm keep the look on 2.31?~~ **Answered in session 4:** yes; it opens with `updating_finalized_state` true in the `NewGame` edit mode (§3.1).
3. Which `m_editMode` does the in-world mirror pass, and does the native `ReFinalizeState` save or autosave? (`cc.open`'s idle-scenario event away from a mirror: no, it leaves the backdrop half-open and the menu busy; §3.1.) Does `cc.open`'s pause-menu redirect (0.4.2) open it anywhere, as CCA's does, and with which edit tag (HairDresser, or NewGame as CCA's F12 ran; `edit_mode`, 0.5.1)? Does photo mode's own time-of-day slider (attribute 70, which `world.time.set` sets in photo mode since 0.4.2) give the world's clock back when photo mode closes? (Session 5 compares `game_status`'s `world_time_seconds` before and after; until then the bridge's photo-mode undo never touches the world's clock.)
4. Is the camera PRESET placed relative to V's spawn position and yaw, and how does collision change it? Can the camera entity from `PhotomodeCameraSwitchedEvent` be teleported and stay put?
5. ~~Does photo mode keep a light moved with the teleportation facility where it was put?~~ **Answered in session 4:** yes (`held: true`, and the face is lit from there; §5.1).
6. Does the AMM-style `Hide` context hide the photo-mode cursor without side effects on the menu's mouse input?
7. Does the system send `OnOptionUpdated` after an external `ApplyChangeToOption`, for any option type?
8. Does a vanilla slot load restore look-at (74–77), expression and V's placement, or does the pose's own setup reset them? Does it find a moved pose by the stored clip name? Do 2.3x light slots keep light positions? What do the second `PhotoMode_Settings` array and `PhotoMode_OutfitWeather` hold? (The [snapshot design's session](../research/runtime/photo-snapshots-design.md#7-first-game-session-test-plan) answers these.)
9. Is `LookAt/MaxIterationsCount` a float with default 3, and does 0.9 hold every character's look-at, NPCs and scenes included? Does following the world's time dilation freeze the stand-in's look-at without side effects on its pose changes?

## Related pages

[Runtime access](runtime-access.md) · [Facial expressions](facial-expressions.md) · [Poses](poses.md) · [Character-creator lighting](creator-lighting.md) · [Game crashes](game-crashes.md) · [Bridge autonomy backlog](../research/backlog/bridge-autonomy.md) · [Runtime bridge design](../research/runtime/runtime-bridge-design.md) · [Test card](../research/runtime/runtime-bridge-test-card.md)
