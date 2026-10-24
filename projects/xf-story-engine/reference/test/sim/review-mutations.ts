// Compatible, surgical regressions: each reverses one behaviour while leaving constructors and interfaces intact.
export interface Probe {
  name: string;
  file: string;
  source: string;
  edits: Array<[string, string]>;
}
const probe = (name: string, file: string, source: string, ...edits: Array<[string, string]>): Probe => ({ name, file, source, edits });
export const probes: Probe[] = [
  probe('R3-01', 'review-round2', 'src/sim/sim.ts', ['    this.restoreEvidence();', '    // mutation: do not restore evidence']),
  probe('R3-02', 'review-round2', 'src/sim/protection.ts', ['Math.min(to ?? now, now)', 'to ?? now']),
  probe('R3-03a', 'review-fixes', 'src/seeding/run.ts', ['while (c.ord !== undefined && i < changes.length && changes[i]!.ord === c.ord)', 'while (false && c.ord !== undefined && i < changes.length && changes[i]!.ord === c.ord)']),
  probe('R3-03b', 'review-round2', 'src/sim/divergence.ts', ['source.ord ?? (source.ord = this.sim.record.ord++)', 'list.length']),
  probe('R3-03c', 'review-round2', 'src/sim/reads.ts', ['feed.windows.flatMap((win) => win.items.filter((tr) => tr.key === key))', 'feed.windows.flatMap((win) => win.items).map((tr, ord) => ({ ...tr, ord })).filter((tr) => tr.key === key)']),
  probe('R3-03d', 'review-round2', 'src/sim/reads.ts', ['ord: e.ord', 'ord: 0']),
  probe('R3-03e', 'review-round2', 'src/sim/divergence.ts', ['source.ord ?? (source.ord = this.sim.record.ord++)', 'this.sim.record.ord++']),
  probe('R3-04', 'review-round2', 'src/sim/people.ts', ['!this.hasUncertainInputs(this.ownerChain(ref.household), nodes, general)', 'true']),
  probe('R3-05', 'review-round2', 'src/sim/proc-events.ts', ['cloneState: (st) => structuredClone(st)', 'cloneState: (st) => ({ ...st, ring: [...st.ring] })']),
  probe('R3-06', 'review-round2', 'src/kernel.ts', ['const snapshot: Change = structuredClone(change);', 'const snapshot: Change = change;']),
  probe('R3-07', 'review-round2', 'src/sim/tie-policy.ts', ['e.value === \'no\' && e.t === floor || ', '']),
  probe('R3-08', 'audits', 'src/sim/source-audit.ts', ['        const p = property(node);', '        if (ts.isTemplateExpression(node)) return;\n        const p = property(node);']),
  probe('R3-09', 'audits', 'src/sim/source-audit.ts', ['function guardsMeta(file: ts.SourceFile, method: string): boolean {', 'function guardsMeta(file: ts.SourceFile, method: string): boolean { return true;']),
  probe('A1-01', 'review-round4', 'src/sim/divergence.ts', ['ord: e.ord', 'ord: e.ord - 1000000']),
  probe('A1-01b', 'review-round4', 'src/sim/s1ctx.ts', ['if (tr.ord === undefined) tr.ord = sim.record.ord++;', '/* mutation: publication never stamps transitions */']),
  probe('A1-01c', 'review-round4', 'src/sim/sim.ts', ['    this.k.readingHooks.push((node, slot) => this.divergence.noteReading(node, slot));', '    // mutation: wait for relevance dispatch']),
  probe('A1-02', 'review-round4', 'src/events.ts', ['if (!provenance) {', '{']),
  probe('A1-03', 'review-round4', 'src/sim/tie-policy.ts', [' || e.valid.to > this.k.now', '']),
  probe('A1-04', 'review-round4', 'src/sim/tie-policy.ts', ['    this.pruneLog(edge.from, edge.to);', "    if (!ended) log.push({ t: edge.valid.from, value: 'yes', ord: this.sim.record.ord++ });\n    while (log.length > 64) log.shift();\n    this.pruneLog(edge.from, edge.to);"]),
  probe('A1-05', 'review-round4', 'src/sim/source-audit.ts', ['return a === undefined ? undefined : a ? a : b;', 'return a === true || b === true ? true : a === false ? b : b === false ? a : undefined;']),
  probe('A1-05b', 'review-round4', 'src/sim/source-audit.ts', ['return a === undefined ? undefined : a ? b : a;', 'return a === false || b === false ? false : a === true ? b : b === true ? a : undefined;']),
  probe('A1-06', 'review-round4', 'src/sim/people.ts', ['return Object.freeze(view);', 'return view;']),
  probe('A1-07', 'review-round4', 'test/sim/review-probe-result.ts', [
    "return exitCode !== 0 && lines.some((line) => line.startsWith('(fail) ') && (line.startsWith(`(fail) ${name}:`) || line.includes(` > ${name}:`))) && lines.some((line) => line.startsWith(`error: ${name} semantic:`));",
    'return exitCode !== 0;',
  ]),
];

export function mutate(text: string, p: Probe): string {
  for (const [from, to] of p.edits) {
    if (!text.includes(from)) throw new Error(`${p.name}: mutation target missing in ${p.source}`);
    text = text.replaceAll(from, to);
  }
  return text;
}
