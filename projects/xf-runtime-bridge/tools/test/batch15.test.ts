// Bridge 0.8.1: the wave-4 review's fixes on the tools' side (RB-119..128 in the code-health ledger), offline, with fake
// transports and child processes, and against the self-test host: emergency controls that never wait behind the queue
// (RB-121), photo.open's last check before the key (RB-122), the session lock as a mutex (RB-124), inventory undo's exact
// copy (RB-125), cc.back past a stuck busy flag (RB-126), a long teleport's undo (RB-127), a sweep whose return is refused
// (RB-128) and scene.read's null point (RB-123). Proves nothing about the game.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BridgeClient, type BridgeResponse } from "../bridge-lib.ts";
import type { CommandContext } from "../api/catalogue.ts";
import { CommandApi, EMERGENCY_COMMANDS, SUPERSEDING_COMMANDS, type BridgeTransport, type CommandOutcome } from "../api/command-api.ts";
import { REFUSALS } from "../api/catalogue080.ts";
import { BRIDGE_MESSAGES } from "../api/errors.ts";
import { acquireSessionLock, lockMutexName, lockPath, readSessionLock } from "../session-lock.ts";
import { runShowroomRotate } from "../showroom/commands.ts";
import { HOOK_TIMEOUT_MS, openSyntheticWindow, projectDir, sleep, startSelftestHost, tempDir, type Host, type Synthetic } from "./helpers.ts";

type Any = any;
const ALL = "photo,world,character,save,showroom,inventory,player";

async function ok(api: CommandApi, name: string, input: Record<string, unknown> = {}): Promise<Any> {
  const out = await api.run(name, input);
  expect(out.ok, `${name} ${JSON.stringify(out)}`).toBe(true);
  return out.ok ? (out.result as Any) : null;
}

const codeOf = (outcome: CommandOutcome) => (outcome.ok ? "ok" : outcome.error.code);

/** Settles with the promise's value, or "pending" when it hasn't settled within ms. */
const within = <T>(promise: Promise<T>, ms: number) => Promise.race([promise, sleep(ms).then(() => "pending" as const)]);

// --- RB-121: emergency controls -------------------------------------------------------------------------------------------

/** A fake bridge: game.status always says loading (so a game.wait never ends by itself); game.save hangs until released. */
function fakeBridge() {
  const dir = tempDir("xfb-rb121-");
  writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, pid: process.pid, pipe: String.raw`\\.\pipe\xfb-none`, sid: "s", token: "t" }));
  const sent: string[] = [];
  let releaseSave: (() => void) | null = null;
  const answer = (result: unknown): BridgeResponse => ({ v: 1, id: 1, cid: "c", ok: true, result });
  const transport: BridgeTransport = {
    call: async (method) => {
      sent.push(method);
      if (method === "game.status") return answer({ phase: "loading" });
      if (method === "game.save") {
        await new Promise<void>((resolve) => (releaseSave = resolve));
        return answer({ saved: true });
      }
      if (method === "bridge.handover") return answer({ was: false, player_released: { released: true, removed: [] } });
      return answer({});
    },
    close: () => undefined,
  };
  const api = new CommandApi({ runtimeDir: dir, auditDir: join(dir, "logs"), captureRoot: join(dir, "captures"), transport: async () => transport, idleCloseMs: 60_000 });
  return { dir, api, sent, release: () => releaseSave?.() };
}

describe("RB-121: emergency controls never wait behind the queue", () => {
  test("the kill answers at once during a ten-minute game.wait; what was sent before it is cancelled, later commands run", async () => {
    const { api, sent } = fakeBridge();
    const wait = api.run("game.wait", { phase: ["photo_mode"], timeout_ms: 600000 });
    const queued = api.run("photo.state");
    await sleep(150);
    const started = performance.now();
    const kill = await api.run("bridge.kill");
    expect(kill.ok, JSON.stringify(kill)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
    // The running wait stops at its next step; the queued read never started.
    const waited = await within(wait, 2000);
    expect(waited !== "pending" && codeOf(waited)).toBe("superseded");
    expect(waited !== "pending" && !waited.ok && waited.error.message).toContain("bridge_kill");
    const read = await queued;
    expect(codeOf(read)).toBe("superseded");
    expect(!read.ok && read.error.message).toContain("before it started");
    expect(sent).not.toContain("photo.state");
    // A command sent after the kill runs as usual.
    expect(codeOf(await api.run("game.status"))).toBe("ok");
    api.close();
  });

  test("with a request still waiting for its answer on the pipe, the kill writes the KILL file at once", async () => {
    const { dir, api, release } = fakeBridge();
    const save = api.run("game.save", {});
    await sleep(100);
    const started = performance.now();
    const kill = await api.run("bridge.kill");
    expect(performance.now() - started).toBeLessThan(500);
    expect(kill.ok && (kill.result as Any).route).toBe("kill_file");
    expect(existsSync(join(dir, "KILL"))).toBe(true);
    release();
    await save;
    api.close();
  });

  test("a stop goes ahead beside a running wait without cancelling it; a handover cancels it", async () => {
    const { api, sent } = fakeBridge();
    const wait = api.run("game.wait", { phase: ["photo_mode"], timeout_ms: 600000 });
    await sleep(100);
    const stop = await within(api.run("behave.stop", { all: true }), 1000);
    expect(stop !== "pending" && codeOf(stop)).toBe("ok");
    expect(await within(wait, 700)).toBe("pending");
    const handover = await within(api.run("session.handover", {}), 2000);
    expect(handover !== "pending" && codeOf(handover)).toBe("ok");
    expect(sent).toContain("bridge.handover");
    const waited = await within(wait, 2000);
    expect(waited !== "pending" && codeOf(waited)).toBe("superseded");
    api.close();
  });

  test("the sets and the plain words", () => {
    expect([...EMERGENCY_COMMANDS].sort()).toEqual(["behave.stop", "bridge.kill", "player.stop", "session.handover", "session.resume", "supervisor.clear", "test.record.stop"]);
    expect([...SUPERSEDING_COMMANDS].sort()).toEqual(["bridge.kill", "session.handover"]);
    expect(BRIDGE_MESSAGES.superseded).toContain("emergency control");
  });
});

// --- RB-121 review: the control route, the barrier, cancellation inside local workflows -------------------------------------

/** A main pipe that answers one request at a time, as the plugin's does, with player.look holding it for lookMs. */
function serialBridge(lookMs: number) {
  const dir = tempDir("xfb-rb121-serial-");
  writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, pid: process.pid, pipe: String.raw`\\.\pipe\xfb-none`, control_pipe: String.raw`\\.\pipe\xfb-none-control`, sid: "s", token: "t" }));
  const main: string[] = [], control: string[] = [];
  let busy: Promise<void> = Promise.resolve();
  const answer = (result: unknown): BridgeResponse => ({ v: 1, id: 1, cid: "c", ok: true, result });
  const mainTransport: BridgeTransport = {
    call: async (method) => {
      const turn = busy;
      let done!: () => void;
      busy = new Promise<void>((r) => (done = r));
      await turn;
      try {
        main.push(method);
        if (method === "player.look") await sleep(lookMs);
        return answer(method === "game.status" ? { phase: "gameplay" } : {});
      } finally {
        done();
      }
    },
    close: () => undefined,
  };
  const controlTransport: BridgeTransport = {
    call: async (method, params) => {
      control.push(`${method}${method === "bridge.handover" ? `:${String(params.on)}` : ""}`);
      if (method === "bridge.handover") return answer({ was: false, player_released: { released: true, removed: [] } });
      return answer(method === "game.status" ? { phase: "gameplay" } : {});
    },
    close: () => undefined,
  };
  const api = new CommandApi({
    runtimeDir: dir,
    auditDir: join(dir, "logs"),
    captureRoot: join(dir, "captures"),
    transport: async () => mainTransport,
    controlTransport: async () => controlTransport,
    idleCloseMs: 60_000,
  });
  return { api, main, control };
}

describe("RB-121 review: stops go on the control route, emergencies are barriers, cancellation reaches local work", () => {
  test("player.stop, behave.stop and a handover answer at once while the main pipe serves a five-second look", async () => {
    const { api, main, control } = serialBridge(5000);
    const look = api.callBridge("player.look", {}, "t-look");
    await sleep(100);
    for (const [name, input] of [["player.stop", {}], ["behave.stop", { all: true }], ["session.handover", {}]] as const) {
      const started = performance.now();
      const out = await api.run(name, input);
      expect(codeOf(out), name).toBe("ok");
      expect(performance.now() - started, name).toBeLessThan(1000);
    }
    expect(control).toEqual(expect.arrayContaining(["player.stop", "behave.stop", "bridge.handover:true"]));
    expect(main).toEqual(["player.look"]);
    expect(await within(look, 100)).toBe("pending");
    await look;
    api.close();
  }, 15_000);

  test("a resume sent right after a handover waits for it: the session ends resumed", async () => {
    const dir = tempDir("xfb-rb121-barrier-");
    writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, pid: process.pid, pipe: String.raw`\\.\pipe\xfb-none`, sid: "s", token: "t" }));
    const order: string[] = [];
    const transport: BridgeTransport = {
      call: async (method, params) => {
        if (method === "bridge.handover") {
          if (params.on === true) await sleep(300); // the handover's last step is slow
          order.push(`handover:${String(params.on)}`);
          return { v: 1, id: 1, cid: "c", ok: true, result: { was: !params.on, player_released: { released: true, removed: [] } } };
        }
        return { v: 1, id: 1, cid: "c", ok: true, result: method === "game.status" ? { phase: "gameplay" } : {} };
      },
      close: () => undefined,
    };
    const api = new CommandApi({ runtimeDir: dir, auditDir: join(dir, "logs"), transport: async () => transport, idleCloseMs: 60_000 });
    const handover = api.run("session.handover", {});
    const resume = api.run("session.resume", {});
    expect(codeOf(await handover)).toBe("ok");
    expect(codeOf(await resume)).toBe("ok");
    expect(order).toEqual(["handover:true", "handover:false"]);
    api.close();
  });

  test("a handover during a sweep's settle: no further step, the return is still tried, and a refused return keeps its undo in the answer", async () => {
    const dir = tempDir("xfb-rb121-sweep-");
    writeFileSync(join(dir, "session.json"), JSON.stringify({ protocol: 1, pid: process.pid, pipe: String.raw`\\.\pipe\xfb-none`, sid: "s", token: "t" }));
    const turns: string[] = [];
    const ok = (result: unknown): BridgeResponse => ({ v: 1, id: 1, cid: "c", ok: true, result });
    const transport: BridgeTransport = {
      call: async (method, params) => {
        if (method === "showroom.state") return ok({ pieces: [{ index: 0, label: "a", appearance: "x", position: [0, 0, 0], yaw: 15, base_yaw: 10, spawned: true }] });
        if (method === "showroom.turn") {
          turns.push(String((params.turns as Any[])[0].yaw));
          // The first step turns; anything after it (here: the return) is refused, as the player's pause would.
          if (turns.length > 1) return { v: 1, id: 1, cid: "c", ok: false, error: { code: "writes_paused", message: "paused" } };
          return ok({ turned: [] });
        }
        if (method === "bridge.handover") return ok({ was: false, player_released: { released: true, removed: [] } });
        return ok(method === "game.status" ? { phase: "gameplay" } : {});
      },
      close: () => undefined,
    };
    const api = new CommandApi({ runtimeDir: dir, auditDir: join(dir, "logs"), transport: async () => transport, idleCloseMs: 60_000 });
    const sweep = api.run("showroom.rotate", { sweep: { steps: 5, settle_ms: 1500 } });
    await sleep(300); // inside the first step's settle
    expect(codeOf(await api.run("session.handover", {}))).toBe("ok");
    const out = await within(sweep, 1000);
    expect(out).not.toBe("pending");
    const outcome = out as CommandOutcome;
    expect(codeOf(outcome)).toBe("superseded");
    // The first step's turn (base 10 - 60 = -50), then no further step: only the return to the start (15), refused.
    expect(turns).toEqual(["-50", "15"]);
    if (!outcome.ok) {
      expect(outcome.error.cause).toBe("interrupted");
      expect(outcome.error.detail).toContain("weren't turned back");
      expect(outcome.error.detail).toContain('"method":"showroom.turn"');
    }
    api.close();
  });
});

// --- RB-124: the session lock is a mutex ----------------------------------------------------------------------------------

const holderScript = join(projectDir, "tools", "test", "fixtures", "lock-holder.ts");

/** A child process that tries the lock: prints "won" (and holds it for holdMs) or "lost <pid>". */
function tryInChild(dir: string, holdMs: number) {
  const child = spawn(process.execPath, [holderScript, dir, String(holdMs)], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout!.on("data", (d) => (out += String(d)));
  const first = new Promise<string>((resolve) => {
    const check = () => (out.includes("\n") ? resolve(out.split("\n")[0]!.trim()) : setTimeout(check, 10));
    check();
  });
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  return { child, first, exited };
}

describe("RB-124: one session runner at a time, by an OS mutex", () => {
  test("six runners starting at once: exactly one wins", async () => {
    const dir = tempDir("xfb-lock-race-");
    // Each holds what it wins until it is killed, so a slow starter can't win after an early winner let go.
    const runners = Array.from({ length: 6 }, () => tryInChild(dir, 120_000));
    const answers = await Promise.all(runners.map((r) => r.first));
    expect(answers.filter((a) => a === "won")).toHaveLength(1);
    expect(answers.filter((a) => a.startsWith("lost"))).toHaveLength(5);
    // This process is refused too while the winner holds it, and is told who holds it.
    const blocked = acquireSessionLock(dir, "session-x");
    expect("heldBy" in blocked).toBe(true);
    const winner = runners[answers.indexOf("won")]!;
    expect("heldBy" in blocked && blocked.heldBy.pid).toBe(winner.child.pid!);
    for (const r of runners) r.child.kill();
    await Promise.all(runners.map((r) => r.exited));
    const after = acquireSessionLock(dir, "session-x");
    expect("release" in after).toBe(true);
    (after as { release: () => void }).release();
  }, 30_000);

  test("a runner that dies holding the lock frees it (no stale lock to judge), and this process can't take it twice", async () => {
    const dir = tempDir("xfb-lock-dead-");
    const holder = tryInChild(dir, 60_000);
    expect(await holder.first).toBe("won");
    expect(readSessionLock(dir)?.pid).toBe(holder.child.pid!);
    holder.child.kill(); // TerminateProcess: no release, the lock file stays behind
    await holder.exited;
    expect(existsSync(lockPath(dir))).toBe(true);
    const mine = acquireSessionLock(dir, "session-y");
    expect("release" in mine).toBe(true);
    expect(readSessionLock(dir)?.script).toBe("session-y");
    const again = acquireSessionLock(dir, "session-z");
    expect("heldBy" in again && again.heldBy.script).toBe("session-y");
    (mine as { release: () => void }).release();
    expect(existsSync(lockPath(dir))).toBe(false);
    expect(lockMutexName(dir)).toMatch(/^Local\\XFRuntimeBridge\.SessionRunner\.[0-9a-f]{32}$/);
    expect(lockMutexName(dir.toUpperCase())).toBe(lockMutexName(dir));
  }, 30_000);
});

// --- RB-126: cc.back past a stuck busy flag --------------------------------------------------------------------------------

describe("RB-126: Back isn't held by the appearance screen's busy flag", () => {
  test("XFCharacter.Leave asks Busy only on the Confirm route; Back clears the flag and says so", () => {
    const source = readFileSync(join(projectDir, "redscript", "XFRuntimeBridgeActions.reds"), "utf8");
    const leave = source.slice(source.indexOf("public static func Leave(cid: String, mode: Int32)"), source.indexOf("public static func Snapshot()"));
    const busyAt = leave.indexOf("XFCharacter.Busy(cid, menu)");
    expect(busyAt).toBeGreaterThan(0);
    expect(leave.indexOf("XFCharacter.Busy(cid, menu)", busyAt + 1)).toBe(-1);
    // The one Busy check sits inside `if keep {`, and the else branch clears the flag.
    const keepAt = leave.lastIndexOf("if keep {", busyAt);
    expect(keepAt).toBeGreaterThan(0);
    expect(leave.slice(keepAt, busyAt)).not.toContain("}");
    expect(leave).toContain("busy_cleared");
    expect(REFUSALS["cc.back"]).not.toContain("busy");
    expect(REFUSALS["cc.confirm"]).toContain("busy");
  });
});

// --- RB-128: a refused return after a sweep --------------------------------------------------------------------------------

describe("RB-128: a sweep whose heads can't be turned back says so", () => {
  const heads = [{ index: 0, label: "a", appearance: "x", position: [0, 0, 0], yaw: 15, base_yaw: 10, spawned: true }];
  const contextFor = (refuseReturn: boolean, failStep = false) => {
    let turns = 0;
    return {
      api: {
        callBridge: async (method: string) => {
          if (method === "showroom.state") return { ok: true, result: { pieces: heads } };
          if (method === "showroom.turn") {
            turns++;
            if (failStep && turns === 2) return { ok: false, error: { code: "timeout", message: "The game was too busy." } };
            // The third turn is the return: after two steps, or after a step that failed (the second).
            if (refuseReturn && turns === 3) return { ok: false, error: { code: "writes_paused", message: "Changes are paused." } };
            return { ok: true, result: { turned: [] } };
          }
          return { ok: true, result: {} };
        },
      },
      cid: "t-rb128",
    } as unknown as CommandContext;
  };

  test("a refused return: returned false, the reason, and the exact undo", async () => {
    const out = (await runShowroomRotate({ sweep: { steps: 2, settle_ms: 0 } }, contextFor(true))).value as Any;
    expect(out.returned).toBe(false);
    expect(out.return_failed).toMatchObject({ code: "writes_paused" });
    expect(out.warning).toContain("weren't turned back");
    expect(out.undo).toEqual({ method: "showroom.turn", params: { turns: [{ index: 0, yaw: 15 }] } });
  });

  test("a return that worked: returned true, no warning", async () => {
    const out = (await runShowroomRotate({ sweep: { steps: 2, settle_ms: 0 } }, contextFor(false))).value as Any;
    expect(out.returned).toBe(true);
    expect(out.warning).toBeUndefined();
  });

  test("a sweep that failed part-way and couldn't turn back: the error carries both", async () => {
    let error: Any = null;
    try {
      await runShowroomRotate({ sweep: { steps: 3, settle_ms: 0 } }, contextFor(true, true));
    } catch (e) {
      error = e;
    }
    expect(error?.plain?.code).toBe("timeout");
    expect(error?.plain?.detail).toContain("weren't turned back");
    expect(error?.plain?.detail).toContain("showroom.turn");
  });
});

// --- against the self-test host --------------------------------------------------------------------------------------------

describe("0.8.1 against the self-test host", () => {
  let host: Host;
  let api: CommandApi;
  let synthetic: Synthetic;
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", ALL], 240);
    api = new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-b15-cap-"), "captures"), auditDir: tempDir("xfb-b15-audit-"), idleCloseMs: 300 });
    synthetic = await openSyntheticWindow(320, 180);
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    synthetic?.close();
    api?.close();
    await host?.stop();
  }, HOOK_TIMEOUT_MS);

  const phase = async (value: string) => expect((await api.callBridge("selftest.phase", { phase: value }, "t-phase")).ok).toBe(true);

  test("RB-123: scene.read refuses a null point (and other bad points) before anything reads it", async () => {
    for (const points of [[null], [[1, 2]], [[1, 2, "x"]], [[0, 0, 1e7]]]) {
      const response = await api.callBridge("scene.read", { points }, "t-rb123");
      expect(!response.ok && response.error.code, JSON.stringify(points)).toBe("bad_params");
    }
    expect((await api.callBridge("scene.read", { points: [[100, 200, 11]], parts: ["camera"] }, "t-rb123")).ok).toBe(true);
  });

  test("RB-127: a permitted long teleport's undo carries far, and runs", async () => {
    await phase("gameplay");
    const moved = await ok(api, "player.teleport", { position: [100, 290, 10], far: true });
    expect(moved.undo).toEqual({ method: "player.teleport", params: { position: [100, 200, 10], yaw: 0, ground: "exact", far: true } });
    await sleep(600);
    await ok(api, moved.undo.method, moved.undo.params);
    expect((await ok(api, "player.state")).position).toEqual([100, 200, 10]);
    await sleep(600);
    // A short one's undo doesn't need it.
    const near = await ok(api, "player.teleport", { offset: { forward: 2 } });
    expect(near.undo.params.far).toBeUndefined();
    await sleep(600);
    await ok(api, near.undo.method, near.undo.params);
  });

  test("RB-125: an inventory undo names the exact copy that was worn, and equipping by id says whether that copy was found", async () => {
    await phase("gameplay");
    await ok(api, "inventory.equip", { item: "Items.Jacket_01_basic_01" });
    const coat = await ok(api, "inventory.equip", { item: "Items.Coat_01_basic_01", add_if_missing: true });
    expect(coat.undo.method).toBe("inventory.equip");
    expect(coat.undo.params).toMatchObject({ item: "Items.Jacket_01_basic_01", slot: "OuterChest" });
    expect(coat.undo.params.id).toMatch(/^[0-9]{1,20}$/);
    const back = await ok(api, coat.undo.method, coat.undo.params);
    expect(back.exact).toBe(true);
    const off = await ok(api, "inventory.unequip", { slot: "OuterChest" });
    expect(off.undo.params).toMatchObject({ item: "Items.Jacket_01_basic_01", id: coat.undo.params.id });
    const other = await ok(api, "inventory.equip", { item: "Items.Jacket_01_basic_01", id: "12345" });
    expect(other.exact).toBe(false);
    expect(other.exact_note).toContain("12345");
    expect(codeOf(await api.run("inventory.equip", { item: "Items.Jacket_01_basic_01", id: "12a" }))).toBe("bad_input");
    expect((await api.callBridge("inventory.equip", { item: "Items.Jacket_01_basic_01", id: "12a" }, "t-rb125")).ok).toBe(false);
    await ok(api, "inventory.unequip", { slot: "OuterChest" });
  });

  test("RB-122: photo.open checks the pause and the handover again right before the key", async () => {
    const sent: number[] = [];
    let interfere: (() => Promise<unknown>) | null = null;
    // The pipe takes one client at a time: this test's own API holds it until it closes.
    api.disconnect();
    const opener = new CommandApi({
      runtimeDir: host.dir,
      captureRoot: join(tempDir("xfb-b15-open-"), "captures"),
      captureTarget: { hwnd: synthetic.hwnd },
      idleCloseMs: 300,
      keySender: async (_target, vk, route, options) => {
        // While the window "comes to the front", the player pauses changes or the session is handed over.
        await interfere?.();
        await options?.beforeSend?.();
        sent.push(vk);
        return { route, focused_by_bridge: false, scan_code: 0x31, extended: false };
      },
    });
    try {
      expect((await opener.callBridge("selftest.phase", { phase: "gameplay" }, "t-rb122")).ok).toBe(true);
      interfere = () => opener.callBridge("selftest.pause_writes", { paused: true }, "t-rb122");
      expect(codeOf(await opener.run("photo.open", {}))).toBe("writes_paused");
      await opener.callBridge("selftest.pause_writes", { paused: false }, "t-rb122");
      interfere = () => opener.callBridge("bridge.handover", { on: true }, "t-rb122");
      expect(codeOf(await opener.run("photo.open", {}))).toBe("handed_over");
      await opener.callBridge("bridge.handover", { on: false }, "t-rb122");
      expect(sent).toEqual([]);
    } finally {
      opener.close();
    }
  }, 20_000);

  test("RB-121: the bridge's control pipe answers a stop while the main pipe holds a long request, and only the emergency controls", async () => {
    expect(host.session.control_pipe).toMatch(/-control$/);
    const hold = api.callBridge("selftest.hold", { ms: 4000 }, "t-hold");
    await sleep(200);
    const started = performance.now();
    const stop = await api.run("player.stop", {});
    expect(codeOf(stop)).toBe("ok");
    expect(performance.now() - started).toBeLessThan(2000);
    expect(await within(hold, 50)).toBe("pending");
    const behaviours = await api.run("behave.stop", { all: true });
    expect(codeOf(behaviours)).toBe("ok");
    expect((await hold).ok).toBe(true);
    // Anything else on the control pipe is refused.
    const client = new BridgeClient({ ...host.session, pipe: host.session.control_pipe! }, 5000);
    await client.connect();
    try {
      const refused = await client.call("game.saves", {}, "t-not-control");
      expect(!refused.ok && refused.error?.code).toBe("not_on_control_route");
      const read = await client.call("game.status", {}, "t-control-status");
      expect(read.ok).toBe(true);
    } finally {
      client.close();
    }
  }, 20_000);

  test("RB-125: with two copies of one record, the undo puts back the copy that was worn", async () => {
    await phase("gameplay");
    const second = (await api.callBridge("selftest.give", { item: "Items.Jacket_01_basic_01", copy: 2 }, "t-give")) as Any;
    expect(second.ok).toBe(true);
    // V wears the second copy, then another jacket goes over it.
    const worn = await ok(api, "inventory.equip", { item: "Items.Jacket_01_basic_01", id: second.result.id });
    expect(worn.exact).toBe(true);
    expect((await api.callBridge("selftest.state", {}, "t-state") as Any).result.worn.OuterChest).toBe("Items.Jacket_01_basic_01#2");
    const coat = await ok(api, "inventory.equip", { item: "Items.Coat_01_basic_01", add_if_missing: true });
    expect(coat.undo.params.id).toBe(second.result.id);
    const back = await ok(api, coat.undo.method, coat.undo.params);
    expect(back).toMatchObject({ exact: true, equipped: true });
    // The first copy comes first in V's inventory; the undo still put the second one back.
    expect((await api.callBridge("selftest.state", {}, "t-state") as Any).result.worn.OuterChest).toBe("Items.Jacket_01_basic_01#2");
    await ok(api, "inventory.unequip", { slot: "OuterChest" });
  });

  test("the tools' version is 0.8.19", () => {
    expect(JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8")).version).toBe("0.8.19");
  });
});
