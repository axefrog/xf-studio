// S2 2.25: the silent-start and per-write gate share one read of the current world.
import type { Instance, Layer2 } from './layer2.ts';
import type { EffectDecl } from './types.ts';
import { resolveEventSpec } from './effects.ts';
import { agentRoles } from './actors.ts';

export function nudgeLegal(l2: Layer2, inst: Instance, effects: EffectDecl[] = []): boolean {
  if (!inst.st.document.nudge) return true;
  const k = l2.k, now = k.now, casts = Object.values(inst.st.roles).flatMap((r) => r.cast ? [r.cast] : []);
  const held = (rule: number): false => { l2.record(inst, 'nudge-held', { rule }); return false; };
  const node = (r: string): string | undefined => r === 'v' ? k.vId : inst.st.roles[r]?.cast;
  k.persistence.recoverIfSaved(k.vId, ...casts);
  if (casts.includes(k.vId)) return held(1);
  const current = k.value(k.vId, 'where');
  const location = typeof current === 'string' ? current : k.store.edgesFrom(k.vId)
    .find((e) => e.type === 'core:located-in' && e.valid.from <= now && (e.valid.to === undefined || now < e.valid.to))?.to;
  for (const other of l2.live()) if (other.id !== inst.id && other.st.deliveries.some((d) =>
    d.what === 'offer' && ['released', 'displayed'].includes(d.state) && ['presented', 'confirmed'].includes(d.grade ?? ''))
    && Object.values(other.st.roles).some((r) => !!r.cast && casts.includes(r.cast)))
    return held(3);
  for (const effect of effects) {
    if (!('event' in effect)) continue;
    const spec = resolveEventSpec(l2, inst, effect.event);
    if (!spec) return held(4);
    if (spec.participants?.some((p) => p.who === k.vId) || spec.effects?.some((e) => e.on === k.vId)
      || (spec.place && (spec.place === location || l2.reg.sim?.eval('depth', [spec.place], now) === 'open'))
      || (spec.place && k.frames.demandTier(spec.place) >= 3) || spec.witnesses?.includes(k.vId)) return held(1);
    for (const who of spec.participants ?? []) {
      k.persistence.recoverIfSaved(who.who);
      if (k.store.pinsOn(who.who, 'where').some((p) => p.reason === 'observed' && !k.store.isWithdrawn(p.id)
        && Math.abs(p.at - now) <= l2.tun.nudgeGap && spec.place && p.value !== spec.place)) return held(2);
    }
    const agents = agentRoles(l2, spec.kind);
    for (const actor of spec.participants?.filter((p) => agents.includes(p.role)) ?? []) {
      const wants = k.frames.framesOf(actor.who).some((f) => ['active', 'blocked'].includes(f.status)
        && f.payload.goal?.effects?.some((wanted) => spec.effects?.some((e) => e.on === wanted.on && e.effect === wanted.effect)));
      if (!wants && !l2.worldRegistry.intends?.(actor.who, spec.kind, now) && spec.kind !== 'tell') return held(4);
    }
    if (spec.kind === 'tell') {
      const teller = spec.participants?.find((p) => p.role === 'teller')?.who,
        listener = spec.participants?.find((p) => p.role === 'listener')?.who,
        told = spec.participants?.find((p) => p.role === 'told')?.who;
      if (!teller || !listener || !told || k.beliefs.knows(teller, told, 'kind', now).k === 'unknown'
        || !l2.worldRegistry.areTied?.(teller, listener, now)) return held(4);
    }
    if (['tell', 'expose', 'confess'].includes(spec.kind)) {
      const told = spec.participants?.find((p) => p.role === 'told')?.who;
      if (told && k.events.mintedSpec(told)?.participants?.some((p) => p.who === k.vId)) return held(5);
    }
  }
  for (const role of Object.values(inst.st.document.roles)) for (const e of role.goal?.effects ?? []) {
    const target = node(e.on);
    if (!target) return held(4);
    if (target === k.vId && !['help', 'give', 'protect', 'rescue', 'meet'].includes(e.effect)) return held(5);
    if (e.effect === 'take') {
      k.persistence.recoverIfSaved(target);
      const vHolds = k.store.edgesFrom(target).some((edge) => edge.type === 'xf:held-by' && edge.to === k.vId
        && edge.valid.from <= now && (edge.valid.to === undefined || now < edge.valid.to));
      if (vHolds && !k.events.canonEvents().some((id) => {
        const ev = k.events.mintedSpec(id);
        return ev?.kind === 'promise' && ev.participants?.some((p) => p.role === 'promiser' && p.who === k.vId)
          && ev.participants.some((p) => p.role === 'subject' && p.who === target);
      })) return held(5);
    }
  }
  return true;
}
