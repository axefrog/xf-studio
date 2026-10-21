import type { DocumentHistory, HistorySnapshot } from "../api/history";
import { HISTORY_LIMIT } from "../api/history";

/** One document's history: the metadata the History panel shows, the value before its first kept step, and each step's value after it. */
type Entry = { snapshot: HistorySnapshot; start: unknown; after: unknown[] };

/**
 * The document history (`DocumentHistory`): global commands select a document, and each document's history stays
 * isolated. At the history limit a new step drops the oldest, whose value after it becomes the start.
 */
export function createDocumentHistory(): DocumentHistory {
  let selected: string | null = null;
  const documents = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of [...listeners]) listener(); };
  const snapshot = (id: string): HistorySnapshot => documents.get(id)?.snapshot ?? { startId: `${id}:start`, steps: [], current: -1, redoCount: 0, trimmed: false };
  return {
    selected: () => selected,
    focus(id) { if (selected === id) return; selected = id; changed(); },
    snapshot,
    record(id, documentLabel, entry, change) {
      const old = documents.get(id), base = snapshot(id), keep = base.current + 1;
      const steps = [...base.steps.slice(0, keep), { ...entry, state: "done" as const }];
      const after = [...(old?.after.slice(0, keep) ?? []), change.after];
      let start = old ? old.start : change.before;
      const dropped = Math.max(0, steps.length - HISTORY_LIMIT);
      if (dropped) start = after[dropped - 1];
      documents.set(id, { start, after: after.slice(dropped), snapshot: { startId: base.startId, steps: steps.slice(dropped), current: steps.length - dropped - 1, redoCount: 0,
        trimmed: base.trimmed || dropped > 0, documentLabel } });
      selected = id; changed();
    },
    move(id, current) {
      const old = documents.get(id);
      if (!old) return undefined;
      const bounded = Math.max(-1, Math.min(old.snapshot.steps.length - 1, current));
      const steps = old.snapshot.steps.map((step, index) => ({ ...step, state: index <= bounded ? "done" as const : "undone" as const }));
      documents.set(id, { ...old, snapshot: { ...old.snapshot, steps, current: bounded, redoCount: steps.length - bounded - 1 } });
      selected = id; changed();
      return bounded < 0 ? old.start : old.after[bounded];
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
