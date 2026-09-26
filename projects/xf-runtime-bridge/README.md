# XF Runtime Bridge

A set of small, verbosely logged Cyberpunk 2077 base mods, one per mod type, plus a local-only bridge so that XF Studio and its agents can read live game state and, under supervision, change it. It is an R&D project separate from `projects/xf-studio`.

**Status:** phase 2 is built and tested offline: one command catalogue with a stdio MCP server, a command line and a JSON session runner on top, external window capture with crops and downscaling, and write methods for photo mode, the character creator's mirror screen and the world clock, all refused unless `allow_writes = true`. The plugin builds, the bridge core passes its offline self-test through every client, the redscript layer lints against the game's own script bundle and the Lua layer parses. **Nothing has run in the game yet.** The [first-session test card](../../research/runtime/runtime-bridge-test-card.md) (staging checklist, first-session checks, then session 2 through the bridge) is ready. Design, source citations and the capability matrix: [research/runtime/runtime-bridge-design.md](../../research/runtime/runtime-bridge-design.md).

## Layers

| Layer | Folder | Ships to (MO2 mod root) | Does |
|---|---|---|---|
| RED4ext plugin (C++) | `native/` | `red4ext/plugins/XFRuntimeBridge/XFRuntimeBridge.dll` + `config.ini` | Load and unload, game states, five global natives, RTTI calls on the main thread, the named-pipe bridge and its method table |
| redscript | `redscript/` | `red4ext/plugins/XFRuntimeBridge/Scripts/*.reds`, added to compilation by the plugin (`sdk->scripts->Add`) | The game-side actions: game phase, photo-mode menu model and attribute changes, the mirror screen's options, clock and freeze, the save lock; vanilla APIs only |
| CET Lua | `cet/xf_runtime_bridge/` | `bin/x64/plugins/cyber_engine_tweaks/mods/xf_runtime_bridge/init.lua` | Events, a kill-switch hotkey, an always-visible status label (green read-only, amber writes on, red killed) |
| TweakXL data | `tweaks/` | `r6/tweaks/XFRuntimeBridge/xf_runtime_bridge.yaml` | One TweakDB flat confirming the data layer loaded |
| Tools (Bun/TypeScript) | `tools/` | nothing (development side) | The command catalogue and API, MCP server, CLI, session runner, capture, self-test, packaging |

No ArchiveXL stub: XF Eye Artistry already exercises ArchiveXL. The redscript files ship under the plugin rather than `r6/scripts`: they declare natives that only exist when the DLL loads, so a missing DLL can never break everyone's script compilation (psiberx's plugins, Let There Be Flight and mod_settings ship scripts the same way).

## Bridge in one paragraph

The plugin opens `\\.\pipe\xf-runtime-bridge-<pid>-<random>` only when `[bridge] enabled = true`. The pipe is local only, has a user-only DACL, and takes one client at a time. Each side sends newline-delimited JSON, and every request carries the per-session token published in `%LOCALAPPDATA%\XFStudio\runtime-bridge\session.json`. Only allowlisted methods exist. Write methods are refused unless `allow_writes = true`, each write takes a save lock first, logs `write.done` with its reversal and returns a machine-readable `undo`, and every request and refusal is logged with a correlation ID. Requests are capped at 64 KiB and 32 levels of nesting. A rate limit covers every request, and a connection that sends five malformed or unauthenticated requests is dropped. A kill switch (the CET hotkey, `bridge.kill` or a `KILL` file) stops the bridge until the game restarts and undoes what it left on (a world freeze, a hidden photo-mode menu, the save lock). Game work runs on the main thread from the plugin's Running-state update. Nothing ever saves the game. Methods: [design §3.2](../../research/runtime/runtime-bridge-design.md#32-protocol-1).

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

**Permission classes** are data, ready for a consent screen: `read` (looks, changes nothing), `write-photo` (photo mode only; gone when it closes), `write-world` (clock and freeze), `write-character` (the mirror screen's options), `control` (the kill switch, always allowed). The game-side gate is separate and final: without `allow_writes = true` in the plugin's config every write is refused.

| Command | Class | What it does |
|---|---|---|
| `bridge.ping`, `bridge.info` | read | Connection check; versions, build commit, `allow_writes` |
| `bridge.kill` | control | Switches the bridge off until the game restarts |
| `capture.screenshot`, `capture.recrop` | read | Window capture with a region, preview ≤ 1280 px, full-resolution file on disk; re-crop a saved file |
| `game.status`, `game.wait` | read | Phase (`main_menu`, `loading`, `gameplay`, `photo_mode`, `character_menu`, `menu`, `paused` …), save lock, photo state; wait for a phase |
| `player.appearance` | read | V's creator state; every option and value while the mirror screen is open |
| `photo.state` | read | Photo-mode menu items with keys, ranges, options and current values |
| `photo.enter`, `photo.exit` | write-photo | Open (Codeware quest node) or leave photo mode |
| `photo.camera.set` | write-photo | Named preset and/or field of view, roll, focus, aperture, depth of field, autofocus, look-at, V's placement; `reset` |
| `photo.light.set` | write-photo | Light 1–3 brightness, range, cone angles, colour |
| `photo.hud.hide` | write-photo | Fade the photo-mode menu out or in |
| `photo.expression.set` | write-photo | V's expression by value, as the menu does |
| `cc.apply` | write-character | One creator option while the mirror screen is open; never confirms |
| `world.time.set`, `world.pause` | write-world | Set or restore the clock; freeze the world |

**Captures** (`tools/capture/`): external captures of the game window through `PrintWindow` (full content) or the screen, so they show what is on screen after ReShade and overlays, 8-bit. Crops: pixel or normalised rectangles, or named regions sized in window heights and centred (`full`, `center-16x9`, `head-and-shoulders`, `face`, `eyes`), so they frame the same area on 16:9 and on the 3840×1600 ultrawide. The crop is saved at full resolution (`.full.png`) and an exact area-filter downscale (≤ 1280 px on the long side by default) is returned, with a sidecar JSON of window size, route, crop, scale and hashes. Camera presets (`tools/api/presets.ts`) and region shapes are uncalibrated until the first session.

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

Tools are the catalogue with dots as underscores (`photo_camera_set`), each described in plain words with its permission and undo note, `annotations.readOnlyHint` set for reads, and `_meta` `xf/command` and `xf/permission`. Options: `--read-only` (read and control tools only), `--allow read,write-photo,…` (chosen classes), `--no-inline-images` (paths only). `--runtime-dir` and `--capture-hwnd` exist for the tests. While the game isn't running every game tool answers that the bridge isn't running; captures still work on any window of the game. The server keeps the pipe only while commands flow (it closes after 3 s idle), so the CLI and the session runner can connect in between, but not at the same moment.

## Command line

- **Bun:** `bun tools/bridge-client.ts commands [--json]` lists the catalogue; `run <command> [json]` runs one command through the command API (`run photo.camera.set '{"preset":"face"}'`). The raw protocol stays available: `ping | smoke | call <method> [json] | discover | kill`. The pipe is opened through `bun:ffi` (kernel32), not `node:net`, so that the two checks below are possible.
- **PowerShell 7:** `pwsh -File tools/bridge-client.ps1 ping | smoke | call <method> | discover | kill` (raw protocol only).
- **Both clients** open the pipe at the Identification impersonation level and check that the pipe's server process matches `session.json`'s `pid` before sending the token (exit code 3 if not). `--runtime-dir` / `-RuntimeDir` exist for the self-test only.

## Scripted sessions

`bun tools/session.ts <script.json> [--dry-run] [--out <dir>] [--from <label>] [--until <label>]` runs a JSON script (`xfb/session-script-1`) through the command API: steps `set camera`, `set light`, `apply cc`, `capture`, `wait`, `note`, `ask` and `run` (any catalogue command), with `continue_on_error`, `expect_error` and a `restore` list that runs after a failure. An *ask* is something only the player can do or judge: interactively the runner waits for Enter; run by a harness it stops cleanly there and prints the `--from` label that continues. Each run appends to the report folder's `manifest.json` (`xfb/session-report-2`) with inputs, results, undo notes, timings and screenshots. Scripts: [`tools/sessions/session-2.json`](tools/sessions/session-2.json) ([session 2 card](../../experiments/020-session-2/README.md)) and [`session-3.json`](tools/sessions/session-3.json) ([session 3 card](../../experiments/022-session-3/README.md)), generated by `tools/sessions/make-sessions.py`.

## Build and check

Needs Visual Studio 2022 (MSVC 14.43), CMake 4.0.1 and Bun 1.4.2. The native dependencies are fetched and pinned: RED4ext.SDK tag `1.0.0` and nlohmann/json 3.12.0 (release tarball, SHA-256 pinned). The tools' dependencies are pinned in `package.json` / `bun.lock`.

```powershell
# from projects/xf-runtime-bridge; add -DXFB_RED4EXT_SDK_GIT=D:/Dev/RED4ext.SDK to clone the SDK from a local checkout
cmake -S native -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
bun install

bun tools/selftest.ts                                  # the bridge core through every client (in-process unit checks included)
bun test tools                                         # catalogue, MCP end to end, session runner, capture
bunx tsc --noEmit
bun tools/lint-redscript.ts --bundle <COPY of r6/cache/final.redscripts>
bun tools/lint-lua.ts
bun tools/package.ts                                   # three zips in dist/ (see below)
```

- **Self-test:** `xfb_selftest.exe` hosts the same core with a simulated game thread and simulated versions of every phase-2 method (same parameter checks, `core/Params.cpp`), plus `selftest.phase` to switch the simulated phase. Through the Bun library and both command-line clients it checks the token, allowlist, write gate and rate limit; message size, the nesting limit and `id` echoing; dropping a client after five rejected requests; game-thread marshalling and `timeout_after_start`; invalid UTF-8; reconnects, the kill method and `KILL` file, and a bounded stop with a client that never reads; the PID check; that the token never reaches the log; and the CLI's `run` path.
- **Tests (`bun test tools`):** the catalogue's invariants; the MCP server driven by the SDK's own client against the self-test host (tools list, reads, refused writes with plain text, each write's undo, phase refusals, `cc.apply` at a simulated mirror, the kill switch, `--read-only`, no-bridge wording, capture images) and against synthetic 3840×1600 and 1920×1080 windows (`tools/test/synthetic-window.ps1`, off-screen); the session runner (script checks, pauses at asks, `--from`, restore, `game.wait`); capture, crop, downscale and PNG round trips.
- **Packaging:** each build writes `XFB_BUILD=<commit>;dirty=<0|1>` into the DLL; `package.ts` refuses a dirty project tree or a DLL not built cleanly from `HEAD`, and the manifest records the commit. It writes `xf-runtime-bridge-<v>.zip` (bridge off), `-diagnostic.zip` (on, read-only) and `-writes.zip` (on, `allow_writes = true`, for the dedicated test profile only; its config says so). Each carries `THIRD_PARTY_NOTICES.txt` (nlohmann/json and RED4ext.SDK, both MIT).
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
| `request_timeout_ms` | 2000 |
| `max_requests_per_second` | 20 |
| `idle_disconnect_seconds` | 120 |
| `[log] level` | `debug` |

The diagnostic zip differs from the default only in `enabled = true`; the writes zip also sets `allow_writes = true`.

## Versions

Built for game 2.31 (file version `3.0.80.51928`). Target frameworks: RED4ext 1.30.0, redscript 0.5.31, CET 1.37.1; optionally TweakXL 1.11.4 (data marker) and Codeware 1.20.5 (`photo.enter` only). The plugin declares runtime 2.31, so RED4ext skips it with a clear warning after a game patch until it is rebuilt.

## Future

- **MCP as an optional XF Studio capability** ([AI integration](../../research/backlog/ai-integration-mcp.md)): `createMcpServer(api, {allow})` has no transport attached, so the desktop app can host the same tools (for example over the SDK's Streamable HTTP transport on loopback with a token) behind an off-by-default switch. The tool text is already user-facing, permissions are data for a consent screen, and the three layers (catalogue, command API, frontends) stay as they are. Before in-app hosting, capture results should report paths relative to the capture folder rather than absolute paths.
- **Studio tools** would join the same catalogue through the Studio's typed actions and capabilities.
- Once the first session calibrates them: camera presets, region shapes, the photo-mode keys for lights on/off, film grain and chromatic aberration.
