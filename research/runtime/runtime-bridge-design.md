# Runtime bridge design (runtime access baseline)

**Status: baseline built, not yet run in the game.** The plugin DLL builds, the bridge core passes an offline self-test through both clients, and the redscript and Lua layers pass offline checks. Nothing here has been observed in the running game yet; the [one-session test card](runtime-bridge-test-card.md) asks for that. Project: [`projects/xf-runtime-bridge`](../../projects/xf-runtime-bridge/README.md). Consolidated answers live in [knowledge/runtime-access.md](../../knowledge/runtime-access.md).

Evidence grades follow the [knowledge rules](../../knowledge/README.md): **[source]** read in a clone, **[doc]** vendor documentation outside the clones, **[offline]** exercised by our own build or self-test, **[runtime]** seen in the game (none yet), **[unverified]**.

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
| `red4ext-rs` | `v0.10.0-35` | Alternative native layer (Rust) |
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
- **Outward:** the plugin calls game RTTI functions and our own redscript statics by name (`CClass::GetFunction` matches the short name, SDK `RTTITypes-inl.hpp:379-403`).
- **External:** only the plugin talks to other processes.

### 3.1 Choosing the external transport

| Option | Security | Stability | Update resilience | Verdict |
|---|---|---|---|---|
| **Named pipe hosted by the RED4ext plugin** | Local only by construction: `PIPE_REJECT_REMOTE_CLIENTS` refuses SMB clients; an explicit DACL grants only the game's user (the default pipe DACL also grants Everyone read) [doc] Microsoft `CreateNamedPipe` and "Named Pipe Security and Access Rights". Browsers cannot open pipes, so no cross-site or DNS-rebinding exposure. No firewall prompt. | One overlapped-I/O thread, bounded messages, idle timeout; `Stop` never blocks. | Transport and protocol code never touches the game; only the handful of RTTI calls can break on a patch, and they fail soft. | **Chosen.** Bun 1.4.2 opens it through `node:net` and PowerShell through `NamedPipeClientStream` [offline]. |
| Loopback TCP or HTTP/WebSocket from the plugin | Any local process, including every browser tab, can reach `127.0.0.1`; needs origin checks, a token and care against request smuggling and DNS rebinding; Windows may prompt for firewall access. | Same threading as the pipe, plus a socket stack and (for HTTP) a server library. | Same. | Rejected for the baseline; reconsider only if a browser client must connect directly. |
| File exchange (command and answer files) | Relies on folder ACLs; easy to audit. | Polling latency; partial writes; clean-up. | Good. | Kept only for the kill switch (`KILL` file) and discovery (`session.json`). |
| CET-hosted endpoint | CET's sandbox has no sockets or HTTP [source] CET `LuaSandbox.cpp:10-79, 152-161`. | — | — | Impossible. |
| ReShade add-on hosting the pipe | Same as the plugin pipe. | Loads only with the full add-on build; add-ons are disabled in the signed build (§7.2). | Tied to ReShade API version (18 in 6.7.x, 20 in 6.8.0). | Optional capture helper at most, never the main bridge. |

### 3.2 Protocol 1

One JSON object per line each way. Request `{"v":1,"id":…,"token":"…","method":"…","cid":"…","params":{}}`; response `{"v":1,"id":…,"cid":…,"ok":true,"result":…}` or `{"ok":false,"error":{"code","message"}}`. Checks run in this order: parse, token (constant-time compare), kill switch, rate limit, allowlist, write gate, then the method runs on its declared thread. Error codes: `bad_request`, `bad_version`, `unauthorized`, `killed`, `rate_limited`, `unknown_method`, `writes_disabled`, `game_not_running`, `timeout`, `busy`, `too_large`, `game_not_ready`, `rtti_missing`, `call_failed`, `script_layer_missing`, `failed`. Implemented in `native/src/core/Dispatcher.cpp`.

| Method | Access | Thread | What it proves |
|---|---|---|---|
| `ping` | read | bridge | Transport, token, session id |
| `bridge.info`, `bridge.methods` | read | bridge | Versions, status, allowlist with access classes |
| `bridge.kill` | kill | bridge | Kill switch from the client side |
| `game.version`, `game.state` | read | bridge | `sdk->runtime` product version, exe file version, RED4ext state and tick count |
| `layers.status` | read | bridge | Announcements from redscript, CET and the TweakXL marker |
| `player.position` | read | game | `GetPlayer;GameInstance` then `entEntity.GetWorldPosition` by RTTI |
| `photomode.state` | read | game | `ScriptGameInstance.GetPhotoModeSystem` then `IsPhotoModeActive`, `CanPhotoModeBeEnabled`, `IsExitLocked` |
| `script.describe` | read | game | Native → redscript call (`XFRuntimeBridge.XFBridgeQuery.DescribeJson`) |
| `diag.write_probe` | write | game | The write gate and audit log, with no game effect |

Discovery: `%LOCALAPPDATA%\XFStudio\runtime-bridge\session.json` holds `pid`, `pipe`, `sid`, `token`, `started_at`, `plugin_version` and `allow_writes`; it exists only while the bridge listens. The folder sits in the user profile, so MO2's virtual file system does not redirect it and its default ACL keeps it private to the user. The PowerShell client also checks `GetNamedPipeServerProcessId` against `pid` before sending the token, which defeats a pipe-name squatter.

### 3.3 Threading

The pipe thread never touches game objects. Game-thread methods go through `GameThreadQueue` (capacity 16), drained at most four per tick from the plugin's `Running` `OnUpdate`. A request not started within `request_timeout_ms` (default 2000) is cancelled and never runs, so a late write cannot happen after the client gave up. RED4ext removes a state callback that returns `true` [source] `StateSystem.cpp:128-160`, although the SDK comment says the Running result does not matter (`Api/v1/GameState.hpp`); the plugin therefore returns `false`. Whether calling script functions from the Running `OnUpdate` is safe in every game phase is **[unverified]**; the first session tests it.

## 4. Safety model

| Rule | Implementation | Status |
|---|---|---|
| Local only | Named pipe with `PIPE_REJECT_REMOTE_CLIENTS`, a user-only DACL and `FILE_FLAG_FIRST_PIPE_INSTANCE`; the name has a random suffix | [offline] clients connect; remote refusal is [doc] |
| Per-session token | 256-bit `BCryptGenRandom` token in `session.json`; required on every request; never logged | [offline] wrong or missing token refused; log scanned for the token |
| Off unless enabled | `[bridge] enabled = false` by default: no pipe, no session file | [offline] default zip ships it off |
| Read-only by default | Every method declares read or write; writes are refused unless `[bridge] allow_writes = true` | [offline] |
| Allowlist | Only registered methods exist; nothing evaluates client-supplied code | [offline] |
| Audit | Every request and response is logged with `cid`, method, access class, client PID, outcome and duration | [offline] |
| Rate limit | Token bucket, `max_requests_per_second` (default 20, burst 40) | [offline] |
| Kill switch | CET hotkey (`XFBridge_Kill`), `bridge.kill`, or a `KILL` file beside `session.json`; refuses everything, drops the client, removes `session.json`, closes the listener until restart | [offline] method and file; hotkey [unverified] |
| Visible indicator | CET draws "XF bridge: listening (read-only / writes ON)" whenever the bridge listens | [unverified] |
| Dedicated profile and saves | A dedicated MO2 profile; disposable test saves; never overwrite the player's saves | Process rule (§7.4) |
| No online features | No achievement, telemetry, marketing-consent or online-system calls on the allowlist, ever | Process rule |

## 5. Logging

| Layer | Where | Bound | Notes |
|---|---|---|---|
| Plugin (and everything routed through `XFBridge_Log`) | `red4ext/logs/xfruntimebridge-<timestamp>.log` (MO2: `overwrite/red4ext/logs/`) | RED4ext's `rotating_file_sink_mt`: `max_file_size` MB × `max_files` per plugin, defaults 10 MB and 5 files; older logs pruned per plugin | [source] `Utils.cpp:62-76`, `Config.hpp:24-27`, `LoggerSystem.hpp:40-76`, `LoggerSystem.cpp:37-94`. RED4ext's default level is `info`, so the plugin filters by its own `[log] level` and writes debug lines at `info`; it never edits the user's RED4ext config. |
| RED4ext loader | `red4ext/logs/red4ext-<timestamp>.log` | as above | Load line `XF Runtime Bridge (version: 0.1.0, author(s): XF Studio) has been loaded` [source] `PluginSystem.cpp:319` |
| redscript compiler | `r6/logs/redscript_rCURRENT.log` | Daily rotation, 4 kept | Lists compiled files and errors [source] `scc/lib/src/lib.rs:201-250` |
| TweakXL | `red4ext/plugins/TweakXL/TweakXL-<timestamp>.log` (+ `TweakXL.log` link) | 100 MiB × 2, 10 logs | `Reading "…"` per file [source] TweakXL `SpdlogProvider.cpp:12, 58-79`, `TweakImporter.cpp:139` |
| CET mod | `bin/x64/plugins/cyber_engine_tweaks/mods/xf_runtime_bridge/xf_runtime_bridge.log` | 5 MiB × 3, appended across launches | Release builds flush only on warnings or at shutdown [source] CET `Utils.cpp:105-118`, `Utils.h:16-18` |
| Self-test | stdout | — | Same line format |

**Line format:** `sid=<session> lvl=<level> layer=<native|redscript|cet|tweakxl> cid=<correlation id> evt=<event> key=value …`. Every line is cut at 2 KiB with control characters replaced (`core/Log.cpp`).

**Correlation IDs:**
- Clients choose `cid` (a safe charset, up to 64 characters) or get `n<k>`.
- Redscript uses `rs-*` and CET uses `cet-<k>`.
- `script.describe` passes the request's `cid` into redscript, so one ID appears on both layers.

Nothing logs per frame except a heartbeat about every ten minutes; `tools/capture_session.py` already collects `red4ext/logs`.

## 6. Update resilience

- **Runtime pin.** The plugin declares `RED4EXT_V1_RUNTIME_VERSION_LATEST` (2.31, `3.0.80.51928`), so after a game patch RED4ext skips it with a clear "incompatible" warning until it is rebuilt [source] `PluginSystem.cpp:270-294`.
- **RTTI by name.** Game access is by name at runtime and fails soft (`rtti_missing`); no hard-coded offsets or hooks.
- **Redscript surface.** The redscript layer uses only APIs already used by published mods and is linted against the game's own bundle; its `.reds` files compile only when the DLL loads (`scripts->Add`), so a missing DLL cannot break script compilation.
- **Protocol version.** The transport and protocol are versioned (`v:1`) and independent of the game.

## 7. Autonomy capability matrix

What an agent would need to run in-game tests with minimal hand-holding. **Layer:** N = native game RTTI (callable from RED4ext, redscript or CET), CW = Codeware, L = CET Lua technique, X = external process, RS = ReShade add-on. **R/W:** read or write. Unless stated, RTTI signatures come from `red-dump-json` (`a8e52990`, pre-2.3) and must be re-checked on 2.31, for example with a fresh RTTIDumper run.

### 7.1 Capture

| Capability | API | Layer | R/W | Evidence | Risk / status |
|---|---|---|---|---|---|
| Game screenshot to a chosen file | none found: `gamePhotoModeSystem` has five functions, none a capture; no global or CET capture call | — | — | [source] RDJ `classes/gamePhotoModeSystem.json`; CET source | **No verified in-game API.** Engine structs `rendSingleScreenShotData{outputPath, saveFormat}` exist without a script-visible caller [source] RDJ `rendSingleScreenShotData.json:13,38` |
| Find the game's own screenshots afterwards | `inkISystemRequestsHandler.RequestGameScreenshotsForLoad()` → `inkGameScreenshotInfo.path` | N + CW callback | R | [source] RDJ `inkISystemRequestsHandler.json:809`, `inkGameScreenshotInfo.json:7`; Codeware `Addons/inkISystemRequestsHandler.reds:59` | Path chosen by the game; folder and file name pattern [unverified] |
| External window capture | GDI `CopyFromScreen` over the game's client rectangle (`tools/capture-window.ps1`) | X | R | [offline] tested on another window | **Implemented.** Captures what is on screen (after ReShade and overlays), 8-bit; fullscreen mode [unverified]. Framing, not calibration |
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
| Open photo mode | No script API; AMM reacts to the `TogglePhotoMode` input action; `questOpenPhotoMode_NodeType` works only inside quest graphs; Photo Mode Ex hooks the native `PhotoModeSystem::Activate` | input / hook | W | [source] AMM `init.lua:698-704`; SDK `quest/OpenPhotoMode_NodeType.hpp:21-24`; PMEx `src/Red/PhotoMode.hpp:100-101` | **No verified API; not implemented.** Candidates: call the hooked native `Activate` (address-library hash in PMEx `src/Red/Addresses/Library.hpp`) or raise the input action. Both need reverse-engineering and a runtime test |
| Close photo mode | `TryExitPhotomodeEvent` (target unknown) or the `ExitPhotoMode` action | N / input | W | [source] SDK `game/ui/TryExitPhotomodeEvent.hpp:15` | [unverified] |
| Camera pose and FOV | Read: `CameraSystem.GetActiveCameraWorldTransform(out Transform)`, `GetActiveCameraFOV()`. Photo-mode camera objects expose no script methods | N | R | [source] RDJ `gameCameraSystem.json:23,63` | Setting it inside photo mode [unverified] |
| Attributes (DOF, lights, filters, vignette) | Native `PhotoModeSystem::SetAttributeValue(attr: uint32, value: float, apply)`; script `gameuiPhotoModeMenuController.OnAttributeUpdated(key, value, doApply)`; known key DepthOfField = 26 | N (address library) / redscript | W | [source] PMEx `src/Red/PhotoMode.hpp:112-118`, `PhotoModeExService.cpp:7-35`; RDJ `gameuiPhotoModeMenuController.json:315` | Keys for FOV, lights, vignette and filters [unverified]; photo-mode defaults can be set through TweakDB (`photo_mode.camera.*`, AMM `init.lua:816-821`) |

### 7.4 Menus, appearance and saves

| Capability | API | Layer | R/W | Evidence | Risk / status |
|---|---|---|---|---|---|
| Character-customisation system | `GameInstance.GetCharacterCustomizationSystem(game)`: `InitializeState`, `GetState`, `GetHeadOptions(preset)`, `ApplyChangeToOption(option, value)`, `ApplyUIPreset(name)`, `ApplyEditTag`, `FinalizeState`, `ReFinalizeState` | N | R/W | [source] RDJ `gameuiICharacterCustomizationSystem.json:15-268`; SDK `game/ui/ICharacterCustomizationSystem.hpp:15-21` | Whether these work outside the CC menu is [unverified]; `Finalize` probably writes V's persistent look. Match options by name, not index (ArchiveXL rebuilds indices; [cc-file-chain.md](../../knowledge/cc-file-chain.md)) |
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
| Time of day | `TimeSystem.SetGameTimeByHMS(h, m, s)`, `GetGameTime()` | N | W | [source] RDJ `gameTimeSystem.json:264-292`; AMM `Modules/tools.lua:3813-3817` | Can trigger quest time events; disposable save |
| Pause game time | `TimeSystem.SetPausedState(paused, source)`, `IsPausedState()` | N | W | [source] RDJ `gameTimeSystem.json:60, 318-333`; AMM `tools.lua:3712` | Resume with the same `source` |
| Freeze the world | `SetTimeDilation(reason, dilation, …)`, `UnsetTimeDilation(reason)` | N | W | [source] RDJ `gameTimeSystem.json:336-360`; AMM `tools.lua:3747-3795` (uses 1e-13, not 0) | Stuck freeze if never unset: pair with the kill switch |
| Weather | Codeware `WeatherSystem.SetWeather(name, blendTime, priority)`, `ResetWeather` | CW | W | [source] Codeware `scripts/World/WeatherSystem.reds:1-5`; AMM `tools.lua:3607-3609` | Needs Codeware |
| Teleport | `GetTeleportationFacility().Teleport(obj, position, orientation)` | N | W | [source] RDJ `gameTeleportationFacility.json:8-45`; AMM `Modules/util.lua:522` | Streaming delay before capture |
| Hide the HUD | Codeware ink layer `inkHUDLayer` virtual window (non-persistent) or AMM's `/interface/hud/*` settings toggle (persistent, must be restored) | CW / L | W | [source] Codeware `scripts/UI/inkSystem.reds:4-21`; AMM `init.lua:1353-1367` | Prefer the non-persistent route; [unverified] |
| Player pose | Spawn a workspot entity (CET `exEntitySpawner`), `WorkspotGameSystem.PlayInDeviceSimple` + `SendJumpToAnimEnt` | N + L | W | [source] AMM `Modules/anims.lua:351-371`; RDJ `gameWorkspotGameSystem.json:302-706` | Needs workspot and animation names |
| Fixed close-up camera | Spawn `base\entities\cameras\simple_free_camera.ent`, `camera` component `Activate(blend, overrideAudio)`, `SetFOV`; swap in the TPP head so the face renders | N + L | W | [source] AMM `Modules/camera.lua:13, 59-128`; RDJ `gameCameraComponent.json:135-201` | **Most promising repeatable framing route**; restore the FPP camera afterwards |

### 7.6 Input, launch and exit

- **Input simulation:** no clone injects OS input [source] searches of CET, Codeware, AMM, RED4ext and others. Input would only be needed to open photo mode or the mirror. The safer alternative is always a direct API call (sections 7.3 to 7.5) or a spawned camera instead of photo mode. If input injection is ever used, it must target only the game window, be on the allowlist and be logged; it is out of scope now.
- **Launch (design only; the maintainer has not decided whether agents may launch the game):** a harness could start MO2 with an explicit profile and executable, e.g. `ModOrganizer.exe -p "<profile>" "moshortcut://:<executable title>"` [unverified: not in any clone; check against MO2 documentation before use], then wait for `session.json` and `ping`. It must never switch the maintainer's selected profile permanently.
- **Exit:** `inkISystemRequestsHandler.ExitGame()` exists [source] RDJ `inkISystemRequestsHandler.json:192-196`; whether it exits cleanly from gameplay without a prompt is [unverified]. A harness would then confirm the process ended and `session.json` is gone.
- **Avoid:** `gameAchievementSystem` (`UnlockAchievement`, `SetAchievementProgress`), telemetry and consent requests (`RequestTelemetryConsent`, `RequestMarketingConsentUpdate`), and online/cloud systems [source] RDJ `gameAchievementSystem.json:18,36`, `inkISystemRequestsHandler.json:852, 957`. These never go on the allowlist.

## 8. Phase-2 plan: automated finish-board session

Goal: run the [finish board](../../experiments/016-finish-board/README.md) check end to end with the maintainer only watching. Effort is rough agent effort after the baseline session passes.

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
3. **Agents launching the game** (phase 2, step 2).
4. **ReShade as an optional capture dependency** (full add-on build only).
5. **Write actions for phase 2** (time, weather, teleport, camera, CC changes), each behind `allow_writes` in a dedicated profile with test saves.

## 10. Open questions

1. Is script execution from the RED4ext `Running` `OnUpdate` safe at the main menu, during loading and in photo mode?
2. Does CET bind `XFRuntimeBridge_XFBridgeQuery` as a Lua global for a redscript class added through `scripts->Add`?
3. When does `XFBridgeSystem.OnAttach` first run: at the main menu or on the first save load?
4. Is the TweakXL flat readable by the time the scriptable system attaches?
5. Do any RTTI names differ on 2.31 from the pre-2.3 dump? A fresh RTTIDumper run would settle every signature above.
