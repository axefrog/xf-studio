import type { PoolEntry } from '../procedural/types.ts';
import type { Pattern } from '../seeding/pattern-types.ts';

export const plainWords = (value?: string): string => value ? value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._:-]+/g, ' ') : 'not recorded';
export function unopenedDoing(role?: string): string {
  if (!role) return 'a person (role not recorded; not yet opened)';
  const labels: Record<string, string> = { vendor: 'merchant', shopkeeper: 'merchant', stallholder: 'merchant', gang: 'gang member', service: 'service worker', corporate: 'corporate worker', nightlife: 'nightlife worker' };
  const label = labels[role] ?? plainWords(role);
  return `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label} (not yet opened)`;
}
export function storyCaption(entry: PoolEntry, pattern: Pattern | undefined, name: (id: string | undefined) => string): string {
  if (entry.graph?.outcome || entry.complete) return `ended: ${plainWords(entry.graph?.outcome?.name)}`;
  const ready = Object.entries(entry.graph?.junctures ?? {}).filter(([, j]) => j.state === 'ready')
    .sort((a, b) => (a[1].readySince ?? Infinity) - (b[1].readySince ?? Infinity));
  if (ready.length) {
    const next = pattern?.junctures?.[ready[0][0]];
    const actor = next && (next.args.by ?? next.args.who ?? next.args.actor ?? next.args.group ?? next.args.guard ?? next.args.debtor);
    return `waiting for ${plainWords(next?.fn)} by ${name(actor ? entry.bindings[actor] : undefined)}`;
  }
  const matched = Object.entries(entry.graph?.junctures ?? {}).filter(([, j]) => j.state === 'matched' || j.state === 'refined')
    .sort((a, b) => (b[1].filler?.at ?? -Infinity) - (a[1].filler?.at ?? -Infinity));
  return `under way: ${plainWords(matched[0]?.[0])}`;
}
