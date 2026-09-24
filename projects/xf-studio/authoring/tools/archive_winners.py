"""Small, read-only archive-hash stage for the character catalog.

The order policy is a source-derived expectation for an explicitly selected
launch route. It is never a report of bytes loaded by a running game.
"""
from __future__ import annotations

import hashlib
import re
import struct
from pathlib import Path
from typing import Iterable


MAX_U64 = (1 << 64) - 1
ARCHIVE_PATH = "archive\\pc\\mod\\"


def decimal_hash(value: str) -> str:
    if not re.fullmatch(r"[0-9]+", value) or int(value) > MAX_U64:
        raise ValueError(f"resource hash must be decimal uint64: {value}")
    return str(int(value))


def index_hashes(path: Path, wanted: set[int]) -> set[int]:
    """Read the RDAR index only; the SHA-1 entry field is not payload proof."""
    size = path.stat().st_size
    with path.open("rb") as stream:
        header = stream.read(24)
        if len(header) != 24 or header[:4] != b"RDAR":
            raise ValueError("invalid RDAR header")
        index_offset = struct.unpack_from("<Q", header, 8)[0]
        if index_offset > size - 28:
            raise ValueError("archive index outside file")
        stream.seek(index_offset + 16)
        count_data = stream.read(4)
        if len(count_data) != 4:
            raise ValueError("truncated archive index")
        count = struct.unpack("<I", count_data)[0]
        if count > (size - index_offset - 28) // 56:
            raise ValueError("archive entries outside file")
        stream.seek(index_offset + 28)
        found: set[int] = set()
        for _ in range(count):
            entry = stream.read(56)
            if len(entry) != 56:
                raise ValueError("truncated archive entry")
            hashed = struct.unpack_from("<Q", entry)[0]
            if hashed in wanted:
                found.add(hashed)
        return found


def resolve_archive_hashes(files: dict[str, dict], requested: Iterable[str],
                           *, base_roots: Iterable[Path] = ()) -> dict:
    """Resolve visible archive containers, then source-order indexed hashes.

    A visible modlist is used literally. Without one, the MO2 Cyberpunk guide's
    alphabetical first-wins rule is applied to standard archive/pc/mod files.
    Missing base roots, ambiguous virtual files, duplicate list names and index
    errors prevent a winner claim where relevant.
    """
    wanted = {decimal_hash(value) for value in requested}
    wanted_int = {int(value) for value in wanted}
    modlist_key = ARCHIVE_PATH + "modlist.txt"
    modlist = files.get(modlist_key)
    order_names: list[str] | None = None
    modlist_sha256 = None
    order_source = "MO2 Cyberpunk support guide: alphabetical, first archive wins"
    order_issue = None
    if modlist:
        if not modlist["winner"]:
            order_issue = "visible archive modlist.txt is ambiguous"
        else:
            path = Path(modlist["winner"]["physical_path"])
            modlist_sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
            order_names = [line.strip().casefold() for line in path.read_text(encoding="utf-8-sig").splitlines()
                           if line.strip() and not line.lstrip().startswith("#")]
            if len(order_names) != len(set(order_names)):
                order_issue = "duplicate names in archive modlist.txt"
            order_source = f"visible archive modlist.txt ({path}); first listed archive wins"

    rows: list[dict] = []
    errors: list[dict] = []
    ambiguous_files: list[str] = []
    for virtual, resolution in files.items():
        if not virtual.endswith(".archive"):
            continue
        if not resolution["winner"] and any(row["active"] for row in resolution["candidates"]):
            ambiguous_files.append(virtual)
        for candidate in resolution["candidates"]:
            # Retain disabled and shadowed containers as physical evidence.
            rows.append(dict(candidate, visible=candidate == resolution["winner"],
                             base=False, name=Path(candidate["physical_path"]).name.casefold(),
                             standard_mod=virtual.startswith(ARCHIVE_PATH)))
    roots = list(base_roots)
    for root in roots:
        if not root.is_dir():
            raise ValueError(f"base archive root is absent: {root}")
    for root in roots:
        for path in sorted(root.rglob("*.archive")) if root.is_dir() else []:
            rows.append({"provider": "installed game base", "virtual_path": str(path),
                         "physical_path": str(path), "active": True, "priority": None,
                         "kind": "base", "visible": True, "base": True,
                         "name": path.name.casefold(), "standard_mod": False})

    visible_standard_names = {row["name"] for row in rows if row["visible"] and row["standard_mod"]}
    missing_list_names = sorted(set(order_names or []) - visible_standard_names)
    hits: dict[str, list[dict]] = {value: [] for value in wanted}
    digest_cache: dict[str, str] = {}
    for row in rows:
        try:
            path = Path(row["physical_path"])
            matched = index_hashes(path, wanted_int)
            if matched and row["physical_path"] not in digest_cache:
                digest = hashlib.sha256()
                with path.open("rb") as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(block)
                digest_cache[row["physical_path"]] = digest.hexdigest()
            size = path.stat().st_size if matched else None
        except (OSError, ValueError) as exc:
            errors.append({"archive": row["physical_path"], "visible": row["visible"], "error": str(exc)})
            continue
        for hashed in matched:
            hits[str(hashed)].append(dict(row, container_sha256=digest_cache[row["physical_path"]],
                                          container_size=size))

    def order_key(row: dict) -> tuple[int, int | str]:
        if row["base"]:
            return (1, row["name"])
        if order_names is not None:
            return (0, order_names.index(row["name"]) if row["name"] in order_names else len(order_names))
        return (0, row["name"])

    results = {}
    for hashed, candidates in hits.items():
        active = [row for row in candidates if row["visible"]]
        ordered = sorted(active, key=order_key)
        gaps = []
        if not roots:
            gaps.append("installed game base archives not supplied")
        if any(error["visible"] for error in errors):
            gaps.append("one or more archive indexes could not be read")
        if ambiguous_files:
            gaps.append("one or more active virtual archive paths have ambiguous physical visibility")
        if order_issue:
            gaps.append(order_issue)
        if missing_list_names:
            gaps.append("visible modlist.txt names archives outside the indexed view")
        if any(not row["standard_mod"] and not row["base"] for row in active):
            gaps.append("nonstandard archive mount order is unmodeled")
        if any(row["base"] for row in active) and any(not row["base"] for row in active):
            gaps.append("base-game versus mod archive precedence is unmodeled")
        if order_names is not None and any(row["standard_mod"] and row["name"] not in order_names for row in active):
            gaps.append("active archive is absent from visible modlist.txt")
        if len({row["name"] for row in active if row["standard_mod"]}) < len([row for row in active if row["standard_mod"]]):
            gaps.append("duplicate archive basenames have unresolved order")
        winner = ordered[0] if ordered and not gaps else None
        results[hashed] = {"physical_candidates": candidates, "visible_candidates": ordered,
                           "source_derived_winner": winner, "runtime_observed_winner": None,
                           "rule": order_source, "confidence": "source-derived" if winner else "unknown",
                           "gaps": gaps or (["no visible indexed provider"] if not ordered else [])}
    return {"resource_hashes": results,
            "coverage": {"indexed_archives": len(rows), "index_errors": errors,
                         "ambiguous_virtual_archives": ambiguous_files,
                         "missing_modlist_archives": missing_list_names,
                         "modlist_sha256": modlist_sha256,
                         "base_roots": [str(root) for root in roots],
                         "order_source": order_source,
                         "runtime_observation": "none; selected route and source order are an offline expectation"}}
