// The event-kind registry (S1 5, S0 10.5 v4.8): the kinds S1 mints and reads, each with its tags, producers, sizes, content
// listing, roles and carrier. Kinds are pack data; no kind has code of its own. A selector matches a kind through a `where`
// predicate on the `kind` slot, never through a schema `KindId`.
//
// `lintKinds` is the load-time lint of S1 5.1: a pack is refused, with the kind named, when it breaks a rule.

import type { FillDecl } from '../event-kinds.ts';
import type { Effect } from '../types.ts';
import type { CityKindDef, ContentClass, S1Data } from './data.ts';
import { type OutcomeRules, fillsOfEnforcement, fillsOfFixedKind, outcomeRulesOf } from './fills.ts';

export type KindFamily = 'city' | 'order' | 'social' | 'mirror' | 'raw' | 'tie' | 'group' | 'goal' | 'scene';

export interface RoleSpec {
  role: string;
  source:
    | { from: 'offenders' }
    | { from: 'group'; side: 'A' | 'B'; roles?: string[] }
    | { from: 'residents'; roles?: string[]; aff?: 'gang' }
    | { from: 'responders' }
    | { from: 'parent'; role: string }
    /** v0.6 (S1 5.4): the person or thing a goal act's descriptor fixes (`Descriptor.fixed`); never drawn. */
    | { from: 'fixed' };
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
  /** v0.6 (S1 5.1, 5.2a): the participant role names its events use, the story functions it fills, how an occurrence can fail, the roles in which a participant acts. */
  roleNames: string[];
  fills: FillDecl[];
  outcomes?: OutcomeRules;
  agentRoles: string[];
}

/** Everything that can produce an event in the core (S1 5.1): the processes and policies of the core, layer 2 and the port. */
export const PRODUCERS = ['city.events', 'city.mirror', 'order.norms', 'order.stocks', 'order.ledger', 'group.decide', 'scene.acts', 'social', 'ties', 'witness', 's2', 'port'] as const;

export const CITY_KIND_NAMES = ['theft', 'assault', 'gang-clash', 'shakedown', 'police-action', 'psycho-break', 'disorder', 'accident', 'outage', 'commerce'] as const;
export const RAW_KIND_NAMES = ['game.death', 'game.combat.start', 'game.combat.end', 'game.heat.0', 'game.heat.1', 'game.heat.2', 'game.heat.3', 'game.heat.4', 'game.heat.5', 'game.district', 'game.journal.finished', 'game.journal.failed'] as const;
export const TIE_KIND_NAMES = ['reply', 'bid', 'disclosure', 'favour', 'conflict', 'repair', 'joint-activity', 'crisis', 'retract'] as const;
/** The acts goals produce besides the city kinds they reuse (S1 5.3, 7.10): produced by `city.events`, except the scene's `confront`. */
export const GOAL_KIND_NAMES = ['presence', 'call-in', 'warning', 'price', 'search'] as const;
export const SOCIAL_KIND_NAMES = ['tell', 'promise', 'threat', 'confess', 'betrayal', 'expose', 'conceal'] as const;

const ROLE_SPECS = (kind: string, hasParent: boolean): RoleSpec[] => {
  const res = (role: string, count: [number, number], extra: Partial<RoleSpec['source']> = {}, adult = true): RoleSpec => ({ role, source: { from: 'residents', ...extra } as RoleSpec['source'], count, adult });
  switch (kind) {
    case 'theft':
      // v0.6: the item a theft moves is fixed by a goal act's descriptor; an incident of the city's rates has none
      return [{ role: 'aggressor', source: { from: 'offenders' }, count: [1, 1], adult: true }, res('victim', [1, 1]), { role: 'item', source: { from: 'fixed' }, count: [0, 1], adult: false }];
    case 'assault':
    case 'psycho-break':
      return [{ role: 'aggressor', source: { from: 'offenders' }, count: [1, 1], adult: true }, res('victim', [1, 1])];
    case 'presence':
      return [{ role: 'guard', source: { from: 'fixed' }, count: [1, 1], adult: true }, { role: 'ward', source: { from: 'fixed' }, count: [1, 1], adult: true }];
    case 'call-in':
      return [{ role: 'creditor', source: { from: 'fixed' }, count: [1, 1], adult: true }, { role: 'debtor', source: { from: 'fixed' }, count: [1, 1], adult: true }];
    case 'warning':
    case 'price':
      return [{ role: 'warner', source: { from: 'fixed' }, count: [1, 1], adult: true }, { role: 'warned', source: { from: 'fixed' }, count: [1, 1], adult: false }];
    case 'search':
      return [{ role: 'searcher', source: { from: 'fixed' }, count: [1, 1], adult: true }, res('asked', [0, 1]), { role: 'sought', source: { from: 'fixed' }, count: [1, 1], adult: false }];
    case 'confront':
      return [{ role: 'confronter', source: { from: 'fixed' }, count: [1, 3], adult: true }, { role: 'confronted', source: { from: 'fixed' }, count: [1, 1], adult: false }];
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
  for (const r of ['aggressor', 'victim', 'target', 'hostile', 'responder', 'enforcer', 'giver', 'taker', 'participant', 'teller', 'listener', 'subject', 'entry', 'actor',
    // v0.6 (S1 5.3, 5.4): the thing a theft moves, who prevented an act, what a telling is about, and the roles of the group and goal kinds
    'promiser', 'promisee', 'receiver', 'repairer', 'exposer', 'confessor', 'audience', 'protagonist', 'asker', 'replier', 'bidder',
    'told', 'guard', 'ward', 'item', 'group', 'decider', 'object', 'successor', 'predecessor', 'late', 'creditor', 'debtor', 'warner', 'warned', 'searcher', 'asked', 'sought', 'confronter', 'confronted']) roles.add(r);
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
    ...RAW_KIND_NAMES, ...TIE_KIND_NAMES, ...SOCIAL_KIND_NAMES, ...GOAL_KIND_NAMES, 'confront',
    // v0.6 (S1 5.3): a group's decisions, the ends of its courses and its successions, generated from `data.groups.intents`
    ...data.groups.intents.flatMap((i) => [`decide.${i.id}`, `relent.${i.id}`]), 'succession',
  ].filter((v, i, a) => a.indexOf(v) === i);
}

/** The role names a city kind's events use: those of its role specifications with a parent and without, a `-group` form where the role allows group involvement, and (v0.6) `guard` and `item`. */
const cityRoleNames = (name: string, prevents: boolean): string[] => {
  const out = new Set<string>();
  for (const hp of [false, true]) for (const r of ROLE_SPECS(name, hp)) {
    out.add(r.role);
    if (r.groupOk) out.add(`${r.role}-group`);
  }
  if (name === 'disorder') out.add('victim');
  if (prevents) out.add('guard');
  if (name === 'theft') out.add('item');
  return [...out];
};
const AGENT_ROLES: Record<string, string[]> = {
  theft: ['aggressor'], assault: ['aggressor'], shakedown: ['aggressor'], 'gang-clash': ['aggressor'], 'psycho-break': ['aggressor'], 'police-action': ['responder'], tell: ['teller'],
  presence: ['guard'], 'call-in': ['creditor'], warning: ['warner'], price: ['warner'], search: ['searcher'], confront: ['confronter'],
};

const city = (d: CityKindDef): KindDef1 => {
  const outcomes = outcomeRulesOf(d.name, d.effects);
  return {
    name: d.name, family: 'city', tags: d.tags, effects: d.effects, producers: ['city.events', 'city.mirror', 'scene.acts'], sizes: d.sizes,
    classes: d.classes.length === 0 ? 'none' : d.classes, roles: ROLE_SPECS(d.name, false), severity: d.severity, pulse: d.pulse, carrier: d.carrier,
    roleNames: cityRoleNames(d.name, outcomes?.prevent !== undefined), fills: d.fills ?? fillsOfFixedKind(d.name) ?? [], ...(outcomes ? { outcomes } : {}), agentRoles: AGENT_ROLES[d.name] ?? [],
  };
};
const plain = (name: string, family: KindFamily, producers: string[], extra: Partial<KindDef1> = {}): KindDef1 => ({
  name, family, tags: [], effects: [], producers, sizes: [1, 1], classes: 'none', roles: [], severity: 0, pulse: 0, carrier: { channels: [], days: 0 },
  roleNames: [], fills: fillsOfFixedKind(name) ?? [], agentRoles: AGENT_ROLES[name] ?? [], ...extra,
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
        roleNames: ['enforcer', 'target', 'guard'], fills: fillsOfEnforcement(rung), agentRoles: ['enforcer'],
        ...(outcomeRulesOf(`enf.${norm}.${rung}`, [], { rungEffect: r.effect }) ? { outcomes: outcomeRulesOf(`enf.${norm}.${rung}`, [], { rungEffect: r.effect })! } : {}),
      }));
    }
    // v0.6 (S1 5.3): lifecycle notices of `group.decide`: no effects, class none, severity 0.3, pulse 0.2, carrier people 14 days; roles `group`, `decider` and the informational `object`
    const groupKind = (name: string, roleNames: string[], fills: FillDecl[]): void => {
      this.kinds.set(name, plain(name, 'group', ['group.decide'], { severity: 0.3, pulse: 0.2, carrier: { channels: ['people'], days: 14 }, roleNames, fills }));
    };
    for (const i of data.groups.intents) {
      groupKind(`decide.${i.id}`, ['group', 'decider', 'object'], [{ fn: 'decide', args: { group: 'group', what: 'object|group' } }]);
      groupKind(`relent.${i.id}`, ['group', 'decider', 'object'], []);
    }
    groupKind('succession', ['group', 'successor', 'predecessor', 'late'], [{ fn: 'bind', args: { a: 'successor', b: 'group' } }, { fn: 'sever', args: { a: 'predecessor', b: 'group' }, when: { has: ['predecessor'] } }]);
    // v0.6 (S1 5.3): the acts goals produce; size 1, produced by `city.events` (`confront` by `scene.acts`), cast from the goal's fixed people
    const goalKind = (name: string, o: { producers?: string[]; family?: KindFamily; tags?: string[]; effects?: KindDef1['effects']; classes?: ContentClass[]; severity: number; pulse: number; carrier: KindDef1['carrier']; roleNames: string[]; outcomes?: OutcomeRules }): void => {
      this.kinds.set(name, plain(name, o.family ?? 'goal', o.producers ?? ['city.events'], {
        tags: o.tags ?? [], effects: o.effects ?? [], classes: o.classes ?? 'none', roles: ROLE_SPECS(name, false), severity: o.severity, pulse: o.pulse, carrier: o.carrier,
        roleNames: o.roleNames, fills: fillsOfFixedKind(name) ?? [], ...(o.outcomes ? { outcomes: o.outcomes } : {}),
      }));
    };
    goalKind('presence', { effects: [{ role: 'ward', effect: 'protect' }], severity: 0.2, pulse: 0.3, carrier: { channels: ['people'], days: 7 }, roleNames: ['guard', 'ward'] });
    goalKind('call-in', { classes: [{ class: 'property', shown: 1, reported: 1 }], severity: 0.3, pulse: 0.3, carrier: { channels: ['people'], days: 7 }, roleNames: ['creditor', 'debtor'], outcomes: outcomeRulesOf('call-in', []) });
    goalKind('warning', { tags: ['news', 'threat'], classes: [{ class: 'threat', shown: 1, reported: 1 }], severity: 0.6, pulse: 0.7, carrier: { channels: ['people'], days: 14 }, roleNames: ['warner', 'warned'] });
    goalKind('price', { tags: ['news', 'threat'], classes: [{ class: 'threat', shown: 2, reported: 1 }], severity: 0.8, pulse: 0.8, carrier: { channels: ['people', 'place'], days: 30 }, roleNames: ['warner', 'warned'] });
    goalKind('search', { tags: ['news'], classes: [{ class: 'threat', shown: 1, reported: 1 }], severity: 0.5, pulse: 0.5, carrier: { channels: ['people'], days: 14 }, roleNames: ['searcher', 'asked', 'sought'] });
    // v0.6 (S1 5.3): the scene's encounter of a hunt: no effects, class `pursuit`
    goalKind('confront', { producers: ['scene.acts'], family: 'scene', classes: [{ class: 'pursuit', shown: 2, reported: 1 }], severity: 0.9, pulse: 0.9, carrier: { channels: ['people'], days: 30 }, roleNames: ['confronter', 'confronted'] });
    this.kinds.set('gig-outcome', plain('gig-outcome', 'mirror', ['city.mirror']));
    for (const n of RAW_KIND_NAMES) this.kinds.set(n, plain(n, 'raw', ['port']));
    this.kinds.set('reply', plain('reply', 'tie', ['ties']));
    for (const n of TIE_KIND_NAMES.filter((x) => x !== 'reply')) this.kinds.set(n, plain(n, 'tie', ['s2', 'port']));
    this.kinds.set('tell', plain('tell', 'social', ['social'], { roleNames: ['teller', 'listener', 'subject', 'told'] }));
    for (const n of SOCIAL_KIND_NAMES.filter((x) => x !== 'tell')) this.kinds.set(n, plain(n, 'social', ['s2']));
    // v0.6 (S1 5.3, 8.3): a promise is news: witnesses remember and tell it although it has no effect; severity 0.5, pulse 0.4
    this.kinds.set('promise', plain('promise', 'social', ['s2'], { tags: ['news'], severity: 0.5, pulse: 0.4, roleNames: ['promiser', 'promisee'], agentRoles: ['promiser'] }));
  }

  /** `producers(kind)` and `eventKind(name)` for S3 (S1 9.2): from v0.6 with the roles, fills, outcomes and agent roles. */
  eventKind(name: string): { tags: string[]; producers: string[]; roles: string[]; fills: FillDecl[]; outcomes?: OutcomeRules; agentRoles: string[] } | undefined {
    const k = this.kinds.get(name);
    return k ? { tags: [...k.tags], producers: [...k.producers], roles: [...k.roleNames], fills: structuredClone(k.fills), ...(k.outcomes ? { outcomes: structuredClone(k.outcomes) } : {}), agentRoles: [...k.agentRoles] } : undefined;
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
  const vocabulary = new Set(data.vocabulary);
  for (const k of reg.kinds.values()) {
    // v0.6 (S1 5.1): a fill names a role the kind has, a function of the loaded vocabulary, and an outcome the kind can reach
    for (const fl of k.fills) {
      if (!vocabulary.has(fl.fn)) problems.push(`kind ${k.name}: the fill ${fl.fn} is not a function of the loaded vocabulary`);
      const roles = new Set(k.roleNames);
      const named = [...Object.values(fl.args).flatMap((a) => a.split('|')), ...(fl.when?.has ?? []), ...(fl.when?.lacks ?? []), ...Object.values(fl.when?.state?.args ?? {}).flatMap((a) => a.split('|'))];
      for (const r of named) if (r !== '@place' && r !== '@self' && !roles.has(r)) problems.push(`kind ${k.name}: the fill ${fl.fn} names the role ${r}, which the kind does not have`);
      for (const o of fl.when?.outcome ?? []) {
        const reach = o === 'done' || (o === 'prevented' && k.outcomes?.prevent !== undefined) || (o === 'failed' && k.outcomes?.fail !== undefined);
        if (!reach) problems.push(`kind ${k.name}: the fill ${fl.fn} needs the outcome ${o}, which the kind cannot reach`);
      }
    }
    if (k.producers.length === 0) problems.push(`kind ${k.name} has no producer`);
    for (const p of k.producers) if (!known.has(p)) problems.push(`kind ${k.name} names the producer ${p}, which is not supported yet`);
    if (!k.carrier) problems.push(`kind ${k.name} has no carrier`);
    if (k.classes === undefined) problems.push(`kind ${k.name} has no content listing`);
    if (k.name.startsWith('meta:') && k.producers.some((p) => p !== 's2' && p !== 'port')) problems.push(`kind ${k.name} starts with meta: and has a producer in S1`);
  }
  // v0.6 (S1 5.1): a kind may let `v` fill only an agent role, an informational role, or a protagonist-object role
  const informational = new Set(['subject', 'told', 'object']);
  const protagonistObject = new Set(['warned', 'sought', 'confronted']);
  for (const d of data.kinds) {
    const k = reg.get(d.name);
    for (const r of d.allowV ?? []) if (!(k?.agentRoles.includes(r) || informational.has(r) || protagonistObject.has(r))) problems.push(`kind ${d.name} lets v be ${r}, which is not an agent role, an informational role or a protagonist-object role`);
  }
  // The core produces and casts the kinds of its own table (the role specifications and the producers are code, not data): a kind added to
  // the data would be given the core's producers and no roles, and would pass for a supported one (SIM-15). Anything else waits for its capability.
  for (const d of data.kinds) {
    if (!(CITY_KIND_NAMES as readonly string[]).includes(d.name)) problems.push(`kind ${d.name} is not supported yet: the core produces and casts only ${CITY_KIND_NAMES.join(', ')}`);
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
