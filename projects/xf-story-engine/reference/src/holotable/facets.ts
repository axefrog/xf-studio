import type { Item } from './schema.ts';

/** The blank line separates the summary block from its causes. Current-story
 * text belongs to that summary block, never to the arrow-linked cause chain. */
export function compatibilityDetail(detail: string): string {
  const [summary, ...causeBlocks] = detail.split('\n\n');
  const heading = summary.split('\n').filter(Boolean).join(' ');
  const causes = causeBlocks.flatMap((block) => block.split('\n')).filter(Boolean);
  return causes.length ? `${heading} Why: ${causes.join(' → ')}` : heading;
}

/** Keep the largest complete prefix of a diagnostic list/map that fits. For
 * scalar text N counts omitted UTF-16 characters, matching the schema's bound.
 */
function caption(value: string, limit = 500): string {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { /* ordinary text */ }
  const array = Array.isArray(parsed) ? parsed : undefined;
  const entries = !array && parsed && typeof parsed === 'object' ? Object.entries(parsed) : undefined;
  if (array || entries) {
    const values = array ?? entries!;
    let lo = 0, hi = values.length - 1, best = '';
    while (lo <= hi) {
      const n = Math.floor((lo + hi) / 2);
      const head = JSON.stringify(array ? values.slice(0, n) : Object.fromEntries(values.slice(0, n)));
      const suffix = `… (+${values.length - n} more)`;
      if (head.length + suffix.length <= limit) { best = head + suffix; lo = n + 1; }
      else hi = n - 1;
    }
    if (best) return best;
  }
  let keep = limit;
  for (;;) {
    const suffix = `… (+${value.length - keep} more)`;
    const next = limit - suffix.length;
    if (next >= keep) return value.slice(0, keep) + suffix;
    keep = next;
  }
}

/** Mutates only the newly constructed producer item, never an engine record.
 * Counts one truncation per shortened facet and one for shortened detail.
 */
export function boundText(item: Item): number {
  const long = Object.entries(item.facets ?? {}).filter(([, v]) => v.length > 500);
  const label = item.label && item.label.length > 160 ? item.label : undefined;
  const full = long.length || label ? [item.detail, label, ...long.map(([key, value]) => `${key}: ${value}`)].filter(Boolean).join('\n') : item.detail;
  for (const [key, value] of long) item.facets![key] = caption(value);
  if (label) item.label = caption(label, 160);
  let count = long.length + (label ? 1 : 0);
  if (full !== undefined) {
    if (full.length > 4000 || full.split('\n').length > 40) {
      const suffix = '… (more in the record link)';
      item.detail = full.split('\n').slice(0, 40).join('\n').slice(0, 4000 - suffix.length) + suffix;
      count++;
    } else item.detail = full;
  }
  return count;
}
