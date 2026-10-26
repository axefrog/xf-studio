import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { BridgeClient, PipeConnectError } from "../bridge-lib.ts";
import { CommandApi } from "../api/command-api.ts";
import { requireAutonomousSelftest, startSelftestHost, type Host, sleep } from "./helpers.ts";

let host: Host;
const clients: BridgeClient[] = [];
const apis: CommandApi[] = [];
beforeAll(async () => { requireAutonomousSelftest(); host = await startSelftestHost(["--allow-writes", "--allow-test-hooks", "--write-classes", "photo,world,character,npc"]); }, 60000);
afterAll(async () => { for (const api of apis) api.close(); for (const c of clients) c.close(); await host?.stop(); });
const client = async (readOnly = false) => {
  const c = new BridgeClient(host.session, 500); clients.push(c);
  await c.connect({ readOnly, busyWaitMs: 200 }); return c;
};
const api = (readOnly = false) => {
  const a = new CommandApi({ runtimeDir: host.dir, readOnly, idleCloseMs: 60000,
    auditDir: join(host.dir, "audit"), captureRoot: join(host.dir, "capture") }); apis.push(a); return a;
};

test("writer and two persistent digest readers coexist; disconnect leaves writer and recorder owned", async () => {
  const writer = api(), first = api(true), second = api(true);
  try {
    expect(host.session.read_only_pipes).toHaveLength(3);
    const start = await writer.run("test.record.start", { channels: ["v"], duration_s: 5 });
    expect(start.ok).toBe(true);
    for (let i = 0; i < 4; ++i) {
      const outcomes = await Promise.all([first.run("game.digest"), second.run("game.digest"), writer.run("session.note", { text: `writer ${i}` })]);
      expect(outcomes.map(o => o.ok)).toEqual([true, true, true]);
      await sleep(80);
    }
    const refused = await first.run("session.note", { text: "must not reach native" });
    expect(refused.ok ? "ok" : refused.error.code).toBe("read_only_connection");
    first.close(); second.close();
    await sleep(150);
    if (start.ok) {
      const page = await writer.run("test.record.read", { run: (start.result as any).run });
      expect(page.ok).toBe(true);
      if (page.ok) expect((page.result as any).active).toBe(true);
    }
    const busy = new BridgeClient(host.session, 100); clients.push(busy);
    await expect(busy.connect({ busyWaitMs: 20 })).rejects.toBeInstanceOf(PipeConnectError);
    expect((await writer.run("session.note", { text: "writer survived" })).ok).toBe(true);
    expect((await writer.run("test.record.stop")).ok).toBe(true);
  } finally { writer.close(); first.close(); second.close(); }
}, 15000);

test("native reader enforces role, pool capacity and independent cursors; slot reusable", async () => {
  const writer = await client();
  const a = await client(true), b = await client(true), c = await client(true);
  try {
    expect((await a.call("session.note", { text: "forbidden" })).error?.code).toBe("read_only_connection");
    expect((await a.call("test.record.start", {})).error?.code).toBe("read_only_connection");
    for (const method of ["game.saves", "game.options.read"])
      expect((await a.call(method, {})).error?.code).toBe("read_only_connection");
    expect((await a.call("behave.stop", { all: true })).ok).toBe(true);
    const extra = new BridgeClient(host.session, 50); clients.push(extra);
    await expect(extra.connect({ readOnly: true, busyWaitMs: 0 })).rejects.toBeInstanceOf(PipeConnectError);
    const note = await writer.call("session.note", { text: "independent cursor" });
    expect(note.ok).toBe(true);
    const since = Number((note.result as any).seq) - 1;
    const [one, two] = await Promise.all([a.call("session.events", { since }), b.call("session.events", { since })]);
    expect(one.result).toEqual(two.result);
    a.close(); await sleep(50);
    const replacement = await client(true); replacement.close();
    expect((await writer.call("ping")).ok).toBe(true);
  } finally { writer.close(); a.close(); b.close(); c.close(); }
}, 10000);

test("reader NPC picks cannot consume shared ownership; list/status remain readable", async () => {
  const writer = await client(), raw = await client(true);
  let opened = 0;
  const reader = new CommandApi({ readOnly: true, runtimeDir: host.dir, transport: async () => {
    ++opened; throw new Error("reader policy must refuse before transport opens");
  } });
  try {
    const refused = await reader.run("npc.pick", { id: "EntityID(9001)" });
    expect(refused.ok ? "ok" : refused.error.code).toBe("read_only_connection");
    expect(opened).toBe(0);
    for (let i = 0; i < 6; ++i)
      expect((await raw.call("npc.pick", { id: "EntityID(9001)" })).error?.code).toBe("read_only_connection");
    expect((await raw.call("npc.list", {})).ok).toBe(true);
    const status = await raw.call("npc.status", {});
    expect(status.ok).toBe(true); expect((status.result as any).npcs).toEqual([]);
    raw.close();
    const pick = await writer.call("npc.pick", { id: "EntityID(9001)" });
    expect(pick.ok).toBe(true); expect((pick.result as any).already).not.toBe(true);
    if (pick.ok) expect((await writer.call("npc.release", { who: (pick.result as any).who })).ok).toBe(true);
  } finally { writer.close(); raw.close(); reader.close(); }
});

test("reader flood backs off across reconnect; writer/control remain usable and repeats coalesce", async () => {
  const endpoint = { ...host.session, pipe: host.session.read_only_pipes![0]! };
  const flood = new BridgeClient(endpoint, 3000), replacement = new BridgeClient(endpoint, 3000);
  clients.push(flood, replacement);
  const writer = api();
  try {
    await flood.connect({ busyWaitMs: 2000 });
    let limited = false;
    for (let i = 0; i < 100; ++i) {
      const result = await flood.call("ping", {});
      if (result.error?.code === "rate_limited") { limited = true; break; }
    }
    expect(limited).toBe(true);
    const began = performance.now(); flood.close();
    await replacement.connect({ busyWaitMs: 2000 });
    // A client may open the OS handle during cooldown; its request must still wait.
    await replacement.call("ping", {});
    expect(performance.now() - began).toBeGreaterThanOrEqual(80);
    expect((await writer.run("session.note", { text: "writer survives flood" })).ok).toBe(true);
    expect((await writer.run("behave.stop", { all: true })).ok).toBe(true);
    const first = await replacement.call("player.stop", {});
    const second = await replacement.call("player.stop", {});
    expect(first.ok).toBe(true); expect(second.ok).toBe(true);
    expect((second.result as any).coalesced).toBe(true);
    expect((await writer.run("player.stop", {})).ok).toBe(true);
  } finally { flood.close(); replacement.close(); writer.close(); }
}, 15000);

test("reader emergency route remains available", async () => {
  const reader = api(true);
  try {
    expect((await reader.run("behave.stop", { all: true })).ok).toBe(true);
    const writer = await client(), rawReader = await client(true);
    try {
      expect((await rawReader.call("bridge.kill", {})).ok).toBe(true);
      await sleep(50);
      expect((await writer.call("ping")).ok).toBe(false);
    } finally { writer.close(); rawReader.close(); }
  } finally { reader.close(); }
});
