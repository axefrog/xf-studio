"""Read-only index/extract/disassemble tool for Cyberpunk 2077 compiled shader caches.

Never modifies the game. Every extracted program, disassembly and index is written
under the git-ignored research/consumers/shader-system/raw/ (or json/) tree.
Only this script and written findings are tracked.

Commands (run from any directory; Python 3.10+):

  python shader_cache.py index
      Parse engine/shader_final.cache (material shaders, RDHS v10) and
      engine/staticshader_final.cache (engine shaders, RDHS v8) into
      research/consumers/shader-system/json/{material,static}-index.json.

  python shader_cache.py find TEMPLATE_REGEX [--info REGEX]
      List material compilations whose template name matches, optionally
      filtered on the full compilation string (e.g. "VF: MeshSkinned]" or
      "renderstage_gbuffer_regular"). Prints stage-classified GUIDs.

  python shader_cache.py static NAME_REGEX
      List static (engine) shader names and the program GUIDs referenced by
      their descriptor records.

  python shader_cache.py extract GUID [GUID ...]
      Write <GUID>.dxbc from either cache and disassemble it with Windows SDK
      dxc -dumpbin into <GUID>.ll.

  python shader_cache.py summary GUID
      Summarise a disassembly: signature, resource bindings and every
      storeOutput (render target/row, component, SSA value).

Format notes: the v10 layout follows WolvenKit's ShaderCacheReader.cs, except that
the two shader GUIDs in each compilation record are stored first/second and the stage
is taken from each program's DXIL header (WolvenKit labels them pixel/vertex, which is
wrong for the audited records). The static v8 layout was reverse-engineered here:
[u64 guid][u32 size][DXBC] records are contiguous after a descriptor region that
holds length-prefixed technique names (m_*, REBLUR_*, ...); each record's program GUID(s)
precede its name, so each GUID occurrence is attributed to the next name. Treat this
association as a heuristic and confirm with the disassembly (resource names, entry type).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import subprocess
import sys
from pathlib import Path

import os

# PATH_TO_GAME and the Windows SDK dxc location are configurable; the defaults match the
# lab workstation layout recorded in docs/toolchain.md.
GAME = Path(os.environ.get("CP2077_GAME_DIR", "F:/Games/Cyberpunk 2077"))
MATERIAL_CACHE = GAME / "engine/shader_final.cache"
STATIC_CACHE = GAME / "engine/staticshader_final.cache"
DXC = Path(os.environ.get("DXC_EXE", "C:/Program Files (x86)/Windows Kits/10/bin/10.0.22621.0/x64/dxc.exe"))
HQ = Path(__file__).resolve().parents[3]
OUT = HQ / "research/consumers/shader-system"
RAW, JSON_DIR = OUT / "raw", OUT / "json"
STAGES = {0: "pixel", 1: "vertex", 2: "geometry", 3: "hull", 4: "domain", 5: "compute",
          6: "library", 13: "mesh", 14: "amplification"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def dxbc_stage(blob: bytes) -> str:
    if blob[:4] != b"DXBC":
        return "not-dxbc"
    for i in range(struct.unpack_from("<I", blob, 28)[0]):
        p = struct.unpack_from("<I", blob, 32 + 4 * i)[0]
        if blob[p:p + 4] == b"DXIL":
            return STAGES.get(struct.unpack_from("<I", blob, p + 8)[0] >> 16, "unknown")
    return "no-dxil"


def parse_material_cache(data: bytes):
    footer = data[-112:]
    if footer[104:108] != b"RDHS" or struct.unpack_from("<I", footer, 108)[0] != 10:
        raise SystemExit("unsupported shader_final.cache footer")
    shader_count, extra_count, param_count = struct.unpack_from("<III", footer, 0)
    extras_start, params_start, mapping_start = struct.unpack_from("<QQQ", footer, 72)
    shaders, at = {}, 0
    for _ in range(shader_count):
        guid, params, size = struct.unpack_from("<QQI", data, at)
        at += 20
        blob = data[at:at + size]
        shaders[guid] = {"offset": at, "size": size, "params": params, "stage": dxbc_stage(blob)}
        at += size
    if at != extras_start:
        raise SystemExit("shader region not consumed exactly")
    compilations, at = [], extras_start
    for _ in range(extra_count):
        start, end, a, b = struct.unpack_from("<IIBB", data, at)
        at += 10
        n = (a & 0xBF) | ((b & 1) << 6)
        info = data[at:at + n].decode("utf8")
        at += n
        (start2, first, second, mat1, mat2, unknown, end2) = struct.unpack_from("<IQQQQQI", data, at)
        at += 48
        if start2 != start or end2 != end or mat1 != mat2:
            raise SystemExit("compilation record mismatch")
        flags = []
        for _k in range(2):
            (count,) = struct.unpack_from("<I", data, at)
            at += 4
            flags.append(list(struct.unpack_from(f"<{count}Q", data, at)))
            at += 8 * count
        progs = [{"guid": str(g), "stage": shaders.get(g, {}).get("stage", "missing")} for g in (first, second)]
        compilations.append({"template": info.split(" ")[0], "info": info, "programs": progs,
                             "material": str(mat1), "unknown": str(unknown),
                             "flags1": [str(x) for x in flags[0]], "flags2": [str(x) for x in flags[1]]})
    if at != params_start:
        raise SystemExit("compilation region not consumed exactly")
    return shaders, compilations


def parse_static_cache(data: bytes):
    tail = data[-16:]
    if tail[:4] != b"RDHS":
        raise SystemExit("unsupported staticshader_final.cache footer")
    version = struct.unpack_from("<I", tail, 4)[0]
    dx = [m.start() for m in re.finditer(rb"DXBC", data)]
    shaders, region_start = {}, None
    for o in dx:
        size = struct.unpack_from("<I", data, o + 24)[0]
        if struct.unpack_from("<I", data, o - 4)[0] != size:
            continue  # "DXBC" bytes inside another program, not a record
        guid = struct.unpack_from("<Q", data, o - 12)[0]
        blob = data[o:o + size]
        shaders[guid] = {"offset": o, "size": size, "stage": dxbc_stage(blob)}
        region_start = o - 12 if region_start is None else region_start
    guid_bytes = {struct.pack("<Q", g): g for g in shaders}
    skip = {"rtFormats", "None"}
    names = []
    for j in range(1, region_start):
        n = data[j - 1]
        if not n & 0x80 or (n & 0x7F) < 3:
            continue
        text = data[j:j + (n & 0x7F)]
        if (len(text) == n & 0x7F and all(32 < c < 127 for c in text) and re.match(rb"[A-Za-z_]", text)
                and text.decode() not in skip and not text.startswith((b"static:", b"TEXFMT_"))):
            names.append((j, text.decode()))
    # A descriptor record stores its program GUID(s) BEFORE its length-prefixed name
    # (observed: 111-112 bytes before the name for single-program compute records), so
    # each GUID occurrence is attributed to the next name that follows it.
    hits = [(j, guid_bytes[data[j:j + 8]]) for j in range(region_start - 7) if data[j:j + 8] in guid_bytes]
    entries, k = [], 0
    for pos, name in names:
        refs = []
        while k < len(hits) and hits[k][0] < pos:
            g = str(hits[k][1])
            if g not in refs:
                refs.append(g)
            k += 1
        entries.append({"name": name, "programs": [{"guid": r, "stage": shaders[int(r)]["stage"]} for r in refs]})
    return version, shaders, entries


def cmd_index(_args):
    JSON_DIR.mkdir(parents=True, exist_ok=True)
    data = MATERIAL_CACHE.read_bytes()
    shaders, comps = parse_material_cache(data)
    (JSON_DIR / "material-index.json").write_text(json.dumps({
        "source": str(MATERIAL_CACHE), "sha256": sha256(data), "bytes": len(data),
        "shaders": len(shaders), "compilations": comps}, indent=1))
    sdata = STATIC_CACHE.read_bytes()
    version, sshaders, entries = parse_static_cache(sdata)
    (JSON_DIR / "static-index.json").write_text(json.dumps({
        "source": str(STATIC_CACHE), "sha256": sha256(sdata), "bytes": len(sdata), "version": version,
        "programs": len(sshaders), "entries": entries}, indent=1))
    print(json.dumps({"material": {"sha256": sha256(data), "programs": len(shaders), "compilations": len(comps)},
                      "static": {"sha256": sha256(sdata), "version": version, "programs": len(sshaders),
                                 "names": len(entries),
                                 "unreferenced": len(set(map(str, sshaders)) - {p["guid"] for e in entries for p in e["programs"]})}},
                     indent=1))


def load(name):
    path = JSON_DIR / f"{name}-index.json"
    if not path.exists():
        raise SystemExit("run `index` first")
    return json.loads(path.read_text())


def cmd_find(args):
    rx, info = re.compile(args.template), re.compile(args.info) if args.info else None
    for c in load("material")["compilations"]:
        if rx.fullmatch(c["template"]) and (not info or info.search(c["info"])):
            progs = " ".join(f"{p['stage']}={p['guid']}" for p in c["programs"])
            print(f"{c['info']}\n    {progs} material={c['material']}")


def cmd_static(args):
    rx = re.compile(args.name)
    for e in load("static")["entries"]:
        if rx.search(e["name"]):
            print(e["name"], " ".join(f"{p['stage']}={p['guid']}" for p in e["programs"]))


_PARSED: dict = {}


def find_program(guid: int):
    for cache, parser in ((MATERIAL_CACHE, "material"), (STATIC_CACHE, "static")):
        if cache not in _PARSED:
            data = cache.read_bytes()
            shaders = parse_material_cache(data)[0] if parser == "material" else parse_static_cache(data)[1]
            _PARSED[cache] = (data, shaders)
        data, shaders = _PARSED[cache]
        if guid in shaders:
            s = shaders[guid]
            return cache, data[s["offset"]:s["offset"] + s["size"]]
    raise SystemExit(f"program {guid} not found")


def cmd_extract(args):
    RAW.mkdir(parents=True, exist_ok=True)
    for g in args.guid:
        cache, blob = find_program(int(g))
        dxbc, ll = RAW / f"{g}.dxbc", RAW / f"{g}.ll"
        dxbc.write_bytes(blob)
        res = subprocess.run([str(DXC), "-dumpbin", str(dxbc)], capture_output=True, text=True)
        ll.write_text(res.stdout + res.stderr)
        print(json.dumps({"guid": g, "cache": cache.name, "stage": dxbc_stage(blob), "bytes": len(blob),
                          "sha256": sha256(blob), "disassembly": str(ll), "dxc_rc": res.returncode}))


STORE = re.compile(r"call void @dx\.op\.storeOutput\.\w+\(i32 5, i32 (\d+), i32 (\d+), i8 (\d+), \w+ ([^)]+)\)")


def cmd_summary(args):
    text = (RAW / f"{args.guid}.ll").read_text()
    sig, res, in_block = [], [], None
    for line in text.splitlines():
        if line.startswith("; Input signature") or line.startswith("; Output signature"):
            in_block = "sig"
        elif line.startswith("; Resource Bindings"):
            in_block = "res"
        elif line.startswith("; ") and in_block and line.strip("; ").strip():
            (sig if in_block == "sig" else res).append(line)
        elif not line.startswith(";"):
            in_block = None
    print("\n".join(sig + res))
    for m in STORE.finditer(text):
        print(f"store sigId={m.group(1)} row={m.group(2)} comp={'xyzw'[int(m.group(3))]} value={m.group(4)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("index").set_defaults(fn=cmd_index)
    p = sub.add_parser("find"); p.add_argument("template"); p.add_argument("--info"); p.set_defaults(fn=cmd_find)
    p = sub.add_parser("static"); p.add_argument("name"); p.set_defaults(fn=cmd_static)
    p = sub.add_parser("extract"); p.add_argument("guid", nargs="+"); p.set_defaults(fn=cmd_extract)
    p = sub.add_parser("summary"); p.add_argument("guid"); p.set_defaults(fn=cmd_summary)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
