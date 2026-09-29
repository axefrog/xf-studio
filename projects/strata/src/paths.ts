/** Paths, path keys, the tombstone marker and path masks. */
import type { Json } from "./json";
import { equal } from "./json";
import type { Path } from "./types";

/** An own value's key: the path as a JSON array string. */
export const pathKey = (path: Path): string => JSON.stringify(path);
export const keyPath = (key: string): Path => JSON.parse(key) as Path;

/** The stored marker for "absent here" at a map key. */
export const TOMBSTONE: Json = Object.freeze({ $strata: "tombstone" });
export const isTombstone = (value: unknown): boolean => equal(value, TOMBSTONE);

/** Whether `prefix` is a prefix of (or equal to) `path`. */
export function startsWith(path: Path, prefix: Path): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== path[i]) return false;
  return true;
}

/** Whether a layer's path mask covers `path`: `"*"`, or one of its paths is a prefix of it. */
export function covers(mask: "*" | readonly Path[], path: Path): boolean {
  return mask === "*" || mask.some(prefix => startsWith(path, prefix));
}

export const samePath = (a: Path, b: Path) => a.length === b.length && startsWith(a, b);
