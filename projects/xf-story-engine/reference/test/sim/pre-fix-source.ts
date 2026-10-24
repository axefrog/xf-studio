// bun test preload for check-review-mutations.ts. No source files are replaced on disk.
import { plugin } from 'bun';
import { readFileSync } from 'node:fs';
import { mutate, probes } from './review-mutations.ts';
const probe = probes.find((p) => p.name === process.env.S1_REVIEW_MUTATION);
if (!probe) throw new Error('use check-review-mutations.ts with a known mutation');
plugin({
  name: 'review-semantic-mutation',
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, ({ path }) => {
      const source = path.replaceAll('\\', '/').split('/reference/')[1]!;
      const text = readFileSync(path, 'utf8');
      return { contents: source === probe.source ? mutate(text, probe) : text, loader: 'ts' };
    });
  },
});
