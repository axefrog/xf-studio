"""Write the compact, path-free manifest of the quest corpus database.

    python write_manifest.py --db quest-corpus.sqlite --out research/story-engine/quest-corpus-h-manifest.json \
        [--loose-manifest PATH_TO_LOOSE_JSON/MANIFEST.json]

The same summary is added under the key `areaH` of the loose corpus MANIFEST.json when given.
Per-file hashes are not repeated: they live in the database (`resources.sha256`, `resources.raw_sha256`).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3

DEFAULT_COMMANDS = [
    "WolvenKit.CLI archive PATH_TO_GAME/<archive> -l -r \"[.](quest|questphase|scene|journal)$\"   (path listing, for every archive under archive/pc/content and archive/pc/ep1 except localisation)",
    "WolvenKit.CLI extract PATH_TO_GAME/<archive> -o SCRATCH/chunk -r \"^(<quest folders of the chunk>)..*[.](quest|questphase|scene|journal)$\"   (chunks of about 250 resources, one archive at a time)",
    "WolvenKit.CLI convert serialize SCRATCH/chunk   (default settings; one .json written beside each resource, ingested and deleted before the next chunk)",
]


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 24), b""):
            h.update(block)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--loose-manifest")
    ap.add_argument("--db-sha256", help="skip hashing the database and use this value")
    a = ap.parse_args()
    db = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    q = lambda sql: db.execute(sql).fetchall()
    meta = dict(q("SELECT key, value FROM meta"))

    by_area_type: dict = {}
    for area, typ, n, b in q("SELECT area, type, COUNT(*), SUM(bytes) FROM resources GROUP BY area, type"):
        by_area_type.setdefault(area, {})[typ] = {"resources": n, "jsonBytes": b}
    by_archive: dict = {}
    for arch, typ, var, n in q("SELECT archive, type, variant, COUNT(*) FROM resources WHERE type IN ('quest','questphase','scene','journal') GROUP BY archive, type, variant"):
        by_archive.setdefault(arch, {}).setdefault(typ, {})[var] = n
    by_category = {c: {t: n for t, n in q(f"SELECT type, COUNT(*) FROM resources WHERE category='{c}' AND variant='live' AND type IN ('quest','questphase','scene','journal') GROUP BY type")}
                   for (c,) in q("SELECT DISTINCT category FROM resources")}
    structure = {t: q(f"SELECT COUNT(*) FROM {t}")[0][0] for t in
                 ("graphs", "nodes", "edges", "fact_refs", "phases", "scenes", "scene_node_types", "scene_event_types", "journal_entries")}
    log = {k: n for k, n in q("SELECT kind, COUNT(*) FROM ingest_log GROUP BY kind")}
    total = q("SELECT COUNT(*), SUM(bytes) FROM resources")[0]

    summary = {
        "purpose": "Research request \"The quest corpus\" (area H of the P2 game-substrate plan), steps 1 and 2. Every quest, questphase, scene and journal resource of the base game and Phantom Liberty, serialised to JSON and held in one SQLite database with structure tables for statistics. Derived from game files: the database is private, ignored by git, never packaged.",
        "extractedOn": meta.get("built_on"),
        "tool": {
            "name": "WolvenKit CLI",
            "version": "9.0.1",
            "exeSha256": meta.get("wolvenkit_exe_sha256"),
            "whyThisVersion": "The same tool, version and settings as areas A, B and C (quest-corpus-a-manifest.json).",
            "jsonHeader": {"WolvenKitVersion": "9.0.1", "WKitJsonVersion": "0.0.9", "GameVersion": 2310},
        },
        "game": {"productVersion": "2.31", "jsonHeaderGameVersion": 2310},
        "commands": DEFAULT_COMMANDS,
        "run": "Every WolvenKit call ran under tools/memory_guard.py with a limit of 4 GB. The game was not running. Chunks were built on drive C and deleted after ingestion; the database was built on C and copied to the corpus folder in one go.",
        "database": {
            "location": "research/consumers/quest-corpus/quest-corpus.sqlite (ignored)",
            "bytes": os.path.getsize(a.db),
            "sha256": a.db_sha256 or sha256_file(a.db),
            "schemaVersion": int(meta.get("schema_version", 0)),
            "largestChunkScratchBytes": int(meta.get("scratch_peak_bytes", 0)),
            "storage": "JSON text in resources.json; scenes zlib-compressed in resources.json_z",
        },
        "counts": {
            "resources": total[0],
            "jsonBytes": total[1],
            "byAreaAndType": by_area_type,
            "byArchiveTypeVariant": by_archive,
            "liveByCategory": by_category,
            "structureRows": structure,
        },
        "earlierLooseIngest": json.loads(meta["existing_summary"]) if "existing_summary" in meta else None,
        "ingestLog": log,
        "notes": [
            "Areas A, B and C are the earlier loose-file extractions, ingested after their SHA-256 values were checked against MANIFEST.json. Area E (decompiled scripts) and the analysis outputs were not ingested.",
            "Resources are keyed by archive and path: the journal and one gig phase exist in both gamedata archives.",
            "variant 'version' marks copies under versions/ folders and 'test' marks test/ folders; the statistics use 'live'.",
            "Step 3 (decompositions into the composite) is not part of this run.",
        ],
    }
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(summary, f, indent=1)
        f.write("\n")
    print("wrote", a.out)
    if a.loose_manifest:
        with open(a.loose_manifest, encoding="utf-8") as f:
            m = json.load(f)
        m["areaH"] = dict(summary, location="research/consumers/quest-corpus/quest-corpus.sqlite (ignored)")
        with open(a.loose_manifest, "w", encoding="utf-8", newline="\n") as f:
            json.dump(m, f, indent=1)
        print("updated", a.loose_manifest)


if __name__ == "__main__":
    main()
