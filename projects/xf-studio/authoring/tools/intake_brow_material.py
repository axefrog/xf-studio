"""Make an ignored, exact-identity browser intake for Nathan's saved brow material.

Requires Pillow. Arguments are decoded local PNGs, never redistributed source assets.
The material adapter consumes filtered source alphas at runtime, so this command
copies them unchanged instead of pre-baking coverage at texel centres.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from PIL import Image

SOURCES = {
    "primary": ("primary.png", "5fac5306ee4f32c082a6739457170e5f5d2aac5e2f3a73eb3c903628ebfdb56f", (2048, 1024)),
    "secondary": ("secondary.png", "1684bedf441efc495bd06f3c8c1438e7293dc00f7f3b4b55bc6ce254d1546eaf", (2048, 1024)),
    "gradient": ("gradient.png", "53cfa17949db9dd729de1d364754a2c9bb43c41a6e7448ab25f89e4eaf18a4cd", (32, 4)),
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for key in SOURCES:
        parser.add_argument(f"--{key}", type=Path, required=True)
    args = parser.parse_args()
    out = Path(__file__).resolve().parents[1] / "public" / "assets" / "brows"
    staged = {}
    for key, (name, sha, dimensions) in SOURCES.items():
        source = getattr(args, key)
        if digest(source) != sha:
            raise ValueError(f"{key} does not match the audited saved-V resource")
        with Image.open(source) as image:
            if image.size != dimensions or image.mode != "RGBA":
                raise ValueError(f"{key} must be the audited RGBA {dimensions} export")
        staged[key] = {"url": f"/assets/brows/{name}", "sha256": sha,
                       "width": dimensions[0], "height": dimensions[1]}
    out.mkdir(parents=True, exist_ok=True)
    for key, (name, _, _) in SOURCES.items():
        shutil.copyfile(getattr(args, key), out / name)
    manifest = {"schema": "xfs/brow-preview-1", "appearanceHash": "10685882159528859062",
                "definition": "10_brown_ombre", **staged}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
