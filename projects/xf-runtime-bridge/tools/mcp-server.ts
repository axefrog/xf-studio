// Stdio entry point for the XF Runtime Bridge MCP server: a thin wrapper around
// tools/mcp/server.ts. An MCP client (Claude Code, another harness) starts it and talks JSON-RPC
// over stdin/stdout. It only ever connects to the local game bridge named by the session file
// (%LOCALAPPDATA%\XFStudio\runtime-bridge\session.json); while the game isn't running every
// game tool answers "the game bridge isn't running".
//
//   bun tools/mcp-server.ts [--allow read,write-photo,... | --read-only] [--no-inline-images]
//
// --read-only and --allow are exclusive, an empty --allow is refused, and the kill switch
// (control) is always exposed.
//
// --runtime-dir <dir> and --capture-hwnd <window handle> exist for the tests only (the plugin
// always uses the default folder, and captures normally target the game process). --capture-hwnd
// never aims photo_open's key: the command API ignores it for keys unless XFB_NO_INPUT=1, in which
// case nothing can be sent at all (RB-35).
// Registration: see the README ("MCP server").

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CommandApi } from "./api/command-api.ts";
import { createMcpServer, parsePermissionFlags } from "./mcp/server.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const flags = parsePermissionFlags(args);
if ("error" in flags) {
  process.stderr.write(flags.error + "\n");
  process.exit(2);
}
const allow = flags.allow;

const hwnd = option("--capture-hwnd");
const api = new CommandApi({
  runtimeDir: option("--runtime-dir"),
  captureRoot: option("--capture-root"),
  ...(hwnd ? { captureTarget: { hwnd: BigInt(hwnd) } } : {}),
});
const server = createMcpServer(api, { allow, inlineImages: !args.includes("--no-inline-images") });
const transport = new StdioServerTransport();
transport.onclose = () => {
  api.close();
  process.exit(0);
};
await server.connect(transport);
process.stdin.on("end", () => {
  api.close();
  process.exit(0);
});
