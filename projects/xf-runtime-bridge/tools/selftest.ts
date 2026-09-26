// Offline self-test of the bridge core: runs build/Release/xfb_selftest.exe (the same transport,
// protocol and safety code as the plugin, with a simulated game thread) and checks it through
// the real clients (bridge-lib.ts, the Bun CLI and the PowerShell CLI). Proves nothing about
// the game; it proves the bridge before the game session.
//
//   bun tools/selftest.ts [--exe <path to xfb_selftest.exe>]

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BridgeClient, PipeConnectError, readSession, type BridgeSession } from "./bridge-lib.ts";

const projectDir = resolve(import.meta.dir, "..");
const exeArg = process.argv.indexOf("--exe");
const exe = exeArg > 0 ? process.argv[exeArg + 1] : join(projectDir, "build", "Release", "xfb_selftest.exe");
if (!existsSync(exe)) {
  console.error(`missing ${exe}; build first: cmake --build build --config Release`);
  process.exit(2);
}

let failures = 0;
let checks = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  checks++;
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` ${JSON.stringify(detail)}`}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Host = { child: ChildProcess; dir: string; session: BridgeSession; log: string[]; exitedAt: () => number | null };

async function startHost(args: string[], seconds = 60): Promise<Host> {
  const dir = mkdtempSync(join(tmpdir(), "xfb-selftest-"));
  const log: string[] = [];
  let exitedAt: number | null = null;
  const child = spawn(exe, ["--runtime-dir", dir, "--seconds", String(seconds), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  child.once("exit", () => (exitedAt = performance.now()));
  child.stdout!.on("data", (d) => log.push(...d.toString().split(/\r?\n/).filter(Boolean)));
  child.stderr!.on("data", (d) => log.push(...d.toString().split(/\r?\n/).filter(Boolean)));
  for (let i = 0; i < 100; i++) {
    const session = readSession(dir);
    if (session) return { child, dir, session, log, exitedAt: () => exitedAt };
    await sleep(50);
  }
  child.kill();
  throw new Error(`host did not write session.json; log:\n${log.join("\n")}`);
}

async function waitExit(child: ChildProcess, ms: number) {
  if (child.exitCode !== null) return true;
  return await Promise.race([new Promise<boolean>((r) => child.once("exit", () => r(true))), sleep(ms).then(() => false)]);
}

async function waitFor(condition: () => boolean, ms: number) {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    if (condition()) return true;
    await sleep(20);
  }
  return condition();
}

const count = (log: string[], text: string) => log.filter((line) => line.includes(text)).length;
const stopMs = (log: string[]) => {
  const line = log.find((l) => l.includes("evt=bridge.server_stopped"));
  const match = line && /stop_ms=(\d+)/.exec(line);
  return match ? Number(match[1]) : null;
};
const nested = (depth: number) => "[".repeat(depth) + "]".repeat(depth);

// --- Run 0: in-process unit checks (log sanitising, nesting pre-scan, queue task states) -----
{
  const unit = spawnSync(exe, ["--unit"], { encoding: "utf8" });
  const lines = (unit.stdout ?? "").split(/\r?\n/).filter((l) => /^(PASS|FAIL) unit:/.test(l));
  for (const line of lines) check(line.replace(/^(PASS|FAIL) /, ""), line.startsWith("PASS"));
  check("unit checks ran and passed", unit.status === 0 && lines.length >= 15, { status: unit.status, count: lines.length });
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
  check("bridge.kill is a control method, enabled with writes off", methods.some((m: any) => m.name === "bridge.kill" && m.access === "control" && m.enabled === true));

  // RB-03: invalid UTF-8 from a method is replaced, never thrown.
  r = await client.call("selftest.bad_utf8", {}, "t-utf8");
  check("invalid UTF-8 in a result is answered with U+FFFD", r.ok && String((r.result as any)?.text).includes("�"), r.result);

  // RB-01: only scalar ids are echoed; nesting up to 32 levels is fine.
  r = await client.call("ping", {}, "t-id-string", { id: "abc" });
  check("a string id is echoed", r.ok && r.id === "abc", r.id);
  r = await client.call("ping", {}, "t-id-array", { id: [[1]] });
  check("an array id is answered with id null", r.ok && r.id === null, r.id);
  r = await client.call("ping", JSON.parse(`{"deep":${nested(30)}}`), "t-depth-32");
  check("a request nested 32 levels deep is accepted", r.ok, r.error);

  // RB-04: a game-thread task that finishes within the grace period answers normally; one that
  // runs past timeout + grace answers timeout_after_start and its late completion is logged.
  r = await client.call("selftest.slow", { ms: 1500 }, "t-slow-grace");
  check("a running task finishing within the grace period answers ok", r.ok && (r.result as any)?.slept_ms === 1500, r.error ?? r.result);
  const lateStarted = performance.now();
  r = await client.call("selftest.slow", { ms: 2600 }, "t-slow-late");
  const lateMs = Math.round(performance.now() - lateStarted);
  check("a task still running after timeout + grace answers timeout_after_start", !r.ok && r.error?.code === "timeout_after_start" && lateMs < 2500, { code: r.error?.code, ms: lateMs });
  check("its late completion is logged", await waitFor(() => log.some((l) => l.includes("evt=game.task_completed_late") && l.includes("cid=t-slow-late")), 2000));

  // Rate limit: 20/s with a 40 burst. Fire 60 at once.
  await sleep(2100);
  const burst = await Promise.all(Array.from({ length: 60 }, (_, i) => client.call("ping", {}, `t-burst-${i}`)));
  const limited = burst.filter((b) => !b.ok && b.error?.code === "rate_limited").length;
  check("rate limit refuses a burst beyond 2 s of budget", limited >= 15, { limited });
  await sleep(2100);

  // Oversize message: the server answers too_large and drops the connection.
  r = await client.sendRaw("x".repeat(70 * 1024));
  check("oversize message is refused and the client dropped", !r.ok && (r.error?.code === "too_large" || r.error?.code === "disconnected"), r.error);
  client.close();
  await sleep(700);

  // RB-01: a 5,000-deep id (10 KB, no token) used to overflow the stack. Now: bad_request, and the host lives.
  const deep = new BridgeClient(session, 3000);
  await deep.connect();
  r = await deep.sendRaw(`{"method":"ping","id":${nested(5000)}}\n`);
  check("a 5,000-deep request without a token is refused as bad_request", !r.ok && r.error?.code === "bad_request" && r.id === null, r.error);
  r = await deep.call("ping", {}, "t-after-deep");
  check("the host still answers after the deep request", r.ok, r.error);
  r = await deep.call("ping", JSON.parse(`{"deep":${nested(31)}}`), "t-depth-33");
  check("a request nested 33 levels deep is refused", !r.ok && r.error?.code === "bad_request", r.error);
  check("the too-deep refusals are logged", count(log, "reason=too_deep") >= 2);
  deep.close();
  await sleep(200);

  // RB-05: five malformed or unauthenticated requests end the connection; each refusal is logged.
  const unauthBefore = count(log, "evt=bridge.unauthorized");
  const flood = new BridgeClient(session, 2000);
  await flood.connect();
  const floodReplies = [];
  for (let i = 0; i < 6; i++) floodReplies.push(await flood.call("ping", {}, `t-flood-${i}`, { token: "f".repeat(64) }));
  check("five unauthenticated requests are refused", floodReplies.slice(0, 5).every((x) => x.error?.code === "unauthorized"), floodReplies.map((x) => x.error?.code));
  check("the sixth finds the connection dropped", floodReplies[5].error?.code === "disconnected", floodReplies[5].error);
  await waitFor(() => log.some((l) => l.includes("reason=too_many_rejected")), 1000);
  check("the drop is logged (too_many_rejected)", count(log, "reason=too_many_rejected") >= 1);
  check("every refused request is logged", count(log, "evt=bridge.unauthorized") - unauthBefore === 5, count(log, "evt=bridge.unauthorized") - unauthBefore);
  flood.close();
  await sleep(1200); // the server waits 1 s before accepting after a too-many-rejected drop

  // RB-05: the Bun client refuses a pipe whose server is not the process session.json names.
  const requestsBefore = count(log, "evt=bridge.request") + count(log, "evt=bridge.unauthorized");
  let wrongServer = "";
  try {
    const impostor = new BridgeClient({ ...session, pid: session.pid + 1 }, 2000);
    await impostor.connect();
    impostor.close();
  } catch (error) {
    wrongServer = error instanceof PipeConnectError ? error.code : String(error);
  }
  await sleep(300);
  check("the Bun client refuses a pipe served by another PID", wrongServer === "wrong_server", wrongServer);
  check("and sends nothing (no request reached the server)", count(log, "evt=bridge.request") + count(log, "evt=bridge.unauthorized") === requestsBefore);

  // A new connection works after the drops.
  const again = new BridgeClient(session, 3000);
  await again.connect();
  r = await again.call("ping", {}, "t-reconnect");
  check("server accepts a new client after a drop", r.ok, r.error);

  r = await again.call("bridge.kill", {}, "t-kill");
  check("bridge.kill answers", r.ok && (r.result as any).killed === true, r.error);
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
  check("the kill request is logged with access=control", log.some((l) => l.includes("cid=t-kill") && l.includes("access=control")));
  if (child.exitCode === null) child.kill();
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

// --- Run 4 (RB-02): a client that sends a request and never reads cannot hold up the kill switch.
{
  const host = await startHost([]);
  const silent = new BridgeClient(host.session, 3000);
  await silent.connect({ read: false });
  silent.writeOnly(JSON.stringify({ v: 1, id: 1, token: host.session.token, method: "ping", cid: "t-silent" }) + "\n");
  await sleep(300);
  const killedAt = performance.now();
  writeFileSync(join(host.dir, "KILL"), "");
  const exited = await waitExit(host.child, 5000);
  const exitMs = Math.round((host.exitedAt() ?? performance.now()) - killedAt);
  check("with a non-reading client, KILL still stops the host promptly", exited && exitMs < 2500, { exitMs });
  const ms = stopMs(host.log);
  check("PipeServer::Stop returned within 1 s", ms !== null && ms < 1000, { stop_ms: ms });
  silent.close();
  if (host.child.exitCode === null) host.child.kill();
  rmSync(host.dir, { recursive: true, force: true });
}

// --- Run 5 (RB-02): a non-reading client whose replies fill the pipe cannot hold up shutdown.
{
  const host = await startHost([], 4);
  const silent = new BridgeClient(host.session, 3000);
  await silent.connect({ read: false });
  const line = JSON.stringify({ v: 1, id: 1, token: host.session.token, method: "ping" }) + "\n";
  silent.writeOnly(line.repeat(700)); // ~73 KB of requests; the ~80 KB of replies overflow the 64 KB pipe buffer
  const exited = await waitExit(host.child, 8000);
  const ms = stopMs(host.log);
  check("with the pipe full of unread replies, the host still shuts down", exited, { exitCode: host.child.exitCode });
  check("and PipeServer::Stop returned within 1 s", ms !== null && ms < 1000, { stop_ms: ms, write_blocked: host.log.some((l) => l.includes("evt=bridge.write_timeout")) });
  silent.close();
  if (host.child.exitCode === null) host.child.kill();
  rmSync(host.dir, { recursive: true, force: true });
}

// --- Run 6: both command-line clients against a host -----------------------------------------
{
  const host = await startHost([]);
  const bun = spawnSync(process.execPath, [join(projectDir, "tools", "bridge-client.ts"), "smoke", "--runtime-dir", host.dir], { encoding: "utf8" });
  check("Bun CLI smoke answers every method", bun.status === 0 && (bun.stdout.match(/^OK /gm) ?? []).length === 9, { status: bun.status, out: bun.stdout.trim().split("\n").slice(-2) });
  await sleep(200);
  const pwsh = spawnSync("pwsh", ["-NoProfile", "-File", join(projectDir, "tools", "bridge-client.ps1"), "smoke", "-RuntimeDir", host.dir], { encoding: "utf8" });
  check("PowerShell CLI smoke answers every method", pwsh.status === 0 && (pwsh.stdout.match(/^OK /gm) ?? []).length === 9, { status: pwsh.status, out: pwsh.stdout.trim().split("\n").slice(-2) });
  check("PowerShell CLI prints the duration as <n>ms", /^OK {3}ping cid=ps-smoke-\S+ \d+ms \{/m.test(pwsh.stdout));
  await sleep(200);

  // The Bun CLI's `run` goes through the command API (the same path as the MCP server).
  const runStatus = spawnSync(process.execPath, [join(projectDir, "tools", "bridge-client.ts"), "run", "game.status", "--runtime-dir", host.dir], { encoding: "utf8" });
  check("Bun CLI run game.status answers through the command API", runStatus.status === 0 && /"phase": "gameplay"/.test(runStatus.stdout), { status: runStatus.status, out: runStatus.stdout.trim().split("\n")[0] });
  await sleep(200);
  const runWrite = spawnSync(process.execPath, [join(projectDir, "tools", "bridge-client.ts"), "run", "photo.enter", "--runtime-dir", host.dir], { encoding: "utf8" });
  check("Bun CLI run of a write explains that changes are switched off (exit 1)", runWrite.status === 1 && runWrite.stdout.includes("writes_disabled") && runWrite.stdout.includes("switched off"), { status: runWrite.status });
  await sleep(200);

  // A session.json naming another PID: both clients refuse before sending the token.
  const fakeDir = join(host.dir, "wrong-pid");
  mkdirSync(fakeDir);
  const fake = { ...JSON.parse(readFileSync(join(host.dir, "session.json"), "utf8")), pid: host.session.pid + 1 };
  writeFileSync(join(fakeDir, "session.json"), JSON.stringify(fake));
  const requestsBefore = count(host.log, "evt=bridge.request") + count(host.log, "evt=bridge.unauthorized");
  const bunWrong = spawnSync(process.execPath, [join(projectDir, "tools", "bridge-client.ts"), "ping", "--runtime-dir", fakeDir], { encoding: "utf8" });
  await sleep(200);
  const pwshWrong = spawnSync("pwsh", ["-NoProfile", "-File", join(projectDir, "tools", "bridge-client.ps1"), "ping", "-RuntimeDir", fakeDir], { encoding: "utf8" });
  await sleep(300);
  check("Bun CLI refuses a pipe served by another PID (exit 3)", bunWrong.status === 3, { status: bunWrong.status });
  check("PowerShell CLI refuses a pipe served by another PID (exit 3)", pwshWrong.status === 3, { status: pwshWrong.status });
  check("neither sent a request", count(host.log, "evt=bridge.request") + count(host.log, "evt=bridge.unauthorized") === requestsBefore);
  host.child.kill();
  await waitExit(host.child, 2000);
  rmSync(host.dir, { recursive: true, force: true });
}

console.log(failures === 0 ? `\nALL ${checks} CHECKS PASSED` : `\n${failures} OF ${checks} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
