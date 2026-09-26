"""Read-only reader for the hair lighting and hair-profile code in Cyberpunk2077.exe (2.31).

Finds, from the executable alone, what the hair shaders cannot say: the default values of the
`Editor/Characters/Hair/*` GameOptions, which constant-buffer register each option feeds, and
the CPU bake of `.hp` profiles. Never modifies the game; prints to stdout only.

  python exe_hair.py options   # every hair GameOption: default, range, storage address
  python exe_hair.py fill      # the function copying options into cb0; register of each option
  python exe_hair.py dis RVA [END]   # disassemble (hex RVAs), e.g. the bake at 0xaeb374 0xaeb690

Needs the Capstone Python package (pure disassembler, BSD-3-Clause): either importable, or
unpacked under <XF_TOOLS_DIR>/capstone/<version>/site (XF_TOOLS_DIR defaults to a `tools`
folder beside the repository checkout). CP2077_GAME_DIR overrides the game location.

Addresses are relative virtual addresses (RVAs) of the 2.31 executable whose SHA-256 is
recorded in research/materials/shader-hair.md; another build moves them, but the method
(string cross-references, then the option initialisers and their readers) still applies.
"""
from __future__ import annotations

import os
import re
import struct
import sys
from pathlib import Path

import numpy as np

HQ = Path(__file__).resolve().parents[3]
GAME = Path(os.environ.get("CP2077_GAME_DIR", "F:/Games/Cyberpunk 2077"))
EXE = GAME / "bin/x64/Cyberpunk2077.exe"
TOOLS = Path(os.environ.get("XF_TOOLS_DIR", HQ.parent / "tools"))
for site in sorted((TOOLS / "capstone").glob("*/site"), reverse=True):
    sys.path.append(str(site))
import capstone  # noqa: E402

DATA = EXE.read_bytes()
_pe = struct.unpack_from("<I", DATA, 0x3C)[0]
_opt = struct.unpack_from("<H", DATA, _pe + 20)[0]
BASE = struct.unpack_from("<Q", DATA, _pe + 48)[0]
SECTIONS = []
for i in range(struct.unpack_from("<H", DATA, _pe + 6)[0]):
    o = _pe + 24 + _opt + 40 * i
    vsize, va, rsize, raw = struct.unpack_from("<IIII", DATA, o + 8)
    SECTIONS.append((DATA[o:o + 8].rstrip(b"\0").decode(), va, vsize, raw, rsize))
TEXT = next(s for s in SECTIONS if s[0] == ".text")
MD = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
RIP = re.compile(r"rip ([+-]) 0x([0-9a-f]+)")


def off(rva: int) -> int | None:
    for _, va, _, raw, rsize in SECTIONS:
        if va <= rva < va + rsize:
            return raw + rva - va
    return None


def cstr(rva: int) -> str:
    o = off(rva)
    return DATA[o:o + 96].split(b"\0")[0].decode(errors="replace") if o is not None else ""


def f32(rva: int) -> float:
    return struct.unpack_from("<f", DATA, off(rva))[0]


def rip_target(ins) -> int | None:
    m = RIP.search(ins.op_str)
    if not m:
        return None
    return ins.address + ins.size + int(m.group(2), 16) * (1 if m.group(1) == "+" else -1) - BASE


def rip_refs(targets: set[int]) -> list[tuple[int, int]]:
    """Positions in .text whose disp32 resolves (for an instruction ending at the disp) to a target."""
    _, va, _, raw, rsize = TEXT
    disp = np.ndarray((rsize - 4,), dtype="<i4", buffer=DATA, offset=raw, strides=(1,)).astype(np.int64)
    tgt = disp + np.arange(rsize - 4, dtype=np.int64) + va + 4
    hits = np.nonzero(np.isin(tgt, np.array(sorted(targets), dtype=np.int64)))[0]
    return [(int(i) + va, int(tgt[i])) for i in hits]


_PDATA = next(s for s in SECTIONS if s[0] == ".pdata")
_FUNCS = np.ndarray((_PDATA[4] // 12, 3), dtype="<u4", buffer=DATA, offset=_PDATA[3])
_FUNCS = _FUNCS[_FUNCS[:, 0] > 0]


def function_of(rva: int) -> tuple[int, int]:
    """Start and end RVA of the unwind-table entry holding rva."""
    i = int(np.searchsorted(_FUNCS[:, 0], rva, side="right")) - 1
    return int(_FUNCS[i, 0]), int(_FUNCS[i, 1])


def disasm(start: int, end: int):
    o = off(start)
    return list(MD.disasm(DATA[o:o + end - start], BASE + start))


def options() -> list[dict]:
    """Float GameOptions registered by the hair static initialisers (group, name, default, min, max, value RVA)."""
    groups = {m.start(): m.group(1).decode() for m in re.finditer(rb"(Editor/Characters/Hair[A-Za-z_/]*)\0", DATA)}
    group_rvas = {(s[1] + o - s[3]): g for o, g in groups.items() for s in SECTIONS if s[3] <= o < s[3] + s[4]}
    found = []
    for pos, target in rip_refs(set(group_rvas)):
        start, end = function_of(pos)
        regs, stack, xmm, var = {}, {}, {}, None
        for ins in disasm(start, end):
            t = rip_target(ins)
            ops = [x.strip() for x in ins.op_str.split(",")]
            if ins.mnemonic == "movss" and t is not None and ops[0].startswith("xmm"):
                xmm[ops[0]] = f32(t)
            elif ins.mnemonic == "xorps":
                xmm[ops[0]] = 0.0
            elif ins.mnemonic == "movss" and ops[0].startswith("dword ptr [rsp"):
                stack[ops[0]] = xmm.get(ops[1])
            elif ins.mnemonic == "mov" and ops[0].startswith("dword ptr [rsp") and ops[1].startswith("0x"):
                stack[ops[0]] = struct.unpack("<f", struct.pack("<I", int(ops[1], 16)))[0]
            elif ins.mnemonic == "mov" and ops[0].startswith("dword ptr [rsp") and ops[1] == "0":
                stack[ops[0]] = 0.0
            elif ins.mnemonic == "lea" and t is not None and ops[0] in ("rdx", "r8"):
                regs[ops[0]] = cstr(t)
            elif ins.mnemonic == "lea" and t is not None and ops[0] == "rcx":
                var = t
            elif ins.mnemonic == "call":
                break
        if regs.get("rdx") != group_rvas[target] or var is None:
            continue
        # Constructor arguments: r9 -> default [rsp+0x60], [rsp+0x20] -> min [rsp+0x58], [rsp+0x28] -> max [rsp+0x50].
        found.append({"group": regs["rdx"], "name": regs.get("r8"), "default": stack.get("dword ptr [rsp + 0x60]"),
                      "min": stack.get("dword ptr [rsp + 0x58]"), "max": stack.get("dword ptr [rsp + 0x50]"),
                      "value": var + 0x30})
    return sorted(found, key=lambda o: (o["group"], o["name"] or ""))


def fill(opts: list[dict]) -> None:
    """Locate the function that reads every option value and print the cb0 register of each."""
    values = {o["value"]: o for o in opts}
    reads = [(pos, t) for pos, t in rip_refs(set(values)) if pos - 4 > 0]
    # The fill function is the densest cluster of reads outside the initialisers and the ini loader.
    reads.sort()
    best, cluster = [], []
    for pos, t in reads:
        if cluster and pos - cluster[-1][0] > 0x100:
            best, cluster = max(best, cluster, key=len), []
        cluster.append((pos, t))
    best = max(best, cluster, key=len)
    start, end = function_of(best[0][0])[0], best[-1][0] + 0x40
    loaded, slot = {}, {}
    for ins in disasm(start, end):
        t = rip_target(ins)
        ops = [x.strip() for x in ins.op_str.split(",")]
        if ins.mnemonic == "movss" and t in values and ops[0].startswith("xmm"):
            loaded[ops[0]] = values[t]
        elif ops and ops[0].startswith("xmm"):
            loaded.pop(ops[0], None)  # any other write (e.g. the minss/maxss results) is not a single option
        elif ins.mnemonic == "call":
            loaded.pop("xmm0", None)
        elif ins.mnemonic == "movss" and ops[0].startswith("dword ptr [rbp") and ops[1] in loaded:
            m = re.fullmatch(r"dword ptr \[rbp(?: ([+-]) (0x[0-9a-f]+|\d+))?\]", ops[0])
            if m:
                slot[(-1 if m.group(1) == "-" else 1) * int(m.group(2) or "0", 0)] = loaded[ops[1]]
    # SpecularRandom_Min/Max reach cb0[17].z/.w through minss/maxss (min(Min, Max), max(Min, Max)).
    anchor = next(k for k, o in slot.items() if o["group"].endswith("GlobalLight") and o["name"] == "R")
    print(f"fill function around RVA {start:#x}..{end:#x}; GlobalLight/R taken as cb0[12].x (its role in the light programs)")
    for k in sorted(slot):
        reg, comp = divmod(k - anchor, 16)
        o = slot[k]
        print(f"  cb0[{12 + reg}].{'xyzw'[comp // 4]}  {o['group']}/{o['name']} (default {o['default']:g})")


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "options"
    if cmd == "options":
        for o in options():
            print(f"{o['group']}/{o['name']}: default {o['default']:g}, range [{o['min']:g}, {o['max']:g}], value RVA {o['value']:#x}")
    elif cmd == "fill":
        fill(options())
    elif cmd == "dis":
        start = int(sys.argv[2], 16)
        end = int(sys.argv[3], 16) if len(sys.argv) > 3 else start + 0x100
        for ins in disasm(start, end):
            t = rip_target(ins)
            note = ""
            if t is not None:
                text = cstr(t)
                shown = f" {text!r}" if len(text) >= 3 and text.isascii() and text.isprintable() else (
                    f" f32={f32(t):g}" if off(t) is not None else " (uninitialised data)")
                note = f"  ; {t:#x}{shown}"
            print(f"{ins.address - BASE:#x}: {ins.mnemonic} {ins.op_str}{note}")
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
