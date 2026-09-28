"""Offline facts behind the player-control design (research/runtime/player-control-design.md).

Read only. Reports, as JSON on stdout:
  - the game executable's input-related imports (raw input, XInput, focus, cursor);
  - the address library's named symbols that concern input;
  - the functional-test classes in an RTTI dump (red-dump-json layout) and their functions;
  - optionally, counts of the script APIs the design relies on in a decompiled script bundle.

Usage:
  python probe_offline.py --game PATH_TO_GAME --rtti PATH_TO_RED_DUMP_JSON [--scripts PATH_TO_DECOMPILED_BUNDLE]

No game file is copied or written; nothing is sent anywhere.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
from pathlib import Path

INPUT_IMPORT = re.compile(
    r"(?i)rawinput|xinput|foreground|getfocus|activewindow|cursor|keystate|keyboardstate|mapvirtualkey|peekmessage|hid"
)
INPUT_SYMBOL = re.compile(r"(?i)input|interact|choice|camera|teleport")
FUNCTIONAL_CLASSES = [
    "FunctionalTestsGameSystem",
    "FunctionalTestsInputManager",
    "PlayerFunctionalTests",
    "NavigationFunctionalTests",
    "UIFunctionalTests",
    "WorldFunctionalTests",
]
SCRIPT_APIS = {
    "TeleportationFacility.Teleport": r"GetTeleportationFacility\(",
    "TargetingSystem.LookAt": r"\.LookAt\([^)]*[Aa]im",
    "TargetingSystem.GetLookAtObject": r"GetLookAtObject\(",
    "AdjustTransformWithDurations": r"new AdjustTransformWithDurations\(\)",
    "UIInteractions.InteractionChoiceHub": r"UIInteractions\.InteractionChoiceHub|InteractionsBBDefinition\.InteractionChoiceHub",
    "UIInteractions.DialogChoiceHubs": r"DialogChoiceHubs",
    "EquipmentSystemWeaponManipulationRequest": r"new EquipmentSystemWeaponManipulationRequest\(\)",
    "ItemActionsHelper.ConsumeItem": r"ItemActionsHelper\.ConsumeItem\(",
    "StartHubMenuEvent": r"new StartHubMenuEvent\(\)",
    "inkMenuInstance_SpawnEvent": r"new inkMenuInstance_SpawnEvent\(\)",
    "GameplayRestriction.ForceCrouch": r"GameplayRestriction\.ForceCrouch",
    "NavigationSystem.CalculatePathOnlyHumanNavmesh": r"CalculatePathOnlyHumanNavmesh\(",
    "StateGameScriptInterface.GetActionValue": r"GetActionValue\(n\"",
}


def pe_imports(path: Path) -> dict[str, list[str]]:
    data = path.read_bytes()
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe : pe + 4] != b"PE\0\0":
        raise ValueError("not a PE file")
    coff = pe + 4
    sections = struct.unpack_from("<H", data, coff + 2)[0]
    opt_size = struct.unpack_from("<H", data, coff + 16)[0]
    opt = coff + 20
    if struct.unpack_from("<H", data, opt)[0] != 0x20B:
        raise ValueError("expected a PE32+ image")
    import_rva = struct.unpack_from("<I", data, opt + 112 + 8)[0]
    table = opt + opt_size
    secs = []
    for i in range(sections):
        base = table + i * 40
        vsize, vaddr, rsize, raddr = struct.unpack_from("<IIII", data, base + 8)
        secs.append((vaddr, max(vsize, rsize), raddr))

    def off(rva: int) -> int:
        for vaddr, size, raddr in secs:
            if vaddr <= rva < vaddr + size:
                return rva - vaddr + raddr
        raise ValueError(f"rva {rva:#x} outside sections")

    def cstr(o: int) -> str:
        end = data.index(b"\0", o)
        return data[o:end].decode("ascii", "replace")

    result: dict[str, list[str]] = {}
    d = off(import_rva)
    while True:
        oft, _, _, name_rva, ft = struct.unpack_from("<IIIII", data, d)
        if name_rva == 0:
            break
        names = []
        t = off(oft or ft)
        while True:
            thunk = struct.unpack_from("<Q", data, t)[0]
            if thunk == 0:
                break
            if thunk & (1 << 63):
                names.append(f"#{thunk & 0xFFFF}")
            else:
                names.append(cstr(off(thunk & 0x7FFFFFFF) + 2))
            t += 8
        result[cstr(off(name_rva))] = names
        d += 20
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", required=True, type=Path, help="game folder (the one holding bin/ and r6/)")
    ap.add_argument("--rtti", required=True, type=Path, help="red-dump-json clone")
    ap.add_argument("--scripts", type=Path, help="decompiled script bundle folder (optional)")
    args = ap.parse_args()

    out: dict[str, object] = {}
    exe = args.game / "bin" / "x64" / "Cyberpunk2077.exe"
    imports = pe_imports(exe)
    out["input_imports"] = {
        dll: sorted(n for n in names if INPUT_IMPORT.search(n) or INPUT_IMPORT.search(dll))
        for dll, names in imports.items()
        if any(INPUT_IMPORT.search(n) for n in names) or INPUT_IMPORT.search(dll)
    }

    addresses = json.loads((args.game / "bin" / "x64" / "cyberpunk2077_addresses.json").read_text("utf-8"))
    out["named_input_symbols"] = [
        {"symbol": a["symbol"], "hash": a.get("hash"), "offset": a.get("offset")}
        for a in addresses.get("Addresses", [])
        if a.get("symbol") and INPUT_SYMBOL.search(a["symbol"])
    ]

    classes = {}
    for name in FUNCTIONAL_CLASSES:
        p = args.rtti / "classes" / f"{name}.json"
        if not p.exists():
            classes[name] = None
            continue
        c = json.loads(p.read_text("utf-8"))
        classes[name] = {
            "parent": c.get("parent"),
            "functions": [f.get("fullName") for f in c.get("funcs", [])],
            "declared_params": sum(len(f.get("params", [])) for f in c.get("funcs", [])),
        }
    out["functional_test_classes"] = classes

    if args.scripts:
        counts = {k: 0 for k in SCRIPT_APIS}
        for f in args.scripts.rglob("*.script"):
            text = f.read_text("utf-8", "replace")
            for k, pattern in SCRIPT_APIS.items():
                counts[k] += len(re.findall(pattern, text))
        out["script_api_uses"] = counts

    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
