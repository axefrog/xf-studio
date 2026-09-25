# Research and work queue

**Current as of 25 September 2026.** This is the single ranked queue for XF Studio (`projects/xf-studio`) and related research. Each row links to the owner document that holds the detailed requirements and open/done state. Tracks marked *parallel* are independent enough to run as separate subagents on their own `claude/` branches and worktrees; the coordinator reviews, merges and updates shared status.

## Ranked tracks

| Priority | Track | Status | Owner doc |
|---|---|---|---|
| 1 | **First in-game makeup smoke test** | Prepared, awaiting the maintainer's session. Check/Build produce independently verified private candidates for Matte, Satin and Metallic; a diagnostic MO2 profile is staged with the four-preset (Matte/Metallic/Off) candidate; a five-preset Satin candidate is built but not staged. **No in-game test has happened.** The maintainer runs all game tests. | [Runtime preflight and session card](../authoring/first-makeup-runtime-preflight-2026-09-25.md) |
| 2 | **Character detail rendering completeness** — brow, lash and hair *colours* correct first (a long-standing, top feature priority), then render **all** character-customisation details in the viewport | Open. Brow material path corrected from source (study approximation); lash colour source ambiguous (Alliekat vs vanilla `brown_liquorice.hp`); hair colour uses an approximate dark brown instead of the `ash_brown.hp` profile. Skin/eye/lip parity not reached. | [Preview fidelity](preview-fidelity.md), [brow/lash study](../eye-artistry/brow-lash-fidelity.md), [hair profile resolution](../eye-artistry/saved-hair-profile-resolution.md) |
| 3 | **CC controls and presets** — expose all character-creator options in the Studio, not just eye shape and piercings; later save back and share CC presets | Open (new track). Read-only catalogue probe exists. *Parallel* with 2 where assets do not conflict. | [CC controls and presets](cc-controls-and-presets.md) |
| 4 | **Materials system and shader reverse-engineering** — skin, hair, eye, decal/multilayered and related shaders | Open; a long-standing directive, never properly begun as a systematic study. Finish-specific and resource-chain studies exist. *Parallel*. | [Materials and shader RE](materials-shader-re.md) |
| 5 | **Character-customisation file-chain study** — consolidate how CC files tie together, mining legacy xf-omega and the local wiki clone (text **and** images) | Open; wiki-based map exists. *Parallel* (read-only research). | [CC file chain](cc-file-chain.md) |
| 6 | **Eye-makeup editor and remaining finish export adapters** (Shimmer, Glitter, Glossy, Colour-shifting) | Editor feature set largely done (see linked backlogs). Export adapters depend on track 4; browser Glitter models recipe-7..10 exist but game export stays guarded. | [Finishes and glitter](glitter-material.md), [path and falloff](path-and-falloff-controls.md), [viewport and editor](viewport-and-editor-controls.md), [authoring requests](eye-artistry-authoring.md) |
| 7 | **UI follow-ups** | Opus overhaul delivered and merged 24 Sep; reviewed only cursorily so far. Open: in-depth review, API gaps, `legacy.html` retirement after acceptance. | [UI overhaul follow-ups](claude-ui-overhaul.md), [boundary assessment](../authoring/ui-architecture-boundary.md) |
| 8 | **CCXL character-creator capability study** | Queued explicit request (keep). Source/resource merge boundary mapped; runtime and UI probes remain. Feeds tracks 3 and 5. | [CCXL capabilities](ccxl-character-creator-capabilities.md) |
| 9 | **Desktop app release and public site** — standing request: finish the desktop app build and keep a preliminary GitHub Pages site for it | Pages site **live** at https://axefrog.github.io/xf-studio/ (deployed from `main` by CI since 24 Sep; says no release/download yet). Electrobun Windows trial works in installed canaries (edit, library, intake, Check, Build, restart persistence). Open: signing and a real release channel, standard-user install, signed A→B updater, clean-machine first run, a download/release section on the site once a build is published. *Parallel*. | [Desktop packaging](../authoring/desktop-packaging.md), [desktop README](../../projects/xf-studio/authoring/desktop/README.md), [update gate](../authoring/desktop-update-ab-gate.md), [site README](../../projects/xf-studio/site/README.md) |

Supporting research that sits under a track rather than being ranked on its own: [wgpu/ray-tracing assessment](wgpu-renderer-assessment.md) (under track 2/4; current recommendation is to keep the browser renderer), [hair, piercings and jewellery context](jewellery-and-customization.md) (preview context under track 2; jewellery *authoring* is a later feature), and the [portable mod-source resolver](jewellery-and-customization.md#portable-mod-source-discovery) (shared by tracks 2, 3 and 5).

## Standing direction (set 25 September 2026)

1. **First goal: a fully working XF Eye Artistry export.** Prove the supported finishes (Matte, Satin, Metallic) in game, then design and prove game materials for every finish the editor offers (Shimmer, Glitter, Glossy, Colour-shifting). Shader decompilation and R&D are approved where they're needed to do this properly.
2. **Rendering grows outward from the head:**
   1. Face and head as the seed.
   2. All face/head character-creator options.
   3. Correct rendering and shading.
   4. The vanilla body, since many options are body-related.
   5. The character's full in-game appearance, including worn clothing read from the save.

   Every step goes through the generic resolver, and independent work runs in parallel.

## Queued R&D and background work

- **Runtime access baseline** (early mod R&D, start when a research slot frees, ideally after the first in-game test): minimal, heavily logged base mods per type (RED4ext C++, redscript, CET Lua, ArchiveXL/TweakXL) plus a loopback bridge so agents can read and change live game state while the maintainer plays. See [runtime access baseline](runtime-access-baseline.md).
- **Shader decompile annotator** (R&D tooling, in progress): rename decompiled material constants and bindless textures from template register maps. See [shader-system tooling](../materials/shader-system/README.md).
- **Generic game-file resolver** (architecture, feeds tracks 2–3): support for installed mods and frameworks such as PRC and CCXL packs must come from interpreting files as the game does, not per-mod adapters. Phase 1 is implemented and validated ([mod loading](../../knowledge/mod-loading.md), [validation](../character-customization/resolver-validation.md)); next are a geometry/texture export adapter and wiring it into the preview, after which the PRC-specific preview code (migration debt) can be removed. Specified by the [CC file chain](cc-file-chain.md) research.
- **Python-free Build: done.** Build needs only the game folder and WolvenKit; the TypeScript builder reproduces the Python outputs byte for byte ([Build pipeline port](../authoring/studio-to-mod-pipeline.md#build-pipeline-port)). Remaining: repeat the Build in an installed desktop canary.
- **Native archive and resource reader** (later R&D, approved): a TypeScript reader for the game's `.archive` and CR2W resource formats, decompressing through the user's installed game DLL via `bun:ffi` rather than redistributing it. It removes WolvenKit from the user path and underpins the generic resolver. Respect licences and credit the format research it builds on (WolvenKit, RED4ext SDK, wiki).
- **Framework handling in tooling: done 25 September.** The tools never install frameworks, add only XF Eye Artistry by a documented [placement rule](../authoring/framework-version-check.md), and a read-only version check gives friendly update guidance. Remaining: remove the diagnostic MO2 profile after the first in-game test.
- **Retire the legacy XF Eye Artistry CCXL mod (when XF Eye Artistry is ready):** keep it installed until then as a resolver test case (custom CCXL extensions read from save plus installed mods as the game sees them). Before retiring it, recreate the desired look in XF Eye Artistry and apply it in game, then disable the old mod. Use the resolver to confirm how the save treats references to the removed options.
- **Public knowledge pages** (low priority, background): periodically publish mature, attributed and caveated knowledge on the Pages site. See [public knowledge pages](public-knowledge-site.md).

## Paused pending in-game evidence

- **Expanded-plate clearance** ([Experiment 006](../../experiments/006-plate-clearance/README.md), [012](../../experiments/012-native-plate-bootstrap/README.md)). Many offline candidates were rejected; no correction is accepted. Pause until the smoke test shows whether residual eyelid contacts are visible in game. Any resumed candidate must be morph-aware and finite-contact-aware and preserve exact native skin bytes in mesh and morph base buffers.
- **Native eye assembly** ([013](../../experiments/013-native-preview-core/README.md), [014](../../experiments/014-native-eye-gradient/README.md), [015](../../experiments/015-native-eye-assembly/README.md)). Offline candidates and gates only; not selected by the Studio renderer.

## Later features — discuss with the maintainer before building each

In order:

1. Piercings/earrings design (a [jewellery construction-set proposal](../jewellery/construction-set-design.md) awaits review)
2. Eyebrows
3. Cheek makeup
4. Hair design
5. Facial expressions and idles (static/animated; varied idle animations)
6. Tattoos
7. Full body customisation
8. World integration: quest design, area design

Existing brow, lash, hair and piercing *preview context* is not permission to build those editors.

**Photo Mode Tools** remains an independent second project (engine/API audit queued after the XF Studio tracks); see its project README.

## Working rules for this queue

This is a durable queue, not a scheduled automation. Bounded parallel subagents are explicitly authorised; code-changing agents work in their own worktree under `D:/Dev/worktrees/<slug>` on a `claude/` branch. Offline verification never substitutes for in-game proof: batch game-only questions into one prepared session for the maintainer to run.
