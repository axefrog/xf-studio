// The minors floor (S2 section 2.19): a role that could bind a minor is barred from sexual and exploitation
// tags and from victim, target or hostile positions. The lint checks it from the document (L-95); casting
// enforces it at run time by removing non-adults from the roles it bars. A missing age class counts as minor
// (S0 v4, V4-22).

import { effectSites, playOf } from './doc.ts';
import type { PackIndex } from './packs.ts';
import type { L2Registry } from './registries.ts';
import type { CompiledSeed, Fragment } from './types.ts';

const TARGET_EFFECTS = new Set(['harm', 'kill', 'take', 'expose', 'conceal']);

/** The roles a seed bars from minors, each with the plain reason. */
export function barredRoles(c: CompiledSeed, pack: PackIndex, reg: L2Registry): Map<string, string> {
  const out = new Map<string, string>();
  const fragOf = (ref: string): Fragment | undefined => pack.fragment(ref);
  for (const [beat, b] of Object.entries(c.beats)) {
    for (const ref of playOf(b).refs) {
      const f = fragOf(ref);
      if (!f) continue;
      const tagged = (f.content ?? []).filter((t) => reg.isSexual(t.class) || reg.isExploit(t.class));
      if (tagged.length === 0) continue;
      for (const fr of f.roles) {
        const role = b.bind?.[fr] ?? fr;
        if (c.roles[role]) out.set(role, `it is in a beat tagged ${tagged.map((t) => t.class).join(', ')}`);
      }
    }
    void beat;
  }
  for (const e of effectSites(c, fragOf)) {
    const x = e.effect;
    if ('kernel' in x && TARGET_EFFECTS.has(x.kernel.effect) && c.roles[x.kernel.on]) out.set(x.kernel.on, `it is the target of ${x.kernel.effect}`);
  }
  for (const r of Object.values(c.roles)) {
    for (const g of r.goal?.effects ?? []) if (TARGET_EFFECTS.has(g.effect) && c.roles[g.on]) out.set(g.on, `it is the target of ${g.effect}`);
  }
  return out;
}
