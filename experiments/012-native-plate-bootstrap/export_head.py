"""Export a bound native head GLB from extracted installed-game resources."""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
HQ = HERE.parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(command):
    result = subprocess.run([str(x) for x in command], cwd=HQ, capture_output=True,
                            text=True, encoding='utf-8', errors='replace', timeout=300)
    if result.returncode:
        raise RuntimeError(f'{command[0]} failed: {(result.stdout + result.stderr)[-3000:]}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extracted-root', type=Path, required=True, help='Private WolvenKit extraction root')
    parser.add_argument('--native-morph-json', type=Path, required=True)
    parser.add_argument('--wolvenkit', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='Ignored private output directory')
    args = parser.parse_args()
    selection = json.loads((HERE / 'selection.json').read_text())
    assert sha(args.native_morph_json) == selection['sourceHeadMorphSha256']
    morph_document = json.loads(args.native_morph_json.read_text(encoding='utf-8-sig'))
    depot = Path(morph_document['Data']['RootChunk']['baseMesh']['DepotPath']['$value'].replace('\\', '/'))
    native_mesh = args.extracted_root / depot
    native_morph = args.extracted_root / 'base/characters/head/player_base_heads/player_female_average/h0_000_pwa__morphs.morphtarget'
    assert native_mesh.is_file() and native_morph.is_file()
    output = args.output
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output directory must be new and empty')
    output.mkdir(parents=True, exist_ok=True)
    adapter_project = HQ / 'projects/xf-studio/tools/morph-import'
    adapter = adapter_project / 'bin/Debug/net9.0/MorphImport.dll'
    run(['dotnet', 'build', adapter_project, '--nologo', '-v', 'quiet'])
    lookup = output / 'lookup' / depot
    lookup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(native_mesh, lookup)
    packed = output / 'packed'
    packed.mkdir(exist_ok=True)
    run([args.wolvenkit, 'pack', output / 'lookup', '-o', packed])
    run(['dotnet', adapter, '--export-bound', packed / 'lookup.archive', native_morph, output / 'head'])
    head = output / 'head.glb'
    report = {'schema': 'xfs/native-head-export-1', 'source': {'meshSha256': sha(native_mesh),
              'morphSha256': sha(native_morph), 'morphJsonSha256': sha(args.native_morph_json)},
              'output': {'sha256': sha(head), 'relativePath': head.name}, 'installed': False}
    (output / 'export-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
