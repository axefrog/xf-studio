"""Which MO2 mod archives carry the CC scene, its camera/UI resources or the grading LUTs (RDAR index hashes only)."""
import glob, struct, sys

BS = chr(92)


def fnv(s):
    h = 0xcbf29ce484222325
    for b in s.lower().replace('/', BS).encode():
        h ^= b
        h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    return h


PATHS = [
    'base/weather/24h_basic/luts/cp2077_gen_lut_nge_v017.xbm',
    'base/weather/24h_basic/luts/cp2077_gen_lut_nge_hdr_v017.xbm',
    'base/weather/24h_basic/cp2077_master_env_nge_v002.env',
    'base/worlds/03_night_city/_compiled/default/quest_a73ac4b55b3d6ec1.streamingsector',
    'base/worlds/03_night_city/_compiled/default/quest_8cf966bb983a0158.streamingsector',
    'base/worlds/04_main_menu/_compiled/default/quest_fc76e8948d75e8d4.streamingsector',
    'base/worlds/04_main_menu/_compiled/default/quest_a0f0cd2476942221.streamingsector',
    'base/worlds/04_main_menu/_compiled/default/04_main_menu.streamingworld',
    'base/gameplay/gui/fullscreen/main_menu/target_face.ent',
    'base/gameplay/gui/fullscreen/main_menu/prefabs/empty_room_char_creation_female.ent',
    'base/gameplay/gui/fullscreen/main_menu/prefabs/empty_room_char_creation_male.ent',
    'base/gameplay/gui/fullscreen/main_menu/character_creation_step_6.inkwidget',
    'base/gameplay/gui/fullscreen/main_menu/preview.dtex',
    'base/gameplay/gui/fullscreen/main_menu/preview.inkatlas',
    'base/items/quest/q110__misc/q110_black_box.mesh',
    'base/gameplay/gui/fullscreen/menu.inkmenu',
    'base/gameplay/gui/fullscreen/main_menu/pregame_menu.inkmenu',
    'base/materials/hair.mt',  # control: expected absent or rare
]

want = {fnv(p): p for p in PATHS}
hits = {}
root = sys.argv[1]
for a in glob.glob(root + '/**/*.archive', recursive=True):
    try:
        with open(a, 'rb') as f:
            h = f.read(24)
            if h[:4] != b'RDAR':
                continue
            off = struct.unpack_from('<Q', h, 8)[0]
            f.seek(off + 16)
            cnt = struct.unpack('<I', f.read(4))[0]
            f.seek(off + 28)
            data = f.read(cnt * 56)
        for i in range(cnt):
            hv = struct.unpack_from('<Q', data, i * 56)[0]
            if hv in want:
                rel = a[len(root) + 1:].replace(BS, '/')
                hits.setdefault(want[hv], []).append(rel)
    except Exception as e:
        print('ERR', a, e)
for p in PATHS:
    print(p, '->', hits.get(p, []))
