import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { BridgeClient, PipeConnectError } from "../bridge-lib.ts";
import { CommandApi } from "../api/command-api.ts";
import { startSelftestHost, type Host, sleep } from "./helpers.ts";

let host: Host;
const clients: BridgeClient[] = [];
const apis: CommandApi[] = [];
beforeAll(async () => { host = await startSelftestHost(["--allow-writes", "--allow-test-hooks"]); }, 60000);
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
