// Run from reference/: bun run test/sim/check-review-mutations.ts [probe name]
// Mutate only the intended behaviour in memory; setup failures never count as regression evidence.
import { probes } from './review-mutations.ts';
import { semanticFailure } from './review-probe-result.ts';

const selected = process.argv[2];
if (selected && !probes.some((p) => p.name === selected)) throw new Error(`unknown probe ${selected}`);
for (const p of probes.filter((p) => !selected || p.name === selected)) {
  const args = ['test', '--preload', './test/sim/pre-fix-source.ts', `test/sim/${p.file}.test.ts`, '-t', `${p.name}:`];
  const r = Bun.spawnSync([process.execPath, ...args], { env: { ...process.env, S1_REVIEW_MUTATION: p.name } });
  const output = r.stdout.toString() + r.stderr.toString();
  if (!semanticFailure(r.exitCode, output, p.name)) throw new Error(`${p.name}: intended semantic rejection missing\n${output}`);
  console.log(`${p.name}: intended semantic assertion rejected the mutation`);
}
