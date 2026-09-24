"""Compare hair-profile blend hypotheses against the character creator's colour swatches.

Private inputs (never committed): a directory of WolvenKit-serialized `*.hp.json`
(e.g. `unbundle -w "*.hp"` from basegame_4_appearance.archive, then
`convert serialize`) and a serialized creator resource that lists hair colour
definitions with swatch colours and tags (e.g. female_cco.inkcharcustomization.json).

  python tools/hair-profile-swatch-fit.py <hp json dir> <customization json> [--grid 48]

For each hypothesis it averages the per-pixel base colour over a uniform grid of
Strand_ID x Strand_Gradient samples, then reports the angle between that mean
linear colour and the linear swatch (brightness-independent), plus the best
single exposure. Swatches of (0,0,0) are skipped. This is a statistical
consistency check on designer-picked UI colours, not a rendering measurement.
"""
import argparse
import json
import math
import statistics
from pathlib import Path


def dec(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def samp(stops, t):
    s = sorted(stops, key=lambda e: e[0])
    if t <= s[0][0]:
        return s[0][1]
    if t >= s[-1][0]:
        return s[-1][1]
    for a, b in zip(s, s[1:]):
        if t <= b[0]:
            f = 0 if b[0] == a[0] else (t - a[0]) / (b[0] - a[0])
            return [a[1][k] + (b[1][k] - a[1][k]) * f for k in range(3)]


def overlay(rt, idc):
    luma = 0.3 * rt[0] + 0.59 * rt[1] + 0.11 * rt[2]
    return [abs(2 * i * r if luma < 0.5 else 1 - 2 * (1 - i) * (1 - r)) for i, r in zip(idc, rt)]


HYPOTHESES = {
    "overlay, stops decoded from sRGB (preview model)": lambda rt, i: overlay([dec(x) for x in rt], [dec(x) for x in i]),
    "overlay, stops used raw": lambda rt, i: overlay([x / 255 for x in rt], [x / 255 for x in i]),
    "overlay with roles swapped, decoded": lambda rt, i: overlay([dec(x) for x in i], [dec(x) for x in rt]),
    "multiply, decoded": lambda rt, i: [dec(a) * dec(b) for a, b in zip(rt, i)],
    "multiply, raw": lambda rt, i: [a / 255 * b / 255 for a, b in zip(rt, i)],
    "Blender add-on (id^2.2 * rt^4.5)": lambda rt, i: [(b / 255) ** 2.2 * (a / 255) ** 4.5 for a, b in zip(rt, i)],
}


def load_profiles(directory):
    profiles = {}
    for path in Path(directory).glob("*.hp.json"):
        root = json.loads(path.read_text(encoding="utf-8"))["Data"]["RootChunk"]
        grab = lambda k: [(e["value"], (e["color"]["Red"], e["color"]["Green"], e["color"]["Blue"])) for e in root[k]]
        profiles[path.name[:-len(".hp.json")]] = (grab("gradientEntriesID"), grab("gradientEntriesRootToTip"))
    return profiles


def load_swatches(path):
    swatches = {}
    def walk(o):
        if isinstance(o, dict):
            if o.get("$type") == "gameuiIndexedAppearanceDefinition":
                c = o["color"]
                for tag in o["tags"]["tags"]:
                    swatches.setdefault(tag["$value"], (c["Red"], c["Green"], c["Blue"]))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(json.loads(Path(path).read_text(encoding="utf-8")))
    return swatches


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("profiles")
    parser.add_argument("customization")
    parser.add_argument("--grid", type=int, default=48)
    args = parser.parse_args()
    profiles, swatches = load_profiles(args.profiles), load_swatches(args.customization)
    names = sorted(n for n, s in swatches.items() if n in profiles and s != (0, 0, 0))
    print(f"{len(names)} profiles with a non-black swatch")
    for label, fn in HYPOTHESES.items():
        angles, exposures = [], []
        for name in names:
            ids, root = profiles[name]
            acc, n = [0.0, 0.0, 0.0], 0
            for a in range(args.grid):
                for b in range(args.grid):
                    o = fn(samp(root, (a + .5) / args.grid), samp(ids, (b + .5) / args.grid))
                    acc = [x + y for x, y in zip(acc, o)]
                    n += 1
            p = [x / n for x in acc]
            s = [dec(x) for x in swatches[name]]
            dot = sum(x * y for x, y in zip(p, s))
            norm = math.sqrt(sum(x * x for x in p) * sum(y * y for y in s))
            angles.append(math.degrees(math.acos(max(-1, min(1, dot / norm)))) if norm else float("nan"))
            exposures.append(dot / sum(x * x for x in p) if any(p) else float("nan"))
        print(f"{label:52s} median angle {statistics.median(angles):5.2f} deg, mean {statistics.mean(angles):5.2f}, "
              f"median exposure {statistics.median(exposures):.3f}")


if __name__ == "__main__":
    main()
