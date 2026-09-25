"""Experiment 019: how WolvenKit stores a non-square XBM with a supplied mip chain (asset-free probe).

Writes a 64 x 16 R8 DDS whose every mip level has its own background value (40, 60, 80, ...) and a bright
marker (250) in the top-left corner, imports it with the package builder's scalar settings
(TCM_QualityR, no generated mips), serializes the XBM and decodes the stored BC4 blocks directly, then
exports it back to DDS. It answers two questions for the plate-local UV window:

1. Are supplied non-square chains kept (level count, per-level values)?
2. In which row order does the import store the image (the game samples stored row 0 at t_v = 0)?

    python experiments/019-uv-window/probe_xbm.py --wolvenkit <WolvenKit.CLI.exe> --gamepath <game> --work <empty dir>

Writes only into --work. Prints JSON.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import struct
import subprocess
from pathlib import Path


def dds(levels: list[bytes], width: int, height: int) -> bytes:
    header = bytearray(148)
    header[0:4] = b"DDS "
    struct.pack_into("<IIIIIII", header, 4, 124, 0x2100F, height, width, width, 0, len(levels))
    struct.pack_into("<II", header, 76, 32, 4)
    header[84:88] = b"DX10"
    struct.pack_into("<I", header, 108, 0x401008)
    struct.pack_into("<IIIII", header, 128, 61, 3, 0, 1, 0)  # DXGI_FORMAT_R8_UNORM, TEXTURE2D
    return bytes(header) + b"".join(levels)


def chain(width: int, height: int) -> list[bytes]:
    levels, level, w, h = [], 0, width, height
    while True:
        rows = [[40 + 20 * level] * w for _ in range(h)]
        for y in range(min(4, h)):
            for x in range(max(1, w // 2)):
                rows[y][x] = 250
        levels.append(bytes(v for row in rows for v in row))
        if w == 1 and h == 1:
            return levels
        w, h, level = max(1, w // 2), max(1, h // 2), level + 1


def run(cli: str, args: list[str], env: dict[str, str] | None = None) -> str:
    result = subprocess.run([cli, *args], capture_output=True, text=True, env={**os.environ, **(env or {})})
    if result.returncode not in (0, 3):
        raise SystemExit(result.stdout + result.stderr)
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wolvenkit", required=True)
    parser.add_argument("--gamepath", required=True)
    parser.add_argument("--work", required=True, type=Path)
    a = parser.parse_args()
    width, height = 64, 16
    for sub in ("in", "xbm", "json", "export"):
        (a.work / sub).mkdir(parents=True, exist_ok=False)
    (a.work / "in" / "probe.dds").write_bytes(dds(chain(width, height), width, height))
    settings = {"IsGamma": "false", "TextureGroup": "TEXG_Generic_Grayscale", "RawFormat": "TRF_Grayscale", "Compression": "TCM_QualityR",
                "GenerateMipMaps": "false", "IsStreamable": "true", "PremultiplyAlpha": "false"}
    run(a.wolvenkit, ["import", str(a.work / "in"), "-o", str(a.work / "xbm")], {f"XbmImportArgs__{k}": v for k, v in settings.items()})
    run(a.wolvenkit, ["convert", "serialize", str(a.work / "xbm"), "-o", str(a.work / "json")])
    run(a.wolvenkit, ["export", str(a.work / "xbm"), "-o", str(a.work / "export"), "--uext", "dds", "--gamepath", a.gamepath])
    root = json.loads((a.work / "json" / "probe.xbm.json").read_text(encoding="utf-8-sig"))["Data"]["RootChunk"]
    blob = root["renderTextureResource"]["renderResourceBlobPC"]["Data"]
    raw = base64.b64decode(blob["textureData"]["Bytes"])
    stored = []
    for info in blob["header"]["mipMapInfo"]:
        offset, size, pitch = info["placement"]["offset"], info["placement"]["size"], info["layout"]["rowPitch"]
        # First endpoint of each BC4 block: the block's value when the block is uniform.
        stored.append([[raw[offset + r * pitch + c * 8] for c in range(pitch // 8)] for r in range(size // pitch)])
    exported = (a.work / "export" / "probe.dds").read_bytes()
    w, h, count = struct.unpack_from("<I", exported, 16)[0], struct.unpack_from("<I", exported, 12)[0], struct.unpack_from("<I", exported, 28)[0]
    at, levels = 148, []
    for _ in range(count):
        levels.append({"size": f"{w}x{h}", "firstColumn": [exported[at + y * w] for y in range(h)]})
        at += w * h
        w, h = max(1, w // 2), max(1, h // 2)
    print(json.dumps({"compression": root["setup"]["compression"], "size": [root["width"], root["height"]],
                      "storedMipCount": blob["header"]["textureInfo"]["mipCount"],
                      "storedBlockRowsLevel0TopToBottom": stored[0], "storedLevels": stored[1:],
                      "exportedLevels": levels}))


if __name__ == "__main__":
    main()
