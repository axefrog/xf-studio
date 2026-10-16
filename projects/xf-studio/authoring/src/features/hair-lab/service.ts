import { Aborter, erector, standardOperators } from "../../platform/api/graph";
import type { AbortSignalLike, GraphModel, Json, NodeRef, Process } from "../../platform/api/graph";
import type { ModuleService } from "../../platform/api";
import type { ExperimentContext } from "../../platform/api/graph";
import { constant } from "./fields";
import { validateGroom } from "./groom";
import type { Groom, HeadSurface, Paths, Residuals } from "./types";
import type { HistoryCommand, HistoryParticipant } from "../../platform/api/history";

export type HairDisplay = "combined" | "strands" | "scalp" | "reference" | "reference-scalp" | "volumes" | "cards";
export type HairAction = { kind: "hairLab.preview"; target: string; display: HairDisplay } | { kind: "hairLab.activate"; target: string; active: boolean } | { kind: "hairLab.set"; target: string; field: "length" | "waves" | "spread"; value: number }
  | { kind: "hairLab.undo" | "hairLab.redo" | "hairLab.retry"; target: string };
export type Continuation = { groom: Groom; paths: Paths };
export type Generation = { groom: Groom; paths: Paths; uncutPaths?: Paths; continuation?: boolean; residuals: Residuals | null; stage: "coarse" | "refined"; milliseconds: Record<string, number>; volumes?: import("./volumes").Volumes; volumeGeometry?: ReturnType<typeof import("./volumes").volumeMesh>; cards?: import("./cards").CardMesh; occlusion?: ReturnType<typeof import("./occlusion").bakeOcclusion>["statistics"]; cardContact?: { minimumClearanceMetres: number; penetrationMetres: number }; coverageGeometry?: { positions: number[]; indices: number[]; uv: number[] } | null; coverage?: { width: number; height: number; values: string }; tintCheck?: ReturnType<typeof import("./scalp").densityCoverage> };
export type GenerationDevice = { generate(target: string, surface: HeadSurface, groom: Groom | null, signal: AbortSignalLike, publish: (result: Generation) => void, previous?: Continuation | null): Promise<void> };
type Session = { display: HairDisplay; id: string; active: boolean; surface: HeadSurface; document: NodeRef | null; revision: number; phase: "off" | "shaping" | "settling" | "ready" | "failed"; message: string; result: Generation | null; settled: Continuation | null; continuation: Continuation | null };
export type HairLabSnapshot = { sessions: readonly (Session & { groom: Groom | null })[] };
export type HairLabFacade = ModuleService & { snapshot(): HairLabSnapshot; dispatch(action: HairAction): Promise<{ ok: boolean; message?: string }> };

/** Authored content lives in its own event stream. Session observations and results remain session streams. */
export function createHairLab(context: ExperimentContext, device: GenerationDevice) {
  const { env, graph } = context, life = new Aborter(context.signal);
  const sessions = env.seed<Record<string, Session>>({ initial: {}, signal: life.signal });
  const request = env.seed<number>({ initial: 0, signal: life.signal });
  const change = (id: string, update: Partial<Session>) => { const row = sessions.value()![id]; if (row) env.observe(sessions, { ...sessions.value(), [id]: { ...row, ...update } }); };
  const demand = () => env.observe(request, (request.value() ?? 0) + 1);
  const jobs = new Map<string, { revision: number; process: Process }>();
  const readGroom = (row: Session): Groom | null => row.document ? graph.resolve(row.document, ["document"]) as unknown as Groom : null;
  const model: GraphModel = { nodes: [{ id: "maintain", kind: "driver", op: "maintain-hair" }] };
  const modelNode = env.seed<GraphModel>({ initial: model, signal: life.signal });
  const erected = erector(env, modelNode, { ...standardOperators, "maintain-hair": { kind: "driver", create: () => ({ name: "Maintain Hair Lab requests", start(run) {
    run.effect({ inputs: [request], run: () => {
      for (const [id, job] of jobs) { const row = sessions.value()![id]; if (!row?.active || row.revision !== job.revision) { job.process.abort("newer hair request"); jobs.delete(id); } }
      for (const row of Object.values(sessions.value()!)) {
        if (!row.active || jobs.has(row.id)) continue;
        const revision = row.revision, id = row.id;
        change(id, { phase: "shaping", message: "Shaping hair…", result: null });
        const job = run.spawn("Generate requested groom", async (signal, progress): Promise<Json> => {
          try {
            let rejected: string | null = null;
            await device.generate(id, row.surface, readGroom(row), signal, result => {
              const latest = sessions.value()![id];
              if (signal.aborted || !latest?.active || latest.revision !== revision) return;
              if (rejected) return;
              if (result.stage === "refined") {
                const r = result.residuals;
                if (!r || !r.curvature || !result.paths.paths.length || ![r.rootMetres, r.lengthRatio, r.penetrationMetres, r.minimumClearanceMetres, ...Object.values(r.curvature)].every(Number.isFinite) || r.rootMetres > 1e-6 || r.lengthRatio > .02 || r.penetrationMetres > .00005 || r.curvature.maximumPerMetre > 350 || r.curvature.maximumTurnRadians > 1.65 || r.curvature.maximumJumpPerMetre > 250 || r.colliders?.some(c => !Number.isFinite(c.minimumClearanceMetres) || c.penetrationMetres > .00005)) {
                  rejected = "The refined result failed its attachment, intrinsic-length, contact or smoothness gate.";
                  change(id, { phase: "failed", result: null, settled: null, message: "Couldn't settle this groom. Try again, or turn Hair Lab off to use your usual hairstyle." });
                  progress({ stage: "rejected", revision }); return;
                }
              }
              let document = latest.document;
              if (!document) {
                const created = graph.commit([{ op: "create", type: "experiment-document", as: "groom", fields: { module: "hair-lab", document: result.groom as unknown as Json } }], { scope: `hair:${id}`, label: "Create groom" });
                if (!created.ok) throw Error(created.message);
                document = created.created.groom;
              }
              change(id, { document, result, ...(result.stage === "refined" ? { settled: { groom: result.groom, paths: result.groom.cut ? result.paths : result.uncutPaths ?? result.paths } } : {}), phase: result.stage === "coarse" ? "settling" : "ready", message: result.stage === "coarse" ? "Settling hair…" : "Ready" });
              progress({ stage: result.stage, revision });
            }, row.continuation);
            if (rejected) return { error: rejected };
            return { scene: id, revision };
          } catch (error) {
            const latest = sessions.value()![id];
            if (!signal.aborted && latest?.revision === revision) change(id, { phase: "failed", result: null, message: "Couldn't shape this groom. Try again, or turn Hair Lab off to use your usual hairstyle." });
            return { error: error instanceof Error ? error.message : "Hair generation failed." };
          }
        });
        jobs.set(id, { revision, process: job });
      }
    } });
    run.signal.addEventListener("abort", () => { for (const job of jobs.values()) job.process.abort(); jobs.clear(); });
  } }) } });
  erected.driver.start(life.signal);
  (erected.live("maintain") as import("../../platform/api/graph").Driver).start(life.signal, { reason: "active Hair Lab scene", goal: "matching generated hair shown" });
  function observe(signal: AbortSignalLike, listener: () => void) {
    const driver = env.driver({ name: "Observe Hair Lab", start(run) { run.effect({ inputs: [sessions], run: () => listener() }); } }, undefined, signal);
    driver.start(signal);
  }
  const refreshDocument = (groomRef: NodeRef) => {
    for (const row of Object.values(sessions.value()!)) if (row.document?.id === groomRef.id) change(row.id, { revision: row.revision + 1, continuation: row.settled });
    demand();
  };
  function moveHistory(groomRef: NodeRef, action: HistoryCommand): boolean {
    const scope = `hair:${groomRef.id}`, timeline = context.history?.snapshot(scope);
    const desired = action.kind === "history.undo" ? (timeline?.current ?? 0) - 1 : action.kind === "history.redo" ? (timeline?.current ?? -1) + 1 : action.entryId === timeline?.startId ? -1 : timeline?.steps.findIndex(step => step.id === action.entryId);
    if (desired === undefined || timeline && (desired < -1 || desired >= timeline.steps.length) || action.kind === "history.jumpTo" && desired === -1 && action.entryId !== timeline?.startId) return false;
    let current = timeline?.current ?? (action.kind === "history.undo" ? 0 : -1), changed = false;
    while (current !== desired) {
      const result = current > desired ? graph.undo(scope) : graph.redo(scope);
      if (!result.ok) { if (changed) refreshDocument(groomRef); return false; }
      current += current > desired ? -1 : 1; context.history?.move(scope, current); changed = true;
    }
    if (changed) refreshDocument(groomRef); return true;
  }
  const facade: HairLabFacade = {
    module: "hair-lab", snapshot: () => ({ sessions: Object.values(sessions.value()!).map(row => Object.freeze({ ...row, groom: readGroom(row) })) }),
    capability: () => ({ available: true }),
    async dispatch(action: HairAction) {
      const row = sessions.value()![action.target]; if (!row) return { ok: false, message: "Open a 3D view first." };
      if (action.kind === "hairLab.preview") {
        if (!["combined", "strands", "scalp", "reference", "reference-scalp", "volumes", "cards"].includes(action.display)) return { ok: false, message: "Choose a supported preview." };
        change(row.id, { display: action.display }); return { ok: true };
      }
      if (action.kind === "hairLab.activate") {
        change(row.id, { active: action.active, revision: row.revision + 1, phase: "off", result: null, settled: null, continuation: null, message: "" }); demand(); return { ok: true };
      }
      if (action.kind === "hairLab.retry") { change(row.id, { revision: row.revision + 1, continuation: null, settled: null }); demand(); return { ok: true }; }
      if (!row.document) return { ok: false, message: "Turn Hair Lab on to create a groom first." };
      const scope = `hair:${row.document.id}`;
      if (action.kind === "hairLab.set") {
        const groom = readGroom(row)!;
        const limits = { length: [.08, .85], waves: [0, .035], spread: [0, .065] };
        const [lo, hi] = limits[action.field] ?? [Infinity, -Infinity];
        if (!Number.isFinite(action.value) || action.value < lo || action.value > hi) return { ok: false, message: "Choose a value within the slider's range." };
        const edited = { ...groom, fields: { ...groom.fields, [action.field]: constant(action.value, "m") } };
        const issues = validateGroom(edited); if (issues.length) return { ok: false, message: "That change couldn't be used. Undo it and try another value." };
        const label = `Hair ${{ length: "length", waves: "waves", spread: "volume" }[action.field]}`;
        const result = graph.commit([{ op: "set", node: row.document, path: ["document"], value: edited as unknown as Json }], { scope, label, action: action.kind });
        if (!result.ok) return { ok: false, message: result.message };
        context.history?.record(scope, "Hair Lab", { id: result.commit, label, actionKind: action.kind });
      } else {
        return moveHistory(row.document, { kind: action.kind === "hairLab.undo" ? "history.undo" : "history.redo" }) ? { ok: true } : { ok: false, message: "There is no hair change to undo or redo." };
      }
      refreshDocument(row.document); return { ok: true };
    },
    subscribe(listener) { const token = new Aborter(life.signal); observe(token.signal, listener); return () => token.abort(); },
  };
  return {
    facade,
    histories(): HistoryParticipant[] {
      const documents = new Map(Object.values(sessions.value()!).flatMap(row => row.document ? [[row.document.id, row.document] as const] : []));
      return [...documents.values()].map(groomRef => ({ id: `hair:${groomRef.id}`, dispatch: action => moveHistory(groomRef, action) }));
    },
    actionHints(): Readonly<Record<string, string>> { return Object.values(sessions.value()!).some(row => row.active) ? { "motion.setPhysics": "Turn Hair Lab off for hair physics." } : {}; },
    withdraw() {
      for (const row of Object.values(sessions.value()!)) if (row.active) change(row.id, { active: false, revision: row.revision + 1, phase: "off", result: null, settled: null, continuation: null, message: "" });
      demand();
    },
    bind(id: string, surface: HeadSurface, signal: AbortSignalLike) {
      const previous = sessions.value()![id];
      const previousGroom = previous ? readGroom(previous) : null;
      const document = (previousGroom?.scalp.resource === surface.resource && previousGroom?.scalp.topology === surface.topology ? previous?.document : null) ?? graph.list().find(ref => ref.type === "experiment-document" && graph.resolve(ref, ["module"]) === "hair-lab" &&
        (graph.resolve(ref, ["document"]) as unknown as Groom)?.scalp.resource === surface.resource && (graph.resolve(ref, ["document"]) as unknown as Groom)?.scalp.topology === surface.topology) ?? null;
      env.observe(sessions, { ...sessions.value(), [id]: { display: previous?.display ?? "cards", id, surface, document, active: previous?.active ?? false, revision: (previous?.revision ?? 0) + 1, phase: "off", message: "", result: null, settled: null, continuation: null } });
      demand();
      signal.addEventListener("abort", () => { const next = { ...sessions.value() }; delete next[id]; env.observe(sessions, next); demand(); });
    },
    coverageState(id: string, state: "preparing" | "failed", message: string) {
      const row = sessions.value()![id]; if (!row?.active) return;
      change(id, state === "failed" ? { phase: "failed", message, result: null, revision: row.revision + 1 } : { phase: "shaping", message });
    },
    observe,
    session: (id: string) => sessions.value()?.[id],
  };
}
