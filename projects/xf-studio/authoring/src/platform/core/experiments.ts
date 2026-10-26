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
import { createHistoryService, type HistoryService } from "./history-service";
import { documentOwners } from "./saved-document";
import type { DocumentOutbox } from "./document-outbox";
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
  /** Reads the library's documents; every write goes through `outbox`, the one way a document reaches the library. */
  documents: Pick<DocumentStorePort, "list">; outbox: DocumentOutbox; random: Random; signal: AbortSignal;
  /** The session's history service: the experiments' documents are its `doc:*` scopes (default: one of their own). */
  history?: HistoryService;
  /** A listener's failure, sent to the page's diagnostics (default: the console); it never stops the others or a state change. */
  report?: (error: unknown) => void;
};
export type Experiments<T extends ExperimentRegistration> = Omit<ExperimentPort, "registrations" | "history"> & {
  registrations(): readonly T[]; readonly history: ExperimentContext["history"]; readonly context: ExperimentContext;
};

/** Reads the stored preference, then loads every enabled experiment (each in a task of its own) for as long as `signal` lives. */
export async function createExperiments<T extends ExperimentRegistration>(options: ExperimentOptions<T>): Promise<Experiments<T>> {
  const { definitions, documents, signal } = options;
  const stored = (await documents.list<ExperimentFlagsDocument>(EXPERIMENT_FLAGS.kind, signal)).find(item => item.id === EXPERIMENT_FLAGS.id);
  signal.throwIfAborted();
  // One holder per stored document for the page's lifetime, shared by every experiment instance (the one-owner rule).
  const owners = documentOwners(options.outbox);
  const preference = owners.open<ExperimentFlagsDocument>(EXPERIMENT_FLAGS.kind, EXPERIMENT_FLAGS.id, { schema: EXPERIMENT_FLAGS.schema, flags: {} }, stored);
  // Each document's history is a scope of the session's history service; the documents an experiment offers reach global Undo.
  const service = options.history ?? createHistoryService(), history = service.documents;
  const registered = () => [...loads.values()].flatMap(task => { const state = task.state(); return state.phase === "done" ? [state.result] : []; });
  signal.addEventListener("abort", service.participants(() => registered().flatMap(item => item.histories?.() ?? [])), { once: true });
  const contextFor = (lifetime: AbortSignal): ExperimentContext => ({ history, signal: lifetime, newId: () => options.random.uuid(),
    task: () => createTask({ signal: lifetime }),
    document: (kind, id, initial, stored) => owners.open(kind, id, initial, stored),
    async loadDocuments<T>(kind: string, read?: AbortSignal) {
      for (const item of await documents.list<T>(kind, read)) owners.open(kind, item.id, item.value, item);
      return owners.held<T>(kind);
    } });
  const context = contextFor(signal);
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of [...listeners]) { try { listener(); } catch (error) { report(error); } } };
  // The registration set's own generation and signal: moved only where an experiment's registration appears or goes, never for
  // settings, phases, services or history.
  let registrationGeneration = 0;
  const registrationListeners = new Set<() => void>();
  const report = options.report ?? ((error: unknown) => console.error(error));
  // Each listener on its own: one that throws never skips the others, nor the state change and publish that follow.
  const registrationsChanged = () => {
    registrationGeneration++;
    for (const listener of [...registrationListeners]) { try { listener(); } catch (error) { report(error); } }
  };
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
        if (task) {
          const wasRegistered = task.state().phase === "done";
          loads.delete(definition.id); task.cancel("experiment off");
          if (wasRegistered) registrationsChanged();
          publish(definition.id, "off");
        }
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
        // Only the load still held speaks for the experiment: a superseded one (switched off and on before it finished) publishes
        // nothing, so it can't mark the newer load ready or failed. The set changes here, once.
        if (loads.get(definition.id) !== load) return;
        if (outcome.status === "done") { registrationsChanged(); publish(definition.id, "ready"); }
        else if (outcome.status === "failed") publish(definition.id, "failed", `Couldn't open ${definition.label}. Turn it off and on to try again.`);
      });
    }
  };
  reconcile();

  return {
    context,
    history,
    settle: () => owners.settle(),
    snapshot: () => definitions.map(info => ({ id: info.id, label: info.label, description: info.description, enabled: effective(info.id), overridden: info.id in options.overrides,
      phase: phases[info.id]?.phase ?? "off", message: saveErrors[info.id] || phases[info.id]?.message || "" })),
    registrations: registered,
    async set(id, enabled) {
      if (!definitions.some(d => d.id === id) || typeof enabled !== "boolean") return { ok: false, message: "That experiment isn't available." };
      if (id in options.overrides) return { ok: false, message: "This verification page fixes that experiment setting. Open a page without the override to change it." };
      // The choice applies at once and is recorded in the outbox, which takes it to the library in the background (profiles design
      // §2.2): the answer doesn't wait for the library. A save that can't be recorded, or is later overtaken by another page's, says so.
      const next = { schema: EXPERIMENT_FLAGS.schema, flags: { ...preference.value.flags, [id]: enabled } };
      const saved = preference.save(next);
      const message = "This change applies for this session, but Studio couldn't confirm saving it. Try again.";
      if (preference.value !== next) {
        await saved.catch(() => {});
        saveErrors[id] = message; changed();
        return { ok: false, message };
      }
      reconcile();
      if (saveErrors[id]) saveErrors[id] = "";
      changed();
      saved.catch(() => { saveErrors[id] = message; changed(); });
      return { ok: true };
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    registrationGeneration: () => registrationGeneration,
    onRegistrationsChanged(listener) { registrationListeners.add(listener); return () => { registrationListeners.delete(listener); }; },
  };
}

export const OFF_EXPERIMENTS = Object.freeze({ snapshot: () => [], registrations: () => [],
  set: async () => ({ ok: false, message: "Experimental features aren't available in this host yet." }), subscribe: () => () => {},
  registrationGeneration: () => 0, onRegistrationsChanged: () => () => {} }) satisfies ExperimentPort;

/** Mounts immediately: the preference is read in the background, and that read can't delay or fail the ordinary shell. */
export function startExperiments<T extends ExperimentRegistration>(options: ExperimentOptions<T>) {
  const initial: ExperimentState[] = options.definitions.map(info => ({ id: info.id, label: info.label, description: info.description, enabled: false, overridden: info.id in options.overrides, phase: "off", message: "" }));
  const failed = initial.map(info => ({ ...info, phase: "failed" as const, message: "Couldn't read experimental settings. Reload Studio to try again." }));
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of [...listeners]) listener(); };
  const history = options.history ?? createHistoryService();
  const reading = createTask<Experiments<T>>({ signal: options.signal });
  reading.subscribe(changed);
  const runtime = () => { const state = reading.state(); return state.phase === "done" ? state.result : undefined; };
  // The registration signal passes straight through: the set is empty until the runtime exists, so its arrival changes nothing.
  const registrationListeners = new Set<() => void>();
  const ready = reading.run(async signal => {
    const loaded = await createExperiments({ ...options, history, signal });
    const off = loaded.subscribe(changed);
    const offRegistrations = loaded.onRegistrationsChanged(() => { for (const listener of [...registrationListeners]) listener(); });
    signal.addEventListener("abort", () => { off(); offRegistrations(); }, { once: true });
    return loaded;
  }).then(outcome => outcome.status === "done");
  return {
    ready,
    /** The history service the experiments' documents live in, for the startup root to share with the look (`studio-startup.ts`). */
    historyService: history,
    get context() { return runtime()?.context; },
    get history() { return runtime()?.history; },
    snapshot: (): readonly ExperimentState[] => runtime()?.snapshot() ?? (reading.state().phase === "failed" ? failed : initial),
    registrations: () => runtime()?.registrations() ?? [],
    settle: async () => await runtime()?.settle?.() ?? true,
    async set(id: string, enabled: boolean) { return await ready && runtime() ? runtime()!.set(id, enabled) : { ok: false, message: "Couldn't read experimental settings. Reload Studio to try again." }; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    registrationGeneration: () => runtime()?.registrationGeneration() ?? 0,
    onRegistrationsChanged(listener: () => void) { registrationListeners.add(listener); return () => { registrationListeners.delete(listener); }; },
  };
}
