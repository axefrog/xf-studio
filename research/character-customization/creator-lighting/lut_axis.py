"""Neutral-axis response of a serialized CBitmapTexture 3D grading LUT (WolvenKit JSON): LogC3 (EI 800) in, linear out.
Usage: lut_axis.py <lut.xbm.json>..."""
import json,base64,numpy as np,math,sys,hashlib
def logc_dec(t):
    a,b,c,d,e,f=5.555556,0.052272,0.247190,0.385537,5.367655,0.092809
    return (10**((t-d)/c)-b)/a if t> e*0.010591+f else (t-f)/e
def logc_enc(x):
    return 0.247190*math.log10(5.555556*x+0.052272)+0.385537 if x>0.010591 else 5.367655*x+0.092809
def load(fn):
    d=json.load(open(fn)); r=d['Data']['RootChunk']
    raw=base64.b64decode(r['renderTextureResource']['renderResourceBlobPC']['Data']['textureData']['Bytes'])
    a=np.frombuffer(raw,dtype='<f4'); n=round((a.size/4)**(1/3)); return raw, a.reshape(n,n,n,4)
def sample(L,rgb):
    # trilinear, texcoord = logc*31 (half-texel mapping assumed: scale 31/32, bias 0.5/32)
    N=L.shape[0]-1; p=[logc_enc(max(v,-0.017))*N for v in rgb]  # [r,g,b] -> x,y,z
    x,y,z=[min(max(v,0),N) for v in p]
    x0,y0,z0=int(min(x,N-1)),int(min(y,N-1)),int(min(z,N-1)); fx,fy,fz=x-x0,y-y0,z-z0
    out=np.zeros(3)
    for dz in (0,1):
        for dy in (0,1):
            for dx in (0,1):
                w=(fx if dx else 1-fx)*(fy if dy else 1-fy)*(fz if dz else 1-fz)
                out+=w*L[z0+dz,y0+dy,x0+dx,:3]
    return out
def srgb(v): v=min(max(v,0),1); return 255*(12.92*v if v<=0.0031308 else 1.055*v**(1/2.4)-0.055)
for fn in sys.argv[1:]:
    raw,L=load(fn)
    print('==',fn.split('/')[-2] if '/' in fn else fn,'size',L.shape[0],'blob sha256',hashlib.sha256(raw).hexdigest()[:16])
    for x in [0.01,0.02,0.05,0.1,0.18,0.3,0.5,1.0,2.0,4.0]:
        o=sample(L,[x,x,x]); print(f'  grey {x:5.2f} -> linear {np.round(o,4)} sRGB8 {[round(srgb(v)) for v in o]}')
