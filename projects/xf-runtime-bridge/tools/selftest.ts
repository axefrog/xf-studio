// Offline self-test of the bridge core: runs build/Release/xfb_selftest.exe (the same transport,
// protocol and safety code as the plugin, with a simulated game thread) and checks it through
// the real client. Proves nothing about the game; it proves the bridge before the game session.
//
//   bun tools/selftest.ts [--exe <path to xfb_selftest.exe>]

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BridgeClient, readSession, type BridgeSession } from "./bridge-lib.ts";

const projectDir = resolve(import.meta.dir, "..");
const exeArg = process.argv.indexOf("--exe");
const exe = exeArg > 0 ? process.argv[exeArg + 1] : join(projectDir, "build", "Release", "xfb_selftest.exe");
if (!existsSync(exe)) {
  console.error(`missing ${exe}; build first: cmake --build build --config Release`);
  process.exit(2);
}

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` ${JSON.stringify(detail)}`}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function startHost(args: string[]): Promise<{ child: ChildProcess; dir: string; session: BridgeSession; log: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "xfb-selftest-"));
  const log: string[] = [];
  const child = spawn(exe, ["--runtime-dir", dir, "--seconds", "60", ...args], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (d) => log.push(...d.toString().split(/\r?\n/).filter(Boolean)));
  child.stderr!.on("data", (d) => log.push(...d.toString().split(/\r?\n/).filter(Boolean)));
  for (let i = 0; i < 100; i++) {
    const session = readSession(dir);
    if (session) return { child, dir, session, log };
    await sleep(50);
  }
  child.kill();
  throw new Error(`host did not write session.json; log:\n${log.join("\n")}`);
}

async function waitExit(child: ChildProcess, ms: number) {
  if (child.exitCode !== null) return true;
  return await Promise.race([new Promise<boolean>((r) => child.once("exit", () => r(true))), sleep(ms).then(() => false)]);
}

// --- Run 1: normal host, writes disabled, game thread pumping --------------------------------
{
  const { child, dir, session, log } = await startHost([]);
  check("session.json has pipe, sid and a 64-hex token", /^\\\\\.\\pipe\\xf-runtime-bridge-\d+-[0-9a-f]{12}$/.test(session.pipe) && /^[0-9a-f]{64}$/.test(session.token), { pipe: session.pipe, sid: session.sid });

  const client = new BridgeClient(session, 3000);
  await client.connect();

  let r = await client.call("ping", {}, "t-ping");
  check("ping answers pong with the session id", r.ok && (r.result as any).pong === true && (r.result as any).sid === session.sid && r.cid === "t-ping");

  r = await client.call("ping", {}, "t-badtoken", { token: "0".repeat(64) });
  check("wrong token is refused", !r.ok && r.error?.code === "unauthorized", r.error);

  r = await client.call("ping", {}, "t-notoken", { token: undefined });
  check("missing token is refused", !r.ok && r.error?.code === "unauthorized", r.error);

  r = await client.call("system.exec", { cmd: "calc" }, "t-unknown");
  check("unknown method is refused (allowlist)", !r.ok && r.error?.code === "unknown_method", r.error);

  r = await client.call("selftest.write", {}, "t-write");
  check("write method is refused while allow_writes = false", !r.ok && r.error?.code === "writes_disabled", r.error);

  r = await client.call("player.position", {}, "t-pos");
  check("game-thread method answers through the queue", r.ok && (r.result as any).simulated === true, r.result);

  r = await client.call("selftest.throw", {}, "t-throw");
  check("method error code crosses the game thread", !r.ok && r.error?.code === "not_in_game", r.error);

  r = await client.call("ping", {}, "bad cid with spaces");
  check("unsafe correlation id is replaced by a generated one", r.ok && /^n\d+$/.test(r.cid), r.cid);

  r = await client.sendRaw("{not json\n");
  check("invalid JSON gets bad_request", !r.ok && r.error?.code === "bad_request", r.error);

  r = await client.call("bridge.methods", {}, "t-methods");
  const methods = (r.result as any)?.methods ?? [];
  check("bridge.methods lists the allowlist with access classes", r.ok && methods.some((m: any) => m.name === "selftest.write" && m.access === "write" && m.enabled === false), methods.map((m: any) => m.name));

  // Rate limit: 20/s with a 40 burst. Fire 60 at once.
  const burst = await Promise.all(Array.from({ length: 60 }, (_, i) => client.call("ping", {}, `t-burst-${i}`)));
  const limited = burst.filter((b) => !b.ok && b.error?.code === "rate_limited").length;
  check("rate limit refuses a burst beyond 2 s of budget", limited >= 15, { limited });
  await sleep(2100);

  // Oversize message: the server answers too_large and drops the connection.
  r = await client.sendRaw("x".repeat(70 * 1024));
  check("oversize message is refused and the client dropped", !r.ok && (r.error?.code === "too_large" || r.error?.code === "disconnected"), r.error);
  client.close();
  await sleep(200);

  // A second connection works after the first one is dropped.
  const again = new BridgeClient(session, 3000);
  await again.connect();
  r = await again.call("ping", {}, "t-reconnect");
  check("server accepts a new client after a drop", r.ok);

  r = await again.call("bridge.kill", {}, "t-kill");
  check("bridge.kill answers", r.ok && (r.result as any).killed === true);
  r = await again.call("ping", {}, "t-after-kill");
  check("after kill every request is refused", !r.ok, r.error);
  again.close();

  await sleep(800);
  check("kill removes session.json", readSession(dir) === null);
  check("host exits after the listener closes", await waitExit(child, 3000));

  const text = log.join("\n");
  check("log lines carry sid and cid", text.includes(`sid=${session.sid}`) && text.includes("cid=t-ping"));
  check("token never appears in the log", !text.includes(session.token));
  check("audit log records refused writes", text.includes("evt=bridge.write_refused"));
  if (!child.killed && child.exitCode === null) child.kill();
  rmSync(dir, { recursive: true, force: true });
}

// --- Run 2: writes enabled -------------------------------------------------------------------
{
  const { child, dir, session } = await startHost(["--allow-writes"]);
  const client = new BridgeClient(session, 3000);
  await client.connect();
  const r = await client.call("selftest.write", {}, "t-write-on");
  check("write method runs when allow_writes = true", r.ok && (r.result as any).wrote === true, r);
  client.close();
  child.kill();
  await waitExit(child, 2000);
  rmSync(dir, { recursive: true, force: true });
}

// --- Run 3: game thread not pumping ----------------------------------------------------------
{
  const { child, dir, session } = await startHost(["--no-pump"]);
  const client = new BridgeClient(session, 3000);
  await client.connect();
  let r = await client.call("player.position", {}, "t-nopump");
  check("game-thread method before Running reports game_not_running", !r.ok && r.error?.code === "game_not_running", r.error);
  r = await client.call("ping", {}, "t-nopump-ping");
  check("ping still answers before Running", r.ok);
  client.close();

  // Kill file: create KILL beside session.json; the watcher stops the bridge within ~0.5 s.
  writeFileSync(join(dir, "KILL"), "");
  await sleep(1200);
  check("KILL file stops the bridge and removes session.json", readSession(dir) === null);
  check("host exits after the KILL file", await waitExit(child, 3000));
  if (child.exitCode === null) child.kill();
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
