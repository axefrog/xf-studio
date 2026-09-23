"""Build a complete DDS mip chain for the inspected flat mesh-decal adapter.

The source/base pixels are the existing compiler output. REDengine's selected
mesh-decal pass squares filtered diffuse alpha and blends sqrt(linear colour),
roughness and metalness by that coverage. Lower mip texel centres therefore
need averages of those *destination contributions*, not averages of the source
PNG bytes. This cannot make bilinear/trilinear filtering exact between centres.
"""
from __future__ import annotations

import struct
from pathlib import Path

import numpy as np


def _linear(v: np.ndarray) -> np.ndarray:
    return np.where(v <= .04045, v / 12.92, ((v + .055) / 1.055) ** 2.4)


def _srgb(v: np.ndarray) -> np.ndarray:
    return np.where(v <= .0031308, v * 12.92, 1.055 * np.maximum(v, 0) ** (1 / 2.4) - .055)


def _byte(v: np.ndarray) -> np.ndarray:
    # Match the nonnegative Math.round convention used by the base compiler.
    return np.floor(np.clip(v, 0, 1) * 255 + .5).astype(np.uint8)


def destination_contributions(diffuse: np.ndarray, roughness: np.ndarray, metalness: np.ndarray) -> np.ndarray:
    """Six channels: premultiplied sqrt-linear RGB, R, M, and coverage."""
    d = diffuse.astype(np.float64) / 255
    coverage = d[..., 3] ** 2
    r = roughness.astype(np.float64) / 255
    m = metalness.astype(np.float64) / 255
    result = np.empty((*coverage.shape, 6), dtype=np.float64)
    result[..., :3] = np.sqrt(_linear(d[..., :3])) * coverage[..., None]
    result[..., 3] = r * coverage
    result[..., 4] = m * coverage
    result[..., 5] = coverage
    return result


def _next_level(contributions: np.ndarray) -> np.ndarray:
    height, width, channels = contributions.shape
    if height == 1 and width == 1:
        raise ValueError("The 1x1 level has no successor")
    # Current preset export is square/power-of-two. Keep the helper strict rather
    # than silently dropping an odd edge of an unsupported texture.
    if height % 2 or width % 2:
        raise ValueError("Mip source dimensions must be even")
    return contributions.reshape(height // 2, 2, width // 2, 2, channels).mean(axis=(1, 3))


def _encode(contributions: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    height, width, _ = contributions.shape
    coverage = contributions[..., 5]
    present = coverage > 0
    unpremultiplied = np.divide(contributions[..., :5], coverage[..., None],
                               out=np.zeros((height, width, 5), dtype=np.float64), where=present[..., None])
    diffuse = np.zeros((height, width, 4), dtype=np.uint8)
    diffuse[..., :3] = _byte(_srgb(np.clip(unpremultiplied[..., :3], 0, 1) ** 2))
    diffuse[..., 3] = _byte(np.sqrt(coverage))
    return diffuse, _byte(unpremultiplied[..., 3]), _byte(unpremultiplied[..., 4])


def mip_levels(diffuse: bytes, roughness: bytes, metalness: bytes, size: int) -> tuple[list[bytes], list[bytes], list[bytes]]:
    if size < 1 or size & (size - 1):
        raise ValueError("Texture size must be a positive power of two")
    pixels = size * size
    if len(diffuse) != pixels * 4 or len(roughness) != pixels or len(metalness) != pixels:
        raise ValueError("Base map byte length does not match size")
    colour = [diffuse]
    rough = [roughness]
    metal = [metalness]
    d = np.frombuffer(diffuse, dtype=np.uint8).reshape(size, size, 4)
    r = np.frombuffer(roughness, dtype=np.uint8).reshape(size, size)
    m = np.frombuffer(metalness, dtype=np.uint8).reshape(size, size)
    contribution = destination_contributions(d, r, m)
    while contribution.shape[0] > 1:
        contribution = _next_level(contribution)
        dc, rr, mm = _encode(contribution)
        colour.append(dc.tobytes())
        rough.append(rr.tobytes())
        metal.append(mm.tobytes())
    return colour, rough, metal


def dds_bytes(levels: list[bytes], size: int, channel: str) -> bytes:
    """Uncompressed DX10 DDS accepted by WolvenKit's XBM importer.

    The importer compresses to QualityColor/QualityR while retaining the caller's
    levels when GenerateMipMaps=false. Its exported DDS is checked separately.
    """
    if channel not in ("diffuse", "roughness", "metalness"):
        raise ValueError("Unsupported flat-map channel")
    stride = 4 if channel == "diffuse" else 1
    dimension = size
    for level in levels:
        if len(level) != dimension * dimension * stride:
            raise ValueError("Invalid DDS mip byte length")
        dimension = max(1, dimension // 2)
    if len(levels) != size.bit_length():
        raise ValueError("DDS requires a complete power-of-two mip chain")
    header = bytearray(148)
    header[:4] = b"DDS "
    struct.pack_into("<I", header, 4, 124)  # DDS_HEADER size
    struct.pack_into("<I", header, 8, 0x2100F)  # CAPS|HEIGHT|WIDTH|PITCH|PIXELFORMAT|MIPMAPCOUNT
    struct.pack_into("<IIII", header, 12, size, size, size * stride, 0)
    struct.pack_into("<I", header, 28, len(levels))
    struct.pack_into("<I", header, 76, 32)  # DDS_PIXELFORMAT size
    struct.pack_into("<I", header, 80, 4)  # DDPF_FOURCC
    header[84:88] = b"DX10"
    struct.pack_into("<I", header, 108, 0x401008)  # TEXTURE|COMPLEX|MIPMAP
    struct.pack_into("<IIIII", header, 128, 29 if stride == 4 else 61, 3, 0, 1, 0)
    return bytes(header) + b"".join(levels)


def read_dds_levels(path: Path, channel: str) -> tuple[int, list[np.ndarray]]:
    """Read the uncompressed DX10 DDS emitted by the checked WolvenKit export."""
    data = path.read_bytes()
    if len(data) < 148 or data[:4] != b"DDS " or data[84:88] != b"DX10":
        raise ValueError(f"Unsupported DDS header: {path}")
    height, width = struct.unpack_from("<II", data, 12)
    count = struct.unpack_from("<I", data, 28)[0]
    fmt, dimension, _, array_size, _ = struct.unpack_from("<IIIII", data, 128)
    stride = 4 if channel == "diffuse" else 1
    if height != width or width < 1 or width & (width - 1) or count != width.bit_length():
        raise ValueError(f"Unexpected DDS dimensions or mip count: {path}")
    if fmt != (29 if stride == 4 else 61) or dimension != 3 or array_size != 1:
        raise ValueError(f"Unexpected DDS format: {path}")
    offset = 148
    levels = []
    for index in range(count):
        side = max(1, width >> index)
        length = side * side * stride
        if offset + length > len(data):
            raise ValueError(f"Truncated DDS mip: {path}")
        levels.append(np.frombuffer(data, dtype=np.uint8, count=length, offset=offset).reshape(side, side, stride).copy())
        offset += length
    if offset != len(data):
        raise ValueError(f"Unexpected trailing DDS data: {path}")
    return width, levels
