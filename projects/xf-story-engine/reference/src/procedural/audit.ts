import ts from 'ts-parser';
import { withSourceTrees, type SourceFile } from '../source-trees.ts';
import type { Layer3 } from './layer3.ts';
import type { Layer3Data } from './types.ts';
import { dataProblems } from './data.ts';
export interface AuditFinding {
  audit: string;
  where: string;
  detail: string;
}
/** Conservative syntax audit: computed literal accesses and executable templates count as code. */
export function auditSources(files: SourceFile[]): AuditFinding[] {
  return withSourceTrees(files, (trees) => {
    const out: AuditFinding[] = [];
    trees.forEach((tree, i) => {
      const file = files[i],
        base = file.path.replaceAll('\\', '/').split('/').at(-1)!;
      const fail = (audit: string, detail: string) => out.push({ audit, where: file.path, detail });
      const name = (n: ts.Node): string | undefined =>
        ts.isPropertyAccessExpression(n)
          ? n.name.text
          : ts.isElementAccessExpression(n) && n.argumentExpression && ts.isStringLiteral(n.argumentExpression)
            ? n.argumentExpression.text
            : undefined;
      const visit = (n: ts.Node): void => {
        if (
          ts.isIdentifier(n) &&
          ['Date', 'performance', 'wallClock', 'loadCount', 'quitCount', 'idleTime', 'sessionLength'].includes(n.text)
        )
          fail('closed-inputs', n.text);
        if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
          const prop = name(n),
            obj = n.expression;
          if (
            ts.isIdentifier(obj) &&
            obj.text === 'Math' &&
            ['random', 'exp', 'expm1', 'log', 'log2', 'log10', 'pow'].includes(prop ?? '')
          )
            fail('arithmetic', `Math.${prop}`);
          if (['sower.ts', 'keys.ts'].includes(base) && ['playClock', 'epoch', 'phase', 'session'].includes(prop ?? ''))
            fail('session-independence', prop!);
          if (
            base === 'fit.ts' &&
            ['playClock', 'playTotal', 'tempo', 'noticing', 'phase', 'session', 'log'].includes(prop ?? '')
          )
            fail('world-fit-only', prop!);
          if (
            ['sower.ts', 'director.ts', 'fit.ts', 'keys.ts'].includes(base) &&
            prop === 'log' &&
            !(ts.isCallExpression(n.parent) && n.parent.expression === n)
          )
            fail('evidence-firewall', 'The decision log may be written, not read');
          if (
            ['pin', 'reading', 'contribute', 'addEdge', 'observe', 'setBelief', 'tell'].includes(prop ?? '') &&
            ts.isCallExpression(n.parent) &&
            n.parent.expression === n
          )
            fail('two-doors', `Direct world write: ${prop}`);
        }
        n.forEachChild(visit);
      };
      visit(tree);
    });
    return out;
  });
}
export function auditData(d: Layer3Data): AuditFinding[] {
  return dataProblems(d).map((detail) => ({ audit: 'data', where: 'Layer3Data', detail }));
}
/** Inspector-side invariant audit. Its output is not an input to selection. */
export function auditState(l3: Layer3): AuditFinding[] {
  const out: AuditFinding[] = [],
    fail = (detail: string) => out.push({ audit: 'state', where: 'Layer3State', detail }),
    st = l3.state;
  if (st.pool.length > l3.data.sifter.poolTotal) fail('Pool total exceeded');
  for (const pattern of l3.sifter.patterns.keys())
    if (st.pool.filter((e) => e.pattern === pattern).length > l3.data.sifter.poolPerPattern)
      fail('Pattern pool exceeded');
  if (new Set(st.pool.map((e) => e.id)).size !== st.pool.length) fail('Duplicate match');
  if (
    new Set(st.pool.filter((e) => !e.complete).map((e) => e.bindingKey)).size !==
    st.pool.filter((e) => !e.complete).length
  )
    fail('Duplicate open binding');
  if (st.recent.length > l3.data.sower.recentSown || st.pending.length > l3.data.threads.maxLive)
    fail('History or pending cap exceeded');
  if (new Set(st.pending.map((p) => p.instance)).size !== st.pending.length) fail('Duplicate pending seed');
  const roots = [
    ...new Set([
      ...st.pool.flatMap((e) => [...e.stages.map((s) => s.event), ...(e.story ? [e.story] : [])]),
      ...st.buffer.map((b) => b.event.id),
    ]),
  ].sort();
  const saved = l3.k.retention.seeds.get(l3.keys.record);
  if (JSON.stringify(saved?.nodes) !== JSON.stringify(roots)) fail('Retention roots differ from pool and buffer');
  for (const e of st.pool) {
    if (new Set(e.stages.map((s) => s.event)).size !== e.stages.length) fail('An occurrence served twice');
    if (e.stages.some((s, i) => i > 0 && s.time < e.stages[i - 1].time)) fail('Stages are not chronological');
    for (const s of e.stages) if (!l3.kv.event(s.event)) fail('Missing stage evidence');
    if (e.story) {
      const story = l3.kv.event(e.story);
      if (!story || story.creator !== l3.keys.director || story.effects.length || story.witnesses.length)
        fail('Meta event is not inert');
    }
  }
  return out;
}
