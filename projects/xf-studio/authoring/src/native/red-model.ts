/**
 * The decoded form of a resource before it is written as JSON. Pure. The CR2W and package readers build it; red-json-writer.ts
 * turns it into the JSON shape the resolver reads. Values that need the writer's attention are class instances below; every other
 * value is already final JSON (numbers, strings, CName and reference objects, arrays and `{Elements}` wrappers of values).
 */

/** An instance of a class or struct: its type and the properties the file wrote (in file order). */
export class RedObject {
  constructor(readonly type: string, readonly fields: Record<string, unknown> = {}) {}
}

/** A handle to an object (null: the null handle). */
export class RedHandle {
  constructor(readonly target: RedObject | null) {}
}

/** What a buffer decodes to, when its owner is one the readers parse. */
export type ParsedBuffer =
  | { kind: "package"; version: number; sections: number; cruidIndex: number; cruidDict: Record<string, string>; chunks: RedObject[] }
  | { kind: "cr2w-list"; files: RedDocument[] };

/** A data buffer: its flags from the buffer table, its size in memory, and its bytes or parsed content. */
export class RedBuffer {
  constructor(readonly flags: number, readonly memSize: number, readonly bytes: () => Uint8Array, readonly parsed: ParsedBuffer | null = null,
    /** SharedDataBuffer values carry no buffer id. */
    readonly shared = false) {}
}

/** A decoded CR2W file. */
export interface RedDocument {
  readonly version: number;
  readonly buildVersion: number;
  readonly root: RedObject;
  readonly embedded: readonly { path: string; content: RedObject }[];
}

/** A resource or value the native reader does not decode (the caller falls back to another reader). */
export class NativeUnsupportedError extends Error {}
