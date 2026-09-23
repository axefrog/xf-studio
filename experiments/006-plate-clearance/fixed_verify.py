"""Recheck fixed-shell feasibility evidence without importing an optimizer."""
import hashlib
import json
from pathlib import Path
import sys
import numpy as np
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent/'004-plate-import'))
from verify_roundtrip import Glb

root=Path(json.loads((HERE/'latest-build.json').read_text(encoding='utf-8'))['root'])
report=json.loads((root/'fixed_feasibility.json').read_text(encoding='utf-8'))
for source in report['inputs']:
    assert hashlib.sha256(Path(source['path']).read_bytes()).hexdigest()==source['sha256']
build=json.loads((root/'build.json').read_text(encoding='utf-8'))
mapping=np.array(json.loads(Path(build['mapping']).read_text(encoding='utf-8'))['plateToHeadIndices'])
head=Glb(Path(build['head']))
faces=head.array(head.p['indices']).astype(int).reshape(-1,3)
hp=np.fromfile(root/'posed/head.positions.f64',dtype='<f8').reshape(len(report['frames']),-1,3)
matrix=np.fromfile(root/'fixed_linear.f64',dtype='<f8').reshape(len(report['frames']),len(mapping),3,3)
delta=np.fromfile(root/'fixed_displacement_diagnostic.f64',dtype='<f8').reshape(-1,3)
margin=report['margin']; radius=report['bound']/margin
counts={}; max_gap=0.; certificate_counts={}
for row in report['verticesReport']:
    p=row['plateVertex'];h=row['headVertex']; assert mapping[p]==h
    ids=np.flatnonzero((faces==h).any(axis=1))
    assert ids.tolist()==row['incidentTriangles']
    tri=hp[:,faces[ids]]
    normals=np.cross(tri[:,:,1]-tri[:,:,0],tri[:,:,2]-tri[:,:,0])
    normals/=np.linalg.norm(normals,axis=2)[:,:,None]
    # Explicit per-frame multiplication instead of solver's einsum construction.
    a=np.vstack([normals[s] @ matrix[s,p] for s in range(len(hp))])
    status=row['status'];counts[status]=counts.get(status,0)+1
    if status=='feasible':
        q=delta[p]/margin
        assert np.linalg.norm(q)<=radius+1e-7
        assert np.min(a@q)>=1-1e-7
    elif status=='over-budget-certified':
        cert=row['normDualCertificate'];lam=np.array(cert['weights']);assert lam.min()>=0
        combined=a[cert['indices']].T@lam
        dual=lam.sum()-.5*combined@combined
        assert dual>radius**2/2+1e-7
        certificate_counts['norm-lower-bound']=certificate_counts.get('norm-lower-bound',0)+1
    elif status=='infeasible-certified':
        cert=row['opposedDualCertificate'];lam=np.array(cert['weights']);assert lam.min()>=0
        assert lam.sum()>radius*np.linalg.norm(a[cert['indices']].T@lam)+1e-7
        certificate_counts['bounded-opposition']=certificate_counts.get('bounded-opposition',0)+1
    else:raise AssertionError('Unresolved case requires explicit report')
    if status!='feasible':
        cert=row['marginDualCertificate'];lam=np.array(cert['weights']);assert lam.min()>=0
        assert abs(lam.sum()-1)<1e-8
        upper=radius*np.linalg.norm(a[cert['indices']].T@lam)
        q=np.array(row['relaxedDisplacementRatio'])
        assert np.linalg.norm(q)<=radius+1e-6
        lower=max(0,float(np.min(a@q)))
        assert lower<=upper+1e-7
        assert abs(upper-row['bestMarginRatioUpper'])<1e-8
        max_gap=max(max_gap,upper-lower)
assert counts==report['counts']
result={'passed':True,'optimizerImported':False,'verifiedStatuses':counts,'verifiedCertificates':certificate_counts,
        'maxMarginRatioDualityGap':max_gap,'reportSha256':hashlib.sha256((root/'fixed_feasibility.json').read_bytes()).hexdigest(),
        'limits':['Floating-point checks with explicit numerical tolerances, not symbolic exact arithmetic.','Verifies the relaxed incident-plane model only; no head-contact or game-render proof.']}
(root/'fixed_verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
summary={k:v for k,v in report.items() if k!='verticesReport'}
summary['verification']=result
summary['problemVertices']=[{k:v for k,v in row.items() if k in ['plateVertex','headVertex','uv','status','normRatio','dualLowerNormRatio','bestMarginRatioLower','bestMarginRatioUpper','minimumMarginRelaxationLower','minimumMarginRelaxationUpper','activePlanes','independentPoseStatus']} for row in report['verticesReport'] if row['status']!='feasible']
(HERE/'fixed_summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
