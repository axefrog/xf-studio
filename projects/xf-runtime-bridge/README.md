# XF Runtime Bridge

A set of small, verbosely logged Cyberpunk 2077 base mods, one per mod type, plus a local-only bridge so that XF Studio and its agents can read live game state and, under supervision, change it. It is an R&D project separate from `projects/xf-studio`.

**Status:** phase 2 works in game, and an autonomy batch is built and tested offline. **In game, 26 September 2026:** after the script-call fix (every game and script call made with a caller frame and a context, as CET does; [design §3.5](../../research/runtime/runtime-bridge-design.md#35-calling-game-and-script-functions-from-native-code)) the reads, photo-mode writes (field of view, V's placement, look-at, light, menu fade, expression), `cc.apply` in the creator, the clock, the freeze and the kill switch's restore all worked, and session 2 ran semi-manually through the bridge ([test card results](../../research/runtime/runtime-bridge-test-card.md)). **Built since, offline only:** `photo.open` (presses the player's own photo-mode key in the game window, the one input the tools send), `photo.frame` (frames V from the game's own camera projection, no hand-tuned offsets), `photo.subject`, lights on/off, type and shadow, hiding the mouse cursor with the menu, the creator row's label following `cc.apply`, `cc.confirm`/`cc.back`, `capture.burst`, the `cc-eyes` crop, XF camera presets for the test profile, and session 2 and 3 scripts reworked to that flow. `photo.enter`'s quest-node route opens a restricted photo mode, so it now refuses unless asked for it by name (research only). A second batch, also offline only, closed the open review findings (RB-32..41: engine addresses checked at load, the cursor hidden only in photo mode, stricter key sending, a test preload and a packaging test) and added the expression editor's two research commands, `face.rig.read` and `photo.expression.index` (runtime questions R1 and R2). A third batch, offline only as well, removes most of the remaining player steps: `cc.open` opens the character creator from normal play (after taking the save lock), `cc.page` points the creator's camera, `cc.apply` takes a value by its on-screen label and an option by its slot, `world.time.set` also works with the creator open, `game.options.read` records the graphics settings and (through the CET layer) the engine's character render options, and the test profile gains a full-body camera preset; the session scripts now open the creator and set vanilla rows through the bridge. The [test card](../../research/runtime/runtime-bridge-test-card.md#next-session-autonomy-checks-expression-checks-then-session-2-continued) lists the next session's checks, [batch 3's](../../research/runtime/runtime-bridge-test-card.md#batch-3-checks-the-creator-from-gameplay-and-the-settings-record) among them. Design, source citations and the capability matrix: [research/runtime/runtime-bridge-design.md](../../research/runtime/runtime-bridge-design.md); photo mode and the creator from script: [knowledge/photo-mode.md](../../knowledge/photo-mode.md).

## Layers

| Layer | Folder | Ships to (MO2 mod root) | Does |
|---|---|---|---|
| RED4ext plugin (C++) | `native/` | `red4ext/plugins/XFRuntimeBridge/XFRuntimeBridge.dll` + `config.ini` | Load and unload, game states, seven global natives, RTTI calls on the main thread, the named-pipe bridge and its method table |
| redscript | `redscript/` | `red4ext/plugins/XFRuntimeBridge/Scripts/*.reds`, added to compilation by the plugin (`sdk->scripts->Add`) | The game-side actions: game phase, photo-mode menu model and attribute changes, V's head and the camera (`photo.subject`), the menu cursor, the creator's opening, options, rows, camera, Confirm and Back, clock and freeze, the user settings, the save lock; vanilla APIs only |
| CET Lua | `cet/xf_runtime_bridge/` | `bin/x64/plugins/cyber_engine_tweaks/mods/xf_runtime_bridge/init.lua` | Events, a kill-switch hotkey, an always-visible status label (green read-only, amber writes on, red killed); answers `game.options.read`'s render options (CET's `GameOptions.Get`, read-only) |
| TweakXL data | `tweaks/` | `r6/tweaks/XFRuntimeBridge/xf_runtime_bridge.yaml`; `xf_photo_mode_presets.yaml` in the -diagnostic and -writes packages only | One TweakDB flat confirming the data layer loaded; XF photo-mode camera presets 6-9 (full body, face, eyes, head and shoulders) for the test profile |
| Tools (Bun/TypeScript) | `tools/` | nothing (development side) | The command catalogue and API, MCP server, CLI, session runner, capture, framing (`tools/api/framing.ts`), the photo-mode key (`tools/input/photo-key.ts`), self-test, packaging |

No ArchiveXL stub: XF Eye Artistry already exercises ArchiveXL. The redscript files ship under the plugin rather than `r6/scripts`: they declare natives that only exist when the DLL loads, so a missing DLL can never break everyone's script compilation (psiberx's plugins, Let There Be Flight and mod_settings ship scripts the same way).

## Bridge in one paragraph

The plugin opens `\\.\pipe\xf-runtime-bridge-<pid>-<random>` only when `[bridge] enabled = true`. The pipe is local only, has a user-only DACL, and takes one client at a time. Each side sends newline-delimited JSON, and every request carries the per-session token published in `%LOCALAPPDATA%\XFStudio\runtime-bridge\session.json`. Only allowlisted methods exist. Write methods are refused unless `allow_writes = true`, each write takes a save lock first, logs `write.done` with its reversal and returns a machine-readable `undo`, and every request and refusal is logged with a correlation ID. Requests are capped at 64 KiB and 32 levels of nesting. A rate limit covers every request, and a connection that sends five malformed or unauthenticated requests is dropped. A kill switch (the CET hotkey, `bridge.kill` or a `KILL` file) stops the bridge until the game restarts, cancels any write still queued, and undoes what it left on (a world freeze, a hidden photo-mode menu). It keeps the save lock: other changes may still be live, and only loading a save releases it. The CET hotkey has no key until it is bound in CET's Bindings. Game work runs on the main thread from the plugin's Running-state update, and every game or script function is called the way script code calls it: through the engine's internal execute with a caller frame and a context that is never null (`native/src/plugin/ScriptCall.cpp`; without a context the game crashes in natives such as `TweakDBInterface.GetInt`). The engine addresses that call needs are resolved when the plugin loads; if the game's address library lacks one, every game method is refused for the session (`script_calls_unavailable`) instead of the game ending at the first call. Nothing ever saves the game. Methods: [design §3.2](../../research/runtime/runtime-bridge-design.md#32-protocol-1).

**Security boundary:** the Windows user, at medium integrity. Other users, remote machines, browsers and low-integrity or AppContainer processes can't reach the pipe. Any process running as the same user can read the token and connect, but such a process can already read or change the game's memory. Details: [safety model](../../research/runtime/runtime-bridge-design.md#4-safety-model).

## One command API, many frontends

```
catalogue (tools/api/catalogue.ts)  typed commands: name, plain text, JSON Schema input, permission class, undo note
        |
CommandApi (tools/api/command-api.ts)  validate -> audit (writes) -> bridge method or local handler -> plain result or refusal
        |
  +-- MCP server (tools/mcp/server.ts, stdio entry tools/mcp-server.ts)
  +-- CLI        (tools/bridge-client.ts commands | run)
  +-- sessions   (tools/session.ts, scripts in tools/sessions/)
  +-- later: the XF Studio desktop app, user scripts
        |
bridge-lib.ts (named pipe, PID check, Identification level)  ->  the game
```

A command added to the catalogue appears in every frontend; `tools/test/catalogue.test.ts` checks that the MCP tool list equals the catalogue and that every bridge command exists in the plugin and the self-test host with the same access class. Errors are plain sentences with one next step (`tools/api/errors.ts`), with the bridge's technical message kept as `detail`. Write and control commands are appended to `logs/commands-<day>.jsonl` (ignored) with their input and undo note.

**Permission classes** are data, ready for a consent screen: `read` (looks, changes nothing), `write-photo` (photo mode only; gone when it closes), `write-world` (clock and freeze), `write-character` (opening the creator, its options, camera, Confirm and Back), `control` (the kill switch, always allowed). The game-side gate is separate and final: without `allow_writes = true` in the plugin's config every write is refused, and the plugin knows the same classes, so `allow_write_classes` can switch photo, world or character changes off one by one (`write_class_disabled`). `photo.open` runs in the tools, not the plugin, and checks the same gate through `game.status` before it sends anything.

**Maintainer decisions** (26 September 2026, each confined to the test profile's `-writes` build): the bridge may press **Confirm and Back** in the creator (`cc.confirm`, `cc.back`; `allow_creator_leave = true` only in that build), only in sessions that end by loading the safety save, and `cc.open` (batch 3) sits behind the same switch; it may send **the photo-mode key** to the game window (`photo.open`: one allowlisted key, the player's own binding, only to the Cyberpunk window, only after the game allows photo mode, never any other input); and the -diagnostic and -writes packages may carry **XF camera presets** (`photo_mode.std_preset_7..9`), never the distribution package. Recorded in the [bridge autonomy backlog](../../research/backlog/bridge-autonomy.md#decisions-for-the-maintainer).

| Command | Class | What it does |
|---|---|---|
| `bridge.ping`, `bridge.info` | read | Connection check; versions, build commit, `allow_writes` |
| `bridge.kill` | control | Switches the bridge off until the game restarts |
| `capture.screenshot`, `capture.recrop` | read | Window capture with a region, preview ≤ 1280 px, full-resolution file on disk; re-crop a saved file |
| `capture.burst` | read | 2-120 captures of one area at an interval, a contact sheet and one manifest with timings and frame-to-frame differences (flicker and motion checks) |
| `game.status`, `game.wait` | read | Phase (`main_menu`, `loading`, `gameplay`, `photo_mode`, `character_menu`, `menu`, `paused` …), save lock, photo state; wait for a phase |
| `game.options.read` | read | The graphics and display settings (every setting of `/graphics/presets`, `advanced`, `raytracing`, `basic`, `performance` and `/video/display`) with a summary: upscaler and mode (DLAA), frame generation, ray and path tracing, SSS quality, HDR, camera effects; and, through the CET layer, the engine's character render options (hair, skin, rim light, eyes, feature toggles; or `names`) |
| `player.appearance` | read | V's creator state; every option and value while the mirror screen is open |
| `photo.state` | read | Photo-mode menu items with keys, ranges, options and current values |
| `photo.subject` | read | V's head (plus an offset) in the world and on screen, the camera's transform, field of view and aspect ratio, V's placement values |
| `photo.open` | write-photo | Presses the player's photo-mode key in the game window (tools side; checks the write gate, the phase and that photo mode is allowed first), then waits for photo mode |
| `photo.enter` | write-photo | Refuses (`photo_key_needed`, pointing at `photo.open`); `route: "quest"` keeps the restricted quest-node route for research |
| `photo.exit` | write-photo | Leave photo mode |
| `photo.camera.set` | write-photo | Named preset and/or photo mode's own camera preset (attribute 23), field of view, roll, focus, aperture, depth of field, autofocus, look-at, film grain, chromatic aberration, V's placement; `reset` |
| `photo.frame` | write-photo | Frames V (eyes, face, head and shoulders) at the window's centre and a set size: an XF camera preset if asked, then measured corrections through `photo.subject` (or, as a coarse fallback, window captures); turns V to face the camera plus a sweep angle; returns the chosen values and an undo |
| `photo.light.set` | write-photo | Light 1–3 on/off, spot or ambient, shadow, brightness, range, cone angles, colour |
| `photo.hud.hide` | write-photo | Fade the photo-mode menu out or in, with the mouse cursor (`cursor: false` leaves it) |
| `photo.expression.set` | write-photo | V's expression by value, as the menu does |
| `photo.expression.index` | write-photo | Research (expression design R2): applies a photo-mode face index straight to the face animation (`AnimFeature_PhotomodeFacial`, then `updateFacialPose`) on V's stand-in or its head item; only indices the expression list offers unless `unlisted: true`; the undo selects the menu's expression again |
| `face.rig.read` | read | Research (expression design R1): the photo-mode head item's (or stand-in's) named components with their facial setup, graph, rig and animation sets, as resource path hashes |
| `cc.open` | write-character | Opens the creator from normal play: refuses in combat, a scene, a vehicle, a menu or where photo mode isn't allowed; takes the save lock and asks only once the game reports saving locked; then the idle menu scenario opens the mirror's scenario (`mode` mirror or ripperdoc, the edit tag that decides which rows can change). Waits for the screen; withdraws a request that never opens. Refused unless `allow_creator_leave = true`; undo `cc.back` |
| `cc.apply` | write-character | One creator option while the creator is open, through the option's own row (its label follows, and the creator's camera moves to that part); the option by name, on-screen label or slot (`piercings_color`), the value by `index` or `value` (name or on-screen label; `5` = `05`; else a unique partial match); never confirms |
| `cc.page` | write-character | Points the open creator's camera at a part of V (skin, hair, eyes, teeth, nose, lips, jaw, head, nails, body, default), as hovering a row does |
| `cc.confirm`, `cc.back` | write-character | The creator's own Confirm (keeps the look) or Back (discards); refused unless `allow_creator_leave = true` (the -writes build) |
| `world.time.set`, `world.pause` | write-world | Set or restore the clock (in normal play or with the creator open); freeze the world (normal play only) |

**Captures** (`tools/capture/`): external captures of the game window through `PrintWindow` (full content) or the screen, so they show what is on screen after ReShade and overlays, 8-bit. `capture.burst` grabs every frame first and writes them afterwards, so encoding doesn't stretch the interval, and refuses a burst that would hold more than 256 MB of pictures. `capture.recrop` accepts only a `.full.png` inside the capture folder: the path is checked as written (no other drive, UNC or device path, or `..`) before anything touches the file system, and again after resolving junctions, and the recrop is written beside it. Crops: pixel or normalised rectangles, or named regions sized in window heights and placed from the window's centre (`full`, `center-16x9`, `head-and-shoulders`, `face`, `eyes`, `cc-eyes`), so they frame the same area on 16:9 and on the 3840×1600 ultrawide. The photo-mode regions (`face`, `eyes`, `head-and-shoulders`, `full-body`) match `photo.frame`'s framings (target at the centre, the framing's span filling the window height); `cc-eyes` is the creator's own eyes zoom, measured from the first session's creator captures. The crop is saved at full resolution (`.full.png`) and an exact area-filter downscale (≤ 1280 px on the long side by default) is returned, with a sidecar JSON of window size, route, crop, scale and hashes. The named camera presets (`tools/api/presets.ts`) are the old fixed guesses; framing depends on where the drone camera spawns, so `photo.frame` replaces them.

**Framing** (`tools/api/framing.ts`): `photo.frame` reads `photo.subject` (the photo-mode stand-in's `Head` slot plus an anatomical offset, and `CameraSystem.ProjectPoint` for the target, the window centre and points 10 cm up and right), works out which screen space the projection uses, turns V to face the camera (a probe tells which way the rotation slider turns), measures the target's movement per unit of left/right and up/down with two small probes (a 2×2 Jacobian, refined with Broyden updates), centres, sets the field of view so the span fills the window height (tan(fov/2) scales with the measured size), centres again and re-checks the facing. If `photo.subject` isn't usable it falls back to window captures: it nudges V by known amounts, finds V's outline in the difference (photo mode stills the world), takes the head from the outline's top and width, measures pixels per unit by correlation and moves the target by fixed proportions (coarse). Both routes record every step. The target offsets are anatomical estimates until a session checks one capture per framing.

**The photo-mode key** (`tools/input/photo-key.ts`): the binding comes from the game's `UserSettings.json` (`/key_bindings/…`, option `photoMode`), or the default `IK_N` when the file or the entry doesn't exist; an unbound or malformed entry, or a settings file that can't be read, is refused rather than guessed. Letters, digits, function keys, the keypad and the navigation keys can be sent (the navigation cluster as extended keys); punctuation keys depend on the keyboard layout and are refused, so the player presses them. `sendinput` (default) brings the game window to the front once, checks the game again (still in the world, photo mode still allowed) and refuses unless the window really is the foreground window, then sends the key's scan code down and up; `postmessage` posts it to the game window only (research). The sender checks the window belongs to the game's process and that the process is `Cyberpunk2077.exe`. Tests run with `XFB_NO_INPUT=1` (the test preload in `bunfig.toml`), which makes the sender refuse, so no test ever presses a key.

## MCP server

A stdio server built on the official MCP TypeScript SDK (1.30.1, MIT). Install once, then register it with the MCP client:

```powershell
cd projects/xf-runtime-bridge
bun install
claude mcp add xf-runtime-bridge -- bun <absolute path to the repository>/projects/xf-runtime-bridge/tools/mcp-server.ts
```

or in a project `.mcp.json`:

```json
{
  "mcpServers": {
    "xf-runtime-bridge": {
      "command": "bun",
      "args": ["projects/xf-runtime-bridge/tools/mcp-server.ts"]
    }
  }
}
```

Tools are the catalogue with dots as underscores (`photo_camera_set`), each described in plain words with its permission and undo note, `annotations.readOnlyHint` set for reads, and `_meta` `xf/command` and `xf/permission`. Options: `--read-only` (read and control tools only) or `--allow read,write-photo,…` (chosen classes; never both, never an empty list; the kill switch is always included), `--no-inline-images` (paths only). While a scripted session runs (its lock file is present), every tool that would use the bridge answers plainly that a session is driving the game; captures still work. `--runtime-dir` and `--capture-hwnd` exist for the tests; `--capture-hwnd` never aims `photo_open`'s key (it counts for keys only while key input is off). While the game isn't running every game tool answers that the bridge isn't running; captures still work on any window of the game. The server keeps the pipe only while commands flow (it closes after 3 s idle), so the CLI and the session runner can connect in between, but not at the same moment.

## Command line

- **Bun:** `bun tools/bridge-client.ts commands [--json]` lists the catalogue; `run <command> [json]` runs one command through the command API (`run photo.camera.set '{"preset":"face"}'`). The raw protocol stays available: `ping | smoke | call <method> [json] | discover | kill`. The pipe is opened through `bun:ffi` (kernel32), not `node:net`, so that the two checks below are possible.
- **PowerShell 7:** `pwsh -File tools/bridge-client.ps1 ping | smoke | call <method> | discover | kill` (raw protocol only).
- **Both clients** open the pipe at the Identification impersonation level and check that the pipe's server process matches `session.json`'s `pid` before sending the token (exit code 3 if not). `--runtime-dir` / `-RuntimeDir` exist for the self-test only.

## Scripted sessions

`bun tools/session.ts <script.json> [--dry-run] [--out <dir>] [--from <label>] [--until <label>]` runs a JSON script (`xfb/session-script-1`) through the command API: steps `set camera`, `set light`, `apply cc`, `frame`, `capture`, `burst`, `wait`, `note`, `ask` (optionally with `replaced_by`, the command expected to take the step over later, shown in dry runs and the manifest) and `run` (any catalogue command), with `continue_on_error`, `expect_error` and a `restore` list that runs once at the end, after a failure, an unexpected error or Ctrl+C (the first Ctrl+C ends the current wait, ask or `game.wait` and runs `restore`; a second quits at once). While it runs, the runner holds an advisory lock (`session-runner.lock` beside `session.json`; a lock whose process has gone, judged by PID and the process's start time, is ignored and taken over safely), so a second runner refuses to start and the MCP server stays off the bridge; its refusal names the lock file. `bridge_kill` still works during a session: while the runner holds the pipe, the command API writes the `KILL` file instead. An *ask* is something only the player can do or judge: interactively the runner waits for Enter; run by a harness it stops cleanly there and prints the `--from` label that continues. Each run appends to the report folder's `manifest.json` (`xfb/session-report-2`) with inputs, results, undo notes, timings and screenshots. Scripts: [`tools/sessions/session-2.json`](tools/sessions/session-2.json) (the parts of the [session 2 card](../../experiments/020-session-2/README.md) still open) and [`session-3.json`](tools/sessions/session-3.json) ([session 3 card](../../experiments/022-session-3/README.md)), generated by `tools/sessions/make-sessions.py`. Per preset: the bridge opens the creator (`cc.open`; a note and `game.wait` cover a refusal), sets the XF row, points the creator's camera at the eyes (`cc.page`), photographs that zoom and presses Confirm, opens photo mode with `photo.open`, turns off grain and aberration, switches light 1 on, frames with `photo.frame` (XF preset, then fine adjustment), hides the menu and cursor, captures, sweeps the light by turning V with look-at off, and leaves. Notes cover the fallbacks (open the creator, press Confirm, press the photo-mode key) while `game.wait` waits. Vanilla rows (piercings and their colours, eye colour, eye shape, hairstyle, face cyberware) are set by the bridge through `cc.apply` by label or colour name, in the ripperdoc mode where the row needs it; the preflight records the graphics settings with `game.options.read` instead of asking for them.

## Build and check

Needs Visual Studio 2022 (MSVC 14.43), CMake 4.0.1 and Bun 1.4.2. The native dependencies are fetched and pinned: RED4ext.SDK tag `1.0.0` and nlohmann/json 3.12.0 (release tarball, SHA-256 pinned). The tools' dependencies are pinned in `package.json` / `bun.lock`.

```powershell
# from projects/xf-runtime-bridge; add -DXFB_RED4EXT_SDK_GIT=D:/Dev/RED4ext.SDK to clone the SDK from a local checkout
cmake -S native -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
bun install

bun tools/selftest.ts                                  # the bridge core through every client (in-process unit checks included)
bun test tools                                         # from this folder (bunfig.toml's preload switches key input off)
bunx tsc --noEmit
bun tools/lint-redscript.ts --bundle <COPY of r6/cache/final.redscripts>
bun tools/lint-lua.ts
bun tools/package.ts                                   # three zips in dist/ (see below)
```

- **Unit checks** (`xfb_selftest --unit`) include `cc.open`'s parameters and sequence (prepare, settle, ask, wait; the withdrawn request on a timeout; nothing asked after a refusal), `cc.page`'s slots, `cc.apply` by value, `game.options.read`'s parameters and the render-option exchange with the CET layer (answers checked, withdrawn, and released by the kill switch), the caller frame's parameter code for game calls (`core/ScriptFrame.cpp`, byte for byte as CET writes it), the engine-address check made at load, `face.rig.read`'s and `photo.expression.index`'s parameters and the face index's undo, the partial `photo.camera.set {reset: true}`, the light's on/type/shadow keys and their undo, the menu-and-cursor undo, the camera preset, grain and aberration keys, `photo.enter`'s refusal and research route, and the `allow_creator_leave` gate.
- **Self-test:** `xfb_selftest.exe` hosts the same core with a simulated game thread and simulated versions of every phase-2 method (same parameter checks, `core/Params.cpp`, and the same write logic, `core/Writes.cpp`: undo values, the light sequence, the kill switch's once-only restore), plus `selftest.phase` to switch the simulated phase (and, with `creator_opens: false`, a creator request the menu never picks up), `--write-classes` for the per-class write gate and `--no-cet` for a missing CET layer; a simulated CET layer answers render-option requests from the pump loop. Through the Bun library and both command-line clients it checks the token, allowlist, write gate and rate limit; message size, the nesting limit and `id` echoing; dropping a client after five rejected requests; game-thread marshalling and `timeout_after_start`; invalid UTF-8; reconnects, the kill method and `KILL` file, the restore after a kill (once after a write, never without one), the write-class gate, the cursor given back after an idle disconnect (`--idle-seconds`), and a bounded stop with a client that never reads; the PID check; that the token never reaches the log; and the CLI's `run` path.
- **Tests (`bun test tools`):** the catalogue's invariants; the MCP server driven by the SDK's own client against the self-test host (tools list, reads, refused writes with plain text, each write's undo values, phase refusals, `cc.apply` at a simulated mirror (by index and by value), `cc.open` (opened, already open, refused outside normal play or without `allow_creator_leave`, withdrawn on a timeout), `cc.page`, the clock with the creator open, `game.options.read` with and without the CET layer, the kill switch, `--read-only`, `--allow` lists and conflicting flags, the session lock, no-bridge wording, capture images) and against synthetic 3840×1600 and 1920×1080 windows (`tools/test/synthetic-window.ps1`, off-screen); the session runner (script checks, pauses at asks, `--from`, restore, `game.wait`, Ctrl+C, the lock, a reused PID, `bridge.kill` through the `KILL` file while the pipe is busy, `frame` and `burst` steps, `replaced_by`); capture, crop, downscale and PNG round trips, and `recrop`'s folder restriction (another drive, UNC and device paths, `..`, junctions); `photo.frame` against simulated worlds (both routes, all three screen spaces, position, span and sweep angle) and the self-test host's simulated camera; `photo.open`'s gate, phase refusals, the last-moment re-check and a fake key sender; `face.rig.read` and `photo.expression.index` against the simulated face; the key binding and its refusals, key codes, extended keys and the `INPUT` record; what each package carries (`tools/packaging.ts`, staged with a stand-in DLL); `capture.burst` timings and differences. The screen-route capture test needs the synthetic window on top of the desktop and fails when something covers it.
- **Packaging:** each build writes `XFB_BUILD=<commit>;dirty=<0|1>` into the DLL; `package.ts` refuses a dirty project tree or a DLL not built cleanly from `HEAD`, and the manifest records the commit. What each variant carries is `tools/packaging.ts`, which the package test stages. It writes `xf-runtime-bridge-<v>.zip` (bridge off), `-diagnostic.zip` (on, read-only) and `-writes.zip` (on, `allow_writes = true` with all three write classes, for the dedicated test profile only; its config says so). Each carries `THIRD_PARTY_NOTICES.txt` (nlohmann/json and RED4ext.SDK, both MIT).
- **Lint tools:** the official `redscript-cli` 0.5.31 (it exits 0 on errors, so the wrapper fails on any `ERROR` line; it does not check `@wrapMethod` parameter lists for `cb` methods); `luaparse` 0.3.1 with the LuaJIT grammar plus CET-specific checks. Locations: [docs/toolchain.md](../../docs/toolchain.md).
- **`dist/`, `build/`, `captures/` and `logs/` are ignored.** Nothing is ever installed: zips are staged into a dedicated MO2 profile only when a session is prepared.

## Logs

The plugin log is `red4ext/logs/xfruntimebridge-<timestamp>.log`; under MO2 it is in `overwrite/`. RED4ext rotates and bounds it. Redscript and CET write into it too through `XFBridge_Log`, with `layer=redscript|cet`. Line format: `sid=… lvl=… layer=… cid=… evt=… key=value …`. `tools/capture_session.py` collects it with the CET mod log. [Design §5](../../research/runtime/runtime-bridge-design.md#5-logging) lists every location. The tools' own audit trail is `logs/commands-<day>.jsonl`.

## Configuration

`red4ext/plugins/XFRuntimeBridge/config.ini`:

| Key | Default |
|---|---|
| `[bridge] enabled` | `false` |
| `allow_writes` | `false` |
| `allow_write_classes` | `photo, world, character` (checked after `allow_writes`; empty allows none) |
| `allow_creator_leave` | `false` (`cc.open`, `cc.confirm` and `cc.back`; `true` only in the -writes build) |
| `request_timeout_ms` | 2000 |
| `max_requests_per_second` | 20 |
| `idle_disconnect_seconds` | 120 (a client silent this long is dropped, and a mouse cursor the bridge hid comes back) |
| `[log] level` | `debug` |

The diagnostic zip differs from the default in `enabled = true` and the XF camera presets file; the writes zip also sets `allow_writes = true`, keeps all three write classes and sets `allow_creator_leave = true`.

## Versions

Built for game 2.31 (file version `3.0.80.51928`). Target frameworks: RED4ext 1.30.0, redscript 0.5.31, CET 1.37.1; optionally TweakXL 1.11.4 (data marker, and the test profile's camera presets) and Codeware 1.20.5 (`photo.enter`'s research route only). The plugin declares runtime 2.31, so RED4ext skips it with a clear warning after a game patch until it is rebuilt.

## Future

- **MCP as an optional XF Studio capability** ([AI integration](../../research/backlog/ai-integration-mcp.md)): `createMcpServer(api, {allow})` has no transport attached, so the desktop app can host the same tools (for example over the SDK's Streamable HTTP transport on loopback with a token) behind an off-by-default switch. The tool text is already user-facing, permissions are data for a consent screen, and the three layers (catalogue, command API, frontends) stay as they are. Before in-app hosting, capture results should report paths relative to the capture folder rather than absolute paths.
- **Studio tools** would join the same catalogue through the Studio's typed actions and capabilities.
- From the [bridge autonomy backlog](../../research/backlog/bridge-autonomy.md): a spawned key light that can move for real light sweeps, reading and placing the photo-mode camera entity, a fixed studio spot (teleport), and short video captures.
