"""Decode facial float tracks from clip GLBs (read-only research probe).

Usage: python decode_face_pose_vectors.py <dir of clip .glb> <face skeleton .rig.json>

Each GLB is one clip exported by `projects/xf-studio/tools/anim-export` (WolvenKit's exporter writes the float tracks
into the animation's glTF extras as `trackKeys` / `constTrackKeys`). For every clip this prints the tracks with a
nonzero value (largest magnitude over the clip), which for an AdditiveFromRefPose expression is the sparse pose-weight
vector it adds to the rig's reference tracks, and writes `summary.json` beside the inputs. Inputs and output stay in an
ignored `research/consumers/<topic>/` folder; they are game-derived."""
import json, struct, sys, glob, os

root = sys.argv[1]
rig = json.load(open(sys.argv[2], encoding="utf-8"))["Data"]["RootChunk"]
names = [t["$value"] for t in rig["trackNames"]]
refs = rig.get("referenceTracks", [])


def glb_json(path):
    b = open(path, "rb").read()
    n = struct.unpack_from("<I", b, 12)[0]
    return json.loads(b[20:20 + n])


summary = {}
for fn in sorted(glob.glob(os.path.join(root, "*.glb"))):
    g = glb_json(fn)
    anim = g["animations"][0]
    ex = anim.get("extras", {})
    vals = {}
    for k in ex.get("constTrackKeys", []):
        vals.setdefault(k["trackIndex"], []).append(k["value"])
    for k in ex.get("trackKeys", []):
        vals.setdefault(k["trackIndex"], []).append(k["value"])
    typ = ex.get("animationType")
    nz = {}
    for i, vs in vals.items():
        v = max(vs, key=abs)
        if abs(v) > 1e-4:
            nz[names[i]] = round(v, 4)
    clip = os.path.basename(fn)[:-4]
    summary[clip] = {"animationType": typ, "tracksPresent": len(vals), "nonzero": nz}
    inputs = {k: v for k, v in nz.items() if not (k.startswith("LipsyncPoseOutput") or "wrinkle" in k.lower())}
    print(f"== {clip} type={typ} tracks={len(vals)} nonzero={len(nz)} (inputs {len(inputs)})")
    print("   " + ", ".join(f"{k}={v}" for k, v in sorted(inputs.items(), key=lambda kv: -abs(kv[1]))[:40]))
json.dump(summary, open(os.path.join(root, "summary.json"), "w"), indent=1)
print("referenceTracks len", len(refs), "names", len(names), "first envelopes", names[:13])
