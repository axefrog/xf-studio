"""Read-only, local character-creator catalog probe.

Consumes a provider-neutral inventory plus WolvenKit JSON exports. It never
writes to the game, MO2, archives, or saves. See research/character-customization/
catalog-prototype.md for the deliberately narrow merge boundary.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class Candidate:
    provider: str
    virtual_path: str
    physical_path: str
    active: bool
    priority: int | None
    kind: str


def visible_files(candidates: Iterable[Candidate]) -> dict[str, dict]:
    """Resolve loose virtual files only; archive resources are a later stage."""
    grouped: dict[str, list[Candidate]] = {}
    for item in candidates:
        grouped.setdefault(item.virtual_path.casefold().replace("/", "\\"), []).append(item)
    out = {}
    for key, rows in grouped.items():
        active = [r for r in rows if r.active]
        ordered = sorted(active, key=lambda r: r.priority if r.priority is not None else -1, reverse=True)
        certain = len(ordered) < 2 or (all(r.kind == "mo2" for r in ordered)
                                      and ordered[0].priority is not None
                                      and ordered[0].priority != ordered[1].priority)
        out[key] = {"candidates": [asdict(r) for r in rows],
                    "winner": asdict(ordered[0]) if ordered and certain else None,
                    "confidence": "inferred" if ordered and certain else "unknown"}
    return out


def mo2_snapshot(root: Path, profile: str) -> tuple[list[Candidate], dict]:
    listing = root / "profiles" / profile / "modlist.txt"
    if not listing.is_file():
        raise FileNotFoundError(listing)
    lines = listing.read_text(encoding="utf-8-sig").splitlines()
    mods = [(line[1:], line[0] == "+", i) for i, line in enumerate(lines)
            if line and line[0] in "+-" and not line.startswith("#")]
    candidates: list[Candidate] = []
    for name, enabled, priority in mods:
        folder = root / "mods" / name
        if not folder.is_dir():
            continue
        for suffix in ("*.archive", "*.xl", "*.inkcharcustomization"):
            for path in folder.rglob(suffix):
                virtual = str(path.relative_to(folder)).replace("/", "\\")
                candidates.append(Candidate(name, virtual, str(path), enabled, priority, "mo2"))
    overwrite = root / "overwrite"
    if overwrite.is_dir():
        for suffix in ("*.archive", "*.xl", "*.inkcharcustomization"):
            for path in overwrite.rglob(suffix):
                candidates.append(Candidate("MO2 overwrite", str(path.relative_to(overwrite)).replace("/", "\\"),
                                            str(path), True, len(lines) + 1, "mo2"))
    settings = (root / "ModOrganizer.ini").read_text(encoding="utf-8-sig", errors="replace")
    flags = {name: (re.search(rf"{name}=(true|false)", settings, re.I) or [None, "unobserved"])[1]
             for name in ("enforce_archive_load_order", "reverse_archive_load_order")}
    selected = re.search(r"^selected_profile=@ByteArray\((.*)\)$", settings, re.M)
    return candidates, {"profile": profile, "configured_profile": selected.group(1) if selected else None,
                        "profile_matches_config": bool(selected and selected.group(1) == profile),
                        "modlist_sha256": hashlib.sha256(listing.read_bytes()).hexdigest(),
                        "profile_rows": len(mods), "priority_rule": "later modlist row has greater MO2 file priority",
                        "archive_order_flags": flags, "archive_order_status": "unresolved; no per-hash index/order proof"}


def directory_snapshot(root: Path, provider: str, kind: str, virtual_prefix: str = "") -> list[Candidate]:
    if not root.is_dir():
        return []
    out = []
    for suffix in ("*.archive", "*.xl", "*.inkcharcustomization"):
        for path in root.rglob(suffix):
            virtual = virtual_prefix + str(path.relative_to(root)).replace("/", "\\")
            out.append(Candidate(provider, virtual, str(path), True, None, kind))
    return out


def launch_sources(launch_context: str, game_mod_root: Path,
                   mo2_root: Path | None = None, profile: str | None = None) -> tuple[list[Candidate], list[Candidate], dict]:
    """Enumerate only mounts visible to the selected launch route.

    This selects physical-file candidates; archive hash order and whether a
    particular launch used this route remain separate unresolved questions.
    """
    manual = directory_snapshot(game_mod_root, "manual game mod", "manual", "archive\\pc\\mod\\")
    if launch_context == "direct":
        return [], manual, {"kind": "direct", "profile": None,
                            "archive_order_status": "unresolved; no per-hash index/order proof"}
    if launch_context == "mo2":
        if mo2_root is None or not profile:
            raise ValueError("MO2 launch context requires --mo2-root and --profile")
        mo, metadata = mo2_snapshot(mo2_root, profile)
        return mo, manual, dict(metadata, kind="mo2")
    raise ValueError(f"unsupported launch context: {launch_context}")


def xl_customizations(path: Path) -> tuple[dict[str, list[str]], list[str]]:
    """Read only the scalar/list customizations stanza; flag unfamiliar syntax."""
    result = {"female": [], "male": []}
    gaps = []
    section = False
    sex = None
    for raw in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        line = raw.split(" #", 1)[0].rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        if indent == 0:
            section = line.strip() == "customizations:"
            sex = None
            continue
        if not section:
            continue
        m = re.match(r"\s+(female|male):(?:\s*(.*))?$", line)
        if m:
            sex = m.group(1)
            value = (m.group(2) or "").strip().strip("\"'")
            if value:
                result[sex].append(value)
            continue
        m = re.match(r"\s+-\s+([^{}\[\]]+)$", line)
        if m and sex:
            result[sex].append(m.group(1).strip().strip("\"'"))
        else:
            gaps.append(f"unsupported customizations line: {line.strip()}")
    return result, gaps


def unwrap(value):
    return value.get("$value", "") if isinstance(value, dict) else value


def depot_path(value) -> str:
    return unwrap(value.get("DepotPath")) if isinstance(value, dict) else ""


def fnv64(path: str) -> str:
    value = 14695981039346656037
    for byte in path.lower().encode("utf-8"):
        value = ((value ^ byte) * 1099511628211) & ((1 << 64) - 1)
    return str(value)


def xl_resource_meta(path: Path) -> tuple[dict[str, dict[str, str]], dict[str, list[str]]]:
    """Read the small resource.fix.paths/resource.scope subset used by the catalog."""
    fixes: dict[str, dict[str, str]] = {}
    scopes: dict[str, list[str]] = {}
    section = subsection = target = None
    in_paths = False
    for raw in path.read_text(encoding="utf-8-sig", errors="replace").splitlines():
        line = raw.split(" #", 1)[0].rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        value = line.strip()
        if indent == 0:
            section = value if value == "resource:" else None
            subsection = target = None
            in_paths = False
        elif section and indent == 2:
            subsection = value[:-1] if value in ("fix:", "scope:") else None
            target = None
            in_paths = False
        elif subsection == "fix" and indent == 4:
            target = value.split(":", 1)[0].casefold() if value.endswith(":") or ": &" in value else None
            in_paths = False
        elif subsection == "fix" and indent == 6:
            in_paths = value == "paths:"
        elif subsection == "fix" and indent == 8 and target and in_paths and ": " in value:
            old, new = value.split(": ", 1)
            fixes.setdefault(target, {})[old.casefold()] = new.strip().strip("\"'")
        elif subsection == "scope" and indent == 4 and value.endswith(":"):
            target = value[:-1].casefold()
        elif subsection == "scope" and indent == 6 and target and value.startswith("- "):
            scopes.setdefault(target, []).append(value[2:].strip().strip("\"'"))
    return fixes, scopes


def scope_leaves(scope: str, scopes: dict[str, list[str]]) -> set[str]:
    """Expand a scope chain as ArchiveXL does; reject cycles instead of guessing."""
    visiting: set[str] = set()

    def expand(path: str) -> set[str]:
        key = path.casefold()
        if key in visiting:
            raise ValueError(f"cyclic resource scope: {path}")
        if key not in scopes:
            return {key}
        visiting.add(key)
        leaves = set().union(*(expand(child) for child in scopes[key]))
        visiting.remove(key)
        return leaves

    return expand(scope)


def apply_app_fix(base: dict, mappings: dict[str, str], allowed_apps: set[str], evidence: dict) -> dict:
    """Apply an evidenced base-resource path fix before custom choice overlays."""
    rows = {area: [] for area in ("head", "body", "arms")}
    for area, options in base["options"].items():
        for option in options:
            copy = dict(option)
            old = option.get("app", "")
            mapped = mappings.get(old.casefold()) if old else None
            if mapped and mapped.casefold() in allowed_apps:
                copy["app_original"] = old
                copy["app"] = mapped
                copy["app_resolution"] = evidence
            rows[area].append(copy)
    return dict(base, options=rows)


def saved_appearance_matches(catalog: dict, app_hash: str, definition: str) -> list[dict]:
    return [{"area": area, "option": option["name"], "app": option["app"],
             "definition": definition, "choice_provider": choice["provider"], "sources": option["sources"],
             "app_original": option.get("app_original"), "app_resolution": option.get("app_resolution")}
            for area, options in catalog["options"].items() for option in options
            if option["type"] == "gameuiAppearanceInfo" and option["app"] and fnv64(option["app"]) == app_hash
            for choice in option["choices"] if choice["name"] == definition]


def normalize_resource(path: Path, provider: str, depot: str) -> dict:
    document = json.loads(path.read_text(encoding="utf-8-sig"))
    root = document["Data"]["RootChunk"]
    groups = {}
    options = {}
    for area in ("head", "body", "arms"):
        groups[area] = [{"name": unwrap(g.get("name")), "options": [unwrap(v) for v in g.get("options", [])]}
                        for g in root.get(area + "Groups", [])]
        options[area] = []
        for handle in root.get(area + "CustomizationOptions", []):
            item = handle.get("Data", handle)
            kind = item.get("$type", "unknown")
            common = {k: unwrap(item.get(k)) for k in ("name", "uiSlot", "link", "localizedName", "enabled", "hidden", "index", "defaultIndex")}
            common.update({"type": kind, "provider": provider, "resource": depot,
                           "editTags": item.get("editTags", [])})
            if kind == "gameuiAppearanceInfo":
                common["app"] = depot_path(item.get("resource"))
                common["choices"] = [{"name": unwrap(v.get("name")), "index": v.get("index"),
                                      "icon": v.get("icon"), "color": v.get("color"),
                                      "provider": provider} for v in item.get("definitions", [])]
            elif kind == "gameuiSwitcherInfo":
                common["choices"] = [{"name": v.get("localizedName"), "index": v.get("index"),
                                      "names": [unwrap(n) for n in v.get("names", [])], "provider": provider}
                                     for v in item.get("options", [])]
            elif kind == "gameuiMorphInfo":
                common["choices"] = [{"name": unwrap(v), "provider": provider} for v in item.get("morphNames", [])]
            else:
                common["choices"] = []
            options[area].append(common)
    return {"provider": provider, "depot": depot, "json_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "gameVersion": document.get("Header", {}).get("GameVersion"), "groups": groups, "options": options}


def merge_catalog(base: dict, additions: list[dict]) -> dict:
    """Narrow, evidence-labelled named/anonymous appearance choice overlay."""
    rows = {area: [dict(o, choices=list(o["choices"]), sources=[o["provider"]]) for o in base["options"][area]]
            for area in ("head", "body", "arms")}
    overlays = []
    gaps = []
    for resource in additions:
        for area, added in resource["options"].items():
            for option in added:
                name = option["name"]
                if name and name != "None":
                    targets = [o for o in rows[area] if o["name"] == name]
                else:
                    targets = [o for o in rows[area] if
                               (option["uiSlot"] not in (None, "", "None") and o["uiSlot"] == option["uiSlot"])
                               or (option["link"] not in (None, "", "None") and o["link"] == option["link"])]
                if not targets and name and name != "None":
                    rows[area].append(dict(option, sources=[resource["provider"]]))
                    continue
                if len(targets) != 1 or targets[0]["type"] != option["type"]:
                    gaps.append({"provider": resource["provider"], "area": area, "name": name,
                                 "reason": f"overlay target count/type unresolved ({len(targets)})"})
                    continue
                target = targets[0]
                if option["type"] != "gameuiAppearanceInfo":
                    gaps.append({"provider": resource["provider"], "area": area, "name": name,
                                 "reason": "non-appearance merge omitted from narrow prototype"})
                    continue
                prior = {c["name"]: i for i, c in enumerate(target["choices"])}
                for choice in option["choices"]:
                    if choice["name"] in prior:
                        target["choices"][prior[choice["name"]]] = choice
                    else:
                        target["choices"].append(choice)
                target["sources"].append(resource["provider"])
                overlays.append({"area": area, "target": target["name"], "source": resource["provider"],
                                 "added_or_replaced": len(option["choices"]), "match": "name" if name != "None" else "uiSlot/link"})
    return {"options": rows, "overlays": overlays, "gaps": gaps,
            "confidence": "source-derived approximation; no runtime winner claim"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--launch-context", choices=("mo2", "direct"), default="mo2",
                        help="Physical-file view to inspect; default preserves the MO2 probe")
    parser.add_argument("--mo2-root", type=Path)
    parser.add_argument("--profile")
    parser.add_argument("--game-mod-root", type=Path, required=True)
    parser.add_argument("--base-json", type=Path, required=True)
    parser.add_argument("--base-depot", default=r"base\gameplay\gui\fullscreen\main_menu\female_cco.inkcharcustomization")
    parser.add_argument("--custom", action="append", default=[], metavar="PROVIDER=DEPOT=JSON")
    parser.add_argument("--saved-app-hash", default="")
    parser.add_argument("--saved-definition", default="")
    parser.add_argument("--app-fix-xl", type=Path, help="Active ArchiveXL bundle resource fix .xl")
    parser.add_argument("--app-scope-xl", type=Path, help="Active ArchiveXL bundle resource scope .xl")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    mo, manual, launch = launch_sources(args.launch_context, args.game_mod_root, args.mo2_root, args.profile)
    files = visible_files(mo + manual)
    active_xl = [v["winner"] for k, v in files.items() if k.endswith(".xl") and v["winner"]]
    declarations = []
    for entry in active_xl:
        found, gaps = xl_customizations(Path(entry["physical_path"]))
        if found["female"] or found["male"] or gaps:
            declarations.append({"provider": entry["provider"], "xl": entry["virtual_path"],
                                 "customizations": found, "gaps": gaps})
    base = normalize_resource(args.base_json, "installed game base", args.base_depot)
    if bool(args.app_fix_xl) != bool(args.app_scope_xl):
        raise ValueError("app fix and scope .xl must be supplied together")
    app_meta = None
    if args.app_fix_xl:
        active_paths = {str(Path(entry["physical_path"]).resolve()).casefold(): entry for entry in active_xl}
        fix_entry = active_paths.get(str(args.app_fix_xl.resolve()).casefold())
        scope_entry = active_paths.get(str(args.app_scope_xl.resolve()).casefold())
        if not fix_entry or not scope_entry or fix_entry["provider"] != scope_entry["provider"]:
            raise ValueError("app fix and scope must be active visible .xl files from one provider")
        fixes, _ = xl_resource_meta(args.app_fix_xl)
        _, scopes = xl_resource_meta(args.app_scope_xl)
        mappings = fixes.get(base["depot"].casefold(), {})
        allowed = scope_leaves("player_customization.app", scopes)
        if not mappings or "player_customization.app" not in scopes or not allowed:
            raise ValueError("no customization app fix/scope found")
        app_meta = {"provider": fix_entry["provider"], "fix_xl": fix_entry["virtual_path"],
                    "scope_xl": scope_entry["virtual_path"],
                    "fix_sha256": hashlib.sha256(args.app_fix_xl.read_bytes()).hexdigest(),
                    "scope_sha256": hashlib.sha256(args.app_scope_xl.read_bytes()).hexdigest(),
                    "basis": "active loose XL config and pinned ArchiveXL source; effective archive winner unproven"}
        base = apply_app_fix(base, mappings, allowed, app_meta)
    additions = []
    for spec in args.custom:
        provider, depot, path = spec.split("=", 2)
        additions.append(normalize_resource(Path(path), provider, depot))
    for item in additions:
        if item["gameVersion"] != base["gameVersion"]:
            raise ValueError(f"custom resource game version differs from base: {item['provider']}")
    registered = {(d["provider"], p.casefold()) for d in declarations for p in d["customizations"]["female"]}
    for item in additions:
        if (item["provider"], item["depot"].casefold()) not in registered:
            raise ValueError(f"custom resource has no active female .xl registration: {item['provider']} {item['depot']}")
    catalog = merge_catalog(base, additions)
    if args.saved_app_hash or args.saved_definition:
        if not re.fullmatch(r"\d{1,20}", args.saved_app_hash) or not args.saved_definition:
            raise ValueError("saved selection needs decimal uint64 app hash and definition")
        catalog["saved_selection"] = {"app_hash": args.saved_app_hash, "definition": args.saved_definition,
                                       "matches": saved_appearance_matches(catalog, args.saved_app_hash, args.saved_definition)}
    output = {"schema": "xfs/read-only-cc-catalog-probe-2",
              "source": args.profile if args.launch_context == "mo2" else "direct game",
              "launch_context": launch,
              "inventory": {"mo2_files": len(mo), "manual_files": len(manual),
                            "active_xl_customization_declarations": len(declarations),
                            "decoded_custom_resources": len(additions),
                            "excluded": ["archive index conflicts and effective resource hashes", "unexported .inkcharcustomization payloads",
                                         "ArchiveXL merge ordering beyond appearance overlay, resource patches, runtime script/UI changes",
                                         "Vortex deployment and actual runtime launch route"]},
              "app_fix": app_meta,
              "declarations": declarations, "resources": [{"provider": x["provider"], "depot": x["depot"],
                                                                "json_sha256": x["json_sha256"], "gameVersion": x["gameVersion"]}
                                                               for x in [base] + additions],
              "catalog": catalog}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
