"""Finite-contact-guided local trial on the morph-aware numeric shell.

For each observed new nonadjacent plate/head triangle intersection, push its
plate vertices toward the head triangle's winding-positive half-space in the
corresponding posed or static shape. Pull posed corrections through the exact
sampled skin matrix, smooth over plate edges, and retain only objective-improving
steps that satisfy the original displacement and all-static edge budgets. This
is deliberately a local heuristic, not a replacement for exact contact proof.
"""
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
WORKSPACE=EXP.parent.parent
sys.path.insert(0, str(EXP.parent / '004-plate-import'))
sys.path.insert(0, str(EXP))
from verify_roundtrip import Glb
from triangles import contacts, intersect_pairs, self_test as triangle_self_test
from finite_correction_probe import edges_of, BOUND, NEIGHBOR_CAP


def new_pairs(plate_triangles, head_triangles, source_face_ids, head_faces):
    hit = contacts(plate_triangles, head_triangles)
    pairs = np.asarray(hit['pairs'], dtype=int).reshape(-1, 2)
    if not len(pairs): return pairs
    source = head_faces[source_face_ids[pairs[:, 0]]]
    other = head_faces[pairs[:, 1]]
    adjacent = (source[:, :, None] == other[:, None, :]).any(axis=(1, 2))
    nonadj = pairs[~adjacent]
    if not len(nonadj): return nonadj
    already = intersect_pairs(head_triangles[source_face_ids[nonadj[:, 0]]],
                              head_triangles[nonadj[:, 1]])
    return nonadj[~already]


def main():
    triangle_self_test()
    initial = json.loads((HERE / 'morph_aware_summary.json').read_text())
    root = Path(initial['sourceBuild'])
    build = json.loads((root / 'build.json').read_text())
    head = Glb(Path(build['head']))
    mapping = np.asarray(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'], dtype=int)
    initial_path=Path(initial['numericCandidate'])
    if not initial_path.is_absolute():initial_path=WORKSPACE/initial_path
    candidate = np.load(initial_path)
    assert hashlib.sha256(initial_path.read_bytes()).hexdigest() == initial['numericCandidateSha256']
    assert np.array_equal(mapping, candidate['mapping'])
    field = candidate['field'].copy()
    plate = Glb(Path(next(c for c in build['candidates'] if c['name'] == initial['sourceCandidate'])['roundtrip']))
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    pf = plate.array(plate.p['indices']).astype(int).reshape(-1, 3)
    edges = edges_of(pf)
    source_lookup = {tuple(sorted(t)): i for i, t in enumerate(hf)}
    source_face_ids = np.array([source_lookup[tuple(sorted(t))] for t in mapping[pf]])
    head_base = head.attr('POSITION').astype(float)
    names = head.mesh['extras']['targetNames']
    head_targets = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    plate_targets = np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']])
    selected = [names.index(n) for n in initial['field']['correctedMorphNames']]
    correction = candidate['morphChange']
    saved = [names.index(n) for n in ['h091_eyes','h012_nose','h053_mouth','h054_jaw','h145_ear']]
    saved_residual = (plate_targets[saved] + correction[saved] - head_targets[saved][:, mapping]).sum(axis=0)
    frames = json.loads((root / 'posed/manifest.json').read_text())['frames']
    hp = np.fromfile(root / 'posed/head.positions.f64', dtype='<f8').reshape(len(frames), -1, 3)
    matrix = np.fromfile(root / 'fixed_linear.f64', dtype='<f8').reshape(len(frames), len(mapping), 3, 3)
    static_names = [r['case'] for r in initial['staticCases'] if r['newNonadjacent']]
    frame_ids = [i for i,r in enumerate(initial['poseCases']) if r['newNonadjacent']]
    static = []
    for name in static_names:
        i = names.index(name)
        h = head_base + head_targets[i]
        residual = plate_targets[i] + correction[i] - head_targets[i, mapping]
        static.append((name, h, residual))
    caps = []
    for name in ['Basis'] + names + ['saved_v']:
        ids = [] if name=='Basis' else saved if name=='saved_v' else [names.index(name)]
        h = head_base[mapping] + head_targets[ids][:, mapping].sum(axis=0) if ids else head_base[mapping]
        caps.append(np.minimum(NEIGHBOR_CAP, .25 * np.linalg.norm(h[edges[:, 0]]-h[edges[:, 1]], axis=1)))
    min_caps = np.min(np.stack(caps), axis=0)
    sys.path.insert(0, str(root.parent / 'fixed_python'))
    from scipy.sparse import coo_matrix, eye, diags
    from scipy.sparse.linalg import spsolve
    degree = np.bincount(edges.ravel(), minlength=len(field))
    lap = diags(degree.astype(float)) + coo_matrix(
        (np.full(2*len(edges),-1.), (np.r_[edges[:, 0],edges[:, 1]],np.r_[edges[:, 1],edges[:, 0]])),
        shape=(len(field),len(field)))
    smoother = eye(len(field),format='csc') + .5*lap.tocsc()

    def contexts(d):
        result=[]
        for name,h,residual in static:
            p = h[mapping] + d + residual
            pairs = new_pairs(p[pf],h[hf],source_face_ids,hf)
            result.append((name,pairs,p,h,np.broadcast_to(np.eye(3),(len(mapping),3,3))))
        for s in frame_ids:
            h = hp[s]
            p = h[mapping] + np.einsum('vij,vj->vi',matrix[s],d+saved_residual)
            pairs = new_pairs(p[pf],h[hf],source_face_ids,hf)
            result.append((f'frame-{frames[s]}',pairs,p,h,matrix[s]))
        return result

    def shape_budget(d):
        norm = np.linalg.norm(d,axis=1).max()
        gap = np.linalg.norm(d[edges[:,0]]-d[edges[:,1]],axis=1)
        return norm, float(gap.max()), int((gap>min_caps+1e-10).sum())

    history=[]
    current=field.copy()
    for iteration in range(5):
        observed=contexts(current)
        score=sum(len(row[1]) for row in observed)
        norm,gap,over=shape_budget(current)
        history.append({'iteration':iteration,'criticalContacts':int(score),
                        'byContext':{r[0]:len(r[1]) for r in observed},
                        'maximumDisplacement':float(norm),'maximumGap':gap,'overEdgeBudget':over})
        print(json.dumps(history[-1]),flush=True)
        if score==0: break
        shifts=np.zeros_like(current)
        counts=np.zeros(len(current))
        for _,pairs,p,h,linear in observed:
            for plate_face,head_face in pairs:
                tri=h[hf[head_face]]
                n=np.cross(tri[1]-tri[0],tri[2]-tri[0]); length=np.linalg.norm(n)
                if length<1e-15:continue
                n/=length
                vertices=pf[plate_face]
                distance=(p[vertices]-tri[0])@n
                for v,d in zip(vertices,distance):
                    step=np.clip(.00001-d,0,.00005)
                    pulled=np.linalg.solve(linear[v],n*step)
                    shifts[v]+=pulled
                    counts[v]+=1
        used=counts>0
        if not np.any(used):break
        shifts[used]/=counts[used,None]
        shifts=np.column_stack([spsolve(smoother,shifts[:,k]) for k in range(3)])
        best=None
        for scale in [.25,.5,1.,1.5,2.]:
            trial=current+scale*shifts
            norm,gap,over=shape_budget(trial)
            if norm>BOUND+1e-10 or over:continue
            observed_trial=contexts(trial)
            next_score=sum(len(r[1]) for r in observed_trial)
            if next_score<score and (best is None or next_score<best[0]):
                best=(next_score,trial,scale)
        if best is None:
            history[-1]['stopped']='No tested local step improved finite contacts without breaking shape gates.'
            break
        history[-1]['acceptedScale']=best[2]
        current=best[1]
    outdir=EXP/'generated/morph-aware'
    outdir.mkdir(parents=True,exist_ok=True)
    output=outdir/'contact-rescue.npz'
    np.savez_compressed(output,field=current)
    result={'purpose':'Local finite-contact perturbation on numeric morph-aware candidate; never imported.',
            'sourceSummarySha256':hashlib.sha256((HERE/'morph_aware_summary.json').read_bytes()).hexdigest(),
            'numericResult':output.relative_to(WORKSPACE).as_posix(),
            'numericResultSha256':hashlib.sha256(output.read_bytes()).hexdigest(),
            'criticalFrames':[frames[i] for i in frame_ids],'criticalStaticCases':static_names,
            'history':history,
            'warning':'Critical-context improvement alone cannot pass the 73-pose and 107-static complete gates; rerun those before import.'}
    (HERE/'morph_contact_rescue_summary.json').write_text(json.dumps(result,indent=2)+'\n')


if __name__=='__main__': main()
