"""Read-only census of the mods in a Mod Organizer 2 instance, for the mod-ecosystem survey.

Walks every folder under <MO2>/mods, reads meta.ini and the mod's text files (scripts, tweaks, .xl, input XML,
readmes, licences) and records, per mod: identity as evidenced, file counts by kind, framework use, declared and
evident dependencies, source presence, licence files, profile enablement and script hook points. It then
aggregates hook points across mods (extension-point frequency and conflicts) and classifies each mod.

It never writes under the MO2 folder, never launches anything, and reads modlist.txt files only.
See research/mod-ecosystem/README.md for the method and the limits of each heuristic.

Usage:
  python tools/mod_survey.py --mo2 PATH_TO_MO2 --out experiments/mod-ecosystem/generated
      [--profile "NAME" ...]  (default: the XF diagnostic profile and the main profile)

The MO2 root defaults to $XFS_RESOLVER_MO2_ROOT. Output is JSON; put it in an ignored folder: it names the
maintainer's installed mods and profiles.
"""
from __future__ import annotations

import argparse
import configparser
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

DEFAULT_PROFILES = ["XF Studio diagnostic 2026-09-25", "2025 (again)"]
TEXT_LIMIT = 4 * 1024 * 1024  # skip text files larger than this

# Libraries psiberx publishes for CET mods; many mods bundle copies. Hooks found in these files are attributed
# to the library as well as the mod, so the frequency table can separate "the mod hooks X" from "a bundled
# helper hooks X".
BUNDLED_LUA_LIBS = {"gamesession.lua", "gameui.lua", "gamehud.lua", "gamesettings.lua", "cron.lua", "ref.lua",
                    "gamelocale.lua", "gamestate.lua", "gameoptions.lua"}

# Framework detection from file evidence. Each entry: key -> (display name, reds regex, lua regex).
FRAMEWORK_USE = {
    "Codeware": (r"\bimport\s+Codeware\b|\bScriptableService\b|\bGetCallbackSystem\(|\binkCustomController\b|"
                 r"\bDynamicEntitySystem\b|\bScriptableEnv\b|\bGetScriptableServiceContainer\(|\bGameSessionEvent\b|"
                 r"\bEntityLifecycleEvent\b|\bResourceEvent\b|\bKeyInputEvent\b|\bCodeware\.",
                 r"\bCodeware\b|DynamicEntitySystem|GetCallbackSystem"),
    "ArchiveXL": (r"\bArchiveXL\.", r"\bArchiveXL\b"),
    "TweakXL": (r"\bTweakDBManager\b|\bTweakXL\.", r"\bTweakXL\b"),
    "RedFileSystem": (r"\bimport\s+RedFileSystem\b|\bFileSystem\.GetStorage\(|\bFileSystemStorage\b", None),
    "RedData": (r"\bimport\s+RedData\b|\bRedData\.|\bParseJson\(|\bJsonObject\b", None),
    "Mod Settings": (r"ModSettings\.|@runtimeProperty\(\s*\"ModSettings", None),
    "Native Settings (CET)": (None, r"GetMod\(\s*[\"']nativeSettings[\"']\s*\)"),
    "Audioware": (r"\bimport\s+Audioware\b|\bAudioware\.|\bAudioSystemExt\b", None),
    "AMM (CET)": (None, r"GetMod\(\s*[\"']AppearanceMenuMod[\"']\s*\)"),
    "0-Engine (CET)": (None, r"GetMod\(\s*[\"']0-Engine[\"']\s*\)"),
}

# Direction tags: which XF research directions a mod touches, from its name, Nexus description (first part)
# and hook targets. Keyword evidence only; the ranking step reviews it.
DIRECTIONS = {
    "character creator and appearance": r"character ?creat|charactercustomi[sz]ation|\bcc\b|appearance|ccxl|makeup|tattoo|skin tone|hairstyle|cyberware visib|mirror|inkCharacterCustomization|gameuiCharacterCustomization",
    "photo mode and posing": r"photo ?mode|photomode|\bpose|posing|screenshot|\bcamera\b|freefly|\bdof\b",
    "facial expressions and animation": r"\bfacial|expression|\banim|workspot|\bidle|\bsit anywhere|\blean|gesture|emote|lipsync|\bface\b",
    "lighting and rendering": r"\blight|lighting|render|\bshader|reshade|\blut\b|weather|\benv\b|environment|exposure|\bfog|ray ?trac|path ?trac|dlss|\bfsr\b|bloom|tonemap",
    "world and interiors": r"streaming|apartment|interior|\bworld|location|sector|\bdoor|elevator|metro|train|furnitur|\bspawn|prop\b|props\b|entspawner|world ?builder",
    "NPCs and routines": r"\bnpc|crowd|\bai\b|pedestrian|traffic|community|routine|police|gang|companion|romance|\bbarks?\b|reaction",
    "quests and story": r"\bquest|journal|story|dialog|scene|mission|\bgig|\bsms\b|message|phone|\bfact",
    "UI techniques": r"\bui\b|\bhud|\bmenu|widget|\bink[A-Z]|popup|inventory|tooltip|\bmap\b|minimap|\bwindow",
    "persistence and save state": r"persist|save ?game|\bsaves?\b|\bstorage|database|sqlite|scriptablesystem",
    "input": r"\binput|hotkey|keybind|controller|gamepad|\bkey\b",
    "performance": r"performance|\bfps\b|\blod\b|optimi[sz]|stutter|load ?time|memory|\bcache",
    "mod management and compatibility": r"compatib|\bpatch|\bfix(es)?\b|framework|library|\bapi\b|mod manager|load order",
}

REDS_HOOK = re.compile(r"@(wrapMethod|replaceMethod|addMethod|addField|replaceGlobal|wrapConstructor)\s*\(\s*([\w.]*)\s*\)")
REDS_AFTER_FUNC = re.compile(r"\bfunc\s+(\w+)")
REDS_AFTER_FIELD = re.compile(r"\blet\s+(\w+)")
LUA_HOOK = re.compile(r"\b(Override|ObserveBefore|ObserveAfter|Observe)\s*\(\s*([\"'])([\w.:]+)\2\s*,\s*([\"'])([^\"']+)\4")
LUA_HOOK_ANY = re.compile(r"(?<![\w.])(?:[\w.]+[.:])?(Override|ObserveBefore|ObserveAfter|Observe)\s*\(")
REDS_MODULE = re.compile(r"^\s*module\s+([\w.]+)", re.M)
REDS_IMPORT = re.compile(r"^\s*import\s+([\w.]+)", re.M)
REDS_MODULE_EXISTS = re.compile(r"ModuleExists\(\s*\"([\w.]+)\"\s*\)")
LUA_GETMOD = re.compile(r"GetMod\(\s*[\"']([^\"']+)[\"']\s*\)")
NEXUS_LABEL = re.compile(r"\[url=[^\]]*nexusmods\.com/cyberpunk2077/mods/(\d+)[^\]]*\]([^\[]{2,60})\[/url\]", re.I)
NEXUS_LINK = re.compile(r"nexusmods\.com/cyberpunk2077/mods/(\d+)", re.I)
GITHUB_LINK = re.compile(r"github\.com/([\w.-]+)/([\w.-]+)", re.I)
AUTHOR_LINE = re.compile(r"^\s*(?:[-/*#;]+\s*)?(?:@?author|authors|created by|made by|mod by|written by)\s*[:=\-]?\s*[\"']?([^\n\"']{2,60})", re.I | re.M)
COPYRIGHT = re.compile(r"copyright\s*(?:\(c\)|©)?\s*(?:\d{4}(?:\s*[-,]\s*\d{4})*)?\s*,?\s*([^\n]{2,60})", re.I)


def strip_reds_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    return re.sub(r"(?<!:)//[^\n]*", "", text)


def strip_lua_comments(text: str) -> str:
    text = re.sub(r"--\[(=*)\[.*?\]\1\]", " ", text, flags=re.S)
    return re.sub(r"--[^\n]*", "", text)


def read_text(path: Path) -> str | None:
    try:
        if path.stat().st_size > TEXT_LIMIT:
            return None
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def read_meta(mod_dir: Path) -> dict:
    meta_path = mod_dir / "meta.ini"
    out: dict = {}
    if not meta_path.is_file():
        return out
    cp = configparser.RawConfigParser(strict=False, interpolation=None)
    try:
        cp.read_string(read_text(meta_path) or "")
    except configparser.Error:
        return out
    g = cp["General"] if cp.has_section("General") else {}
    for key in ("modid", "version", "newestVersion", "category", "nexusCategory", "installationFile", "repository", "url"):
        v = g.get(key)
        if v not in (None, ""):
            out[key] = v.strip().strip('"')
    desc = g.get("nexusDescription")
    if desc:
        desc = desc.strip().strip('"').replace("\\n", "\n").replace("<br />", "")
        out["nexusDescription"] = desc
    return out


def read_modlist(path: Path) -> dict[str, str]:
    state: dict[str, str] = {}
    text = read_text(path) or ""
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        flag, name = line[0], line[1:]
        state[name] = {"+": "enabled", "-": "disabled", "*": "unmanaged"}.get(flag, "unknown")
    return state


def yaml_top_keys(text: str) -> list[str]:
    return re.findall(r"^([A-Za-z_$][\w.$\-]*)\s*:", text, re.M)


def xl_top_keys(text: str) -> list[str]:
    stripped = text.strip()
    if stripped.startswith("{"):
        try:
            data = json.loads(stripped)
            return list(data.keys()) if isinstance(data, dict) else []
        except json.JSONDecodeError:
            pass
    return re.findall(r"^([A-Za-z_][\w]*)\s*:", text, re.M)


def rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def scan_mod(mod_dir: Path) -> dict:
    name = mod_dir.name
    rec: dict = {"name": name, "meta": read_meta(mod_dir)}
    counts: Counter = Counter()
    files = [p for p in mod_dir.rglob("*") if p.is_file()]
    rec["fileCount"] = len(files)
    rec["bytes"] = sum(p.stat().st_size for p in files)

    cet_mods_with_init: set[str] = set()
    cet_lua_by_mod: Counter = Counter()
    reds_lines = lua_lines = 0
    hooks: list[dict] = []
    unresolved_lua_hooks = 0
    modules: set[str] = set()
    imports: set[str] = set()
    module_exists: set[str] = set()
    getmods: set[str] = set()
    fw_use: set[str] = set()
    xl_keys: Counter = Counter()
    yaml_keys: Counter = Counter()
    yaml_prefixes: Counter = Counter()
    yaml_types: Counter = Counter()
    yaml_clothing_like = 0
    licence_files: list[str] = []
    readme_files: list[str] = []
    dlls: list[str] = []
    native_funcs = 0
    persistent_fields = 0
    scriptable_systems = 0
    scriptable_services = 0
    author_evidence: list[dict] = []
    links_text = []
    tags_text = [name]
    hook_text: list[str] = []

    for p in files:
        r = rel(p, mod_dir)
        rl = r.lower()
        ext = p.suffix.lower()
        base = p.name.lower()
        if base == "meta.ini":
            continue
        if re.match(r"(licen[cs]e|copying|third_party_licenses)", base) or base.startswith("license"):
            licence_files.append(r)
            t = read_text(p) or ""
            m = COPYRIGHT.search(t)
            if m and base != "third_party_licenses":
                author_evidence.append({"source": r, "kind": "copyright", "text": m.group(1).strip()[:60]})
            continue
        if ext in (".md", ".txt", ".pdf") and re.search(r"readme|read me|install|credits|info|changelog", base):
            readme_files.append(r)
        if ext == ".reds":
            counts["reds"] += 1
            t = read_text(p) or ""
            reds_lines += t.count("\n") + 1
            for m in AUTHOR_LINE.finditer(t[:1500]):
                author_evidence.append({"source": r, "kind": "script header", "text": m.group(1).strip()})
            links_text.append(t[:3000])
            if re.search(r"VirtualShopRegistration|VirtualAtelier", t):
                links_text.append("VirtualAtelier")
            code = strip_reds_comments(t)
            modules.update(REDS_MODULE.findall(code))
            imports.update(REDS_IMPORT.findall(code))
            module_exists.update(REDS_MODULE_EXISTS.findall(code))
            native_funcs += len(re.findall(r"\bnative\s+(?:static\s+)?func\b", code))
            persistent_fields += len(re.findall(r"\bpersistent\s+let\b", code))
            scriptable_systems += len(re.findall(r"extends\s+ScriptableSystem\b", code))
            scriptable_services += len(re.findall(r"extends\s+ScriptableService\b", code))
            for key, (reds_re, _lua_re) in FRAMEWORK_USE.items():
                if reds_re and re.search(reds_re, code):
                    fw_use.add(key)
            for m in REDS_HOOK.finditer(code):
                kind, cls = m.group(1), m.group(2)
                tail = code[m.end(): m.end() + 600]
                # skip over other annotations between this one and the declaration
                fm = (REDS_AFTER_FIELD if kind == "addField" else REDS_AFTER_FUNC).search(tail)
                target = fm.group(1) if fm else None
                hooks.append({"lang": "reds", "kind": kind, "class": cls or "<global>", "member": target, "file": r})
                hook_text.append(f"{cls}.{target}")
        elif ext == ".lua":
            parts = rl.split("/")
            cet_mod = None
            if "cyber_engine_tweaks" in parts and "mods" in parts:
                i = parts.index("mods", parts.index("cyber_engine_tweaks"))
                if i + 1 < len(parts) - 0:
                    cet_mod = r.split("/")[i + 1]
            if cet_mod:
                cet_lua_by_mod[cet_mod] += 1
                if base == "init.lua" and parts[i + 2:] == ["init.lua"]:
                    cet_mods_with_init.add(cet_mod)
            counts["lua"] += 1
            t = read_text(p) or ""
            lua_lines += t.count("\n") + 1
            for m in AUTHOR_LINE.finditer(t[:1500]):
                author_evidence.append({"source": r, "kind": "script header", "text": m.group(1).strip()})
            code = strip_lua_comments(t)
            getmods.update(LUA_GETMOD.findall(code))
            for key, (_reds_re, lua_re) in FRAMEWORK_USE.items():
                if lua_re and re.search(lua_re, code):
                    fw_use.add(key)
            resolved_spans = set()
            for m in LUA_HOOK.finditer(code):
                kind, cls, fn = m.group(1), m.group(3), m.group(5)
                fn = fn.split(";")[0]
                resolved_spans.add(m.start(1))
                hooks.append({"lang": "lua", "kind": kind, "class": cls, "member": fn, "file": r,
                              "bundledLib": base if base in BUNDLED_LUA_LIBS else None})
                hook_text.append(f"{cls}.{fn}")
            for m in LUA_HOOK_ANY.finditer(code):
                if m.start(1) not in resolved_spans and not re.match(r"\s*(function|local)\b", code[max(0, m.start() - 9):m.start()]):
                    unresolved_lua_hooks += 1
        elif ext == ".dll":
            counts["dll"] += 1
            if "red4ext/plugins" in rl:
                counts["red4ext_dll"] += 1
            dlls.append(r)
        elif ext == ".asi":
            counts["asi"] += 1
        elif ext in (".yaml", ".yml"):
            counts["yaml"] += 1
            t = read_text(p) or ""
            keys = yaml_top_keys(t)
            yaml_keys.update(keys)
            for k in keys:
                yaml_prefixes[k.split(".")[0]] += 1
            yaml_types.update(re.findall(r"\$type:\s*([\w.]+)", t))
            if re.search(r"appearanceName|placementSlots|\$type:\s*Clothing|\$base:\s*Items\.Generic|visualTags|garmentOffset|entityName:", t):
                yaml_clothing_like += 1
            if re.search(r"\bQuest|journal|FactValue|gamedataQuest", t):
                counts["yaml_questish"] += 1
        elif ext == ".tweak":
            counts["tweak"] += 1
        elif ext == ".xl":
            counts["xl"] += 1
            t = read_text(p) or ""
            ks = xl_top_keys(t)
            xl_keys.update(ks)
            if re.search(r"^\s*(quest|journal)\s*:", t, re.M) or '"quest"' in t or '"journal"' in t:
                counts["xl_quest_or_journal"] += 1
            if re.search(r"^\s*streaming\s*:", t, re.M) or '"streaming"' in t:
                counts["xl_streaming"] += 1
            if "localization" in t:
                counts["xl_localization"] += 1
        elif ext == ".archive":
            counts["archive"] += 1
        elif ext == ".xml" and "r6/input" in rl:
            counts["input_xml"] += 1
        elif ext == ".ini":
            counts["ini"] += 1
        elif ext == ".json":
            counts["json"] += 1
            if "localization" in rl or "lang" in rl or "onscreens" in rl:
                counts["localization_json"] += 1
        elif ext in (".fx", ".fxh"):
            counts["reshade_shader"] += 1
        elif ext in (".mp3", ".wav", ".ogg", ".wem"):
            counts["audio"] += 1
        elif ext == ".sqlite3":
            counts["sqlite"] += 1
        elif ext == ".toml":
            counts["toml"] += 1
        if ext in (".md", ".txt") and r in readme_files:
            t = read_text(p) or ""
            links_text.append(t[:20000])
            for m in AUTHOR_LINE.finditer(t[:4000]):
                author_evidence.append({"source": r, "kind": "readme", "text": m.group(1).strip()})
        if ext == ".lua" and base == "init.lua":
            links_text.append((read_text(p) or "")[:3000])

    counts["cet_lua_own"] = sum(n for m, n in cet_lua_by_mod.items() if m in cet_mods_with_init)
    counts["cet_lua_addon"] = sum(n for m, n in cet_lua_by_mod.items() if m not in cet_mods_with_init)
    rec["counts"] = dict(counts)
    rec["scriptLines"] = {"reds": reds_lines, "lua": lua_lines}
    rec["cetMods"] = sorted(cet_mods_with_init)
    rec["cetAddonTargets"] = sorted(m for m in cet_lua_by_mod if m not in cet_mods_with_init)
    rec["redsModules"] = sorted(modules)
    rec["redsImports"] = sorted(imports)
    rec["redsModuleExists"] = sorted(module_exists)
    rec["luaGetMod"] = sorted(getmods)
    rec["nativeFuncs"] = native_funcs
    rec["persistentFields"] = persistent_fields
    rec["scriptableSystems"] = scriptable_systems
    rec["scriptableServices"] = scriptable_services
    rec["frameworkUse"] = sorted(fw_use)
    rec["xlKeys"] = dict(xl_keys)
    rec["yamlPrefixes"] = dict(yaml_prefixes.most_common(20))
    rec["yamlTypes"] = dict(yaml_types.most_common(20))
    rec["yamlClothingLikeFiles"] = yaml_clothing_like
    rec["dlls"] = dlls
    rec["licenceFiles"] = licence_files
    rec["readmeFiles"] = readme_files
    rec["hooks"] = hooks
    rec["unresolvedLuaHooks"] = unresolved_lua_hooks
    desc = rec["meta"].get("nexusDescription", "")
    all_links = "\n".join(links_text) + "\n" + desc
    rec["githubLinks"] = sorted({f"{o}/{re.sub(r'(\.git)?[.,)]*$', '', rp)}" for o, rp in GITHUB_LINK.findall(all_links)})
    rec["nexusLinks"] = sorted({int(x) for x in NEXUS_LINK.findall(all_links)})
    rec["nexusLinkLabels"] = [[int(i), lab.strip()[:60]] for i, lab in NEXUS_LABEL.findall(desc)]
    rec["luaFileNames"] = sorted({p.name.lower() for p in files if p.suffix.lower() == ".lua"})
    lowered = [rel(p, mod_dir).lower() for p in files]
    rec["pathMarkers"] = sorted({k for k in ("r6/cache", "persistent") if any(k in x for x in lowered)})
    rec["mentionsVirtualAtelier"] = bool(re.search(r"VirtualShopRegistration|VirtualAtelier|AtelierStore", "\n".join(links_text)))
    for m in AUTHOR_LINE.finditer(desc[:6000]):
        author_evidence.append({"source": "meta.ini nexusDescription", "kind": "nexus page", "text": m.group(1).strip()})
    seen = set()
    rec["authorEvidence"] = [a for a in author_evidence if not (a["text"].lower() in seen or seen.add(a["text"].lower()))][:6]
    tags_text.append(desc[:3000])
    tags_text.extend(hook_text)
    blob = "\n".join(tags_text)
    rec["directionHits"] = {d: len(re.findall(rx, blob, re.I)) for d, rx in DIRECTIONS.items() if re.search(rx, blob, re.I)}
    return rec


# Nexus ids of the frameworks, as recorded in the installed frameworks' own meta.ini files (resolved at runtime,
# so nothing here is guessed): map framework display name -> the installed mod folder that provides it.
FRAMEWORK_FOLDERS = {
    "Cyber Engine Tweaks": ["Cyber Engine Tweaks"],
    "RED4ext": ["RED4ext"],
    "redscript": ["redscript"],
    "ArchiveXL": ["ArchiveXL"],
    "TweakXL": ["TweakXL"],
    "Codeware": ["Codeware"],
    "Mod Settings": ["Mod Settings"],
    "Input Loader": ["Input Loader;", "Input Loader"],
    "RedFileSystem": ["RedFileSystem"],
    "RedData": ["RedData"],
    "Audioware": ["Audioware"],
    "Native Settings UI": ["Native Settings UI", "nativeSettings"],
    "Appearance Menu Mod": ["Appearance Menu Mod"],
    "Virtual Atelier": ["Virtual Atelier"],
    "EquipmentEx": ["Equipment-EX"],
}


def evident_deps(rec: dict) -> set[str]:
    c = rec["counts"]
    d: set[str] = set()
    if c.get("reds"):
        d.add("redscript")
    if c.get("cet_lua_own") or c.get("cet_lua_addon"):
        d.add("Cyber Engine Tweaks")
    if c.get("red4ext_dll"):
        d.add("RED4ext")
    if c.get("yaml") or c.get("tweak"):
        d.add("TweakXL")
    if c.get("xl"):
        d.add("ArchiveXL")
    if c.get("input_xml"):
        d.add("Input Loader")
    fw = set(rec["frameworkUse"])
    for key, name in (("Codeware", "Codeware"), ("ArchiveXL", "ArchiveXL"), ("TweakXL", "TweakXL"),
                      ("RedFileSystem", "RedFileSystem"), ("RedData", "RedData"), ("Mod Settings", "Mod Settings"),
                      ("Native Settings (CET)", "Native Settings UI"), ("Audioware", "Audioware"),
                      ("AMM (CET)", "Appearance Menu Mod"), ("0-Engine (CET)", "0-Engine")):
        if key in fw:
            d.add(name)
    if "AppearanceMenuMod" in rec["cetAddonTargets"]:
        d.add("Appearance Menu Mod")
    return d


# Triage shortcut: creators known for fashion or hair only, and title patterns that mark fashion or hair
# packages. A mod matching either is classed as fashion or hair without further checks (fuzzy, case-insensitive,
# matched at a word start). Its hooks still count in the hook scan.
FASHION_CREATORS = ["nola ?dreamer", "meluminary", "atomiic", "raenef", "axelly", "veegee", "phoebe", "se7en", "mayo",
                    "yusei", "lebronze", "beaniebby", "cyb3r", "alliekat", "limerence", "xrx", "rvc00n", "kmkc",
                    "breezy", "rosa"]
FASHION_TITLE = [r".+archive ?xl", r"casual", r"ccxl", r"dress", r".+ outfit"]


def name_rule_fashion(name: str) -> bool:
    n = name.lower()
    if any(re.search(r"(?<![a-z0-9])" + c, n) for c in FASHION_CREATORS):
        return True
    return any(re.search(p, n) for p in FASHION_TITLE)


def classify(rec: dict, framework_names: set[str]) -> tuple[str, str]:
    c = rec["counts"]
    name = rec["name"]
    cat = rec["meta"].get("nexusCategory") or ""
    cats = set(filter(None, (rec["meta"].get("category") or "").split(",")))
    if name.endswith("_separator"):
        return "separator", "MO2 separator"
    if re.match(r"XF ", name):
        return "XF first-party", "the project's own test or bridge mod"
    if name_rule_fashion(name):
        return "asset-only fashion or hair", "name rule (fashion or hair creator or title pattern; not checked further)"
    if not rec["meta"].get("modid") or rec["meta"].get("modid") == "0":
        if any(k in rec.get("pathMarkers", []) for k in ("r6/cache", "persistent")) and not c.get("archive"):
            return "asset/other visuals", "runtime-generated caches and mod data (an overwrite capture)"
    if name in framework_names:
        return "framework or library", "provides an API other installed mods use"
    code = c.get("reds", 0) + c.get("cet_lua_own", 0) + c.get("red4ext_dll", 0) + c.get("asi", 0)
    if cat == "12" or "12" in cats:
        return ("framework or library", "Nexus category Modders Resources" + (" (code)" if code else " (assets)"))
    hook_classes = {h["class"] for h in rec["hooks"]}
    if (c.get("reds") and not c.get("cet_lua_own") and not c.get("red4ext_dll") and not c.get("input_xml")
            and hook_classes <= {"gameuiInGameMenuGameController"}
            and ("Virtual Atelier" in rec.get("dependsOnInstalledMods", []) or rec.get("mentionsVirtualAtelier"))):
        return "asset-only fashion or hair", "items plus a Virtual Atelier store registration shim"
    if code or c.get("input_xml") or c.get("xl_quest_or_journal"):
        return "functionality", "scripts, plugins, input or quest content"
    yp = set(rec["yamlPrefixes"])
    content_prefixes = {"Items", "Vehicle", "photo_mode", "$instances", "Ammo", "AttachmentSlots",
                        "PhotoModePoses", "PhotoModePoseCategories", "PhotoModeFaces", "poselibrary"}
    if yp and yp <= content_prefixes and yp & {"PhotoModePoses", "PhotoModeFaces"}:
        return "asset/other visuals", "photo-mode pose or expression pack"
    if (c.get("yaml") or c.get("tweak")) and yp - content_prefixes and not rec["yamlClothingLikeFiles"]:
        return "functionality", "tweak-only (changes records beyond item or pose additions: " + ", ".join(sorted(yp - content_prefixes)[:5]) + ")"
    xk = set(rec["xlKeys"])
    fashion = bool(xk & {"factories", "customizations"}) or rec["yamlClothingLikeFiles"] or cat in ("3", "13") or re.search(r"hair|ccxl|archive ?xl|outfit|dress|boots|jacket|makeup|nails|piercing|earring|tattoo|brows|lashes", name, re.I)
    if c.get("cet_lua_addon") and not code:
        return "asset/other visuals", "data add-on for " + ", ".join(rec["cetAddonTargets"])
    if xk & {"streaming"}:
        return "asset/other visuals", "world location (ArchiveXL streaming)"
    if fashion:
        return "asset-only fashion or hair", "items, CC options or appearance archives"
    if c.get("reshade_shader"):
        return "asset/other visuals", "ReShade shaders"
    if c.get("audio"):
        return "asset/other visuals", "audio"
    return "asset/other visuals", "archives or data without scripts"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mo2", default=os.environ.get("XFS_RESOLVER_MO2_ROOT"), help="MO2 instance folder")
    ap.add_argument("--out", required=True, help="output folder (use an ignored one)")
    ap.add_argument("--profile", action="append", help="MO2 profile to record enablement for (repeatable)")
    args = ap.parse_args()
    if not args.mo2:
        ap.error("--mo2 or XFS_RESOLVER_MO2_ROOT is required")
    mo2 = Path(args.mo2)
    mods_root = mo2 / "mods"
    profiles = args.profile or DEFAULT_PROFILES
    modlists = {p: read_modlist(mo2 / "profiles" / p / "modlist.txt") for p in profiles}

    records = []
    for d in sorted(mods_root.iterdir(), key=lambda p: p.name.lower()):
        if d.is_dir():
            rec = scan_mod(d)
            rec["profiles"] = {p: ml.get(d.name, "absent") for p, ml in modlists.items()}
            records.append(rec)

    by_name = {r["name"]: r for r in records}
    by_modid: dict[int, list[str]] = defaultdict(list)
    for r in records:
        try:
            by_modid[int(r["meta"].get("modid", "0"))].append(r["name"])
        except ValueError:
            pass

    # Which installed mods provide which framework, and the Nexus ids of the frameworks as installed.
    fw_provider: dict[str, str] = {}
    for fw, folders in FRAMEWORK_FOLDERS.items():
        for f in folders:
            if f in by_name:
                fw_provider[fw] = f
                break
    fw_modid = {fw: int(by_name[f]["meta"].get("modid", "0") or 0) for fw, f in fw_provider.items()}
    label_votes: dict[str, Counter] = defaultdict(Counter)
    for r in records:
        for nid, lab in r["nexusLinkLabels"]:
            for fw in FRAMEWORK_FOLDERS:
                if fw not in fw_modid and re.fullmatch(r"\W*" + re.escape(fw) + r"(\s*\(?CET\)?)?\W*", lab, re.I):
                    label_votes[fw][nid] += 1
    for fw, votes in label_votes.items():
        nid, n = votes.most_common(1)[0]
        if n >= 3:
            fw_modid[fw] = nid  # evidenced by >= 3 mod pages linking this id under the framework's name
    modid_to_fw = {v: k for k, v in fw_modid.items() if v}

    # Reds module providers and CET mod providers, for inter-mod dependency edges.
    module_provider: dict[str, list[str]] = defaultdict(list)
    cet_provider: dict[str, list[str]] = defaultdict(list)
    for r in records:
        for m in r["redsModules"]:
            module_provider[m].append(r["name"])
        for m in r["cetMods"]:
            cet_provider[m].append(r["name"])
    used_by: Counter = Counter()
    for r in records:
        deps_mods: set[str] = set()
        for imp in r["redsImports"]:
            imp = imp.rstrip(".")
            # `import A.B.C` names module A.B.C, or symbol C of module A.B: take the longest declared module.
            cands = [m for m in module_provider if imp == m or imp.startswith(m + ".")]
            if not cands:
                continue
            provs = module_provider[max(cands, key=len)]
            # Some mods bundle copies of a framework's modules; prefer the framework itself when it declares them.
            fw_provs = [p for p in provs if p in fw_provider.values()]
            for prov in (fw_provs or provs):
                if prov != r["name"]:
                    deps_mods.add(prov)
        for gm in r["luaGetMod"]:
            deps_mods.update(p for p in cet_provider.get(gm, []) if p != r["name"])
        for ca in r["cetAddonTargets"]:
            deps_mods.update(p for p in cet_provider.get(ca, []) if p != r["name"])
        r["dependsOnInstalledMods"] = sorted(deps_mods)
        for dm in deps_mods:
            used_by[dm] += 1
        r["optionalModules"] = sorted(set(r["redsModuleExists"]) - set(r["redsModules"]))
        declared = set()
        for nid in r["nexusLinks"]:
            if nid in modid_to_fw:
                declared.add(modid_to_fw[nid])
        desc = r["meta"].get("nexusDescription", "")
        # Declared = the Nexus page links the framework's page. A bare name in the text is weaker (it may be a
        # list of the author's other mods), so it is kept apart.
        r["declaredDeps"] = sorted(declared)
        r["mentionedFrameworks"] = sorted(fw for fw in FRAMEWORK_FOLDERS
                                          if fw not in declared and re.search(re.escape(fw), desc, re.I))
        r["evidentDeps"] = sorted(evident_deps(r))
        r["sourcePresent"] = bool(r["counts"].get("reds") or r["counts"].get("lua"))
        r["nativeSourceLinks"] = r["githubLinks"] if r["counts"].get("red4ext_dll") else []

    framework_names = set(fw_provider.values()) | {
        n for n, k in used_by.items()
        if k >= 2 and re.search(r"core|framework|librar|resource|extension|hacking ?system|engine|\bapi\b", n, re.I)}
    for extra in ("Cyber Engine Tweaks", "RED4ext", "redscript"):
        if extra in by_name:
            framework_names.add(extra)
    for r in records:
        r["usedByInstalledMods"] = used_by.get(r["name"], 0)
        r["class"], r["classReason"] = classify(r, framework_names)
        r["nameRule"] = name_rule_fashion(r["name"])

    # Lua files that several mods bundle under the same name (psiberx's GameUI/GameSession, interaction-UI
    # helpers and the like): hooks found in them are reported as "via a bundled library copy".
    lua_name_mods: Counter = Counter()
    for r in records:
        lua_name_mods.update(n for n in r["luaFileNames"] if n != "init.lua")
    shared_lua = {n for n, k in lua_name_mods.items() if k >= 3} | BUNDLED_LUA_LIBS
    for r in records:
        for h in r["hooks"]:
            if h["lang"] == "lua":
                b = h["file"].rsplit("/", 1)[-1].lower()
                h["bundledLib"] = b if b in shared_lua else None

    # Hook aggregation.
    hook_mods: dict[tuple, dict] = {}
    for r in records:
        seen = set()
        for h in r["hooks"]:
            if h["kind"] in ("addMethod", "addField"):
                continue
            key = (h["class"], h["member"])
            kind = h["kind"]
            via_lib = bool(h.get("bundledLib"))
            e = hook_mods.setdefault(key, {"class": key[0], "member": key[1], "mods": {}, })
            m = e["mods"].setdefault(r["name"], {"kinds": set(), "viaBundledLibOnly": True, "libs": set(), "profiles": r["profiles"]})
            m["kinds"].add(kind)
            if via_lib:
                m["libs"].add(h["bundledLib"])
            else:
                m["viaBundledLibOnly"] = False
    table = []
    for key, e in hook_mods.items():
        mods = e["mods"]
        direct = [n for n, m in mods.items() if not m["viaBundledLibOnly"]]
        replacers = sorted(n for n, m in mods.items() if "replaceMethod" in m["kinds"] or "replaceGlobal" in m["kinds"])
        overriders = sorted(n for n, m in mods.items() if "Override" in m["kinds"])
        wrappers = sorted(n for n, m in mods.items() if m["kinds"] & {"wrapMethod", "wrapConstructor", "Observe", "ObserveBefore", "ObserveAfter"})
        table.append({"class": e["class"], "member": e["member"], "mods": len(mods), "modsDirect": len(direct),
                      "replacers": replacers, "luaOverriders": overriders, "wrappersOrObservers": wrappers,
                      "detail": {n: {"kinds": sorted(m["kinds"]), "viaBundledLibOnly": m["viaBundledLibOnly"], "libs": sorted(m["libs"]), "profiles": m["profiles"]} for n, m in sorted(mods.items())}})
    table.sort(key=lambda t: (-t["modsDirect"], -t["mods"], t["class"], str(t["member"])))
    conflicts = [t for t in table if len(t["replacers"]) + len(t["luaOverriders"]) >= 2 or ((t["replacers"] or t["luaOverriders"]) and len(set(t["wrappersOrObservers"]) - set(t["replacers"]) - set(t["luaOverriders"])) >= 1)]

    added = defaultdict(set)
    for r in records:
        for h in r["hooks"]:
            if h["kind"] in ("addMethod", "addField"):
                added[(h["class"], h["member"], h["kind"])].add(r["name"])
    add_collisions = [{"class": c, "member": m, "kind": k, "mods": sorted(v)} for (c, m, k), v in added.items() if len(v) > 1]

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for r in records:
        r["meta"].pop("nexusDescription", None)  # large; the scanner re-reads it when needed
        r.pop("nexusLinkLabels", None)
    summary = {
        "mo2": "PATH_TO_MO2", "profiles": profiles, "modCount": len(records),
        "classCounts": dict(Counter(r["class"] for r in records)),
        "frameworkProviders": fw_provider, "frameworkNexusIds": fw_modid,
    }
    (out / "survey.json").write_text(json.dumps({"summary": summary, "mods": records}, indent=1, default=sorted), encoding="utf-8")
    (out / "hooks.json").write_text(json.dumps({"extensionPoints": table, "conflicts": conflicts, "addCollisions": add_collisions}, indent=1, default=sorted), encoding="utf-8")
    print(json.dumps(summary, indent=1))
    print(f"hook targets: {len(table)}; conflicts: {len(conflicts)}; add collisions: {len(add_collisions)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
