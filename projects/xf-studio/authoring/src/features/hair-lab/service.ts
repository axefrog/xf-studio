import type { ModuleService } from "../../platform/api";
import type { ExperimentContext } from "../../platform/api/experiment-context";
import type { SavedDocument } from "../../platform/api/document-store";
import type { HistoryCommand, HistoryParticipant } from "../../platform/api/history";
import type { Task } from "../../platform/api/tasks";
import { constant } from "./fields";
import { validateGroom } from "./groom";
import type { Groom, HeadSurface, Paths, Residuals } from "./types";

export type HairDisplay = "combined" | "strands" | "scalp" | "reference" | "reference-scalp" | "volumes" | "cards";
export type HairAction = { kind: "hairLab.preview"; target: string; display: HairDisplay } | { kind: "hairLab.activate"; target: string; active: boolean } | { kind: "hairLab.set"; target: string; field: "length" | "waves" | "spread"; value: number }
  | { kind: "hairLab.undo" | "hairLab.redo" | "hairLab.retry"; target: string };
export type Continuation = { groom: Groom; paths: Paths };
export type Generation = { groom: Groom; paths: Paths; uncutPaths?: Paths; continuation?: boolean; residuals: Residuals | null; stage: "coarse" | "refined"; milliseconds: Record<string, number>; volumes?: import("./volumes").Volumes; volumeGeometry?: ReturnType<typeof import("./volumes").volumeMesh>; cards?: import("./cards").CardMesh; occlusion?: ReturnType<typeof import("./occlusion").bakeOcclusion>["statistics"]; cardContact?: { minimumClearanceMetres: number; penetrationMetres: number }; coverageGeometry?: { positions: number[]; indices: number[]; uv: number[] } | null; coverage?: { width: number; height: number; values: string }; tintCheck?: ReturnType<typeof import("./scalp").densityCoverage> };
export type GenerationDevice = { generate(target: string, surface: HeadSurface, groom: Groom | null, signal: AbortSignal, publish: (result: Generation) => void, previous?: Continuation | null): Promise<void> };
type Session = { display: HairDisplay; id: string; active: boolean; surface: HeadSurface; document: string | null; revision: number; phase: "off" | "shaping" | "settling" | "ready" | "failed"; message: string; result: Generation | null; settled: Continuation | null; continuation: Continuation | null };
export type HairLabSnapshot = { sessions: readonly (Session & { groom: Groom | null })[] };
export type HairLabFacade = ModuleService & { snapshot(): HairLabSnapshot; dispatch(action: HairAction): Promise<{ ok: boolean; message?: string }> };

/** Hair Lab's authored grooms in the document store: one document per groom, the groom without its derived density and binding. */
export const HAIR_GROOM_KIND = "hair-groom";

/** Session results are read-only: frozen through, except typed arrays (which can't be frozen and are never handed out to edit). */
function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !ArrayBuffer.isView(value) && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) frozen(item); }
  return value;
}

/** Whether a refined result passes its attachment, intrinsic-length, contact and smoothness gate. */
function refinedPasses(result: Generation): boolean {
  const r = result.residuals;
  return !!r && !!r.curvature && result.paths.paths.length > 0
    && [r.rootMetres, r.lengthRatio, r.penetrationMetres, r.minimumClearanceMetres, ...Object.values(r.curvature)].every(Number.isFinite)
    && r.rootMetres <= 1e-6 && r.lengthRatio <= .02 && r.penetrationMetres <= .00005 && r.curvature.maximumPerMetre <= 350
    && r.curvature.maximumTurnRadians <= 1.65 && r.curvature.maximumJumpPerMetre <= 250
    && !r.colliders?.some(c => !Number.isFinite(c.minimumClearanceMetres) || c.penetrationMetres > .00005);
}

/**
 * The Hair Lab service. Each groom is a stored document (`HAIR_GROOM_KIND`), edited through the shared document history
 * (scope `hair:<document id>`); each scene's session and its generated result are session state. Every active scene has
 * one generation task: a newer request (an edit, a retry, a new surface) supersedes the one before, and a superseded
 * run's results never reach the session. `grooms` is the grooms the page already holds (`context.loadDocuments`).
 */
export function createHairLab(context: ExperimentContext, device: GenerationDevice, grooms: readonly SavedDocument<Groom>[] = []) {
  const { history, signal: lifetime } = context;
  let sessions: Record<string, Session> = {};
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const change = (id: string, update: Partial<Session>) => { const row = sessions[id]; if (row) { sessions = { ...sessions, [id]: { ...row, ...update } }; notify(); } };
  const documents = new Map<string, SavedDocument<Groom>>(grooms.map(item => [item.id, item]));
  /** Each scene's generation task and the session revision its current run is for (null: none). */
  const jobs = new Map<string, { revision: number | null; task: Task<void> }>();
  const readGroom = (row: Session): Groom | null => {
    const value = row.document ? documents.get(row.document)?.value : undefined;
    return value ? Object.freeze({ ...value, fields: Object.freeze({ ...value.fields }) }) : null;
  };
  const authored = (groom: Groom): Groom => {
    const { density: _density, binding: _binding, ...scalp } = groom.scalp;
    return { ...groom, scalp };
  };
  /** Saves a groom in the background; a save the store refuses is said on the sessions showing it (the edit stays shown). */
  const persist = (id: string, value: Groom): Promise<boolean> => documents.get(id)!.save(value).then(() => true, () => {
    for (const row of Object.values(sessions)) if (row.document === id) change(row.id, { message: "Couldn't save the latest hair change. Make another change to try again." });
    return false;
  });
  const generate = (row: Session) => async (signal: AbortSignal): Promise<void> => {
    const { revision, id } = row;
    let rejected = false;
    try {
      await device.generate(id, row.surface, readGroom(row), signal, result => {
        const latest = sessions[id];
        if (signal.aborted || rejected || !latest?.active || latest.revision !== revision) return;
        if (result.stage === "refined" && !refinedPasses(result)) {
          rejected = true;
          change(id, { phase: "failed", result: null, settled: null, message: "Couldn't settle this groom. Try again, or turn Hair Lab off to use your usual hairstyle." });
          return;
        }
        frozen(result);
        let document = latest.document;
        if (!document) {
          document = context.newId();
          const groom = authored(result.groom);
          documents.set(document, context.document(HAIR_GROOM_KIND, document, groom));
          void persist(document, groom);
        }
        change(id, { document, result, ...(result.stage === "refined" ? { settled: { groom: result.groom, paths: result.groom.cut ? result.paths : result.uncutPaths ?? result.paths } } : {}),
          phase: result.stage === "coarse" ? "settling" : "ready", message: result.stage === "coarse" ? "Settling hair…" : "Ready" });
      }, row.continuation);
    } catch (error) {
      if (!signal.aborted && sessions[id]?.revision === revision) change(id, { phase: "failed", result: null, message: "Couldn't shape this groom. Try again, or turn Hair Lab off to use your usual hairstyle." });
      throw error;
    }
  };
  /**
   * Brings the generation tasks in line with the sessions. Each scene keeps one task: a session that is active (with the
   * coverage it needs) runs once per revision, a newer revision's run supersedes the one before, and anything else cancels it.
   */
  const demand = () => {
    if (lifetime.aborted) return;
    for (const [id, job] of jobs) if (!sessions[id]) { job.task.cancel("scene closed"); jobs.delete(id); }
    for (const row of Object.values(sessions)) {
      const job = jobs.get(row.id);
      if (!row.active || row.surface.coverageRequired && !row.surface.coverageSurface) {
        if (job && job.revision !== null) { job.revision = null; job.task.cancel("newer hair request"); }
        continue;
      }
      if (job?.revision === row.revision) continue;
      const scene = job ?? { revision: null, task: context.task<void>() };
      jobs.set(row.id, scene);
      scene.revision = row.revision;
      change(row.id, { phase: "shaping", message: "Shaping hair…", result: null });
      void scene.task.run(generate(sessions[row.id]));
    }
  };
  lifetime.addEventListener("abort", () => { for (const job of jobs.values()) job.task.cancel(); jobs.clear(); }, { once: true });
  /** Calls `listener` now and after every change to the sessions, until `signal` aborts. */
  function observe(signal: AbortSignal, listener: () => void) {
    if (signal.aborted) return;
    listeners.add(listener);
    signal.addEventListener("abort", () => listeners.delete(listener), { once: true });
    listener();
  }
  const refreshDocument = (document: string) => {
    for (const row of Object.values(sessions)) if (row.document === document) change(row.id, { revision: row.revision + 1, continuation: row.settled });
    demand();
  };
  function moveHistory(document: string, action: HistoryCommand): boolean {
    const scope = `hair:${document}`, timeline = history.snapshot(scope);
    const desired = action.kind === "history.undo" ? timeline.current - 1 : action.kind === "history.redo" ? timeline.current + 1
      : action.entryId === timeline.startId ? -1 : timeline.steps.findIndex(step => step.id === action.entryId);
    if (desired < -1 || desired >= timeline.steps.length || action.kind === "history.jumpTo" && desired === -1 && action.entryId !== timeline.startId) return false;
    if (desired === timeline.current) return true;
    const value = history.move(scope, desired) as Groom | undefined;
    if (!value || !documents.has(document)) return false;
    void persist(document, value);
    refreshDocument(document);
    return true;
  }
  const facade: HairLabFacade = {
    module: "hair-lab", snapshot: () => ({ sessions: Object.values(sessions).map(row => Object.freeze({ ...row, groom: readGroom(row) })) }),
    capability: () => ({ available: true }),
    async dispatch(action: HairAction) {
      const row = sessions[action.target]; if (!row) return { ok: false, message: "Open a 3D view first." };
      if (action.kind === "hairLab.preview") {
        if (!["combined", "strands", "scalp", "reference", "reference-scalp", "volumes", "cards"].includes(action.display)) return { ok: false, message: "Choose a supported preview." };
        change(row.id, { display: action.display }); return { ok: true };
      }
      if (action.kind === "hairLab.activate") {
        if (!action.active && row.document && history.selected() === `hair:${row.document}`) history.focus(null);
        change(row.id, { active: action.active, revision: row.revision + 1, phase: "off", result: null, settled: null, continuation: null, message: "" }); demand(); return { ok: true };
      }
      if (action.kind === "hairLab.retry") { change(row.id, { revision: row.revision + 1, continuation: null, settled: null, phase: "shaping", message: "Preparing hair…" }); demand(); return { ok: true }; }
      const groom = readGroom(row), document = row.document;
      if (!document || !groom) return { ok: false, message: "Turn Hair Lab on to create a groom first." };
      if (action.kind !== "hairLab.set")
        return moveHistory(document, { kind: action.kind === "hairLab.undo" ? "history.undo" : "history.redo" }) ? { ok: true } : { ok: false, message: "There is no hair change to undo or redo." };
      const limits = { length: [.08, .85], waves: [0, .035], spread: [0, .065] };
      const [lo, hi] = limits[action.field] ?? [Infinity, -Infinity];
      if (!Number.isFinite(action.value) || action.value < lo || action.value > hi) return { ok: false, message: "Choose a value within the slider's range." };
      const edited: Groom = { ...groom, fields: { ...groom.fields, [action.field]: constant(action.value, "m") } };
      const issues = validateGroom(edited); if (issues.length) return { ok: false, message: "That change couldn't be used. Undo it and try another value." };
      const label = `Hair ${{ length: "length", waves: "waves", spread: "volume" }[action.field]}`;
      history.record(`hair:${document}`, "Hair Lab", { id: context.newId(), label, actionKind: action.kind }, { before: documents.get(document)!.value, after: edited });
      const saved = persist(document, edited);
      refreshDocument(document);
      return await saved ? { ok: true } : { ok: false, message: "This change shows now, but Studio couldn't save it. Try again." };
    },
    subscribe(listener) { const token = new AbortController(); observe(token.signal, listener); return () => token.abort(); },
  };
  return {
    facade,
    histories(): HistoryParticipant[] {
      const shown = new Set(Object.values(sessions).flatMap(row => row.document ? [row.document] : []));
      return [...shown].map(document => ({ id: `hair:${document}`, dispatch: action => moveHistory(document, action) }));
    },
    actionHints(): Readonly<Record<string, string>> { return Object.values(sessions).some(row => row.active) ? { "motion.setPhysics": "Turn Hair Lab off for hair physics." } : {}; },
    withdraw() {
      history.focus(null);
      for (const row of Object.values(sessions)) if (row.active) change(row.id, { active: false, revision: row.revision + 1, phase: "off", result: null, settled: null, continuation: null, message: "" });
      demand();
    },
    bind(id: string, surface: HeadSurface, signal: AbortSignal) {
      const previous = sessions[id];
      const fits = (groom: Groom | null | undefined) => groom?.scalp.resource === surface.resource && groom?.scalp.topology === surface.topology;
      const document = (previous && fits(readGroom(previous)) ? previous.document : null) ?? [...documents.values()].find(item => fits(item.value))?.id ?? null;
      sessions = { ...sessions, [id]: { display: previous?.display ?? "cards", id, surface, document, active: previous?.active ?? false, revision: (previous?.revision ?? 0) + 1, phase: "off", message: "", result: null, settled: null, continuation: null } };
      notify();
      demand();
      signal.addEventListener("abort", () => { const next = { ...sessions }; delete next[id]; sessions = next; notify(); demand(); }, { once: true });
    },
    coverageState(id: string, state: "preparing" | "failed", message: string) {
      const row = sessions[id]; if (!row?.active) return;
      change(id, state === "failed" ? { phase: "failed", message, result: null, revision: row.revision + 1 } : { phase: "shaping", message });
    },
    observe,
    session: (id: string) => sessions[id],
  };
}
