"""Read-only trace of the material-shader path in Cyberpunk 2077 (2.31): cache keys, lookup, shader and PSO creation.

Never modifies the game; prints to stdout only. Evidence tool behind
research/materials/xf-shaders-pipeline-trace.md.

  python exe_shaders.py cache                 # decode every region of shader_final.cache and verify the lookup key
  python exe_shaders.py key NAME PASS [--vf MeshSkinned] [--index 0] [--pass-index 0] [--discarded] [--preskinned] [--dismembered]
                                              # the 64-bit technique key the engine looks up, and the record it finds
  python exe_shaders.py trace                 # traced functions: RVA, address-library ID, and a structural check of each
  python exe_shaders.py dis RVA [END]         # disassemble (hex RVAs)

Key facts the `cache` command re-proves from the file alone (the executable shows how they are used):
  - technique key = (fold32(FNV-1a-64(CMaterialTemplate.name)) << 32) | permutation32, where fold32(h) = lo32(h) ^ hi32(h)
  - permutation32 = FNV-1a-32 over: u32 (VF << 3 | Discarded*2 | PreSkinned*1 | Dismembered*4), u32 technique index,
    the pass's render-stage name bytes, then one FNV step with the pass index byte.
The compilation string's first word is the template's *file* stem; the key uses the template's `name` CName
(three vanilla templates differ, e.g. silverhand_props_overlay.mt is named silverhand_overlay).

Needs Capstone for `trace`/`dis` (<XF_TOOLS_DIR>/capstone/<version>/site, as exe_hair.py). CP2077_GAME_DIR
overrides the game location. RVAs are for the 2.31 executable (linker timestamp 68af45ea); the address-library
IDs printed by `trace` resolve the same functions in later builds through bin/x64/cyberpunk2077_addresses.json.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys
from collections import Counter
from pathlib import Path

HQ = Path(__file__).resolve().parents[3]
GAME = Path(os.environ.get("CP2077_GAME_DIR", "F:/Games/Cyberpunk 2077"))
CACHE = GAME / "engine/shader_final.cache"
EXE = GAME / "bin/x64/Cyberpunk2077.exe"
ADDRESSES = GAME / "bin/x64/cyberpunk2077_addresses.json"
TOOLS = Path(os.environ.get("XF_TOOLS_DIR", HQ.parent / "tools"))

VF = {name: i for i, name in enumerate(
    "_ Terrain MeshStatic MeshSkinned MeshExtSkinned GarmentMeshSkinned GarmentMeshExtSkinned MeshSpeedTree "
    "ParticleBilboard ParticleParallel ParticleMotionBlur ParticleSphereAligned ParticleVerticalFixed ParticleTrail "
    "ParticleFacingTrail ParticleScreen ParticleBeam ParticleFacingBeam Decal Debug DrawBuffer Fullscreen "
    "MeshSkinnedVehicle MeshStaticVehicle MeshProcedural MeshDestructible MeshDestructibleSkinned "
    "MeshSkinnedLightBlockers MeshExtSkinnedLightBlockers GarmentMeshSkinnedLightBlockers "
    "GarmentMeshExtSkinnedLightBlockers MeshSkinnedSingleBone MeshProxy MeshWindowProxy".split())}
INFO = re.compile(r"Index: (\d+), Pass '([^']+)', PassIndex: (\d+), Fallback: (\d+), "
                  r"RenderStageContext: \[ID: (\d+), VF: (\w+)((?:; \w+)*)\]")


def fnv32(data: bytes, h: int = 0x811C9DC5) -> int:
    for c in data:
        h = ((h ^ c) * 0x01000193) & 0xFFFFFFFF
    return h


def fnv64(data: bytes) -> int:
    h = 0xCBF29CE484222325
    for c in data:
        h = ((h ^ c) * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return h


def name_key(name: str) -> int:
    h = fnv64(name.encode())
    return (h & 0xFFFFFFFF) ^ (h >> 32)


def permutation_key(vf: int, index: int, stage: str, pass_index: int, discarded=False, preskinned=False,
                    dismembered=False) -> int:
    packed = (vf << 3) | (2 if discarded else 0) | (1 if preskinned else 0) | (4 if dismembered else 0)
    h = fnv32(struct.pack("<I", packed))
    h = fnv32(struct.pack("<I", index), h)
    h = fnv32(stage.encode(), h)
    return ((h ^ pass_index) * 0x01000193) & 0xFFFFFFFF


def read_cache():
    data = CACHE.read_bytes()
    f = data[-112:]
    names = ["programs", "techniques", "param_sets", "uk1", "uk2", "uk3", "id_high", "sources",
             "programs_size", "techniques_size", "param_sets_size", "sources_size", "templates_size",
             "techniques_at", "param_sets_at", "templates_at", "sources_at", "magic", "version"]
    footer = dict(zip(names, struct.unpack_from("<8I5Q4Q2I", f)))
    if footer["magic"] != 0x53484452 or footer["version"] != 10:
        raise SystemExit("unsupported cache footer")
    at, programs = 0, {}
    for _ in range(footer["programs"]):
        guid, params, size = struct.unpack_from("<QQI", data, at)
        programs[guid] = (params, at + 20, size)
        at += 20 + size
    at, techniques = footer["techniques_at"], []
    for _ in range(footer["techniques"]):
        perm, tpl, a, b = struct.unpack_from("<IIBB", data, at)
        at += 10
        n = (a & 0xBF) | ((b & 1) << 6)
        info = data[at:at + n].decode()
        at += n
        perm2, first, second, mat, mat2, uid, tpl2 = struct.unpack_from("<IQQQQQI", data, at)
        at += 48
        lists = []
        for _k in range(2):
            (cnt,) = struct.unpack_from("<I", data, at)
            lists.append(struct.unpack_from(f"<{cnt}Q", data, at + 4))
            at += 4 + 8 * cnt
        assert perm2 == perm and tpl2 == tpl and mat == mat2
        techniques.append(dict(perm=perm, tpl=tpl, info=info, vertex=first, pixel=second, material=mat, uid=uid,
                               lists=lists))
    at, param_sets = footer["param_sets_at"], {}
    for _ in range(footer["param_sets"]):
        guid, _uk, cnt = struct.unpack_from("<QII", data, at)
        at += 16
        items = []
        for _j in range(cnt):
            nl = data[at] & 0x7F
            items.append(data[at + 1:at + 1 + nl].decode(errors="replace"))
            at += 3 + nl
        param_sets[guid] = items
    at = footer["templates_at"]
    (cnt,) = struct.unpack_from("<I", data, at)
    templates = [struct.unpack_from("<III", data, at + 4 + 12 * i) for i in range(cnt)]
    at = footer["sources_at"]
    (cnt,) = struct.unpack_from("<I", data, at)
    at += 4
    sources = []
    for _ in range(cnt):
        nl = data[at] & 0x7F
        sources.append((data[at + 1:at + 1 + nl].decode(errors="replace"), struct.unpack_from("<Q", data, at + 1 + nl)[0]))
        at += 9 + nl
    return data, footer, programs, techniques, param_sets, templates, sources


def parse_info(info: str) -> dict:
    m = INFO.search(info)
    idx, stage, pidx, fallback, ctx, vf, flags = m.groups()
    flags = {x.strip() for x in flags.split(";") if x.strip()}
    return dict(index=int(idx), stage=stage, pass_index=int(pidx), fallback=int(fallback), context=int(ctx),
                vf=VF[vf], discarded="Discarded" in flags, preskinned="PreSkinned" in flags,
                dismembered="Dismembered" in flags)


def cmd_cache(_args):
    data, footer, programs, techniques, param_sets, templates, sources = read_cache()
    print(json.dumps({k: (hex(v) if k in ("uk1", "uk2", "uk3", "id_high", "magic") else v) for k, v in footer.items()}))
    perm_ok = sum(permutation_key(**{k: v for k, v in parse_info(t["info"]).items()
                                     if k not in ("fallback", "context")}) == t["perm"] for t in techniques)
    stem_ok = Counter()
    for t in techniques:
        stem_ok[name_key(t["info"].split(" ")[0]) == t["tpl"]] += 1
    keys = {(t["tpl"] << 32) | t["perm"] for t in techniques}
    shared = Counter()
    for t in techniques:
        for g in (t["vertex"], t["pixel"]):
            if g:
                shared[g] += 1
    owners = {}
    for t in techniques:
        for g in (t["vertex"], t["pixel"]):
            if g:
                owners.setdefault(g, set()).add(t["tpl"])
    print(f"techniques {len(techniques)}; permutation key reproduced {perm_ok}/{len(techniques)}; "
          f"distinct 64-bit keys {len(keys)}")
    print(f"template key == fold32(FNV-1a-64(file stem)) for {stem_ok[True]} records; the other {stem_ok[False]} "
          f"belong to templates whose CName differs from the file stem")
    print(f"templates listed {len(templates)} (key, a record's uid low word, uid high {templates[0][2]:#x}); "
          f"programs {len(programs)}, each owned by exactly one template: "
          f"{all(len(v) == 1 for v in owners.values())}")
    sm = Counter()
    rts0 = 0
    for _g, (_p, o, s) in programs.items():
        blob = data[o:o + s]
        for k in range(struct.unpack_from("<I", blob, 28)[0]):
            po = struct.unpack_from("<I", blob, 32 + 4 * k)[0]
            cc = blob[po:po + 4]
            if cc == b"DXIL":
                v = struct.unpack_from("<I", blob, po + 8)[0]
                sm[("ps" if v >> 16 == 0 else "vs" if v >> 16 == 1 else str(v >> 16)) + f"_{(v >> 4) & 15}_{v & 15}"] += 1
            rts0 += cc == b"RTS0"
    print(f"shader models {dict(sm)}; programs embedding a root signature (RTS0): {rts0}")
    print(f"parameter sets {len(param_sets)}; source files {len(sources)} (e.g. {sources[0][0]})")


def cmd_key(args):
    _data, _f, _p, techniques, _ps, _t, _s = read_cache()
    tk = name_key(args.name)
    pk = permutation_key(VF[args.vf], args.index, args.stage, args.pass_index, args.discarded, args.preskinned,
                         args.dismembered)
    print(f"template key {tk:#010x}  permutation {pk:#010x}  technique key {(tk << 32) | pk:#018x}")
    for t in techniques:
        if t["tpl"] == tk and t["perm"] == pk:
            print(f"  record: {t['info']}\n  vertex {t['vertex']}  pixel {t['pixel'] or '-'}  material {t['material']}")
            return
    print("  no record: the engine finds no compiled technique for this key")


# ---- executable -----------------------------------------------------------------------------------------------
TRACE = [
    # (RVA, role, check)  check: ('str', text) the function references the string; ('imm', value) it contains the
    # 32-bit immediate; ('iid', guid) it references the D3D12 interface ID; ('call', rva) it calls that function.
    (0x7B9088, "shader-cache init: static cache, then the material cache object (global g_ShaderCache)", ("str", "staticshader_final.cache")),
    (0x7B9368, "opens shader_final.cache into a reader and stores it in g_ShaderCache+0x10", ("str", "shader_final.cache")),
    (0x7BA4BC, "reader: reads the 0x70-byte footer ('ShaderCacheReadOnly' IO tag)", ("str", "ShaderCacheReadOnly")),
    (0x7B9FCC, "footer callback: checks the RDHS magic, then reads the metadata regions", ("imm", 0x53484452)),
    (0x2ACBD8, "reader vtable +0x28 FindTechnique(key64): map at +0x148, records (0x50 bytes) at +0x1E8", ("call", 0x2ADCF4)),
    (0x2ADBE8, "reader vtable +0x20 GetProgram(guid): map at +0x118, entries (0x38 bytes) at +0x1D8", ("call", 0x2ADCF4)),
    (0x2ADC5C, "reader vtable +0x58 GetParameterSet(guid): map at +0x178, entries (0x20 bytes) at +0x1F8", ("call", 0x2ADCF4)),
    (0x255010, "GetOrCompileTechnique: permutation hash, per-template technique map at +0x708, else compile", ("call", 0x2AD458)),
    (0x2AD458, "CompileTechnique: key = [tpl+0x128] << 32 | permutation; FindTechnique; load VS and PS", ("call", 0x2AD690)),
    (0x2AD690, "LoadProgram: GetProgram(record+8 vertex / +0x10 pixel), create shader, merge parameter set", ("call", 0x2AD7BC)),
    (0x2AD7BC, "CreateShaderFromBlob: wraps a GpuApi shader ID", ("call", 0x2ADA48)),
    (0x2ADA48, "GpuApi CreateShader: FNV-1a-32 of the bytecode, dedup in SDeviceData+0xBDCB00 (4096 slots)", ("imm", 0x811C9DC5)),
    (0x2AE99C, "BindMaterialForPass: GetOrCompileTechnique, then fills constants per parameter type", ("call", 0x255010)),
    (0x1F744C, "command list: resolve PSO from the context's state (root signature, desc, shader hashes)", ("call", 0x1F74B0)),
    (0x1F74B0, "PSO lookup: ready -> return, else compile now or queue CompilePSOAsync", ("call", 0x1F7540)),
    (0x88ED24, "PSO cache get-or-create: FNV of the desc's state fields, 8192 entries of 0x2A8", ("call", 0x88EF88)),
    (0x88EF88, "PSO key hash over D3D12_GRAPHICS_PIPELINE_STATE_DESC state fields (not the bytecode)", ("imm", 0x811C9DC5)),
    (0x88F364, "CreateGraphicsPSO: ID3D12PipelineLibrary::LoadGraphicsPipeline, else ID3D12Device::CreateGraphicsPipelineState", ("iid", "765a30f3-f624-4c6f-a828-ace948622445")),
    (0x88F668, "LoadGraphicsPipeline by decimal name of the PSO's library hash", ("call", 0x193D274)),
    (0x7E2584, "renderer device init: chooses GamePipelineLibrary.cache", ("str", "GamePipelineLibrary.cache")),
    (0x100EF70, "global graphics root signature: D3D12SerializeRootSignature, CreateRootSignature -> SDeviceData+0x13BC638", ("iid", "c54a6b66-72df-4ee8-8be5-a946a1429214")),
]
GLOBALS = [(0x3438990, "g_ShaderCache (material shader cache object; reader at +0x10)"),
           (0x3438A28, "g_DeviceData (RED4ext.SDK GpuApi::SDeviceData*)")]


class Exe:
    def __init__(self):
        for site in sorted((TOOLS / "capstone").glob("*/site"), reverse=True):
            sys.path.append(str(site))
        import capstone  # noqa: PLC0415
        self.data = EXE.read_bytes()
        d = self.data
        pe = struct.unpack_from("<I", d, 0x3C)[0]
        opt = struct.unpack_from("<H", d, pe + 20)[0]
        self.base = struct.unpack_from("<Q", d, pe + 48)[0]
        self.sections = []
        for i in range(struct.unpack_from("<H", d, pe + 6)[0]):
            o = pe + 24 + opt + 40 * i
            vsize, va, rsize, raw = struct.unpack_from("<IIII", d, o + 8)
            self.sections.append((d[o:o + 8].rstrip(b"\0").decode(), va, vsize, raw, rsize))
        self.md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
        pdata = next(s for s in self.sections if s[0] == ".pdata")
        self.funcs = sorted(struct.unpack_from("<III", d, pdata[3] + 12 * i)[:2] for i in range(pdata[4] // 12)
                            if struct.unpack_from("<I", d, pdata[3] + 12 * i)[0])

    def off(self, rva):
        for _, va, _, raw, rsize in self.sections:
            if va <= rva < va + rsize:
                return raw + rva - va
        return None

    def rva(self, o):
        for _, va, _, raw, rsize in self.sections:
            if raw <= o < raw + rsize:
                return va + o - raw
        return None

    def end_of(self, start):
        import bisect  # noqa: PLC0415
        i = bisect.bisect_right(self.funcs, (start, 1 << 32)) - 1
        return self.funcs[i][1] if self.funcs[i][0] == start else start + 0x200

    def disasm(self, start, end):
        o = self.off(start)
        return list(self.md.disasm(self.data[o:o + end - start], self.base + start))

    def target(self, ins):
        m = re.search(r"rip ([+-]) 0x([0-9a-f]+)", ins.op_str)
        if m:
            return ins.address + ins.size + int(m.group(2), 16) * (1 if m.group(1) == "+" else -1) - self.base
        if ins.mnemonic in ("call", "jmp") and ins.op_str.startswith("0x"):
            return int(ins.op_str, 16) - self.base
        return None

    def check(self, start, kind, value):
        body = self.disasm(start, self.end_of(start))
        if kind == "imm":
            return any(f"{value:#x}" in i.op_str for i in body)
        if kind == "call":
            return any(i.mnemonic == "call" and self.target(i) == value for i in body)
        if kind == "str":
            return any((t := self.target(i)) is not None and (o := self.off(t)) is not None
                       and self.data[o:o + len(value) + 1] == value.encode() + b"\0" for i in body)
        if kind == "iid":
            import uuid  # noqa: PLC0415
            b = uuid.UUID(value).bytes_le
            return any((t := self.target(i)) is not None and (o := self.off(t)) is not None
                       and self.data[o:o + 16] == b for i in body)
        return False


def address_library(sections):
    lib = json.loads(ADDRESSES.read_text())
    out = {}
    for a in lib["Addresses"]:
        seg, o = a["offset"].split(":")
        out[sections[int(seg) - 1][1] + int(o, 16)] = (int(a["hash"]), a.get("symbol", ""))
    return lib.get("Linker map timestamp", "?"), out


def cmd_trace(_args):
    exe = Exe()
    stamp, lib = address_library(exe.sections)
    print(f"address library: linker map {stamp}")
    for rva, role, (kind, value) in TRACE:
        lid = lib.get(rva)
        ok = exe.check(rva, kind, value)
        print(f"{rva:#09x}  id {lid[0] if lid else '-':>10}  {'ok  ' if ok else 'FAIL'}  {role}")
    for rva, role in GLOBALS:
        lid = lib.get(rva)
        print(f"{rva:#09x}  id {lid[0] if lid else '-':>10}  data  {role}")


def cmd_dis(args):
    exe = Exe()
    start = int(args.start, 16)
    end = int(args.end, 16) if args.end else exe.end_of(start)
    for ins in exe.disasm(start, end):
        t = exe.target(ins)
        note = ""
        if t is not None and (o := exe.off(t)) is not None:
            s = exe.data[o:o + 64].split(b"\0")[0]
            note = f'  ; "{s.decode()}"' if len(s) >= 4 and all(31 < c < 127 for c in s) else f"  ; {t:#x}"
        print(f"{ins.address - exe.base:#010x}  {ins.mnemonic:8} {ins.op_str}{note}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("cache").set_defaults(fn=cmd_cache)
    p = sub.add_parser("key")
    p.add_argument("name")
    p.add_argument("stage")
    p.add_argument("--vf", default="MeshSkinned")
    p.add_argument("--index", type=int, default=0)
    p.add_argument("--pass-index", type=int, default=0)
    p.add_argument("--discarded", action="store_true")
    p.add_argument("--preskinned", action="store_true")
    p.add_argument("--dismembered", action="store_true")
    p.set_defaults(fn=cmd_key)
    sub.add_parser("trace").set_defaults(fn=cmd_trace)
    p = sub.add_parser("dis")
    p.add_argument("start")
    p.add_argument("end", nargs="?")
    p.set_defaults(fn=cmd_dis)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
