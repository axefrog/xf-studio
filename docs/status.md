# Current state

Last reviewed **25 September 2026** by Claude (coordinator from 25 September; previously GPT-6). This page states current truth. Update it in place; don't prepend dated entries. The previous append-only log (23–25 September) is archived at [history/status-log-2026-09.md](history/status-log-2026-09.md), and the ranked work queue is the [backlog](../research/backlog/README.md).

## Summary

XF Studio's eye-makeup editor works as a local prototype. Its Build derives the expanded eye plate from the player's own game and produces a verified **XF Eye Artistry** mod. **Nothing has been seen in the game yet.** The six-board finish test package is staged in MO2 for the maintainer's first in-game test. Brow, lash and hair colours in the preview now follow the game's decoded hair shader, pending in-game calibration. The first public alpha (MIT-licensed) is in release readiness. The R&D lab has Draft knowledge pages on materials/shaders, hair shading and the character-customisation file chain, plus tooling that decompiles game shaders into named HLSL.

## What works (verified in code and tests)

| Area | State |
|---|---|
| **Editor** | Head and UV surface editing. Variable layer stacks and presets with rename, copy, reorder and recovery. Bézier/corner paths, directional softness, multiple warp fields, whole-shape transforms, UV zoom/pan, whole-gesture Undo, and a persistent `?verify=1` isolated workspace. New recipes are `xfs/recipe-7`. See the [editor invariants](../research/authoring/editor-invariants.md). |
| **UI** | Dock/panel workspace (`studio-ui/`, started by the one composition root `studio-startup.ts` on localhost and desktop), delivered 24 September and built by Claude under the previous coordinator. Its three audit defects are fixed. It has a History panel (click any step to undo or redo to it, with named Undo/Redo tooltips), a UV map that fills its panel with floating non-shifting hints, and right-click menus that show only actionable sections. The maintainer's cursory review is positive; an in-depth review is pending. The legacy sidebar shell was retired on 25 September (no legacy code paths in an alpha; older saved data still loads). |
| **Preview** | Head, eye plate and eyes derived only from the player's own game files (both hosts prepare them with a progress card); deforming head and plate with the real default creator idle (pause and head/facial subsets), saved-V import (five facial morphs, eye shape), saved brows, lashes and hair shaded with the game's decoded hair-shader colour model and light (Karis-style lobes with the game's vanilla hair options from a third-party list; profile colour space still a hypothesis, awaiting a controlled capture), vanilla and PRC piercings, preview quality presets and experimental finish looks. |
| **Library** | Local SQLite (`bun:sqlite`) with immutable collection and preset versions, and portable recipe and collection files. |
| **Packaging** | Check reports unsupported details. Build produces an independently verified **XF Eye Artistry** candidate for **Matte, Satin and Metallic**, plus **experimental** game-matched **Glossy** (single lobe), **Shimmer** (facet normals) and **Colour-shifting** (Fresnel tint, one pigment per preset); Glitter and earlier-model layers are omitted with reporting ([finish designs](../research/materials/finish-designs/README.md)). The expanded eye plate is derived automatically from the installed 2.31 game (byte-exact to the game head) and cached. Build no longer needs Python: it runs entirely in TypeScript, and its unpacked resources are byte-identical to the retired Python builder's on both test collections. Game and MO2 installs are auto-detected, and MO2 precedence follows MO2's own rules. See the [pipeline guide](../research/authoring/studio-to-mod-pipeline.md). |
| **Desktop** | Electrobun app with a tag-driven CI release pipeline (draft pre-releases, checksums, attestation), a hand-written changelog and a unified XF icon. Installed canaries work on the development machine. An unattended clean-machine (Windows Sandbox) first run passes, including the one-click WebView2 install when the runtime is missing. First run now leads a community user from the game folder through a consented, hash-pinned WolvenKit download (with .NET guidance) to a prepared 3D head, and every step can be re-opened, retried or recovered from the head pane. Unsigned alphas; updater disabled. See the [desktop README](../projects/xf-studio/authoring/desktop/README.md). |
| **Site** | Public GitHub Pages site and style guide, **live** at https://axefrog.github.io/xf-studio/ and deployed from `main` by CI. It says there is no release or download yet. |
| **Checks** | 788 Studio tests pass with 5 opt-in real-install tests skipped, 61 desktop tests pass, both typechecks, the browser build, site verify and the Markdown link check pass (25 September, `ecb4b33`). Linux CI had failed since `10c3bdd` on one Windows-path test in the .NET probe; fixed in `ecb4b33`. The deep review at `19bf84c`/`524a575` is complete and its alpha blockers are fixed; a release-trigger review is running before the `v0.1.0-alpha.1` tag. See the [code-health ledger](../research/authoring/code-health.md). |

## Proven only offline or not at all

Offline verification is not in-game proof. None of the following has runtime evidence:

- ArchiveXL registration of the single makeup selector, preset switching and clearing, finish appearance under game lighting, and save persistence.
- Whether the expanded plate's remaining eyelid contacts are visible in game. Many offline correction candidates were rejected; see experiments [006](../experiments/006-plate-clearance/README.md) and [012](../experiments/012-native-plate-bootstrap/README.md).
- Brow, lash and hair colour and shading parity (the preview model is decoded from compiled shaders, but light tuning and profile colour space are hypotheses), and which installed archive wins for the saved brown-lash profile.
- Any Glossy, Shimmer or Colour-shifting game material: they export experimentally but nobody has seen them in game. The [finish board](../experiments/016-finish-board/README.md) is built for that session (not installed). Glitter export stays guarded.

## Waiting on the maintainer

1. **First in-game test.** The [finish board](../experiments/016-finish-board/README.md) is staged in the test profile: selector, Off and board switching and clearing, flat finishes (Matte, Satin, Metallic, experimental Glossy), Shimmer, Colour-shifting against its control, blend steps and a metalness ramp, eyelid contact, save persistence, plus brow/lash/hair captures for colour calibration. See the board's test card and the [validation card](validation.md#prepared-single-session-test-card). It needs a new manual save, because the test profile doesn't isolate saves.
2. **In-depth review of the new UI** (the legacy shell is already retired).

## Active direction

Product and R&D run in parallel, like a commercial team beside a research lab:

- **Product tracks:** first game smoke test; brow, lash and hair colours; rendering every character detail in the viewport; CC controls so work can be checked on other characters (later: save write-back and shareable CC presets); remaining finish adapters.
- **R&D lab:** the game's material and shader system, and the character-customisation file chain (mining the legacy xf-omega code and the Modding Docs screenshots). Findings are distilled into the agent-facing [knowledge base](../knowledge/README.md).
- **Desktop app and public site (standing request):** the Pages site is live at https://axefrog.github.io/xf-studio/. First alpha `v0.1.0-alpha.1` blockers: **the 3D head must work for community users**, derived from their own game install (the maintainer won't share the alpha until it does; WolvenKit is now downloaded on first use with consent and .NET is guided, verified end to end in a fresh data folder on the development PC; an installed-canary run is next), a clean-machine Sandbox first run with one-click WebView2 setup, then the maintainer's go to publish. Build no longer needs Python. Signing (SignPath) comes after the first alpha.
- **Paused pending in-game evidence:** plate clearance and native eye assembly.

See the [ranked backlog](../research/backlog/README.md) for owners and details, and [AGENTS.md](../AGENTS.md) for the standing rules.

## Repository state

- **Branches:** one checkout on `main`. On 25 September the previous coordinator's 126 `codex/*` worktrees and branches were removed after their commits were verified as integrated. Their tips are kept in `local/worktree-archive/codex-branches.bundle`.
- **Private outputs:** outputs that existed only in worktrees (about 7.5 GB) were moved to their canonical ignored locations. The roughly 1 GB of conflicting copies went to `local/worktree-archive/` with a manifest.
- **Future parallel work:** uses `D:/Dev/worktrees/<slug>` on `claude/<slug>` branches, removed after integration.

## Open proof obligations

- Runtime propagation of custom CCXL app names to morph-skinned meshes.
- Single-template mesh fallback in this resource shape.
- Correct normal and morph transfer for the plate topology.
- Deterministic decal stacking.
- Distinct finished material looks in game.
- Large-palette editor and runtime performance.
- Stable IDs and save behaviour.

Each of these needs its named runtime evidence; none may be presented as done without it.
