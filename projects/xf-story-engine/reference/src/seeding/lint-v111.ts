import { atoms, bound, effectSites, playOf } from './doc.ts';
import { declarationFills } from './seed-patterns.ts';
import type { LintCtx } from './lint.ts';
import type { CompiledSeed, Finding } from './types.ts';
import { acceptedBy, obstacleOffers } from './accepted.ts';

/** The v1.11 additions are independent static checks, using pack data only. */
export function lintV111(c: CompiledSeed, ctx: LintCtx): Finding[] {
  const findings: Finding[] = [];
  const fail = (n: number, at: string, message: string, level: Finding['level'] = 'error') =>
    findings.push({ code: `L-${n}`, at, message, level, ...(level === 'error' ? { engine: true } : {}) });
  const fragment = (r: string) => ctx.pack.fragment(r);
  const fragments = Object.entries(c.beats).flatMap(([beat, b]) => playOf(b).refs.flatMap((ref) => {
    const f = fragment(ref); return f ? [{ beat, frag: f }] : [];
  }));
  const effects = [...effectSites(c, fragment), ...(c.unattended.events ?? []).map((event, i) =>
    ({ effect: { event }, at: `unattended.events[${i}]`, origin: 'unattended' as const }))];
  const isV = (r: string): boolean => r === 'v' || ['v', 'root:v'].includes(String(bound(c.roles[r]?.identity).value));
  const encounter = Object.values(c.roles).some((r) => r.must?.some((p) => p.path === 'kind' && p.op === 'eq' && p.arg === 'confront'));
  const chosen = (beat: string | undefined): boolean => {
    const b = beat ? c.beats[beat] : undefined;
    return !!b?.links?.length && b.links.every((l) => 'because' in l && l.on && acceptedBy(l.on).length > 0);
  };
  for (const site of effects) {
    const e = site.effect;
    if ('event' in e) {
      const ev = e.event, entry = ctx.eventKinds?.eventKind(ev.kind), b = 'beat' in site ? site.beat : undefined;
      const refs = [...(ev.participants ?? []).map((p) => p.who), ...(ev.effects ?? []).map((p) => p.on), ...(ev.causes ?? []), ...(ev.place ? [ev.place] : [])];
      if (!entry?.producers.includes('s2') || refs.some((r) => r !== 'v' && !c.roles[r])
        || (refs.some(isV) && !['action', 'decline'].includes(site.origin) && !chosen(b)))
        fail(139, site.at, 'A seed event needs an s2 kind, declared roles and a chosen path for the protagonist.');
    }
    const harm = 'kernel' in e ? [e.kernel] : 'event' in e ? e.event.effects ?? [] : [];
    for (const h of harm) if (isV(h.on) && ['harm', 'kill', 'take', 'expose'].includes(h.effect)) {
      const b = 'beat' in site && site.beat ? c.beats[site.beat] : undefined;
      const acceptedObstacle = 'beat' in site && !!site.beat && obstacleOffers(c, site.beat, fragment, isV).length > 0;
      if (encounter || !acceptedObstacle) fail(15, site.at, 'Harm to the protagonist requires an accepted stake and an obstacle with two affordances; a group encounter asserts none.');
    }
  }
  for (const { beat, frag } of fragments) {
    if (frag.offer?.choice === 'consequential' && !frag.offer.asker) fail(141, `beats.${beat}.offer`, 'A consequential offer should name its asker.', 'warning');
    for (const role of [frag.offer?.asker, ...(frag.offer?.plan ?? [])])
      if (role && !c.roles[role]) fail(139, `beats.${beat}.offer`, 'The asker and plan must name declared seed roles.');
    if (frag.offer) {
      const options = [...frag.offer.actions, ...frag.offer.decline, frag.offer.nullPath];
      for (const o of options) {
        if (o.label && !ctx.reg.actLabels.has(o.label)) fail(129, `beats.${beat}.offer.${o.id}`, 'An option label must name an act from the registered list.');
        if (o.say && 'text' in o.say && ctx.pack.text(o.say.text)?.voice)
          fail(115, `beats.${beat}.offer.${o.id}`, 'A new protagonist text line must stay unvoiced.');
      }
      const actions = frag.offer.actions, voiced = actions.filter((a) => a.say && !('text' in a.say));
      const stances = new Set(voiced.map((a) => a.stance));
      if (voiced.length && stances.size === 1 && actions.some((a) => !stances.has(a.stance) && a.say && 'text' in a.say))
        fail(143, `beats.${beat}.offer`, 'Voice availability marks one stance as the expected answer.', 'warning');
    }
  }
  const optionTexts = new Set(fragments.flatMap(({ frag }) => frag.offer
    ? [...frag.offer.actions, ...frag.offer.decline, frag.offer.nullPath].flatMap((a) => a.say && 'text' in a.say && typeof a.say.text === 'string' ? [a.say.text.replace(/^pack:/, '')] : []) : []));
  for (const text of ctx.pack.closure(c).texts)
    if (text.speaker === 'v' && !optionTexts.has(text.id)) fail(142, `texts.${text.id}`, 'Only a selected option may speak for the protagonist.');
  // Permission belongs to the use, not to a text id that happened to be selectable elsewhere.
  const ordinaryTexts = (value: unknown): void => {
    if (typeof value === 'string') {
      if (ctx.pack.text(value)?.speaker === 'v') fail(142, `content.${value}`, 'Only a selected option may speak for the protagonist.');
    } else if (Array.isArray(value)) value.forEach(ordinaryTexts);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) if (!['say', 'id', 'roles', 'asker', 'plan'].includes(key)) ordinaryTexts(child);
  };
  fragments.forEach(({ frag }) => ordinaryTexts(frag));
  ordinaryTexts(c.closing);
  for (const [i, r] of (c.realises ?? []).entries()) {
    const p = ctx.reg.patterns.get(r.pattern), j = p?.junctures[r.juncture];
    const at = `realises[${i}]`;
    if (!j || p?.family === 'shape' || Object.values(j.args).some((v) => v.startsWith('?') && !r.binds[v])
      || Object.values(r.binds).some((role) => role !== 'v' && !c.roles[role])) {
      fail(138, at, 'Realises needs a non-shape juncture and bindings for all its variable arguments.'); continue;
    }
    if (r.by === 'end' || r.by === 'unattended') continue;
    const b = c.beats[r.by];
    if (!b) { fail(138, at, 'Realises names an unknown beat.'); continue; }
    const fs = fragments.filter((f) => f.beat === r.by).map((f) => f.frag);
    const fills = [...(b.leaves ?? []), ...fs.flatMap((f) => f.leaves ?? [])]
      .flatMap((e) => 'event' in e ? declarationFills(e.event, ctx.eventKinds?.eventKind(e.event.kind)) : []);
    for (const f of fs) if (f.offer) {
      fills.push({ fn: 'ask', args: { ...(f.offer.asker ? { by: f.offer.asker } : {}), of: 'v' } });
      if (f.offer.asker) {
        if (f.offer.actions.some((a) => ['help', 'bargain'].includes(a.stance))) fills.push({ fn: 'comply', args: { who: 'v', to: f.offer.asker } });
        if (f.offer.decline.length || f.offer.actions.some((a) => ['refuse', 'oppose'].includes(a.stance))) fills.push({ fn: 'refuse', args: { who: 'v', to: f.offer.asker } });
      }
      if (f.offer.actions.length) fills.push({ fn: 'choose', args: { who: 'v' } });
    }
    if (!fills.some((f) => f.fn === j.fn && Object.entries(j.args).every(([a, v]) => !v.startsWith('?') || f.args[a] === r.binds[v])))
      fail(138, at, 'The named beat leaves no event that fills the function with the declared bindings.');
  }
  if (c.nudge) {
    const unsafeGoal = Object.values(c.roles).some((r) => r.goal?.effects.some((e) => isV(e.on) && !['help', 'give', 'protect', 'rescue', 'meet'].includes(e.effect)));
    const unsafeEvent = effects.some(({ effect: e }) => 'event' in e && (
      [...(e.event.participants ?? []).map((p) => p.who), ...(e.event.effects ?? []).map((p) => p.on)].some(isV)
      || (e.event.kind === 'tell' && ['teller', 'listener', 'told'].some((r) => !e.event.participants?.some((p) => p.role === r)))));
    if (c.closing || c.promises?.length || c.clocks || c.projections || c.forms
      || Object.values(c.roles).some((r) => ['v', 'root:v'].includes(String(bound(r.identity).value)) || r.authored?.length || (r.tie as { to?: string } | undefined)?.to === 'v')
      || fragments.some(({ frag }) => frag.offer || frag.channels.length) || unsafeGoal || unsafeEvent)
      fail(140, 'nudge', 'A nudge must stay silent, off-screen and free of protagonist acts and authored beliefs or edges.');
  }
  return findings;
}
