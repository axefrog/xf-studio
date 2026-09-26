# Small headquarters utilities

Use the installed Python runtime named in `docs/toolchain.md`. Scripts have no dependency on xf-omega or its libraries.

| Utility | Purpose / boundary |
|---|---|
| `inventory/scan.py` | Read-only metadata census; writes only inside HQ. `--output` selects a new dated snapshot. Git/cache/dependency exclusions are recorded. |
| `inventory/report.py` | Builds Markdown/JSON inventories from the pinned survey and curated `inventory/classifications.json`. Both inputs are ignored local files, so it runs only in a workspace that has them. Update its snapshot date for a later survey. |
| `inventory/update_references.py` | Authorized external-reference fast-forwards only; preserves tracked real changes and untracked collision protection. Writes an update log. Review paths/branches before a later use. |
| `inventory/fetch_archivexl.py` | Fetches current stable release metadata and pinned source evidence; does not update installed mods. |
| `inventory/check_framework_releases.py` | Reads current official stable-release metadata. |
| `inventory/inspect_blend.py` | Run using Blender background/factory startup/disable-autoexec; inspects the identified legacy scene, writes a report and never saves the scene. |
| `inventory/inspect_resources.py` | Summarizes converted consumer resources, measures the old generator output, and hashes selected intake assets. Run after the isolated consumer exports exist. |
| `check_links.py` | Checks every relative Markdown link and `#anchor` in tracked files (GitHub slug rules), and that every Studio source path written in inline code (`src/….ts`, resolved against `projects/xf-studio/authoring/`) exists. Links into sibling reference clones are skipped unless `--external-clones` is passed; a dated record that deliberately names retired code wraps those lines in `<!-- historical-paths -->` … `<!-- /historical-paths -->`. Run before committing documentation; CI runs it too. |
| `review_due.py` | Reports whether a threshold-triggered code/architecture review is due (merges, changed source lines or new subsystems since the last reviewed commit in `research/authoring/code-health.md`). Exit 1 when due. |
| `minidump_summary.py` | Fingerprints Cyberpunk 2077 crashes from the game's own reports (`%LOCALAPPDATA%\REDEngine\ReportQueue`): exception, faulting `<module>+<offset>`, the report's message, and a heuristic stack scan (`--frames N`). Read-only. See [knowledge/game-crashes.md](../knowledge/game-crashes.md). |
| `memory_guard.py` | Runs a command inside a Windows Job Object and kills the whole process tree when its private memory passes `--limit` GB (default 8) or the machine's free memory falls below `--floor` GB (default 16); a hard commit cap at 1.25× the limit backs up the polling, and the tree dies with the guard. A kill exits 99 with a plain message and is appended to the ignored `local/memory-guard.log`. Wrap every heavy command in it: `python tools/memory_guard.py --limit 6 -- bun test`. |
| `capture_session.py` | Copies existing game/MO2 logs and profile list to a unique timestamped evidence folder. Never launches/deploys/changes the game. |
| `../experiments/001-dynamic-material-contract/check_contract.py` | Validates a fresh proposed material contract and CR2W round-trip. Does not prove runtime behavior. |

Inventory outputs (`inventory/dev.md`, `mo2.md`, `summary.json`, `classifications.json`, snapshots and records) are ignored and local-only; links to them resolve only in the maintainer's local workspace. All scripts capture paths/metadata rather than credentials. The Nexus credential lives outside HQ under Windows CurrentUser DPAPI, not in a script or config. Reference extractions and large manifests are locally available but excluded from Git/release packaging.
