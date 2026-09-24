"""Local morph fit for selected finite posed-contact witnesses."""
import argparse
import json, sys, itertools
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
parser.add_argument('--prior-map',type=Path,required=True)
parser.add_argument('--dense',type=Path,required=True)
parser.add_argument('--scipy-path',type=Path,required=True)
parser.add_argument('--frames',type=int,nargs='+',required=True)
parser.add_argument('--expected-hits',type=int,required=True)
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
saved=[names.index(n) for n in ('h091_eyes','h012_nose','h053_mouth','h054_jaw','h145_ear')]
eye=names.index('h091_eyes')
lookup={tuple(sorted(row)):i for i,row in enumerate(hf)}
source_faces=np.asarray([lookup[tuple(sorted(row))] for row in mapping[pf]])
old_map=np.asarray(json.loads(args.prior_map.read_text())['plateToHeadIndices'],int)
first={}
for j,h in enumerate(old_map):first.setdefault(int(h),j)
old_indices=np.array([first[int(h)] for h in mapping])
dense=args.dense
hp=np.memmap(dense/'head.positions.f64',dtype='<f8',mode='r',shape=(664,len(hb),3))
old_linear=np.memmap(dense/'fixed_linear.f64',dtype='<f8',mode='r',shape=(664,len(old_map),3,3))
frames=tuple(args.frames)
residual=base+morph[saved].sum(0)

def positions(frame,residual):
    return hp[frame,mapping]+np.einsum('vij,vj->vi',old_linear[frame,old_indices],residual)

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

hits=[]
for frame in frames:
    p=positions(frame,residual)
    pairs=new_pairs(p[pf],hp[frame,hf],source_faces,hf)
    print('start',frame,pairs.tolist(),flush=True)
    hits.extend((frame,int(a),int(b)) for a,b in pairs)
assert len(hits)==args.expected_hits
vertices=set(int(v) for _,face,_ in hits for v in pf[face])
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
cases=[]
for ids in ([eye],saved):
    h=hb[mapping]+ht[ids][:,mapping].sum(0)
    d=base+morph[ids].sum(0)
    cap=np.minimum(5e-5,.25*np.linalg.norm(h[e[:,0]]-h[e[:,1]],axis=1))*1e6
    initial=(d[e[:,0]]-d[e[:,1]])*1e6
    cases.append((initial,cap))
axis_options=[]
for frame,plate_face,head_face in hits:
    p=positions(frame,residual)
    options=axes(p[pf[plate_face]],hp[frame,hf[head_face]])[:4]
    print('pair',frame,plate_face,head_face,'options',[x[0]*1e6 for x in options],flush=True)
    axis_options.append(options)

def try_axes(chosen):
    B=[];rhs=[]
    for (frame,plate_face,head_face),(required,axis) in zip(hits,chosen):
        p=positions(frame,residual)
        face=pf[plate_face]
        bound=np.max(hp[frame,hf[head_face]]@axis)+2e-6
        for v in face:
            row=np.zeros((len(vertices),3))
            row[index[int(v)]]=old_linear[frame,old_indices[v]].T@axis
            B.append(row.ravel())
            rhs.append((bound-p[v]@axis)*1e6)
    B=np.asarray(B);rhs=np.asarray(rhs)
    def norm(x):
        shifted=A@x.reshape(-1,3)
        return [(initial+shifted) for initial,_ in cases]
    def fun(x):
        return np.concatenate([cap-np.linalg.norm(d,axis=1)-.1 for d,(_,cap) in zip(norm(x),cases)])
    def jac(x):
        rows=[]
        for d in norm(x):
            u=d/np.maximum(np.linalg.norm(d,axis=1)[:,None],1e-20)
            rows.append(-(A[:,:,None]*u[:,None,:]).reshape(len(e),-1))
        return np.vstack(rows)
    result=minimize(lambda x:.5*x@x,np.zeros(len(vertices)*3),jac=lambda x:x,
                    method='SLSQP',bounds=[(-40,40)]*(len(vertices)*3),
                    constraints=[{'type':'ineq','fun':fun,'jac':jac},
                                 {'type':'ineq','fun':lambda x:B@x-rhs,'jac':lambda x:B}],
                    options={'maxiter':200,'ftol':1e-8})
    update=np.zeros_like(base);update[vertices]=result.x.reshape(-1,3)/1e6
    trial=morph[eye]+update
    gap=[]
    for ids in ([eye],saved):
        h=hb[mapping]+ht[ids][:,mapping].sum(0)
        d=base+morph[ids].sum(0)+update
        cap=np.minimum(5e-5,.25*np.linalg.norm(h[edges[:,0]]-h[edges[:,1]],axis=1))
        gap.append(int(np.count_nonzero(np.linalg.norm(d[edges[:,0]]-d[edges[:,1]],axis=1)>cap+1e-10)))
    residual_trial=residual+update
    contacts=[]
    for frame in frames:
        p=positions(frame,residual_trial)
        contacts.append((frame,new_pairs(p[pf],hp[frame,hf],source_faces,hf).tolist()))
    displacement=max(np.linalg.norm(base+trial,axis=1).max(),np.linalg.norm(residual_trial,axis=1).max())
    print('trial',result.success,result.message,'min edge',float(fun(result.x).min()),
          'min sep',float((B@result.x-rhs).min()),'gap',gap,'contacts',contacts,
          'max step',np.linalg.norm(update,axis=1).max(),'disp',displacement,flush=True)
    return result.success and not any(gap) and all(not p for _,p in contacts) and displacement<=.00025+1e-10,update

for combo in itertools.product(*axis_options):
    success,update=try_axes(combo)
    if success:
        morph[eye]+=update
        print('SUCCESS',flush=True)
        break
else:raise AssertionError('No local axis assignment satisfies selected constraints')
args.output.parent.mkdir(parents=True,exist_ok=True)
np.savez_compressed(args.output,base=base,morph=morph,mapping=mapping)
