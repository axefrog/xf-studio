import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLeaseHarness } from "../tools/lease-harness";

// The workspace lease harness (profiles design §2.3): two windows on each host, a holder killed while draining, a hung holder and a late
// write refused by fencing; a release that can't save, a write stalled across a handover, a lost host stream, no lease generation and a retried
// takeover; on the real desktop server and the real library routes. About 15 s.
test("the workspace lease harness passes on both hosts", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "xfs-lease-harness-"));
  try {
    const checks = await runLeaseHarness(scratch);
    expect(checks.filter(check => !check.ok)).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(31);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 60_000);
