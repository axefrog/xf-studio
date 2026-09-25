# XF Runtime Bridge

A set of small, verbosely logged Cyberpunk 2077 base mods, one per mod type, plus a local-only bridge so that XF Studio and its agents can later read live game state and, under supervision, change it. This is the **baseline**: skeletons that build, log and prove the round trip. It adds no features. It is an R&D project separate from `projects/xf-studio`.

**Status:** the native plugin builds, and the bridge core passes an offline self-test through both clients. The redscript layer lints against the game's own script bundle, and the Lua layer parses. **Nothing has run in the game yet.** The [one-session test card](../../research/runtime/runtime-bridge-test-card.md) is ready. The design, with source citations, the capability matrix for agent-driven testing and the phase-2 plan, is in [research/runtime/runtime-bridge-design.md](../../research/runtime/runtime-bridge-design.md).

## Layers

| Layer | Folder | Ships to (MO2 mod root) | Proves |
|---|---|---|---|
| RED4ext plugin (C++) | `native/` | `red4ext/plugins/XFRuntimeBridge/XFRuntimeBridge.dll` + `config.ini` | Load and unload, game-state transitions, five global natives, RTTI calls on the main thread, the named-pipe bridge |
| redscript | `redscript/` | `red4ext/plugins/XFRuntimeBridge/Scripts/*.reds`, added to compilation by the plugin (`sdk->scripts->Add`) | Native calls, a `ScriptableSystem`, `@wrapMethod` and `@addMethod`, a read-only query that the plugin calls back |
| CET Lua | `cet/xf_runtime_bridge/` | `bin/x64/plugins/cyber_engine_tweaks/mods/xf_runtime_bridge/init.lua` | Events, calls into the natives and redscript, a kill-switch hotkey, an always-visible status label |
| TweakXL data | `tweaks/` | `r6/tweaks/XFRuntimeBridge/xf_runtime_bridge.yaml` | One TweakDB flat that redscript reads and reports, confirming the data layer loaded |

No ArchiveXL stub: XF Eye Artistry already exercises ArchiveXL, and a data-only `.xl` here would add nothing observable. The redscript files live under the plugin rather than `r6/scripts`. They declare natives that only exist when the DLL loads, so shipping them through the plugin means a missing DLL can never break everyone's script compilation. psiberx's plugins, Let There Be Flight and mod_settings ship scripts the same way.

## Bridge in one paragraph

The plugin opens `\\.\pipe\xf-runtime-bridge-<pid>-<random>` only when `[bridge] enabled = true`. The pipe is local only, has a user-only DACL, and takes one client at a time. Each side sends newline-delimited JSON, and every request carries the per-session token published in `%LOCALAPPDATA%\XFStudio\runtime-bridge\session.json`. Only allowlisted methods exist. Write methods are refused unless `allow_writes = true`, and every request is logged with a correlation ID. A rate limit applies. A kill switch (the CET hotkey, the `bridge.kill` method or a `KILL` file) stops the bridge until the game restarts. Game work runs on the main thread from the plugin's Running-state update. Methods are listed in the [design §3.2](../../research/runtime/runtime-bridge-design.md#32-protocol-1).

## Build and check

Needs Visual Studio 2022 (MSVC 14.43) and CMake 4.0.1. The two dependencies are fetched and pinned: RED4ext.SDK tag `1.0.0` (the SDK RED4ext 1.30.0 builds against) and nlohmann/json 3.12.0 (release tarball, SHA-256 pinned).

```powershell
# from projects/xf-runtime-bridge; add -DXFB_RED4EXT_SDK_GIT=D:/Dev/RED4ext.SDK to clone the SDK from a local checkout
cmake -S native -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release

bun tools/selftest.ts                                  # 26 offline checks of the bridge core through the real client
bun tools/lint-redscript.ts --bundle <COPY of r6/cache/final.redscripts>
bun tools/lint-lua.ts
bun tools/package.ts                                   # dist/xf-runtime-bridge-<v>.zip (bridge off) and -diagnostic.zip (on, read-only)
```

- **Self-test:** `xfb_selftest.exe` hosts the same core with a simulated game thread. It checks the token, allowlist, write gate, rate limit, message size, game-thread marshalling and errors, reconnects, the kill method and `KILL` file, and that the token never reaches the log.
- **Lint tools:**
  - **redscript:** the official `redscript-cli` 0.5.31. It reports errors but still exits 0, so the wrapper fails on any `ERROR` line. It does **not** check `@wrapMethod` parameter lists for `cb` methods.
  - **Lua:** `luaparse` 0.3.1 with the LuaJIT grammar, plus checks for CET-specific mistakes.
  - Tool locations: [docs/toolchain.md](../../docs/toolchain.md).
- **`dist/` and `build/` are ignored.** Nothing is ever installed: the zips are staged into a dedicated MO2 profile only when a session is prepared.

## Clients

- **Bun:** `bun tools/bridge-client.ts ping | smoke | call <method> [json] | discover | kill`
- **PowerShell 7:** `pwsh -File tools/bridge-client.ps1 ping | smoke | call <method> | discover | kill`. It also checks that the pipe's server process matches `session.json` before it sends the token.
- **External capture:** `pwsh -File tools/capture-window.ps1 -Name <label>` saves a PNG of the game window's client area under the ignored `captures/`. There is no verified in-game screenshot API, so this captures the screen as displayed (after ReShade and overlays). Use it for framing, not colour calibration.

## Logs

The plugin log is `red4ext/logs/xfruntimebridge-<timestamp>.log`; under MO2 it is in `overwrite/`. It is rotated and bounded by RED4ext's own settings. Redscript and CET write into it too through `XFBridge_Log`, with `layer=redscript|cet`. Line format: `sid=… lvl=… layer=… cid=… evt=… key=value …`. `tools/capture_session.py` collects this log and the CET mod log. [Design §5](../../research/runtime/runtime-bridge-design.md#5-logging) lists every log location.

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

The diagnostic zip differs from the default zip only in `enabled = true`.

## Versions

Built for game 2.31 (file version `3.0.80.51928`). Target frameworks: RED4ext 1.30.0, redscript 0.5.31, CET 1.37.1 and, optionally, TweakXL 1.11.4. The plugin declares runtime 2.31, so RED4ext skips it with a clear warning after a game patch until it is rebuilt.
