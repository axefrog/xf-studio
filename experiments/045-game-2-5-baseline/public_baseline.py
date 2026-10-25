"""Fail-closed public evidence schema: identities and section counts/hashes only.

Exact manifests, resource differences and per-element data belong in generated/.
Hashes use canonical UTF-8 JSON (sorted keys, compact separators, no ASCII escaping).
"""
import hashlib
import json
import re

IDENTITIES = frozenset(('fixtureSha256', 'gameExecutableSha256', 'oodleSha256', 'bcnSha256'))
FLAGS = frozenset(('roundtripEqual', 'roundtripUnpackedEqual'))
SECTIONS = frozenset('''tools steps historicalPlateInputs wk9Members wk9Unpacked wk10Members
wk10Unpacked roundtripChanges roundtripJsonChanges storedBinaryChanges preparedManifests
preparedFiles plateManifests provenance buildManifests buildMembers failures writerOracleInputs
nativeWriterFiles writerCompression writerSemanticComparison writerResources environment
earlierEmptyCacheTrialSeconds validation captureReport captures writerOodle'''.split())


def summary(value):
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    return {'count': len(value) if isinstance(value, (dict, list, str)) else 1,
            'jsonBytes': len(encoded), 'sha256': hashlib.sha256(encoded).hexdigest()}


def validate_public(value):
    if not isinstance(value, dict) or value.get('schema') != 2:
        raise ValueError('public baseline must use schema 2')
    if set(value) - ({'schema', 'sections'} | IDENTITIES | FLAGS):
        raise ValueError('unexpected public field')
    for key in IDENTITIES & value.keys():
        if not isinstance(value[key], str) or not re.fullmatch('[0-9a-f]{64}', value[key]):
            raise ValueError('invalid identity hash')
    for key in FLAGS & value.keys():
        if type(value[key]) is not bool:
            raise ValueError('invalid equality flag')
    sections = value.get('sections')
    if not isinstance(sections, dict) or set(sections) - SECTIONS:
        raise ValueError('unexpected public section')
    for item in sections.values():
        if not isinstance(item, dict) or set(item) != {'count', 'jsonBytes', 'sha256'}:
            raise ValueError('section must contain counts and a hash only')
        if any(type(item[k]) is not int or item[k] < 0 for k in ('count', 'jsonBytes')):
            raise ValueError('invalid summary count')
        if not isinstance(item['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', item['sha256']):
            raise ValueError('invalid section hash')
    return value


def public_baseline(evidence):
    unknown = set(evidence) - ({'schema'} | IDENTITIES | FLAGS | SECTIONS)
    if unknown:
        raise ValueError('unreviewed evidence sections: ' + ', '.join(sorted(unknown)))
    result = {'schema': 2, **{k: evidence[k] for k in sorted((IDENTITIES | FLAGS) & evidence.keys())},
              'sections': {k: summary(evidence[k]) for k in sorted(SECTIONS & evidence.keys())}}
    return validate_public(result)


def baseline_target(path, folder):
    target, folder = path.resolve(), folder.resolve()
    if not target.is_relative_to(folder) or target == folder or target.suffix != '.json':
        raise ValueError('saved baseline must be a new JSON file inside this experiment')
    return target


def save_baseline(path, evidence, folder):
    target = baseline_target(path, folder)
    public = public_baseline(evidence)
    # Exclusive creation also refuses symlink destinations and races with another writer.
    with target.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(public, indent=2) + '\n')


if __name__ == '__main__':
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('private_evidence', type=Path)
    parser.add_argument('new_baseline', type=Path)
    args = parser.parse_args()
    save_baseline(args.new_baseline, json.loads(args.private_evidence.read_text(encoding='utf-8-sig')),
                  Path(__file__).resolve().parent)
