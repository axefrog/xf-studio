import type { Item } from './schema.ts';

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
  const full = long.length || label ? JSON.stringify({ ...(item.detail ? { detail: item.detail } : {}), ...(label ? { label } : {}), ...Object.fromEntries(long) }) : item.detail;
  for (const [key, value] of long) item.facets![key] = caption(value);
  if (label) item.label = caption(label, 160);
  let count = long.length + (label ? 1 : 0);
  if (full !== undefined) {
    if (full.length > 4000) {
      const suffix = `… (truncated; full record at ${item.cite})`;
      item.detail = full.slice(0, 4000 - suffix.length) + suffix;
      count++;
    } else item.detail = full;
  }
  return count;
}
