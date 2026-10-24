import type { Finding, Seed } from '../seeding/types.ts';
import type { Layer2 } from '../seeding/layer2.ts';
import { bound, playOf } from '../seeding/doc.ts';
import type { KernelView, Layer3Data, SiftPattern, Sowable } from './types.ts';

export const levels = ['glance', 'encounter', 'vignette', 'gig', 'arc', 'season'];
export const forms = ['rumour', 'recap', 'sighting', 'foreshadow', 'offer', 'aftermath'];
const finding = (code: string, message: string): Finding => ({ code, level: 'error', message });
export function clauses(p: SiftPattern) {
  return [...p.stages, ...(p.unless ?? []).map((u) => u.clause)];
}
export function kinds(clause: SiftPattern['stages'][number], k: KernelView): string[] {
  return typeof clause.kind === 'string'
    ? [clause.kind]
    : k
        .eventKinds()
        .filter((n) =>
          k.eventKind(n)?.tags.includes(clause.kind && typeof clause.kind !== 'string' ? clause.kind.tag : ''),
        );
}
export function sowableFindings(t: Seed, l2: Layer2, view: KernelView, data: Layer3Data, pack: string): Finding[] {
  const out: Finding[] = [],
    sow = t.sowable as Sowable | undefined;
  if (!sow) return [finding('S3-K-0', 'No sowable declaration.')];
  if (!Array.isArray(sow.serves) || !sow.serves.length || sow.serves.some((f) => !forms.includes(f)))
    return [finding('S3-K-0', 'This form is not supported yet.')];
  if (!(sow.weight === undefined || (Number.isFinite(sow.weight) && sow.weight > 0)))
    out.push(finding('S3-K-0', 'Kit weight must be positive and finite.'));
  if (t.maturity !== 'ready') out.push(finding('S3-K-1', 'Only ready templates are sowable.'));
  if (
    levels.indexOf(t.level) < 0 ||
    levels.indexOf(t.level) > levels.indexOf(data.sower.maxLevel) ||
    !['person', 'crew', 'block'].includes(t.stakeScale ?? 'block')
  )
    out.push(finding('S3-K-2', 'This level or stake scale is not supported yet.'));
  if (sow.serves?.some((f) => !['rumour', 'recap', 'sighting'].includes(f)) && !t.closing)
    out.push(finding('S3-K-3', 'An offer kit needs closing content.'));
  const compiled = l2.compile(pack, t);
  if (compiled.ok) {
    const classes = compiled.seed.start
      .flatMap((b) => playOf(compiled.seed.beats[b]).refs)
      .flatMap((ref) => {
        const frag = l2.packs.get(pack)?.fragment(ref);
        return frag ? frag.channels.map((ch) => l2.reg.channels.get(ch)?.class).filter((c) => c !== undefined) : [];
      });
    if (!classes.length || classes.some((c) => c !== sow.firstClass))
      out.push(finding('S3-K-4', 'firstClass must match every possible first delivery and its fallback.'));
  } else out.push(finding('S3-K-4', 'The template must compile before its first delivery can be checked.'));
  if (
    Object.values(t.roles).some((r) => {
      const b = bound(r.identity);
      return b.value && view.isSpine(l2.k.expandId(b.value));
    })
  )
    out.push(finding('S3-K-5', 'A kit may not fix a spine character.'));
  for (const variant of t.variation?.variants ?? []) {
    if (variant.parts.sowable !== undefined)
      out.push(finding('S3-K-0', 'Changing a sowable declaration in a variant is not supported yet.'));
    out.push(
      ...sowableFindings(
        { ...t, ...variant.parts, sowable: t.sowable, variation: undefined },
        l2,
        view,
        data,
        pack,
      ).map((f) => ({ ...f, message: `Variant ${variant.id}: ${f.message}` })),
    );
  }
  return out;
}
export function compatible(p: SiftPattern, t: Seed, view: KernelView): boolean {
  return Object.entries(p.telling.binds).every(([role, v]) => {
    const r = t.roles[role];
    if (!r || bound(r.identity).status === 'fixed') return false;
    if (v === '?story')
      return (
        r.kind === 'core:event' &&
        (r.must ?? []).some((m) => m.path === 'kind' && m.op === 'eq' && m.arg === 'meta:story')
      );
    const kind = v === '?end' ? 'core:event' : p.roles[v]?.kind;
    return !!kind && view.isKind(kind, r.kind);
  });
}
export function patternFindings(p: SiftPattern, l2: Layer2, view: KernelView, data: Layer3Data): Finding[] {
  const out: Finding[] = [],
    fail = (n: number, m: string) => out.push(finding(`S3-L-${n}`, m));
  if (
    !p ||
    !Array.isArray(p.stages) ||
    !p.roles ||
    typeof p.roles !== 'object' ||
    !p.telling ||
    !p.telling.binds ||
    typeof p.telling.binds !== 'object'
  )
    return [finding('S3-L-7', 'Malformed or later pattern clauses are not supported yet.')];
  if (
    (p.unless !== undefined && !Array.isArray(p.unless)) ||
    p.stages.some((c) => !c || typeof c !== 'object') ||
    Object.values(p.roles).some((r) => !r || typeof r.kind !== 'string')
  )
    return [finding('S3-L-7', 'Malformed or later pattern clauses are not supported yet.')];
  const all = clauses(p),
    extra = p as unknown as Record<string, unknown>;
  if (
    all.some(
      (c) =>
        !c ||
        !c.kind ||
        !['string', 'object'].includes(typeof c.kind) ||
        (c.who !== undefined && !Array.isArray(c.who)) ||
        (c.effects !== undefined && !Array.isArray(c.effects)),
    )
  )
    return [finding('S3-L-7', 'Malformed or later clauses are not supported yet.')];
  if (
    Object.keys(extra).some(
      (k) => !['id', 'version', 'roles', 'stages', 'unless', 'within', 'once', 'tags', 'telling'].includes(k),
    ) ||
    all.some(
      (c) =>
        Object.keys(c).some((k) => !['kind', 'who', 'effects', 'where'].includes(k)) ||
        (typeof c.kind === 'string' && c.kind.startsWith('meta:')),
    ) ||
    !forms.includes(p.telling.form)
  )
    fail(7, 'This pattern capability is not supported yet.');
  for (const c of all)
    if (c?.kind) {
      const names = kinds(c, view);
      if (!names.length || names.some((n) => !view.eventKind(n)?.producers.length))
        fail(1, 'Every clause needs a registered kind with producers.');
      if (names.some((n) => n.startsWith('meta:'))) fail(7, 'Meta patterns are not supported yet.');
    }
  const vars = (c: SiftPattern['stages'][number]) => [
    ...(c.who ?? []).map((w) => w.as),
    ...(c.effects ?? []).map((e) => e.on),
  ];
  const stageVars = new Set(p.stages.flatMap(vars)),
    start = new Set(vars(p.stages[0] ?? { kind: '' }));
  const participantBound = l2.k.schema.dim('core:count-participants').value;
  if (participantBound.t === 'int' && stageVars.size > participantBound.max)
    fail(2, 'The completed story would exceed the kernel participant bound.');
  const used = [
    ...all.filter(Boolean).flatMap(vars),
    ...(p.once ?? []),
    ...Object.values(p.telling.binds).filter((v) => !['?end', '?story'].includes(v)),
  ];
  if (
    used.some((v) => typeof v !== 'string' || !v.startsWith('?') || !p.roles[v]) ||
    Object.values(p.telling.binds).some((v) => !['?story', '?end'].includes(v) && !stageVars.has(v)) ||
    Object.values(p.roles).some((r) => !view.isKind(r.kind, 'core:thing'))
  )
    fail(2, 'Every variable must be declared, compatible and bound by completion.');
  if (
    !p.stages.length ||
    p.stages.length > data.sifter.maxStages ||
    (p.unless ?? []).some(
      (u) =>
        !Number.isInteger(u.between[0]) ||
        !Number.isInteger(u.between[1]) ||
        u.between[0] < 0 ||
        u.between[0] >= u.between[1] ||
        u.between[1] >= p.stages.length,
    )
  )
    fail(3, 'Invalid stage count or unless interval.');
  if (p.within !== undefined && (!(p.within > 0) || !Number.isFinite(p.within) || p.within > data.sifter.maxWithin))
    fail(4, 'within must be positive and within maxWithin.');
  if (![...start].some((v) => ['core:person', 'core:group'].some((k) => p.roles[v] && view.isKind(p.roles[v].kind, k))))
    fail(5, 'Stage zero must bind a person or group.');
  const kits = [...l2.packs.entries()]
    .flatMap(([pack, index]) => index.pack.seeds.map((t) => ({ pack, t })))
    .filter(({ t }) => !p.telling.kit || p.telling.kit === t.id);
  if (
    !kits.some(
      ({ pack, t }) =>
        (t.sowable as Sowable | undefined)?.serves?.includes(p.telling.form) &&
        compatible(p, t, view) &&
        !sowableFindings(t, l2, view, data, pack).length,
    )
  )
    fail(6, 'The telling needs a compatible sowable kit without fixed role identities.');
  if ((p.once ?? []).some((v) => !start.has(v))) fail(8, 'once variables must be bound by stage zero.');
  return out;
}
