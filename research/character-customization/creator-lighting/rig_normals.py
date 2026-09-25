"""Lambert-weighted light at the head for a few surface normals, under the hypotheses in rig_gains.py.
Usage: rig_normals.py <sector.json> <yaw> <head height> [--half]"""
import json, math, subprocess, sys
import os
rows=[json.loads(l) for l in subprocess.run([sys.executable,os.path.join(os.path.dirname(os.path.abspath(__file__)),'rig_table.py')]+sys.argv[1:4],capture_output=True,text=True).stdout.splitlines()]
HALF='--half' in sys.argv
def dec(c):
    c/=255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
normals={'face front (-Z)':(0,0,-1),'crown (+Y)':(0,1,0),'back (+Z)':(0,0,1),"character's right (+X)":(1,0,0),"character's left (-X)":(-1,0,0),'front-up 45':(0,0.707,-0.707)}
head=(0,float(sys.argv[3]),0)
res={}
for nname,n in normals.items():
    tot=[0,0,0]; per=[]
    for x in rows:
        p=x['three_pos']; v=[p[i]-head[i] for i in range(3)]; d=math.sqrt(sum(a*a for a in v)); l=[a/d for a in v]
        ndl=max(0,sum(a*b for a,b in zip(n,l)))
        r=x['radius']
        att=min(max(0,1-(d/r)**4)**2/max(d*d,1e-4),12) if x['atten']=='LA_InverseSquare' else 1-min(max(d/r,0),1)
        k=1 if HALF else 0.5
        co,ci=math.cos(math.radians(x['outer']*k)),math.cos(math.radians(max(x['inner'],0.01)*k))
        cone=max(0,min(1,(math.cos(math.radians(x['head_off_axis']))-co)/max(ci-co,1e-4)))**x['soft']
        col=(1,1,1) if x['color']=='default' else tuple(dec(c) for c in x['color'])
        e=x['lm']/(4*math.pi)*att*cone*ndl
        per.append((e,x['name']))
        for i in range(3): tot[i]+=e*col[i]
    per.sort(reverse=True)
    s=sum(tot) or 1
    print(f"{nname:24s} total={sum(tot)/3:6.2f} chroma(r,g,b)/mean={[round(3*t/s,2) for t in tot]} top={[ (n,round(e,2)) for e,n in per[:3]]}")
