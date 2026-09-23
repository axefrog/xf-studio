"""Report saved style-18 brow texture channels without copying game assets.

Usage: python tools/brow-channels.py <saved-v-brows directory>
Requires Pillow. The input directory is ignored local research data.
"""
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image

if len(sys.argv) != 2:
    raise SystemExit("Usage: python tools/brow-channels.py <saved-v-brows directory>")
root = Path(sys.argv[1])
names = {
    "diffuse": "ark_heb__base_d18.png",
    "secondary": "ark_heb_wa__base_ds18.png",
    "normal": "ark_heb__base_n18.png",
}
report = {}
for role, filename in names.items():
    path = root / "raw" / filename
    data = path.read_bytes()
    with Image.open(path) as image:
        image.load()
        if image.mode != "RGBA":
            raise ValueError(f"Expected RGBA for {path}, got {image.mode}")
        channels = {}
        for label in "RGBA":
            values = image.getchannel(label).histogram()
            channels[label] = {
                "min": next(i for i, count in enumerate(values) if count),
                "max": next(i for i in range(255, -1, -1) if values[i]),
                "mean": round(sum(i * count for i, count in enumerate(values)) / (image.width * image.height), 3),
                "nonzero": sum(values[1:]),
            }
        row = {"file": filename, "sha256": hashlib.sha256(data).hexdigest(),
               "size": list(image.size), "channels": channels}
        if role == "diffuse":
            rgba = image.tobytes()
            row["greenVersusAlpha"] = {
                "greenGreater": sum(rgba[i + 1] > rgba[i + 3] for i in range(0, len(rgba), 4)),
                "equal": sum(rgba[i + 1] == rgba[i + 3] for i in range(0, len(rgba), 4)),
                "alphaGreater": sum(rgba[i + 3] > rgba[i + 1] for i in range(0, len(rgba), 4)),
            }
    report[role] = row
material = json.loads((root / "json" / "ark_eyebrows_02__18.mi.json").read_text())
values = material["Data"]["RootChunk"]["values"]
report["materialOverrides"] = {key: value for row in values for key, value in row.items() if key != "$type"}
print(json.dumps(report, indent=2))
