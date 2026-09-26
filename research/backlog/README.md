# Research and work queue

**Current as of 26 September 2026.** This is the single ranked queue for XF Studio (`projects/xf-studio`) and related research. Each row links to the owner document that holds the detailed requirements and open/done state. Tracks marked *parallel* are independent enough to run as separate subagents on their own `claude/` branches and worktrees; the coordinator reviews, merges and updates shared status.

## Ranked tracks

| Priority | Track | Status | Owner doc |
|---|---|---|---|
| 1 | **XF Eye Artistry in game** | First session done (25 September): the XF selector works in the character creator, gameplay and photo mode, switching and saves persist, and Colour-shifting behaves as designed. Found wrong: close-up breakup (fixed offline by the 0.4 mm plate lift like vanilla decals), Matte/Satin reading glossy and Shimmer reading as soft gloss. **Session 2** ([experiment 020](../../experiments/020-session-2/README.md)) is staged: texture placement at the new density first, then depth, gloss calibration, strong Shimmer and the metal ramp. The maintainer runs all game tests. | [Experiment 020](../../experiments/020-session-2/README.md), [finish board results](../../experiments/016-finish-board/README.md#runtime-results) |
| 2 | **Character detail rendering completeness** — brow, lash and hair *colours* correct first (a long-standing, top feature priority), then render **all** character-customisation details in the viewport | Open. Brows, lashes, hair, skin, eyes and face details (rank 2 of the head CC plan) render from the resolver's output for any V; parity with the game not yet measured. | [Head CC rendering plan](../../knowledge/head-cc-rendering.md) (ranked: resolver-fed render record, skin material, one face-decal path, creator controls, full eye, general hair), [preview fidelity](preview-fidelity.md), [brow/lash study](../eye-artistry/brow-lash-fidelity.md), [hair profile resolution](../eye-artistry/saved-hair-profile-resolution.md) |
| 3 | **CC controls and presets** — expose all character-creator options in the Studio, not just eye shape and piercings; later save back and share CC presets | Panel done (slice 2, 26 Sep): every creator option in the Character panel with live preview, Off, Reset, its own Undo, "Hide my V's own makeup" and portable presets. Next: choice icons, save write-back. | [CC controls and presets](cc-controls-and-presets.md) |
| 4 | **Materials system and shader reverse-engineering** — skin, hair, eye, decal/multilayered and related shaders | In progress: skin and hair references and the shader fact index done (26 September); eye, decals and multilayered next. *Parallel*. | [Materials and shader RE](materials-shader-re.md) |
| 5 | **Character-customisation file-chain study** — consolidate how CC files tie together, mining legacy xf-omega and the local wiki clone (text **and** images) | Open; wiki-based map exists. *Parallel* (read-only research). | [CC file chain](cc-file-chain.md) |
| 6 | **Eye-makeup editor and remaining finish export adapters** (Shimmer, Glitter, Glossy, Colour-shifting) | Editor feature set largely done (see linked backlogs). Experimental Glossy, Shimmer and Colour-shifting adapters exist ([finish designs](../materials/finish-designs/README.md)); the [finish board](../../experiments/016-finish-board/README.md) awaits its game session. Glitter export stays guarded. | [Finishes and glitter](glitter-material.md), [path and falloff](path-and-falloff-controls.md), [viewport and editor](viewport-and-editor-controls.md), [authoring requests](eye-artistry-authoring.md) |
| 7 | **UI follow-ups** | Opus overhaul delivered and merged 24 Sep; reviewed only cursorily so far. Open: in-depth review, API gaps. The legacy shell was retired 25 Sep. | [UI overhaul follow-ups](claude-ui-overhaul.md), [boundary assessment](../authoring/ui-architecture-boundary.md) |
| 8 | **CCXL character-creator capability study** | Queued explicit request (keep). Source/resource merge boundary mapped; runtime and UI probes remain. Feeds tracks 3 and 5. | [CCXL capabilities](ccxl-character-creator-capabilities.md) |
| 9 | **Desktop app release and public site** — standing request: finish the desktop app build and keep a preliminary GitHub Pages site for it | Pages site **live** at https://axefrog.github.io/xf-studio/ (deployed from `main` by CI since 24 Sep; says no release/download yet). Electrobun Windows trial works in installed canaries (edit, library, intake, Check, Build, restart persistence). Open: signing and a real release channel, standard-user install, signed A→B updater, clean-machine first run, a download/release section on the site once a build is published. *Parallel*. | [Desktop packaging](../authoring/desktop-packaging.md), [desktop README](../../projects/xf-studio/authoring/desktop/README.md), [update gate](../authoring/desktop-update-ab-gate.md), [site README](../../projects/xf-studio/site/README.md) |

Supporting research that sits under a track rather than being ranked on its own: [wgpu/ray-tracing assessment](wgpu-renderer-assessment.md) (under track 2/4; current recommendation is to keep the browser renderer), [hair, piercings and jewellery context](jewellery-and-customization.md) (preview context under track 2; jewellery *authoring* is a later feature), and the [portable mod-source resolver](jewellery-and-customization.md#portable-mod-source-discovery) (shared by tracks 2, 3 and 5).

Later-domain research queue (below the body and appearance work): [world, terminals, arcade and scripting](world-and-interactive-ideas.md).

## Standing direction (set 25 September 2026)

1. **First goal: a fully working XF Eye Artistry export.** Prove the supported finishes (Matte, Satin, Metallic) in game, then design and prove game materials for every finish the editor offers (Shimmer, Glitter, Glossy, Colour-shifting). Shader decompilation and R&D are approved where they're needed to do this properly.
2. **Rendering grows outward from the head:**
   1. Face and head as the seed.
   2. All face/head character-creator options.
   3. Correct rendering and shading.
   4. The vanilla body, since many options are body-related.
   5. The character's full in-game appearance, including worn clothing read from the save ([research and plan](clothing-render.md)).

   Every step goes through the generic resolver, and independent work runs in parallel.

## Queued R&D and background work

- **Runtime access baseline** (early mod R&D; baseline built and hardened after its security review, awaiting its first game session): heavily logged base mods per type (RED4ext C++, redscript, CET Lua, TweakXL data) and a local named-pipe bridge, read-only by default, in [`projects/xf-runtime-bridge`](../../projects/xf-runtime-bridge/README.md). Phase 2 (command catalogue, MCP server, CLI, session scripts, writes behind `allow_writes`) is built offline. Next: the [first session](../runtime/runtime-bridge-test-card.md), then session 2 through the bridge. See [runtime access baseline](runtime-access-baseline.md).
- **Runtime bridge autonomy** (R&D done, nothing built): ranked bridge features that remove the player's remaining steps in a test session — light on/off, hiding the photo-mode cursor, camera presets for repeatable framing, opening and leaving the creator from script, row labels that follow scripted changes, NPC hiding and a fixed studio spot, and the full photo mode via the player's key. Evidence in [photo mode](../../knowledge/photo-mode.md). See [bridge autonomy](bridge-autonomy.md).
- **Worn clothing rendering** (R&D done, nothing built; standing direction step 5, after the body track): read V's loadout, wardrobe overrides and hidden slots from the save, resolve items through TweakDB, factories, suffixes and ArchiveXL dynamic appearances, hide items and body chunks by visual tags, then draw garments over the body with a Clothing control (as saved, without headwear and face items, underwear only, custom). Four questions for the maintainer, including whether EquipmentEx's saved outfits may be read. See [clothing render](clothing-render.md) and [knowledge/clothing.md](../../knowledge/clothing.md).
- **Shader decompile annotator** (R&D tooling, in progress): rename decompiled material constants and bindless textures from template register maps. See [shader-system tooling](../materials/shader-system/README.md).
- **Generic game-file resolver** (architecture, feeds tracks 2–3): support for installed mods and frameworks such as PRC and CCXL packs must come from interpreting files as the game does, not per-mod adapters. Phase 1 is implemented and validated ([mod loading](../../knowledge/mod-loading.md), [validation](../character-customization/resolver-validation.md)); next are a geometry/texture export adapter and wiring it into the preview, after which the PRC-specific preview code (migration debt) can be removed. Specified by the [CC file chain](cc-file-chain.md) research.
- **Vortex support** (background R&D, feeds the generic resolver): a read-only prototype attributes Vortex-deployed game-folder files to their Vortex mods (with Nexus ids from Vortex's state), finds the deploying installation and profile, and reports out-of-date deployments. Next: first-run detection, placing XF Eye Artistry through Vortex's own `--install-archive`, and staleness guidance. See [Vortex support](vortex-support.md) and [knowledge/vortex.md](../../knowledge/vortex.md).
- **Python-free Build: done.** Build needs only the game folder and WolvenKit; the TypeScript builder reproduces the Python outputs byte for byte ([Build pipeline port](../authoring/studio-to-mod-pipeline.md#build-pipeline-port)). Remaining: repeat the Build in an installed desktop canary.
- **Native archive and resource reader** (R&D; phases 1–2 done, hardened against hostile files on `claude/native-hardening`, not wired in): a TypeScript reader for the game's `.archive` and CR2W formats that decompresses through the user's installed Oodle DLL via `bun:ffi` (never redistributed). It matches WolvenKit's bytes and the resolver's JSON on every cached resource. A cold resolve of the reference save took 2.7–2.9 s with no WolvenKit launches, against 90–95 s and 23 launches, and also resolved a mod `.app` that WolvenKit cannot serialize. Next: integrate native-first with WolvenKit fallback after `claude/choice-prefetch` lands, then textures (phase 3) and meshes (phase 4). See [native archive reader](native-archive-reader.md) and [archive and resource formats](../../knowledge/archive-format.md).
- **Framework handling in tooling: done 25 September.** The tools never install frameworks, add only XF Eye Artistry by a documented [placement rule](../authoring/framework-version-check.md), and a read-only version check gives friendly update guidance. Remaining: remove the diagnostic MO2 profile after the first in-game test.
- **Retire the legacy XF Eye Artistry CCXL mod (when XF Eye Artistry is ready):** keep it installed until then as a resolver test case (custom CCXL extensions read from save plus installed mods as the game sees them). Before retiring it, recreate the desired look in XF Eye Artistry and apply it in game, then disable the old mod. Use the resolver to confirm how the save treats references to the removed options.
- **README presentation: done 25 September.** The root README opens with a theme-aware `<picture>` banner (the XF tile and a font-free bevelled-stroke wordmark, light and dark SVGs) and light and dark Studio screenshot thumbnails linking to full-size WebP images, with the CD PROJEKT RED credit line. Assets live in `docs/images/readme/`; the screenshots show a neutral demo collection authored in an isolated verification workspace.
- **Guidance system: tours, spotlights and a Help view** (v1 built on `claude/guidance`): data-driven onboarding and "what's new" tours over stable UI anchors, a theme-aware spotlight overlay, callouts with "Do it for me" buttons, and a searchable Help view (F1) that launches tours. Remaining: feature-module tour and help contributions, a what's-new tour shown automatically after an update, and localisation; see [feature-module platform §6a](../authoring/feature-module-platform.md#6a-guidance-tours-spotlights-and-help-v1-built).
- **One-click "prepare idle and blink"** (desktop app, open; under track 9 and the "It just works" policy): a consented flow that downloads the pinned IO Suite solver and bakes the creator idle and the game's blink from the player's own files, so the Motion panel works in an installed app. See [prepare idle and blink](prepare-idle-and-blink.md).
- **Public knowledge pages: implemented.** The Pages site generates a Knowledge section from Draft-or-better `knowledge/*.md` pages on every build, with caveat banner, evidence-grade legend, last-updated date, source and correction links, and a personal-data guard. Ongoing: keep knowledge pages public-quality. See [public knowledge pages](public-knowledge-site.md).

- **AI integration through MCP** (direction set 26 September): an optional, off-by-default MCP server so users can connect their own AI tools to the game (through the runtime bridge) and later to the Studio's typed actions. See [AI integration](ai-integration-mcp.md).

## Paused pending in-game evidence

- **Expanded-plate clearance** ([Experiment 006](../../experiments/006-plate-clearance/README.md), [012](../../experiments/012-native-plate-bootstrap/README.md)). Many offline candidates were rejected; no correction is accepted. Pause until the smoke test shows whether residual eyelid contacts are visible in game. Any resumed candidate must be morph-aware and finite-contact-aware and preserve exact native skin bytes in mesh and morph base buffers.
- **Native eye assembly** ([013](../../experiments/013-native-preview-core/README.md), [014](../../experiments/014-native-eye-gradient/README.md), [015](../../experiments/015-native-eye-assembly/README.md)). Offline candidates and gates only; not selected by the Studio renderer.

## Later features — discuss with the maintainer before building each

In order:

1. Piercings/earrings design (a [jewellery construction-set proposal](../jewellery/construction-set-design.md) awaits review)
2. Eyebrows
3. Cheek makeup

   Research and design options for both, with a recommended default and questions for the maintainer: [brows and cheeks brief](brows-and-cheeks-brief.md). Brow editor proposal (field-driven groom rasterised into the brow texture set, phased plan): [brow editor design](../brows/brow-editor-design.md).
4. Hair design
5. Facial expressions and idles (static/animated; varied idle animations)

   Feasibility, editor options, export plan and runtime questions: [expressions and idles brief](expressions-and-idles-brief.md). Phased design for static photo-mode expressions (the decided first scope): [expression editor design](../animation/expression-editor-design.md).
6. Tattoos
7. Full body customisation
8. World integration: quest design, area design

Existing brow, lash, hair and piercing *preview context* is not permission to build those editors.

**Photo Mode Tools** remains an independent second project (engine/API audit queued after the XF Studio tracks); see its project README.

## Working rules for this queue

This is a durable queue, not a scheduled automation. Bounded parallel subagents are explicitly authorised; code-changing agents work in their own worktree under `D:/Dev/worktrees/<slug>` on a `claude/` branch. Offline verification never substitutes for in-game proof: batch game-only questions into one prepared session for the maintainer to run.
