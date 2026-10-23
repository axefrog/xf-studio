// The core schema (spec 2.6, 9.2, 9.3). The reference model ships it; the fixtures use it.
//
// Where the specification leaves a detail open (the contents of enums, the exact dimension of a
// count), the choice here is a small, plain one, and the fixtures extend or replace it as they need.
// Slot modes follow spec 5.1: `assigned` slots take their values from pins (or from a constraint that
// leaves exactly one value), `sampled` slots are drawn, `mirrored` slots are read from the game.

import type { DimensionDef, EdgeTypeDef, KindDef, SchemaDefs } from './schema-types.ts';
import type { FnRef } from './types.ts';

const uniform: FnRef = { name: 'uniform', version: 1 };

const dim = (id: string, value: DimensionDef['value'], structure: DimensionDef['structure'] = 'none', extra: Partial<DimensionDef> = {}): DimensionDef => ({
  id,
  value,
  structure,
  prior: uniform,
  ...extra,
});

export const CORE_DRIVES: Array<{ id: string; family: string }> = [
  { id: 'hunger', family: 'body' },
  { id: 'rest', family: 'body' },
  { id: 'comfort', family: 'body' },
  { id: 'safety', family: 'survival' },
  { id: 'money', family: 'resources' },
  { id: 'housing', family: 'resources' },
  { id: 'family', family: 'bonds' },
  { id: 'belonging', family: 'bonds' },
  { id: 'status', family: 'standing' },
  { id: 'ambition', family: 'power' },
  { id: 'freedom', family: 'self' },
  { id: 'curiosity', family: 'curiosity' },
  { id: 'honour', family: 'justice' },
  { id: 'legacy', family: 'legacy' },
];

export const CORE_EFFECTS = ['harm', 'kill', 'help', 'protect', 'rescue', 'take', 'give', 'expose', 'conceal', 'move', 'meet'];

/**
 * The core event kinds (spec 9.2, 16). `offer`, `response` and `seed-outcome` are the seeding layer's (v4, V4-2).
 * Packs register more (S0 v4.8); until the event-kind registry exists, a caller names them in `extraEventKinds`.
 */
export const CORE_EVENT_KINDS = ['generic', 'robbery', 'arrival', 'meeting', 'assault', 'sale', 'weather-change'];
/** The event kinds the seeding layer adds (v4, V4-2). */
export const V4_EVENT_KINDS = ['offer', 'response', 'seed-outcome'];

export interface CoreDefsOptions {
  /** Include the v4 additions (V4-2, V4-3, V4-22). On by default; the frozen v3 digest runs without them (SPEC-NOTES 58). */
  v4?: boolean;
  /** More event kinds (S0 v4.8's registry does not exist yet). */
  extraEventKinds?: readonly string[];
}

export function coreDefs(wSim = 600, opts: CoreDefsOptions = {}): SchemaDefs {
  const v4 = opts.v4 ?? true;
  const extraEventKinds = opts.extraEventKinds ?? [];
  const dims: DimensionDef[] = [
    dim('core:origin', { t: 'enum', values: ['western', 'japanese'] }),
    dim('core:given-name', {
      t: 'enum-by',
      by: 'origin',
      lists: { western: ['Alex', 'Jordan', 'Maria', 'Dmitri'], japanese: ['Haruto', 'Yui', 'Kenji'] },
    }),
    dim('core:family-name', {
      t: 'enum-by',
      by: 'origin',
      lists: { western: ['Reyes', 'Novak', 'Hale'], japanese: ['Tanaka', 'Sato', 'Mori'] },
    }),
    dim('core:display-name', { t: 'text' }),
    dim('core:drive-id', { t: 'enum', values: CORE_DRIVES.map((d) => d.id) }),
    dim('core:unit', { t: 'real', min: 0, max: 1, quantum: 1 / 64 }, 'metric'),
    dim('core:trait-id', { t: 'enum', values: ['loyal', 'greedy', 'curious', 'cautious', 'proud', 'kind'] }),
    dim('core:age', { t: 'int', min: 16, max: 90 }, 'order'),
    dim('core:age-band', { t: 'int', min: 0, max: 9 }, 'order'),
    dim('core:count-small', { t: 'int', min: 0, max: 8 }, 'order'),
    dim('core:count-255', { t: 'int', min: 0, max: 255 }, 'order'),
    dim('core:position', { t: 'vec', n: 3, quantum: 1 / 16 }, 'metric'),
    dim('core:public', { t: 'enum', values: ['public', 'private', 'restricted'] }),
    dim('core:role', { t: 'enum', values: ['leader', 'member', 'associate', 'contractor'] }),
    dim('core:visibility', { t: 'enum', values: ['open', 'secret', 'deniable'] }),
    dim('core:terms', { t: 'enum', values: ['standing', 'contract'] }),
    dim('core:time', { t: 'int', min: -(2 ** 50), max: 2 ** 50 }, 'order'),
    dim('core:duration', { t: 'int', min: 1, max: 2 ** 40 }, 'order'),
    dim('core:relation', { t: 'enum', values: ['parent', 'child', 'sibling', 'partner'] }),
    dim('core:event-kind', { t: 'enum', values: [...CORE_EVENT_KINDS, ...(v4 ? V4_EVENT_KINDS : []), ...extraEventKinds] }),
    ...(v4
      ? [
          // v4 additions (V4-2, V4-3, V4-22).
          dim('core:age-class', { t: 'enum', values: ['adult', 'minor'] }),
          dim('core:fact-value', { t: 'int', min: -2048, max: 2047 }, 'order'),
          dim('core:seed-fact-value', { t: 'int', min: -(2 ** 31), max: 2 ** 31 - 1 }, 'order'),
          dim('core:event-outcome', { t: 'enum', values: ['done', 'failed', 'prevented'] }),
          dim('core:frame-ref', { t: 'text' }),
        ]
      : []),
    dim('core:effect-id', { t: 'enum', values: CORE_EFFECTS }),
    dim('core:participant-role', {
      t: 'enum',
      values: ['participant', 'actor', 'target', 'victim', 'customer', 'collector', 'vendor', 'guard', 'witness'],
    }),
    dim('core:count-participants', { t: 'int', min: 0, max: 32 }, 'order'),
    // A ref to anything (used for assigned slots, whose values come from pins, so the query is never run).
    dim('core:thing-ref', {
      t: 'ref',
      kind: 'core:thing',
      candidates: { find: 'core:thing', scope: { under: 'root:city' }, must: [], max: 1 },
    }),
    dim('core:place-ref', {
      t: 'ref',
      kind: 'core:place',
      candidates: { find: 'core:place', scope: { under: 'root:city' }, must: [], max: 256 },
    }),
    dim('core:event-ref', {
      t: 'ref',
      kind: 'core:event',
      candidates: { find: 'core:event', scope: { under: 'root:city' }, must: [], max: 1 },
    }),
    dim('core:name-node', { t: 'node', kind: 'core:name' }),
    dim('core:trait-node', { t: 'node', kind: 'core:trait' }),
    dim('core:drive-node', { t: 'node', kind: 'core:drive-state' }),
    dim('core:participant-node', { t: 'node', kind: 'core:participant' }),
    dim('core:effect-node', { t: 'node', kind: 'core:effect-record' }),
  ];

  const kinds: KindDef[] = [
    // The abstract base of every thing a ref can name.
    { id: 'core:thing', slots: [] },
    {
      id: 'core:name',
      extends: ['core:thing'],
      slots: [
        { key: 'origin', dim: 'core:origin', card: 'one', mode: 'sampled', tier: 4 },
        { key: 'given', dim: 'core:given-name', card: 'one', mode: 'sampled', tier: 4 },
        { key: 'family', dim: 'core:family-name', card: 'one', mode: 'sampled', tier: 4 },
        {
          key: 'display',
          dim: 'core:display-name',
          card: 'one',
          mode: 'derived',
          derive: { fn: { name: 'concat', version: 1, params: { sep: ' ' } }, inputs: ['given', 'family'] },
          tier: 4,
        },
      ],
    },
    {
      id: 'core:drive-state',
      extends: ['core:thing'],
      slots: [
        { key: 'drive', dim: 'core:drive-id', card: 'one', mode: 'sampled', tier: 1 },
        { key: 'importance', dim: 'core:unit', card: 'one', mode: 'sampled', tier: 1 },
        { key: 'urgency', dim: 'core:unit', card: 'one', mode: 'sampled', temporal: { window: wSim }, tier: 1 },
      ],
    },
    {
      id: 'core:trait',
      extends: ['core:thing'],
      slots: [
        { key: 'trait', dim: 'core:trait-id', card: 'one', mode: 'sampled', tier: 4 },
        { key: 'strength', dim: 'core:unit', card: 'one', mode: 'sampled', tier: 4 },
      ],
    },
    {
      id: 'core:person',
      extends: ['core:thing'],
      facets: ['actor'],
      slots: [
        { key: 'name', dim: 'core:name-node', card: 'one', mode: 'sampled', tier: 3 },
        { key: 'age', dim: 'core:age', card: 'one', mode: 'sampled', tier: 3 },
        {
          key: 'age-band',
          dim: 'core:age-band',
          card: 'one',
          mode: 'derived',
          derive: {
            fn: { name: 'floor-div', version: 1, params: { divisor: 10 } },
            inputs: ['age'],
            preimage: { name: 'floor-div', version: 1, params: { divisor: 10 } },
          },
          tier: 3,
        },
        { key: 'traits', dim: 'core:trait-node', card: { many: { count: 'core:count-small' } }, mode: 'sampled', tier: 4 },
        { key: 'drives', dim: 'core:drive-node', card: { many: { count: 'core:count-small' } }, mode: 'sampled', tier: 2 },
        { key: 'position', dim: 'core:position', card: 'one', mode: 'mirrored', tier: 3 },
        { key: 'place', dim: 'core:place-ref', card: 'one', mode: 'sampled', tier: 2 },
        // v4.4 (V4-22): derived from age for generated people, mirrored for mirrored people, declared (pinned) for pack people.
        ...(v4
          ? [
              {
                key: 'age-class',
                dim: 'core:age-class',
                card: 'one' as const,
                mode: 'mirrored' as const,
                derive: {
                  fn: { name: 'age-class', version: 1 },
                  inputs: ['age'],
                  preimage: { name: 'age-class', version: 1 },
                },
                tier: 3 as const,
              },
            ]
          : []),
      ],
    },
    {
      id: 'core:group',
      extends: ['core:thing'],
      facets: ['actor', 'group'],
      slots: [
        { key: 'name', dim: 'core:name-node', card: 'one', mode: 'sampled', tier: 1 },
        { key: 'drives', dim: 'core:drive-node', card: { many: { count: 'core:count-small' } }, mode: 'sampled', tier: 1 },
      ],
    },
    {
      id: 'core:place',
      extends: ['core:thing'],
      facets: ['place'],
      slots: [
        { key: 'position', dim: 'core:position', card: 'one', mode: 'mirrored', tier: 2 },
        { key: 'district', dim: 'core:place-ref', card: 'one', mode: 'sampled', tier: 1 },
        { key: 'public', dim: 'core:public', card: 'one', mode: 'sampled', tier: 2 },
      ],
    },
    {
      id: 'core:participant',
      extends: ['core:thing'],
      slots: [
        { key: 'who', dim: 'core:thing-ref', card: 'one', mode: 'assigned', tier: 3 },
        { key: 'role', dim: 'core:participant-role', card: 'one', mode: 'assigned', tier: 3 },
      ],
    },
    {
      id: 'core:effect-record',
      extends: ['core:thing'],
      slots: [
        { key: 'on', dim: 'core:thing-ref', card: 'one', mode: 'assigned', tier: 3 },
        { key: 'effect', dim: 'core:effect-id', card: 'one', mode: 'assigned', tier: 3 },
      ],
    },
    {
      id: 'core:event',
      extends: ['core:thing'],
      facets: ['event'],
      slots: [
        { key: 'time', dim: 'core:time', card: 'one', mode: 'assigned', tier: 3 },
        { key: 'place', dim: 'core:place-ref', card: 'one', mode: 'assigned', tier: 3 },
        { key: 'kind', dim: 'core:event-kind', card: 'one', mode: 'assigned', tier: 3 },
        { key: 'participants', dim: 'core:participant-node', card: { many: { count: 'core:count-participants' } }, mode: 'sampled', tier: 3 },
        { key: 'effects', dim: 'core:effect-node', card: { many: { count: 'core:count-participants' } }, mode: 'sampled', tier: 3 },
        { key: 'witnesses', dim: 'core:thing-ref', card: { many: { count: 'core:count-participants' } }, mode: 'assigned', tier: 3 },
        { key: 'causes', dim: 'core:event-ref', card: { many: { count: 'core:count-participants' } }, mode: 'assigned', tier: 3 },
        // v4 (V4-3): optional. An event without them means what it always meant.
        ...(v4
          ? [
              { key: 'outcome', dim: 'core:event-outcome', card: 'one' as const, mode: 'assigned' as const, tier: 3 as const },
              { key: 'served', dim: 'core:frame-ref', card: 'one' as const, mode: 'assigned' as const, tier: 3 as const },
            ]
          : []),
      ],
    },
    ...(v4
      ? [
          // v4 (V4-2): the seeding layer's kinds (S2 section 0.4).
          {
            id: 'core:game-fact',
            extends: ['core:thing'],
            slots: [{ key: 'value', dim: 'core:fact-value', card: 'one' as const, mode: 'mirrored' as const, tier: 1 as const }],
          },
          {
            id: 'core:seed-fact',
            extends: ['core:thing'],
            slots: [{ key: 'value', dim: 'core:seed-fact-value', card: 'one' as const, mode: 'assigned' as const, tier: 1 as const }],
          },
          { id: 'core:seed', extends: ['core:thing'], facets: ['actor' as const], slots: [] },
        ]
      : []),
    {
      id: 'core:summary',
      extends: ['core:thing'],
      facets: ['summary'],
      slots: [
        { key: 'kind', dim: 'core:event-kind', card: 'one', mode: 'assigned', tier: 1 },
        { key: 'from', dim: 'core:time', card: 'one', mode: 'assigned', tier: 1 },
        { key: 'length', dim: 'core:duration', card: 'one', mode: 'assigned', tier: 1 },
        { key: 'scope', dim: 'core:place-ref', card: 'one', mode: 'assigned', tier: 1 },
        { key: 'count', dim: 'core:count-255', card: 'one', mode: 'sampled', tier: 1 },
      ],
    },
  ];

  const edgeTypes: EdgeTypeDef[] = [
    {
      id: 'core:member-of',
      from: ['core:thing'],
      to: ['core:group'],
      attrs: { role: 'core:role', strength: 'core:unit', visibility: 'core:visibility', terms: 'core:terms', until: 'core:time', 'exit-cost': 'core:unit' },
      data: ['obligations'],
      perceivable: true,
    },
    { id: 'core:kin', from: ['core:person'], to: ['core:person'], attrs: { relation: 'core:relation' }, symmetric: true },
    { id: 'core:located-in', from: ['core:thing'], to: ['core:thing'], attrs: {} },
    // v4 (V4-2): a seed's committed cast. Not perceivable; the role is carried as edge data.
    ...(v4 ? [{ id: 'core:cast', from: ['core:seed'], to: ['core:thing'], attrs: {}, data: ['role'] }] : []),
    { id: 'core:knows', from: ['core:person'], to: ['core:person'], attrs: {}, symmetric: true },
  ];

  return { dims, kinds, edgeTypes, drives: CORE_DRIVES };
}

/** Combine schema definitions (a pack extending the core). Duplicate ids are an error at load time. */
export function mergeDefs(...parts: SchemaDefs[]): SchemaDefs {
  return {
    dims: parts.flatMap((p) => p.dims),
    kinds: parts.flatMap((p) => p.kinds),
    edgeTypes: parts.flatMap((p) => p.edgeTypes),
    drives: parts.flatMap((p) => p.drives ?? []),
  };
}
