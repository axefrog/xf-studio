/**
 * A resource's bytes to the JSON document the resolver reads. Pure apart from the injected decompressor.
 *
 * Besides the file's own properties, the resolver's JSON carries a few derived ones, which this adds [resource: WolvenKit 9.0.1
 * output; knowledge/archive-format.md §6.4]:
 * - `CMaterialInstance.values` (the parameter list stored after the properties) and `metadata` (null);
 * - `meshMeshMaterialBuffer.materials`: the root objects of the local material files in `rawData`;
 * - `entEntityTemplate.entity` (a handle to the package's entity) and `components` (its other roots), null without a package;
 * - `appearanceAppearanceDefinition.components`: the package's roots.
 */
import { readCr2w } from "./cr2w-reader";
import type { Decompress } from "./kark";
import { type JsonWriteOptions, writeResourceJson } from "./red-json-writer";
import { RedBuffer, type RedDocument, RedHandle, RedObject } from "./red-model";

/**
 * Version of the native reader's output rules. Part of the reader identity in cache keys: bump it whenever decoding or JSON
 * writing changes what a resource's document holds.
 */
export const NATIVE_READER_VERSION = 1;

function derive(object: RedObject, seen: Set<RedObject>): void {
  if (seen.has(object)) return;
  seen.add(object);
  const fields = object.fields;
  for (const value of Object.values(fields)) visit(value, seen);
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
}

function visit(value: unknown, seen: Set<RedObject>): void {
  if (value instanceof RedObject) derive(value, seen);
  else if (value instanceof RedHandle) { if (value.target) derive(value.target, seen); }
  else if (value instanceof RedBuffer) {
    if (value.parsed?.kind === "package") for (const chunk of value.parsed.chunks) derive(chunk, seen);
    if (value.parsed?.kind === "cr2w-list") for (const file of value.parsed.files) deriveDocument(file, seen);
  } else if (Array.isArray(value)) for (const item of value) visit(item, seen);
  else if (value && typeof value === "object") for (const item of Object.values(value)) visit(item, seen);
}

function deriveDocument(document: RedDocument, seen: Set<RedObject>): void {
  derive(document.root, seen);
  for (const item of document.embedded) derive(item.content, seen);
}

/** Decode a CR2W resource and add the derived properties. */
export function readResourceModel(bytes: Uint8Array, decompress: Decompress): RedDocument {
  const document = readCr2w(bytes, decompress);
  deriveDocument(document, new Set());
  return document;
}

/** The resolver-shaped JSON document of a CR2W resource. */
export function readResourceJson(bytes: Uint8Array, decompress: Decompress, options: JsonWriteOptions = { buffers: "trim" }) {
  return writeResourceJson(readResourceModel(bytes, decompress), options);
}
