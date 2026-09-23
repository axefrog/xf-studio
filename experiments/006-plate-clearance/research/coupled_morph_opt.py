"""Bounded finite-triangle SAT optimization of two eye morph records.

Numeric diagnostics only: no mesh, morph resource, or owned master is written.
"""
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
WORKSPACE = EXP.parent.parent
sys.path[:0] = [str(EXP.parent / '004-plate-import'), str(EXP),
                str(Path('D:/Dev/cp2077-modding-hq/experiments/006-plate-clearance/generated/fixed_python'))]
from verify_roundtrip import Glb
from finite_pair_search import new_pairs
from triangles import intersect_pairs
from scipy.optimize import minimize, LinearConstraint, NonlinearConstraint, Bounds

UNIT = 1e-5
BOUND = 25.


def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def axes(a, b, mode):
    ae = np.roll(a, -1, axis=0) - a
    be = np.roll(b, -1, axis=0) - b
    raw = [np.cross(ae[0], ae[1]), np.cross(be[0], be[1])]
    raw.extend(np.cross(x, y) for x in ae for y in be)
    native_normal = raw[0] / np.linalg.norm(raw[0])
    options = []
    for vector in raw:
        norm = np.linalg.norm(vector)
        if norm < 1e-14: continue
        direction = vector / norm
        for sign in (1., -1.):
            direction2 = direction * sign
            move = float((b @ direction2).max() - (a @ direction2).min() + 2e-6)
            if move <= 0: continue
            alignment = float(direction2 @ native_normal)
            options.append((move, direction2, alignment))
    if mode == 'outward':
        compatible = [o for o in options if o[2] > .2]
        if compatible: options = compatible
    elif mode == 'normal':
        compatible = [o for o in options if o[2] > .8]
        if compatible: options = compatible
    move, direction, _ = min(options, key=lambda x: x[0])
    return direction, move


def axes_self_test():
    a = np.array([[0.,0.,0.],[1.,0.,0.],[0.,1.,0.]])
    cases = [np.array([[.2,.2,-.2],[.2,.2,.2],[.8,.2,0.]]),
             np.array([[.1,.1,0.],[.4,.1,0.],[.1,.4,0.]])]
    for b in cases:
        assert intersect_pairs(a[None],b[None])[0]
        for mode in ('shortest','outward','normal'):
            direction, move = axes(a,b,mode)
            assert not intersect_pairs((a+direction*move)[None],b[None])[0]


def neighborhood(faces, edges, pair_faces, rings=2):
    selected = set(map(int, faces[pair_faces].ravel()))
    for _ in range(rings):
        grown = set(selected)
        for a, b in edges:
            if a in selected or b in selected:
                grown.add(int(a)); grown.add(int(b))
        selected = grown
    return np.array(sorted(selected), dtype=int)


def solve(contexts, shape_cases, pf, hf, source_faces, edges, mode, forced=None, rings=2):
    forced = forced or {}
    observations = []
    for name, p, h, matrices in contexts:
        current = new_pairs(p[pf], h[hf], source_faces, hf)
        listed = set(map(tuple, current.tolist()))
        listed.update((pi, hi) for context, pi, hi in forced if context == name)
        pairs = np.array(sorted(listed), dtype=int).reshape(-1, 2)
        observations.append((name, pairs, p, h, matrices))
    count = sum(len(o[1]) for o in observations)
    if count == 0: return np.zeros((len(contexts[0][1]), 3)), {'start': 0, 'finish': 0}
    local = neighborhood(pf, edges, np.unique(np.concatenate([o[1][:, 0] for o in observations if len(o[1])])), rings)
    lookup = {int(v): i for i, v in enumerate(local)}
    dimension = len(local) * 3
    rows = []
    rhs = []
    axis_details = []
    for name, pairs, p, h, matrices in observations:
        for plate_face, head_face in pairs:
            direction = forced.get((name, int(plate_face), int(head_face)))
            if direction is None:
                direction, _ = axes(p[pf[plate_face]], h[hf[head_face]], mode)
            target = float((h[hf[head_face]] @ direction).max() + 2e-6)
            for v in pf[plate_face]:
                row = np.zeros(dimension)
                row[3*lookup[int(v)]:3*lookup[int(v)]+3] = direction @ matrices[v]
                rows.append(row)
                rhs.append((target - p[v] @ direction) / UNIT)
            axis_details.append({'context': name, 'plateFace': int(plate_face), 'headFace': int(head_face),
                                 'direction': direction.tolist()})
    matrix = np.stack(rows)
    rhs = np.array(rhs)
    affected_edges = edges[np.isin(edges, local).any(axis=1)]
    edge_i = np.array([lookup.get(int(v), -1) for v in affected_edges[:, 0]])
    edge_j = np.array([lookup.get(int(v), -1) for v in affected_edges[:, 1]])
    shape_data = []
    for name, displacement, limits in shape_cases:
        shape_data.append((name, displacement[local]/UNIT,
                           (displacement[affected_edges[:, 0]]-displacement[affected_edges[:, 1]])/UNIT,
                           limits[np.isin(edges, local).any(axis=1)]/UNIT))

    def shape_values(x):
        field = x.reshape(-1, 3)
        result = []
        for _, vertex_base, edge_base, limits in shape_data:
            v = vertex_base + field
            e = edge_base.copy()
            good = edge_i >= 0; e[good] += field[edge_i[good]]
            good = edge_j >= 0; e[good] -= field[edge_j[good]]
            result.append(np.r_[BOUND**2 - np.einsum('ij,ij->i', v, v),
                                limits**2 - np.einsum('ij,ij->i', e, e)])
        return np.concatenate(result)

    def shape_jac(x):
        field = x.reshape(-1, 3)
        blocks = []
        for _, vertex_base, edge_base, _ in shape_data:
            v = vertex_base + field
            e = edge_base.copy()
            good = edge_i >= 0; e[good] += field[edge_i[good]]
            good = edge_j >= 0; e[good] -= field[edge_j[good]]
            jac = np.zeros((len(local)+len(e), dimension))
            for i in range(len(local)):
                jac[i, 3*i:3*i+3] = -2*v[i]
            for k in range(len(e)):
                if edge_i[k] >= 0: jac[len(local)+k, 3*edge_i[k]:3*edge_i[k]+3] = -2*e[k]
                if edge_j[k] >= 0: jac[len(local)+k, 3*edge_j[k]:3*edge_j[k]+3] = 2*e[k]
            blocks.append(jac)
        return np.vstack(blocks)

    result = minimize(lambda x: .5*x@x, np.zeros(dimension), jac=lambda x: x,
                      method='SLSQP', bounds=Bounds(-20*np.ones(dimension), 20*np.ones(dimension)),
                      constraints=[LinearConstraint(matrix, rhs, np.inf),
                                   NonlinearConstraint(shape_values, 0, np.inf, jac=shape_jac)],
                      options={'ftol': 1e-9, 'maxiter': 120})
    correction = np.zeros_like(contexts[0][1])
    correction[local] = result.x.reshape(-1, 3) * UNIT
    shape_min = float(shape_values(result.x).min())
    sat_min = float((matrix @ result.x - rhs).min())
    measured = []
    for name, _, p, h, matrices in observations:
        updated = p + np.einsum('vij,vj->vi', matrices, correction)
        measured.append({'context': name, 'contacts': len(new_pairs(updated[pf], h[hf], source_faces, hf))})
    return correction, {'start': count, 'finish': sum(r['contacts'] for r in measured),
                        'contexts': measured, 'localVertices': len(local), 'satRows': len(rhs),
                        'solverStatus': int(result.status), 'solverMessage': str(result.message),
                        'iterations': int(result.nit), 'minimumShapeSlackSquared': shape_min,
                        'minimumSatSlack': sat_min, 'axisChoices': axis_details}


def main():
    axes_self_test()
    prior_path = HERE / 'finite_pair_search_summary.json'
    prior = json.loads(prior_path.read_text())
    numeric = WORKSPACE / prior['numericResult']
    assert sha(numeric) == prior['numericResultSha256']
    old = json.loads((HERE / 'morph_aware_rescue_summary.json').read_text())
    root = Path(old['sourceBuild'])
    build = json.loads((root / 'build.json').read_text())
    source = next(c for c in build['candidates'] if c['name'] == old['sourceCandidate'])
    assert source['weightTransfer']['binaryRoundtripSkinBufferExact']
    assert source['weightTransfer']['morphBaseBuffer']['binaryRoundtripSkinBufferExact']
    head, plate = Glb(Path(build['head'])), Glb(Path(source['roundtrip']))
    mapping = np.array(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'], dtype=int)
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    pf = plate.array(plate.p['indices']).astype(int).reshape(-1, 3)
    lookup = {tuple(sorted(t)): i for i, t in enumerate(hf)}
    source_faces = np.array([lookup[tuple(sorted(t))] for t in mapping[pf]])
    edges = np.unique(np.sort(np.concatenate([pf[:, [0,1]], pf[:, [1,2]], pf[:, [2,0]]]), axis=1), axis=0)
    names = head.mesh['extras']['targetNames']
    assert names == plate.mesh['extras']['targetNames'] and len(names) == 105
    hb, pb = head.attr('POSITION').astype(float), plate.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    pt = np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']])
    start = np.load(numeric)
    field, morph = start['field'].copy(), start['morphChange'].copy()
    frames = json.loads((root / 'posed/manifest.json').read_text())['frames']
    hp = np.fromfile(root / 'posed/head.positions.f64', dtype='<f8').reshape(len(frames), -1, 3)
    matrices = np.fromfile(root / 'fixed_linear.f64', dtype='<f8').reshape(len(frames), len(mapping), 3, 3)
    saved = [names.index(n) for n in ['h091_eyes','h012_nose','h053_mouth','h054_jaw','h145_ear']]
    reports = []
    for name, mode in [('h171_eyes','shortest'), ('h171_eyes','outward'), ('h091_eyes','shortest'),
                       ('h091_eyes','outward'), ('h091_eyes','normal')]:
        i = names.index(name)
        h = hb + ht[i]
        p = pb + start['baseChange'] + pt[i] + morph[i]
        d = p - h[mapping]
        caps = np.minimum(5e-5, .25*np.linalg.norm(h[mapping[edges[:,0]]]-h[mapping[edges[:,1]]], axis=1))
        if name == 'h171_eyes':
            contexts = [(name,p,h,np.broadcast_to(np.eye(3),(len(mapping),3,3)))]
            shapes = [(name,d,caps)]
        else:
            saved_h = hb + ht[saved].sum(axis=0)
            saved_p = pb + start['baseChange'] + (pt[saved]+morph[saved]).sum(axis=0)
            saved_d = saved_p - saved_h[mapping]
            saved_caps = np.minimum(5e-5,.25*np.linalg.norm(saved_h[mapping[edges[:,0]]]-saved_h[mapping[edges[:,1]]],axis=1))
            shapes = [(name,d,caps),('saved_v',saved_d,saved_caps)]
            residual = (pt[saved]+morph[saved]-ht[saved][:,mapping]).sum(axis=0)
            contexts = []
            for frame in (25,169):
                j = frames.index(frame)
                posed = hp[j,mapping] + np.einsum('vij,vj->vi',matrices[j],field+residual)
                contexts.append((f'frame-{frame}',posed,hp[j],matrices[j]))
        correction, report = solve(contexts,shapes,pf,hf,source_faces,edges,mode)
        report.update(targetMorph=name,axisMode=mode,maxCorrection=float(np.linalg.norm(correction,axis=1).max()))
        reports.append(report)
        print(json.dumps({k:v for k,v in report.items() if k!='axisChoices'}),flush=True)
        out = EXP/'generated/morph-aware'/f'coupled-{name}-{mode}.npz'
        out.parent.mkdir(parents=True,exist_ok=True)
        variant = morph.copy();variant[i] += correction
        np.savez_compressed(out,field=field,baseChange=start['baseChange'],morphChange=variant,mapping=mapping)
        report['numericResult'] = out.relative_to(WORKSPACE).as_posix()
        report['numericSha256'] = sha(out)
    result = {'startingNumericSha256': prior['numericResultSha256'], 'startingReportSha256': sha(prior_path),
              'sourceBuild': str(root), 'trials': reports,
              'limits': ['SAT axes are sufficient finite-triangle separation conditions for the selected pairs, not a global nonintersection proof.',
                         'Local solver success does not override exact full 107-static/73-pose gates.',
                         'No resource import or master edit.']}
    winning = {r['targetMorph']: r for r in reports if r['axisMode']=='shortest'}
    assert set(winning) == {'h171_eyes','h091_eyes'}
    combined = morph.copy()
    for target, row in winning.items():
        variant = np.load(WORKSPACE/row['numericResult'])['morphChange']
        index = names.index(target)
        combined[index] = variant[index]
    combined_path = EXP/'generated/morph-aware/coupled-combined.npz'
    np.savez_compressed(combined_path,field=field,baseChange=start['baseChange'],morphChange=combined,mapping=mapping)
    result['combinedNumericResult'] = combined_path.relative_to(WORKSPACE).as_posix()
    result['combinedNumericSha256'] = sha(combined_path)
    # One bounded active-set pass carries forward the successful separation
    # axes and adds any contacts exposed at the neighboring sampled phases.
    h091 = names.index('h091_eyes')
    h = hb + ht[h091]
    p = pb + start['baseChange'] + pt[h091] + combined[h091]
    d = p-h[mapping]
    caps = np.minimum(5e-5,.25*np.linalg.norm(h[mapping[edges[:,0]]]-h[mapping[edges[:,1]]],axis=1))
    saved_h = hb + ht[saved].sum(axis=0)
    saved_p = pb + start['baseChange'] + (pt[saved]+combined[saved]).sum(axis=0)
    saved_d = saved_p-saved_h[mapping]
    saved_caps = np.minimum(5e-5,.25*np.linalg.norm(saved_h[mapping[edges[:,0]]]-saved_h[mapping[edges[:,1]]],axis=1))
    residual = (pt[saved]+combined[saved]-ht[saved][:,mapping]).sum(axis=0)
    contexts = []
    for frame in (25,120,169,170):
        j = frames.index(frame)
        posed = hp[j,mapping] + np.einsum('vij,vj->vi',matrices[j],field+residual)
        contexts.append((f'frame-{frame}',posed,hp[j],matrices[j]))
    forced = {(row['context'],row['plateFace'],row['headFace']):np.array(row['direction'])
              for row in winning['h091_eyes']['axisChoices']}
    correction, iterative = solve(contexts,[(names[h091],d,caps),('saved_v',saved_d,saved_caps)],
                                  pf,hf,source_faces,edges,'shortest',forced)
    iterative.update(targetMorph='h091_eyes',axisMode='carried-shortest-plus-new-contacts',
                     maxCorrection=float(np.linalg.norm(correction,axis=1).max()))
    iterated_morph = combined.copy();iterated_morph[h091] += correction
    iterated_path = EXP/'generated/morph-aware/coupled-iterated.npz'
    np.savez_compressed(iterated_path,field=field,baseChange=start['baseChange'],morphChange=iterated_morph,mapping=mapping)
    result['iteratedTrial'] = iterative
    result['iteratedNumericResult'] = iterated_path.relative_to(WORKSPACE).as_posix()
    result['iteratedNumericSha256'] = sha(iterated_path)
    print(json.dumps({k:v for k,v in iterative.items() if k!='axisChoices'}),flush=True)
    result['alternateIteratedTrials'] = []
    for alternate_mode in ('outward','normal'):
        correction, alternate = solve(contexts,[(names[h091],d,caps),('saved_v',saved_d,saved_caps)],
                                      pf,hf,source_faces,edges,alternate_mode,forced)
        alternate.update(targetMorph='h091_eyes',axisMode=f'carried-plus-{alternate_mode}',
                         maxCorrection=float(np.linalg.norm(correction,axis=1).max()))
        variant = combined.copy(); variant[h091] += correction
        path = EXP/'generated/morph-aware'/f'coupled-iterated-{alternate_mode}.npz'
        np.savez_compressed(path,field=field,baseChange=start['baseChange'],morphChange=variant,mapping=mapping)
        alternate['numericResult'] = path.relative_to(WORKSPACE).as_posix()
        alternate['numericSha256'] = sha(path)
        result['alternateIteratedTrials'].append(alternate)
        print(json.dumps({k:v for k,v in alternate.items() if k!='axisChoices'}),flush=True)
    result['expandedIteratedTrials'] = []
    for rings in (3,4):
        correction, expanded = solve(contexts,[(names[h091],d,caps),('saved_v',saved_d,saved_caps)],
                                     pf,hf,source_faces,edges,'shortest',forced,rings)
        expanded.update(targetMorph='h091_eyes',axisMode='carried-shortest-expanded',rings=rings,
                        maxCorrection=float(np.linalg.norm(correction,axis=1).max()))
        variant = combined.copy(); variant[h091] += correction
        path = EXP/'generated/morph-aware'/f'coupled-iterated-rings-{rings}.npz'
        np.savez_compressed(path,field=field,baseChange=start['baseChange'],morphChange=variant,mapping=mapping)
        expanded['numericResult'] = path.relative_to(WORKSPACE).as_posix()
        expanded['numericSha256'] = sha(path)
        result['expandedIteratedTrials'].append(expanded)
        print(json.dumps({k:v for k,v in expanded.items() if k!='axisChoices'}),flush=True)
    (HERE/'coupled_morph_opt_summary.json').write_text(json.dumps(result,indent=2)+'\n')


if __name__=='__main__': main()
