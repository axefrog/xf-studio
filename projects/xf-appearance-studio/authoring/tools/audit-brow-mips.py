"""Compare saved brow XBM mip levels with simple 2x box downsamples.

Uses locally serialized, ignored game/mod resources. It writes no images or
third-party bytes. This is a diagnostic, not a model of GPU texture filtering.
"""

import argparse
import base64
import json
from pathlib import Path

import numpy as np
from PIL import Image


def audit(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))["Data"]["RootChunk"]
    blob = data["renderTextureResource"]["renderResourceBlobPC"]["Data"]
    levels = blob["header"]["mipMapInfo"]
    pixels = base64.b64decode(blob["textureData"]["Bytes"])
    width, height = data["width"], data["height"]
    previous = None
    result = []
    for index, entry in enumerate(levels):
        placement = entry["placement"]
        level = np.frombuffer(pixels, dtype=np.uint8, count=placement["size"],
                              offset=placement["offset"]).reshape(height, width, 4)
        if previous is not None:
            # Box filter is a controlled reference, not a claim about Three.js
            # or the GPU mip generator. Compare alpha as well as the RGB mask.
            box = np.asarray(Image.fromarray(previous).resize((width, height), Image.Resampling.BOX))
        else:
            box = level
        alpha_error = np.abs(level[:, :, 3].astype(np.int16) - box[:, :, 3])
        result.append({
            "level": index, "size": [width, height],
            "alpha_mean": round(float(level[:, :, 3].mean()), 4),
            "alpha_over_0_1": int((level[:, :, 3] > 25).sum()),
            "alpha_over_0_5": int((level[:, :, 3] > 127).sum()),
            "alpha_box_mae": round(float(alpha_error.mean()), 4),
            "alpha_box_max": int(alpha_error.max()),
            "alpha_box_error_over_8": int((alpha_error > 8).sum()),
            "rgb_box_mae": round(float(np.abs(level[:, :, :3].astype(np.int16) - box[:, :, :3]).mean()), 4),
        })
        previous = level
        width, height = max(1, width // 2), max(1, height // 2)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xbm_json", type=Path, nargs="+")
    args = parser.parse_args()
    for path in args.xbm_json:
        print(json.dumps({"source": path.name, "mips": audit(path)}, indent=2))
