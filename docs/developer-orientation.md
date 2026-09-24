# Developer orientation

This is the internal map behind the [XF Studio landing page](../README.md). Read the [current state](status.md), the relevant project README and its linked research before changing behavior. [AGENTS.md](../AGENTS.md) carries binding working rules; this page is a navigation aid, not a replacement.

## Repository layout

| Location | Purpose |
|---|---|
| [XF Studio](../projects/xf-studio/README.md) | Active standalone product and project-specific source, intake, build and verification |
| [Photo Mode Tools](../projects/xf-photo-mode-tools/README.md) | Second independent project; research before a clean implementation |
| [Current state](status.md) | Established results, limitations and next work |
| [Inventory](../inventory/README.md) | Local source/mod landscape and explicit survey exclusions (outputs are ignored, local-only files) |
| [Experiments](../experiments/) | Numbered investigations, evidence and conclusions |
| [Research](../research/) | Source-supported findings, design contracts and backlog |
| [Tools](../tools/README.md) | Small shared inspection and verification utilities |
| [Toolchain](toolchain.md) | Installed tools, versions and update needs |
| [Validation](validation.md) | Offline checks and prepared runtime evidence |
| [Community credits](community-credits.md) | Attribution, learning and reuse boundaries |

The [architecture contract](../research/authoring/architecture-contract.md) governs Studio feature/refactor work. The [Studio-to-mod pipeline](../research/authoring/studio-to-mod-pipeline.md) governs recipe, compiler and package changes. Start from the [research queue](../research/backlog/README.md) for requested work, including the [CCXL character-creator capability study](../research/backlog/ccxl-character-creator-capabilities.md). The [ArchiveXL strategy](../research/archive-xl/eye-artistry-strategy.md) and [art/project lineage](../research/eye-artistry/lineage.md) provide the historical source trail.

The first local survey was on 23 September 2026; it required no game launch or mod deployment. It recorded metadata and exclusions, not a reading of every source file or decoding of every archive. Later authorized reference updates have their own before/after record in the inventory. Original projects remain research inputs in their original locations; new implementation belongs in these peer projects and does not inherit the old toolbox architecture. The repository keeps source and reviewed, provenance-tracked work. Personal inventories, credentials, saves, SQLite libraries, extracted game/mod assets and the game-derived Blender master remain local; links into those folders work only in the original workspace. A clone is therefore not a self-contained asset bundle. Put experimental output under `experiments/<id>/`, extracted consumer resources under `research/consumers/`, and releasable output only under a project's `dist/`; do not package research dumps or reference assets.

## Naming and path boundaries

The public repository is [axefrog/xf-studio](https://github.com/axefrog/xf-studio), and its display name is XF Studio. The technical project directory moved to `projects/xf-studio` on 24 September 2026. The following names remain deliberately unchanged. Review any future migration against the [naming contract](../projects/xf-studio/data/naming.md), current consumers and historical evidence before editing them.

| Existing name | Why it stays for now |
|---|---|
| Local checkout `D:/Dev/cp2077-modding-hq` | Active scripts, research commands and captured evidence use this absolute workspace path; moving it needs a separate path audit. |
| Game depot root `axefrog/appearance_studio/` | Existing game-resource references depend on this path; it is not repository branding. |
| `XFAS_DATA_DIR`, existing browser keys, the internal package/health identifiers and serialized `eye-artistry/*` / `xfas/*` IDs | Compatibility with saved drafts, collections, SQLite revisions, existing health clients and older inputs; do not bulk-rename them. New recipe versions and generated game appearances follow their explicit current contracts. |
| `xfas_eye_plate.blend`, earlier experiment outputs, hashes and external resource names | Source provenance and reproducibility. Keep historical identifiers exactly as recorded. |
| Historical “HQ”, “Eye Artistry” and “XF Appearance Studio” mentions in research, scripts and evidence | Many describe past states or literal paths. Update only when a specific page is revised with its original context preserved. |

Newly generated archive appearances use lowercase `xfs_`. The project-directory migration updates executable paths and current documentation links while retaining historical input and output identities. The local checkout name remains a separate, deferred migration.

The old directory spelling remains only in captured, immutable output evidence and the internal package/health identifiers. The local ignored head, plate, hair and SQLite assets have since been moved to the new path in the primary checkout (for example `projects/xf-studio/authoring/public/assets/` and `projects/xf-studio/assets/authored/xfas_eye_plate.blend`); an empty, file-free `projects/xf-appearance-studio/` directory skeleton may still exist locally and can be ignored.

## Parallel work, worktrees and the local archive

Code-changing parallel work uses a separate Git worktree at `D:/Dev/worktrees/<slug>` on a `claude/<slug>` branch; the agent edits, tests and commits only there, and the result is reviewed and merged or cherry-picked into `main` in the primary checkout. Remove the worktree and branch only after integration and a check for uncommitted work. Read-only research may use the primary checkout.

On 25 September 2026 all earlier `D:/Dev/worktrees/*` checkouts and `codex/*` branches were removed after integration. Private, ignored experiment outputs that had existed only in those worktrees were moved to their canonical ignored locations in the primary checkout (for example `experiments/*/generated/`). Copies that conflicted with existing files were kept under the ignored `local/worktree-archive/<old-worktree>/` folder, alongside `consolidation-manifest.json` (every move and its destination), `branch-tips.txt` and a `codex-branches.bundle`. Check that manifest before assuming a historical private output is lost.
