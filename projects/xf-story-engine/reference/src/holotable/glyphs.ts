import type { Item, Kind } from './schema.ts';

// Holotable glyph vocabulary v1, including its documented family fallbacks.
// Unknown names are deliberately accepted by the schema and counted at publish.
export const GLYPHS = new Set([
  'person', 'fixer', 'merchant', 'collector', 'police', 'medic', 'courier', 'gang-member', 'gang-leader', 'netrunner', 'civilian',
  'group', 'gang', 'corp', 'crowd',
  'event', 'theft', 'assault', 'clash', 'shakedown', 'police-action', 'cyberpsychosis', 'disorder', 'accident', 'outage', 'trade', 'rumour', 'warning', 'confrontation', 'death',
  'story', 'juncture', 'scene', 'thread', 'direction', 'sown', 'held', 'refused',
  'place', 'refuge', 'hideout', 'market', 'clinic', 'crackdown', 'festival', 'hazard',
  'item', 'vehicle', 'weapon', 'data', 'money', 'diagnostic', 'waypoint', 'control-point', 'sensor', 'goal', 'note', 'probe',
]);
export const BADGES = new Set(['ready', 'pending', 'matched', 'blocked', 'done', 'new']);
export const KIND_GLYPHS: Record<Kind, string> = { actor: 'person', point: 'event', zone: 'place', target: 'direction', relation: 'diagnostic' };
const normal = (name: string) => name.toLowerCase().replace(/[ _]+/g, '-');
export function personGlyph(role?: string): string {
  const name = normal(role ?? '');
  const aliases: Record<string, string> = { vendor: 'merchant', shopkeeper: 'merchant', stallholder: 'merchant', 'street-vendor': 'merchant', gang: 'gang-member' };
  if (aliases[name]) return aliases[name];
  return ['merchant', 'collector', 'fixer', 'police', 'medic', 'courier', 'gang-member', 'gang-leader', 'netrunner', 'civilian'].includes(name) ? name : 'person';
}
export function eventGlyph(kind: string): string {
  const aliases: Record<string, string> = { 'gang-clash': 'clash', 'psycho-break': 'cyberpsychosis', commerce: 'trade', tell: 'rumour', telling: 'rumour', confront: 'confrontation', threat: 'warning', price: 'warning', search: 'confrontation', presence: 'scene', 'game.death': 'death', 'meta:story': 'story' };
  const name = aliases[kind] ?? kind;
  return ['theft', 'assault', 'clash', 'shakedown', 'police-action', 'cyberpsychosis', 'disorder', 'accident', 'outage', 'trade', 'rumour', 'warning', 'confrontation', 'death', 'scene', 'story'].includes(name) ? name : 'event';
}
export const storyGlyph = (family?: string) => family === 'turn' ? 'juncture' : family === 'shape' ? 'thread' : 'story';
export const decisionGlyph = (kind?: string, held = false) => held ? 'held' : kind === 'told' ? 'rumour' : kind === 'surface' ? 'direction' : kind === 'explain' ? 'note' : 'sown';
export function placeGlyph(regimes: readonly string[], refuge: boolean): string {
  return regimes.includes('crackdown') ? 'crackdown' : regimes.includes('festival') ? 'festival' : refuge ? 'refuge' : 'place';
}
export function storyBadge(states: readonly string[]): string | undefined {
  return ['ready', 'pending', 'matched'].find((state) => states.includes(state));
}
/** Number of unrecognised names on this published revision, including badges. */
export function unknownGlyphs(item: Item): number {
  return Number(item.glyph !== undefined && !GLYPHS.has(item.glyph)) + Number(item.badge !== undefined && !BADGES.has(item.badge));
}
