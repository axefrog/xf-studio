"""Strict generated-resource gate before WolvenKit packs a Studio collection.

ArchiveWriter hashes a sanitized depot path and skips unsupported extensions. Our
generated resource tree is deliberately narrower: paths must already be canonical
and must match the collection plan exactly, so sanitization cannot silently rename
or omit a resource.
"""
import hashlib
from pathlib import Path
import re


SEGMENT = re.compile(r'[a-z0-9_][a-z0-9_.-]*\Z', re.ASCII)
EXTENSIONS = {'.app', '.inkcharcustomization', '.mesh', '.morphtarget', '.xbm'}


def depot_path(value):
    if not isinstance(value, str) or not value or '\\' in value or value.startswith('/'):
        raise ValueError(f'Noncanonical depot path: {value!r}')
    parts = value.split('/')
    if any(part in ('.', '..') or not SEGMENT.fullmatch(part) or part.endswith('.') for part in parts):
        raise ValueError(f'Noncanonical depot path: {value!r}')
    # ArchiveWriter interprets a leading decimal filename as a literal hash.
    if re.match(r'^\d+\.', parts[0]):
        raise ValueError(f'Archive hash-override filename is not generated: {value!r}')
    if Path(value).suffix not in EXTENSIONS:
        raise ValueError(f'Unsupported generated resource extension: {value!r}')
    return value.replace('/', '\\')


def path_hash(value):
    """FNV-1a 64 of WolvenKit's already-canonical backslash path, UTF-8 bytes."""
    hashed = 14695981039346656037
    for byte in depot_path(value).encode('utf-8'):
        hashed = ((hashed ^ byte) * 1099511628211) & 0xffffffffffffffff
    return hashed


def expected_paths(plan):
    paths = [plan[key] for key in ('mesh', 'morph', 'app', 'customization')]
    for preset in plan['presets']:
        paths.extend(preset['textures'][channel] for channel in ('diffuse', 'roughness', 'metalness'))
    if len(paths) != len(set(paths)):
        raise ValueError('Collection plan contains duplicate depot paths.')
    for path in paths:
        depot_path(path)
    return set(paths)


def inventory(root, plan):
    """Return hashed generated files only if the physical tree equals the plan."""
    root = Path(root)
    expected = expected_paths(plan)
    actual = {}
    hashes = {}
    for path in root.rglob('*'):
        if path.is_symlink():
            raise ValueError(f'Generated archive tree contains a symlink: {path}')
        if not path.is_file():
            continue
        relative = path.relative_to(root).as_posix()
        depot_path(relative)
        hashed = path_hash(relative)
        if hashed in hashes:
            raise ValueError(f'Archive path hash collision: {hashes[hashed]!r} and {relative!r}')
        hashes[hashed] = relative
        actual[relative] = {'path': relative, 'bytes': path.stat().st_size,
                            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                            'depotPathHash64': str(hashed)}
    if set(actual) != expected:
        missing = sorted(expected - set(actual))
        extra = sorted(set(actual) - expected)
        raise ValueError(f'Generated archive resources differ from plan; missing={missing}, extra={extra}')
    return [actual[path] for path in sorted(actual)]
