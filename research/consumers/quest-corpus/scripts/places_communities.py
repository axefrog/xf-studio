"""Pin every community instance of the world registry to a district (research area D).

  python places_communities.py --registry registry.json --areas loc_areas.json [--streamable streamable.json] \
      [--characters characters.json] --out communities.json

Inputs
  registry.json     `places_join.py registry`: area nodes of the regular communities, registry instances, AI spots.
  loc_areas.json    `places_index.py areas`: district polygons.
  streamable.json   {sector: [area node, ...]} for the streamable and background communities, as `places_streamable.py` writes it.
  characters.json   optional {character record: {"aff": "<affiliation without Factions.>"}} for the gang mix.

A community's spots (global node ids) are looked up in the registry's spot table and each spot is given a district and a venue by
the point-in-polygon index. The community takes the district that holds most of its spots; `share` is that majority's fraction.
"""
import argparse, collections, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from places_index import DistrictIndex


def pin(nodes_by_sid, instances, spots, index):
    rows = []
    for sid, nodes in nodes_by_sid.items():
        pts = []
        for it in nodes:
            for ids in it["ents"].values():
                pts.extend(spots[s][:3] for s in ids if s in spots)
        if not pts:  # fall back to the area node's own placement
            for it in nodes:
                pts.extend(tuple(p) for p in it.get("pl", []))
        if not pts:
            continue
        votes = collections.Counter(index.classify(*p) for p in pts)
        (district, venue), n = votes.most_common(1)[0]
        inst = instances.get(sid)
        rows.append(dict(sid=sid, type=inst["type"] if inst else "unknown", district=district, venue=venue, spots=len(pts), share=n / len(pts),
                         centroid=(sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))))
    return rows


def gang_mix(rows, instances, characters):
    """Entry quantity by affiliation per district: an entry's weight is the largest quantity of any of its periods."""
    mix = collections.defaultdict(collections.Counter)
    for r in rows:
        inst = instances.get(r["sid"])
        for rec, _name, phases in (inst["ents"] or []):
            aff = characters.get(rec, {}).get("aff") or ("Vehicle" if rec.startswith("Vehicle") else "?")
            mix[r["district"]][aff] += max([t[1] for ph in phases for t in ph[1]] or [0])
    return mix


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--registry", required=True)
    ap.add_argument("--areas", required=True)
    ap.add_argument("--streamable")
    ap.add_argument("--characters")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    reg = json.load(open(a.registry))
    instances = {str(i["id"]): i for i in reg["instances"]}
    spots = {int(k): v for k, v in reg["spots"].items()}
    index = DistrictIndex(json.load(open(a.areas)))
    nodes = collections.defaultdict(list)
    for area in reg["areas"]:
        nodes[str(area["sid"])].append(area)
    if a.streamable:
        for items in json.load(open(a.streamable)).values():
            for it in items:
                nodes[str(it["sid"])].append(it)
    rows = pin(nodes, instances, spots, index)
    out = dict(communities=rows)
    if a.characters:
        mix = gang_mix(rows, instances, json.load(open(a.characters)))
        out["gangMix"] = {str(d): dict(c) for d, c in mix.items()}
    json.dump(out, open(a.out, "w"))
    print(len(rows), "communities pinned;", collections.Counter(r["type"] for r in rows))
