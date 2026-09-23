"""Summarize preserved shading-normal controls and latest geometric-normal trials."""
import hashlib
import argparse
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--archive-only',action='store_true')
    args=parser.parse_args()
    latest=Path(json.loads((HERE/'latest-build.json').read_text())['root'])
    # Preserve every completed study under its own immutable build directory.
    for name in ['static-clearance.json','posed-clearance.json','contact-analysis.json']:
        report=json.loads((HERE/name).read_text())
        assert Path(report['build'])==latest, f'Stale evidence: {name}'
        (latest/name).write_text(json.dumps(report,indent=2)+'\n')
    if args.archive_only:
        print(f'Preserved evidence in {latest}')
        return
    rows=[]
    for build_file in sorted((HERE/'generated').glob('build-*/build.json')):
        root=build_file.parent
        if not all((root/name).exists() for name in ['static-clearance.json','posed-clearance.json']):continue
        build=json.loads(build_file.read_text())
        static=json.loads((root/'static-clearance.json').read_text())
        posed=json.loads((root/'posed-clearance.json').read_text())
        for c in build['candidates']:
            s=next(r for r in static['candidates'] if r['name']==c['name'])
            p=next(r for r in posed['results'] if r['name']==c['name'])
            rows.append({'method':build.get('method','shading'),'offset':c['offset'],'build':str(root),
                'roundtripSha256':s['roundtripSha256'],'staticCases':static['casesPerCandidate'],
                'worstStaticShadingPlaneDistance':s['worstSignedDistance'],
                'posedSamples':len(p['samples']),'worstPosedShadingPlaneDistance':p['worstSignedDistance'],
                'maxContactPairs':p['maxContactPairs'],'posesWithContact':p['posesWithContact'],
                'contactingTrianglesFrame0':p['samples'][0]['plateTrianglesInContact'],
                'morphMaxError':s['morphMaxError'],
                'evidenceHashes':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ['static-clearance.json','posed-clearance.json']}})
    assert len(rows)>=4, 'Both offset methods must have preserved evidence'
    report={'candidates':rows,'releaseCandidateSelected':False,
        'conclusion':'Both methods clear most of the expanded plate. Neither is contact-free in the sampled eyelid motion. Geometry normals reduce the open-eye crease contacts but can oppose lighting normals in some individual eye morphs. A blanket larger offset is not a validated repair.',
        'next':['Classify render-visible versus occluded crease/corner contacts across sampled poses.',
            'Investigate a local constrained correction or safe boundary treatment while preserving makeup coverage.',
            'Keep game depth/blending validation separate and batch it with material/selector tests.']}
    (HERE/'comparison.json').write_text(json.dumps(report,indent=2)+'\n')
    pointer={'root':str(latest),'validated':False,'checksCompleted':['resource-roundtrip','static-vertex-planes','sampled-idle','triangle-contact-analysis'],
        'clearanceAccepted':False,'reason':'Residual eyelid triangle contacts; no release offset selected'}
    (HERE/'latest-build.json').write_text(json.dumps(pointer,indent=2)+'\n')
    print(json.dumps({'candidates':len(rows),'releaseCandidateSelected':False},indent=2))

if __name__=='__main__':main()
