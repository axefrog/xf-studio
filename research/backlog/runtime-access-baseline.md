# Runtime access baseline (R&D)

**Status: phase 2 built and tested offline (command catalogue, MCP server, CLI, session runner, captures, writes behind `allow_writes`); first game session prepared, not run.** The code is in [`projects/xf-runtime-bridge`](../../projects/xf-runtime-bridge/README.md), the design and citations in [runtime bridge design](../runtime/runtime-bridge-design.md), the consolidated answers in [knowledge/runtime-access.md](../../knowledge/runtime-access.md), and the session in the [test card](../runtime/runtime-bridge-test-card.md).

## Goal

Prove that agents can build, load and debug each kind of Cyberpunk 2077 mod the project will need. Establish a live bridge so that agents in the development harness can **read live game state and change it while the maintainer plays**, with the maintainer supervising. Later work such as body customisation, world integration and quest tooling builds on this capability. It also turns many "needs an in-game test" questions into quick live queries. The widened goal is agent-driven in-game tests with minimal hand-holding; see the [capability matrix and phase-2 plan](../runtime/runtime-bridge-design.md#7-autonomy-capability-matrix).

## Done (offline)

- **Base mods, one per type, heavily logged:**
  - **RED4ext C++ plugin:** SDK 1.0.0, game states, five global natives, RTTI calls on the main thread.
  - **redscript:** a `ScriptableSystem`, `@wrapMethod`/`@addMethod`, and a query the plugin calls back.
  - **CET Lua:** events, native calls, a kill-switch hotkey and a status label.
  - **TweakXL:** a data-layer marker.
  - No ArchiveXL stub, because XF Eye Artistry already exercises ArchiveXL.
- **Local bridge:**
  - A named pipe from the plugin, off by default, using a per-session token.
  - An allowlist with a write gate, a rate limit, a kill switch and an audit log with correlation IDs.
  - A self-test through the real client covers 26 checks.
  - Bun and PowerShell clients.
- **Offline checks:**
  - The plugin builds cleanly with `/W4`.
  - The redscript layer lints against the game's script bundle, and the Lua layer parses.
- **Package:** install-layout zips (default, diagnostic and `-writes` for the test profile) are written to the ignored `dist/`. Nothing is installed.
- **Phase 2:** one command catalogue behind a stdio MCP server, the CLI and a JSON session runner; external window capture with region crops and downscaling; photo-mode, mirror-screen and clock writes with undo, a save lock and restore on kill; scripts for sessions 2 and 3. See the [project README](../../projects/xf-runtime-bridge/README.md).
- **Logs:** `tools/capture_session.py` also collects the bridge's logs.

## Next

1. Run the [first-session test card](../runtime/runtime-bridge-test-card.md) in the test profile, then session 2 through the bridge; turn the design's unverified rows into runtime evidence and calibrate the camera presets.
2. Take a fresh 2.31 RTTI dump (RTTIDumper) to re-check every signature in the capability matrix.
3. Later reads and writes: camera transform, save list, session-ready events, weather, teleport and a fixed camera, with an optional ReShade before-effects capture add-on; then the automated finish-board session.
4. Host the MCP module in the desktop app ([AI integration](ai-integration-mcp.md)).

## Constraints

- **The maintainer launches the game; agents never do** (unless the maintainer later decides otherwise). Every session is prepared with a checklist. Each base mod is isolated in its own MO2 profile or mod entry.
- **Framework versions:** target current stable framework releases. Record source, installed and runtime-log versions separately.
- **Branding:** the mod is named **XF Runtime Bridge**.
- **Game impact:** nothing may save or modify saves unless a test requires it, and then only on a disposable test save. No online, achievement or telemetry calls, ever.

## Decisions for the maintainer

These are listed in [design §9](../runtime/runtime-bridge-design.md#9-maintainer-decisions):
- whether the bridge is enabled by default;
- where the session file lives;
- whether agents may launch the game;
- whether ReShade becomes an optional capture dependency;
- which write actions phase 2 may have.
