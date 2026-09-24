"""Compare decoded RGBA mip pixels in two locally serialized XBM resources.

The source JSON and textures stay in ignored local research space. This prints
only aggregate differences and endpoint colours, not image bytes.
"""

import argparse
import base64
import json
from pathlib import Path

import numpy as np
from PIL import Image


def mip_images(path: Path) -> tuple[dict, list[np.ndarray]]:
    root = json.loads(path.read_text(encoding="utf-8"))["Data"]["RootChunk"]
    blob = root["renderTextureResource"]["renderResourceBlobPC"]["Data"]
    data = base64.b64decode(blob["textureData"]["Bytes"])
    images = []
    width, height = root["width"], root["height"]
    for mip in blob["header"]["mipMapInfo"]:
        offset, size = mip["placement"]["offset"], mip["placement"]["size"]
        # The inspected 32x4 gradient has 16-byte BC7 blocks. The Pillow BC7
        # decoder is used only for this verified format, not arbitrary XBMs.
        minimum = max(1, (width + 3) // 4) * max(1, (height + 3) // 4) * 16
        if size != minimum:
            raise ValueError(f"Mip {width}x{height} is not the expected BC7 layout")
        images.append(np.asarray(Image.frombytes("RGBA", (width, height),
                                               data[offset:offset + size], "bcn", 7)))
        width, height = max(1, width // 2), max(1, height // 2)
    return root, images


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("game_xbm_json", type=Path)
    parser.add_argument("mod_xbm_json", type=Path)
    args = parser.parse_args()
    game, game_mips = mip_images(args.game_xbm_json)
    mod, mod_mips = mip_images(args.mod_xbm_json)
    if len(game_mips) != len(mod_mips):
        raise ValueError("Mip counts differ")
    print(json.dumps({
        "game": {"gamma": game["setup"]["isGamma"],
                 "allowTextureDowngrade": game["setup"]["allowTextureDowngrade"]},
        "mod": {"gamma": mod["setup"]["isGamma"],
                "allowTextureDowngrade": mod["setup"]["allowTextureDowngrade"]},
        "mips": [{
            "level": i, "size": [int(a.shape[1]), int(a.shape[0])],
            "differentPixels": int(np.any(a != b, axis=2).sum()),
            "maxChannelDifference": int(np.abs(a.astype(np.int16) - b.astype(np.int16)).max()),
            "gameEndpoint": a[a.shape[0] // 2, -1].tolist(),
            "modEndpoint": b[b.shape[0] // 2, -1].tolist(),
        } for i, (a, b) in enumerate(zip(game_mips, mod_mips))],
    }, indent=2))


if __name__ == "__main__":
    main()
