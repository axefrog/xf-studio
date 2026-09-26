# Photo mode and the character creator from script

**Maturity: Draft.** How Cyberpunk 2077's photo mode and the in-game character creator (the mirror's appearance screen) can be opened, driven and left from script, and which techniques from published photo-mode mods an automated test session can reuse. Consolidated on 26 September 2026 from the decompiled 2.31 script bundle (redscript-cli 0.5.31), the game's input configuration, RED4ext.SDK and the pre-2.3 RTTI dump, the source of photo-mode, camera and lighting mods (installed releases, and public repositories where they exist), and the XF Runtime Bridge's first in-game session. Claims marked [runtime] were seen in that session (26 September 2026, game 2.31, heavily modded profile); everything else waits for a game session. Grades follow the [knowledge rules](README.md). The bridge itself is described in [runtime access](runtime-access.md).

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
| Can a script open the full photo mode the way the player's key does? | **No script-visible route found.** The key sends the input action `TogglePhotoMode`, which native code handles. `PhotoModeSystem` exposes only five script functions, none of which opens it. Codeware's quest-node route opens a **restricted** photo mode (§2). The practical routes are sending the player's own photo-mode key to the game window, or a native call that still needs reverse engineering. | [source] [resource]; restricted result [runtime] |
| Can a script open the character creator anywhere? | **Yes:** switch the menu system to the scenario `MenuScenario_CharacterCustomizationMirror`, which is what Character Customization Anywhere does, from the pause menu (§3). The bridge's `cc.open` does it from the idle scenario with its own menu event (§3.1). | [source]; `cc.open` [offline] |
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
| **Send the player's key to the game** | Read the effective binding (the default `IK_N`, or the player's rebinding), bring the game window to the front, and send that key press to it. It is only needed once per session, since `photo.exit` already closes photo mode through the menu. | The game must have focus. The game's input API (raw input or window messages) decides whether posted messages suffice or `SendInput` is needed. It is input injection, so it must target only the game window and be allowlisted and logged. Built as the bridge's `photo.open`, approved for the test profile (26 September); not yet run in game. | [hypothesis] |
| Native entry point | Find the native function the `TogglePhotoMode` handler calls (the caller of `Activate`) in the address library or by disassembly, and call it on the main thread from the plugin | Needs reverse engineering. A wrong call crashes, and the address must be refreshed per game build | [hypothesis] |
| Quest node | As above | Opens only the restricted photo mode | [runtime] |

## 3. Opening, confirming and leaving the character creator

### 3.1 How Character Customization Anywhere opens it

A 38-line CET mod [source] `bin/x64/plugins/cyber_engine_tweaks/mods/characterCustomizationAnywhere/init.lua`:

1. **It captures the in-game menu controller:** `Observe('gameuiInGameMenuGameController', 'RegisterGlobalBlackboards', …)` stores `self` (`:5-7`). This is why the mod says to reload a save if the hotkey does nothing.
2. **On its hotkey it opens the pause menu:** `inGameMenu:SpawnMenuInstanceEvent('OnOpenPauseMenu')`, and sets a flag (`:30-38`), which is the same event the game's own pause key sends [source] 2.31 `inGameMenuGameController.script:210`.
3. **It redirects the pause menu:** `Override("MenuScenario_PauseMenu", "OnEnterScenario", …)` calls `this:SwitchToScenario("MenuScenario_CharacterCustomizationMirror")` instead of opening the pause menu while the flag is set (`:9-16`).
4. **It supplies the creator's menu data:** `Override("MenuScenario_CharacterCustomizationMirror", "OnCCOPuppetReady", …)` opens the menus `player_puppet` and `character_customization` with a new `MorphMenuUserData` (`:18-27`).

The vanilla mirror scenario does the same thing when it gets its data: `OnEnterScenario` marks the data `m_updatingFinalizedState = true` and opens `character_customization_scenes`, and `OnCCOPuppetReady` opens `player_puppet` and `character_customization` [source] 2.31 `inGameScenarios.script:217-247`.

**A 2.31 caveat.** CCA writes the fields `optionsListInitialized`, `updatingFinalizedState`, `editMode` and `currMenuName`, but in 2.31 they are `m_optionsListInitialized`, `m_updatingFinalizedState`, `m_editMode` and `m_currMenuName` [source] 2.31 `orphans.script:52919-52927`. CET stores a write to an unknown property on the Lua object and never reaches the game object [source] CET `src/reverse/Type.cpp:58-63, 260-277`, `RTTIHelper.cpp:949-975`. So on 2.31 the creator probably opens with `m_updatingFinalizedState = false`, the new-game mode, in which Confirm moves on to the next menu instead of saving the look (§3.3) [hypothesis]. It worked in the first session, where it was only used to preview changes that were then discarded [runtime]. Don't rely on CCA's Confirm until this is checked (open question 2).

**The bridge's route (`cc.open`, batch 3)** [source; in game unverified]: no pause menu and no wrapped vanilla function. The bridge adds its own event to the idle scenario (`@addMethod(MenuScenario_Idle) protected cb func OnXFBridgeOpenCreator()`, the way Mod Settings adds its pause-menu event) and raises it through the game's menu-event blackboard (`MenuEventBlackboard.MenuEventToTrigger`, set to `None` first, as `GameObject.TriggerMenuEvent` does; the in-game menu controller turns the name into a scenario event) [source] 2.31 `gameObject.script:2480-2490`, `inGameMenuGameController.script:76, 294`. The event does something only when the bridge asked for it in the last three seconds (a flag on its registry), and checks the moment again; it then calls `SwitchToScenario(n"MenuScenario_CharacterCustomizationMirror", data)` with a new `MorphMenuUserData` carrying an edit tag. The vanilla `OnEnterScenario` sets `m_updatingFinalizedState = true`, and `OnCCOPuppetReady` passes the same data to the creator, so it opens in the mirror's edit-V's-look mode and Confirm keeps the look. Before asking, the bridge refuses outside normal play, in combat, in a vehicle, with a scene tier above 1, where photo mode isn't allowed, or while the game locks saving for combat, a scene, a tier or a moving platform; it takes its save lock and asks only once the game reports saving locked. A request the menu never picks up (another menu open) is withdrawn after the wait, and the kill switch withdraws a pending one; a screen already open stays open for the player to leave.

### 3.2 Edit modes

`MorphMenuUserData.m_editMode` is `gameuiCharacterCustomizationEditTag`: `NewGame` (0, the default), `HairDresser` (1) or `Ripperdoc` (2) [source] 2.31 `orphans.script:8175-8179`. In any mode other than `NewGame`, the creator freezes the world and V with time dilation 0 under the reason `VendorStash` and restores it on close; `NewGame` enables the voice switcher; `HairDresser` hides some randomiser options [source] `characterCreationBodyMorphMenu.script:222-224, 262-264, 881-883, 1107-1117`; `characterCreationPunkRandomizerMenu.script:380`. Which mode the in-world mirror passes has not been traced.

**The mode decides which rows can change.** The menu calls `ApplyEditTag(mode)` before listing options, and each option carries `editTags` [source] `characterCreationBodyMorphMenu.script:878`. In the vanilla female CCO, `hairstyle`, `eyes_color`, `eyebrows`, `piercings` (and its colour options), `makeupEyes` and `teeth` carry all three tags, while `eyes` (the eye shape), `nose`, `skin_type` and `cyberware` carry `NewGame` and `Ripperdoc` only [resource] `female_cco.inkcharcustomization`; XF Eye Artistry's rows carry all three. So `cc.open` offers `mode: "mirror"` (`HairDresser`) and `mode: "ripperdoc"` (`Ripperdoc`, which adds the face-shape, skin and cyberware rows); it never opens the new-game mode.

**The creator's camera** moves by body region, not page: the base menu's protected native `RequestCameraChange(slot, delayed)` with the slots `GetSlotName` returns (`UI_Skin`, `UI_Hairs`, `UI_Eyes`, `UI_Teeth`, `UI_Nose`, `UI_Lips`, `UI_Jaw`, `UI_HeadPreview`, `UI_FingerNails`, `UI_Preview`, and `m_defaultPreviewSlot` on open) [source] `characterCreationMenu.script:73`, `characterCreationBodyMorphMenu.script:1075-1105`. Hovering a row and a row's own change both request that row's slot (`OnHoverOverOption`, `OnSliderChange`), so `cc.apply` through the row moves the camera to the option's region; an option outside the eyes, hair, teeth, nose, lips and jaw lists (an XF row, for example) goes to `UI_HeadPreview`. `cc.page` requests a slot directly, which makes the `cc-eyes` crop's eyes zoom (`UI_Eyes`) reproducible after an XF row change [source]; whether `UI_Eyes` is the zoom the crop was measured on is [hypothesis].

### 3.3 What Confirm and Back do

| Action | Call chain | Grade |
|---|---|---|
| **Confirm** (the Next button, or the `one_click_confirm` action when no colour picker or confirmation box is open) | `ConfirmCustomizedCharacter()` → if `m_updatingFinalizedState`: `ReFinalizeState()` on the customisation system → event `OnReFinalizeStateCompleteEvent` → `NextMenu()` → `OnAccept` → the scenario's `GotoIdleState()` → `MenuScenario_Idle`. In new-game mode it only calls `NextMenu()`. | [source] `characterCreationBodyMorphMenu.script:272-277, 427-429, 701-712, 768-773`; `characterCreationMenu.script:118-124`; `inGameScenarios.script:212-214, 238-240` |
| **Back** | The first press shows a confirmation box; confirming it runs `ConfirmBackConfirmation()` → `CancelFinalizedStateUpdate()` → event → `OnOutro()` and `OnCancel` → idle. | [source] same file `:682-699, 431-434, 752-767` |
| **Autosave** | No creator or mirror code requests an autosave. The script callers of `RequestAutoSave` and `RequestCheckpoint` are vendors, ripperdocs, perks, fast travel and delayed `AutoSaveEvent`s. Whether the native `ReFinalizeState` saves is not established. | [source] 2.31 `inGameScenarios.script:260-276`, `gameObject.script:2651-2672`, `fastTravelSystem.script:234, 611-620`; native [hypothesis] |

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

**Recommendation:** make framing deterministic in two steps. First put V somewhere known with open space (teleport, §8). Then pick a camera preset whose numbers the test profile controls, and fine-tune with V's offsets. Test whether the preset is relative to V's spawn and survives collision before relying on it (open question 4).

## 5. Lights

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
- **No attribute places a light.** Where a photo-mode light starts, and what `ResetCurrentLightButton` (`IK_R` in photo mode) does to it, are not traced; the light is probably placed relative to the camera when it is switched on [resource] `inputUserMappings.xml` `ResetCurrentLightButton`; placement [hypothesis]. Photo-mode lights are native `gamePhotomodeLightObject` entities with a `gamePhotomodeLightComponent` (an `entLightComponent`), and the menu receives `PhotomodeLightInitializedEvent { light: wref<Entity> }` and projects each light's position for its on-screen indicator [source] SDK generated types; 2.31 `orphans.script:53440-53443`, `photoModeLightIndicatorController.script`. Getting hold of these entities to move them is a lead [hypothesis].

### 5.2 Spawned lights (CharLi and AMM)

Both mods spawn their own light entities and control them through the light component, in or out of photo mode:

| Step | CharLi | AMM | Grade |
|---|---|---|---|
| Templates | Its own `base\charli\*.ent` (spot, area, point) in `charli.archive` | Its own `base\amm_props\entity\ambient_{point,spot,area}_light_controllable[_shadows].ent` | [source] |
| Spawn | `exEntitySpawner.Spawn(template, transform, 2)` at V's position plus an offset and Euler rotation, then poll `Game.FindEntityByID` (up to 10 tries) | `exEntitySpawner.Spawn(template, transform, app, record)` | [source] CharLi `cl.glow.lua:1465-1470, 297-330, 485-490`; AMM `Modules/props.lua:1838, 1901` |
| Follow V | Watches the puppet's position and yaw each update and moves every light with `TeleportationFacility.Teleport(entity, position, angles)`. In photo mode it follows the photo-mode puppet, caught with `ObserveAfter('PhotoModePlayerEntityComponent', 'SetupInventory')` → `self.fakePuppet`. | Moves with `Teleport` | [source] CharLi `init.lua:33-35`, `cl.core.lua:27-42, 1567-1630`, `cl.glow.lua:1477-1479` |
| Control | `FindComponentByName(name)`, then `SetColor(Color)`, `SetIntensity`, `SetRadius`, `SetAngles(inner, outer)`, `ToggleLight(bool)` | Finds components whose class contains `LightComponent`; same setters. Local shadows can't be switched at run time, so AMM respawns the `_shadows` variant. | [source] CharLi `cl.glow.lua:1562-1688`; AMM `Modules/light.lua:310-327, 375-455, 506-514, 571-589` |
| Remove | `GetEntity():Destroy()` with a destruction poll; everything on CET shutdown | `Dispose()` | [source] CharLi `cl.glow.lua:333-366, 1490`, `cl.core.lua:1646-1655` |

`exEntitySpawner` is a CET function. From redscript, Codeware's `DynamicEntitySystem` is the equivalent (AMM spawns NPCs with it) [source] AMM `Modules/spawn.lua:3-25, 602-612`. Neither mod's templates may be reused, so a bridge rig needs its own light entity, or a base-game entity with a light component [hypothesis].

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
| V (2) | 38 character, **27 character visible**, 5 pose category, 6 pose, 83 outfit preset, 32 muzzle flash, **28 facial expression** (207 with the Mega Pack), 15 look at camera, 74–77 look-at body part and angles, 7/3421/3422 yaw/pitch/roll, 8/9/37 left-right/close-far/up-down |
| Characters (3) | **54 surrounding NPCs**, 55 characters (spawn), 68 edit character, 3433 appearance (Photo Mode Ex), 56/65/57 NPC expression, category and pose, 60–62/66 and 3431/3432 NPC placement |
| Lights (4) | 43–53, see §5.1 |
| Effects (5), colour balance (6) | 10 exposure, 11 contrast, 24 highlights, 12 vignette, **13 chromatic aberration**, **25 grain**, 14/64 effect; 84–93 colour balance |
| Stickers and frames (7), saved settings (8) | 35, 22, 34; 29–31 |

Attribute numbers can shift with the game version and with mods that add rows; the bridge validates each one against the options the menu set up.

### 8.2 World, NPCs and V

| Need | Technique | Grade |
|---|---|---|
| Put V in a known open spot | `GetTeleportationFacility().Teleport(player, position, EulerAngles(0, 0, yaw))`; AMM keeps named spots as JSON (`x`, `y`, `z`, `w`, `yaw`) | [source] AMM `Modules/tools.lua:1785, 1825-1856` |
| Time and weather | In photo mode: attributes 69–71. In gameplay: `TimeSystem.SetGameTimeByHMS`, Codeware `WeatherSystem.SetWeather(name, blend, priority)` / `ResetWeather` | [runtime] menu; [source] AMM `Modules/tools.lua:3606-3609, 3813-3817` |
| Freeze the world | `TimeSystem.SetTimeDilation(reason, 0)` and `SetTimeDilationOnLocalPlayerZero` (the creator's own freeze); AMM clamps 0 to 1e-13 for slow motion | [source] §3.2; AMM `Modules/tools.lua:3747-3798` |
| Hide NPCs | In photo mode: attribute 54 off. In gameplay: AMM disposes NPCs within 20 m found with `TargetingSystem` (`TSQ_NPC`) | [runtime]; [source] AMM `Modules/tools.lua:2201-2203`, `Modules/util.lua:806-822` |
| Keep NPCs harmless | `SetAttitudeTowards(player, AIA_Friendly)`, `GodModeSystem.AddGodMode(id, Immortal, …)`; V `SetInvisible(true)` | [source] AMM `Modules/director.lua:1426-1428`, `Modules/util.lua:906-916`, `Modules/tools.lua:539-543` |
| Freeze one character | `TimeDilationHelper.SetIndividualTimeDilation(entity, reason, 0)` (AMM, Photo Mode Pose Selector) | [source] AMM `Modules/tools.lua:2448-2473`; PMPS `init.lua:335-345` |
| Catch the photo-mode V puppet | Wrap `PhotoModePlayerEntityComponent.SetupInventory` and keep `fakePuppet` (record `Character.Player_Puppet_Photomode`) | [source] PMPS `r6/scripts/PhotoModePoseSelector/PhotoModeVTargetBridge.reds:55-73`; CharLi `init.lua:33-35` |
| A reference NPC beside V | Photo Mode Ex turns every `Character` record with `persistentName: PhotomodePuppet`, an entity template and an icon into a photo-mode character (Photomode NPCs Extended adds 208 this way); spawn with attribute 55 and place with 60–62/66; three NPC slots. Outside photo mode: Codeware `DynamicEntitySystem.CreateEntity(spec)` (AMM). | [source] PMEx `PhotoModeExService.cpp:102-245`, `src/Red/PhotoMode.hpp:96`; [resource] NPCs Extended yaml; AMM `Modules/spawn.lua:20-25, 602-670` |
| Poses and expressions | In photo mode: attributes 5/6 and 28 (expressions are chosen by option data, the `faceId`). Outside: AMM plays poses through a workspot entity (`PlayInDeviceSimple` + `SendJumpToAnimEnt`) and NPC expressions through `AnimFeature_FacialReaction`; see [facial expressions](facial-expressions.md). How the pose lists, records and clips fit together is in [poses](poses.md) | [runtime] [source] AMM `Modules/anims.lua:344-407`, `Modules/tools.lua:2368-2395` |
| A calmer look-at | `GameOptions.SetFloat("LookAt", "MaxIterationsCount", …)` slows or freezes the look-at-camera turn for every character until reset | [source] AMM `Modules/tools.lua:484-491` |
| Hide the photo-mode menu, not the game | The ink tree under `inkPhotoModeLayer` (`options_panel`, `input_panel`, `others`) can be hidden widget by widget, as Customisable Photo Mode UI does on each `OnShow` | [source] `r6/scripts/CustomisablePhotoModeUI.reds:3-11, 49-107` |

**Persistence to watch:** AMM's HUD toggle changes the player's real `/interface/hud/*` settings, and the look-at option is global; any bridge use must record and restore them [source] AMM `init.lua:1353-1367`. Photo Mode Ex keeps some values per save [source].

## Open questions

1. What does the native `TogglePhotoMode` handler call, and can a plugin call it safely? Does a posted key press reach the game, or only `SendInput` with focus?
2. When Character Customization Anywhere opens the creator on 2.31, is `m_updatingFinalizedState` false, and does its Confirm keep the look? (Read the menu's field through the bridge, or check whether the bottom buttons show the new-game labels.)
3. Which `m_editMode` does the in-world mirror pass, and does the native `ReFinalizeState` save or autosave? Does `cc.open`'s idle-scenario event open the creator anywhere in the world (no mirror scene around V), as Character Customization Anywhere's pause-menu redirect does?
4. Is the camera PRESET placed relative to V's spawn position and yaw, and how does collision change it? Can the camera entity from `PhotomodeCameraSwitchedEvent` be teleported and stay put?
5. Where does a photo-mode light start when switched on, and can its entity be caught and moved?
6. Does the AMM-style `Hide` context hide the photo-mode cursor without side effects on the menu's mouse input?
7. Does the system send `OnOptionUpdated` after an external `ApplyChangeToOption`, for any option type?

## Related pages

[Runtime access](runtime-access.md) · [Facial expressions](facial-expressions.md) · [Poses](poses.md) · [Character-creator lighting](creator-lighting.md) · [Game crashes](game-crashes.md) · [Bridge autonomy backlog](../research/backlog/bridge-autonomy.md) · [Runtime bridge design](../research/runtime/runtime-bridge-design.md) · [Test card](../research/runtime/runtime-bridge-test-card.md)
