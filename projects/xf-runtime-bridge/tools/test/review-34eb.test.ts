// The Codex review of 65b8da29..34eb3d9d (5 High, 8 Medium): each finding reproduced first. Fake bridges and hosts;
// nothing reaches a game.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tempDir } from "./helpers.ts";

const fakes = async () => {
  const { FakeClock } = await import("./fake-clock.ts");
  const f = await import("./batch-fakes.ts");
  return { clock: new FakeClock(), ...f };
};

describe("H1: a tripped commit monitor doesn't refuse the teardown", () => {
  test("after a trip in a row, every teardown step still reaches the bridge", async () => {
    const { clock, fakeApi, fakeHost, go, script } = await fakes();
    const api = fakeApi(clock);
    const host = fakeHost({ freeGb: 40 });
    void clock.sleep(3000).then(() => { host.free = 2 * 1024 ** 3; });
    const rows = [{ id: "heavy", title: "heavy", steps: [{ label: "w", do: "wait", ms: 20_000 }] }];
    const result = await go(script(rows as never), api, host, clock, tempDir("xfb-r34-"), { commitEveryMs: 1000 });
    expect(result.halt).toContain("commit tripwire");
    const after = api.calls.slice(api.calls.findIndex((c) => c.name === "session.handover") + 1).map((c) => c.name);
    for (const name of ["supervisor.clear", "test.record.stop", "npc.status", "ui.message", "ui.hud"]) expect(after).toContain(name);
    // The trip's reason is kept for the report.
    expect(result.haltInfo?.kind).toBe("tripwire");
  });
});
