// Bridge 0.8.2: the re-check's findings on the tools' side and session 9's bridge fixes, offline, with fake transports and
// against the self-test host: emergency controls that never block the event loop and never race for the control pipe (1),
// a handover that clears the rigs after the write gate closes (3), captures that stop when cancelled (5), a look stopped
// mid-way (2), game.wait with one phase, the press-any-key screen after a load, the staged showroom found by itself, the
// clean-build gate, and the schema's anyOf and its plain length message (the ink panel's placement is batch17's since 0.8.3).
// Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BridgeClient, type BridgeResponse } from "../bridge-lib.ts";
import type { CommandContext } from "../api/catalogue.ts";
import { CommandApi, type BridgeTransport, type CommandOutcome } from "../api/command-api.ts";
import { waitForLoadEnd } from "../api/load-continue.ts";
import { validate } from "../api/schema.ts";
import { findCommand } from "../api/catalogue.ts";
import { chooseStagedShowroom, showroomBuilds } from "../showroom/plan.ts";
import { staleObject } from "../packaging.ts";
import { HOOK_TIMEOUT_MS, projectDir, sleep, startSelftestHost, tempDir, type Host } from "./helpers.ts";

type Any = any;
const ALL = "photo,world,character,save,showroom,inventory,player";
const codeOf = (outcome: CommandOutcome) => (outcome.ok ? "ok" : outcome.error.code);
const answer = (result: unknown): BridgeResponse => ({ v: 1, id: 1, cid: "c", ok: true, result });

function fakeSession(dir: string) {
  writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, pid: process.pid, pipe: String.raw`\\.\pipe\xfb-none`, sid: "s", token: "t" }));
}

// --- re-check 1: concurrent emergency controls ---------------------------------------------------------------------------

describe("0.8.2 re-check 1: emergency controls, one after another, never blocking", () => {
  test("a control-pipe connection waits for a busy pipe asynchronously: behave.stop then player.stop both answer, the event loop runs", async () => {
    const dir = tempDir("xfb-082-ctl-");
    fakeSession(dir);
    writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, pid: process.pid, pipe: "p", control_pipe: "p-control", sid: "s", token: "t" }));
    let open = 0;
    let most = 0;
    const order: string[] = [];
    // A single-client pipe: a second connection while one is open is busy (the real pipe's behaviour).
    const control = async (): Promise<BridgeTransport> => {
      if (open > 0) throw Object.assign(new Error("busy"), { code: "busy" });
      open++;
      most = Math.max(most, open);
      return {
        call: async (method) => {
          order.push(method);
          await sleep(120);
          return answer({ stopped: true });
        },
        close: () => {
          open--;
        },
      };
    };
    const api = new CommandApi({ runtimeDir: dir, auditDir: join(dir, "logs"), captureRoot: join(dir, "captures"), transport: async () => ({ call: async () => answer({}), close: () => undefined }), controlTransport: control });
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const [a, b] = await Promise.all([api.run("behave.stop", { all: true }), api.run("player.stop", {})]);
    clearInterval(timer);
    expect(codeOf(a)).toBe("ok");
    expect(codeOf(b)).toBe("ok");
    expect(order).toEqual(["behave.stop", "player.stop"]);
    expect(most).toBe(1);
    expect(ticks).toBeGreaterThan(10); // the event loop kept running throughout
    api.close();
  });

  test("bridge.kill never waits for the control pipe: busy, it uses the KILL file at once", async () => {
    const dir = tempDir("xfb-082-kill-");
    writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, pid: process.pid, pipe: "p", control_pipe: "p-control", sid: "s", token: "t" }));
    const { PipeConnectError } = await import("../bridge-lib.ts");
    const asked: (number | undefined)[] = [];
    const api = new CommandApi({
      runtimeDir: dir, auditDir: join(dir, "logs"), captureRoot: join(dir, "captures"),
      transport: async () => ({ call: async () => answer({}), close: () => undefined }),
      controlTransport: async (_session, options) => {
        asked.push(options?.busyWaitMs);
        throw new PipeConnectError("pipe busy (another client is connected)", "busy");
      },
    });
    const started = performance.now();
    const kill = await api.run("bridge.kill");
    expect(performance.now() - started).toBeLessThan(500);
    expect(kill.ok && (kill.result as Any).route).toBe("kill_file");
    expect((kill.ok && (kill.result as Any).note) || "").toContain("busy");
    expect(asked).toEqual([0]);
    expect(readdirSync(dir)).toContain("KILL");
    api.close();
  });
});

// --- re-check 3 and 5: the handover's rigs, cancelled captures -------------------------------------------------------------

describe("0.8.2 re-checks 3 and 5 (fake bridge)", () => {
  function fake(onCall?: (method: string, params: Record<string, unknown>) => void) {
    const dir = tempDir("xfb-082-fake-");
    fakeSession(dir);
    const sent: { method: string; params: Record<string, unknown> }[] = [];
    const transport: BridgeTransport = {
      call: async (method, params) => {
        sent.push({ method, params });
        onCall?.(method, params);
        if (method === "game.status") return answer({ phase: "photo_mode", photo_ui_hidden: false });
        if (method === "bridge.handover") return answer({ was: false, player_released: { released: true, removed: [] }, lights_cleared: params.lights ? { removed_lights: 2, what: "lights" } : null });
        if (method === "ui.hud") return answer({ undo: { method: "ui.hud", params: { show: true, cet_label: true } } });
        return answer({});
      },
      close: () => undefined,
    };
    const api = new CommandApi({ runtimeDir: dir, auditDir: join(dir, "logs"), captureRoot: join(dir, "captures"), transport: async () => transport, idleCloseMs: 60_000 });
    return { dir, api, sent };
  }

  test("re-check 3: the handover asks the bridge to clear the rigs inside bridge.handover, after its write gate closes, not before", async () => {
    const { api, sent } = fake();
    const out = await api.run("session.handover", { lights: "clear" });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(sent.map((s) => s.method)).not.toContain("showroom.clear");
    expect(sent.find((s) => s.method === "bridge.handover")?.params).toMatchObject({ on: true, lights: "clear" });
    expect((out.ok && (out.result as Any).steps.find((s: Any) => s.step.startsWith("clear the showroom's rigs"))?.ok)).toBe(true);
    api.close();
  });

  test("re-check 5: a capture cancelled while the overlay is being hidden takes no picture, and what it hid comes back", async () => {
    const controller = new AbortController();
    const { api, sent, dir } = fake((method) => {
      if (method === "ui.hud") controller.abort("test");
    });
    const out = await api.run("capture.screenshot", {}, { signal: controller.signal });
    expect(codeOf(out)).toBe("interrupted");
    const methods = sent.map((s) => s.method);
    expect(methods).not.toContain("overlay.hide"); // the forward step after the cancel wasn't sent
    expect(sent.filter((s) => s.method === "ui.hud").length).toBe(2); // hidden, then put back
    expect(readdirSync(dir)).not.toContain("captures");
    api.close();
  });

  test("re-check 5: a contact sheet stops before its next picture once cancelled", async () => {
    const controller = new AbortController();
    controller.abort("before");
    const { api, sent } = fake();
    const out = await api.run("capture.sheet", { cells: [{ label: "a" }, { label: "b" }] }, { signal: controller.signal });
    expect(codeOf(out)).toBe("interrupted");
    expect(sent.map((s) => s.method)).not.toContain("ui.message");
    api.close();
  });
});

// --- session 9's tools fixes --------------------------------------------------------------------------------------------

describe("0.8.2 session 9 (offline)", () => {
  test("session_wait lets the pipe go between its polls, so other XF tools can call meanwhile", async () => {
    const dir = tempDir("xfb-082-wait-");
    fakeSession(dir);
    let opened = 0, closed = 0;
    const api = new CommandApi({
      runtimeDir: dir, auditDir: join(dir, "logs"), captureRoot: join(dir, "captures"), idleCloseMs: 60_000,
      transport: async () => {
        opened++;
        return { call: async (method) => answer(method === "session.events" ? { events: [], next: 1, latest: 1 } : {}), close: () => void closed++ };
      },
    });
    const out = await api.run("session.wait", { timeout_s: 1.2, poll_ms: 200 });
    expect(out.ok && (out.result as Any).timed_out).toBe(true);
    expect(opened).toBeGreaterThanOrEqual(3);
    expect(closed).toBeGreaterThanOrEqual(opened - 1);
    api.close();
  });

  test("game.wait takes one phase as text or a list; a wrong phase still says what is allowed", () => {
    const schema = findCommand("game.wait")!.input;
    expect(validate(schema, { phase: "gameplay" })).toEqual([]);
    expect(validate(schema, { phase: ["gameplay", "photo_mode"] })).toEqual([]);
    expect(validate(schema, { phase: "nowhere" }).join(" ")).toContain("must be one of");
    expect(validate(schema, { phase: ["nowhere"] }).join(" ")).toContain("must be one of");
  });

  test("ui_message's choices: the catalogue states the 24-character limit, and a longer one is refused in plain words", () => {
    const command = findCommand("ui.message")!;
    expect(command.description).toContain("at most 24 characters");
    const problems = validate(command.input, { text: "Which?", level: "ask", choices: ["A label well over twenty-four characters"] });
    expect(problems.join(" ")).toContain("40 characters, at most 24");
    expect(problems.join(" ")).toContain("button label");
  });

  test("game.load's wait answers when the press-any-key screen waits, and never sends a key (review: no synthetic key)", async () => {
    let now = 0;
    let keys = 0;
    const context = {
      cid: "t",
      api: {
        callBridge: async () => ({ ok: true, result: now < 2000 ? { phase: "loading" } : { phase: "loading", waiting_for_input: true } }),
        session: () => ({ pid: 0 }),
        keyTarget: () => ({ hwnd: 1n, pid: 1 }),
        keySender: () => async () => {
          keys++;
          return {};
        },
      },
    } as unknown as CommandContext;
    const out = await waitForLoadEnd(context, { waitMs: 30_000, now: () => now, sleep: async (ms) => void (now += ms) });
    expect(out.reached).toBe("press_any_key");
    expect(out.waiting_for_input).toBe(true);
    expect(out.note).toContain("ask the player to press a key");
    expect(now).toBeGreaterThanOrEqual(2000 + 1500);
    expect(keys).toBe(0);
    expect(readFileSync(join(projectDir, "tools", "api", "load-continue.ts"), "utf8")).not.toMatch(/keySender|SendInput|sendKeyToWindow/);
  });

  test("a load that reaches gameplay answers gameplay; a slow one answers in time with the way on", async () => {
    let now = 0;
    const context = (result: Any) => ({ cid: "t", api: { callBridge: async () => ({ ok: true, result: typeof result === "function" ? result() : result }) } }) as unknown as CommandContext;
    const done = await waitForLoadEnd(context(() => (now >= 1000 ? { phase: "gameplay" } : { phase: "loading" })), { waitMs: 30_000, now: () => now, sleep: async (ms) => void (now += ms) });
    expect(done.reached).toBe("gameplay");
    now = 0;
    const slow = await waitForLoadEnd(context({ phase: "loading" }), { waitMs: 5000, now: () => now, sleep: async (ms) => void (now += ms) });
    expect(slow.reached).toBe("loading");
    expect(slow.note).toContain("game_wait");
  });

  test("game.continue refuses plainly: no route inside the game is known, and no key is sent", async () => {
    const dir = tempDir("xfb-082-cont-");
    fakeSession(dir);
    const sent: string[] = [];
    const api = new CommandApi({ runtimeDir: dir, auditDir: join(dir, "logs"), captureRoot: join(dir, "captures"), transport: async () => ({ call: async (m) => (sent.push(m), answer({})), close: () => undefined }) });
    const out = await api.run("game.continue", {});
    expect(codeOf(out)).toBe("no_safe_route");
    expect(!out.ok && out.error.message).toContain("never sends one");
    expect(sent).toEqual([]);
    api.close();
  });

  test("the staged showroom is found by itself: the newest build per archive, the newest the game loaded", () => {
    const dist = tempDir("xfb-082-dist-");
    const make = (archive: string, folder: string, ms: number) => {
      mkdirSync(join(dist, folder));
      const file = join(dist, folder, "manifest.json");
      writeFileSync(file, JSON.stringify({ schema: "xfs/showroom-package-1", archive }));
      utimesSync(file, ms / 1000, ms / 1000);
    };
    const a = "xfs_showroom_" + "a".repeat(32), b = "xfs_showroom_" + "b".repeat(32);
    make(a, `${a}-1`, 1_000_000_000_000);
    make(a, `${a}-2`, 1_000_000_500_000);
    make(b, `${b}-1`, 1_000_000_900_000);
    const builds = showroomBuilds(dist);
    expect(builds.map((x) => x.archive)).toEqual([b, a, a]);
    const chosen = chooseStagedShowroom(builds, { [a]: true, [b]: false });
    expect(chosen.archive).toBe(a);
    expect(chosen.manifest).toContain(`${a}-2`);
    expect(() => chooseStagedShowroom(builds, {})).toThrow(/isn't|is loaded|None/);
    expect(() => chooseStagedShowroom([], {})).toThrow(/No XF Finish Showroom build/);
  });

  test("the clean-build gate: an object file older than a source file refuses the package", () => {
    const root = tempDir("xfb-082-build-");
    mkdirSync(join(root, "native", "src"), { recursive: true });
    mkdirSync(join(root, "build", "x.dir", "Release"), { recursive: true });
    const source = join(root, "native", "src", "Bridge.hpp");
    const object = join(root, "build", "x.dir", "Release", "Main.obj");
    writeFileSync(source, "x");
    writeFileSync(object, "x");
    utimesSync(object, 1000, 1000);
    utimesSync(source, 2000, 2000);
    expect(staleObject(join(root, "build"), join(root, "native"))?.object).toBe(object);
    utimesSync(object, 3000, 3000);
    expect(staleObject(join(root, "build"), join(root, "native"))).toBeNull();
  });

  // The ink panel's placement for all nine anchors moved to batch17 (0.8.3): session 10 showed 0.8.2's visible-screen model
  // (the middle 1600 units of the 2160 canvas) put every anchor about 280 units too low.
});

// --- against the self-test host ----------------------------------------------------------------------------------------

describe("0.8.2 against the self-test host", () => {
  let host: Host;
  let api: CommandApi;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 240);
    api = new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-b16-cap-"), "captures"), auditDir: tempDir("xfb-b16-audit-"), idleCloseMs: 300 });
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    api?.close();
    await host?.stop();
  }, HOOK_TIMEOUT_MS);

  test("re-check 1: two emergency controls at once over the real control pipe both answer", async () => {
    const [a, b] = await Promise.all([api.run("behave.stop", { all: true }), api.run("player.stop", {})]);
    expect(codeOf(a)).toBe("ok");
    expect(codeOf(b)).toBe("ok");
  }, 20_000);

  test("re-check 2: player.stop during a three-second look ends it at once, and it says it was stopped", async () => {
    await api.callBridge("selftest.phase", { phase: "gameplay" }, "t-phase");
    const look = api.run("player.look", { yaw: 60, pitch: 0, mode: "smooth", duration_s: 3 });
    await sleep(400);
    const started = performance.now();
    expect(codeOf(await api.run("player.stop", {}))).toBe("ok");
    const out = await look;
    expect(performance.now() - started).toBeLessThan(1500);
    expect(out.ok && (out.result as Any).stopped).toBe(true);
  }, 20_000);

  test("re-check 3: bridge.handover clears the rigs in the same step and then refuses showroom writes", async () => {
    const handed = await api.callBridge("bridge.handover", { on: true, lights: "clear" }, "t-handover");
    expect(handed.ok, JSON.stringify(handed)).toBe(true);
    expect(handed.ok && (handed.result as Any).lights_cleared).toMatchObject({ what: "lights" });
    const refused = await api.callBridge("showroom.clear", { what: "lights" }, "t-after");
    expect(!refused.ok && refused.error.code).toBe("handed_over");
    expect((await api.callBridge("bridge.handover", { on: false, lights: "clear" }, "t-bad")).ok).toBe(false);
    expect((await api.callBridge("bridge.handover", { on: false }, "t-resume")).ok).toBe(true);
  }, 20_000);

  test("showroom.anchor says which showroom archives the game loaded", async () => {
    const yes = "xfs_showroom_1" + "a".repeat(31), no = "xfs_showroom_" + "b".repeat(32);
    const out = await api.callBridge("showroom.anchor", { archives: [yes, no] }, "t-anchor");
    expect(out.ok && (out.result as Any).archives).toEqual({ [yes]: true, [no]: false });
    expect((await api.callBridge("showroom.anchor", { archives: ["../x"] }, "t-bad")).ok).toBe(false);
  }, 20_000);

  test("one question at a time, and a plain clear withdraws it", async () => {
    const first = await api.run("ui.message", { text: "First?", level: "ask", seconds: 60 });
    const second = await api.run("ui.message", { text: "Second?", level: "ask", seconds: 60 });
    const firstId = (first.ok && (first.result as Any).id) as number;
    expect(second.ok && (second.result as Any).withdrawn).toEqual([firstId]);
    expect(((await api.callBridge("ui.ask.state", { id: firstId }, "t-ask")) as Any).result.state).toBe("gone");
    await api.run("ui.message", { clear: true });
    const secondId = (second.ok && (second.result as Any).id) as number;
    expect(((await api.callBridge("ui.ask.state", { id: secondId }, "t-ask")) as Any).result.state).toBe("gone");
  }, 20_000);

  test("the frame names the status surface; a client on the control pipe alone still counts as the session", async () => {
    const frame = (await api.callBridge("selftest.hud", {}, "t-hud")) as Any;
    expect(frame.ok && frame.result.surface).toBe("cet_line");
    expect(frame.result.status_all.connection).toBe("XF Studio connected");
    const client = new BridgeClient({ ...host.session, pipe: host.session.control_pipe! }, 5000);
    await client.connect();
    client.close();
  }, 20_000);

  test("the tools' version is 0.8.10", () => {
    expect(JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8")).version).toBe("0.8.10");
  });
});

describe("0.8.2 review fixes (tools)", () => {
  test("review 6: a cancelled screenshot takes no picture without a bridge, or with clear_overlay false", async () => {
    for (const withSession of [false, true]) {
      const dir = tempDir("xfb-082-cap-");
      if (withSession) fakeSession(dir);
      const sent: string[] = [];
      const api = new CommandApi({ runtimeDir: dir, auditDir: join(dir, "logs"), captureRoot: join(dir, "captures"), transport: async () => ({ call: async (m) => (sent.push(m), answer({})), close: () => undefined }) });
      const controller = new AbortController();
      controller.abort("test");
      const out = await api.run("capture.screenshot", withSession ? { clear_overlay: false } : {}, { signal: controller.signal });
      expect(codeOf(out)).toBe("interrupted");
      expect(readdirSync(dir)).not.toContain("captures");
      expect(sent).toEqual([]);
      api.close();
    }
  });

  test("review 7: showroom discovery asks about every archive, 16 at a time, and combines the answers", async () => {
    const { loadedArchives } = await import("../showroom/commands.ts");
    const archives = Array.from({ length: 17 }, (_, i) => "xfs_showroom_" + i.toString(16).padStart(32, "0"));
    const asked: string[][] = [];
    const context = {
      cid: "t",
      api: {
        callBridge: async (_method: string, params: Any) => {
          asked.push(params.archives);
          return { ok: true, result: { archives: Object.fromEntries(params.archives.map((a: string) => [a, a === archives[16]])) } };
        },
      },
    } as unknown as CommandContext;
    const loaded = await loadedArchives(context, archives);
    expect(asked.map((a) => a.length)).toEqual([16, 1]);
    expect(loaded[archives[16]!]).toBe(true);
    expect(Object.keys(loaded).length).toBe(17);
  });
});
