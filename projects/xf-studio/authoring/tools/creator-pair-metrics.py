"""Matched-pair skin metrics for the creator preset (knowledge/creator-lighting.md §12, research/materials/shader-skin.md §11.8).

    python tools/creator-pair-metrics.py --game <game capture> --studio <studio render> [--studio <another> ...] --lut <decoded LUT .bin>
        --regions <regions.json> [--overlay <png>] [--json <out.json>]

Every colour is compared in scene-linear light: the mean display sRGB of a box (or each pixel of the face mask) is inverted through the
installed grade's full display transform, sRGB_encode(LUT(LogC3(x))), per channel by fixed-point refinement from the LUT's own grey
response. Exposure cancels in every reported number (ratios to the forehead and channel ratios).

The regions file names landmarks and boxes in the game frame's pixels and the landmarks in each Studio frame; an affine map fitted to
the landmarks carries the boxes and the face mask into the Studio frame:

    { "game": { "landmarks": { "eye_left": [x, y], ... }, "boxes": { "forehead": [cx, cy, w, h], ... },
                "mask": [[x, y], ...], "exclude": [[x0, y0, x1, y1], ...] },
      "studio": { "landmarks": { "eye_left": [x, y], ... } } }

Reports, per Studio frame against the game: forehead R/G (the §11.8 metric); every box's luminance relative to the forehead, with the
rms of the log ratios over the fit regions (§12.3's 0.31); R/G and B/G of the lit planes, the terminator band and the nose shadow (the
face mask's pixels split by luminance relative to the forehead); and the face's 5th-to-95th percentile luminance ratio (contrast).
Read-only: it writes only the optional overlay and JSON. Captures of a private V stay in ignored folders.
"""
import argparse, json, math
import numpy as np
from PIL import Image, ImageDraw

A, B, C, D, E, F, CUT = 5.555556, 0.052272, 0.24719, 0.385537, 5.367655, 0.092809, 0.010591

def logc_encode(x):
    x = np.asarray(x, dtype=np.float64)
    return np.where(x > CUT, C * np.log10(np.maximum(A * x + B, 1e-12)) + D, E * x + F)

def srgb_decode(v):
    v = np.asarray(v, dtype=np.float64)
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)

def srgb_encode(v):
    x = np.clip(v, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * x ** (1 / 2.4) - 0.055)

def load_lut(path):
    raw = open(path, "rb").read()
    magic, version, size, channels = np.frombuffer(raw[:16], dtype="<u4")
    assert magic == 0x54554C58 and version == 1 and channels == 4, "not a decoded grading LUT (XLUT v1)"
    return np.frombuffer(raw[16:], dtype="<f4").reshape(size, size, size, 4)[..., :3].astype(np.float64)  # [b, g, r, c]

def sample(lut, t):
    """Trilinear LUT sample at LogC coordinates t (..., 3) in [0, 1], texel centres, as grading-lut.ts samples."""
    n = lut.shape[0]; m = n - 1
    p = np.clip(t * m, 0, m)
    i0 = np.minimum(m - 1, np.floor(p)).astype(int); f = p - i0
    out = np.zeros(t.shape[:-1] + (3,))
    for dz in (0, 1):
        for dy in (0, 1):
            for dx in (0, 1):
                w = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                out += w[..., None] * lut[i0[..., 2] + dz, i0[..., 1] + dy, i0[..., 0] + dx]
    return out

def display(lut, x):
    return srgb_encode(sample(lut, logc_encode(x)))

def invert(lut, srgb, iterations=40):
    """Scene-linear colours whose display transform is `srgb` (..., 3) in [0, 1]."""
    target = np.maximum(srgb_decode(np.asarray(srgb, dtype=np.float64)), 1e-6)
    # Start from each channel's grey response inverse (a monotonic table along the neutral axis).
    ts = np.linspace(0, 1, 2049)
    grey = srgb_decode(srgb_encode(sample(lut, np.repeat(ts[:, None], 3, axis=1))))
    x = np.empty_like(target)
    for c in range(3):
        x[..., c] = np.interp(target[..., c], np.maximum.accumulate(grey[:, c]), ts)
    x = np.where(x > E * CUT + F, (10 ** ((x - D) / C) - B) / A, (x - F) / E)
    x = np.maximum(x, 1e-6)
    for _ in range(iterations):
        got = np.maximum(srgb_decode(display(lut, x)), 1e-6)
        x = np.maximum(x * (target / got) ** 0.8, 1e-7)
    return x

def affine(src, dst):
    src = np.asarray(src, float); dst = np.asarray(dst, float)
    M = np.hstack([src, np.ones((len(src), 1))])
    sol, *_ = np.linalg.lstsq(M, dst, rcond=None)
    return lambda p: np.hstack([np.asarray(p, float).reshape(-1, 2), np.ones((np.asarray(p).reshape(-1, 2).shape[0], 1))]) @ sol

LUM = np.array([0.2126, 0.7152, 0.0722])
FIT = ["forehead", "nose_shadow", "nose_lit", "under_eye_right", "under_eye_left", "cheek_shadow", "cheek_lit", "chin", "philtrum_right", "philtrum_left"]

def box_mean(img, cx, cy, w, h):
    x0, x1 = int(round(cx - w / 2)), int(round(cx + w / 2)); y0, y1 = int(round(cy - h / 2)), int(round(cy + h / 2))
    return img[max(0, y0):y1, max(0, x0):x1].reshape(-1, 3).mean(axis=0)

def measure(img, lut, boxes, mask_poly, excludes, scale):
    """Boxes (already in this frame's pixels) → scene-linear means; the mask's pixels → classes and contrast."""
    out = {"boxes": {}}
    for name, (cx, cy, w, h) in boxes.items():
        mean = box_mean(img, cx, cy, w * scale[0], h * scale[1]) / 255.0
        lin = invert(lut, mean[None, :])[0]
        out["boxes"][name] = {"srgb": (mean * 255).round(1).tolist(), "linear": lin.tolist()}
    mask = Image.new("L", (img.shape[1], img.shape[0]), 0)
    ImageDraw.Draw(mask).polygon([tuple(p) for p in mask_poly], fill=255)
    for x0, y0, x1, y1 in excludes:
        ImageDraw.Draw(mask).polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], fill=0)
    m = np.asarray(mask) > 0
    pixels = img[m].astype(np.float64) / 255.0
    lin = invert(lut, pixels)
    lum = lin @ LUM
    fh = np.asarray(out["boxes"]["forehead"]["linear"]) @ LUM
    rel = lum / fh
    classes = {"lit": rel >= 0.5, "band": (rel >= 0.12) & (rel < 0.5), "shadow": rel < 0.12}
    out["classes"] = {}
    for name, sel in classes.items():
        s = lin[sel]
        out["classes"][name] = {"share": float(sel.mean()), "R/G": float(s[:, 0].mean() / s[:, 1].mean()) if len(s) else None,
                                "B/G": float(s[:, 2].mean() / s[:, 1].mean()) if len(s) else None}
    p5, p50, p95 = np.percentile(lum, [5, 50, 95])
    out["contrast"] = {"p95/p5": float(p95 / p5), "p95/p50": float(p95 / p50), "p50/p5": float(p50 / p5), "pixels": int(m.sum())}
    return out, m

def summarise(res):
    b = res["boxes"]; fh = np.asarray(b["forehead"]["linear"])
    s = {"forehead R/G": fh[0] / fh[1], "forehead B/G": fh[2] / fh[1]}
    for name, v in b.items():
        lin = np.asarray(v["linear"])
        s[f"{name} L/forehead"] = float(lin @ LUM / (fh @ LUM))
        s[f"{name} R/G"] = float(lin[0] / lin[1])
    return s

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", required=True); ap.add_argument("--studio", action="append", required=True)
    ap.add_argument("--lut", required=True); ap.add_argument("--regions", required=True)
    ap.add_argument("--overlay"); ap.add_argument("--json")
    a = ap.parse_args()
    lut = load_lut(a.lut); regions = json.load(open(a.regions))
    g = regions["game"]; names = list(g["landmarks"])
    game = np.asarray(Image.open(a.game).convert("RGB"))
    game_res, game_mask = measure(game, lut, g["boxes"], g["mask"], g["exclude"], (1, 1))
    report = {"game": {"summary": summarise(game_res), **game_res}, "studio": {}}
    to_studio = affine([g["landmarks"][n] for n in names], [regions["studio"]["landmarks"][n] for n in names])
    sx = np.linalg.norm(to_studio([[1, 0]]) - to_studio([[0, 0]])); sy = np.linalg.norm(to_studio([[0, 1]]) - to_studio([[0, 0]]))
    boxes = {k: [*to_studio([[cx, cy]])[0], w, h] for k, (cx, cy, w, h) in g["boxes"].items()}
    poly = to_studio(g["mask"]).tolist()
    excl = []
    for x0, y0, x1, y1 in g["exclude"]:
        p = to_studio([[x0, y0], [x1, y1]]); excl.append([p[0][0], p[0][1], p[1][0], p[1][1]])
    gs = report["game"]["summary"]
    for path in a.studio:
        img = np.asarray(Image.open(path).convert("RGB"))
        res, m = measure(img, lut, boxes, poly, excl, (sx, sy))
        s = summarise(res)
        logs = [math.log(s[f"{n} L/forehead"] / gs[f"{n} L/forehead"]) for n in FIT if n != "forehead"]
        rms = math.sqrt(sum(v * v for v in logs) / len(logs))
        report["studio"][path] = {"summary": s, **res, "rms_log_luminance": rms,
                                  "ratios": {n: s[f"{n} L/forehead"] / gs[f"{n} L/forehead"] for n in FIT}}
        if a.overlay:
            ov = Image.fromarray(img.copy()); d = ImageDraw.Draw(ov)
            d.polygon([tuple(p) for p in poly], outline=(0, 255, 0))
            for k, (cx, cy, w, h) in boxes.items():
                d.rectangle([cx - w * sx / 2, cy - h * sy / 2, cx + w * sx / 2, cy + h * sy / 2], outline=(255, 255, 0))
            for x0, y0, x1, y1 in excl: d.rectangle([x0, y0, x1, y1], outline=(255, 0, 0))
            ov.save(a.overlay.replace(".png", f"-studio{list(report['studio']).index(path)}.png"))
    if a.overlay:
        ov = Image.fromarray(game.copy()); d = ImageDraw.Draw(ov)
        d.polygon([tuple(p) for p in g["mask"]], outline=(0, 255, 0))
        for k, (cx, cy, w, h) in g["boxes"].items(): d.rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], outline=(255, 255, 0))
        for x0, y0, x1, y1 in g["exclude"]: d.rectangle([x0, y0, x1, y1], outline=(255, 0, 0))
        ov.save(a.overlay.replace(".png", "-game.png"))
    if a.json: json.dump(report, open(a.json, "w"), indent=1)
    # A compact table on stdout.
    def row(label, s, res, extra=""):
        c = res["classes"]
        print(f"{label:28s} fh R/G {s['forehead R/G']:.3f} B/G {s['forehead B/G']:.3f} | lit R/G {c['lit']['R/G']:.3f} B/G {c['lit']['B/G']:.3f} ({c['lit']['share']:.2f})"
              f" | band R/G {c['band']['R/G']:.3f} B/G {c['band']['B/G']:.3f} ({c['band']['share']:.2f})"
              f" | shadow R/G {c['shadow']['R/G'] or float('nan'):.3f} B/G {c['shadow']['B/G'] or float('nan'):.3f} ({c['shadow']['share']:.2f})"
              f" | noseSh R/G {s['nose_shadow R/G']:.3f} L {s['nose_shadow L/forehead']:.3f} | p95/p5 {res['contrast']['p95/p5']:.1f} {extra}")
    row("game", gs, game_res)
    for path, r in report["studio"].items():
        row(path.replace("\\", "/").split("/")[-2] + "/" + path.replace("\\", "/").split("/")[-1], r["summary"], r, f"| rms {r['rms_log_luminance']:.3f}")
        print("   ratios " + " ".join(f"{n} {v:.2f}" for n, v in r["ratios"].items()))

if __name__ == "__main__":
    main()
