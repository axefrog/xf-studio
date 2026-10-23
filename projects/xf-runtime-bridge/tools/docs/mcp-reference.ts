// The MCP tool reference (docs/mcp-reference.md), generated from the command catalogue so it can never drift from what
// the MCP server publishes: every tool with its plain description, parameters (types, ranges, defaults), permission
// class, whether it changes the game, its undo note and the refusal codes it names, grouped by area.
//
//   bun tools/docs/mcp-reference.ts            writes docs/mcp-reference.md
//   bun tools/docs/mcp-reference.ts --check    exits 1 when the file differs from what the catalogue gives
//                                              (the Docs links workflow and tools/test/mcp-reference.test.ts check it)
//
// Refusal codes per tool are the catalogue entry's own `refusals` (catalogue080.ts), joined by the known codes the tool's
// own text names (its description, undo note and parameter descriptions). A code is known when the tools' shared wording (tools/api/errors.ts) has it or a source raises it: the
// tools' planError calls, the plugin's MethodError and the redscript layer's XFJson.Fail. The refusals every tool can
// give (no bridge, a closed write gate, a paused bridge) are listed once, at the top. Only the catalogue, errors.ts and
// source text are read: no MCP SDK, no game and no bridge, so CI runs it without an install.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { CATALOGUE, PERMISSIONS, toolName, type CommandDef, type Permission } from "../api/catalogue.ts";
import { BRIDGE_MESSAGES, connectError, NO_BRIDGE } from "../api/errors.ts";
import type { JsonSchema } from "../api/schema.ts";

export const PROJECT_DIR = resolve(import.meta.dir, "..", "..");
export const REFERENCE_OUT = join(PROJECT_DIR, "docs", "mcp-reference.md");

// --- areas -----------------------------------------------------------------------------------------

type Area = { id: string; title: string; intro: string; match: (name: string) => boolean };

const is = (...names: string[]) => (name: string) => names.includes(name);
const prefix = (...prefixes: string[]) => (name: string) => prefixes.some((p) => name.startsWith(p + "."));

/** First match wins; a command no area claims lands in "Other tools", so a new command family never breaks the build. */
export const AREAS: readonly Area[] = [
  {
    id: "session-and-answers",
    title: "Connection, session and answers",
    intro:
      "Check the connection, read the game's phase, follow the session's event stream, ask the player a question in the game and wait for the answer, hand the game over to the player and take it back.",
    match: (n) => prefix("bridge", "session")(n) || is("game.status", "game.wait", "game.options.read", "input.probe", "ui.message")(n),
  },
  {
    id: "photo-mode",
    title: "Photo mode",
    intro: "Open and leave photo mode, frame V, set the camera, lights, expression, pose and scene rows, and hide the menu for a clean capture. Nothing outlives photo mode.",
    match: prefix("photo", "pose", "face"),
  },
  {
    id: "appearance-screen",
    title: "Appearance screen (character creator)",
    intro: "Read V's creator options, open the appearance screen from normal play, change options through their own rows, and confirm or back out.",
    match: (n) => prefix("cc")(n) || is("player.appearance")(n),
  },
  {
    id: "player",
    title: "Player",
    intro: "Read V's state, move and turn her, turn her view, crouch, draw or holster, open menus, and give her back.",
    match: prefix("player"),
  },
  {
    id: "behaviours",
    title: "Behaviours",
    intro:
      "Routines that run inside the game at frame rate: a turntable, a smooth look, a glide along a walkable path, keeping a subject framed. Each streams its progress to the session's events and stops on `behave_stop`, the kill switch or loading a save.",
    match: prefix("behave"),
  },
  {
    id: "world",
    title: "World",
    intro: "Read the world's state, probe the ground and streaming around V, and set the clock, the weather, a freeze or XF map pins.",
    match: prefix("world"),
  },
  {
    id: "wardrobe-and-cyberware",
    title: "Wardrobe, clothing and cyberware",
    intro: "Read and change what V wears and her cyberware, through the game's own equipment requests. Off in every build until writes to V's inventory are approved.",
    match: prefix("inventory", "wardrobe", "cyberware"),
  },
  {
    id: "showroom",
    title: "XF Finish Showroom",
    intro: "Spawn, light, turn and clear the showroom's mannequin heads for close-up finish checks. Nothing is saved: clearing, the kill switch or loading a save removes them.",
    match: prefix("showroom"),
  },
  {
    id: "npc-direction",
    title: "NPC direction",
    intro:
      "Spawn XF actors (never saved), pick NPCs near V, and direct them: walk, follow, turn, place, speak (voiced, text or holocall style), look, set a face, gesture, and offer V dialogue choices whose pick comes back as an event. Releasing, the kill switch, the pause, a handover or loading a save gives everything back.",
    match: prefix("npc"),
  },
  {
    id: "capture-and-the-agents-view",
    title: "Capture and the agent's view",
    intro:
      "Screenshots from outside the game (they work without the bridge), re-crops, bursts and contact sheets, and the scene report: the agent's own view of the shot without a screenshot.",
    match: prefix("capture", "scene"),
  },
  {
    id: "saves",
    title: "Saves",
    intro: "List, make and load saves. Only `game_save` ever saves the game, and never over an existing save.",
    match: is("game.save", "game.load", "game.saves"),
  },
  {
    id: "overlay-and-ui",
    title: "Overlay and in-game UI",
    intro: "Read the game's UI state and the XF overlay host, and place the bridge's own in-game panel.",
    match: prefix("ui", "overlay"),
  },
  { id: "other-tools", title: "Other tools", intro: "Tools not yet sorted into an area above.", match: () => true },
];

export function areaOf(command: CommandDef): Area {
  return AREAS.find((area) => area.match(command.name))!;
}

// --- permission classes ------------------------------------------------------------------------------

/** What each class does to the game, in the reference's words. */
export function changesGame(permission: Permission): string {
  if (permission === "read") return "No";
  if (permission === "notify") return "No: it shows or moves the bridge's own messages and panel";
  if (permission === "control") return "Only the bridge's own work: it stops or pauses it";
  return "Yes";
}

/** The game-side switch for each class, in the plugin's config.ini (red4ext/plugins/XFRuntimeBridge/config.ini). */
const GATES: Record<Permission, string> = {
  read: "Always allowed while the bridge is on.",
  notify: "Always allowed while the bridge is on, read-only builds included.",
  control: "Always allowed; every MCP configuration includes it.",
  "write-photo": "`allow_writes = true` and `photo` in `allow_write_classes` (on by default once writes are allowed).",
  "write-world": "`allow_writes = true` and `world` in `allow_write_classes` (on by default once writes are allowed).",
  "write-character":
    "`allow_writes = true` and `character` in `allow_write_classes` (on by default once writes are allowed); opening, confirming and leaving the appearance screen also need `allow_creator_leave = true`.",
  "write-inventory": "`allow_writes = true` and `inventory` listed by name. Off in every package unless the test build is made with `--allow-inventory`.",
  "write-save": "`allow_writes = true` and `save` listed by name (the test profile's build lists it).",
  "write-showroom": "`allow_writes = true` and `showroom` listed by name (the test profile's build lists it).",
  "write-player": "`allow_writes = true` and `player` listed by name (the test profile's build lists it).",
  "act-player": "`allow_writes = true` and `act` listed by name. Reserved: no tool uses it yet.",
  "write-npc": "`allow_writes = true` and `npc` listed by name (the test profile's build lists it); spawning also needs Codeware and the -writes package's XF actor records (TweakXL).",
};

// --- refusal codes -----------------------------------------------------------------------------------

/** Codes every tool that reaches the game can answer, and those every change can answer. */
const TOOL_CODES = ["bad_input"];
const GAME_CODES = [
  "no_bridge",
  "bridge_busy",
  "session_running",
  "wrong_server",
  "access_denied",
  "connect_failed",
  "disconnected",
  "client_timeout",
  "game_not_running",
  "game_loading",
  "game_not_ready",
  "timeout",
  "timeout_after_start",
  "busy",
  "rate_limited",
  "killed",
  "script_calls_unavailable",
  "script_layer_missing",
  "unknown_method",
  "rtti_missing",
  "rtti_signature",
  "call_failed",
  "failed",
];
const WRITE_CODES = ["writes_disabled", "write_class_disabled", "writes_paused", "handed_over", "bad_params"];

/** Refusals typical of a class: the moments and setups its tools refuse (the codes' wording in errors.ts says so). */
const CLASS_CODES: Partial<Record<Permission, string[]>> = {
  "write-photo": ["not_in_photo_mode", "write_mismatch"],
  "write-world": ["not_in_gameplay"],
  "write-character": ["not_in_character_menu", "creator_leave_disabled", "not_safe_now", "not_v"],
  "write-inventory": ["not_in_inventory", "not_added_by_bridge", "no_active_outfit", "outfit_managed_elsewhere", "script_outfit_api_changed"],
  "write-save": ["bridge_save_lock", "bridge_effects_active", "saving_locked", "no_free_slot", "save_failed", "save_uncertain", "save_not_found"],
  "write-showroom": ["codeware_missing", "showroom_missing", "not_in_world", "too_far", "no_such_piece", "not_spawned_yet", "spawn_refused", "not_ready"],
  "write-player": ["in_combat", "in_vehicle", "in_scene", "player_busy", "user_took_over", "no_ground", "not_streamed", "no_path"],
  "write-npc": ["codeware_missing", "not_in_world", "in_combat", "in_vehicle", "in_scene", "npc_unknown", "npc_lost", "not_ours", "too_far", "limit"],
};

/** Plain wording for codes the tools answer themselves (the rest come from errors.ts). */
function toolsWording(): Record<string, string> {
  const connect = Object.fromEntries(
    ["not_found", "busy", "wrong_server", "access_denied", "other"].map((kind) => {
      const error = connectError(kind, "");
      return [kind === "not_found" ? "no_bridge_gone" : error.code, error.message];
    }),
  );
  return {
    bad_input: "A value doesn't fit the tool's input schema (the message lists each problem), or two options that exclude each other were both given. Nothing was sent to the game.",
    no_bridge: `${NO_BRIDGE.message} When the connection disappears mid-session: ${connect.no_bridge_gone}`,
    bridge_busy: connect.bridge_busy,
    wrong_server: connect.wrong_server,
    access_denied: connect.access_denied,
    connect_failed: connect.connect_failed,
    session_running:
      "A scripted session is driving the game, so the MCP server stays off the bridge until it finishes or pauses at a question for the player. Screenshots and the kill switch still work.",
  };
}

const CODE_TOKEN = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

function filesUnder(dir: string, extension: string, skip: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (skip(path)) continue;
    if (entry.isDirectory()) out.push(...filesUnder(path, extension, skip));
    else if (entry.name.endsWith(extension)) out.push(path);
  }
  return out.sort();
}

/** Every refusal code a source raises: the tools' planError and plain codes, the plugin's MethodError, the redscript layer's Fail. */
export function knownCodes(projectDir = PROJECT_DIR): Set<string> {
  const codes = new Set<string>([...Object.keys(BRIDGE_MESSAGES), ...Object.keys(toolsWording())]);
  const scan = (files: string[], pattern: RegExp) => {
    for (const file of files) for (const match of readFileSync(file, "utf8").matchAll(pattern)) codes.add(match[1]);
  };
  const toolsDir = join(projectDir, "tools");
  const skipTools = (path: string) => /[\\/](test|docs|node_modules)$/.test(path);
  scan(filesUnder(toolsDir, ".ts", skipTools), /planError\(\s*"([a-z][a-z0-9_]*)"/g);
  scan(filesUnder(toolsDir, ".ts", skipTools), /\bcode:\s*"([a-z][a-z0-9]*_[a-z0-9_]*)"/g);
  scan(filesUnder(join(projectDir, "native", "src"), ".cpp", (path) => /[\\/]selftest$/.test(path)), /MethodError\(\s*"([a-z][a-z0-9_]*)"/g);
  scan(filesUnder(join(projectDir, "redscript"), ".reds", () => false), /Fail\(\s*"([a-z][a-z0-9_]*)"/g);
  return codes;
}

/** All the text a command publishes: description, undo note and every parameter description. */
function commandText(command: CommandDef): string {
  const parts = [command.description, command.undo ?? ""];
  const walk = (schema: JsonSchema) => {
    if (schema.description) parts.push(schema.description);
    for (const child of Object.values(schema.properties ?? {})) walk(child);
    if (schema.items) walk(schema.items);
  };
  walk(command.input);
  return parts.join("\n");
}

/**
 * A command's refusal codes: the entry's own `refusals` (declared, so listed even when no source text raises them yet),
 * then the known codes its text names that the entry doesn't declare, in the order it names them.
 */
export function namedCodes(command: CommandDef, known: Set<string>): string[] {
  const found: string[] = [...new Set(command.refusals ?? [])];
  for (const [token] of commandText(command).matchAll(CODE_TOKEN)) if (known.has(token) && !found.includes(token)) found.push(token);
  return found;
}

// --- rendering ---------------------------------------------------------------------------------------

/** Text for a Markdown table cell: pipes escaped (GFM splits on them even inside code), one line, no raw HTML. */
function cell(text: string): string {
  return text.replace(/\r?\n+/g, " ").replace(/</g, "&lt;").replace(/\|/g, "\\|").trim();
}

/** Prose outside tables: no raw HTML. */
function prose(text: string): string {
  return text.replace(/</g, "&lt;");
}

const code = (text: string | number) => "`" + String(text) + "`";

function typeOf(schema: JsonSchema): string {
  if (schema.anyOf) return schema.anyOf.map(typeOf).join(" or ");
  if (schema.type === "array") return schema.items ? `array of ${typeOf(schema.items)}` : "array";
  return schema.type ?? "any";
}

function range(min: number | undefined, max: number | undefined, unit = ""): string | null {
  if (min !== undefined && max !== undefined) return min === max ? `exactly ${min}${unit}` : `${min} to ${max}${unit}`;
  if (min !== undefined) return `at least ${min}${unit}`;
  if (max !== undefined) return `at most ${max}${unit}`;
  return null;
}

function allowedOf(schema: JsonSchema): string {
  // 0.8.2's anyOf (one value or a list of them): each branch's allowed values, the shared default once.
  if (schema.anyOf) {
    const branches = schema.anyOf.map((branch) => allowedOf({ ...branch, default: undefined })).filter(Boolean);
    const joined = branches.length > 1 && branches.every((b) => b === branches[0]) ? branches[0]! : branches.join("; or ");
    return schema.default !== undefined ? `${joined}; default ${code(JSON.stringify(schema.default))}` : joined;
  }
  const parts: string[] = [];
  if (schema.type === "boolean") parts.push("`true`, `false`");
  if (schema.type === "object" && schema.properties) parts.push("the fields below");
  if (schema.enum) parts.push(schema.enum.map(code).join(", "));
  const numeric = range(schema.minimum, schema.maximum);
  if (numeric) parts.push(numeric);
  const length = range(schema.minLength, schema.maxLength, " characters");
  if (length) parts.push(length);
  if (schema.pattern) parts.push(`matches ${code(schema.pattern)}`);
  const items = range(schema.minItems, schema.maxItems, " items");
  if (items) parts.push(items);
  if (schema.items && schema.items.type !== "object") {
    const each = allowedOf(schema.items);
    if (each) parts.push(`each ${each}`);
  }
  if (schema.default !== undefined) parts.push(`default ${code(JSON.stringify(schema.default))}`);
  return parts.join("; ");
}

type ParamRow = { name: string; type: string; required: boolean; allowed: string; description: string };

export function parameterRows(schema: JsonSchema, prefixName = ""): ParamRow[] {
  const rows: ParamRow[] = [];
  const required = new Set(schema.required ?? []);
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    const name = prefixName ? `${prefixName}.${key}` : key;
    rows.push({ name, type: typeOf(child), required: required.has(key), allowed: allowedOf(child), description: child.description ?? "" });
    if (child.type === "object" && child.properties) rows.push(...parameterRows(child, name));
    if (child.type === "array" && child.items?.type === "object" && child.items.properties) rows.push(...parameterRows(child.items, `${name}[]`));
  }
  return rows;
}

const refusalLink = (id: string, wording: Record<string, string>) => (wording[id] ? `[${code(id)}](#refusal-${id.replaceAll("_", "-")})` : code(id));

function renderTool(command: CommandDef, known: Set<string>, wording: Record<string, string>): string[] {
  const lines: string[] = [];
  const permission = PERMISSIONS[command.permission];
  lines.push(`### ${code(toolName(command))}`, "");
  lines.push(`**${prose(command.title)}.** ${prose(command.description)}`, "");
  lines.push(`- **Command:** ${code(command.name)}, ${command.local ? "run by the tools (it may call the bridge several times)" : `the bridge method ${code(command.bridge!.method)}`}`);
  lines.push(`- **Permission:** ${prose(permission.label)} (${code(command.permission)})`);
  lines.push(`- **Changes the game:** ${changesGame(command.permission)}`);
  if (command.undo) lines.push(`- **Undo:** ${prose(command.undo)}`);
  else if (command.permission === "read") lines.push("- **Undo:** nothing to undo");
  const codes = namedCodes(command, known);
  if (codes.length) lines.push(`- **Refusals:** ${codes.map((c) => refusalLink(c, wording)).join(", ")}`);
  lines.push("");
  const rows = parameterRows(command.input);
  if (!rows.length) {
    lines.push("No parameters.", "");
    return lines;
  }
  lines.push("| Parameter | Type | Allowed | Description |", "|---|---|---|---|");
  for (const row of rows) {
    lines.push(`| ${code(row.name)}${row.required ? " (required)" : ""} | ${row.type} | ${cell(row.allowed) || "any"} | ${cell(row.description)} |`);
  }
  lines.push("");
  return lines;
}

/** The whole reference for a catalogue. Deterministic: the same catalogue and sources give the same bytes. */
export function renderReference(commands: readonly CommandDef[] = CATALOGUE, known = knownCodes()): string {
  const wording: Record<string, string> = { ...BRIDGE_MESSAGES, ...toolsWording() };
  const byArea = new Map<Area, CommandDef[]>();
  for (const command of commands) {
    const area = areaOf(command);
    byArea.set(area, [...(byArea.get(area) ?? []), command]);
  }
  const areas = AREAS.filter((area) => byArea.has(area));
  const classCount = (p: Permission) => commands.filter((c) => c.permission === p).length;
  const changing = commands.filter((c) => changesGame(c.permission) === "Yes").length;

  const out: string[] = [
    "<!-- Generated by tools/docs/mcp-reference.ts from the command catalogue (tools/api/catalogue*.ts). Do not edit by hand: run `bun tools/docs/mcp-reference.ts` in projects/xf-runtime-bridge. CI fails when this file is out of date. -->",
    "",
    "# XF Runtime Bridge MCP tool reference",
    "",
    `Every tool the XF Runtime Bridge MCP server publishes: ${commands.length} tools, ${changing} of which change the game. The [MCP guide](mcp.md) explains installing the server, the safety model and a worked session; this page is generated from the command catalogue, so it always matches what the server lists.`,
    "",
    "Tool names are the catalogue's command names with dots as underscores (`photo.camera.set` is `photo_camera_set`). Every tool's description, parameters and refusals are written for the person using the AI client as much as for the model. A successful answer is JSON text with the `result`, an `undo` when the tool changed something, and a correlation id (`cid`) that matches the bridge's logs; captures also return a small preview image. A refusal is an error result with a plain sentence, the code in brackets and the correlation id.",
    "",
    "## Contents",
    "",
    "- [Permission classes](#permission-classes)",
    "- [Refusals any tool can give](#refusals-any-tool-can-give)",
    ...areas.map((area) => `- [${area.title}](#${slug(area.title)}) (${byArea.get(area)!.length})`),
    "- [Refusal codes](#refusal-codes)",
    "",
    "## Permission classes",
    "",
    "Each tool belongs to one class. The MCP server can withhold classes (`--read-only`, `--allow`), and the game's own gate in the bridge's `config.ini` is separate and final: without it every change is refused, whatever the MCP client allows.",
    "",
    "| Class | Label | Tools | Changes the game | What it covers | Game-side switch |",
    "|---|---|---|---|---|---|",
    ...(Object.keys(PERMISSIONS) as Permission[]).map(
      (p) => `| ${code(p)} | ${cell(PERMISSIONS[p].label)} | ${classCount(p)} | ${cell(changesGame(p))} | ${cell(PERMISSIONS[p].description)} | ${cell(GATES[p] ?? "See the bridge's configuration.")} |`,
    ),
    "",
    "## Refusals any tool can give",
    "",
    "A refused tool changes nothing unless its message says otherwise (`timeout_after_start` is the one that may have happened), and its message is a plain sentence with one next step that a client can show as it is. The codes below can come from many tools, so each tool's own list (\"Refusals\") shows the codes the catalogue declares for it and those its description and parameters mention; it is not exhaustive.",
    "",
    `- **Any tool:** ${TOOL_CODES.map((c) => refusalLink(c, wording)).join(", ")}.`,
    `- **Any tool that reaches the game** (everything except \`capture_screenshot\` and \`capture_recrop\`, which work on the game window without the bridge): ${GAME_CODES.map((c) => refusalLink(c, wording)).join(", ")}.`,
    `- **Any tool that changes the game:** ${WRITE_CODES.map((c) => refusalLink(c, wording)).join(", ")}.`,
    "",
    "Each class's tools also refuse at moments that class cares about:",
    "",
    ...(Object.keys(CLASS_CODES) as Permission[]).map((p) => `- **${code(p)}:** ${CLASS_CODES[p]!.map((c) => refusalLink(c, wording)).join(", ")}.`),
    "",
  ];

  for (const area of areas) {
    out.push(`## ${area.title}`, "", area.intro, "");
    for (const command of byArea.get(area)!) out.push(...renderTool(command, known, wording));
  }

  const named = new Set(commands.flatMap((c) => namedCodes(c, known)));
  const withWording = Object.keys(wording).sort();
  const without = [...named].filter((c) => !wording[c]).sort();
  out.push(
    "## Refusal codes",
    "",
    "The shared plain wording each code is answered with (`tools/api/errors.ts`), whichever tool gives it. The bridge's own technical message, when there is one, follows as `detail`.",
    "",
    "| Code | Message |",
    "|---|---|",
    ...withWording.map((c) => `| <a id="refusal-${c.replaceAll("_", "-")}"></a>${code(c)} | ${cell(wording[c])} |`),
    "",
  );
  if (without.length) {
    out.push(
      "Codes the tools above name that have no shared wording yet; the answer's own message (from the tools) or its `detail` (from the game) explains each in context:",
      "",
      without.map(code).join(", ") + ".",
      "",
    );
  }
  return out.join("\n");
}

/** GitHub's heading anchor for plain text (lower case, punctuation dropped, spaces to hyphens). */
export function slug(text: string): string {
  return text
    .replace(/`/g, "")
    .toLowerCase()
    .replace(/[^\w\- ]/g, "")
    .replace(/ /g, "-");
}

if (import.meta.main) {
  const text = renderReference();
  const shown = relative(process.cwd(), REFERENCE_OUT) || REFERENCE_OUT;
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(REFERENCE_OUT, "utf8").replace(/\r\n/g, "\n");
    } catch {
      // Missing counts as out of date.
    }
    if (current !== text) {
      console.error(`${shown} is out of date with the command catalogue. Run: bun tools/docs/mcp-reference.ts (in projects/xf-runtime-bridge)`);
      process.exit(1);
    }
    console.log(`${shown} matches the catalogue.`);
  } else {
    writeFileSync(REFERENCE_OUT, text);
    console.log(`Wrote ${shown}.`);
  }
}
