import data from './wording.json';
import { WIDE_NAMES } from '../sim/names.ts';
import type { NameData } from '../sim/data.ts';
import type { EventView, PoolEntry } from '../procedural/types.ts';
import type { Juncture, Pattern } from '../seeding/pattern-types.ts';
import tensions from '../../../../../research/story-engine/composite/patterns/tensions.json';
import turns from '../../../../../research/story-engine/composite/patterns/turns.json';
import closures from '../../../../../research/story-engine/composite/patterns/closures.json';
import shapes from '../../../../../research/story-engine/composite/patterns/shapes.json';

export const wording = data;
export const patternInfo = (id: string) => [...tensions.patterns, ...turns.patterns, ...closures.patterns, ...shapes.patterns].find((p) => p.id === id);
export type Mood = 'past' | 'waiting' | 'holds';
export type Names = (id: string | undefined, prose?: boolean) => string | undefined;
const lookup = (table: object, key: string): string | undefined => (table as Record<string, string>)[key];
export const sentence = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : '';
export const words = (s?: string) => s?.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ');
export const strength = (n: number) => n < .34 ? 'weak' : n < .67 ? 'moderate' : 'strong';
export const percent = (n: number) => `${Math.round(n * 100)} %`;
export const groupName = (s?: string) => s ? lookup(data.groups, s) : undefined;
export const roleWord = (s?: string) => s ? lookup(data.roles, s.replace(/-group$/, '')) : undefined;
export const eventNoun = (kind: string) => lookup(data.eventNouns, kind) ?? 'what happened';
export const reason = (s: string) => lookup(data.reasons, s) ?? words(s.replace(/[^a-zA-Z -]/g, ' '))?.trim() ?? '';

/** Names already in the record win. Unopened names use a display-only pool
 * assignment, stable by identity; this never calls the engine's random draws.
 * It is not an assertion that the unresolved name slot has that value. */
export function names(record: ReadonlyMap<string, string>, protagonist: string): Names {
  return (id, prose = true) => {
    if (!id) return undefined;
    if (id === protagonist) return prose ? 'you' : 'V';
    const known = record.get(id);
    if (known) return known;
    return undefined;
  };
}
export function poolName(id: string, pool: NameData = WIDE_NAMES): string {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const origins = Object.values(pool.origins), o = origins[h % origins.length];
  return `${o.given[Math.floor(h / origins.length) % o.given.length]} ${o.family[Math.floor(h / (origins.length * o.given.length)) % o.family.length]}`;
}
function fill(template: string, slots: Record<string, string | undefined>): string | undefined {
  let missing = false;
  const result = template.replace(/\{([^}]+)\}/g, (_, slot: string) => {
    if (!slots[slot]) missing = true;
    return slots[slot] ?? '';
  });
  return missing ? undefined : result;
}
export const phrase = (key: keyof typeof data.phrases, slots: Record<string, string | undefined> = {}) => fill(data.phrases[key], slots)!;
export function share(line: Readonly<Record<string, number>>): string | undefined {
  const merged = new Map<string, number>();
  for (const [aff, q] of Object.entries(line)) {
    const name = groupName(aff);
    if (name && q > 0 && Number.isFinite(q)) merged.set(name, (merged.get(name) ?? 0) + q);
  }
  const rows = [...merged].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = rows.reduce((s, [, q]) => s + q, 0);
  if (!total) return undefined;
  const top = rows.filter(([name]) => name !== 'others').slice(0, 3);
  const rest = rows.filter(([name]) => !top.some(([shown]) => shown === name)).reduce((s, [, q]) => s + q, 0);
  const displayed = [...top, ...(rest ? [['others', rest] as [string, number]] : [])];
  const rounded = displayed.map(([, q]) => Math.floor(q / total * 100));
  const remainders = displayed.map(([, q], i) => ({ i, fraction: q / total * 100 - rounded[i] })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (let left = 100 - rounded.reduce((n, q) => n + q, 0), i = 0; left > 0; left--, i++) rounded[remainders[i].i]++;
  return displayed.map(([name], i) => `${name} ${rounded[i]} %`).join(' · ');
}
const shortPattern = (s: string) => s.replace(/^xf\.composite:/, '');
export function title(instance: Pick<PoolEntry, 'pattern' | 'bindings'>, resolve: Names): string {
  const spec = (data.patterns as Record<string, { title: string; fallback: string }>)[shortPattern(instance.pattern)];
  if (!spec) return 'A story';
  const slots = Object.fromEntries(Object.entries(instance.bindings).map(([k, v]) => [k, resolve(v)]));
  return fill(spec.title, slots) ?? (spec.fallback ? fill(spec.fallback, slots) : undefined) ?? spec.title.split(':')[0];
}
export function step(juncture: Juncture, mood: Mood, instance: Pick<PoolEntry, 'pattern' | 'bindings'>, pattern: Pattern | undefined, resolve: Names, depth = 0): string | undefined {
  const spec = (data.functions as Record<string, Record<Mood, string>>)[juncture.fn];
  if (!spec || depth > 4) return undefined;
  const slots = Object.fromEntries(Object.entries(juncture.args).map(([key, value]) => {
    if (value.startsWith('?')) return [key, resolve(instance.bindings[value])];
    const referred = pattern?.junctures?.[value];
    if (referred) {
      const noun = (data.nouns as Record<string, Record<string, string>>)[shortPattern(instance.pattern)]?.[value];
      const past = step(referred, 'past', instance, pattern, resolve, depth + 1);
      return [key, noun ?? (past ? `what happened when ${past[0].toLowerCase()}${past.slice(1)}` : undefined)];
    }
    if (key === 'pattern') return [key, value === 'any' ? 'earlier' : (data.patterns as Record<string, { title: string }>)[shortPattern(value)]?.title.split(':')[0].toLowerCase()];
    if (value === 'any') return [key, key === 'outcome' ? 'it came to an end' : 'help'];
    return [key, /^[a-z][a-z -]*$/.test(value) ? words(value) : resolve(value)];
  }));
  // Empty moods in the agreed table intentionally have no text. A state that
  // has no waiting mood is described by what must hold, in the waiting mood.
  const template = spec[mood] || (mood === 'waiting' && spec.holds ? `waiting until ${spec.holds}` : '');
  const text = template && fill(template, slots);
  return text ? sentence(text) : undefined;
}
export function event(ev: EventView, resolve: Names): string {
  const slots: Record<string, string | undefined> = {};
  for (const p of ev.participants) {
    const key = p.role.replace(/-group$/, ''), name = resolve(p.who);
    if (name) slots[key] = slots[key] ? `${slots[key]} and ${name}` : name;
  }
  const template = lookup(data.events, ev.kind);
  const mapping = (data.eventFunctions as Record<string, { fn: string; args: Record<string, string> }>)[ev.kind];
  const functionTemplate = mapping && (data.functions as Record<string, { past: string }>)[mapping.fn]?.past;
  const base = mapping && functionTemplate ? fill(functionTemplate, Object.fromEntries(Object.entries(mapping.args).map(([key, role]) => [key, slots[role]]))) : template && fill(template, slots);
  const fallback = lookup(data.eventFallbacks, ev.kind) ?? (template && !template.includes('{') ? template : 'Something happened');
  const text = sentence(base ?? fallback);
  return ev.outcome === 'prevented' ? `${text}, but it was prevented` : ev.outcome === 'failed' ? `${text}, but it failed` : text;
}
export function time(at: number, start = 0): string {
  const minutes = Math.max(0, Math.floor((at - start) / 60));
  return `Day ${Math.floor(minutes / 1440) + 1}, ${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
/** Bounded, cycle-safe cause traversal. The subject itself is the final step.
 * Unknown causes add no invented text. A note signals a clipped known chain. */
export function why(eventId: string, max: number, events: ReadonlyMap<string, EventView>, resolve: Names, start = 0): string[] {
  const cap = Math.max(0, Math.min(5, Math.floor(max))), seen = new Set<string>(), selected: EventView[] = [];
  const pending = [eventId]; let cut = false;
  while (pending.length) {
    pending.sort((a, b) => (events.get(a)?.time ?? -Infinity) - (events.get(b)?.time ?? -Infinity) || a.localeCompare(b));
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const ev = events.get(id);
    if (!ev) continue;
    if (selected.length >= cap) { cut = true; break; }
    selected.push(ev);
    pending.push(...[...new Set([...ev.causes, ...(events.has(ev.cause) ? [ev.cause] : [])])].filter((c) => !seen.has(c)));
  }
  const result = selected.reverse().sort((a, b) => a.time - b.time).map((e) => `${time(e.time, start)}: ${event(e, resolve)}.`);
  if (cut) result.push('(earlier causes not shown)');
  return result;
}
export function person(node: { name: string; role?: string; doing?: unknown; wants?: string[]; planning?: string[]; believes?: string[]; affiliation?: string }): { label: string; facets: Record<string, string> } {
  const role = roleWord(node.role), facets: Record<string, string> = {};
  const doing = typeof node.doing === 'string' ? lookup(data.routines, node.doing) : undefined;
  if (doing) facets.doing = doing;
  if (node.wants?.length) facets.wants = node.wants.join(' ');
  if (node.planning?.length) facets.planning = node.planning.join(' ');
  if (node.believes?.length) facets.believes = node.believes.join(' ');
  if (node.affiliation) facets.with = node.affiliation;
  return { label: node.name + (role ? `, ${role}` : ''), facets };
}
