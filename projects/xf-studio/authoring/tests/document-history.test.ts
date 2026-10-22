import { expect, test } from "bun:test";
import { createDocumentHistory } from "../src/platform/core/document-history";
import { createHistoryService } from "../src/platform/core/history-service";
import { HISTORY_LIMIT } from "../src/platform/api/history";
const step = (id: string, label = "Hair length") => ({ id, label, actionKind: "hairLab.set" });

test("global history reaches the focused document through its participant, keeps step identity and drops only its redo branch", () => {
  const service = createHistoryService(), book = service.documents;
  book.record("a", "Hair", step("one"), { before: 1, after: 2 });
  book.record("b", "Other groom", step("two", "Hair waves"), { before: 10, after: 20 });
  expect(book.move("b", -1)).toBe(10); expect(book.snapshot("b").steps[0].id).toBe("two"); expect(book.snapshot("a").current).toBe(0);
  // Without a participant (the experiment no longer shows the document) and no other editing context, global Undo has nowhere to go.
  expect(service.acting(service.focus.recent())).toBeNull();
  let moves = 0;
  service.participants(() => [{ id: "b", dispatch() { moves++; book.move("b", 0); return true; } }]);
  expect(service.acting(service.focus.recent())!.capability({ kind: "history.redo" }).available).toBe(true);
  expect(service.acting(service.focus.recent())!.command({ kind: "history.redo" })).toBe(true);
  expect(moves).toBe(1);
  expect(service.acting(service.focus.recent())!.timeline().documentLabel).toBe("Other groom");
  book.move("b", -1); book.record("b", "Other groom", step("three", "Hair volume"), { before: 10, after: 30 });
  expect(book.snapshot("b").steps.map(s => s.id)).toEqual(["three"]); expect(book.snapshot("a").steps.map(s => s.id)).toEqual(["one"]);
  expect(book.move("b", 0)).toBe(30); expect(book.move("b", -1)).toBe(10);
  book.focus(null); expect(service.acting(service.focus.recent())).toBeNull();
});

test("a step keeps the value after it: Undo, Redo and jumps hand back the value to restore, and a document without history has none", () => {
  const book = createDocumentHistory();
  expect(book.move("none", -1)).toBeUndefined();
  for (const [index, value] of ["b", "c", "d"].entries()) book.record("doc", "Doc", step(`s${index}`), { before: index ? "ignored" : "a", after: value });
  expect(book.move("doc", 1)).toBe("c"); expect(book.move("doc", -1)).toBe("a"); expect(book.move("doc", 2)).toBe("d");
  expect(book.move("doc", 9)).toBe("d"); expect(book.snapshot("doc").redoCount).toBe(0);
  expect(book.move("doc", 0)).toBe("b"); expect(book.snapshot("doc").steps.map(s => s.state)).toEqual(["done", "undone", "undone"]);
});

test("at the history limit the oldest step is dropped and its value becomes the start; undoing the newest brings it back", () => {
  const book = createDocumentHistory();
  for (let i = 0; i < HISTORY_LIMIT + 2; i++) book.record("doc", "Doc", step(`s${i}`), { before: i, after: i + 1 });
  const timeline = book.snapshot("doc");
  expect(timeline.steps.length).toBe(HISTORY_LIMIT); expect(timeline.trimmed).toBe(true); expect(timeline.steps[0].id).toBe("s2");
  expect(book.move("doc", -1)).toBe(2);
  // Undoing the step that displaced the oldest kept one brings that one back, as in the look's history.
  expect(book.snapshot("doc").steps.map(s => s.id).slice(0, 2)).toEqual(["s1", "s2"]);
  expect(book.move("doc", -1)).toBe(1);
  expect(book.move("doc", HISTORY_LIMIT)).toBe(HISTORY_LIMIT + 2);
});

test("a step's value is kept by reference, never copied, and every edit is a step (even one that changes nothing)", () => {
  const book = createDocumentHistory(), groom = { density: new Array(10_000).fill(0.5) }, edited = { ...groom, length: 1 };
  book.record("g", "Hair Lab", step("one"), { before: groom, after: edited });
  book.record("g", "Hair Lab", step("two"), { before: edited, after: edited });
  expect(book.snapshot("g").steps).toHaveLength(2);
  expect(book.move("g", -1)).toBe(groom);
  expect(book.move("g", 0)).toBe(edited);
});

test("subscribers hear every selection, record and move once", () => {
  const book = createDocumentHistory(); let heard = 0;
  const off = book.subscribe(() => heard++);
  book.record("doc", "Doc", step("s"), { before: 0, after: 1 }); book.move("doc", -1); book.focus(null); book.focus(null);
  expect(heard).toBe(3); off(); book.focus("doc"); expect(heard).toBe(3);
});
