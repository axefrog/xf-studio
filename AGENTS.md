# XF Studio repository working rules

These are the standing rules for any agent working in this repository. They record the maintainer's decisions. Current state and priorities live in [docs/status.md](docs/status.md) and the [ranked backlog](research/backlog/README.md), not here. Rewritten 25 September 2026 when Claude took over coordination; the earlier wording is in git history. Technical invariants that used to be dated checkpoint paragraphs here now live in the contract docs linked below.

## What this is

XF Studio (`projects/xf-studio`) is a specialised, all-in-one Cyberpunk 2077 modding toolkit. The first suite is V customisation, starting with eye makeup. Next come tools for designing piercings and hair and other facial/head details, then full body customisation, and later world integration such as quest and area design. That breadth is why the Studio's architecture must stay strict. Photo Mode Tools (`projects/xf-photo-mode-tools`) is an independent second project, not a child of an all-in-one toolbox.

**Read first:** [README.md](README.md), [docs/status.md](docs/status.md), the [backlog](research/backlog/README.md), the [knowledge base](knowledge/README.md), [docs/developer-orientation.md](docs/developer-orientation.md), then the relevant project README and linked research. Keep these current whenever work changes a project's state. Write them as *current truth*: update or replace stale statements instead of prepending dated paragraphs above them.

## R&D lab

R&D is a permanent, first-class mandate, run like a research lab beside the product work rather than as an occasional detour. CP2077 modding knowledge is thin in model training data, so our own understanding of the engine is the foundation for every advanced feature to come.

- **Always run R&D.** Keep at least one R&D track active alongside feature work. The standing tracks are the game's material and shader system, and the character-customisation file chain.
- **Distil findings into the [knowledge base](knowledge/README.md).** It holds current, cited, evidence-graded answers to "how does X work?". Task logs alone are not enough.
- **Read before you work.** Agents and subagents read the relevant knowledge pages before starting and update them when they learn something.
- **Offline understanding serves the tests.** Its purpose is to make the maintainer's in-game tests succeed first time, not to replace them.

## Working with the maintainer

- **Report at each milestone** what was achieved and what, if anything, the maintainer needs to test. Keep it short and concrete.
- **The maintainer runs the game; agents never do.** Offline programmatic understanding of the game exists so that those tests succeed with minimal attempts. It is not a reason to avoid asking for a test. Batch runtime questions into one prepared session with a checklist, the exact candidate and profile, and versioned evidence capture. Later work will add live programmatic game access (RED4ext, CET, redscript, Lua) under the maintainer's supervision.
- **Volunteer design insights.** The maintainer welcomes useful unsolicited insights; explain meaningful design implications as they arise.
- **Discuss before building each later feature.** The order is piercings/earrings, eyebrows, cheek makeup, hair, facial expressions (static/animated, plus varied idles), tattoos (full body by then). Early approved exception: playing the real default character-creator idle with an on/off toggle. Never label synthetic motion as the game idle.
- **Ask when a decision is genuinely his.** Otherwise pick a sensible default and say so.
- **Test UI changes in an isolated `?verify=1` workspace,** never in the maintainer's active draft.

## Coordination and parallel work

- **Parallelise independent tracks** with subagents. The maintainer expects queued independent features to proceed concurrently.
- **Worktrees for code-changing subagents.** Create a separate worktree at `D:/Dev/worktrees/<slug>` on a `claude/<slug>` branch and give the agent that absolute path and a bounded ownership scope. It edits, tests and commits there, never in the shared checkout. Read-only research agents may use the primary checkout.
- **Integrate centrally.** The coordinator reviews and merges or cherry-picks verified results into `main`, then updates shared status and provenance.
- **Clean up after integration.** Check for uncommitted work, then move any ignored private outputs (e.g. `experiments/*/generated/`) into the main checkout's canonical ignored locations. Old worktrees may contain directory junctions into the main checkout (e.g. `node_modules`, `.hutch`, private assets). Unlink each junction non-recursively (`cmd /c rmdir <link>`) before deleting a worktree, or the deletion empties the main checkout's target. Only then remove the worktree and branch. Never leave unique evidence only inside a worktree. Never remove an active worktree or force its branch.
- **Commits and pushes** to the **public** `axefrog/xf-studio` repository are authorised as coherent verified checkpoints. Never force-push over remote work.

## Architecture contract

The Studio architecture is a maintained contract, not a one-time cleanup. Follow [the architecture contract](research/authoring/architecture-contract.md) for every feature and refactor:

- **Layers.** Domain/application services own validation, state transitions, Undo, persistence and async policy. Renderer/device adapters own Three, canvas, worker, file and network mechanics. Presentation owns layout, focus, theme and controls, and talks to the rest through typed actions, read-only snapshots and capabilities.
- **No new coupling.** Do not add business logic or direct mutable recipe access to startup files (`studio-main.ts`, legacy `main.ts`) or UI modules. Existing coupling is migration debt, not precedent.
- **Grow the catalogue.** Extend the action/capability catalogue and the boundary tests with each user-visible capability.
- **Record exceptions.** Record any unavoidable exception, with owner and removal criterion, in the [UI architecture boundary](research/authoring/ui-architecture-boundary.md).
- **Design for later domains.** New domain code should extend cleanly to other V features, body customisation and world tools.
- **UI direction.** Dockable/floating panels, magnetic composites and tabbed groups. Snapping uses the cursor position, never panel bounds. Any future redesign brief prescribes functional requirements and leaves aesthetics and workflow open.

## Mod pipeline and packaging

- **Pipeline documentation is a contract.** After any change to recipe/collection inputs, finish eligibility, layer compilation, resource naming or wiring, ArchiveXL declaration, package preflight/build, verification, manifest or promotion, update [the Studio-to-mod pipeline](research/authoring/studio-to-mod-pipeline.md) in the same checkpoint. Render its diagrams and **visually inspect** them at normal and enlarged size; Mermaid syntax validity alone is insufficient. Check label readability, arrow directions, the Check-versus-Build branches, where layers merge, private output versus runtime proof, and agreement with the source/output tree. Record the date, tool, observations and limits in its visual-review table. Commit only asset-free visual evidence.
- **Partial export.** Packaging keeps independently usable supported content when other details lack a proven export adapter.
  - Build from a package-only copy and never mutate the authored collection.
  - Report every omitted active layer or whole preset in Check, Build and the manifest. Check and Build must agree on the filtered snapshot and identities.
  - Refuse promotion if nothing usable remains or any structural, compiler or independent-verifier gate fails.
  - Never present an omitted detail as packaged, or a verified archive as game-tested. See the [partial export checkpoint](research/authoring/partial-mod-export-checkpoint.md).
- **One selector.** Users author complete presets in the Studio, save them in a local SQLite library and export a collection for **one** eye-makeup selector. Compile only authored combinations. Prefer merged material output where faithful; do not assume REDengine multilayered shading supports mixed finishes or transparency. See the [product direction](projects/xf-studio/data/product-direction.md).
- **Never auto-deploy.** Never deploy old generator output automatically; the old generator installs even when build-only behaviour is expected.

## Product decisions

- **Finish menu.** Matte, **Satin** (internal `regular`: soft sheen without distinct sparkles), **Metallic** (foil grouped here; never alias it to Shimmer), Shimmer (pearl grouped here), Glitter, Glossy/wet look and Colour-shifting (duochrome/multichrome).
  - The original four classes are historical intent, not a cap.
  - Define intended looks clearly and validate them against references; cosmetic finish terms overlap between brands.
  - The initial shimmer interpretation was an assistant's, not the Discord recommendation's.
  - See the [finish taxonomy](research/materials/makeup-finish-taxonomy.md).
- **Content catalogue.** Old Eye Artistry designs, preset identities, names and IDs are reference material, not compatibility or content requirements. Rebuild the catalogue with the new tools and preserve the layered-makeup concept. Legacy layers decoded from the reference save need no bespoke support; a general archive-driven catalogue may surface them as ordinary installed options.
- **Palette size.** The palette must exceed the legacy 49 colours and be configurable. The old matrix made WolvenKit unusably slow; benchmark UI, atlas and cache costs, not only generator speed.
- **Mod branding.** Every mod we produce is XF-branded in game and in mod managers (e.g. a spell-casting mod might be "XF Wizardry"). XF Studio is the *app*; mods get their own XF names. The eye-makeup export is **XF Eye Artistry**: unlike a normal one-size-fits-all mod, each player builds their own copy from the looks they authored. Internal resource identifiers keep the `xfs_` prefix.
- **Naming.** The product is **XF Studio** at `projects/xf-studio`. Every newly generated archive appearance name (app and mesh) starts with lowercase `xfs_`, e.g. `xfs_eye_layer1__xfs_e01+000+matte`. Keep existing browser keys, serialized schema IDs, historical inputs and evidence, original external resource names and saved legacy identifiers unchanged; no bulk renames. See the [naming contract](projects/xf-studio/data/naming.md).
- **Character context.** All character details should eventually render in the viewport, and CC values should be editable so users can check work on characters other than their own. Later, CC values can save back to a save file and be shared as reusable presets.
- **Desktop app and site.** The standing request is a finished desktop app build (Electrobun Windows trial is functional) and a preliminary public GitHub Pages site for it (live, deployed from `main` by CI). Keep localhost development and portable recipe import/export working alongside the desktop host.

## Evidence and honesty

- **Separate the kinds of evidence.** Track observed facts, source-supported expectations, hypotheses and runtime evidence separately. Offline serialization, simulated resolvers or archive verification never prove game rendering.
- **Game resource research.** In the local [Cyberpunk Modding Docs clone](../Cyberpunk-Modding-Docs), inspect each guide's diagrams and screenshots as evidence, not just its prose. Record the source commit, exact guide and image paths, and page-specific authorship when evidenced. Separate editor examples from runtime proof. See the [file-chain map](research/character-customization/file-chain-map.md).
- **Inventory coverage.** The inventory is metadata-level coverage, not a claim to have read every file or decoded every archive; record scan exclusions. Archived agent instructions and plans are historical evidence, not current mandates.
- **Runtime proof.** An MO2 profile `+` is not proof that a resource won at runtime. A future asset resolver must accept configurable MO2, Vortex and manual `archive/pc/mod` sources, and must distinguish installed files from effective load-order winners. Investigate saved-V references that differ from vanilla against MO2 mods and overrides.

## Community credit — mandatory

Whenever a third-party mod, repository, tool, guide, paper, discussion or creator teaches us something that informs research, implementation or design, credit it in [the community credits](docs/community-credits.md) during that work, before its checkpoint. This applies to ideas and techniques even when no code or assets are copied.

- **The credits file is a public acknowledgement, not a provenance ledger.** Each third-party party gets one entry: name and creator as evidenced (never guess), a link, and one to three plain sentences on what they contributed or what we learned. Name the relationship only when it matters, i.e. dependency use, code adaptation or asset use (with licence/permission status). No hashes, file paths, per-study logs or dated entries, and no instructions to agents inside the file.
- **Detailed provenance lives with the work.** Exact versions/commits, inspected files, hashes and what each source established belong in the research, experiment or knowledge page that used it.
- **First-party material is not a credit.** Never credit the maintainer or the project for their own reference collections, saves, recipes or decisions.
- **Unresolved authorship** goes on the internal [provenance follow-ups](research/provenance-followups.md) list rather than being omitted. Remove it once resolved and credited.
- **Before distribution,** use the credits and follow-ups to prepare visible acknowledgements and required third-party notices. Acknowledgement is not a substitute for permission or required notices. An inventory listing alone is not a learning credit.

## Writing repository documents

- **Don't name the maintainer.** Documents in the repo describe the project, not a person. Use neutral phrasing ("the reference save", "the maintainer's reference character", "a supplied recipe") or state the fact without attribution. Git history already records who did what.
- **Write current truth.** Update or replace stale statements; don't prepend dated diary paragraphs.
- **No personal paths or identifiers.** The repository and site are public: no user-folder, save, Downloads or Temp paths, credentials or account identifiers. Use placeholders such as `PATH_TO_GAME` or `%USERPROFILE%`.

## Sources, assets and repository hygiene

- **Primary base:** `D:/Dev/cp2077-modding-hq`. Keep new implementation project-local. Shared `tools/` is for small proven utilities, not a framework. Do not import legacy xf-common/xf-ui/xf-process dependencies by default.
- **The maintainer's old projects are research inputs only,** including `D:/Dev/xf-omega` and `D:/Dev/sx-cp2077`. Reimplement cleanly here; never resume or modify them in place. Reuse selected authored assets only with provenance and hashes, separating original inputs from derived outputs.
- **Output locations.** Experimental output goes under `experiments/<id>/`, extracted third-party resources under `research/consumers/`, and releasable output only in a project's `dist/`. Never package research dumps or reference assets.
- **Keep private material local and ignored:** personal inventories, credentials, saves, SQLite libraries, extracted game/mod assets, game-derived Blender files and the `local/` archive. Never add ignored payloads to make a clone self-contained.
- **External reference clones may be updated.** Prefer tracked-branch fast-forwards, preserve real changes and untracked files, and record before/after commits. For Windows newline-only drift, compare with per-command `core.autocrlf=true`; never reset files to make an update work. The Modding Docs clone tracks canonical `upstream/main`; `origin` is the maintainer's older fork.
- **Framework versions.** Target current stable releases and do not design around outdated installed mods. Tell the maintainer which installed versions need updating before runtime tests. Keep source revisions, installed metadata and runtime-log versions distinct. Beta features need an explicit reason.
- **Blender** upgrades are authorised if needed. Headless scripts work without Blender MCP.
- **MO2 and Nexus.** The maintainer's MO2 collection (profiles and overwrite overlays) is a research source. MO2 has a user-confirmed Nexus connection. A validated Nexus API credential is stored locally; see [docs/toolchain.md](docs/toolchain.md) for its DPAPI location. Never print or store credentials in research records, and prefer official public release downloads.

## Expanded eye plate

- **Repairs are authorised.** The maintainer is an amateur Blender user. Inspect topology, normals, UVs, skin clearance and facial/eyelid deformation, and fix the owned master with evidence. Preserve the historical source and design intent.
- **Provenance.** The maintainer cut the plate from the larger head mesh, and exact head-surface correspondence is verified. Preserve inherited deformation and shading. Future sculpting or offsets must revalidate that correspondence.
- **Skin bytes.** For head-cut geometry, preserve native skin bytes in **both** the mesh and the morph resource's embedded base buffer through the verified vertex mapping. Normalised GLB weights can quantise differently on reimport, and retaining eight influences alone does not prove identical deformation. Keep all morphs and independent clearance checks.
- **Clearance work is paused pending in-game evidence.** Offline candidates, including morph-aware and subframe-checked ones, have not passed every gate; see [experiment 012](experiments/012-native-plate-bootstrap/README.md). Any new candidate must be morph-aware and finite-contact-aware and must preserve the skin-byte rule.

## Technical contracts

| Area | Contract |
|---|---|
| Recipe versions, layers/presets, surface editing, preview jobs, saved-V inputs | [Editor and recipe invariants](research/authoring/editor-invariants.md) |
| Exact raster performance (the maintainer's 2K reference recipe: byte-identical, about 7.13 s → 0.97 s) | [Raster performance](research/authoring/raster-performance.md) |
| Bézier tangent projection and occlusion | [Projected tangent controls](research/authoring/projected-tangent-controls.md) |
| Directional softness | [Directional softness contract](research/authoring/directional-softness-contract.md) |
| Whole-shape and UV gestures | [Shape gesture contract](research/authoring/shape-gesture-contract.md) |
| Preview quality presets | [Preview quality contract](research/authoring/preview-quality-contract.md) |
| Glitter models and export guard | [Direct glint checkpoint](research/materials/direct-glint-browser-checkpoint.md), [glitter implementation contract](research/materials/glitter-implementation-contract.md), [glitter backlog](research/backlog/glitter-material.md) |
| Preview fidelity (eye/lip artifacts need shader/material/asset diagnosis, not an assumed SSS fix) | [Preview fidelity backlog](research/backlog/preview-fidelity.md) |
| Brow idle / animation clips (do not substitute `ui_closeup_shot_eyes` as the default idle without evidence of the live graph) | [Brow idle gap](research/animation/brow-idle-gap.md) |
| Saved-V import | [Save import](research/eye-artistry/save-import.md) |
| Historical lineage and ArchiveXL strategy | [Lineage](research/eye-artistry/lineage.md), [ArchiveXL strategy](research/archive-xl/eye-artistry-strategy.md), [inventory](inventory/README.md), [validation](docs/validation.md) |
