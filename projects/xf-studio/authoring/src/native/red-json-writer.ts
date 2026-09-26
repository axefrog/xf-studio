/**
 * Writes the red model as the JSON document shape the resolver reads (the shape of WolvenKit's `convert serialize`, WKitJsonVersion
 * 0.0.9, as far as the resolver's readers depend on it). Pure. Conventions and their evidence: knowledge/archive-format.md §6.
 *
 * - A class object: `$type` first, then every property of the class in English collation order (`Intl.Collator("en")`), the ones
 *   the file left out filled with their defaults (red-defaults.ts) when the class is in the RTTI slice.
 * - Handles: `{HandleId, Data}` where an object is first written (depth-first, in key order), `{HandleRefId}` after. The root, a
 *   package's roots and a local material list's roots are written plainly and take no id.
 * - Buffers: `{BufferId, Flags, Bytes}`, numbered in write order; parsed ones carry `Type` and `Data` instead of `Bytes`. With
 *   `buffers: "trim"` the bytes are left out as `{$trimmedBase64Length}`, as the resolver's cache stores them.
 */
import { defaultValue, learnedDefault, learnedKeys } from "./red-defaults";
import { RedBuffer, type RedDocument, RedHandle, RedObject } from "./red-model";
import { classProperties } from "./rtti";

export interface JsonWriteOptions {
  /** "trim": buffers as `{$trimmedBase64Length}` (no decompression); "base64": their decompressed bytes. */
  readonly buffers: "trim" | "base64";
  /** Header fields to write (the reader's identity). */
  readonly header?: Record<string, unknown>;
  /** Leave out properties the file did not write (no defaults): for measuring what defaults contribute. */
  readonly omitDefaults?: boolean;
}

const collator = new Intl.Collator("en");
const orderMemo = new Map<string, string[]>();
/** Keys in the reference JSON's order (English collation), memoised per key set. */
function ordered(keys: string[]): string[] {
  const id = keys.join("\u0000");
  let order = orderMemo.get(id);
  if (!order) { order = [...keys].sort(collator.compare); if (orderMemo.size < 20_000) orderMemo.set(id, order); }
  return order;
}

/** `4·ceil(n/3)`: the length of `n` bytes in base64. */
export const base64Length = (bytes: number) => 4 * Math.ceil(bytes / 3);

class JsonWriter {
  private readonly ids = new Map<RedObject, number>();
  private nextHandle = 0;
  private nextBuffer = 0;
  constructor(private readonly options: JsonWriteOptions) {}

  value(value: unknown): unknown {
    if (value instanceof RedObject) return this.object(value);
    if (value instanceof RedHandle) return this.handle(value);
    if (value instanceof RedBuffer) return this.buffer(value);
    if (Array.isArray(value)) return value.map(item => this.value(item));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) out[key] = this.value(item);
      return out;
    }
    return value;
  }

  object(object: RedObject): Record<string, unknown> {
    const props = this.options.omitDefaults ? null : classProperties(object.type);
    const types = new Map(props ?? []);
    const keys = new Set(Object.keys(object.fields));
    for (const [name] of props ?? []) keys.add(name);
    if (!this.options.omitDefaults) for (const name of learnedKeys(object.type)) keys.add(name);
    const out: Record<string, unknown> = { $type: object.type };
    for (const key of ordered([...keys])) {
      if (Object.hasOwn(object.fields, key)) out[key] = this.value(object.fields[key]);
      else {
        const learned = learnedDefault(object.type, key);
        out[key] = learned !== undefined ? structuredClone(learned) : types.has(key) ? this.value(defaultValue(types.get(key)!)) : null;
      }
    }
    return out;
  }

  handle(handle: RedHandle): unknown {
    const target = handle.target;
    if (!target) return { HandleRefId: "-1" };
    const known = this.ids.get(target);
    if (known !== undefined) return { HandleRefId: String(known) };
    const id = this.nextHandle++;
    this.ids.set(target, id);
    return { HandleId: String(id), Data: this.object(target) };
  }

  buffer(buffer: RedBuffer): unknown {
    const head = buffer.shared ? {} : { BufferId: String(this.nextBuffer++), Flags: buffer.flags };
    const parsed = buffer.parsed;
    if (parsed?.kind === "package")
      return { ...head, Type: "RedPackage", Data: { Version: parsed.version, Sections: parsed.sections, CruidIndex: parsed.cruidIndex,
        CruidDict: parsed.cruidDict, Chunks: parsed.chunks.map(chunk => this.object(chunk)) } };
    if (parsed?.kind === "cr2w-list")
      return { ...head, Type: "CR2WList", Data: { Files: parsed.files.map(file => this.file(file)) } };
    return { ...head, Bytes: this.options.buffers === "trim" ? { $trimmedBase64Length: base64Length(buffer.memSize) } : Buffer.from(buffer.bytes()).toString("base64") };
  }

  file(document: RedDocument): Record<string, unknown> {
    return { Version: document.version, BuildVersion: document.buildVersion, RootChunk: this.object(document.root),
      EmbeddedFiles: document.embedded.map(item => ({ FileName: { $type: "ResourcePath", $storage: item.path ? "string" : "uint64", $value: item.path || "0" },
        Content: this.object(item.content) })) };
  }
}

/** The JSON document of a decoded CR2W file. */
export function writeResourceJson(document: RedDocument, options: JsonWriteOptions): { Header: Record<string, unknown>; Data: Record<string, unknown> } {
  return { Header: { ...options.header, WKitJsonVersion: "0.0.9", DataType: "CR2W" }, Data: new JsonWriter(options).file(document) };
}
