"""Report whether a threshold-triggered code/architecture review is due.

Usage: python tools/review_due.py
Reads the last reviewed commit from research/authoring/code-health.md and counts merged feature branches
and changed source lines on main since then. Exit status is 1 when a review is due.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True, check=True).stdout.strip())
LEDGER = ROOT / 'research/authoring/code-health.md'
MERGES, LINES = 5, 4000
SOURCE = re.compile(r'^projects/.*\.(ts|py|js)$')
EXCLUDED = re.compile(r'(^|/)(tests?|generated|build|dist)/|\.test\.ts$|style-guide\.html$')


def git(*args):
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def main():
    text = LEDGER.read_text(encoding='utf-8')
    section = text.split('## Last reviewed', 1)[1].split('##', 1)[0]
    commits = re.findall(r'^\|\s*`?([0-9a-f]{7,40})`?\s*\|', section, re.M)
    base = commits[0] if commits else git('rev-list', '--max-parents=0', 'HEAD').split()[0]
    merges = [line for line in git('log', '--merges', '--first-parent', '--format=%s', f'{base}..main').splitlines() if line]
    changed = 0
    for line in git('diff', '--numstat', f'{base}..main').splitlines():
        added, removed, path = (line.split('\t') + ['', '', ''])[:3]
        if SOURCE.match(path) and not EXCLUDED.search(path) and added.isdigit():
            changed += int(added) + int(removed)
    listed = text.split('## New subsystems since last review', 1)[1].split('\n## ', 1)[0].strip()
    new_subsystems = listed.startswith('-') and not listed.lower().startswith('- none')
    due = len(merges) >= MERGES or changed >= LINES or new_subsystems
    print(f'Since {base[:10]}: {len(merges)} merges, {changed} changed source lines, '
          f'new subsystems listed: {"yes" if new_subsystems else "no"}.')
    print('Deep review DUE.' if due else 'No deep review due yet.')
    return 1 if due else 0


if __name__ == '__main__':
    sys.exit(main())
