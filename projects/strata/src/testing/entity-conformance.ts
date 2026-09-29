/**
 * The entity-vector runner (SPEC §22.3): types declared as data, a script of commits, undo, redo, compaction, purge,
 * time and stored entries, and the expected effective values, refusals, streams, origins and change reports. Nodes are
 * named by labels: `as` on a create edit names the new node, and `{ "$label": name }` anywhere in a script stands for it.
 */
import { canonical, equal } from "../json";
import type { Json } from "../json";
import { defineType } from "../define";
import type { TypeDef, TypeSpec, Upcaster } from "../define";
import { Aborter } from "../kernel/abort";
import { createGraph } from "../graph";
import { MemoryStore } from "../store";
import { pathKey } from "../paths";
import type { ChangeSet, Edit, Entry, EventRef, NodeRef, Path } from "../types";
import { seededRandom } from "../random";
import { Scheduler, settle, simClock } from "./sim-sources";

type TypeData = Omit<TypeSpec, "defaults" | "upcasters" | "identity" | "validate" | "derive"> & {
  readonly defaults?: Readonly<Record<string, unknown>>;
  readonly upcasters?: readonly { readonly from: string; readonly to: string; readonly rename: readonly (readonly [Path, Path])[] }[];
};
export type EntityStep =
  | { readonly commit: readonly Json[]; readonly options?: Json }
  | { readonly undo: string } | { readonly redo: string }
  | { readonly compact: string; readonly bucket?: number; readonly roots?: readonly Json[] }
  | { readonly purge: string; readonly force?: boolean }
  | { readonly collapse: string }
  | { readonly advance: number }
  | { readonly forget: string }
  | { readonly reload: true }
  | { readonly entries: readonly Json[] };
export type EntityVector = {
  readonly name: string; readonly kind: "entity"; readonly rules?: readonly string[]; readonly description?: string;
  readonly seed?: string; readonly types: readonly TypeData[]; readonly script: readonly EntityStep[];
  readonly expect: {
    readonly effective?: Readonly<Record<string, Json | null>>;
    readonly refusals?: readonly (string | null)[];
    readonly streams?: Readonly<Record<string, readonly (readonly [number, string])[]>>;
    readonly origins?: Readonly<Record<string, Readonly<Record<string, string>>>>;
    readonly changes?: readonly (readonly string[])[];
    /** Per node, its entries' `[seq, actor, actorSeq]` (SPEC §17.1, §17.2). */
    readonly actors?: Readonly<Record<string, readonly (readonly [number, string, number])[]>>;
  };
};

const renamePath = (path: Path, from: Path, to: Path): Path =>
  from.every((part, i) => path[i] === part) ? [...to, ...path.slice(from.length)] : path;

/** A type from its data form: defaults as data, upcasters as declarative renames. */
export function typeFromData(data: TypeData): TypeDef {
  const upcasters: Upcaster[] = (data.upcasters ?? []).map(step => ({
    from: step.from, to: step.to,
    set: (path, value) => ({ path: step.rename.reduce((at, [from, to]) => renamePath(at, from, to), path), value }),
    state: state => ({ ...state, own: Object.fromEntries(Object.entries(state.own).map(([key, value]) =>
      [pathKey(step.rename.reduce((at, [from, to]) => renamePath(at, from, to), JSON.parse(key) as Path)), value])) }),
  }));
  const { defaults, upcasters: _data, ...rest } = data;
  return defineType({ ...rest, ...(defaults ? { defaults: () => defaults } : {}), ...(upcasters.length ? { upcasters } : {}) });
}

/** Runs one entity vector; returns its problems (empty when it passes). */
export async function runEntityVector(vector: EntityVector): Promise<string[]> {
  const scheduler = new Scheduler(), memory = new MemoryStore(), life = new Aborter();
  const types = vector.types.map(typeFromData);
  const labels = new Map<string, NodeRef>();
  const names = new Map<string, string>();
  const resolveLabels = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolveLabels);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && typeof record.$label === "string") {
      const ref = labels.get(record.$label);
      if (!ref) throw new Error(`${vector.name}: no node is labelled ${record.$label}`);
      return ref;
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, resolveLabels(item)]));
  };
  // Stored entries come before the graph loads.
  let at = 0;
  for (const step of vector.script) {
    if (!("entries" in step)) break;
    for (const raw of step.entries) {
      const entry = raw as unknown as Entry & { label?: string };
      if (entry.label) { labels.set(entry.label, entry.node); names.set(entry.node.id, entry.label); }
      const { label: _label, ...stored } = entry;
      memory.appendNow({ commit: stored.commit, entries: [stored], expect: [[stored.node.id, stored.seq - 1]] });
    }
    at++;
  }
  let session = new Aborter(life.signal), sessions = 0;
  const open = async () => {
    const opened = createGraph({ types, store: memory, signal: session.signal,
      sources: { clock: simClock(scheduler), random: seededRandom(`${vector.seed ?? vector.name}${sessions ? `:${sessions}` : ""}`) } });
    await opened.load();
    opened.subscribeAll(set => sets.push(set), { signal: session.signal });
    return opened;
  };
  const sets: ChangeSet[] = [];
  let graph = await open();
  const refusals: (string | null)[] = [];
  const changes: string[][] = [];
  for (const step of vector.script.slice(at)) {
    sets.length = 0;
    let result: { ok: boolean; reason?: string } | undefined;
    if ("commit" in step) {
      const edits = resolveLabels(step.commit) as Edit[];
      const committed = graph.commit(edits, (step.options ?? {}) as never);
      result = committed;
      if (committed.ok) for (const [label, ref] of Object.entries(committed.created)) { labels.set(label, ref); names.set(ref.id, label); }
    } else if ("undo" in step) result = graph.undo(step.undo);
    else if ("redo" in step) result = graph.redo(step.redo);
    else if ("compact" in step) {
      await graph.flush();
      result = await graph.compact(labels.get(step.compact)!, { ...(step.bucket ? { bucketMs: step.bucket } : {}),
        ...(step.roots ? { roots: resolveLabels(step.roots) as EventRef[] } : {}) });
    } else if ("purge" in step) result = await graph.purge(labels.get(step.purge)!, { force: !!step.force });
    else if ("advance" in step) scheduler.now += step.advance;
    else if ("forget" in step) graph.forgetHistory(step.forget === "*" ? undefined : step.forget);
    else if ("collapse" in step) result = await graph.collapseInline(labels.get(step.collapse)!);
    else if ("reload" in step) {
      // A new session over the same store: snapshots written at close, then loaded from them and their tails.
      await graph.snapshotAll();
      session.abort("closed");
      session = new Aborter(life.signal);
      sessions++;
      graph = await open();
    }
    if (result) refusals.push(result.ok ? null : result.reason ?? "unknown");
    await settle();
    changes.push(sets.flatMap(set => set.nodes.flatMap(change => change.paths.map(path => `${names.get(change.node.id) ?? change.node.id} ${pathKey(path)}`))).sort());
  }
  await graph.flush();
  const problems: string[] = [];
  const show = (value: unknown) => canonical(value);
  const expect = vector.expect;
  for (const [label, expected] of Object.entries(expect.effective ?? {})) {
    const ref = labels.get(label);
    const actual = ref ? graph.resolve(ref) ?? null : null;
    const want = resolveLabels(expected);   // references in expectations may name nodes by label too
    if (!equal(actual, want)) problems.push(`${vector.name}: ${label} is ${show(actual)}, expected ${show(want)}`);
  }
  if (expect.refusals && !equal(refusals, expect.refusals)) problems.push(`${vector.name}: refusals ${show(refusals)}, expected ${show(expect.refusals)}`);
  for (const [label, expected] of Object.entries(expect.streams ?? {})) {
    const ref = labels.get(label);
    const actual = ref ? (await graph.history(ref)).map(entry => [entry.seq, entry.op.kind]) : [];
    if (!equal(actual, expected)) problems.push(`${vector.name}: stream ${label} is ${show(actual)}, expected ${show(expected)}`);
  }
  for (const [label, paths] of Object.entries(expect.origins ?? {})) {
    for (const [key, expected] of Object.entries(paths)) {
      const origin = graph.origin(labels.get(label)!, JSON.parse(key) as Path);
      const actual = origin.via === "own" ? `own` : origin.via === "feed" || origin.via === "base"
        ? `${origin.via} ${names.get(origin.layer.id) ?? origin.layer.id} ${origin.owner === "default" ? "default" : names.get(origin.owner.id) ?? origin.owner.id}` : origin.via;
      if (actual !== expected) problems.push(`${vector.name}: origin of ${label} ${key} is ${actual}, expected ${expected}`);
    }
  }
  if (expect.changes && !equal(changes, expect.changes.map(list => [...list].sort()))) problems.push(`${vector.name}: changes ${show(changes)}, expected ${show(expect.changes)}`);
  for (const [label, expected] of Object.entries(expect.actors ?? {})) {
    const ref = labels.get(label);
    const actual = ref ? (await graph.history(ref)).map(entry => [entry.seq, entry.actor, entry.actorSeq]) : [];
    if (!equal(actual, expected)) problems.push(`${vector.name}: actors of ${label} are ${show(actual)}, expected ${show(expected)}`);
  }
  life.abort();
  return problems;
}
