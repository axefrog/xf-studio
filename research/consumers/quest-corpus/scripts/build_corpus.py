"""Build the quest corpus database from scratch.

    python build_corpus.py --game PATH_TO_GAME --wolvenkit PATH_TO_WOLVENKIT_CLI_EXE \
        --scratch SCRATCH_DIR --out SCRATCH_DIR/quest-corpus.sqlite [--existing-json DIR]

Steps (each can be run alone with --step):
  existing  ingest loose JSON from the earlier extractions (areas A, B, C), checking each file against
            MANIFEST.json. Skipped when --existing-json is not given.
  extract   list every quest, questphase, scene and journal resource in the game's archives, and for
            everything not in the database yet: extract in chunks, serialise to JSON with WolvenKit CLI,
            ingest, and delete the chunk's files before the next chunk. Resumable.
  finalize  create the views and write the summary counts into the meta table.

Every WolvenKit call runs under tools/memory_guard.py. The scratch folder should be on a fast drive.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import qc_lib

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
GUARD = REPO / "tools" / "memory_guard.py"
EXTS = ("quest", "questphase", "scene", "journal")
EXT_RE = re.compile(r"^[a-z0-9_\-. \\]+\.(quest|questphase|scene|journal)$", re.I)
ARCHIVE_DIRS = ("archive/pc/content", "archive/pc/ep1")
SKIP_ARCHIVE_PREFIXES = ("lang_",)   # localisation text: no quest data


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def game_running() -> bool:
    out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq Cyberpunk2077.exe", "/NH"],
                         capture_output=True, text=True).stdout
    return "Cyberpunk2077.exe" in out


def wait_for_game_off() -> None:
    while game_running():
        log("Cyberpunk2077.exe is running; pausing extraction, rechecking in 3 minutes")
        time.sleep(180)


def run_wk(args, wolvenkit: str, limit: int, timeout: int = 3600):
    cmd = [sys.executable, str(GUARD), "--limit", str(limit), "--", wolvenkit, *args]
    for attempt in range(200):
        wait_for_game_off()
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if r.returncode != 99:
            return r
        text = r.stdout + r.stderr
        if "floor" in text:
            # other work on the machine took the free memory; this job is not the cause. Wait and retry.
            log("memory guard: the machine's free memory is below the floor; retrying in 2 minutes")
            time.sleep(120)
            continue
        raise SystemExit("memory guard killed WolvenKit (exit 99): shrink the chunk, do not raise the limit")
    raise SystemExit("gave up waiting for free memory")


def dir_size(p: Path) -> int:
    total = 0
    for root, _, files in os.walk(p):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


# ------------------------------------------------------------------------------ existing loose files

def ingest_existing(db, json_root: Path) -> None:
    manifest = json.loads((json_root / "MANIFEST.json").read_text(encoding="utf-8"))
    sources = [("A", manifest.get("files", [])),
               ("B", manifest.get("areaB", {}).get("files", [])),
               ("C", manifest.get("areaC", {}).get("files", []))]
    listed = set()
    n = bad = dup = missing = 0
    for area, files in sources:
        for ent in files:
            rel = ent["json"]
            listed.add(rel.lower())
            f = json_root / rel
            if not f.exists():
                missing += 1
                db.execute("INSERT INTO ingest_log VALUES ('missing_file', ?, ?)", (rel, area))
                continue
            raw = f.read_bytes()
            if qc_lib.sha256_bytes(raw) != ent["sha256"] or len(raw) != ent["bytes"]:
                bad += 1
                db.execute("INSERT INTO ingest_log VALUES ('hash_mismatch', ?, ?)", (rel, area))
            archive = ent["archive"]
            rid = qc_lib.ingest_resource(db, path=ent["depotPath"], archive=archive, area=area, raw=raw)
            if rid is None:
                dup += 1
                db.execute("INSERT INTO ingest_log VALUES ('duplicate_in_manifests', ?, ?)", (rel, area))
            else:
                n += 1
            if n % 200 == 0:
                db.commit()
                log(f"existing: {n} ingested (area {area})")
    db.commit()
    # loose files the manifests do not mention
    extra = 0
    for top in ("base", "ep1"):
        for root, _, files in os.walk(json_root / top):
            for fn in files:
                rel = (Path(root) / fn).relative_to(json_root).as_posix()
                if rel.lower() not in listed:
                    extra += 1
                    db.execute("INSERT INTO ingest_log VALUES ('unlisted_file', ?, NULL)", (rel,))
    db.commit()
    log(f"existing: {n} ingested, {bad} hash mismatches, {dup} duplicates, {missing} missing, {extra} unlisted")
    db.execute("INSERT OR REPLACE INTO meta VALUES ('existing_summary', ?)",
               (json.dumps({"ingested": n, "hash_mismatches": bad, "duplicates": dup, "missing": missing, "unlisted": extra}),))
    db.commit()


# ------------------------------------------------------------------------------ listing and planning

def list_archives(game: Path, wolvenkit: str, limit: int, lists: Path) -> dict[str, list[str]]:
    """Return {archive relative path: [depot paths]} for every quest, questphase, scene and journal."""
    lists.mkdir(parents=True, exist_ok=True)
    result = {}
    for d in ARCHIVE_DIRS:
        for a in sorted((game / d).glob("*.archive")):
            if a.name.startswith(SKIP_ARCHIVE_PREFIXES):
                continue
            rel = f"{d}/{a.name}"
            cache = lists / (Path(d).name + "_" + a.stem + ".txt")   # two archives can share a name (audio_1_general)
            if not cache.exists():
                r = run_wk(["archive", str(a), "-l", "-r", "[.](quest|questphase|scene|journal)$"], wolvenkit, limit)
                lines = [ln.strip() for ln in r.stdout.splitlines()]
                if r.returncode != 0:
                    raise SystemExit(f"listing {a.name} failed: {r.stdout[-300:]} {r.stderr[-300:]}")
                cache.write_text("\n".join(ln for ln in lines if EXT_RE.match(ln)), encoding="utf-8")
            paths = [ln.strip().lower() for ln in cache.read_text(encoding="utf-8").splitlines() if EXT_RE.match(ln.strip())]
            if paths:
                result[rel] = paths
                log(f"listed {rel}: {len(paths)}")
    return result


def plan_chunks(db, listing: dict[str, list[str]], chunk_files: int):
    done = {(a, p) for a, p in db.execute("SELECT archive, path FROM resources")}
    chunks = []
    for archive, paths in listing.items():
        pending = [p for p in paths if (archive, p) not in done]
        units: dict[str, list[str]] = {}
        for p in pending:
            units.setdefault(qc_lib.classify(p)[2], []).append(p)
        cur_units: list[str] = []
        cur_files: list[str] = []
        for key in sorted(units):
            if cur_files and len(cur_files) + len(units[key]) > chunk_files:
                chunks.append((archive, cur_units, cur_files))
                cur_units, cur_files = [], []
            cur_units.append(key)
            cur_files.extend(units[key])
        if cur_files:
            chunks.append((archive, cur_units, cur_files))
    return chunks


def unit_regex(units: list[str]) -> str:
    parts = ["".join(c if re.match(r"[a-z0-9_]", c) else "." for c in u) for u in units]
    parts = [p.replace("\\", ".") for p in parts]
    return "^(" + "|".join(parts) + ")..*[.](" + "|".join(EXTS) + ")$"


def run_chunk(db, game: Path, wolvenkit: str, limit: int, scratch: Path, archive: str, units, files, area: str):
    out = scratch / "chunk"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    want = set(files)
    r = run_wk(["extract", str(game / archive), "-o", str(out), "-r", unit_regex(units)], wolvenkit, limit)
    if r.returncode != 0:
        db.execute("INSERT INTO ingest_log VALUES ('extract_failed', ?, ?)", (archive, (r.stdout[-300:] + r.stderr[-300:])))
    present = {}
    for root, _, fs in os.walk(out):
        for fn in fs:
            full = Path(root) / fn
            depot = str(full.relative_to(out)).replace("/", "\\").lower()
            if depot in want:
                present[depot] = full
            else:
                full.unlink()          # extracted but belongs to another chunk or is already in the database
    for p in sorted(want - set(present)):
        db.execute("INSERT INTO ingest_log VALUES ('not_extracted', ?, ?)", (p, archive))
    r = run_wk(["convert", "serialize", str(out)], wolvenkit, limit)
    peak = dir_size(out)
    n_ok = 0
    for depot, raw_file in sorted(present.items()):
        jf = raw_file.with_name(raw_file.name + ".json")
        if not jf.exists():
            db.execute("INSERT INTO ingest_log VALUES ('convert_failed', ?, ?)", (depot, archive))
            continue
        raw_sha = qc_lib.sha256_bytes(raw_file.read_bytes())
        rid = qc_lib.ingest_resource(db, path=depot, archive=archive, area=area, raw=jf.read_bytes(), raw_sha256=raw_sha)
        n_ok += 1 if rid is not None else 0
        jf.unlink()
        raw_file.unlink()
        if n_ok % 40 == 0:
            db.commit()
    return len(present), n_ok, peak


def extract_all(db, args, scratch: Path) -> None:
    game = Path(args.game)
    listing = list_archives(game, args.wolvenkit, args.guard_limit, scratch / "lists")
    chunks = plan_chunks(db, listing, args.chunk_files)
    total = sum(len(c[2]) for c in chunks)
    log(f"extract: {len(chunks)} chunks, {total} resources to do")
    peak_all = 0
    for i, (archive, units, files) in enumerate(chunks, 1):
        if args.max_chunks and i > args.max_chunks:
            break
        t0 = time.time()
        n_present, n_ok, peak = run_chunk(db, game, args.wolvenkit, args.guard_limit, scratch, archive, units, files, "H")
        peak_all = max(peak_all, peak)
        cid = f"{archive}#{i}/{len(chunks)}"
        db.execute("INSERT OR REPLACE INTO chunks_done VALUES (?,?,?,?)", (cid, len(files), n_ok, peak))
        db.commit()
        log(f"chunk {i}/{len(chunks)} {archive}: {n_ok}/{len(files)} ingested, scratch {peak/1e9:.2f} GB, {time.time()-t0:.0f}s")
        shutil.rmtree(scratch / "chunk", ignore_errors=True)
    old = db.execute("SELECT value FROM meta WHERE key='scratch_peak_bytes'").fetchone()
    db.execute("INSERT OR REPLACE INTO meta VALUES ('scratch_peak_bytes', ?)", (str(max(peak_all, int(old[0]) if old else 0)),))
    db.commit()


# ------------------------------------------------------------------------------ finalize

def finalize(db, wolvenkit: str) -> None:
    db.executescript(qc_lib.VIEWS)
    meta = {
        "schema_version": str(qc_lib.SCHEMA_VERSION),
        "built_on": time.strftime("%Y-%m-%d"),
        "tool": "WolvenKit CLI 9.0.1 (archive -l, extract, convert serialize with default settings)",
    }
    if wolvenkit and os.path.exists(wolvenkit):
        import hashlib
        meta["wolvenkit_exe_sha256"] = hashlib.sha256(Path(wolvenkit).read_bytes()).hexdigest().upper()
    for k, v in meta.items():
        db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (k, v))
    db.commit()
    for row in db.execute("SELECT area, type, COUNT(*) FROM resources GROUP BY area, type ORDER BY area, type"):
        log(f"resources area {row[0]} {row[1]}: {row[2]}")
    for row in db.execute("SELECT kind, COUNT(*) FROM ingest_log GROUP BY kind"):
        log(f"ingest_log {row[0]}: {row[1]}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game", required=True, help="the game folder (PATH_TO_GAME)")
    ap.add_argument("--wolvenkit", required=True, help="WolvenKit.CLI.exe (9.0.1)")
    ap.add_argument("--scratch", required=True, help="scratch folder (fast drive); chunk files live here briefly")
    ap.add_argument("--out", required=True, help="the SQLite file to create or continue")
    ap.add_argument("--existing-json", help="folder with the earlier loose JSON and its MANIFEST.json (areas A-C)")
    ap.add_argument("--step", choices=["existing", "extract", "finalize", "all"], default="all")
    ap.add_argument("--chunk-files", type=int, default=250)
    ap.add_argument("--guard-limit", type=int, default=4, help="GB for each WolvenKit call")
    ap.add_argument("--max-chunks", type=int, default=0, help="stop after this many chunks (testing)")
    args = ap.parse_args()
    scratch = Path(args.scratch)
    scratch.mkdir(parents=True, exist_ok=True)
    db = qc_lib.open_db(args.out, create=not os.path.exists(args.out))
    if args.step in ("existing", "all") and args.existing_json:
        ingest_existing(db, Path(args.existing_json))
    if args.step in ("extract", "all"):
        extract_all(db, args, scratch)
    if args.step in ("finalize", "all"):
        finalize(db, args.wolvenkit)


if __name__ == "__main__":
    main()
