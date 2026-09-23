"""Construct and audit one bounded finite-surface-informed correction, without import.

This is a counterfactual field on the retained head-cut plate. The field is
applied to the GLB base position only; all 105 morph deltas and skin data remain
unchanged in the source resources. It is never written as a game asset.
"""
import hashlib
import heapq
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
sys.path.insert(0,str(EXP.parent/'004-plate-import'))
sys.path.insert(0,str(EXP))
from verify_roundtrip import Glb
from triangles import contacts, intersect_pairs, self_test as triangle_self_test

BOUND = .00025
NEIGHBOR_CAP = .00005
SEEDS = {266:25, 275:25, 277:25, 805:590, 5981:490}
AMP = {266:.0001, 275:.00007, 277:.00007, 805:.00007, 5981:.00002}
MORPHS = ['h091_eyes','h012_nose','h053_mouth','h054_jaw','h145_ear']


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def edges_of(faces):
    return np.unique(np.sort(np.concatenate([faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]]]),axis=1),axis=0)


def graph_distances(seed, adjacency, radius):
    distance = {seed:0.}
    queue = [(0.,seed)]
    while queue:
        current, vertex = heapq.heappop(queue)
        if current != distance[vertex]:
            continue
        for other, length in adjacency[vertex]:
            next_distance = current+length
            if next_distance < radius and next_distance < distance.get(other,float('inf')):
                distance[other] = next_distance
                heapq.heappush(queue,(next_distance,other))
    return distance


def construct(base_delta, head_rest, faces, mapping, head_poses, head_faces, matrices, frames, nearest):
    plate_faces = faces
    edges = edges_of(plate_faces)
    lengths = np.linalg.norm(head_rest[edges[:,0]]-head_rest[edges[:,1]],axis=1)
    limits = np.minimum(NEIGHBOR_CAP,.25*lengths)
    adjacency = [[] for _ in range(len(mapping))]
    for (a,b),length in zip(edges,lengths):
        adjacency[a].append((b,float(length)))
        adjacency[b].append((a,float(length)))
    target = base_delta.copy()
    seed_rows = []
    for vertex,frame in SEEDS.items():
        p = int(np.flatnonzero(mapping==vertex)[0])
        s = frames.index(frame)
        row = next(r for r in nearest['queries'] if r['frame']==frame and r['headVertex']==vertex
                   and r['candidate']=='geometry-0.00005000')
        # At 805, use its exposed active face because the globally nearest face is sampled hidden.
        if row['nearestHead']['faceExposure']=='exposed':
            face = row['nearestHead']['headTriangle']
        else:
            face = next(d['headTriangle'] for d in row['activeCertificateFaces'] if d['faceExposure']=='exposed')
        tri = head_poses[s,head_faces[face]]
        outward = np.cross(tri[1]-tri[0],tri[2]-tri[0])
        outward /= np.linalg.norm(outward)
        pullback = np.linalg.solve(matrices[s,p],outward)
        pullback /= np.linalg.norm(pullback)
        distances = graph_distances(p,adjacency,.0045)
        for q,length in distances.items():
            target[q] += AMP[vertex]*np.exp(-.5*(length/.0015)**2)*pullback
        seed_rows.append({'headVertex':vertex,'frame':frame,'sourceHeadFace':face,
                          'headFaceExposure':row['nearestHead']['faceExposure'],
                          'amplitude':AMP[vertex],'affectedVertices':len(distances)})
    # Norm projection and graph-regularized least squares. The matrix is an
    # M-matrix, so each result is a convex average of bounded target vectors.
    norms = np.linalg.norm(target,axis=1)
    target *= np.minimum(1,BOUND/np.maximum(norms,1e-30))[:,None]
    # The saved experiment installed SciPy beside the retained ignored build.
    retained = Path(json.loads((EXP/'fixed_summary.json').read_text(encoding='utf-8'))['build'])
    sys.path.insert(0,str(retained.parent/'fixed_python'))
    from scipy.sparse import coo_matrix, eye, diags
    from scipy.sparse.linalg import spsolve
    n = len(target)
    degree = np.bincount(edges.ravel(),minlength=n)
    lap = diags(degree.astype(float)) + coo_matrix((np.full(2*len(edges),-1.),
        (np.r_[edges[:,0],edges[:,1]],np.r_[edges[:,1],edges[:,0]])),shape=(n,n))
    attempts = []
    for lam in [0, .1, .3, 1, 3, 10, 30, 100, 300, 1000]:
        field = target if lam==0 else np.column_stack([spsolve(eye(n,format='csc')+lam*lap.tocsc(),target[:,k]) for k in range(3)])
        gap = np.linalg.norm(field[edges[:,0]]-field[edges[:,1]],axis=1)
        violation = int((gap>limits+1e-10).sum())
        attempts.append({'lambda':lam,'edgeViolations':violation,'maxGap':float(gap.max()),
                         'maxNorm':float(np.linalg.norm(field,axis=1).max())})
        if violation==0:
            assert np.linalg.norm(field,axis=1).max() <= BOUND+1e-10
            return field, edges, limits, seed_rows, attempts
    raise AssertionError('No smooth bounded field found; record this failure instead of a candidate')


def classify_pairs(hit, head_faces, source_face_ids, head_triangles):
    pairs = np.array(hit['pairs'],dtype=int).reshape(-1,2)
    if not len(pairs):
        return {'pairs':0,'sourceAdjacent':0,'nativeNonadjacent':0,'newNonadjacent':0}
    source = head_faces[source_face_ids[pairs[:,0]]]
    other = head_faces[pairs[:,1]]
    adjacent = (source[:,:,None]==other[:,None,:]).any(axis=(1,2))
    new = np.zeros(len(pairs),dtype=bool)
    nonadjacent = np.flatnonzero(~adjacent)
    if len(nonadjacent):
        existing = intersect_pairs(head_triangles[source_face_ids[pairs[nonadjacent,0]]],head_triangles[pairs[nonadjacent,1]])
        new[nonadjacent] = ~existing
    return {'pairs':len(pairs),'sourceAdjacent':int(adjacent.sum()),
            'nativeNonadjacent':int((~adjacent & ~new).sum()),'newNonadjacent':int(new.sum())}


def static_edge_pair_certificate(vectors, limits, case_names, edges, mapping):
    """Necessary condition for a common base-position correction on each edge.

    If two case-specific edge displacement vectors are farther apart than the
    sum of their permitted radii, no common additive edge correction can put
    both inside their balls. This test does not rely on the proposed field.
    """
    worst = None
    failing_edges = 0
    for edge in range(vectors.shape[1]):
        delta = vectors[:,edge,None,:]-vectors[None,:,edge,:]
        separation = np.linalg.norm(delta,axis=2)-limits[:,edge,None]-limits[None,:,edge]
        np.fill_diagonal(separation,-np.inf)
        i,j = np.unravel_index(np.argmax(separation),separation.shape)
        value = float(separation[i,j])
        if value > 1e-10:
            failing_edges += 1
            if worst is None or value > worst['excessDistance']:
                worst = {'edgeIndex':edge,'plateVertices':edges[edge].tolist(),
                         'headVertices':mapping[edges[edge]].tolist(),
                         'cases':[case_names[i],case_names[j]],
                         'caseVectorDistance':float(np.linalg.norm(vectors[i,edge]-vectors[j,edge])),
                         'sumAllowedRadii':float(limits[i,edge]+limits[j,edge]),
                         'excessDistance':value}
    return {'certifiedIncompatibleEdges':failing_edges,'worstCertificate':worst,
            'interpretation':'Necessary pairwise condition only; zero failures would not prove a coupled field exists.'}


def certificate_self_test():
    edges=np.array([[0,1]])
    mapping=np.array([4,5])
    vectors=np.array([[[0.,0,0]],[[3.,0,0]]])
    limits=np.array([[1.],[1.]])
    failed=static_edge_pair_certificate(vectors,limits,['a','b'],edges,mapping)
    assert failed['certifiedIncompatibleEdges']==1
    assert abs(failed['worstCertificate']['excessDistance']-1)<1e-12
    limits[:]=2
    assert static_edge_pair_certificate(vectors,limits,['a','b'],edges,mapping)['certifiedIncompatibleEdges']==0


def main():
    triangle_self_test()
    certificate_self_test()
    fixed_summary = json.loads((EXP/'fixed_summary.json').read_text(encoding='utf-8'))
    root = Path(fixed_summary['build'])
    build = json.loads((root/'build.json').read_text(encoding='utf-8'))
    manifest = json.loads((root/'posed/manifest.json').read_text(encoding='utf-8'))
    nearest = json.loads((HERE/'finite_contact_summary.json').read_text(encoding='utf-8'))
    assert nearest['visibilityFollowUp']['counts']['exposed'] > 0
    for item in nearest['inputs']:
        assert digest(item['path'])==item['sha256']
    expected = {s['name']:s['sha256'] for s in manifest['surfaces']}
    candidate = next(c for c in build['candidates'] if c['offset']==.00005)
    assert digest(candidate['roundtrip'])==expected[candidate['name']]
    assert candidate['weightTransfer']['binaryRoundtripSkinBufferExact']
    assert candidate['weightTransfer']['morphBaseBuffer']['binaryRoundtripSkinBufferExact']
    head,plate = Glb(Path(build['head'])),Glb(Path(candidate['roundtrip']))
    assert digest(build['head'])==expected['head']
    mapping=np.array(json.loads(Path(build['mapping']).read_text(encoding='utf-8'))['plateToHeadIndices'])
    hf=head.array(head.p['indices']).astype(int).reshape(-1,3)
    pf=plate.array(plate.p['indices']).astype(int).reshape(-1,3)
    head_faces={tuple(sorted(t)):i for i,t in enumerate(hf)}
    source_face_ids=np.array([head_faces[tuple(sorted(t))] for t in mapping[pf]])
    names=head.mesh['extras']['targetNames']
    assert names==plate.mesh['extras']['targetNames'] and len(names)==105
    frames=manifest['frames']
    hp=np.fromfile(root/'posed/head.positions.f64',dtype='<f8').reshape(len(frames),-1,3)
    baseline_pose=np.fromfile(root/f'posed/{candidate["name"]}.positions.f64',dtype='<f8').reshape(len(frames),len(mapping),3)
    matrices=np.fromfile(root/'fixed_linear.f64',dtype='<f8').reshape(len(frames),len(mapping),3,3)
    head_rest=head.attr('POSITION')[mapping].astype(float).copy()
    plate_rest=plate.attr('POSITION').astype(float).copy()
    saved_indices=[names.index(name) for name in MORPHS]
    for i in saved_indices:
        head_rest+=head.array(head.p['targets'][i]['POSITION'])[mapping]
        plate_rest+=plate.array(plate.p['targets'][i]['POSITION'])
    base_delta=plate_rest-head_rest
    assert np.max(np.linalg.norm(hp[:,mapping]+np.einsum('svij,vj->svi',matrices,base_delta)-baseline_pose,axis=2))<1e-10
    field,edges,limits,seeds,attempts=construct(base_delta,head_rest,pf,mapping,hp,hf,matrices,frames,nearest)
    change=field-base_delta
    posed=baseline_pose+np.einsum('svij,vj->svi',matrices,change)
    pose_rows=[]
    baseline_pose_rows=[]
    for s,frame in enumerate(frames):
        head_tri=hp[s,hf]
        baseline_hit=contacts(baseline_pose[s,pf],head_tri)
        baseline_row=classify_pairs(baseline_hit,hf,source_face_ids,head_tri)
        baseline_row['frame']=frame
        baseline_pose_rows.append(baseline_row)
        hit=contacts(posed[s,pf],head_tri)
        row=classify_pairs(hit,hf,source_face_ids,head_tri)
        row['frame']=frame
        pose_rows.append(row)
        if s%10==0: print(f'Pose {s+1}/{len(frames)}: {row["newNonadjacent"]} new nonadjacent',flush=True)
    static_rows=[]
    static_vectors=[]
    static_limits=[]
    cases=[('Basis',[])]+[(name,[i]) for i,name in enumerate(names)]+[('saved_v',saved_indices)]
    for case,indices in cases:
        h=head.attr('POSITION').astype(float).copy()
        p=plate.attr('POSITION').astype(float).copy()+change
        for i in indices:
            h+=head.array(head.p['targets'][i]['POSITION'])
            p+=plate.array(plate.p['targets'][i]['POSITION'])
        d=p-h[mapping]
        norm=np.linalg.norm(d,axis=1)
        gap=np.linalg.norm(d[edges[:,0]]-d[edges[:,1]],axis=1)
        edge_limit=np.minimum(NEIGHBOR_CAP,.25*np.linalg.norm(h[mapping][edges[:,0]]-h[mapping][edges[:,1]],axis=1))
        static_vectors.append(d[edges[:,0]]-d[edges[:,1]])
        static_limits.append(edge_limit)
        head_tri=h[hf]
        hit=contacts(p[pf],head_tri)
        row=classify_pairs(hit,hf,source_face_ids,head_tri)
        row.update(case=case,maxDisplacement=float(norm.max()),overDisplacement=int((norm>BOUND+1e-10).sum()),
                   maxNeighborGap=float(gap.max()),overNeighborBudget=int((gap>edge_limit+1e-10).sum()))
        static_rows.append(row)
        if len(static_rows)%20==0: print(f'Static {len(static_rows)}/{len(cases)}',flush=True)
    pair_certificate=static_edge_pair_certificate(np.stack(static_vectors),np.stack(static_limits),
        [name for name,_ in cases],edges,mapping)
    report={'build':str(root),'method':'Finite exposed-face normal pullbacks, geodesic taper, bounded Laplacian smoothing; counterfactual GLB base-position delta only.',
        'candidateSource':candidate['name'],'bound':BOUND,'neighborBudget':'min(0.00005, quarter local source edge length)',
        'seeds':seeds,'smoothingAttempts':attempts,'field':{'maxNorm':float(np.linalg.norm(field,axis=1).max()),
            'maxNeighborGap':float(np.linalg.norm(field[edges[:,0]]-field[edges[:,1]],axis=1).max()),
            'changedVerticesOver1e-10':int((np.linalg.norm(change,axis=1)>1e-10).sum())},
        'baselinePoseCases':baseline_pose_rows,'poseCases':pose_rows,'staticCases':static_rows,
        'staticNeighborPairwiseNecessaryCondition':pair_certificate,
        'gates':{'73PosesChecked':len(pose_rows)==73,'107StaticCasesChecked':len(static_rows)==107,
            'poseContactFree':not any(r['pairs'] for r in pose_rows),
            'poseNewNonadjacentFree':not any(r['newNonadjacent'] for r in pose_rows),
            'staticContactFree':not any(r['pairs'] for r in static_rows),
            'allStaticDisplacementWithinBudget':not any(r['overDisplacement'] for r in static_rows),
            'allStaticNeighborsWithinBudget':not any(r['overNeighborBudget'] for r in static_rows),
            'sourceMeshNativeSkinExact':candidate['weightTransfer']['binaryRoundtripSkinBufferExact'],
            'sourceMorphBaseNativeSkinExact':candidate['weightTransfer']['morphBaseBuffer']['binaryRoundtripSkinBufferExact'],
            'all105MorphDeltasPreservedInCounterfactual':len(names)==105},
        'inputs':[{'path':str(p),'sha256':digest(p)} for p in [Path(build['head']),Path(candidate['roundtrip']),Path(build['mapping']),
            root/'posed/head.positions.f64',root/f'posed/{candidate["name"]}.positions.f64',root/'fixed_linear.f64',HERE/'finite_contact_summary.json']],
        'limits':['Counterfactual positions only: no new mesh/morph import or native buffer byte audit exists for this candidate.',
                  'Head-only exposed-face seed selection does not establish combined-scene contact visibility.',
                  'Sampled poses and isolated static morphs do not prove all morph combinations or continuous animation.']}
    path=HERE/'finite_correction_summary.json'
    path.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'field':report['field'],'gates':report['gates'],
        'maxPoseNewNonadjacent':max(r['newNonadjacent'] for r in pose_rows),
        'maxStaticNewNonadjacent':max(r['newNonadjacent'] for r in static_rows)}),flush=True)


if __name__=='__main__':main()
