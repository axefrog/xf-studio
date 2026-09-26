/**
 * Leaf-by-leaf comparison of a native document with a reference (WolvenKit) document, for the differential harness and the
 * oracle test. Pure. Two known, harmless differences are classified rather than counted as errors:
 * - a hash-only `ResourcePath` where the reference shows path text (package references store hashes; the reference tool names
 *   them from its own path list), and
 * - a hash-only `TweakDBID` where the reference shows the record name, when the name hashes to the same id.
 * Buffer `Type` strings (the reference tool's .NET type names) are not compared; a reference `Bytes` string compares by its length.
 */
import { tweakDbId } from "../tweakdb-flats";

export interface DocumentMismatch { readonly path: string; readonly kind: string; readonly mine: string; readonly reference: string }

export const HASH_ONLY_PATH = "path text unavailable (hash-only reference)";
export const HASH_ONLY_TWEAKDB = "TweakDB name unavailable (hash-only TweakDBID, same id)";
export const isNameOnly = (mismatch: DocumentMismatch) => mismatch.kind === HASH_ONLY_PATH || mismatch.kind === HASH_ONLY_TWEAKDB;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => JSON.stringify(value)?.slice(0, 160) ?? "undefined";

export function compareDocuments(mine: unknown, reference: unknown, path = "", out: DocumentMismatch[] = [], owner = ""): DocumentMismatch[] {
  if (Array.isArray(mine) && Array.isArray(reference)) {
    if (mine.length !== reference.length) out.push({ path, kind: `${owner}: array length`, mine: String(mine.length), reference: String(reference.length) });
    for (let i = 0; i < Math.min(mine.length, reference.length); i++) compareDocuments(mine[i], reference[i], `${path}[${i}]`, out, owner);
    return out;
  }
  if (isObject(mine) && isObject(reference)) {
    const type = typeof reference.$type === "string" ? reference.$type : owner;
    if (reference.$type === "TweakDBID" && mine.$type === "TweakDBID" && mine.$storage === "uint64" && reference.$storage === "string") {
      const same = String(tweakDbId(String(reference.$value))) === String(BigInt(String(mine.$value)) & ((1n << 40n) - 1n));
      out.push({ path, kind: same ? HASH_ONLY_TWEAKDB : "TweakDBID: different id", mine: text(mine.$value), reference: text(reference.$value) });
      return out;
    }
    if (reference.$type === "ResourcePath" && mine.$type === "ResourcePath" && mine.$storage === "uint64" && reference.$storage === "string") {
      out.push({ path, kind: HASH_ONLY_PATH, mine: text(mine.$value), reference: text(reference.$value) });
      return out;
    }
    const normalised = typeof reference.Bytes === "string" ? { ...reference, Bytes: { $trimmedBase64Length: reference.Bytes.length } } : reference;
    for (const key of Object.keys(normalised)) if (!(key in mine) && key !== "Type") out.push({ path: `${path}.${key}`, kind: `${type}.${key}: missing`, mine: "", reference: text(normalised[key]) });
    for (const key of Object.keys(mine)) if (!(key in normalised) && key !== "Type") out.push({ path: `${path}.${key}`, kind: `${type}.${key}: extra`, mine: text(mine[key]), reference: "" });
    for (const key of Object.keys(mine)) if (key in normalised && key !== "Type") compareDocuments(mine[key], normalised[key], `${path}.${key}`, out, `${type}.${key}`);
    return out;
  }
  if (mine !== reference) out.push({ path, kind: `${owner}: value`, mine: text(mine), reference: text(reference) });
  return out;
}
