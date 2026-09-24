"""Annotate compiled Cyberpunk 2077 material programs with their template's names.

Read-only. Lifts a `dxc -dumpbin` DXIL disassembly into readable pseudo-HLSL and
labels, from evidence that survives in the program or its template:

  * cb4 material constants and bindless textures -> template parameter name, type, default
    (register = usedParameters[stage] register; checked against the program's own
    ShaderSpecificConstants field types);
  * engine constant buffers -> the struct type names kept in the DXIL resource metadata
    (GlobalShaderConsts, SharedPixelConsts, ...), plus the few registers our evidence decodes;
  * pixel inputs -> the paired vertex program's inputs they depend on (dxc ViewId table);
  * render targets -> G-buffer roles for G-buffer passes, plus the template pass blend state.

Everything it writes goes to the git-ignored research/consumers/shader-system/raw/annotated/.

  python shader_annotate.py annotate TEMPLATE [--info REGEX] [--guid GUID ...]
      TEMPLATE is a depot path or regex matched against template-summary.json paths
      (e.g. "base/materials/mesh_decal.mt"). Annotates every matching compilation's
      pixel program and its vertex program, writing <GUID>.hlsl and <GUID>.annotated.ll
      for each; the pixel header lists which vertex inputs feed each interpolator.
      --info filters on the compilation string, e.g. "post_gbuffer'.*VF: MeshSkinned\\]".
      --guid annotates only the given pixel program(s) of that template.

  python shader_annotate.py search TEMPLATE_REGEX PATTERN [PATTERN ...] [--info REGEX]
      Annotate every pixel program of templates whose cache name matches, and report
      those whose pseudo-HLSL matches ALL regex patterns (e.g. to locate a snippet).

Requires `shader_cache.py index` and `template_summary.py` to have been run.
"""
from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import shader_cache as sc  # noqa: E402

TEMPLATE_SUMMARY = sc.JSON_DIR / "template-summary.json"
ANN = sc.RAW / "annotated"
GROUP = {"pixel": 2, "vertex": 1}
XYZW = "xyzw"

# Engine registers decoded in research/materials/shader-system/README.md. Keyed by the
# DXIL struct name, register and component. Anything absent stays anonymous.
KNOWN_ENGINE = {
    ("GlobalShaderConsts", 0, "x"): "inferred by use: animation time (mesh_decal flipbook frac(AnimationSpeed * x))",
    ("GlobalShaderConsts", 5, "w"): "sun/moon disk angular radius (clustered-light program; README)",
    ("SharedPixelConsts", 25, None): "inferred by use: depth-buffer linearisation (mesh_decal DepthThreshold test)",
    ("SharedPixelConsts", 26, None): "inferred by use: depth-buffer linearisation (mesh_decal DepthThreshold test)",
    ("SharedPixelConsts", 69, None): "row of the matrix that rebuilds world position from depth (README)",
    ("SharedPixelConsts", 70, None): "row of the matrix that rebuilds world position from depth (README)",
    ("SharedPixelConsts", 71, None): "row of the matrix that rebuilds world position from depth (README)",
    ("SharedPixelConsts", 72, None): "row of the matrix that rebuilds world position from depth (README)",
}
GBUFFER_ROLES = {  # knowledge/materials-and-shaders.md §2.2 (decoded from the deferred light)
    0: "GBuffer0: rgb = sqrt(linear base colour); a = class payload",
    1: "GBuffer1: rgb = world normal n/max|n|*0.5+0.5; a = class payload",
    2: "GBuffer2: x = metalness, y = roughness, z = 'translucency' term (1/3 neutral; meaning a hypothesis); "
       "w = class payload (skin: profile bit, emissive flag + 6 bits)",
}
# ShaderSpecificConstants field type expected per parameter class (one field per register).
# Other classes (SkinParameters, DynamicTexture, Multilayer*, StructBuffer, ...) are
# engine-resolved and only reported.
EXPECTED_FIELD = {"Scalar": "float", "Vector": "<4 x float>", "Color": "<4 x float>",
                  "Texture": "i32", "TextureArray": "i32", "Cube": "i32"}
GBUFFER_STAGES = re.compile(r"renderstage_(gbuffer_regular|gbuffer_velbuff_regular|post_gbuffer)$")

FUNC = {  # dxc op comment name -> HLSL-ish function
    "FAbs": "abs", "Saturate": "saturate", "IsNaN": "isnan", "IsInf": "isinf", "IsFinite": "isfinite",
    "Cos": "cos", "Sin": "sin", "Tan": "tan", "Acos": "acos", "Asin": "asin", "Atan": "atan",
    "Hcos": "cosh", "Hsin": "sinh", "Htan": "tanh", "Exp": "exp2", "Frc": "frac", "Log": "log2",
    "Sqrt": "sqrt", "Rsqrt": "rsqrt", "Round_ne": "round", "Round_ni": "floor", "Round_pi": "ceil",
    "Round_z": "trunc", "Bfrev": "reversebits", "Countbits": "countbits", "FirstbitLo": "firstbitlow",
    "FirstbitHi": "firstbithigh", "FirstbitSHi": "firstbithigh", "FMax": "max", "FMin": "min",
    "IMax": "max", "IMin": "min", "UMax": "max", "UMin": "min", "FMad": "mad", "Fma": "fma",
    "IMad": "mad", "UMad": "mad", "Dot2": "dot", "Dot3": "dot", "Dot4": "dot",
    "DerivCoarseX": "ddx_coarse", "DerivCoarseY": "ddy_coarse", "DerivFineX": "ddx_fine",
    "DerivFineY": "ddy_fine", "LegacyF32ToF16": "f32tof16", "LegacyF16ToF32": "f16tof32",
}
BINOP = {"fadd": "+", "fsub": "-", "fmul": "*", "fdiv": "/", "frem": "%", "add": "+", "sub": "-",
         "mul": "*", "udiv": "/", "sdiv": "/", "urem": "%", "srem": "%", "shl": "<<", "lshr": ">>",
         "ashr": ">>", "and": "&", "or": "|", "xor": "^"}
CMP = {"oeq": "==", "ueq": "==", "one": "!=", "une": "!=", "ogt": ">", "ugt": ">", "oge": ">=",
       "uge": ">=", "olt": "<", "ult": "<", "ole": "<=", "ule": "<=", "eq": "==", "ne": "!=",
       "sgt": ">", "sge": ">=", "slt": "<", "sle": "<="}
CAST = {"zext": "uint", "sext": "int", "trunc": "uint", "uitofp": "float", "sitofp": "float",
        "fptoui": "uint", "fptosi": "int", "fpext": "float", "fptrunc": "half"}
FLAGS = {"fast", "nnan", "ninf", "nsz", "arcp", "contract", "afn", "reassoc", "nuw", "nsw", "exact", "inbounds"}
SIDE_EFFECT = {"StoreOutput", "Discard", "TextureStore", "BufferStore", "Barrier", "AtomicBinOp",
               "AtomicCompareExchange", "StorePatchConstant", "EmitStream", "CutStream"}
PER_PIXEL = {"Sample", "SampleBias", "SampleCmp", "DerivCoarseX", "DerivCoarseY", "DerivFineX",
             "DerivFineY", "CalculateLOD"}
RESOURCE_READ = {"Sample", "SampleBias", "SampleLevel", "SampleGrad", "SampleCmp", "SampleCmpLevelZero",
                 "TextureLoad", "BufferLoad", "RawBufferLoad", "TextureGather", "TextureGatherCmp",
                 "GetDimensions", "CalculateLOD"}


# --------------------------------------------------------------------------- parsing

def split_top(s: str) -> list[str]:
    out, depth, cur, quote = [], 0, [], False
    for ch in s:
        if ch == '"':
            quote = not quote
        elif not quote and ch in "([{<":
            depth += 1
        elif not quote and ch in ")]}>":
            depth -= 1
        if ch == "," and depth == 0 and not quote:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        out.append("".join(cur).strip())
    return out


def table(lines: list[str], start: int) -> list[dict]:
    """Parse a dxc fixed-width '; Name ... / ; ----' table beginning at a header line."""
    header, dashes = lines[start][1:], lines[start + 1][1:]
    spans = [m.span() for m in re.finditer(r"-+", dashes)]
    names = [header[a:b + (1 if i < len(spans) - 1 else 20)].strip() or f"c{i}"
             for i, (a, b) in enumerate(spans)]
    rows = []
    for line in lines[start + 2:]:
        body = line[1:]
        if not line.startswith(";") or not body.strip():
            break
        cells = []
        for i, (a, _b) in enumerate(spans):
            end = spans[i + 1][0] if i + 1 < len(spans) else len(body)
            cells.append(body[a:end].strip())
        rows.append(dict(zip(names, cells)))
    return rows


SIG_ROW = re.compile(r"^; (\S+)\s+(\d+)\s+([xyzw][xyzw ]*?)\s+(\d+|N/A)\s+(\S+)\s+(\S+)(.*)$")


def sig_table(lines: list[str], start: int) -> list[dict]:
    rows = []
    for line in lines[start + 2:]:
        m = SIG_ROW.match(line)
        if not m:
            break
        g = [x.replace(" ", "") for x in m.groups()]
        rows.append(dict(zip(("Name", "Index", "Mask", "Register", "SysValue", "Format", "Used"), g)))
    return rows


def fmt_float(tok: str) -> str:
    if tok.startswith("0x"):
        v = struct.unpack(">d", bytes.fromhex(tok[2:].rjust(16, "0")))[0]
    else:
        v = float(tok)
    if v != v or v in (float("inf"), float("-inf")):
        return repr(v)
    f32 = struct.unpack("<f", struct.pack("<f", v))[0] if abs(v) < 3.4e38 else v
    for p in range(1, 10):
        s = f"{f32:.{p}g}"
        if abs(v) >= 3.4e38 or struct.pack("<f", float(s)) == struct.pack("<f", f32):
            break
    return repr(float(s))


class Instr:
    __slots__ = ("res", "text", "comment", "block", "op", "type", "args", "extra", "line")

    def __init__(self, res, text, comment, block, line):
        self.res, self.text, self.comment, self.block, self.line = res, text, comment, block, line
        self.op, self.type, self.args, self.extra = "", "", [], {}


class Program:
    def __init__(self, text: str):
        self.text = text
        lines = text.splitlines()
        self.inputs, self.outputs, self.bindings = [], [], []
        for i, line in enumerate(lines):
            if line.startswith("; Name") and "Mask Register" in line:
                rows = sig_table(lines, i)
                prev = "\n".join(lines[max(0, i - 3):i])
                if "Input signature" in prev and not self.inputs:
                    self.inputs = rows
                elif "Output signature" in prev and not self.outputs:
                    self.outputs = rows
            elif line.startswith("; Name") and "HLSL Bind" in line and not self.bindings:
                self.bindings = table(lines, i)
        m = re.search(r'!dx.shaderModel = !\{(![0-9]+)\}', text)
        sm = re.search(rf'^{re.escape(m.group(1))} = !\{{!"(\w+)", i32 (\d+), i32 (\d+)\}}', text, re.M) if m else None
        self.model = f"{sm.group(1)}_{sm.group(2)}_{sm.group(3)}" if sm else "?"
        self.cb_struct = self._resource_structs()
        self.cb4_fields = self._struct_fields("ShaderSpecificConstants")
        self.deps = self._viewid_deps()
        self._parse_body(lines)

    # -- metadata
    def _resource_structs(self):
        md = {m.group(1): m.group(2) for m in re.finditer(r"^!(\d+) = (?:distinct )?!\{(.*)\}$", self.text, re.M)}
        root = re.search(r"^!dx.resources = !\{!(\d+)\}", self.text, re.M)
        out = {}
        if not root:
            return out
        lists = [x.strip() for x in md[root.group(1)].split(",")]
        if len(lists) > 2 and lists[2] != "null":
            for ref in md[lists[2][1:]].split(","):
                entry = md[ref.strip()[1:]]
                m = re.match(r"i32 (\d+), %([\w.]+)\* undef", entry)
                if m:
                    out[int(m.group(1))] = m.group(2).replace("hostlayout.", "")
        return out

    def _struct_fields(self, name):
        m = re.search(rf"^%{name} = type \{{ (.*) \}}$", self.text, re.M)
        return split_top(m.group(1)) if m else []

    def _viewid_deps(self):
        deps = {}
        for m in re.finditer(r"^;\s+output (\d+) depends on inputs: \{ ([\d, ]*) \}", self.text, re.M):
            deps[int(m.group(1))] = [int(x) for x in m.group(2).split(",") if x.strip()]
        return deps

    def binding(self, cls: int, rng: int):
        pref = {0: "T", 1: "U", 2: "CB", 3: "S"}[cls]
        for b in self.bindings:
            if b.get("ID") == f"{pref}{rng}":
                return b
        return {"ID": f"{pref}{rng}", "HLSL Bind": f"?{pref}{rng}", "Count": "1", "Dim": ""}

    # -- body
    def _parse_body(self, lines):
        self.blocks: dict[str, list[Instr]] = {}
        self.order: list[str] = []
        self.defs: dict[str, Instr] = {}
        start = next(i for i, l in enumerate(lines) if l.startswith("define void @"))
        cur = "0"
        self.blocks[cur], self.order = [], [cur]
        buf = None
        for n, line in enumerate(lines[start + 1:], start + 2):
            if line.startswith("}"):
                break
            lab = re.match(r"; <label>:(\d+)", line)
            if lab:
                cur = lab.group(1)
                self.blocks[cur] = []
                self.order.append(cur)
                continue
            if not line.strip() or line.lstrip().startswith(";"):
                continue
            if buf is not None:  # multi-line switch
                buf += " " + line.strip()
                if "]" in line:
                    self._add(buf, cur, n)
                    buf = None
                continue
            if line.strip().startswith("switch ") and "]" not in line:
                buf = line.strip()
                continue
            self._add(line.strip(), cur, n)

    def _add(self, s, block, n):
        comment = ""
        if "  ; " in s:
            s, comment = s.split("  ; ", 1)
        s = re.sub(r",\s*!(dx\.controlflow\.hints|tbaa|[\w.]+) ![0-9]+", "", s).strip()
        m = re.match(r"(%[\w.]+) = (.*)", s)
        ins = Instr(m.group(1) if m else None, m.group(2) if m else s, comment.strip(), block, n)
        self._decode(ins)
        self.blocks[block].append(ins)
        if ins.res:
            self.defs[ins.res] = ins

    @staticmethod
    def _decode(ins: Instr):
        words = ins.text.split(" ")
        op = words[0]
        ins.op = op
        rest = " ".join(w for w in words[1:] if w not in FLAGS)
        if op == "call":
            m = re.match(r"(\S+(?: \S+)?) @([\w.]+)\((.*)\)$", rest)
            ins.type = m.group(1)
            ins.extra["fn"] = m.group(2)
            ins.args = split_top(m.group(3))
            name = re.match(r"(\w+)\((.*)\)", ins.comment)
            ins.extra["dxop"] = name.group(1) if name else m.group(2)
            ins.extra["argnames"] = name.group(2).split(",") if name else []
        elif op in BINOP:
            t, a = rest.split(" ", 1)
            ins.type, ins.args = t, split_top(a)
        elif op in ("fcmp", "icmp"):
            pred, t, a = rest.split(" ", 2)
            ins.type, ins.args, ins.extra["pred"] = "i1", split_top(a), pred
        elif op == "select":
            ins.args = split_top(rest)
            ins.type = ins.args[1].rsplit(" ", 1)[0]
        elif op in CAST or op == "bitcast":
            m = re.match(r"(.*) to (\S+)$", rest)
            ins.args, ins.type = [m.group(1)], m.group(2)
        elif op == "extractvalue":
            ins.args = split_top(rest)
            ins.type = ins.args[0].rsplit(" ", 1)[0]
        elif op == "phi":
            t, a = rest.split(" ", 1)
            ins.type = t
            ins.args = [tuple(x.strip() for x in p.split(",")) for p in re.findall(r"\[ ([^\]]+) \]", a)]
        elif op == "alloca":
            ins.type = split_top(rest)[0]
        elif op == "getelementptr":
            ins.args = split_top(rest)
            ins.type = "ptr"
        elif op == "load":
            ins.args = split_top(rest)
            ins.type = ins.args[0]
        elif op == "store":
            ins.args = split_top(rest)
        elif op == "br":
            ins.args = split_top(rest)
        elif op == "switch":
            m = re.match(r"(\S+) (\S+), label (%\d+) \[(.*)\]", rest)
            ins.args = [m.group(2), m.group(3)]
            ins.extra["cases"] = re.findall(r"\S+ (-?\d+), label (%\d+)", m.group(4))


def val(tok: str) -> str:
    """Last token of a typed operand ('float %3' -> '%3')."""
    return tok.strip().rsplit(" ", 1)[-1]


# --------------------------------------------------------------------------- template side

def load_templates():
    if not TEMPLATE_SUMMARY.exists():
        raise SystemExit("run template_summary.py first (writes json/template-summary.json)")
    return json.loads(TEMPLATE_SUMMARY.read_text())


def find_template(items, pattern: str):
    norm = pattern.replace("\\\\", "/").replace("\\", "/")
    exact = [t for t in items if t["path"] == norm]
    if exact:
        return exact[0]
    rx = re.compile(pattern)
    hits = [t for t in items if rx.search(t["path"])]
    if len(hits) != 1:
        raise SystemExit(f"template pattern matched {len(hits)} templates: {[h['path'] for h in hits][:10]}")
    return hits[0]


def cache_name(tpl) -> str:
    return tpl["path"].rsplit("/", 1)[-1].rsplit(".", 1)[0]


def fmt_default(d):
    if isinstance(d, list):
        return "(" + ", ".join(str(x) for x in d) + ")"
    return str(d)


# --------------------------------------------------------------------------- lifter

class Lifter:
    def __init__(self, prog: Program, tpl: dict | None, stage: str, vs: Program | None = None):
        self.p, self.tpl, self.stage, self.vs = prog, tpl, stage, vs
        self.params = {}
        if tpl:
            for q in tpl["parameters"]:
                if q["group"] == GROUP.get(stage) and q["usedRegister"] is not None:
                    self.params[q["usedRegister"]] = q
        self.handles: dict[str, dict] = {}
        self.used_params: dict[int, set] = defaultdict(set)
        self.engine_regs: dict[tuple, set] = defaultdict(set)
        self.notes: list[str] = []
        self.force_var: set[str] = set()
        self.uses = defaultdict(int)
        self.use_blocks = defaultdict(set)
        for b in self.p.order:
            for ins in self.p.blocks[b]:
                for tok in re.findall(r"%[\w.]+", ins.text):
                    if tok != ins.res:
                        self.uses[tok] += 1
                        self.use_blocks[tok].add(b)
        self._cfg()
        self._resolve_handles()

    # -- control flow
    def _cfg(self):
        self.succ, self.pred = defaultdict(list), defaultdict(list)
        for b in self.p.order:
            t = self.p.blocks[b][-1]
            if t.op == "br":
                targets = [val(a)[1:] for a in t.args if a.startswith("label")]
            elif t.op == "switch":
                targets = [t.args[1][1:]] + [c[1][1:] for c in t.extra["cases"]]
            else:
                targets = []
            for s in dict.fromkeys(targets):
                self.succ[b].append(s)
                self.pred[s].append(b)
        # reverse post-order + back edges
        seen, post, self.back = set(), [], set()
        stack = set()

        def dfs(n):
            seen.add(n)
            stack.add(n)
            for s in self.succ[n]:
                if s in stack:
                    self.back.add((n, s))
                elif s not in seen:
                    dfs(s)
            stack.discard(n)
            post.append(n)
        sys.setrecursionlimit(10000)
        dfs("0")
        self.rpo = post[::-1]
        # immediate post-dominators (iterative, virtual exit "EXIT")
        nodes = self.rpo
        exits = [n for n in nodes if not self.succ[n]]
        pdom = {n: set(nodes) | {"EXIT"} for n in nodes}
        pdom["EXIT"] = {"EXIT"}
        changed = True
        while changed:
            changed = False
            for n in reversed(nodes):
                ss = self.succ[n] or ["EXIT"]
                new = set.intersection(*(pdom[s] for s in ss)) | {n}
                if n in exits:
                    new = {n, "EXIT"}
                if new != pdom[n]:
                    pdom[n], changed = new, True
        self.ipdom = {}
        for n in nodes:
            # strict post-dominators form a chain; the nearest has the largest own set
            cands = pdom[n] - {n}
            best = max(cands, key=lambda c: len(pdom[c]) if c != "EXIT" else 0, default="EXIT")
            self.ipdom[n] = None if best == "EXIT" else best

    # -- resources
    def _resolve_handles(self):
        for b in self.p.order:
            for ins in self.p.blocks[b]:
                if ins.op != "call":
                    continue
                d = ins.extra["dxop"]
                if d == "CreateHandle":
                    cls, rng, idx = int(val(ins.args[1])), int(val(ins.args[2])), val(ins.args[3])
                    self.handles[ins.res] = self._handle(cls, rng, idx)
                elif d == "CreateHandleFromBinding":
                    self.notes.append("SM6.6 CreateHandleFromBinding present: handle names are raw bindings")
                    self.handles[ins.res] = {"kind": "raw", "name": f"binding_{ins.res[1:]}"}
                elif d == "AnnotateHandle":
                    src = val(ins.args[1])
                    self.handles[ins.res] = self.handles.get(src, {"kind": "raw", "name": src})

    def _handle(self, cls, rng, idx):
        b = self.p.binding(cls, rng)
        bind = b.get("HLSL Bind", "?").replace(" ", "")
        if cls == 2:
            reg = int(re.match(r"cb(\d+)", bind).group(1)) if bind.startswith("cb") else -1
            struct_ = self.p.cb_struct.get(rng, "")
            return {"kind": "cb", "reg": reg, "struct": struct_, "name": struct_ or f"cb{reg}"}
        if cls == 3:
            return {"kind": "sampler", "name": bind}
        count = int(b.get("Count") or 1)
        if count > 1:  # bindless table: trace the index back to a cb4 register
            reg = self._trace_index(idx)
            if reg is not None and reg in self.params:
                q = self.params[reg]
                self.used_params[reg].add("texture")
                return {"kind": "tex", "name": q["name"], "bind": bind, "param": q}
            self.force_var.add(idx)
            return {"kind": "tex", "name": f"{bind.split(',')[0]}[_{idx[1:]}]", "bind": bind}
        return {"kind": "tex", "name": f"engine_{bind.split(',')[0]}", "bind": bind}

    def _trace_index(self, tok):
        for _ in range(8):
            ins = self.p.defs.get(tok)
            if ins is None:
                return None
            if ins.op == "add" and val(ins.args[1]) == "0":
                tok = val(ins.args[0])
            elif ins.op == "call" and ins.extra["dxop"] in ("WaveReadLaneFirst",):
                tok = val(ins.args[1])
            elif ins.op == "extractvalue":
                src = self.p.defs.get(val(ins.args[0]))
                if src is not None and src.op == "call" and src.extra["dxop"] == "CBufferLoadLegacy":
                    h = self.p.defs.get(val(src.args[1]))
                    if h is not None and h.extra.get("dxop") == "CreateHandle":
                        bb = self.p.binding(2, int(val(h.args[2])))
                        if bb.get("HLSL Bind", "").strip() == "cb4" and ins.args[1].strip() == "0":
                            return int(val(src.args[2]))
                return None
            else:
                return None
        return None

    # -- naming of values
    def cb_name(self, h, reg: int, comp: int) -> str:
        c = XYZW[comp]
        if h["kind"] == "cb" and h["reg"] == 4 and reg in self.params:
            q = self.params[reg]
            self.used_params[reg].add(c)
            if q["type"] == "Scalar" and comp == 0:
                return q["name"]
            if "Texture" in q["type"] and comp == 0:
                return f"{q['name']}_bindlessIndex"
            return f"{q['name']}.{c}"
        if h["kind"] == "cb" and h["reg"] == 4:
            self.used_params[reg].add(c)
            return f"cb4[{reg}].{c} /*unmapped*/"
        self.engine_regs[(h["name"], reg)].add(c)
        return f"{h['name']}[{reg}].{c}"

    def input_name(self, sig_id: int, comp: int) -> str:
        row = self.p.inputs[sig_id] if sig_id < len(self.p.inputs) else {"Name": f"in{sig_id}", "Index": ""}
        idx = row.get("Index", "")
        return f"{row['Name']}{idx if row['Name'].startswith('TEXCOORD') or idx not in ('0', '') else ''}.{XYZW[comp]}"

    def output_name(self, sig_id: int, comp: int) -> str:
        row = self.p.outputs[sig_id] if sig_id < len(self.p.outputs) else {"Name": f"out{sig_id}", "Index": ""}
        return f"{row['Name']}{row.get('Index', '')}.{XYZW[comp]}"

    # -- expression building
    def lift(self) -> str:
        p = self.p
        self.expr: dict[str, tuple[str, bool]] = {}
        self.inline: dict[str, bool] = {}
        self.decls: dict[str, str] = {}
        loops = bool(self.back)
        for b in self.rpo:
            for ins in p.blocks[b]:
                if not ins.res:
                    continue
                text, atomic, kind = self._expr(ins)
                self.expr[ins.res] = (text, atomic)
                if ins.res in self.force_var:
                    self.inline[ins.res] = False
                elif kind == "name":
                    self.inline[ins.res] = True
                elif kind == "var":
                    self.inline[ins.res] = False
                else:
                    same = self.use_blocks[ins.res] <= {b}
                    ok_block = same or (not loops and kind == "pure")
                    self.inline[ins.res] = (self.uses[ins.res] == 1 and ok_block and len(text) <= 110)
        # phi declarations
        for b in p.order:
            for ins in p.blocks[b]:
                if ins.op == "phi":
                    self.decls[ins.res] = self._ty(ins.type)
        self.out, self.emitted, self.labels = [], set(), set()
        self._region("0", None, 1)
        body = []
        for line in self.out:
            m = re.match(r"(\s*)@@LABEL(\w+)@@(.*)", line)
            if m:
                if m.group(2) == "0":
                    continue
                line = (f"block_{m.group(2)}:  " if m.group(2) in self.labels else m.group(1)) + m.group(3)
            body.append(line)
        by_type = defaultdict(list)
        for r, t in self.decls.items():
            if "[" not in t:
                by_type[t].append("_" + r[1:])
        decl = [f"    {t} {', '.join(v)};" for t, v in by_type.items()]
        return "\n".join(decl + body)

    def _ty(self, t: str) -> str:
        t = t.strip()
        return {"float": "float", "i32": "uint", "i1": "bool", "half": "half", "i16": "int16_t",
                "i64": "int64_t", "double": "double", "%dx.types.ResRet.f32": "float4",
                "%dx.types.ResRet.i32": "int4", "%dx.types.CBufRet.f32": "float4"}.get(t, t)

    def ref(self, tok: str, paren=True) -> str:
        tok = tok.strip()
        if tok.startswith("%"):
            if self.inline.get(tok):
                text, atomic = self.expr[tok]
                return text if atomic or not paren else f"({text})"
            return "_" + tok[1:]
        if tok.startswith("@"):
            m = re.search(r"\\01\?(\w+)@@", tok)
            return m.group(1) if m else tok[1:].strip('"')
        if tok in ("true", "false", "undef"):
            return tok
        if re.fullmatch(r"-?(0x[0-9A-Fa-f]+|\d+\.\d+e[+-]\d+|\d+\.\d*)", tok):
            return fmt_float(tok)
        return tok

    def _expr(self, ins: Instr):
        """Return (text, atomic, kind) with kind in name/pure/resource/var."""
        op, a = ins.op, ins.args
        if op in BINOP:
            x, y = self.ref(val(a[0])), self.ref(val(a[1]))
            if op in ("add", "or") and val(a[1]) == "0":
                return x, not x.startswith("(") and " " not in x, "pure"
            if op == "xor" and ins.type == "i1" and val(a[1]) == "true":
                return f"!{x}", True, "pure"
            if op == "fsub" and val(a[0]) in ("-0.000000e+00", "0xH8000"):
                return f"-{y}", True, "pure"
            sym = BINOP[op]
            if ins.type == "i1" and op in ("and", "or"):
                sym = {"and": "&&", "or": "||"}[op]
            return f"{x} {sym} {y}", False, "pure"
        if op in ("fcmp", "icmp"):
            return f"{self.ref(val(a[0]))} {CMP.get(ins.extra['pred'], ins.extra['pred'])} {self.ref(val(a[1]))}", False, "pure"
        if op == "select":
            return f"{self.ref(val(a[0]))} ? {self.ref(val(a[1]))} : {self.ref(val(a[2]))}", False, "pure"
        if op in CAST:
            src = a[0].rsplit(" ", 1)[0]
            if op == "zext" and src == "i1":
                return f"(uint){self.ref(val(a[0]))}", True, "pure"
            return f"({CAST[op]}){self.ref(val(a[0]))}", True, "pure"
        if op == "bitcast":
            fn = "asuint" if ins.type == "i32" else "asfloat" if ins.type == "float" else f"({ins.type})"
            return f"{fn}({self.ref(val(a[0]), False)})", True, "pure"
        if op == "extractvalue":
            src_tok, k = val(a[0]), int(a[1])
            src = self.p.defs.get(src_tok)
            if src is not None and src.op == "call" and src.extra["dxop"] in ("CBufferLoadLegacy",):
                h = self.handles.get(val(src.args[1]), {"kind": "raw", "name": "cb?"})
                reg = val(src.args[2])
                if not reg.isdigit():  # dynamic index, e.g. bone palettes
                    return f"{h['name']}[{self.ref(reg, False)}].{XYZW[k]}", True, "name"
                return self.cb_name(h, int(reg), k), True, "name"
            base = self.ref(src_tok)
            return f"{base}.{XYZW[k] if k < 4 else 'status'}", True, "name"
        if op == "call":
            return self._call(ins)
        if op == "phi":
            return "_" + ins.res[1:], True, "var"
        if op == "alloca":
            m = re.match(r"\[(\d+) x (\w+)\]", ins.type)
            self.decls[ins.res] = f"{self._ty(m.group(2))}[{m.group(1)}]" if m else ins.type
            return "_" + ins.res[1:], True, "var"
        if op == "getelementptr":
            base = self.ref(val(a[1]))
            idx = [self.ref(val(x), False) for x in a[2:]]
            if idx and idx[0] == "0":
                idx = idx[1:]
            return base + "".join(f"[{i}]" for i in idx), True, "name"
        if op == "load":
            return self.ref(val(a[1])), True, "var"
        return f"/* {ins.text} */", True, "var"

    def _call(self, ins: Instr):
        d, a, names = ins.extra["dxop"], ins.args[1:], ins.extra["argnames"]
        if d in ("CreateHandle", "CreateHandleFromBinding", "AnnotateHandle"):
            return self.handles.get(ins.res, {"name": "?"})["name"], True, "name"
        if d == "LoadInput":
            name = self.input_name(int(val(a[0])), int(val(a[2])))
            row = val(a[1])
            return (name if row == "0" else f"{name.split('.')[0]}[{self.ref(row, False)}].{name.split('.')[1]}"), True, "name"
        if d == "CBufferLoadLegacy":
            h = self.handles.get(val(a[0]), {"name": "cb?"})
            return f"{h['name']}[{val(a[1])}]", True, "var"
        args = [self.ref(val(x), False) for x in a]
        if d in FUNC:
            fn = FUNC[d]
            if d.startswith("Dot"):
                n = int(d[3])
                vt = f"float{n}"
                return f"dot({vt}({', '.join(args[:n])}), {vt}({', '.join(args[n:2 * n])}))", True, "pure"
            kind = "resource" if d in PER_PIXEL else "pure"
            return f"{fn}({', '.join(args)})", True, kind
        if d in RESOURCE_READ or d.startswith(("Sample", "Texture", "Buffer", "RawBuffer")):
            return self._resource_call(ins, d, a, names)
        if d in SIDE_EFFECT or not ins.res:
            return f"{d}({', '.join(args)})", True, "var"
        # thread ids, wave ops etc.
        return f"{d}({', '.join(args)})", True, "var"

    def _resource_call(self, ins, d, a, names):
        names = [n.strip() for n in names][: len(a)]
        obj = self.handles.get(val(a[0]), {"name": self.ref(val(a[0]))})["name"] if a else "?"
        groups, order = defaultdict(list), []
        itype = {}
        for n, x in zip(names[1:], a[1:]):
            v = val(x)
            itype[re.sub(r"\d+$", "", n)] = x.strip().startswith("i32")
            key = re.sub(r"\d+$", "", n) if re.search(r"(coord|offset|ddx|ddy)\d$", n) else n
            if v == "undef":
                continue
            if key not in groups:
                order.append(key)
            groups[key].append(self.ref(v, False))
        parts = []
        for k in order:
            vals = groups[k]
            if k == "offset" and all(v == "0" for v in vals):
                continue
            if k in ("sampler",):
                parts.append(self.handles.get("%" + vals[0][1:], {"name": vals[0]})["name"])
            elif len(vals) > 1:
                vt = "int" if (k == "offset" or itype.get(k)) else "float"
                parts.append(f"{vt}{len(vals)}({', '.join(vals)})")
            else:
                parts.append(vals[0])
        # sampler handles were resolved via ref(); map "_N" of handle tokens back to names
        parts = [self._handle_text(p) for p in parts]
        method = {"TextureLoad": "Load", "BufferLoad": "Load", "RawBufferLoad": "Load"}.get(d, d)
        return f"{obj}.{method}({', '.join(parts)})", True, "var"

    def _handle_text(self, text):
        m = re.fullmatch(r"_(\d+)", text)
        if m and ("%" + m.group(1)) in self.handles:
            return self.handles["%" + m.group(1)]["name"]
        return text

    # -- statement emission
    def emit(self, indent, s):
        self.out.append("    " * indent + s)

    def _stmt(self, ins: Instr, indent):
        if ins.op in ("br", "switch", "ret"):
            return
        if ins.op == "phi":
            return
        if ins.op == "store":
            self.emit(indent, f"{self.ref(val(ins.args[1]), False)} = {self.ref(val(ins.args[0]), False)};")
            return
        if ins.op == "call" and ins.extra["dxop"] == "StoreOutput":
            a = ins.args[1:]
            name = self.output_name(int(val(a[0])), int(val(a[2])))
            if val(a[1]) != "0":
                name = f"{name.split('.')[0]}[{self.ref(val(a[1]), False)}].{name.split('.')[1]}"
            self.emit(indent, f"{name} = {self.ref(val(a[3]), False)};")
            return
        if ins.op == "call" and ins.extra["dxop"] == "Discard":
            self.emit(indent, f"if ({self.ref(val(ins.args[1]), False)}) discard;")
            return
        if not ins.res:
            text = self._expr(ins)[0]
            self.emit(indent, f"{text};")
            return
        if self.inline.get(ins.res) or ins.op == "alloca":
            if ins.op == "alloca":
                self.emit(indent, f"{self.decls[ins.res].split('[')[0]} _{ins.res[1:]}[{self.decls[ins.res].split('[')[1]};")
            return
        if ins.op == "call" and ins.extra["dxop"] in ("CreateHandle", "CBufferLoadLegacy", "LoadInput",
                                                       "AnnotateHandle", "CreateHandleFromBinding"):
            return
        text = self.expr[ins.res][0]
        ty = self._ty(ins.type)
        if ins.op == "call" and ins.extra["dxop"] in RESOURCE_READ:
            src = self.handles.get(val(ins.args[1]), {})
            label = src.get("name", "r").split("[")[0]
            ty = "float4" if "f32" in ins.type else "int4" if "i32" in ins.type else ty
            self.emit(indent, f"{ty} _{ins.res[1:]} = {text};  // {label}")
            return
        self.emit(indent, f"{ty} _{ins.res[1:]} = {text};")

    def _phi_copies(self, frm, to, indent):
        phis = [i for i in self.p.blocks[to] if i.op == "phi"]
        pairs = []
        for ph in phis:
            for v, lab in ph.args:
                if lab == "%" + frm:
                    pairs.append((ph.res, val(v)))
        phi_set = {r for r, _ in pairs}
        if any(v in phi_set for _, v in pairs):  # parallel copy through temporaries
            for r, v in pairs:
                self.emit(indent, f"{self.decls[r]} _{r[1:]}_next = {self.ref(v, False)};")
            for r, _ in pairs:
                self.emit(indent, f"_{r[1:]} = _{r[1:]}_next;")
        else:
            for r, v in pairs:
                self.emit(indent, f"_{r[1:]} = {self.ref(v, False)};")

    def _region(self, b, stop, indent):
        while b is not None and b != stop:
            if b in self.emitted:
                self.emit(indent, f"goto block_{b};  // loop back-edge or unstructured join")
                self.labels.add(b)
                return
            self.emitted.add(b)
            self.emit(indent, f"@@LABEL{b}@@// %{b}")
            for ins in self.p.blocks[b]:
                self._stmt(ins, indent)
            t = self.p.blocks[b][-1]
            if t.op == "ret":
                self.emit(indent, "return;")
                return
            if t.op == "br" and len(t.args) == 1:
                s = val(t.args[0])[1:]
                self._phi_copies(b, s, indent)
                b = s
                continue
            merge = self.ipdom.get(b)
            if t.op == "br":
                cond = self.ref(val(t.args[0]), False)
                tt, ff = val(t.args[1])[1:], val(t.args[2])[1:]
                head = len(self.out)
                self.emit(indent, f"if ({cond}) {{")
                self._edge(b, tt, merge, indent + 1)
                mark = len(self.out)
                self.emit(indent, "} else {")
                self._edge(b, ff, merge, indent + 1)
                if len(self.out) == mark + 1:
                    self.out.pop()
                elif mark == head + 1:  # empty then-branch: negate instead
                    del self.out[mark]
                    self.out[head] = "    " * indent + f"if (!({cond})) {{"
                self.emit(indent, "}")
            elif t.op == "switch":
                self.emit(indent, f"switch ({self.ref(val(t.args[0]), False)}) {{")
                for k, lab in t.extra["cases"]:
                    self.emit(indent, f"case {k}: {{")
                    self._edge(b, lab[1:], merge, indent + 1)
                    self.emit(indent + 1, "break; }")
                self.emit(indent, "default: {")
                self._edge(b, t.args[1][1:], merge, indent + 1)
                self.emit(indent + 1, "break; }")
                self.emit(indent, "}")
            b = merge

    def _edge(self, frm, to, merge, indent):
        self._phi_copies(frm, to, indent)
        if to != merge:
            if (frm, to) in self.back or to in self.emitted:
                self.emit(indent, f"goto block_{to};  // loop back-edge or unstructured join")
                self.labels.add(to)
            else:
                self._region(to, merge, indent)


# --------------------------------------------------------------------------- reports

def vertex_io(vs: Program | None):
    """Map VS output scalar slot -> list of VS input names it depends on."""
    if vs is None:
        return {}
    in_slots = {}
    for row in vs.inputs:
        reg = row.get("Register", "")
        if not reg.isdigit():
            continue
        for c in row.get("Mask", "").strip():
            in_slots[int(reg) * 4 + XYZW.index(c)] = f"{row['Name']}{row.get('Index', '')}.{c}"
    out = {}
    for row in vs.outputs:
        reg = row.get("Register", "")
        if not reg.isdigit():
            continue
        key = f"{row['Name']}{row.get('Index', '')}"
        comps = {}
        for c in row.get("Mask", "").strip():
            slot = int(reg) * 4 + XYZW.index(c)
            comps[c] = [in_slots.get(s, f"slot{s}") for s in vs.deps.get(slot, [])]
        out[key] = comps
    return out


def compress(names):
    by = defaultdict(str)
    for n in names:
        sem, _, c = n.rpartition(".")
        by[sem or n] += c
    return ", ".join(f"{s}.{c}" for s, c in by.items()) or "constants only"


def header(lf: Lifter, ps_guid, vs_guid, blob_sha, info, pass_info, vs):
    p, lines = lf.p, []
    lines.append(f"// Annotated pseudo-HLSL lifted from dxc -dumpbin DXIL ({p.model}); not compilable source.")
    lines.append(f"// Program {ps_guid}  SHA-256 {blob_sha}")
    if info:
        lines.append(f"// Compilation: {info}")
    if lf.tpl:
        lines.append(f"// Template: {lf.tpl['path']}  materialType={lf.tpl['materialType']}")
    lines.append("// Names: _N is SSA %N of the .ll (per-program). Template names come from usedParameters"
                 f"[{GROUP.get(lf.stage)}] registers; engine buffers from DXIL struct names.")
    lines.append("//\n// Constant buffers:")
    for b in p.bindings:
        if b.get("Type") == "cbuffer":
            rng = int(re.sub(r"\D", "", b["ID"]))
            lines.append(f"//   {b['HLSL Bind']:<6} {p.cb_struct.get(rng, '(anonymous)')}")
    lines.append("// Other resources:")
    for b in p.bindings:
        if b.get("Type") != "cbuffer":
            lines.append(f"//   {b['HLSL Bind']:<12} {b['Type']:<8} {b.get('Dim', ''):<6} count {b.get('Count', '')}"
                         + ("  (bindless table)" if int(b.get("Count") or 1) > 1 else ""))
    # template parameters
    if lf.tpl:
        lines.append("//\n// Material parameters (cb4 register: name type default -> use in this program):")
        fields = p.cb4_fields
        mism, unchecked = [], []
        for reg in sorted(lf.params):
            q = lf.params[reg]
            use = sorted(lf.used_params.get(reg, []))
            use_s = "texture" if "texture" in use else ("." + "".join(c for c in XYZW if c in use)) if use else "unused"
            lines.append(f"//   [{reg:>2}] {q['name']:<28} {q['type']:<10} {fmt_default(q['default'])}  -> {use_s}")
            want = EXPECTED_FIELD.get(q["type"])
            if reg < len(fields) and want and fields[reg] != want:
                mism.append(f"[{reg}] {q['name']} {q['type']} vs field {fields[reg]}")
            elif reg < len(fields) and not want:
                unchecked.append(f"{q['name']}:{q['type']}={fields[reg]}")
        extra = sorted(r for r in lf.used_params if r not in lf.params)
        if extra:
            lines.append(f"//   UNMAPPED cb4 registers read: {extra}")
        if fields:
            lines.append(f"// ShaderSpecificConstants has {len(fields)} fields; register/type check: "
                         + ("all consistent" if not mism else "MISMATCH " + "; ".join(mism))
                         + (f" (engine-bound, not checked: {', '.join(unchecked)})" if unchecked else ""))
    if lf.engine_regs:
        lines.append("//\n// Engine registers read (struct[register].components):")
        for (name, reg), comps in sorted(lf.engine_regs.items()):
            label = KNOWN_ENGINE.get((name, reg, None)) or next(
                (KNOWN_ENGINE[(name, reg, c)] for c in comps if (name, reg, c) in KNOWN_ENGINE), "")
            lines.append(f"//   {name}[{reg}].{''.join(c for c in XYZW if c in comps)}" + (f"  -- {label}" if label else ""))
    # inputs
    vio = vertex_io(vs)
    lines.append(f"//\n// Inputs (dependencies in vertex program {vs_guid}):" if vs_guid else "//\n// Inputs:")
    for row in p.inputs:
        key = f"{row['Name']}{row.get('Index', '')}"
        comps = vio.get(key, {})
        groups = defaultdict(str)
        for c, v in comps.items():
            groups[compress(v)] += c
        dep = "; ".join(f".{c} <- {d}" for d, c in groups.items())
        lines.append(f"//   {key:<14} mask {row.get('Mask', ''):<5} used {row.get('Used', ''):<5} {dep}")
    lines.append("// Outputs:")
    gb = bool(pass_info and GBUFFER_STAGES.search(pass_info.get("stage", "")))
    for row in p.outputs:
        key = f"{row['Name']}{row.get('Index', '')}"
        role = GBUFFER_ROLES.get(int(row.get("Index") or 0), "") if gb and row["Name"] == "SV_Target" else ""
        blend = ""
        if pass_info and row["Name"] == "SV_Target":
            t = pass_info["targets"]
            idx = int(row.get("Index") or 0)
            blend = f" [blend {t[idx]}]" if idx < len(t) else ""
        lines.append(f"//   {key:<12}{blend} {role}")
    if lf.notes:
        lines.append("// Notes: " + "; ".join(sorted(set(lf.notes))))
    return "\n".join(lines)


def annotate_ll(lf: Lifter) -> str:
    out = []
    for line in lf.p.text.splitlines():
        m = re.match(r"\s+(%[\w.]+) = ", line)
        if m and m.group(1) in lf.expr:
            text, _ = lf.expr[m.group(1)]
            ins = lf.p.defs[m.group(1)]
            if ins.op in ("extractvalue", "call") and (ins.op == "extractvalue" or ins.extra.get("dxop") in (
                    "CreateHandle", "LoadInput")) and not text.startswith("_"):
                line += f"   ; => {text}"
        elif "storeOutput" in line:
            mm = re.search(r"i32 5, i32 (\d+), i32 \d+, i8 (\d)", line)
            if mm:
                line += f"   ; => {lf.output_name(int(mm.group(1)), int(mm.group(2)))}"
        out.append(line)
    return "\n".join(out)


# --------------------------------------------------------------------------- commands

def disassembly(guid: str) -> tuple[Program, str]:
    ll = sc.RAW / f"{guid}.ll"
    dx = sc.RAW / f"{guid}.dxbc"
    if not ll.exists() or not dx.exists():
        sc.RAW.mkdir(parents=True, exist_ok=True)
        _cache, blob = sc.find_program(int(guid))
        dx.write_bytes(blob)
        res = sc.subprocess.run([str(sc.DXC), "-dumpbin", str(dx)], capture_output=True, text=True)
        if res.returncode:
            raise SystemExit(f"dxc failed for {guid}: {res.stderr[:400]}")
        ll.write_text(res.stdout)
    return Program(ll.read_text()), sc.sha256(dx.read_bytes())


def pass_for(tpl, info):
    m = re.search(r"Pass '([^']+)'", info or "")
    if not (tpl and m):
        return None
    return next((p for p in tpl["passes"] if p["stage"] == m.group(1)), None)


def annotate_one(tpl, ps_guid, vs_guid, info, write=True):
    prog, sha = disassembly(ps_guid)
    vs = disassembly(vs_guid)[0] if vs_guid else None
    stage = "pixel" if prog.model.startswith("ps") else "vertex" if prog.model.startswith("vs") else prog.model
    lf = Lifter(prog, tpl, stage, vs)
    body = lf.lift()
    text = header(lf, ps_guid, vs_guid, sha, info, pass_for(tpl, info), vs) + "\n\nvoid main()\n{\n" + body + "\n}\n"
    if write:
        ANN.mkdir(parents=True, exist_ok=True)
        (ANN / f"{ps_guid}.hlsl").write_text(text)
        (ANN / f"{ps_guid}.annotated.ll").write_text(annotate_ll(lf))
    return text, lf


def compilations(name_rx, info_rx=None):
    index = sc.load("material")["compilations"]
    rx, irx = re.compile(name_rx), re.compile(info_rx) if info_rx else None
    for c in index:
        if rx.fullmatch(c["template"]) and (not irx or irx.search(c["info"])):
            progs = {p["stage"]: p["guid"] for p in c["programs"]}
            yield c, progs.get("vertex"), progs.get("pixel")


def cmd_annotate(args):
    items = load_templates()
    tpl = find_template(items, args.template)
    name = cache_name(tpl)
    same = [t["path"] for t in items if cache_name(t) == name]
    if len(same) > 1:
        print(f"note: cache name '{name}' is shared by {same}; programs cannot be told apart by name", file=sys.stderr)
    done = set()
    if args.guid:
        by_ps = {}
        for c, vs, ps in compilations(re.escape(name)):
            by_ps.setdefault(ps, (c, vs, ps))
        jobs = [by_ps.get(g, (None, None, g)) for g in args.guid]
    else:
        jobs = list(compilations(re.escape(name), args.info))
    for c, vs, ps in jobs:
        if not ps or ps in done:
            continue
        done.add(ps)
        text, lf = annotate_one(tpl, ps, vs, c["info"] if c else None)
        if vs and vs not in done:
            done.add(vs)
            annotate_one(tpl, vs, None, c["info"] if c else None)
        used = sum(1 for r in lf.params if lf.used_params.get(r))
        print(f"{ps}  {c['info'] if c else ''}\n    -> {ANN / (ps + '.hlsl')}  params used {used}/{len(lf.params)}"
              f"  unmapped cb4 {sorted(r for r in lf.used_params if r not in lf.params)}")
    if not done:
        print("no pixel programs matched")


def cmd_search(args):
    items = load_templates()
    by_name = defaultdict(list)
    for t in items:
        by_name[cache_name(t)].append(t)
    pats = [re.compile(p) for p in args.pattern]
    seen, hits = set(), 0
    for c, vs, ps in compilations(args.template, args.info):
        if not ps or ps in seen:
            continue
        seen.add(ps)
        tpls = by_name.get(c["template"], [])
        text, _lf = annotate_one(tpls[0] if len(tpls) == 1 else None, ps, vs, c["info"], write=False)
        if all(p.search(text) for p in pats):
            hits += 1
            print(f"MATCH {ps} {c['info']}")
            for p in pats:
                m = p.search(text)
                s = text.rfind("\n", 0, m.start()) + 1
                print("    " + text[s:text.find("\n", m.end())].strip()[:200])
    print(f"{hits} of {len(seen)} pixel programs matched")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("annotate")
    p.add_argument("template")
    p.add_argument("--info")
    p.add_argument("--guid", nargs="+")
    p.set_defaults(fn=cmd_annotate)
    p = sub.add_parser("search")
    p.add_argument("template")
    p.add_argument("pattern", nargs="+")
    p.add_argument("--info")
    p.set_defaults(fn=cmd_search)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
