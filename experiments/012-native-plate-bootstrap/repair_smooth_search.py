"""Local base-field fit to the seven failed native edges; numeric research only."""
import argparse
import json, sys
from pathlib import Path
from collections import defaultdict
import numpy as np

root=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(root/'experiments/004-plate-import'),str(root/'experiments/006-plate-clearance'),
              str(Path(__file__).resolve().parent)]
from verify_roundtrip import Glb
from verify_crease_roundtrip import new_pairs
parser=argparse.ArgumentParser()
parser.add_argument('--head',type=Path,required=True)
parser.add_argument('--native',type=Path,required=True)
parser.add_argument('--native-map',type=Path,required=True)
parser.add_argument('--prior-packed',type=Path,required=True)
parser.add_argument('--prior-map',type=Path,required=True)
parser.add_argument('--scipy-path',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
sys.path.insert(0,str(args.scipy_path))
from scipy.optimize import minimize

head=Glb(args.head)
native=Glb(args.native)
prior=Glb(args.prior_packed)
mapping=np.asarray(json.loads(args.native_map.read_text())['plateToHeadIndices'],int)
old_map=np.asarray(json.loads(args.prior_map.read_text())['plateToHeadIndices'],int)
assert len(mapping)==1620 and len(old_map)==1635 and set(mapping)==set(old_map)
groups=defaultdict(list)
for i,h in enumerate(old_map):groups[int(h)].append(i)
hb=head.attr('POSITION').astype(float)
ht=np.stack([head.array(t['POSITION']).astype(float) for t in head.p['targets']])
pb=prior.attr('POSITION').astype(float)
pt=np.stack([prior.array(t['POSITION']).astype(float) for t in prior.p['targets']])
old_base=pb-hb[old_map]
old_morph=pt-ht[:,old_map]
base=np.stack([old_base[groups[int(h)]].mean(0) for h in mapping])
morph=np.stack([old_morph[:,groups[int(h)]].mean(1) for h in mapping],axis=1)
pf=native.array(native.p['indices']).astype(int).reshape(-1,3)
hf=head.array(head.p['indices']).astype(int).reshape(-1,3)
edges=np.unique(np.sort(np.concatenate((pf[:,[0,1]],pf[:,[1,2]],pf[:,[2,0]])),axis=1),axis=0)
names=head.mesh['extras']['targetNames']
saved=[names.index(n) for n in ('h091_eyes','h012_nose','h053_mouth','h054_jaw','h145_ear')]
cases=[('Basis',[])]+[(name,[i]) for i,name in enumerate(names)]+[('saved_v',saved)]
d=np.stack([base+morph[ids].sum(0) if ids else base for _,ids in cases])
case_head=np.stack([hb[mapping]+ht[ids][:,mapping].sum(0) if ids else hb[mapping] for _,ids in cases])
caps=np.minimum(5e-5,.25*np.linalg.norm(case_head[:,edges[:,0]]-case_head[:,edges[:,1]],axis=2))
gaps=np.linalg.norm(d[:,edges[:,0]]-d[:,edges[:,1]],axis=2)
failing=np.flatnonzero(np.any(gaps>caps+1e-10,axis=0))
vertices=np.unique(edges[failing].ravel())
near=np.flatnonzero(np.isin(edges,vertices).any(axis=1))
assert len(failing)==7 and len(vertices)==12
print('local',len(near), 'global fail',sum((gaps>caps+1e-10).ravel()),flush=True)
sel_edges=edges[near]
A=np.zeros((len(near),len(vertices)))
local={int(v):i for i,v in enumerate(vertices)}
for i,(a,b) in enumerate(sel_edges):
    if int(a) in local:A[i,local[int(a)]]+=1
    if int(b) in local:A[i,local[int(b)]]-=1
dv=d[:,sel_edges[:,0]]-d[:,sel_edges[:,1]]
limit=caps[:,near]
scale=1e6
dv*=scale
limit*=scale

def trial(x):
    field=x.reshape(len(vertices),3)
    diff=dv+(A@field)[None]
    norm=np.linalg.norm(diff,axis=2)
    unit=diff/np.maximum(norm[:,:,None],1e-20)
    return diff,norm,unit

def fun(x):return limit-trial(x)[1]-2.0
def jac(x):
    unit=trial(x)[2]
    return -(A[None,:,:,None]*unit[:,:,None,:]).reshape(-1,len(vertices)*3)

res=minimize(lambda x:.5*x@x,np.zeros(len(vertices)*3),jac=lambda x:x,
             method='SLSQP',bounds=[(-50,50)]*(len(vertices)*3),
             constraints=[{'type':'ineq','fun':lambda x:fun(x).ravel(),'jac':jac}],
             options={'maxiter':250,'ftol':1e-8,'disp':True})
print('opt',res.success,res.message,res.nit,float(fun(res.x).min()),float(np.max(np.abs(res.x))),flush=True)
assert res.success and fun(res.x).min()>-1e-7
base[vertices]+=res.x.reshape(-1,3)/scale
d=np.stack([base+morph[ids].sum(0) if ids else base for _,ids in cases])
gap=np.linalg.norm(d[:,edges[:,0]]-d[:,edges[:,1]],axis=2)
bad=np.argwhere(gap>caps+1e-10)
print('post gaps',len(bad),'max excess',np.max(gap-caps),'max disp',np.linalg.norm(d,axis=2).max(),flush=True)
assert len(bad)==0 and np.linalg.norm(d,axis=2).max()<=.00025+1e-10
lookup={tuple(sorted(row)):i for i,row in enumerate(hf)}
source_faces=np.asarray([lookup[tuple(sorted(row))] for row in mapping[pf]])
contacts=[]
for case_id,(label,ids) in enumerate(cases):
    h=hb+ht[ids].sum(0) if ids else hb
    p=h[mapping]+d[case_id]
    pairs=new_pairs(p[pf],h[hf],source_faces,hf)
    if len(pairs):contacts.append((label,pairs.tolist()))
print('contacts',contacts,flush=True)
assert [(name,len(pairs)) for name,pairs in contacts]==[('h031_eyes',1),('h141_eyes',1)]
args.output.parent.mkdir(parents=True,exist_ok=True)
np.savez_compressed(args.output,base=base,morph=morph,mapping=mapping)
