"""Print every node of a serialized .streamingsector (WolvenKit JSON), with light parameters."""
import json,sys,math
def val(x):
    if isinstance(x,dict):
        if '$value' in x: return x['$value']
        if 'DepotPath' in x: return x['DepotPath'].get('$value')
    return x
for f in sys.argv[1:]:
    d=json.load(open(f))
    root=d['Data']['RootChunk']
    nodes=root['nodes']; nd=root['nodeData']['Data']
    print('=====',f,'nodeRefs:',[val(r) for r in root.get('nodeRefs',[])][:20])
    for e in nd:
        n=nodes[e['NodeIndex']]['Data']; t=n['$type']
        p=e['Position']; q=e['Orientation']; s=e['Scale']
        pos=(round(p['X'],3),round(p['Y'],3),round(p['Z'],3))
        quat=(round(q['i'],4),round(q['j'],4),round(q['k'],4),round(q['r'],4))
        line=f"[{e['NodeIndex']}] {t} dbg={val(n.get('debugName'))} pos={pos} q={quat} scale={(s['X'],s['Y'],s['Z'])} qref={val(e.get('QuestPrefabRefHash'))}"
        print(line)
        if 'Light' in t:
            keys=['type','unit','intensity','EV','color','temperature','radius','innerAngle','outerAngle','attenuation','sourceRadius','softness','enableLocalShadows','contactShadows','shadowSoftnessMode','areaShape','areaRectSideA','areaRectSideB','capsuleLength','spotCapsule','directional','lightChannel','group','envColorGroup','sceneDiffuse','sceneSpecularScale','roughnessBias','scaleEnvProbes','scaleGI','scaleVolFog','clampAttenuation','iesProfile','colorGroupSaturation','useInTransparents','shadowRadius','shadowAngle','allowDistantLight']
            out={}
            for k in keys:
                v=n.get(k)
                if isinstance(v,dict) and 'Red' in v: v=(v['Red'],v['Green'],v['Blue'])
                else: v=val(v)
                out[k]=v
            print('     ',out)
        elif t=='worldEntityNode' or 'Entity' in t:
            print('      entity=',val(n.get('entityTemplate')), 'app=',val(n.get('appearanceName')))
        elif 'Mesh' in t:
            print('      mesh=',val(n.get('mesh')), 'app=',val(n.get('meshAppearance')))
        elif 'Marker' in t:
            print('      ', {k:val(v) for k,v in n.items() if k not in ('$type',)})
        elif 'Collision' in t: pass
        else:
            print('      ', json.dumps({k:val(v) for k,v in n.items() if k not in ('$type',)})[:600])
