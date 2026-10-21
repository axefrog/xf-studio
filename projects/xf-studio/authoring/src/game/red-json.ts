/**
 * Readers for WolvenKit CR2W JSON (`convert serialize`, WKitJsonVersion 0.0.9). Pure: callers pass
 * parsed JSON. Only the value shapes the character resolver needs are interpreted; anything else is
 * left as raw JSON. Evidence for the shapes: WolvenKit CLI 8.17.4 output for `.inkcharcustomization`,
 * `.app`, `.ent`, `.mesh`, `.morphtarget` and `.mi` resources of game 2.31 [resource].
 */
import { refFromHash, refFromPath, type DepotRef } from "./depot-path";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const isObject = (value: unknown): value is JsonObject =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const asArray = (value: unknown): Json[] => Array.isArray(value) ? value : [];

/** The resource root (`Data.RootChunk`) and header of a serialized CR2W file. */
export function cr2wRoot(document: unknown): { root: JsonObject; gameVersion: number | null; wolvenKit: string | null } {
  if (!isObject(document) || !isObject(document.Data) || !isObject(document.Data.RootChunk))
    throw Error("Not a WolvenKit CR2W JSON document.");
  const header = isObject(document.Header) ? document.Header : {};
  return { root: document.Data.RootChunk, gameVersion: typeof header.GameVersion === "number" ? header.GameVersion : null,
    wolvenKit: typeof header.WolvenKitVersion === "string" ? header.WolvenKitVersion : null };
}

/** CName value; `None` and empty names read as "". */
export function cname(value: unknown): string {
  if (typeof value === "string") return value === "None" ? "" : value;
  if (isObject(value) && typeof value.$value === "string") return value.$value === "None" ? "" : value.$value;
  return "";
}

/** A `ResourcePath`, `rRef`/`raRef` (`{DepotPath, Flags}`) or bare `{ $storage, $value }` value. */
export function depotRef(value: unknown): DepotRef | null {
  if (!isObject(value)) return null;
  const path = isObject(value.DepotPath) ? value.DepotPath : value;
  if (!isObject(path) || typeof path.$value !== "string") return null;
  if (path.$storage === "uint64") return path.$value === "0" ? null : refFromHash(path.$value);
  return path.$value ? refFromPath(path.$value) : null;
}

/** Raw path text of a reference, keeping ArchiveXL dynamic markers such as `*` and `{material}`. */
export function depotText(value: unknown): string | null {
  const path = isObject(value) && isObject(value.DepotPath) ? value.DepotPath : value;
  return isObject(path) && path.$storage === "string" && typeof path.$value === "string" && path.$value ? path.$value : null;
}

/**
 * WolvenKit writes a shared handle once (`{HandleId, Data}`) and later as `{HandleRefId}`. A handle
 * table is scoped to one object package, so an `.app` appearance's `compiledData` has its own table.
 */
export class HandleScope {
  private readonly table = new Map<string, JsonObject>();
  constructor(scopeRoot: Json) { this.collect(scopeRoot, true); }
  private collect(value: Json, top: boolean): void {
    if (Array.isArray(value)) { for (const item of value) this.collect(item, false); return; }
    if (!isObject(value)) return;
    // A nested object package starts its own handle numbering.
    if (!top && isObject(value.Data) && Array.isArray((value.Data as JsonObject).Chunks) && "BufferId" in value) return;
    if (typeof value.HandleId === "string" && isObject(value.Data)) this.table.set(value.HandleId, value.Data);
    for (const item of Object.values(value)) this.collect(item, false);
  }
  /** Dereference a handle wrapper to its data object. */
  data(value: unknown): JsonObject | null {
    if (!isObject(value)) return null;
    if (isObject(value.Data) && ("HandleId" in value)) return value.Data;
    if (typeof value.HandleRefId === "string") return this.table.get(value.HandleRefId) ?? null;
    return typeof value.$type === "string" ? value : null;
  }
}

/** Objects of an embedded object package (`compiledData`), dereferenced within the package's own scope. */
export function packageChunks(compiledData: unknown): JsonObject[] {
  if (!isObject(compiledData) || !isObject(compiledData.Data)) return [];
  const chunks = asArray(compiledData.Data.Chunks);
  const scope = new HandleScope(compiledData.Data);
  return chunks.map(chunk => scope.data(chunk)).filter((chunk): chunk is JsonObject => !!chunk);
}

export type MaterialParamValue =
  | { kind: "resource"; type: string; ref: DepotRef | null; text: string | null }
  | { kind: "name"; value: string }
  | { kind: "scalar"; type: string; value: Json };

/** `CMaterialInstance.values` → ordered `[name, value]` pairs (each entry has `$type` plus one param key). */
export function materialParams(values: unknown): [string, MaterialParamValue][] {
  const out: [string, MaterialParamValue][] = [];
  for (const entry of asArray(values)) {
    if (!isObject(entry)) continue;
    const type = typeof entry.$type === "string" ? entry.$type : "";
    for (const [name, value] of Object.entries(entry)) {
      if (name === "$type") continue;
      if (/^r(?:a)?Ref:/.test(type)) out.push([name, { kind: "resource", type, ref: depotRef(value), text: depotText(value) }]);
      else if (type === "CName") out.push([name, { kind: "name", value: cname(value) }]);
      else out.push([name, { kind: "scalar", type, value }]);
    }
  }
  return out;
}
