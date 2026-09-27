"""Lip-sync proof of concept: speech audio + phone timing -> JALI-style curves in the game's lip-sync channel -> solved face.

Offline and local only (research/animation/lipsync-design.md, experiment 027). Nothing here ships and no audio is committed.

Inputs
* a mono 16-bit WAV of a consenting or synthetic voice;
* Rhubarb Lip Sync's debug log for that WAV (``--logLevel Debug``), whose ``##phone[a-b]: X`` lines give ARPAbet phones
  aligned to the audio (Rhubarb's PocketSphinx recogniser, guided by ``--dialogFile``);
* optionally a WolvenKit JSON of a vanilla lip-sync set and a clip name, to compare the solved motion with the game's own.

Output (``generated/``, ignored): the clip as additive track values per frame at 30 fps (the game's lip-sync clips are 30 fps
``AdditiveFromRefPose``), and asset-free metrics of the solved face (lip gap, jaw rotation) for the generated and the vanilla clip.

The curves follow the published JALI rules (Edwards, Landreth, Fiume and Singh, SIGGRAPH 2016) as read and re-expressed here, not
copied from any implementation: viseme onsets 120 ms before the sound (150 ms for lip-heavy visemes), apex held to 75 % of the phone,
120/150 ms decay; bilabials close the lips; tongue-only phones leave the lips to their neighbours; jaw (JA) and lip (LI) strength
from the recording's intensity. The viseme targets are our own table over the game's control names. They are written into the
channel the game's lip-sync clips use: ``lipSyncEnvelope``, ``muzzleLips``, ``jaliJaw``/``jaliLips``, the ``…LipsyncPoseOutput``
tracks and the ``…AnimOverrideWeight`` tracks (knowledge/lipsync.md §2).

    python experiments/027-lipsync-poc/lipsync_poc.py --wav line.wav --phones rh.log [--vanilla v.anims.json --clip f_…]
"""
import argparse
import base64
import json
import re
import struct
import sys
import types
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
HQ = HERE.parents[1]
TOOLS = HQ / 'projects/xf-studio/authoring/tools'
INTAKE = Path('D:/Dev/cp2077-modding-hq/research/consumers/cc-idle/json')   # the local WolvenKit JSON intake (cc-idle.md)
FPS = 30

# Viseme targets over the game's main-pose control names (design choice; weights at JA = LI = 0.5).
# "jaw" means jaw_mid_open; lip entries without a side are applied to both sides.
VISEMES = {
    'PP': {'jaw': 0.02, 'lips_together_up': 1.05, 'lips_together_dn': 1.05},
    'FF': {'jaw': 0.06, 'lips_suck_dn': 0.65, 'upper_raise': 0.2},
    'TH': {'jaw': 0.15, 'tongue_mid_tip_up': 0.3, 'tongue_mid_base_fwd': 0.5},
    'DD': {'jaw': 0.12, 'tongue_mid_lift': 0.9, 'tongue_mid_tip_up': 0.3},
    'LL': {'jaw': 0.22, 'tongue_mid_lift': 0.9, 'tongue_mid_tip_up': 0.32},
    'KK': {'jaw': 0.14, 'tongue_mid_base_up': 1.0, 'tongue_mid_base_back': 0.7},
    'SS': {'jaw': 0.04, 'stretch': 0.3, 'corner_stretch': 0.2, 'corner_up': 0.2, 'tongue_mid_lift': 0.5},
    'SH': {'jaw': 0.06, 'funnel': 0.33, 'purse': 0.25, 'tongue_mid_lift': 0.6},
    'RR': {'jaw': 0.2, 'funnel': 0.25, 'purse': 0.2, 'tongue_mid_tip_up': 0.25},
    'WW': {'jaw': 0.08, 'purse': 0.53, 'funnel': 0.2},
    'YY': {'jaw': 0.1, 'stretch': 0.3, 'corner_up': 0.25, 'tongue_mid_base_up': 0.5},
    'IY': {'jaw': 0.2, 'stretch': 0.35, 'corner_stretch': 0.2, 'corner_up': 0.3, 'tongue_mid_base_up': 0.3},
    'EH': {'jaw': 0.38, 'stretch': 0.2, 'corner_up': 0.25, 'upper_raise': 0.15},
    'AA': {'jaw': 0.6, 'upper_raise': 0.15},
    'OW': {'jaw': 0.35, 'funnel': 0.33, 'purse': 0.3},
    'UW': {'jaw': 0.12, 'purse': 0.53, 'funnel': 0.33},
    'HH': {'jaw': 0.2},
}
PHONE_VISEME = {
    'P': 'PP', 'B': 'PP', 'M': 'PP', 'F': 'FF', 'V': 'FF', 'TH': 'TH', 'DH': 'TH', 'T': 'DD', 'D': 'DD', 'N': 'DD',
    'L': 'LL', 'K': 'KK', 'G': 'KK', 'NG': 'KK', 'S': 'SS', 'Z': 'SS', 'SH': 'SH', 'ZH': 'SH', 'CH': 'SH', 'JH': 'SH',
    'R': 'RR', 'ER': 'RR', 'W': 'WW', 'Y': 'YY', 'IY': 'IY', 'IH': 'IY', 'EH': 'EH', 'AE': 'EH', 'EY': 'EH',
    'AA': 'AA', 'AH': 'AA', 'AO': 'OW', 'AW': 'AA', 'AY': 'AA', 'OW': 'OW', 'OY': 'OW', 'UW': 'UW', 'UH': 'UW', 'HH': 'HH',
}
VOWELS = {'IY', 'IH', 'EH', 'AE', 'EY', 'AA', 'AH', 'AO', 'AW', 'AY', 'OW', 'OY', 'UW', 'UH', 'ER'}
LIP_HEAVY = {'UW', 'UH', 'OW', 'OY', 'W', 'SH', 'ZH', 'CH', 'JH', 'R', 'ER'}
SIDED = {'upper_raise': 'lips_{}_upper_raise', 'stretch': 'lips_{}_stretch', 'corner_stretch': 'lips_{}_corner_stretch',
         'funnel': 'lips_{}_funnel', 'purse': 'lips_{}_purse', 'corner_up': 'lips_{}_corner_up'}
CORNER_FAMILY = ('upper_raise', 'pull', 'corner_up', 'corner_wide', 'corner_stretch', 'stretch', 'lower_raise', 'corner_dn')


def read_wav(path):
    with wave.open(str(path), 'rb') as w:
        assert w.getsampwidth() == 2 and w.getnchannels() == 1, 'expected 16-bit mono'
        rate = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float64) / 32768
    return rate, data


def read_phones(path):
    phones = []
    for line in Path(path).read_text(encoding='utf-8', errors='replace').splitlines():
        m = re.search(r'##phone\[([\d.]+)-([\d.]+)\]: (\S+)', line)
        if m and m.group(3) in PHONE_VISEME:
            phones.append((float(m.group(1)), float(m.group(2)), m.group(3)))
    return phones


def features(rate, data, start, end):
    seg = data[int(start * rate):max(int(end * rate), int(start * rate) + 1)]
    rms = np.sqrt(np.mean(seg ** 2) + 1e-12)
    hf = np.sqrt(np.mean(np.diff(seg) ** 2) + 1e-12) if len(seg) > 1 else rms   # first difference as a high-frequency proxy
    return 20 * np.log10(rms), 20 * np.log10(hf)


def ja_li(phones, rate, data):
    """Per-phone jaw (JA) and lip (LI) strength in 0..1 from intensity, compared within the phone's class (JALI §4.3, simplified:
    no lexical stress, no pitch)."""
    feats = [features(rate, data, s, e) for s, e, _ in phones]
    out = []
    classes = {'vowel': [], 'obstruent': []}
    for (s, e, p), f in zip(phones, feats):
        classes['vowel' if p in VOWELS else 'obstruent'].append(f)
    stats = {k: (np.mean(v, axis=0), np.std(v, axis=0) + 1e-6) if v else (np.zeros(2), np.ones(2)) for k, v in classes.items()}
    for (s, e, p), f in zip(phones, feats):
        mean, std = stats['vowel' if p in VOWELS else 'obstruent']
        z_int, z_hf = (np.array(f) - mean) / std
        ja = float(np.interp(z_int, [-1, 0, 1], [0.15, 0.45, 0.8]))
        li = float(np.interp(z_int if p in VOWELS else z_hf, [-1, 0, 1], [0.25, 0.5, 0.8]))
        out.append((ja, li, float(z_int)))
    return out


def curve(times, start, end, lip_heavy):
    """0..1 weight of one viseme: onset 120/150 ms before the sound, apex at its start, held to 75 % of the phone, then decay."""
    lead = 0.15 if lip_heavy else 0.12
    hold = start + 0.75 * (end - start)
    return np.interp(times, [start - lead, start, hold, hold + lead], [0, 1, 1, 0], left=0, right=0)


def build(phones, rate, data, brows=True):
    duration = len(data) / rate
    times = np.arange(int(np.ceil(duration * FPS)) + 1) / FPS
    tracks = {}

    def put(name, values, combine=np.maximum):
        tracks[name] = combine(tracks[name], values) if name in tracks else values.copy()

    strengths = ja_li(phones, rate, data)
    bilabial = np.zeros_like(times)
    for (s, e, p), (ja, li, _) in zip(phones, strengths):
        w = curve(times, s, e, p in LIP_HEAVY)
        vis = VISEMES[PHONE_VISEME[p]]
        for key, target in vis.items():
            if key == 'jaw':
                put('jaw_mid_open', np.clip(target * (0.4 + 0.6 * ja), 0, 1) * w)
            elif key in SIDED:
                for side in 'lr':
                    put(SIDED[key].format(side), np.clip(target * (0.5 + li), 0, 1) * w)
            elif key.startswith('lips_together'):
                put(key, target * w)                      # bilabials always close, whatever the strength
            else:
                put(key, np.clip(target * (0.5 + li), 0, 1) * w)
        if PHONE_VISEME[p] == 'PP':
            bilabial = np.maximum(bilabial, w)
    if 'jaw_mid_open' in tracks:                          # a closing bilabial narrows the jaw its neighbours open
        tracks['jaw_mid_open'] *= 1 - 0.6 * bilabial
    # Envelope: in over 0.4 s before the first viseme, out over 0.5 s after the last phone (vanilla medians 0.43 s and 0.6 s).
    first = phones[0][0] - 0.12
    last = phones[-1][1]
    env = np.interp(times, [first - 0.4, first, last, last + 0.5], [0, 1, 1, 0], left=0, right=0)
    extra = {'lipSyncEnvelope': env, 'muzzleLips': env}
    # JA/LI as slow prosody curves, the way vanilla clips carry jaliJaw/jaliLips (deltas on reference 1, about -0.45..0.7).
    ja_t = np.interp(times, [(s + e) / 2 for s, e, _ in phones], [x[0] for x in strengths])
    li_t = np.interp(times, [(s + e) / 2 for s, e, _ in phones], [x[1] for x in strengths])
    kernel = np.hanning(int(0.5 * FPS)) ; kernel /= kernel.sum()
    extra['jaliJaw'] = np.convolve(ja_t * 1.2 - 0.45, kernel, mode='same') * env
    extra['jaliLips'] = np.convolve(li_t * 1.2 - 0.45, kernel, mode='same') * env
    if brows:                                             # emphasis: brows lift on the loudest vowels (vanilla uses up to 0.45)
        lift = np.zeros_like(times)
        for (s, e, p), (_, _, z) in zip(phones, strengths):
            if p in VOWELS and z > 0.8:
                lift = np.maximum(lift, min(0.35, 0.25 * (z - 0.4)) * curve(times, s, e, True))
        lift = np.convolve(lift, kernel, mode='same')
        for side in 'lr':
            put(f'eye_{side}_brows_raise_in', lift)
            put(f'eye_{side}_brows_raise_out', 0.7 * lift)
    return times, tracks, extra


def to_channel(times, tracks, extra, track_names):
    """Additive values per frame in the rig's 414-track order: poses into …LipsyncPoseOutput, overrides muting the expression."""
    index = {n: i for i, n in enumerate(track_names)}
    frames = np.zeros((len(times), len(track_names)), dtype=np.float32)
    for name, values in extra.items():
        frames[:, index[name]] = values
    env = extra['lipSyncEnvelope']
    for name, values in tracks.items():
        frames[:, index[name + 'LipsyncPoseOutput']] = values
    for i, name in enumerate(track_names):
        if not name.endswith('AnimOverrideWeight'):
            continue
        pose = name[:-len('AnimOverrideWeight')]
        lps = tracks.get(pose, np.zeros_like(times))
        corner = any(pose.startswith('lips_') and pose.endswith(k) for k in CORNER_FAMILY)
        mute = np.maximum(lps, 0.5 * env) if corner else lps
        frames[:, i] = -mute
    return frames


def vanilla_frames(path, clip, track_names):
    root = json.loads(Path(path).read_text(encoding='utf-8'))['Data']['RootChunk']
    chunks = [base64.b64decode(c['buffer']['Bytes']) for c in root['animationDataChunks']]
    for a in root['animations']:
        anim = a['Data']['animation']['Data']
        if anim['name']['$value'] != clip:
            continue
        b = anim['animBuffer']['Data']; addr = b['dataAddress']
        raw = chunks[addr['unkIndex']][addr['fsetInBytes']:addr['fsetInBytes'] + addr['zeInBytes']]
        at = b['numAnimKeys'] * 10 + b['numAnimKeysRaw'] * 16 + b['numConstAnimKeys'] * 16
        dur = anim['duration']; keyed = {}
        for _ in range(b['numTrackKeys']):
            t, tr, v = struct.unpack_from('<HHf', raw, at); at += 8
            keyed.setdefault(tr, []).append((t / 65535 * dur, v))
        const = {}
        for _ in range(b['numConstTrackKeys']):
            tr, _t, v = struct.unpack_from('<HHf', raw, at); at += 8
            const[tr] = v
        times = np.arange(int(round(dur * FPS)) + 1) / FPS
        frames = np.zeros((len(times), len(track_names)), dtype=np.float32)
        for tr, v in const.items():
            frames[:, tr] = v
        for tr, keys in keyed.items():
            keys.sort(); k = np.array(keys)
            frames[:, tr] = np.interp(times, k[:, 0], k[:, 1])
        return times, frames
    raise SystemExit(f'clip {clip} not found')


def solver_setup():
    sys.path.insert(0, str(TOOLS))
    from bake_idle_face import external_solver
    loader, runtime, model, solver = external_solver(Path('D:/Dev/Cyberpunk-Blender-add-on'))
    rig = json.loads((INTAKE / 'h0_000_pwa_c__basehead_skeleton.rig.json').read_text(encoding='utf-8'))['Data']['RootChunk']
    setup = loader.parse_facial_setup(json.loads((INTAKE / 'h0_000_pwa_c__basehead_rigsetup.facialsetup.json').read_text(encoding='utf-8')))
    names = [x['$value'] for x in rig['boneNames']]
    tracks = [x['$value'] for x in rig['trackNames']]
    dims = types.SimpleNamespace(num_bones=len(names), num_tracks=len(tracks))
    compiled = runtime.compile_runtime(setup, dims, model.TrackSegments.from_setup(setup, len(tracks)))
    return rig, names, tracks, compiled, solver


def qmul(a, b):
    xyz = a[:3] * b[3] + b[:3] * a[3] + np.cross(a[:3], b[:3])
    return np.r_[xyz, a[3] * b[3] - np.dot(a[:3], b[:3])]


def qrot(q, v):
    return v + 2 * np.cross(q[:3], np.cross(q[:3], v) + q[3] * v)


def metrics(frames_add, rig, names, compiled, solver, times):
    """Lip gap (mean of the two mid-lip joint pairs, mm, relative to rest) and jaw joint rotation (degrees) per frame."""
    parents = rig['boneParentIndexes']
    rest = rig['boneTransforms']
    rq = np.array([[t['Rotation'][k] for k in 'ijkr'] for t in rest], dtype=float)
    rt = np.array([[t['Translation'][k] for k in 'XYZ'] for t in rest], dtype=float)
    ref = np.array(rig['referenceTracks'], dtype=np.float32)
    pairs = [(names.index(f'{s}_J_mug_lip_up_0_JNT'), names.index(f'{s}_J_mug_lip_dn_0_JNT')) for s in 'lr']
    corners = (names.index('l_J_mug_lip_corner_0_JNT'), names.index('r_J_mug_lip_corner_0_JNT'))
    jaw = names.index('mid_J_jaw_JNT')
    out = []

    def world(q, t):
        wq = np.zeros_like(q); wt = np.zeros_like(t)
        for i, p in enumerate(parents):
            if p < 0:
                wq[i], wt[i] = q[i], t[i]
            else:
                wq[i] = qmul(wq[p], q[i]); wt[i] = wt[p] + qrot(wq[p], t[i])
        return wt

    base = world(rq, rt)
    gap0 = np.mean([np.linalg.norm(base[a] - base[b]) for a, b in pairs])
    width0 = np.linalg.norm(base[corners[0]] - base[corners[1]])
    for f in frames_add:
        q, t, _ = solver.solve_runtime(compiled, ref + f, lod=0)
        lq = np.array([qmul(rq[i], q[i]) for i in range(len(names))])
        lt = rt + np.array([qrot(rq[i], t[i]) for i in range(len(names))])
        w = world(lq, lt)
        gap = np.mean([np.linalg.norm(w[a] - w[b]) for a, b in pairs]) - gap0
        width = np.linalg.norm(w[corners[0]] - w[corners[1]]) - width0
        angle = np.degrees(2 * np.arccos(min(1.0, abs(float(q[jaw][3])))))
        out.append((gap * 1000, width * 1000, angle))
    return np.array(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wav', type=Path, required=True)
    ap.add_argument('--phones', type=Path, required=True)
    ap.add_argument('--vanilla', type=Path)
    ap.add_argument('--clip')
    ap.add_argument('--out', type=Path, default=HERE / 'generated')
    args = ap.parse_args()
    args.out.mkdir(exist_ok=True)
    rate, data = read_wav(args.wav)
    phones = read_phones(args.phones)
    times, tracks, extra = build(phones, rate, data)
    rig, names, track_names, compiled, solver = solver_setup()
    frames = to_channel(times, tracks, extra, track_names)
    (args.out / 'clip.json').write_text(json.dumps({'fps': FPS, 'animationType': 'AdditiveFromRefPose',
        'duration': float(times[-1]), 'tracks': {track_names[i]: [round(float(v), 4) for v in frames[:, i]]
                                                  for i in np.flatnonzero(np.abs(frames).max(axis=0) > 1e-6)}}))
    report = {'phones': len(phones), 'duration': round(float(times[-1]), 2), 'animatedTracks':
              int((np.abs(frames).max(axis=0) > 1e-6).sum())}
    m = metrics(frames, rig, names, compiled, solver, times)
    bil = [(s, e) for s, e, p in phones if PHONE_VISEME[p] == 'PP']
    at = lambda t: int(round(t * FPS))
    report['generated'] = {
        'lipGapMm': {'min': round(float(m[:, 0].min()), 2), 'max': round(float(m[:, 0].max()), 2)},
        'mouthWidthMm': {'min': round(float(m[:, 1].min()), 2), 'max': round(float(m[:, 1].max()), 2)},
        'jawDeg': {'max': round(float(m[:, 2].max()), 2)},
        'lipGapMmP50P90': [round(float(np.percentile(m[m[:, 0] > 0.5, 0], q)), 2) for q in (50, 90)],
        'bilabialGapMm': [round(float(m[min(at(s + 0.5 * (e - s)), len(m) - 1), 0]), 2) for s, e in bil],
    }
    if args.vanilla and args.clip:
        vt, vf = vanilla_frames(args.vanilla, args.clip, track_names)
        vm = metrics(vf, rig, names, compiled, solver, vt)
        report['vanilla'] = {'clip': args.clip, 'duration': round(float(vt[-1]), 2),
            'lipGapMm': {'min': round(float(vm[:, 0].min()), 2), 'max': round(float(vm[:, 0].max()), 2)},
            'mouthWidthMm': {'min': round(float(vm[:, 1].min()), 2), 'max': round(float(vm[:, 1].max()), 2)},
            'jawDeg': {'max': round(float(vm[:, 2].max()), 2)},
            'lipGapMmP50P90': [round(float(np.percentile(vm[vm[:, 0] > 0.5, 0], q)), 2) for q in (50, 90)]}
    np.savetxt(args.out / 'generated-metrics.tsv', np.c_[times, m], fmt='%.3f', delimiter='\t', header='t\tgap_mm\twidth_mm\tjaw_deg')
    (args.out / 'report.json').write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
