import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import config from "../electrobun.config";
import { COTTONTAIL_CAPABILITIES, hostCapabilities, hostCapabilityUses } from "../runtime-capabilities";

test("the Cottontail capability declaration is exactly what the host reaches", () => {
  const declared = [...(config.build.cottontail?.capabilities ?? [])].sort();
  const reached = hostCapabilities();
  // A capability the host reaches but the list omits would be missing from a Cottontail build; one listed but no longer
  // reached is stale. Either way: update build.cottontail.capabilities in electrobun.config.ts.
  expect(declared).toEqual(reached);
  expect(reached).toEqual(["compression", "ffi", "hashing", "sqlite", "yaml"]);
  for (const name of declared) expect(COTTONTAIL_CAPABILITIES as readonly string[]).toContain(name);
});

test("the walk covers the workers and the Build tool, and finds uses the bundle scan can't", () => {
  const { files, uses } = hostCapabilityUses();
  expect(files).toBeGreaterThan(100);
  const where = (capability: string) => uses.filter(use => use.capability === capability).map(use => use.file.replaceAll("\\", "/"));
  expect(where("sqlite").some(file => file.endsWith("src/library-store.ts"))).toBe(true);
  expect(where("ffi").some(file => file.endsWith("src/native/oodle.ts"))).toBe(true);
  expect(where("yaml").length).toBeGreaterThan(0);

  const folder = mkdtempSync(join(tmpdir(), "xfs-capabilities-"));
  try {
    writeFileSync(join(folder, "entry.ts"), 'import "./helper";\nexport const data = Bun.YAML.parse("a: 1");\n');
    writeFileSync(join(folder, "helper.ts"), 'export const ffi = import.meta.require("bun:ffi");\nexport const h = new Bun.CryptoHasher("sha256");\n');
    expect(hostCapabilityUses([join(folder, "entry.ts")]).uses.map(use => use.capability).sort()).toEqual(["ffi", "hashing", "yaml"]);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("the known capability names match the Cottontail this checkout's devkit selected, when it is present", () => {
  const lock = resolve(import.meta.dir, "..", ".hutch", "dependencies.lock");
  if (!existsSync(lock)) return;
  const cottontail = (JSON.parse(readFileSync(lock, "utf8")).objects as Array<{ product?: string; relativeRoot?: string }>)
    .find(item => item.product === "cottontail");
  const manifest = cottontail?.relativeRoot &&
    join(process.env.HUTCH_HOME || join(homedir(), ".hutch"), cottontail.relativeRoot, "bin", "cottontail-stdlib", "capabilities.json");
  if (!manifest || !existsSync(manifest)) return;
  expect(Object.keys(JSON.parse(readFileSync(manifest, "utf8")).capabilities).sort()).toEqual([...COTTONTAIL_CAPABILITIES].sort());
});
