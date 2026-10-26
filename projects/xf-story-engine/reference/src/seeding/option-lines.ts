import type { Instance, Layer2 } from './layer2.ts';
import type { Delivery, OfferSpec } from './types.ts';

/** Freeze exactly the selectable words once. A load never calls a game transcript resolver again. */
export function freezeOptions(l2: Layer2, inst: Instance, d: Delivery, offer: OfferSpec): void {
  if (d.options) return;
  const options = [...offer.actions.map((a) => ({ ...a, key: `action:${a.id}` })),
    ...offer.decline.map((a) => ({ ...a, key: `decline:${a.id}` })), { ...offer.nullPath, key: 'null' }];
  d.options = options.map((o) => {
    const line = o.say;
    let words: string | undefined;
    if (line && 'text' in line) words = l2.renderWords(inst, { ...d, words: undefined, content: line.text });
    else if (line && 'recorded' in line) words = l2.reg.gameLine?.(line.recorded);
    else if (line && 'splice' in line) {
      const cuts = line.splice.map((cut) => l2.reg.gameLine?.(cut.line, { from: cut.from, to: cut.to }));
      if (cuts.every((s) => s !== undefined)) words = cuts.join(' ');
    }
    return { key: o.key, ...(words === undefined ? {} : { words }), ...(o.label ? { label: o.label } : {}),
      voiced: !!line && !('text' in line), ...(line ? { line: structuredClone(line) } : {}) };
  });
}
