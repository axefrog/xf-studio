// The schema pack `xf.core.world@1` (S1 4.1, 4.2, 7.0): the kinds, dimensions and edge types of the simulation layer, and the
// registry functions they name. Slots are in declaration order; every read is of an earlier slot of the same node or of the owner
// chain (S0 2.3), which the kernel's schema loader checks and the schema audit repeats.

import { coreDefs, mergeDefs } from '../core-schema.ts';
import type { Registry } from '../registry.ts';
import { coreRegistry } from '../registry.ts';
import { ivlRegion } from '../region.ts';
import type { DimensionDef, EdgeTypeDef, KindDef, SchemaDefs, SlotDef } from '../schema-types.ts';
import type { FnRef, Region, Value } from '../types.ts';
import type { S1Data } from './data.ts';
import { ARCHETYPES, HH_TYPES, HPROFILE_VALUES, N_PROFILES, PROFILE_VALUES, ROLES, SOCIABILITY, profileA, profileF, profileR } from './profile.ts';
import { allEventKindNames, participantRoles } from './kinds.ts';

const UNIFORM: FnRef = { name: 'uniform', version: 1 };
const dim = (id: string, value: DimensionDef['value'], extra: Partial<DimensionDef> = {}): DimensionDef => ({ id, value, structure: 'none', prior: UNIFORM, ...extra });
const slot = (key: string, dimId: string, extra: Partial<SlotDef> = {}): SlotDef => ({ key, dim: dimId, card: 'one', mode: 'sampled', tier: 2, ...extra });

export const PACK_ID = 'xf.core.world@1';

/** The registry functions of the pack. */
export const VIEW_FN: FnRef = { name: 'xf-view', version: 1 };
export const SIZE_FN: FnRef = { name: 'xf-hsize', version: 1 };
export const EXTRA_FN: FnRef = { name: 'xf-extra', version: 1 };

const PROFILE_A = PROFILE_VALUES.slice(0, N_PROFILES).map((_, x) => profileA(x));
const PROFILE_R = PROFILE_VALUES.slice(0, N_PROFILES).map((_, x) => profileR(x));
const PROFILE_F = PROFILE_VALUES.slice(0, N_PROFILES).map((_, x) => profileF(x));

function viewOf(which: unknown, x: number): Value {
  if (which === 'a') return PROFILE_A[x]!;
  if (which === 'r') return ROLES[PROFILE_R[x]!]!;
  return PROFILE_F[x]!;
}

/** The registry with the simulation layer's functions added to the core's. */
export function worldRegistry(): Registry {
  const r = coreRegistry();
  // A unary view of a profile: the age band, the role or the affiliation class. "none" has none (the slot is unavailable).
  r.register('derive', VIEW_FN.name, VIEW_FN.version, (inputs, params) => {
    const p = inputs[0];
    if (p === undefined || p === 'none') return undefined;
    return viewOf(params.which, Number(p));
  });
  // The preimage: the profiles whose view lies in the region.
  r.register('preimage', VIEW_FN.name, VIEW_FN.version, (output: Region, _other, params) => {
    if (output.r === 'all') return output;
    const which = params.which;
    const values: string[] = [];
    for (let x = 0; x < N_PROFILES; x++) {
      const v = viewOf(which, x);
      const ok = output.r === 'set' ? typeof v === 'string' && output.values.includes(v) : output.r === 'ivl' && typeof v === 'number' && output.ivls.some(([lo, hi]) => v >= lo && v <= hi);
      if (ok) values.push(String(x));
    }
    return { r: 'set', values: values.sort() };
  });
  // The size of a household: min(6, base(type) + extra).
  r.register('derive', SIZE_FN.name, SIZE_FN.version, (inputs, params) => {
    const [h, extra] = inputs;
    if (h === undefined || extra === undefined) return undefined;
    const base = params.base as number[];
    return Math.min(6, base[Math.floor(Number(h) / 12)]! + (extra as number));
  });
  // The extra members, conditioned on the household's type.
  r.register('conditioned', EXTRA_FN.name, EXTRA_FN.version, (inputs, F, params) => {
    const weights = params.weights as number[][];
    const row = weights[Math.floor(Number(inputs[0]) / 12)]!;
    return F.map((v) => Math.max(row[v as number] ?? 0, 1e-9));
  });
  return r;
}

const RESIDENT_SLOTS = (j: number): SlotDef[] => [
  slot('profile', 'xf:profile', { mode: 'derived', derive: { fn: { name: 'identity', version: 1 }, inputs: [`^/p${j}`], preimage: { name: 'identity', version: 1 } } }),
  slot('aband', 'xf:aband', { mode: 'derived', derive: { fn: { ...VIEW_FN, params: { which: 'a' } }, inputs: ['profile'], preimage: { ...VIEW_FN, params: { which: 'a' } } } }),
  slot('role', 'xf:role', { mode: 'derived', derive: { fn: { ...VIEW_FN, params: { which: 'r' } }, inputs: ['profile'], preimage: { ...VIEW_FN, params: { which: 'r' } } } }),
  slot('affc', 'xf:affc', { mode: 'derived', derive: { fn: { ...VIEW_FN, params: { which: 'f' } }, inputs: ['profile'], preimage: { ...VIEW_FN, params: { which: 'f' } } } }),
  slot('name', 'xf:name-node', { tier: 3 }),
  slot('age', 'core:age', { tier: 3 }),
  slot('age-class', 'core:age-class', { mode: 'derived', tier: 3, derive: { fn: { name: 'age-class', version: 1 }, inputs: ['age'], preimage: { name: 'age-class', version: 1 } } }),
  slot('sociability', 'xf:sociability', { tier: 4 }),
  slot('archetype', 'xf:archetype', { tier: 3 }),
  slot('life', 'xf:life', { tier: 3 }),
  // The game time a story event killed the resident, pinned by whoever killed them; absent while they live (S1 4.2).
  slot('died', 'core:time', { mode: 'assigned', tier: 3 }),
  // The rungs of the relationship ladder the person refuses, comma-separated (S1 4.7): a boundary pin.
  slot('boundary', 'core:display-name', { mode: 'assigned', tier: 3 }),
  slot('position', 'core:position', { mode: 'mirrored', tier: 3 }),
];

/**
 * The name dimensions of a pack that carries the wide name registry (src/sim/names.ts): the origins, and the given and family names under each.
 * A pack without it takes the kernel's own two origins and seven names, and its schema is unchanged.
 */
function nameDims(data: S1Data): DimensionDef[] {
  const n = data.people.names;
  if (!n) return [];
  const origins = Object.keys(n.origins).sort();
  const list = (k: 'given' | 'family'): Record<string, string[]> => Object.fromEntries(origins.map((o) => [o, n.origins[o]![k].slice()]));
  return [
    dim('xf:name-origin', { t: 'enum', values: origins }),
    dim('xf:given-name', { t: 'enum-by', by: 'origin', lists: list('given') }),
    dim('xf:family-name', { t: 'enum-by', by: 'origin', lists: list('family') }),
  ];
}

/** The slots of `xf:name`: the registry's own origin, given and family slots replace the core's (same keys, same order, so `display` still concatenates them). */
function nameSlots(data: S1Data): SlotDef[] {
  if (!data.people.names) return [];
  return [slot('origin', 'xf:name-origin', { tier: 4 }), slot('given', 'xf:given-name', { tier: 4 }), slot('family', 'xf:family-name', { tier: 4 })];
}

/** The schema definitions of the pack, for the districts' norms and the event kinds of `data`. */
export function worldDefs(data: S1Data, wSim = data.time.W): SchemaDefs {
  const W = wSim;
  const dims: DimensionDef[] = [
    dim('xf:headcount', { t: 'int', min: 0, max: 65535 }, { structure: 'order' }),
    dim('xf:count-cells', { t: 'int', min: 0, max: 255 }, { structure: 'order' }),
    dim('xf:count-hh', { t: 'int', min: 0, max: 4095 }, { structure: 'order' }),
    dim('xf:count-services', { t: 'int', min: 0, max: 15 }, { structure: 'order' }),
    dim('xf:public', { t: 'enum', values: ['public', 'semi', 'private'] }),
    dim('xf:band', { t: 'enum', values: ['quiet', 'elevated', 'hot', 'flashpoint'] }),
    dim('xf:svc-status', { t: 'enum', values: ['open', 'quiet', 'watched', 'closed'] }),
    dim('xf:svc-type', { t: 'text' }),
    dim('xf:gap', { t: 'enum', values: ['aligned', 'gap', 'wide'] }),
    dim('xf:label', { t: 'enum', values: ['unknown', 'low', 'mid', 'high'] }),
    dim('xf:group-gap', { t: 'enum', values: ['low', 'mid', 'high'] }),
    dim('xf:hprofile', { t: 'enum', values: HPROFILE_VALUES }),
    dim('xf:extra', { t: 'int', min: 0, max: 3 }, { structure: 'order' }),
    dim('xf:hsize', { t: 'int', min: 1, max: 6 }, { structure: 'order' }),
    dim('xf:profile', { t: 'enum', values: PROFILE_VALUES }),
    dim('xf:aband', { t: 'int', min: 0, max: 7 }, { structure: 'order' }),
    dim('xf:role', { t: 'enum', values: [...ROLES] }),
    dim('xf:affc', { t: 'int', min: 0, max: 5 }, { structure: 'order' }),
    dim('xf:life', { t: 'enum', values: Array.from({ length: 16 }, (_, i) => String(i)) }),
    dim('xf:archetype', { t: 'enum', values: [...ARCHETYPES] }),
    dim('xf:sociability', { t: 'enum', values: [...SOCIABILITY] }, {
      prior: { name: 'weights', version: 1, params: { weights: { low: data.people.sociability.prior[0], mid: data.people.sociability.prior[1], high: data.people.sociability.prior[2] } } },
    }),
    dim('xf:yesno', { t: 'enum', values: ['yes', 'no'] }),
    dim('xf:alive', { t: 'enum', values: ['yes', 'no'] }),
    dim('xf:flag', { t: 'enum', values: ['yes', 'no'] }),
    dim('xf:affiliation', { t: 'text' }),
    dim('xf:tracked', { t: 'enum', values: ['yes', 'no'] }),
    dim('xf:jstate', { t: 'enum', values: ['active', 'blocked', 'finished', 'failed'] }),
    dim('xf:wanted', { t: 'int', min: 0, max: 5 }, { structure: 'order' }),
    dim('xf:signed', { t: 'real', min: -1, max: 1, quantum: 1 / 64 }, { structure: 'metric' }),
    dim('xf:tie-kind', { t: 'enum', values: ['kin', 'crew', 'colleague', 'neighbour', 'friend', 'rival'] }),
    dim('xf:tie-status', { t: 'enum', values: ['acquainted', 'friendly', 'close', 'strained', 'estranged', 'ended'] }),
    dim('xf:lastcontact', { t: 'int', min: -1, max: 2 ** 40 }, { structure: 'order' }),
    dim('xf:evn', { t: 'int', min: 0, max: 65535 }, { structure: 'order' }),
    dim('xf:name-node', { t: 'node', kind: 'xf:name' }),
    ...nameDims(data),
    dim('xf:cell-node', { t: 'node', kind: 'xf:cell' }),
    dim('xf:household-node', { t: 'node', kind: 'xf:household' }),
    dim('xf:service-node', { t: 'node', kind: 'xf:service' }),
    dim('xf:group-node', { t: 'node', kind: 'xf:group' }),
    dim('xf:circle-node', { t: 'node', kind: 'xf:circle' }),
    dim('xf:standing-node', { t: 'node', kind: 'xf:standing' }),
    ...Array.from({ length: 6 }, (_, j) => dim(`xf:resident-node-${j}`, { t: 'node', kind: `xf:resident-${j}` })),
  ];

  const temporalGap = (id: string): SlotDef => slot(`gap-${id}`, 'xf:gap', { mode: 'assigned', temporal: { window: W }, tier: 1 });
  const kinds: KindDef[] = [
    { id: 'xf:city', extends: ['core:place'], slots: [] },
    {
      id: 'xf:district', extends: ['core:place'],
      slots: [
        slot('cells', 'xf:cell-node', { card: { many: { count: 'xf:count-cells' } }, tier: 1 }),
        slot('grp-a1', 'xf:group-node', { tier: 1 }), slot('grp-a2', 'xf:group-node', { tier: 1 }), slot('grp-a3', 'xf:group-node', { tier: 1 }),
        slot('circle-stalls', 'xf:circle-node', { tier: 1 }),
        slot('standing-v', 'xf:standing-node', { tier: 1 }),
        ...data.norms.norms.map((n) => temporalGap(n.id)),
      ],
    },
    {
      id: 'xf:cell', extends: ['core:place'],
      slots: [
        slot('public', 'xf:public', { mode: 'assigned', tier: 2 }),
        slot('headcount', 'xf:headcount', { mode: 'assigned', tier: 2 }),
        slot('households', 'xf:household-node', { card: { many: { count: 'xf:count-hh' } }, tier: 2 }),
        slot('services', 'xf:service-node', { card: { many: { count: 'xf:count-services' } }, tier: 2 }),
        slot('band', 'xf:band', { mode: 'assigned', temporal: { window: W }, tier: 2 }),
      ],
    },
    { id: 'xf:service', extends: ['core:thing'], slots: [slot('type', 'xf:svc-type', { mode: 'assigned', tier: 2 }), slot('status', 'xf:svc-status', { mode: 'assigned', temporal: { window: W }, tier: 2 })] },
    {
      id: 'xf:standing', extends: ['core:thing'],
      slots: data.ledger.axes.map((a) => slot(`label-${a}`, 'xf:label', { mode: 'assigned', temporal: { window: W }, tier: 1 })),
    },
    { id: 'xf:group', extends: ['core:group'], slots: [slot('standing-v', 'xf:standing-node', { tier: 1 }), slot('group-gap', 'xf:group-gap', { mode: 'assigned', temporal: { window: W }, tier: 1 })] },
    { id: 'xf:circle', extends: ['core:group'], slots: [slot('standing-v', 'xf:standing-node', { tier: 1 })] },
    { id: 'xf:name', extends: ['core:name'], slots: nameSlots(data) },
    {
      id: 'xf:household', extends: ['core:thing'],
      slots: [
        slot('hprofile', 'xf:hprofile'),
        slot('extra', 'xf:extra', { conditioned: { fn: { ...EXTRA_FN, params: { weights: HH_TYPES.map((t) => [...data.people.extraWeights[t]]) } }, inputs: ['hprofile'] } }),
        slot('size', 'xf:hsize', { mode: 'derived', derive: { fn: { ...SIZE_FN, params: { base: HH_TYPES.map((t) => data.people.baseSize[t]) } }, inputs: ['hprofile', 'extra'] } }),
        ...Array.from({ length: 6 }, (_, j) => slot(`p${j}`, 'xf:profile')),
        ...Array.from({ length: 6 }, (_, j) => slot(`m${j}`, `xf:resident-node-${j}`)),
      ],
    },
    { id: 'xf:resident', extends: ['core:thing'], classifiesAs: ['core:person'], facets: ['actor'], slots: RESIDENT_SLOTS(0) },
    ...Array.from({ length: 6 }, (_, j): KindDef => ({ id: `xf:resident-${j}`, extends: ['xf:resident'], slots: [RESIDENT_SLOTS(j)[0]!] })),
    {
      id: 'xf:person', extends: ['core:person'],
      slots: [
        slot('affiliation', 'xf:affiliation', { mode: 'mirrored', tier: 3 }),
        slot('alive', 'xf:alive', { mode: 'mirrored', tier: 3 }),
        slot('crowd', 'xf:flag', { mode: 'mirrored', tier: 3 }),
        slot('quest-linked', 'xf:flag', { mode: 'mirrored', tier: 3 }),
        slot('boundary', 'core:display-name', { mode: 'assigned', tier: 3 }),
      ],
    },
    // v0.6 (S1 4.9): a minimal possession; S1 never mints one in the core
    { id: 'xf:item', extends: ['core:thing'], slots: [slot('label', 'core:display-name', { mode: 'assigned', tier: 1 })] },
    {
      id: 'xf:v-state', extends: ['core:thing'],
      slots: [
        slot('position', 'core:position', { mode: 'mirrored', tier: 1 }),
        slot('district', 'core:display-name', { mode: 'mirrored', tier: 1 }),
        slot('cell', 'core:display-name', { mode: 'mirrored', tier: 1 }),
        slot('wanted', 'xf:wanted', { mode: 'mirrored', tier: 1 }),
      ],
    },
    {
      id: 'xf:journal', extends: ['core:thing'],
      slots: [
        slot('family', 'core:display-name', { mode: 'mirrored', tier: 1 }),
        slot('district', 'core:display-name', { mode: 'mirrored', tier: 1 }),
        slot('tracked', 'xf:tracked', { mode: 'mirrored', tier: 1 }),
        slot('jstate', 'xf:jstate', { mode: 'mirrored', tier: 1 }),
        slot('target', 'core:display-name', { mode: 'mirrored', tier: 1 }),
      ],
    },
  ];

  const edgeTypes: EdgeTypeDef[] = [
    { id: 'xf:tie', from: ['core:thing'], to: ['core:thing'], attrs: { kind: 'xf:tie-kind', status: 'xf:tie-status', strength: 'core:unit', lastContact: 'xf:lastcontact' }, data: ['history'], symmetric: true },
    { id: 'xf:regard', from: ['core:thing'], to: ['core:thing'], attrs: { warmth: 'xf:signed', respect: 'xf:signed', trustA: 'core:unit', trustB: 'core:unit', trustI: 'core:unit', evN: 'xf:evn' } },
    // v0.6 (S1 7.0, 4.9): a seat holder leads a group (writer `group.decide`), an item is held by an actor (writer `city.events`)
    { id: 'xf:leads', from: ['core:thing'], to: ['core:group'], attrs: { seat: 'core:count-small' } },
    { id: 'xf:held-by', from: ['xf:item'], to: ['core:thing'], attrs: {} },
  ];
  return { dims, kinds, edgeTypes };
}

/** The whole schema of a simulation kernel: the core's, with the event kinds and participant roles the pack registers, and the pack's. */
export function simDefs(data: S1Data, kindNames: readonly string[] = allEventKindNames(data), wSim = data.time.W): SchemaDefs {
  const core = coreDefs(wSim, { extraEventKinds: kindNames, extraParticipantRoles: participantRoles() });
  return mergeDefs(core, worldDefs(data, wSim));
}

export { ivlRegion };
