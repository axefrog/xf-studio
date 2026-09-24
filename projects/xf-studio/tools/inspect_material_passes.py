"""Summarize locally serialized authoritative templates; never modify game resources."""
import hashlib
import json
from pathlib import Path

HQ = Path(__file__).resolve().parents[3]
ROOT = HQ / "research/consumers/glitter"
items = []
for name, depot in [
    ("multilayered", "engine/materials/multilayered.mt"),
    ("mesh_decal", "base/materials/mesh_decal.mt"),
]:
    binary = ROOT / "extracted" / depot
    serialized = ROOT / "json" / f"{name}.mt.json"
    document = json.loads(serialized.read_text(encoding="utf-8-sig"))
    data = document["Data"]["RootChunk"]
    passes = []
    for technique in data["techniques"]:
        for p in technique["passes"]:
            b = p["blendMode"]
            passes.append({
                "featureFlags": technique["featureFlagsEnabledMask"]["flags"],
                "stage": p["stagePassNameRegular"]["$value"],
                "depthWrite": p["depthStencilMode"]["depthWriteEnable"],
                "targets": [{k: target[k] for k in ["blendEnable", "srcFactor", "destFactor", "colorOp"]}
                            for target in b["renderTarget"]["Elements"][:b["numTargets"]]],
            })
    items.append({
        "depot": depot,
        "binarySha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        "jsonSha256": hashlib.sha256(serialized.read_bytes()).hexdigest(),
        "gameVersion": document["Header"]["GameVersion"],
        "wolvenKitVersion": document["Header"]["WolvenKitVersion"],
        "canBeMasked": data["canBeMasked"],
        "parameters": sorted({p["name"]["$value"] for group in data["parameterInfo"] for p in group}),
        "passes": passes,
    })
output = HQ / "research/materials/evidence/multilayered-decal-passes.json"
output.write_text(json.dumps({"templates": items, "scope": "Serialized template render states; not runtime pipeline capture."}, indent=2) + "\n")
print(output)
