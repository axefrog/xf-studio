"""Numerically compare authored GLB with the WolvenKit morph-resource round trip."""
import hashlib
import json
import struct
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent

class Glb:
    def __init__(self, path):
        self.path = path
        data = path.read_bytes()
        assert data[:4] == b'glTF'
        n, kind = struct.unpack_from('<II', data, 12)
        assert kind == 0x4E4F534A
        self.doc = json.loads(data[20:20+n])
        size, kind = struct.unpack_from('<II', data, 20+n)
        assert kind == 0x004E4942
        self.bin = data[28+n:28+n+size]
        self.mesh = self.doc['meshes'][0]
        assert len(self.mesh['primitives']) == 1
        self.p = self.mesh['primitives'][0]

    def array(self, index):
        a = self.doc['accessors'][index]
        assert 'sparse' not in a, 'Dense exporter required for this fixture'
        view = self.doc['bufferViews'][a['bufferView']]
        dtype = np.dtype({5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']])
        width = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
        offset = view.get('byteOffset',0)+a.get('byteOffset',0)
        result = np.ndarray((a['count'],width),dtype=dtype,buffer=self.bin,offset=offset,
                            strides=(view.get('byteStride',width*dtype.itemsize),dtype.itemsize)).astype(float)
        if a.get('normalized'):
            result /= np.iinfo(dtype).max
            if dtype.kind == 'i': result = np.maximum(result,-1)
        assert np.isfinite(result).all()
        return result

    def attr(self, name): return self.array(self.p['attributes'][name])
    def bones(self): return [self.doc['nodes'][n]['name'] for n in self.doc['skins'][0]['joints']]
    def weights(self, all_bones):
        names = self.bones()
        out = np.zeros((len(self.attr('POSITION')),len(all_bones)))
        rows = np.arange(len(out))[:,None]
        for slot in range(2):
            joints = self.attr(f'JOINTS_{slot}').astype(int)
            indices = np.array([all_bones.index(n) for n in names])[joints]
            np.add.at(out,(rows,indices),self.attr(f'WEIGHTS_{slot}'))
        return out

def delta(a,b):
    d = np.linalg.norm(a-b,axis=1)
    return {'max':float(d.max()),'mean':float(d.mean()),'p95':float(np.percentile(d,95))}

def compare():
    a = Glb(ROOT/'generated/raw/xfas_eye_plate.glb')
    b = Glb(ROOT/'generated/roundtrip/xfas_eye_plate.glb.glb')
    assert a.mesh['extras']['targetNames'] == b.mesh['extras']['targetNames']
    assert np.array_equal(a.array(a.p['indices']),b.array(b.p['indices'])), 'Triangle correspondence changed'
    attributes = {k:delta(a.attr(k),b.attr(k)) for k in ['POSITION','NORMAL','TANGENT','TEXCOORD_0','TEXCOORD_1','COLOR_0']}
    targets = []
    for name,ta,tb in zip(a.mesh['extras']['targetNames'],a.p['targets'],b.p['targets']):
        targets.append({'name':name,**{k:delta(a.array(ta[k]),b.array(tb[k])) for k in ['POSITION','NORMAL','TANGENT']}})
    bones = sorted(set(a.bones())|set(b.bones()))
    wa,wb = a.weights(bones),b.weights(bones)
    weighted_a = {bones[i] for i in np.where(wa.max(axis=0)>0)[0]}
    weighted_b = {bones[i] for i in np.where(wb.max(axis=0)>0)[0]}
    # Bounds cover the observed resource quantization; fail on lost data or shading clipping.
    assert attributes['POSITION']['max'] < 5e-6
    assert attributes['NORMAL']['max'] < .002 and attributes['TANGENT']['max'] < .002
    assert attributes['TEXCOORD_0']['max'] == 0 and attributes['TEXCOORD_1']['max'] == 0
    assert max(t['POSITION']['max'] for t in targets) < 2e-5
    assert max(t[k]['max'] for t in targets for k in ['NORMAL','TANGENT']) < .004
    assert weighted_a == weighted_b and (wb>0).sum(axis=1).max() == 8
    assert abs(wa-wb).max() < .005 and abs(wb.sum(axis=1)-1).max() < 1e-6
    report = {'source':str(a.path),'roundtrip':str(b.path),
        'hashes':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [a.path,b.path]},
        'vertices':len(a.attr('POSITION')),'triangles':len(a.array(a.p['indices']))//3,
        'morphCount':len(targets),'morphOrderEqual':True,'triangleIndicesEqual':True,
        'numericAcceptancePassed':True,
        'attributes':attributes,'targets':targets,
        'weights':{'sourceBones':len(a.bones()),'outputBones':len(b.bones()),
            'sourceWeightedBones':len(weighted_a),'outputWeightedBones':len(weighted_b),
            'lostWeightedBones':sorted(weighted_a-weighted_b),'maxAbsoluteError':float(abs(wa-wb).max()),
            'sourceMaxInfluences':int((wa>0).sum(axis=1).max()),'outputMaxInfluences':int((wb>0).sum(axis=1).max()),
            'sourceMaxSumError':float(abs(wa.sum(axis=1)-1).max()),'outputMaxSumError':float(abs(wb.sum(axis=1)-1).max())},
        'limitations':['Does not prove in-game rendering, skin clearance or runtime animation.','Colour set 1 is not present in the game round-trip export.','Rig hierarchy and inverse bind transforms require separate inspection.']}
    (ROOT/'roundtrip-comparison.json').write_text(json.dumps(report,indent=2)+'\n')
    brief={k:v for k,v in report.items() if k!='targets'}
    brief['maxMorphErrors']={k:max(t[k]['max'] for t in targets) for k in ['POSITION','NORMAL','TANGENT']}
    print(json.dumps(brief,indent=2))

if __name__ == '__main__': compare()
