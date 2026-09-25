"""Extract a CC box light rig relative to its puppet marker/spawner. Output JSON list."""
import json,sys,math
def val(x):
    if isinstance(x,dict):
        if '$value' in x: return x['$value']
        if 'DepotPath' in x: return x['DepotPath'].get('$value')
    return x
def qrot(q,v):
    x,y,z,w=q; vx,vy,vz=v
    # v' = q v q*
    tx=2*(y*vz-z*vy); ty=2*(z*vx-x*vz); tz=2*(x*vy-y*vx)
    return (vx+w*tx+(y*tz-z*ty), vy+w*ty+(z*tx-x*tz), vz+w*tz+(x*ty-y*tx))
def rig(f):
    d=json.load(open(f)); root=d['Data']['RootChunk']; nodes=root['nodes']
    origin=None; lights=[]; others=[]
    for e in root['nodeData']['Data']:
        n=nodes[e['NodeIndex']]['Data']; p=e['Position']; q=e['Orientation']
        pos=(p['X'],p['Y'],p['Z']); quat=(q['i'],q['j'],q['k'],q['r'])
        dbg=val(n.get('debugName'))
        if n['$type']=='worldPopulationSpawnerNode': origin=pos
        if n['$type']=='worldStaticLightNode':
            c=n['color']; col=(c['Red'],c['Green'],c['Blue'],c['Alpha'])
            lights.append(dict(name=dbg,pos=pos,fwd=qrot(quat,(0,1,0)),intensity=n['intensity'],EV=n['EV'],unit=n['unit'],type=n['type'],color=col,temperature=n['temperature'],radius=n['radius'],inner=n['innerAngle'],outer=n['outerAngle'],atten=n['attenuation'],sourceRadius=n['sourceRadius'],softness=n['softness'],shadows=n['enableLocalShadows'],contact=n['contactShadows'],roughnessBias=n['roughnessBias'],spec=n['sceneSpecularScale'],diffuse=n['sceneDiffuse'],channel=n['lightChannel'],clamp=n['clampAttenuation']))
    for l in lights:
        l['rel']=tuple(round(a-b,3) for a,b in zip(l['pos'],origin))
        l['fwd']=tuple(round(a,3) for a in l['fwd'])
        del l['pos']
    return origin,sorted(lights,key=lambda l:l['name'])
if __name__=='__main__':
    for f in sys.argv[1:]:
        o,ls=rig(f); print('==',f,'origin',o)
        for l in ls: print(json.dumps(l))
