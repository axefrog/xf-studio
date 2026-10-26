"""Release-readiness snapshot across the XF projects, for the maintainer's "where are we?" question.

Usage: python tools/release_status.py [--days 7] [--no-jev] [--out local/release-status.md]

Deterministic, read-only aggregation of what the chats already record:
  - the work queue's Beta blockers and Polish lanes (research/backlog/README.md), with each item's age
    from its trailing *dd Mon* date;
  - open code-health findings by severity (research/authoring/code-health.md; more than 3 High pauses merges);
  - git activity per project (last commit, commits in the window) and commits since the last release tag;
  - the latest CI run per workflow (through the GitHub CLI, when available);
  - each chat's board row (local/coordination.md, private and optional): its release line and how fresh it is.

Signals (things worth a nudge) are listed at the end. With TYPESAFE_API_KEY set and --no-jev not given,
the Jev model gives one fuzzy judgement per beta blocker (moving, stalled or waiting on the maintainer)
from the blocker's text and the window's commit subjects; on any error or low confidence it says
"unknown". The key is read from the environment or HKCU\\Environment and never printed.
The report goes to local/ (ignored), because the board rows it quotes are private.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUEUE = ROOT / "research/backlog/README.md"
LEDGER = ROOT / "research/authoring/code-health.md"
BOARD = ROOT / "local/coordination.md"
MONTHS = {m: i for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(), 1)}
STALE_BLOCKER_DAYS = 14
STALE_ROW_DAYS = 3


def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout


def item_date(text: str, today: date) -> date | None:
    found = re.findall(r"\*(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b", text)
    if not found:
        return None
    day, mon = found[-1]
    d = date(today.year, MONTHS[mon], int(day))
    return d if d <= today else date(today.year - 1, MONTHS[mon], int(day))


def lane_items(lane: str, today: date) -> list[dict]:
    """Top-level bullets of a work-queue lane, with title and age."""
    lines = QUEUE.read_text(encoding="utf-8").splitlines()
    out, inside, current = [], False, None
    for line in lines:
        if line.startswith("### "):
            inside = line[4:].strip().lower().startswith(lane.lower())
            continue
        if line.startswith("## "):
            inside = False
        if not inside:
            continue
        if line.startswith("- "):
            current = {"text": line[2:]}
            out.append(current)
        elif current is not None and line.strip():
            current["text"] += " " + line.strip()
    for it in out:
        m = re.match(r"\*\*(.+?)\*\*", it["text"])
        it["title"] = (m.group(1) if m else it["text"][:80]).rstrip(":. ")
        d = item_date(it["text"], today)
        it["age_days"] = (today - d).days if d else None
    return out


def ledger_counts() -> dict:
    counts = {"High": 0, "Med": 0, "Low": 0}
    text = LEDGER.read_text(encoding="utf-8")
    section = text.split("## Open findings", 1)[-1].split("\n## ", 1)[0]
    for row in re.findall(r"^\| [A-Z]+-\d+ \| (High|Med|Medium|Low) \|", section, re.M):
        counts["Med" if row.startswith("Med") else row] += 1
    return counts


def project_activity(days: int) -> list[dict]:
    since = (date.today() - timedelta(days=days)).isoformat()
    rows = []
    for p in sorted((ROOT / "projects").iterdir()):
        if not p.is_dir():
            continue
        rel = p.relative_to(ROOT).as_posix()
        last = git("log", "-1", "--format=%cs", "--", rel).strip() or "never"
        n = len(git("log", f"--since={since}", "--format=%h", "--", rel).split())
        rows.append({"project": p.name, "last_commit": last, f"commits_{days}d": n})
    return rows


def release_tags() -> dict:
    tag = git("describe", "--tags", "--abbrev=0", "main").strip()
    if not tag:
        return {"last_tag": None}
    return {"last_tag": tag, "tag_date": git("log", "-1", "--format=%cs", tag).strip(),
            "commits_since": int(git("rev-list", "--count", f"{tag}..main").strip() or 0)}


def ci_status() -> list[dict]:
    try:
        out = subprocess.run(["gh", "run", "list", "--branch", "main", "--limit", "40", "--json",
                              "workflowName,conclusion,status,createdAt"], cwd=ROOT, capture_output=True,
                             text=True, timeout=60).stdout
        runs = json.loads(out or "[]")
    except Exception:
        return []
    latest = {}
    for r in runs:
        latest.setdefault(r["workflowName"], r)
    return [{"workflow": k, "result": v.get("conclusion") or v.get("status"), "at": v["createdAt"][:16]} for k, v in sorted(latest.items())]


def board_rows(today: date) -> list[dict]:
    if not BOARD.exists():
        return []
    rows = []
    for line in BOARD.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\| (XF · [^|]+?) \| `(local_[0-9a-f-]+)` \| (.*)", line)
        if not m:
            continue
        body = m.group(3)
        state = re.search(r"\*\*State \((\d{1,2}) (\w{3})\):\*\*", body)
        stamp = date(today.year, MONTHS[state.group(2)], int(state.group(1))) if state and state.group(2) in MONTHS else None
        release = re.search(r"\*\*Release:\*\*\s*([^|]+?)(?:\s\*\*|\s\||$)", body)
        rows.append({"chat": m.group(1).strip(), "state_date": stamp.isoformat() if stamp else None,
                     "state_age_days": (today - stamp).days if stamp else None,
                     "release": release.group(1).strip() if release else None})
    return rows


def jev_key() -> str | None:
    key = os.environ.get("TYPESAFE_API_KEY")
    if key or sys.platform != "win32":
        return key
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            return winreg.QueryValueEx(k, "TYPESAFE_API_KEY")[0]
    except OSError:
        return None


def jev_progress(blockers: list[dict], subjects: str, key: str) -> None:
    """One choice question per blocker: is it moving, stalled or waiting on the maintainer?"""
    questions = {}
    for i, b in enumerate(blockers):
        questions[f"b{i}"] = {"type": "choice",
                              "instructions": f"Judge the work item '{b['title']}' against the recent commit subjects in the state. Item text: {b['text'][:700]}",
                              "criteria": {"moving": "recent commits clearly advance this item",
                                           "stalled": "no recent commit relates to this item",
                                           "waiting": "the item text says it waits on the maintainer, a game session or a decision"}}
    body = json.dumps({"state": "Recent commit subjects on main:\n" + subjects[:6000], "model": "jev-latest", "questions": questions}).encode()
    req = urllib.request.Request("https://api.typesafe.ai/v1/systemone", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            answers = json.load(r).get("answers", {})
    except Exception:
        return
    for i, b in enumerate(blockers):
        a = answers.get(f"b{i}") or {}
        if a.get("confidence", 0) >= 0.6:
            b["jev"] = f"{a.get('choice')} ({a['confidence']:.2f})"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--no-jev", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "local/release-status.md"))
    a = ap.parse_args()
    today = date.today()

    blockers, polish = lane_items("Beta blockers", today), lane_items("Polish lane", today)
    ledger, activity, tags, ci, rows = ledger_counts(), project_activity(a.days), release_tags(), ci_status(), board_rows(today)
    if not a.no_jev and (key := jev_key()):
        jev_progress(blockers, git("log", f"--since={a.days}.days", "--format=%s", "main"), key)

    signals = []
    if ledger["High"] > 3:
        signals.append(f"{ledger['High']} open High findings: feature merges pause until it's 3 or fewer")
    for b in blockers:
        if b["age_days"] is not None and b["age_days"] > STALE_BLOCKER_DAYS and not str(b.get("jev", "")).startswith("moving"):
            signals.append(f"beta blocker older than {STALE_BLOCKER_DAYS} days and not visibly moving: {b['title']} ({b['age_days']} d)")
    for c in ci:
        if c["result"] not in ("success", "in_progress", "queued", "skipped"):
            signals.append(f"CI {c['workflow']}: {c['result']} ({c['at']})")
    for r in rows:
        if r["state_age_days"] is not None and r["state_age_days"] > STALE_ROW_DAYS:
            signals.append(f"{r['chat']}: board state line is {r['state_age_days']} days old")
        if r["release"] is None:
            signals.append(f"{r['chat']}: no **Release:** line on its board row")

    md = [f"# Release status ({datetime.now():%d %b %Y %H:%M})", "",
          f"Last release tag: {tags.get('last_tag')} ({tags.get('tag_date', '?')}), {tags.get('commits_since', '?')} commits since.",
          f"Open code-health findings: {ledger['High']} High, {ledger['Med']} Medium, {ledger['Low']} Low.", "",
          "## Beta blockers (XF Studio's first Nexus release)", ""]
    md += [f"- {b['title']} — {b['age_days'] if b['age_days'] is not None else '?'} d" + (f" — Jev: {b['jev']}" if b.get("jev") else "") for b in blockers]
    md += ["", "## Polish lane", ""] + [f"- {p['title']} — {p['age_days'] if p['age_days'] is not None else '?'} d" for p in polish]
    md += ["", f"## Projects (last {a.days} days)", ""] + [f"- {p['project']}: last commit {p['last_commit']}, {p[f'commits_{a.days}d']} commits" for p in activity]
    if ci:
        md += ["", "## CI (latest run on main)", ""] + [f"- {c['workflow']}: {c['result']} ({c['at']})" for c in ci]
    if rows:
        md += ["", "## Chats", ""] + [f"- {r['chat']}: state {r['state_date'] or '?'}; release: {r['release'] or '(none recorded)'}" for r in rows]
    md += ["", "## Signals", ""] + ([f"- {s}" for s in signals] or ["- none"])
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(md) + "\n", encoding="utf-8")
    out.with_suffix(".json").write_text(json.dumps({"blockers": blockers, "polish": polish, "ledger": ledger, "projects": activity,
                                                    "tags": tags, "ci": ci, "chats": rows, "signals": signals}, indent=1, default=str), encoding="utf-8")
    print(f"wrote {out} ({len(signals)} signals)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
