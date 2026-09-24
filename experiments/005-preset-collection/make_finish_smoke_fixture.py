"""Create a private five-look Matte/Metallic/Satin smoke fixture from the checked-in sample.

This never changes the source collection or an authored Studio library. The default
output is ignored; building or installing it is a separate explicit action.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "editor-collection.json"
SOURCE_SHA256 = "8591c115d59915a4747f2586e874696d2108c842759942b4a9c1c02f4bfe4089"
OUTPUT = HERE.parents[1] / "projects/xf-studio/authoring/data/runtime-preflight/satin.collection.json"
COLLECTION_ID = "6c9d0beb-b6d4-54a9-8937-b1b5b470796c"
SATIN_ID = "1f0e24b3-8924-564d-9477-43ca64e7774d"


def create_fixture() -> bytes:
    source = SOURCE.read_bytes()
    if hashlib.sha256(source.replace(b"\r\n", b"\n")).hexdigest() != SOURCE_SHA256:
        raise ValueError("The checked-in sample changed; review its looks before deriving this fixture.")
    collection = json.loads(source)
    if len(collection["presets"]) != 4:
        raise ValueError("Expected the four-look sample collection.")
    control = copy.deepcopy(collection["presets"][0])
    satin = [layer for layer in control["recipe"]["layers"] if layer["finish"] == "satin"]
    if len(satin) != 1 or satin[0]["name"] != "Inner light":
        raise ValueError("Expected one Inner light Satin layer in the source look.")
    collection["id"] = COLLECTION_ID
    collection["name"] = "XF Studio finish diagnostic - Matte Metallic Satin"
    control["id"] = SATIN_ID
    control["name"] = "Verification - satin control"
    control["revision"] = 1
    for layer in control["recipe"]["layers"]:
        layer["enabled"] = layer is satin[0]
    collection["presets"].append(control)
    return (json.dumps(collection, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    body = create_fixture()
    target = args.output.resolve()
    if target.exists():
        if target.read_bytes().replace(b"\r\n", b"\n") != body:
            raise ValueError(f"Refusing to overwrite a different file: {target}")
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    print(f"{target} sha256={hashlib.sha256(target.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
