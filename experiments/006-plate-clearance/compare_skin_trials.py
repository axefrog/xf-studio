"""Compare paired geometry trials, isolating native skin-byte retention."""
import hashlib
import json
from pathlib import Path
import sys
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / '004-plate-import'))
from verify_roundtrip import Glb
from verify_binding_clearance import transforms


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    root = Path(load(HERE / 'latest-build.json')['root'])
    build = load(root / 'build.json')
    assert build['preserveHeadWeights']
    previous = []
    for path in sorted((HERE / 'generated').glob('build-*/build.json')):
        other = load(path)
        if other.get('method') == build['method'] and not other.get('preserveHeadWeights') and (path.parent / 'posed-clearance.json').exists():
            previous.append((path.parent, other))
    assert previous
    prior, baseline = previous[-1]
    old_report, new_report = load(prior / 'posed-clearance.json'), load(HERE / 'posed-clearance.json')
    assert Path(new_report['build']) == root
    assert old_report['sampling']['frames'] == new_report['sampling']['frames']
    assert old_report['sampling']['animationHashes'] == new_report['sampling']['animationHashes']
    old_head = np.fromfile(prior / 'posed/head.positions.f64', dtype='<f8')
    new_head = np.fromfile(root / 'posed/head.positions.f64', dtype='<f8')
    assert np.array_equal(old_head, new_head), 'Head poses changed; cannot isolate plate skin weights'
    rows = []
    for candidate in build['candidates']:
        before = next(c for c in baseline['candidates'] if c['offset'] == candidate['offset'])
        a, b = Glb(Path(before['roundtrip'])), Glb(Path(candidate['roundtrip']))
        assert a.bones() == b.bones()
        for old_bind, new_bind in zip(transforms(a), transforms(b)):
            assert np.array_equal(old_bind, new_bind), 'Bone/bind transforms changed'
        assert np.array_equal(a.array(a.p['indices']), b.array(b.p['indices']))
        for name in a.p['attributes']:
            if not name.startswith(('JOINTS_', 'WEIGHTS_')):
                assert np.array_equal(a.attr(name), b.attr(name)), name
        assert a.mesh['extras']['targetNames'] == b.mesh['extras']['targetNames']
        for x, y in zip(a.p['targets'], b.p['targets']):
            for name in x:
                assert np.array_equal(a.array(x[name]), b.array(y[name])), name
        old = np.fromfile(prior / f'posed/{before["name"]}.positions.f64', dtype='<f8').reshape(-1, 3)
        new = np.fromfile(root / f'posed/{candidate["name"]}.positions.f64', dtype='<f8').reshape(-1, 3)
        distance = np.linalg.norm(old - new, axis=1)
        op = next(r for r in old_report['results'] if r['name'] == before['name'])
        np_ = next(r for r in new_report['results'] if r['name'] == candidate['name'])
        rows.append({'candidate': candidate['name'], 'offset': candidate['offset'],
            'nonSkinAttributesAndAllMorphsIdentical': True,
            'boneNamesAndBindTransformsIdentical': True,
            'maxPosedDisplacementDueToWeightChange': float(distance.max()),
            'p99PosedDisplacementDueToWeightChange': float(np.percentile(distance, 99)),
            'oldMaxContactPairs': op['maxContactPairs'], 'newMaxContactPairs': np_['maxContactPairs'],
            'oldFrame0Contacts': op['samples'][0]['contactPairs'], 'newFrame0Contacts': np_['samples'][0]['contactPairs'],
            'oldTotalSampleContactPairs': sum(x['contactPairs'] for x in op['samples']),
            'newTotalSampleContactPairs': sum(x['contactPairs'] for x in np_['samples']),
            'samplesImproved': sum(n['contactPairs'] < o['contactPairs'] for o, n in zip(op['samples'], np_['samples'])),
            'samplesWorsened': sum(n['contactPairs'] > o['contactPairs'] for o, n in zip(op['samples'], np_['samples'])),
            'samplesEqual': sum(n['contactPairs'] == o['contactPairs'] for o, n in zip(op['samples'], np_['samples']))})
    report = {'baseline': str(prior), 'retained': str(root), 'samples': len(new_report['sampling']['frames']),
        'headPosesExactlyEqual': True, 'results': rows,
        'inputs': [{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in [prior / 'build.json', root / 'build.json', prior / 'posed-clearance.json', HERE / 'posed-clearance.json']],
        'limitations': ['Isolates the skin-byte change on the current decoded idle and saved morph combination, not every game animation.',
                       'Residual intersections and static geometry issues remain separate; no release geometry is approved.']}
    (HERE / 'skin-comparison.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
