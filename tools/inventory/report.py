"""Build navigable inventories from the read-only census and curated classifications."""
import collections
import datetime as dt
import json
from pathlib import Path
import re

HQ = Path(__file__).resolve().parents[2]
SNAP = HQ / 'inventory/snapshots/2026-09-23'
projects = json.loads((SNAP/'projects.json').read_text(encoding='utf-8'))
dirs = json.loads((SNAP/'directories.json').read_text(encoding='utf-8'))
notes = json.loads((SNAP/'scan-notes.json').read_text(encoding='utf-8'))
classes = json.loads((HQ/'inventory/classifications.json').read_text(encoding='utf-8'))
aggregates = {}
for row in sorted(dirs,key=lambda x:len(Path(x['path']).parts),reverse=True):
    path = row['path']
    agg = aggregates.setdefault(path,{'files':0,'bytes':0,'extensions':collections.Counter()})
    agg['files'] += row['direct_files']; agg['bytes'] += row['direct_bytes']; agg['extensions'].update(row['extensions'])
    parent = str(Path(path).parent)
    if parent != path:
        dest = aggregates.setdefault(parent,{'files':0,'bytes':0,'extensions':collections.Counter()})
        dest['files'] += agg['files']; dest['bytes'] += agg['bytes']; dest['extensions'].update(agg['extensions'])

def link(path):
    p = Path(path)
    return f'[{p.name}](<{p.as_posix()}>)'
def escaped(text): return str(text).replace('|','/').replace('\n',' ')
def stamp(text): return dt.datetime.fromisoformat(text).astimezone(dt.timezone(dt.timedelta(hours=10))).strftime('%Y-%m-%d')
def description(row):
    if row['root']=='dev':
        rel = Path(row['path']).relative_to('D:/Dev')
        category, summary = classes['dev'][rel.parts[0]]
        if len(rel.parts)>1:
            g = row.get('git') or {}
            clues = ', '.join(row.get('children',[])[:6])
            package = Path(row['path'])/'package.json'
            if package.exists():
                try:
                    pkg = json.loads(package.read_text(encoding='utf-8-sig'))
                    detail = pkg.get('description') or pkg.get('name') or ''
                except (ValueError,OSError): detail = ''
            else: detail = ''
            summary = f'{rel.name}: {detail or "contents: " + clues}. ' + ('Older framework/tool clone; compare revision history.' if rel.parts[0]=='clones' else 'General development/archive reference; no direct mod implementation established.')
            if g.get('origin'): summary += ' Repository: '+g['origin']+'.'
        return category,summary
    rel=Path(row['path']).relative_to('F:/Games/RedModding').as_posix()
    return 'modding-reference',classes['redmodding'].get(rel,classes['redmodding'].get(rel.split('/')[0], 'Historical modding resource.'))

def write_catalog(root,name):
    rows=[r for r in projects if r['root']==root]
    out=[f'# {name}', '', 'Survey: 2026-09-23 (Australia/Brisbane). Creation/modified dates are filesystem evidence, not proof of authorship or chronology. Git revisions below are the **pre-update census**; see [reference updates](reference-updates-2026-09-23.json) for newer revisions.', '', 'Every top-level folder and nested project/container boundary is listed. Deeper directories inherit the nearest classification in `directories-classified.jsonl`; file metadata is in the dated snapshot. Dependency/cache exclusions are explicit in `scan-notes.json`.', '', '| Folder | Relevance | Created / modified | Files (surveyed) | Summary | Git baseline |','|---|---|---|---:|---|---|']
    for r in rows:
        cat,desc=description(r); agg=aggregates[r['path']]; git=r.get('git') or {}
        out.append(f'| {link(r["path"])} | {cat} | {stamp(r["created_utc"])} / {stamp(r["modified_utc"])} | {agg["files"]:,} | {escaped(desc)} | {escaped((git.get("head") or "")[:12])} {escaped(git.get("last_commit") or "")} |')
    if root=='dev': out += ['', 'The initially empty `cp2077-modding-hq` is the primary workspace and was deliberately excluded from its own census. Loose `gen.ps1` generates RTTI JSON; `desktop.ini` is shell metadata; `kernel.zip` is an archive whose payload is not needed for current mod work.']
    else: out += ['', 'Loose project-root backups and authoring files are indexed individually in the file manifest. See [Eye Artistry lineage](../research/eye-artistry/lineage.md) for the meaningful version comparison.']
    (HQ/'inventory'/f'{root}.md').write_text('\n'.join(out)+'\n',encoding='utf-8')
write_catalog('dev','D:/Dev inventory')
write_catalog('redmodding','F:/Games/RedModding inventory')

# Every visited directory has a classification, including descendants rather than only roots.
with (HQ/'inventory/directories-classified.jsonl').open('w',encoding='utf-8') as f:
    for row in dirs:
        if row['relative']=='.': cat,summary='container','Survey root.'
        elif row['root']=='dev':
            cat,summary=classes['dev'][Path(row['relative']).parts[0]]
        elif row['root']=='redmodding':
            rel=Path(row['relative']).as_posix(); keys=[k for k in classes['redmodding'] if rel==k or rel.startswith(k+'/')]
            cat,summary='modding-reference',classes['redmodding'][max(keys,key=len)] if keys else 'Modding research container.'
        else: cat,summary='installed-mod-reference','MO2 mod/profile/runtime artifact; membership does not alone prove a resource won at runtime.'
        f.write(json.dumps({'path':row['path'],'classification':cat,'summary':summary},ensure_ascii=False)+'\n')

profiles={}
for folder in Path('F:/Games/MO2/profiles').iterdir():
    path=folder/'modlist.txt'
    if path.exists():
        profiles[folder.name]={line[1:]:line[0] for line in path.read_text(encoding='utf-8-sig').splitlines() if line and line[0] in '+-'}

def meta(path):
    if not path.exists(): return {}
    # Whitelist fields: never include auth/config or bulk Nexus descriptions.
    keys={'modid','version','installationFile','gameName','category','nexusCategory','lastNexusUpdate'}
    result={}
    for line in path.read_text(encoding='utf-8-sig',errors='replace').splitlines():
        k,sep,v=line.partition('=')
        if sep and k in keys: result[k]=v
    return result

mod_rows=[]
for row in projects:
    if row['root']!='mo2-mods': continue
    p=Path(row['path']); agg=aggregates[str(p)]; ext=agg['extensions']; m=meta(p/'meta.ini'); n=p.name.lower()
    if n.endswith('_separator'): category,summary='separator','MO2 visual grouping; no mod payload expected.'
    elif any(s in n for s in ['eye artistry','photoreal eyes','heterochromia','hair profiles','dipped tips']): category,summary='eye-artistry-priority','Closest makeup/eye/palette/CCXL consumer or legacy build; inspect resource expansion and shader setup.'
    elif any(s in n for s in ['archivexl','tweakxl','codeware','redscript','cyber engine tweaks','red4ext']) and agg['files']<100 and not ext['.archive']: category,summary='framework/tool','Framework, scripting or runtime tooling; verify versions against actual game logs.'
    elif any(s in n for s in ['eye','makeup','eyeshadow','eyeliner','ccxl','hair','tattoo','skin','complexion','uv texture']): category,summary='character/customization','Character asset/material/customization reference; inspect CCXL mappings, UVs and compatibility as needed.'
    elif any(s in n for s in ['photo','pose','camera','amm','appearance menu','world builder']): category,summary='photo/scene','Photo mode, actor, pose or scene reference for diagnostics and Photo Mode Tools.'
    elif ext['.lua'] or ext['.reds'] or ext['.dll']: category,summary='script/native','Inspectable runtime logic or native extension; candidate for event/API/diagnostic pattern study.'
    elif ext['.xl'] or ext['.yaml']: category,summary='archive/tweak','ArchiveXL/TweakXL consumer: resource naming, packaging and declared runtime changes.'
    else: category,summary='asset/reference','Installed asset or configuration reference; archive payload needs targeted extraction before deeper classification.'
    surfaces=', '.join(f'{k}:{v}' for k,v in sorted(ext.items()) if k in {'.archive','.xl','.yaml','.lua','.reds','.dll','.mesh','.mi','.ini'})
    mod_rows.append({'name':p.name,'path':str(p),'category':category,'summary':summary,'metadata':m,'files':agg['files'],'bytes':agg['bytes'],'extensions':dict(ext),'profiles':{k:v.get(p.name,'absent') for k,v in profiles.items()},'surfaces':surfaces,'created_utc':row['created_utc'],'modified_utc':row['modified_utc']})
(HQ/'inventory/mo2-mods.json').write_text(json.dumps(mod_rows,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
active='2025 (again)'
counts=collections.Counter(r['profiles'].get(active,'absent') for r in mod_rows if r['category']!='separator')
out=['# MO2 research inventory','','Selected profile in ModOrganizer.ini: **2025 (again)**. `+` means enabled in the saved profile, `-` disabled, `absent` not listed. This is not proof of winning resource priority or of the last game launch path. Categories are triage inferred from names and exposed file types, not a full audit of every archive.','',f'{len(mod_rows)} folders; {sum(r["category"]=="separator" for r in mod_rows)} separators; non-separator selected-profile counts: {dict(counts)}. All profile memberships and Nexus metadata are in [mo2-mods.json](mo2-mods.json).','','| Mod | Profile | Category | Version / Nexus ID | Exposed surfaces | Research relevance |','|---|---|---|---|---|---|']
for r in mod_rows:
    out.append(f'| {link(r["path"])} | {r["profiles"].get(active,"absent")} | {r["category"]} | {escaped(r["metadata"].get("version",""))} / {r["metadata"].get("modid","")} | {r["surfaces"]} | {r["summary"]} |')
(HQ/'inventory/mo2.md').write_text('\n'.join(out)+'\n',encoding='utf-8')
summary={'files':notes['files_per_root'],'directories':len(dirs),'project_entries':len(projects),'errors':len(notes['errors']),'pruned_subtrees':len(notes['skipped']),'mo2_folders':len(mod_rows),'mo2_separators':sum(r['category']=='separator' for r in mod_rows),'selected_profile':active,'selected_profile_mod_counts':dict(counts),'profiles':{k:dict(collections.Counter(v.values())) for k,v in profiles.items()}}
(HQ/'inventory/summary.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary,indent=2))
