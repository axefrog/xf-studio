"""Read official latest stable release metadata; no installations or credentials."""
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import json
from pathlib import Path
import urllib.request

repos=['psiberx/cp2077-archive-xl','psiberx/cp2077-tweak-xl','psiberx/cp2077-codeware','wopss/RED4ext','jac3km4/redscript','maximegmd/CyberEngineTweaks','WolvenKit/WolvenKit']
def check(repo):
    url=f'https://api.github.com/repos/{repo}/releases/latest'
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'cp2077-modding-hq-research'}),timeout=30) as f: d=json.load(f)
        return {'repository':repo,'tag':d['tag_name'],'name':d['name'],'published_at':d['published_at'],'url':d['html_url'],'prerelease':d['prerelease']}
    except Exception as e: return {'repository':repo,'error':str(e)}
result={'checked_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'releases':list(ThreadPoolExecutor(max_workers=4).map(check,repos))}
output=Path(__file__).resolve().parents[2]/'inventory/framework-releases-2026-09-23.json'
output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,indent=2))
