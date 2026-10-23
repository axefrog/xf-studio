// Run from reference/: bun run test/sim/check-review-mutations.ts [pre-fix commit]
// Each negative run must fail the named regression, with a pre-fix module loaded only in memory.
const base = process.argv[2] ?? 'd4b78f79';
const probes = [
  ['R3-01', 'review-round2', 'src/sim/sim.ts'],
  ['R3-02', 'review-round2', 'src/sim/protection.ts'],
  ['R3-03a', 'review-fixes', 'src/seeding/run.ts'],
  ['R3-03b', 'review-round2', 'src/sim/divergence.ts'],
  ['R3-03c', 'review-round2', 'src/sim/reads.ts'],
  ['R3-03d', 'review-round2', 'src/sim/reads.ts'],
  ['R3-03e', 'review-round2', 'src/sim/divergence.ts'],
  ['R3-04', 'review-round2', 'src/sim/people.ts'],
  ['R3-05', 'review-round2', 'src/sim/proc-events.ts'],
  ['R3-06', 'review-round2', 'src/kernel.ts'],
  ['R3-07', 'review-round2', 'src/sim/reads.ts'],
  ['R3-08', 'audits', 'src/sim/audit.ts'],
  ['R3-09', 'audits', 'src/sim/audit.ts'],
];
for (const [name, file, source] of probes) {
  const args = ['test', '--preload', './test/sim/pre-fix-source.ts', `test/sim/${file}.test.ts`, '-t', name!];
  const r = Bun.spawnSync([process.execPath, ...args], { env: { ...process.env, S1_REVIEW_BASE: base, S1_REVIEW_SOURCES: source! } });
  const output = r.stdout.toString() + r.stderr.toString();
  if (r.exitCode === 0 || !output.includes(`(fail)`) || !output.includes(name!)) throw new Error(`${name}: pre-fix rejection missing\n${output}`);
  console.log(`${name}: pre-fix source rejected`);
}
