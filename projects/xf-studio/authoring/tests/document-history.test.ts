import { expect, test } from "bun:test";
import { createDocumentHistory } from "../src/platform/core/document-history";
import { routeDocumentHistory } from "../src/platform/core/document-history-routing";
import { HISTORY_LIMIT } from "../src/platform/api/history";
const step = (id: string, label = "Hair length") => ({ id, label, actionKind: "hairLab.set" });
const empty = { startId: "base", steps: [], current: -1, redoCount: 0, trimmed: false };
const experimentsWith = (history: ReturnType<typeof createDocumentHistory>, participants: { id: string; dispatch(): boolean }[]) =>
  ({ history, snapshot: () => [], set: async () => ({ ok: true }), subscribe: () => () => {}, registrations: () => [{ histories: () => participants } as any] });

test("global history routes independent documents, preserves step identity through Undo and drops only their redo branch", () => {
  const book = createDocumentHistory();
  book.record("a", "Hair", step("one"), { before: 1, after: 2 });
  book.record("b", "Other groom", step("two", "Hair waves"), { before: 10, after: 20 });
  expect(book.move("b", -1)).toBe(10); expect(book.snapshot("b").steps[0].id).toBe("two"); expect(book.snapshot("a").current).toBe(0);
  const participant = { id: "b", dispatch() { book.move("b", 0); return true; } };
  const route = routeDocumentHistory({ state: () => ({ depth: 0, redoDepth: 0 }), timeline: () => empty }, experimentsWith(book, [participant]));
  expect(route.capability({ kind: "history.redo" })?.available).toBe(true); expect(route.execute({ kind: "history.redo" })?.ok).toBe(true);
  expect(route.timeline().documentLabel).toBe("Other groom");
  book.move("b", -1); book.record("b", "Other groom", step("three", "Hair volume"), { before: 10, after: 30 });
  expect(book.snapshot("b").steps.map(s => s.id)).toEqual(["three"]); expect(book.snapshot("a").steps.map(s => s.id)).toEqual(["one"]);
  expect(book.move("b", 0)).toBe(30); expect(book.move("b", -1)).toBe(10);
  book.focus(null); expect(route.timeline()).toEqual(empty);
});

test("a step keeps the value after it: Undo, Redo and jumps hand back the value to restore, and a document without history has none", () => {
  const book = createDocumentHistory();
  expect(book.move("none", -1)).toBeUndefined();
  for (const [index, value] of ["b", "c", "d"].entries()) book.record("doc", "Doc", step(`s${index}`), { before: index ? "ignored" : "a", after: value });
  expect(book.move("doc", 1)).toBe("c"); expect(book.move("doc", -1)).toBe("a"); expect(book.move("doc", 2)).toBe("d");
  expect(book.move("doc", 9)).toBe("d"); expect(book.snapshot("doc").redoCount).toBe(0);
  expect(book.move("doc", 0)).toBe("b"); expect(book.snapshot("doc").steps.map(s => s.state)).toEqual(["done", "undone", "undone"]);
});

test("at the history limit the oldest step is dropped and its value becomes the start", () => {
  const book = createDocumentHistory();
  for (let i = 0; i < HISTORY_LIMIT + 2; i++) book.record("doc", "Doc", step(`s${i}`), { before: i, after: i + 1 });
  const timeline = book.snapshot("doc");
  expect(timeline.steps.length).toBe(HISTORY_LIMIT); expect(timeline.trimmed).toBe(true); expect(timeline.steps[0].id).toBe("s2");
  expect(book.move("doc", -1)).toBe(2); expect(book.move("doc", HISTORY_LIMIT - 1)).toBe(HISTORY_LIMIT + 2);
});

test("subscribers hear every selection, record and move", () => {
  const book = createDocumentHistory(); let heard = 0;
  const off = book.subscribe(() => heard++);
  book.record("doc", "Doc", step("s"), { before: 0, after: 1 }); book.move("doc", -1); book.focus(null); book.focus(null);
  expect(heard).toBe(3); off(); book.focus("doc"); expect(heard).toBe(3);
});

test("flag-off work builds no history timeline and a selected document respects base busy state", async () => {
  let reads = 0, calls = 0;
  const route = routeDocumentHistory({ state: () => ({ depth: 0, redoDepth: 0 }), timeline: () => { reads++; return empty; } });
  expect(route.baseChange(() => ++calls)).toBe(1); expect(reads).toBe(0);
  expect(await route.baseRequest(async () => ++calls)).toBe(2); expect(reads).toBe(0);
  const book = createDocumentHistory();
  book.record("a", "Hair Lab", step("step", "Hair waves"), { before: 0, after: 1 });
  const busy = routeDocumentHistory({ state: () => ({ depth: 0, redoDepth: 0 }), timeline: () => empty, capability: () => ({ available: false, code: "busy", reason: "Finish adjustment." }) },
    experimentsWith(book, [{ id: "a", dispatch() { calls++; return true; } }]));
  expect(busy.capability({ kind: "history.undo" })?.code).toBe("busy"); expect(busy.execute({ kind: "history.undo" })?.ok).toBe(false); expect(calls).toBe(2);
});
