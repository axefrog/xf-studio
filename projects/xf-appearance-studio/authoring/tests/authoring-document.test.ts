import { expect, test } from "bun:test";
import { AuthoringDocument } from "../src/authoring-document";
import { WorkspacePersistence } from "../src/workspace-persistence";
import { freshWorkspace, workspaceKeys } from "../src/workspace-state";

test("authoring document owns selection and Undo, and exposes detached snapshots", () => {
  const workspace = freshWorkspace();
  const document = new AuthoringDocument(workspace);
  const changes: string[] = [];
  document.subscribe(change => changes.push(change));
  const original = document.recipe.layers[0].color;
  document.checkpoint();
  document.recipe.layers[0].color = "#123456";
  document.gestureChanged();
  const snapshot = document.snapshot();
  expect(snapshot.recipe.layers[0].color).toBe("#123456");
  workspace.recipe.layers[0].color = "#abcdef";
  expect(document.recipe.layers[0].color).toBe("#123456");
  (snapshot.recipe.layers[0] as { color: string }).color = "#fedcba";
  expect(document.recipe.layers[0].color).toBe("#123456");
  expect(document.canUndo).toBe(true);
  expect(document.undoRecipe()?.layers[0].color).toBe(original);
  expect(document.canUndo).toBe(false);
  expect(changes).toEqual(["history", "recipe", "history"]);
});

test("authoring restore is atomic and validates recipe/history before publishing", () => {
  const document = new AuthoringDocument(freshWorkspace());
  const changes: string[] = [];
  document.subscribe(change => changes.push(change));
  const prior = document.snapshot();
  const invalid = { ...document.export(), history: [{}] };
  expect(() => document.restore(invalid as never)).toThrow();
  expect(document.snapshot()).toEqual(prior);
  expect(changes).toEqual([]);
  const next = document.export();
  next.active = 999; next.selected = 999;
  document.restore(next);
  expect(document.active).toBe(next.recipe.layers.length - 1);
  expect(document.selected).toBe(next.recipe.layers.at(-1)!.points.length - 1);
  expect(changes).toEqual(["restore"]);
});

test("workspace writer debounces the latest snapshot and keeps verify storage isolated", async () => {
  const storage = new Map<string, string>();
  const workspace = freshWorkspace();
  const key = workspaceKeys(true).workspace;
  const writer = new WorkspacePersistence({ storage: { setItem(k, v) { storage.set(k, v); } },
    key, writable: true, capture: () => workspace, delayMs: 5 });
  writer.request();
  expect(storage.size).toBe(0);
  writer.activate();
  writer.request();
  workspace.recipe.layers[0].color = "#123456";
  writer.request();
  await Bun.sleep(25);
  expect(JSON.parse(storage.get(key)!).recipe.layers[0].color).toBe("#123456");
  expect(storage.has(workspaceKeys(false).workspace)).toBe(false);
  expect(writer.snapshot().kind).toBe("saved");
});

test("workspace writer protects unreadable storage and reports write failure", () => {
  let writes = 0;
  const options = { key: "workspace", capture: freshWorkspace,
    storage: { setItem() { writes++; throw Error("blocked"); } } };
  const protectedWriter = new WorkspacePersistence({ ...options, writable: false, restoreError: "Unreadable" });
  protectedWriter.activate(); protectedWriter.flush();
  expect(writes).toBe(0);
  expect(protectedWriter.snapshot()).toEqual({ kind: "protected",
    message: "Unreadable. Original storage kept; export your recipe before closing." });
  const failedWriter = new WorkspacePersistence({ ...options, writable: true });
  failedWriter.activate(); failedWriter.flush();
  expect(writes).toBe(1);
  expect(failedWriter.snapshot().kind).toBe("unavailable");
});
