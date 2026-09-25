"""Asset-free measurement of how face-decal meshes sit on the player head (experiment 017).

Reads WolvenKit JSON of the installed 2.31 female head, vanilla face decals, the built-in eye
plate and optional mod decals, all kept in ignored folders, and prints/writes only numbers.

  python experiments/017-plate-depth/measure_offsets.py --json DIR [--plate-json DIR]
      [--mod-json DIR] [--output experiments/017-plate-depth/offset-evidence.json]

DIR must hold `h0_000_pwa_c__basehead.mesh.json`, `h0_000_pwa__morphs.morphtarget.json` and the
vanilla `hx_000_pwa_c__basehead_<name>.mesh.json` / `hx_000_pwa__morphs_<name>.morphtarget.json`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from redmesh import (candidate_faces, decode_blob, decode_morph, load_json, morphed,  # noqa: E402
                     signed_distance)

DECALS = ["makeup_eyes_01", "makeup_lips_01", "makeup_freckles_01", "pimples_01"]
MM = 1000.0


def stats(values: np.ndarray) -> dict:
    v = np.asarray(values, dtype=np.float64) * MM
    return {"min": round(float(v.min()), 4), "p1": round(float(np.percentile(v, 1)), 4),
            "median": round(float(np.median(v)), 4), "p99": round(float(np.percentile(v, 99)), 4),
            "max": round(float(v.max()), 4)}


def unit(v: np.ndarray) -> np.ndarray:
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-30)


def file_sha(path: str) -> str:
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def per_target(decal_morph, head_morph, cand) -> dict:
    """Signed distance of every morphed decal vertex to the morphed head, per target."""
    head = head_morph.base
    worst, medians, below = [], [], 0
    for t in range(len(head_morph.names)):
        sd, _ = signed_distance(morphed(decal_morph, t), morphed(head_morph, t), head.faces, cand, head.normals)
        worst.append((float(sd.min()), head_morph.names[t]))
        medians.append(float(np.median(sd)))
        below += int((sd < 0).sum())
    worst.sort()
    return {"worstTargets": [{"target": name, "minMm": round(v * MM, 4)} for v, name in worst[:5]],
            "medianOfMediansMm": round(float(np.median(medians)) * MM, 4),
            "verticesBelowHeadAcrossTargets": below}


def lifted_plate(plate_morph, amount: float):
    """Lift base positions along the stored shading normal; carry each target's normal change."""
    base = plate_morph.base
    n0 = unit(base.normals)
    lifted = type(plate_morph)(base=type(base)(base.positions + amount * n0, base.normals, base.uv0, base.faces,
                                               base.skin, base.vertex_factory, base.lod_masks),
                               names=plate_morph.names, deltas=[], normal_deltas=plate_morph.normal_deltas)
    for t, deltas in enumerate(plate_morph.deltas):
        out = {}
        for v, d in deltas.items():
            dn = plate_morph.normal_deltas[t].get(v, np.zeros(3))
            out[v] = d + amount * (unit(base.normals[v] + dn) - n0[v])
        lifted.deltas.append(out)
    return lifted


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", required=True)
    parser.add_argument("--plate-json")
    parser.add_argument("--mod-json")
    parser.add_argument("--output")
    args = parser.parse_args()
    path = lambda name: os.path.join(args.json, name)  # noqa: E731
    head_morph = decode_morph(load_json(path("h0_000_pwa__morphs.morphtarget.json")))
    head_mesh = decode_blob(load_json(path("h0_000_pwa_c__basehead.mesh.json"))["Data"]["RootChunk"]["renderResourceBlob"]["Data"])
    head = head_morph.base
    assert np.array_equal(head_mesh.positions, head.positions), "head mesh and morph base differ"
    hn = unit(head.normals)
    report: dict = {"schema": "xfs/plate-depth-evidence-1", "units": "millimetres; + = outside the head along its normals",
                    "head": {"vertices": len(head.positions), "triangles": len(head.faces),
                             "lodLevels": 1, "note": "lodLevelInfo [0], renderLODs [0], one chunk with lodMask 1"},
                    "decals": {}}
    for name in DECALS:
        mesh_doc = load_json(path(f"hx_000_pwa_c__basehead_{name}.mesh.json"))
        root = mesh_doc["Data"]["RootChunk"]
        mesh = decode_blob(root["renderResourceBlob"]["Data"])
        morph = decode_morph(load_json(path(f"hx_000_pwa__morphs_{name}.morphtarget.json")))
        assert np.allclose(mesh.positions, morph.base.positions), name
        cand = candidate_faces(mesh.positions, head.positions, head.faces, 32)
        sd, _ = signed_distance(mesh.positions, head.positions, head.faces, cand, head.normals)
        entry = {"vertices": len(mesh.positions), "chunks": len(mesh.lod_masks), "lodMasks": mesh.lod_masks,
                 "lodLevelInfo": root.get("lodLevelInfo"), "vertexFactory": mesh.vertex_factory,
                 "neutralSignedDistance": stats(sd)}
        # Construction test: nearest head vertex after removing a candidate normal offset.
        best = None
        for amount in (0.00030, 0.00035, 0.00038, 0.00040, 0.00042, 0.00045):
            shifted = head.positions + amount * hn
            nearest = np.array([((shifted - p) ** 2).sum(-1).argmin() for p in mesh.positions])
            resid = np.linalg.norm(mesh.positions - shifted[nearest], axis=1)
            if best is None or np.median(resid) < best[1]:
                best = (amount, float(np.median(resid)), nearest, resid)
        entry["bestNormalOffset"] = {"amountMm": round(best[0] * MM, 3), "medianResidualMm": round(best[1] * MM, 5),
                                     "p99ResidualMm": round(float(np.percentile(best[3], 99)) * MM, 4),
                                     "distinctHeadVertices": int(len(set(best[2].tolist())))}
        if name in ("makeup_eyes_01", "makeup_freckles_01"):
            entry["morphs"] = per_target(morph, head_morph, cand)
        report["decals"][name] = entry
    if args.plate_json:
        pm = decode_morph(load_json(os.path.join(args.plate_json, "xfs_eye_plate.morphtarget.json")))
        cand = candidate_faces(pm.base.positions, head.positions, head.faces, 32)
        plate = {"vertices": len(pm.base.positions)}
        for amount in (0.0, 0.0001, 0.0002, 0.0004):
            lifted = lifted_plate(pm, amount)
            sd, _ = signed_distance(lifted.base.positions, head.positions, head.faces, cand, head.normals)
            plate[f"lift{amount * MM:.1f}mm"] = {"neutralSignedDistance": stats(sd), "morphs": per_target(lifted, head_morph, cand)}
        report["builtInPlate"] = plate
    if args.mod_json:
        van = decode_blob(load_json(path("hx_000_pwa_c__basehead_makeup_eyes_01.mesh.json"))["Data"]["RootChunk"]["renderResourceBlob"]["Data"])
        mods = {}
        for stem in ("xfea", "winterkissed_w"):
            file = os.path.join(args.mod_json, f"{stem}.mesh.json")
            if not os.path.exists(file):
                continue
            m = decode_blob(load_json(file)["Data"]["RootChunk"]["renderResourceBlob"]["Data"])
            same = m.positions.shape == van.positions.shape and float(np.abs(m.positions - van.positions).max()) == 0.0
            mods[stem] = {"vertices": len(m.positions), "positionsEqualVanillaEyeMakeup": same}
        report["modDecals"] = mods
    text = json.dumps(report, indent=2)
    print(text)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")


if __name__ == "__main__":
    main()
