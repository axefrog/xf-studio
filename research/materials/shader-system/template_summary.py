"""Summarise serialized material templates (.mt/.remt JSON from WolvenKit CLI).

Read-only. Input: the ignored research/consumers/shader-system/raw/templates tree produced by
  WolvenKit.CLI unbundle memoryresident_1_general.archive -r "\\.(mt|remt)$" -o <tree>
  WolvenKit.CLI convert serialize <tree>
Output: research/consumers/shader-system/json/template-summary.json (ignored), plus a
Markdown table on stdout for the templates named on the command line (default: all).

  python template_summary.py [depot/path/regex ...]

Per template: materialType (lighting class written to stencil; see knowledge page),
materialPriority, canBeMasked, vertex factories, every technique pass (stage names,
depth test/write, stencil, cull, per-target blend) and every parameter with its type,
register, default and whether the compiled variant set marks it as used.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HQ = Path(__file__).resolve().parents[3]
TREE = HQ / "research/consumers/shader-system/raw/templates"
OUT = HQ / "research/consumers/shader-system/json/template-summary.json"


def val(x):
    if isinstance(x, dict):
        if "$value" in x:
            return x["$value"]
        if "DepotPath" in x:
            return val(x["DepotPath"])
        if set(x) >= {"X", "Y", "Z", "W"}:
            return [x["X"], x["Y"], x["Z"], x["W"]]
        if set(x) >= {"Red", "Green", "Blue", "Alpha"}:
            return [x["Red"], x["Green"], x["Blue"], x["Alpha"]]
    return x


def param_default(d):
    for key in ("scalar", "vector", "color", "texture", "hairProfile", "skinProfile", "setup", "mask",
                "gradient", "cubeTexture", "textureArray", "enumeration"):
        if key in d:
            return val(d[key])
    return None


def summarise(path: Path):
    doc = json.loads(path.read_text(encoding="utf-8-sig"))
    r = doc["Data"]["RootChunk"]
    used = {(g, u["name"]["$value"]): u["register"] for g, grp in enumerate(r["usedParameters"]["Elements"]) for u in grp}
    params = []
    for g, grp in enumerate(r["parameters"]["Elements"]):
        for h in grp:
            d = h["Data"]
            name = d["parameterName"]["$value"]
            params.append({"group": g, "name": name, "type": d["$type"].replace("CMaterialParameter", ""),
                           "register": d.get("register"), "default": param_default(d),
                           "usedRegister": used.get((g, name))})
    passes = []
    for t in r["techniques"]:
        for p in t["passes"]:
            b, ds = p["blendMode"], p["depthStencilMode"]
            targets = []
            for rt in b["renderTarget"]["Elements"][:b["numTargets"]]:
                targets.append("off" if not rt["blendEnable"] else
                               f"{rt['srcFactor']}/{rt['destFactor']} a:{rt['srcAlphaFactor']}/{rt['destAlphaFactor']} {rt['writeMask']}")
            passes.append({"flags": t["featureFlagsEnabledMask"]["flags"], "stage": p["stagePassNameRegular"]["$value"],
                           "discardedStage": p["stagePassNameDiscarded"]["$value"],
                           "depthTest": ds["depthTestEnable"], "depthWrite": ds["depthWriteEnable"],
                           "depthFunc": ds["depthFunc"], "stencil": ds["stencilEnable"],
                           "cull": p["rasterizerMode"]["cullMode"], "pixelShader": p["enablePixelShader"],
                           "targets": targets})
    return {"path": str(path.relative_to(TREE)).replace("\\", "/")[:-5], "gameVersion": doc["Header"]["GameVersion"],
            "materialType": r.get("materialType"), "materialPriority": r.get("materialPriority"),
            "canBeMasked": r.get("canBeMasked"), "vertexFactories": r.get("vertexFactories"),
            "parameters": params, "passes": passes}


def main():
    items = [summarise(p) for p in sorted(TREE.rglob("*.json"))]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(items, indent=1))
    pats = [re.compile(a) for a in sys.argv[1:]]
    for it in items:
        if pats and not any(p.search(it["path"]) for p in pats):
            continue
        print(f"\n## {it['path']}  type={it['materialType']} priority={it['materialPriority']} masked={it['canBeMasked']}")
        print("VF:", ", ".join(v.replace("MVF_", "") for v in it["vertexFactories"] or []))
        seen = set()
        for p in it["passes"]:
            key = (p["stage"], p["depthWrite"], tuple(p["targets"]), p["pixelShader"])
            if key in seen:
                continue
            seen.add(key)
            print(f"  pass {p['stage']}: depthW={p['depthWrite']} ps={p['pixelShader']} cull={p['cull']} targets={p['targets']}")
        for q in it["parameters"]:
            print(f"  [{q['group']}] {q['name']}: {q['type']} reg={q['register']} used={q['usedRegister']} default={q['default']}")


if __name__ == "__main__":
    main()
