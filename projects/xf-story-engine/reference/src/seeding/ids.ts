// Layer 2's identities (S2 sections 1.2, 2.5, 3.3, 6.2, 8.6, 12.1), each a pure function of the world seed and
// the names that make it. Nothing here reads a session value (S2-I-11).

import { H, id as hid, i as hi, mintedId, mirroredId, rootId, s as hs } from '../id.ts';
import type { Id } from '../types.ts';

export const GLOBAL_NAME = 'layer2';

/** The layer-2 global record's id: `H("root", worldSeed, "layer2")` (S2 section 12.1). */
export const globalId = (worldSeed: Id): Id => rootId(worldSeed, GLOBAL_NAME);

export const packRootId = (worldSeed: Id, packId: string): Id => rootId(worldSeed, `pack:${packId}`);

/** The `cause` of an authored instance: `H("sow", packId, templateId[, n])` (S2 section 1.2). */
export const sowCause = (packId: string, templateId: string, n?: number): Id =>
  n === undefined ? H(hs('sow'), hs(packId), hs(templateId)) : H(hs('sow'), hs(packId), hs(templateId), hi(n));

export const instanceName = (templateId: string, n?: number, localName?: string): string =>
  localName !== undefined ? `seed:${templateId}:${localName}` : n === undefined ? `seed:${templateId}` : `seed:${templateId}:${n}`;

export const instanceId = (creator: Id, cause: Id, name: string): Id => mintedId(creator, cause, name);

/** The fact node a game fact is: `H("game", "fact:" + name)` (S0 section 2.6). */
export const gameFactKey = (name: string): string => `fact:${name}`;
export const gameFactNode = (name: string): Id => mirroredId(gameFactKey(name));

/** A seed's own fact node: `H("mint", seedId, seedId, "fact:" + key)` (S2 section 2.5). */
export const seedFactNode = (seed: Id, key: string): Id => mintedId(seed, seed, `fact:${key}`);

/** The pin Id of the n-th write of a seed fact: a rewrite of an earlier value is a new pin, not the old one (S2 section 2.5). */
export const seedFactPinId = (seed: Id, key: string, n: number): Id => H(hs('pin'), hid(seed), hs(`fact:${key}`), hi(n));

export const watchFrameId = (seed: Id): Id => mintedId(seed, seed, 'frame:watch');
export const roleFrameId = (seed: Id, role: string): Id => mintedId(seed, seed, `frame:role:${role}`);
export const goalFrameId = (seed: Id, role: string): Id => mintedId(seed, seed, `frame:goal:${role}`);

/**
 * A cast edge's Id: it names the role, so two roles bound to the same node have two edges, and the commit (the time and the delivery that
 * committed it), so a role committed again after it was lost has a new one (S2 section 5.3, L2-06). The kernel's own edge Id leaves the
 * edge data, and so the role, out.
 */
export const castEdgeId = (seed: Id, role: string, node: Id, at: number, cause: Id): Id =>
  H(hs('cast-edge'), hid(seed), hs(role), hid(node), hi(at), hid(cause));

/** A stand-in's node: `H("mint", seedId, seedId, "role:" + key)` (S2 section 5.4). */
export const standInNode = (seed: Id, role: string): Id => mintedId(seed, seed, `role:${role}`);

/** An offer's event and delivery Id: `H("mint", seedId, seedId, "offer:" + beat + ":" + n)` (S2 section 6.2). */
export const offerId = (seed: Id, beat: string, n: number): Id => mintedId(seed, seed, `offer:${beat}:${n}`);
export const responseEventId = (seed: Id, beat: string, n: number): Id => mintedId(seed, seed, `response:${beat}:${n}`);
export const outcomeEventId = (seed: Id): Id => mintedId(seed, seed, 'outcome');
export const beatDeliveryId = (seed: Id, beat: string, n: number): Id => H(hs('beat'), hid(seed), hs(beat), hi(n));
export const closeDeliveryId = (seed: Id, kind: string): Id => H(hs('close'), hid(seed), hs(kind));
export const newsDeliveryId = (seed: Id): Id => H(hs('news'), hid(seed));
export const noticeId = (kind: string, branch: string): Id => H(hs('notice'), hs(kind), hs(branch));
export const replyDeliveryId = (seed: Id, offer: Id, kind: string): Id => H(hs('reply'), hid(seed), hid(offer), hs(kind));

/** The tie-break of the arbiter: `H("arb", worldSeed, delivery.id)` (S2 section 8.3). */
export const arbTie = (worldSeed: Id, delivery: Id): Id => H(hs('arb'), hid(worldSeed), hid(delivery));

/** The next consequence-event id of an effect: stable per (seed, beat, n, index). */
export const effectEventId = (seed: Id, tag: string): Id => mintedId(seed, seed, `effect:${tag}`);
