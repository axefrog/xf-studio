import type { ExperimentContext } from "../api/graph";
/** Generic experiment preferences and loader. Feature implementations are reached only through injected lazy loaders. */
import { Aborter, createEnvironment, createGraph, defineType, erector, standardOperators } from "strata";
import type { AbortSignalLike, GraphModel, GraphStore, Json, KNode, NodeId, Sources } from "strata";
import type { ExperimentInfo, ExperimentPort, ExperimentRegistration, ExperimentState } from "../api/experiments";
import { documentHistory } from "./document-history";

export const EXPERIMENT_TYPES = [
  defineType({ type: "experimental-features", owner: "platform", schema: "1", fields: { flags: { kind: "map", of: { kind: "value" } } }, defaults: () => ({ flags: {} }) }),
  defineType({ type: "experiment-document", owner: "platform", schema: "1", fields: { module: { kind: "value" }, document: { kind: "value" }, values: { kind: "map", of: { kind: "value" } } }, defaults: () => ({ values: {} }) }),
];
export type ExperimentDefinition<T extends ExperimentRegistration = ExperimentRegistration> = ExperimentInfo & {
  load(signal: AbortSignalLike): Promise<{ create(context: ExperimentContext): T }>;
};
export function experimentOverrides(query: string, known: readonly string[], verification = false): Record<string, boolean> {
  const params = new URLSearchParams(query), result: Record<string, boolean> = {};
  if (!verification) return result;
  for (const id of known) { const values = params.getAll(`experiment.${id}`); if (values.length === 1 && /^[01]$/.test(values[0])) result[id] = values[0] === "1"; }
  return result;
}
type ExperimentOptions<T extends ExperimentRegistration> = {
  definitions: readonly ExperimentDefinition<T>[]; overrides: Readonly<Record<string, boolean>>; sources: Sources; store?: GraphStore; signal: AbortSignalLike;
};
export async function createExperiments<T extends ExperimentRegistration>(options: ExperimentOptions<T>): Promise<Omit<ExperimentPort, "registrations"> & { registrations(): readonly T[]; context: ExperimentContext }> {
  const life = new Aborter(options.signal), { definitions, sources } = options;
  const graph = createGraph({ types: EXPERIMENT_TYPES, sources, store: options.store, actor: "studio-experiments", signal: life.signal,
    snapshotEvery: Number.MAX_SAFE_INTEGER, snapshotFoldMs: Infinity });
  await graph.load();
  const env = createEnvironment({ clock: sources.clock });
  const preferenceRef = () => graph.list().find(ref => ref.type === "experimental-features");
  const existing = preferenceRef();
  const flags = env.seed<Record<string, boolean>>({ initial: existing ? graph.resolve(existing, ["flags"]) as Record<string, boolean> : {}, signal: life.signal });
  const states = env.seed<Record<string, { phase: ExperimentState["phase"]; message: string }>>({ initial: {}, signal: life.signal });
  // Per-experiment save problems, shown instead of the load message until a later save of that experiment succeeds.
  const saveErrors = env.seed<Record<string, string>>({ initial: {}, signal: life.signal });
  const updates = env.seed<number>({ initial: 0, signal: life.signal });
  const registrations = new Map<string, { life: Aborter; contribution?: T }>(); // Adapter runtimes, keyed by experiment request.
  const effective = (id: string) => options.overrides[id] ?? flags.value()?.[id] ?? false;
  const history = documentHistory(env, life.signal);
  const context: ExperimentContext = { graph, env, sources, signal: life.signal, history };
  const publish = (id: string, phase: ExperimentState["phase"], message = "") => env.observe(states, { ...states.value(), [id]: { phase, message } });
  const model: GraphModel = { nodes: [{ id: "load", kind: "driver", op: "load-experiments" }] };
  const modelNode = env.seed<GraphModel>({ initial: model, signal: life.signal });
  const erected = erector(env, modelNode, { ...standardOperators, "load-experiments": { kind: "driver", create: () => ({ name: "Load requested experiments", start(run) {
    run.effect({ inputs: [flags], run: () => {
      for (const definition of definitions) {
        const previous = registrations.get(definition.id), enabled = effective(definition.id);
        if (!enabled) { if (previous) { registrations.delete(definition.id); previous.life.abort("experiment off"); publish(definition.id, "off"); } continue; }
        if (previous) continue;
        const token = new Aborter(run.signal), runtime = { life: token, contribution: undefined as T | undefined };
        registrations.set(definition.id, runtime); publish(definition.id, "loading");
        const process = run.spawn(`Load ${definition.label}`, async (signal): Promise<Json> => {
          try {
            const loaded = await definition.load(signal);
            if (signal.aborted || token.signal.aborted || registrations.get(definition.id) !== runtime) return null;
            runtime.contribution = loaded.create({ ...context, signal: token.signal });
            if (token.signal.aborted) return null;
            const off = runtime.contribution.service.subscribe(() => env.observe(updates, (updates.value() ?? 0) + 1));
            token.signal.addEventListener("abort", off);
            publish(definition.id, "ready");
            return { experiment: definition.id };
          } catch (error) {
            if (!signal.aborted && !token.signal.aborted) publish(definition.id, "failed", `Couldn't open ${definition.label}. Turn it off and on to try again.`);
            return { error: error instanceof Error ? error.message : "Experiment loading failed." };
          }
        });
        token.signal.addEventListener("abort", () => process.abort("superseded"));
      }
    } });
    run.signal.addEventListener("abort", () => { for (const r of registrations.values()) r.life.abort(); registrations.clear(); });
  } }) } });
  erected.driver.start(life.signal);
  // Erected drivers are declarative entries; demand starts this root request and lasts with the page.
  (erected.live("load") as import("strata").Driver).start(life.signal, { reason: "experimental feature preference", goal: "registered while enabled" });
  return {
    context,
    history,
    snapshot: () => definitions.map(info => ({ id: info.id, label: info.label, description: info.description, enabled: effective(info.id), overridden: info.id in options.overrides,
      phase: states.value()?.[info.id]?.phase ?? "off", message: saveErrors.value()?.[info.id] || states.value()?.[info.id]?.message || "" })),
    registrations: () => [...registrations.values()].flatMap(r => r.contribution ? [r.contribution] : []),
    async set(id, enabled) {
      if (!definitions.some(d => d.id === id) || typeof enabled !== "boolean") return { ok: false, message: "That experiment isn't available." };
      if (id in options.overrides) return { ok: false, message: "This verification page fixes that experiment setting. Open a page without the override to change it." };
      const before = flags.value()!;
      let committed = false;
      try {
        let ref = preferenceRef();
        if (!ref) {
          const created = graph.commit([{ op: "create", id: "xfs-experimental-preferences" as NodeId, type: "experimental-features", as: "flags" }], { scope: "experiment-settings" });
          if (!created.ok) throw Error(created.message); ref = created.created.flags;
        }
        const result = graph.commit([{ op: "set", node: ref, path: ["flags", id], value: enabled }], { scope: "experiment-settings", action: "experiment.set" });
        if (!result.ok) throw Error(result.message);
        committed = true;
        env.observe(flags, { ...before, [id]: enabled });
        await graph.flush();
        env.observe(saveErrors, { ...saveErrors.value(), [id]: "" });
        return { ok: true };
      } catch {
        // The store may have written before its acknowledgement failed: keep the graph's accepted truth rather than rolling back behind it.
        const message = committed ? "This change applies for this session, but Studio couldn't confirm saving it. Try again."
          : "Couldn't change this experimental setting. Try again.";
        if (committed) { const ref = preferenceRef(); if (ref) env.observe(flags, graph.resolve(ref, ["flags"]) as Record<string, boolean>); }
        env.observe(saveErrors, { ...saveErrors.value(), [id]: message });
        return { ok: false, message };
      }
    },
    subscribe(listener) {
      const subscription = new Aborter(life.signal);
      const driver = env.driver({ name: "Observe experiments", start(run) { run.effect({ inputs: [flags, states, updates, saveErrors], run: () => listener() }); } }, undefined, subscription.signal);
      driver.start(subscription.signal); return () => subscription.abort();
    },
  };
}

export const OFF_EXPERIMENTS = Object.freeze({ snapshot: () => [], registrations: () => [],
  set: async () => ({ ok: false, message: "Experimental features aren't available in this host yet." }), subscribe: () => () => {} }) satisfies ExperimentPort;

/** Mount immediately; the requested background read cannot delay or fail the ordinary shell. */
export function startExperiments<T extends ExperimentRegistration>(options: ExperimentOptions<T>) {
  const life = new Aborter(options.signal), env = createEnvironment({ clock: options.sources.clock });
  const initial: ExperimentState[] = options.definitions.map(info => ({ id: info.id, label: info.label, description: info.description, enabled: false, overridden: info.id in options.overrides, phase: "off", message: "" }));
  const observations = env.seed<readonly ExperimentState[]>({ initial, signal: life.signal });
  // The loaded platform is an abort-owned runtime; its public observations remain stream data.
  let runtime: Awaited<ReturnType<typeof createExperiments<T>>> | undefined;
  let finish!: (ok: boolean) => void;
  const ready = new Promise<boolean>(resolve => { finish = resolve; });
  life.signal.addEventListener("abort", () => finish(false));
  const driver = env.driver({ name: "Read optional experimental preferences", start(run) {
    run.spawn("Read experimental preferences", async signal => {
      try {
        const loaded = await createExperiments({ ...options, signal });
        if (signal.aborted) return null;
        runtime = loaded;
        const observe = () => env.observe(observations, loaded.snapshot());
        const off = loaded.subscribe(observe); signal.addEventListener("abort", off); observe(); finish(true);
        return { ready: true };
      } catch {
        if (!signal.aborted) env.observe(observations, initial.map(info => ({ ...info, phase: "failed", message: "Couldn't read experimental settings. Reload Studio to try again." })));
        finish(false); return { ready: false };
      }
    });
  } }, undefined, life.signal);
  driver.start(life.signal, { reason: "optional experimental preferences", goal: "experiments available without delaying Studio startup" });
  return {
    ready,
    get context() { return runtime?.context; },
    get history() { return runtime?.history; },
    snapshot: () => observations.value()!,
    registrations: () => runtime?.registrations() ?? [],
    async set(id: string, enabled: boolean) { return await ready && runtime ? runtime.set(id, enabled) : { ok: false, message: "Couldn't read experimental settings. Reload Studio to try again." }; },
    subscribe(listener: () => void) {
      const token = new Aborter(life.signal), observer = env.driver({ name: "Observe experimental startup", start(run) { run.effect({ inputs: [observations], run: () => listener() }); } }, undefined, token.signal);
      observer.start(token.signal); return () => token.abort();
    },
  };
}
