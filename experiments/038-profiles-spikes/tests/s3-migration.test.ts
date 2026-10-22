import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The S3 migration sweep on the production code (profiles design §8, chunk 1d-i): hosts and pages really killed at every protocol step,
// two hosts at once with identical and divergent drafts, and the downgrade round trip. About 15 s per round.
test("the migration sweep passes", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "xfs-s3-migration-"));
  try {
    const run = Bun.spawn([process.execPath, join(import.meta.dir, "..", "tools", "s3-migration.ts"), scratch, "1"], { stdout: "pipe", stderr: "ignore" });
    const [code, text] = await Promise.all([run.exited, new Response(run.stdout).text()]);
    const results = JSON.parse(text.slice(text.indexOf("{"))) as Record<string, { ok?: boolean }>;
    expect(Object.entries(results).filter(([, result]) => typeof result === "object" && !result.ok).map(([name]) => name)).toEqual([]);
    expect(code).toBe(0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 120_000);
