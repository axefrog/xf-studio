"""Extract and normalize the fixed Cyberpunk 2077 2.31 brown-eye profile.

All game-derived output stays under this experiment's ignored generated/ folder.
This records shader inputs; it does not bake a rendered iris texture.
"""
import argparse
import hashlib
import json
import math
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARCHIVES = {
    'appearance': ('archive/pc/content/basegame_4_appearance.archive',
                   '9c20370467e71d49ffb0a6415fe0415b2349ac22fe5afd38daf2783f54f2443b'),
    'template': ('archive/pc/content/memoryresident_1_general.archive',
                 '71d3d4116eee455b75309e0c36f5af5aa2fef17ecf509639c3e3a622fcf32295'),
}
RESOURCES = {
    'profile': ('appearance', 'base/characters/common/eyes/gradient_profiles/eye_brown.gradient',
                'a0316560105d88121dab00467ed1ff22a361db528ce9d7db019717e12fea5e04'),
    'instance': ('appearance', 'base/characters/common/eyes/brown_eye_gradient.mi',
                 '3dab26626dece44d46811c00504d75a65971bbdfcf2d72871324906cb896c676'),
    'template': ('template', 'base/materials/eye_gradient.mt',
                 '348ec8d2b88288dec4fea5dca69f4d15bcc0c2c3c0b89111bf4f922fdb0f36f5'),
}
EXPECTED_REFERENCES = {
    'Albedo': 'base/characters/common/eyes/textures/he_000_base_d02.xbm',
    'Normal': 'base/characters/common/eyes/textures/he_000_base_n01.xbm',
    'Roughness': 'base/characters/common/eyes/textures/he_000_base_rm01.xbm',
    'Blick': 'base/characters/common/eyes/cube_blick_1.cubemap',
    'NormalBubble': 'base/characters/common/eyes/textures/normal_bubble.xbm',
    'IrisMask': 'base/characters/common/eyes/textures/eye_mask.xbm',
    'IrisColorGradient': RESOURCES['profile'][1],
}
OPTIC_NAMES = (
    'RefractionIndex', 'RefractionAmount', 'IrisSize',
    'EyeHorizAngleRight', 'EyeHorizAngleLeft', 'EyeRadius',
    'EyeParallaxPlane', 'BubbleNormalTile', 'EggFullRadius',
    'EggMarginExponent', 'EggMarginFactor', 'EggSubFactor',
    'IrisCoordFactor', 'IrisCoordMargin', 'Specularity',
    'RoughnessScale', 'SubsurfaceFactor', 'AntiLightbleedValue',
    'AntiLightbleedUpOff',
)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def require_hash(path, expected):
    if not path.is_file() or digest(path) != expected:
        raise ValueError(f'Missing or changed 2.31 input: {path}; expected SHA-256 {expected}')


def run(*parts):
    proc = subprocess.run([str(part) for part in parts], capture_output=True,
                          text=True, encoding='utf-8', errors='replace', timeout=300)
    if proc.returncode:
        raise RuntimeError(f'{parts[0]} failed ({proc.returncode}): {(proc.stdout + proc.stderr)[-2000:]}')


def root(path, expected_type):
    doc = json.loads(path.read_text(encoding='utf-8-sig'))
    if doc['Header']['GameVersion'] != 2310 or doc['Data']['RootChunk']['$type'] != expected_type:
        raise ValueError(f'Unexpected serialized resource: {path}')
    return doc['Data']['RootChunk']


def depot(reference):
    return reference['DepotPath']['$value'].replace('\\', '/')


def normalize(source):
    profile = root(source / (RESOURCES['profile'][1] + '.json'), 'CGradient')
    instance = root(source / (RESOURCES['instance'][1] + '.json'), 'CMaterialInstance')
    template = root(source / (RESOURCES['template'][1] + '.json'), 'CMaterialTemplate')
    if depot(instance['baseMaterial']) != RESOURCES['template'][1]:
        raise ValueError('Brown-eye material template link changed')
    if template['name']['$value'] != 'eye_gradient' or template['materialType'] != 'RMT_Eye':
        raise ValueError('Eye-gradient template identity changed')
    parameters = {row['name']['$value']: row['type'] for group in template['parameterInfo'] for row in group}
    if parameters.get('IrisColorGradient') != 16:
        raise ValueError('Gradient template parameter changed')

    values = {}
    for row in instance['values']:
        names = [key for key in row if not key.startswith('$')]
        if len(names) != 1 or names[0] in values:
            raise ValueError('Unexpected or duplicate instance value')
        name = names[0]
        item = row[name]
        values[name] = depot(item) if isinstance(item, dict) and 'DepotPath' in item else item
    references = {name: values[name] for name in EXPECTED_REFERENCES}
    if references != EXPECTED_REFERENCES:
        raise ValueError('Brown-eye material reference chain changed')
    if any(name not in parameters for name in (*EXPECTED_REFERENCES, *OPTIC_NAMES)):
        raise ValueError('Template does not declare all recorded inputs')
    optics = {name: values[name] for name in OPTIC_NAMES}
    if any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in optics.values()):
        raise ValueError('Non-finite or missing optical scalar')

    stops = []
    for entry in profile['gradientEntries']:
        color = entry['color']
        at = entry['value']
        rgba = [color[channel] for channel in ('Red', 'Green', 'Blue', 'Alpha')]
        if not isinstance(at, (int, float)) or not math.isfinite(at) or not 0 <= at <= 1:
            raise ValueError('Invalid gradient position')
        if any(not isinstance(v, int) or not 0 <= v <= 255 for v in rgba):
            raise ValueError('Invalid gradient colour')
        stops.append({'position': at, 'rgba8': rgba})
    stops.sort(key=lambda row: row['position'])
    if len(stops) != 3 or len({row['position'] for row in stops}) != 3:
        raise ValueError('Unexpected gradient stop layout')
    return {'schema': 'xfs/native-eye-gradient-inputs-1', 'gameVersion': '2.31',
            'source': {name: {'archive': ARCHIVES[item[0]][0], 'depot': item[1], 'sha256': item[2]}
                       for name, item in RESOURCES.items()},
            'gradientStops': stops, 'materialReferences': references, 'materialScalars': optics,
            'limits': ['Stops preserve decoded source positions and RGBA bytes; no shader interpolation, colour-space or iris-mask interpretation is inferred.',
                       'Scalars and references are source inputs, not Three.js settings or game-rendering proof.',
                       'Gaze node transforms, native eye rig assembly, effective provider winner and accepted eye plate are outside this probe.']}


def build(args):
    output = args.output.resolve()
    if not output.is_relative_to((HERE / 'generated').resolve()):
        raise ValueError('Output must stay in this experiment\'s ignored generated/ folder')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output directory must be new and empty')
    game = args.game.resolve()
    cli = args.wolvenkit.resolve()
    require_hash(cli, 'fdffea5f19a13a5abf57487acf4e9cffce35e789d8f0d8ef551130021a086201')
    for relative, expected in ARCHIVES.values():
        require_hash(game / relative, expected)
    output.mkdir(parents=True, exist_ok=True)
    source = output / 'source'
    for archive_key in dict.fromkeys(item[0] for item in RESOURCES.values()):
        relative = ARCHIVES[archive_key][0]
        # These narrow names may match similarly suffixed siblings; only exact depot paths below are consumed.
        pattern = 'eye_brown\\.gradient$|brown_eye_gradient\\.mi$' if archive_key == 'appearance' else 'eye_gradient\\.mt$'
        run(cli, 'unbundle', game / relative, '-o', source, '-r', pattern, '-v', 'Quiet')
    for _, depot_path, expected in RESOURCES.values():
        require_hash(source / depot_path, expected)
    run(cli, 'convert', 's', source, '-v', 'Quiet')
    report = normalize(source)
    report['archiveSha256'] = {name: expected for name, (_, expected) in ARCHIVES.items()}
    destination = output / 'inputs.json'
    destination.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(json.dumps({'inputs': str(destination), 'sha256': digest(destination),
                      'gradientStops': len(report['gradientStops'])}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game', type=Path, required=True)
    parser.add_argument('--wolvenkit', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    build(parser.parse_args())
