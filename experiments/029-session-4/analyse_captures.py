"""Offline measurements for session 4 (experiment 029).

Reads the session's private captures from the ignored folder
experiments/029-session-4/generated/captures/ (copied from the bridge's
capture folder) and prints every number the results page quotes. Nothing is
written. Run from the repository root:

    python tools/memory_guard.py --limit 3 -- python experiments/029-session-4/analyse_captures.py

Pixel values are the game's display-referred 8-bit output (SDR, after tone
mapping and grading). "Linear" below means the sRGB transfer undone, which is
not scene-linear light: ratios are provisional (see the README's limits).
"""

from __future__ import annotations

import glob
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
# Optional first argument: another captures folder (for example the main checkout's, from a worktree).
CAPTURES = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "generated", "captures")
LUMA = np.array([0.2126, 0.7152, 0.0722])


def load(name: str) -> np.ndarray:
    """The full-resolution frame of the capture whose name ends in `name`."""
    hits = sorted(glob.glob(os.path.join(CAPTURES, f"*-{name}.full.png")))
    if not hits:
        sys.exit(f"missing capture {name}: copy session 4's captures first")
    return np.asarray(Image.open(hits[-1]).convert("RGB")).astype(float)


def box(im: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    return im[y : y + h, x : x + w].reshape(-1, 3)


def lin(v):
    v = np.asarray(v, dtype=float) / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def fmt(v) -> str:
    return "(" + ", ".join(f"{x:.1f}" for x in v) + ")"


def silver_highlight() -> None:
    """N5.5: colour of the silver nose ring's highlights and of its body."""
    print("== N5.5 silver piercing (n5-5.5-p1-silver, nose ring box 2050,1028 40x85)")
    px = box(load("n5-5.5-p1-silver"), 2050, 1028, 40, 85)
    lum = px @ LUMA
    metal = px[:, 0] - px[:, 2] < 5  # skin is warm (R - B about 20-30); the metal isn't
    print(f"  metal pixels {metal.sum()} of {len(px)}")
    for lo, hi in [(30, 100), (100, 150), (150, 200), (200, 235), (235, 256)]:
        sel = metal & (lum >= lo) & (lum < hi)
        if sel.any():
            m = px[sel].mean(0)
            print(f"  L {lo:3d}-{hi:3d}: n={sel.sum():3d} mean={fmt(m)} B/R={m[2] / m[0]:.3f} G/R={m[1] / m[0]:.3f}")
    body = px[metal & (lum < 110)]
    print(f"  darkest metal (body between highlights): min L {lum[metal].min():.0f}, mean of L<110 {fmt(body.mean(0))}")
    gold = box(load("n5-5.5-p1-gold"), 2055, 1020, 45, 90)
    g = gold[(gold @ LUMA) > 150]
    print(f"  gold ring, pixels L>150: mean={fmt(g.mean(0))} (B/R {g[:, 2].mean() / g[:, 0].mean():.2f})")


# Tone table (bytes) and TintScale from knowledge/head-cc-rendering.md section 2.
IVORY = (np.array([255, 245, 181]), -0.15)
AMBER = (np.array([199, 116, 112]), 0.52)
LIMESTONE = (np.array([131, 149, 83]), 0.38)


def tone_factor(tone, mode: str, m: float):
    """Albedo multiplier of a tone at tint-mask weight m (albedo below 0.5, so overlay is 2aT)."""
    t = tone[0] / 255.0 if mode == "byte" else lin(tone[0])
    w = abs(tone[1]) * m
    if tone[1] < 0:  # overlay blend: lerp(a, 2aT, w) = a(1 + w(2T - 1))
        return 1 + w * (2 * t - 1)
    return 1 - w + w * t  # multiply: lerp(a, aT, w)


def tint_encoding() -> None:
    """N5.2: senna amber (5) and limestone (2) against warm ivory (1), skin type 1."""
    print("== N5.2 tint encoding (skin type 1; tones 1 warm ivory, 5 senna amber, 2 limestone)")
    frames = {k: load(f"n5-5.2-type1-tone{k}") for k in (1, 5, 2)}
    regions = {
        "lit cheek": (1860, 880, 60, 60),
        "shadowed cheek": (1670, 910, 60, 60),
        "chin": (1780, 1070, 50, 50),
        "upper chest (body)": (1550, 1390, 120, 60),
    }
    for mode in ("byte", "srgb"):
        a = tone_factor(AMBER, mode, 1) / tone_factor(IVORY, mode, 1)
        l = tone_factor(LIMESTONE, mode, 1) / tone_factor(IVORY, mode, 1)
        print(f"  predicted at full mask, {mode:4s}: amber/ivory {np.round(a, 3)} (Y {a @ LUMA:.3f}); "
              f"limestone/ivory {np.round(l, 3)} (Y {l @ LUMA:.3f}, B/G {l[2] / l[1]:.3f})")
    for name, b in regions.items():
        t1, t5, t2 = (lin(box(frames[k], *b)).mean(0) for k in (1, 5, 2))
        ra, rl = t5 / t1, t2 / t1
        print(f"  {name:18s} amber/ivory {np.round(ra, 3)} Y {(t5 @ LUMA) / (t1 @ LUMA):.3f}; "
              f"limestone/ivory {np.round(rl, 3)} Y {(t2 @ LUMA) / (t1 @ LUMA):.3f} B/G {rl[2] / rl[1]:.3f}")
        target = np.concatenate([ra, rl])
        for mode in ("byte", "srgb"):
            fits = []
            for m in np.linspace(0, 1.5, 151):
                p = np.concatenate([tone_factor(AMBER, mode, m) / tone_factor(IVORY, mode, m),
                                    tone_factor(LIMESTONE, mode, m) / tone_factor(IVORY, mode, m)])
                fits.append((float(np.sqrt(np.mean((p - target) ** 2))), float(m)))
            rms, m = min(fits)
            # Robustness: a free per-region tone-curve exponent k (display ratio = albedo ratio ** k) with the mask weight at most 1.
            free = min((float(np.sqrt(np.mean((np.concatenate([tone_factor(AMBER, mode, w) / tone_factor(IVORY, mode, w),
                         tone_factor(LIMESTONE, mode, w) / tone_factor(IVORY, mode, w)]) ** k - target) ** 2))), float(w), float(k))
                        for w in np.linspace(0, 1, 101) for k in np.linspace(0.6, 2.0, 71))
            print(f"      {mode:4s}: best mask weight {m:.2f}, rms {rms:.3f}; with a free exponent: rms {free[0]:.3f} (m {free[1]:.2f}, k {free[2]:.2f})")


def link_tone() -> None:
    """N6.2: tone 3 kept on the body across skin type 1 -> 5."""
    print("== N6.2 tone follower (skin_color 3; type 1 -> 5; body framing)")
    a, b = load("n6-link-type1-body"), load("n6-link-type5-body")
    for name, r in {"upper chest left": (1550, 1390, 120, 60), "upper chest right": (1950, 1400, 100, 50),
                    "left shoulder": (1250, 1420, 80, 60), "UI tone swatch": (2990, 480, 50, 45)}.items():
        ma, mb = box(a, *r).mean(0), box(b, *r).mean(0)
        print(f"  {name:18s} type 1 {fmt(ma)}  type 5 {fmt(mb)}  ratio {np.round(mb / ma, 3)}")
    print(f"  whole frame mean |diff| {np.abs(a - b).mean():.2f}/255")


def tattoo_strength() -> None:
    """N5.7: ink against skin on matched rows, tattoo 2 and tattoo 9 on tone 1."""
    print("== N5.7 tattoo strength (display values, luminance)")
    t2, t9 = load("n5-5.7-tat2-tone1"), load("n5-5.7-tat9-tone1")
    star = box(t2, 1670, 894, 8, 8).mean(0) @ LUMA
    skin = box(t2, 1720, 940, 15, 15).mean(0) @ LUMA
    print(f"  tattoo 2 star core {star:.0f} against skin {skin:.0f}: {star / skin:.2f}")
    for y in (900, 920):
        r2 = (t2[y : y + 6, 1560:1640] @ LUMA).mean(0)
        r9 = (t9[y : y + 6, 1560:1640] @ LUMA).mean(0)
        sk = np.median(r9[40:])
        print(f"  row {y}: tattoo 9 line min {r9[:30].min():.0f} vs skin {sk:.0f} ({r9[:30].min() / sk:.2f}); "
              f"tattoo 2 gun {np.median(r2[:15]):.0f} vs skin {np.median(r2[40:]):.0f} "
              f"({np.median(r2[:15]) / np.median(r2[40:]):.2f})")


def sss_quality() -> None:
    """N7.6: mean absolute difference between runs in a face box."""
    print("== N7.6 SSS quality (mean |diff| per channel value, face box 1650,480 550x670)")
    fb = (1650, 480, 550, 670)
    for view in ("yaw-60", "yaw0", "yaw60", "far"):
        runs = {r: box(load(f"sss-{r}-{view}"), *fb) for r in ("high", "low", "low2", "high2")}
        d = lambda p, q: float(np.abs(runs[p] - runs[q]).mean())
        print(f"  {view:6s} low/low2 {d('low', 'low2'):.2f}  high2/low2 {d('high2', 'low2'):.2f}  "
              f"high2/low {d('high2', 'low'):.2f}  (void high/low {d('high', 'low'):.2f})")


def ear_transmission() -> None:
    """N7.7: ear colour back-lit against no light and against the lit neck."""
    print("== N7.7 back-lit ear (ear box 1540,800 110x190; neck box 1360,1080 100x100)")
    for name in ("ear2-az-150-yaw-90", "ear2-az-120-yaw-90", "ear2-nolight-yaw-90"):
        im = load(name)
        e, n = box(im, 1540, 800, 110, 190).mean(0), box(im, 1360, 1080, 100, 100).mean(0)
        print(f"  {name:22s} ear {fmt(e)} R/G {e[0] / e[1]:.2f}; neck {fmt(n)} R/G {n[0] / n[1]:.2f}")


if __name__ == "__main__":
    silver_highlight()
    tint_encoding()
    link_tone()
    tattoo_strength()
    sss_quality()
    ear_transmission()
