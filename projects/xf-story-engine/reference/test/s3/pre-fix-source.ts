import { plugin } from 'bun';
import { readFileSync } from 'node:fs';
import { probes } from './review-mutations.ts';
const probe = probes.find((p) => p.name === process.env.S3_REVIEW_MUTATION);
if (!probe) throw new Error('use check-review-mutations.ts with a known mutation');
plugin({ name: 's3-review-mutation', setup(build) {
  build.onLoad({ filter: /\.ts$/ }, ({ path }) => {
    let text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
    for (const edit of [probe, ...(probe.also ?? [])])
      if (path.replaceAll('\\', '/').endsWith('/reference/' + edit.source)) {
        if (!text.includes(edit.from)) throw new Error('mutation target missing: ' + probe.name);
        text = text.replace(edit.from, edit.to);
      }
    return { contents: text, loader: 'ts' };
  });
} });
