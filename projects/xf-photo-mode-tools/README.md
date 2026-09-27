# XF Photo Mode Tools

**Status:** the standalone Photo Mode Tools is published on Nexus Mods as a small Cyber Engine Tweaks mod. Its successor is proposed and not yet approved or built.

## Proposed direction (27 September 2026)

Photo Mode Tools would be succeeded by **XF Photo Mode** (working name), a plugin on the proposed **XF Core** runtime base promoted from the [XF Runtime Bridge](../xf-runtime-bridge/README.md). The design is in the [XF Core architecture](../../research/runtime/xf-core-architecture.md), and the feature R&D is in the photo-mode snapshots design on the `claude/rnd-photo-slots` branch.

- **Features** (snapshot design: [complete photo-mode snapshots](../../research/runtime/photo-snapshots-design.md), which also covers the look-at freeze plan and the reference mods, including Photo Mode Pose Selector):
  - Complete photo-mode snapshots that restore everything, including modded attribute keys, V's placement and look-at, lights and NPCs. They are kept in XF's own store, never in the game's save slots.
  - The head and eye freeze, rebuilt so that it leaves nothing global behind.
  - An in-game panel in the shared XF overlay.
- **The Nexus page stays the successor's home:** renamed "XF Photo Mode (formerly Photo Mode Tools)", with the next major version (2.0.0) requiring XF Core, and the last standalone version kept under Old files.
- **Bindings carry over:** the old mod stores nothing but its two CET hotkey bindings, keyed by its folder `photo_mode_tools` and the ids `freeze` and `restore`. XF Photo Mode keeps both, so players keep their keys, and only one `init.lua` can exist, so the old script never runs beside the new one.
- **Name, page plan and timing** are among the maintainer's decisions in the architecture page (§11). Until they are approved, AGENTS.md's description of Photo Mode Tools as an independent project stands.

## The standalone mod (legacy reference)

Legacy source: `D:/Dev/xf-photo-mode-tools/bin/x64/plugins/cyber_engine_tweaks/mods/photo_mode_tools/init.lua` (four callbacks).

- It sets the global engine option `LookAt/MaxIterationsCount` to 1.0 on initialisation, toggles 0.9 and 1.0 for the freeze, and writes a hard-coded 3.0 on restore and shutdown.
- The effect covers every character, not just the photo-mode actor.
- It never records the original value and doesn't restore it when photo mode closes. Its README documents the global side effects.

Rebuild from behaviour requirements, not by copying those callbacks. The proposed rebuild tries actor-scoped routes first: a static look-at target on the photo-mode stand-in, photo mode's own head rotation, or the stand-in's individual time dilation. Otherwise it manages the global option through XF Core's settings guard: captured first, changed only while photo mode is open, and restored on exit and every transition while it still holds our value. The route has to stay compatible with Photo Mode Ex, AMM and pose tools, and a hard-coded engine setting is not evidence of a stable public contract.

Useful references: `D:/Dev/cp2077-photomode-ex`, `cp2077-codeware`, `cp2077-cet-kit`, `appearancemenumod`, `CP77_nativeSettings`, and the MO2 photo, pose and camera categories. Saved lighting (through XF Lighting), poses and annotation tools remain later possibilities, not first-release scope.
