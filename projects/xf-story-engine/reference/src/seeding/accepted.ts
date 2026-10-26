import { playOf } from './doc.ts';
import type { CompiledSeed, Fragment, Pred } from './types.ts';
import type { Instance, Layer2 } from './layer2.ts';
import { evalPred } from './eval.ts';

/** Offer beats whose accepted action is guaranteed by this predicate, including every OR arm. */
export function acceptedBy(p: Pred): string[] {
  if (typeof p === 'string' || 'not' in p) return [];
  if ('all' in p) return [...new Set(p.all.flatMap(acceptedBy))];
  if ('any' in p) {
    const arms = p.any.map(acceptedBy);
    return arms.length ? arms[0].filter((b) => arms.every((a) => a.includes(b))) : [];
  }
  return 'response' in p && p.is.length > 0 && p.is.every((r) => r.startsWith('action:')) ? [p.response] : [];
}

export function obstacleOffers(c: CompiledSeed, beat: string, fragment: (r: string) => Fragment | undefined,
  isV: (role: string) => boolean): string[] {
  const b = c.beats[beat];
  if (b?.kind !== 'obstacle' || (b.obstacle?.affordances.length ?? 0) < 2 || !b.links?.length) return [];
  const eligible = (key: string) => playOf(c.beats[key] ?? {}).refs.some((r) => fragment(r)?.offer?.stakes.some((s) => isV(s.bearer)));
  const perLink = b.links.map((l) => 'because' in l && l.on ? acceptedBy(l.on).filter(eligible) : []);
  return perLink.every((a) => a.length) ? [...new Set(perLink.flat())] : [];
}

/** Resolved targets and the recorded answer decide runtime permission, even for aliased V roles. */
export function harmAllowed(l2: Layer2, inst: Instance, path?: string): boolean {
  const beat = path?.split('/')[1];
  if (!beat) return false;
  const isV = (r: string) => r === 'v' || inst.st.roles[r]?.cast === l2.k.vId;
  const fragment = (ref: string) => inst.st.closure.fragments.find((f) => f.id === ref.replace(/^pack:/, ''));
  const sources = obstacleOffers(inst.st.document, beat, fragment, isV);
  return sources.some((source) => {
    if (!inst.st.document.beats[beat].links?.some((l) => 'because' in l && l.on && acceptedBy(l.on).includes(source)
      && evalPred(l2, { inst, t: l2.k.now }, l.on) === 'yes')) return false;
    const rt = inst.st.beats[source];
    if (!rt?.response?.startsWith('action:')) return false;
    const d = inst.st.deliveries.find((d) => d.id === rt.responseDelivery);
    const offer = d?.fragment ? fragment(d.fragment)?.offer : undefined;
    return !!offer?.actions.some((a) => 'action:' + a.id === rt.response) && !!offer.stakes.some((s) => isV(s.bearer));
  });
}
