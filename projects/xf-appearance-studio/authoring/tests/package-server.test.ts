import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPackageHandler, localPackageTools } from "../src/package-server";
import { planCollection } from "../src/preset-collection";
import type { PackageAction, PackageCheck } from "../src/package-action";

const fixture = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../../experiments/005-preset-collection/editor-collection.json"), "utf8"));
const url = "http://127.0.0.1:4317/api/package";
const request = (body: unknown, origin = "http://127.0.0.1:4317") => new Request(url, {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const summary = (): PackageCheck => {
  const plan = planCollection(fixture);
  return { ready: true, collectionId: plan.collectionId, namespace: plan.namespace,
    presets: plan.presets.map(p => ({ id: p.id, revision: p.revision, appearance: p.appearance })) };
};

test("package boundary accepts only same-origin validated collection snapshots and ignores browser paths", async () => {
  let calls = 0;
  const handler = createPackageHandler(localPackageTools(), async () => { calls++; return summary(); });
  expect((await handler(request({ action: "check", collection: fixture }, "https://other.example"))).status).toBe(403);
  expect((await handler(request({ action: "check", collection: fixture, outputRoot: "F:/Games/Cyberpunk 2077" }))).status).toBe(400);
  expect((await handler(request({ action: "check", collection: { ...fixture, presets: [] } }))).status).toBe(400);
  expect((await handler(new Request(url, { method: "POST", headers: { Origin: url.replace("/api/package", ""),
    "Content-Type": "application/json", "Content-Length": "16000001" }, body: "{}" }))).status).toBe(413);
  const valid = await handler(request({ action: "check", collection: fixture }));
  expect(valid.status).toBe(200);
  expect((await valid.json()).namespace).toBe(summary().namespace);
  expect(calls).toBe(1);
});

test("a running package build blocks a second build without blocking the HTTP event loop", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const handler = createPackageHandler(localPackageTools(), async (action: PackageAction) => {
    if (action === "build") await gate;
    throw Error("Simulated local tool failure");
  });
  const first = handler(request({ action: "build", collection: fixture }));
  const second = await handler(request({ action: "build", collection: fixture }));
  expect(second.status).toBe(409);
  release();
  const result = await first;
  expect(result.status).toBe(422);
  expect((await result.json()).error).toContain("Simulated local tool failure");
});

test("real local preflight checks compiler finish support and keeps unsupported finish visible", async () => {
  const handler = createPackageHandler();
  const accepted = await handler(request({ action: "check", collection: fixture }));
  expect(accepted.status).toBe(200);
  const unsupported = structuredClone(fixture);
  unsupported.presets[0].recipe.layers[0].finish = "glitter";
  const rejected = await handler(request({ action: "check", collection: unsupported }));
  expect(rejected.status).toBe(422);
  const response = await rejected.json();
  expect(response.code).toBe("unsupported_finish");
  expect(response.error).toContain("Glitter in preset “Verification — metallic copy”, layer “Petal wash”");
  expect(response.error).toContain("Matte, Satin and Metallic");
  expect(response.error).toContain("Change or disable");
  expect(response.error).not.toContain("Stack trace");
});

test("check and build reject every enabled unsupported finish before invoking package tools", async () => {
  let calls = 0;
  const handler = createPackageHandler(localPackageTools(), async () => { calls++; return summary(); });
  const unsupported = structuredClone(fixture);
  unsupported.presets[0].recipe.layers[0].finish = "glitter";
  unsupported.presets[1].recipe.layers[0].finish = "shimmer";
  for (const action of ["check", "build"] as const) {
    const response = await handler(request({ action, collection: unsupported }));
    expect(response.status).toBe(422);
    const message = (await response.json()).error as string;
    expect(message).toContain("Glitter in preset");
    expect(message).toContain("Shimmer in preset");
    expect(message).toContain("no mod files were created");
    expect(message).not.toContain("at compileFlatPreset");
  }
  expect(calls).toBe(0);
});

test("inactive and transparent experimental layers keep the current compiler eligibility", async () => {
  const handler = createPackageHandler(localPackageTools(), async () => summary());
  const collection = structuredClone(fixture);
  collection.presets[0].recipe.layers[0].finish = "glitter";
  collection.presets[0].recipe.layers[0].enabled = false;
  collection.presets[1].recipe.layers[0].finish = "shimmer";
  collection.presets[1].recipe.layers[0].opacity = 0;
  const response = await handler(request({ action: "check", collection }));
  expect(response.status).toBe(200);
});
