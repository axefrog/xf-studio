# Quest corpus: database and scripts

The quest corpus is every quest, quest-phase, scene and journal resource of the base game and Phantom Liberty (game 2.31), serialised to JSON and held in **one SQLite file**, `research/consumers/quest-corpus/quest-corpus.sqlite`. The file is private game-derived data and is ignored by git (`*.sqlite*`). These scripts rebuild it from a game install and produce the statistics page, [quest corpus statistics](../../../story-engine/quest-corpus-statistics.md). The tracked summary of what the database holds is [quest-corpus-h-manifest.json](../../../story-engine/quest-corpus-h-manifest.json).

Standard library only (Python 3.11 or later) plus WolvenKit CLI. Nothing here runs or touches the game; the extractor refuses to start a WolvenKit job while `Cyberpunk2077.exe` is running and waits instead.

## Files

| File | Purpose |
|---|---|
| `build_corpus.py` | Builds or continues the database: ingests earlier loose JSON, lists the game archives, extracts and serialises everything missing in chunks, ingests, finalises |
| `qc_lib.py` | Schema, path classification, and the extractors that fill the structure tables |
| `quest_stats.py` | Writes `research/story-engine/quest-corpus-statistics.md` from the database |
| `write_manifest.py` | Writes the tracked summary and the `areaH` entry of the loose corpus `MANIFEST.json` |
| `places_archive.py` | Area D: reads resources straight from a game archive with the game's own Oodle DLL, and takes a census of every streaming sector's class table in seconds |
| `places_index.py` | Area D: decodes the district polygons (`AreaShapeOutline`) from serialised sectors and answers "which district and venue holds this point?" |
| `places_join.py` | Area D: the world community registry, regular community areas and AI spots from the always-loaded sectors; journal path hashes joined to the compiled pin resources |
| `places_streamable.py` | Area D: reads the streamable community area nodes from the 965 sectors that hold them (disk-heavy, memory-guarded, resumable) |
| `places_communities.py` | Area D: pins every community instance to a district and tallies the gang mix per district |

## Rebuild from scratch

Needs WolvenKit CLI 9.0.1 (the version end users get; see [the toolchain](../../../../docs/toolchain.md)), the game install (`PATH_TO_GAME`), about 6 GB of free space on a fast drive for the growing database and one chunk of scratch, and a few hours. Run from the repository root:

```
python research/consumers/quest-corpus/scripts/build_corpus.py ^
  --game PATH_TO_GAME ^
  --wolvenkit PATH_TO_WOLVENKIT_CLI_EXE ^
  --scratch %USERPROFILE%/xfs-scratch/quest-corpus-h/build ^
  --out %USERPROFILE%/xfs-scratch/quest-corpus-h/quest-corpus.sqlite
```

Build on the fast drive, then copy the finished file to `research/consumers/quest-corpus/quest-corpus.sqlite` in one go and compare SHA-256 values.

- With no `--existing-json`, every resource comes from the game archives. The earlier extractions (areas A, B and C) were made with the same tool and settings, so the result is the same content; only the `area` label and the JSON header's scratch path and timestamp differ. To ingest those loose files instead of re-extracting them, pass `--existing-json` with the folder that holds them and its `MANIFEST.json`: each file is checked against its SHA-256 and size first.
- `--step existing|extract|finalize|all` runs one stage. The run is resumable: resources already in the database are skipped, so an interrupted run continues where it stopped.
- Every WolvenKit call runs under `tools/memory_guard.py` with a 4 GB limit (`--guard-limit`); WolvenKit peaked at about 1.4 GB. If the machine's free memory falls below the guard's floor because of other work, the script waits and retries.
- What is extracted: `archive -l` with a regular expression for the four extensions lists every archive under `archive/pc/content` and `archive/pc/ep1` (localisation archives skipped); `extract -r <folder pattern>` pulls a chunk of about 250 resources; `convert serialize <chunk folder>` with default settings writes the JSON beside each file. The chunk's files are deleted after ingestion. A chunk needs under 1 GB of scratch; the finished database is about 3.9 GB.
- Two depot paths exist in both gamedata archives (the journal, and one gig phase). The database keys resources by archive and path, so both copies are kept; the Phantom Liberty archive's copy wins at run time.

Then:

```
python research/consumers/quest-corpus/scripts/build_corpus.py --step finalize ...   (views and metadata)
python research/consumers/quest-corpus/scripts/quest_stats.py --db quest-corpus.sqlite --out research/story-engine/quest-corpus-statistics.md
python research/consumers/quest-corpus/scripts/write_manifest.py --db quest-corpus.sqlite --out research/story-engine/quest-corpus-h-manifest.json [--loose-manifest PATH_TO_LOOSE_JSON/MANIFEST.json]
```

## What the database holds

- `resources`: one row per resource: depot path, type, source archive, research area (`A`, `B`, `C`, `H`), category, quest folder, variant (`live`, `version`, `test`), SHA-256 of the JSON text, the extracted game file's SHA-256 (area H), and the JSON. Scenes are stored zlib-compressed in `json_z` (they are about 73 % of the JSON bytes and compress about 21 to 1); everything else is text in `json`.
- Structure tables, filled from the JSON as it is ingested: `graphs`, `nodes`, `edges`, `fact_refs`, `phases` (quests and quest phases); `scenes`, `scene_node_types`, `scene_event_types`; `journal_entries`. Views: `v_resource_counts`, `v_node_type_counts`, `v_fact_usage`, `v_quest_scenes`, `v_quest_graph_size`, `v_scene_refs`.
- `ingest_log` records anything unusual (a file that could not be extracted or converted, a hash mismatch, a connection whose end is outside the graph). `meta` records the tool and the build.

Example queries are in the statistics page's "How to query" section. To read a scene's JSON in Python: `qc_lib.read_json(db, resource_id)`.

## Places (area D)

The `places_*.py` scripts reproduce [the places page](../../../../knowledge/places.md): they read the Phantom Liberty copies of the world resources (the superset of the base game's) and need the same WolvenKit CLI 9.0.1 and a game folder. Order: `WolvenKit.CLI archive <ep1_1_nightcity.archive> -l` (the path list) -> `places_archive.py census` -> extract and serialise the sectors the census names (those with a `worldLocationAreaNotifier`; the four `always_loaded` sectors) -> `places_index.py areas` -> `places_join.py registry` and `pins` -> `places_streamable.py` -> `places_communities.py`. The tracked summary is [quest-corpus-d-manifest.json](../../../story-engine/quest-corpus-d-manifest.json). The checks used while developing them: the census equals the earlier header tallies for all 23,691 base sectors; the archive reader's extraction equals WolvenKit's byte for byte on a sector; the index reproduces the 205 areas and the per-district spot counts of the first prototype.

## Definitions the statistics rely on

- **Category** comes from the folder: `main` (`base/quest/main_quests` and the master graph), `side` (`side_quests`, `minor_quests`), `gig` (`open_world/street_stories`), `phantom_liberty` (anything under `ep1/`), `other` (the rest).
- **Quest folder** (`quest_key`) is the folder above the first `phases`, `scenes`, `test`, `versions` or similar subfolder, so a quest, a gig or a system with all of its phases and scenes shares one key.
- **Variant**: `version` is a copy under a `versions/` folder (kept by the game for patch comparison), `test` is under `test/` or `tests/`. Statistics use `live` only.
- **Edges** are the connections between node sockets, resolved from the serialised handle references; an edge belongs to the graph of its source node. A phase node can hold an inline graph, stored as a nested row in `graphs`.
- **Fact references** are literal fact names in node data (set, add, conditions) and in scene graphs. A set node writes; any other mention reads. Facts built in scripts are not visible.

## Scope

Not ingested: the decompiled scripts and the analysis outputs kept beside the loose corpus. Not in this run: decompositions of sample quests into the Story Engine's composite (they wait for its schema).
