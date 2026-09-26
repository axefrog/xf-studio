"""Brow material chain, gradient inputs and the clip, creator entries (experiment 025).

Reads serialized resources (WolvenKit 9.0.1 JSON, ignored local extracts):
- eyebrows_grad__default.mi and the 35 per-colour .mi files;
- the 35 hh_cap_grad__<colour>.xbm gradients (decoded with Pillow's BC7 decoder);
- the female and male brow meshes' local materials (style overrides);
- the vanilla and two CCXL mods' character-customisation resources (eyebrows entries).
Writes generated/materials.json.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

import numpy as np

from common import HERE, cr2w, fnv1a64, mi_params, val, xbm

LINEAR_TONE_VANILLA = None  # filled from textures.json when present


def srgb_to_linear(c):
    c = np.asarray(c, np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def gradient_facts(path: Path, uv: float) -> dict:
    x = xbm(path)
    img = x["images"][0].astype(np.float64)  # 4 rows x 32 texels, stored (GPU) row order
    h, w = img.shape[:2]
    lin = srgb_to_linear(img[..., :3]) if x["isGamma"] else img[..., :3] / 255.0
    # v = 0.5 falls between rows 1 and 2: bilinear average of those rows (identical rows make this moot).
    rowmix = 0.5 * (lin[h // 2 - 1] + lin[h // 2])
    fx = uv * w - 0.5                       # texel-centre coordinate
    i0 = int(np.floor(fx)); t = fx - i0
    clamp = (1 - t) * rowmix[min(max(i0, 0), w - 1)] + t * rowmix[min(max(i0 + 1, 0), w - 1)]
    wrap = (1 - t) * rowmix[i0 % w] + t * rowmix[(i0 + 1) % w]
    rows_equal = bool(np.all(img == img[:1]))
    return {"size": [w, h], "isGamma": x["isGamma"], "compression": x["compression"], "mipCount": x["mipCount"],
            "rowsIdentical": rows_equal,
            "sampleLinear_clamp": [round(float(v), 4) for v in clamp],
            "sampleLinear_wrap": [round(float(v), 4) for v in wrap],
            "firstTexelLinear": [round(float(v), 4) for v in rowmix[0]],
            "channelsAbove0.5_clamp": int((clamp > 0.5).sum()), "channelsAbove0.5_wrap": int((wrap > 0.5).sum()),
            "maxChannel_clamp": round(float(clamp.max()), 4)}


def cc_entries(path: Path) -> dict:
    r = cr2w(path)
    out = {"switchers": [], "appearanceOptions": 0, "sampleOption": None, "headGroups": {}}
    opts = [o["Data"] for o in r["headCustomizationOptions"]]
    for o in opts:
        if o["$type"] == "gameuiSwitcherInfo" and val(o["name"]) == "eyebrows":
            out["switchers"].append({
                "name": "eyebrows", "localizedName": o.get("localizedName"), "defaultIndex": o.get("defaultIndex"),
                "uiSlots": [val(s) for s in o.get("uiSlots", [])], "editTags": o.get("editTags"),
                "options": len(o["options"]),
                "firstOptions": [{"localizedName": c.get("localizedName"), "names": [val(n) for n in c["names"]], "index": c.get("index")}
                                 for c in o["options"][:3]],
                "lastOption": {"localizedName": o["options"][-1].get("localizedName"), "names": [val(n) for n in o["options"][-1]["names"]]},
                "localizedNameKinds": dict(Counter("LocKey" if str(c.get("localizedName", "")).startswith("LocKey") else
                                                   ("UI-key" if str(c.get("localizedName", "")).startswith("UI-") else
                                                    ("empty" if not c.get("localizedName") else "plain text")) for c in o["options"])),
            })
    brow_opts = [o for o in opts if o["$type"] == "gameuiAppearanceInfo" and str(val(o.get("uiSlot", o.get("slot", "")))) and
                 str(val(o.get("link"))) == "eyebrows color"]
    out["appearanceOptions"] = len(brow_opts)
    if brow_opts:
        o = brow_opts[min(1, len(brow_opts) - 1)]
        defs = o.get("definitions", [])
        out["sampleOption"] = {
            "name": val(o["name"]), "localizedName": o.get("localizedName"), "uiSlot": val(o.get("uiSlot")),
            "link": val(o.get("link")), "resource": val(o.get("resource")), "useThumbnails": o.get("useThumbnails"),
            "enabled": o.get("enabled"), "hidden": o.get("hidden"), "definitions": len(defs),
            "firstDefinition": ({k: val(v) for k, v in defs[0].items() if k in ("name", "index", "localizedName", "icon", "tags")}
                                if defs else None),
        }
        out["optionNames"] = [val(b["name"]) for b in brow_opts][:3] + ["…"] + [val(b["name"]) for b in brow_opts][-2:]
    brow_names = {"eyebrows"} | {str(val(b["name"])) for b in brow_opts}
    for g in r.get("headGroups", []):
        gd = g.get("Data", g)
        names = [str(val(n)) for n in gd.get("options", [])]
        brows = [n for n in names if n in brow_names]
        if brows:
            out["headGroups"][val(gd.get("name"))] = {"browEntries": len(brows), "switcherListed": "eyebrows" in brows}
    if brow_opts:
        o = brow_opts[0]
        out["optionFields"] = {"index": o.get("index"), "linkController": o.get("linkController"),
                               "randomizeCategory": o.get("randomizeCategory"),
                               "resourceFlags": o.get("resource", {}).get("Flags") if isinstance(o.get("resource"), dict) else None}
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--extracts", type=Path, required=True, help="research/consumers/brows-cheeks")
    ap.add_argument("--mods-json", type=Path, required=True, help="research/consumers/brows-cheeks-mods/json")
    ap.add_argument("--out", type=Path, default=HERE / "generated")
    a = ap.parse_args()
    G = a.extracts / "json/base/characters/common/character_customisation_items/eyebrows/grad"
    res: dict = {}
    d = cr2w(G / "eyebrows_grad__default.mi.json")
    res["default_mi"] = {"baseMaterial": val(d["baseMaterial"]), "params": mi_params(d),
                         "fnv1a64": str(fnv1a64("base\\characters\\common\\character_customisation_items\\eyebrows\\grad\\eyebrows_grad__default.mi"))}
    colours = {}
    for f in sorted(G.glob("eyebrows_grad__*.mi.json")):
        c = f.name[len("eyebrows_grad__"):-len(".mi.json")]
        if c == "default":
            continue
        r = cr2w(f)
        p = mi_params(r)
        colours[c] = {"base": str(val(r["baseMaterial"])).split("\\")[-1], "params": {k: (str(v).split("\\")[-1] if isinstance(v, str) else v) for k, v in p.items()}}
    res["colour_mi"] = colours
    # Gradients and the clip.
    tone = None
    tj = a.out / "textures.json"
    if tj.exists():
        t = json.loads(tj.read_text())
        used = [t["vanilla"][s]["d"]["rgbLinear_coverageWeighted_mean"] for s in ("01", "02", "03", "04", "05", "06", "07", "08", "12", "13", "14", "15", "16")]
        tone = float(np.mean(used))
        res["vanillaToneLinear_mean_creatorSets"] = round(tone, 4)
    grads = {}
    X = a.extracts / "json/xbm"
    for c, info in colours.items():
        gm = info["params"].get("GradientMap") or f"hh_cap_grad__black_carbon.xbm"  # black_carbon inherits the default
        uv = info["params"].get("GradientMapUV", res["default_mi"]["params"].get("GradientMapUV", 1.0))
        p = X / (gm + ".json")
        if not p.exists():
            grads[c] = {"missing": gm}
            continue
        g = gradient_facts(p, float(uv))
        g["file"] = gm
        g["GradientMapUV"] = uv
        if tone is not None:
            for mode in ("clamp", "wrap"):
                s = np.array(g[f"sampleLinear_{mode}"])
                g[f"vanillaBrowColourLinear_{mode}"] = [round(float(v), 4) for v in np.clip(2 * s, 0, 1) * tone]
                g[f"ratioToGradient_{mode}"] = [round(float(v), 3) for v in (np.clip(2 * s, 0, 1) * tone / np.maximum(s, 1e-6))]
        grads[c] = g
    res["gradients"] = grads
    res["clipSummary"] = {
        "coloursWithAnyChannelAbove0.5_clamp": sorted(c for c, g in grads.items() if g.get("channelsAbove0.5_clamp")),
        "coloursWithAnyChannelAbove0.5_wrap": sorted(c for c, g in grads.items() if g.get("channelsAbove0.5_wrap")),
        "coloursWhereWrapAndClampDifferBy>0.02": sorted(c for c, g in grads.items() if "sampleLinear_wrap" in g and
                                                        np.abs(np.array(g["sampleLinear_wrap"]) - np.array(g["sampleLinear_clamp"])).max() > 0.02),
    }
    # Style overrides in the brow meshes' local materials.
    M = a.extracts / "json/base/characters/head/player_base_heads"
    for g, rel in (("female", "player_female_average/heb_000_pwa_c__basehead.mesh.json"),
                   ("male", "player_man_average/heb_000_pma_c__basehead.mesh.json")):
        r = cr2w(M / rel)
        mats = r["localMaterialBuffer"]["materials"]
        keys, bases = Counter(), Counter()
        extra_vals = Counter()
        for e in r["materialEntries"]:
            m = mats[e["index"]]
            p = mi_params(m)
            keys[tuple(sorted(p))] += 1
            bases[str(val(m["baseMaterial"])).split("\\")[-1].split("__")[0]] += 1
            for k, v in p.items():
                if k not in ("DiffuseTexture", "SecondaryDiffuseAlpha", "NormalTexture"):
                    extra_vals[(k, str(v))] += 1
        res[f"mesh_{g}"] = {"materials": len(r["materialEntries"]), "paramSets": {"|".join(k): n for k, n in keys.items()},
                            "baseFamilies": dict(bases), "otherOverrides": {f"{k}={v}": n for (k, v), n in extra_vals.items()}}
    # Creator entries: vanilla (female, male) and the two CCXL brow mods.
    C = a.extracts / "json/cco/basegame_4_gamedata"
    res["cc"] = {"vanilla_female": cc_entries(C / "female_cco.inkcharcustomization.json"),
                 "vanilla_male": cc_entries(C / "male_cco.inkcharcustomization.json"),
                 "arkhe2_female": cc_entries(a.mods_json / "ark_eyebrows_02_ccxl_pwa.inkcharcustomization.json"),
                 "evenmorebrows_female": cc_entries(a.mods_json / "ck_emb_pwa.inkcharcustomization.json")}
    # Mod style materials.
    for key, f in (("arkhe2_style18", "ark_eyebrows_02__18.mi.json"), ("evenmorebrows_01", "ck_emb__01.mi.json")):
        r = cr2w(a.mods_json / f)
        res[f"mi_{key}"] = {"baseMaterial": val(r["baseMaterial"]), "params": mi_params(r)}
    (a.out / "materials.json").write_text(json.dumps(res, indent=1, default=str))
    print("wrote", a.out / "materials.json")


if __name__ == "__main__":
    main()
