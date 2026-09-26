// Stdio entry point for the XF Runtime Bridge MCP server: a thin wrapper around
// tools/mcp/server.ts. An MCP client (Claude Code, another harness) starts it and talks JSON-RPC
// over stdin/stdout. It only ever connects to the local game bridge named by the session file
// (%LOCALAPPDATA%\XFStudio\runtime-bridge\session.json); while the game isn't running every
// game tool answers "the game bridge isn't running".
//
//   bun tools/mcp-server.ts [--allow read,write-photo,...] [--read-only] [--no-inline-images]
//
// --runtime-dir <dir> and --capture-hwnd <window handle> exist for the tests only (the plugin
// always uses the default folder, and captures normally target the game process).
// Registration: see the README ("MCP server").

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PERMISSIONS, type Permission } from "./api/catalogue.ts";
import { CommandApi } from "./api/command-api.ts";
import { createMcpServer } from "./mcp/server.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

let allow: Permission[] | undefined;
if (args.includes("--read-only")) allow = ["read", "control"];
const allowText = option("--allow");
if (allowText) {
  allow = allowText.split(",").map((p) => p.trim()) as Permission[];
  const unknown = allow.filter((p) => !(p in PERMISSIONS));
  if (unknown.length) {
    process.stderr.write(`unknown permission class(es): ${unknown.join(", ")}; known: ${Object.keys(PERMISSIONS).join(", ")}\n`);
    process.exit(2);
  }
}

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
