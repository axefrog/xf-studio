// MCP frontend over the command API. Transport-agnostic: `createMcpServer` returns an SDK Server
// with no transport attached, so the stdio entry point (tools/mcp-server.ts) and, later, the
// XF Studio desktop app (for example over the SDK's Streamable HTTP transport) host the same
// tools. Every tool comes from the command catalogue; nothing here defines a command.
//
// Official MCP TypeScript SDK (@modelcontextprotocol/sdk, MIT), low-level Server API so the
// catalogue's own JSON Schemas are published as they are.

import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { findCommand, PERMISSIONS, toolName, type CommandDef, type Permission } from "../api/catalogue.ts";
import type { CommandApi, CommandOutcome } from "../api/command-api.ts";
import { lockPath, readSessionLock, sessionRunningMessage } from "../session-lock.ts";

export const SERVER_NAME = "xf-runtime-bridge";
export const SERVER_VERSION = "0.2.0";

export type McpServerOptions = {
  /** Permission classes to expose; a future consent screen fills this in. Default: all. */
  allow?: readonly Permission[];
  /** Include the viewing-size PNG in capture results (default true). */
  inlineImages?: boolean;
};

/**
 * Reads the permission flags of the command line: `--read-only` (read and control tools) or
 * `--allow <classes>` (a comma-separated list), never both. `control` (the kill switch) is always
 * included. Returns undefined for "every class", or a plain error.
 */
export function parsePermissionFlags(args: readonly string[]): { allow?: Permission[] } | { error: string } {
  const readOnly = args.includes("--read-only");
  const at = args.indexOf("--allow");
  if (at < 0) return readOnly ? { allow: ["read", "control"] } : {};
  if (readOnly) return { error: "Use either --read-only or --allow <classes>, not both." };
  if (args.indexOf("--allow", at + 1) >= 0) return { error: "Give --allow once, with a comma-separated list." };
  const value = args[at + 1];
  const known = Object.keys(PERMISSIONS).join(", ");
  if (value === undefined || value.startsWith("--")) return { error: `--allow needs a comma-separated list of permission classes (${known}).` };
  const classes = value.split(",").map((p) => p.trim()).filter(Boolean);
  if (!classes.length) return { error: `--allow needs at least one permission class (${known}).` };
  const unknown = classes.filter((p) => !Object.hasOwn(PERMISSIONS, p));
  if (unknown.length) return { error: `Unknown permission class(es): ${unknown.join(", ")}; known: ${known}.` };
  return { allow: [...new Set([...(classes as Permission[]), "control" as Permission])] };
}

export const INSTRUCTIONS = [
  "These tools drive Cyberpunk 2077 through XF Runtime Bridge, a local connection that exists only while the game runs with the bridge enabled.",
  "Start with bridge_ping or game_status. Actions that change the game only work when the bridge's config.ini allows them (the dedicated test profile); otherwise they are refused and nothing changes.",
  "Photo-mode actions need photo mode open (photo_enter). capture_screenshot works without the bridge and returns a small preview plus the path of a full-resolution file; capture_recrop cuts a tighter area from that file.",
  "Nothing here saves the game.",
].join(" ");

function describe(command: CommandDef): string {
  const permission = PERMISSIONS[command.permission];
  const parts = [command.description, `Permission: ${permission.label} (${command.permission}).`];
  if (command.undo) parts.push(`Undo: ${command.undo}`);
  return parts.join(" ");
}

/** The MCP tool list for a catalogue, in catalogue order. */
export function toolsFor(commands: readonly CommandDef[], allow?: readonly Permission[]): Tool[] {
  return commands
    .filter((command) => !allow || allow.includes(command.permission))
    .map((command) => ({
      name: toolName(command),
      title: command.title,
      description: describe(command),
      inputSchema: command.input as Tool["inputSchema"],
      annotations: {
        title: command.title,
        readOnlyHint: command.permission === "read",
        destructiveHint: command.permission === "write-character" || command.permission === "control",
        idempotentHint: command.permission === "read",
        openWorldHint: false,
      },
      _meta: { "xf/command": command.name, "xf/permission": command.permission },
    }));
}

/** Turns a command outcome into MCP content: text JSON, plus the preview image for captures. */
export function toCallResult(outcome: CommandOutcome, inlineImages = true): CallToolResult {
  if (!outcome.ok) {
    const { code, message, detail } = outcome.error;
    return {
      isError: true,
      content: [{ type: "text", text: `${message}${detail ? `\n(detail: ${detail})` : ""}\n[${code}; cid ${outcome.cid}]` }],
    };
  }
  const content: CallToolResult["content"] = [];
  for (const image of outcome.images ?? []) {
    if (!inlineImages || image.role !== "view") continue;
    try {
      content.push({ type: "image", data: readFileSync(image.path).toString("base64"), mimeType: image.mimeType });
    } catch {
      // The text below still carries the path.
    }
  }
  const text = { result: outcome.result, ...(outcome.undo ? { undo: outcome.undo } : {}), cid: outcome.cid };
  content.push({ type: "text", text: JSON.stringify(text, null, 2) });
  return { content };
}

/** Commands that never talk to the bridge: allowed while a scripted session holds the pipe. */
const PIPE_FREE = new Set(["capture.screenshot", "capture.recrop"]);

export function createMcpServer(api: CommandApi, options: McpServerOptions = {}): Server {
  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  const allowed = (command: CommandDef | undefined) => !!command && (!options.allow || options.allow.includes(command.permission));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolsFor(api.commands(), options.allow) }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const command = findCommand(request.params.name);
    if (!allowed(command)) {
      return { isError: true, content: [{ type: "text", text: `There is no tool called "${request.params.name}" here.` }] };
    }
    // While the session runner holds its lock, only commands that never use the pipe (captures)
    // and the kill switch go ahead; everything else would compete with the session for the bridge.
    if (!PIPE_FREE.has(command!.name) && command!.permission !== "control") {
      const lock = readSessionLock(api.runtimeDir);
      if (lock) return { isError: true, content: [{ type: "text", text: sessionRunningMessage(lock) + "\n[session_running]" }] };
    }
    const outcome = await api.run(command!.name, request.params.arguments ?? {}, { source: "mcp" });
    return toCallResult(outcome, options.inlineImages !== false);
  });
  return server;
}
