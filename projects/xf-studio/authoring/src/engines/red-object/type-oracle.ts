/**
 * The type oracle (research/save/save-editor-design.md §8.1): one place that answers "what is this type?" and "what name has this
 * hash?" for the generic object layer, composed in priority order from
 *
 * 1. the save's own `TypeDatabase_v2` (type-database.ts): kinds, sizes and element types by name hash, for every script-system and
 *    persistency type the save holds, mod types included;
 * 2. the engine's type list the Studio ships (the RTTI subset: enum, bitfield and class names and class properties), for the
 *    native-system packages the save's database leaves out;
 * 3. names the user's installed scripts define (`final.redscripts`, script-bundle.ts) and names the save's own packages spell out:
 *    read-only labels for hashes, never kinds.
 *
 * It never guesses: an unanswered question is `undefined`, and the decoders keep that value opaque. Every answer says which source gave
 * it. Pure; the sources are data the caller hands in (the engine list comes from the composition, not from here).
 */
import { fnv1a64 } from "./hash";
import type { DatabaseType, TypeDatabase, TypeKindName } from "./type-database";

export type TypeSourceId = "save" | "engine" | "scripts" | "package";
/** A type's kind as the package reader needs it: an enum is a u16 name index, a bitfield a u8 count of them, a class a field table. */
export type NamedKind = "enum" | "bitfield" | "class";
/** The engine's type list: names by kind and class properties (base classes included), as data. */
export type EngineTypes = {
  readonly enums: Iterable<string>;
  readonly bitfields: Iterable<string>;
  readonly classes: Iterable<string>;
  /** Property names, for naming property hashes. */
  readonly properties: Iterable<string>;
};
export type NameAnswer = { readonly name: string; readonly source: TypeSourceId };
export type KindAnswer = { readonly kind: NamedKind; readonly source: TypeSourceId };
export type TypeAnswer = DatabaseType & { readonly name?: string; readonly source: "save" };

export type TypeOracle = {
  /** What a type named in a package is, or undefined (the reader then keeps a value of it opaque). */
  kindOf(name: string): KindAnswer | undefined;
  /** Shorthand for the package reader: whether a named type's values are enum members. */
  isEnum(name: string): boolean;
  isBitfield(name: string): boolean;
  /** A persisted type by its name hash, from the save's database. */
  type(hash: bigint): TypeAnswer | undefined;
  /** A name for a hash (a type, class or property name), where some source defines it. */
  name(hash: bigint): NameAnswer | undefined;
  /** How many names each source contributed (for the explorer's evidence line). */
  readonly stats: Readonly<Record<TypeSourceId, number>> & { readonly typesNamed: number; readonly types: number; readonly propertiesNamed: number; readonly properties: number };
};

/**
 * Engine fundamentals and common wrappers, as names to try for hashes (they are types, not in the RTTI class and enum lists). Their
 * spellings are the RTTI's.
 */
const FUNDAMENTALS = ["Bool", "Int8", "Uint8", "Int16", "Uint16", "Int32", "Uint32", "Int64", "Uint64", "Float", "Double", "String", "CName",
  "TweakDBID", "CRUID", "NodeRef", "LocalizationString", "CGUID", "CDateTime", "EditorObjectID", "DataBuffer", "serializationDeferredDataBuffer",
  "SharedDataBuffer", "Variant", "CVariant", "ResourcePath", "gamedataLocKeyWrapper", "MessageResourcePath", "redResourceReferenceScriptToken",
  "Vector2", "Vector3", "Vector4", "Quaternion", "EulerAngles", "Transform", "WorldTransform", "WorldPosition", "Matrix", "Color", "HDRColor",
  "Box", "entEntityID", "gameItemID", "gamePersistentID", "gameStatModifierData_Deprecated"];

export function createTypeOracle(sources: {
  database?: TypeDatabase | null;
  engine?: EngineTypes | null;
  /** Extra candidate names: installed scripts' names, and names read from the save's own packages. */
  names?: readonly { readonly source: "scripts" | "package"; readonly names: Iterable<string> }[];
}): TypeOracle {
  const database = sources.database ?? null;
  const names = new Map<bigint, NameAnswer>();
  const stats = { save: 0, engine: 0, scripts: 0, package: 0 };
  const add = (name: string, source: TypeSourceId) => {
    if (!name || name.length > 512) return;
    const hash = fnv1a64(name);
    if (!names.has(hash)) { names.set(hash, { name, source }); stats[source]++; }
  };
  const engineKinds = new Map<string, NamedKind>();
  if (sources.engine) {
    for (const name of sources.engine.enums) { engineKinds.set(name, "enum"); add(name, "engine"); }
    for (const name of sources.engine.bitfields) { engineKinds.set(name, "bitfield"); add(name, "engine"); }
    for (const name of sources.engine.classes) { if (!engineKinds.has(name)) engineKinds.set(name, "class"); add(name, "engine"); }
    for (const name of sources.engine.properties) add(name, "engine");
  }
  for (const name of FUNDAMENTALS) add(name, "engine");
  // A script field is spelled `m_name` in the bundle and persisted as `name` [offline: 92 % of a save's property hashes resolve so].
  for (const set of sources.names ?? []) for (const name of set.names) {
    add(name, set.source);
    if (set.source === "scripts" && name.startsWith("m_") && name.length > 2) add(name.slice(2), set.source);
  }

  // Container types are named from their element: `array:X`, `handle:X`, `whandle:X`, and static or native arrays `[N]X`.
  const typeNames = new Map<bigint, string>();
  if (database) {
    const nameOfType = (type: DatabaseType, depth: number): string | undefined => {
      const known = typeNames.get(type.hash) ?? names.get(type.hash)?.name;
      if (known !== undefined || depth > 8 || type.inner === 0n) return known;
      const inner = database.type(type.inner);
      const innerName = inner ? nameOfType(inner, depth + 1) : names.get(type.inner)?.name;
      if (innerName === undefined) return undefined;
      const candidates = type.kind === "array" ? [`array:${innerName}`]
        : type.kind === "handle" ? [`handle:${innerName}`, `whandle:${innerName}`]
          : [`[${type.count}]${innerName}`, `static:${type.count},${innerName}`, `native:${innerName}`, `array:${innerName}`,
            `handle:${innerName}`, `whandle:${innerName}`];
      const found = candidates.find(candidate => fnv1a64(candidate) === type.hash);
      if (found !== undefined) typeNames.set(type.hash, found);
      return found;
    };
    for (const type of database.types) nameOfType(type, 0);
  }
  const typeName = (hash: bigint) => typeNames.get(hash) ?? names.get(hash)?.name;

  const kindOf = (name: string): KindAnswer | undefined => {
    const saved = database?.type(fnv1a64(name));
    if (saved) {
      if (saved.kind === "enum") return { kind: "enum", source: "save" };
      if (saved.kind === "class") return { kind: "class", source: "save" };
    }
    const engine = engineKinds.get(name);
    if (engine) return { kind: engine, source: "engine" };
    return undefined;
  };
  let typesNamed = 0, propertiesNamed = 0;
  if (database) {
    for (const type of database.types) if (typeName(type.hash) !== undefined) typesNamed++;
    for (const property of database.properties) if (names.has(property.hash)) propertiesNamed++;
  }
  return {
    kindOf,
    isEnum: name => kindOf(name)?.kind === "enum",
    isBitfield: name => kindOf(name)?.kind === "bitfield",
    type: hash => {
      const found = database?.type(hash);
      if (!found) return undefined;
      const name = typeName(hash);
      return { ...found, ...(name !== undefined ? { name } : {}), source: "save" };
    },
    name: hash => {
      const derived = typeNames.get(hash);
      return derived !== undefined ? { name: derived, source: "save" } : names.get(hash);
    },
    stats: { ...stats, typesNamed, types: database?.types.length ?? 0, propertiesNamed, properties: database?.properties.length ?? 0 },
  };
}

/** The oracle's kind names for a database type, for display. */
export const kindLabel = (kind: TypeKindName) => kind.replace("-", " ");
