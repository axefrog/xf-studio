"""Minimal, asset-free decoders for WolvenKit JSON render blobs and morph targets (numpy only).

Formats (WolvenKit official source at 11720772, `MeshTools.cs`, `MorphTargetTools.cs`,
`Common/StructFunctions.cs`; observed in the 2.31 head, see experiment 012):
- PS_Position PT_Short4N: int16 / 32767 * quantizationScale + quantizationOffset.
- PS_Normal PT_Dec4: 10-bit unsigned per axis, x * 2 / 1023 - 1 ("TenBitShifted").
- Morph diff rows are 12 bytes: position u32 (10-bit unsigned, / 1023 * scale + offset per target),
  then normal and tangent u32 deltas. A u16 vertex-index mapping follows each target's run.
"""
from __future__ import annotations

import base64
import json
from dataclasses import dataclass

import numpy as np

ELEMENT_BYTES = {"PT_Short4N": 8, "PT_UByte4": 4, "PT_UByte4N": 4, "PT_Float16_4": 8, "PT_Float16_2": 4,
                 "PT_Dec4": 4, "PT_Color": 4, "PT_Float1": 4, "PT_Float2": 8, "PT_Float3": 12, "PT_Float4": 16,
                 "PT_UInt4": 16}


def _vec(v: dict) -> np.ndarray:
    return np.array([v["X"], v["Y"], v["Z"]], dtype=np.float64)


@dataclass
class Blob:
    positions: np.ndarray  # (N, 3) float64 in mesh units (metres)
    normals: np.ndarray    # (N, 3) unit-ish vertex normals
    uv0: np.ndarray        # (N, 2)
    faces: np.ndarray      # (F, 3) int
    skin: np.ndarray       # (N, 16) raw skin index/weight bytes
    vertex_factory: int
    lod_masks: list


def load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def decode_blob(blob: dict, chunk_index: int | None = None) -> Blob:
    """Decode every render chunk (or one) of a rendRenderMeshBlob into shared arrays."""
    header = blob["header"]
    raw = base64.b64decode(blob["renderBuffer"]["Bytes"])
    q_off, q_scale = _vec(header["quantizationOffset"]), _vec(header["quantizationScale"])
    chunks = header["renderChunkInfos"]
    picks = range(len(chunks)) if chunk_index is None else [chunk_index]
    pos_all, nrm_all, uv_all, skin_all, faces_all, masks = [], [], [], [], [], []
    base = 0
    factory = None
    for ci in picks:
        chunk = chunks[ci]
        layout = chunk["chunkVertices"]["vertexLayout"]
        offsets = chunk["chunkVertices"]["byteOffsets"]["Elements"]
        strides = layout["slotStrides"]["Elements"]
        cursor: dict[int, int] = {}
        elems = {}
        for e in layout["elements"]["Elements"]:
            if e["streamType"] != "ST_PerVertex":
                continue
            s = e["streamIndex"]
            off = cursor.get(s, 0)
            elems[(e["usage"], e["usageIndex"])] = (s, off, e["type"])
            cursor[s] = off + ELEMENT_BYTES[e["type"]]
        n = chunk["numVertices"]

        def rows(usage, index=0, size=None):
            s, off, typ = elems[(usage, index)]
            size = size or ELEMENT_BYTES[typ]
            start = offsets[s]
            block = np.frombuffer(raw, dtype=np.uint8, count=strides[s] * n, offset=start).reshape(n, strides[s])
            return block[:, off:off + size]

        p = rows("PS_Position").copy().view(np.int16).reshape(n, 4)[:, :3].astype(np.float64)
        pos = np.clip(p / 32767.0, -1, 1) * q_scale + q_off
        d = rows("PS_Normal").copy().view(np.uint32).reshape(n)
        nrm = np.stack([(d >> (10 * k)) & 0x3FF for k in range(3)], axis=1).astype(np.float64) * 2 / 1023 - 1
        uv = rows("PS_TexCoord", 0).copy().view(np.float16).reshape(n, 2).astype(np.float64)
        sk = np.concatenate([rows("PS_SkinIndices", 0), rows("PS_SkinIndices", 1),
                             rows("PS_SkinWeights", 0), rows("PS_SkinWeights", 1)], axis=1)
        ib = chunk["chunkIndices"]
        start = header["indexBufferOffset"] + ib["teOffset"]  # teOffset is a byte offset
        idx = np.frombuffer(raw, dtype=np.uint16, count=chunk["numIndices"], offset=start).astype(np.int64)
        faces_all.append(idx.reshape(-1, 3) + base)
        pos_all.append(pos); nrm_all.append(nrm); uv_all.append(uv); skin_all.append(sk)
        masks.append(chunk["lodMask"])
        factory = chunk["vertexFactory"]
        base += n
    return Blob(np.concatenate(pos_all), np.concatenate(nrm_all), np.concatenate(uv_all),
                np.concatenate(faces_all), np.concatenate(skin_all), factory, masks)


@dataclass
class Morph:
    base: Blob
    names: list[str]
    deltas: list[dict[int, np.ndarray]]  # per target: global vertex index -> position delta (chunk-concatenated)
    normal_deltas: list[dict[int, np.ndarray]]  # per target: vertex -> shading-normal delta (10-bit shifted)


def decode_morph(doc: dict) -> Morph:
    root = doc["Data"]["RootChunk"]
    blob = root["blob"]["Data"]
    header = blob["header"]
    base = decode_blob(blob["baseBlob"]["Data"])
    chunk_sizes = [c["numVertices"] for c in blob["baseBlob"]["Data"]["header"]["renderChunkInfos"]]
    chunk_base = np.concatenate([[0], np.cumsum(chunk_sizes)])[:-1]
    diffs = base64.b64decode(blob["diffsBuffer"]["Bytes"])
    mapping = base64.b64decode(blob["mappingBuffer"]["Bytes"])
    names = [t["name"]["$value"] for t in root["targets"]]
    out, nout = [], []
    for t in range(header["numTargets"]):
        off, scale = _vec(header["targetPositionDiffOffset"][t]), _vec(header["targetPositionDiffScale"][t])
        d0 = header["targetStartsInVertexDiffs"][t]
        m0 = header["targetStartsInVertexDiffsMapping"][t]
        result: dict[int, np.ndarray] = {}
        nres: dict[int, np.ndarray] = {}
        for ci, (count, mcount) in enumerate(zip(header["numVertexDiffsInEachChunk"][t],
                                                  header["numVertexDiffsMappingInEachChunk"][t])):
            if count:
                rows = np.frombuffer(diffs, dtype=np.uint32, count=count * 3, offset=d0 * 12).reshape(count, 3)
                q = np.stack([(rows[:, 0] >> (10 * k)) & 0x3FF for k in range(3)], axis=1).astype(np.float64)
                delta = q / 1023.0 * scale + off
                nq = np.stack([(rows[:, 1] >> (10 * k)) & 0x3FF for k in range(3)], axis=1).astype(np.float64)
                ndelta = nq * 2 / 1023.0 - 1
                vid = np.frombuffer(mapping, dtype=np.uint16, count=count, offset=m0 * 4).astype(np.int64)
                for v, dv, dn in zip(vid + chunk_base[ci], delta, ndelta):
                    result[int(v)] = dv
                    nres[int(v)] = dn
            d0 += count
            m0 += mcount
        out.append(result)
        nout.append(nres)
    return Morph(base, names, out, nout)


def morphed(m: Morph, target: int) -> np.ndarray:
    pos = m.base.positions.copy()
    for v, d in m.deltas[target].items():
        pos[v] += d
    return pos


def face_normals(pos: np.ndarray, faces: np.ndarray) -> np.ndarray:
    n = np.cross(pos[faces[:, 1]] - pos[faces[:, 0]], pos[faces[:, 2]] - pos[faces[:, 0]])
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-30)


def closest_on_triangles(p: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    """Closest points on triangles (a, b, c) to points p (Ericson, Real-Time Collision Detection 5.1.5), vectorised."""
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = (ab * ap).sum(-1), (ac * ap).sum(-1)
    bp = p - b
    d3, d4 = (ab * bp).sum(-1), (ac * bp).sum(-1)
    cp = p - c
    d5, d6 = (ab * cp).sum(-1), (ac * cp).sum(-1)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    denom = np.where(np.abs(va + vb + vc) < 1e-300, 1e-300, va + vb + vc)
    v = vb / denom
    w = vc / denom
    res = a + ab * v[..., None] + ac * w[..., None]
    # edge and vertex regions
    with np.errstate(divide="ignore", invalid="ignore"):
        m = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
        t = np.clip(d1 / np.where(d1 - d3 == 0, 1, d1 - d3), 0, 1)
        res = np.where(m[..., None], a + ab * t[..., None], res)
        m2 = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
        t = np.clip(d2 / np.where(d2 - d6 == 0, 1, d2 - d6), 0, 1)
        res = np.where(m2[..., None], a + ac * t[..., None], res)
        m3 = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
        t = np.clip((d4 - d3) / np.where((d4 - d3) + (d5 - d6) == 0, 1, (d4 - d3) + (d5 - d6)), 0, 1)
        res = np.where(m3[..., None], b + (c - b) * t[..., None], res)
    res = np.where(((d1 <= 0) & (d2 <= 0))[..., None], a, res)
    res = np.where(((d3 >= 0) & (d4 <= d3))[..., None], b, res)
    res = np.where(((d6 >= 0) & (d5 <= d6))[..., None], c, res)
    return res


def candidate_faces(points: np.ndarray, pos: np.ndarray, faces: np.ndarray, k: int = 24) -> np.ndarray:
    """k nearest triangles by centroid for each point (brute force in blocks)."""
    cent = pos[faces].mean(axis=1)
    out = np.empty((len(points), k), dtype=np.int64)
    for s in range(0, len(points), 256):
        d = ((points[s:s + 256, None, :] - cent[None]) ** 2).sum(-1)
        out[s:s + 256] = np.argpartition(d, k, axis=1)[:, :k]
    return out


def signed_distance(points: np.ndarray, pos: np.ndarray, faces: np.ndarray, cand: np.ndarray,
                    normals: np.ndarray | None = None):
    """Closest-point distance from each point to the candidate triangles, positive on the side the
    surface's vertex normals point to (outward). CP2077 meshes wind front faces clockwise, so the
    geometric cross-product normal points inward; the stored vertex normals decide the sign."""
    tri = faces[cand]  # (P, k, 3)
    a, b, c = pos[tri[..., 0]], pos[tri[..., 1]], pos[tri[..., 2]]
    q = closest_on_triangles(points[:, None, :], a, b, c)
    dist = np.linalg.norm(points[:, None, :] - q, axis=-1)
    best = dist.argmin(axis=1)
    rows = np.arange(len(points))
    face = cand[rows, best]
    fn = face_normals(pos, faces)[face]
    if normals is not None:
        fn = fn * np.sign((fn * normals[faces[face]].mean(1)).sum(-1))[:, None]
    diff = points - q[rows, best]
    sign = np.sign((diff * fn).sum(-1))
    return dist[rows, best] * np.where(sign == 0, 1, sign), face
