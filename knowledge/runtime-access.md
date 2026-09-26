# Runtime access: RED4ext, redscript, CET and the XF bridge

**Maturity: Draft.** This page covers how each Cyberpunk 2077 mod type gets code into the running game, where each one logs, and how XF Studio's local bridge reaches the game. It is consolidated from source reading of RED4ext 1.30.0, RED4ext.SDK 1.0.0, redscript 0.5.31, CET 1.37.1, TweakXL 1.11.4 and psiberx's plugins, plus the decompiled 2.31 scripts and the offline build, self-test and tests of [`projects/xf-runtime-bridge`](../projects/xf-runtime-bridge/README.md). **No claim here has runtime evidence yet**; the [first-session test card](../research/runtime/runtime-bridge-test-card.md) collects it. The full citations, capability matrix and phase-2 plan are in the [runtime bridge design](../research/runtime/runtime-bridge-design.md).

## 1. Load order and entry points

| Mod type | How the game picks it up | Entry point | Grade |
|---|---|---|---|
| RED4ext plugin | Found at `red4ext/plugins/<dir>/<name>.dll` (at most one folder deep). Needs the exports `Supports` (API version), `Query` (name, version, runtime, SDK) and `Main(Load/Unload)`. Refused if its runtime doesn't match the game build, or its SDK is older than 0.5.0-compat. | `Main(Load)` runs before the game starts, and the plugin registers RTTI callbacks there | [source] RED4ext `PluginSystem.cpp:89-154, 223-321` |
| Global natives for scripts | `CRTTISystem::AddPostRegisterCallback`, then `CGlobalFunction::Create` with flags `{isNative, isStatic}`, then `RegisterFunction` | Called by redscript as a declared `native func`, and by CET as `Game.Name(...)` | [source] SDK `examples/native_globals_redscript/Main.cpp:60-83`; CET `RTTIHelper.cpp:305-354` |
| redscript | `r6/scripts/**.reds`, plus any path a plugin adds with `sdk->scripts->Add` (resolved against the plugin folder) | Class bodies, `@wrapMethod`/`@addMethod`, `ScriptableSystem` callbacks | [source] RED4ext `v1/Funcs.cpp:123-139`, `ScriptCompilationSystem.cpp:101-134`; redscript `unit.rs` |
| TweakXL data | `r6/tweaks/**.yaml\|.yml\|.tweak`, imported right after TweakDB loads | none (data) | [source] TweakXL `Environment.hpp:13-16`, `TweakService.cpp:25-59` |
| CET mod | `bin/x64/plugins/cyber_engine_tweaks/mods/<name>/init.lua` | `registerForEvent` at top level only; `Game` and `Observe` are available from `onInit` | [source] CET `ScriptStore.cpp:31-64`, `ScriptContext.cpp:46-65, 194-196` |

## 2. Rules learned the hard way (from source)

- **Declare natives outside a module.** Redscript prefixes the module onto global natives (`XFRuntimeBridge.XFBridge_Ping`), but the plugin registers the plain name. Declare them in a module-less file, as Codeware does [source] redscript `unit.rs:1023`, `symbol.rs:222-246`.
- **Ship `.reds` that declare natives through the plugin (`scripts->Add`), not `r6/scripts`.** A redscript compile error blocks every mod's scripts behind a message box, and a declared native without its DLL is such an error [source] `scc/lib/src/lib.rs:86-94`.
- **Return `false` from a Running `OnUpdate`.** RED4ext removes a state callback that returns `true`, even though the SDK comment says the Running result does not matter [source] `StateSystem.cpp:128-160`.
- **Include `RED4ext/RED4ext.hpp` before any `RED4ext/Api` header.** The SDK becomes header-only only when `Common.hpp` is included first; otherwise `CreateSemVer`/`CreateFileVer` fail to link [offline].
- **CET cannot open network connections.** Its sandbox exposes no sockets, HTTP, `ffi` or process spawning, and file access is confined to the mod folder [source] CET `LuaSandbox.cpp:10-79, 152-161, 695-719`. Any external link must be native.
- **CET API details:** CET has `spdlog.warning`, not `spdlog.warn`; its Lua is LuaJIT (5.1), so use `unpack`; `onDraw` runs every frame even with the overlay closed [source] CET `LuaSandbox.cpp:641-666`, `LuaVM.cpp:50-56`.
- **Retail `Log`/`LogChannel` print nowhere** unless CET (`gamelog.log`, `scripting.log`) or Red Hot Tools hooks them. Route script logs through a plugin native instead [source] CET `LuaVM_Hooks.cpp:192-250`.
- **Bound JSON nesting before handing it to nlohmann/json, and serialise with `error_handler_t::replace`.**
  - Parsing and destruction are iterative in 3.12, but copying, comparing and `dump()` recurse. A 10 KB value nested 5,000 deep overflowed a 1 MB stack, and the game thread's 2 MB would take only about twice that [offline].
  - `dump()` throws `type_error.316` on invalid UTF-8 unless given a replace or ignore handler [source] json 3.12.0 `serializer::dump_escaped`.
- **Don't `FlushFileBuffers` a named pipe before disconnecting.** It waits until the client reads, which a client can simply not do [offline: held a stop 12 s]. `DisconnectNamedPipe` discards unread data, so give a client a short, bounded window to read a final reply instead [doc] Microsoft `DisconnectNamedPipe`.
- **`node:net` can't choose a pipe client's impersonation level or query the server PID.** Use `CreateFileW` with `SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION` and `GetNamedPipeServerProcessId` (through `bun:ffi` in Bun), or .NET's `NamedPipeClientStream` with `TokenImpersonationLevel.Identification` [offline].
- **`redscript-cli lint` exits 0 even on errors,** so parse its output for them. It also doesn't check `@wrapMethod` parameter lists on `cb` methods [offline].
- **Check a pre-2.3 RTTI dump against the 2.31 script bundle before relying on a signature.** `TimeSystem.SetPausedState` has no parameters in 2.31, although the dump lists two [source].
- **`PhotoModeMenuListItem.ForceValue` silently selects the first option for an option value it doesn't know.** Validate against the option data the menu set up (`OnSetupOptionSelector`) before calling it [source] 2.31 photo-mode scripts.
- **A photo-mode expression is selected by its option data (the `faceId`), not its position in the menu** [source]; the first session and session 3 check this in game.
- **`PrintWindow` with `PW_RENDERFULLCONTENT` returns black for a window that is entirely off-screen,** while legacy `WM_PRINT` works there but not for DirectX content; capture the game on-screen [offline].

## 3. Logging locations

| Layer | File (MO2 writes new files to `overwrite/`) | Bound |
|---|---|---|
| RED4ext and its plugins | `red4ext/logs/red4ext-<ts>.log`, `red4ext/logs/<dll stem>-<ts>.log` | `max_file_size` (10 MB) × `max_files` (5) per plugin, older ones pruned [source] RED4ext `Utils.cpp:62-76`, `Config.hpp:24-27` |
| psiberx plugins (ArchiveXL, TweakXL, Codeware) | Their own `red4ext/plugins/<Name>/<Name>-<ts>.log` | 100 MiB × 2, 10 logs (ArchiveXL 5) [source] `SpdlogProvider.hpp:61-63` |
| redscript compiler | `r6/logs/redscript_rCURRENT.log` | daily, 4 kept [source] `scc/lib/src/lib.rs:242-250` |
| CET mod | `…/mods/<name>/<name>.log` | 5 MiB × 3, appended; info lines flushed only on warnings or at exit [source] CET `Utils.cpp:105-118` |
| XF bridge (all layers) | `red4ext/logs/xfruntimebridge-<ts>.log`, `sid= lvl= layer= cid= evt=` lines | RED4ext's bound |

## 4. The XF bridge

- **Transport:** a Windows named pipe owned by the RED4ext plugin, off unless `[bridge] enabled = true`. It is local only (`PIPE_REJECT_REMOTE_CLIENTS`, user-only DACL, first-instance flag, random name), and uses newline-delimited JSON, protocol 1.
- **Security boundary:** the Windows user at medium integrity. Other users, remote machines, browsers and low-integrity or AppContainer processes can't reach the pipe. Same-user processes can, but they could already read or change the game's memory ([design §4](../research/runtime/runtime-bridge-design.md#4-safety-model)).
- **Security measures:**
  - A 256-bit token per session, published in `%LOCALAPPDATA%\XFStudio\runtime-bridge\session.json`. The plugin has no override for this folder.
  - Only allowlisted methods exist, and writes are gated by `allow_writes`. `bridge.kill` is a *control* method, which only changes the bridge.
  - Input is bounded: 64 KiB per line and 32 levels of nesting, and only scalar `id` values are echoed. Deep nesting would otherwise overflow the stack when a value is copied or serialised [offline: a 5,000-deep request crashed the host before the fix].
  - A rate limit covers unauthenticated requests too. Five malformed or unauthenticated requests drop the connection. Every refusal is logged.
  - A kill switch covers the CET hotkey, `bridge.kill` and a `KILL` file. Stopping is bounded and never waits for a client to read.
  - Every request is logged with a correlation ID. No C++ exception can unwind into the game.
  - A named pipe was chosen over loopback HTTP because browsers and other network clients cannot reach it ([design §3.1](../research/runtime/runtime-bridge-design.md#31-choosing-the-external-transport)).
- **Threading:** the pipe thread never touches the game. Game work is queued and drained from the plugin's Running `OnUpdate` (at most four tasks per tick).
  - A task not started before its timeout is cancelled and never runs.
  - A task already running at the timeout gets a 1 s grace. If it still hasn't finished, the client gets `timeout_after_start` and the late completion is logged.
- **Game access:** by RTTI name at run time, plus a check of the static flag, parameter types and return type before each call. A missing function fails with `rtti_missing` and a changed signature with `rtti_signature`. A function whose signature is unchanged but whose behaviour changed is not caught; the runtime pin is the main guard. Two routes are in use:
  - `GetPlayer;GameInstance` → `entEntity.GetWorldPosition`;
  - `ScriptGameInstance.GetPhotoModeSystem` → `gamePhotoModeSystem.IsPhotoModeActive`.

  These names and signatures come from the pre-2.3 `red-dump-json`, so they are [source] for existence and [unverified] on 2.31. Phase-2 game access goes through our redscript actions layer instead (plugin → redscript statics by name), which lints against the installed 2.31 bundle.
- **Clients:** Bun (`bun:ffi` calls kernel32, [offline] Bun 1.4.2) and PowerShell 7 (`NamedPipeClientStream`). Both open the pipe at the Identification impersonation level. Both check the server PID against `session.json` before sending the token. `node:net` can do neither, which is why the Bun client doesn't use it.

## 5. Phase 2: commands, writes and captures

- **One catalogue, many frontends.** Every command (name, plain text, JSON Schema input, permission class, undo note) is defined once in `tools/api/catalogue.ts`; the MCP server, the CLI's `run` and the session runner derive from it, so a command added once appears everywhere [offline]. Permission classes: `read`, `write-photo`, `write-world`, `write-character`, `control`.
- **Writes are gated twice.** The tools can withhold classes (`--read-only`, `--allow`), and the game refuses every write unless `allow_writes = true` in the plugin's config, which only the `-writes` build sets for the test profile [offline].
- **Every write is reversible and recorded.** It takes a save lock first, logs `write.done … undo=` and returns `undo {method, params}`; the kill switch undoes a freeze and a hidden photo-mode menu and keeps the save lock until a save is loaded [unverified]; no queued write can run after it [offline].
- **Photo mode is driven through its own menu.** `GetMenuItem(key)` and `ForceValue` reach `OnAttributeUpdated`, with values checked against the ranges the menu set up; keys come from four photo-mode mods' source ([design §3.2](../research/runtime/runtime-bridge-design.md#32-protocol-1)) [source]. Opening photo mode from a script needs Codeware's `QuestsSystem.ExecuteNode` with `questOpenPhotoMode_NodeType` [source; hypothesis outside quests].
- **Character options change only in the open mirror screen,** through `ApplyChangeToOption` as its own controls do; the bridge never confirms (`ReFinalizeState`), and Back discards [source].
- **The world clock and a freeze:** `SetGameTimeByHMS` / `SetGameTimeBySeconds`, and time dilation 0 on the world and V as the mirror screen does [source].
- **Captures** are external (`PrintWindow` or the screen), cropped to named regions sized in window heights so they frame the same area on 16:9 and 21:9, saved at full resolution and returned downscaled with an exact area filter [offline].

| API | Grade | Status |
|---|---|---|
| `gameuiPhotoModeMenuController.GetMenuItem` / `PhotoModeMenuListItem.ForceValue` / `OnAttributeUpdated` | [source] 2.31 | Used for camera, lights, expression |
| `gameuiPhotoModeMenuController.OnExitConfirmed(Bool)` | [source] 2.31 | Used for `photo.exit` |
| Protected `OnFadeVisibility(Float)` through an added method | [source] 2.31 | Used for `photo.hud.hide` |
| Codeware `QuestsSystem.ExecuteNode` + `questOpenPhotoMode_NodeType` | [source]; outside quests [hypothesis] | Used for `photo.enter`; the player's key is the fallback |
| `gameuiICharacterCustomizationSystem.ApplyChangeToOption`, `GetUnitedOptions` | [source] 2.31 | Used in the mirror screen only |
| `ReFinalizeState` (Confirm), `CancelFinalizedStateUpdate` (Back) | [source] 2.31 | Never called by the bridge |
| `TimeSystem.SetGameTimeByHMS`, `SetGameTimeBySeconds`, `SetTimeDilation`, `SetTimeDilationOnLocalPlayerZero` | [source] 2.31 | Used for the clock and the freeze |
| `TimeSystem.SetPausedState()` | [source] 2.31, no parameters | Not used |
| `SaveLocksManager.RequestSaveLockAdd/Remove` | [source] 2.31 | Held from the first write until a save is loaded (the kill switch keeps it); blocking autosaves in practice [unverified] |
| Autosave triggers: vendor, ripperdoc and perk exits (`MenuUIUtils.RequestAutoSave`), fast travel, legendary loot, drop points, quest checkpoints, the timed autosave setting | [source] 2.31 | Why sessions start with a manual save and end by loading it |

## 6. What agents can and cannot do yet

- **Built, untested in game:** the phase-2 commands above, through MCP, the CLI or a session script.
- **Verified to exist (still untested in game):**
  - reading photo-mode state, camera transform and FOV;
  - time of day, pause and dilation, teleport;
  - weather (with Codeware);
  - listing and loading saves by ID;
  - the character-customisation system calls;
  - quitting through `ExitGame`.
- **No API found:**
  - taking a game screenshot to a chosen file;
  - opening photo mode without input, other than Codeware's quest-node route;
  - opening the mirror screen from gameplay;
  - saving to a chosen slot.
- **Capture paths:** capture is external for now (window capture after post-processing). The lossless, before-effects route is an optional ReShade add-on (6.7.x headers, full add-on build only), which must never change the user's preset.

Details and citations: [design §7](../research/runtime/runtime-bridge-design.md#7-autonomy-capability-matrix).

## Open questions

1. Is running scripts from RED4ext's Running `OnUpdate` safe at the main menu, while loading and in photo mode?
2. Can CET call a redscript class that a plugin added with `scripts->Add`, as the Lua global `Module_Class`?
3. When does a `ScriptableSystem`'s `OnAttach` first run: at the main menu or on the first save load?
4. Do the RTTI names from the pre-2.3 dump still match on 2.31? Settle this with a fresh RTTIDumper run.
5. Does window capture return the game image in its fullscreen mode, or only in borderless windowed mode?
6. Does the Codeware quest node open photo mode outside a quest, and does the save lock hold off autosaves?
7. Do the photo-mode keys from mod source match this install, and which keys switch lights on and set film grain and chromatic aberration?

## Related pages

[Runtime bridge design](../research/runtime/runtime-bridge-design.md) · [Test card](../research/runtime/runtime-bridge-test-card.md) · [Mod loading](mod-loading.md) · [Validation](../docs/validation.md) · [Toolchain](../docs/toolchain.md)
