# Current state

Last reviewed **25 September 2026** by Claude (coordinator from 25 September; previously GPT-6). This page states current truth. Update it in place; don't prepend dated entries. The previous append-only log (23–25 September) is archived at [history/status-log-2026-09.md](history/status-log-2026-09.md), and the ranked work queue is the [backlog](../research/backlog/README.md).

## Summary

XF Studio's eye-makeup editor works as a local prototype and can build verified private mod candidates. **Nothing has been seen in the game yet.** The first in-game smoke test is prepared and waiting for the maintainer to run it. The long-requested brow, lash and hair colour fidelity is traced offline but unfinished. Two research directives, the game shader/material system and the character-customisation file chain, were never properly started and now form the core of the R&D lab.

## What works (verified in code and tests)

| Area | State |
|---|---|
| **Editor** | Head and UV surface editing. Variable layer stacks and presets with rename, copy, reorder and recovery. Bézier/corner paths, directional softness, multiple warp fields, whole-shape transforms, UV zoom/pan, whole-gesture Undo, and a persistent `?verify=1` isolated workspace. New recipes are `xfs/recipe-7`. See the [editor invariants](../research/authoring/editor-invariants.md). |
| **UI** | New dock/panel workspace (`studio-main.ts`), delivered 24 September and built by Claude under the previous coordinator. Its three audit defects are fixed. The maintainer's cursory review is positive; an in-depth review is pending. The legacy shell remains at `/legacy.html` until the new UI is accepted after that review. |
| **Preview** | Deforming head and plate with the real default creator idle (pause and head/facial subsets), saved-V import (five facial morphs, eye shape), approximate saved brows, lashes and hair (MELUMINARY/AshBrown), vanilla and PRC piercings, preview quality presets and experimental finish looks. |
| **Library** | Local SQLite (`bun:sqlite`) with immutable collection and preset versions, and portable recipe and collection files. |
| **Packaging** | Check reports unsupported details. Build produces an independently verified private candidate for **Matte, Satin and Metallic** and omits other finishes with reporting. See the [pipeline guide](../research/authoring/studio-to-mod-pipeline.md). |
| **Desktop** | Electrobun trial: first-run setup, UV-only mode without assets, asset intake, Check/Build and workspace persistence across restarts are accepted in installed canaries. Unsigned, with the updater disabled and no public release. See the [desktop README](../projects/xf-studio/authoring/desktop/README.md). |
| **Site** | Public GitHub Pages site and style guide, **live** at https://axefrog.github.io/xf-studio/ and deployed from `main` by CI. It says there is no release or download yet. |
| **Checks** | 448 Studio and desktop tests, both typechecks, site tests and site build/check all pass (25 September). |

## Proven only offline or not at all

Offline verification is not in-game proof. None of the following has runtime evidence:

- ArchiveXL registration of the single makeup selector, preset switching and clearing, finish appearance under game lighting, and save persistence.
- Whether the expanded plate's remaining eyelid contacts are visible in game. Many offline correction candidates were rejected; see experiments [006](../experiments/006-plate-clearance/README.md) and [012](../experiments/012-native-plate-bootstrap/README.md).
- Brow, lash and hair colour and shading parity, and which installed archive wins for the saved brown-lash profile.
- Any Shimmer, Glitter, Glossy or Colour-shifting game material. Export of these stays guarded.

## Waiting on the maintainer

1. **First in-game smoke test.** Selector, Off/Matte/Metallic/(Satin) switching, finish look, clearing and persistence, plus matched brow/lash captures for the colour work. Follow the [single-session card](../research/authoring/first-makeup-runtime-preflight-2026-09-25.md). It needs a recoverable test save, because the diagnostic MO2 profile doesn't isolate saves.
2. **In-depth review of the new UI**, after which the legacy shell can be retired.

## Active direction

Product and R&D run in parallel, like a commercial team beside a research lab:

- **Product tracks:** first game smoke test; brow, lash and hair colours; rendering every character detail in the viewport; CC controls so work can be checked on other characters (later: save write-back and shareable CC presets); remaining finish adapters.
- **R&D lab:** the game's material and shader system, and the character-customisation file chain (mining the legacy xf-omega code and the Modding Docs screenshots). Findings are distilled into the agent-facing [knowledge base](../knowledge/README.md).
- **Desktop app and public site (standing request):** the Pages site is live at https://axefrog.github.io/xf-studio/. The desktop app needs signing, a release channel, a signed updater and a clean-machine first run before it can be published.
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
