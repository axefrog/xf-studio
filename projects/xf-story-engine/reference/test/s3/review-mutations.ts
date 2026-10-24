// Each mutation restores one reviewed defect without touching source files on disk.
export interface Probe {
  name: string; test: string; source: string; from: string; to: string;
  file?: string;
  also?: Array<{ source: string; from: string; to: string }>;
}
const probe = (name: string, test: string, source: string, from: string, to: string): Probe => ({ name, test, source, from, to });
const saveEdge = 'merge(this.base.edges, cur.edges, (id) => store.edges.get(id));';
const clampSavedEdge = (sameStart: boolean): string => `merge(this.base.edges, cur.edges, (id) => {
      const e = store.edges.get(id); if (!e) return e;
      const edge = clone(e), saved = this.base.edges.get(id);
      if (saved && ${sameStart ? 'saved.valid.from === edge.valid.from && ' : ''}saved.valid.to !== undefined)
        edge.valid = { from: edge.valid.from, to: Math.min(edge.valid.to ?? Infinity, saved.valid.to) };
      return edge;
    });`;
const restrictedRoots = { source: 'src/retention.ts', from: 'const eventRoots = new Set(stack);',
  to: `const eventRoots = new Set([...this.seeds.values()].flatMap(s => s.nodes));
    for (const st of this.k.evolution.states.values())
      for (const batch of st.outstanding)
        for (const ref of idFields(batch.ops, (id) => this.k.expandId(id))) eventRoots.add(ref);` };
export const probes: Probe[] = [
  { ...probe('S3-01', 'S3-01', 'src/procedural/layer3.ts',
    "if (ref && this.kv.kind(ref) && this.k.schema.isKind(this.kv.kind(ref)!, 'core:event')) held.add(ref);", '/* omit transitive descriptors */'),
    // Undo both complementary parts of the hand-over fix: S3 descriptors and kernel own facts.
    also: [{ source: 'src/persistence.ts', from: 'const eventFacts = k.retention.eventFacts();', to: 'const eventFacts = new Set<string>();' }] },
  { ...probe('S3-02', 'S3-02', 'src/retention.ts', 'if (!firstVisit && !traverseEvent) continue;', 'if (!firstVisit) continue;'),
    // With all root categories now traversed, also restore the earlier restricted discovery to expose revisitation.
    also: [restrictedRoots] },
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
  ...['canon-causes', 'canon-participants', 'canon-served', 'pin-evidence', 'frame-focus', 'edge-cause', 'belief-evidence'].map((ref) => ({
    ...probe(`S3B-01-${ref}`, `S3B-01-${ref}`, restrictedRoots.source, restrictedRoots.from, restrictedRoots.to),
    file: 'test/process-evidence.test.ts',
    also: [{ source: 'src/retention.ts', from: 'follow(h.origin.owner);', to: 'stack.push(h.origin.owner);' },
      { source: 'src/retention.ts', from: 'follow(h.origin.creator, h.origin.cause);', to: 'stack.push(h.origin.creator, h.origin.cause);' }],
  })),
  ...['creator', 'cause'].map((link) => ({
    ...probe(`S3B-01-origin-${link}`, `S3B-01-origin-${link}`, 'src/retention.ts',
      'follow(h.origin.creator, h.origin.cause);', 'stack.push(h.origin.creator, h.origin.cause);'),
    file: 'test/process-evidence.test.ts',
  })),
  ...['batch', 'seed'].map((ref) => ({
    ...probe(`S3B-02-${ref}`, `S3B-02-${ref}`, 'src/retention.ts',
      'c.source.origin === materialisation &&', 'false &&'), file: 'test/process-evidence.test.ts',
  })),
  probe('S3B-03', 'S3B-03', 'src/procedural/sower.ts', "identity.status === 'fixed' && identity.value ?", 'identity.value ?'),
  { ...probe('S3B-01-location', 'S3B-01-location', 'src/persistence.ts',
    '(own ? marked.has(e.from) : base.edges.has(e.id))', 'base.edges.has(e.id)'),
    file: 'test/process-evidence.test.ts' },
  { ...probe('S3B-01-location-history', 'S3B-01-location', 'src/persistence.ts',
    '(own ? marked.has(e.from) : base.edges.has(e.id))',
    '(base.edges.has(e.id) || (own && marked.has(e.from)))'),
    file: 'test/process-evidence.test.ts' },
  { ...probe('S3C-01', 'S3C-01', 'src/retention.ts',
    'const materialisation = this.k.events.materialisationOf(id)?.materialisation;',
    `const materialisation = store.contributionsNaming(id).find((c) =>
      c.source.layer === 'simulation' && c.target.slot === 'participants#count' && c.form.f === 'const')?.source.origin;`),
    file: 'test/process-evidence.test.ts' },
  { ...probe('S3C-01-view', 'S3C-01', 'src/procedural/views.ts',
    'const provenance = k.events.materialisationOf(id);',
    `const origin = k.store.contributionsNaming(id).find((c) =>
      c.source.layer === 'simulation' && c.target.slot === 'participants#count' && c.form.f === 'const')?.source.origin;
    const provenance = origin ? { descriptor: h.origin.creator, materialisation: origin } : undefined;`),
    file: 'test/process-evidence.test.ts' },
  { ...probe('S3C-02', 'S3C-02', 'src/persistence.ts',
    saveEdge, '/* omit saved edge updates */'),
    file: 'test/process-evidence.test.ts' },
  { ...probe('S3C-02-sweep', 'S3C-02-sweep', 'src/retention.ts',
    'if (!this.k.persistence.hasSavedEdge(e.id))', 'if (true)'), file: 'test/process-evidence.test.ts' },
  { ...probe('S3D-01', 'S3D-01', 'src/persistence.ts',
    saveEdge,
    `merge(this.base.edges, cur.edges, (id) => {
      const e = store.edges.get(id);
      return e && this.k.retention.isOwnEventLocation(e) && !this.k.retention.marked().has(e.from)
        ? { ...clone(e), valid: { from: e.valid.from, to: this.k.now } } : e;
    });`),
    file: 'test/process-evidence.test.ts' },
  ...['S3D-02', 'S3D-02-sweep'].map((name) => ({ ...probe(name, name, 'src/persistence.ts',
    saveEdge, clampSavedEdge(false)),
    file: 'test/process-evidence.test.ts' })),
  ...['S3E-01', 'S3E-01-snapshot', 'S3E-01-two-loads'].map((name) => ({ ...probe(name, name, 'src/retention.ts',
    'const h = this.k.persistence.restoreReferencedHeader(id);', 'const h = store.header(id);'),
    file: 'test/process-evidence.test.ts' })),
  { ...probe('S3E-01-immediate', 'S3E-01', 'src/retention.ts',
    'this.marked();', '/* omit immediate seed dependency restoration */'), file: 'test/process-evidence.test.ts' },
  ...['S3F-01-sweep-query-first', 'S3F-01-snapshot-sweep-query-first'].map((name) => ({
    ...probe(name, name, 'src/retention.ts',
      'const h = this.k.persistence.restoreReferencedHeader(id);',
      'const h = store.header(id) ?? this.k.persistence.restoreReferencedHeader(id);'), file: 'test/process-evidence.test.ts',
  })),
  { ...probe('S3F-01-recovery', 'S3F-01-sweep-query-first', 'src/persistence.ts',
    'if (!h || !this.base.headers.has(id)) return h;',
    'if (!h || store.header(id)) return h;'), file: 'test/process-evidence.test.ts' },
  ...['S3E-02', 'S3E-02-sweep', 'S3E-02-load-A', 'S3E-02-open'].map((name) => ({ ...probe(name, name, 'src/persistence.ts',
    saveEdge, clampSavedEdge(true)), file: 'test/process-evidence.test.ts' })),
  { ...probe('S3G-01', 'S3G-01', 'src/persistence.ts',
    'merge(this.base.contributions, cur.contributions, (id) => store.contribution(id));',
    '/* omit saved contribution updates */'), file: 'test/process-evidence.test.ts' },
  { ...probe('S3G-01-sweep', 'S3G-01-sweep', 'src/retention.ts',
    'if (!this.k.persistence.hasPendingContribution(c))', 'if (true)'), file: 'test/process-evidence.test.ts' },
  { ...probe('S3G-02', 'S3G-02', 'src/persistence.ts',
    "else if (header.origin.by === 'minted') fields.push(header.origin.creator, header.origin.cause);",
    '/* omit reached descriptor headers */'), file: 'test/process-evidence.test.ts' },
];
