# XF Studio

XF Studio is intended to become a specialised, all-in-one Cyberpunk 2077 modding toolkit. Its first suite is **V customisation**: eye makeup first, with piercing and hair design tools planned early and other facial and head details to follow. Full body customisation comes next, then world integration such as quest and area design. Each later feature is discussed with the maintainer before it is built; see the [product direction and discussion gates](data/product-direction.md).

This directory is the authoritative location for XF Studio, formerly XF Appearance Studio and XF Eye Artistry (renamed on 2026-09-23). Photo Mode Tools remains an independent peer project.

## Current state

As of 25 September 2026 (see [docs/status.md](../../docs/status.md) for the repository-wide current state):

- **Authoring editor.** The local [procedural eye-makeup editor](authoring/README.md) runs at `127.0.0.1:4317`. Its default interface is the dock/panel workspace delivered on 24 September: dockable, floating and tabbed panels with cursor-position snapping, magnetic composites, target-aware context menus, a command palette and system/light/dark themes, mounted only through `StudioPresentationPort`. The [interface style guide](authoring/public/style-guide.html) documents every pattern and the [delivery record](../../research/authoring/ui-overhaul-2026-09-24.md) holds the audit and acceptance evidence.
- **Product model.** Users author their own presets from editable layers, save a local SQLite library and compile a collection for **one in-game selector**. This supersedes the four in-game layer selectors and the design/colour/finish matrix. New recipes use `xfs/recipe-7`; choosing Glossy, Shimmer or Colour-shifting moves a recipe to `xfs/recipe-11` (game-matched optics).
- **Mod export.** **Check mod export** and **Build mod files** work for Matte, Satin and Metallic, and experimentally for game-matched Glossy, Shimmer and Colour-shifting ([finish designs](../../research/materials/finish-designs/README.md)). They build from a package-only copy, omit and report unsupported layers or whole presets, and promote only independently verified files to a private candidate with a manifest. Generated archive resources pass an exact plan/path/hash inventory gate before packing and again during verification. The [Studio-to-mod pipeline guide](../../research/authoring/studio-to-mod-pipeline.md) diagrams the whole path. Glitter, and layers still in an earlier Glossy, Shimmer or Colour-shifting browser study, fail the production export guard.
- **Game testing.** **No in-game test has happened yet.** An offline-verified four-preset candidate and ArchiveXL 1.27.3, TweakXL 1.11.4 and Codeware 1.20.5 are staged in a separate, unselected diagnostic MO2 profile; the original profile still uses the older installed frameworks. The maintainer runs game sessions; the prepared card is [first makeup runtime preflight](../../research/authoring/first-makeup-runtime-preflight-2026-09-25.md). Offline verification is not runtime proof.
- **Desktop trial.** A private [Electrobun trial](authoring/desktop/README.md) opens the editor, library, mask export and Check without preview assets, and enables the 3D head after a private five-file intake. Disposable Windows installs have exercised the WebView editor, Build, restart and close persistence and full-data uninstall. The [desktop architecture](../../research/authoring/desktop-packaging.md) defines first-run configuration, per-user data, configurable game/MO2/tool paths and a consented update gate. A public release, real updater, general asset resolution, standard-user installation and game rendering remain unavailable or unproved. [Local settings](authoring/LOCAL-SETTINGS.md) and a [read-only source discovery foundation](../../research/authoring/source-discovery-foundation.md) are implemented.
- **Expanded plate.** The owned neutral master is `assets/authored/xfas_eye_plate.blend` (hashed intake, all 105 facial shapes, eight bone influences). It is confirmed to have been cut from the larger head, and exact geometric correspondence is verified. [Experiment 004](../../experiments/004-plate-import/README.md) records conversion and shading retention. Every clearance correction so far has failed a later gate: the [006 post-packing candidate](../../experiments/006-plate-clearance/research/postpack-crease-checkpoint.md) failed the [dense 664-frame idle gate](../../experiments/006-plate-clearance/research/dense-idle-contact-gate.md), and the latest [012 packed candidate](../../experiments/012-native-plate-bootstrap/README.md) failed a subframe contact gate. The owned master and current package remain unchanged; that work is paused until the first game session shows whether the contacts are visible.

New features follow the [architecture contract](../../research/authoring/architecture-contract.md): validated application actions and detached state, browser/renderer device ports, and replaceable presentation. The [presentation-port acceptance](../../research/authoring/ui-port-acceptance-2026-09-24.md) is the boundary baseline.

## Editor capabilities

The editor supports Bézier and legacy curve areas with per-point pigment and edge softness, up to eight smooth warp fields per layer, mirroring, whole-shape move/rotate/scale in UV and on the head, persistent UV pan/zoom, editable ordered layers and presets, seven finish families, 512–4K preview quality, recipe persistence, 2048² alpha-mask export and importing a save's facial morph choices. It renders the actual head and `.010` plate with eight bone influences and all 105 customisation morphs, plus the game's close-up idle with independent head/facial movement.

Optional private preview context includes Arkhe brows, Soft Natural lashes, locally resolved saved-V MELUMINARY hair with island_dancer's CCXL AshBrown profile, vanilla piercings and three private PRC nose slots. These are browser material approximations, not verified game shader matches; hair physics and saved skin/other appearance references remain incomplete. See [save research](../../research/eye-artistry/save-import.md), [hair preview limits](../../research/eye-artistry/saved-v-hair-preview.md), [cap UV correction](../../research/eye-artistry/saved-hair-profile-resolution.md#cap-uv-tile-correction-24-september) and [PRC preview limits](../../research/jewellery/prc-preview-slice.md).

Measured checkpoints: [camera FOV framing](../../research/authoring/camera-zoom-design.md#implementation-checkpoint--24-september-2026); [raster performance](../../research/authoring/raster-performance.md) (a supplied complex 2K design fell from about 7 s to 1 s in Chrome with identical pixels); [whole-shape gestures](../../research/authoring/shape-gesture-contract.md); five Glitter browser models (four versioned as recipe-7 to recipe-10) with no photographic match or game mapping yet. A [read-only study of the maintainer's separate CharacterCreator project](../../research/eye-artistry/charactercreator-rendering-reference.md) informed lighting and material isolation without importing its shaders or assets. Remaining refinements are in the [authoring queue](../../research/backlog/eye-artistry-authoring.md).

## Game package experiments

[Experiment 005](../../experiments/005-preset-collection/README.md) is the production package path: ONE selector with authored presets and Off, sharing one material template and one mesh/morph pair, with authored lower mip chains whose decoded coverage is measured against the base maps. Studio's Check/Build and the separate [local package command](../../research/authoring/local-package-build.md) both use it. Shimmer, Glitter and Glossy have recipe-driven stock-material fixtures but remain guarded; the [Shimmer on-plate diagnostic](../../experiments/011-shimmer-plate-comparison/README.md) packages Off, a flat control and four normal variants for a later batched game comparison. First runtime questions: selector registration, A/B/Off clearing, posed clearance and save identity. Preserve zero-offset and controlled-offset comparisons; do not regenerate a full combinatorial catalogue. No installed mod is replaced by this work.

Target: current stable ArchiveXL 1.27.3 on Cyberpunk 2077 2.31. See the [toolchain](../../docs/toolchain.md#runtime-evidence-and-current-stable-releases), [expansion design](../../research/archive-xl/eye-artistry-strategy.md) and [asset lineage](../../research/eye-artistry/lineage.md).

## Naming and content

All newly generated archive appearance names use the lowercase `xfs_` namespace; existing identifiers are not bulk-renamed. See [naming and scope](data/naming.md).

Historical Eye Artistry intent: female V, four independently selectable makeup layers, 20 designs (9 eyeliner, 11 eyeshadow), 49 colours and four finish labels. The legacy finish implementations are not all distinct; keep user-visible intent separate from accidental old behaviour. Expanded eye-plate surface, predictable layer ordering and facial deformation support remain core requirements.

**Content reset authorised:** all old designs, identities, preset names and IDs may be replaced. The numbers above describe historical reference material, not a catalogue specification. The layered concept matters; the procedural editor can author a completely fresh collection. Legacy parity or a save migration bridge is not required unless it becomes useful or is requested.

The project requires **more colours**. The legacy 49-colour limit came from the enormous material matrix and reports of WolvenKit becoming unusably slow. Keep the palette configurable and benchmark residual UI/thumbnail/cache growth; 49 is not a release cap. The queued CCXL capability study should investigate decoupled selectors and palette browsing where they help.

## Layout

| Path | Contents |
|---|---|
| `authoring/` | Bun/TypeScript/Three.js Studio app, server, tests, intake/study tools and evidence. [README](authoring/README.md) |
| `authoring/desktop/` | Private Electrobun Windows packaging trial. [README](authoring/desktop/README.md) |
| `data/` | [Product direction](data/product-direction.md), [naming contract](data/naming.md) and plate intake provenance |
| `site/` | Public GitHub Pages site, independent of the app. [README](site/README.md) |
| `tools/` | Blender plate intake/audit/export scripts and .NET 9 `morph-import` / `anim-export` helpers built against WolvenKit libraries |
| `assets/authored/`, `assets/imported/` | Ignored local owned masters and preserved intake copies (game-derived; never committed) |
| `build/`, `dist/` | Ignored generated intermediates and private verified mod candidates with manifests |

Empty `src/` and `resources/` directories may exist locally from the original plan; build and validation code lives under `authoring/` and `tools/`.
