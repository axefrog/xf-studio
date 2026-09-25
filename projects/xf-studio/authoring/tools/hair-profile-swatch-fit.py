"""Compare hair-profile bake/blend hypotheses against designer-picked colour references.

Two private reference sets (never committed):

* creator swatches: a directory of WolvenKit-serialized `*.hp.json` (e.g. `unbundle -w "*.hp"`
  from basegame_4_appearance.archive, then `convert serialize`) and a serialized creator resource
  that lists hair colour definitions with swatch colours and tags (female_cco.inkcharcustomization.json);
* selector icons: a colour pack's `*.hp.json` directory, its icon atlas exported to PNG and the
  serialized `.inkatlas`. Each part name `NN_<profile>` maps to `<profile>.hp`; the icon's mean
  colour (left 80 % of the part, which skips a corner badge) is the reference.

  python tools/hair-profile-swatch-fit.py <hp json dir> <customization json> [--grid 48]
  python tools/hair-profile-swatch-fit.py <hp json dir> --icons <atlas.png> <atlas.inkatlas.json>

For each hypothesis it averages the per-pixel base colour over a uniform grid of
Strand_ID x Strand_Gradient samples and reports, against each reference colour:
the angle between the linear colours (brightness-independent), the median exposure
(reference luminance / model luminance) and the spread of log exposure. A correct
bake with a common lighting factor should give a small angle and a small spread;
the median exposure then estimates that factor. References of (0,0,0) are skipped.
Designer references are statistical evidence, not rendering measurements.
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


def power(g):
    return lambda c: (c / 255) ** g


HYPOTHESES = {
    "overlay, stops decoded from sRGB (preview model)": lambda rt, i: overlay([dec(x) for x in rt], [dec(x) for x in i]),
    "overlay, stops used raw": lambda rt, i: overlay([x / 255 for x in rt], [x / 255 for x in i]),
    "overlay, stops^3": lambda rt, i: overlay([power(3)(x) for x in rt], [power(3)(x) for x in i]),
    "overlay decoded, result squared": lambda rt, i: [v * v for v in overlay([dec(x) for x in rt], [dec(x) for x in i])],
    "overlay, stops decoded twice": lambda rt, i: overlay([dec(255 * dec(x)) for x in rt], [dec(255 * dec(x)) for x in i]),
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


def walk(o, visit):
    if isinstance(o, dict):
        visit(o)
        for v in o.values():
            walk(v, visit)
    elif isinstance(o, list):
        for v in o:
            walk(v, visit)


def load_swatches(path):
    """Creator swatch colours in linear space, keyed by definition tag."""
    swatches = {}
    def visit(o):
        if o.get("$type") == "gameuiIndexedAppearanceDefinition":
            c = o["color"]
            for tag in o["tags"]["tags"]:
                swatches.setdefault(tag["$value"], [dec(c["Red"]), dec(c["Green"]), dec(c["Blue"])])
    walk(json.loads(Path(path).read_text(encoding="utf-8")), visit)
    return swatches


def load_icons(atlas_png, inkatlas_json):
    """Mean linear colour of each atlas part, keyed by the part name without its `NN_` prefix."""
    from PIL import Image
    image = Image.open(atlas_png).convert("RGB")
    parts = []
    walk(json.loads(Path(inkatlas_json).read_text(encoding="utf-8")),
         lambda o: parts.append(o) if "partName" in o and "clippingRectInPixels" in o else None)
    icons = {}
    for part in parts:
        r = part["clippingRectInPixels"]
        left, right = r["left"], r["left"] + int((r["right"] - r["left"]) * 0.8)
        raw = image.crop((left, r["top"], right, r["bottom"])).tobytes()
        count = len(raw) // 3
        mean = [sum(dec(v) for v in raw[k::3]) / count for k in range(3)]
        icons[part["partName"]["$value"].split("_", 1)[-1]] = mean
    return icons


def lum(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("profiles")
    parser.add_argument("customization", nargs="?")
    parser.add_argument("--icons", nargs=2, metavar=("ATLAS_PNG", "INKATLAS_JSON"))
    parser.add_argument("--grid", type=int, default=48)
    args = parser.parse_args()
    if not args.customization and not args.icons:
        parser.error("give a customization JSON or --icons")
    profiles = load_profiles(args.profiles)
    references = load_icons(*args.icons) if args.icons else load_swatches(args.customization)
    names = sorted(n for n, s in references.items() if n in profiles and any(s))
    print(f"{len(names)} profiles with a non-black reference")
    for label, fn in HYPOTHESES.items():
        angles, exposures = [], []
        for name in names:
            ids, root = profiles[name]
            acc = [0.0, 0.0, 0.0]
            for a in range(args.grid):
                for b in range(args.grid):
                    o = fn(samp(root, (a + .5) / args.grid), samp(ids, (b + .5) / args.grid))
                    acc = [x + y for x, y in zip(acc, o)]
            p = [x / args.grid ** 2 for x in acc]
            s = references[name]
            dot = sum(x * y for x, y in zip(p, s))
            norm = math.sqrt(sum(x * x for x in p) * sum(y * y for y in s))
            angles.append(math.degrees(math.acos(max(-1, min(1, dot / norm)))) if norm else float("nan"))
            exposures.append(lum(s) / lum(p) if lum(p) > 0 else float("nan"))
        spread = statistics.pstdev([math.log(e) for e in exposures if e > 0])
        print(f"{label:52s} median angle {statistics.median(angles):5.2f} deg, mean {statistics.mean(angles):5.2f}, "
              f"median exposure {statistics.median(exposures):.3f}, log-exposure spread {spread:.2f}")


if __name__ == "__main__":
    main()
