"""Small synthetic checks; no game, WolvenKit, servers, or shared caches."""
import json
from pathlib import Path
import runpy
import shutil
import tempfile
import sys
sys.dont_write_bytecode = True
from public_baseline import baseline_target, public_baseline, save_baseline, validate_public
from recheck import isolated_environment, require_capture_worktree

HERE = Path(__file__).resolve().parent


def refused(action):
    try:
        action()
    except (ValueError, FileExistsError):
        return
    raise AssertionError('unsafe operation was accepted')


def main():
    scratch = HERE / 'generated/scratch'
    scratch.mkdir(exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix='safety-', dir=scratch))
    try:
        experiment = work / 'experiment'
        experiment.mkdir()
        import subprocess
        def git_identity(paths, code=0):
            def run(command, **options):
                assert command == ['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']
                return subprocess.CompletedProcess(command, code, '\n'.join(map(str, paths)), '')
            return run
        gitdir = experiment / '.git'
        refused(lambda: require_capture_worktree(experiment, git_identity([gitdir, gitdir])))
        refused(lambda: require_capture_worktree(experiment, git_identity([], 128)))
        require_capture_worktree(experiment, git_identity([gitdir / 'worktrees/test', gitdir]))
        refused(lambda: baseline_target(work / 'outside.json', experiment))
        refused(lambda: baseline_target(experiment / '../outside.json', experiment))
        refused(lambda: baseline_target(work / 'experiment-other/a.json', experiment))
        evidence = {'schema': 1, 'provenance': {'mapping': {'triangles': [0, 1, 2], 'vertices': [4, 5, 6]}},
                    'roundtripJsonChanges': {'added': {'Bytes': 'SECRET'}}}
        public = public_baseline(evidence)
        assert public['sections']['provenance']['count'] == 1
        assert 'SECRET' not in json.dumps(public) and 'triangles' not in json.dumps(public)
        refused(lambda: public_baseline({'unreviewed': [1, 2, 3]}))
        refused(lambda: validate_public({**public, 'raw': evidence}))
        refused(lambda: validate_public({'schema': 2, 'sections': {'provenance': evidence}}))
        target = experiment / 'baseline.json'
        save_baseline(target, evidence, experiment)
        before = target.read_bytes()
        refused(lambda: save_baseline(target, evidence, experiment))
        assert target.read_bytes() == before
        # A junction must resolve outside the allowed experiment before writing.
        import subprocess
        link = experiment / 'linked'
        if __import__('os').name == 'nt':
            result = subprocess.run(['cmd', '/c', 'mklink', '/J', str(link), str(work)], capture_output=True)
            assert result.returncode == 0, result.stderr
        else:
            link.symlink_to(work, target_is_directory=True)
        try:
            refused(lambda: baseline_target(link / 'escape.json', experiment))
        finally:
            if __import__('os').name == 'nt':
                link.rmdir()  # Unlink the junction, never recursively traverse it.
            else:
                link.unlink()
        diff = runpy.run_path(str(HERE / 'compare-json.py'))['differences']
        for left, right in [({}, {'nested': {'Bytes': 'SECRET'}}),
                            ({'nested': [{'Bytes': [1, 2, 3]}]}, {}),
                            ({'item': 1}, {'item': {'deep': {'Bytes': 'SECRET'}}})]:
            result = diff(left, right)
            assert result and 'SECRET' not in json.dumps(result)
            assert 'payloadLength' in json.dumps(result)
        assert 'sha256' in json.dumps(diff({'indices': [1, 2]}, {'indices': [2, 3]}))
        env = isolated_environment(work, work, work, {'XFS_RESOLVER_CACHE': 'unsafe',
                                   'XFS_SETTINGS_DIR': 'unsafe', 'XFS_TOOLS_DIR': 'unsafe', 'PATH': 'keep'})
        assert env['PATH'] == 'keep'
        for key in ('XFS_RESOLVER_CACHE', 'XFS_SETTINGS_DIR', 'XFS_TOOLS_DIR', 'XFAS_DATA_DIR',
                    'XFS_CHOICE_PREVIEW_CACHE', 'XFS_PACKAGE_PLATE_CACHE', 'XFS_EXPRESSIONS_GAME_CACHE'):
            assert Path(env[key]).is_relative_to(work)
        print('Safety checks passed: capture worktree guard, containment, exclusive writes, junction escape, schema, nested buffers, environment')
    finally:
        assert work.resolve().is_relative_to(scratch.resolve())
        shutil.rmtree(work)
        if not any(scratch.iterdir()):
            scratch.rmdir()


if __name__ == '__main__':
    main()

