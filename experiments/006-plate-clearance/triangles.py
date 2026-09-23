"""Triangle contact query: spatial-grid broad phase, segment/triangle + coplanar narrow phase.

Contact includes shared edges/vertices. Degenerate triangles are reported separately.
This checks sampled surfaces, not continuous collision or inside/outside of an open head.
"""
from itertools import product
import numpy as np

def cross2(a, b): return a[...,0]*b[...,1]-a[...,1]*b[...,0]

def intersect_pairs(a, b):
    assert a.shape == b.shape and a.shape[1:] == (3,3)
    hit = np.zeros(len(a),dtype=bool)
    for segment, triangle in [(a,b),(b,a)]:
        edge1 = triangle[:,1]-triangle[:,0]
        edge2 = triangle[:,2]-triangle[:,0]
        for i in range(3):
            origin = segment[:,i]
            direction = segment[:,(i+1)%3]-origin
            h = np.cross(direction,edge2)
            det = np.sum(edge1*h,axis=1)
            good = abs(det)>1e-18
            denominator = np.where(good,det,1)
            s = origin-triangle[:,0]
            u = np.sum(s*h,axis=1)/denominator
            q = np.cross(s,edge1)
            v = np.sum(direction*q,axis=1)/denominator
            t = np.sum(edge2*q,axis=1)/denominator
            hit |= good & (u>=-1e-8) & (v>=-1e-8) & (u+v<=1+1e-8) & (t>=-1e-8) & (t<=1+1e-8)
    an = np.cross(a[:,1]-a[:,0],a[:,2]-a[:,0])
    bn = np.cross(b[:,1]-b[:,0],b[:,2]-b[:,0])
    al = np.linalg.norm(an,axis=1); bl = np.linalg.norm(bn,axis=1)
    valid = (al>1e-16)&(bl>1e-16)
    parallel = np.linalg.norm(np.cross(an,bn),axis=1) <= al*bl*1e-9
    planar = abs(np.sum((a[:,0]-b[:,0])*bn,axis=1)) <= bl*1e-9
    coplanar = valid & parallel & planar & ~hit
    drop = np.argmax(abs(bn),axis=1)
    for axis in range(3):
        subset = np.where(coplanar & (drop==axis))[0]
        if not len(subset): continue
        keep = [i for i in range(3) if i!=axis]
        x = a[subset][:,:,keep]; y = b[subset][:,:,keep]
        cop_hit = np.zeros(len(subset),dtype=bool)
        for p, tri in [(x[:,0],y),(y[:,0],x)]:
            orientations = np.stack([cross2(tri[:,(i+1)%3]-tri[:,i],p-tri[:,i]) for i in range(3)],axis=1)
            cop_hit |= (orientations>=-1e-16).all(axis=1)|(orientations<=1e-16).all(axis=1)
        for i in range(3):
            for j in range(3):
                p,q=x[:,i],x[:,(i+1)%3];r,s=y[:,j],y[:,(j+1)%3]
                o1,o2=cross2(q-p,r-p),cross2(q-p,s-p)
                o3,o4=cross2(s-r,p-r),cross2(s-r,q-r)
                boxes=(np.maximum(np.minimum(p,q),np.minimum(r,s))<=np.minimum(np.maximum(p,q),np.maximum(r,s))+1e-12).all(axis=1)
                cop_hit |= boxes & (o1*o2<=1e-30) & (o3*o4<=1e-30)
        hit[subset] |= cop_hit
    return hit & valid

def contacts(plate, head, cell=.01):
    epsilon=1e-9
    pmin,pmax=plate.min(axis=1)-epsilon,plate.max(axis=1)+epsilon
    hmin,hmax=head.min(axis=1)-epsilon,head.max(axis=1)+epsilon
    active=np.where((hmax>=pmin.min(axis=0)).all(axis=1)&(hmin<=pmax.max(axis=0)).all(axis=1))[0]
    grid={}
    def cells(lo,hi):
        lower=np.floor(lo/cell).astype(int);upper=np.floor(hi/cell).astype(int)
        yield from product(*(range(lower[k],upper[k]+1) for k in range(3)))
    for j in active:
        for key in cells(hmin[j],hmax[j]):grid.setdefault(key,[]).append(j)
    pairs=[]
    for i in range(len(plate)):
        possible=set()
        for key in cells(pmin[i],pmax[i]):possible.update(grid.get(key,[]))
        if not possible:continue
        candidates=np.fromiter(possible,dtype=int)
        candidates=candidates[(hmax[candidates]>=pmin[i]).all(axis=1)&(hmin[candidates]<=pmax[i]).all(axis=1)]
        pairs.extend((i,int(j)) for j in candidates)
    pairs=np.array(pairs,dtype=int).reshape(-1,2)
    hits=[]
    for start in range(0,len(pairs),16000):
        part=pairs[start:start+16000]
        hits.extend(part[intersect_pairs(plate[part[:,0]],head[part[:,1]])].tolist())
    return {'candidatePairs':len(pairs),'contactPairs':len(hits),
        'plateTrianglesInContact':len({i for i,j in hits}),'pairs':hits,
        'degeneratePlateTriangles':int((np.linalg.norm(np.cross(plate[:,1]-plate[:,0],plate[:,2]-plate[:,0]),axis=1)<=1e-16).sum()),
        'degenerateHeadTriangles':int((np.linalg.norm(np.cross(head[:,1]-head[:,0],head[:,2]-head[:,0]),axis=1)<=1e-16).sum())}

def self_test():
    base=np.array([[0.,0,0],[1,0,0],[0,1,0]])
    others=np.array([
        [[.2,.2,-1],[.2,.2,1],[.8,.2,0]], # transversal
        base+[0,0,.00005], # deliberately microscopic separation
        [[.1,.1,0],[.2,.1,0],[.1,.2,0]], # coplanar contained
        base+[2,2,0], # coplanar disjoint
        [[1.,0,0],[2,0,0],[1,1,0]], # touching edge/vertex
        [[.2,.2,0],[.2,.2,0],[.2,.2,0]], # degenerate excluded
    ])
    expected=[True,False,True,False,True,False]
    repeated=np.repeat(base[None],len(others),axis=0)
    for scale in [1,.001]:
        assert intersect_pairs(repeated*scale,others*scale).tolist()==expected
        assert intersect_pairs(others*scale,repeated*scale).tolist()==expected
    # Exercise broad phase against an independent all-pairs query.
    rng=np.random.default_rng(421)
    a=rng.uniform(-.015,.015,(19,3,3));b=rng.uniform(-.015,.015,(23,3,3))
    brute={(i,j) for i in range(len(a)) for j in range(len(b)) if intersect_pairs(a[i:i+1],b[j:j+1])[0]}
    assert {tuple(p) for p in contacts(a,b)['pairs']}==brute

if __name__=='__main__':self_test();print('Triangle contact synthetic and broad-phase checks passed')
