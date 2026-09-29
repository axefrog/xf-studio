/**
 * Registration: node types, conflict rules, sources and sinks. A project brings its own types; the engine knows none.
 */
import type { Json } from "./json";
import { freeze, isJson } from "./json";
import { pathKey } from "./paths";
import type { Conflict, EventRef, FieldKind, FieldSpec, FixRoute, Issue, NodeRef, NodeState, NodeType, Path, Severity } from "./types";
import type { Clock, RandomStream } from "./sources";

/** A version step for a type's stored entries, applied on read; stored entries are never rewritten. */
export type Upcaster = {
  readonly from: string; readonly to: string;
  /** The entry's op (or, for `create`, `import` and `state` entries, its state) as the next schema has it. */
  readonly state?: (state: NodeState) => NodeState;
  readonly set?: (path: Path, value: Json) => { readonly path: Path; readonly value: Json } | null;
};

/** What a derivation may read. `derived` walks a `follows` edge; a circle of them surfaces as a cycle, not a loop. */
export interface DeriveContext {
  readonly node: NodeRef;
  resolve(ref: NodeRef, path?: Path): unknown;
  derived(ref: NodeRef, name: string): unknown;
  exists(ref: NodeRef): boolean;
}

export interface TypeSpec {
  readonly type: NodeType;
  /** The module that owns the type (`"platform"` for shared types). */
  readonly owner: string;
  /** The current schema of the type's entries, such as `"v1"`. */
  readonly schema: string;
  /** `delta` (default): entries change the state. `value`: each entry replaces the last. */
  readonly stream?: "delta" | "value";
  /** `persistent` (default): entries go to the store. `session`: kept in a bounded in-memory ring only. */
  readonly persistence?: "persistent" | "session";
  readonly fields: Readonly<Record<string, FieldSpec>>;
  /** The type's default effective value, by field (map fields as objects of keys). */
  defaults?(): Readonly<Record<string, unknown>>;
  /** Fresh own values for identity fields at every creation (a fork or clone gets its own). */
  identity?(context: { readonly random: RandomStream; readonly clock: Clock }): Readonly<Record<string, unknown>>;
  /** Findings on the effective value, after layering. */
  validate?(effective: Readonly<Record<string, unknown>>): readonly Issue[];
  /** Read-only nodes shipped with the type: `builtin:<type>/<name>`. */
  readonly constants?: readonly { readonly name: string; readonly label: string; readonly fields: Readonly<Record<string, unknown>> }[];
  readonly upcasters?: readonly Upcaster[];
  /** Other types whose nodes may be layer sources for this one (a registered compatible schema). */
  readonly compatible?: readonly NodeType[];
  /** Derived values, computed on demand for the time window asked for and memoised while in use. */
  readonly derive?: Readonly<Record<string, (context: DeriveContext) => unknown>>;
  /** Session streams: how many entries the ring keeps (default 1024). */
  readonly ring?: number;
}
export type TypeDef = TypeSpec & { readonly kind: "strata/type" };

const fieldError = (type: string, name: string, message: string) => new Error(`Type ${type}, field ${name}: ${message}`);

function checkKind(type: string, name: string, kind: FieldKind, depth: number): void {
  if (depth > 8) throw fieldError(type, name, "maps nest at most 8 deep");
  switch (kind.kind) {
    case "value": case "entry": return;
    case "ref": case "refs":
      if (kind.clone !== "follow" && kind.clone !== "share") throw fieldError(type, name, "clone must be follow or share");
      if (!(typeof kind.to === "string" || Array.isArray(kind.to) && kind.to.length)) throw fieldError(type, name, "name the target types");
      return;
    case "map": return checkKind(type, name, kind.of, depth + 1);
    default: throw fieldError(type, name, "unknown field kind");
  }
}

/** Declares a node type. */
export function defineType(spec: TypeSpec): TypeDef {
  if (!/^[a-z][\w:.-]*$/i.test(spec.type)) throw new Error(`Type name ${JSON.stringify(spec.type)} is not a plain identifier.`);
  if (!spec.owner || !spec.schema) throw new Error(`Type ${spec.type} needs an owner and a schema.`);
  for (const [name, field] of Object.entries(spec.fields)) {
    if (name.startsWith("$")) throw fieldError(spec.type, name, "field names may not start with $");
    checkKind(spec.type, name, field, 0);
  }
  const names = new Set<string>();
  for (const constant of spec.constants ?? []) {
    if (names.has(constant.name)) throw new Error(`Type ${spec.type} declares constant ${constant.name} twice.`);
    names.add(constant.name);
  }
  return Object.freeze({ ...spec, kind: "strata/type" as const });
}

/** The ID of a type's constant. */
export const constantId = (type: NodeType, name: string) => `builtin:${type}/${name}`;

// ---------------------------------------------------------------------------------------------------------------
// Field navigation
// ---------------------------------------------------------------------------------------------------------------

/** The field kind at the end of a path, or null when the path doesn't fit the type. `leaf` when the path is complete. */
export function kindAt(def: TypeSpec, path: Path): { kind: FieldKind; spec: FieldSpec; leaf: boolean } | null {
  if (!path.length) return null;
  const spec = def.fields[path[0]];
  if (!spec) return null;
  let kind: FieldKind = spec;
  for (let i = 1; i < path.length; i++) {
    if (kind.kind !== "map" || typeof path[i] !== "string" || !path[i]) return null;
    kind = kind.of;
  }
  return { kind, spec, leaf: kind.kind !== "map" };
}

/** How deep a field's leaves are: 1 for a plain field, one more per map level. */
export function leafDepth(spec: FieldKind): number {
  return spec.kind === "map" ? 1 + leafDepth(spec.of) : 1;
}

const isRef = (value: unknown): value is NodeRef => !!value && typeof value === "object" && !Array.isArray(value) &&
  typeof (value as NodeRef).type === "string" && typeof (value as NodeRef).id === "string" && Object.keys(value).length === 2;
const isEventRef = (value: unknown): value is EventRef => !!value && typeof value === "object" && isRef((value as EventRef).node) &&
  Number.isSafeInteger((value as EventRef).seq) && (value as EventRef).seq >= 1 && Object.keys(value).length === 2;
const accepts = (to: NodeType | readonly NodeType[], type: NodeType) => typeof to === "string" ? to === type : to.includes(type);

/** Why a value doesn't fit a leaf kind, or null when it does. `null` clears a `ref`; references name an accepted type. */
export function valueProblem(kind: FieldKind, value: unknown): string | null {
  switch (kind.kind) {
    case "value": return isJson(value) ? null : "a plain JSON value";
    case "entry": return value === null || isEventRef(value) ? null : "an entry reference ({ node, seq })";
    case "ref": return value === null || isRef(value) && accepts(kind.to, value.type) ? null : `a reference to ${[kind.to].flat().join(" or ")}`;
    case "refs": return Array.isArray(value) && value.every(item => isRef(item) && accepts(kind.to, item.type)) ? null
      : `a list of references to ${[kind.to].flat().join(" or ")}`;
    case "map": return "a keyed map (set one key at a time)";
  }
}

/** Own values from fields as a caller writes them (map fields as objects of keys), checked against the type. */
export function ownFromFields(def: TypeSpec, fields: Readonly<Record<string, unknown>>): Record<string, Json> {
  const own: Record<string, Json> = {};
  const walk = (path: string[], kind: FieldKind, value: unknown) => {
    if (value === undefined) return;
    if (kind.kind === "map") {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${pathKey(path)} must be an object of keys.`);
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) walk([...path, key], kind.of, item);
      return;
    }
    const problem = valueProblem(kind, value);
    if (problem) throw new Error(`${pathKey(path)} must be ${problem}.`);
    own[pathKey(path)] = freeze(value as Json);
  };
  for (const [name, value] of Object.entries(fields)) {
    const spec = def.fields[name];
    if (!spec) throw new Error(`Type ${def.type} has no field ${name}.`);
    walk([name], spec, value);
  }
  return own;
}

/** A type's default at a leaf path (navigating the defaults object), or undefined. */
export function defaultAt(defaults: Readonly<Record<string, unknown>> | undefined, path: Path): unknown {
  let value: unknown = defaults;
  for (const part of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

// ---------------------------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------------------------

/** What a rule may read. */
export interface RuleContext {
  resolve(ref: NodeRef, path?: Path): unknown;
  exists(ref: NodeRef): boolean;
  trashed(ref: NodeRef): boolean;
  /** The node's layers, or [] for a missing node. */
  layers(ref: NodeRef): readonly import("./types").Layer[];
  /** Every node referencing `ref` through a reference field, with the field. */
  referrers(ref: NodeRef): readonly { readonly node: NodeRef; readonly path: Path; readonly follows: boolean }[];
  /** Every reference the node holds (effective values of its ref, refs and map-of-ref fields). */
  references(ref: NodeRef): readonly { readonly path: Path; readonly target: NodeRef; readonly follows: boolean }[];
  /** A circle of `follows` references reachable from `ref`, as the edges on it, or null. */
  followCycle(ref: NodeRef): readonly { readonly from: NodeRef; readonly path: Path; readonly to: NodeRef }[] | null;
  /** The nodes of a type (live, not retracted). */
  nodes(type: NodeType): readonly NodeRef[];
  /** The type definition of a type, if registered. */
  typeOf(type: NodeType): TypeSpec | undefined;
}

/** A conflict as a rule reports it; the graph adds identity, severity and blocks. */
export type ConflictDraft = {
  readonly subjects?: readonly NodeRef[]; readonly sentence: string; readonly routes?: readonly FixRoute[];
  /** Distinguishes several conflicts of one rule on the same subjects. */
  readonly key?: string; readonly kind?: "conflict" | "disagreement";
};

export interface RuleSpec {
  readonly id: string; readonly owner: string;
  /** The subject types the rule evaluates, or `"*"` for every type. */
  readonly subject: NodeType | readonly NodeType[] | "*";
  readonly severity: Severity;
  /** Action kinds a blocking conflict refuses; `"*"` for every edit of the subjects. */
  readonly blocks?: readonly string[];
  /** `local` (default): re-evaluated for subjects a commit touched. `global`: re-evaluated after every commit. */
  readonly scope?: "local" | "global";
  evaluate(subject: NodeRef, context: RuleContext): readonly ConflictDraft[];
}
export type RuleDef = RuleSpec & { readonly kind: "strata/rule" };

/** Declares a conflict rule. Rules are pure functions of what they read. */
export function defineRule(spec: RuleSpec): RuleDef {
  if (!spec.id || !spec.owner) throw new Error("A rule needs an id and an owner.");
  return Object.freeze({ ...spec, kind: "strata/rule" as const });
}

export type { Conflict };
