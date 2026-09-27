# XF Core architecture (work in progress)

**Status: WIP draft (27 September 2026), design only; nothing built, nothing published.** This page will hold the architecture for XF Core (working name): one runtime base mod promoted from the [runtime bridge](../../projects/xf-runtime-bridge/README.md), plus XF-branded plugin mods that depend on it through a versioned API. First plugins: XF Photo Mode (the successor to Photo Mode Tools) and XF Lighting (the [lighting mirror](lighting-mirror-design.md)). What follows are the findings and recommendations reached so far. Diagrams, the full phase plan and the maintainer decision table are still to be written.

## Source findings this design rests on

| Finding | Why it matters | Grade |
|---|---|---|
| RED4ext loads DLLs only from `red4ext/plugins/<dir>/` and its direct files. It skips anything deeper, and ignores a folder that holds no DLL | A plugin folder with no DLL (a manifest and scripts) sits beside RED4ext plugins harmlessly. A native part in `red4ext/plugins/<Plugin>/native/` is not loaded by RED4ext, so only the core can load it, after its own checks | [source] RED4ext v1.30.0 `PluginSystem.cpp` (depth > 1 skipped) |
| `sdk->scripts->Add` accepts an absolute path, or a path relative to the calling plugin's folder | The core can add each accepted plugin's `.reds` folder to compilation. Plugin scripts then compile only when the core is present and has accepted the plugin, so a plugin whose core is missing or incompatible can't break compilation | [source] RED4ext v1.30.0 `ScriptCompilationSystem.cpp:101-134` |
| When redscript fails to compile, the game starts with no scripts in effect: every mod's scripts, not just the broken one | One bad plugin script disables all redscript mods for that session. The core should notice (its own script layer never announces itself) and, on the next launch, hold back the plugins that changed since the last good compile. It can attribute the failure from the redscript log where possible | [source] redscript v0.5.31 `scc/lib/src/lib.rs` (the popup text); holding back is a design proposal |
| CET runs each mod in its own sandboxed context. A mod reaches another mod's exported table through `GetMod(name)` | Plugin CET parts are isolated from each other by construction, and they reach the core's overlay framework through `GetMod("xf_core")` from `onInit` | [source] CET v1.37.1 `ScriptStore.cpp`, `Scripting.cpp:433` |
| CET stores hotkey bindings in `bindings.json` in its own folder, keyed by the mod's folder name and the hotkey id. By default it deletes a mod's bindings once that mod's folder is gone | The legacy Photo Mode Tools stores nothing else: its only settings are the bindings `photo_mode_tools` / `freeze` and `restore`. If the successor keeps the CET folder name and those hotkey ids, players keep their keys. A same-named folder also means only one `init.lua` runs, so the old global LookAt callbacks can never run beside the new mod | [source] CET v1.37.1 `Paths.cpp:76`, `VKBindings.cpp` (`RemoveDeadBindings`) |
| The legacy mod sets `LookAt/MaxIterationsCount` globally: 1.0 at start-up, 0.9/1.0 on freeze, and a hard-coded 3.0 on restore and shutdown. It never records the original value and never restores it on photo-mode exit. AMM changes the same option | The rebuilt freeze must not repeat this. Preferred route: freeze only the photo-mode puppet with `TimeDilationHelper.SetIndividualTimeDilation` (AMM, Photo Mode Pose Selector) [source; effect on the look-at turn is a hypothesis]. Fallback: the global option, recorded at the moment of freezing and restored on unfreeze, on photo-mode exit, by the kill switch and at shutdown, and only while the value is still the one we set. The real default needs one in-game read on a clean launch | legacy `init.lua`; [knowledge/photo-mode.md §8.2](../../knowledge/photo-mode.md#82-world-npcs-and-v) |
| The Studio's install host already places one XF mod with a consented plan: MO2 placement that respects separator sections, receipts and backups, refusal while MO2 or the game runs, Vortex attribution, and direct `archive\pc\mod` | XF Core and its plugins extend this host rather than getting a new installer. It needs multi-mod plans, the `red4ext`, `r6` and CET paths on the direct route, Vortex `--install-archive` per mod, and a placement choice for the core (a framework section or not) | [projects/xf-studio/authoring/src/mod-install-host.ts](../../projects/xf-studio/authoring/src/mod-install-host.ts), [knowledge/vortex.md](../../knowledge/vortex.md) |
| The desktop release workflow triggers on `v*` tags | Mod releases need namespaced tags (`xf-core-v…`, `xf-photo-mode-v…`) so that they never start a Studio release | [desktop release decisions](../authoring/desktop-release-decisions.md) |

## Recommendations so far

1. **Boundaries.**
   - **XF Core:** the native link (pipe, session, token, kill switch and re-arm, dispatcher, write gate, save lock, audit), the game-thread queue and script-call routine, a plugin host (manifest scan, compatibility, script gating, quarantine, native-part loader), the snapshot store, user settings and consent, framework detection, the core redscript API (`game.status`, logging, undo plumbing) and the CET overlay framework. No game features.
   - **Plugins:** XF Photo Mode (the `photo.*` commands, complete snapshots, the rebuilt freeze), XF Lighting (`lights.*`, the light-host archive; needs Codeware) and XF Lab (test profile only, never published: `cc.*`, `world.*`, the live-pose, face and options research commands, and the camera presets).
   - **The Studio:** the link client (catalogue, command API, MCP, CLI, sessions, capture, framing, the photo-mode key) and installing and updating the mods.
   - "Light host" in the brief is read here as a *lightweight plugin host*. The lighting mirror's light-host entity belongs to XF Lighting.
2. **Plugin API.** Each plugin declares itself in a manifest (`red4ext/plugins/<Plugin>/xf-plugin.json`): id, version, the core API range, required capabilities (`commands@1`, `snapshots@1`, `overlay@1`…), required frameworks, owned command namespaces, and commands with an access class, a JSON Schema and an undo note. The logic is in redscript through one entry point, `Handle(method, params, cid) -> String`. The UI is an optional CET mod that registers panels with the core. An optional native part goes through the core's C ABI. It is loaded by the core, not RED4ext, and is game-version independent when it uses only core services.
   - **Isolation happens in layers:** refusal at load, script gating, quarantine after a failed compile, RTTI checks before each call, bounded results and timeouts, a per-plugin circuit breaker, `pcall` around each overlay panel, per-plugin restore hooks on the kill switch, and per-plugin store namespaces.
   - **A minimal plugin** is a manifest and one `.reds` file.
3. **Runtime layers.**
   - **XF Core:** hard dependencies on RED4ext and redscript. CET is optional (the overlay only). No Codeware, ArchiveXL or TweakXL.
   - **Plugins:** each declares its own dependencies. Frameworks are detected from their DLL version resources, using the same marker table as the Studio's `framework-versions.ts`, and are never installed. Plain guidance for anything missing appears in the overlay, the Studio and a one-time in-game message.
4. **Studio link.**
   - **Unchanged:** protocol 1, the pipe, the security boundary, the token and PID checks, attach-only. Command names stay the same, so session scripts and MCP tools keep working while ownership moves to the plugins. `bridge.hello` adds the API version, capabilities, plugins and consent state.
   - **Two build flavours:** `release` has the research methods compiled out, and the link stays off until the player switches it on in the overlay or consents in the Studio's install plan. `lab` keeps today's config gates.
   - **Proposed release write classes:** `read`, `write-photo` and `write-store`.
5. **Distribution.**
   - **One archive per mod,** with paths relative to the game folder. The Studio bundles the versions it was tested with and installs or updates them through the consented install host. Nexus pages: XF Core, XF Photo Mode (the Photo Mode Tools page, renamed) and XF Lighting.
   - **Versioning:** SemVer for each mod, a separate core API SemVer, and plugins declare a range (`>=1.2 <2`).
   - **Nexus uploads** are done by hand by the maintainer.
6. **Photo Mode Tools transition.**
   - **Nexus page:** the next major version of the page runs on XF Core, and the last standalone version stays as an old file.
   - **Bindings:** keep the `photo_mode_tools` CET folder and the `freeze`/`restore` hotkey ids.
   - **Freeze:** rebuild it as above, with nothing global left behind.
7. **Naming.** XF Core (recommended), XF Runtime or XF Base. Plugins: XF Photo Mode (or XF Photo Mode Tools), XF Lighting, later XF Posing and XF Expressions. XF Lab is internal only.
8. **In-game UI.** One XF window in the CET overlay with a status line and one tab per plugin. A Lua component kit lives in the core, with a theme generated from the Studio's dark tokens and ImGui styles scoped to the XF window only. It shows only actions that are available.
9. **Testing.**
   - **Offline:** extend `xfb_selftest` into a plugin-host harness (manifests, gating, a fake framework table, quarantine, circuit breaker, restore order, store, flavour gates, release-DLL string scan), run the CET Lua in fengari against stubs, and add a redscript compile matrix and packaging layout tests.
   - **Still to write:** the first-release in-game checklist.

## Still to do (resume here)

- Write the full sections: diagrams (architecture, plugin load and gating, distribution; render with Mermaid CLI and inspect), the manifest schema, the C ABI outline, the snapshot store details, the first-release session checklist, the phase plan with effort (all of C1–C5 can be built before any game session), and the maintainer decision table with defaults.
- Update the bridge and Photo Mode Tools READMEs ("proposed"), add the backlog entry, add the source findings above to [knowledge/runtime-access.md](../../knowledge/runtime-access.md) and one-line credits (CET bindings, redscript compile failure, RED4ext discovery depth), then run `check_links.py` and `check_private_paths.py`.
- Flag for the coordinator: AGENTS.md still calls Photo Mode Tools an independent project. That changes only if the maintainer approves this direction.
