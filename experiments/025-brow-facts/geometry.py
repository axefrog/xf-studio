"""Brow strip geometry facts: metric, orientation, footprints, tangent frame (experiment 025).

Reads WolvenKit 9.0.1 bound GLB exports of the vanilla female and male brow meshes
(heb_000_pwa_c__basehead / heb_000_pma_c__basehead) from an ignored local extract, and
writes aggregate results to generated/geometry.json plus mask PNGs. Nothing extracted is
copied into the repository.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from common import HERE, Glb

MESHES = {
    "female": "player_female_average/h0_000_pwa_c__basehead/heb_000_pwa_c__basehead.glb",
    "male": "player_man_average/h0_000_pma_c__basehead/heb_000_pma_c__basehead.glb",
}
W, H = 2048, 1024  # authoring resolution (design default); a texel is 1/W x 1/H UV


def wq(values: np.ndarray, weights: np.ndarray, qs=(0.0, 0.05, 0.5, 0.95, 1.0)) -> list[float]:
    """Weighted quantiles."""
    order = np.argsort(values)
    v, w = values[order], weights[order]
    c = np.cumsum(w) / w.sum()
    return [float(np.round(v[min(len(v) - 1, np.searchsorted(c, q))], 4)) for q in qs]


def jacobians(m: dict) -> dict:
    """Per-triangle dP/du, dP/dv in mm per UV unit (glTF UV)."""
    P, UV, I = m["P"] * 1000.0, m["UV"], m["I"]
    e1, e2 = P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]]
    t1, t2 = UV[I[:, 1]] - UV[I[:, 0]], UV[I[:, 2]] - UV[I[:, 0]]
    det = t1[:, 0] * t2[:, 1] - t1[:, 1] * t2[:, 0]
    ok = np.abs(det) > 1e-12
    d = np.where(ok, det, 1.0)[:, None]
    dPdu = (e1 * t2[:, 1:2] - e2 * t1[:, 1:2]) / d
    dPdv = (e2 * t1[:, 0:1] - e1 * t2[:, 0:1]) / d
    area3 = 0.5 * np.linalg.norm(np.cross(e1, e2), axis=1)
    areauv = 0.5 * np.abs(det)
    return dict(dPdu=dPdu, dPdv=dPdv, area=area3, areauv=areauv, det=det, ok=ok)


def raster_ids(m: dict, tris: np.ndarray) -> np.ndarray:
    """Triangle id per texel centre (-1 outside), glTF UV with v down the image rows."""
    ids = np.full((H, W), -1, np.int32)
    UV = m["UV"] * np.array([W, H])
    for t in tris:
        a, b, c = UV[m["I"][t]]
        x0, x1 = int(np.floor(min(a[0], b[0], c[0]))), int(np.ceil(max(a[0], b[0], c[0])))
        y0, y1 = int(np.floor(min(a[1], b[1], c[1]))), int(np.ceil(max(a[1], b[1], c[1])))
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W - 1), min(y1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        l3 = 1 - l1 - l2
        inside = (l1 >= -1e-9) & (l2 >= -1e-9) & (l3 >= -1e-9)
        sub = ids[y0:y1 + 1, x0:x1 + 1]
        sub[inside] = t
    return ids


def bbox(mask: np.ndarray) -> list[float]:
    ys, xs = np.nonzero(mask)
    return [round(xs.min() / W, 4), round((xs.max() + 1) / W, 4), round(ys.min() / H, 4), round((ys.max() + 1) / H, 4)]


def analyse(name: str, m: dict) -> tuple[dict, dict]:
    P, UV, I = m["P"], m["UV"], m["I"]
    cx = P[I].mean(1)[:, 0]
    tri_side = np.where(cx > 0, "+x", "-x")
    # Which body side is +x: count weight on l_/r_ joints for +x vertices.
    lw = np.array([n.startswith("l_") for n in m["joints"]])
    rw = np.array([n.startswith("r_") for n in m["joints"]])
    J, Wt = m["J"].astype(int), m["W"]
    vx = P[:, 0] > 0
    l_on_px = float((Wt[vx] * lw[J[vx]]).sum())
    r_on_px = float((Wt[vx] * rw[J[vx]]).sum())
    px_is = "left" if l_on_px > r_on_px else "right"
    j = jacobians(m)
    su = np.linalg.norm(j["dPdu"], axis=1)
    sv = np.linalg.norm(j["dPdv"], axis=1)
    cosang = np.einsum("ij,ij->i", j["dPdu"], j["dPdv"]) / np.maximum(su * sv, 1e-12)
    shear = np.degrees(np.arcsin(np.clip(cosang, -1, 1)))  # 0 = orthogonal
    ok, A = j["ok"], j["area"]
    res = {"vertices": int(len(P)), "triangles": int(len(I)), "plusXSide": px_is,
           "uvBounds": [round(float(UV[:, 0].min()), 4), round(float(UV[:, 0].max()), 4),
                        round(float(UV[:, 1].min()), 4), round(float(UV[:, 1].max()), 4)],
           "surfaceAreaMm2": round(float(A.sum()), 1)}
    # Orientation: u against |x| (medial -> lateral), v against height (glTF +y up).
    for s in ("+x", "-x"):
        vm = (P[:, 0] > 0) if s == "+x" else (P[:, 0] < 0)
        res[f"orientation{s}"] = {
            "corr_u_absx": round(float(np.corrcoef(UV[vm, 0], np.abs(P[vm, 0]))[0, 1]), 3),
            "corr_v_height": round(float(np.corrcoef(UV[vm, 1], P[vm, 1])[0, 1]), 3),
            "u_at_most_medial": round(float(UV[vm][np.argmin(np.abs(P[vm, 0])), 0]), 3),
            "u_at_most_lateral": round(float(UV[vm][np.argmax(np.abs(P[vm, 0])), 0]), 3),
        }
    # Metric: mm per UV unit along u and v, per side; area-weighted quantiles.
    for s in ("+x", "-x"):
        k = ok & (tri_side == s)
        res[f"metric{s}"] = {
            "triangles": int(k.sum()), "areaMm2": round(float(A[k].sum()), 1),
            "mmPerU_q0_5_50_95_100": wq(su[k], A[k]), "mmPerV_q0_5_50_95_100": wq(sv[k], A[k]),
            "shearDeg_q": wq(np.abs(shear[k]), A[k]),
            "globalMmPerU": round(float(np.sqrt((su[k] ** 2 * A[k]).sum() / A[k].sum())), 2),
            "globalMmPerV": round(float(np.sqrt((sv[k] ** 2 * A[k]).sum() / A[k].sum())), 2),
            "mm2PerUv2": round(float(A[k].sum() / j["areauv"][k].sum()), 1),
        }
    # Deviation from one constant diagonal metric (both sides together): max/min length
    # ratio over directions of G0^-1/2 G G0^-1/2.
    su0 = np.sqrt((su[ok] ** 2 * A[ok]).sum() / A[ok].sum())
    sv0 = np.sqrt((sv[ok] ** 2 * A[ok]).sum() / A[ok].sum())
    dev = np.zeros(len(I))
    for t in np.nonzero(ok)[0]:
        Jm = np.stack([j["dPdu"][t] / su0, j["dPdv"][t] / sv0], 1)
        sig = np.linalg.svd(Jm, compute_uv=False)
        dev[t] = max(abs(sig[0] - 1), abs(sig[1] - 1))
    res["constantScale"] = {"mmPerU": round(float(su0), 2), "mmPerV": round(float(sv0), 2),
                            "texelMm2048x1024": [round(float(su0 / 2048), 4), round(float(sv0 / 1024), 4)],
                            "maxLengthError_q0_5_50_95_100": wq(dev[ok], A[ok]),
                            "areaShareWithin5pct": round(float(A[ok & (dev <= 0.05)].sum() / A[ok].sum()), 3),
                            "areaShareWithin10pct": round(float(A[ok & (dev <= 0.10)].sum() / A[ok].sum()), 3),
                            "areaShareWithin20pct": round(float(A[ok & (dev <= 0.20)].sum() / A[ok].sum()), 3)}
    # Tangent frame: stored tangent vs dP/du; B = cross(N, T) * w vs dP/dv.
    vt = {s: [] for s in ("+x", "-x")}
    acc_du = np.zeros((len(P), 3)); acc_dv = np.zeros((len(P), 3))
    for t in np.nonzero(ok)[0]:
        for vi in I[t]:
            acc_du[vi] += j["dPdu"][t] * A[t]
            acc_dv[vi] += j["dPdv"][t] * A[t]
    T, N = m["T"][:, :3], m["N"]
    w = np.sign(m["T"][:, 3])
    B = np.cross(N, T) * w[:, None]
    du = acc_du / np.maximum(np.linalg.norm(acc_du, axis=1, keepdims=True), 1e-12)
    dv = acc_dv / np.maximum(np.linalg.norm(acc_dv, axis=1, keepdims=True), 1e-12)
    for s in ("+x", "-x"):
        vm = (P[:, 0] > 0) if s == "+x" else (P[:, 0] < 0)
        cT = np.einsum("ij,ij->i", T[vm], du[vm])
        cB = np.einsum("ij,ij->i", B[vm], dv[vm])
        vt[s] = {"w_values": sorted(set(np.round(m["T"][vm, 3], 3).tolist())),
                 "cos_T_dPdu_q": [round(float(q), 3) for q in np.quantile(cT, [0, 0.05, 0.5, 1])],
                 "cos_B_dPdv_q": [round(float(q), 3) for q in np.quantile(cB, [0, 0.05, 0.5, 1])],
                 "uvHandedness_sign_of_dot(cross(dPdu,dPdv),N)": sorted(set(np.sign(np.einsum(
                     "ij,ij->i", np.cross(du[vm], dv[vm]), N[vm])).astype(int).tolist()))}
    res["tangentFrame"] = vt
    # Footprints per side at 2048 x 1024 (glTF v down the rows).
    ids = {s: raster_ids(m, np.nonzero(tri_side == s)[0]) for s in ("+x", "-x")}
    masks = {s: ids[s] >= 0 for s in ids}
    res["footprint"] = {s: {"texels": int(masks[s].sum()), "bbox_u0u1v0v1": bbox(masks[s])} for s in masks}
    both = masks["+x"] & masks["-x"]
    res["footprint"]["bothSides"] = {"texels": int(both.sum()), "bbox_u0u1v0v1": bbox(both)}
    # Shared UVs: largest UV distance between mirror-matched vertices.
    Pm = P.copy(); Pm[:, 0] *= -1
    d2 = ((Pm[:, None, :] - P[None, :, :]) ** 2).sum(-1)
    jn = d2.argmin(1)
    duv = np.abs(UV - UV[jn]).max(1) * np.array([W])[0]
    res["mirrorPairs"] = {"maxMirrorPosErrMm": round(float(np.sqrt(d2[np.arange(len(P)), jn]).max() * 1000), 3),
                          "uvDiffTexels2048_q0_50_95_100": [round(float(q), 2) for q in np.quantile(duv, [0, 0.5, 0.95, 1])],
                          "shareSameUV_within1texel": round(float((duv <= 1).mean()), 3)}
    extra = {"ids": ids, "masks": masks, "both": both, "su": su, "sv": sv, "dPdu": j["dPdu"], "dPdv": j["dPdv"]}
    return res, extra


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--extracts", type=Path, required=True,
                    help="research/consumers/brows-cheeks (ignored extract) of the main checkout")
    ap.add_argument("--out", type=Path, default=HERE / "generated")
    a = ap.parse_args()
    root = a.extracts / "extracted/uncook/base/characters/head/player_base_heads"
    a.out.mkdir(parents=True, exist_ok=True)
    results, extras = {}, {}
    for g, rel in MESHES.items():
        m = Glb(root / rel).mesh()
        results[g], extras[g] = analyse(g, m)
    f, mm = extras["female"], extras["male"]
    inter = f["both"] & mm["both"]
    union = f["both"] | mm["both"]
    results["intersection"] = {
        "texels": int(inter.sum()), "shareOfFemale": round(float(inter.sum() / f["both"].sum()), 3),
        "shareOfMale": round(float(inter.sum() / mm["both"].sum()), 3), "bbox_u0u1v0v1": bbox(inter),
        "femaleOnlyTexels": int((f["both"] & ~mm["both"]).sum()), "maleOnlyTexels": int((mm["both"] & ~f["both"]).sum()),
        "unionTexels": int(union.sum())}
    # Metric ratio male/female at the same texel (intersection, +x side each).
    ratios_u, ratios_v = [], []
    fi, mi = f["ids"]["+x"], mm["ids"]["+x"]
    sel = (fi >= 0) & (mi >= 0)
    ratios_u = mm["su"][mi[sel]] / f["su"][fi[sel]]
    ratios_v = mm["sv"][mi[sel]] / f["sv"][fi[sel]]
    results["maleOverFemaleMetricAtSameTexel"] = {
        "u_q0_5_50_95_100": [round(float(q), 3) for q in np.quantile(ratios_u, [0, 0.05, 0.5, 0.95, 1])],
        "v_q0_5_50_95_100": [round(float(q), 3) for q in np.quantile(ratios_v, [0, 0.05, 0.5, 0.95, 1])]}
    # Safe interior: intersection eroded by k texels (bleed margin for mips / filtering).
    def erode(mask: np.ndarray, k: int) -> np.ndarray:
        out = mask.copy()
        for _ in range(k):
            s = out.copy()
            s[1:, :] &= out[:-1, :]; s[:-1, :] &= out[1:, :]; s[:, 1:] &= out[:, :-1]; s[:, :-1] &= out[:, 1:]
            out = s
        return out
    results["intersectionEroded"] = {f"{k}texels": int(erode(inter, k).sum()) for k in (8, 16, 32)}
    for name, mask in (("female", f["both"]), ("male", mm["both"]), ("intersection", inter),
                       ("female_plusx", f["masks"]["+x"]), ("female_minusx", f["masks"]["-x"])):
        Image.fromarray((mask * 255).astype(np.uint8)).save(a.out / f"footprint_{name}.png")
    np.save(a.out / "footprint_intersection.npy", inter)
    tables = {g: {"dPdu_mm": np.round(extras[g]["dPdu"], 4).tolist(), "dPdv_mm": np.round(extras[g]["dPdv"], 4).tolist()} for g in extras}
    (a.out / "jacobians.json").write_text(json.dumps(tables))
    (a.out / "geometry.json").write_text(json.dumps(results, indent=1))
    print(json.dumps(results, indent=1))


if __name__ == "__main__":
    main()
