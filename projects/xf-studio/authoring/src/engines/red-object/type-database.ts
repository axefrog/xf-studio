/**
 * The save's own schema, `TypeDatabase_v2` (knowledge/save-files.md §3; research/save/save-editor-design.md §5.2). Pure and bounded.
 * No other tool we know decodes it; the layout is measured on private 2.31 saves [offline]:
 *
 * - Header, 32 bytes: u32 node ID, u32 body size, u32 3 (a version [hypothesis]), u64 [unknown], u32 type count *T*, u32 count *B* of an
 *   unknown section, u32 property count *P*. The node is exactly 32 + 20*T* + 8*B* + 12*P* bytes.
 * - Types, 20 bytes each, sorted by hash: u64 FNV-1a 64 of the type name, u64 hash of the element or pointee type (`array:X`,
 *   `handle:X`) or 0, u16 flags (bits 4–7 the RTTI type kind, bits 12–15 the byte size of fixed-size values), u16 count.
 * - *B* × 8 bytes, unknown (kept, not read).
 * - Properties, 12 bytes each: u64 FNV-1a 64 of the property name, u32 whose low 16 bits index the type table.
 *
 * It lists the script-system and persistency classes (mod classes included) and their enums; it does not list the native-system package
 * classes. Hashes are identity here; names come from a type oracle's candidate names (type-oracle.ts).
 */

/** The RTTI type kinds as the flags' bits 4–7 give them [offline]. */
export const TYPE_KINDS = ["name", "fundamental", "class", "array", "simple", "enum", "static-array", "native-array", "unknown-8", "handle",
  "unknown-10", "unknown-11", "unknown-12", "unknown-13", "unknown-14", "unknown-15"] as const;
export type TypeKindName = typeof TYPE_KINDS[number];

export type DatabaseType = {
  readonly hash: bigint;
  /** The element or pointee type's hash, or 0n. */
  readonly inner: bigint;
  readonly flags: number;
  readonly kind: TypeKindName;
  /** The byte size of a fixed-size value (flags bits 12–15), or 0. */
  readonly size: number;
  readonly count: number;
};
export type DatabaseProperty = { readonly hash: bigint; readonly type: number; readonly high: number };
export type TypeDatabase = {
  readonly version: number;
  readonly types: readonly DatabaseType[];
  readonly properties: readonly DatabaseProperty[];
  readonly unknownCount: number;
  /** A type by its name hash. */
  type(hash: bigint): DatabaseType | undefined;
  /** A property's type (by property row). */
  propertyType(property: DatabaseProperty): DatabaseType | undefined;
};

export class TypeDatabaseError extends Error { override name = "TypeDatabaseError"; }

const MAX_ROWS = 1_000_000;

/** Read a `TypeDatabase_v2` node's data (its u32 ID included). */
export function readTypeDatabase(data: Uint8Array): TypeDatabase {
  if (data.length < 32) throw new TypeDatabaseError("The type database is truncated.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint32(8, true);
  const typeCount = view.getUint32(20, true), unknownCount = view.getUint32(24, true), propertyCount = view.getUint32(28, true);
  if (typeCount > MAX_ROWS || unknownCount > MAX_ROWS || propertyCount > MAX_ROWS) throw new TypeDatabaseError("The type database is larger than any save's.");
  if (32 + typeCount * 20 + unknownCount * 8 + propertyCount * 12 !== data.length)
    throw new TypeDatabaseError("The type database's tables don't add up to its size (an unknown layout).");
  const types: DatabaseType[] = [];
  for (let i = 0, at = 32; i < typeCount; i++, at += 20) {
    const flags = view.getUint16(at + 16, true);
    types.push({ hash: view.getBigUint64(at, true), inner: view.getBigUint64(at + 8, true), flags, kind: TYPE_KINDS[(flags >> 4) & 15]!,
      size: (flags >> 12) & 15, count: view.getUint16(at + 18, true) });
  }
  const properties: DatabaseProperty[] = [];
  for (let i = 0, at = 32 + typeCount * 20 + unknownCount * 8; i < propertyCount; i++, at += 12) {
    const packed = view.getUint32(at + 8, true);
    properties.push({ hash: view.getBigUint64(at, true), type: packed & 0xffff, high: packed >>> 16 });
  }
  const byHash = new Map(types.map(type => [type.hash, type]));
  return { version, types, properties, unknownCount, type: hash => byHash.get(hash), propertyType: property => types[property.type] };
}
