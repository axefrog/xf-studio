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

DEFAULT_APP = Path(__file__).resolve().parents[1]
DEFAULT_HQ = DEFAULT_APP.parents[2]
DEFAULT_STUDY = DEFAULT_HQ / 'experiments/005-preset-collection'
DEFAULT_PROJECT = DEFAULT_APP.parent


def file_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def run(command, cwd, log=None):
    if log is None:
        subprocess.run([str(part) for part in command], cwd=cwd, check=True, timeout=1800)
        return
    result = subprocess.run([str(part) for part in command], cwd=cwd,
        capture_output=True, text=True, timeout=600)
    log.write_text(result.stdout + '\n' + result.stderr, encoding='utf-8')
    if result.returncode:
        raise ValueError(f'Independent verifier failed ({result.returncode}): {result.stderr[-3000:]}')


def destination(root, dist_root):
    """Return a canonical destination beneath the host's private dist root."""
    reject_linked_path(root, 'Output root')
    base = dist_root.resolve()
    chosen = root.resolve()
    if chosen != base and base not in chosen.parents:
        raise ValueError(f'Output must be inside {base}; game/MO2 deployment is a separate action.')
    if chosen.exists() and not chosen.is_dir():
        raise ValueError(f'Output root is not a directory: {chosen}')
    return chosen


def reject_linked_path(path, label):
    """Reject symlinks and Windows junctions in writable paths before resolving them."""
    absolute = path.absolute()
    for component in (absolute, *absolute.parents):
        if component.is_symlink() or (hasattr(component, 'is_junction') and component.is_junction()):
            raise ValueError(f'{label} uses a linked directory: {component}')


def overlaps(left, right):
    return left == right or left in right.parents or right in left.parents


def guard_private_roots(build_arg, dist_arg, output_arg, protected, collection):
    """Keep all wrapper writes apart from declared source, game and tool inputs."""
    for label, path in [('Build root', build_arg), ('Dist root', dist_arg), ('Output root', output_arg)]:
        reject_linked_path(path, label)
    build_root, dist_root = build_arg.resolve(), dist_arg.resolve()
    output_root = destination(output_arg, dist_root)
    if overlaps(build_root, dist_root):
        raise ValueError('Build and dist roots must be separate private directories.')
    for label, path in protected:
        source = path.resolve()
        for root_label, root in [('Build root', build_root), ('Dist root', dist_root)]:
            if overlaps(root, source):
                raise ValueError(f'{root_label} overlaps configured {label}: {source}')
    if build_root == collection or build_root in collection.parents or dist_root == collection or dist_root in collection.parents:
        raise ValueError('Collection input cannot be inside a writable build or dist root.')
    return build_root, dist_root, output_root


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collection', type=Path, required=True, help='Studio Export collection JSON')
    parser.add_argument('--plate', type=Path, help='Local experiment-004 plate resource directory')
    parser.add_argument('--wolvenkit', type=Path, help='WolvenKit.CLI executable')
    parser.add_argument('--gamepath', type=Path, help='Local Cyberpunk 2077 directory for texture conversion')
    parser.add_argument('--bun', type=Path, default=Path(shutil.which('bun') or ''), help='Bun executable')
    parser.add_argument('--app-root', type=Path, default=DEFAULT_APP, help='Studio authoring source root')
    parser.add_argument('--study-root', type=Path, default=DEFAULT_STUDY, help='Experiment 005 Python tools root')
    parser.add_argument('--work-root', type=Path, default=DEFAULT_HQ, help='Working directory for child tools')
    parser.add_argument('--build-root', type=Path, default=DEFAULT_PROJECT/'build', help='Private intermediate build root')
    parser.add_argument('--dist-root', type=Path, default=DEFAULT_PROJECT/'dist', help='Host-owned private package root')
    parser.add_argument('--preflight-script', type=Path, help='Shared TypeScript preflight entry; defaults under app root')
    parser.add_argument('--bake-script', type=Path, help='Shared TypeScript bake entry; defaults under app root')
    parser.add_argument('--output-root', type=Path, help='Destination within --dist-root (defaults to dist root)')
    parser.add_argument('--check', action='store_true', help='Validate the collection/finish support without building')
    parser.add_argument('--machine-result', action='store_true', help='Emit one prefixed JSON result for the local server')
    args = parser.parse_args(argv)

    try:
        app = args.app_root.resolve(strict=True)
        study = args.study_root.resolve()
        work_root = args.work_root.resolve(strict=True)
        build_root = args.build_root.resolve()
        dist_root = args.dist_root.resolve()
        preflight_script = (args.preflight_script or app/'tools/validate_collection_build.ts').resolve(strict=True)
        bake_script = (args.bake_script or app/'tools/bake_collection.ts').resolve()
        if not app.is_dir() or not work_root.is_dir():
            raise ValueError('App and work roots must be directories.')
        output_root = destination(args.output_root or dist_root, dist_root)
        collection = args.collection.resolve(strict=True)
        if not collection.is_file() or collection.stat().st_size > 16_000_000:
            raise ValueError('Collection must be a file of at most 16 MB.')
        source_hash = file_hash(collection)
        bun = args.bun.resolve(strict=True)
        if not bun.is_file(): raise ValueError(f'Bun executable is missing: {bun}')
        preflight = subprocess.run([str(bun), str(preflight_script), str(collection)],
            cwd=work_root, capture_output=True, text=True, encoding='utf-8', timeout=120)
        if preflight.returncode:
            raise ValueError('Collection preflight rejected input: ' + preflight.stderr[-3000:])
        summary = json.loads(preflight.stdout)
        packaged_json = summary.pop('packagedCollectionJson')
        packaged_hash = hashlib.sha256(packaged_json.encode('utf-8')).hexdigest()
        summary['packagedCollectionSha256'] = packaged_hash
        if file_hash(collection) != source_hash:
            raise ValueError('Collection changed during preflight; export a stable snapshot and retry.')
        if args.check:
            result = {'ready': True, **summary}
            print(('XFS_PACKAGE_RESULT=' + json.dumps(result)) if args.machine_result else json.dumps(result, indent=2))
            return 0
        if not study.is_dir() or not (study/'build.py').is_file() or not (study/'verify.py').is_file() or not bake_script.is_file():
            raise ValueError('Build requires the Experiment 005 tools and shared bake script.')
        if not args.plate or not args.wolvenkit or not args.gamepath:
            raise ValueError('Build requires --plate, --wolvenkit and --gamepath. --check only needs --collection.')
        plate = args.plate.resolve(strict=True)
        wolvenkit = args.wolvenkit.resolve(strict=True)
        gamepath = args.gamepath.resolve(strict=True)
        for name in ('xfas_eye_plate.mesh', 'xfas_eye_plate.morphtarget'):
            if not (plate/name).is_file(): raise ValueError(f'Missing source plate resource: {plate/name}')
        if not wolvenkit.is_file() or not gamepath.is_dir():
            raise ValueError('WolvenKit must be a file and gamepath must be a directory.')
        protected = [('game root', gamepath), ('plate source', plate), ('app source', app),
                     ('study source', study), ('preflight tool', preflight_script.parent),
                     ('bake tool', bake_script.parent), ('WolvenKit tools', wolvenkit.parent),
                     ('Bun tools', bun.parent)]
        build_root, dist_root, output_root = guard_private_roots(
            args.build_root, args.dist_root, args.output_root or args.dist_root, protected, collection)
        token = f"{summary['namespace']}-{time.time_ns()}"
        intermediate = build_root / token
        final = output_root / token
        if intermediate.exists() or final.exists(): raise ValueError('Build destination already exists.')
        build_root.mkdir(parents=True, exist_ok=True)
        snapshot = build_root / f'source-{token}.json'
        if file_hash(collection) != source_hash:
            raise ValueError('Collection changed during preflight; export a stable snapshot and retry.')
        snapshot.write_text(packaged_json, encoding='utf-8')
        if file_hash(snapshot) != packaged_hash:
            snapshot.unlink(missing_ok=True)
            raise ValueError('Filtered collection snapshot changed while writing; retry.')
        print(f'Building {len(summary["presets"])} preset(s) in ignored local intermediates: {intermediate}', flush=True)
        try:
            run([sys.executable, study/'build.py', '--collection', snapshot, '--output', intermediate,
                '--plate', plate, '--wolvenkit', wolvenkit, '--bun', bun, '--gamepath', gamepath,
                '--app-root', app, '--work-root', work_root, '--bake-script', bake_script, '--no-latest'], work_root)
        finally:
            snapshot.unlink(missing_ok=True)
        run([sys.executable, study/'verify.py', '--build', intermediate, '--wolvenkit', wolvenkit], work_root,
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
        checked_roots = guard_private_roots(
            args.build_root, args.dist_root, args.output_root or args.dist_root, protected, collection)
        if checked_roots != (build_root, dist_root, output_root):
            raise ValueError('Private output roots changed during the build.')
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
                'packagedCollectionSha256': packaged_hash,
                'originalPresetCount': summary['originalPresetCount'], 'omissions': summary['omissions'],
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
            'presetCount': verification['presetCount'], 'originalPresetCount': summary['originalPresetCount'],
            'omissions': summary['omissions'], 'packagedCollectionSha256': packaged_hash, 'installed': False,
            'gameRenderingVerified': False}
        print(('XFS_PACKAGE_RESULT=' + json.dumps(result)) if args.machine_result else json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, KeyError, json.JSONDecodeError, subprocess.CalledProcessError,
            subprocess.TimeoutExpired) as error:
        parser.exit(1, f'Package build failed: {error}\nNo package was installed or promoted.\n')


if __name__ == '__main__':
    raise SystemExit(main())
