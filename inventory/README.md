# Local landscape inventory

The 2026-09-23 census covered all top-level folders in `D:/Dev` and `F:/Games/RedModding`, nested project/repository/container boundaries, all MO2 mod folders, profiles and both overwrite trees.

- [D:/Dev catalogue](dev.md): Cyberpunk frameworks and third-party mod references; personal legacy sources; unrelated and indirect projects.
- [RedModding catalogue](redmodding.md): original WolvenKit projects, tools, authoring assets, templates and reference material.
- [MO2 catalogue](mo2.md): 999 folders, including 11 separators; 988 actual mod folders. Selected profile `2025 (again)` has 920 enabled mods and 68 disabled mods.
- [MO2 structured inventory](mo2-mods.json): metadata, all three profile memberships, extension counts, dates and research summaries.
- [Reference update log](reference-updates-2026-09-23.json) and [first pass](reference-updates-first-pass-2026-09-23.json): authorized source refreshes, preserved changes, and before/after revisions.
- [Census summary](summary.json).

Machine-readable local detail:

- `snapshots/2026-09-23/files.jsonl`: 382,741 file metadata records, including creation and modification time in UTC and byte size.
- `snapshots/2026-09-23/directories.json`: 39,377 visited directories with direct file/type counts.
- `directories-classified.jsonl`: classification and relevance summary for every visited directory, inherited from its nearest relevant source/project category.
- `snapshots/2026-09-23/projects.json`: 1,176 mod/project/container/repository entries, Git baseline metadata and immediate contents.
- `snapshots/2026-09-23/scan-notes.json`: zero scan errors and 215 explicitly excluded dependency/cache/Git/HQ subtrees.

Scope honesty: file metadata and project purposes are inventoried; not every document has been read or every binary decoded. Git objects, dependency/cache internals and this HQ's own output were intentionally pruned. Downloads and MO2 application internals are classified as supporting infrastructure, not recursively decoded mods. The reference updates happened after this immutable census.

`F:/Games/MO2` supporting folders: `downloads` contains original install packages; `profiles` holds saved enablement/order; `overwrite` contains current runtime outputs; `_overwrite_` is an older February 2026 output tree; `logs`/`crashDumps` diagnose MO2/virtualisation failures; `plugins` includes integrations; `dlls`, `platforms`, `qml`, `resources`, `translations`, `styles`, `stylesheets`, `licenses`, `tutorials`, `loot`, `explorer++`, and `webcache` are manager/runtime support rather than authored mods. Root INI/executable/DLL files configure and run MO2. The configured Nexus connection remains in MO2.

Refresh: run `tools/inventory/scan.py`, then `tools/inventory/report.py` after reviewing classification changes. The reporting script is pinned to this survey date; select a new snapshot explicitly before a later census report. Do not silently replace historical provenance.
