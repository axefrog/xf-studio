"""Read the streamable community area nodes from the sectors that hold them (research area D). Disk-heavy: one job at a time.

  python places_streamable.py --game PATH_TO_GAME --wolvenkit PATH_TO_WOLVENKIT_CLI_EXE --census census.json \
      --scratch %USERPROFILE%/xfs-scratch/places/sb --out streamable.json

census.json is `places_archive.py census` over the Phantom Liberty archive `ep1/ep1_1_nightcity.archive`, which holds a complete
effective copy of the city's sectors. The script takes every sector whose class table has `worldCompiledCommunityAreaNode_Streamable`,
extracts 25 at a time, serialises each with WolvenKit, keeps (debug name, source object id, spot ids per entry, placements) and
deletes the batch. It runs under tools/memory_guard.py (4 GB; WolvenKit peaks at about 1 GB), refuses to run while
Cyberpunk2077.exe runs, and continues where it stopped. About 6 s per sector (965 sectors).
"""
import argparse, collections, glob, json, os, shutil, subprocess, sys, time

BS = chr(92)
GUARD = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "tools", "memory_guard.py")


def game_running():
    return subprocess.run("tasklist", capture_output=True, text=True).stdout.lower().count("cyberpunk2077.exe") > 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game", required=True)
    ap.add_argument("--wolvenkit", required=True)
    ap.add_argument("--census", required=True)
    ap.add_argument("--scratch", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--batch", type=int, default=25)
    ap.add_argument("--limit-gb", default="4")
    a = ap.parse_args()
    archive = a.game + "/archive/pc/ep1/ep1_1_nightcity.archive"
    census = json.load(open(a.census))
    names = sorted(p.split("default" + BS)[-1].replace(".streamingsector", "").replace(BS, "/")
                   for p, v in census.items() if v["exports"].get("worldCompiledCommunityAreaNode_Streamable"))
    res = json.load(open(a.out)) if os.path.exists(a.out) else {}
    py = sys.executable

    def run(cmd):
        r = subprocess.run([py, GUARD, "--limit", a.limit_gb, "--"] + cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print("PROBLEM", r.returncode, (r.stdout + r.stderr)[-300:], flush=True)

    t0 = time.time()
    for bi in range(0, len(names), a.batch):
        batch = [n for n in names[bi:bi + a.batch] if n not in res]
        if not batch:
            continue
        if game_running():
            sys.exit("Cyberpunk2077.exe is running; stopping")
        shutil.rmtree(a.scratch, ignore_errors=True)
        os.makedirs(a.scratch)
        rx = "default.(" + "|".join(n.replace("/", ".") for n in batch) + ")[.]streamingsector$"
        run([a.wolvenkit, "extract", archive, "-o", a.scratch, "-r", rx])
        for f in glob.glob(a.scratch + "/**/*.streamingsector", recursive=True):
            run([a.wolvenkit, "convert", "serialize", f])
        for f in glob.glob(a.scratch + "/**/*.streamingsector.json", recursive=True):
            name = f.split("default")[-1].lstrip(BS + "/").replace(".streamingsector.json", "").replace(BS, "/")
            rc = json.load(open(f))["Data"]["RootChunk"]
            place = collections.defaultdict(list)
            for x in rc["nodeData"]["Data"]:
                p = x["Position"]
                place[x["NodeIndex"]].append((p["X"], p["Y"], p["Z"]))
            items = []
            for i, n in enumerate(rc["nodes"]):
                d = n["Data"]
                if d["$type"] != "worldCompiledCommunityAreaNode_Streamable":
                    continue
                ents = {}
                for e in d["area"]["Data"]["entriesData"]:
                    ids = []
                    for ph in e["phasesData"]:
                        for tp in ph["timePeriodsData"]:
                            ids.extend(int(s["hash"]) for s in tp["spotNodeIds"])
                    ents[e["entryName"]["$value"]] = sorted(set(ids))
                items.append(dict(node=i, debug=d["debugName"]["$value"], sid=d["sourceObjectId"]["hash"], ents=ents, pl=place.get(i, [])))
            res[name] = items
        for n in batch:
            res.setdefault(n, [])
        json.dump(res, open(a.out, "w"))
        print(bi, len(res), round(time.time() - t0), flush=True)
    shutil.rmtree(a.scratch, ignore_errors=True)
    print("DONE", len(res))


if __name__ == "__main__":
    main()
