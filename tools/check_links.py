"""Check relative Markdown links (files and #anchors) in tracked .md files.

Usage: python tools/check_links.py [--external-clones]
Links into sibling reference clones outside the repository (e.g. ../Cyberpunk-Modding-Docs)
are skipped unless --external-clones is given, because they exist only in the local workspace.
Anchors use GitHub's heading slug rules. Exit status is 1 when anything is broken.
"""
import argparse
import os
import re
import subprocess
import sys
import urllib.parse

ROOT = subprocess.run(['git', 'rev-parse', '--show-toplevel'], capture_output=True, text=True, check=True).stdout.strip()
LINK = re.compile(r'(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|!\[[^\]]*\]\(([^)\s]+)\)')
FENCE = re.compile(r'^(```|~~~).*?^\1', re.S | re.M)
HEADING = re.compile(r'^#{1,6}\s+(.*?)\s*#*\s*$', re.M)
_anchor_cache = {}


def slug(text):
    text = re.sub(r'<[^>]+>', '', text)                    # inline HTML
    text = re.sub(r'!?\[([^\]]*)\]\([^)]*\)', r'\1', text)  # links -> text
    text = text.replace('`', '').lower()
    text = re.sub(r'[^\w\- ]', '', text)
    return text.replace(' ', '-')


def anchors(path):
    if path not in _anchor_cache:
        body = FENCE.sub('', open(path, encoding='utf-8', errors='replace').read())
        seen, found = {}, set()
        for heading in HEADING.findall(body):
            base = slug(heading)
            n = seen.get(base, 0)
            found.add(base if n == 0 else f'{base}-{n}')
            seen[base] = n + 1
        found.update(re.findall(r'<a\s+(?:name|id)="([^"]+)"', body))
        _anchor_cache[path] = found
    return _anchor_cache[path]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--external-clones', action='store_true')
    args = parser.parse_args()
    files = subprocess.run(['git', 'ls-files', '*.md'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    broken = []
    for rel in files:
        path = os.path.join(ROOT, rel)
        body = FENCE.sub('', open(path, encoding='utf-8', errors='replace').read())
        for match in LINK.finditer(body):
            target = match.group(1) or match.group(2)
            if re.match(r'^[a-z][a-z0-9+.-]*:', target, re.I):
                continue
            file_part, _, fragment = target.partition('#')
            file_part = urllib.parse.unquote(file_part)
            dest = os.path.normpath(os.path.join(os.path.dirname(path), file_part)) if file_part else path
            if not os.path.relpath(dest, ROOT).startswith('..'):
                pass
            elif not args.external_clones:
                continue
            if not os.path.exists(dest):
                broken.append((rel, target, 'missing file'))
            elif fragment and dest.endswith('.md') and urllib.parse.unquote(fragment).lower() not in anchors(dest):
                broken.append((rel, target, 'missing anchor'))
    for rel, target, why in broken:
        print(f'{rel}: {target} ({why})')
    print(f'{len(broken)} broken link(s) in {len(files)} Markdown files')
    return 1 if broken else 0


if __name__ == '__main__':
    sys.exit(main())
