"""Check relative Markdown links (files and #anchors) and Studio source paths in tracked .md files.

Usage: python tools/check_links.py [--external-clones]
Links into sibling reference clones outside the repository (e.g. ../Cyberpunk-Modding-Docs)
are skipped unless --external-clones is given, because they exist only in the local workspace.
Links to git-ignored local-only files (inventories, captures, extracted evidence) are accepted
when absent, since they exist only in the maintainer's workspace. Anchors use GitHub's heading slug rules.

Source paths: a TypeScript path to the Studio's source written in inline code outside fenced blocks,
such as `src/engines/layered-makeup/recipe.ts` or `projects/xf-studio/authoring/src/scene.ts`
(also `authoring/src/...`), must exist; a bare `src/...` resolves against projects/xf-studio/authoring/.
Globs such as `src/preview-core-*.ts` are not checked. A record that deliberately names code as it
was (a dated design, audit or delivery record) marks those lines: the checker skips from a line
containing <!-- historical-paths --> through the next line containing <!-- /historical-paths -->,
or to the end of the file when there is none; both markers on one line skip only that line. The public
site escapes HTML in knowledge/ pages, so there a retired module is named without its src/ path instead.

Exit status is 1 when anything is broken.
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
CODE_SPAN = re.compile(r'`([^`\n]+)`')
SOURCE_PATH = re.compile(r'(?<![\w./*-])(?:(?:(?:projects/)?xf-studio/)?authoring/)?(src/[\w./-]+?\.ts)(?![\w.*-])')
AUTHORING = 'projects/xf-studio/authoring'
HISTORICAL_START, HISTORICAL_END = '<!-- historical-paths -->', '<!-- /historical-paths -->'
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


def is_ignored(path):
    rel = os.path.relpath(path, ROOT)
    if rel.startswith('..'):
        return False
    return subprocess.run(['git', 'check-ignore', '-q', '--no-index', rel.replace(os.sep, '/')], cwd=ROOT).returncode == 0


def missing_source_paths(text):
    """(line number, path) for each Studio source path in inline code that does not exist."""
    text = FENCE.sub(lambda m: '\n' * m.group(0).count('\n'), text)  # blank fenced blocks, keeping line numbers
    found, skipping = [], False
    for number, line in enumerate(text.split('\n'), 1):
        skipping = skipping or HISTORICAL_START in line
        if not skipping:
            for span in CODE_SPAN.findall(line):
                for source in SOURCE_PATH.findall(span):
                    dest = os.path.join(ROOT, AUTHORING, source)
                    if not os.path.exists(dest) and not is_ignored(dest):
                        found.append((number, source))
        if HISTORICAL_END in line:
            skipping = False
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--external-clones', action='store_true')
    args = parser.parse_args()
    files = subprocess.run(['git', 'ls-files', '*.md'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    broken = []
    for rel in files:
        path = os.path.join(ROOT, rel)
        text = open(path, encoding='utf-8', errors='replace').read()
        for number, source in missing_source_paths(text):
            broken.append((f'{rel}:{number}', source, 'missing source path'))
        body = FENCE.sub('', text)
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
                if is_ignored(dest):
                    continue  # local-only (git-ignored) evidence: exists only in the maintainer's workspace
                broken.append((rel, target, 'missing file'))
            elif fragment and dest.endswith('.md') and urllib.parse.unquote(fragment).lower() not in anchors(dest):
                broken.append((rel, target, 'missing anchor'))
    for rel, target, why in broken:
        print(f'{rel}: {target} ({why})')
    print(f'{len(broken)} broken link(s) or source path(s) in {len(files)} Markdown files')
    return 1 if broken else 0


if __name__ == '__main__':
    sys.exit(main())
