// bun test preload for check-review-mutations.ts. No source files are replaced on disk.
import { plugin } from 'bun';
import { readFileSync } from 'node:fs';
const paths = new Set((process.env.S1_REVIEW_SOURCES ?? '').split(','));
if (paths.size === 0 || !process.env.S1_REVIEW_BASE) throw new Error('use check-review-mutations.ts');
plugin({
  name: 'pre-fix-review-source',
  setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, ({ path }) => {
      const source = path.replaceAll('\\', '/').split('/reference/')[1]!;
      if (!paths.has(source)) return { contents: readFileSync(path, 'utf8'), loader: 'ts' };
      const r = Bun.spawnSync(['git', 'show', `${process.env.S1_REVIEW_BASE}:projects/xf-story-engine/reference/${source}`]);
      if (r.exitCode !== 0) throw new Error(r.stderr.toString());
      return { contents: r.stdout.toString(), loader: 'ts' };
    });
  },
});
