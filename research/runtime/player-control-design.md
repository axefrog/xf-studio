# Player control through the runtime bridge (design)

**Status: research and design, 29 September 2026; nothing here is built or seen in the game.** The request: drive V directly from the XF Runtime Bridge (walk her in a direction or to a point, turn the camera instantly or smoothly, use what she is looking at, pick dialogue choices, and the other things a player does) through the game's own systems, not through other mods' screens or key bindings. This page records what the game offers for each capability, grades it, proposes a command set with its safety rules, and ends with a ten-minute first test card. The distilled, reusable part is on the knowledge page [player control](../../knowledge/player-control.md). The bridge itself is described in the [runtime bridge design](runtime-bridge-design.md); its safety model (§4), threading (§3.3) and the load gate that session 5's crash taught us (bridge 0.5.2: no script call outside the window between the session's player attach and its detach, checked on the game thread right before each call; recorded on [game crashes](../../knowledge/game-crashes.md)) apply unchanged and are extended here.

Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[source]** read in game scripts, a clone or an installed mod; **[resource]** read in game files; **[offline]** exercised by our own tools; **[runtime]** seen in the game; **[hypothesis]** not established.

## 1. Sources read

| Source | Version | Used for |
|---|---|---|
| Game scripts, decompiled with redscript-cli 0.5.31 into a private scratch folder | 2.31, `final.redscripts` SHA-256 `2119046f…ee86` | Player state machine (PSM), teleport, targeting look-at, interactions, dialogue hubs, equipment, menus, navigation |
| Game input configuration `r6/config/inputContexts.xml`, `inputUserMappings.xml` | 2.31 | Action names and their keys and pad buttons |
| Game executable imports and the address library `bin/x64/cyberpunk2077_addresses.json` | 2.31 (file version 3.0.80.51928) | How input reaches the game; named engine functions |
| `red-dump-json` | `a8e52990` (pre-2.3) | Native classes and functions scripts don't declare |
| RED4ext.SDK | `ad727771` (1.0.0 + 21) | Generated layouts (`FPPCameraComponent`, input systems) |
| Cyber Engine Tweaks | `v1.37.1-9-g9a8522f` | Its window-procedure input trap; how it instantiates `FunctionalTestsGameSystem` |
| Codeware | clone `v1.20.4`; installed 1.20.5 | Its raw-input hook and input-event layout; its import of the functional-test system |
| Appearance Menu Mod | clone `1.8.4-167-g5427235` | Player teleport, free camera, restriction effects |
| Input Loader | clone `v0.2.3-12-gf92f7dc` | How input actions are registered (they are not fired) |
| Native Interactions Framework | clone `041f17e` | External camera offset; scene-based interactions |
| Installed mods (read in place, `mods/<name>/` in the mod manager) | FreeFly (Noclip) 2.4.0, Immersive Third Person - Best Of Both Worlds 1.3.0, 0-Engine 0.13.0 | Noclip flight, third-person camera and 360-degree movement, PSM state cache |

`experiments/player-control/probe_offline.py` reproduces the import, address-library, RTTI-dump and script-API facts below from a game folder, a `red-dump-json` clone and (optionally) a decompiled bundle; it only reads.

## 2. Findings by capability

### 2.1 Summary

| Capability | Best route | Feasible now? | Grade |
|---|---|---|---|
| Teleport with facing | `TeleportationFacility.Teleport(player, position, EulerAngles(0, 0, yaw))` | Yes | [source]; used by AMM and FreeFly |
| Snap a destination to walkable ground | `NavigationSystem.FindPointInSphereOnlyHumanNavmesh`, `IsNavmeshStreamedInLocation` | Yes | [source] |
| Plan a walk to a point | `NavigationSystem.CalculatePathOnlyHumanNavmesh(start, end, Human, tolerance)` → `NavigationPath.path` | Yes | [source] |
| Walk with the game's locomotion and animation | Synthetic movement input (no script route) | Needs an input channel (§2.5) | [source] no script path; channel [hypothesis] |
| Move without animation ("glide") | Per-tick teleport along a navmesh path, as FreeFly flies | Yes | [source] |
| Turn to face a yaw instantly | Teleport in place with the new yaw | Yes | [source] |
| Aim the camera at a point, smoothly or quickly | `TargetingSystem.LookAt(player, AimRequest)`, `BreakLookAt` | Yes | [source]; the scanner, melee and a thrown-knife item use it |
| Set pitch exactly | `LookAt` at a point at that pitch; `PlayerFunctionalTests.SetCameraOrientation` is a lead | Yes (via a point) | [source]; lead [hypothesis] |
| Our own free or third-person camera | Spawn `base\entities\cameras\simple_free_camera.ent`, `CameraComponent.Activate`, move it with `Teleport` | Yes | [source] AMM |
| Read what V is looking at | `TargetingSystem.GetLookAtObject(player)`; `InteractionManager.IsInteractionLookAtTarget` | Yes | [source] |
| Read the offered interaction and dialogue choices | `UIInteractions` blackboard: `InteractionChoiceHub`, `DialogChoiceHubs`, `ActiveChoiceHubID`, `SelectedIndex`, `LootData`, `LastAttemptedChoice` | Yes | [source] |
| Select a device choice without input | Queue `InteractionChoiceEvent` on the device (its `OnInteractionUsed` runs `ExecuteAction`) | Probably | [source] handler; our event [hypothesis] |
| Select any choice, dialogue included | Fire the choice's own input action (`Choice1`…`Choice4`, `DialogConfirm`, scroll) | Needs an input channel | [source] no script route |
| Crouch | Status effect `GameplayRestriction.ForceCrouch` (the sniper nest's route) | Yes | [source] |
| Draw, holster, switch weapon | `EquipmentSystemWeaponManipulationRequest` to the equipment system | Yes | [source] |
| Consume an item or heal | `ItemActionsHelper.ConsumeItem`, `UseHealCharge` | Yes | [source] |
| Open inventory, map, journal, perks, crafting | `StartHubMenuEvent.SetStartMenu(name)` through `UISystem.QueueEvent` | Yes | [source] |
| Open the wardrobe | `inkMenuInstance_SpawnEvent.Init(n"OnOpenWardrobeMenu", WardrobeUserData)` through `UISystem.QueueEvent` | Yes | [source] |
| Jump, sprint, dodge, slide | Input only (PSM decisions read the actions) | Needs an input channel | [source] |
| Input without window focus | `FunctionalTestsGameSystem.FakeInput*` (CDPR's test input), a virtual XInput pad, or a hook in the decoded input stream | Research (§2.5) | [source] existence; behaviour [hypothesis] |

### 2.2 Moving V

**Teleport.** The game's only script teleport is `TeleportationFacility.Teleport(objectToTeleport, position: Vector4, orientation: EulerAngles)` and `TeleportToNode(object, NodeRef)` [source] 2.31 `orphans.script:31933-31938`. Fast travel resets the camera pitch, then teleports to a node (`playerPuppet.GetFPPCameraComponent().ResetPitch()`, `TeleportToNode`) [source] `core/systems/fastTravelSystem.script:321-341`. AMM teleports the player with `EulerAngles.new(0, 0, yaw)` and "freezes" her by teleporting her to where she stands [source] AMM `Modules/tools.lua:1782-1786`, `Modules/util.lua:516-523`; FreeFly teleports her every frame and turns her by the yaw argument [source] FreeFly `modules/utils/logic.lua` (`logic.fly`). So the orientation argument sets V's facing (her yaw is the first-person camera's yaw), and teleporting in place is how a script turns her instantly. Pitch lives in the first-person camera, not in the entity [source] SDK `game/FPPCameraComponent.hpp` (pitch limits at `0x3E0`, `headingLocked` at `0x3F6`; the pitch itself is in an unnamed field).

Teleport risks and how the design meets them:

| Risk | Why | Answer |
|---|---|---|
| Landing inside geometry, in the air or off the world | `Teleport` checks nothing | Snap the destination to navmesh (`FindPointInSphereOnlyHumanNavmesh`, radius 2 m) and require `IsNavmeshStreamedInLocation` [source] `core/systems/navigationSystem.script:8, 18, 24-40`; refuse `no_ground` / `not_streamed` unless `ground: "exact"` is asked for |
| Far jumps before the world streams in | Streaming follows the player | Cap the distance (50 m by default); a longer jump needs `far: true` and waits for `IsNavmeshStreamedInLocation` and a stable `IsOnGround` read afterwards [source] `navigationSystem.script:41` |
| Quest and area triggers | Entering or leaving a trigger volume can advance a quest | Disposable save and the bridge's save lock, as for every write; no teleport during a scene (§3) |
| Speed-dependent state | A teleport mid-jump or mid-slide leaves the PSM in the air state | Refuse unless `Locomotion` is `Default` or `Crouch` and `Fall`/`Landing` are idle (PSM blackboard) [source] `orphans.script:6647-6661` |

**Walking.** No script sets the player's movement input. The PSM reads it (`scriptInterface.GetActionValue(n"MoveX")`, `n"MoveY"`, `GetInputHeading()`) only to choose states [source] `cyberpunk/player/psm/defaultTransition.script:587-588, 639`; `orphans.script:42516-42572`; the character's motion comes from native code fed by the input system. Four routes, ranked:

1. **Synthetic movement input** (the real walk, with the game's own locomotion, animation, collision, stairs and sprint): hold the movement axis through an input channel (§2.5) while steering, and follow a navmesh path. Heading follows the camera in first person, so steering is `TargetingSystem.LookAt` towards the next path point, or a teleport-in-place yaw between steps. Grade: the path and steering [source]; the channel [hypothesis].
2. **Glide** (available with no new native work): move V along the navmesh path by a per-tick `Teleport` at walking speed (about 1.4 m/s), heading along the path, as FreeFly flies but grounded. It ignores physics (the path keeps to navmesh) and plays no walk cycle [hypothesis: the third-person body's locomotion graph reads the character's velocity, which a teleport doesn't set]. FreeFly and AMM's free camera hold the player's own input off meanwhile with `GameplayRestriction.NoMovement` (and FreeFly `NoZooming`, `NoCombat`) [source] FreeFly `logic.toggleFlight`; AMM `util.lua:541-561`. Answers say `animated: false`.
3. **PSM slide** (research): the PSM's own `AdjustTransformWithDurations` request (`SetPosition`, `SetSlideDuration`, `SetRotation`, `SetRotationDuration`, `SetTarget`, `SetDistanceRadius`, `SetGravity`, `SetCurve`) set as the temporary parameter `adjustTransform` [source] `orphans.script:42776-42798`, `defaultTransition.script:319-345`. The game uses it for melee lunges, takedown alignment and turning a knocked-down V towards the hit (`locomotionTransitions.script:5112-5121`). It needs a live `StateContext`, which only PSM callbacks receive; Immersive Third Person keeps the one its wrap of `StandEvents.OnTick` sees and turns V's body with a rotation-only request [source] ITP `r6/scripts/immersive_third_person/tpp_camera_bridge.reds:2030-2057`. Holding a state context between ticks is that mod's choice; we would set the request from inside our own PSM wrap instead. Slides are short and not a walk cycle [hypothesis].
4. **AI navigation on the player**: the quest system can move puppets (`questMovePuppetNodeDefinition` with `questMoveToParams`) and has a streaming-test node that moves the player on a spline (`questStreamingTestMovePlayerOnSpline_NodeType`) [source] `red-dump-json`; no evidence that the player accepts AI move commands, and a spline needs a world node. Not pursued.

Walking risks: **the PSM** (refuse outside `Default`/`Crouch` locomotion and high-level `Default`; stop on `Fall`, `Landing`, `Swimming`, `IsInWorkspot`, a takedown or body carry); **cutscenes and scenes** (refuse at scene tier 3 and above and whenever `SceneSystemInterface.IsEntityInScene` or `IsEntityInDialogue` is true [source] `orphans.script:32248-32252`, `6685-6693`); **falling** (follow navmesh paths only; stop at once on the `Fall` state; for input walks, stop when progress along the path stalls for a second); **the player's own input** (any real input cancels a motion, §3.2).

### 2.3 The camera

- **Look direction, read:** `CameraSystem.GetActiveCameraForward/Right/Up` and `GetActiveCameraWorldTransform` [source] (the bridge already reads them for photo mode); pitch = `asin(forward.z)`, yaw from `forward.x, forward.y`. `GameObject.GetWorldYaw()` gives V's facing [source] `core/entity/entity.script:48`. What she aims at: `TargetingSystem.GetLookAtObject / GetLookAtComponent / GetLookAtPosition(player, withLOS, ignoreTransparent)` [source] `orphans.script:22401-22405`.
- **Look at a point, smoothly or fast:** `TargetingSystem.LookAt(instigator, AimRequest)` turns the player's camera in yaw and pitch towards `lookAtTarget` over `duration` (with `maxDuration`, `easeIn`/`easeOut`, `precision`, `adjustYaw`/`adjustPitch`, `endOnTargetReached`, `endOnTimeExceeded`, `endOnCameraInputApplied`, `cameraInputMagToBreak`, `processAsInput`), and `BreakLookAt` ends it [source] `orphans.script:22413-22423, 26044-26088`. The scanner's target switch (`core/systems/hud/hudManager.script:640-670`, 0.1 s, `processAsInput`), melee (`defaultTransition.script:720-755`), an item action that makes the player look at a thrown knife (`cyberpunk/items/combat_gadgets/kurtThrowableKnife.script:295-313`) and an effect executor (`cyberpunk/strike/executors/executorLookAt.script:1-24`, 0.25 s with easing) all call it from outside a PSM callback, so a system can. `endOnCameraInputApplied = true` lets the player's own mouse or stick break it, which is what the design wants.
- **Instant:** yaw by a teleport in place (§2.2), pitch by a `LookAt` with a very short duration; the answer reports the reached yaw and pitch read back from the camera. `PlayerFunctionalTests.SetCameraOrientation` exists as a native in retail RTTI with its parameters stripped [source] `red-dump-json` `PlayerFunctionalTests.json`; a lead for an exact set, only after its parameters are recovered (§2.5).
- **First-person camera component:** `PlayerPuppet.GetFPPCameraComponent()` (component name `camera`) has `ResetPitch()` and the placed-component `SetLocalPosition/SetLocalOrientation` [source] `orphans.script:16646-16664, 27006-27011`; its `pitchMin/pitchMax/yawMaxLeft/yawMaxRight/headingLocked` are script-writable fields in CET, which Native Interactions Framework uses to pull the camera 2 m behind V for an external view and Immersive Third Person uses to free the look while its own camera renders [source] NIF `modules/ui/interactionUI.lua:38-62`; ITP `init.lua:1029-1070`. Writing the component's local orientation for pitch is [hypothesis]: the native camera controller probably rewrites it each frame from its own pitch state.
- **Third person (Immersive Third Person).** ITP owns a second camera component on the player (`tppCamera`), activates it, and sets its local orientation and position every frame from its own orbit state, fed by the player's `CameraMouseX/Y` and pad axes caught in `PlayerPuppet.OnAction`; switching back it resets the first-person camera (`ResetPitch`, neutral orientation, origin) and re-activates it [source] ITP `init.lua:3890-3920, 4490-4600`. Its RED4ext plugin `ImmersiveThirdPersonMove360` swaps the native handlers of `StateGameScriptInterface.GetActionValue` and `GetInputHeading` in the game's native-function table (with guards that refuse when the table can't be proven) so the PSM sees the movement it wants for 360-degree movement [source] the DLL's own log strings. So under ITP, `player.look` turns V (and ITP's camera follows her heading with its orbit offset), but it does not set ITP's orbit; the answer reports `perspective: "tpp_mod"`. Driving ITP's orbit would mean depending on another mod's internals, which the self-contained rule excludes.
- **Our own free camera** (for third-person views and fly-throughs without another mod): spawn `base\entities\cameras\simple_free_camera.ent`, take its `camera` component, `Activate(blendTime, false)`, `SetFOV`, move it with `TeleportationFacility.Teleport(cameraEntity, position, angles)` each tick; release with `Deactivate` and `GetFPPCameraComponent().Activate()`; while it is active AMM applies `NoMovement`, `NoCameraControl`, `NoZooming`, `NoCombat` and more to V and swaps her head in so she is seen [source] AMM `Modules/camera.lua` (`Spawn`, `Activate`, `Deactivate`, `Move`), `util.lua:541-561`. The bridge's design matrix already lists this as the most promising repeatable framing route ([design §7.5](runtime-bridge-design.md#75-world-and-player)).
- **FreeFly** is not a camera: it is noclip, moving the player entity by per-frame teleports along the active camera's forward and right vectors, turning by the teleport's yaw plus the mouse's `CameraMouseX`, with `NoMovement`, `NoZooming` and optionally `NoCombat` applied and health topped up [source] FreeFly `init.lua`, `modules/utils/logic.lua`, `miscUtils.lua`.

### 2.4 Interaction and dialogue

**Reading.** The native interaction manager publishes what the HUD shows on the `UIInteractions` blackboard (auto-created, global) [source] `core/blackboard/blackboardDefinitions.script:805-838`; the HUD's base controller listens to exactly these fields [source] `cyberpunk/UI/interactions/interactionUIBase.script:30-107`:

| Field | Type | Holds |
|---|---|---|
| `InteractionChoiceHub` | `InteractionChoiceHubData { id, flags, active, title, choices: [InteractionChoiceData], timeProvider }` | The world interaction prompt (doors, terminals, pickups, NPCs) [source] `orphans.script:42008-42021` |
| each `InteractionChoiceData` | `{ inputAction: CName, rawInputKey, isHoldAction, localizedName, type, data: [Variant], captionParts }` | Its label is `GetLocalizedText(localizedName)`; `inputAction` is the action that selects it (`Choice1`…`Choice4`, or a hold variant) [source] `orphans.script:54537-54552`; `interactionsUIChoiceItem.script:64, 152` |
| `DialogChoiceHubs` | `{ choiceHubs: [ListChoiceHubData { id, activityState, flags, isPhoneLockActive, title, choices: [ListChoiceData { localizedName, type, inputActionName, captionParts, timeProvider }] }] }` | Dialogue and scene choices; `inputActionName` is a choice's dedicated input where it has one [source] `orphans.script:42023-42026, 54489-54517`; `dialogUI.script:312-324` |
| `ActiveChoiceHubID`, `SelectedIndex` | Int | Which hub and which line is highlighted |
| `LootData`, `ContactsData` | Variant | The loot list and the phone's contacts |
| `LastAttemptedChoice` | `InteractionAttemptedChoice { visualizerType, choice, choiceIdx, isSuccess }` | What was last chosen and whether it worked (the prevention system listens to it) [source] `orphans.script:33653-33662`; `core/systems/preventionSystem.script:1150` |

**Selecting.** The manager turns the choice's input action into an `InteractionChoiceEvent { hotspot, activator, layerData, choice: InteractionChoice, actionType }` sent to the hotspot's entity [source] `orphans.script:18261-18268, 22133-22144, 35785-35790`. The script API of `InteractionManager` has only `IsInteractionLookAtTarget`, `SetBlockAllInteractions` and `AreSceneInteractionsBlocked` [source] `orphans.script:33671-33678`, and the scene system's script interface has no choice call [source] `orphans.script:32199-32252`; the dialogue UI only draws [source] `cyberpunk/UI/interactions/dialogUI.script`. So:

- **Any choice, dialogue included, through input:** fire the choice's own `inputAction` (a press, or a hold for `isHoldAction`). Dialogue: step `ChoiceScrollUp/Down` until `SelectedIndex` is the target, then `DialogConfirm` (`IK_F`, `IK_Enter`, pad X) or the line's dedicated input; confirm with `LastAttemptedChoice` [source] `r6/config/inputUserMappings.xml:1175-1200`. Needs an input channel (§2.5).
- **Device choices without input:** devices handle the event with `OnInteractionUsed(evt) → ExecuteAction(evt.choice, evt.activator, evt.layerData.tag)` [source] `cyberpunk/devices/core/interactiveDevice.script:276-278`; containers, vehicles and items have similar handlers (`core/components/lootContainers.script:113`, `gameVehicleMountableComponent.script:4-12`, `inventoryComponent.script:44`). Queuing our own `InteractionChoiceEvent` on the look-at device (checked with `IsInteractionLookAtTarget`) with a choice rebuilt from the hub is plausible [hypothesis: whether the hub's `data` variants are the device actions the handler expects, and whether script can fill an `importonly` event's fields]. Scene and dialogue choices don't go through device handlers, so this route never covers dialogue. Native Interactions Framework's usable spots are scene interactions too (it processes scene resources) [source] NIF `r6/scripts/nativeInteractions.reds`, so they also need the input route.

### 2.5 Synthetic input

**How input reaches the game** [resource] imports of the 2.31 executable (`probe_offline.py`): `RegisterRawInputDevices` and `GetRawInputData` (keyboard and mouse as Raw Input), `XInputGetState` from `XINPUT9_1_0.dll` (Xbox pads), `HID.DLL` (other pads), and `GetForegroundWindow`, `ClipCursor`, `SetCursorPos`. The address library names `input::InputSystemWin32Base::Update` (hash `261693736`) and CET resolves `input::InputSystemWin32Base::ForceCursor` (`2130646213`) [source] CET `src/reverse/Addresses.h:62-63`. CET's overlay traps input by swallowing mouse, keyboard and `WM_INPUT` messages in its window-procedure hook [source] CET `src/d3d12/D3D12.cpp:27-50`. Codeware reads decoded input by hooking `inkSystem::ProcessInputEvents(system, a2, RawInputBuffer&)` (hash `673454961`), whose buffer holds `RawInputData { EInputKey key, EInputAction action, float value, mouseX, mouseY, … }` (0x40 bytes) [source] Codeware `src/App/Callback/Controllers/RawInputHook.hpp`, `src/Red/Input.hpp`, `src/Red/Addresses/Library.hpp:53`. Session 5 showed that posted key messages never reach the game (Raw Input only comes from the system's input stream), and that `SendInput` works only with the game in front ([photo mode §2.3](../../knowledge/photo-mode.md#23-routes-to-the-full-photo-mode)) [runtime].

**Input Loader** registers actions; it never fires them. It merges `r6/input/*.xml` (or a plugin's file through `InputLoader::Add`) into copies of `inputContexts.xml` and `inputUserMappings.xml` under `r6/cache` and writes `engine/config/platform/pc/input_loader.ini` so the game reads those copies [source] Input Loader `src/Main.cpp:52-226`, `readme.md`. Mods then listen with `RegisterInputListener` or observe `PlayerPuppet.OnAction` (15 installed mods do the latter, [survey](../mod-ecosystem/README.md)). Nothing installed injects an action.

**Candidate channels, ranked:**

| # | Channel | What it is | For | Against | Grade |
|---|---|---|---|---|---|
| 1 | **`FunctionalTestsGameSystem`** | CD PROJEKT RED's own functional-test system, in retail RTTI with 60 native functions including `FakeInputPressAction`, `FakeInputReleaseAction`, `FakeInputHoldAction`, `FakeInputClickAction`, `FakeInputMultitapAction`, `FakeInputAxisAction`, `FakeInputReleaseAxisAction`, `FakePressButton`, `FakeReleaseButton`, `FakeSetAxis`, `TakeOverInput`, `ReleaseAllInput`, `LookAtPosition`, `NavigateFlatTowards`, `NotifyReachedCurrentDestination`, `TeleportPlayer`, `GetPlayerPosition`, `GetPlayerOrientation`; beside it `PlayerFunctionalTests.SetCameraOrientation`, `NavigationFunctionalTests.GetPathOnNavmesh`, `UIFunctionalTests.Play`/`IsPlaying` | Action-level input from inside the game, independent of the window and focus if it feeds the action layer; the game's own test harness, so the most "self-contained" route | Retail RTTI lists every one of these functions with **no parameters** (red-dump-json; Codeware 1.20.5 re-declares the class with empty parameter lists, `Codeware.Global.reds:16732-16791`); the retail game does not register the system: CET creates it as a singleton so its spawner works (`RTTIExtender.cpp:660-667`), and CET re-adds the parameters of `WorldFunctionalTests.SpawnEntity` itself when it finds none (`params.size == 0`, `RTTIExtender.cpp:585-625`) and calls that native's retail body, kept for mods that still use it. Whether the fake-input bodies do anything outside the test engine (`FunctionalTestsGameEngine`, `FunctionalTestsInputManager`) is unknown | Existence [source]; behaviour and parameters [hypothesis] |
| 2 | **Virtual XInput pad** | Replace the game's `XInputGetState` import (an import-table entry in-process, installed at plugin load) with one that returns the real pad's state merged with ours | Analog movement (left stick: walk to run by magnitude), look (right stick), every pad button (`Choice1` is pad X, photo mode is both sticks clicked, `IK_PAD_LR_THUMB` [source] `inputUserMappings.xml:2066-2069`); a well-understood mechanism, reversible by restoring the entry | Whether the game polls pads when not in front is unknown (it imports `GetForegroundWindow`); the game switches its prompts and hints to pad glyphs while a pad is in use; aim assist and pad sensitivity apply; the player's own pad must pass through | Mechanism [source] (imports); focus and effect [hypothesis] |
| 3 | **Decoded input buffer** | Append `RawInputData` entries in a before-hook of `inkSystem::ProcessInputEvents`, the hook Codeware already uses to read keys | Key-level, no OS input | This is the UI system's copy; whether gameplay actions come from the same buffer is unknown; a second hook on a function Codeware hooks | [source] hook point; effect [hypothesis] |
| 4 | Hook `input::InputSystemWin32Base::Update` | Inject at the source, before action mapping | Everything | Needs reverse engineering of the input system's queue; per-build | [hypothesis] |
| 5 | `SendInput` with the game in front | What `photo.open` does | Proven | Needs focus; catches the player's own typing; not self-contained | [runtime] |

**Plan:** a read-only runtime probe first, then offline disassembly, then one supervised call.

1. `input.probe` (read, no call): is `FunctionalTestsGameSystem` in the game instance (`GameInstance::GetSystem` by type, which CET's singleton makes true)? For each `Fake*`, `TakeOverInput`, `ReleaseAllInput`, `LookAtPosition`, `NavigateFlatTowards` and `PlayerFunctionalTests.SetCameraOrientation`: the function's flags, parameter count and native handler's address as an offset in the executable. Is the game window in front? Which import entry does `XInputGetState` resolve to?
2. Offline: disassemble each handler at the reported offset (`dumpbin /disasm /range:` on the installed executable, read only, as [game crashes §2.1](../../knowledge/game-crashes.md#21-calling-scripts-from-native-code) did) and read which stack-frame parameter reads it makes and with which types, to rebuild each signature (probably a `CName` action and a float or duration), and whether it bails out when a test-engine object is missing.
3. One supervised call on a disposable save: `FakeInputPressAction` of a harmless action whose effect is visible and reversible (`ToggleCrouch` in V's apartment, or the photo-mode action), with a probe log line before it ([game crashes §3](../../knowledge/game-crashes.md#3-finding-the-crashing-call-in-few-restarts)), first with the game in front, then behind another window. The same call with `TogglePhotoMode` answers bridge 0.5.2's item 7 (photo mode without focus).
4. If the test system does nothing in retail, build channel 2 (virtual pad) behind its own switch and test the same two things.

### 2.6 Other player actions (routes)

| Action | Route | Grade |
|---|---|---|
| Crouch / stand | Apply or remove `GameplayRestriction.ForceCrouch`; the PSM checks the `ForceCrouch` tag, and the sniper nest uses exactly this [source] `defaultTransition.script:1203`, `cyberpunk/devices/sniperNest/sniperNest.script:346, 359` | [source] |
| Jump | Input only: `JumpDecisions` wakes only on a `Jump` input event and reads `IsActionJustPressed(n"Jump")` [source] `locomotionTransitions.script:4141-4185` | [source] |
| Sprint, dodge, slide | Input only; sprint also needs movement input within an angle of forward [source] `locomotionTransitions.script:1461-1540` | [source] |
| Draw, holster, switch weapon | `EquipmentSystemWeaponManipulationRequest { owner, requestType }` queued on the equipment system, `requestType` from `EquipmentManipulationAction` (`RequestLastUsedOrFirstAvailableWeapon` 7, `UnequipWeapon` 21, `RequestWeaponSlot1-3` 27-29, `RequestFists` 19) [source] `orphans.script:11191-11221, 28176-28184`; `cyberpunk/player/disarmComponent.script:127-135` | [source] |
| Consume, heal | `ItemActionsHelper.ConsumeItem(executor, itemID, fromInventory)`, `UseHealCharge(executor, itemID)` [source] `cyberpunk/items/actions/itemActionsHelper.script:4, 55` | [source] |
| Inventory, map, journal, perks, crafting | `StartHubMenuEvent.SetStartMenu(n"inventory_screen" \| n"world_map" \| n"quest_log" \| n"new_perks" \| n"crafting_main")` through `GameInstance.GetUISystem(game).QueueEvent`, as a shard opens the codex [source] `cyberpunk/UI/fullscreen/ingame/inGameScenarios.script:2-12`, `inGameMenuGameController.script:501-526`, `cyberpunk/puppet/scriptedPuppet.script:564-568` | [source] |
| Wardrobe | `inkMenuInstance_SpawnEvent.Init(n"OnOpenWardrobeMenu", new WardrobeUserData())` through the UI system, as the wardrobe device does [source] `cyberpunk/devices/wardrobe/wardrobeController.script:43-53`, `inGameScenarios.script:110-112` | [source] |
| Close a hub menu | `ForceCloseHubMenuEvent`, which the in-game menu turns into `OnCloseHubMenuRequest` [source] `inGameMenuGameController.script:274-276`, `questCodexLink.script:296-297`; sent through the UI system [hypothesis] | [source] handler |
| Pause menu | The menu-event blackboard (`OnOpenPauseMenu`), as `cc.open` already does ([photo mode §3.1](../../knowledge/photo-mode.md#31-how-character-customization-anywhere-opens-it)) | [source] |
| Photo mode | `photo.open` (the key with the game in front) until the input channel works | [runtime] |

## 3. Command set

A new permission class **`write-player`** (reversible player changes) and **`act-player`** (irreversible actions in the world: using devices, dialogue, consuming), each listed separately in `allow_write_classes` and withheld by default; `input.*` is `control` and test-profile only, like `photo.open`. Every command runs on the game thread through the redscript actions layer, returns `undo` where it means something, and refuses with a named reason.

| Command | Class | Parameters | Route | Undo |
|---|---|---|---|---|
| `player.state` | read | — | Position, V's yaw, camera yaw and pitch, PSM snapshot (`Locomotion`, `HighLevel`, `SceneTier`, `Vehicle`, `Combat`, `Swimming`, `IsInWorkspot`, `Fall`, `Landing`, `Takedown`, `BodyCarrying`), in combat, mounted, in scene or dialogue, photo mode, a menu open, the look-at object (entity id, class, distance, whether it is the interaction target), the perspective (`fpp`, `tpp_mod`, `xf_free_camera`), any active motion | — |
| `player.teleport` | write-player | `position` or `offset {forward, right, up}`; `yaw` (absolute) or `turn` (relative); `ground: "snap"` (default) or `"exact"`; `far` | `Teleport(player, pos, EulerAngles(0, 0, yaw))` after the ground and streaming checks; reads back two ticks later (`held`) | Previous position and yaw |
| `player.look` | write-player | `yaw`, `pitch` (degrees, absolute or `relative`), or `at {position}` / `at {entity}`; `mode: "instant"` or `"smooth"`; `duration_s` (≤ 5); `ease` | Instant: teleport in place for yaw, a very short `LookAt` for pitch. Smooth: one `LookAt` to a point 10 m along the wanted direction, with `endOnCameraInputApplied`; reports the reached angles | Previous yaw and pitch |
| `player.look.stop` | write-player | — | `BreakLookAt` | — |
| `player.move` | write-player | `to {position}` or `direction {yaw, relative}` with `distance_m` (≤ 50) or `duration_s` (≤ 30); `speed: "walk"`, `"jog"`, `"sprint"`; `route: "input"` or `"glide"` | Path from `CalculatePathOnlyHumanNavmesh`; `input`: hold the movement axis through the input channel and steer with `LookAt` towards the next point; `glide`: per-tick teleport along the path with `NoMovement` held; stops on arrival (0.5 m), stall (under 0.1 m in 1 s), fall, a refusal state or the player's input | Start position and yaw (a teleport back) |
| `player.stop` | write-player | — | Ends every motion: releases held input, `BreakLookAt`, ends a glide, removes the effects the bridge applied | — |
| `camera.free` / `camera.free.move` / `camera.free.release` | write-player | `position`, `yaw`, `pitch`, `fov`; `to`, `duration_s`; `blend_s` | Spawned `simple_free_camera.ent`, `Activate`, per-tick `Teleport`; V's head shown and her input held off while active | Release restores the first-person camera and removes the effects |
| `player.interact.list` | read | — | The `UIInteractions` fields in §2.4, labels localised, each choice with its index, input action and hold flag; the hub `id` for a stale check | — |
| `player.interact.select` | act-player | `index` or `label`; `hub_id` from the list; `route: "input"` or `"event"` | `input`: fire the choice's own input action; `event`: a device's `InteractionChoiceEvent` (devices only); refuses `stale_hub` if the hub changed since the list | None (world change) |
| `player.use` | act-player | — | The first choice of the active interaction hub | None |
| `player.dialogue.choose` | act-player | `index` or `label`; `hub_id` | Input route: scroll until `SelectedIndex` matches, then confirm; checks `LastAttemptedChoice` | None |
| `player.action` | write-player or act-player | `name`: `crouch` / `stand` (ForceCrouch effect), `weapon.draw` / `weapon.holster` / `weapon.slot {1-3}` (equipment requests), `consume {item}` / `heal` (item actions, act-player), `menu.open {inventory, map, journal, perks, crafting, wardrobe, pause}` / `menu.close`; input-only names `jump`, `sprint`, `dodge {direction}` need the channel | Per §2.6 | Crouch, weapon and menu undo their own change; consume none |
| `input.probe` | read | — | §2.5 step 1 | — |
| `input.action` | control (test profile) | `action` from an allowlist; `kind: "press" \| "release" \| "hold" \| "axis"`; `value`; `ms` (≤ 2000) | The best available channel; releases everything on stop | Release |

## 4. Safety

### 4.1 The moment

Every `write-player` and `act-player` command checks, on the game thread right before it acts, and refuses with the reason:

| Refusal | Check | Commands |
|---|---|---|
| `game_loading` | The 0.5.2 game gate: no script call before the session's player attaches or after its detach ([game crashes](../../knowledge/game-crashes.md)) | All, reads included |
| `in_combat` | `PlayerPuppet.IsInCombat()`, PSM `Combat` | All except `player.stop` |
| `in_vehicle` | `VehicleComponent.IsMountedToVehicle(game, player)` [source] `vehicleComponent.script:255`, PSM `Vehicle` | All except `player.state`, `player.stop`; menus allowed |
| `in_scene` | Scene tier 3 and above (`gamePSMHighLevel` 3-5), `SceneSystemInterface.IsEntityInScene` | All except `player.dialogue.choose`, `player.interact.*` (a scene's choices are the point) |
| `in_dialogue` | `IsEntityInDialogue` | `player.teleport`, `player.move`, `player.look` |
| `busy` | PSM locomotion not `Default`/`Crouch`, `Fall`/`Landing` active, swimming, a workspot, a takedown or a carried body, a menu open, photo mode, the player dead | `player.teleport`, `player.move`, `camera.free` |
| `not_streamed`, `no_ground`, `too_far` | §2.2 | `player.teleport`, `player.move` |
| `stale_hub` | The hub id or labels differ from the list the caller used | `player.interact.select`, `player.dialogue.choose` |
| `no_input_channel` | The input channel is not proven on this build | Input routes |

Irreversible actions (`act-player`) also take the bridge's save lock first, like every write, and the session starts from a disposable save.

### 4.2 Stopping

- **Kill switch:** the existing one (CET hotkey, `bridge.kill`, `KILL` file) calls `player.stop` first on the next Running tick: releases every held input (and `ReleaseAllInput` if the test channel is used), `BreakLookAt`, ends a glide, removes every status effect the bridge applied (it keeps the list), releases a free camera and re-activates the first-person camera. This joins `RestoreAfterKill` ([design §4](runtime-bridge-design.md#4-safety-model)), and like it waits for the game gate.
- **The player pre-empts:** real input cancels a motion. With the test-input or buffer channels the bridge knows what it injected, so any other movement, camera, jump or crouch action seen in `PlayerPuppet.OnAction` stops the motion (`user_took_over`); with the virtual pad, any keyboard or mouse action does, and any pad input beyond what the bridge wrote. `LookAt` with `endOnCameraInputApplied` breaks itself.
- **Detach:** a motion is dropped without a script call when the gate closes (a load, a detach), and never resumes.
- **Held input is never left held:** every press has a release scheduled at its end, on stop, on the gate closing and on plugin unload; the pad channel restores the original import entry on unload.

### 4.3 Caps

| Cap | Default |
|---|---|
| One motion at a time (a new one replaces the old after a stop) | — |
| `player.move` duration / distance | 30 s / 50 m |
| `player.look` smooth duration | 5 s |
| `player.teleport` distance without `far` | 50 m |
| Teleports | 2 a second |
| `input.action` hold | 2 s; axis values clamped to [-1, 1] |
| Choice selection | One per hub id; a new list needed after a change |
| Allowlisted input actions | Movement and camera axes, `Jump`, `ToggleCrouch`, `Sprint`, `ToggleSprint`, `Dodge*`, `Choice1-4`, `ChoiceScrollUp/Down`, `DialogConfirm`, `TogglePhotoMode`; never `QuickSave`, `QuickLoad`, `OpenPauseMenu` (menus have routes), attack or throw actions |

## 5. Threading and gating

- Every command is one game-thread task (the bridge's queue, §3.3 of its design), made through the one script-call routine with a caller frame and a context. The load gate is checked on the game thread right before each call, not when the request is queued.
- **Motions** (`player.move`, a smooth `camera.free.move`, a glide, a held input) are a small controller the plugin owns and ticks from its Running `OnUpdate`: one redscript call per frame (`XFPlayer.Tick(dt)`) only while a motion runs, which reads the PSM and position, checks the stop conditions and sets the next step. `LookAt` itself runs natively once asked, so a smooth look needs no per-frame calls. The controller's state lives in the plugin, so a detach drops it without touching scripts.
- **Input channels** run where the game reads input: the test system's calls on the game thread; a pad's state returned from our `XInputGetState` replacement on whatever thread the game polls from, reading a lock-free snapshot the game thread writes.
- Nothing is saved: status effects the bridge applies are temporary and removed on stop; the session ends by loading its save.

## 6. Build order

1. **Script routes, no new native hooks (0.6):** `player.state`, `player.teleport`, `player.look` (+ `stop`), `player.move {route: "glide"}`, `player.stop`, `player.interact.list`, `player.action` (crouch, weapons, consume, menus), `camera.free*`, `input.probe`; the two new permission classes; the kill-switch additions.
2. **Input channel research:** the probe's offline disassembly and one supervised call per §2.5; then `input.action`, `player.move {route: "input"}`, `player.interact.select {route: "input"}`, `player.dialogue.choose`, jump, sprint, dodge, and photo mode without focus.
3. **Fallbacks:** the device event route for `player.interact.select`; the virtual pad if the test system is inert; a PSM-slide experiment only if both fail.

## 7. First in-game test card (about 10 minutes)

**Setup:** the bridge build with §6 phase 1, the test profile with `write-player` and `act-player` allowed, a fresh manual save in V's apartment, V on foot and unarmed, the game window in front. M is the maintainer, C the coordinator (or agent).

| # | Who | Step | Expect | If not |
|---|---|---|---|---|
| P1 | C | `player.state`, `input.probe` | Position, yaw and pitch that match the view; PSM `Default`, scene tier 2, `perspective: "fpp"`; the probe lists the functional-test functions with their parameter counts and handler offsets and says whether the system exists | Record; phase 2 needs the probe's numbers |
| P2 | C | `player.teleport {offset: {forward: 2}, turn: 90}`, then its undo | V stands 2 m ahead turned right, then back where she was; `held: true` both times | `no_ground`: record the position |
| P3 | C, M | `player.look {yaw: +45, pitch: -20, mode: "instant"}`; then `{at: {entity: <look-at object>}, mode: "smooth", duration_s: 2}`; during a third smooth look M moves the mouse | The view jumps, then glides over 2 s and reports the reached angles within 2 degrees; M's mouse breaks the third look | Angles off: record the answer and a capture |
| P4 | C | `player.move {direction: {yaw: 0}, distance_m: 3, route: "glide"}`; then `player.stop` mid-way in a second one | V glides 3 m and stops; `animated: false`; the stop ends the second glide at once | Record the stop reason |
| P5 | C | `player.action crouch`, then `stand`; `weapon.draw`, then `weapon.holster` | V crouches and stands; draws her last weapon and holsters it | Record |
| P6 | C | `player.action menu.open {inventory}`, then `menu.close`; the same with `wardrobe` near nothing | The inventory opens and closes; the wardrobe opens away from a wardrobe | Record which step |
| P7 | C, M | M stands V in front of the apartment door or a light switch. `player.interact.list`; `player.interact.select {index: 0, route: "event"}` | The list shows the prompt's labels with `Choice1`; the device reacts (door opens, light toggles) | Nothing happens: record; the input route is the answer |
| P8 | C, M | During a 10 s glide, M presses the kill hotkey | The glide stops, no effect is left (V moves again with WASD), the first-person camera is active | Stop the session; record |

**Friction log:** note every manual step, wait and surprise, as for every session.

## 8. Open questions

1. Do `FunctionalTestsGameSystem`'s fake-input natives work in the retail engine, with which parameters, and without window focus? (§2.5)
2. Does the game poll XInput while its window is not in front?
3. Does the gameplay input path consume the same decoded buffer as `inkSystem::ProcessInputEvents`?
4. Can script construct an `InteractionChoiceEvent` a device accepts, from the hub's choice data? (§2.4)
5. Does a glide play any locomotion animation on V's third-person body, and does it trip area triggers the way walking does?
6. Is the first-person camera's pitch settable directly (component local orientation, or `PlayerFunctionalTests.SetCameraOrientation`), or only through `LookAt`?
7. Does `LookAt` with a very short duration land exactly (within `precision`), and does it respect the camera's pitch limits?
