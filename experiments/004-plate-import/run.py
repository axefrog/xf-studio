"""Rebuild the isolated plate fixture; never installs files into the game or MO2.

Requires fresh game JSON/extractions recorded by prepare_templates.py and owned master.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
HQ=HERE.parents[1]
PROJECT=HQ/'projects/xf-studio'
OUT=HERE/'generated'
WK=Path('F:/Games/RedModding/WolvenKit.Console/WolvenKit.CLI.exe')
BLENDER=Path('C:/Program Files/Blender Foundation/Blender 5.0/blender.exe')
ADAPTER=PROJECT/'tools/morph-import/bin/Debug/net9.0/MorphImport.dll'
DEPOT=Path('axefrog/appearance_studio/studies')
STUDIES=OUT/'archive'/DEPOT
logs=OUT/'logs';logs.mkdir(parents=True,exist_ok=True)
steps=[]
def run(name,args,env=None):
    result=subprocess.run([str(x) for x in args],cwd=HQ,env=env,text=True,encoding='utf-8',errors='replace',capture_output=True)
    log=result.stdout+'\n'+result.stderr
    (logs/f'{name}.log').write_text(log,encoding='utf-8')
    if result.returncode or re.search(r'Traceback \(most recent|\bError\s*\]|Unhandled exception',log,re.I):
        raise RuntimeError(f'{name} failed ({result.returncode}); see {logs/name}.log\n{log[-4000:]}')
    steps.append({'name':name,'exitCode':result.returncode})
    print(f'{name}: complete',flush=True)

run('export-blender',[BLENDER,'--background','--factory-startup','--python',PROJECT/'tools/export_plate.py'])
run('build-adapter',['dotnet','build',PROJECT/'tools/morph-import','--nologo','-v','quiet'])
head=HQ/'research/consumers/eye-plate/extracted/base/characters/head/player_base_heads/player_female_average/h0_000_pwa__morphs.morphtarget'
run('export-game-head',['dotnet',ADAPTER,'--export',head,OUT/'roundtrip/vanilla_head'])
run('retain-head-shading',[sys.executable,HERE/'retain_head_shading.py'])
run('prepare-templates',[sys.executable,HERE/'prepare_templates.py'])
run('deserialize',[WK,'convert','deserialize',OUT/'templates','-o',STUDIES])
env=os.environ.copy();env['GltfImportArgs__ImportFormat']='Mesh';env['GltfImportArgs__ImportGarmentSupport']='false'
run('mesh-import',[WK,'import',OUT/'raw/xfas_eye_plate.glb','-o',STUDIES,'--keep'],env)
lookup=OUT/'lookup'/DEPOT;lookup.mkdir(parents=True,exist_ok=True)
shutil.copy2(STUDIES/'xfas_eye_plate.mesh',lookup/'xfas_eye_plate.mesh')
run('pack-resolver',[WK,'pack',OUT/'lookup','-o',OUT/'packed'])
run('morph-import',['dotnet',ADAPTER,OUT/'packed/lookup.archive',OUT/'raw/xfas_eye_plate.glb',STUDIES/'xfas_eye_plate.morphtarget',OUT/'roundtrip/xfas_eye_plate.glb'])
run('numeric-comparison',[sys.executable,HERE/'verify_roundtrip.py'])
report={'steps':steps,'artifacts':[{'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in STUDIES.glob('xfas_eye_plate.*')],
    'installed':False,'gameRenderingVerified':False}
(HERE/'build-evidence.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
