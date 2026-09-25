"""Experiment 018: map sets and measurements for the proposed Glitter game route (asset-free).

Generates, for each diagnostic-board preset, the per-texel maps of the proposed `mesh_decal` Glitter
route in a plate-local UV window, with an explicit mip chain in which flakes are re-rasterized at
every level ("nested flake mips") instead of averaged. It also measures what survives at each mip
level against the plain BOX chain the faceted route uses today. Deterministic; numpy + Pillow only.

    python experiments/018-glitter-route/make_maps.py                 # metrics only -> result.json
    python experiments/018-glitter-route/make_maps.py --png           # also write PNG chains to generated/
    python experiments/018-glitter-route/make_maps.py --preset A --size 2048x512

Nothing here reads game files. The plate constants below were measured from the built-in plate's
serialized mesh (see README, "Texel density"). Outputs under generated/ are ignored by git; only
result.json (numbers) is tracked. This is a research fixture, not a Studio exporter.
"""
from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, field, replace
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent

# --- Plate-local UV window --------------------------------------------------------------------
# Built-in plate UV0 bounds (mesh convention, V as stored): U 0.27319-0.72656, V 0.67627-0.82129.
# The window adds a small margin so sampling never wraps (s0 addresses with TA_Wrap).
WIN_U = (0.2686, 0.7312)
WIN_V_MESH = (0.6733, 0.8243)
WIN_V_TOP = (1 - WIN_V_MESH[1], 1 - WIN_V_MESH[0])  # glTF UV0 top-left, as the Studio authors
# Area-weighted median world length per unit UV on the plate (mm), per axis.
MM_PER_U, MM_PER_V = 569.0, 405.0

# Nominal render scales (internal pixels per mm of eyelid) for the framings the test card uses.
# Test setup: 3840x1600 output with DLSS at an assumed ~0.58 render scale. See README for the derivation.
FRAMINGS = {"close-up (eyes fill frame)": 16.0, "face framing": 3.0, "gameplay (~1 m)": 0.67}


def uv_transform() -> dict:
    """mesh_decal UV constants mapping the window to [0,1]: t = S*(u-0.5)+0.5+O (UVRotation 0)."""
    out = {}
    for axis, (a, b) in (("X", WIN_U), ("Y", WIN_V_MESH)):
        s = 1.0 / (b - a)
        o = -(s * ((a + b) / 2 - 0.5))  # window centre -> 0.5
        out[f"UVScale{axis}"], out[f"UVOffset{axis}"] = round(s, 6), round(o, 6)
    return out


# --- Flake model ------------------------------------------------------------------------------
@dataclass(frozen=True)
class Flakes:
    size_mm: float = 0.2          # median flake width
    size_sigma: float = 0.35      # log-normal spread of width
    cover: float = 0.15           # authored area fraction covered by flakes
    tilt_sigma: float = 25.0      # degrees, |N(0, sigma)| truncated at tilt_max
    tilt_max: float = 50.0
    rough: float = 0.22
    metal: float = 0.85
    colour: str = "#e8c46a"       # flake colour (sRGB)
    retention: float = 0.7        # share of flake area kept as representatives per level beyond the first enlarged one
    cap_mm: float = 1.2           # no representative flakes wider than this; the rest becomes sheen
    seed: int = 2077


@dataclass(frozen=True)
class Region:
    name: str
    rect: tuple[float, float, float, float]  # glTF UV0 top-left: u0, v0, u1, v1
    flakes: Flakes | None                    # None = pigment only (control)
    mips: str = "nested"                     # "nested" or "box"
    mirror_of: str | None = None             # reuse another region's catalogue, mirrored in u


@dataclass(frozen=True)
class Preset:
    key: str
    name: str
    regions: tuple[Region, ...]
    pigment: str = "#6d4a7e"
    pigment_rough: float = 0.50
    accent: tuple[str, float] | None = None  # (region name, share of flakes that also emit)
    notes: str = ""


LID = (.300, .211, .444, .248)
STRIPES = ((.300, .211, .350, .248), (.346, .211, .398, .248), (.394, .211, .444, .248))


def mirror(r):
    u0, v0, u1, v1 = r
    return (1 - u1, v0, 1 - u0, v1)


BASE = Flakes()
PRESETS = [
    Preset("A", "Glitter A · base", (
        Region("left lid glitter", LID, BASE),
        Region("right lid satin control", mirror(LID), None),
    ), notes="Primary recipe on the left lid; the same pigment without flakes on the right."),
    Preset("B", "Glitter B · mips", (
        Region("left lid nested mips", LID, BASE, "nested"),
        Region("right lid box mips", mirror(LID), BASE, "box", mirror_of="left lid nested mips"),
    ), notes="Identical base level (mirrored catalogue); only the mip chain differs."),
    Preset("C", "Glitter C · size", tuple(
        [Region(f"left {s} mm", STRIPES[i], replace(BASE, size_mm=s)) for i, s in enumerate((0.12, 0.25, 0.5))]
        + [Region(f"right {s} mm", mirror(STRIPES[i]), replace(BASE, size_mm=s, seed=4242)) for i, s in enumerate((0.12, 0.25, 0.5))]
    ), notes="Flake width 0.12 / 0.25 / 0.5 mm, outer to inner; right lid mirrors with another seed."),
    Preset("D", "Glitter D · surface", tuple(
        [Region(f"left rough {r}", STRIPES[i], replace(BASE, rough=r)) for i, r in enumerate((0.12, 0.22, 0.35))]
        + [Region(f"right metal {m}", mirror(STRIPES[i]), replace(BASE, metal=m, seed=4242)) for i, m in enumerate((1.0, 0.6, 0.25))]
    ), notes="Left: flake roughness 0.12 / 0.22 / 0.35 at metal 0.85. Right: metal 1.0 / 0.6 / 0.25 at roughness 0.22."),
    Preset("E", "Glitter E · accent", (
        Region("left lid glitter", LID, BASE),
        Region("right lid glitter", mirror(LID), BASE, mirror_of="left lid glitter"),
    ), accent=("left lid glitter", 0.08),
        notes="Primary on both lids; 8 % of the left lid's flakes also drive a mesh_decal_emissive_subsurface accent chunk."),
    Preset("F", "Glitter F · tilt", tuple(
        [Region(f"left tilt {s}/{m}", STRIPES[i], replace(BASE, tilt_sigma=s, tilt_max=m)) for i, (s, m) in enumerate(((10, 20), (25, 50), (40, 70)))]
        + [Region(f"right tilt {s}/{m}", mirror(STRIPES[i]), replace(BASE, tilt_sigma=s, tilt_max=m, seed=4242)) for i, (s, m) in enumerate(((10, 20), (25, 50), (40, 70)))]
    ), notes="Tilt spread sigma/max in degrees: 10/20, 25/50, 40/70, outer to inner."),
]


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def hex_rgb(h):
    return srgb_to_linear([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])


@dataclass
class Catalogue:
    cx: np.ndarray; cy: np.ndarray   # centres in mm (window coordinates)
    d: np.ndarray                    # widths in mm
    rot: np.ndarray; aspect: np.ndarray
    nx: np.ndarray; ny: np.ndarray   # tangent-space normal x/y
    key: np.ndarray                  # stable rank key in [0,1)
    area_mm2: float                  # region area


def rect_mm(rect):
    u0, v0, u1, v1 = rect
    return ((u0 - WIN_U[0]) * MM_PER_U, (v0 - WIN_V_TOP[0]) * MM_PER_V,
            (u1 - WIN_U[0]) * MM_PER_U, (v1 - WIN_V_TOP[0]) * MM_PER_V)


def catalogue(rect, f: Flakes, mirrored_from: Catalogue | None = None, mirror_rect=None) -> Catalogue:
    x0, y0, x1, y1 = rect_mm(rect)
    if mirrored_from is not None:
        sx0, _, sx1, _ = rect_mm(mirror_rect)
        c = mirrored_from
        return replace_cat(c, cx=x0 + (sx1 - c.cx), rot=-c.rot, nx=-c.nx)
    rng = np.random.default_rng(f.seed)
    area = (x1 - x0) * (y1 - y0)
    hex_area = 3 * math.sqrt(3) / 8  # regular hexagon area / width^2
    mean_area = hex_area * f.size_mm ** 2 * math.exp(2 * f.size_sigma ** 2) * 1.2  # aspect ~1.2 on average
    n = rng.poisson(f.cover * area / mean_area)
    tilt = np.abs(rng.normal(0, f.tilt_sigma, n))
    tilt = np.where(tilt > f.tilt_max, rng.uniform(0, f.tilt_max, n), tilt)
    az = rng.uniform(0, 2 * math.pi, n)
    s = np.sin(np.radians(tilt))
    return Catalogue(cx=rng.uniform(x0, x1, n), cy=rng.uniform(y0, y1, n),
                     d=f.size_mm * np.exp(f.size_sigma * rng.standard_normal(n)),
                     rot=rng.uniform(0, math.pi, n), aspect=rng.uniform(1.0, 1.4, n),
                     nx=s * np.cos(az), ny=s * np.sin(az), key=rng.random(n), area_mm2=area)


def replace_cat(c: Catalogue, **kw) -> Catalogue:
    vals = {k: getattr(c, k) for k in c.__dataclass_fields__}
    vals.update(kw)
    return Catalogue(**vals)


# --- Rasterization ----------------------------------------------------------------------------
SS = 4  # supersamples per texel axis
HEX = np.array([[math.cos(a), math.sin(a)] for a in np.arange(6) * math.pi / 3])


class Level:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.tu = (WIN_U[1] - WIN_U[0]) * MM_PER_U / w
        self.tv = (WIN_V_TOP[1] - WIN_V_TOP[0]) * MM_PER_V / h
        self.mask = np.zeros((h, w))
        self.nrm = np.zeros((h, w, 2))
        self.nown = np.full((h, w), np.inf)  # key of the flake that owns the (dilated) normal
        self.rough = np.zeros((h, w)); self.metal = np.zeros((h, w)); self.col = np.zeros((h, w, 3))

    def stamp(self, cx, cy, width, rot, aspect, nx, ny, key, rough, metal, col, dilate=2):
        r = width / 2
        poly = HEX * r
        poly[:, 0] *= aspect
        c, s = math.cos(rot), math.sin(rot)
        poly = poly @ np.array([[c, s], [-s, c]])
        px = (poly[:, 0] + cx) / self.tu
        py = (poly[:, 1] + cy) / self.tv
        x0, x1 = int(math.floor(px.min())) - dilate, int(math.ceil(px.max())) + dilate
        y0, y1 = int(math.floor(py.min())) - dilate, int(math.ceil(py.max())) + dilate
        x0c, x1c, y0c, y1c = max(x0, 0), min(x1, self.w), max(y0, 0), min(y1, self.h)
        if x0c >= x1c or y0c >= y1c:
            return
        # Supersampled inside test against the convex polygon's edges.
        xs = (np.arange(x0c * SS, x1c * SS) + 0.5) / SS
        ys = (np.arange(y0c * SS, y1c * SS) + 0.5) / SS
        X, Y = np.meshgrid(xs, ys)
        pos = np.ones_like(X, dtype=bool)
        neg = np.ones_like(X, dtype=bool)
        for i in range(6):
            ax, ay, bx, by = px[i], py[i], px[(i + 1) % 6], py[(i + 1) % 6]
            cr = (bx - ax) * (Y - ay) - (by - ay) * (X - ax)
            pos &= cr >= 0
            neg &= cr <= 0
        inside = pos | neg  # either winding
        cov = inside.reshape(y1c - y0c, SS, x1c - x0c, SS).mean(axis=(1, 3))
        sl = (slice(y0c, y1c), slice(x0c, x1c))
        m = self.mask[sl]
        self.rough[sl] = self.rough[sl] * (1 - cov) + rough * cov
        self.metal[sl] = self.metal[sl] * (1 - cov) + metal * cov
        self.col[sl] = self.col[sl] * (1 - cov[..., None]) + col * cov[..., None]
        self.mask[sl] = m + (1 - m) * cov
        # Dilated normal: the lowest-key flake within `dilate` texels owns the normal, so bilinear
        # and trilinear taps at a flake's edge read its full tilt; the mask carries the shape.
        own = self.nown[sl]
        prio = np.where(cov > 0, key - 10.0, key)  # a flake's own footprint always beats a neighbour's dilation
        take = prio < own
        self.nown[sl] = np.where(take, prio, own)
        self.nrm[sl] = np.where(take[..., None], np.array([nx, ny]), self.nrm[sl])


def build_levels(preset: Preset, W: int, H: int):
    """Return per-level dicts of channels for the nested chain and the plain BOX chain."""
    cats: dict[str, Catalogue] = {}
    for rg in preset.regions:
        if rg.flakes is None:
            continue
        if rg.mirror_of:
            src = next(r for r in preset.regions if r.name == rg.mirror_of)
            cats[rg.name] = catalogue(rg.rect, rg.flakes, cats[src.name], src.rect)
        else:
            cats[rg.name] = catalogue(rg.rect, rg.flakes)
    pig = hex_rgb(preset.pigment)
    levels, stats = [], []
    n_levels = int(math.log2(min(W, H))) + 1
    for L in range(n_levels):
        w, h = W >> L, H >> L
        lv = Level(w, h)
        region_masks = {}
        lvl_stats = {"level": L, "size": f"{w}x{h}", "texel_mm": [round(lv.tu, 4), round(lv.tv, 4)], "regions": {}}
        for rg in preset.regions:
            x0, y0, x1, y1 = rect_mm(rg.rect)
            rm = np.zeros((h, w), dtype=bool)
            rm[int(y0 / lv.tv):int(math.ceil(y1 / lv.tv)), int(x0 / lv.tu):int(math.ceil(x1 / lv.tu))] = True
            region_masks[rg.name] = rm
            if rg.flakes is None:
                continue
            f, c = rg.flakes, cats[rg.name]
            t = max(lv.tu, lv.tv)
            dL = np.maximum(c.d, 2 * t)
            t0 = t / 2 ** L
            first_enlarged = max(0, math.floor(math.log2(f.size_mm / (2 * t0))) + 1)  # first level whose 2-texel minimum exceeds the median width
            target = f.cover * (f.retention ** max(0, L - first_enlarged))
            order = np.argsort(c.key)
            areas = (3 * math.sqrt(3) / 8) * dL[order] ** 2 * c.aspect[order]
            keep_n = int(np.searchsorted(np.cumsum(areas), target * c.area_mm2, side="right"))
            keep = order[:keep_n]
            keep = keep[dL[keep] <= f.cap_mm]
            col = hex_rgb(f.colour)
            for i in keep[::-1]:  # highest key first, so the lowest keys (kept longest) end on top
                lv.stamp(c.cx[i], c.cy[i], dL[i], c.rot[i], c.aspect[i], c.nx[i], c.ny[i], c.key[i], f.rough, f.metal, col)
            lvl_stats["regions"][rg.name] = {"catalogue": int(len(c.key)), "represented": int(len(keep)),
                                              "min_width_texels": round(float(dL[keep].min() / t), 2) if len(keep) else None,
                                              "target_cover": round(target, 4)}
        levels.append((lv, region_masks))
        stats.append(lvl_stats)
    return cats, levels, stats, pig


def finalize(preset: Preset, levels, pig):
    """Turn raster levels into material channels, including the sheen for unrepresented flakes."""
    out = []
    for lv, rmasks in levels:
        rough = np.full((lv.h, lv.w), preset.pigment_rough)
        metal = np.zeros((lv.h, lv.w))
        col = np.broadcast_to(pig, (lv.h, lv.w, 3)).copy()
        for rg in preset.regions:
            if rg.flakes is None:
                continue
            f, rm = rg.flakes, rmasks[rg.name]
            represented = lv.mask[rm].mean() if rm.any() else 0.0
            unrep = max(0.0, f.cover - represented)
            share = unrep / max(1e-6, 1 - represented)
            v = float(np.mean(np.sin(np.radians(np.clip(np.abs(np.random.default_rng(1).normal(0, f.tilt_sigma, 4096)), 0, f.tilt_max))) ** 2))
            r_sheen = ((f.rough ** 2) ** 2 + v) ** 0.25
            rough[rm] = preset.pigment_rough * (1 - share) + r_sheen * share
            metal[rm] = f.metal * share
            col[rm] = pig * (1 - share) + hex_rgb(f.colour) * share
        m = lv.mask
        # lv.rough/metal/col are premultiplied by flake coverage ("over" compositing from zero).
        ch = {"mask": m, "nx": lv.nrm[..., 0], "ny": lv.nrm[..., 1],
              "rough": rough * (1 - m) + lv.rough, "metal": metal * (1 - m) + lv.metal,
              "col": col * (1 - m[..., None]) + lv.col}
        out.append(ch)
    return out


def box_chain(base: dict, n: int):
    """The faceted route's rule: plain 2x2 BOX means of the base level (normal X/Y averaged)."""
    chain = [base]
    for _ in range(1, n):
        prev = chain[-1]
        nxt = {}
        for k, v in prev.items():
            h, w = v.shape[:2]
            v = v[:h // 2 * 2, :w // 2 * 2]
            nxt[k] = (v[0::2, 0::2] + v[1::2, 0::2] + v[0::2, 1::2] + v[1::2, 1::2]) / 4
        chain.append(nxt)
    return chain


def gate(nx, ny):
    """NormalsBlendingMode 1 alpha factor saturate(50 - 50 z), z = sqrt(1 - x^2 - y^2)."""
    z = np.sqrt(np.clip(1 - nx ** 2 - ny ** 2, 0, 1))
    return np.clip(50 - 50 * z, 0, 1)


# --- Lit glint measurement ----------------------------------------------------------------------
# Each texel stands for one internal pixel (the framing at which this level is sampled). The decal's
# normal (mode 1 over flat skin) is lerp(flat, flake, NormalAlpha x mask x gate), normalised by the light.
# Specular is the skin class's two GGX lobes at roughness x 0.966 and x 1.597 (default skin profile),
# F0 = lerp(0.04, albedo luminance, metalness); visibility and NdotL are omitted (relative measure).
# A texel "sparkles" when its specular exceeds GLINT_X times the flat pigment's own highlight peak (N = H),
# i.e. it clearly outshines the brightest point the plain satin pigment can ever show.
# The temporal filter is the decoded m_simpleTemporal rule: history clamped to mean +- 1 sigma of the
# 5-tap cross, blended 5 % per frame; for a stable glint the steady state is min(v, 0.05 v + 0.95 (mu + sigma)).
V_DIR = np.array([0.0, 0.0, 1.0])
LIGHTS = [np.array([math.sin(t) * math.cos(a), math.sin(t) * math.sin(a), math.cos(t)])
          for t in np.radians([10, 20, 30, 40, 50]) for a in np.radians(np.arange(0, 360, 30))]
GLINT_X = 20.0


def ggx(nh, alpha):
    a2 = alpha * alpha
    d = nh * nh * (a2 - 1) + 1
    return a2 / (math.pi * d * d)


def spec_field(nx, ny, w, rough, metal, lum, l):
    z = np.sqrt(np.clip(1 - nx ** 2 - ny ** 2, 0, 1))
    n = np.stack([nx * w, ny * w, 1 - w + z * w], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    h = (l + V_DIR); h /= np.linalg.norm(h)
    nh = np.clip(n @ h, 0, 1)
    nl = np.clip(n @ l, 0, 1)
    f0 = 0.04 + (lum - 0.04) * metal
    r = np.clip(rough, 0.04, 1)
    return f0 * (ggx(nh, (r * 0.966) ** 2) + ggx(nh, (r * 1.597) ** 2)) * (nl > 0)


def taa_retained(v):
    """Steady-state share of each texel's value kept by the mean +- sigma cross clamp (5 % blend)."""
    p = np.pad(v, 1, mode="edge")
    taps = np.stack([p[1:-1, 1:-1], p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
    mu, sd = taps.mean(0), taps.std(0)
    return np.minimum(v, 0.05 * v + 0.95 * (mu + sd))


def glint_metrics(ch, rm, lv_tex_mm, pig_rough, use_mask=True):
    """Share of region pixels that glint, averaged over 60 light directions, before and after the temporal clamp."""
    if not rm.any():
        return None
    ys, xs = np.nonzero(rm)
    sl = (slice(max(ys.min() - 1, 0), ys.max() + 2), slice(max(xs.min() - 1, 0), xs.max() + 2))
    sub = rm[sl]
    nx, ny = ch["nx"][sl], ch["ny"][sl]
    w = gate(nx, ny) * (ch["mask"][sl] if use_mask else 1.0)
    lum = (ch["col"][sl] @ np.array([0.2126, 0.7152, 0.0722]))
    count = survive = 0.0
    r = max(pig_rough, 0.04)
    base = 0.04 * (ggx(1.0, (r * 0.966) ** 2) + ggx(1.0, (r * 1.597) ** 2))
    for l in LIGHTS:
        sp = spec_field(nx, ny, w, ch["rough"][sl], ch["metal"][sl], lum, l)
        count += ((sp > GLINT_X * base) & sub).sum()
        survive += ((taa_retained(sp) > GLINT_X * base) & sub).sum()
    n, px = len(LIGHTS), sub.sum()
    return {"sparkle_px_pct": round(float(100 * count / n / px), 3),
            "after_taa_pct": round(float(100 * survive / n / px), 3)}


def today_chain(base, n):
    """Today's faceted rule, for comparison: flake normal x coverage (flat between flakes) and the
    surface maps BOX-averaged from the same base level; no separate normal mask."""
    return box_chain({"nx": base["nx"] * base["mask"], "ny": base["ny"] * base["mask"],
                      "mask": np.ones_like(base["mask"]), "rough": base["rough"], "metal": base["metal"],
                      "col": base["col"]}, n)


def compose_chain(preset, nested, levels):
    """Per region choose the nested or the BOX chain (texel-wise by region rectangle)."""
    box = box_chain(nested[0], len(nested))
    chain = []
    for L, (ch, (lv, rmasks)) in enumerate(zip(nested, levels)):
        out = {k: v.copy() for k, v in ch.items()}
        for rg in preset.regions:
            if rg.mips == "box":
                rm = rmasks[rg.name]
                b = box[L]
                for k in out:
                    out[k][rm] = b[k][rm]
        chain.append(out)
    return chain, box


def screen_table(preset: Preset, W: int, H: int):
    t0 = max((WIN_U[1] - WIN_U[0]) * MM_PER_U / W, (WIN_V_TOP[1] - WIN_V_TOP[0]) * MM_PER_V / H)
    rows = {}
    for name, ppm in FRAMINGS.items():
        lod = max(0.0, math.log2(1 / (ppm * t0)))
        L = int(round(lod))
        rep = max(BASE.size_mm, 2 * t0 * 2 ** L)
        rows[name] = {"internal_px_per_mm": ppm, "lod": round(lod, 2),
                      "representative_flake_mm": round(rep, 3) if rep <= BASE.cap_mm else None,
                      "representative_flake_px": round(rep * ppm, 2) if rep <= BASE.cap_mm else None}
    return rows


def write_pngs(preset: Preset, chain, out: Path, accent=None):
    from PIL import Image
    d = out / preset.key
    d.mkdir(parents=True, exist_ok=True)
    for L, ch in enumerate(chain):
        b = lambda v: (np.clip(v, 0, 1) * 255 + 0.5).astype(np.uint8)
        Image.fromarray(b(ch["mask"])).save(d / f"normal_alpha_L{L}.png")
        n = np.dstack([b(ch["nx"] * .5 + .5), b(ch["ny"] * .5 + .5), np.full(ch["nx"].shape, 255, np.uint8)])
        Image.fromarray(n).save(d / f"normal_L{L}.png")
        Image.fromarray(b(ch["rough"])).save(d / f"roughness_L{L}.png")
        Image.fromarray(b(ch["metal"])).save(d / f"metalness_L{L}.png")
        Image.fromarray(b(linear_to_srgb(ch["col"]))).save(d / f"diffuse_rgb_L{L}.png")


def run(preset: Preset, W: int, H: int, png: bool, max_levels: int = 6):
    cats, levels, stats, pig = build_levels(preset, W, H)
    nested = finalize(preset, levels, pig)
    chain, box = compose_chain(preset, nested, levels)
    today = today_chain(nested[0], len(nested))
    for rg in preset.regions:
        if rg.flakes is None:
            continue
        for L, (lv, rmasks) in enumerate(levels[:max_levels]):
            rm = rmasks[rg.name]
            s = stats[L]["regions"][rg.name]
            s["mask_mean"] = round(float(chain[L]["mask"][rm].mean()), 4)
            tex = (lv.tu, lv.tv)
            s["glint_shipped"] = glint_metrics(chain[L], rm, tex, preset.pigment_rough)
            if rg.mips == "nested":
                s["glint_box_same_base"] = glint_metrics(box[L], rm, tex, preset.pigment_rough)
                s["glint_today_rule"] = glint_metrics(today[L], rm, tex, preset.pigment_rough, use_mask=False)
    if png:
        write_pngs(preset, chain, HERE / "generated")
    accent = None
    if preset.accent:
        region, share = preset.accent
        c = cats[region]
        accent = {"region": region, "share": share, "flakes": int((c.key < share).sum()),
                  "template": "base/materials/mesh_decal_emissive_subsurface.mt",
                  "note": "No UV transform in this template: the mask lives in the head UV atlas (2048 recommended, about 0.25 mm/texel on the lid); accent flakes are drawn at >= 2 texels there."}
    return {"key": preset.key, "name": preset.name, "name_length": len(preset.name), "notes": preset.notes,
            "regions": {rg.name: {"rect_gltf_uv": rg.rect, "mips": rg.mips,
                                  "flakes": None if rg.flakes is None else rg.flakes.__dict__} for rg in preset.regions},
            "levels": stats, "accent": accent}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preset", action="append", help="preset key(s) A-F; default all")
    ap.add_argument("--size", default="4096x1024", help="base texture size WxH (default 4096x1024)")
    ap.add_argument("--png", action="store_true", help="write PNG chains under generated/")
    ap.add_argument("--levels", type=int, default=6, help="levels to measure and report (default 6)")
    a = ap.parse_args()
    W, H = (int(x) for x in a.size.lower().split("x"))
    chosen = [p for p in PRESETS if not a.preset or p.key in a.preset]
    t = uv_transform()
    result = {
        "experiment": "018-glitter-route",
        "window": {"u_mesh": WIN_U, "v_mesh": WIN_V_MESH, "v_gltf_top_left": [round(v, 4) for v in WIN_V_TOP],
                   "mm_per_uv": [MM_PER_U, MM_PER_V], "size": [W, H], "material_constants": t,
                   "texel_mm": [round((WIN_U[1] - WIN_U[0]) * MM_PER_U / W, 4), round((WIN_V_TOP[1] - WIN_V_TOP[0]) * MM_PER_V / H, 4)],
                   "current_atlas_texel_mm_at_1024": [round(MM_PER_U / 1024, 3), round(MM_PER_V / 1024, 3)]},
        "framings": screen_table(PRESETS[0], W, H),
        "presets": [],
    }
    for p in chosen:
        r = run(p, W, H, a.png, a.levels)
        r["levels"] = r["levels"][:a.levels]
        result["presets"].append(r)
        for s in r["levels"]:
            print(p.key, s["level"], s["size"], {k: (v.get("represented"), v.get("glint_shipped"), v.get("glint_box_same_base"), v.get("glint_today_rule")) for k, v in s["regions"].items()})
    path = HERE / "result.json"
    if not a.preset and (W, H) == (4096, 1024):
        path.write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
        print("wrote", path)
    else:
        print(json.dumps(result["window"], indent=1))


if __name__ == "__main__":
    main()
