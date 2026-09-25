"""Compact node-tree printer for WolvenKit-serialised .animgraph JSON (read-only research helper).

Usage: python animgraph_tree.py <graph.animgraph.json> > tree.txt

Serialise the graph first with `WolvenKit.CLI convert serialize <file.animgraph> -o <dir>`. Prints each node's type
and its non-default scalar fields, follows pose/float/int/bool links, and marks shared handles as `(seen)`. Used to read
the photo-mode and paperdoll facial graphs for the facial-expressions knowledge page."""
import json, sys

d = json.load(open(sys.argv[1], encoding="utf-8"))
seen = set()
SKIP = {"visAxes", "visMask", "visNames", "visPostPose", "visPostPoseColor", "visPrePose", "visPrePoseColor",
        "visRigPartMask", "visWhenActive", "poseInfoLogger", "debugName", "id", "debug", "debugInput", "debugFlag"}
LINKS = {"animPoseLink", "animFloatLink", "animIntLink", "animBoolLink", "animVectorLink", "animQuaternionLink"}


def short(v):
    if isinstance(v, dict) and v.get("$type") == "CName":
        return v["$value"]
    if isinstance(v, dict) and "DepotPath" in v:
        return v["DepotPath"].get("$value")
    return None


def pr(o, ind, key):
    if isinstance(o, dict):
        if "HandleId" in o:
            h = o["HandleId"]
            if o.get("Data") is None:
                print(" " * ind + f"{key}: ->#{h}")
                return
            if h in seen:
                print(" " * ind + f"{key}: ->#{h} (seen)")
                return
            seen.add(h)
            o = o["Data"]
            key = f"{key} #{h}"
        t = o.get("$type", "")
        if t in LINKS:
            n = o.get("node")
            if n is not None:
                pr(n, ind, key)
            return
        scal, kids = [], []
        for k, v in o.items():
            if k in SKIP or k == "$type":
                continue
            s = short(v)
            if s is not None:
                if s not in ("None", "0"):
                    scal.append(f"{k}={s}")
            elif isinstance(v, (int, float, str)):
                if v not in (0, ""):
                    scal.append(f"{k}={v}")
            elif isinstance(v, (dict, list)):
                kids.append((k, v))
        print(" " * ind + f"{key}: {t} " + " ".join(scal)[:300])
        for k, v in kids:
            if isinstance(v, list):
                for i, x in enumerate(v):
                    pr(x, ind + 2, f"{k}[{i}]")
            else:
                pr(v, ind + 2, k)
    elif isinstance(o, list):
        for i, x in enumerate(o):
            pr(x, ind + 2, f"{key}[{i}]")


sys.setrecursionlimit(20000)
pr(d["Data"]["RootChunk"], 0, "root")
