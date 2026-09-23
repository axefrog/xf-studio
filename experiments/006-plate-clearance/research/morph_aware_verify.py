"""Independent reconstruction of the two numeric morph-aware plate reports.

This does not import the candidate constructor or its optimizer. It checks the
stored deltas against original GLBs and recomputes finite contacts directly.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

HERE=Path(__file__).resolve().parent
EXP=HERE.parent
WORKSPACE=EXP.parent.parent
sys.path.insert(0,str(EXP.parent/'004-plate-import'))
sys.path.insert(0,str(EXP))
from verify_roundtrip import Glb
from triangles import contacts,intersect_pairs,self_test


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def resolve(path):
    path=Path(path)
    return path if path.is_absolute() else WORKSPACE/path


def new_contact_count(plate_triangles,head_triangles,source_faces,head_faces):
    pairs=np.asarray(contacts(plate_triangles,head_triangles)['pairs'],dtype=int).reshape(-1,2)
    if not len(pairs):return 0
    mapped=head_faces[source_faces[pairs[:,0]]]
    native=head_faces[pairs[:,1]]
    nonadj=~(mapped[:,:,None]==native[:,None,:]).any(axis=(1,2))
    pairs=pairs[nonadj]
    if not len(pairs):return 0
    originally=intersect_pairs(head_triangles[source_faces[pairs[:,0]]],head_triangles[pairs[:,1]])
    return int((~originally).sum())


def verify(path):
    report=json.loads(path.read_text())
    assert digest(resolve(report['numericCandidate']))==report['numericCandidateSha256']
    for item in report['inputs']:
        assert digest(resolve(item['path']))==item['sha256'],item['path']
    data=np.load(resolve(report['numericCandidate']))
    root=Path(report['sourceBuild'])
    build=json.loads((root/'build.json').read_text())
    source=next(c for c in build['candidates'] if c['name']==report['sourceCandidate'])
    assert source['weightTransfer']['binaryRoundtripSkinBufferExact']
    assert source['weightTransfer']['morphBaseBuffer']['binaryRoundtripSkinBufferExact']
    head,plate=Glb(Path(build['head'])),Glb(Path(source['roundtrip']))
    mapping=np.array(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'])
    assert np.array_equal(data['mapping'],mapping)
    hf=head.array(head.p['indices']).astype(int).reshape(-1,3)
    pf=plate.array(plate.p['indices']).astype(int).reshape(-1,3)
    lookup={tuple(sorted(t)):i for i,t in enumerate(hf)}
    source_faces=np.array([lookup[tuple(sorted(t))] for t in mapping[pf]])
    edges=np.unique(np.sort(np.concatenate([pf[:,[0,1]],pf[:,[1,2]],pf[:,[2,0]]]),axis=1),axis=0)
    names=head.mesh['extras']['targetNames']
    assert names==plate.mesh['extras']['targetNames'] and len(names)==105
    head_base=head.attr('POSITION').astype(float)
    plate_base=plate.attr('POSITION').astype(float)
    head_targets=np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    plate_targets=np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']])
    base_change=data['baseChange']
    morph_change=data['morphChange']
    field=data['field']
    assert base_change.shape==(len(mapping),3) and morph_change.shape==(105,len(mapping),3)
    np.testing.assert_allclose(plate_base+base_change,head_base[mapping]+field,atol=1e-14,rtol=0)
    changed=[names[i] for i in range(105) if np.linalg.norm(morph_change[i],axis=1).max()>1e-12]
    assert set(changed)==set(report['field']['correctedMorphNames'])
    for name in changed:
        i=names.index(name)
        assert name.endswith('_eyes')
        np.testing.assert_allclose(plate_targets[i]+morph_change[i],head_targets[i,mapping],atol=1e-14,rtol=0)
    saved=[names.index(n) for n in ['h091_eyes','h012_nose','h053_mouth','h054_jaw','h145_ear']]
    cases=[('Basis',[])]+[(n,[i]) for i,n in enumerate(names)]+[('saved_v',saved)]
    actual=[]
    for name,ids in cases:
        h=head_base+head_targets[ids].sum(axis=0) if ids else head_base
        p=plate_base+base_change+(plate_targets[ids]+morph_change[ids]).sum(axis=0) if ids else plate_base+base_change
        d=p-h[mapping]
        limits=np.minimum(.00005,.25*np.linalg.norm(h[mapping[edges[:,0]]]-h[mapping[edges[:,1]]],axis=1))
        gaps=np.linalg.norm(d[edges[:,0]]-d[edges[:,1]],axis=1)
        row=next(r for r in report['staticCases'] if r['case']==name)
        assert int((gaps>limits+1e-10).sum())==row['overNeighborLimit'],name
        assert int((np.linalg.norm(d,axis=1)>.00025+1e-10).sum())==row['overDisplacement'],name
        count=new_contact_count(p[pf],h[hf],source_faces,hf)
        assert count==row['newNonadjacent'],(name,count,row['newNonadjacent'])
        actual.append(count)
    frames=json.loads((root/'posed/manifest.json').read_text())['frames']
    hp=np.fromfile(root/'posed/head.positions.f64',dtype='<f8').reshape(len(frames),-1,3)
    matrices=np.fromfile(root/'fixed_linear.f64',dtype='<f8').reshape(len(frames),len(mapping),3,3)
    source_residual=(plate_targets[saved]+morph_change[saved]-head_targets[saved][:,mapping]).sum(axis=0)
    posed=[]
    for index,frame in enumerate(frames):
        p=hp[index,mapping]+np.einsum('vij,vj->vi',matrices[index],field+source_residual)
        count=new_contact_count(p[pf],hp[index,hf],source_faces,hf)
        row=report['poseCases'][index]
        assert frame==row['frame'] and count==row['newNonadjacent'],(frame,count,row['newNonadjacent'])
        posed.append(count)
    assert len(actual)==107 and len(posed)==73
    return {'report':path.name,'verified':True,'changedEyeMorphs':len(changed),
            'staticNewContacts':sum(actual),'poseNewContacts':sum(posed),
            'staticNeighborViolations':sum(r['overNeighborLimit'] for r in report['staticCases'])}


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--rescue',action='store_true')
    args=parser.parse_args()
    self_test()
    path=HERE/('morph_aware_rescue_summary.json' if args.rescue else 'morph_aware_summary.json')
    print(json.dumps(verify(path)))
