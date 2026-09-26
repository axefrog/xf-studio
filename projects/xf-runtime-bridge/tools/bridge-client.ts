// XF Runtime Bridge command-line client.
//
//   bun tools/bridge-client.ts discover            show session.json (without the token)
//   bun tools/bridge-client.ts ping                liveness
//   bun tools/bridge-client.ts smoke               ping + every read method, one line each
//   bun tools/bridge-client.ts call <method> [json-params]
//   bun tools/bridge-client.ts kill                kill switch (bridge refuses everything after)
//   bun tools/bridge-client.ts commands [--json]   the command catalogue (what the MCP server and sessions offer)
//   bun tools/bridge-client.ts run <command> [json-input]
//                                                  one catalogue command through the command API, e.g.
//                                                  run game.status, run capture.screenshot '{"region":"face"}'
//
// `call` speaks the raw bridge protocol (any allowlisted method); `run` goes through the same
// command API as the MCP server: input checked against the catalogue, plain-language errors,
// write commands in the audit log, captures that work without the bridge.
//
// Options: --runtime-dir <dir> (default %LOCALAPPDATA%\XFStudio\runtime-bridge), --cid <id>
// Exit code: 0 when every request answered ok, 1 otherwise, 2 when no bridge session exists or
// the pipe cannot be opened, 3 when the pipe's server is not the process session.json names.
// The pipe is opened at the Identification impersonation level, and the token is sent only
// after the server PID check passes (see bridge-lib.ts).

import { CATALOGUE, PERMISSIONS, toolName } from "./api/catalogue.ts";
import { CommandApi } from "./api/command-api.ts";
import { BridgeClient, PipeConnectError, describeSession, defaultRuntimeDir, readSession } from "./bridge-lib.ts";

const SMOKE_METHODS = [
  "ping",
  "bridge.info",
  "game.version",
  "game.state",
  "layers.status",
  "player.position",
  "photomode.state",
  "script.describe",
  "bridge.methods",
];

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let runtimeDir: string | undefined;
  let cid: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--runtime-dir") runtimeDir = argv[++i];
    else if (arg === "--cid") cid = argv[++i];
    else positional.push(arg);
  }
  return { positional, runtimeDir: runtimeDir ?? defaultRuntimeDir(), cid };
}

function listCommands(asJson: boolean) {
  if (asJson) {
    console.log(JSON.stringify(CATALOGUE.map(({ local: _l, bridge, ...c }) => ({ ...c, tool: toolName(c), bridge_method: bridge?.method ?? null })), null, 2));
    return;
  }
  for (const [permission, info] of Object.entries(PERMISSIONS)) {
    const commands = CATALOGUE.filter((c) => c.permission === permission);
    if (!commands.length) continue;
    console.log(`\n${info.label} (${permission}): ${info.description}`);
    for (const c of commands) console.log(`  ${c.name.padEnd(22)} ${c.title}`);
  }
  console.log("\nDetails and input schemas: commands --json. Run one: run <command> [json-input].");
}

async function runCommand(name: string | undefined, inputText: string | undefined, runtimeDir: string, cid: string | undefined) {
  if (!name) {
    console.error("run needs a command name; list them with: commands");
    process.exit(2);
  }
  let input: unknown = {};
  try {
    input = inputText ? JSON.parse(inputText) : {};
  } catch {
    console.error(`The input isn't valid JSON: ${inputText}`);
    process.exit(2);
  }
  const api = new CommandApi({ runtimeDir });
  const started = performance.now();
  const outcome = await api.run(name, input, { source: "cli", ...(cid ? { cid } : {}) });
  api.close();
  const ms = Math.round(performance.now() - started);
  if (outcome.ok) {
    console.log(`OK   ${outcome.command} cid=${outcome.cid} ${ms}ms`);
    console.log(JSON.stringify(outcome.result, null, 2));
    for (const image of outcome.images ?? []) console.log(`image: ${image.path} (${image.width}x${image.height})`);
    if (outcome.undo) console.log(`undo: ${outcome.undo}`);
    process.exit(0);
  }
  console.log(`FAIL ${outcome.command} cid=${outcome.cid} ${ms}ms ${outcome.error.code}`);
  console.log(outcome.error.message);
  if (outcome.error.detail) console.log(`(detail: ${outcome.error.detail})`);
  process.exit(outcome.error.code === "no_bridge" ? 2 : outcome.error.code === "wrong_server" ? 3 : 1);
}

async function main() {
  const { positional, runtimeDir, cid } = parseArgs(process.argv.slice(2));
  const command = positional[0] ?? "ping";
  if (command === "commands") return listCommands(process.argv.includes("--json"));
  if (command === "run") return runCommand(positional[1], positional[2], runtimeDir, cid);
  const session = readSession(runtimeDir);
  if (!session) {
    console.error(`No bridge session at ${runtimeDir}\\session.json.`);
    console.error("Is the game running with [bridge] enabled = true in red4ext/plugins/XFRuntimeBridge/config.ini?");
    process.exit(2);
  }
  if (command === "discover") {
    console.log(JSON.stringify(describeSession(session), null, 2));
    return;
  }

  const client = new BridgeClient(session);
  try {
    await client.connect();
  } catch (error) {
    console.error(`Could not open ${session.pipe}: ${(error as Error).message}`);
    if (error instanceof PipeConnectError && error.code === "wrong_server") process.exit(3);
    console.error("The session file may be stale (game closed or crashed), or another client is connected.");
    process.exit(2);
  }

  let failures = 0;
  const run = async (method: string, params: Record<string, unknown> = {}, requestCid?: string) => {
    const started = performance.now();
    const response = await client.call(method, params, requestCid);
    const ms = Math.round(performance.now() - started);
    if (!response.ok) failures++;
    const body = response.ok ? JSON.stringify(response.result) : `${response.error?.code}: ${response.error?.message}`;
    console.log(`${response.ok ? "OK  " : "FAIL"} ${method} cid=${response.cid} ${ms}ms ${body}`);
  };

  const stamp = Date.now().toString(36);
  if (command === "ping") await run("ping", {}, cid ?? `cli-${stamp}`);
  else if (command === "smoke") {
    for (const [index, method] of SMOKE_METHODS.entries()) await run(method, {}, `${cid ?? `smoke-${stamp}`}-${index}`);
  } else if (command === "call") {
    const method = positional[1];
    if (!method) throw new Error("call needs a method name");
    const params = positional[2] ? JSON.parse(positional[2]) : {};
    await run(method, params, cid ?? `cli-${stamp}`);
  } else if (command === "kill") await run("bridge.kill", {}, cid ?? `cli-${stamp}`);
  else {
    console.error(`unknown command ${command}`);
    process.exit(2);
  }

  client.close();
  process.exit(failures === 0 ? 0 : 1);
}

await main();
