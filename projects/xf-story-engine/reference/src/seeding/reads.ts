// City, norm, brokerage and reputation reads (S2 2.16, 2.17): the atoms `city` and `social`. Layer 2 holds none of the simulation layer's code: it
// names the reads it understands and the order of their arguments, and asks a `SimReadPort` for the answer (registries.ts). A read the
// port does not build stays a later capability, refused at compile with a plain finding; the reads it builds answer `maybe` until the
// simulation layer has a reading for their scope.

import type { Instance } from './layer2.ts';
import type { Pred } from './types.ts';

export type ReadFamily = 'city' | 'social';

/** The reads S2 names, by family, with the names of their arguments in order (S2 2.16, 2.17). */
export const READ_SHAPES: Record<string, { family: ReadFamily; args: readonly string[] }> = {
  band: { family: 'city', args: ['cell'] },
  heatRank: { family: 'city', args: ['district'] },
  tension: { family: 'city', args: ['a', 'b'] },
  regime: { family: 'city', args: ['scope'] },
  regimeIs: { family: 'city', args: ['scope', 'kind'] },
  reach: { family: 'city', args: ['district', 'item'] },
  protected: { family: 'city', args: ['node'] },
  presence: { family: 'city', args: ['leaf', 'faction'] },
  priceLevel: { family: 'city', args: ['district'] },
  refuge: { family: 'city', args: ['leaf'] },
  label: { family: 'social', args: ['audience', 'subject', 'axis'] },
  bridge: { family: 'social', args: ['who'] },
  normGap: { family: 'social', args: ['norm', 'scope'] },
  contract: { family: 'social', args: ['id'] },
  tied: { family: 'social', args: ['a', 'b', 'type'] },
  divergence: { family: 'social', args: ['believer', 'subject'] },
};

export type ReadAtom = Extract<Pred, { city: unknown } | { social: unknown }>;

export type ReadCall = { name: string; family: ReadFamily; args: unknown[]; argNames: readonly string[] } | { error: string };

/** The read a `city` or `social` atom makes: `{ band: { cell: X } }` is the read `band` with the argument `X`. */
export function readCall(atom: ReadAtom): ReadCall {
  const family: ReadFamily = 'city' in atom ? 'city' : 'social';
  const call = ('city' in atom ? atom.city : atom.social) as unknown;
  if (typeof call !== 'object' || call === null || Array.isArray(call)) return { error: `A ${family} read is written as { <read>: { <argument>: ... } }.` };
  const keys = Object.keys(call);
  if (keys.length !== 1) return { error: `A ${family} read names exactly one read; this one names ${keys.length}.` };
  const name = keys[0]!;
  const shape = READ_SHAPES[name];
  if (!shape || shape.family !== family) return { error: `"${name}" is not a ${family} read. The ${family} reads are: ${Object.entries(READ_SHAPES).filter(([, s]) => s.family === family).map(([n]) => n).join(', ')}.` };
  const given = (call as Record<string, unknown>)[name];
  if (typeof given !== 'object' || given === null || Array.isArray(given)) return { error: `The read "${name}" takes its arguments as an object: ${shape.args.join(', ')}.` };
  const have = Object.keys(given);
  const missing = shape.args.filter((a) => !have.includes(a));
  const extra = have.filter((a) => !shape.args.includes(a));
  if (missing.length > 0 || extra.length > 0) {
    return { error: `The read "${name}" takes ${shape.args.join(', ')}${missing.length > 0 ? `; missing: ${missing.join(', ')}` : ''}${extra.length > 0 ? `; not an argument: ${extra.join(', ')}` : ''}.` };
  }
  return { name, family, args: shape.args.map((a) => (given as Record<string, unknown>)[a]), argNames: shape.args };
}

/**
 * A read's arguments for an instance: a role of the seed is replaced by the node cast in it; anything else (an Id, a place name, a norm or an
 * axis) is the argument as written. Undefined when an argument names a role that is not cast (the answer is then `maybe`).
 */
export function resolveReadArgs(call: Extract<ReadCall, { name: string }>, inst: Instance | undefined): unknown[] | undefined {
  const out: unknown[] = [];
  for (const a of call.args) {
    if (typeof a === 'string' && inst && inst.st.document.roles[a] !== undefined) {
      const node = inst.st.roles[a]?.cast;
      if (node === undefined) return undefined;
      out.push(node);
    } else out.push(a);
  }
  return out;
}
