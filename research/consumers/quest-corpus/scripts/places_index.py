"""District areas from serialised streaming sectors, and a point-in-polygon district index (research area D).

Step 1, `areas`: read WolvenKit-serialised `.streamingsector.json` files and write every node that carries a
`worldLocationAreaNotifier` (location, interior and trigger areas) with its polygon in world metres and its vertical band.
Step 2, `DistrictIndex`: answer "which district record and which venue holds this point?".

  python places_index.py areas --sectors FOLDER_OF_SECTOR_JSON --districts districts.json --out loc_areas.json

The outline buffer is a u32 count, that many (x, y, z, 1.0) float points in the node's local space, and a final float height
(WolvenKit's `AreaShapeOutline.cs` names the layout as a to-do). World points are the points scaled by the placement's scale,
rotated by its quaternion and moved by its position. The vertical band runs from the lowest world z up by height * scale z.
The rule for overlapping areas is: the smallest footprint whose band contains the point (the game itself uses the newest entry).
"""
import argparse, base64, collections, glob, json, struct

BS = chr(92)


def decode_outline(buf):
    b = base64.b64decode(buf)
    n = struct.unpack_from("<I", b, 0)[0]
    pts = [struct.unpack_from("<4f", b, 4 + 16 * i)[:3] for i in range(n)]
    height = struct.unpack_from("<f", b, 4 + 16 * n)[0] if len(b) >= 8 + 16 * n else None
    return pts, height


def rotate(q, v):
    i, j, k, r = q
    x, y, z = v
    tx, ty, tz = 2 * (j * z - k * y), 2 * (k * x - i * z), 2 * (i * y - j * x)
    return (x + r * tx + (j * tz - k * ty), y + r * ty + (k * tx - i * tz), z + r * tz + (i * ty - j * tx))


def read_areas(folder):
    out = []
    for f in sorted(glob.glob(folder + "/**/*.streamingsector.json", recursive=True)):
        rc = json.load(open(f))["Data"]["RootChunk"]
        placements = collections.defaultdict(list)
        for x in rc["nodeData"]["Data"]:
            placements[x["NodeIndex"]].append(x)
        sector = f.split("default")[-1].lstrip(BS + "/").replace(".streamingsector.json", "").replace(BS, "/")
        for i, node in enumerate(rc["nodes"]):
            d = node["Data"]
            notifiers = [m["Data"] for m in d.get("notifiers", []) or [] if m and "Data" in m]
            loc = [n for n in notifiers if n["$type"] == "worldLocationAreaNotifier"]
            if not loc or not d.get("outline"):
                continue
            pts, height = decode_outline(d["outline"]["Data"]["buffer"])
            for pl in placements[i]:
                p, q, s = pl["Position"], pl["Orientation"], pl["Scale"]
                quat = (q["i"], q["j"], q["k"], q["r"])
                world = []
                for (px, py, pz) in pts:
                    rx, ry, rz = rotate(quat, (px * s["X"], py * s["Y"], pz * s["Z"]))
                    world.append((rx + p["X"], ry + p["Y"], rz + p["Z"]))
                zlo = min(w[2] for w in world)
                out.append(dict(sector=sector, type=d["$type"], debug=d.get("debugName", {}).get("$value"),
                                district=loc[0]["districtID"]["$value"], enabled=loc[0]["isEnabled"],
                                notify=loc[0]["sendNewLocationNotification"], channels=loc[0]["includeChannels"],
                                notifiers=[n["$type"] for n in notifiers], npts=len(world),
                                zlo=zlo, zhi=zlo + (height or 0) * s["Z"], height=height, scale=(s["X"], s["Y"], s["Z"]),
                                poly=[(round(a, 2), round(b, 2), round(c, 2)) for a, b, c in world]))
    return out


def point_in_polygon(x, y, poly):
    inside, j = False, len(poly) - 1
    for i in range(len(poly)):
        xi, yi, xj, yj = poly[i][0], poly[i][1], poly[j][0], poly[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def footprint(poly):
    s = 0.0
    for i in range(len(poly)):
        x1, y1, x2, y2 = poly[i][0], poly[i][1], poly[(i + 1) % len(poly)][0], poly[(i + 1) % len(poly)][1]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


class DistrictIndex:
    """classify(x, y, z) -> (location district id or None, venue district id or None)."""

    def __init__(self, areas):
        self.loc, self.venue = [], []
        for a in areas:
            if not a["poly"] or not a["enabled"] or a["district"] in ("0", "Districts.0"):
                continue
            xs, ys = [p[0] for p in a["poly"]], [p[1] for p in a["poly"]]
            rec = dict(d=a["district"], poly=a["poly"], zlo=a["zlo"], zhi=a["zhi"], ar=footprint(a["poly"]),
                       bbox=(min(xs), min(ys), max(xs), max(ys)))
            (self.loc if a["type"] == "worldLocationAreaNode" else self.venue).append(rec)

    @staticmethod
    def _best(cands, x, y, z):
        best = None
        for r in cands:
            b = r["bbox"]
            if b[0] <= x <= b[2] and b[1] <= y <= b[3] and point_in_polygon(x, y, r["poly"]):
                if z is not None and not (r["zlo"] - 2 <= z <= r["zhi"] + 2):
                    continue
                if best is None or r["ar"] < best["ar"]:
                    best = r
        return best["d"] if best else None

    def classify(self, x, y, z=None):
        return self._best(self.loc, x, y, z), self._best(self.venue, x, y, z)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["areas"])
    ap.add_argument("--sectors", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    areas = read_areas(a.sectors)
    json.dump(areas, open(a.out, "w"))
    print(len(areas), "areas;", len({x["district"] for x in areas}), "district ids")
