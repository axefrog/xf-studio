# Runtime access baseline (R&D)

**Status (25 September 2026): queued.** Early mod R&D, to start when a research slot is free and the first in-game makeup test has run. No implementation yet.

## Goal

Prove that agents can build, load and debug each kind of Cyberpunk 2077 mod the project will need, and establish a live bridge so that agents in the development harness can **read live game state and change it while the maintainer plays**, with the maintainer supervising. This capability underpins later work such as body customisation, world integration and quest tooling. It also turns many "needs an in-game test" questions into quick live queries.

## Scope

1. **Minimal, heavily logged base mods,** one per mod type, each proving build → install → load → observable effect:
   - **RED4ext C++ plugin** (native); see the psiberx repositories in `D:/Dev` (ArchiveXL, TweakXL, Codeware, Photo Mode Ex, Equipment Ex, Red Hot Tools) and `RED4ext.SDK` for current idioms.
   - **redscript** (compiled script, including a `@wrapMethod`/`@addMethod` example).
   - **CET Lua** (Cyber Engine Tweaks: `onInit`, `onUpdate`, overlay, console).
   - **ArchiveXL / TweakXL** declarative resources (YAML/XL) as a data-only baseline.
   - Codeware-based reflection or events where they simplify access.
2. **Logging.** Structured, bounded, timestamped logs from every layer, with versions logged at load. Log files go to known locations the harness can read, and capture uses `tools/capture_session.py` conventions. Verbose by design, but never unbounded per-frame dumping.
3. **A live bridge.** A local-only endpoint the harness can call while the game runs, for example a RED4ext or CET-hosted loopback HTTP/WebSocket server, or a file/named-pipe command queue if sockets are impractical. It needs:
   - **read operations:** player appearance/CC state, position, equipped items, active resources, framework versions;
   - **write operations:** apply a CC choice, toggle an appearance, spawn or preview a resource, run a whitelisted command;
   - **safety:** loopback only, an explicit per-session token, a command allowlist, no arbitrary code execution from the network, and a visible in-game indicator when the bridge is active.
4. **Harness tooling:** a small client (Bun/TypeScript) and documentation so any agent can check the bridge's health, query state and send allowlisted commands, plus a knowledge page, `knowledge/runtime-access.md`.

## Constraints

- **The maintainer launches the game; agents never do.** Every session is prepared with a checklist, and each base mod is isolated in its own MO2 profile or mod entry.
- **Framework versions:** target current stable framework releases and record source, installed and runtime-log versions separately.
- **Branding:** mods are XF-branded (e.g. "XF Bridge"; the final names are to be chosen).
- **Game impact:** nothing may modify saves unless a test requires it, and then only on a disposable test save.

## Deliverables

- `projects/` location for the base mods (to be decided, likely a runtime-tools project), with build scripts and tests where possible.
- `knowledge/runtime-access.md`: how each mod type is built and loaded, logging locations, and the bridge protocol.
- A one-session test card for the maintainer.
