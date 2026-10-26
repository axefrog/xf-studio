import type { Juncture } from '../seeding/pattern-types.ts';
import { actingArgument } from '../seeding/pattern-lint.ts';
import { namesNode } from '../predicate.ts';
import { INTEREST_TYPES } from '../registry.ts';
import { newOpCtx } from '../resolve.ts';
import type { MatchedFiller } from './graph-types.ts';
import type { GraphWorld } from './graph-world.ts';
import type { PoolEntry } from './types.ts';

export interface LinkLimits { causeHops: number; causeWalkMax: number; stateCandidates: number }
export function protagonistAct(world: GraphWorld, j: Juncture, f: MatchedFiller): boolean {
  const argument = actingArgument(j, world.vocabulary);
  if (!argument || f.args[argument] !== world.k.vId || f.fn === 'learn') return false;
  const event = 'event' in f.ref ? world.view.event(f.ref.event) : undefined;
  return !!event && world.acts(event, world.k.vId);
}

export function linkHolds(world: GraphWorld, link: string, earlier: MatchedFiller, later: MatchedFiller,
  juncture: Juncture, limits: LinkLimits, instance?: PoolEntry): boolean {
  if (earlier.id === later.id) return true; // two functions of one occurrence
  if (protagonistAct(world, juncture, later)) link = 'answers';
  const walk = (f: MatchedFiller, target: string) => world.walk(f, target, limits.causeHops, limits.causeWalkMax);
  const event = 'event' in later.ref ? world.view.event(later.ref.event) : undefined;
  const actorArg = actingArgument(juncture, world.vocabulary), actor = actorArg ? later.args[actorArg] : undefined;
  if (link === 'order') return later.at >= earlier.at;
  if (link === 'because') return walk(later, earlier.id);
  if (link === 'answers') {
    const response = event?.kind === 'response' || ['comply', 'refuse'].includes(later.fn)
      || (event?.kind === 'seed-outcome' && world.l2.realisedBy(event.id).some((f) => f.fn === 'repay'))
      || (event && world.eventFills(event).some((f) => ['comply', 'refuse'].includes(f.fn)));
    if (response && world.causes(later).includes(earlier.id)) return true;
    if (!instance || 'event' in earlier.ref || event?.kind !== 'response') return false;
    const answer = world.l2.responseOf(event.id), seed = answer && world.l2.instance(answer.seed);
    if (!seed || !instance.graph?.seeds.some((s) => s.seed === seed.id && !['told', 'closing'].includes(s.for))) return false;
    const offer = seed.st.deliveries.find((d) => d.what === 'offer' && !!d.offerEvent && event.causes.includes(d.offerEvent));
    return !!offer && seed.st.receipts.some((r) => r.delivery === offer.id && r.grade !== 'ambient'
      && (earlier.causes ?? []).some((n) => !!world.view.event(n) && r.cites.includes(n)));
  }
  if (link === 'enables') {
    if (!('event' in earlier.ref)) {
      if (later.at < earlier.at || (earlier.until !== undefined && later.at >= earlier.until)) return false;
      return earlier.until !== undefined || world.rules(earlier.fn).some((r) => r.holdsAt(earlier.ref, later.at) === 'yes');
    }
    return earlier.at <= later.at && walk(later, earlier.id);
  }
  const beliefs = actor ? world.k.beliefs.activeOf(actor).filter((b) => b.memorable && (b.at ?? 0) <= later.at)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, limits.stateCandidates) : [];
  if (link === 'motive') {
    if (later.fn === 'story' && event) {
      const prior = earlier.fn === 'story' ? world.view.event(earlier.id)?.causes ?? [] : [earlier.id];
      // A story has no acting argument. Only its recorded constituent events may
      // carry an NPC motive; the meta event itself supplies no inferred intention.
      return event.causes.slice(0, limits.causeWalkMax).some((id) => {
        const child = world.view.event(id);
        if (!child || child.kind === 'meta:story') return false;
        const f: MatchedFiller = { ...later, id, ref: { event: id }, at: child.time, causes: child.causes };
        const actors = child.participants.filter((p) => p.who !== world.k.vId && world.acts(child, p.who)).map((p) => p.who);
        return prior.some((target) => {
          if (!walk(f, target)) return false;
          if (child.served && actors.length) {
            world.k.persistence.recoverIfSaved(child.served);
            const frame = world.k.frames.frame(child.served);
            if (frame && actors.includes(frame.actor) && (frame.cause === target || walk({ ...f, id: frame.id, ref: { frame: frame.id }, causes: [frame.cause] }, target))) return true;
          }
          return actors.some((actor) => world.k.beliefs.activeOf(actor).filter((b) => b.memorable && (b.at ?? 0) <= child.time)
            .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, limits.stateCandidates)
            .some((b) => b.evidence.includes(target) || walk({ ...f, id: b.id, ref: { belief: b.id }, causes: b.evidence }, target)));
        });
      });
    }
    if (!('event' in later.ref) && walk(later, earlier.id)) return true;
    if (event?.served) {
      world.k.persistence.recoverIfSaved(event.served);
      const frame = world.k.frames.frame(event.served);
      if (frame && (('frame' in earlier.ref && frame.id === earlier.ref.frame) || frame.cause === earlier.id || walk({ ...later, id: frame.id, ref: { frame: frame.id }, causes: [frame.cause] }, earlier.id))) return true;
    }
    return beliefs.some((b) => ('belief' in earlier.ref && earlier.ref.belief === b.id) || b.evidence.some((e) => e === earlier.id
      || walk({ ...later, id: b.id, ref: { belief: b.id }, causes: b.evidence }, earlier.id)));
  }
  if (link === 'reveals') return !!actor && (world.view.event(earlier.id)?.witnesses.includes(actor)
    || !!event?.participants.some((p) => p.role === 'told' && p.who === earlier.id)
    || beliefs.some((b) => b.evidence.includes(earlier.id)));
  if (link === 'but') {
    const previous = 'event' in earlier.ref ? world.view.event(earlier.ref.event) : undefined;
    const frameId = 'frame' in earlier.ref ? earlier.ref.frame : previous?.served;
    if (!frameId || !event) return false;
    world.k.persistence.recoverIfSaved(frameId);
    const frame = world.k.frames.frame(frameId);
    if (!frame) return false;
    const env = world.k.resolver.makeEnv(newOpCtx(world.k.config.allowance), later.at);
    const conflict = world.k.registry.get('conflict', world.k.conflictTable);
    return event.effects.some((effect) => INTEREST_TYPES.some((type) => frame.own[type].some((selector) =>
      namesNode(env, selector, effect.on) && conflict(type, effect.effect, {}) === 'violates')));
  }
  return false;
}
