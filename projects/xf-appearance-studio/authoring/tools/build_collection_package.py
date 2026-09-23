"""Build a local, offline-verified XF Studio eye-makeup package. Never installs it.

Experiment 005 remains the resource/compiler source of truth. Only a successful
independent verification is promoted into the ignored project dist directory.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

APP = Path(__file__).resolve().parents[1]
HQ = APP.parents[2]
STUDY = HQ / 'experiments/005-preset-collection'
PROJECT = APP.parent
DIST = PROJECT / 'dist'
BUILD = PROJECT / 'build'


def file_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def run(command, log=None):
    if log is None:
        subprocess.run([str(part) for part in command], cwd=HQ, check=True, timeout=1800)
        return
    result = subprocess.run([str(part) for part in command], cwd=HQ,
        capture_output=True, text=True, timeout=600)
    log.write_text(result.stdout + '\n' + result.stderr, encoding='utf-8')
    if result.returncode:
        raise ValueError(f'Independent verifier failed ({result.returncode}): {result.stderr[-3000:]}')


def destination(root):
    """Only return an ignored project dist path, never a game/mod deployment path."""
    base = DIST.resolve()
    chosen = root.resolve()
    if chosen != base and base not in chosen.parents:
        raise ValueError(f'Output must be inside {base}; game/MO2 deployment is a separate action.')
    if chosen.exists() and not chosen.is_dir():
        raise ValueError(f'Output root is not a directory: {chosen}')
    return chosen


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collection', type=Path, required=True, help='Studio Export collection JSON')
    parser.add_argument('--plate', type=Path, help='Local experiment-004 plate resource directory')
    parser.add_argument('--wolvenkit', type=Path, help='WolvenKit.CLI executable')
    parser.add_argument('--gamepath', type=Path, help='Local Cyberpunk 2077 directory for texture conversion')
    parser.add_argument('--bun', type=Path, default=Path(shutil.which('bun') or ''), help='Bun executable')
    parser.add_argument('--output-root', type=Path, default=DIST, help='Ignored destination within project dist')
    parser.add_argument('--check', action='store_true', help='Validate the collection/finish support without building')
    parser.add_argument('--machine-result', action='store_true', help='Emit one prefixed JSON result for the local server')
    args = parser.parse_args(argv)

    try:
        output_root = destination(args.output_root)
        collection = args.collection.resolve(strict=True)
        if not collection.is_file() or collection.stat().st_size > 16_000_000:
            raise ValueError('Collection must be a file of at most 16 MB.')
        source_hash = file_hash(collection)
        bun = args.bun.resolve(strict=True)
        if not bun.is_file(): raise ValueError(f'Bun executable is missing: {bun}')
        preflight = subprocess.run([str(bun), str(APP/'tools/validate_collection_build.ts'), str(collection)],
            cwd=HQ, capture_output=True, text=True, timeout=120)
        if preflight.returncode:
            raise ValueError('Collection preflight rejected input: ' + preflight.stderr[-3000:])
        summary = json.loads(preflight.stdout)
        if args.check:
            result = {'ready': True, **summary}
            print(('XFS_PACKAGE_RESULT=' + json.dumps(result)) if args.machine_result else json.dumps(result, indent=2))
            return 0
        if not args.plate or not args.wolvenkit or not args.gamepath:
            raise ValueError('Build requires --plate, --wolvenkit and --gamepath. --check only needs --collection.')
        plate = args.plate.resolve(strict=True)
        wolvenkit = args.wolvenkit.resolve(strict=True)
        gamepath = args.gamepath.resolve(strict=True)
        for name in ('xfas_eye_plate.mesh', 'xfas_eye_plate.morphtarget'):
            if not (plate/name).is_file(): raise ValueError(f'Missing source plate resource: {plate/name}')
        if not wolvenkit.is_file() or not gamepath.is_dir():
            raise ValueError('WolvenKit must be a file and gamepath must be a directory.')
        token = f"{summary['namespace']}-{time.time_ns()}"
        intermediate = BUILD / token
        final = output_root / token
        if intermediate.exists() or final.exists(): raise ValueError('Build destination already exists.')
        BUILD.mkdir(parents=True, exist_ok=True)
        snapshot = BUILD / f'source-{token}.json'
        if file_hash(collection) != source_hash:
            raise ValueError('Collection changed during preflight; export a stable snapshot and retry.')
        shutil.copyfile(collection, snapshot)
        if file_hash(snapshot) != source_hash:
            snapshot.unlink(missing_ok=True)
            raise ValueError('Collection changed while copying the build snapshot; retry.')
        print(f'Building {len(summary["presets"])} preset(s) in ignored local intermediates: {intermediate}', flush=True)
        try:
            run([sys.executable, STUDY/'build.py', '--collection', snapshot, '--output', intermediate,
                '--plate', plate, '--wolvenkit', wolvenkit, '--bun', bun, '--gamepath', gamepath, '--no-latest'])
        finally:
            snapshot.unlink(missing_ok=True)
        run([sys.executable, STUDY/'verify.py', '--build', intermediate, '--wolvenkit', wolvenkit],
            log=intermediate/'logs/package-verify-cli.log')
        verification = json.loads((intermediate/'verification.json').read_text(encoding='utf-8'))
        built = json.loads((intermediate/'build.json').read_text(encoding='utf-8'))
        if verification['archiveSha256'] != built['archiveSha256'] or verification['presetCount'] != len(summary['presets']):
            raise ValueError('Independent verification does not match the build.')
        built_plan = built['plan']
        if built_plan['collectionId'] != summary['collectionId'] or built_plan['namespace'] != summary['namespace'] or [
            {key: preset[key] for key in ('id', 'revision', 'appearance')} for preset in built_plan['presets']
        ] != summary['presets']:
            raise ValueError('Compiled collection identities differ from preflight.')
        source_package = intermediate/'package/archive/pc/mod'
        names = [summary['namespace'] + suffix for suffix in ('.archive', '.archive.xl')]
        output_root.mkdir(parents=True, exist_ok=True)
        staging = output_root / ('.staging-' + token)
        staging.mkdir(exist_ok=False)
        try:
            target = staging/'archive/pc/mod'
            target.mkdir(parents=True)
            for name in names: shutil.copyfile(source_package/name, target/name)
            manifest = {
                'schema': 'xfs/local-package-1', 'collectionId': summary['collectionId'],
                'collectionSha256': source_hash, 'namespace': summary['namespace'],
                'presets': summary['presets'], 'verifiedPresetCount': verification['presetCount'],
                'verifiedUnpackedFiles': verification['unpackedFilesVerified'],
                'files': [{'path': f'archive/pc/mod/{name}', 'sha256': file_hash(target/name),
                           'bytes': (target/name).stat().st_size} for name in names],
                'installed': False, 'gameRenderingVerified': False,
                'limits': verification['limits'],
            }
            if manifest['files'][0]['sha256'] != verification['archiveSha256']:
                raise ValueError('Promoted archive differs from the verified archive.')
            (staging/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
            staging.rename(final)
        finally:
            if staging.exists(): shutil.rmtree(staging)
        result = {'package': str(final), 'manifest': str(final/'manifest.json'), 'archiveSha256': verification['archiveSha256'],
            'presetCount': verification['presetCount'], 'installed': False,
            'gameRenderingVerified': False}
        print(('XFS_PACKAGE_RESULT=' + json.dumps(result)) if args.machine_result else json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, KeyError, json.JSONDecodeError, subprocess.CalledProcessError,
            subprocess.TimeoutExpired) as error:
        parser.exit(1, f'Package build failed: {error}\nNo package was installed or promoted.\n')


if __name__ == '__main__':
    raise SystemExit(main())
