"""Fetch pinned upstream source evidence without changing any reference checkout."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import urllib.request

HQ = Path(__file__).resolve().parents[2]
dest = HQ / 'research' / 'archive-xl' / 'upstream'
dest.mkdir(parents=True, exist_ok=True)
def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'cp2077-modding-hq-research'}), timeout=30).read()
release = json.loads(fetch('https://api.github.com/repos/psiberx/cp2077-archive-xl/releases/latest'))
tag = release['tag_name']
commit = json.loads(fetch('https://api.github.com/repos/psiberx/cp2077-archive-xl/commits/' + tag))['sha']
manifest = {'retrieved_utc': dt.datetime.now(dt.timezone.utc).isoformat(), 'release': tag, 'published_at': release['published_at'], 'release_url': release['html_url'], 'commit': commit, 'release_notes': release['body'], 'files': []}
for path in ['src/App/Extensions/Mesh/Extension.cpp', 'src/App/Extensions/Customization/Extension.cpp', 'src/App/Extensions/Garment/Dynamic.cpp', 'src/App/Extensions/Garment/Extension.cpp', 'src/App/Extensions/ResourceMeta/Extension.cpp']:
    url = f'https://raw.githubusercontent.com/psiberx/cp2077-archive-xl/{commit}/{path}'
    data = fetch(url)
    output = dest / path
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    manifest['files'].append({'path': path, 'url': url, 'sha256': hashlib.sha256(data).hexdigest()})
(dest / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps(manifest, indent=2))
