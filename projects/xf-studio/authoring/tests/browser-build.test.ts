import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { browserBundleNames } from "../browser-build";

test("every public page script under /build/ is produced by the shared browser build", () => {
  const publicDir = resolve(import.meta.dir, "..", "public");
  const referenced = readdirSync(publicDir).filter(name => name.endsWith(".html")).flatMap(page =>
    [...readFileSync(resolve(publicDir, page), "utf8").matchAll(/src="\/build\/([^"]+\.js)"/g)].map(m => ({ page, bundle: m[1] })));
  expect(referenced.length).toBeGreaterThan(0);
  for (const { page, bundle } of referenced) expect({ page, bundle, built: browserBundleNames.includes(bundle) }).toEqual({ page, bundle, built: true });
});

test("browser bundle names are unique after flattening", () => {
  expect(new Set(browserBundleNames).size).toBe(browserBundleNames.length);
});
