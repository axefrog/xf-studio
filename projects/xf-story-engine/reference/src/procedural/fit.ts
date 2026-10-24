import type { FitRequest, FitTerm, Layer3Data } from './types.ts';
import { bound } from '../seeding/doc.ts';
import { cmp } from './keys.ts';

/** One implementation for live draws and the fit report. No session or preference input. */
export function fitTerms(req: FitRequest, data: Layer3Data): FitTerm[] {
  const previous = req.layer2
    .instances()
    .filter(
      (i) =>
        i.template.id === req.seed.template.id &&
        i.template.pack === req.seed.template.pack &&
        i.sowSeq < req.seed.sowSeq,
    )
    .sort((a, b) => b.sowSeq - a.sowSeq)[0];
  const global = req.layer2.global();
  return req.options.map((o) => {
    let aes = 0,
      denom = 0;
    if (req.choice.kind === 'cast' && o.node)
      for (const k of Object.keys(req.seed.document.intent.aesthetic ?? {}).sort(cmp)) {
        const a = req.seed.document.intent.aesthetic![k];
        const f = req.kernel.aesthetic(o.node, k);
        if (f !== undefined) {
          aes += a * f;
          denom += Math.abs(a);
        }
      }
    aes = denom === 0 ? 0 : aes / denom;
    const prior =
      req.choice.kind === 'cast' ? previous?.roles[req.choice.role!]?.cast : previous?.draws[req.choice.key]?.value;
    const used = o.fragment ? global.fragmentUses[o.fragment] : undefined;
    const variety = -Math.max(
      prior !== undefined && prior === (o.node ?? o.id) ? 1 : 0,
      used && global.offerCount - used.lastOffer < data.fit.varietyOffers ? 1 : 0,
    );
    const role = req.seed.document.roles[req.choice.role ?? ''];
    const claim = role?.claim ? bound(role.claim).value : undefined;
    const yielding =
      req.choice.kind === 'cast' &&
      o.node &&
      req.layer2.claimConflict(o.node, claim?.span ?? 'seed', claim?.share ?? 'none')
        ? -1
        : 0;
    let raw = data.fit.aesthetic * aes;
    raw += data.fit.variety * variety;
    raw += data.fit.yield * yielding;
    return {
      option: o.id,
      aes,
      var: variety,
      yield: yielding,
      raw,
      clamped: Math.max(-req.fitCap, Math.min(req.fitCap, raw)),
    };
  });
}
export const leadAim = (w: { lead?: 'early' | 'preferred' | 'late'; urgency: number }) => ({
  release: w.lead ?? ('early' as const),
  urgency: w.urgency,
});
export function aimHolds(
  w: { lead?: 'early' | 'preferred' | 'late'; urgency: number },
  waited: number,
  maxWait: number,
  joint: boolean,
  data: Layer3Data,
): boolean {
  if (waited >= data.aim.relaxAt * maxWait) return false;
  const aim = leadAim(w);
  if (aim.release === 'early') return false;
  if (aim.release === 'preferred')
    return aim.urgency < data.aim.preferredUrgency && !(waited >= data.aim.preferredWait && joint);
  return aim.urgency < data.aim.lateUrgency;
}
