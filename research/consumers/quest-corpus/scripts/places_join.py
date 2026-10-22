"""Join journal entries, community areas and AI spots to positions (research area D).

  python places_join.py registry --sector ALWAYS_LOADED_JSON [...] --out registry.json
      Streams the three serialised always-loaded sectors: the world community registry (instances, area type, entries),
      the regular community area nodes (spot ids per entry) and the registry's AI spots (global node id -> x, y, z).
  python places_join.py pins --resource FOLDER --journal base.json --journal ep1.json --out pins.json
      Reads the compiled `.poimappins` and `.mappins` (serialised) and joins every journalPathHash to a journal path.

Journal path hash: Murmur3-32, seed 0x5EEDBA5E, of the entry's path from the journal root (`points_of_interest/<group>/<id>`, `quests/...`;
the expansion's journal has the root id `ep1`, so its paths start `ep1/`). The same seed keys TweakDB record types. All base points of interest match.
"""
import argparse, collections, json, struct

MASK = 0xFFFFFFFF


def murmur3_32(data, seed):
    c1, c2 = 0xCC9E2D51, 0x1B873593
    h, n, i = seed, len(data), 0
    while i + 4 <= n:
        k = struct.unpack_from("<I", data, i)[0]
        i += 4
        k = (k * c1) & MASK
        k = ((k << 15) | (k >> 17)) & MASK
        k = (k * c2) & MASK
        h ^= k
        h = ((h << 13) | (h >> 19)) & MASK
        h = (h * 5 + 0xE6546B64) & MASK
    k, tail = 0, data[i:]
    if len(tail) >= 3:
        k ^= tail[2] << 16
    if len(tail) >= 2:
        k ^= tail[1] << 8
    if len(tail) >= 1:
        k ^= tail[0]
        k = (k * c1) & MASK
        k = ((k << 15) | (k >> 17)) & MASK
        k = (k * c2) & MASK
        h ^= k
    h ^= n
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & MASK
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & MASK
    h ^= h >> 16
    return h


def journal_hash(path):
    return murmur3_32(path.encode(), 0x5EEDBA5E)


def journal_paths(journal_json):
    """Every entry path of a serialised cooked journal, with its class: {path: class}. The Phantom Liberty journal's root is `ep1`."""
    root = json.load(open(journal_json))["Data"]["RootChunk"]["entry"]["Data"]
    out = {}

    def walk(d, path):
        here = path + [d["id"]] if d.get("id") else path
        if here:
            out["/".join(here)] = d["$type"]
        for e in d.get("entries", []) or []:
            walk(e["Data"], here)

    walk(root, [])
    return out


def pins(resource_folder, journals):
    base = resource_folder + "/base/worlds/03_night_city/_compiled/default/03_night_city."
    found = collections.defaultdict(list)
    for ext, key in [("poimappins", "cookedData"), ("mappins", "cookedData"), ("mappins", "cookedGpsData"), ("mappins", "cookedMultiData")]:
        for p in json.load(open(base + ext + ".json"))["Data"]["RootChunk"][key]:
            pts = [p["position"]] if "position" in p else p.get("positions", [])
            for q in pts:
                found[p["journalPathHash"]].append((ext + ":" + key, (q["X"], q["Y"], q["Z"])))
    names = {}
    for jpath in journals:
        for path, cls in journal_paths(jpath).items():
            names[journal_hash(path)] = (path, cls)
    return [dict(path=names.get(h, (None, None))[0], cls=names.get(h, (None, None))[1], src=s, pos=pos)
            for h, lst in found.items() for s, pos in lst]


# ---- the always-loaded sectors ------------------------------------------------------------------------------------
FP = 131072.0
dec = json.JSONDecoder()


def iter_array(text, key):
    k = text.find('"%s": [' % key)
    assert k >= 0, key
    j = text.index("[", k) + 1
    while True:
        while text[j] in " \n\r\t,":
            j += 1
        if text[j] == "]":
            return
        obj, j = dec.raw_decode(text, j)
        yield obj


def registry(sector_jsons):
    areas, instances, spots = [], [], {}
    for sec, fn in enumerate(sector_jsons):
        text = open(fn, encoding="utf-8").read()
        placements = collections.defaultdict(list)
        j = text.index('"Data": [', text.find('"nodeData": {')) + len('"Data": [')
        while True:
            while text[j] in " \n\r\t,":
                j += 1
            if text[j] == "]":
                break
            x, j = dec.raw_decode(text, j)
            p = x["Position"]
            placements[x["NodeIndex"]].append((p["X"], p["Y"], p["Z"]))
        for idx, node in enumerate(iter_array(text, "nodes")):
            d = node["Data"]
            if d["$type"] == "worldCompiledCommunityAreaNode":
                ents = {}
                for e in d["area"]["Data"]["entriesData"]:
                    ids = []
                    for ph in e["phasesData"]:
                        for tp in ph["timePeriodsData"]:
                            ids.extend(int(s["hash"]) for s in tp["spotNodeIds"])
                    ents[e["entryName"]["$value"]] = sorted(set(ids))
                areas.append(dict(sector=sec, node=idx, debug=d["debugName"]["$value"], sid=d["sourceObjectId"]["hash"], ents=ents, pl=placements.get(idx, [])))
            elif d["$type"] == "worldCommunityRegistryNode":
                templates = {}
                for it in d["communitiesData"]:
                    t = it["template"]
                    if "Data" in t:
                        templates[t["HandleId"]] = t
                    else:
                        t = templates.get(t.get("HandleRefId"))
                    entries = []
                    for e in (t["Data"]["entries"] if t else []):
                        ed = e["Data"]
                        phases = [[ph["Data"]["phaseName"]["$value"], [[tp["hour"], tp["quantity"], len(tp["spotNodeRefs"]), len(tp["markings"])] for tp in ph["Data"]["timePeriods"]]] for ph in ed["phases"]]
                        entries.append([ed["characterRecordId"]["$value"], ed["entryName"]["$value"], phases])
                    instances.append(dict(id=it["communityId"]["entityId"]["hash"], type=it["communityAreaType"], ents=entries if t else None))
                for w in d["workspotsPersistentData"]:
                    wp = w["worldPosition"]
                    spots[int(w["globalNodeId"]["hash"])] = (wp["x"]["Bits"] / FP, wp["y"]["Bits"] / FP, wp["z"]["Bits"] / FP, w["isEnabled"])
    return areas, instances, spots


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("registry")
    r.add_argument("--sector", action="append", required=True)
    r.add_argument("--out", required=True)
    p = sub.add_parser("pins")
    p.add_argument("--resource", required=True)
    p.add_argument("--journal", action="append", required=True)
    p.add_argument("--out", required=True)
    a = ap.parse_args()
    if a.cmd == "registry":
        areas, inst, spots = registry(a.sector)
        json.dump(dict(areas=areas, instances=inst, spots={str(k): v for k, v in spots.items()}), open(a.out, "w"))
        print(len(areas), "area nodes,", len(inst), "instances,", len(spots), "spots")
    else:
        out = pins(a.resource, a.journal)
        json.dump(out, open(a.out, "w"))
        print(len(out), "positions,", sum(1 for o in out if o["path"]), "with a journal path")
