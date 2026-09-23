"""Bounded local search against float32 and measured packed geometry."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
sys.path[:0] = [str(Path('D:/Dev/cp2077-modding-hq/experiments/006-plate-clearance/generated/fixed_python')),
                str(EXP.parent / '004-plate-import'), str(EXP)]
from scipy.optimize import minimize
from verify_roundtrip import Glb
from verify_crease_roundtrip import new_pairs
from roundtrip_crease import write_glb


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--edge-margin', type=float, default=3e-6)
    parser.add_argument('--baseline', type=Path, required=True)
    args = parser.parse_args()
    baseline = args.baseline
    build = json.loads((baseline / 'build.json').read_text())
    original = np.load(build['candidate'])
    source = Glb(Path(build['sourceGlb']))
    head, raw, packed = [Glb(Path(build[key])) for key in ('head', 'raw', 'roundtrip')]
    mapping = np.asarray(json.loads(Path(build['mapping']).read_text())['plateToHeadIndices'], dtype=int)
    names = head.mesh['extras']['targetNames']
    hf = head.array(head.p['indices']).astype(int).reshape(-1, 3)
    pf = raw.array(raw.p['indices']).astype(int).reshape(-1, 3)
    lookup = {tuple(sorted(face)): i for i, face in enumerate(hf)}
    source_faces = np.asarray([lookup[tuple(sorted(face))] for face in mapping[pf]])
    edges = np.unique(np.sort(np.concatenate((pf[:, [0, 1]], pf[:, [1, 2]], pf[:, [2, 0]])), axis=1), axis=0)
    hb = head.attr('POSITION').astype(float)
    ht = np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
    surfaces = [(plate.attr('POSITION').astype(float),
                 np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']]))
                for plate in (raw, packed)]
    saved = [names.index(n) for n in ('h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear')]
    cases = [('Basis', [])] + [(name, [i]) for i, name in enumerate(names)] + [('saved_v', saved)]
    local = np.array([119, 321, 322])
    local_edges = edges[np.isin(edges, local).any(axis=1)]
    i_lookup = {int(v): i for i, v in enumerate(local)}
    edge_i = np.array([i_lookup.get(int(v), -1) for v in local_edges[:, 0]])
    edge_j = np.array([i_lookup.get(int(v), -1) for v in local_edges[:, 1]])
    bases, caps = [], []
    for _, indices in cases:
        h = hb + ht[indices].sum(axis=0) if indices else hb
        cap = np.minimum(5e-5, .25 * np.linalg.norm(h[mapping[local_edges[:, 0]]] - h[mapping[local_edges[:, 1]]], axis=1))
        for pb, pt in surfaces:
            p = pb + pt[indices].sum(axis=0) if indices else pb
            d = p - h[mapping]
            bases.append(d[local_edges[:, 0]] - d[local_edges[:, 1]])
            caps.append(cap)
    bases, caps = np.asarray(bases), np.asarray(caps)
    edge_count = len(local_edges)
    signs = np.zeros((edge_count, len(local)))
    for k in range(edge_count):
        if edge_i[k] >= 0: signs[k, edge_i[k]] += 1
        if edge_j[k] >= 0: signs[k, edge_j[k]] -= 1

    def values(x):
        change = signs @ x.reshape(len(local), 3)
        return (caps - args.edge_margin - np.linalg.norm(bases + change[None], axis=2)).ravel()

    result = minimize(lambda x: .5 * x @ x, np.zeros(len(local)*3), jac=lambda x: x,
                      method='SLSQP', constraints=[{'type': 'ineq', 'fun': values}],
                      bounds=[(-20e-6, 20e-6)] * (len(local)*3),
                      options={'ftol': 1e-16, 'maxiter': 200})
    change = result.x.reshape(len(local), 3)
    data = {'success': bool(result.success), 'status': int(result.status), 'message': result.message,
            'minimumSlack': float(values(result.x).min()), 'corrections': dict(zip(map(str, local), change.tolist())),
            'localEdgeCount': edge_count, 'margin': args.edge_margin,
            'sourceCandidateSha256': sha(build['candidate'])}
    out = EXP / 'generated/postpack-base-edge-search.json'
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(data, indent=2) + '\n')
    print(json.dumps(data))
    if data['minimumSlack'] < -1e-10:
        return
    base = original['baseChange'].copy()
    base[local] += change
    candidate = EXP / 'generated/morph-aware/postpack-base-edge.npz'
    candidate.parent.mkdir(parents=True, exist_ok=True)
    # Field tracks the base displacement from the original head for the numeric verifier.
    values_field = original['field'].copy()
    values_field[local] += change
    np.savez_compressed(candidate, field=values_field, baseChange=base,
                        morphChange=original['morphChange'], mapping=mapping)
    raw_candidate = EXP / 'generated/morph-aware/postpack-base-edge.glb'
    write_glb(Path(build['sourceGlb']), raw_candidate, base, original['morphChange'])
    print(json.dumps({'candidate': str(candidate), 'candidateSha256': sha(candidate),
                      'rawGlb': str(raw_candidate), 'rawGlbSha256': sha(raw_candidate)}))
    morph = original['morphChange'].copy()
    morph[names.index('h091_eyes'), [118, 119, 156, 321], 1] += 3.5e-6
    morph[names.index('h201_eyes'), [449, 571, 572]] += np.array([-3e-6, 6e-6, 1e-6])
    trial = EXP / 'generated/morph-aware/postpack-contacts-trial.npz'
    np.savez_compressed(trial, field=values_field, baseChange=base,
                        morphChange=morph, mapping=mapping)
    trial_raw = EXP / 'generated/morph-aware/postpack-contacts-trial.glb'
    trial_predicted = EXP / 'generated/morph-aware/postpack-contacts-trial-predicted.glb'
    write_glb(Path(build['sourceGlb']), trial_raw, base, morph)
    write_glb(Path(build['roundtrip']), trial_predicted,
              base - original['baseChange'], morph - original['morphChange'])
    print(json.dumps({'trial': str(trial), 'trialSha256': sha(trial),
                      'raw': str(trial_raw), 'predicted': str(trial_predicted)}))
    final_raw, final_predicted = Glb(trial_raw), Glb(trial_predicted)

    def optimize_morph_edges(target_name, local_vertices, target_cases):
        chosen = np.asarray(local_vertices)
        incident = edges[np.isin(edges, chosen).any(axis=1)]
        lookup_local = {int(v): j for j,v in enumerate(chosen)}
        signs = np.zeros((len(incident), len(chosen)))
        for j,(a,b) in enumerate(incident):
            if int(a) in lookup_local: signs[j,lookup_local[int(a)]] += 1
            if int(b) in lookup_local: signs[j,lookup_local[int(b)]] -= 1
        starts, limits = [], []
        for indices in target_cases:
            h = hb + ht[indices].sum(axis=0)
            cap = np.minimum(5e-5,.25*np.linalg.norm(h[mapping[incident[:,0]]]-h[mapping[incident[:,1]]],axis=1))
            for plate in (final_raw,final_predicted):
                pb0 = plate.attr('POSITION').astype(float)
                pt0 = np.stack([plate.array(t['POSITION']).astype(float) for t in plate.p['targets']])
                p = pb0 + pt0[indices].sum(axis=0)
                d = p-h[mapping]
                starts.append(d[incident[:,0]]-d[incident[:,1]])
                limits.append(cap)
        starts, limits = np.asarray(starts), np.asarray(limits)
        def slacks(x):
            shift = signs@x.reshape(len(chosen),3)
            return (limits-args.edge_margin-np.linalg.norm(starts+shift[None],axis=2)).ravel()
        opt = minimize(lambda x:.5*x@x,np.zeros(len(chosen)*3),jac=lambda x:x,
                       method='SLSQP',constraints=[{'type':'ineq','fun':slacks}],
                       bounds=[(-12e-6,12e-6)]*(len(chosen)*3),
                       options={'ftol':1e-16,'maxiter':300})
        return opt.x.reshape(len(chosen),3), {'name':target_name,'vertices':local_vertices,
            'corrections':opt.x.reshape(len(chosen),3).tolist(),'status':int(opt.status),
            'message':opt.message,'minSlack':float(slacks(opt.x).min()),'localEdges':len(incident)}

    updates = []
    for name, verts, case_indices in [
        ('h091_eyes',[109,118,121,156,158],[[names.index('h091_eyes')],saved]),
        ('h171_eyes',[31,848],[[names.index('h171_eyes')]])]:
        correction, detail = optimize_morph_edges(name, verts, case_indices)
        updates.append(detail)
        morph[names.index(name),verts] += correction
    (EXP/'generated/postpack-morph-edge-search.json').write_text(json.dumps(updates,indent=2)+'\n')
    print(json.dumps(updates))
    refined = EXP/'generated/morph-aware/postpack-refined.npz'
    np.savez_compressed(refined,field=values_field,baseChange=base,morphChange=morph,mapping=mapping)
    refined_raw = EXP/'generated/morph-aware/postpack-refined.glb'
    refined_predicted = EXP/'generated/morph-aware/postpack-refined-predicted.glb'
    write_glb(Path(build['sourceGlb']),refined_raw,base,morph)
    write_glb(Path(build['roundtrip']),refined_predicted,
              base-original['baseChange'],morph-original['morphChange'])
    print(json.dumps({'refined':str(refined),'sha256':sha(refined),
                      'raw':str(refined_raw),'predicted':str(refined_predicted)}))


if __name__ == '__main__':
    main()
