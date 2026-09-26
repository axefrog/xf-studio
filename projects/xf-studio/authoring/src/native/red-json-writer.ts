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
 *
 * Writing fills in defaults, so a small file can ask for a large document: the values written and the nesting are counted against
 * the session's budget (limits.ts). A watched property the file left out (`rendChunk.renderMask`) is reported with its path, so a
 * consumer can tell "missing" from a stored zero although both are written the same way.
 */
import { DecodeSession } from "./limits";
import { defaultValue, learnedDefault, learnedKeys } from "./red-defaults";
import { RedBuffer, type RedDocument, RedHandle, RedObject } from "./red-model";
import { classProperties, propertyTypes } from "./rtti";

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

const isNested = (value: unknown) => value !== null && typeof value === "object";

class JsonWriter {
  private readonly ids = new Map<RedObject, number>();
  private nextHandle = 0;
  private nextBuffer = 0;
  /** Keys and indexes from the document root to the value being written, kept only when properties are watched. */
  private readonly path: (string | number)[] = [];
  private readonly tracking: boolean;
  /** Watched property names by class (`rendChunk` → `renderMask`). */
  private readonly watched = new Map<string, Set<string>>();
  constructor(private readonly options: JsonWriteOptions, private readonly session: DecodeSession) {
    this.tracking = session.watched.size > 0;
    for (const name of session.watched) {
      const dot = name.lastIndexOf(".");
      const set = this.watched.get(name.slice(0, dot)) ?? new Set<string>();
      set.add(name.slice(dot + 1));
      this.watched.set(name.slice(0, dot), set);
    }
  }

  at(key: string | number, write: () => unknown): unknown {
    if (!this.tracking) return write();
    this.path.push(key);
    try { return write(); } finally { this.path.pop(); }
  }

  /** `this.value(item)` under `key` (inline for the hot paths: no closure; a throw abandons the whole write, so no finally). */
  private nested(key: string | number, item: unknown): unknown {
    if (!this.tracking) return this.value(item);
    this.path.push(key);
    const out = this.value(item);
    this.path.pop();
    return out;
  }

  private pathText(): string {
    return this.path.map(part => typeof part === "number" ? `[${part}]` : `.${part}`).join("");
  }

  value(value: unknown): unknown {
    if (value instanceof RedObject) return this.object(value);
    if (value instanceof RedHandle) return this.handle(value);
    if (value instanceof RedBuffer) return this.buffer(value);
    if (Array.isArray(value)) {
      this.session.jsonNodes(value.length);
      this.session.enter();
      const out = new Array(value.length);
      for (let i = 0; i < value.length; i++) { const item = value[i]; out[i] = isNested(item) ? this.nested(i, item) : item; }
      this.session.leave();
      return out;
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value);
      this.session.jsonNodes(entries.length);
      const out: Record<string, unknown> = {};
      for (const [key, item] of entries) out[key] = isNested(item) ? this.nested(key, item) : item;
      return out;
    }
    return value;
  }

  object(object: RedObject): Record<string, unknown> {
    const props = this.options.omitDefaults ? null : classProperties(object.type);
    const types = this.options.omitDefaults ? null : propertyTypes(object.type);
    const keys = new Set(Object.keys(object.fields));
    for (const [name] of props ?? []) keys.add(name);
    if (!this.options.omitDefaults) for (const name of learnedKeys(object.type)) keys.add(name);
    this.session.jsonNodes(keys.size + 1);
    this.session.enter();
    const out: Record<string, unknown> = { $type: object.type };
    const watched = this.tracking ? this.watched.get(object.type) : undefined;
    for (const key of ordered([...keys])) {
      if (Object.hasOwn(object.fields, key)) {
        const item = object.fields[key];
        out[key] = isNested(item) ? this.nested(key, item) : item;
      } else {
        const learned = learnedDefault(object.type, key);
        const type = types?.get(key);
        out[key] = learned !== undefined ? structuredClone(learned) : type !== undefined ? this.nested(key, defaultValue(type)) : null;
        if (watched?.has(key)) this.session.defaulted(`${object.type}.${key}`, () => `${this.pathText()}.${key}`);
      }
    }
    this.session.leave();
    return out;
  }

  handle(handle: RedHandle): unknown {
    const target = handle.target;
    if (!target) return { HandleRefId: "-1" };
    const known = this.ids.get(target);
    if (known !== undefined) return { HandleRefId: String(known) };
    const id = this.nextHandle++;
    this.ids.set(target, id);
    return { HandleId: String(id), Data: this.at("Data", () => this.object(target)) };
  }

  buffer(buffer: RedBuffer): unknown {
    const head = buffer.shared ? {} : { BufferId: String(this.nextBuffer++), Flags: buffer.flags };
    const parsed = buffer.parsed;
    if (parsed?.kind === "package")
      return { ...head, Type: "RedPackage", Data: { Version: parsed.version, Sections: parsed.sections, CruidIndex: parsed.cruidIndex,
        CruidDict: parsed.cruidDict, Chunks: this.at("Data", () => this.at("Chunks", () => this.list(parsed.chunks, chunk => this.object(chunk)))) } };
    if (parsed?.kind === "cr2w-list")
      return { ...head, Type: "CR2WList", Data: { Files: this.at("Data", () => this.at("Files", () => this.list(parsed.files, file => this.file(file)))) } };
    return { ...head, Bytes: this.options.buffers === "trim" ? { $trimmedBase64Length: base64Length(buffer.memSize) } : Buffer.from(buffer.bytes()).toString("base64") };
  }

  private list<T>(items: readonly T[], write: (item: T) => unknown): unknown[] {
    this.session.jsonNodes(items.length);
    return items.map((item, i) => this.at(i, () => write(item)));
  }

  file(document: RedDocument): Record<string, unknown> {
    this.session.enter();
    const out = { Version: document.version, BuildVersion: document.buildVersion, RootChunk: this.at("RootChunk", () => this.object(document.root)),
      EmbeddedFiles: this.at("EmbeddedFiles", () => this.list(document.embedded, item => ({ FileName: { $type: "ResourcePath", $storage: item.path ? "string" : "uint64", $value: item.path || "0" },
        Content: this.at("Content", () => this.object(item.content)) }))) };
    this.session.leave();
    return out;
  }
}

/**
 * The JSON document of a decoded CR2W file. The session (normally the one that decoded it) budgets the writing and receives the
 * watched-default reports; paths start at `Data`.
 */
export function writeResourceJson(document: RedDocument, options: JsonWriteOptions, session = new DecodeSession()): { Header: Record<string, unknown>; Data: Record<string, unknown> } {
  const writer = new JsonWriter(options, session);
  const data = writer.at("Data", () => writer.file(document)) as Record<string, unknown>;
  return { Header: { ...options.header, WKitJsonVersion: "0.0.9", DataType: "CR2W" }, Data: data };
}
