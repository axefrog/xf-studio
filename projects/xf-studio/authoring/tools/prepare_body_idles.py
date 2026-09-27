"""Prepare the game's own character-preview idles as local, nonredistributed assets (knowledge/body-animation.md §2).

The preview puppet (`player_wa_tpp.ent`: the creator's `Character.Player_Puppet_Menu`) plays its body with
`base\\gameplay\\anim_graphs\\player_paperdoll.animgraph` from `base\\animations\\ui\\female\\ui_female.anims`. This tool reads that graph
(WolvenKit's serialized JSON), lists the looping body clips of its preview screens (every looping clip in a state machine state, plus the
looping clips the screens' switch plays directly), exports each with the project's clip exporter (tools/anim-export), bakes the face clip
the face graph loops with it where the face set has one (bake_idle_face.py), and writes the catalogue the Studio reads
(`public/assets/cc-idle-catalogue.json`, idle-catalogue.ts). Game data stays local: the intake under research/consumers/cc-idle and the
outputs under public/assets are ignored.

  python tools/prepare_body_idles.py --wolvenkit <WolvenKit.CLI.exe> --game <game folder> --anim-export <AnimExport.exe>
      [--addon <Cyberpunk-Blender-add-on checkout>]
"""
import argparse
import hashlib
import json
import struct
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
HQ = APP.parents[2]
ROOT = HQ / 'research/consumers/cc-idle'
ASSETS = APP / 'public/assets'
GRAPH = r'base\gameplay\anim_graphs\player_paperdoll.animgraph'
SET = r'base\animations\ui\female\ui_female.anims'
FACE_SET = r'base\animations\ui\female\ui_female_face.anims'
RIG = r'base\characters\base_entities\woman_base\woman_base.rig'
FACE_RIG = r'base\characters\head\player_base_heads\player_female_average\h0_000_pwa_c__basehead\h0_000_pwa_c__basehead_skeleton.rig'
# Studio labels by entry id; an entry the graph adds later gets its clip name.
LABELS = {'closeup': 'Creator close-up', 'fullbody': 'Creator full body', 'inventory': 'Inventory', 'nails': 'Creator nails',
          'gender-selection': 'Gender selection'}


def depot(path):
    return ROOT / 'extracted' / Path(*path.split('\\'))


def ensure_extracted(args):
    missing = [p for p in [GRAPH, SET, FACE_SET, RIG, FACE_RIG] if not depot(p).exists()]
    if missing:
        pattern = '(' + '|'.join(p.replace('\\', '.').replace('.animgraph', '[.]animgraph').replace('.anims', '[.]anims') for p in missing) + ')'
        subprocess.run([args.wolvenkit, 'unbundle', str(Path(args.game) / 'archive/pc/content'), '-o', str(ROOT / 'extracted'), '-r', pattern],
                       check=True, stdout=subprocess.DEVNULL)
    for p in [GRAPH, SET, FACE_SET, RIG, FACE_RIG]:
        if not depot(p).exists():
            raise SystemExit(f'{p} could not be extracted.')
    serialized = ROOT / 'json' / 'player_paperdoll.animgraph.json'
    if not serialized.exists():
        (ROOT / 'json').mkdir(parents=True, exist_ok=True)
        subprocess.run([args.wolvenkit, 'convert', 'serialize', str(depot(GRAPH)), '-o', str(ROOT / 'json')], check=True, stdout=subprocess.DEVNULL)
    return json.loads(serialized.read_text(encoding='utf-8'))


def value(x):
    if isinstance(x, dict):
        if '$value' in x:
            return x['$value']
        if 'name' in x:
            return value(x['name'])
    return x


def graph_nodes(document):
    """Every handle's data by id, and each node's child handles (its references), from WolvenKit's JSON."""
    nodes, stack = {}, [document['Data']['RootChunk']]
    while stack:
        o = stack.pop()
        if isinstance(o, dict):
            if 'HandleId' in o and 'Data' in o:
                if o['HandleId'] not in nodes:
                    nodes[o['HandleId']] = o['Data']
                    stack.append(o['Data'])
                continue
            stack.extend(o.values())
        elif isinstance(o, list):
            stack.extend(o)

    def refs(data):
        out, stack = [], [data]
        while stack:
            o = stack.pop()
            if isinstance(o, dict):
                if 'HandleId' in o and 'Data' in o:
                    out.append(o['HandleId'])
                    continue
                if 'HandleRefId' in o:
                    out.append(o['HandleRefId'])
                    continue
                stack.extend(o.values())
            elif isinstance(o, list):
                stack.extend(o)
        return out
    children = {h: refs({k: v for k, v in d.items()}) for h, d in nodes.items()}
    return nodes, children


def preview_idles(document):
    """The looping body clips of the preview screens, with the state, flags and screen each loops in."""
    nodes, children = graph_nodes(document)
    parents = {}
    for h, kids in children.items():
        for k in kids:
            parents.setdefault(k, set()).add(h)

    def ancestors(h):
        seen, stack = [], [h]
        while stack:
            x = stack.pop()
            for p in parents.get(x, ()):
                if p not in seen:
                    seen.append(p)
                    stack.append(p)
        return seen

    def flags_of(machine):
        found = set()
        for h in [machine] + [x for x in descendants(machine)]:
            d = nodes[h]
            if d['$type'].startswith('animAnimStateTransitionCondition_') and value(d.get('featureName')) == 'Paperdoll':
                found.add(value(d.get('featurePropertyName')))
        return sorted(found)

    def descendants(h, stop=('animAnimNode_StateMachine',)):
        out, stack, seen = [], list(children.get(h, [])), set()
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            out.append(x)
            if nodes[x]['$type'] not in stop:
                stack.extend(children.get(x, []))
        return out

    looping = {h: d for h, d in nodes.items() if d['$type'] == 'animAnimNode_SkAnim' and d.get('isLooped', 1)}
    machines = [h for h, d in nodes.items() if d['$type'] == 'animAnimNode_StateMachine']
    entries, seen = [], set()
    for machine in machines:
        flags = flags_of(machine)
        states = [nodes[r] for r in children[machine] if nodes[r]['$type'] == 'animAnimNode_State']
        for state in states:
            state_id = next(h for h, d in nodes.items() if d is state)
            for h in descendants(state_id):
                if h in looping:
                    clip = value(looping[h]['animation'])
                    if clip in seen:
                        continue
                    seen.add(clip)
                    screen = 'inventory' if any(f.startswith('inventoryScreen') for f in flags) else 'creator'
                    name = value(state['name'])
                    entry_id = 'inventory' if screen == 'inventory' else 'nails' if 'characterCreation_Nails' in flags else name.lower()
                    entries.append({'id': entry_id, 'clip': clip, 'screen': screen, 'state': name, 'flags': flags,
                                    'evidence': f'[resource] player_paperdoll.animgraph: looping SkAnim in state `{name}` of a state machine'
                                                f'{" testing " + ", ".join(flags) if flags else ""}'})
    # The screens' switch: the nearest switch every state machine descends from; a looping clip it plays directly is a screen of its own.
    common = None
    for machine in machines:
        chain = [a for a in ancestors(machine) if nodes[a]['$type'] == 'animAnimNode_Switch']
        common = chain if common is None else [a for a in common if a in chain]
    if common:
        # The nearest of them: the one every other common switch is an ancestor of.
        switch = next(c for c in common if all(o == c or o in ancestors(c) for o in common))
        # It and the switches directly above it (the gender screen sits one switch up) choose among the screens.
        switches = [switch]
        while True:
            above = [p for p in parents.get(switches[-1], ()) if nodes[p]['$type'] == 'animAnimNode_Switch']
            if len(above) != 1:
                break
            switches.append(above[0])
        for h in [h for sw in switches for h in children[sw]]:
            if h in looping:
                clip = value(looping[h]['animation'])
                if clip in seen:
                    continue
                seen.add(clip)
                screen = 'gender' if 'gender' in clip.lower() else 'creator'
                entries.append({'id': clip.lower().replace('ui_', '').replace('_', '-'), 'clip': clip, 'screen': screen, 'state': 'switch input',
                                'flags': [], 'evidence': '[resource] player_paperdoll.animgraph: looping SkAnim played directly by the preview screens\' switch'})
    left = sorted({value(d['animation']) for d in looping.values()} - seen)
    return entries, [{'clip': clip, 'why': 'a held weapon\'s idle (the inventory\'s weapon view); the Studio draws no weapon'} for clip in left]


def read_glb(path):
    b = path.read_bytes()
    n = struct.unpack_from('<I', b, 12)[0]
    return json.loads(b[20:20 + n]), b[20 + n:]


def strip_body(raw, out):
    """The body clip without WolvenKit's float-track extras, as prepare_idle.py serves the close-up's."""
    body, tail = read_glb(raw)
    for a in body['animations']:
        a['extras'] = {'sourceClip': a['name'], 'animationType': a.get('extras', {}).get('animationType')}
    encoded = json.dumps(body, separators=(',', ':')).encode()
    encoded += b' ' * ((-len(encoded)) % 4)
    payload = struct.pack('<4sII', b'glTF', 2, 20 + len(encoded) + len(tail)) + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + tail
    out.write_bytes(payload)
    duration = 0.0
    for a in body['animations']:
        for s in a['samplers']:
            duration = max(duration, (body['accessors'][s['input']].get('max') or [0])[0])
    return payload, duration


def face_clips():
    serialized = ROOT / 'json' / 'ui_female_face.anims.json'
    if not serialized.exists():
        return set()
    root = json.loads(serialized.read_text(encoding='utf-8'))['Data']['RootChunk']
    return {value(a['Data']['animation']['Data']['name']) for a in root['animations']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--wolvenkit', required=True)
    parser.add_argument('--game', required=True)
    parser.add_argument('--anim-export', required=True)
    parser.add_argument('--addon', default='D:/Dev/Cyberpunk-Blender-add-on')
    args = parser.parse_args()
    document = ensure_extracted(args)
    entries, left = preview_idles(document)
    faces = face_clips()
    ASSETS.mkdir(parents=True, exist_ok=True)
    idles, hashes = [], {}
    for entry in entries:
        clip = entry['clip']
        raw = ROOT / 'raw' / ('idle-body.glb' if clip == 'ui_closeup_shot' else f'body-{clip}.glb')
        if not raw.exists():
            subprocess.run([args.anim_export, str(depot(SET)), str(depot(RIG)), clip, str(raw)], check=True, stdout=subprocess.DEVNULL)
        body_file = 'cc-idle-body.glb' if clip == 'ui_closeup_shot' else f'cc-idle-body-{clip.lower()}.glb'
        payload, duration = strip_body(raw, ASSETS / body_file)
        hashes[body_file] = hashlib.sha256(payload).hexdigest()
        # The face the face graph loops with it: its own face clip where the face set has one; the inventory's is the close-up's after
        # a one-shot pickup (facial-expressions.md §5); otherwise none (the Studio keeps the close-up's face).
        face_clip = 'ui_closeup_shot' if entry['screen'] == 'inventory' else clip if clip in faces else None
        face = None
        if face_clip == 'ui_closeup_shot':
            face = {'clip': 'ui_closeup_shot', 'file': 'cc-idle-face.glb'}
        elif face_clip:
            face_raw = ROOT / 'raw' / f'face-{face_clip}.glb'
            if not face_raw.exists():
                subprocess.run([args.anim_export, str(depot(FACE_SET)), str(depot(FACE_RIG)), face_clip, str(face_raw)], check=True, stdout=subprocess.DEVNULL)
            face_file = f'cc-idle-face-{face_clip.lower()}.glb'
            subprocess.run([sys.executable, str(APP / 'tools/bake_idle_face.py'), '--addon', args.addon, '--clip', face_clip, '--face-glb', str(face_raw),
                            '--output', str(ASSETS / face_file), '--report', str(APP / f'evidence/idle-face-bake-{face_clip.lower()}.json')],
                           check=True, stdout=subprocess.DEVNULL)
            face = {'clip': face_clip, 'file': face_file}
        idles.append({'id': entry['id'], 'label': LABELS.get(entry['id'], clip), 'clip': clip, 'body': body_file, 'duration': round(duration, 3),
                      'screen': entry['screen'], 'state': entry['state'], 'flags': entry['flags'], 'face': face,
                      # The creator's screens run on the creator puppet, whose appearance `character_creation` draws lifted feet.
                      'puppet': None if entry['screen'] == 'inventory' else 'creator', 'evidence': entry['evidence']})
    order = ['closeup', 'fullbody', 'inventory', 'nails', 'gender-selection']
    idles.sort(key=lambda e: order.index(e['id']) if e['id'] in order else len(order))
    catalogue = {'schema': 'xfs/idle-catalogue-1', 'source': {'graph': GRAPH, 'set': SET, 'rig': RIG}, 'idles': idles, 'left': left}
    (ASSETS / 'cc-idle-catalogue.json').write_text(json.dumps(catalogue, indent=2) + '\n', encoding='utf-8')
    report = {'catalogue': catalogue, 'outputSha256': hashes,
              'sourceSha256': {p.split('\\')[-1]: hashlib.sha256(depot(p).read_bytes()).hexdigest() for p in [GRAPH, SET, FACE_SET, RIG]}}
    (APP / 'evidence/idle-catalogue.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps([{k: e[k] for k in ('id', 'clip', 'screen', 'duration')} for e in idles], indent=1))
    print('left out:', [x['clip'] for x in left])


if __name__ == '__main__':
    main()
