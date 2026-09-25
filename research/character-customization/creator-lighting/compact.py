"""Collapse WolvenKit JSON curves/handles into short values for reading."""
import json
def compact(v):
    if isinstance(v,dict) and "Elements" in v and all(isinstance(e,dict) for e in v["Elements"]):
        els=v['Elements']
        vals=[(e.get('Point'), compact(e.get('Value'))) for e in els]
        if len(vals)==0: return None
        if len(set(json.dumps(x[1]) for x in vals))==1: return vals[0][1]
        return vals
    if isinstance(v,dict) and v.get('$type')=='HDRColor': return tuple(round(v[c],4) for c in ('Red','Green','Blue','Alpha'))
    if isinstance(v,dict) and '$value' in v: return v['$value']
    if isinstance(v,dict) and 'DepotPath' in v: return v['DepotPath']['$value']
    if isinstance(v,dict) and 'Data' in v and isinstance(v['Data'],dict): return {k:compact(x) for k,x in v['Data'].items() if k!='$type'}
    if isinstance(v,dict): return {k:compact(x) for k,x in v.items() if k!='$type'}
    if isinstance(v,list): return [compact(x) for x in v]
    return v
