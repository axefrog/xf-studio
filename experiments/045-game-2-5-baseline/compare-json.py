"""Structural JSON differences, abbreviating long buffer strings with hashes."""
import hashlib
import json
from pathlib import Path
import sys


def brief(value):
    """Sanitize whole subtrees, including added/removed/type-changed objects."""
    if isinstance(value, dict):
        return {key: payload(item) if key.lower() in ('bytes', 'buffer', 'rawdata', 'pixels')
                and not is_summary(item) else brief(item)
                for key, item in value.items()}
    if isinstance(value, list):
        if value and all(type(item) in (int, float) for item in value):
            return payload(value)
        return [brief(item) for item in value]
    if isinstance(value, str) and len(value) > 160:
        return payload(value)
    return value


def is_summary(value):
    return (isinstance(value, dict) and set(value) == {'payloadLength', 'sha256'}
            and type(value['payloadLength']) is int and value['payloadLength'] >= 0
            and isinstance(value['sha256'], str) and len(value['sha256']) == 64
            and all(c in '0123456789abcdef' for c in value['sha256']))


def payload(value):
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
    return {'payloadLength': len(value) if isinstance(value, (str, list, dict)) else 1,
            'sha256': hashlib.sha256(encoded).hexdigest()}


def validate_differences(items):
    if not isinstance(items, list):
        raise ValueError('differences must be a list')
    for item in items:
        if not isinstance(item, dict) or set(item) not in ({'path', 'left', 'right'}, {'path', 'leftLength', 'rightLength'}):
            raise ValueError('invalid difference record')
        if not isinstance(item['path'], str):
            raise ValueError('invalid difference path')
        if 'leftLength' in item and any(type(item[k]) is not int or item[k] < 0 for k in ('leftLength', 'rightLength')):
            raise ValueError('invalid difference length')
        if any(brief(item[key]) != item[key] for key in ('left', 'right') if key in item):
            raise ValueError('unsanitized difference')
    return items


def differences(left, right, path='$'):
    return validate_differences(_differences(brief(left), brief(right), path))


def _differences(left, right, path):
    if type(left) is not type(right):
        return [{'path': path, 'left': brief(left), 'right': brief(right)}]
    if isinstance(left, dict):
        result = []
        for key in sorted(left.keys() | right.keys()):
            if key not in left or key not in right:
                result.append({'path': path + '.' + key, 'left': brief(left.get(key, '<missing>')),
                               'right': brief(right.get(key, '<missing>'))})
            else:
                result.extend(_differences(left[key], right[key], path + '.' + key))
        return result
    if isinstance(left, list):
        if len(left) != len(right):
            return [{'path': path, 'leftLength': len(left), 'rightLength': len(right)}]
        return [item for index, (a, b) in enumerate(zip(left, right)) for item in _differences(a, b, f'{path}[{index}]')]
    return [] if left == right else [{'path': path, 'left': brief(left), 'right': brief(right)}]


def compare_folders(left, right):
    files = {p.relative_to(left) for p in left.rglob('*.json')} | {p.relative_to(right) for p in right.rglob('*.json')}
    result = {}
    for file in sorted(files):
        if not (left / file).exists() or not (right / file).exists():
            result[file.as_posix()] = ['missing file']
            continue
        a, b = [json.loads((root / file).read_text(encoding='utf-8-sig')) for root in (left, right)]
        changes = differences(a.get('Data', a), b.get('Data', b))
        if changes:
            result[file.as_posix()] = changes
    for file, changes in result.items():
        if not isinstance(file, str):
            raise ValueError('invalid comparison file')
        if changes != ['missing file']:
            validate_differences(changes)
    return result


if __name__ == '__main__':
    print(json.dumps(compare_folders(Path(sys.argv[1]), Path(sys.argv[2])), indent=2))
