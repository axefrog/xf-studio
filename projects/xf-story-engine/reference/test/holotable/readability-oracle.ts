import { expect } from 'bun:test';
import type { Item } from '../../src/holotable/schema.ts';

// Independent oracle: scan runs and parse exponent mantissa/suffix pairs,
// rather than reuse the producer's guard or its combined regular expression.
export function hasInternals(value: string): boolean {
  if (/se:|xf[.:]|\?[a-z]|[{}\[\]]|not recorded|not opened|\bcoarse\b/i.test(value)) return true;
  for (const token of value.toLowerCase().split(/[^a-z0-9-]+/)) if (/^gate-?\d/.test(token) || /^[a-z]\d+-/.test(token)) return true;
  if (/\bgate \d/i.test(value)) return true;
  for (let i = 0; i < value.length - 1; i++) if (value[i] === '.' && '0123456789'.includes(value[i + 1])) return true;
  let hex = 0, digits = 0;
  for (const char of value.toLowerCase()) {
    hex = '0123456789abcdef'.includes(char) ? hex + 1 : 0;
    digits = '0123456789'.includes(char) ? digits + 1 : 0;
    if (hex >= 16 || digits >= 10) return true;
  }
  for (const token of value.split(/\s+/)) for (let i = 0; i < token.length; i++) {
    if (token[i].toLowerCase() !== 'e') continue;
    const before = token.slice(0, i), after = token.slice(i + 1);
    if (/(?:\d+\.?\d*|\.\d+)$/.test(before) && /^[+-]?\d/.test(after)) return true;
  }
  return false;
}
export function readable(item: Item) {
  for (const value of [item.label, item.detail, ...Object.keys(item.facets ?? {}), ...Object.values(item.facets ?? {}), item.value?.name, item.value?.role, item.value?.type]) if (value) expect(hasInternals(value)).toBe(false);
}
