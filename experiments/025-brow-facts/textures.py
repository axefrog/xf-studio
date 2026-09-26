"""Brow texture facts: formats, mips, colour spaces, levels, footprint fit, normal convention (experiment 025).

Reads serialized XBMs (WolvenKit 9.0.1 JSON, ignored local extracts) of the vanilla brow
texture sets and of three installed brow mods, decodes every stored mip with Pillow's BCn
decoder, and writes aggregate statistics to generated/textures.json. Run geometry.py first:
the footprint test reads generated/footprint_*.png.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

from common import HERE, fnv1a64, xbm

VANILLA_DIR = "base\\characters\\common\\character_customisation_items\\eyebrows\\textures\\"
USED_SETS = ["01", "02", "03", "04", "05", "06", "07", "08", "12", "13", "14", "15", "16", "17", "18", "19"]
UNUSED_SETS = ["09", "10", "11"]
MODS = {
    "arkhe2_style18": ("arkhe\\ccxl_eyebrows_02\\textures\\", "ark_heb__base_d18", "ark_heb_wa__base_ds18", "ark_heb__base_n18"),
    "evenmorebrows_01": ("coralinekoralina\\ccxl\\evenmorebrows_ccxl\\textures\\", "ck_emb_01_d", "ck_emb_01_ds", "ck_emb_01_n"),
    "arkhe_set01_replaces12": (VANILLA_DIR, "heb__base_d12", "heb_wa__base_ds12", "heb__base_n12"),
}


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def box(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    if h == 1 and w == 1:
        return img
    f = img.astype(np.float64)
    if h > 1:
        f = 0.5 * (f[0::2] + f[1::2])
    if w > 1:
        f = 0.5 * (f[:, 0::2] + f[:, 1::2])
    return f


def resample(mask: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Share of each target texel covered by the 2048 x 1024 footprint mask."""
    H, W = mask.shape
    h, w = shape
    return mask.reshape(h, H // h, w, W // w).mean(axis=(1, 3))


def content_bbox(a: np.ndarray, thr: int = 8) -> list[float]:
    ys, xs = np.nonzero(a > thr)
    if len(xs) == 0:
        return []
    h, w = a.shape
    return [round(xs.min() / w, 3), round((xs.max() + 1) / w, 3), round(ys.min() / h, 3), round((ys.max() + 1) / h, 3)]


def diffuse_stats(x: dict, masks: dict) -> dict:
    img = x["images"][0]
    a = img[..., 3].astype(np.float64) / 255.0
    cov = a * a                       # program: coverage = p^2 (no powder)
    rgb = img[..., :3].astype(np.float64)
    lin = srgb_to_linear(rgb) if x["isGamma"] else rgb / 255.0
    w = cov / max(cov.sum(), 1e-12)
    grey = np.abs(rgb[..., 0] - rgb[..., 1]).max(), np.abs(rgb[..., 1] - rgb[..., 2]).max()
    covered = cov > 0.05
    out = {
        "alphaMax": int(img[..., 3].max()), "alphaMeanOverTexture": round(float(a.mean()), 4),
        "coverageMeanOverTexture": round(float(cov.mean()), 4),
        "contentBbox_gpuRows": content_bbox(img[..., 3]),
        "contentBbox_flipped": content_bbox(img[::-1, :, 3]),
        "rgbGreyscale_maxAbs(R-G),(G-B)": [int(grey[0]), int(grey[1])],
        "rgbGreyscale_underCoverage_maxAbs(R-G)": int(np.abs(rgb[..., 0] - rgb[..., 1])[covered].max()) if covered.any() else None,
        "rgbByte_coverageWeighted_mean": [round(float((rgb[..., c] * w).sum()), 1) for c in range(3)],
        "rgbByte_underCoverage_q5_50_95": [int(q) for q in np.quantile(rgb[..., 1][covered], [0.05, 0.5, 0.95])] if covered.any() else None,
        "rgbLinear_coverageWeighted_mean": round(float((lin[..., 1] * w).sum()), 4),
        "rgbByte_whereAlphaZero_q50": [int(np.median(rgb[..., c][img[..., 3] == 0])) for c in range(3)] if (img[..., 3] == 0).any() else None,
    }
    # Footprint fit: share of coverage mass outside each footprint, for both row orientations.
    for orient, im in (("gpuRows", cov), ("flipped", cov[::-1])):
        for name, m in masks.items():
            inside = resample(m, im.shape)
            out[f"coverageOutside_{name}_{orient}"] = round(float((im * (1 - inside)).sum() / max(im.sum(), 1e-12)), 4)
    return out


def mip_stats(x: dict, channel: int, sqrt_domain: bool) -> dict:
    """Stored mip n+1 against a 2x2 box of stored mip n (alpha), and mean coverage per level."""
    errs, mean_cov = [], []
    ims = x["images"]
    for i, im in enumerate(ims):
        a = im[..., channel].astype(np.float64) / 255.0
        mean_cov.append(round(float((a * a).mean()), 5))
        if i + 1 < len(ims):
            ref = box(im[..., channel].astype(np.float64))
            nxt = ims[i + 1][..., channel].astype(np.float64)
            if ref.shape == nxt.shape:
                errs.append(round(float(np.abs(ref - nxt).mean()), 3))
            if sqrt_domain and i == 0:
                pass
    # How much the vanilla chain thins coverage relative to mip 0 (mean p^2 ratio per level).
    thinning = [round(m / mean_cov[0], 3) if mean_cov[0] else None for m in mean_cov]
    return {"alphaBoxMAE_bytes_perLevel": errs[:8], "meanCoverage_p2_ratioToMip0": thinning[:9]}


def normal_stats(x: dict, d_alpha: np.ndarray | None) -> dict:
    img = x["images"][0].astype(np.float64)
    nx, ny = img[..., 0] / 255.0 * 2 - 1, img[..., 1] / 255.0 * 2 - 1
    nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0, 1))
    tilt = np.degrees(np.arccos(np.clip(nz, -1, 1)))
    gate = np.clip(50 - 50 * nz, 0, 1)
    out = {"channelBytes_q50": [int(np.median(img[..., c])) for c in range(img.shape[2])],
           "blueChannelMax": int(img[..., 2].max()) if img.shape[2] > 2 else None,
           "tiltDeg_q50_95_99_max": [round(float(q), 2) for q in np.quantile(tilt, [0.5, 0.95, 0.99, 1.0])],
           "shareOfTexelsAtFullGate(>=11.5deg)": round(float((gate >= 1).mean()), 4),
           "shareOfTexelsGateAbove0.1": round(float((gate > 0.1).mean()), 4)}
    if d_alpha is not None and d_alpha.shape == nx.shape:
        a = d_alpha.astype(np.float64) / 255.0
        out["gateOutsideCoverage(a<0.05)_mean"] = round(float(gate[a < 0.05].mean()), 5)
        out["gateUnderCoverage(a>0.3)_mean"] = round(float(gate[a > 0.3].mean()), 4)
        # Convention: correlate the normal with the negative gradient of a height proxy (alpha).
        # Rows are taken as stored (GPU order); +u = +column; +row = down the stored image.
        gy, gx = np.gradient(a)
        k = (np.abs(gx) + np.abs(gy)) > 1e-3
        out["corr(nx, -dA/dcol)"] = round(float(np.corrcoef(nx[k], -gx[k])[0, 1]), 3)
        out["corr(ny, -dA/drow_gpu)"] = round(float(np.corrcoef(ny[k], -gy[k])[0, 1]), 3)
    return out


def blob_sha(path: Path) -> str:
    root = json.loads(path.read_text(encoding="utf-8"))["Data"]["RootChunk"]
    b64 = root["renderTextureResource"]["renderResourceBlobPC"]["Data"]["textureData"]["Bytes"]
    import base64
    return hashlib.sha256(base64.b64decode(b64)).hexdigest()


def summarise(path: Path, depot: str, kind: str, masks: dict, d_alpha=None) -> tuple[dict, dict]:
    x = xbm(path)
    head = {k: x[k] for k in ("header", "cooked", "mipCount", "compression", "rawFormat", "isGamma", "group",
                              "allowTextureDowngrade", "platformMipBiasPC", "bytes")}
    head["depotPath"] = depot
    head["fnv1a64"] = str(fnv1a64(depot))
    head["textureDataSha256"] = blob_sha(path)
    head["channels"] = int(x["images"][0].shape[2]) if x["images"][0].ndim == 3 else 1
    if kind == "d":
        head.update(diffuse_stats(x, masks))
        head.update(mip_stats(x, 3, True))
    elif kind == "ds":
        img = x["images"][0]
        head["rgbByte_q50"] = [int(np.median(img[..., c])) for c in range(3)]
        head["alphaMax"] = int(img[..., 3].max())
        head["alphaMean"] = round(float(img[..., 3].mean() / 255), 4)
        head["contentBbox_gpuRows"] = content_bbox(img[..., 3])
        head.update(mip_stats(x, 3, False))
    else:
        head.update(normal_stats(x, d_alpha))
    return head, x


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--vanilla-json", type=Path, required=True, help="research/consumers/brows-cheeks/json/xbm")
    ap.add_argument("--mods-json", type=Path, required=True, help="research/consumers/brows-cheeks-mods/json")
    ap.add_argument("--out", type=Path, default=HERE / "generated")
    a = ap.parse_args()
    masks = {n: np.asarray(Image.open(a.out / f"footprint_{n}.png")) > 127 for n in ("female", "male", "intersection")}
    res: dict = {"vanilla": {}, "vanillaUnused": {}, "mods": {}}
    for group, sets in (("vanilla", USED_SETS), ("vanillaUnused", UNUSED_SETS)):
        for s in sets:
            row = {}
            names = {"d": f"heb__base_d{s}", "ds": f"heb_wa__base_ds{s}", "n": f"heb__base_n{s}"}
            d_alpha = None
            for kind in ("d", "ds", "n"):
                p = a.vanilla_json / f"{names[kind]}.xbm.json"
                if not p.exists():
                    row[kind] = None
                    continue
                row[kind], x = summarise(p, VANILLA_DIR + names[kind] + ".xbm", kind, masks, d_alpha)
                if kind == "d":
                    d_alpha = x["images"][0][..., 3]
            res[group][s] = row
    for key, (folder, d, ds, n) in MODS.items():
        row, d_alpha = {}, None
        for kind, name in (("d", d), ("ds", ds), ("n", n)):
            row[kind], x = summarise(a.mods_json / f"{name}.xbm.json", folder + name + ".xbm", kind, masks, d_alpha)
            if kind == "d":
                d_alpha = x["images"][0][..., 3]
        res["mods"][key] = row
    (a.out / "textures.json").write_text(json.dumps(res, indent=1))
    print("wrote", a.out / "textures.json")


if __name__ == "__main__":
    main()
