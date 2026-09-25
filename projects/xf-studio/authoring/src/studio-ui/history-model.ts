import type { HistorySnapshot } from "../authoring-history";
import type { StudioCapability } from "../studio-application";

/**
 * Pure presentation logic for the History panel and the Undo/Redo entry points: rows,
 * wording and tooltips derived from the read-only history snapshot. No DOM.
 */
export type HistoryRow = {
  /** Jump target passed to `history.jumpTo`. */
  id: string;
  label: string;
  /** `start` is the oldest kept state; `done` and `current` are in the look; `undone` can be redone. */
  kind: "start" | "done" | "current" | "undone";
  /** Short time of the change, when known. */
  time?: string;
  /** Screen-reader description of the row. */
  description: string;
};

export const HISTORY_TRIMMED_NOTE = "Older steps were not kept";

export function historyRows(timeline: HistorySnapshot, formatTime: (at: number) => string = defaultTime): HistoryRow[] {
  const atStart = timeline.current < 0;
  const start: HistoryRow = { id: timeline.startId, label: timeline.trimmed ? "Oldest kept version" : "Start",
    kind: atStart ? "current" : "start",
    description: `${timeline.trimmed ? "Oldest kept version" : "Start"}, before the first step${atStart ? ", current" : ""}` };
  return [start, ...timeline.steps.map((step, index): HistoryRow => {
    const kind = index === timeline.current ? "current" : step.state === "undone" ? "undone" : "done";
    const time = step.at === undefined ? undefined : formatTime(step.at);
    const state = kind === "current" ? ", current" : kind === "undone" ? ", undone (can be redone)" : "";
    return { id: step.id, label: step.label, kind, ...(time ? { time } : {}),
      description: `Step ${index + 1}: ${step.label}${time ? ` at ${time}` : ""}${state}` };
  })];
}

/** The rows a click can reach (every row except the current one). */
export const jumpable = (row: HistoryRow) => row.kind !== "current";

/** One-line summary for the panel head: "3 steps · 1 undone". */
export function historySummary(timeline: HistorySnapshot) {
  const steps = timeline.steps.length;
  if (!steps) return "No changes yet";
  return `${steps} ${steps === 1 ? "step" : "steps"}${timeline.redoCount ? ` · ${timeline.redoCount} undone` : ""}`;
}

/**
 * Tooltip and palette title for Undo or Redo, naming what it would change:
 * "Redo: Move point (Ctrl+Shift+Z)", or why it is unavailable with the shortcut still shown.
 */
export function historyCommandTitle(command: "undo" | "redo", capability: StudioCapability, label: string | undefined, shortcut: string) {
  const name = command === "undo" ? "Undo" : "Redo";
  if (!capability.available) return `${name} (${shortcut}) — ${capability.reason ?? "Unavailable."}`;
  return `${name}${label ? `: ${label}` : ""} (${shortcut})`;
}
/** Palette/menu wording without the shortcut, which those surfaces show separately. */
export function historyCommandLabel(command: "undo" | "redo", capability: StudioCapability, label: string | undefined) {
  const name = command === "undo" ? "Undo" : "Redo";
  return capability.available && label ? `${name}: ${label}` : name;
}

/** What to announce after a jump. */
export function jumpAnnouncement(row: HistoryRow) {
  return row.kind === "start" ? `Went back to ${row.label.toLowerCase()}` :
    row.kind === "undone" ? `Redid up to: ${row.label}` : `Went back to: ${row.label}`;
}

function defaultTime(at: number) {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
