// XF Runtime Bridge command-line client.
//
//   bun tools/bridge-client.ts discover            show session.json (without the token)
//   bun tools/bridge-client.ts ping                liveness
//   bun tools/bridge-client.ts smoke               ping + every read method, one line each
//   bun tools/bridge-client.ts call <method> [json-params]
//   bun tools/bridge-client.ts kill                kill switch (bridge refuses everything after)
//
// Options: --runtime-dir <dir> (default %LOCALAPPDATA%\XFStudio\runtime-bridge), --cid <id>
// Exit code: 0 when every request answered ok, 1 otherwise, 2 when no bridge session exists or
// the pipe cannot be opened, 3 when the pipe's server is not the process session.json names.
// The pipe is opened at the Identification impersonation level, and the token is sent only
// after the server PID check passes (see bridge-lib.ts).

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

async function main() {
  const { positional, runtimeDir, cid } = parseArgs(process.argv.slice(2));
  const command = positional[0] ?? "ping";
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
