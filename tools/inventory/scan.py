"""Read-only local landscape census; write metadata only inside this headquarters.

Dependency/cache internals and Git objects are pruned and recorded explicitly.
File contents, credentials, user settings, and downloaded archive payloads are not read.
"""
from __future__ import annotations
import argparse
import collections
import datetime as dt
import json
import os
from pathlib import Path
import subprocess

HQ = Path(__file__).resolve().parents[2]
PRUNE = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', '.next', '.turbo', '.cache', 'webcache', 'target'}
ROOTS = {'dev': Path('D:/Dev'), 'redmodding': Path('F:/Games/RedModding'), 'mo2-mods': Path('F:/Games/MO2/mods'), 'mo2-profiles': Path('F:/Games/MO2/profiles'), 'mo2-overwrite': Path('F:/Games/MO2/overwrite'), 'mo2-legacy-overwrite': Path('F:/Games/MO2/_overwrite_')}

def iso(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).isoformat()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=HQ / 'inventory' / 'snapshots' / dt.date.today().isoformat())
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(HQ):
        raise SystemExit('Output must remain inside headquarters.')
    output.mkdir(parents=True, exist_ok=True)
    errors, skipped, dirs, projects = [], [], [], []
    totals = collections.Counter()
    with (output / 'files.jsonl').open('w', encoding='utf-8') as files:
        for label, root in ROOTS.items():
            if not root.exists():
                errors.append({'path': str(root), 'error': 'missing root'})
                continue
            for current, children, names in os.walk(root, followlinks=False, onerror=lambda e: errors.append({'path': e.filename, 'error': str(e)})):
                folder = Path(current)
                if folder.parent == root:
                    print(f'  {folder}', flush=True)
                kept = []
                for name in sorted(children):
                    child = folder / name
                    reason = 'headquarters output excluded' if child == HQ else 'dependency/cache/git internals' if name in PRUNE else 'junction/symlink' if child.is_symlink() or child.is_junction() else None
                    if reason:
                        skipped.append({'root': label, 'path': str(child), 'reason': reason})
                    else:
                        kept.append(name)
                children[:] = kept
                stat = folder.stat()
                extensions = collections.Counter()
                size = 0
                count = 0
                for name in sorted(names):
                    path = folder / name
                    try:
                        stat_f = path.stat()
                        row = {'root': label, 'path': str(path), 'bytes': stat_f.st_size, 'created_utc': iso(stat_f.st_birthtime), 'modified_utc': iso(stat_f.st_mtime)}
                        files.write(json.dumps(row, ensure_ascii=False) + '\n')
                        size += stat_f.st_size
                        count += 1
                        extensions[path.suffix.lower() or '<none>'] += 1
                    except OSError as e:
                        errors.append({'path': str(path), 'error': str(e)})
                rel = folder.relative_to(root)
                row = {'root': label, 'path': str(folder), 'relative': str(rel), 'created_utc': iso(stat.st_birthtime), 'modified_utc': iso(stat.st_mtime), 'direct_files': count, 'direct_bytes': size, 'extensions': dict(extensions)}
                dirs.append(row)
                totals[label] += count
                if folder != root and (folder.parent == root or (folder / '.git').exists() or (label == 'redmodding' and folder.parent.name in {'Projects', 'General', 'Docs'}) or (label == 'dev' and folder.parent.name in {'archived-projects', 'clones', 'workspaces', '.workspaces-archive', 'forks'})):
                    item = dict(row)
                    item['children'] = children[:]
                    item['files'] = sorted(names)
                    if (folder / '.git').exists():
                        def git(*args):
                            try:
                                p = subprocess.run(['git', '--no-optional-locks', '-C', str(folder), *args], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=5)
                                return p.stdout.strip() if p.returncode == 0 else None
                            except subprocess.TimeoutExpired:
                                return '<timed out>'
                        item['git'] = {'origin': git('config', '--get', 'remote.origin.url'), 'head': git('rev-parse', 'HEAD'), 'last_commit': git('log', '-1', '--format=%cI %s'), 'branch': git('branch', '--show-current')}
                    projects.append(item)
            print(f'{label}: {totals[label]} files', flush=True)
    for name, value in [('directories', dirs), ('projects', projects), ('scan-notes', {'scanned_utc': iso(dt.datetime.now().timestamp()), 'roots': {k:str(v) for k,v in ROOTS.items()}, 'files_per_root': dict(totals), 'errors': errors, 'skipped': skipped})]:
        (output / f'{name}.json').write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(dirs)} directories; {len(projects)} project/mod/container entries; {len(errors)} errors; {len(skipped)} explicitly pruned subtrees')

if __name__ == '__main__':
    main()
