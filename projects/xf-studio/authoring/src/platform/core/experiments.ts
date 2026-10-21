/**
 * The experiments platform: the experimental-features preference and the loading of each enabled experiment. Feature
 * implementations are reached only through injected lazy loaders, so an experiment that is off loads nothing.
 *
 * The preference is one document in the library's document store (`EXPERIMENT_FLAGS`). It sits beside the experiments'
 * own documents rather than in the local settings: it is a per-library choice (a verification workspace's library keeps
 * its own), toggled one flag at a time with no settings revision to collide with, and the experiments platform then needs
 * one transport only.
 */
import type { ExperimentContext, ExperimentFlagsDocument, ExperimentInfo, ExperimentPort, ExperimentRegistration, ExperimentState } from "../api/experiments";
import { EXPERIMENT_FLAGS } from "../api/experiments";
import type { DocumentStorePort } from "../api/document-store";
import type { Random } from "./random";
import { createDocumentHistory } from "./document-history";
import { savedDocument } from "./saved-document";
import { createTask, type Task } from "./tasks";

export type ExperimentDefinition<T extends ExperimentRegistration = ExperimentRegistration> = ExperimentInfo & {
  load(signal: AbortSignal): Promise<{ create(context: ExperimentContext): T | Promise<T> }>;
};
export function experimentOverrides(query: string, known: readonly string[], verification = false): Record<string, boolean> {
  const params = new URLSearchParams(query), result: Record<string, boolean> = {};
  if (!verification) return result;
  for (const id of known) { const values = params.getAll(`experiment.${id}`); if (values.length === 1 && /^[01]$/.test(values[0])) result[id] = values[0] === "1"; }
  return result;
}
export type ExperimentOptions<T extends ExperimentRegistration> = {
  definitions: readonly ExperimentDefinition<T>[]; overrides: Readonly<Record<string, boolean>>;
  documents: DocumentStorePort; random: Random; signal: AbortSignal;
};
export type Experiments<T extends ExperimentRegistration> = Omit<ExperimentPort, "registrations" | "history"> & {
  registrations(): readonly T[]; readonly history: ExperimentContext["history"]; readonly context: ExperimentContext;
};

/** Reads the stored preference, then loads every enabled experiment (each in a task of its own) for as long as `signal` lives. */
export async function createExperiments<T extends ExperimentRegistration>(options: ExperimentOptions<T>): Promise<Experiments<T>> {
  const { definitions, documents, signal } = options;
  const stored = (await documents.list<ExperimentFlagsDocument>(EXPERIMENT_FLAGS.kind)).find(item => item.id === EXPERIMENT_FLAGS.id);
  const preference = savedDocument<ExperimentFlagsDocument>(documents, EXPERIMENT_FLAGS.kind, EXPERIMENT_FLAGS.id,
    { schema: EXPERIMENT_FLAGS.schema, flags: {} }, stored);
  const history = createDocumentHistory();
  const contextFor = (lifetime: AbortSignal): ExperimentContext => ({ documents, history, signal: lifetime, newId: () => options.random.uuid(),
    task: () => createTask({ signal: lifetime }), document: (kind, id, initial, stored) => savedDocument(documents, kind, id, initial, stored) });
  const context = contextFor(signal);
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of [...listeners]) listener(); };
  const phases: Record<string, { phase: ExperimentState["phase"]; message: string }> = {};
  // Per-experiment save problems, shown instead of the load message until a later save of that experiment succeeds.
  const saveErrors: Record<string, string> = {};
  const effective = (id: string) => options.overrides[id] ?? preference.value.flags?.[id] ?? false;
  const publish = (id: string, phase: ExperimentState["phase"], message = "") => { phases[id] = { phase, message }; changed(); };
  /** Each enabled experiment's loading and, once loaded, its contribution; the run's signal is the contribution's lifetime. */
  const loads = new Map<string, Task<T>>();
  const unsubscribe = history.subscribe(changed);
  signal.addEventListener("abort", unsubscribe, { once: true });

  const reconcile = () => {
    for (const definition of definitions) {
      const task = loads.get(definition.id);
      if (!effective(definition.id)) {
        if (task) { loads.delete(definition.id); task.cancel("experiment off"); publish(definition.id, "off"); }
        continue;
      }
      if (task || signal.aborted) continue;
      const load = createTask<T>({ signal });
      loads.set(definition.id, load);
      publish(definition.id, "loading");
      void load.run(async run => {
        const loaded = await definition.load(run);
        run.throwIfAborted();
        const contribution = await loaded.create(contextFor(run));
        run.throwIfAborted();
        const off = contribution.service.subscribe(changed);
        run.addEventListener("abort", off, { once: true });
        return contribution;
      }).then(outcome => {
        if (outcome.status === "done") publish(definition.id, "ready");
        else if (outcome.status === "failed") publish(definition.id, "failed", `Couldn't open ${definition.label}. Turn it off and on to try again.`);
      });
    }
  };
  reconcile();

  return {
    context,
    history,
    snapshot: () => definitions.map(info => ({ id: info.id, label: info.label, description: info.description, enabled: effective(info.id), overridden: info.id in options.overrides,
      phase: phases[info.id]?.phase ?? "off", message: saveErrors[info.id] || phases[info.id]?.message || "" })),
    registrations: () => [...loads.values()].flatMap(task => { const state = task.state(); return state.phase === "done" ? [state.result] : []; }),
    async set(id, enabled) {
      if (!definitions.some(d => d.id === id) || typeof enabled !== "boolean") return { ok: false, message: "That experiment isn't available." };
      if (id in options.overrides) return { ok: false, message: "This verification page fixes that experiment setting. Open a page without the override to change it." };
      // The choice applies at once; a save that can't be confirmed never rolls it back behind what the store may already hold.
      const saved = preference.save({ schema: EXPERIMENT_FLAGS.schema, flags: { ...preference.value.flags, [id]: enabled } });
      reconcile();
      changed();
      try {
        await saved;
        if (saveErrors[id]) { saveErrors[id] = ""; changed(); }
        return { ok: true };
      } catch {
        const message = "This change applies for this session, but Studio couldn't confirm saving it. Try again.";
        saveErrors[id] = message; changed();
        return { ok: false, message };
      }
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export const OFF_EXPERIMENTS = Object.freeze({ snapshot: () => [], registrations: () => [],
  set: async () => ({ ok: false, message: "Experimental features aren't available in this host yet." }), subscribe: () => () => {} }) satisfies ExperimentPort;

/** Mounts immediately: the preference is read in the background, and that read can't delay or fail the ordinary shell. */
export function startExperiments<T extends ExperimentRegistration>(options: ExperimentOptions<T>) {
  const initial: ExperimentState[] = options.definitions.map(info => ({ id: info.id, label: info.label, description: info.description, enabled: false, overridden: info.id in options.overrides, phase: "off", message: "" }));
  const failed = initial.map(info => ({ ...info, phase: "failed" as const, message: "Couldn't read experimental settings. Reload Studio to try again." }));
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of [...listeners]) listener(); };
  const reading = createTask<Experiments<T>>({ signal: options.signal });
  reading.subscribe(changed);
  const runtime = () => { const state = reading.state(); return state.phase === "done" ? state.result : undefined; };
  const ready = reading.run(async signal => {
    const loaded = await createExperiments({ ...options, signal });
    const off = loaded.subscribe(changed);
    signal.addEventListener("abort", off, { once: true });
    return loaded;
  }).then(outcome => outcome.status === "done");
  return {
    ready,
    get context() { return runtime()?.context; },
    get history() { return runtime()?.history; },
    snapshot: (): readonly ExperimentState[] => runtime()?.snapshot() ?? (reading.state().phase === "failed" ? failed : initial),
    registrations: () => runtime()?.registrations() ?? [],
    async set(id: string, enabled: boolean) { return await ready && runtime() ? runtime()!.set(id, enabled) : { ok: false, message: "Couldn't read experimental settings. Reload Studio to try again." }; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
