/**
 * Plain-data helpers: canonical serialisation, deep equality, deep freezing and a stable string hash.
 * Everything the engine stores or hands out is plain JSON data, so these are all it needs.
 */

/** A JSON value. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/**
 * Canonical JSON (SPEC §2.2): the JSON Canonicalization Scheme of RFC 8785. Member names are sorted by their UTF-16
 * code units (JavaScript's default string order), there is no whitespace, numbers take ECMAScript's shortest
 * round-trip form (which JSON.stringify gives, -0 as 0) and strings JSON.stringify's escapes. Members whose value is
 * undefined are not members. A number that isn't finite has no canonical form. Two values are equal exactly when
 * their canonical forms are.
 */
export function canonical(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError(`${value} has no canonical form: numbers must be finite.`);
  if (value === null || typeof value !== "object") return value === undefined ? "null" : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).filter(key => object[key] !== undefined).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
}

/** Deep structural equality of plain data (key order ignored; `undefined` members ignored). */
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], other[i])) return false;
    return true;
  }
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const xs = Object.keys(x).filter(key => x[key] !== undefined), ys = Object.keys(y).filter(key => y[key] !== undefined);
  if (xs.length !== ys.length) return false;
  for (const key of xs) if (!(key in y) || !equal(x[key], y[key])) return false;
  return true;
}

/** Freezes a plain value in place, deeply, and returns it. Frozen values can be handed out without copying. */
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) freeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** A deep, unfrozen copy of plain data. */
export function copy<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(copy) as T;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (item !== undefined) out[key] = copy(item);
  return out as T;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Whether a value is plain JSON data (finite numbers, well-formed strings, no functions, no cycles through the given depth). */
export function isJson(value: unknown, depth = 0): value is Json {
  if (depth > 64) return false;
  if (value === null || typeof value === "boolean") return true;
  // Strings are valid Unicode: no unpaired surrogates (I-JSON, which RFC 8785 requires).
  if (typeof value === "string") return !LONE_SURROGATE.test(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => isJson(item, depth + 1));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value as object).every(item => item === undefined || isJson(item, depth + 1));
  }
  return false;
}

/** A stable 53-bit string hash (cyrb53), as 14 hex digits. Not cryptographic; used for identities such as conflict IDs. */
export function hash(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, "0");
}
