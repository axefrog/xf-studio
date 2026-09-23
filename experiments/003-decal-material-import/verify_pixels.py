"""Inspect decoded XBM pixels against the original candidate, using actual shader channels."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
OUT=HERE/'generated'
def rgba(p): return np.asarray(Image.open(p).convert('RGBA'),dtype=np.float64)/255
def stats(a): return {'mean':float(a.mean()),'p95':float(np.percentile(a,95)),'max':float(a.max())}
def normals(xy):
    n=xy*2-1
    z=np.sqrt(np.maximum(0,1-np.sum(n*n,axis=2)))
    n=np.dstack([n,z])
    return n/np.linalg.norm(n,axis=2,keepdims=True)
report={'normals':[], 'scalars':[]}
for source in sorted((OUT/'input/normal').glob('*.png')):
    a=rgba(source); b=rgba(OUT/'export'/source.name)
    direct=np.abs(a[:,:,:2]-b[:,:,:2]); flipped=np.abs(a[:,:,:2]-b[::-1,:,:2])
    assert direct.mean()<flipped.mean(), 'Unexpected decoded row orientation'
    dot=np.clip(np.sum(normals(a[:,:,:2])*normals(b[:,:,:2]),axis=2),-1,1)
    degrees=np.degrees(np.arccos(dot))
    active=np.sum((a[:,:,:2]*2-1)**2,axis=2)>0.01
    report['normals'].append({'name':source.name,'xyAbsoluteError':stats(direct),
        'decodedRowOrder':'matches input','flippedXYMeanError':float(flipped.mean()),
        'angularErrorDegreesAll':stats(degrees),'angularErrorDegreesTiltedTexels':stats(degrees[active]),
        'blueChannelUsed':False})
for source in sorted((OUT/'input/scalar').glob('*.png')):
    a=rgba(source)[:,:,0];b=rgba(OUT/'export'/source.name)[:,:,0]
    report['scalars'].append({'name':source.name,'redAbsoluteError':stats(np.abs(a-b))})
coverage=np.frombuffer((OUT/'shape.rgba').read_bytes(),dtype=np.uint8).reshape(1024,1024,4)[:,:,3]/255
encoded=rgba(OUT/'input/colour/xfas_shape_diffuse.png')[:,:,3]
decoded=rgba(OUT/'export/xfas_shape_diffuse.png')[:,:,3]
transition=(coverage>0)&(coverage<1)
report['colourCoverage']={'expectedAtTexelCentres':'decoded alpha squared at contrast=0 and secondaryInfluence=0',
    'beforeImportError':stats(np.abs(encoded**2-coverage)[transition]),
    'afterBC7ImportError':stats(np.abs(decoded**2-coverage)[transition]),
    'uncompensatedSquareError':stats(np.abs(coverage**2-coverage)[transition])}
report['limits']=['Only base mip decoded here. Lower mip normal variance and coverage filtering remain unverified.',
    'Roundtrip row order does not prove mesh UV or tangent-space orientation in-game.',
    'BC5 blue output is ignored; Z is reconstructed as in the inspected shader.',
    'Scalar output is read from red, not RGB luminance; this matches the inspected shader.']
(HERE/'pixel-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'normalMaxAngleDegrees':max(r['angularErrorDegreesTiltedTexels']['max'] for r in report['normals']),
    'normalMeanAngleDegrees':{r['name']:r['angularErrorDegreesTiltedTexels']['mean'] for r in report['normals']},
    'coverage':report['colourCoverage']},indent=2))
