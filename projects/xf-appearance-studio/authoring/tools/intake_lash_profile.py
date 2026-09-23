"""Create an ignored, exact-save lash profile manifest from audited local sources."""
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parents[1] / "public/assets/lashes"
PROFILE = ROOT / "research/consumers/base-brow-template/json/brown_liquorice.hp.json"
RESOURCE = ROOT / "research/consumers/lash-profile-base/base/characters/common/hair/textures/hair_profiles/brown_liquorice.hp"
PLACEHOLDERS = ROOT / "research/consumers/hair-placeholders/raw/base/materials/placeholder"

assert hashlib.sha256(RESOURCE.read_bytes()).hexdigest() == "57b9999e9918137ada13e536ccc130caca48f6aca08290525063b54b9e2cdcec"
assert hashlib.sha256(PROFILE.read_bytes()).hexdigest() == "92b72500dca0caa7eacb1582aeae5bf13e2e943456116ffdd54bf08863213a01"
for name, digest in (
    ("grey", "54add2f6f731ce8c208ec4f735140099c0d945357b0cf7f0b537c3f6517abac2"),
    ("white", "3ebfe32c143d33a422e093a51ee55cca1ebf575944aab6d5ed867412191d9140"),
):
    assert hashlib.sha256((PLACEHOLDERS / f"{name}.png").read_bytes()).hexdigest() == digest

def rgb(color):
    return [color[c] for c in ("Red", "Green", "Blue")]

def stops(entries):
    return [{"value": item["value"], "color": rgb(item["color"])} for item in entries]

root = json.loads(PROFILE.read_text(encoding="utf-8"))["Data"]["RootChunk"]
manifest = {
    "schema": "xfs/lash-profile-preview-1",
    "appearanceHash": "6047185506343464350",
    "definition": "05_brown_liquorice",
    "profileResourceSha256": "57b9999e9918137ada13e536ccc130caca48f6aca08290525063b54b9e2cdcec",
    "strandId": list(Image.open(PLACEHOLDERS / "grey.png").convert("RGB").getpixel((0, 0))),
    "strandGradient": list(Image.open(PLACEHOLDERS / "white.png").convert("RGB").getpixel((0, 0))),
    "selectorSwatch": [50, 44, 40],
    "id": stops(root["gradientEntriesID"]),
    "rootToTip": stops(root["gradientEntriesRootToTip"]),
}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "profile.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(OUT / "profile.json")
