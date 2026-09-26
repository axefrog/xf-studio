"""Native vertex UVs and tangent signs of the brow meshes, against the GLB export (experiment 025).

Decodes stream 1 (UV0, float16 x 2) and stream 2 (normal and tangent, PT_Dec4 =
R10G10B10A2 UNORM, expanded as x*2-1 by the double-diffuse vertex program
17205971338381575357) of the serialized mesh's render buffer, and compares them with
WolvenKit's GLB export to establish the UV flip and whether the tangent sign survives export.
"""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path

import numpy as np

from common import HERE, Glb, cr2w

PAIRS = {
    "female": ("player_female_average/heb_000_pwa_c__basehead.mesh.json",
               "player_female_average/h0_000_pwa_c__basehead/heb_000_pwa_c__basehead.glb"),
    "male": ("player_man_average/heb_000_pma_c__basehead.mesh.json",
             "player_man_average/h0_000_pma_c__basehead/heb_000_pma_c__basehead.glb"),
}


def dec4(u32: np.ndarray) -> np.ndarray:
    x = (u32 & 1023) / 1023.0
    y = ((u32 >> 10) & 1023) / 1023.0
    z = ((u32 >> 20) & 1023) / 1023.0
    w = ((u32 >> 30) & 3) / 3.0
    return np.stack([x, y, z, w], 1) * 2 - 1


def native(mesh_json: Path) -> dict:
    r = cr2w(mesh_json)
    b = r["renderResourceBlob"]["Data"]
    buf = base64.b64decode(b["renderBuffer"]["Bytes"])
    ci = b["header"]["renderChunkInfos"][0]
    offs = ci["chunkVertices"]["byteOffsets"]["Elements"]
    n = ci["numVertices"]
    uv = np.frombuffer(buf, np.float16, count=n * 2, offset=offs[1]).reshape(n, 2).astype(np.float64)
    nt = np.frombuffer(buf, np.uint32, count=n * 2, offset=offs[2]).reshape(n, 2)
    q = b["header"]
    pos = np.frombuffer(buf, np.int16, count=n * 12, offset=offs[0]).reshape(n, 12)[:, :4].astype(np.float64) / 32767.0
    s = q["quantizationScale"]; o = q["quantizationOffset"]
    P = pos[:, :3] * np.array([s["X"], s["Y"], s["Z"]]) + np.array([o["X"], o["Y"], o["Z"]])
    import hashlib
    return {"UV": uv, "N": dec4(nt[:, 0]), "T": dec4(nt[:, 1]), "P": P, "sha": hashlib.sha256(buf).hexdigest()}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--extracts", type=Path, required=True, help="research/consumers/brows-cheeks")
    ap.add_argument("--out", type=Path, default=HERE / "generated")
    a = ap.parse_args()
    js = a.extracts / "json/base/characters/head/player_base_heads"
    gl = a.extracts / "extracted/uncook/base/characters/head/player_base_heads"
    res = {}
    for g, (mj, glb) in PAIRS.items():
        nat = native(js / mj)
        m = Glb(gl / glb).mesh()
        # Native Z-up positions against GLB Y-up: WolvenKit maps (x, y, z) -> (x, z, -y).
        conv = np.stack([nat["P"][:, 0], nat["P"][:, 2], -nat["P"][:, 1]], 1)
        pos_err = float(np.abs(conv - m["P"]).max() * 1000)
        du = float(np.abs(nat["UV"][:, 0] - m["UV"][:, 0]).max())
        dv_same = float(np.abs(nat["UV"][:, 1] - m["UV"][:, 1]).max())
        dv_flip = float(np.abs(1 - nat["UV"][:, 1] - m["UV"][:, 1]).max())
        wn, wg = np.sign(nat["T"][:, 3]), np.sign(m["T"][:, 3])
        Tn = np.stack([nat["T"][:, 0], nat["T"][:, 2], -nat["T"][:, 1]], 1)
        Tn /= np.linalg.norm(Tn, axis=1, keepdims=True)
        cosT = np.einsum("ij,ij->i", Tn, m["T"][:, :3])
        px = m["P"][:, 0] > 0
        res[g] = {"renderBufferSha256": nat["sha"], "vertexOrderMatches_posErrMm": round(pos_err, 3), "uMaxDiff": round(du, 5),
                  "vMaxDiff_same": round(dv_same, 5), "vMaxDiff_flipped(1-v)": round(dv_flip, 5),
                  "nativeTangentW_values": sorted(set(np.round(nat["T"][:, 3], 3).tolist())),
                  "nativeW_plusX": sorted(set(wn[px].astype(int).tolist())), "nativeW_minusX": sorted(set(wn[~px].astype(int).tolist())),
                  "glbW_plusX": sorted(set(wg[px].astype(int).tolist())), "glbW_minusX": sorted(set(wg[~px].astype(int).tolist())),
                  "shareWSignEqual": round(float((wn == wg).mean()), 3),
                  "cos(nativeT, glbT)_min": round(float(cosT.min()), 3)}
    (a.out / "native_frame.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
