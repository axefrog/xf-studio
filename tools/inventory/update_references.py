"""Fast-forward external Cyberpunk reference clones; never reset or discard work."""
import datetime as dt
import json
from pathlib import Path
import subprocess

HQ = Path(__file__).resolve().parents[2]
snapshot = HQ / 'inventory/snapshots/2026-09-23/projects.json'
projects = json.loads(snapshot.read_text(encoding='utf-8'))
names = {'CP77_entSpawner','CP77_nativeSettings','CP77_radioExt','CyberEngineTweaks','Cyberpunk-Modding-Docs','RED4.RTTIDumper','RED4ext','RED4ext.SDK','WolvenKit','appearancemenumod','cp2077-archive-xl','cp2077-cet-kit','cp2077-codeware','cp2077-cyberware-ex','cp2077-equipment-ex','cp2077-photomode-ex','cp2077-red-hot-tools','cp2077-tweak-xl','cyberpunk2077-input-loader','in_world_navigation','let_there_be_flight','mod_settings','nativeInteractions','red4ext-rs','redscript','redscript-ide'}
records = []
output = HQ / 'inventory/reference-updates-2026-09-23.json'
priority = ['cp2077-archive-xl','cp2077-tweak-xl','cp2077-codeware','RED4ext','RED4ext.SDK','redscript','WolvenKit']
for item in sorted(projects, key=lambda p: (0 if Path(p['path']).parent == Path('D:/Dev') else 1, priority.index(Path(p['path']).name) if Path(p['path']).name in priority else 99)):
    repo = Path(item['path'])
    if repo.name not in names or repo.parent not in {Path('D:/Dev'),Path('D:/Dev/clones')}:
        continue
    def git(*args):
        p = subprocess.run(['git','--no-optional-locks','-c','core.autocrlf=true','-C',str(repo),*args],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=90 if args[0]=='fetch' else 20,env={**__import__('os').environ,'GIT_TERMINAL_PROMPT':'0'})
        if p.returncode:
            raise RuntimeError(p.stderr.strip() or p.stdout.strip())
        return p.stdout.strip()
    row = {'path':str(repo),'checked_utc':dt.datetime.now(dt.timezone.utc).isoformat()}
    try:
        row['before'] = git('rev-parse','HEAD')
        row['branch'] = git('branch','--show-current')
        row['status_note'] = 'Windows checkout line endings normalized for comparison with per-command core.autocrlf=true; no persistent config change. Untracked files preserved by git merge collision protection.'
        row['local_changes'] = git('status','--porcelain','-uno','--ignore-submodules=untracked')
        if row['local_changes']:
            row['result'] = 'skipped: local changes preserved'
        elif not row['branch']:
            row['result'] = 'skipped: detached HEAD preserved'
        else:
            row['upstream'] = git('rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}')
            git('fetch','origin')
            row['merge_output'] = git('merge','--ff-only','@{upstream}')[-1000:]
            row['after'] = git('rev-parse','HEAD')
            row['result'] = 'updated' if row['before'] != row['after'] else 'already current'
            row['last_commit'] = git('log','-1','--format=%cI %s')
    except (RuntimeError,subprocess.TimeoutExpired) as e:
        row['result'] = 'not updated: ' + str(e)[:600]
    records.append(row)
    output.write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
    print(f'{repo}: {row["result"]}',flush=True)
