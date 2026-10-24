import { probes } from './s3/review-mutations.ts';

const historical = probes.filter(p => /^S3[C-I]-/.test(p.name));
if (historical.length !== 28) throw new Error(`historical probe count changed: ${historical.length}`);
const names = process.argv[2]?.split(',');
const selected = historical.filter(p => !names || names.includes(p.name));
if (names?.some(name => !historical.some(p => p.name === name))) throw new Error('unknown historical probe');
const env = { ...process.env };
delete env.SWEEP_SEEDS;
delete env.SWEEP_STEPS;
delete env.SWEEP_FIRST_SEED;
let caught = 0;
const missed: string[] = [], invalid: string[] = [];
for (const probe of selected) {
  const r = Bun.spawnSync([
    process.execPath, 'test', '--preload', './test/s3/pre-fix-source.ts',
    'test/sweep-replay.test.ts', '-t', 'S3I property:',
  ], { env: { ...env, S3_REVIEW_MUTATION: probe.name } });
  const output = r.stdout.toString() + r.stderr.toString();
  if (r.exitCode !== 0 && output.includes('(fail) S3I property:') &&
      !/mutation target missing|SyntaxError|ReferenceError|Cannot find module|timed out/i.test(output)) {
    caught++;
    console.log(probe.name + ': property rejected');
  } else if (r.exitCode === 0) {
    missed.push(probe.name);
    console.log(probe.name + ': MISSED');
  } else {
    invalid.push(probe.name);
    console.log(probe.name + ': INVALID\n' + output.slice(-1600));
  }
}
console.log(JSON.stringify({ caught, total: selected.length, missed, invalid }));
if (missed.length || invalid.length) process.exitCode = 1;
