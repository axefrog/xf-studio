"""Shared readers for experiment 025 (brow facts). Inputs are local, ignored extracts."""
from __future__ import annotations

import base64
import json
import struct
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class Glb:
    """Minimal glTF binary reader (WolvenKit export)."""

    def __init__(self, path: Path):
        data = path.read_bytes()
        off, self.bin = 12, b""
        while off < len(data):
            length, kind = struct.unpack_from("<II", data, off)
            chunk = data[off + 8: off + 8 + length]
            if kind == 0x4E4F534A:
                self.j = json.loads(chunk)
            else:
                self.bin = chunk
            off += 8 + length

    def acc(self, i: int) -> np.ndarray:
        a = self.j["accessors"][i]
        bv = self.j["bufferViews"][a["bufferView"]]
        n, dt = NC[a["type"]], CT[a["componentType"]]
        size = np.dtype(dt).itemsize
        stride = bv.get("byteStride")
        o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        cnt = a["count"]
        if stride and stride != n * size:
            raw = np.frombuffer(self.bin, np.uint8, count=stride * (cnt - 1) + n * size, offset=o)
            arr = np.lib.stride_tricks.as_strided(raw, (cnt, n * size), (stride, 1)).copy().view(dt)
        else:
            arr = np.frombuffer(self.bin, dt, count=cnt * n, offset=o).copy()
        arr = arr.reshape(cnt, n) if n > 1 else arr
        if a.get("normalized"):
            arr = arr.astype(np.float64) / np.iinfo(dt).max
        return arr

    def mesh(self, prim: int = 0) -> dict:
        p = self.j["meshes"][0]["primitives"][prim]
        at = p["attributes"]
        out = {k: self.acc(at[a]).astype(np.float64) for k, a in
               (("P", "POSITION"), ("N", "NORMAL"), ("T", "TANGENT"), ("UV", "TEXCOORD_0"))}
        out["I"] = self.acc(p["indices"]).reshape(-1, 3).astype(np.int64)
        joints = [self.j["nodes"][k]["name"] for k in self.j["skins"][0]["joints"]]
        j0, w0 = self.acc(at["JOINTS_0"]), self.acc(at["WEIGHTS_0"]).astype(np.float64)
        j1, w1 = self.acc(at["JOINTS_1"]), self.acc(at["WEIGHTS_1"]).astype(np.float64)
        out["J"] = np.concatenate([j0, j1], 1)
        out["W"] = np.concatenate([w0, w1], 1)
        out["joints"] = joints
        return out


def cr2w(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["Data"]["RootChunk"]


def val(x):
    """Flatten WolvenKit JSON values."""
    if isinstance(x, dict):
        if "DepotPath" in x:
            return x["DepotPath"].get("$value")
        if "$value" in x:
            return x["$value"]
        if x.get("$type") == "Color":
            return (x["Red"], x["Green"], x["Blue"], x["Alpha"])
        if str(x.get("$type", "")).startswith("Vector"):
            return tuple(x[k] for k in "XYZW" if k in x)
    return x


def mi_params(m: dict) -> dict:
    return {k: val(v) for p in (m.get("values") or []) for k, v in p.items() if k != "$type"}


# WolvenKit's compression mapping (TCM -> DXGI) as used by its XBM import/export.
BCN = {"TCM_QualityColor": 7, "TCM_Normalmap": 5, "TCM_DXTNoAlpha": 1, "TCM_DXTAlpha": 3}


def xbm(path: Path, decode: bool = True) -> dict:
    """Header facts and (optionally) every decoded mip of a serialized XBM."""
    from PIL import Image

    root = cr2w(path)
    s = root["setup"]
    blob = root["renderTextureResource"]["renderResourceBlobPC"]["Data"]
    info = blob["header"]["textureInfo"]
    mips = blob["header"]["mipMapInfo"]
    data = base64.b64decode(blob["textureData"]["Bytes"])
    w, h = blob["header"]["sizeInfo"]["width"], blob["header"]["sizeInfo"]["height"]
    first = mips[0]
    bytes_per_block = first["layout"]["rowPitch"] / max(1, (w + 3) // 4)
    out = {
        "header": [root["width"], root["height"]], "cooked": [w, h], "mipCount": info["mipCount"],
        "compression": s["compression"], "rawFormat": s["rawFormat"], "isGamma": s["isGamma"],
        "group": s["group"], "hasMipchain": s["hasMipchain"], "allowTextureDowngrade": s["allowTextureDowngrade"],
        "platformMipBiasPC": s["platformMipBiasPC"], "bytes": len(data), "bytesPerBlockRow0": bytes_per_block,
        "mipSizes": [], "images": [],
    }
    mode = BCN.get(s["compression"])
    for m in mips:
        o, n = m["placement"]["offset"], m["placement"]["size"]
        out["mipSizes"].append([w, h])
        if decode:
            if s["compression"] == "TCM_None" or mode is None:
                img = np.frombuffer(data[o:o + n], np.uint8)
                ch = n // (w * h)
                img = img.reshape(h, w, ch) if ch > 1 else img.reshape(h, w)
            else:
                if mode == 5:
                    im = Image.frombytes("RGB", (w, h), data[o:o + n], "bcn", 5)
                elif mode == 1:
                    im = Image.frombytes("RGBA", (w, h), data[o:o + n], "bcn", 1)
                else:
                    im = Image.frombytes("RGBA", (w, h), data[o:o + n], "bcn", mode)
                img = np.asarray(im)
            out["images"].append(img)
        w, h = max(1, w // 2), max(1, h // 2)
    return out


def fnv1a64(s: str) -> int:
    h = 0xCBF29CE484222325
    for b in s.lower().encode("utf-8"):
        h ^= b
        h = (h * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return h
