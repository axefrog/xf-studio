/**
 * Actors, trust and disagreement: primitives only. Another actor's opinion arrives as an entry carrying its provenance
 * (a belief). Resolving a value asks whose opinion counts for this kind of fact, never which write came last; two
 * differing opinions are a visible disagreement, listed with conflicts. Channels, remote actors and trust tables come
 * later; until then an actor trusts only itself.
 */
import { equal } from "./json";
import type { Json } from "./json";
import type { EventRef } from "./types";

/** One actor's claim about a fact, true as of its last observation. */
export type Claim = { readonly actor: string; readonly value: Json; readonly asOf: number; readonly entry?: EventRef };

/**
 * How much an actor is trusted for a kind of fact, within a frame of reference: higher wins; 0 is not trusted. There
 * is no global truth: a frame is the domain in which a collective of actors agrees (the local actor's own frame by
 * default), so policies are per frame.
 */
export interface TrustPolicy { rank(factKind: string, actor: string, frame?: string): number }
/** Trust policies per frame of reference: the policy for a frame. */
export type FramePolicies = (frame: string) => TrustPolicy;

/** The default policy: an actor trusts itself for everything and nobody else. */
export const trustSelf = (self: string): TrustPolicy => ({ rank: (_kind, actor) => actor === self ? 1 : 0 });

/** Trust by a table of fact kinds to ranked actors (`"*"` for every kind), falling back to `fallback`. */
export const trustTable = (table: Readonly<Record<string, readonly string[]>>, fallback?: TrustPolicy): TrustPolicy => ({
  rank(kind, actor) {
    const order = table[kind] ?? table["*"];
    const index = order ? order.indexOf(actor) : -1;
    return index >= 0 ? order!.length - index + 1 : fallback?.rank(kind, actor) ?? 0;
  },
});

/** A value in disagreement: the claims, and the one the policy trusts (if any). */
export type Disagreement = {
  readonly kind: "disagreement"; readonly factKind: string; readonly claims: readonly Claim[]; readonly trusted?: Claim;
};

/**
 * The value to use for a fact from several actors' claims: the most trusted actor's latest claim. `asOf` is compared
 * only within one actor's claims (actors' clocks differ); among equally ranked actors the one whose ID sorts first
 * (by UTF-16 code units, as canonical JSON sorts names) is trusted. When trusted claims differ from another actor's
 * latest claim, the result also carries the disagreement (SPEC §17.5).
 */
export function resolveClaims(factKind: string, claims: readonly Claim[], policy: TrustPolicy, frame?: string):
  { readonly value?: Json; readonly from?: Claim; readonly disagreement?: Disagreement } {
  const latest = new Map<string, Claim>();
  for (const claim of claims) {
    const current = latest.get(claim.actor);
    if (!current || claim.asOf >= current.asOf) latest.set(claim.actor, claim);
  }
  const ranked = [...latest.values()].map(claim => ({ claim, rank: policy.rank(factKind, claim.actor, frame) }))
    .sort((a, b) => b.rank - a.rank || (a.claim.actor < b.claim.actor ? -1 : a.claim.actor > b.claim.actor ? 1 : 0));
  const trusted = ranked.find(item => item.rank > 0)?.claim;
  const differing = [...latest.values()].some(claim => trusted && !equal(claim.value, trusted.value));
  const all = [...latest.values()].sort((a, b) => a.actor < b.actor ? -1 : 1);
  return {
    ...(trusted ? { value: trusted.value, from: trusted } : {}),
    ...(differing || !trusted && all.length > 1 && all.some(claim => !equal(claim.value, all[0].value))
      ? { disagreement: { kind: "disagreement" as const, factKind, claims: all, ...(trusted ? { trusted } : {}) } } : {}),
  };
}
