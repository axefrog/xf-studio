/** Semantic vocabulary only. Producers choose names; renderer adapters choose icons and colour tokens. */
const families: Readonly<Record<string, readonly string[]>> = {
  person: ["person", "fixer", "merchant", "collector", "police", "medic", "courier", "gang-member", "gang-leader", "netrunner", "civilian"],
  group: ["group", "gang", "corp", "crowd"],
  event: ["theft", "assault", "clash", "shakedown", "police-action", "cyberpsychosis", "disorder", "accident", "outage", "trade", "rumour", "warning", "confrontation", "death"],
  story: ["story", "juncture", "scene", "thread"], direction: ["sown", "held", "refused"],
  place: ["place", "refuge", "hideout", "market", "clinic", "crackdown", "festival", "hazard"],
  item: ["item", "vehicle", "weapon", "data", "money"], diagnostic: ["waypoint", "control-point", "sensor", "goal", "note", "probe"],
};
/** One table: the intended Studio icon name first, the family fallback second. Missing icons need no special-case code. */
export const GLYPHS: Readonly<Record<string, { icon: string; family: string }>> = Object.freeze(Object.fromEntries(
  Object.entries(families).flatMap(([family, names]) => names.map(name => [name, { icon: name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), family }]))));
export function glyphIcon(glyph: string | undefined, exists: (name: string) => boolean): { known: boolean; icon?: string } {
  const entry = glyph && Object.hasOwn(GLYPHS, glyph) ? GLYPHS[glyph] : undefined;
  return entry ? { known: true, icon: [entry.icon, entry.family].find(exists) } : { known: false };
}
export const BADGE_TONES: Readonly<Record<string, string>> = { ready: "good", done: "good", pending: "muted", matched: "accent", blocked: "warning", new: "accent" };
export function unknownGlyphs(items: readonly { glyph?: string }[]) {
  const names = items.flatMap(item => item.glyph && !Object.hasOwn(GLYPHS, item.glyph) ? [item.glyph] : []);
  return { count: names.length, names: [...new Set(names)].sort() };
}
