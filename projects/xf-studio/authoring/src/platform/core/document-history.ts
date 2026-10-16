import type { AbortSignalLike, Environment } from "../api/graph";
import type { DocumentHistory, HistorySnapshot } from "../api/history";
import { HISTORY_LIMIT } from "../api/history";
/** Global commands select a document; each document's authored history stays isolated. */
export function documentHistory(env: Environment, signal: AbortSignalLike): DocumentHistory {
  const state = env.seed<{ selected: string | null; documents: Record<string, HistorySnapshot> }>({ initial: { selected: null, documents: {} }, signal });
  const snapshot = (id: string): HistorySnapshot => state.value()!.documents[id] ?? { startId: `${id}:start`, steps: [], current: -1, redoCount: 0, trimmed: false };
  return {
    selected: () => state.value()!.selected,
    focus(id) { env.observe(state, { ...state.value()!, selected: id }); },
    snapshot,
    record(id, documentLabel, entry) {
      const old = snapshot(id), kept = [...old.steps.slice(0, old.current + 1), { ...entry, state: "done" as const }], dropped = Math.max(0, kept.length - HISTORY_LIMIT), steps = kept.slice(dropped);
      env.observe(state, { selected: id, documents: { ...state.value()!.documents, [id]: { startId: old.startId, steps, current: steps.length - 1, redoCount: 0, trimmed: old.trimmed || dropped > 0, documentLabel } } });
    },
    move(id, current) {
      const old = snapshot(id), bounded = Math.max(-1, Math.min(old.steps.length - 1, current));
      const steps = old.steps.map((step, index) => ({ ...step, state: index <= bounded ? "done" as const : "undone" as const }));
      env.observe(state, { selected: id, documents: { ...state.value()!.documents, [id]: { ...old, steps, current: bounded, redoCount: steps.length - bounded - 1 } } });
    },
  };
}
