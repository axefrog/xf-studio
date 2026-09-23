"""Measure post-conversion offset clearance; no renderer/game claims."""
import hashlib
import json
from pathlib import Path
import sys
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent/'004-plate-import'))
from verify_roundtrip import Glb, delta
from verify_binding_clearance import transforms

def measure(plate, head, mapping):
    names = head.mesh['extras']['targetNames']
    assert names == plate.mesh['extras']['targetNames']
    cases = [('Basis', [])] + [(n, [i]) for i, n in enumerate(names)]
    cases += [('saved_v', [names.index(n) for n in ['h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear']])]
    report = []
    for name, indices in cases:
        pp = plate.attr('POSITION').copy()
        hp = head.attr('POSITION')[mapping].copy()
        hn = head.attr('NORMAL')[mapping].copy()
        for i in indices:
            pp += plate.array(plate.p['targets'][i]['POSITION'])
            hp += head.array(head.p['targets'][i]['POSITION'])[mapping]
            hn += head.array(head.p['targets'][i]['NORMAL'])[mapping]
        hn /= np.linalg.norm(hn, axis=1)[:, None]
        displacement = pp-hp
        signed = np.sum(displacement*hn, axis=1)
        tangent = displacement - signed[:, None]*hn
        report.append({'case': name, 'minSignedDistance': float(signed.min()), 'maxSignedDistance': float(signed.max()),
            'maxTangentialDisplacement': float(np.linalg.norm(tangent, axis=1).max()),
            'verticesBehindHeadPlane': int((signed < -1e-7).sum())})
    return report

def main():
    root = Path(json.loads((HERE/'latest-build.json').read_text())['root'])
    build = json.loads((root/'build.json').read_text())
    head = Glb(Path(build['head']))
    mapping = json.loads(Path(build['mapping']).read_text())['plateToHeadIndices']
    control = measure(Glb(Path(build['zeroControl'])), head, mapping)
    reports = []
    for candidate in build['candidates']:
        source, output = Glb(Path(candidate['source'])), Glb(Path(candidate['roundtrip']))
        assert source.mesh['extras']['targetNames'] == output.mesh['extras']['targetNames']
        assert np.array_equal(source.array(source.p['indices']), output.array(output.p['indices']))
        attrs = {k: delta(source.attr(k), output.attr(k)) for k in ['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0']}
        morph = {k: max(delta(source.array(a[k]), output.array(b[k]))['max'] for a,b in zip(source.p['targets'],output.p['targets']))
            for k in ['POSITION', 'NORMAL', 'TANGENT']}
        assert attrs['POSITION']['max'] < 5e-6 and max(attrs[k]['max'] for k in ['NORMAL','TANGENT']) < .002
        assert max(attrs[k]['max'] for k in ['TEXCOORD_0','TEXCOORD_1']) == 0
        assert morph['POSITION'] < 2e-5
        # New offset-only morph records encode formerly absent zero lighting deltas.
        # The shifted 10-bit representation cannot represent exact zero: +/-1/1023.
        # Permit only that observed case; all original nonzero shading stays exact.
        zero_shading_records = 0
        for a,b in zip(source.p['targets'],output.p['targets']):
            for key in ['NORMAL','TANGENT']:
                original,converted=source.array(a[key]),output.array(b[key])
                changed=(original!=converted).any(axis=1)
                assert (original[changed]==0).all(), 'Original nonzero shading changed'
                assert np.max(abs(converted[changed]),initial=0) <= 1/1023+1e-7
                zero_shading_records += int(changed.sum())
        bones = sorted(set(source.bones())|set(output.bones()))
        sw, ow = source.weights(bones), output.weights(bones)
        assert np.array_equal(sw.max(axis=0)>0, ow.max(axis=0)>0)
        assert abs(sw-ow).max() < .005 and (ow>0).sum(axis=1).max() == 8
        shared_bones = sorted(set(head.bones()) | set(output.bones()))
        head_weights = head.weights(shared_bones)[mapping]
        plate_weights = output.weights(shared_bones)
        head_weight_error = float(abs(head_weights-plate_weights).max())
        if build.get('preserveHeadWeights'):
            assert candidate['weightTransfer']['binaryRoundtripSkinBufferExact']
            assert candidate['weightTransfer']['morphBaseBuffer']['binaryRoundtripSkinBufferExact']
            assert head_weight_error < 2e-7, 'Retained skin weights differ from original head'
        sj, si = transforms(source); oj, oi = transforms(output)
        reorder = [output.bones().index(n) for n in source.bones()]
        bind_error = float(max(abs(sj-oj[reorder]).max(), abs(si-oi[reorder]).max()))
        assert bind_error < 1e-6
        clearance = measure(output, head, mapping)
        reports.append({'name': candidate['name'], 'offset': candidate['offset'], 'attributes': attrs,
            'morphMaxError': morph, 'bindMaxError': bind_error, 'weightMaxError': float(abs(sw-ow).max()),
            'headWeightMaxError': head_weight_error,
            'newlyQuantizedZeroShadingRecords':zero_shading_records,
            'clearance': clearance, 'worstSignedDistance': min(x['minSignedDistance'] for x in clearance),
            'roundtripSha256': hashlib.sha256(output.path.read_bytes()).hexdigest()})
    report = {'build': str(root), 'zeroControlWorstSignedDistance': min(x['minSignedDistance'] for x in control),
        'casesPerCandidate': len(control), 'candidates': reports,
        'limitations': ['Corresponding tangent planes only; triangle contacts and animated poses checked separately.',
            'All single morphs and one saved combination do not cover every possible morph combination.',
            'Original shading retained; offset curvature is a geometric approximation, not a game render proof.']}
    (HERE/'static-clearance.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'zero': report['zeroControlWorstSignedDistance'], 'cases': len(control),
        'candidates': [{k:c[k] for k in ['name','worstSignedDistance','morphMaxError','weightMaxError']} for c in reports]},indent=2))

if __name__ == '__main__': main()
