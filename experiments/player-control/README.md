# Player control: offline probe

Offline evidence behind the [player-control design](../../research/runtime/player-control-design.md) and the [player-control knowledge page](../../knowledge/player-control.md). Nothing here touches the running game.

`probe_offline.py` reads a game folder, a `red-dump-json` clone and, optionally, a decompiled script bundle, and prints JSON: the executable's input-related imports, the address library's input-related named symbols, the functional-test classes and their functions, and how often the script APIs the design relies on appear in the bundle.

```
python probe_offline.py --game PATH_TO_GAME --rtti PATH_TO_RED_DUMP_JSON --scripts PATH_TO_DECOMPILED_BUNDLE
```

## Result, 29 September 2026

Game 2.31 (file version 3.0.80.51928), `red-dump-json` `a8e52990`, the bundle decompiled with redscript-cli 0.5.31 (`final.redscripts` SHA-256 `2119046f…ee86`); run under `tools/memory_guard.py --limit 1` (peak 0.5 GB).

| Probe | Result |
|---|---|
| Input imports | `USER32.dll`: `RegisterRawInputDevices`, `GetRawInputData`, `GetForegroundWindow`, `SetForegroundWindow`, `ClipCursor`, `GetCursorPos`, `SetCursorPos`, `SetCursor`, `LoadCursorW`, `MapVirtualKeyW`, `PeekMessageW`; `XINPUT9_1_0.dll`: `XInputGetState`; `HID.DLL`: 11 `HidD_*`/`HidP_*` functions |
| Named input symbols | `input::InputSystemWin32Base::Update` (hash `261693736`, `0001:00149700`) |
| Functional-test classes | `FunctionalTestsGameSystem` (parent `FunctionalTestsIGameSystem`): 60 functions, 0 declared parameters; `PlayerFunctionalTests` 2; `NavigationFunctionalTests` 3; `UIFunctionalTests` 9; `WorldFunctionalTests` 4; `FunctionalTestsInputManager` no functions |
| Script API uses | `GetTeleportationFacility(` 20, `LookAt(…aim…)` 5, `GetLookAtObject(` 9, `new AdjustTransformWithDurations()` 4, `InteractionChoiceHub` 5, `DialogChoiceHubs` 36, `new EquipmentSystemWeaponManipulationRequest()` 20, `ItemActionsHelper.ConsumeItem(` 4, `new StartHubMenuEvent()` 10, `new inkMenuInstance_SpawnEvent()` 7, `GameplayRestriction.ForceCrouch` 2, `CalculatePathOnlyHumanNavmesh(` 3, `GetActionValue(n"…")` 177 |

The counts are regular-expression matches (a guide to where the game uses each API, not an exact call count).
