// The event-kind registry (S1 5, S0 10.5 v4.8): the kinds S1 mints and reads, each with its tags, producers, sizes, content
// listing, roles and carrier. Kinds are pack data; no kind has code of its own. A selector matches a kind through a `where`
// predicate on the `kind` slot, never through a schema `KindId`.
//
// `lintKinds` is the load-time lint of S1 5.1: a pack is refused, with the kind named, when it breaks a rule.

import type { Effect } from '../types.ts';
import type { CityKindDef, ContentClass, S1Data } from './data.ts';

export type KindFamily = 'city' | 'order' | 'social' | 'mirror' | 'raw' | 'tie';

export interface RoleSpec {
  role: string;
  source:
    | { from: 'offenders' }
    | { from: 'group'; side: 'A' | 'B'; roles?: string[] }
    | { from: 'residents'; roles?: string[]; aff?: 'gang' }
    | { from: 'responders' }
    | { from: 'parent'; role: string };
  /** At most 4 persons in all per occurrence; a minimum of 0 makes the role optional. */
  count: [number, number];
  adult: boolean;
  /** An unfilled role may become group involvement. */
  groupOk?: boolean;
}

export interface KindDef1 {
  name: string;
  family: KindFamily;
  tags: string[];
  effects: Array<{ role: string; effect: Effect }>;
  producers: string[];
  sizes: [number, number];
  classes: ContentClass[] | 'none';
  roles: RoleSpec[];
  severity: number;
  pulse: number;
  carrier: { channels: string[]; days: number };
}

/** Everything that can produce an event in the core (S1 5.1): the processes and policies of the core, layer 2 and the port. */
export const PRODUCERS = ['city.events', 'city.mirror', 'order.norms', 'order.stocks', 'order.ledger', 'group.decide', 'scene.acts', 'social', 'ties', 'witness', 's2', 'port'] as const;

export const CITY_KIND_NAMES = ['theft', 'assault', 'gang-clash', 'shakedown', 'police-action', 'psycho-break', 'disorder', 'accident', 'outage', 'commerce'] as const;
export const RAW_KIND_NAMES = ['game.death', 'game.combat.start', 'game.combat.end', 'game.heat.0', 'game.heat.1', 'game.heat.2', 'game.heat.3', 'game.heat.4', 'game.heat.5', 'game.district', 'game.journal.finished', 'game.journal.failed'] as const;
export const TIE_KIND_NAMES = ['reply', 'bid', 'disclosure', 'favour', 'conflict', 'repair', 'joint-activity', 'crisis', 'retract'] as const;
export const SOCIAL_KIND_NAMES = ['tell', 'promise', 'threat', 'confess', 'betrayal', 'expose', 'conceal'] as const;

const ROLE_SPECS = (kind: string, hasParent: boolean): RoleSpec[] => {
  const res = (role: string, count: [number, number], extra: Partial<RoleSpec['source']> = {}, adult = true): RoleSpec => ({ role, source: { from: 'residents', ...extra } as RoleSpec['source'], count, adult });
  switch (kind) {
    case 'theft':
    case 'assault':
    case 'psycho-break':
      return [{ role: 'aggressor', source: { from: 'offenders' }, count: [1, 1], adult: true }, res('victim', [1, 1])];
    case 'accident':
      return [res('victim', [1, 1])];
    case 'gang-clash':
      return [
        { role: 'aggressor', source: { from: 'group', side: 'A' }, count: [1, 1], adult: true, groupOk: true },
        { role: 'victim', source: { from: 'group', side: 'B' }, count: [1, 1], adult: true, groupOk: true },
      ];
    case 'shakedown':
      return [
        { role: 'aggressor', source: { from: 'group', side: 'A', roles: ['gang'] }, count: [1, 1], adult: true, groupOk: true },
        res('victim', [1, 1], { roles: ['vendor', 'shopkeeper'] }),
      ];
    case 'police-action':
      return hasParent
        ? [
            { role: 'responder', source: { from: 'responders' }, count: [0, 2], adult: false },
            { role: 'victim', source: { from: 'parent', role: 'victim' }, count: [0, 1], adult: true },
            { role: 'target', source: { from: 'parent', role: 'aggressor' }, count: [0, 1], adult: true },
          ]
        : [{ role: 'responder', source: { from: 'responders' }, count: [0, 2], adult: false }, res('target', [1, 1], { aff: 'gang' })];
    case 'disorder':
      return [{ role: 'participant', source: { from: 'residents' }, count: [2, 4], adult: false }];
    case 'outage':
      return [];
    case 'commerce':
      return [res('giver', [1, 1], {}, false), res('taker', [1, 1], {}, false)];
    default:
      return [];
  }
};

/** The roles an occurrence of a kind is cast with (S1 5.4). A police response with a parent keeps the parent's participants. */
export const rolesOf = (kind: string, hasParent = false): RoleSpec[] => ROLE_SPECS(kind, hasParent);

/** Roles that bear a harm effect: the casting function excludes the protected set from them (S1 5.4). */
export function isHarmRole(kind: KindDef1 | undefined, role: string, harm: readonly Effect[]): boolean {
  if (!kind) return false;
  return kind.effects.some((e) => e.role === role && harm.includes(e.effect));
}

/** Every participant role name the pack registers (the schema's participant-role enum is extended with them). */
export function participantRoles(): string[] {
  const roles = new Set<string>();
  for (const k of CITY_KIND_NAMES) for (const hp of [false, true]) for (const r of ROLE_SPECS(k, hp)) roles.add(r.role);
  for (const r of ['aggressor', 'victim', 'target', 'hostile', 'responder', 'enforcer', 'giver', 'taker', 'participant', 'teller', 'listener', 'subject', 'entry', 'actor']) roles.add(r);
  for (const r of [...roles]) roles.add(`${r}-group`);
  return [...roles].sort();
}

function rungKinds(data: S1Data): Array<{ norm: string; rung: string }> {
  const out: Array<{ norm: string; rung: string }> = [];
  for (const n of data.norms.norms) for (const r of n.ladder) out.push({ norm: n.id, rung: r.rung });
  return out;
}

/** Every event kind name the pack registers, in registry order. */
export function allEventKindNames(data: S1Data): string[] {
  return [
    ...data.kinds.map((k) => k.name), 'regime-start', 'regime-end', ...rungKinds(data).map((x) => `enf.${x.norm}.${x.rung}`), 'gig-outcome',
    ...RAW_KIND_NAMES, ...TIE_KIND_NAMES, ...SOCIAL_KIND_NAMES,
  ].filter((v, i, a) => a.indexOf(v) === i);
}

const city = (d: CityKindDef): KindDef1 => ({
  name: d.name, family: 'city', tags: d.tags, effects: d.effects, producers: ['city.events', 'city.mirror', 'scene.acts'], sizes: d.sizes,
  classes: d.classes.length === 0 ? 'none' : d.classes, roles: ROLE_SPECS(d.name, false), severity: d.severity, pulse: d.pulse, carrier: d.carrier,
});
const plain = (name: string, family: KindFamily, producers: string[], extra: Partial<KindDef1> = {}): KindDef1 => ({
  name, family, tags: [], effects: [], producers, sizes: [1, 1], classes: 'none', roles: [], severity: 0, pulse: 0, carrier: { channels: [], days: 0 }, ...extra,
});

/** The registry: a map from kind name to its entry, built from the pack data. */
export class KindRegistry {
  readonly kinds = new Map<string, KindDef1>();

  constructor(readonly data: S1Data) {
    for (const d of data.kinds) this.kinds.set(d.name, city(d));
    this.kinds.set('regime-start', plain('regime-start', 'order', ['city.events'], { sizes: [3, 4] }));
    this.kinds.set('regime-end', plain('regime-end', 'order', ['city.events'], { sizes: [3, 4] }));
    for (const { norm, rung } of rungKinds(data)) {
      const r = data.norms.rungs.find((x) => x.name === rung);
      if (!r) continue;
      const roles: RoleSpec[] = [
        { role: 'enforcer', source: { from: 'residents', roles: data.norms.norms.find((n) => n.id === norm)!.enforcer.roles }, count: [1, 1], adult: true },
        { role: 'target', source: { from: 'residents' }, count: [1, 1], adult: true },
      ];
      this.kinds.set(`enf.${norm}.${rung}`, plain(`enf.${norm}.${rung}`, 'order', ['order.norms', 'port'], {
        tags: ['enforcement', `norm:${norm}`], effects: [{ role: 'target', effect: r.effect }],
        classes: r.class ? [{ class: r.class, shown: r.shown ?? 1, reported: r.reported ?? 1 }] : 'none', roles,
      }));
    }
    this.kinds.set('gig-outcome', plain('gig-outcome', 'mirror', ['city.mirror']));
    for (const n of RAW_KIND_NAMES) this.kinds.set(n, plain(n, 'raw', ['port']));
    this.kinds.set('reply', plain('reply', 'tie', ['ties']));
    for (const n of TIE_KIND_NAMES.filter((x) => x !== 'reply')) this.kinds.set(n, plain(n, 'tie', ['s2', 'port']));
    this.kinds.set('tell', plain('tell', 'social', ['social']));
    for (const n of SOCIAL_KIND_NAMES.filter((x) => x !== 'tell')) this.kinds.set(n, plain(n, 'social', ['s2']));
  }

  /** `producers(kind)` and `eventKind(name)` for S3 (S1 9.2). */
  eventKind(name: string): { tags: string[]; producers: string[] } | undefined {
    const k = this.kinds.get(name);
    return k ? { tags: [...k.tags], producers: [...k.producers] } : undefined;
  }
  producers(name: string): string[] {
    return this.kinds.get(name)?.producers ?? [];
  }
  get(name: string): KindDef1 | undefined {
    return this.kinds.get(name);
  }
  names(): string[] {
    return [...this.kinds.keys()];
  }
}

/** The load lints of S1 5.1 and 6 (ladders), over the pack data. A non-empty result refuses the pack. */
export function lintKinds(data: S1Data): string[] {
  const problems: string[] = [];
  const names = new Set(data.kinds.map((k) => k.name));
  const known = new Set<string>(PRODUCERS);
  const reg = new KindRegistry(data);
  for (const k of reg.kinds.values()) {
    if (k.producers.length === 0) problems.push(`kind ${k.name} has no producer`);
    for (const p of k.producers) if (!known.has(p)) problems.push(`kind ${k.name} names the producer ${p}, which is not supported yet`);
    if (!k.carrier) problems.push(`kind ${k.name} has no carrier`);
    if (k.classes === undefined) problems.push(`kind ${k.name} has no content listing`);
    if (k.name.startsWith('meta:') && k.producers.some((p) => p !== 's2' && p !== 'port')) problems.push(`kind ${k.name} starts with meta: and has a producer in S1`);
  }
  for (const d of data.kinds) {
    const nMax = data.events.nMax;
    let worst = 0;
    for (let m = d.sizes[0]; m <= d.sizes[1]; m++) worst = Math.max(worst, data.events.offspring[m - 1]!);
    if (d.offspringFactor * worst >= nMax) problems.push(`kind ${d.name}: the base offspring mean ${d.offspringFactor * worst} is ${nMax} or above`);
    const rates = data.shape.rate[d.name];
    if (!rates) problems.push(`kind ${d.name} has no row in the city rate table`);
    else for (let m = 1; m <= 4; m++) if (rates[m - 1]! !== 0 && (m < d.sizes[0] || m > d.sizes[1])) problems.push(`kind ${d.name}: a rate is non-zero for size ${m}, outside its sizes`);
    for (const target of Object.keys(d.matrix)) if (!names.has(target)) problems.push(`kind ${d.name}: the matrix names the unknown kind ${target}`);
    for (const x of [d.base, d.rw.gang, d.rw.corp, d.rw.ncpd]) if (!(x >= 0) || !Number.isFinite(x)) problems.push(`kind ${d.name}: a driver is not a non-negative number`);
    if (d.delayWeights.length !== data.events.delayBins.length) problems.push(`kind ${d.name}: ${d.delayWeights.length} delay weights for ${data.events.delayBins.length} bins`);
  }
  for (const n of data.norms.norms) {
    const rungs = n.ladder.map((r) => data.norms.rungs.find((x) => x.name === r.rung));
    if (rungs.some((r) => r === undefined)) problems.push(`norm ${n.id}: its ladder names an unknown rung`);
    else if (!rungs.some((r) => r!.class === undefined)) problems.push(`norm ${n.id}: its ladder has no rung with an empty class`);
  }
  return problems;
}
