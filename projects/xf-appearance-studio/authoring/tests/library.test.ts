import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LookLibrary, libraryRequest } from "../src/library-store";
import { initialRecipe } from "../src/recipe";

test("library persists editable revisions and rejects stale or invalid writes atomically", () => {
  const dir = mkdtempSync(join(tmpdir(), "xfas-library-")), path = join(dir, "library.sqlite");
  let db = new LookLibrary(path);
  try {
    const recipe = initialRecipe();
    const first = db.save({ name: "Evening ✨", recipe });
    recipe.layers[0].finish = "iridescent";
    const second = db.save({ name: "Evening revised", recipe, revision: 1 }, first.id);
    expect(second.revision).toBe(2);
    expect(db.get(first.id, 1).recipe.layers[0].finish).toBe("matte");
    expect(() => db.save({ name: "Stale tab", recipe, revision: 1 }, first.id)).toThrow("another window");
    expect(() => db.save({ name: "Broken", recipe: {}, revision: 2 }, first.id)).toThrow();
    expect(db.list()).toHaveLength(1);
    expect(db.get(first.id)).toEqual(second);
    db.close();
    db = new LookLibrary(path);
    expect(db.get(first.id)).toEqual(second);
    const copy = db.save({ name: second.name, recipe });
    expect(copy.id).not.toBe(first.id);
    expect(copy.revision).toBe(1);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("library API validates local writes, preserves conflicts, and separates verification data", async () => {
  const real = new LookLibrary(":memory:"), verification = new LookLibrary(":memory:");
  const origin = "http://127.0.0.1:4317", prefix = "/api/looks";
  const request = (suffix = "", method = "GET", body?: unknown, source = origin) => new Request(origin + prefix + suffix, {
    method, headers: { Origin: source, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  try {
    const data = { name: "Test", recipe: initialRecipe() };
    expect((await libraryRequest(request("", "POST", data, "https://example.com"), real, prefix)).status).toBe(403);
    const created = await libraryRequest(request("", "POST", data), verification, prefix);
    expect(created.status).toBe(201);
    const look = await created.json();
    expect(real.list()).toHaveLength(0);
    const suffix = `/${look.id}`;
    expect((await libraryRequest(request(suffix, "PUT", { ...data, revision: 1 }), verification, prefix)).status).toBe(200);
    expect((await libraryRequest(request(suffix, "PUT", { ...data, revision: 1 }), verification, prefix)).status).toBe(409);
    expect((await libraryRequest(request(suffix), verification, prefix)).status).toBe(200);
    expect((await libraryRequest(request(suffix, "DELETE"), verification, prefix)).status).toBe(405);
    expect((await libraryRequest(request("/not-a-look"), verification, prefix)).status).toBe(404);
    expect((await libraryRequest(request("", "POST", { name: "Invalid", recipe: {} }), verification, prefix)).status).toBe(400);
  } finally { real.close(); verification.close(); }
});
