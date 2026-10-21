/**
 * The history stack (`platform/core/history-stack.ts`): one scope's linear steps. The look's cases (chunks, limit, Redo,
 * stored data) are in look-history.test.ts, which runs over the same class; these are the additions the other scopes need.
 */
import { expect, test } from "bun:test";
import type { HistoryParts } from "../src/platform/api/history";
import { HistoryStack, jsonValues, ReferenceStore, WHOLE_VALUES } from "../src/platform/core/history-stack";
import { LookHistory } from "../src/platform/core/look-history";

const label = (text: string) => ({ label: text, actionKind: text });
const whole = () => new HistoryStack(WHOLE_VALUES, 50, new ReferenceStore());

test("the look history is the history stack", () => {
  expect(LookHistory).toBe(HistoryStack);
});

test("a continuous edit coalesces into the unsealed top step, extending its keys, until it is sealed (CORE-95)", () => {
  const values: Record<string, unknown> = { a: 1, b: 10 }, stack = whole(), read = (key: string) => values[key];
  expect(stack.checkpoint(read, ["a"], { label: label("Drag"), coalesce: "drag" })).toBeDefined();
  values.a = 2;
  // The same run adds no step; a key the step does not hold yet joins it with its value before the run reached it.
  expect(stack.checkpoint(read, ["a", "b"], { label: label("Drag 2"), coalesce: "drag" })).toBeUndefined();
  values.a = 3; values.b = 11;
  expect(stack.depth).toBe(1);
  expect(stack.topLabel()).toEqual(label("Drag 2"));
  expect(stack.stepParts(0)).toEqual({ a: 1, b: 10 });
  stack.seal();
  expect(stack.checkpoint(read, ["a"], { coalesce: "drag" })).toBeDefined();
  expect(stack.depth).toBe(2);
  // A different step ends the run too: the same key afterwards starts a step of its own.
  stack.checkpoint(read, ["b"], { coalesce: "other" });
  values.b = 12;
  expect(stack.checkpoint(read, ["a"], { coalesce: "drag" })).toBeDefined();
  expect(stack.depth).toBe(4);
  // Undo and Redo end the run.
  stack.undo(read);
  expect(stack.checkpoint(read, ["a"], { coalesce: "drag" })).toBeDefined();
});

test("clear drops every step, Redo and the record of dropped ones", () => {
  const values: Record<string, unknown> = { a: 0 }, stack = new HistoryStack(WHOLE_VALUES, 2, new ReferenceStore()), read = (key: string) => values[key];
  for (let i = 1; i <= 4; i++) { stack.checkpoint(read, ["a"]); values.a = i; }
  stack.undo(read);
  expect([stack.depth, stack.redoDepth, stack.trimmed]).toEqual([2, 1, true]);
  stack.clear();
  expect([stack.depth, stack.redoDepth, stack.trimmed, stack.stats().chunks]).toEqual([0, 0, false, 0]);
});

test("a reference store keeps values whole and uncopied, and shares a chunk between equal references", () => {
  const big = { density: new Array(50_000).fill(0.25) }, store = new ReferenceStore(), stack = new HistoryStack(WHOLE_VALUES, 80, store);
  let current: unknown = big;
  stack.checkpoint(() => current, ["groom"]);
  current = { ...big, length: 1 };
  expect(stack.stepParts(0)!.groom).toBe(big);
  expect(store.stats()).toEqual({ chunks: 1, units: 0 });
  // The same reference again is recognised as the top step's content.
  current = big;
  expect(stack.checkpoint(() => current, ["groom"])).toBeUndefined();
  // A distinct step is added on request even then (a document records every edit).
  expect(stack.checkpoint(() => current, ["groom"], { distinct: true })).toBeDefined();
  expect(stack.undo(() => current, 2)!.parts.groom).toBe(big);
});

test("a JSON store keeps the look's stored form: equal chunks once, values parsed back as copies", () => {
  const parts: HistoryParts = { chunks: (_feature, body) => (body as number[]).map(value => ({ value })), join: (_feature, chunks) => chunks.map(chunk => (chunk as { value: number }).value) };
  const stack = new HistoryStack(parts, 80, jsonValues());
  let body = [1, 1, 2];
  stack.checkpoint(() => body, ["f"]);
  body = [3];
  expect(stack.stats().chunks).toBe(2);
  const data = stack.data();
  expect(Object.values(data.chunks)).toEqual([{ value: 1 }, { value: 2 }]);
  expect(HistoryStack.fromData(parts, data).stepParts(0)).toEqual({ f: [1, 1, 2] });
});

test("a step's time is optional", () => {
  const stack = whole();
  stack.checkpoint(() => 1, ["a"], { timed: false });
  expect(stack.list()[0].at).toBeUndefined();
  stack.checkpoint(() => 2, ["a"]);
  expect(typeof stack.list()[1].at).toBe("number");
});

test("a step recorded as distinct keeps its identity through Undo and Redo", () => {
  let value: unknown = "A";
  const stack = whole(), read = () => value, B = "B";
  stack.checkpoint(read, ["d"], { distinct: true }); value = B;
  stack.checkpoint(read, ["d"], { distinct: true });
  const last = stack.checkpoint(read, ["d"], { distinct: true })!;
  expect(stack.depth).toBe(3);
  stack.undo(read);
  expect(stack.redo(read)?.pushed).toBe(1);
  expect([stack.depth, stack.topId]).toEqual([3, last]);
});
