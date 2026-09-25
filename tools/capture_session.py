"""Copy relevant existing logs and profile lists to a unique HQ evidence folder.

Does not launch the game, alter profiles, deploy mods or access Nexus credentials.
"""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import shutil

HQ=Path(__file__).resolve().parents[1]
GAME=Path('F:/Games/Cyberpunk 2077')
MO2=Path('F:/Games/MO2')
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--label',default='session')
parser.add_argument('--profile',default='2025 (again)',
                    help='MO2 profile whose modlist is captured (default: existing baseline profile)')
args=parser.parse_args()
if not args.label or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in args.label):
    raise SystemExit('Use a simple alphanumeric label.')
if (not args.profile or args.profile in {'.','..'} or
        any(c in args.profile for c in '/\\:') or
        any(ord(c) < 32 for c in args.profile)):
    raise SystemExit('Use a single existing MO2 profile directory name.')
profile=MO2/'profiles'/args.profile/'modlist.txt'
if not profile.is_file():
    raise SystemExit(f'Missing MO2 profile modlist: {profile}')
dest=HQ/'captures'/(dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'-'+args.label)
dest.mkdir(parents=True,exist_ok=False)
sources=[]
for prefix,root in [('game',GAME),('mo2-overwrite',MO2/'overwrite'),('mo2-legacy-overwrite',MO2/'_overwrite_')]:
    for group,folder,pattern in [('red4ext','red4ext/logs','red4ext*.log'),('archivexl','red4ext/plugins/ArchiveXL','*.log'),('tweakxl','red4ext/plugins/TweakXL','*.log'),('codeware','red4ext/plugins/Codeware','*.log'),('redscript','r6/logs','redscript*.log'),('xf-runtime-bridge','red4ext/logs','xfruntimebridge-*.log'),('xf-runtime-bridge-cet','bin/x64/plugins/cyber_engine_tweaks/mods/xf_runtime_bridge','*.log')]:
        candidates=list((root/folder).glob(pattern))
        if candidates: sources.append((f'{prefix}/{group}',max(candidates,key=lambda p:p.stat().st_mtime)))
    for name in ['cyber_engine_tweaks.log','scripting.log','gamelog.log']:
        p=root/'bin/x64/plugins/cyber_engine_tweaks'/name
        if p.exists(): sources.append((f'{prefix}/cet',p))
sources.append(('profile',profile))
manifest={'captured_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'label':args.label,'profile':args.profile,'sources':[],'warning':'Existing logs may be from earlier sessions. Use source timestamps and log headers, not the capture folder date, as session evidence.'}
for lane,path in sources:
    output=dest/lane/path.name
    output.parent.mkdir(parents=True,exist_ok=True)
    before=path.stat()
    shutil.copy2(path,output)
    after=path.stat()
    with output.open('rb') as f: digest=hashlib.file_digest(f,'sha256').hexdigest()
    manifest['sources'].append({'source':str(path),'copy':str(output.relative_to(dest)),'bytes':output.stat().st_size,'source_modified_utc':dt.datetime.fromtimestamp(before.st_mtime,dt.timezone.utc).isoformat(),'sha256':digest,'changed_during_copy':(before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns)})
(dest/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'capture':str(dest),'files':len(manifest['sources']),'changed_during_copy':sum(r['changed_during_copy'] for r in manifest['sources'])}))
