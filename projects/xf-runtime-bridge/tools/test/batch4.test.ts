// Bridge batch 4 through the command API against the self-test host (the real bridge core and pipe with a
// simulated game): cc.open's refusals and the kill switch during cc.open (RB-49), the write pause and the
// re-arm after the kill switch (the CET panel's two controls, simulated), and the live-posing experiment's
// commands (photo.pose.set, pose.live.read, pose.live.apply). Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { livePoseParams } from "../api/catalogue.ts";
import { BridgeClient, readSession } from "../bridge-lib.ts";
import { sleep, startSelftestHost, tempDir, type Host } from "./helpers.ts";

const apiFor = (host: Host) =>
  new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-b4-cap-"), "captures"), auditDir: tempDir("xfb-b4-audit-") });

async function bridge(api: CommandApi, method: string, params: Record<string, unknown> = {}) {
  const response = await api.callBridge(method, params, `t-${method}`);
  expect(response.ok).toBe(true);
  return (response as { result: any }).result;
}

describe("cc.open refusals and the kill switch during cc.open (RB-45, RB-49)", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--allow-creator-leave", "--rearm-after-ms", "400"], 90);
    api = apiFor(host);
  });
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("RB-45: outside V (a Johnny section) cc.open is refused in plain words and nothing is requested", async () => {
    await bridge(api, "selftest.phase", { phase: "gameplay", player: "johnny" });
    const outcome = await api.run("cc.open", {});
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("not_v");
    expect(outcome.error.message).toContain("isn't V");
    expect(outcome.error.detail).toContain("Johnny");
    expect((await bridge(api, "game.status")).phase).toBe("gameplay");
    await bridge(api, "selftest.phase", { phase: "gameplay", player: "v" });
  });

  test("RB-49: the kill switch during cc.open withdraws the request; after reconnecting nothing opened", async () => {
    await bridge(api, "selftest.phase", { phase: "gameplay", creator_opens: false });
    const firstSid = readSession(host.dir)!.sid;
    const pending = api.run("cc.open", { timeout_ms: 5000 });
    await sleep(600); // the request is out, the menu never takes it
    writeFileSync(join(host.dir, "KILL"), "killed by the batch 4 test\n");
    const outcome = await pending;
    expect(outcome.ok).toBe(false); // killed while waiting: the answer is an error, never "opened"
    // The kill switch's restore withdrew the request (the self-test's RestoreAfterKill says so).
    for (let i = 0; i < 40 && !host.log.some((l) => l.includes("creator_open_withdrawn")); i++) await sleep(100);
    expect(host.log.some((l) => l.includes("evt=bridge.kill_restored") && l.includes("creator_open_withdrawn"))).toBe(true);
    // Re-armed (the in-game Reconnect, simulated after 400 ms): a new session, and the screen never opened.
    let session = readSession(host.dir);
    for (let i = 0; i < 60 && (!session || session.sid === firstSid); i++) {
      await sleep(100);
      session = readSession(host.dir);
    }
    expect(session && session.sid !== firstSid).toBe(true);
    expect(existsSync(join(host.dir, "KILL"))).toBe(false); // the reconnect removed the KILL file
    const status = await bridge(api, "game.status");
    expect(status.phase).toBe("gameplay");
  }, 20000);
});

describe("the CET panel's controls, simulated: pause writes and reconnect after the kill switch", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--rearm-after-ms", "300"], 90);
    api = apiFor(host);
  });
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("paused writes are refused in plain words (photo.open included); reads work; resuming restores config.ini's gate", async () => {
    await bridge(api, "selftest.phase", { phase: "photo_mode" });
    expect((await bridge(api, "selftest.pause_writes", { paused: true })).writes_paused).toBe(true);
    expect((await bridge(api, "game.status")).writes_paused).toBe(true);
    let outcome = await api.run("photo.camera.set", { fov: 30 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("writes_paused");
      expect(outcome.error.message).toContain("paused");
    }
    await bridge(api, "selftest.phase", { phase: "gameplay" });
    outcome = await api.run("photo.open", {});
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("writes_paused");
    expect((await api.run("game.status", {})).ok).toBe(true);
    await bridge(api, "selftest.pause_writes", { paused: false });
    outcome = await api.run("world.time.set", { hours: 1 });
    expect(outcome.ok).toBe(true);
  });

  test("after the kill switch the bridge re-arms with a new session; the old token is refused, the tools reconnect", async () => {
    const old = readSession(host.dir)!;
    const killed = await api.run("bridge.kill", {});
    expect(killed.ok).toBe(true);
    let session = readSession(host.dir);
    for (let i = 0; i < 60 && (!session || session.sid === old.sid); i++) {
      await sleep(100);
      session = readSession(host.dir);
    }
    expect(session).not.toBeNull();
    expect(session!.sid).not.toBe(old.sid);
    expect(session!.token).not.toBe(old.token);
    expect(session!.pipe).not.toBe(old.pipe);
    // The command API notices the new session id and reconnects by itself.
    const info = await api.run("bridge.info", {});
    expect(info.ok).toBe(true);
    if (info.ok) expect((info.result as any).bridge?.rearms ?? 1).toBeGreaterThanOrEqual(1);
    // A client holding the old session can't reach the new pipe (the old pipe name is gone).
    api.close();
    const stale = new BridgeClient({ ...session!, token: old.token }, 2000);
    await stale.connect();
    const refused = await stale.call("bridge.ping", {}, "t-stale");
    stale.close();
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("unauthorized");
    expect(host.log.some((l) => l.includes("evt=bridge.rearmed"))).toBe(true);
  }, 20000);
});

describe("live posing, experiment L0: photo.pose.set, pose.live.read, pose.live.apply", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--allow-live-pose"], 90);
    api = apiFor(host);
  });
  afterAll(async () => {
    api?.close();
    await host?.stop();
  });

  test("the carrier must be selected before anything is written", async () => {
    await bridge(api, "selftest.phase", { phase: "photo_mode" });
    const outcome = await api.run("pose.live.apply", { joints: [{ joint: "RightForeArm", rotation: [0, 0, 0.2588, 0.9659] }] });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("carrier_not_selected");
      expect(outcome.error.message).toContain("photo_pose_set");
    }
  });

  test("photo.pose.set selects the carrier by record, with an undo to the earlier pose", async () => {
    const outcome = await api.run("photo.pose.set", { record: "xfs_live_carrier" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result).toMatchObject({ category: "XF Live", pose: "XF Live Carrier", changed: true });
    expect((outcome.result as any).undo).toEqual({ method: "photo.pose.set", params: { category_value: 0, pose_value: 1 } });
    const again = await api.run("photo.pose.set", { record: "xfs_live_carrier" });
    expect(again.ok && (again.result as any).undo).toBeNull();
  });

  test("pose.live.read checks the layout and the carrier contract, and compares with the offline hash", async () => {
    const first = await api.run("pose.live.read", {});
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const read = first.result as any;
    expect(read).toMatchObject({ found: true, layout: "ok", carrier_contract: "ok", bridge_wrote: false });
    expect(read.keys.length).toBe(142);
    expect(read.keys[0]).toMatchObject({ joint: 0, name: "Root", channel: "rotation" });
    const compared = await api.run("pose.live.read", { expect_hash: read.keys_hash });
    expect(compared.ok && (compared.result as any).matches_offline).toBe(true);
    const other = await api.run("pose.live.read", { clip: "idle_stand_01" });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.code).toBe("clip_not_found");
  });

  test("pose.live.apply writes one joint (and the Hips), undoes exactly, and bad input never reaches the game", async () => {
    const before = (await api.run("pose.live.read", {})) as any;
    const applied = await api.run("pose.live.apply", {
      joints: [{ joint: "RightForeArm", rotation: [0, 0, 0.2588, 0.9659] }],
      hips: [0, 0, 1.05],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.result).toMatchObject({ applied: 2, undo: { method: "pose.live.apply", params: { restore: true } } });
    const after = (await api.run("pose.live.read", {})) as any;
    expect(after.result.keys_hash).not.toBe(before.result.keys_hash);
    expect(after.result.bridge_wrote).toBe(true);
    const joint40 = after.result.keys.find((k: any) => k.name === "RightForeArm" && k.channel === "rotation");
    expect(joint40.rotation[2]).toBeCloseTo(0.2588, 3);
    const undone = await api.run("pose.live.apply", (applied.result as any).undo.params);
    expect(undone.ok && (undone.result as any).restored).toBe(true);
    const restored = (await api.run("pose.live.read", {})) as any;
    expect(restored.result.keys_hash).toBe(before.result.keys_hash);

    const requests = host.log.filter((l) => l.includes("method=pose.live.apply")).length;
    for (const input of [
      { joints: [{ joint: "A;B", rotation: [0, 0, 0, 1] }] },
      { joints: [{ joint: "RightForeArm", rotation: [0, 0, 1] }] },
      { hips: [0, 0, 9] },
      { joints: [{ joint: "RightForeArm", rotation: [0, 0, 0, 1] }, { joint: "RightForeArm", rotation: [0, 0, 0, 1] }] },
    ]) {
      const refused = await api.run("pose.live.apply", input);
      expect(refused.ok).toBe(false);
    }
    expect(host.log.filter((l) => l.includes("method=pose.live.apply")).length).toBe(requests);
    const notUnit = await api.run("pose.live.apply", { joints: [{ joint: "RightForeArm", rotation: [0, 0, 0, 0.5] }] });
    expect(notUnit.ok).toBe(false);
    if (!notUnit.ok) expect(notUnit.error.detail).toContain("unit quaternion");
  });

  test("the kill switch puts the carrier's keys back", async () => {
    const before = (await api.run("pose.live.read", {})) as any;
    expect((await api.run("pose.live.apply", { joints: [{ joint: "RightForeArm", rotation: [0, 0, 0.5, 0.866] }] })).ok).toBe(true);
    expect((await api.run("bridge.kill", {})).ok).toBe(true);
    for (let i = 0; i < 40 && !host.log.some((l) => l.includes("carrier_restored")); i++) await sleep(100);
    expect(host.log.some((l) => l.includes("evt=bridge.kill_restored") && l.includes("carrier_restored"))).toBe(true);
    expect(before.ok).toBe(true);
  });
});

describe("live posing is off without allow_live_pose", () => {
  test("pose.live.apply is refused in plain words; pose.live.read still reads", async () => {
    const host = await startSelftestHost(["--allow-writes"], 60);
    const api = apiFor(host);
    try {
      await bridge(api, "selftest.phase", { phase: "photo_mode" });
      const outcome = await api.run("pose.live.apply", { restore: true });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe("live_pose_disabled");
        expect(outcome.error.message).toContain("allow_live_pose");
      }
      expect((await api.run("pose.live.read", {})).ok).toBe(true);
    } finally {
      api.close();
      await host.stop();
    }
  });
});

describe("pose.live.apply's input", () => {
  test("the list of joints becomes the bridge's map; a joint given twice is refused", () => {
    expect(livePoseParams({ joints: [{ joint: "Hips", rotation: [0, 0, 0, 1] }], restore: false })).toEqual({
      joints: { Hips: [0, 0, 0, 1] },
      restore: false,
    });
    expect(() => livePoseParams({ joints: [{ joint: "A", rotation: [0, 0, 0, 1] }, { joint: "A", rotation: [0, 0, 0, 1] }] })).toThrow();
  });
});
