import type { Capability } from "../api/capability";
import type { ExperimentPort } from "../api/experiments";
import type { HistoryCommand, HistorySnapshot, HistoryState } from "../api/history";
const historyCommand = (action: { kind: string }): action is HistoryCommand => ["history.undo", "history.redo", "history.jumpTo"].includes(action.kind);
/** Generic application routing; feature identities and document contents never enter the shell. */
export function routeDocumentHistory(base: { state(): HistoryState; timeline(): HistorySnapshot }, experiments?: ExperimentPort) {
  const target = () => { const id = experiments?.history?.selected(); return id ? experiments?.registrations().flatMap(r => r.histories?.() ?? []).find(p => p.id === id) : undefined; };
  const timeline = () => { const selected = target(); return selected ? experiments!.history!.snapshot(selected.id) : base.timeline(); };
  const signature = () => { const t = base.timeline(); return `${t.startId}:${t.current}:${t.steps.map(s => s.id).join(",")}`; };
  return {
    timeline,
    state(): HistoryState { if (!target()) return base.state(); const t = timeline(); return { undo: t.steps[t.current], redo: t.steps[t.current + 1], depth: t.current + 1, redoDepth: t.redoCount }; },
    capability(action: { kind: string }): Capability | undefined {
      if (!historyCommand(action) || !target()) return;
      const t = timeline(), available = action.kind === "history.undo" ? t.current >= 0 : action.kind === "history.redo" ? t.redoCount > 0 : action.entryId === t.startId || t.steps.some(s => s.id === action.entryId);
      return available ? { available: true } : { available: false, code: "unavailable", reason: "There is no matching change in this document." };
    },
    execute(action: { kind: string }): { ok: true } | { ok: false; code: string; message: string } | undefined {
      if (!historyCommand(action)) return; const selected = target(); if (!selected) return;
      return selected.dispatch(action) ? { ok: true } : { ok: false, code: "unavailable", message: "That history step could not be applied." };
    },
    baseChange<T>(work: () => T): T { const before = signature(), result = work(); if (signature() !== before) experiments?.history?.focus(null); return result; },
    hint(action: { kind: string }): string | undefined { return experiments?.registrations().map(r => r.actionHints?.()[action.kind]).find(Boolean); },
  };
}
