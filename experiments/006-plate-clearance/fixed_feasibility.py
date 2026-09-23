"""Fixed pre-skin shell feasibility, never edits/imports a game resource.

The independent-vertex problem is a relaxation of any neighbor-smooth field.
An independently certified failure stops a full-field import before smoothing or
collision validation could disguise it. Generated matrices/positions stay ignored.
"""
import hashlib
import json
from pathlib import Path
import sys
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'generated/fixed_python'))
import numpy as np
import scipy
from scipy.optimize import minimize, linprog, nnls
sys.path.insert(0, str(HERE.parent / '004-plate-import'))
from verify_roundtrip import Glb
from constrained_offset import adjacency

MARGIN, BOUND = .00005, .00025
RADIUS = BOUND / MARGIN


def solve(a):
    """Solve in margin units; independently check primal and dual certificates."""
    fit = minimize(lambda q: .5 * q @ q, np.zeros(3), jac=lambda q: q,
                   constraints={'type': 'ineq', 'fun': lambda q: a @ q - 1,
                                'jac': lambda q: a}, method='SLSQP',
                   options={'ftol': 1e-11, 'maxiter': 150})
    q = fit.x
    slack = a @ q - 1
    primal = bool(slack.min() >= -1e-7)
    out = {'optimizerSuccess': bool(fit.success), 'primalSatisfied': primal,
           'minimumMarginRatio': float(slack.min()+1), 'normRatio': float(np.linalg.norm(q)),
           'dualLowerNormRatio': None, 'infeasibleCertificateResidual': None}
    if primal:
        active = np.flatnonzero(slack < 1e-5)
        lam, residual = nnls(a[active].T, q, maxiter=1000)
        dual = float(lam.sum() - .5 * np.linalg.norm(a[active].T @ lam)**2)
        lower = np.sqrt(max(0, 2*dual))
        out.update(dualLowerNormRatio=float(lower), kktResidual=float(residual),
                   minNormCertified=bool(np.linalg.norm(q)-lower < 1e-5),
                   normDualCertificate={'indices':active.tolist(),'weights':lam.tolist()})
        status = 'feasible' if np.linalg.norm(q) <= RADIUS + 1e-7 else 'over-budget-certified' if lower > RADIUS + 1e-7 else 'unresolved'
    else:
        # Farkas certificate: nonnegative lambda, sum=1 and A^T lambda=0
        # Exact cancellation would contradict every A q >= 1 at any magnitude;
        # numerical residuals below are used only for the explicit finite bound.
        cert = linprog(np.zeros(len(a)), A_eq=np.vstack([a.T, np.ones(len(a))]),
                       b_eq=[0,0,0,1], bounds=(0,None), method='highs')
        residual = np.linalg.norm(a.T @ cert.x) if cert.success else np.inf
        normalized = cert.success and abs(cert.x.sum()-1)<1e-8 and cert.x.min()>=-1e-10
        out['infeasibleCertificateResidual'] = float(residual) if np.isfinite(residual) else None
        # For our bounded problem, sum(lambda) > R * ||A^T lambda|| is
        # already a rigorous contradiction, even without exact cancellation.
        status = 'infeasible-certified' if normalized and RADIUS*residual < 1-1e-7 else 'unresolved'
        if normalized:
            keep=np.flatnonzero(cert.x>0)
            out['opposedDualCertificate']={'indices':keep.tolist(),'weights':cert.x[keep].tolist()}
    out['status'] = status
    if status != 'feasible':
        # Best uniform margin allowed by the radius, needed relaxation explicit.
        opt = minimize(lambda x:-x[3], np.zeros(4), jac=lambda x:np.array([0,0,0,-1.]),
            constraints=[{'type':'ineq','fun':lambda x:a @ x[:3]-x[3],
                          'jac':lambda x:np.column_stack([a,-np.ones(len(a))])},
                         {'type':'ineq','fun':lambda x:RADIUS**2-x[:3]@x[:3],
                          'jac':lambda x:np.r_[-2*x[:3],0]}],
            method='SLSQP',options={'ftol':1e-11,'maxiter':150})
        lower = min(float((a @ opt.x[:3]).min()), float(opt.x[3]))
        if np.linalg.norm(opt.x[:3]) > RADIUS + 1e-6: lower = 0.
        # SLSQP linear-constraint multipliers yield a simplex dual. Normalize
        # regardless of solver success; ANY simplex vector provides an upper bound.
        lam = np.maximum(opt.multipliers[:len(a)],0)
        if lam.sum() > 0:
            lam /= lam.sum()
            upper = float(RADIUS*np.linalg.norm(a.T @ lam))
        else: upper = float('inf')
        out.update(bestMarginRatioLower=max(0.,lower), bestMarginRatioUpper=upper if np.isfinite(upper) else None,
                   minimumMarginRelaxationLower=MARGIN*max(0.,1-upper),
                   minimumMarginRelaxationUpper=MARGIN*(1-max(0.,lower)),
                   relaxedActiveConstraintIndices=np.flatnonzero(lam > 1e-10).tolist(),
                   marginDualCertificate={'indices':np.flatnonzero(lam>0).tolist(),'weights':lam[lam>0].tolist()},
                   relaxedDisplacementRatio=opt.x[:3].tolist())
    return q, out


def self_test():
    cases=[(np.array([[0.,0,1]]),'feasible',1),
           (np.eye(3),'feasible',np.sqrt(3)),
           (np.array([[1.,0,0],[-1,0,0]]),'infeasible-certified',None),
           (np.array([[1.,0,.1],[-1,0,.1]]),'over-budget-certified',10)]
    for a,status,norm in cases:
        q,r=solve(a)
        assert r['status']==status,(status,r)
        if norm is not None: assert abs(np.linalg.norm(q)-norm)<1e-7
        if status=='over-budget-certified':
            assert abs(r['bestMarginRatioLower']-.5)<1e-6
            assert abs(r['bestMarginRatioUpper']-.5)<1e-6
    rot,_=np.linalg.qr(np.random.default_rng(73).normal(size=(3,3)))
    q,r=solve(np.eye(3)@rot)
    np.testing.assert_allclose(q,np.ones(3)@rot,atol=1e-7)
    q,r=solve(np.repeat(np.eye(3),20,axis=0))
    np.testing.assert_allclose(q,np.ones(3),atol=1e-7)


def main():
    self_test()
    root=Path(json.loads((HERE/'latest-build.json').read_text(encoding='utf-8'))['root'])
    build=json.loads((root/'build.json').read_text(encoding='utf-8'))
    meta=json.loads((root/'fixed_skin_manifest.json').read_text(encoding='utf-8'))
    mapping=np.array(json.loads(Path(build['mapping']).read_text(encoding='utf-8'))['plateToHeadIndices'])
    head=Glb(Path(build['head']))
    faces=head.array(head.p['indices']).astype(int).reshape(-1,3)
    incident=adjacency(faces,len(head.attr('POSITION')))
    frames=meta['frames']; nv=len(mapping)
    hp=np.fromfile(root/'posed/head.positions.f64',dtype='<f8').reshape(len(frames),-1,3)
    matrix=np.fromfile(root/'fixed_linear.f64',dtype='<f8').reshape(len(frames),nv,3,3)
    trans=np.fromfile(root/'fixed_translation.f64',dtype='<f8').reshape(len(frames),nv,3)
    rest=np.fromfile(root/'fixed_rest.f64',dtype='<f8').reshape(nv,3)
    reconstruction=float(np.max(np.linalg.norm(np.einsum('svij,vj->svi',matrix,rest)+trans-hp[:,mapping],axis=2)))
    assert reconstruction<1e-10
    t=hp[:,faces]; normals=np.cross(t[:,:,1]-t[:,:,0],t[:,:,2]-t[:,:,0]); lengths=np.linalg.norm(normals,axis=2)
    normals/=np.maximum(lengths,1e-30)[:,:,None]
    uv=head.attr('TEXCOORD_0')[mapping]
    rows=[]; displacement=np.full((nv,3),np.nan); counts={}
    for p,h in enumerate(mapping):
        ids=incident[h]
        assert np.all(lengths[:,ids]>1e-16),'Degenerate incident plane requires explicit policy'
        # Row normal N times displacement matrix M: N*M*d >= margin.
        pulled=np.einsum('ski,sij->skj',normals[:,ids],matrix[:,p]).reshape(-1,3)
        q,row=solve(pulled);displacement[p]=q*MARGIN
        row.update(plateVertex=p,headVertex=int(h),uv=uv[p].tolist(),incidentTriangles=ids)
        if row['status']!='feasible':
            row['activePlanes']=[{'frame':frames[i//len(ids)],'headTriangle':ids[i%len(ids)]} for i in row.pop('relaxedActiveConstraintIndices')]
            per_pose=[solve(pulled[s*len(ids):(s+1)*len(ids)])[1] for s in range(len(frames))]
            row['independentPoseStatus']={key:[frames[s] for s,r in enumerate(per_pose) if r['status']==key] for key in sorted(set(r['status'] for r in per_pose))}
            print(json.dumps({k:v for k,v in row.items() if k in ['plateVertex','headVertex','uv','status','normRatio','bestMarginRatioUpper','independentPoseStatus']}),flush=True)
        counts[row['status']]=counts.get(row['status'],0)+1;rows.append(row)
        if p%250==0:print(f'{p}/{nv} {counts}',flush=True)
    candidate=next(c for c in build['candidates'] if c['offset']==MARGIN)
    plate=Glb(Path(candidate['roundtrip']))
    candidate_rest=plate.attr('POSITION').astype(float)
    names=plate.doc['meshes'][0]['extras']['targetNames']
    for name in ['h091_eyes','h012_nose','h053_mouth','h054_jaw','h145_ear']:
        candidate_rest+=plate.array(plate.p['targets'][names.index(name)]['POSITION'])
    old_candidate=np.fromfile(root/f'posed/{candidate["name"]}.positions.f64',dtype='<f8').reshape(len(frames),nv,3)
    transported=hp[:,mapping]+np.einsum('svij,vj->svi',matrix,candidate_rest-rest)
    candidate_reconstruction=float(np.max(np.linalg.norm(transported-old_candidate,axis=2)))
    pf=plate.array(plate.p['indices']).astype(int).reshape(-1,3)
    edges=np.unique(np.sort(np.concatenate([pf[:,[0,1]],pf[:,[1,2]],pf[:,[2,0]]]),axis=1),axis=0)
    # Conservative diagnostic smoothness budget: <=50 micrometres AND no more
    # than one quarter of each original local edge length. Not an art approval.
    gap=np.linalg.norm(displacement[edges[:,0]]-displacement[edges[:,1]],axis=1)
    edge_bound=np.minimum(MARGIN,.25*np.linalg.norm(rest[edges[:,0]]-rest[edges[:,1]],axis=1))
    problem=[r for r in rows if r['status']!='feasible']
    inputs=[root/'fixed_skin_manifest.json',root/'fixed_linear.f64',root/'fixed_translation.f64',root/'fixed_rest.f64',root/'posed/head.positions.f64',Path(build['head']),Path(build['mapping']),Path(candidate['roundtrip']),root/f'posed/{candidate["name"]}.positions.f64']
    report={'build':str(root),'margin':MARGIN,'bound':BOUND,'frames':frames,'vertices':nv,'scipy':scipy.__version__,
        'numpy':np.__version__,'reconstructionError':reconstruction,'candidateTransportReconstructionError':candidate_reconstruction,'counts':counts,
        'feasibleFullField':not problem,'problemUVBounds':{'min':uv[[r['plateVertex'] for r in problem]].min(axis=0).tolist(),'max':uv[[r['plateVertex'] for r in problem]].max(axis=0).tolist()} if problem else None,
        'unconstrainedNeighborAudit':{'edges':len(edges),'overBound':int((gap>edge_bound+1e-10).sum()),'maxGap':float(gap.max()),'budget':'min(0.00005, quarter original edge length)','coupledSolveSkipped':bool(problem),'reason':'Independent-vertex infeasibility already rules out every coupled-smooth solution; failed vertices never clamped or dropped.'},
        'inputs':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in inputs],
        'verticesReport':rows,'limits':['Sampled saved-V shape only; no morph-general or continuous-motion proof.','Independent positive incident-plane clearance cannot prove absence of non-adjacent contacts.','Failure of the all-incident-plane construction does not rule out every different collision-free shell or decal technique.','No feasible full field means no contact/visibility/import stage is warranted by this experiment.','Optimizer status alone is not proof; primal checks and dual bounds/certificates classify outcomes.']}
    displacement.astype('<f8').tofile(root/'fixed_displacement_diagnostic.f64')
    (root/'fixed_feasibility.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k not in ['verticesReport','inputs','frames']}),flush=True)


if __name__=='__main__':main()
