# Current state

Last reviewed **26 September 2026** by Claude (coordinator from 25 September; previously GPT-6). This page states current truth. Update it in place; don't prepend dated entries. The previous append-only log (23–25 September) is archived at [history/status-log-2026-09.md](history/status-log-2026-09.md), and the ranked work queue is the [backlog](../research/backlog/README.md).

## Summary

XF Studio's eye-makeup editor builds a verified **XF Eye Artistry** mod from the player's own game, and the first public alpha, **`v0.1.0-alpha.1`**, was tagged but stays an unpublished draft: the first published alpha will be **`v0.1.0-alpha.2`**, cut from `main` once the second in-game session confirms the export fixes. The mod **has been seen in game** (25 September): the selector (labelled "XF") appears in the character creator, gameplay and photo mode; switching, clearing and save persistence work; Colour-shifting behaves as designed. Close-up breakup (the plate sat exactly on the skin) is fixed in Build by lifting the plate 0.4 mm like vanilla face decals, and Matte/Satin read too glossy; both await the second session ([experiment 017](../experiments/017-plate-depth/README.md)). The 3D preview renders the head, plate, and the V's own skin, face details (makeup, lipstick, cheeks, freckles, blemishes, scars, tattoos, face cyberware), eyes, brows, lashes and hair resolved from the player's installation, with a **Character creator** lighting preset for calibration. The R&D lab has knowledge pages (also published on the site) on materials and shaders, hair shading, creator lighting, the CC file chain, head CC rendering, Glitter in game, mod loading, runtime access and tooling.

## What works (verified in code and tests)

| Area | State |
|---|---|
| **Editor** | Head and UV surface editing. Variable layer stacks and presets with rename, copy, reorder and recovery. Bézier/corner paths, directional softness, multiple warp fields, whole-shape transforms, UV zoom/pan, whole-gesture Undo, and a persistent `?verify=1` isolated workspace. New recipes are `xfs/recipe-7`. See the [editor invariants](../research/authoring/editor-invariants.md). |
| **UI** | Dock/panel workspace (`studio-ui/`, started by the one composition root `studio-startup.ts` on localhost and desktop), delivered 24 September and built by Claude under the previous coordinator. Its three audit defects are fixed. It has a History panel (click any step to undo or redo to it, with named Undo/Redo tooltips), a UV map that fills its panel with floating non-shifting hints, and right-click menus that show only actionable sections. The maintainer's cursory review is positive; an in-depth review is pending. The legacy sidebar shell was retired on 25 September (no legacy code paths in an alpha; older saved data still loads). |
| **Preview** | Head, eye plate and eyes derived only from the player's own game files (both hosts prepare them with a progress card); deforming head and plate with the real default creator idle (pause and head/facial subsets), saved-V import (five facial morphs, eye shape), the V's own skin, face decals (vanilla and CCXL makeup, scars, tattoos, face cyberware; one decal family with the engine's square-root-space blend) and eyes, saved brows, lashes and hair shaded with the game's decoded hair-shader colour model and light (Karis-style lobes with the game's vanilla hair options from a third-party list; profile colour space still a hypothesis, awaiting a controlled capture), the V's own piercings and the creator's graphic eye designs through a layered (`multilayered.mt`) adapter from the resolver (modular jewellery frameworks included, with a viewport-only style and colour to try), preview quality presets and experimental finish looks. |
| **Library** | Local SQLite (`bun:sqlite`) with immutable collection and preset versions, and portable recipe and collection files. |
| **Packaging** | Check reports unsupported details. Build produces an independently verified **XF Eye Artistry** candidate for **Matte, Satin and Metallic**, plus **experimental** game-matched **Glossy** (single lobe), **Shimmer** (facet normals) and **Colour-shifting** (Fresnel tint, one pigment per preset); Glitter and earlier-model layers are omitted with reporting ([finish designs](../research/materials/finish-designs/README.md)). The expanded eye plate is derived automatically from the installed 2.31 game (byte-exact to the game head) and cached. Flat and faceted textures cover only the plate's UV rectangle (a 2048 × 512 plate-local window mapped back by the material's UV transform: about 0.13 × 0.12 mm per texel instead of 0.56 × 0.40 mm, at the same memory; [experiment 019](../experiments/019-uv-window/README.md)); colour shift stays on head UV. Build no longer needs Python: it runs entirely in TypeScript (the retired Python builder's parity holds for the head-UV layout it knows). Game and MO2 installs are auto-detected, and MO2 precedence follows MO2's own rules. See the [pipeline guide](../research/authoring/studio-to-mod-pipeline.md). |
| **Desktop** | Electrobun app with a tag-driven CI release pipeline (draft pre-releases, checksums, build-provenance attestation, packaged-content privacy scan), a hand-written changelog and a unified XF icon. `v0.1.0-alpha.1` is tagged at `60a60e9`; its draft release asset passed an unattended clean-machine Windows Sandbox run (one-click WebView2 install through uninstall), with checksums and attestation verified. First run leads a community user from the game folder (Steam, GOG, Epic or MO2; an Xbox copy is recognised and explained) through a consented, hash-pinned WolvenKit download to a prepared 3D head. Unsigned alphas; updater disabled. See the [desktop README](../projects/xf-studio/authoring/desktop/README.md) |
| **Site** | Public GitHub Pages site, style guide and **Knowledge** section generated from `knowledge/*.md` (caveated, attributed, privacy-checked), **live** at https://axefrog.github.io/xf-studio/ and deployed from `main` by CI. It says there is no release or download yet until the draft is published |
| **Checks** | 1,141 Studio tests pass with 5 opt-in real-install tests skipped, 72 desktop tests pass; both typechecks, the browser build, site verify, the Markdown link check and the private-data check (with its self-test) pass, locally and in CI (26 September). Deep reviews at `19bf84c`, `524a575`, `ecb4b33` and `ac251d8` plus a runtime-bridge security review; every High they found is fixed except the two long-standing design items (UI-02 partly, CORE-03). See the [code-health ledger](../research/authoring/code-health.md) |

## Proven only offline or not at all

Offline verification is not in-game proof. Runtime evidence so far is in the [finish board results](../experiments/016-finish-board/README.md#runtime-results) and the switcher-exclusivity save check ([head CC rendering](../knowledge/head-cc-rendering.md)). Still without runtime evidence, or found wrong in game:

- **Close-up rendering:** the 0 mm plate broke up at close range and on blinks (found wrong). Build now lifts the plate 0.4 mm like vanilla decals; the depth variants await session 2. Eyelid-contact gates from experiments [006](../experiments/006-plate-clearance/README.md) and [012](../experiments/012-native-plate-bootstrap/README.md) are still open.
- **Finish looks:** Matte and Satin read glossy and Shimmer reads as soft gloss (found wrong); the gloss calibration and stronger Shimmer variants await session 2. The plate uses only about 4 % of each preset texture, which limits every finish; a plate-local UV window is now built for flat and faceted routes ([Glitter in game](../knowledge/glitter-in-game.md)).
- **Colour parity** of brows, lashes, hair and skin with the game: the preview's creator-lighting preset is built but its exposure and light switches need the maintainer's capture.
- **Steam and Epic detection** are proven by tests only (GOG on a real machine).
- **Runtime bridge:** hardened and self-tested offline; never run in game.
- Glitter export stays guarded; its game route is designed ([experiment 018](../experiments/018-glitter-route/README.md)) but not built.
- **Plate-local UV window:** its V sign and WolvenKit's row order are verified offline and checked on every build, but no window build has been seen in game. [Experiment 019](../experiments/019-uv-window/README.md)'s diagnostic candidate (new against old density) is built and verified, not staged.

## Waiting on the maintainer

1. **Second in-game session** ([experiment 020](../experiments/020-session-2/README.md)): texture placement at the new density first, then depth variants, gloss calibration, strong Shimmer and the lifted metal ramp; staged in the test profile.
2. **Third in-game session** ([experiment 022](../experiments/022-session-3/README.md)), after session 2: the Glitter board, the blink on several eye shapes, creator Off rows and linked hairstyles. The coordinator stages it once session 2 is in.
3. **Calibration captures** at the mirror appearance screen with the Character creator preset's protocol ([creator lighting](../knowledge/creator-lighting.md)).
4. **Runtime bridge session** (about 15 minutes, read-only) once a dedicated profile is set up ([test card](../research/runtime/runtime-bridge-test-card.md)).
5. **In-depth review of the new UI.**

## Active direction

Product and R&D run in parallel, like a commercial team beside a research lab:

- **Product tracks:** first game smoke test; brow, lash and hair colours; rendering every character detail in the viewport; CC controls so work can be checked on other characters (every creator option is now in the Character panel with live preview, Off, its own Undo and portable presets; later: save write-back); remaining finish adapters.
- **R&D lab:** the game's material and shader system, and the character-customisation file chain (mining the legacy xf-omega code and the Modding Docs screenshots). Findings are distilled into the agent-facing [knowledge base](../knowledge/README.md).
- **Desktop app and public site (standing request):** the site is live; `v0.1.0-alpha.1` stays an unpublished draft; `v0.1.0-alpha.2` is published after session 2 (releases no longer need the maintainer's go-ahead). Signing (SignPath) and auto-update come after the first alpha.
- **Resumed with in-game evidence:** plate clearance (the decal lift). Native eye assembly remains paused.

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
