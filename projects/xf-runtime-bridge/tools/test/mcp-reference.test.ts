// The MCP tool reference (docs/mcp-reference.md) is generated from the catalogue; these checks fail when a catalogue
// change lands without regenerating it (bun tools/docs/mcp-reference.ts), and prove the generator covers every tool.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CATALOGUE, toolName, type CommandDef } from "../api/catalogue.ts";
import { obj, oneOf } from "../api/schema.ts";
import { areaOf, knownCodes, namedCodes, parameterRows, REFERENCE_OUT, renderReference } from "../docs/mcp-reference.ts";

const current = () => readFileSync(REFERENCE_OUT, "utf8").replace(/\r\n/g, "\n");

describe("MCP reference", () => {
  test("docs/mcp-reference.md is current with the catalogue (regenerate with bun tools/docs/mcp-reference.ts)", () => {
    expect(current()).toBe(renderReference());
  });

  test("every tool has exactly one entry, with its permission and every parameter", () => {
    const text = current();
    for (const command of CATALOGUE) {
      const heading = `### \`${toolName(command)}\``;
      expect(text.split("\n").filter((line) => line === heading)).toHaveLength(1);
      const entry = text.slice(text.indexOf(heading), text.indexOf("\n### ", text.indexOf(heading) + 1) >>> 0);
      expect(entry).toContain(`(\`${command.permission}\`)`);
      for (const row of parameterRows(command.input)) expect(entry).toContain(`| \`${row.name}\``);
    }
  });

  test("every refusal link has its glossary entry", () => {
    const text = current();
    const targets = new Set([...text.matchAll(/<a id="(refusal-[a-z0-9-]+)"><\/a>/g)].map((m) => m[1]));
    const links = [...text.matchAll(/`\]\(#(refusal-[a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(targets.has(link)).toBe(true);
  });

  test("a tool lists only known codes its own text names", () => {
    const known = knownCodes();
    const weather = CATALOGUE.find((c) => c.name === "world.weather.set")!;
    expect(namedCodes(weather, known)).toContain("quest_scene");
    for (const command of CATALOGUE) for (const code of namedCodes(command, known)) expect(known.has(code)).toBe(true);
    // A parameter name that merely looks like a code is not one.
    expect(known.has("add_if_missing")).toBe(false);
  });

  test("a new command changes the reference, and lands in Other tools until an area claims it", () => {
    const extra: CommandDef = {
      name: "npc.wave",
      title: "Wave at V",
      description: "A test command the catalogue doesn't have.",
      permission: "write-player",
      input: obj({ style: oneOf("How to wave.", ["small", "big"]) }, ["style"]),
      undo: "Nothing to put back.",
      bridge: { method: "npc.wave" },
    };
    expect(areaOf(extra).id).toBe("other-tools");
    const text = renderReference([...CATALOGUE, extra]);
    expect(text).not.toBe(current());
    expect(text).toContain("## Other tools");
    expect(text).toContain("| `style` (required) | string | `small`, `big` | How to wave. |");
  });
});
