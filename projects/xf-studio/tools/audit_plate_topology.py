"""Read-only cut-surface, head correspondence and shape-deformation audit in Blender."""
import bpy
import hashlib
import json
from pathlib import Path
from collections import Counter
import numpy as np
from mathutils.kdtree import KDTree

HQ=Path(__file__).resolve().parents[3]
SOURCE=Path('F:/Games/RedModding/Projects/xf-eye-artistry-ccxl/v-character-model/v2/xfea_head2.blend')
before=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(SOURCE),load_ui=False,use_scripts=False)
plate=bpy.data.objects['submesh_00_LOD_1.010']
mesh=plate.data
xyz=np.array([v.co[:] for v in mesh.vertices])
tri=np.array([p.vertices[:] for p in mesh.polygons])
assert tri.shape[1]==3
def crosses(x):
    p=x[tri]
    return np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0])
base_cross=crosses(xyz)
base_area=np.linalg.norm(base_cross,axis=1)/2
edges=Counter(tuple(sorted(e)) for t in tri for e in [(t[0],t[1]),(t[1],t[2]),(t[2],t[0])])
boundary=[e for e,n in edges.items() if n==1]
boundary_degrees=Counter(v for e in boundary for v in e)
adj=[set() for _ in xyz]
for a,b in edges:adj[a].add(b);adj[b].add(a)
remaining=set(range(len(xyz)));components=[]
while remaining:
    pending=[remaining.pop()];seen=set(pending)
    while pending:
        for v in adj[pending.pop()] & remaining:remaining.remove(v);seen.add(v);pending.append(v)
    components.append(len(seen))
shapes=[]
for key in list(mesh.shape_keys.key_blocks)[1:]:
    pos=np.array([v.co[:] for v in key.data]);c=crosses(pos);areas=np.linalg.norm(c,axis=1)/2
    shapes.append({'name':key.name,'minArea':float(areas.min()),'nearZeroFaces':int((areas<1e-12).sum()),
        'normalTurnsOver90Degrees':int((np.sum(c*base_cross,axis=1)<0).sum()),
        'maxVertexDisplacement':float(np.linalg.norm(pos-xyz,axis=1).max())})
heads=[]
for o in bpy.data.objects:
    if o.type!='MESH' or not 7000<len(o.data.vertices)<7500 or not o.data.shape_keys:continue
    tree=KDTree(len(o.data.vertices))
    for v in o.data.vertices:tree.insert(v.co,v.index)
    tree.balance();matches=[tree.find(v.co) for v in mesh.vertices]
    indices=np.array([m[1] for m in matches]);dist=np.array([m[2] for m in matches])
    row={'name':o.name,'vertices':len(o.data.vertices),'maxBasisDistance':float(dist.max()),
         'meanBasisDistance':float(dist.mean()),'exactWithin1e-7':int((dist<1e-7).sum()),
         'uniqueMappedVertices':len(set(indices.tolist())),'hasCustomNormals':o.data.has_custom_normals}
    if dist.max()<1e-6:
        errors=[]
        for key in list(mesh.shape_keys.key_blocks)[1:]:
            other=o.data.shape_keys.key_blocks.get(key.name)
            if other:
                a=np.array([v.co[:] for v in key.data]);b=np.array([v.co[:] for v in other.data])[indices]
                errors.append({'name':key.name,'max':float(np.linalg.norm(a-b,axis=1).max())})
        row['morphCorrespondence']=errors
        row['plateToHeadVertexIndices']=indices.tolist()
    heads.append(row)
report={'source':str(SOURCE),'sha256':before,
    'userProvenance':'The maintainer confirms the expanded plate was cut from the larger head mesh (2026-09-23).',
    'vertices':len(xyz),'triangles':len(tri),'edges':len(edges),'boundaryEdges':len(boundary),
    'boundaryDegreeHistogram':dict(Counter(boundary_degrees.values())),
    'nonManifoldEdgesOver2Faces':sum(n>2 for n in edges.values()),'isolatedVertices':sum(not a for a in adj),
    'componentVertexCounts':sorted(components),'minBasisTriangleArea':float(base_area.min()),
    'nearZeroBasisFaces':int((base_area<1e-12).sum()),'hasCustomNormals':mesh.has_custom_normals,
    'allPolygonsSmooth':all(p.use_smooth for p in mesh.polygons),'shapeAudit':shapes,'headComparisons':heads,
    'limitations':['An open boundary is expected for a plate cut from a head; this is not a closed solid.',
        'Face-normal turns are candidates for inspection, not proof of self-intersection.',
        'No posed eyelid/animation intersection check in this audit.']}
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==before
out=HQ/'research/eye-artistry/evidence/plate-topology-audit.json'
out.write_text(json.dumps(report,indent=2)+'\n')
brief={k:v for k,v in report.items() if k not in ['shapeAudit','headComparisons']}
brief['shapesWithNearZeroFaces']=[s for s in shapes if s['nearZeroFaces']]
brief['shapesWithNormalTurns']=[s for s in shapes if s['normalTurnsOver90Degrees']]
brief['headComparisons']=[{k:v for k,v in h.items() if k not in ['morphCorrespondence','plateToHeadVertexIndices']} for h in heads]
print(json.dumps(brief,indent=2))
