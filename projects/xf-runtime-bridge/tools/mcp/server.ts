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

export const SERVER_NAME = "xf-runtime-bridge";
export const SERVER_VERSION = "0.2.0";

export type McpServerOptions = {
  /** Permission classes to expose; a future consent screen fills this in. Default: all. */
  allow?: readonly Permission[];
  /** Include the viewing-size PNG in capture results (default true). */
  inlineImages?: boolean;
};

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

export function createMcpServer(api: CommandApi, options: McpServerOptions = {}): Server {
  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  const allowed = (command: CommandDef | undefined) => !!command && (!options.allow || options.allow.includes(command.permission));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolsFor(api.commands(), options.allow) }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const command = findCommand(request.params.name);
    if (!allowed(command)) {
      return { isError: true, content: [{ type: "text", text: `There is no tool called "${request.params.name}" here.` }] };
    }
    const outcome = await api.run(command!.name, request.params.arguments ?? {}, { source: "mcp" });
    return toCallResult(outcome, options.inlineImages !== false);
  });
  return server;
}
