/**
 * A resource's bytes to the JSON document the resolver reads. Pure apart from the injected decompressor.
 *
 * Besides the file's own properties, the resolver's JSON carries a few derived ones, which this adds [resource: WolvenKit 9.0.1
 * output; knowledge/archive-format.md §6.4]:
 * - `CMaterialInstance.values` (the parameter list stored after the properties) and `metadata` (null);
 * - `meshMeshMaterialBuffer.materials`: the root objects of the local material files in `rawData`;
 * - `entEntityTemplate.entity` (a handle to the package's entity) and `components` (its other roots), null without a package;
 * - `appearanceAppearanceDefinition.components`: the package's roots.
 *
 * `readResource` also returns what the JSON cannot say: notes (a property stored with a type the RTTI disagrees with) and where a
 * watched property was left out and written as its default. One `DecodeSession` budgets decoding, deriving and writing.
 */
import { readCr2w } from "./cr2w-reader";
import type { Decompress } from "./kark";
import { type DefaultedProperty, DecodeSession, type NativeLimits, type NativeNote, type NativeUsage } from "./limits";
import { type JsonWriteOptions, writeResourceJson } from "./red-json-writer";
import { RedBuffer, type RedDocument, RedHandle, RedObject } from "./red-model";

/**
 * Version of the native reader's output rules. Part of the reader identity in cache keys: bump it whenever decoding or JSON
 * writing changes what a resource's document holds. 2: hardened decoding (budgets, strict packages, typed refusals); documents of
 * well-formed resources are unchanged. 3: an array record is read to its end past a short count (a hair replacer pack's
 * `renderLODs`, as WolvenKit shows it; noted), and the defaults were learned again on 2,448 resources.
 */
export const NATIVE_READER_VERSION = 3;

function derive(object: RedObject, seen: Set<RedObject>, session: DecodeSession): void {
  if (seen.has(object)) return;
  seen.add(object);
  session.enter();
  const fields = object.fields;
  for (const value of Object.values(fields)) visit(value, seen, session);
  const packageOf = (value: unknown) => value instanceof RedBuffer && value.parsed?.kind === "package" ? value.parsed : null;
  switch (object.type) {
    case "CMaterialInstance":
      fields.values ??= [];
      fields.metadata ??= null;
      break;
    case "meshMeshMaterialBuffer": {
      const list = fields.rawData instanceof RedBuffer && fields.rawData.parsed?.kind === "cr2w-list" ? fields.rawData.parsed.files : [];
      fields.materials ??= list.map(file => file.root);
      break;
    }
    case "entEntityTemplate": {
      const parsed = packageOf(fields.compiledData);
      if (!parsed) { fields.entity ??= null; fields.components ??= null; break; }
      const entity = parsed.cruidIndex >= 0 ? parsed.chunks[parsed.cruidIndex] ?? null : null;
      fields.entity ??= entity ? new RedHandle(entity) : null;
      fields.components ??= parsed.chunks.filter(chunk => chunk !== entity);
      break;
    }
    case "appearanceAppearanceDefinition": {
      const parsed = packageOf(fields.compiledData);
      fields.components ??= parsed ? [...parsed.chunks] : null;
      break;
    }
  }
  session.leave();
}

function visit(value: unknown, seen: Set<RedObject>, session: DecodeSession): void {
  if (value instanceof RedObject) derive(value, seen, session);
  else if (value instanceof RedHandle) { if (value.target) derive(value.target, seen, session); }
  else if (value instanceof RedBuffer) {
    if (value.parsed?.kind === "package") for (const chunk of value.parsed.chunks) derive(chunk, seen, session);
    if (value.parsed?.kind === "cr2w-list") for (const file of value.parsed.files) deriveDocument(file, seen, session);
  } else if (Array.isArray(value)) { for (const item of value) if (item !== null && typeof item === "object") visit(item, seen, session); }
  else if (value && typeof value === "object") for (const item of Object.values(value)) if (item !== null && typeof item === "object") visit(item, seen, session);
}

function deriveDocument(document: RedDocument, seen: Set<RedObject>, session: DecodeSession): void {
  derive(document.root, seen, session);
  for (const item of document.embedded) derive(item.content, seen, session);
}

/** Decode a CR2W resource and add the derived properties. */
export function readResourceModel(bytes: Uint8Array, decompress: Decompress, session = new DecodeSession()): RedDocument {
  const document = readCr2w(bytes, decompress, session);
  deriveDocument(document, new Set(), session);
  return document;
}

/** The resolver-shaped JSON document of a CR2W resource. */
export function readResourceJson(bytes: Uint8Array, decompress: Decompress, options: JsonWriteOptions = { buffers: "trim" }, session = new DecodeSession()) {
  return writeResourceJson(readResourceModel(bytes, decompress, session), options, session);
}

/** A decoded resource: its document and what the document cannot say. */
export interface NativeResource {
  readonly document: { Header: Record<string, unknown>; Data: Record<string, unknown> };
  /** Findings about the stored data (type mismatches), deduplicated and bounded. */
  readonly notes: readonly NativeNote[];
  /** Watched properties the file left out (written as their defaults), with their paths from `Data`. */
  readonly defaulted: readonly DefaultedProperty[];
  /** High-water marks against the budgets. */
  readonly usage: NativeUsage;
}

/** Decode a resource within `limits` and return its document with notes, defaulted-property reports and budget usage. */
export function readResource(bytes: Uint8Array, decompress: Decompress, options: JsonWriteOptions = { buffers: "trim" }, limits?: NativeLimits): NativeResource {
  const session = new DecodeSession(limits);
  const document = readResourceJson(bytes, decompress, options, session);
  return { document, notes: session.notes, defaulted: session.defaultedProperties, usage: session.usage };
}
