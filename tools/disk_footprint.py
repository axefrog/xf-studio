"""Report what agents' work is holding on drive C (Windows).

Usage: python tools/disk_footprint.py [--min-gb 0.5]

Lists free space on C, each worktree under %USERPROFILE%/xfs-worktrees, each scratch folder under
%USERPROFILE%/xfs-scratch, the other folders agents' tools tend to fill (Codex sessions, the
Claude app's scratch workspaces, Hugging Face and other caches), and %TEMP% grouped by name
prefix. Sizes skip directory junctions (so a worktree's node_modules junction into the main
checkout isn't counted) and use robocopy's listing mode, which is fast on large trees.
Read-only: it deletes nothing.
"""

import argparse
import os
import re
import shutil
import subprocess
from collections import defaultdict
from datetime import datetime
from pathlib import Path

GB = 1024**3
HOME = Path(os.environ["USERPROFILE"])
TEMP = Path(os.environ.get("TEMP", HOME / "AppData/Local/Temp"))


def size(path: Path) -> float:
    out = subprocess.run(
        ["robocopy", str(path), "C:\\__nul__", "/L", "/S", "/NJH", "/NFL", "/NDL", "/BYTES", "/XJ", "/R:0", "/W:0", "/NP"],
        capture_output=True, text=True, errors="replace",
    ).stdout
    m = re.search(r"^\s*Bytes\s*:\s*(\d+)", out, re.M)
    return int(m.group(1)) / GB if m else 0.0


def rows(parent: Path, min_gb: float):
    if not parent.exists():
        return []
    found = []
    for d in parent.iterdir():
        if d.is_dir() and not d.is_symlink():
            gb = size(d)
            if gb >= min_gb:
                found.append((gb, d.name, datetime.fromtimestamp(d.stat().st_mtime).strftime("%m-%d")))
    return sorted(found, reverse=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-gb", type=float, default=0.5)
    a = ap.parse_args()
    print(f"Drive C: {shutil.disk_usage('C:/').free / GB:.1f} GB free\n")
    for title, parent in [("Worktrees", HOME / "xfs-worktrees"), ("XF scratch", HOME / "xfs-scratch"), ("Fabric work", HOME / "fabric-work")]:
        r = rows(parent, a.min_gb)
        total = sum(g for g, _, _ in r)
        print(f"{title} ({parent}): {total:.1f} GB in folders of at least {a.min_gb:g} GB")
        for gb, name, when in r:
            print(f"  {gb:7.1f} GB  {name}  (last changed {when})")
        print()
    print("Other folders agents' tools fill:")
    for p in [HOME / ".codex/sessions", HOME / ".codex/archived_sessions", HOME / "AppData/Local/Claude-Data",
              HOME / ".cache", HOME / ".bun/install/cache", TEMP]:
        if p.exists():
            print(f"  {size(p):7.1f} GB  {p}")
    groups = defaultdict(lambda: [0, 0.0])
    for e in TEMP.iterdir():
        try:
            mtime = e.stat().st_mtime
        except OSError:  # removed while we were listing
            continue
        key = re.sub(r"\d+$", "", re.split(r"[-_.]", e.name)[0]) or "(other)"
        groups[key][0] += 1
        groups[key][1] = max(groups[key][1], mtime)
    print(f"\n%TEMP% entries by prefix (top 12 of {sum(c for c, _ in groups.values())}):")
    for key, (count, newest) in sorted(groups.items(), key=lambda kv: -kv[1][0])[:12]:
        print(f"  {count:7d} x {key:<24} newest {datetime.fromtimestamp(newest):%m-%d %H:%M}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
