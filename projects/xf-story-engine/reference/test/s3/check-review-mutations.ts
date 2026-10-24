// bun run test/s3/check-review-mutations.ts [probe name]
import { probes } from './review-mutations.ts';
const selected = process.argv[2]?.split(",");
if (selected?.some(name=>!probes.some((p) => p.name === name))) throw new Error('unknown probe ' + selected);
for (const probe of probes.filter((p) => !selected || selected.includes(p.name))) {
  const result = Bun.spawnSync([process.execPath, 'test', '--preload', './test/s3/pre-fix-source.ts',
    probe.file ?? 'test/s3/review-fixes.test.ts', '-t', probe.test + ':'], { env: { ...process.env, S3_REVIEW_MUTATION: probe.name } });
  const output = result.stdout.toString() + result.stderr.toString(), lines = output.split(/\r?\n/);
  if (result.exitCode === 0 || !lines.some((l) => l.startsWith(`(fail) ${probe.test}:`)) ||
    !lines.some((l) => l.startsWith(`error: ${probe.test} semantic:`)))
    throw new Error(`${probe.name}: intended semantic failure missing\n${output}`);
  console.log(`${probe.name}: intended semantic assertion rejected the mutation`);
}
