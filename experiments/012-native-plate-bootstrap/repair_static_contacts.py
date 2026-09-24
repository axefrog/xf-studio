"""Fit two observed eye-morph finite-contact pairs on the native topology."""
import argparse
import json, sys
from pathlib import Path
import numpy as np

root=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(root/'experiments/004-plate-import'),str(root/'experiments/006-plate-clearance'),
              str(Path(__file__).resolve().parent)]
from verify_roundtrip import Glb
from verify_crease_roundtrip import new_pairs
parser=argparse.ArgumentParser()
parser.add_argument('--head',type=Path,required=True)
parser.add_argument('--native',type=Path,required=True)
parser.add_argument('--input',type=Path,required=True)
parser.add_argument('--scipy-path',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
sys.path.insert(0,str(args.scipy_path))
from scipy.optimize import minimize

head=Glb(args.head)
native=Glb(args.native)
data=np.load(args.input)
base=data['base'].copy();morph=data['morph'].copy();mapping=data['mapping']
hb=head.attr('POSITION').astype(float)
ht=np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
pf=native.array(native.p['indices']).astype(int).reshape(-1,3)
hf=head.array(head.p['indices']).astype(int).reshape(-1,3)
edges=np.unique(np.sort(np.concatenate((pf[:,[0,1]],pf[:,[1,2]],pf[:,[2,0]])),axis=1),axis=0)
names=head.mesh['extras']['targetNames']
lookup={tuple(sorted(row)):i for i,row in enumerate(hf)}
source_faces=np.asarray([lookup[tuple(sorted(row))] for row in mapping[pf]])

def axes(a,b):
    ae=np.roll(a,-1,axis=0)-a;be=np.roll(b,-1,axis=0)-b
    raw=[np.cross(ae[0],ae[1]),np.cross(be[0],be[1])]
    raw += [np.cross(x,y) for x in ae for y in be]
    out=[]
    for v in raw:
        z=np.linalg.norm(v)
        if z<1e-14:continue
        for sign in (1,-1):
            axis=sign*v/z
            req=float(np.max(b@axis)-np.min(a@axis)+2e-6)
            out.append((req,axis))
    return sorted(out,key=lambda x:x[0])

def repair_static(name,plate_face,head_face,ring=1):
    global morph
    i=names.index(name)
    h=hb+ht[i];d=base+morph[i];p=h[mapping]+d
    pair=new_pairs(p[pf],h[hf],source_faces,hf)
    assert [plate_face,head_face] in pair.tolist()
    face=pf[plate_face]
    vertices=set(map(int,face))
    for _ in range(ring):
        frontier=vertices.copy()
        vertices.update(int(v) for e in edges if e[0] in frontier or e[1] in frontier for v in e)
    vertices=np.array(sorted(vertices),dtype=int)
    index={int(v):j for j,v in enumerate(vertices)}
    local_edges=np.flatnonzero(np.isin(edges,vertices).any(axis=1))
    e=edges[local_edges]
    A=np.zeros((len(e),len(vertices)))
    for j,(a,b) in enumerate(e):
        if int(a) in index:A[j,index[int(a)]]+=1
        if int(b) in index:A[j,index[int(b)]]-=1
    cap=np.minimum(5e-5,.25*np.linalg.norm(h[mapping[e[:,0]]]-h[mapping[e[:,1]]],axis=1))*1e6
    initial=(d[e[:,0]]-d[e[:,1]])*1e6
    pa=p[face];hbtri=h[hf[head_face]]
    attempts=[]
    for required,axis in axes(pa,hbtri)[:8]:
        rhs=(np.max(hbtri@axis)+2e-6-pa@axis)*1e6
        def diff(x):return initial+A@x.reshape(-1,3)
        def fun(x):return cap-np.linalg.norm(diff(x),axis=1)-.1
        def jac(x):
            v=diff(x);unit=v/np.maximum(np.linalg.norm(v,axis=1)[:,None],1e-20)
            return -(A[:,:,None]*unit[:,None,:]).reshape(len(e),-1)
        face_idx=[index[int(v)] for v in face]
        def sep(x):return x.reshape(-1,3)[face_idx]@axis-rhs
        def sep_jac(x):
            matrix=np.zeros((3,len(vertices),3))
            for j,k in enumerate(face_idx):matrix[j,k]=axis
            return matrix.reshape(3,-1)
        x0=np.zeros((len(vertices),3))
        for j,k in enumerate(face_idx):x0[k]=max(rhs[j],0)*axis
        res=minimize(lambda x:.5*x@x,x0.ravel(),jac=lambda x:x,
                     method='SLSQP',bounds=[(-30,30)]*(len(vertices)*3),
                     constraints=[{'type':'ineq','fun':fun,'jac':jac},
                                  {'type':'ineq','fun':sep,'jac':sep_jac}],
                     options={'maxiter':150,'ftol':1e-9})
        update=np.zeros_like(d);update[vertices]=res.x.reshape(-1,3)/1e6
        candidate=d+update
        new=new_pairs((h[mapping]+candidate)[pf],h[hf],source_faces,hf)
        cap_full=np.minimum(5e-5,.25*np.linalg.norm(h[mapping[edges[:,0]]]-h[mapping[edges[:,1]]],axis=1))
        gap=np.linalg.norm(candidate[edges[:,0]]-candidate[edges[:,1]],axis=1)
        row=(res.success,float(fun(res.x).min()),float(sep(res.x).min()),
             int(np.sum(gap>cap_full+1e-10)),new.tolist(),float(np.linalg.norm(update,axis=1).max()),
             required,axis)
        attempts.append(row)
        print('attempt',name,'ring',ring,'required',required*1e6,'success',row[:6],flush=True)
        if res.success and row[3]==0 and not len(new) and np.linalg.norm(candidate,axis=1).max()<=.00025+1e-10:
            morph[i]+=update
            return True
    return False

for name,a,b in [('h031_eyes',2889,12308),('h141_eyes',2892,12419)]:
    ok=repair_static(name,a,b,ring=1)
    print('repair',name,ok,flush=True)
    assert ok
args.output.parent.mkdir(parents=True,exist_ok=True)
np.savez_compressed(args.output,base=base,morph=morph,mapping=mapping)
