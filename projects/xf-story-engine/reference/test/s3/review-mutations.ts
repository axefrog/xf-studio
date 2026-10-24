// Each mutation restores one reviewed defect without touching source files on disk.
export interface Probe {
  name: string; test: string; source: string; from: string; to: string;
  file?: string;
  also?: Array<{ source: string; from: string; to: string }>;
}
const probe = (name: string, test: string, source: string, from: string, to: string): Probe => ({ name, test, source, from, to });
export const probes: Probe[] = [
  { ...probe('S3-01', 'S3-01', 'src/procedural/layer3.ts',
    "if (ref && this.kv.kind(ref) && this.k.schema.isKind(this.kv.kind(ref)!, 'core:event')) held.add(ref);", '/* omit transitive descriptors */'),
    // Undo both complementary parts of the hand-over fix: S3 descriptors and kernel own facts.
    also: [{ source: 'src/persistence.ts', from: 'const eventFacts = k.retention.eventFacts();', to: 'const eventFacts = new Set<string>();' }] },
  probe('S3-02', 'S3-02', 'src/retention.ts', 'if (!firstVisit && !traverseEvent) continue;', 'if (!firstVisit) continue;'),
  probe('S3-03', 'S3-03', 'src/procedural/layer3.ts', 'this.state.consumedOutcomes ??= [];',
    'this.state.consumedOutcomes = this.l2.all().flatMap((inst) => inst.st.closed ? [inst.st.closed.event] : []);'),
  probe('S3-04-npc', 'S3-04-npc', 'src/seeding/cast.ts', '!l2.directorExcludes(c, t)', '!l2.isSpine(c)'),
  probe('S3-04-spine', 'S3-04-spine', 'src/seeding/cast.ts', '!l2.directorExcludes(c, t)',
    "!(l2.k.settings.at(t).storyExclusions ?? []).some((e) => e.kind === 'npc' && e.value === c)"),
  probe('S3-04-prepare', 'S3-04-npc', 'src/seeding/arbiter.ts', "st.source.by === 'director' && l2.directorExcludes(rs.cast, t)", 'false'),
  probe('S3-04-recast', 'S3-04-npc', 'src/seeding/run.ts', "let bad = st.source.by === 'director' && l2.directorExcludes(rs.cast);", 'let bad = false;'),
  ...['pattern', 'total', 'sown', 'late'].map((cap) => probe(`S3-05-${cap}`, `S3-05-${cap}`, 'src/procedural/sifter.ts',
    'this.sweep(Math.max(this.k.now, now), now);', '/* admission counts dead entries */')),
  ...['tag', 'class', 'verb', 'soft'].map((kind) => probe(`S3-06-${kind}`, `S3-06-${kind}`, 'src/procedural/layer3.ts',
    '}, validate);', '});')),
  probe('S3-07-telling', 'S3-07', 'src/procedural/lint.ts',
    "Object.keys(p.telling).some((key) => !['form', 'kit', 'binds'].includes(key))", 'false'),
  probe('S3-07-sowable', 'S3-07', 'src/procedural/lint.ts',
    "Object.keys(sow).some((key) => !['serves', 'firstClass', 'weight', 'climactic', 'tags'].includes(key))", 'false'),
  { ...probe('S3-kernel', 'S3-kernel', 'src/persistence.ts', 'const eventFacts = k.retention.eventFacts();',
    'const eventFacts = new Set<string>();'), file: 'test/process-evidence.test.ts' },
];
