"""Check the latest public GitHub releases of the frameworks and plugins XF depends on.

Usage: python tools/framework_releases.py [--since YYYY-MM-DD] [--game-version 2.5]

Prints a Markdown table: each repository's latest release tag and date, whether the
release is newer than --since (the game update's release date), and whether its title
or notes mention --game-version. No credentials are used. GitHub allows about 60
unauthenticated API requests an hour, which is plenty for this list.
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.request

REPOS = [
    ("RED4ext", "WopsS/RED4ext"),
    ("redscript", "jac3km4/redscript"),
    ("Cyber Engine Tweaks", "maximegmd/CyberEngineTweaks"),
    ("ArchiveXL", "psiberx/cp2077-archive-xl"),
    ("TweakXL", "psiberx/cp2077-tweak-xl"),
    ("Codeware", "psiberx/cp2077-codeware"),
    ("RedHotTools", "psiberx/cp2077-red-hot-tools"),
    ("RedFileSystem", "rayshader/cp2077-red-filesystem"),
    ("RedHttpClient", "rayshader/cp2077-red-httpclient"),
    ("RedData", "rayshader/cp2077-red-data"),
    ("Mod Settings", "jackhumbert/mod_settings"),
    ("In-World Navigation", "jackhumbert/in_world_navigation"),
    ("Let There Be Flight", "jackhumbert/let_there_be_flight"),
]


def latest(repo):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/releases/latest",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "xf-studio-release-check"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}"}
    except Exception as e:  # network trouble: report and carry on
        return {"error": type(e).__name__}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-10-23", help="game update release date (YYYY-MM-DD)")
    ap.add_argument("--game-version", default="2.5", help="game version to look for in release notes")
    a = ap.parse_args()
    pat = re.compile(r"(?<![\d.])" + re.escape(a.game_version) + r"(?![\d])")
    print(f"| Framework | Latest release | Date | After {a.since}? | Mentions {a.game_version}? |")
    print("|---|---|---|---|---|")
    for name, repo in REPOS:
        d = latest(repo)
        if "error" in d:
            print(f"| {name} | ({d['error']}) | | | |")
            continue
        date = (d.get("published_at") or "")[:10]
        text = f"{d.get('name') or ''}\n{d.get('body') or ''}"
        after = "yes" if date and date >= a.since else "no"
        mention = "yes" if pat.search(text) else "no"
        print(f"| [{name}](https://github.com/{repo}/releases) | {d.get('tag_name')} | {date} | {after} | {mention} |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
