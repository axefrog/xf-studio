# Runtime bridge design (runtime access baseline)

**Status: phase 2 works in game (26 September 2026); an autonomy batch is built and tested offline.** The first in-game run found that calls into our redscript crashed the game when they reached TweakDB or `TDBID` natives; the cause (a script call with no context) and the fix are in §3.5, and the fix passed its in-game check the same day, after which the reads, photo-mode writes, `cc.apply`, the clock, the freeze and the kill switch's restore worked and session 2 ran through the bridge ([test card](runtime-bridge-test-card.md)). The autonomy batch (§3.6) adds `photo.open` (the player's photo-mode key, sent to the game window only; approved for the test profile), `photo.subject` and `photo.frame`, light on/off, type and shadow, the cursor hidden with the menu, `cc.apply` through the option's row, `cc.confirm`/`cc.back` behind `allow_creator_leave`, `capture.burst` and XF camera presets for the test profile; none of it has been seen in the game. Project: [`projects/xf-runtime-bridge`](../../projects/xf-runtime-bridge/README.md). Consolidated answers live in [knowledge/runtime-access.md](../../knowledge/runtime-access.md) and [knowledge/photo-mode.md](../../knowledge/photo-mode.md).

Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[source]** read in a clone, **[doc]** vendor documentation outside the clones, **[offline]** exercised by our own build or self-test, **[runtime]** seen in the game, **[unverified]**.

## 1. Sources read

| Clone (`D:/Dev/…`) | Revision | Used for |
|---|---|---|
| `RED4ext` | `v1.30.0` (`c52c8d8`) | Loader: plugin discovery, API/runtime checks, loggers, game states, script paths |
| `RED4ext.SDK` | tag `1.0.0` (`a4a78108`), the SDK RED4ext 1.30.0 builds against (`cmake/deps/RED4extSdk.cmake`) | Plugin API, RTTI registration, function execution |
| `redscript` | tag `v0.5.31` | Module naming, annotations, compiler and lint CLIs, log files |
| `CyberEngineTweaks` | tag `v1.37.1` | Lua sandbox, events, logging, RTTI access from Lua |
| `cp2077-cet-kit` | `f64c837` | Session and photo-mode observers |
| `cp2077-tweak-xl` | `v1.11.4` | Tweak loading, YAML flat syntax, logs |
| `cp2077-codeware`, `cp2077-archive-xl`, `cp2077-red-hot-tools`, `cp2077-photomode-ex`, `cp2077-equipment-ex`, `cp2077-cyberware-ex` | `v1.20.4`, `v1.27.3`, `v1.3.0-rc.2-2`, `v1.4.1`, `v1.2.9-rc.1`, HEAD | psiberx's plugin structure, logging, script shipping, photo-mode internals, redscript idioms |
| `let_there_be_flight`, `mod_settings` | `v0.3.18-18`, `v0.2.21-8` | Plugin-shipped `.reds` via `scripts->Add`, native declarations |
| `appearancemenumod` | `1.8.4-167-g5427235` | Time, weather, teleport, camera, pose and HUD techniques |
| `red-dump-json` | `a8e52990` (2025-05-23, **pre-2.3**) | RTTI names and signatures; re-check every entry on 2.31 |
| `red4ext-rs` | `v0.10.0-35` | Alternative native layer (Rust); how it calls script functions (§3.5) |
| RedLib inside `cp2077-codeware` (`lib/Red`) | `v1.20.4` | How psiberx's plugins call script functions (§3.5) |
| The game's address library, `bin/x64/cyberpunk2077_addresses.json` (ships with RED4ext; linker map of 27 August 2025) | game 2.31 | Names for a few engine functions, used to read the crash (§3.5); read only |
| `clones/reshade`, `clones/IgcsConnector` | `v6.7.1` (clone HEAD `v6.8.0-28`), `e0130ad` (`v260-3`) | Optional ReShade layer, cloned read-only for this study |

## 2. What each mod type can and cannot do

| Layer | Can | Cannot / caveats | Evidence |
|---|---|---|---|
| **RED4ext plugin (C++)** | Load at game start; register RTTI types and global natives callable from redscript and CET; run code on engine state transitions; call any RTTI function by name on the main thread; hook engine functions; open OS resources (pipes, files, threads); add `.reds` folders to redscript compilation. | Refused on any other game build when it declares a runtime version (it should, since it uses the SDK). Wrong hooks or offsets crash the game. Script and game objects must only be touched on the main thread. | [source] `PluginSystem.cpp:223-321` (load, `Supports`/`Query`/`Main`), `:270-294` (runtime check), `:298-305` (minimum SDK 0.5.0 compat); SDK `Api/v1/Sdk.hpp` (runtime, logger, hooking, gameStates, scripts); `examples/native_globals_redscript/Main.cpp:60-83`; `Scripting/Utils-inl.hpp:14-111` (ExecuteFunction) |
| **redscript** | Classes and modules compiled into the game's script bundle; `@wrapMethod`/`@replaceMethod`/`@addMethod`/`@addField`; `ScriptableSystem` lifecycle (`OnAttach`, `OnDetach`, `OnRestored`, `OnPlayerAttach`); full access to script-visible game systems. | Compile errors break **all** script compilation (modal message box), so every declaration must exist; no file or network I/O; retail `Log`/`LogChannel` print nowhere unless CET or Red Hot Tools hook them; native globals declared inside a module get a module-prefixed name. | [source] redscript `v0.5.31`: `compiler/src/parser.rs:142-154` (annotations), `unit.rs:351,361` (module-qualified names), `unit.rs:1023` + `symbol.rs:222-246` (module prefix on globals), `scc/lib/src/lib.rs:86-94` (error popup); CET `LuaVM_Hooks.cpp:192-250` (CET hooks the log natives) |
| **CET Lua** | Events `onInit`, `onUpdate(dt)`, `onDraw`, `onOverlayOpen/Close`, `onShutdown`, `onHook`, `onTweak`; ImGui overlay (drawn every frame, even with the overlay closed); `Observe`/`ObserveAfter`/`Override`; call any RTTI global (`Game.Name(...)`) or class static; hotkeys; per-mod log and SQLite; JSON. | **No networking**, no process spawning, no `ffi`; file access confined to the mod folder; `registerForEvent`/`registerHotkey` only at the top level of `init.lua`; `Game`/`Observe` exist only from `onInit`; "Reload all mods" clears overrides. | [source] CET `v1.37.1`: `ScriptContext.cpp:46-65` (events), `:194-196` (registration closes), `D3D12_Functions.cpp:356-358` + `LuaVM.cpp:50-56` (onDraw every frame), `LuaSandbox.cpp:10-43, 152-161, 540-570, 695-719` (sandbox), `Scripting.cpp:675-705` + `RTTIHelper.cpp:305-354` (`Game.*` resolution), `RTTIMapper.cpp:153-183` (`.` → `_` class globals) |
| **TweakXL (data)** | YAML/`.tweak` files in `r6/tweaks` (recursive) create or change TweakDB records and flats before scripts use them; scriptable tweaks. | Data only; unquoted text is not inferred as a String. | [source] TweakXL `v1.11.4`: `src/App/Environment.hpp:13-16`, `TweakImporter.cpp:32-33, 114-127`, `YamlReader.cpp:141, 251-254`, `YamlReader.Values.cpp:499-523`, `TweakService.cpp:25-59` |
| **ArchiveXL (data)** | Resource additions and patches declared in `.xl` next to archives. | Already exercised by XF Eye Artistry; a bridge stub would add nothing observable, so the baseline has none. | [mod-loading.md](../../knowledge/mod-loading.md) |
| **Codeware** (optional dependency) | Adds reflection, callbacks (`Session/Ready`, `Input/Key`…), weather and system-request helpers. | Not needed by the baseline; phase 2 may depend on it for session callbacks and weather. | [source] Codeware `wiki/Home.md:84-104, 440-465` |
| **ReShade add-on** (optional) | See §7.2. | Needs the full add-on build of ReShade; never required. | §7.2 |

The alternative native layer **red4ext-rs** (Rust, MIT) supports natives, game-state listeners and hooks and would make networking easy, but has no wrapper for `scripts->Add` and would add a second toolchain; C++ with the SDK the loader itself uses is the lower-risk baseline [source] `red4ext-rs` README and `src/lib.rs:345-348, 417-418`.

## 3. How the layers and the Studio talk

```
 XF Studio / agent harness (outside the game)
      |  \\.\pipe\xf-runtime-bridge-<pid>-<random>   newline-delimited JSON, token per request
      v
 RED4ext plugin  XFRuntimeBridge.dll ---------------------------------------------+
   pipe thread: parse, token, kill switch, rate limit, allowlist, write gate       |
   game thread (Running OnUpdate): drains GameThreadQueue, calls RTTI by name ---+ |
      ^  natives XFBridge_Ping/Info/Log/Announce/Kill                            | |
      |                                                                          v |
 redscript  (Scripts/ added by the plugin)   <---- XFBridgeQuery.DescribeJson ---+ |
      ^                                                                            |
 CET Lua  xf_runtime_bridge/init.lua  ---- Game.XFBridge_* ------------------------+
 TweakXL  r6/tweaks/XFRuntimeBridge/*.yaml -> TweakDB flat read by redscript
```

- **Inward:** redscript and CET call the plugin's global natives. Both write their log lines through `XFBridge_Log`, and each layer announces itself through `XFBridge_Announce`, so one bridge call (`layers.status`) shows which layers loaded and what they saw.
- **Outward:** the plugin calls game RTTI functions and our own redscript statics by name. A redscript class's static functions are registered as global functions named `<Class>::<Name>;<ParamTypes>`, not on the class [runtime]. Every call goes through one routine that calls the way script code does (§3.5).
- **External:** only the plugin talks to other processes.

### 3.1 Choosing the external transport

| Option | Security | Stability | Update resilience | Verdict |
|---|---|---|---|---|
| **Named pipe hosted by the RED4ext plugin** | Local only by construction: `PIPE_REJECT_REMOTE_CLIENTS` refuses SMB clients; an explicit DACL grants only the game's user (the default pipe DACL also grants Everyone read) [doc] Microsoft `CreateNamedPipe` and "Named Pipe Security and Access Rights". Browsers cannot open pipes, so no cross-site or DNS-rebinding exposure. No firewall prompt. | One overlapped-I/O thread, bounded messages, idle timeout; `Stop` is bounded (about 0.5 s at most in the self-test, warning and cancelling I/O past 1 s) and never waits for a client to read. | Transport and protocol code never touches the game. Only the handful of RTTI calls can break on a patch. A missing function or a changed signature is refused with an error, but a function that keeps its signature and changes behaviour is not caught (§6). | **Chosen.** Bun 1.4.2 opens it through `bun:ffi` (kernel32) and PowerShell through `NamedPipeClientStream`, both at the Identification impersonation level [offline]. |
| Loopback TCP or HTTP/WebSocket from the plugin | Any local process, including every browser tab, can reach `127.0.0.1`; needs origin checks, a token and care against request smuggling and DNS rebinding; Windows may prompt for firewall access. | Same threading as the pipe, plus a socket stack and (for HTTP) a server library. | Same. | Rejected for the baseline; reconsider only if a browser client must connect directly. |
| File exchange (command and answer files) | Relies on folder ACLs; easy to audit. | Polling latency; partial writes; clean-up. | Good. | Kept only for the kill switch (`KILL` file) and discovery (`session.json`). |
| CET-hosted endpoint | CET's sandbox has no sockets or HTTP [source] CET `LuaSandbox.cpp:10-79, 152-161`. | — | — | Impossible. |
| ReShade add-on hosting the pipe | Same as the plugin pipe. | Loads only with the full add-on build; add-ons are disabled in the signed build (§7.2). | Tied to ReShade API version (18 in 6.7.x, 20 in 6.8.0). | Optional capture helper at most, never the main bridge. |

### 3.2 Protocol 1

One JSON object per line each way. Request `{"v":1,"id":…,"token":"…","method":"…","cid":"…","params":{}}`; response `{"v":1,"id":…,"cid":…,"ok":true,"result":…}` or `{"ok":false,"error":{"code","message"}}`. Only a number, string or null `id` is echoed; any other `id` is answered with `null`.

Checks run in this order:
1. The transport caps a line at 64 KiB.
2. A nesting pre-scan refuses anything deeper than 32 levels. Parsing and destruction are iterative in nlohmann/json 3.12, but copying, comparing and serialising a value recurse, so a deeply nested value could overflow the thread's stack.
3. Parse (strict UTF-8).
4. Rate limit, for every well-formed request, authenticated or not.
5. Token (constant-time compare).
6. Protocol version.
7. Kill switch.
8. Allowlist.
9. Write gate.
10. The method runs on its declared thread.

Every refusal is logged under its own event name. Malformed and unauthenticated requests count as rejected: the fifth on one connection drops it, and the server then waits 1 s before accepting again. Responses and logs serialise invalid UTF-8 as U+FFFD instead of throwing.

Error codes: `bad_request`, `bad_params`, `bad_version`, `unauthorized`, `killed`, `rate_limited`, `unknown_method`, `writes_disabled`, `game_not_running`, `timeout`, `timeout_after_start`, `busy`, `too_large`, `game_not_ready`, `rtti_missing`, `rtti_signature`, `call_failed`, `script_layer_missing`, `not_in_photo_mode`, `not_in_gameplay`, `not_in_character_menu`, `unsupported`, `unavailable`, `failed`. Implemented in `native/src/core/Dispatcher.cpp`, `PipeServer.cpp`, `core/Params.cpp` and the redscript actions layer; the tools' plain wording for each is in `tools/api/errors.ts`.

Access classes: **read** observes the game, **write** changes it (refused unless `allow_writes`), and **control** changes only the bridge itself. `bridge.kill` is the only control method; it can only take access away, so it stays available with writes off.

| Method | Access | Thread | What it proves |
|---|---|---|---|
| `ping` | read | bridge | Transport, token, session id |
| `bridge.info`, `bridge.methods` | read | bridge | Versions (including the build commit), status, allowlist with access classes |
| `bridge.kill` | control | bridge | Kill switch from the client side |
| `game.version`, `game.state` | read | bridge | `sdk->runtime` product version, exe file version, RED4ext state and tick count |
| `layers.status` | read | bridge | Announcements from redscript, CET and the TweakXL marker |
| `player.position` | read | game | `GetPlayer;GameInstance` then `entEntity.GetWorldPosition` by RTTI |
| `photomode.state` | read | game | `ScriptGameInstance.GetPhotoModeSystem` then `IsPhotoModeActive`, `CanPhotoModeBeEnabled`, `IsExitLocked` |
| `script.describe` | read | game | Native → redscript call (`XFRuntimeBridge.XFBridgeQuery.DescribeJson`, which reads a TweakDB flat: the call that crashed before the §3.5 fix) |
| `diag.write_probe` | write | game | The write gate and audit log, with no game effect |

Phase-2 methods (plugin `GameHandlers.cpp`, game side in `redscript/XFRuntimeBridgeActions.reds`, parameter checks shared with the self-test host in `core/Params.cpp`). Every write takes the save lock first, logs `write.done … undo=` and returns `undo {method, params}` restoring exactly what it changed, or `undo: null` with an `undo_note` when nothing changed or the game couldn't report an earlier value (`core/Writes.cpp`, shared with the self-test host and unit-tested); the kill switch runs `RestoreAfterKill` once (unfreeze, show the photo-mode menu) and keeps the save lock. The Access column is the native access class, the same names as the tools' permission classes; each write class must also be listed in `[bridge] allow_write_classes`.

| Method | Access | Thread | Route | Evidence |
|---|---|---|---|---|
| `game.status` | read | game | Phase from `IsPreGame`, player attach, `IsPhotoModeActive`, the mirror screen (below), `UI_System.IsInMenu` and `IsGamePaused`; save-lock and clock state | [source] 2.31 scripts; [offline] |
| `player.appearance` | read | game | `gameuiICharacterCustomizationSystem` getters (`characterCreationMenu.script:2-59`); options and values only while the mirror screen is open; `HasOption` checks on the finalized look | [source] |
| `photo.state` | read | game | A menu model captured from the photo-mode controller's own setup callbacks (`OnAddMenuItem`, `OnSetupScrollBar`, `OnSetupHueBar`, `OnSetupOptionSelector`) | [source] |
| `photo.enter` | write-photo | bridge, then game | Refuses with `photo_key_needed` unless `route: "quest"`: Codeware `QuestsSystem.ExecuteNode` with a `questUIManagerNodeDefinition` holding `questOpenPhotoMode_NodeType` (`alwaysAllowTPP`), which opens a **restricted** photo mode (first-person camera only, no V tab) | restricted result [runtime]; research only |
| `photo.subject` | read | game | The photo-mode stand-in (caught in a wrap of `PhotoModePlayerEntityComponent.SetupInventory`, else the controller's `m_fakePlayer`), its `Head` slot (`SlotComponent.GetSlotTransform`, then the hit-representation slots, else position + 1.62 m, flagged `approximate`), an offset along world up and V's facing; `CameraSystem.GetActiveCameraWorldTransform`, `GetActiveCameraForward/Right/Up`, `GetActiveCameraFOV`, `GetAspectRatio`, and `ProjectPoint` for the target, the head, a point 5 m ahead of the camera and points 10 cm up and right; the menu's values for keys 1, 7, 8, 9, 37 and 15 | [source] 2.31 `orphans.script:26720-26745`, `photoModePlayerEntity.script:378-389`; the photo-mode camera being the active camera: `camera_fov` matched the menu's FOV in the first session [runtime]; the rest [unverified] |
| `photo.exit` | write-photo | game | `gameuiPhotoModeMenuController.OnExitConfirmed(true)`, the menu's own exit (`photoModeMenuController.script:140, 218`); refused while `IsExitLocked` | [source] |
| `photo.camera.set`, `photo.light.set`, `photo.expression.set` | write-photo | game | `GetMenuItem(key)`, then `PhotoModeMenuListItem.ForceValue(value, true)`, the menu's own path to `OnAttributeUpdated`. Values are checked against the captured range or option data first (option values must be whole), because `ForceValue` truncates and silently selects option 0 for an unknown option value; afterwards the value the menu shows is compared with the one asked for (exactly for options, within a step for sliders), and on a difference the earlier value is put back and the call fails with `write_mismatch`. Lights: select (key 43), wait three game ticks for photo mode to load that light's values (ticks, not time, so it holds at low frame rates), then set; `select_after` re-selects a light afterwards, which the undo uses to put the menu's selection back; a failure after the selection puts it back and says exactly what changed. `reset: true` returns an undo for what it changed; a key that fails does not stop the others, and the answer is then partial (`partial`, `errors`) with an undo for what was reset | [source]; keys below; comparison and tick wait [unverified] in game |
| `photo.hud.hide` | write-photo | game | Our `@addMethod` on the controller around its protected `OnFadeVisibility(Float)`; with `cursor` (default), a flag that a wrap of `CursorGameController.ProcessCursorContext` reads to play `Hide` instead of any context, replayed on every cursor controller seen when the flag changes (the technique learned from Appearance Menu Mod; knowledge/photo-mode.md §6). The flag is cleared when photo mode opens or closes and by the kill switch | fade [runtime]; cursor [source], in game [unverified] |
| `cc.apply` | write-character | game | Through the option's own row when it is on screen: the row matching the option's `uiSlot` gets `SetSelected…(info, index, true)`, which sets its label and index and calls the menu back (`OnSliderChange` / `OnColorChange` → `ApplyChangeToOption`), exactly as its arrows do; otherwise `ApplyChangeToOption` directly (`route` in the result). Only while the creator edits the finalized look (`m_updatingFinalizedState`, a live `GetPuppetPreviewGameController`) and is not busy switching appearance; option by internal name or on-screen label, index range-checked. It never confirms | direct call [runtime] (the row kept the old name, the reason for the row route); row route [source] `characterCreationBodyMorphListItem.script:365-470`, knowledge/photo-mode.md §7 |
| `cc.confirm`, `cc.back` | write-character | game | The captured menu's own `ConfirmCustomizedCharacter()` (keeps the look: `ReFinalizeState`, then the menu moves on) and `ConfirmBackConfirmation()` (discards: `CancelFinalizedStateUpdate`); only in the edit-V's-look mode and when not busy; refused unless `[bridge] allow_creator_leave = true` (default false; true only in the -writes build) | [source] knowledge/photo-mode.md §3.3; approved for the test profile |
| `world.time.set` | write-world | game | `TimeSystem.SetGameTimeByHMS`; exact restore with `SetGameTimeBySeconds` | [source] |
| `world.pause` | write-world | game | `SetTimeDilation(reason, 0.0)` and `SetTimeDilationOnLocalPlayerZero`, the way the mirror screen freezes the world (`characterCreationBodyMorphMenu.script:1107-1117`), under our own reason; the undo returns to the state before the call (`was_frozen`). `SetPausedState` takes **no** parameters in the 2.31 bundle (the pre-2.3 dump lists two), so it is not used | [source] |

**Photo-mode attribute keys** used by the bridge come from the source of Photo Mode Preferences, Photo Mode Pose Selector, Equipment-EX and Photo Mode Ex [source], and the first session's `photo.state` dump confirmed each on this install [runtime]: 1 field of view (1–120 with Photo Mode Unlocker XL), 2 roll, 3 focal distance, 4 aperture, 13 chromatic aberration, 23 camera preset (0 Customization, 1–9), 25 grain, 26 depth of field, 33 autofocus; 7, 8, 9 and 37 V's rotation, left-right, near-far and up-down (±5 in 0.01 steps); 15 look-at (0 off, 1 camera, 2 customisation) and 74 look-at part (1 head, 2 eyes); 28 V's expression (its value is the option's data, not its menu position); 43 light select; 44 light on/off (0/1), 45 light type (1 spot, 2 ambient), 46 shadow; 47–53 light brightness, range, inner and outer angle, hue, saturation and luminosity. There is no camera position setter: framing comes from the field of view and V's placement. Photo Mode Preferences re-applies its saved settings just after `OnShow`, which can race a change made in the same moment; Photo Mode Ex persists depth of field (26) into saves, so the session scripts never write it.

Discovery: `%LOCALAPPDATA%\XFStudio\runtime-bridge\session.json` holds `pid`, `pipe`, `sid`, `token`, `started_at`, `plugin_version`, `allow_writes` and `write_classes`; it exists only while the bridge listens. The folder sits in the user profile, so MO2's virtual file system does not redirect it, and its default ACL keeps it private to the user (plus SYSTEM and administrators). The plugin has no override for this folder; only the self-test passes its own folder explicitly. Both clients check `GetNamedPipeServerProcessId` against `pid` before sending the token, which defeats a pipe-name squatter. They also open the pipe at the Identification impersonation level, so a squatter could not impersonate the client either.

### 3.3 Threading

The pipe thread never touches game objects. Game-thread methods go through `GameThreadQueue` (capacity 16), drained at most four per tick from the plugin's `Running` `OnUpdate`. Each task has one atomic state (queued → running → done, or queued → cancelled), and the game thread and the waiter each change it with a compare-and-swap, so exactly one of them wins:
- A request not started within `request_timeout_ms` (default 2000) is cancelled and never runs.
- A request already running at the timeout gets a further 1 s grace. If it still hasn't finished, the client gets `timeout_after_start` ("it may still complete"), and the plugin logs `game.task_completed_late` when it does.

So the client is never told "cancelled" about a request that then runs. Stopping the bridge (kill switch, shutdown, unload) closes the queue: queued tasks are cancelled and a waiter on a running task is released at once, which keeps the stop bounded.

Every function the game or RED4ext calls (exports, state and RTTI callbacks, natives) and both bridge threads run inside a catch-all that logs the failure. A C++ exception never unwinds into game code, and a failed load leaves the bridge off.

RED4ext removes a state callback that returns `true` [source] `StateSystem.cpp:128-160`, although the SDK comment says the Running result does not matter (`Api/v1/GameState.hpp`); the plugin therefore returns `false`. The Running `OnUpdate` runs on the game's main thread [runtime: the crash report's stack starts in RED4ext's entry frames], in the same state tick where CET runs its Lua `onUpdate` [source] CET `GameHooks.cpp:93-104`, `D3D12.cpp:65`. Script calls from it work at the main menu and in gameplay when they are made with a context (§3.5); loading screens and photo mode are still [unverified].

### 3.4 Command API and frontends

Outside the game, one catalogue (`tools/api/catalogue.ts`) defines every command: name, plain user-facing text, a JSON Schema input, a permission class (`read`, `write-photo`, `write-world`, `write-character`, `control`) and an undo note. `CommandApi` validates input, records writes in an audit log and runs either a bridge method or a local handler (captures). The MCP server (official TypeScript SDK, stdio), the CLI's `run` and the JSON session runner all derive from it, and the MCP module has no transport attached, so the desktop app can host it later ([AI integration](../backlog/ai-integration-mcp.md)). Captures are external (`PrintWindow` with full content, or the screen), cropped to pixel, normalised or named regions sized in window heights, saved at full resolution and returned downscaled with an exact area filter. Details: the [project README](../../projects/xf-runtime-bridge/README.md#one-command-api-many-frontends).

### 3.5 Calling game and script functions from native code

**What the first in-game run showed** [runtime] (26 September 2026; game 2.31, RED4ext 1.30.0, redscript 0.5.31, CET 1.37.1, Codeware 1.20.5, about 900 mods; the plugin log of that evening and crash reports `…-20260926-181257-…`, `…-181813-…`, `…-182825-…`):
- Our redscript classes are in RTTI with no functions on them; their static functions are global functions named `<Class>::<Name>;<ParamTypes>` (`GameHandlers.cpp` `FindGlobalStatic`).
- Called with `RED4ext::ExecuteFunction(nullptr, fn, &out, args)` from a Running `OnUpdate` task, `XFBridgeActions.Status` ran again and again at the main menu and in gameplay. `XFBridgeQuery.DescribeJson` and `XFCharacter.Appearance` crashed the game, every time with a read at `0x0` at `Cyberpunk2077.exe+0x1e28769`. A probe build logged each step: `DescribeJson` got through `GetGameInstance`, `IsValid`, `GetPlayer`, `GetLocalPlayerMainGameObject`, `GetWorldPosition` and `FloatToString`, then crashed inside `TweakDBInterface.GetInt`.
- CET's Lua layer called the same `DescribeJson` at startup and it completed every step, TweakDB and `CharacterCustomizationSystem.GetState` included.
- A heuristic scan of the crashing thread's stack (report `…-182825-…`) runs from RED4ext's entry frames through the plugin's queue task into the script VM, passing CET's hook on the game's script runner. It is the main thread.

**Why it crashed** (confidence: high).
1. **The faulting code** [runtime, read from the installed executable]: the address library names the enclosing function `rtti::Function::InternalCallNative` (RVA `0x14619c`). Its disassembly (`dumpbin /disasm`) shows that for a native **member** function it takes the context from the call's stack object; when there is none, it asks the function for its "invokable" (virtual `+0x20`) and dereferences what comes back. For an ordinary native that is null, and the read at `exe+0x1e28769` is that dereference. Static natives take another branch that tolerates a missing context. RED4ext.SDK reconstructs the same branch in `CBaseFunction::ExecuteNative` [source] (`Scripting/Functions-inl.hpp`, tag 1.0.0: `if (!context) { … GetInvokable()->Execute(…) }`).
2. **The natives involved** [source]: scripts call `TweakDBInterface.GetInt` and `TDBID.ToStringDEBUG` as statics, but the engine registers them as native member functions: every one of the 1,015 `gamedataTweakDBInterface` functions and `gamedataTDBIDHelper.ToStringDEBUG` carry the native flag without the static flag in `red-dump-json` (`a8e52990`). RedLib, the library inside Codeware, calls `gamedataTDBIDHelper` "fake static" and supplies a dummy context for it (`lib/Red/TypeInfo/Invocation.hpp:9-13, 96-107`). `Status` uses only true statics (`GameInstance.Get…System`) and members of real objects, so it ran; `Appearance` calls `TDBID.ToStringDEBUG`.
3. **The missing context** [source]: the VM hands such a native the calling script's own context. A script started with `ExecuteFunction(nullptr, …)` has none, because the null instance becomes both context fields of the SDK's `CStack` (`Scripting/Stack-inl.hpp`, `CBaseStack` constructor). The game's scripts always run with one, and so does every other native caller:
   - CET: a dummy `entEntity` instance as the context, and a caller frame whose function is a dummy, because "some functions expect a non-empty call stack" (`src/reverse/RTTIHelper.cpp:765-812`, v1.37.1; the caller frame since `6dfa53a`, 2022, the dummy context since `41a00cc`, 2023);
   - RedLib/Codeware: the same recipe (`Invocation.hpp:23-76`);
   - red4ext-rs: the class's game system, or else `cpPlayerSystem` (`src/systems/rtti.rs:218-227`, `src/invocable.rs:415-452`);
   - RED4ext.SDK's own `ExecuteGlobalFunction`: `cpPlayerSystem` (`Scripting/Utils-inl.hpp`).
4. **Not the thread or the engine phase** [runtime, source]: the calls ran on the main thread in the Running state tick, where CET's Lua runs too (§3.3), and `Status` worked there.

**The fix** [runtime: script-call check passed on 26 September 2026, build `c31156a`, see the [test card](runtime-bridge-test-card.md#script-call-check-first)]. Every call, to a native or a script function, goes through `CallFunction` (`native/src/plugin/ScriptCall.cpp`), which follows CET's recipe:
- a caller frame whose bytecode passes each argument by pointer: `ExternalVar` (`0x1B`) with the type and value pointers, then `ParamEnd` (`0x26`) (`core/ScriptFrame.cpp`, unit-tested byte for byte; opcodes from redscript's `crates/io/src/instr.rs`);
- that frame's function set to a named dummy, `$XFBridge`, so a script error names the bridge as the caller;
- the engine's internal execute (SDK hash `CBaseFunction_InternalExecute`, present in the 2.31 address library and used by the installed CET), with a context that is never null: the object for a member function, otherwise one `entEntity` instance made once and held by a handle that is never released;
- refused off the game thread.

Each call logs `script.call` before and `script.returned` after (debug level), so after a crash the last line names the call. The first call of a session logs `script.call_context`, which records how this game build registers the two natives that crashed (expected `native_member`). The redscript layer logs a step line before each call known to be risky.

| Alternative | Verdict |
|---|---|
| Keep the SDK's `ExecuteFunction` and only pass a non-null context (as red4ext-rs does) | Fixes this crash, but the script still runs without a caller frame, which CET found some natives need |
| Run the calls in another engine phase (a game system's `UpdateRegistrar` tick, as Codeware's `StaticEntitySystem` does) | Doesn't touch the cause: thread and phase were already right |
| Invert control: a redscript loop (`DelaySystem`) or CET's `onUpdate` polls a native request queue and calls the actions itself | A genuine script context, but a script loop runs only where a game instance and its delay system exist (not reliably at the main menu), CET would become a requirement, and the kill switch's restore must not depend on a layer that may be missing. Rejected |

### 3.6 Autonomy: fewer player steps

Built after the first session (offline; the [bridge autonomy backlog](../backlog/bridge-autonomy.md) ranks the rest):

- **Opening photo mode.** No script can open the full photo mode ([knowledge/photo-mode.md §2](../../knowledge/photo-mode.md#2-opening-photo-mode)). `photo.open` (tools, `tools/input/photo-key.ts`) sends the player's own photo-mode key, read from `UserSettings.json` or the default `IK_N`, to the game window only: it checks the bridge's write gate through `game.status`, that V is in the world and the game allows photo mode, that the window belongs to the game's process, brings it to the front once and refuses unless it is the foreground window, sends the scan code down and up, then waits for photo mode. It is the only input any XF tool sends (approved for the test profile, 26 September 2026).
- **Framing.** `photo.frame` (tools, `tools/api/framing.ts`) measures instead of using fixed offsets: `photo.subject` gives V's head and the game's own projection, and the loop turns V to face the camera, centres the target with a measured Jacobian of left/right and up/down, sizes it with the field of view and re-checks. An XF camera preset (attribute 23 selecting `photo_mode.std_preset_7..9`, defined by a TweakXL file in the -diagnostic and -writes packages only) can place the camera first. Without a usable projection, a coarse capture route nudges V and reads its outline from window captures.
- **Clean captures.** `photo.hud.hide` hides the cursor with the menu (the row above).
- **Lights.** `photo.light.set` takes `on`, `type` and `shadow` (keys 44–46), applied first after the light is selected; lights can't be moved through the menu, so light sweeps turn V with look-at off.
- **The creator.** `cc.apply` goes through the option's row, so the row's label follows; `cc.confirm` and `cc.back` press the menu's own Confirm and Back behind `allow_creator_leave`; `player.appearance` reports how the creator was opened (`menu.updating_finalized_state`, `edit_mode`), which answers whether Character Customization Anywhere's F12 opens the new-game mode on 2.31.
- **Captures.** `capture.burst` (flicker and motion) and the `cc-eyes` crop for the creator's eyes zoom.

## 4. Safety model

**The security boundary is the Windows user at medium integrity.** The bridge keeps out:
- other Windows users (DACL);
- remote machines (`PIPE_REJECT_REMOTE_CLIENTS`);
- browsers and web pages (pipes aren't reachable from the web);
- low-integrity and AppContainer processes (not in the DACL, and the pipe's default medium mandatory label refuses write-up).

It doesn't defend against other processes running as the same user at medium integrity. Such a process can read `session.json` and connect, but it could equally read or write the game's memory or inject a DLL, so the token adds no boundary there. The token and the server-PID check exist to stop accidental cross-talk (a stale session, another game instance) and a squatter taking over the pipe name. Everything below hardens the bridge within that boundary: bounded input, no crash from malformed requests, and an audit trail.

| Rule | Implementation | Status |
|---|---|---|
| Local only | Named pipe with `PIPE_REJECT_REMOTE_CLIENTS`, a user-only DACL and `FILE_FLAG_FIRST_PIPE_INSTANCE`; the name has a random suffix | [offline] clients connect; remote refusal is [doc] |
| Per-session token | 256-bit `BCryptGenRandom` token in `session.json`; required on every request; never logged | [offline] wrong or missing token refused; log scanned for the token |
| Right server, no impersonation | Both clients check `GetNamedPipeServerProcessId` against `session.json`'s `pid` before sending the token, and open the pipe at the Identification impersonation level | [offline] both clients refuse a pipe served by another PID (exit 3) and send nothing |
| Bounded input | 64 KiB per line; 32 levels of nesting (pre-scan before parsing); only scalar `id` values echoed; strict UTF-8 parse | [offline] a 5,000-deep request (which crashed the host before the fix) is refused and the host keeps answering |
| Rejection limit | Malformed or unauthenticated requests are rate-limited like any other; the fifth on one connection drops it, and the server waits 1 s before accepting again; every refusal is logged | [offline] |
| No exceptions into the game | Catch-alls on every export, state and RTTI callback, native and bridge thread; serialisation replaces invalid UTF-8; log text is cut on UTF-8 character boundaries | [offline] invalid UTF-8 in a result; unit checks for the log cut |
| Bounded stop | No `FlushFileBuffers`; every wait watches the stop event except a fixed 0.5 s linger that lets a dropped client read its last reply; the queue releases its waiters; `Stop` warns and cancels I/O past 1 s | [offline] with a client that never reads, `Stop` took about 510 ms (kill, mostly the linger) and 0 ms (shutdown with a full pipe) |
| Off unless enabled | `[bridge] enabled = false` by default: no pipe, no session file | [offline] default zip ships it off |
| Read-only by default | Every method declares its access class (read, write-photo, write-world, write-character, control); writes are refused unless `[bridge] allow_writes = true`, and then each write class only if `[bridge] allow_write_classes` lists it (default all three; an unknown name only takes a class away), with `write_class_disabled` | [offline] unit checks and the self-test host with `--write-classes photo,world` |
| Allowlist | Only registered methods exist; nothing evaluates client-supplied code | [offline] |
| Audit | Every request, response and refusal is logged with `cid`, method, access class, client PID, outcome and duration | [offline] |
| Provenance | The DLL carries `XFB_BUILD=<commit>;dirty=<0\|1>` (also logged as `evt=plugin.build` and returned by `bridge.info`); `package.ts` refuses a dirty tree or a DLL not built cleanly from `HEAD`; each zip ships `THIRD_PARTY_NOTICES.txt` | [offline] |
| Rate limit | Token bucket, `max_requests_per_second` (default 20, burst 40), applied before the token check so it covers unauthenticated requests too | [offline] |
| Kill switch | CET hotkey (`XFBridge_Kill`; CET can't pre-bind a hotkey, so it has no key until bound in CET's Bindings), `bridge.kill` (which the tools turn into the `KILL` file while another client, such as a scripted session, holds the pipe), or a `KILL` file beside `session.json`; refuses everything, closes the game-thread queue before it returns (a write already queued is cancelled and never runs), drops the client, removes `session.json`, closes the listener until restart | [offline] method, file and queue closing (`xfb_selftest --unit`: no queued write runs after kill); hotkey [unverified] |
| Visible indicator | CET draws "XF bridge: listening (read-only / writes ON)" whenever the bridge listens | [unverified] |
| Dedicated profile and saves | A dedicated MO2 profile; disposable test saves; never overwrite the player's saves | Process rule (§7.4) |
| No saves, and a save lock | Nothing on the allowlist saves. Before its first change the bridge asks `SaveLocksManager.RequestSaveLockAdd` for a lock (`core/systems/saveLocksManager.script:30-48`, the request vanilla uses for autodrive), which is not persistent and is gone after a load. The kill switch keeps it: a light, the clock or a creator option the bridge changed may still be live, and a save would keep it. Only loading a save releases it | [source]; blocking autosaves in practice [unverified] |
| Reversible writes | Each write returns `undo {method, params}` for exactly what it changed (or `undo: null` and an `undo_note`) and logs it; the undo logic is `core/Writes.cpp`, shared by the plugin and the self-test host; the tools add a plain undo note to every write command and an audit line before sending | [offline] unit checks and MCP tests against the self-test host |
| Restore on kill | After the kill switch, once the queue is closed (`Bridge::RestoreReady`), the next Running tick runs `RestoreAfterKill` once through `writes::RestoreOnce` (only after a write; a failure is logged and not retried): unfreeze the world, show the photo-mode menu; the save lock stays. It is a redscript call like the others, so it uses §3.5's call path | Trigger and ordering [offline]: unit checks with a fake script caller, and the self-test host (restore logged exactly once after a write, never without one); the script's restore itself [unverified] in game |
| One allowlisted input | `photo.open` is the only thing that sends input: the player's photo-mode key, to the game's own window (owner checked), only when the bridge's write gate allows photo writes, V is in the world and the game allows photo mode; `sendinput` refuses unless the game window is really in front, so the key can't land in another program. Test processes set `XFB_NO_INPUT=1`, which makes the sender refuse | [offline] gate, phase refusals, fake sender, key record layout; in game [unverified] |
| Creator Confirm and Back gated | `cc.confirm` and `cc.back` are write-character methods and also need `[bridge] allow_creator_leave = true`, which only the -writes build sets; Confirm keeps a look in the running game, so sessions end by loading the safety save | [offline] unit checks and the self-test host |
| No online features | No achievement, telemetry, marketing-consent or online-system calls on the allowlist, ever | Process rule |

**Autosave triggers to keep in mind** [source] 2.31 scripts: leaving vendor, ripperdoc and perk screens (`MenuUIUtils.RequestAutoSave`), fast travel, legendary loot, drop points, quest checkpoints (which may ignore save locks) and the timed autosave setting (`/gameplay/hud` `AutosaveInterval`: 5, 10 or 30 minutes). A session therefore starts with a fresh manual save and ends by loading it.

## 5. Logging

| Layer | Where | Bound | Notes |
|---|---|---|---|
| Plugin (and everything routed through `XFBridge_Log`) | `red4ext/logs/xfruntimebridge-<timestamp>.log` (MO2: `overwrite/red4ext/logs/`) | RED4ext's `rotating_file_sink_mt`: `max_file_size` MB × `max_files` per plugin, defaults 10 MB and 5 files; older logs pruned per plugin | [source] `Utils.cpp:62-76`, `Config.hpp:24-27`, `LoggerSystem.hpp:40-76`, `LoggerSystem.cpp:37-94`. RED4ext's default level is `info`, so the plugin filters by its own `[log] level` and writes debug lines at `info`; it never edits the user's RED4ext config. |
| RED4ext loader | `red4ext/logs/red4ext-<timestamp>.log` | as above | Load line `XF Runtime Bridge (version: 0.1.0, author(s): XF Studio) has been loaded` [source] `PluginSystem.cpp:319` |
| redscript compiler | `r6/logs/redscript_rCURRENT.log` | Daily rotation, 4 kept | Lists compiled files and errors [source] `scc/lib/src/lib.rs:201-250` |
| TweakXL | `red4ext/plugins/TweakXL/TweakXL-<timestamp>.log` (+ `TweakXL.log` link) | 100 MiB × 2, 10 logs | `Reading "…"` per file [source] TweakXL `SpdlogProvider.cpp:12, 58-79`, `TweakImporter.cpp:139` |
| CET mod | `bin/x64/plugins/cyber_engine_tweaks/mods/xf_runtime_bridge/xf_runtime_bridge.log` | 5 MiB × 3, appended across launches | Release builds flush only on warnings or at shutdown [source] CET `Utils.cpp:105-118`, `Utils.h:16-18` |
| Self-test | stdout | — | Same line format |

**Line format:** `sid=<session> lvl=<level> layer=<native|redscript|cet|tweakxl> cid=<correlation id> evt=<event> key=value …`. Every line is cut at 2 KiB on a UTF-8 character boundary, with control characters and invalid UTF-8 bytes replaced (`core/Log.cpp`); logging never throws.

**Correlation IDs:**
- Clients choose `cid` (a safe charset, up to 64 characters) or get `n<k>`.
- Redscript uses `rs-*` and CET uses `cet-<k>`.
- `script.describe` passes the request's `cid` into redscript, so one ID appears on both layers.

Nothing logs per frame except a heartbeat about every ten minutes; `tools/capture_session.py` already collects `red4ext/logs`.

## 6. Update resilience

- **Runtime pin.** The plugin declares `RED4EXT_V1_RUNTIME_VERSION_LATEST` (2.31, `3.0.80.51928`), so after a game patch RED4ext skips it with a clear "incompatible" warning until it is rebuilt [source] `PluginSystem.cpp:270-294`.
- **RTTI by name, with a signature check.** Game access is by name at runtime, with no hard-coded offsets or hooks. Before each call the plugin checks the function's static flag, parameter count and types, and return type name against what the call site passes and reads. A missing function is refused with `rtti_missing` and a changed signature with `rtti_signature`, so neither reaches the call. This is not a general guarantee: a function that keeps its signature but changes what it needs (for example, game state that isn't ready), or a crash inside the game's own code, is not caught. The runtime pin is the main guard, and in-game behaviour is still [unverified].
- **Redscript surface.** The redscript layer uses only APIs already used by published mods and is linted against the game's own bundle; its `.reds` files compile only when the DLL loads (`scripts->Add`), so a missing DLL cannot break script compilation.
- **Protocol version.** The transport and protocol are versioned (`v:1`) and independent of the game.

## 7. Autonomy capability matrix

What an agent would need to run in-game tests with minimal hand-holding. **Layer:** N = native game RTTI (callable from RED4ext, redscript or CET), CW = Codeware, L = CET Lua technique, X = external process, RS = ReShade add-on. **R/W:** read or write. Unless stated, RTTI signatures come from `red-dump-json` (`a8e52990`, pre-2.3) and must be re-checked on 2.31, for example with a fresh RTTIDumper run.

### 7.1 Capture

| Capability | API | Layer | R/W | Evidence | Risk / status |
|---|---|---|---|---|---|
| Game screenshot to a chosen file | none found: `gamePhotoModeSystem` has five functions, none a capture; no global or CET capture call | — | — | [source] RDJ `classes/gamePhotoModeSystem.json`; CET source | **No verified in-game API.** Engine structs `rendSingleScreenShotData{outputPath, saveFormat}` exist without a script-visible caller [source] RDJ `rendSingleScreenShotData.json:13,38` |
| Find the game's own screenshots afterwards | `inkISystemRequestsHandler.RequestGameScreenshotsForLoad()` → `inkGameScreenshotInfo.path` | N + CW callback | R | [source] RDJ `inkISystemRequestsHandler.json:809`, `inkGameScreenshotInfo.json:7`; Codeware `Addons/inkISystemRequestsHandler.reds:59` | Path chosen by the game; folder and file name pattern [unverified] |
| External window capture | `PrintWindow` with `PW_RENDERFULLCONTENT` on the game window, or a screen `BitBlt` of its client area when the game is in front (`tools/capture/`, `bun:ffi`); the older `tools/capture-window.ps1` uses GDI `CopyFromScreen` | X | R | [offline] synthetic 3840×1600 and 1920×1080 windows: exact crops, area-filter downscale, PNG round trip. `PW_RENDERFULLCONTENT` returns black for a window entirely off-screen, and legacy `WM_PRINT` works there but not for DirectX, so the automatic route uses the legacy path only for non-game windows | **Implemented** as `capture.screenshot` / `capture.recrop`. Captures what is on screen (after ReShade and overlays), 8-bit; the game's own window [unverified], exclusive fullscreen likely black. Framing, not calibration |
| Windows.Graphics.Capture / DXGI duplication | OS capture APIs | X | R | [doc] Microsoft | Better for exclusive or HDR output; not built |
| Back-buffer read-back in process | CET already hooks Present and holds the swap chain | N (custom) | R | [source] CET `D3D12_Hooks.cpp:11,94`, `D3D12.h:68` | Feasible, not built; high effort and crash risk |
| Lossless capture before post effects | ReShade add-on (§7.2) | RS | R | [source] | Best calibration path, optional |

### 7.2 ReShade (optional layer)

**Rule:** ReShade is never required for a core feature and never changes the user's preset or `ReShade.ini`. The maintainer's installation is ReShade 6.7.1 (`dxgi.dll`, add-on support) with `IgcsConnector.addon64`.

| Capability | API (ReShade `v6.7.1`) | Before effects? | R/W | Persistence risk | Evidence |
|---|---|---|---|---|---|
| (a) One-call capture | `effect_runtime::capture_screenshot(void* pixels)`; `get_screenshot_width_and_height` | What the back buffer holds at the call; raw swap-chain format (BGRA8, RGB10A2 or RGBA16F), not converted | R | None | [source] `include/reshade_api.hpp:102,107`; `source/runtime.cpp:5096-5130` |
| (a) Before-effects image | copy `get_current_back_buffer()` in `addon_event::present` (fires before effects), or in `reshade_begin_effects` with barriers, to a `gpu_to_cpu` resource, then `map_texture_region` | **Yes** | R | None | [source] `source/dxgi/dxgi_swapchain.cpp:997-1006`; `runtime.cpp:586-834` (frame order); pattern in `examples/12-video_capture/video_capture.cpp:232-357` |
| (b) Depth buffer | built-in Generic Depth selects and binds `DEPTH`; its choice is private; an add-on can track depth itself and copy it to a readable texture | n/a | R | Its UI writes `[DEPTH]` to `ReShade.ini`: never touch it | [source] `examples/09-depth/generic_depth_addon.cpp:472-485, 932-1013, 1233, 1250` |
| (b) Draw and pipeline events for the decal z-fight | `bind_render_targets_and_depth_stencil`, `bind_pipeline`, `draw_indexed`, `init_pipeline` (depth bias, depth func), `clear_depth_stencil_view` | n/a | R | None | [source] `include/reshade_events.hpp` (e.g. `:906, :941, :1191, :666, :1412`); `reshade_api_pipeline.hpp:690-698, 738` |
| (c) Effects off for a capture | `effect_runtime::set_effects_state(false)` then restore | n/a | W | Not persisted (never written to config); per-technique toggles can be saved later by the user's auto-save, so avoid them; never call `save_current_preset` | [source] `source/runtime_api.cpp:1316-1328`; `runtime.cpp:743-747, 1222-1245` |
| (d) IGCS Connector camera | Needs a per-game IGCS camera DLL exporting `IGCS_StartScreenshotSession` and friends; the connector only runs shot sessions from its UI and feeds camera data to shaders | n/a | W | Saves `IgcsConnector.ini` | [source] `IgcsConnector src/CameraToolsConnector.cpp:38-66`, `src/Main.cpp:58-104, 313`. A Cyberpunk IGCS camera tool is [unverified]; our own DLL could in principle export the `IGCS_*` functions. **Not a repeatable-framing path for us now**; the game camera routes in §7.5 are simpler |
| (e) Add-on joining the bridge | `register_addon`, `register_event`, `register_overlay`; own threads allowed; loaded from the ReShade folder or `AddonPath` | n/a | — | — | [source] `include/reshade.hpp:245-344`; `addon_manager.cpp:214-262, 433-436` |

Constraints: add-ons load only in the full add-on build (`RESHADE_ADDON=2`); the signed build skips `.addon` files and turns add-ons off under heavy network traffic [source] `addon_manager.cpp:237-241, 572-577`, `dll_main.cpp:306-318`. An add-on must be built against the **6.7.x headers** (API 18): 6.8.0 headers (API 20) are refused by 6.7.1 [source] `include/reshade.hpp:13`, `addon_manager.cpp:433-436`. Licence BSD-3-Clause (some files dual MIT).

**Design (not built):** a tiny `XFCapture.addon64` would read the before-effects back buffer in `present` into a `gpu_to_cpu` texture on request and write a PNG or EXR (RGBA16F kept as float) to a path under the runtime folder. The plugin would signal it through a second pipe or a request file in the runtime folder, and it would never call `set_technique_state`, `save_current_preset` or touch ini files. The same add-on could log depth-stencil bindings and pipeline depth bias around one frame for the decal/head z-fight. Build it only after the baseline session proves the bridge and the maintainer agrees ReShade may be an optional dependency.

### 7.3 Photo mode

| Capability | API | Layer | R/W | Evidence | Risk / status |
|---|---|---|---|---|---|
| Is photo mode active / can it open / is exit locked | `ScriptGameInstance.GetPhotoModeSystem(self)` → `gamePhotoModeSystem.IsPhotoModeActive()`, `CanPhotoModeBeEnabled()`, `IsExitLocked()` | N | R | [source] RDJ `ScriptGameInstance.json` (GetPhotoModeSystem), `gamePhotoModeSystem.json:7-47` | **Implemented** as `photomode.state` |
| Open / close events | Observe `gameuiPhotoModeMenuController.OnShow/OnHide`; blackboard `PhotoMode.IsActive` | L / N | R | [source] cet-kit `GameUI.lua:775-785`, `GameSession.lua:138` | Easy to add to CET |
| Open photo mode | No vanilla script API; the key's action `TogglePhotoMode` is handled natively; Photo Mode Ex hooks the native `PhotoModeSystem::Activate`. Codeware's `QuestsSystem.ExecuteNode` with `questOpenPhotoMode_NodeType` opens a restricted photo mode | X (key) / CW | W | [source] knowledge/photo-mode.md §2; restricted result [runtime] | **Implemented** as `photo.open` (the player's key, sent to the game window only; [unverified] in game); `photo.enter` keeps the quest route for research |
| Close photo mode | The controller's `OnExitConfirmed(true)` (what the menu calls when nothing needs confirming) | redscript | W | [source] 2.31 `photoModeMenuController.script:140, 218` | **Implemented** as `photo.exit` [runtime] |
| Hide the mouse cursor | A wrap of `CursorGameController.ProcessCursorContext` playing `Hide` while a flag is set | redscript | W | [source] 2.31 `cursorGameController.script:343-359`; AMM's override of the same function | **Implemented** in `photo.hud.hide` [unverified] |
| Camera pose and FOV | Read: `CameraSystem.GetActiveCameraWorldTransform(out Transform)`, `GetActiveCameraFOV()`, `GetAspectRatio()`, `ProjectPoint(Vector4)`. Placement: attribute 23 (camera presets from TweakDB) and V's offsets | N | R | [source] RDJ `gameCameraSystem.json:23,63`; 2.31 `orphans.script:26720-26745` | **Implemented** as `photo.subject` and `photo.frame` [unverified]; which screen space `ProjectPoint` uses is detected at run time |
| Attributes (camera, V's placement, lights, expression) | Script `gameuiPhotoModeMenuController.GetMenuItem(key)`, then `PhotoModeMenuListItem.ForceValue(value, apply)`, which reaches `OnAttributeUpdated(key, value, doApply)`; native `PhotoModeSystem::SetAttributeValue` is the address-library alternative | redscript | W | [source] 2.31 photo-mode scripts; PMEx `src/Red/PhotoMode.hpp:112-118`, `PhotoModeExService.cpp:7-35`; keys from Photo Mode Preferences, Photo Mode Pose Selector, Equipment-EX and PMEx (§3.2) | **Implemented** as `photo.camera.set`, `photo.light.set` and `photo.expression.set`, validated against the menu's own ranges; field of view, V's placement, look-at, light values, fade and expression [runtime]; light on/off, type, shadow, grain, aberration and camera preset [unverified] |

### 7.4 Menus, appearance and saves

| Capability | API | Layer | R/W | Evidence | Risk / status |
|---|---|---|---|---|---|
| Character-customisation system | `GameInstance.GetCharacterCustomizationSystem(game)`: `GetUnitedOptions`, `ApplyChangeToOption(option, value)`, `ReFinalizeState` (the mirror's Confirm), `CancelFinalizedStateUpdate` (Back) and the getters in `characterCreationMenu.script:2-59`. `GetUIPresets` and `HasState` do not exist in 2.31; the mirror never calls `InitializeState` | N | R/W | [source] 2.31 `characterCreationMenu.script`, `characterCreationBodyMorphMenu.script`; RDJ `gameuiICharacterCustomizationSystem.json` | **Implemented** as `player.appearance` and `cc.apply` [runtime], now through the option's row [unverified], and `cc.confirm`/`cc.back` through the menu's own functions behind `allow_creator_leave` [unverified]. Options are matched by name or label, never a stored index (ArchiveXL rebuilds indices; [cc-file-chain.md](../../knowledge/cc-file-chain.md)) |
| Open the mirror screen | `MenuScenario_CharacterCustomizationMirror` exists; `inkMenuScenario.SwitchToScenario(name, userData)` on the active scenario | N | W | [source] RDJ `MenuScenario_CharacterCustomizationMirror.json:15-51`, `inkMenuScenario.json:54-65` | How the in-world mirror opens it is [unverified]; no clone does it |
| Preview puppets | Codeware `PlayerSystem.GetCustomizationPuppet()`, `GetPhotoPuppet()` | CW | R | [source] Codeware `scripts/Player/PlayerSystem.reds:15-63` | Exist only once the CC preview initialised |
| How AMM changes V | Swaps the TPP head item appearance through `TransactionSystem`, not CC state | L | W | [source] AMM `Modules/tools.lua:650-720` | Not a CC-state path |
| Save's stored look | Resolved `(app, definition)` pairs per group, not UI state; no runtime getter found | offline | R | [cc-file-chain.md](../../knowledge/cc-file-chain.md) | — |
| List saves | `RequestSavesForLoad()` → `OnSaveMetadataReady(inkSaveMetadataInfo)` (`saveIndex`, `saveID`, `internalName`, `isModded`) | N | R | [source] RDJ `inkISystemRequestsHandler.json:697`, `inkSaveMetadataInfo.json:8-83` | Callback wiring outside the menu [unverified] |
| Load a save | `inkISystemRequestsHandler.LoadSavedGame(saveId: Int32)` | N | W | [source] RDJ `inkISystemRequestsHandler.json:562` | No load by name; ID mapping [unverified] |
| Save to a dedicated slot | `ManualSave(saveName)`, `QuickSave()`, `OverrideSave(saveId)` | N | W | [source] RDJ `inkISystemRequestsHandler.json:398, 640-669` | **No slot choice**; `OverrideSave` destroys its target; quick and auto saves rotate. The existing diagnostic profile shares the real save folder (`LocalSaves=false`, [preflight card](../authoring/first-makeup-runtime-preflight-2026-09-25.md)). Rule: never call save methods from the bridge; isolate test saves with a profile using local saves |
| Session ready signal | Codeware `Session/Ready`, `Session/BeforeSave`; cet-kit `GameSession` | CW / L | R | [source] Codeware `wiki/Home.md:84-94`; cet-kit `GameSession.lua:568-826` | Good "loaded" signal for phase 2 |

### 7.5 World and player

| Capability | API | Layer | R/W | Evidence | Risk |
|---|---|---|---|---|---|
| Time of day | `TimeSystem.SetGameTimeByHMS(h, m, s)`, `SetGameTimeBySeconds`, `GetGameTime()` | N | W | [source] RDJ `gameTimeSystem.json:264-292`; AMM `Modules/tools.lua:3813-3817`; 2.31 scripts | **Implemented** as `world.time.set` with exact restore; it can trigger quest time events, so use a disposable save |
| Pause game time | `TimeSystem.SetPausedState()`, `IsPausedState()` | N | W | [source] 2.31 bundle: `SetPausedState` has **no** parameters (the pre-2.3 dump lists two); AMM `tools.lua:3712` | Not used; `game.status` reports `IsPausedState` |
| Freeze the world | `SetTimeDilation(reason, 0.0)` and `SetTimeDilationOnLocalPlayerZero(reason, 0.0)`, `UnsetTimeDilation(reason)` | N | W | [source] 2.31 `characterCreationBodyMorphMenu.script:1107-1117` (the mirror's own freeze); RDJ `gameTimeSystem.json:336-360`; AMM `tools.lua:3747-3795` (uses 1e-13) | **Implemented** as `world.pause`; the kill switch unfreezes |
| Weather | Codeware `WeatherSystem.SetWeather(name, blendTime, priority)`, `ResetWeather` | CW | W | [source] Codeware `scripts/World/WeatherSystem.reds:1-5`; AMM `tools.lua:3607-3609` | Needs Codeware |
| Teleport | `GetTeleportationFacility().Teleport(obj, position, orientation)` | N | W | [source] RDJ `gameTeleportationFacility.json:8-45`; AMM `Modules/util.lua:522` | Streaming delay before capture |
| Hide the HUD | Codeware ink layer `inkHUDLayer` virtual window (non-persistent) or AMM's `/interface/hud/*` settings toggle (persistent, must be restored) | CW / L | W | [source] Codeware `scripts/UI/inkSystem.reds:4-21`; AMM `init.lua:1353-1367` | Prefer the non-persistent route; [unverified] |
| Player pose | Spawn a workspot entity (CET `exEntitySpawner`), `WorkspotGameSystem.PlayInDeviceSimple` + `SendJumpToAnimEnt` | N + L | W | [source] AMM `Modules/anims.lua:351-371`; RDJ `gameWorkspotGameSystem.json:302-706` | Needs workspot and animation names |
| Fixed close-up camera | Spawn `base\entities\cameras\simple_free_camera.ent`, `camera` component `Activate(blend, overrideAudio)`, `SetFOV`; swap in the TPP head so the face renders | N + L | W | [source] AMM `Modules/camera.lua:13, 59-128`; RDJ `gameCameraComponent.json:135-201` | **Most promising repeatable framing route**; restore the FPP camera afterwards |

### 7.6 Input, launch and exit

- **Input simulation:** no clone injects OS input [source] searches of CET, Codeware, AMM, RED4ext and others. Opening the full photo mode has no script route, so the maintainer approved (26 September 2026, test profile only) exactly one allowlisted input: the player's photo-mode key, sent only to the game window after the game allows photo mode (`photo.open`, §3.6). Any other input stays out of scope; the creator is opened by the player until `cc.open` (a menu-scenario switch, knowledge/photo-mode.md §3.1) is built.
- **Launch (design only; the maintainer has not decided whether agents may launch the game):** a harness could start MO2 with an explicit profile and executable, e.g. `ModOrganizer.exe -p "<profile>" "moshortcut://:<executable title>"` [unverified: not in any clone; check against MO2 documentation before use], then wait for `session.json` and `ping`. It must never switch the maintainer's selected profile permanently.
- **Exit:** `inkISystemRequestsHandler.ExitGame()` exists [source] RDJ `inkISystemRequestsHandler.json:192-196`; whether it exits cleanly from gameplay without a prompt is [unverified]. A harness would then confirm the process ended and `session.json` is gone.
- **Avoid:** `gameAchievementSystem` (`UnlockAchievement`, `SetAchievementProgress`), telemetry and consent requests (`RequestTelemetryConsent`, `RequestMarketingConsentUpdate`), and online/cloud systems [source] RDJ `gameAchievementSystem.json:18,36`, `inkISystemRequestsHandler.json:852, 957`. These never go on the allowlist.

## 8. Phase-2 plan: automated finish-board session

Goal: run the [finish board](../../experiments/016-finish-board/README.md) check end to end with the maintainer only watching. Effort is rough agent effort after the baseline session passes.

**Built offline (26 September 2026):** step 2 as attach-only (the maintainer starts the game; `game.wait` follows the player); step 5 as `cc.apply` in the open mirror screen, with the player confirming; step 6 through photo-mode attributes (`photo.camera.set`, `photo.light.set`, `photo.hud.hide`) instead of a spawned camera; step 7 as external capture with region crops; step 4 in part (`world.time.set`, `world.pause`). The session runner turns a test card into a script ([session 2](../../projects/xf-runtime-bridge/tools/sessions/session-2.json), [session 3](../../projects/xf-runtime-bridge/tools/sessions/session-3.json)). Not built: save loading (step 3), weather and teleport, a spawned camera, the ReShade add-on and the Studio-side comparison.

| Step | How | Effort | Needs |
|---|---|---|---|
| 1. Stage | Existing runtime-diagnostic planner plus one more mod entry (the bridge, diagnostic build) in a dedicated profile with local saves | S | Coordinator; profile creation |
| 2. Launch or attach | Attach: the maintainer starts the game and the harness waits for `ping`. Launch (optional): MO2 command line (§7.6) | S (attach), M (launch) | **Maintainer decision:** may agents launch the game? |
| 3. Load the test save | `RequestSavesForLoad` → find `internalName` → `LoadSavedGame(id)`; wait for Codeware `Session/Ready` | M | A dedicated test save; Codeware as a declared dependency |
| 4. Stage the scene | `SetGameTimeByHMS`, `SetPausedState`, `SetWeather`, `Teleport` to a fixed mirror-like spot | M | Write methods allowed for this profile |
| 5. Apply each board | Unproven: CC system `InitializeState` → option by name → `ApplyChangeToOption` or `ApplyUIPreset` → `FinalizeState`, first with the mirror open by hand; fallback: the maintainer selects each board while the harness captures | L (research-heavy) | Runtime experiments; decision on whether finalising V's look in a test save is acceptable |
| 6. Fixed camera and light | Spawned free camera at a stored transform and FOV; HUD hidden by ink layer; light via a spawned light entity or photo-mode attributes | M-L | Photo-mode attribute keys, or AMM-style camera route |
| 7. Capture | External window capture now; ReShade before-effects add-on for calibration-grade frames | S (external), M (ReShade add-on) | **Maintainer decision:** ReShade as an optional dependency |
| 8. Compare | Store frames with the manifest, board id, camera and time; compare against the Studio preview render and previous runs | M | Studio-side comparison tool |
| 9. Restore and exit | Unset dilation and pause, reset weather, restore camera and HUD; `ExitGame()` only if launching was approved | S | — |

## 9. Maintainer decisions

1. **Bridge default:** the shipped mod keeps `enabled = false`; the diagnostic build turns it on read-only. Recommended: keep it off by default for everyone and let XF Studio switch it on only in its own dedicated profile.
2. **Session file location:** `%LOCALAPPDATA%\XFStudio\runtime-bridge` rather than the game folder (so MO2 does not capture it into overwrite). Acceptable?
3. **Agents launching the game** (phase 2, step 2). Decided for now: attach only; the maintainer starts the game and loads the save.
4. **ReShade as an optional capture dependency** (full add-on build only).
5. **Write actions for phase 2** (time, weather, teleport, camera, CC changes), each behind `allow_writes` in a dedicated profile with test saves. Decided: photo mode, the mirror screen's options, the clock and a world freeze, behind `allow_writes` in the test profile `XF Studio diagnostic 2026-09-25` only.
6. **Autonomy (26 September 2026), each confined to the test profile's -writes build:** the bridge may press Confirm and Back in the creator (only in sessions that end by loading the safety save, with the save lock held); it may send the photo-mode key to the game window (one key, the player's own binding, only to the game window, only after `CanPhotoModeBeEnabled`, never any other input); and the -diagnostic and -writes packages may carry TweakXL camera presets (never the distribution package). Decided: yes to all three.

## 10. Open questions

1. Are script calls from the RED4ext `Running` `OnUpdate`, made with a context (§3.5), safe during loading and in photo mode? Main menu and gameplay: yes for `Status` [runtime]; the rest after the fix.
2. ~~Does CET bind `XFRuntimeBridge_XFBridgeQuery` as a Lua global for a redscript class added through `scripts->Add`?~~ Yes: the CET layer called `XFRuntimeBridge_XFBridgeQuery.DescribeJson` at startup [runtime].
3. When does `XFBridgeSystem.OnAttach` first run: at the main menu or on the first save load?
4. ~~Is the TweakXL flat readable by the time the scriptable system attaches?~~ Yes: the system announced `tweak_marker=1` [runtime].
5. Do any RTTI names differ on 2.31 from the pre-2.3 dump? A fresh RTTIDumper run would settle every signature above. The fix's `script.call_context` log line checks the two natives that matter for §3.5.
