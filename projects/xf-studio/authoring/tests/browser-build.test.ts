import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { browserBundleNames, retainBrowserChunks } from "../browser-build";
import { tempDir } from "./temp-dir";

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

test("lazy chunks survive one successful rebuild; unrelated files are never pruned", () => {
  const dir = tempDir("xfs-chunks-"), put = (name: string) => writeFileSync(resolve(dir, name), name);
  try {
    put("chunk-old.js"); put("worker.js"); retainBrowserChunks(dir, ["chunk-old.js"]);
    put("chunk-next.js"); retainBrowserChunks(dir, ["chunk-next.js"]);
    expect(existsSync(resolve(dir, "chunk-old.js"))).toBe(true);
    put("chunk-latest.js"); retainBrowserChunks(dir, ["chunk-latest.js"]);
    expect(existsSync(resolve(dir, "chunk-old.js"))).toBe(false);
    expect(existsSync(resolve(dir, "chunk-next.js"))).toBe(true);
    expect(existsSync(resolve(dir, "worker.js"))).toBe(true);
  } finally {
    if (!dir.startsWith(resolve(tmpdir(), "xfs-chunks-"))) throw Error("Unexpected test directory");
    rmSync(dir, { recursive: true, force: true });
  }
});
