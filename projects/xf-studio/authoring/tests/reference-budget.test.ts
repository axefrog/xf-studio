import { expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { filesSource, PreparedFiles, PREPARED_BUDGET_BYTES, referenceCap } from "../src/host/prepared-files";
import { hostClock } from "../src/platform/core/clock";
import { createJobScheduler } from "../src/platform/core/jobs";
import { tempDir } from "./temp-dir";

test("the reference share stays within the configured total and below the character's (HAIR-03)", () => {
  for (const total of [1024, 512 * 1024 ** 2, PREPARED_BUDGET_BYTES]) {
    const cap = referenceCap(total);
    expect(cap).toBeLessThanOrEqual(256 * 1024 ** 2);
    expect(total - cap).toBeGreaterThan(cap);
  }
  expect(referenceCap(Infinity)).toBe(Infinity);
  expect(() => referenceCap(0)).toThrow();
});

test("a capped partition keeps within its cap and never evicts another's files; the rest share what the caps leave", async () => {
  const root = tempDir("xfs-reference-budget-");
  try {
    const file = (folder: string, name: string, bytes: number, ageMs: number) => {
      mkdirSync(folder, { recursive: true });
      const path = join(folder, name);
      writeFileSync(path, "x".repeat(bytes));
      const when = new Date(Date.now() - ageMs);
      utimesSync(path, when, when);
    };
    const character = join(root, "character"), reference = join(root, "reference");
    // The user's V's files are the oldest of all, the references' newer: a shared LRU would evict the V's first.
    file(character, "v1.json", 600, 600_000); file(character, "v2.json", 600, 500_000);
    file(reference, "r1.json", 300, 60_000); file(reference, "r2.json", 300, 30_000);
    const files = new PreparedFiles({ budget: 1600, scheduler: createJobScheduler({ clock: hostClock(), quietMs: 0 }) });
    files.partition({ name: "character", evictable: [filesSource(character, ".json")] });
    files.partition({ name: "reference", cap: 400, evictable: [filesSource(reference, ".json")] });
    const result = await files.evict();
    expect(readdirSync(reference)).toEqual(["r2.json"]);
    // The character's 1200 bytes fit the 1200 the reference's cap leaves.
    expect(readdirSync(character).sort()).toEqual(["v1.json", "v2.json"]);
    expect(result).toEqual({ removed: 1, freed: 300, bytes: 1500 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
