"""Measure the colours that tools/hair-colour-look.ts captures change.

  python tools/hair-colour-stats.py <capture dir> [<capture dir> ...]

For each view (face, eye, hair) it compares the all-details frame with the frames
that hide one detail. Pixels inside the 3D viewport that change by more than 12
(summed 8-bit RGB) belong to that detail; the script prints their mean display
colour (averaged in linear light, re-encoded to sRGB). For the face view it also
prints the mean of three fixed skin boxes (forehead and both cheeks) and the
detail-to-skin luminance ratios, which can be compared with the same ratios in an
in-game frame. Raster measures of private renders, not material values.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

VIEWPORT = (slice(85, 970), slice(302, 810))       # 3D viewport in the 1400x1000 capture layout
SKIN_BOXES = {"face": [(510, 330, 600, 400), (400, 640, 460, 700), (640, 640, 700, 700)]}


def dec(x):
    x = np.asarray(x, dtype=np.float64) / 255
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def enc(lin):
    lin = np.clip(lin, 0, 1)
    return 255 * np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)


def lum(c):
    return float(np.dot(c, [0.2126, 0.7152, 0.0722]))


def view_stats(directory: Path, view: str) -> dict:
    frame = lambda variant: np.asarray(Image.open(directory / f"{view}-{variant}.png").convert("RGB")).astype(float)
    full = frame("all")
    inside = np.zeros(full.shape[:2], bool)
    inside[VIEWPORT] = True
    out = {}
    for detail, variant in (("hair", "no-hair"), ("lashes", "no-lashes"), ("brows", "no-brows")):
        mask = (np.abs(full - frame(variant)).sum(-1) > 12) & inside
        out[detail] = dec(full[mask]).mean(0) if mask.any() else np.zeros(3)
    if view in SKIN_BOXES:
        out["skin"] = np.mean([dec(full[y0:y1, x0:x1].reshape(-1, 3)).mean(0)
                               for x0, y0, x1, y1 in SKIN_BOXES[view]], 0)
    return out


def main():
    for arg in sys.argv[1:]:
        directory = Path(arg)
        for view in ("face", "eye", "hair"):
            stats = view_stats(directory, view)
            line = f"{directory.name:10s} {view:5s} " + " ".join(
                f"{k}=({','.join(str(int(round(v))) for v in enc(c))})" for k, c in stats.items())
            if "skin" in stats:
                line += "  " + " ".join(f"{k}/skin={lum(stats[k]) / lum(stats['skin']):.3f}" for k in ("hair", "lashes", "brows"))
            print(line)


if __name__ == "__main__":
    main()
