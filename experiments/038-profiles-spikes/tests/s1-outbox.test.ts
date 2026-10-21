import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The S1 kill harness on the production outbox (profiles design §2.2, chunk 1c): renderer and host killed at 20 points each, two windows
// with kills of both, and a forced outbox-write failure, on the localhost routes and the real desktop server. About 2.5 minutes.
test("the outbox kill harness passes on both hosts", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "xfs-s1-outbox-"));
  try {
    const run = Bun.spawn([process.execPath, join(import.meta.dir, "..", "tools", "s1-outbox.ts"), scratch], { stdout: "pipe", stderr: "ignore" });
    const [code, text] = await Promise.all([run.exited, new Response(run.stdout).text()]);
    const results = JSON.parse(text.slice(text.indexOf("{"))) as Record<string, { ok?: boolean }>;
    expect(Object.entries(results).filter(([, result]) => typeof result === "object" && !result.ok).map(([name]) => name)).toEqual([]);
    expect(code).toBe(0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 400_000);
