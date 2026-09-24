"""Create an ignored strand-profile manifest (hair.mt detail with constant placeholder inputs).

Generic: every installed provider of the material's HairProfile depot path is
listed as a candidate; the browser applies the generic depot rule
(src/depot-resolution.ts) or an explicit --override. No provider is special-cased.

Usage (paths are local, ignored extractions; nothing here is copied into Git):

  python tools/intake_lash_profile.py \
    --appearance 6047185506343464350 --definition 05_brown_liquorice --swatch 50,44,40 \
    --depot-path "base\\characters\\common\\hair\\textures\\hair_profiles\\brown_liquorice.hp" \
    --mi <most-derived .mi.json> --mi <next .mi.json> ... \
    --candidate "basegame_4_appearance.archive|base|<extracted .hp>|<.hp.json>|<container sha256>" \
    --candidate "<mod archive name>|mod|<extracted .hp>|<.hp.json>|<container sha256>" \
    [--override "<archive name>"] [--placeholders <dir with grey.png/white.png>] [--out <dir>]
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
SCALARS = {"AlphaCutoff": "alphaCutoff", "RoughnessScale": "roughnessScale", "RoughnessBias": "roughnessBias",
           "ShadowStrength": "shadowStrength", "ShadowMin": "shadowMin", "ShadowMax": "shadowMax",
           "ShadowRoughness": "shadowRoughness", "FlowStrength": "flowStrength", "Scattering": "scattering"}
PLACEHOLDER_DIGESTS = {
    "grey": "54add2f6f731ce8c208ec4f735140099c0d945357b0cf7f0b537c3f6517abac2",
    "white": "3ebfe32c143d33a422e093a51ee55cca1ebf575944aab6d5ed867412191d9140",
}
PLACEHOLDER_PATHS = {"base\\materials\\placeholder\\grey.xbm": "grey", "base\\materials\\placeholder\\white.xbm": "white"}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def stops(entries):
    return [{"value": e["value"], "color": [e["color"][c] for c in ("Red", "Green", "Blue")]} for e in entries]


def material_chain(paths):
    """Resolve scalar overrides and the two strand textures, most-derived material first."""
    scalars, textures, base = {}, {}, None
    for path in paths:
        root = json.loads(Path(path).read_text(encoding="utf-8"))["Data"]["RootChunk"]
        base = root["baseMaterial"]["DepotPath"]["$value"]
        for value in root["values"]:
            for key, entry in value.items():
                if key in SCALARS and isinstance(entry, (int, float)) and SCALARS[key] not in scalars:
                    scalars[SCALARS[key]] = entry
                if key in ("Strand_ID", "Strand_Gradient") and key not in textures:
                    textures[key] = entry["DepotPath"]["$value"]
    if base != "base\\materials\\hair.mt":
        raise SystemExit(f"Material chain must end at base\\materials\\hair.mt, found {base}")
    # hair.mt template defaults for the strand textures.
    textures.setdefault("Strand_ID", "base\\materials\\placeholder\\grey.xbm")
    textures.setdefault("Strand_Gradient", "base\\materials\\placeholder\\grey.xbm")
    return scalars, textures


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--appearance", required=True)
    parser.add_argument("--definition", required=True)
    parser.add_argument("--swatch")
    parser.add_argument("--depot-path", required=True)
    parser.add_argument("--mi", action="append", required=True)
    parser.add_argument("--candidate", action="append", required=True)
    parser.add_argument("--override")
    parser.add_argument("--placeholders", default=str(ROOT / "research/consumers/hair-placeholders/raw/base/materials/placeholder"))
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "public/assets/lashes"))
    args = parser.parse_args()

    scalars, textures = material_chain(args.mi)
    samples = {}
    for role, depot in textures.items():
        name = PLACEHOLDER_PATHS.get(depot)
        if not name:
            raise SystemExit(f"{role} is a real texture ({depot}); use the per-texel hair intake instead")
        png = Path(args.placeholders) / f"{name}.png"
        if sha256(png) != PLACEHOLDER_DIGESTS[name]:
            raise SystemExit(f"Unexpected decoded placeholder {png.name}")
        samples[role] = list(Image.open(png).convert("RGB").getpixel((0, 0)))

    candidates = []
    for spec in args.candidate:
        archive, scope, hp, hp_json, *rest = spec.split("|")
        if scope not in ("mod", "base") or "/" in archive or "\\" in archive:
            raise SystemExit(f"Bad candidate: {spec}")
        root = json.loads(Path(hp_json).read_text(encoding="utf-8"))["Data"]["RootChunk"]
        candidate = {"archive": archive, "scope": scope, "profileResourceSha256": sha256(hp),
                     "sampleCount": root["sampleCount"], "id": stops(root["gradientEntriesID"]),
                     "rootToTip": stops(root["gradientEntriesRootToTip"])}
        if rest and rest[0]:
            candidate["containerSha256"] = rest[0]
        candidates.append(candidate)

    manifest = {
        "schema": "xfs/lash-profile-preview-2",
        "appearanceHash": args.appearance,
        "definition": args.definition,
        "strandId": samples["Strand_ID"],
        "strandGradient": samples["Strand_Gradient"],
        **({"selectorSwatch": [int(v) for v in args.swatch.split(",")]} if args.swatch else {}),
        "material": scalars,
        "profile": {"depotPath": args.depot_path, "candidates": candidates,
                    **({"override": args.override} if args.override else {})},
    }
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "profile.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(out / "profile.json")


if __name__ == "__main__":
    main()
