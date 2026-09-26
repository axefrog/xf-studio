import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HISTORY_START_ID, type HistorySnapshot } from "../src/authoring-history";
import { shortcutLabel } from "../src/input-bindings";
import { ACTION_DESCRIPTORS } from "../src/studio-action-descriptors";
import { HISTORY_SCOPE, historyCommandLabel, historyCommandTitle, historyRows, historySummary, HISTORY_TRIMMED_NOTE, jumpable,
  jumpAnnouncement } from "../src/studio-ui/history-model";
import { defaultCompact, defaultWide } from "../src/studio-ui/layout-defaults";
import { PANEL_IDS, STUDIO_CATALOGUE } from "../src/compose/views";
import { locate } from "../src/studio-ui/dock/layout";
import { PANEL_META } from "../src/studio-ui/panel-meta";
import { activitySource } from "../src/studio-ui/views/contribution";
const sourceLabel = (kind: string) => activitySource(kind, STUDIO_CATALOGUE);

const root = resolve(import.meta.dir, "..");
const timeline = (patch: Partial<HistorySnapshot> = {}): HistorySnapshot => ({ startId: HISTORY_START_ID, steps: [
  { id: "step-1", label: "Colour", actionKind: "layer.setColor", layerId: "a", at: 1, state: "done" },
  { id: "step-2", label: "Move point", actionKind: "gesture.point.replace", layerId: "a", at: 2, state: "done" },
  { id: "step-3", label: "Opacity", actionKind: "layer.setOpacity", state: "undone" }], current: 1, redoCount: 1, trimmed: false, ...patch });

test("history rows: a start row, done steps, the current step and dimmed undone steps, oldest first", () => {
  const rows = historyRows(timeline(), at => `t${at}`);
  expect(rows.map(row => [row.id, row.label, row.kind, row.time])).toEqual([
    [HISTORY_START_ID, "Start", "start", undefined], ["step-1", "Colour", "done", "t1"],
    ["step-2", "Move point", "current", "t2"], ["step-3", "Opacity", "undone", undefined]]);
  expect(rows.filter(jumpable).map(row => row.id)).toEqual([HISTORY_START_ID, "step-1", "step-3"]);
  expect(rows[2].description).toBe("Step 2: Move point at t2, current");
  expect(rows[3].description).toBe("Step 3: Opacity, undone (can be redone)");
  // At the oldest kept state the start row is current; trimmed histories name it honestly.
  const start = historyRows(timeline({ current: -1, trimmed: true }))[0];
  expect(start).toMatchObject({ kind: "current", label: "Oldest kept version" });
  expect(historyRows(timeline({ steps: [], current: -1, redoCount: 0 }))).toHaveLength(1);
  expect(HISTORY_TRIMMED_NOTE).toBe("Older steps were not kept");
});

test("history wording: summary, announcements and Undo/Redo titles that name the step and shortcut", () => {
  expect(historySummary(timeline())).toBe("3 steps · 1 undone");
  expect(historySummary(timeline({ steps: [], current: -1, redoCount: 0 }))).toBe("No changes yet");
  const rows = historyRows(timeline());
  expect(jumpAnnouncement(rows[0])).toBe("Went back to start");
  expect(jumpAnnouncement(rows[1])).toBe("Went back to: Colour");
  expect(jumpAnnouncement(rows[3])).toBe("Redid up to: Opacity");
  const redo = shortcutLabel("shell.redo"), undo = shortcutLabel("shell.undo");
  // Each title also says what the header's Undo covers: the makeup, not the Character panel's changes (UI-81).
  expect(historyCommandTitle("redo", { available: true }, "Move point", redo)).toBe(`Redo: Move point (${redo})\n${HISTORY_SCOPE}`);
  expect(historyCommandTitle("undo", { available: true }, "Opacity", undo)).toBe(`Undo: Opacity (${undo})\n${HISTORY_SCOPE}`);
  expect(HISTORY_SCOPE).toContain("Character panel");
  // Unavailable commands still show their shortcut, so Redo is discoverable before it can be used.
  expect(historyCommandTitle("redo", { available: false, reason: "There is no undone change to redo." }, undefined, redo))
    .toBe(`Redo (${redo}) — There is no undone change to redo.\n${HISTORY_SCOPE}`);
  expect(historyCommandLabel("redo", { available: true }, "Move point")).toBe("Redo: Move point");
  expect(historyCommandLabel("redo", { available: false }, "Move point")).toBe("Redo");
});

test("history.jumpTo is a catalogued workspace action and the History panel is registered everywhere", () => {
  expect(ACTION_DESCRIPTORS["history.jumpTo"]).toMatchObject({ scope: ["workspace"], effect: "content", undo: "none",
    payload: { entryId: { type: "string", required: true, from: "input" } } });
  expect(sourceLabel("history.jumpTo")).toBe("History");
  expect(PANEL_IDS).toContain("history");
  expect(PANEL_META.history).toMatchObject({ title: "History", icon: "history" });
  // A tab beside Layers in both size classes, behind Layers.
  for (const tree of [defaultWide(STUDIO_CATALOGUE), defaultCompact(STUDIO_CATALOGUE)]) {
    const at = locate(tree, "history")!;
    expect(at.group.panels).toContain("layers");
    expect(at.group.active).toBe("layers");
  }
  const catalogue = readFileSync(resolve(root, "../../../research/authoring/ui-action-catalogue.md"), "utf8");
  for (const name of ["history.jumpTo", "historyTimeline()"]) expect(catalogue).toContain(name);
  // The panel reaches the core only through the port: one typed action, read-only snapshots.
  const panel = readFileSync(resolve(root, "src/studio-ui/panels/history.ts"), "utf8");
  expect(panel).toContain(`kind: "history.jumpTo"`);
  expect(panel).not.toMatch(/import (?!type)[^;]*from "\.\.\/\.\.\/(authoring-|editor-actions|studio-application)/);
  // The shell's view contribution binds it (views/panels.ts); the shell mounts every contributed panel.
  const factories = readFileSync(resolve(root, "src/studio-ui/views/panels.ts"), "utf8");
  expect(factories).toContain("history: historyPanel");
});
