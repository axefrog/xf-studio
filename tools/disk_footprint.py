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


# Robocopy's summary block has one row per counter (dirs, files, bytes, times), each with six
# columns. The labels are localised, so match the shape: a label, a colon and six integers. The
# third such row is the byte count (/BYTES makes it a plain integer). Times rows hold h:mm:ss.
SUMMARY_ROW = re.compile(r"^\s*[^:\d]+:\s+(\d+)(?:\s+\d+){5}\s*$", re.M)


def size(path: Path) -> float | None:
    """GB under path, skipping junctions; None if robocopy failed or its summary didn't parse."""
    if path.is_symlink() or path.is_junction():
        return 0.0
    run = subprocess.run(
        ["robocopy", str(path), "C:\\__nul__", "/L", "/S", "/NJH", "/NFL", "/NDL", "/BYTES", "/XJ", "/R:0", "/W:0", "/NP"],
        capture_output=True, text=True, errors="replace",
    )
    counts = SUMMARY_ROW.findall(run.stdout)
    if run.returncode >= 8 or len(counts) < 3:  # 8 and above: some entries couldn't be read
        return None
    return int(counts[2]) / GB


def show(gb: float | None) -> str:
    return "      ? GB (scan incomplete)" if gb is None else f"{gb:7.1f} GB"


def rows(parent: Path, min_gb: float):
    if not parent.exists():
        return []
    found = []
    for d in parent.iterdir():
        try:
            if not d.is_dir() or d.is_symlink() or d.is_junction():
                continue
            gb = size(d)
            when = datetime.fromtimestamp(d.stat().st_mtime).strftime("%m-%d")
        except OSError:  # removed while we were scanning
            continue
        if gb is None or gb >= min_gb:
            found.append((gb, d.name, when))
    return sorted(found, key=lambda r: -1 if r[0] is None else r[0], reverse=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-gb", type=float, default=0.5)
    a = ap.parse_args()
    print(f"Drive C: {shutil.disk_usage('C:/').free / GB:.1f} GB free\n")
    for title, parent in [("Worktrees", HOME / "xfs-worktrees"), ("XF scratch", HOME / "xfs-scratch"), ("Fabric work", HOME / "fabric-work")]:
        r = rows(parent, a.min_gb)
        total = sum(g for g, _, _ in r if g is not None)
        print(f"{title} ({parent}): {total:.1f} GB in folders of at least {a.min_gb:g} GB")
        for gb, name, when in r:
            print(f"  {show(gb)}  {name}  (last changed {when})")
        print()
    print("Other folders agents' tools fill:")
    # The Claude app is a packaged app: AppData writes from its chats land in its package's LocalCache.
    redirected = sorted((HOME / "AppData/Local/Packages").glob("Claude_*/LocalCache"))
    for p in redirected + [HOME / ".codex/sessions", HOME / ".codex/archived_sessions", HOME / "AppData/Local/Claude-Data",
              HOME / ".cache", HOME / ".bun/install/cache", TEMP]:
        if p.exists():
            print(f"  {show(size(p))}  {p}")
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
