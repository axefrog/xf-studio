import type { ExperimentContext } from "../api/graph";
/** Generic experiment preferences and loader. Feature implementations are reached only through injected lazy loaders. */
import { Aborter, createEnvironment, createGraph, defineType, erector, standardOperators } from "strata";
import type { AbortSignalLike, GraphModel, GraphStore, Json, KNode, Sources } from "strata";
import type { ExperimentInfo, ExperimentPort, ExperimentRegistration, ExperimentState } from "../api/experiments";
import { documentHistory } from "./document-history";

export const EXPERIMENT_TYPES = [
  defineType({ type: "experimental-features", owner: "platform", schema: "1", fields: { flags: { kind: "map", of: { kind: "value" } } }, defaults: () => ({ flags: {} }) }),
  defineType({ type: "experiment-document", owner: "platform", schema: "1", fields: { module: { kind: "value" }, document: { kind: "value" } } }),
];
export type ExperimentDefinition<T extends ExperimentRegistration = ExperimentRegistration> = ExperimentInfo & {
  load(signal: AbortSignalLike): Promise<{ create(context: ExperimentContext): T }>;
};
export function experimentOverrides(query: string, known: readonly string[]): Record<string, boolean> {
  const params = new URLSearchParams(query), result: Record<string, boolean> = {};
  if (params.get("verify") !== "1") return result;
  for (const id of known) { const values = params.getAll(`experiment.${id}`); if (values.length === 1 && /^[01]$/.test(values[0])) result[id] = values[0] === "1"; }
  return result;
}
export async function createExperiments<T extends ExperimentRegistration>(options: {
  definitions: readonly ExperimentDefinition<T>[]; overrides: Readonly<Record<string, boolean>>; sources: Sources; store?: GraphStore; signal: AbortSignalLike;
}): Promise<Omit<ExperimentPort, "registrations"> & { registrations(): readonly T[]; context: ExperimentContext }> {
  const life = new Aborter(options.signal), { definitions, sources } = options;
  const graph = createGraph({ types: EXPERIMENT_TYPES, sources, store: options.store, actor: "studio-experiments", signal: life.signal });
  await graph.load();
  let preferences = graph.list().find(ref => ref.type === "experimental-features");
  if (!preferences) { const result = graph.commit([{ op: "create", type: "experimental-features", as: "flags" }], { scope: "experiment-settings" }); if (!result.ok) throw Error(result.message); preferences = result.created.flags; }
  const preferenceRef = preferences;
  const env = createEnvironment({ clock: sources.clock });
  const flags = env.seed<Record<string, boolean>>({ initial: graph.resolve(preferences, ["flags"]) as Record<string, boolean>, signal: life.signal });
  const states = env.seed<Record<string, { phase: ExperimentState["phase"]; message: string }>>({ initial: {}, signal: life.signal });
  const updates = env.seed<number>({ initial: 0, signal: life.signal });
  const registrations = new Map<string, { life: Aborter; contribution?: T }>(); // Adapter runtimes, keyed by experiment request.
  const effective = (id: string) => options.overrides[id] ?? flags.value()?.[id] ?? false;
  const history = documentHistory(env, life.signal);
  const context: ExperimentContext = { graph, env, sources, signal: life.signal, history };
  graph.subscribe(preferenceRef, () => env.observe(flags, graph.resolve(preferenceRef, ["flags"]) as Record<string, boolean>), { signal: life.signal });
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
      phase: states.value()?.[info.id]?.phase ?? "off", message: states.value()?.[info.id]?.message ?? "" })),
    registrations: () => [...registrations.values()].flatMap(r => r.contribution ? [r.contribution] : []),
    async set(id, enabled) {
      if (!definitions.some(d => d.id === id) || typeof enabled !== "boolean") return { ok: false, message: "That experiment isn't available." };
      if (id in options.overrides) return { ok: false, message: "This verification page fixes that experiment setting. Open a page without the override to change it." };
      const result = graph.commit([{ op: "set", node: preferenceRef, path: ["flags", id], value: enabled }], { scope: "experiment-settings", action: "experiment.set" });
      if (!result.ok) return { ok: false, message: result.message };
      await graph.flush(); return { ok: true };
    },
    subscribe(listener) {
      const subscription = new Aborter(life.signal);
      const driver = env.driver({ name: "Observe experiments", start(run) { run.effect({ inputs: [flags, states, updates], run: () => listener() }); } }, undefined, subscription.signal);
      driver.start(subscription.signal); return () => subscription.abort();
    },
  };
}
