"""Offline game-update baseline. No installs, downloads, or writes to input folders.

Run with the full Python interpreter; use --help for required local paths.
Each heavy child runs under the repository memory guard. Outputs are private.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import runpy
sys.dont_write_bytecode = True
from public_baseline import baseline_target, public_baseline, save_baseline, validate_public

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
APP = ROOT / 'projects/xf-studio/authoring'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inventory(folder):
    return [{'path': p.relative_to(folder).as_posix(), 'bytes': p.stat().st_size,
             'sha256': digest(p)} for p in sorted(folder.rglob('*')) if p.is_file()]


def isolated_environment(out, temp, game, inherited=None):
    # Discard inherited developer overrides before supplying the complete run-local policy.
    env = {k: v for k, v in (os.environ if inherited is None else inherited).items()
           if not k.upper().startswith(('XFS_', 'XFAS_'))}
    roots = {'XFAS_DATA_DIR': 'data', 'XFS_SETTINGS_DIR': 'settings',
             'XFS_PREVIEW_CORE_CACHE': 'preview', 'XFS_RESOLVER_CACHE': 'resolver',
             'XFS_CHOICE_PREVIEW_CACHE': 'choices', 'XFS_PACKAGE_PLATE_CACHE': 'plate',
             'XFS_EXPRESSIONS_GAME_CACHE': 'expressions', 'XFS_TOOLS_DIR': 'tools',
             'XFS_NATIVE_WRITER_ORACLE': 'writer-oracle', 'XFS_NATIVE_WRITER_OUTPUT': 'native-output',
             'XFS_SAVES_DIR': 'saves'}
    env.update({key: str(out / folder) for key, folder in roots.items()})
    env.update(TEMP=str(temp), TMP=str(temp), XFS_MOD_INSTALL='off',
               XFS_PACKAGE_GAMEPATH=str(game), XFS_RESOLVER_GAME_ROOT=str(game),
               XFS_NATIVE_WRITER_GAME_ROOT=str(game), XFS_REQUIRE_ORACLES='1', XFS_NATIVE_WRITER='off')
    return env


def require_capture_worktree(root, git_run=subprocess.run):
    identity = git_run(['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'],
                       cwd=root, capture_output=True, text=True)
    paths = identity.stdout.splitlines()
    if identity.returncode or len(paths) != 2:
        raise ValueError('Cannot verify the capture checkout. Run the recheck from a Git worktree.')
    if Path(paths[0]).resolve() == Path(paths[1]).resolve():
        raise ValueError('Captures rebuild browser bundles. Run the recheck from a Git worktree, not the main working tree.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('game', 'wk9', 'wk10', 'reference-root'):
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--label', required=True, help='New output name; existing folders are refused')
    parser.add_argument('--steps', default='roundtrip,prepare,plate,build,reader,writer,captures')
    parser.add_argument('--baseline', type=Path, default=HERE / 'baseline.json')
    parser.add_argument('--save-baseline', action='store_true')
    parser.add_argument('--port', type=int, default=4585)
    parser.add_argument('--writer-oracle', type=Path)
    parser.add_argument('--bcn', type=Path)
    parser.add_argument('--writer-build', type=Path, help='Existing kept production WolvenKit 9 build to capture')
    args = parser.parse_args()
    for name in ('game', 'wk9', 'wk10', 'reference_root', 'baseline', 'writer_oracle', 'writer_build', 'bcn'):
        value = getattr(args, name)
        if value is not None:
            setattr(args, name, value.resolve())
    allowed = {'roundtrip', 'prepare', 'plate', 'build', 'reader', 'writer', 'captures'}
    if any(name not in allowed for name in args.steps.split(',')):
        parser.error('unknown step')
    if 'captures' in args.steps.split(','):
        try:
            require_capture_worktree(ROOT)
        except ValueError as error:
            parser.error(str(error))
    if args.save_baseline and args.baseline.exists():
        parser.error('refusing to overwrite a saved baseline')
    if args.save_baseline:
        try:
            baseline_target(args.baseline, HERE)
        except ValueError as error:
            parser.error(str(error))
    if not args.game.is_dir() or not args.reference_root.is_dir():
        parser.error('game and reference root must exist')
    if args.writer_oracle and not args.writer_oracle.is_dir():
        parser.error('an explicit writer oracle is a read-only input and must already exist')
    if args.bcn and not args.bcn.is_file():
        parser.error('the explicit BCN DLL must already exist')
    if 'writer' in args.steps.split(',') and args.bcn is None:
        parser.error('writer requires --bcn pointing to a prebuilt DLL; this runner never compiles tools')
    for cli in (args.wk9, args.wk10):
        if not all(path.is_file() for path in (cli, cli.with_suffix('.dll'), cli.with_suffix('.runtimeconfig.json'))):
            parser.error('each supplied CLI must have its DLL and runtimeconfig beside it')
    if not args.label.replace('-', '').replace('_', '').isalnum():
        parser.error('label must contain only letters, digits, - and _')
    if args.port in (4317, 4331) or args.port + 5000 in (4317, 4331):
        parser.error('reserved port')
    ignored = subprocess.run(['git', 'check-ignore', str(HERE / 'generated/probe')],
                             cwd=ROOT, capture_output=True).returncode == 0
    if not ignored:
        parser.error('generated/ must be ignored')
    out = HERE / 'generated' / args.label
    out.mkdir(parents=True, exist_ok=False)
    scratch = HERE / 'generated/scratch'
    scratch.mkdir(parents=True, exist_ok=True)
    temp = scratch / args.label
    temp.mkdir(exist_ok=False)
    env = isolated_environment(out, temp, args.game)
    # Tools may write settings/logs beside themselves. Execute private copies only.
    tools = {}
    for name, source in [('wk9', args.wk9), ('wk10', args.wk10)]:
        destination = temp / name
        shutil.copytree(source.parent, destination)
        tools[name] = destination / source.name
    env['XFS_PACKAGE_WOLVENKIT'] = env['XFS_WOLVENKIT_CLI'] = str(tools['wk10'])
    steps = {}
    results = {'schema': 1, 'fixtureSha256': digest(ROOT / 'experiments/005-preset-collection/editor-collection.json'),
               'tools': {name: {'exeSha256': digest(path), 'managedSha256': digest(path.with_suffix('.dll')),
                               'runtime': json.loads(path.with_suffix('.runtimeconfig.json').read_text(encoding='utf-8-sig'))}
                         for name, path in tools.items()}, 'steps': steps}
    results['gameExecutableSha256'] = digest(args.game / 'bin/x64/Cyberpunk2077.exe')
    results['oodleSha256'] = digest(args.game / 'bin/x64/oo2ext_7_win64.dll')

    def run(name, command, cwd=APP, limit=3, timeout=1200):
        started = time.monotonic()
        guard = [sys.executable, str(ROOT / 'tools/memory_guard.py'), '--limit', str(limit), '--']
        with (out / (name + '.log')).open('w', encoding='utf-8') as log:
            try:
                completed = subprocess.run(guard + list(map(str, command)), cwd=cwd, env=env,
                                           stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
            except subprocess.TimeoutExpired:
                steps[name] = {'exit': 'timeout', 'seconds': round(time.monotonic() - started, 2)}
                raise RuntimeError(f'{name} exceeded {timeout}s; guard closed and its child job stopped')
        steps[name] = {'exit': completed.returncode, 'seconds': round(time.monotonic() - started, 2)}
        print(name, steps[name], flush=True)
        if completed.returncode:
            raise RuntimeError(f'{name} failed; see private log')

    def roundtrip():
        plate = args.reference_root / 'experiments/004-plate-import/generated/archive/axefrog/appearance_studio/studies'
        results['historicalPlateInputs'] = inventory(plate)
        for tool in tools:
            build = out / tool
            run(tool + '-build', [sys.executable, ROOT / 'experiments/005-preset-collection/build.py',
                '--collection', ROOT / 'experiments/005-preset-collection/editor-collection.json',
                '--output', build, '--plate', plate, '--wolvenkit', tools[tool], '--gamepath', args.game,
                '--work-root', ROOT, '--no-latest'], ROOT)
            run(tool + '-verify', [sys.executable, ROOT / 'experiments/005-preset-collection/verify.py',
                '--build', build, '--wolvenkit', tools[tool]], ROOT)
            results[tool + 'Members'] = inventory(build / 'archive')
            results[tool + 'Unpacked'] = inventory(build / 'unpacked')
        results['roundtripEqual'] = results['wk9Members'] == results['wk10Members']
        results['roundtripUnpackedEqual'] = results['wk9Unpacked'] == results['wk10Unpacked']
        results['roundtripChanges'] = [
            {'path': a['path'], 'wk9': a, 'wk10': b} for a, b in
            zip(results['wk9Members'], results['wk10Members']) if a != b]
        compare = runpy.run_path(str(HERE / 'compare-json.py'))['compare_folders']
        results['roundtripJsonChanges'] = compare(out / 'wk9/roundtrip', out / 'wk10/roundtrip')
        # The binary helper reads the current metadata and compares stored fields/buffers.
        (out / 'result.json').write_text(json.dumps(results))
        run('binary-analysis', ['bun', HERE / 'binary-diff.ts', args.game, out], limit=2)
        analysis = json.loads((out / 'binary-analysis.json').read_text(encoding='utf-8-sig'))
        diff = runpy.run_path(str(HERE / 'compare-json.py'))['differences']
        results['storedBinaryChanges'] = {path: {'storedEqual': info['storedEqual'],
            'buffersEqual': info['buffersEqual'], 'differences': diff(info['wk9']['stored'], info['wk10']['stored'])}
            for path, info in analysis.items()}

    def prepare():
        run('prepare-cold', ['bun', 'tools/prepare-preview.ts'])
        run('prepare-warm', ['bun', 'tools/prepare-preview.ts'])
        results['preparedManifests'] = [json.loads(p.read_text(encoding='utf-8-sig')) for p in sorted((out / 'preview').rglob('*manifest.json'))]
        results['preparedFiles'] = [item for item in inventory(out / 'preview')
                                    if not item['path'].endswith('.json')]

    def plate():
        failure = None
        try:
            run('plate', ['bun', 'tools/derive_eye_plate.ts', '--game', args.game,
                         '--wolvenkit', tools['wk10'], '--cache', out / 'plate'])
        except RuntimeError as error:
            failure = error
        results['plateManifests'] = [json.loads(p.read_text(encoding='utf-8-sig')) for p in sorted((out / 'plate').rglob('*manifest.json'))]
        run('provenance', ['bun', HERE / 'snapshot.ts', args.game, out], limit=2)
        results['provenance'] = json.loads((out / 'provenance.json').read_text(encoding='utf-8-sig'))
        if failure:
            raise failure

    def build():
        manifests = list((out / 'plate').rglob('plate-manifest.json'))
        if not manifests:
            manifests = list((out / 'plate').rglob('eye-plate-manifest.json'))
        if len(manifests) != 1:
            raise RuntimeError('one plate manifest required; run plate in the same pass')
        manifest = manifests[0]
        pair = next((out / 'plate').rglob('xfs_eye_plate.mesh')).parent
        run('studio-build', ['bun', 'tools/build_collection_package.ts', '--collection',
            ROOT / 'experiments/005-preset-collection/editor-collection.json', '--plate', pair,
            '--plate-manifest', manifest, '--wolvenkit', tools['wk10'], '--gamepath', args.game,
            '--build-root', out / 'build', '--dist-root', out / 'dist', '--machine-result'])
        results['buildManifests'] = [json.loads(p.read_text(encoding='utf-8-sig')) for p in sorted((out / 'dist').rglob('*.json'))]
        products = list((out / 'build').rglob('features/eye-makeup/build.json'))
        results['buildMembers'] = json.loads(products[0].read_text(encoding='utf-8-sig'))['artifacts']

    def reader():
        errors = []
        for tool in tools:
            env['XFS_WOLVENKIT_CLI'] = str(tools[tool])
            try:
                run('reader-oracle-' + tool, ['bun', 'test', 'tests/native-reader-oracle.test.ts'], limit=3)
            except RuntimeError as error:
                errors.append(str(error))
        env['XFS_WOLVENKIT_CLI'] = str(tools['wk10'])
        if errors:
            raise RuntimeError('; '.join(errors))

    def writer():
        oracle = args.writer_oracle or out / 'writer-oracle'
        bcn = args.bcn
        if not oracle.is_dir():
            source = args.writer_build
            if source is None:
                run('writer-plate', ['bun', 'tools/derive_eye_plate.ts', '--game', args.game,
                    '--wolvenkit', tools['wk9'], '--cache', out / 'writer-plate'])
                manifest = next((out / 'writer-plate').rglob('plate-manifest.json'))
                pair = next((out / 'writer-plate').rglob('xfs_eye_plate.mesh')).parent
                source = out / 'writer-build'
                run('writer-build', ['bun', 'tools/build_collection_package.ts', '--collection',
                    ROOT / 'experiments/005-preset-collection/editor-collection.json', '--plate', pair,
                    '--plate-manifest', manifest, '--wolvenkit', tools['wk9'], '--gamepath', args.game,
                    '--build-root', source, '--dist-root', out / 'writer-dist', '--machine-result'])
            env['XFS_NATIVE_WRITER_ORACLE'] = str(oracle)
            run('writer-capture', ['bun', 'tools/native-writer-oracle.ts', 'capture', source, 'game-baseline'])
        results['writerOracleInputs'] = [item for item in inventory(oracle)
            if not item['path'].endswith(('oracle.json', 'wolvenkit.archive'))]
        if not bcn.is_file():
            raise RuntimeError('prebuilt BCN DLL absent (supply --bcn)')
        env['XFS_NATIVE_WRITER_ORACLE'] = str(oracle)
        env['XFS_BCN_LIBRARY'] = str(bcn)
        results['bcnSha256'] = digest(bcn)
        failures = []
        try:
            run('writer-oracle', ['bun', 'test', 'tests/native-writer.test.ts'], limit=3)
        except RuntimeError as error:
            failures.append(str(error))
        env['XFS_NATIVE_WRITER_OUTPUT'] = str(out / 'native-output')
        try:
            run('writer-compare', ['bun', 'tools/native-writer-oracle.ts', 'compare', 'game-baseline'], limit=2)
        except RuntimeError as error:
            failures.append(str(error))
        identity = out / 'native-output/oodle-identity.json'
        if identity.exists():
            results['writerOodle'] = json.loads(identity.read_text(encoding='utf-8'))
        results['nativeWriterFiles'] = inventory(out / 'native-output')
        if not args.writer_oracle and not args.writer_build:
            run('writer-binary-analysis', ['bun', HERE / 'binary-diff.ts', args.game, out, '--writer'], limit=2)
            results['writerSemanticComparison'] = {path: {'storedEqual': info['storedEqual'], 'buffersEqual': info['buffersEqual']}
                for path, info in json.loads((out / 'writer-binary-analysis.json').read_text(encoding='utf-8-sig')).items()}
        run('compression-probe', ['bun', HERE / 'compression-probe.ts', args.game, oracle, out / 'compression-probe.json'], limit=2)
        results['writerCompression'] = json.loads((out / 'compression-probe.json').read_text(encoding='utf-8-sig'))
        if failures:
            raise RuntimeError('; '.join(failures))

    def captures():
        env['XFS_PACKAGE_WOLVENKIT'] = str(tools['wk9'])
        try:
            run('head-captures', ['bun', 'tools/starter-shapes-look.ts', out / 'captures', args.port,
                                  '--only', 'head', '--empty-settings'], limit=7, timeout=240)
            report = json.loads((out / 'captures/report.json').read_text(encoding='utf-8-sig'))
            results['captureReport'] = report
            results['captures'] = [f for f in inventory(out / 'captures') if f['path'].endswith('.png')]
            if not results['captures'] or report['unreached']:
                raise RuntimeError('capture tool did not reach every required state')
        finally:
            env['XFS_PACKAGE_WOLVENKIT'] = str(tools['wk10'])

    try:
        for name in args.steps.split(','):
            if name not in ('roundtrip', 'prepare', 'plate', 'build', 'reader', 'writer', 'captures'):
                parser.error('unknown step: ' + name)
            try:
                locals()[name]()
            except Exception as error:
                results.setdefault('failures', {})[name] = str(error)
                print(name, str(error), flush=True)
        # Keep exact private evidence, and scrub machine paths from shareable metadata.
        (out / 'result.json').write_text(json.dumps(results, indent=2) + '\n')
        encoded = json.dumps(results)
        for path, placeholder in [(temp, 'SCRATCH'), (out, 'RUN_OUTPUT'), (ROOT, 'REPOSITORY'),
                                  (args.reference_root, 'REFERENCE_ROOT'), (args.game, 'PATH_TO_GAME')]:
            for spelling in (str(path), str(path).replace('\\', '/')):
                encoded = encoded.replace(json.dumps(spelling)[1:-1], placeholder)
        shareable = public_baseline(json.loads(encoded))
        if args.save_baseline:
            save_baseline(args.baseline, json.loads(encoded), HERE)
        elif args.baseline.exists():
            previous = validate_public(json.loads(args.baseline.read_text(encoding='utf-8-sig')))
            previous = {**{k: v for k, v in previous.items() if k not in ('schema', 'sections')}, **previous['sections']}
            current = {**{k: v for k, v in shareable.items() if k not in ('schema', 'sections')}, **shareable['sections']}
            changed = [key for key in sorted(set(previous) | set(current))
                       if key != 'steps' and previous.get(key) != current.get(key)]
            print('DIFF (timings excluded): ' + ', '.join(changed or ['none']))
            diff = runpy.run_path(str(HERE / 'compare-json.py'))['differences']
            details = {key: diff(previous.get(key, '<missing>'), current.get(key, '<missing>')) for key in changed}
            (out / 'diff.json').write_text(json.dumps(details, indent=2) + '\n')
            for key, items in details.items():
                print(f'  {key}: {len(items)} changes; first paths: ' + ', '.join(item['path'] for item in items[:3]))
        return 1 if results.get('failures') or results.get('roundtripEqual') is False else 0
    finally:
        # This path is constructed below generated/scratch, never supplied by a caller.
        shutil.rmtree(temp)
        if not any(scratch.iterdir()):
            scratch.rmdir()


if __name__ == '__main__':
    sys.exit(main())
