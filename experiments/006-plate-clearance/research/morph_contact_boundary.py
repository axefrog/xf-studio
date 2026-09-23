"""Map fixed-base smoothness certificates to UV and observed exposed contacts.

Read-only analysis of the retained-weight experiment-006 build. It constructs no
replacement plate and never changes morph or skin bytes.
"""
import hashlib
import json
from collections import Counter, defaultdict, deque
from pathlib import Path
import sys

import numpy as np

HERE = Path(__file__).resolve().parent
EXP = HERE.parent
sys.path.insert(0, str(EXP.parent / '004-plate-import'))
from verify_roundtrip import Glb

SAVED = ['h091_eyes', 'h012_nose', 'h053_mouth', 'h054_jaw', 'h145_ear']


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def components(edge_indices, edges):
    pending = set(edge_indices)
    vertices = defaultdict(set)
    for e in edge_indices:
        a, b = map(int, edges[e])
        vertices[a].add(e)
        vertices[b].add(e)
    result = []
    while pending:
        first = pending.pop()
        group = {first}
        todo = [first]
        while todo:
            e = todo.pop()
            for vertex in edges[e]:
                for linked in vertices[int(vertex)] & pending:
                    pending.remove(linked)
                    group.add(linked)
                    todo.append(linked)
        result.append(sorted(group))
    return sorted(result, key=lambda group: (-len(group), min(group)))


def shortest_edge_hops(start_vertices, target_vertices, edges):
    if not target_vertices:
        return None
    graph = defaultdict(set)
    for a, b in edges:
        graph[int(a)].add(int(b))
        graph[int(b)].add(int(a))
    queue = deque((int(v), 0) for v in start_vertices)
    visited = set(start_vertices)
    while queue:
        vertex, steps = queue.popleft()
        if vertex in target_vertices:
            return steps
        for other in graph[vertex] - visited:
            visited.add(other)
            queue.append((other, steps + 1))
    return None


def main():
    prior = json.loads((HERE / 'finite_correction_summary.json').read_text())
    root = Path(prior['build'])
    build = json.loads((root / 'build.json').read_text())
    candidate = next(x for x in build['candidates'] if x['name'] == prior['candidateSource'])
    assert candidate['weightTransfer']['binaryRoundtripSkinBufferExact']
    assert candidate['weightTransfer']['morphBaseBuffer']['binaryRoundtripSkinBufferExact']
    head = Glb(Path(build['head']))
    plate = Glb(Path(candidate['roundtrip']))
    mapping_path = Path(build['mapping'])
    mapping = np.asarray(json.loads(mapping_path.read_text())['plateToHeadIndices'], dtype=int)
    faces = plate.array(plate.p['indices']).astype(int).reshape(-1, 3)
    edges = np.unique(np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1), axis=0)
    uv = plate.attr('TEXCOORD_0').astype(float)
    names = head.mesh['extras']['targetNames']
    assert names == plate.mesh['extras']['targetNames'] and len(names) == 105
    saved = [names.index(n) for n in SAVED]
    cases = [('Basis', [])] + [(n, [i]) for i, n in enumerate(names)] + [('saved_v', saved)]
    vectors, limits = [], []
    for _, morphs in cases:
        h = head.attr('POSITION').astype(float).copy()
        p = plate.attr('POSITION').astype(float).copy()
        for i in morphs:
            h += head.array(head.p['targets'][i]['POSITION'])
            p += plate.array(plate.p['targets'][i]['POSITION'])
        displacement = p - h[mapping]
        vectors.append(displacement[edges[:, 0]] - displacement[edges[:, 1]])
        length = np.linalg.norm(h[mapping[edges[:, 0]]] - h[mapping[edges[:, 1]]], axis=1)
        limits.append(np.minimum(.00005, .25 * length))
    vectors = np.stack(vectors)
    limits = np.stack(limits)
    certificates = []
    maximum_uniform_neighbor_cap_multiplier_necessary = 0.
    for e, (a, b) in enumerate(edges):
        distance = np.linalg.norm(vectors[:, e, None, :] - vectors[None, :, e, :], axis=2)
        pair_cap = limits[:, e, None] + limits[None, :, e]
        ratio = distance / pair_cap
        np.fill_diagonal(ratio, 0.)
        maximum_uniform_neighbor_cap_multiplier_necessary = max(
            maximum_uniform_neighbor_cap_multiplier_necessary, float(ratio.max()))
        excess = distance - pair_cap
        np.fill_diagonal(excess, -np.inf)
        i, j = np.unravel_index(int(np.argmax(excess)), excess.shape)
        if excess[i, j] <= 1e-10:
            continue
        certificates.append({
            'edge': e,
            'plateVertices': [int(a), int(b)],
            'headVertices': mapping[[a, b]].tolist(),
            'uvMidpoint': ((uv[a] + uv[b]) * .5).tolist(),
            'cases': [cases[i][0], cases[j][0]],
            'excess': float(excess[i, j]),
            'minimumCombinedCaseSpecificEdgeChange': float(excess[i, j]),
            'equalShareRequirementIfSplitEvenly': float(excess[i, j] * .5),
        })
    previous = prior['staticNeighborPairwiseNecessaryCondition']
    assert len(certificates) == previous['certifiedIncompatibleEdges']
    worst = max(certificates, key=lambda x: x['excess'])
    assert worst['edge'] == previous['worstCertificate']['edgeIndex']
    assert abs(worst['excess'] - previous['worstCertificate']['excessDistance']) < 1e-12

    # These are previously measured *combined-scene* visibility cases, not a
    # substitute for testing other poses or a future corrected surface.
    visibility_path = root / 'contact-visibility-details.json'
    visible = json.loads(visibility_path.read_text())
    observed = []
    for row in visible:
        if row['candidate'] != candidate['name'] or row['frame'] not in (0, 25):
            continue
        exposed_contacts = [x for x in row['contacts']
                            if any(v['visibleAtTolerances']['1e-06'] > 0 for v in x['views'].values())]
        face_ids = {int(x['plateTriangle']) for x in exposed_contacts
                    if not x['alreadyIntersectsInHead'] and x['sharedSourceVertices'] == 0
                   }
        observed.append({'frame': row['frame'], 'exposedNewNonadjacentPlateFaces': len(face_ids),
                         'plateFaces': sorted(face_ids),
                         'allExposedFaces': sorted({int(x['plateTriangle']) for x in exposed_contacts})})
    assert len(observed) == 2
    edge_to_faces = defaultdict(set)
    for f, tri in enumerate(faces):
        for v in tri:
            edge_to_faces[int(v)].add(f)
    for row in certificates:
        incident = edge_to_faces[row['plateVertices'][0]] & edge_to_faces[row['plateVertices'][1]]
        row['incidentPlateFaces'] = sorted(incident)
        row['exposedNewContactAtSampledFrames'] = {
            str(x['frame']): bool(incident & set(x['plateFaces'])) for x in observed
        }
        row['anyExposedContactAtSampledFrames'] = {
            str(x['frame']): bool(incident & set(x['allExposedFaces'])) for x in observed
        }
        row['graphHopsToExposedNewContact'] = {
            str(x['frame']): shortest_edge_hops(
                row['plateVertices'], {int(v) for f in x['plateFaces'] for v in faces[f]}, edges)
            for x in observed
        }
    groups = []
    by_index = {r['edge']: r for r in certificates}
    for group in components(by_index, edges):
        members = [by_index[i] for i in group]
        uvs = np.asarray([r['uvMidpoint'] for r in members])
        groups.append({'edges': group, 'count': len(group),
                       'uvBounds': [uvs.min(axis=0).tolist(), uvs.max(axis=0).tolist()],
                       'maxExcess': max(r['excess'] for r in members)})
    report = {
        'purpose': 'Diagnose necessary morph-aware smoothness changes; no corrected geometry produced.',
        'candidate': candidate['name'], 'cases': len(cases), 'edges': len(edges),
        'certifiedEdges': len(certificates), 'components': groups,
        'minimumUniformNeighborCapMultiplierToRemovePairwiseCertificates': maximum_uniform_neighbor_cap_multiplier_necessary,
        'worst': worst, 'caseFrequencyInWorstPairs': dict(Counter(name for r in certificates for name in r['cases'])),
        'observedVisibilitySubset': [{k: v for k, v in x.items() if k not in ('plateFaces', 'allExposedFaces')} for x in observed],
        'certificateEdgesIncidentToObservedExposedNewContact': {
            str(x['frame']): sum(r['exposedNewContactAtSampledFrames'][str(x['frame'])] for r in certificates)
            for x in observed},
        'certificateEdgesIncidentToAnyObservedExposedContact': {
            str(x['frame']): sum(r['anyExposedContactAtSampledFrames'][str(x['frame'])] for r in certificates)
            for x in observed},
        'minimumCertificateVertexGraphHopsToObservedExposedNewContact': {
            str(x['frame']): min((r['graphHopsToExposedNewContact'][str(x['frame'])]
                                  for r in certificates if r['graphHopsToExposedNewContact'][str(x['frame'])] is not None),
                                 default=None)
            for x in observed},
        'certificates': certificates,
        'inputs': [{'path': str(path), 'sha256': digest(path)} for path in
                   [Path(build['head']), Path(candidate['roundtrip']), mapping_path,
                    HERE / 'finite_correction_summary.json', visibility_path]],
        'limits': [
            'Necessary pairwise condition only. Morph-delta edits could remove this incompatibility but may create other contacts or alter expression.',
            'Equal-share number applies only if the two case-specific edge corrections split the necessary change evenly; it is not a per-case lower bound or proposed morph correction.',
            'Exposed contact overlap checks only frames 0 and 25; all 73 poses and 107 static cases remain required.',
        ],
    }
    out = HERE / 'morph-contact-boundary.json'
    out.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: report[k] for k in ('certifiedEdges', 'components', 'worst',
            'caseFrequencyInWorstPairs', 'certificateEdgesIncidentToObservedExposedNewContact')}, indent=2))


if __name__ == '__main__':
    main()
