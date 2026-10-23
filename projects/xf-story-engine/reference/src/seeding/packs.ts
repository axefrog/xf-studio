// A pack as the compiler and the runtime read it: ids to fragments and text units, references that resolve,
// tombstones, and the closure a live instance freezes (S2 sections 1.2, 12.3).

import { hrec } from '../canon.ts';
import { H, s as hs } from '../id.ts';
import { playOf, resolveFragment } from './doc.ts';
import type { CompiledSeed, ContentRef, Fragment, Pack, TextMeta, TextUnit } from './types.ts';

export type Resolved =
  | { kind: 'fragment'; fragment: Fragment }
  | { kind: 'text'; text: TextUnit }
  | { kind: 'game' }
  | { kind: 'todo' }
  | { kind: 'tombstone'; replacement: string | null }
  | { kind: 'missing' };

const stripPrefix = (ref: string): string => (ref.startsWith('pack:') ? ref.slice(5) : ref);

export class PackIndex {
  readonly fragments = new Map<string, Fragment>();
  readonly texts = new Map<string, TextUnit>();
  readonly duplicates: Array<{ id: string; what: string }> = [];

  constructor(readonly pack: Pack) {
    for (const f of pack.fragments) {
      if (this.fragments.has(f.id) || this.texts.has(f.id)) this.duplicates.push({ id: f.id, what: 'fragment' });
      this.fragments.set(f.id, resolveFragment(f));
    }
    for (const t of pack.texts) {
      if (this.texts.has(t.id) || this.fragments.has(t.id)) this.duplicates.push({ id: t.id, what: 'text unit' });
      this.texts.set(t.id, t);
    }
    const seen = new Set<string>();
    for (const sd of pack.seeds) {
      if (seen.has(sd.id)) this.duplicates.push({ id: sd.id, what: 'seed' });
      seen.add(sd.id);
    }
  }

  /** What a reference names. A reference to the game's own content (`game:...`) is a `GameRef` (S2 section 2.20). */
  resolve(ref: ContentRef | undefined): Resolved {
    if (ref === undefined) return { kind: 'missing' };
    if (typeof ref === 'object') return { kind: 'todo' };
    if (ref.startsWith('game:')) return { kind: 'game' };
    const id = stripPrefix(ref);
    const f = this.fragments.get(id);
    if (f) return { kind: 'fragment', fragment: f };
    const t = this.texts.get(id);
    if (t) return { kind: 'text', text: t };
    const tomb = this.pack.tombstones;
    if (tomb && id in tomb) return { kind: 'tombstone', replacement: tomb[id] ?? null };
    return { kind: 'missing' };
  }

  fragment(ref: string | undefined): Fragment | undefined {
    if (ref === undefined) return undefined;
    const r = this.resolve(ref);
    if (r.kind === 'fragment') return r.fragment;
    if (r.kind === 'tombstone' && r.replacement) return this.fragment(r.replacement);
    return undefined;
  }

  text(ref: ContentRef | undefined): TextUnit | undefined {
    const r = this.resolve(ref);
    if (r.kind === 'text') return r.text;
    if (r.kind === 'fragment') return this.text(r.fragment.forms.standard);
    if (r.kind === 'tombstone' && r.replacement) return this.text(r.replacement);
    return undefined;
  }

  /** The content references a fragment mentions. */
  static fragmentRefs(f: Fragment): ContentRef[] {
    const out: ContentRef[] = [f.forms.standard];
    if (f.forms.short) out.push(f.forms.short);
    if (f.forms.full) out.push(f.forms.full);
    if (f.implied) out.push(f.implied);
    const o = f.offer;
    if (o) {
      for (const a of o.actions) out.push(a.foresight);
      if (o.nullPath.content) out.push(o.nullPath.content);
      if (o.lapse.content) out.push(o.lapse.content);
      for (const d of o.decline) out.push(d.response);
      if (o.retractQuietly) out.push(o.retractQuietly);
    }
    for (const r of f.responses ?? []) {
      out.push(r.content);
      if (r.reply) out.push(r.reply);
    }
    if (f.callback?.recue) out.push(f.callback.recue);
    return out;
  }

  /** The content references a seed document mentions. */
  static seedRefs(c: CompiledSeed): ContentRef[] {
    const out: ContentRef[] = [];
    if (c.closing) out.push(c.closing);
    for (const w of c.windows) if (w.closeContent) out.push(w.closeContent);
    for (const b of Object.values(c.beats)) {
      out.push(...playOf(b).refs);
      if (b.aftermath) out.push(...b.aftermath.signposts);
    }
    return out;
  }

  /**
   * The closure of a document: every fragment and text unit it references, transitively (S2 section 1.2). A
   * reference to a retired id follows its tombstone's replacement.
   */
  closure(c: CompiledSeed): { fragments: Fragment[]; texts: TextUnit[] } {
    const fragments = new Map<string, Fragment>();
    const texts = new Map<string, TextUnit>();
    const queue: ContentRef[] = PackIndex.seedRefs(c);
    while (queue.length > 0) {
      const ref = queue.shift()!;
      const r = this.resolve(ref);
      if (r.kind === 'fragment') {
        if (fragments.has(r.fragment.id)) continue;
        fragments.set(r.fragment.id, r.fragment);
        queue.push(...PackIndex.fragmentRefs(r.fragment));
      } else if (r.kind === 'text') {
        texts.set(r.text.id, r.text);
      } else if (r.kind === 'tombstone' && r.replacement) {
        queue.push(r.replacement);
      }
    }
    const byId = <T extends { id: string }>(m: Map<string, T>): T[] => [...m.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { fragments: byId(fragments), texts: byId(texts) };
  }
}

/**
 * The hash of a document's structure: the expanded document and the semantic content of everything it
 * references, excluding the contents of text units (S2 section 12.3). A text-only edit keeps it.
 */
export function structureHash(c: CompiledSeed, closure: { fragments: Fragment[]; texts: TextMeta[] }): string {
  // Strip the words if a caller passed full units: a text-only edit must keep the hash.
  const texts = closure.texts.map((t) => {
    const { text: _text, ...rest } = t as TextMeta & { text?: string };
    return rest;
  });
  return H(hs('structure'), hrec({ document: c, fragments: closure.fragments, texts }));
}

/** The text units of a closure without their words. */
export const stripWords = (texts: TextUnit[]): TextMeta[] => texts.map(({ text: _text, ...rest }) => rest);
