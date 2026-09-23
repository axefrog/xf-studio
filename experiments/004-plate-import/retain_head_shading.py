"""Retain original game shading on an exact cut-out of the original game head.

Strict correspondence gates intentionally fail if future sculpting changes the surface.
This is not a general-purpose nearest-surface transfer or a geometry repair.
"""
import hashlib
import json
import struct
import numpy as np
from verify_roundtrip import Glb, ROOT

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    source=ROOT/'generated/raw/xfas_eye_plate.blender.glb'
    head_path=ROOT/'generated/roundtrip/vanilla_head.glb'
    plate,head=Glb(source),Glb(head_path)
    assert plate.mesh['extras']['targetNames']==head.mesh['extras']['targetNames']
    fields=['POSITION','TEXCOORD_0','TEXCOORD_1']
    pa={k:plate.attr(k) for k in fields}
    ha={k:head.attr(k) for k in fields}
    indices=[]
    for i in range(len(pa['POSITION'])):
        valid=np.ones(len(ha['POSITION']),dtype=bool)
        for k in fields:valid &= np.linalg.norm(ha[k]-pa[k][i],axis=1)<1e-8
        found=np.where(valid)[0]
        assert len(found)==1, f'Expected one exact head vertex for plate vertex {i}, found {len(found)}'
        indices.append(int(found[0]))
    worst_position_delta=0
    for pt,ht in zip(plate.p['targets'],head.p['targets']):
        error=float(np.linalg.norm(plate.array(pt['POSITION'])-head.array(ht['POSITION'])[indices],axis=1).max())
        worst_position_delta=max(worst_position_delta,error)
        assert error<1e-7,'Plate sculpt no longer matches source head: shading transfer requires reassessment'
    binary=bytearray(plate.bin)
    def replace(accessor, values):
        a=plate.doc['accessors'][accessor]
        view=plate.doc['bufferViews'][a['bufferView']]
        assert a['componentType']==5126 and 'sparse' not in a and 'byteStride' not in view
        assert values.shape==plate.array(accessor).shape and np.isfinite(values).all()
        encoded=values.astype('<f4').tobytes()
        offset=view.get('byteOffset',0)+a.get('byteOffset',0)
        binary[offset:offset+len(encoded)]=encoded
    replacement_summary={}
    for k in ['NORMAL','TANGENT']:
        original=plate.attr(k); replacement=head.attr(k)[indices]
        replacement_summary[k]={'maxBaseChange':float(np.linalg.norm(original-replacement,axis=1).max())}
        replace(plate.p['attributes'][k],replacement)
        clamped_before=0;max_after=0
        for pt,ht in zip(plate.p['targets'],head.p['targets']):
            clamped_before+=int((abs(plate.array(pt[k]))>1).sum())
            replacement=head.array(ht[k])[indices]
            max_after=max(max_after,float(abs(replacement).max()))
            assert max_after<=1
            replace(pt[k],replacement)
        replacement_summary[k].update({'outOfRangeComponentsBefore':clamped_before,'maxMorphComponentAfter':max_after})
    document=json.dumps(plate.doc,separators=(',',':')).encode()
    document+=b' '*((-len(document))%4)
    binary+=b'\x00'*((-len(binary))%4)
    total=12+8+len(document)+8+len(binary)
    output=source.with_name('xfas_eye_plate.glb')
    output.write_bytes(struct.pack('<4sII',b'glTF',2,total)+struct.pack('<II',len(document),0x4E4F534A)+document+struct.pack('<II',len(binary),0x004E4942)+binary)
    result=Glb(output)
    for k in ['POSITION','TEXCOORD_0','TEXCOORD_1','JOINTS_0','JOINTS_1','WEIGHTS_0','WEIGHTS_1','COLOR_0','COLOR_1']:
        assert np.array_equal(plate.attr(k),result.attr(k)),f'Unexpected change to {k}'
    for a,b in zip(plate.p['targets'],result.p['targets']):assert np.array_equal(plate.array(a['POSITION']),result.array(b['POSITION']))
    report={'method':'Exact base position, UV0 and UV1 correspondence, gated by all 105 position morphs',
        'inputs':[{'path':str(p),'sha256':sha(p)} for p in [source,head_path]],
        'output':{'path':str(output),'sha256':sha(output)},'vertices':len(indices),
        'maxMorphPositionCorrespondenceError':worst_position_delta,'changes':replacement_summary,
        'plateToHeadIndices':indices,'limitations':['Original game tangent-frame retention is justified for the unchanged cut surface only.',
            'Further sculpting and per-layer offsets require revalidation.','Rendering still requires game verification.']}
    (ROOT/'head-shading-transfer.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='plateToHeadIndices'},indent=2))

if __name__=='__main__':main()
