"""Experiment 031: side-by-side sheet and pixel differences of render_compare.ts's captures (private, ignored folder).

    python experiments/031-photo-mode-facial-setup/render_sheet.py

For each capture present in both `face-rig` and `female-head`, prints the mean absolute difference (0-255, all channels) over the frame
and the share of pixels differing by more than 8, and writes `sheet.png` (rows: captures; columns: face rig's setup, female head's setup,
difference x4) beside them.
"""
from __future__ import annotations

import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "projects", "xf-studio", "authoring", "evidence", "screenshots", "facial-setup-d1")
game, female = os.path.join(OUT, "face-rig"), os.path.join(OUT, "female-head")
names = sorted(n for n in os.listdir(game) if n.endswith(".png") and os.path.exists(os.path.join(female, n)))
rows = []
for name in names:
    a = np.asarray(Image.open(os.path.join(game, name)).convert("RGB")).astype(float)
    b = np.asarray(Image.open(os.path.join(female, name)).convert("RGB")).astype(float)
    d = np.abs(a - b)
    print(f"{name:32s} mean |diff| {d.mean():5.2f}  pixels > 8: {(d.max(axis=2) > 8).mean() * 100:5.1f} %")
    # Crop to the face (the central 60 % of the frame) and halve for the sheet.
    h, w = a.shape[:2]
    box = (slice(int(h * .1), int(h * .9)), slice(int(w * .25), int(w * .75)))
    tiles = [a[box], b[box], np.clip(d[box] * 4, 0, 255)]
    rows.append(np.concatenate(tiles, axis=1))
if rows:
    sheet = Image.fromarray(np.concatenate(rows, axis=0).astype(np.uint8))
    sheet = sheet.resize((sheet.width // 2, sheet.height // 2), Image.LANCZOS)
    sheet.save(os.path.join(OUT, "sheet.png"))
    print("sheet:", os.path.join(OUT, "sheet.png"))
