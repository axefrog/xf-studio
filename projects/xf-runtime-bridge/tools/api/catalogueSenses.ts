// The senses for the Story Engine (research/story-engine/runtime-requirements.md S2 to S6): read-only commands that tell an
// agent what V is, where she is and what the world has recorded, without a screenshot. catalogue.ts places them; only types
// come from there, so the two modules don't load each other. scene.read's npc_detail lives on scene.read itself
// (catalogue060.ts).
//
//   world.facts     up to 128 named quest facts in one call, or a named preset (main_story: the 93 facts of
//                   research/story-engine/main-story-facts.json; final_boards: the 29 the game's final boards read)
//   world.district  V's district, subdistrict and place from the game's own district system
//   player.status   health, level, street cred, money, wanted level, current vehicle, an inventory summary and the scanner

import type { CommandDef } from "./catalogue.ts";
import { FINAL_BOARDS_FACTS, MAIN_STORY_FACTS } from "./fact-presets.ts";
import { obj, oneOf, str } from "./schema.ts";

type Json = Record<string, any>;

const planError = (code: string, message: string) => Object.assign(new Error(message), { plain: { code, message } });

/** The most facts one world.facts call reads (the bridge's own cap, core/Senses.hpp kMaxFacts). */
export const MAX_FACTS = 128;

export type FactPreset = { description: string; facts: readonly string[] };

export const FACT_PRESETS: Readonly<Record<string, FactPreset>> = {
  main_story: {
    description: "The main-story facts of the 2.31 quest data (93), grouped in the answer by category.",
    facts: MAIN_STORY_FACTS.map((f) => f.name),
  },
  final_boards: {
    description: "The facts the game's own final boards read (29): whose fate matters for the ending.",
    facts: FINAL_BOARDS_FACTS,
  },
};

/** The bridge's params for world.facts: the preset's names, then the given ones, each once, within the cap. */
export function expandFacts(input: Record<string, unknown>): { facts: string[] } {
  const preset = input.preset as string | undefined;
  if (preset !== undefined && !Object.hasOwn(FACT_PRESETS, preset)) throw planError("bad_input", `Unknown preset "${preset}". Presets: ${Object.keys(FACT_PRESETS).join(", ")}.`);
  const names = [...(preset ? FACT_PRESETS[preset]!.facts : []), ...((input.facts as string[] | undefined) ?? [])];
  const facts = [...new Set(names)];
  if (facts.length === 0) throw planError("bad_input", "Give facts (a list of quest fact names) or a preset.");
  if (facts.length > MAX_FACTS) throw planError("bad_input", `That is ${facts.length} different facts; one read takes at most ${MAX_FACTS}. Split the list over several calls.`);
  return { facts };
}

/** A preset read's answer: the preset's name, and the main story's values grouped by category. */
export function annotateFacts(value: unknown, input: Record<string, unknown>): unknown {
  const answer = value as Json;
  const preset = input.preset as string | undefined;
  if (!preset || !answer || typeof answer !== "object" || !answer.facts) return value;
  const out: Json = { ...answer, preset };
  if (preset === "main_story") {
    const byCategory: Record<string, Record<string, number>> = {};
    for (const { name, category } of MAIN_STORY_FACTS) (byCategory[category] ??= {})[name] = answer.facts[name];
    out.by_category = byCategory;
    out.game_version = "2.31";
  }
  return out;
}

export const STATUS_PARTS = ["vitals", "progress", "money", "heat", "vehicle", "inventory", "scanner"] as const;

const NOT_READY = " With no world to read it is refused game_loading (the bridge's gate, on the main menu, between sessions and during a load) or, if the gate is open but the game has no world yet, game_not_ready.";

export const SENSES_COMMANDS: CommandDef[] = [
  {
    name: "world.facts",
    title: "Read quest facts in a batch",
    description:
      `Reads many named quest facts in one call: facts (a list of at most ${MAX_FACTS} names) and/or preset. The preset main_story is the ${MAIN_STORY_FACTS.length} main-story facts of the 2.31 quest data (research/story-engine/main-story-facts.json; the answer also groups them by category), final_boards the ${FINAL_BOARDS_FACTS.length} the game's final boards read. Names are letters, digits, _ and . only. A fact the game never set reads 0, the same as one set to 0. Read only; world_state reads up to 16 facts beside the clock and weather.${NOT_READY}`,
    permission: "read",
    input: obj({
      facts: { type: "array", description: `Quest fact names to read (at most ${MAX_FACTS}).`, items: str("A fact name.", { pattern: "^[A-Za-z0-9_.]+$", maxLength: 96 }), maxItems: MAX_FACTS },
      preset: oneOf(`A named list of facts, read with any extra facts: ${Object.entries(FACT_PRESETS).map(([name, p]) => `${name} (${p.description})`).join(" ")}`, Object.keys(FACT_PRESETS)),
    }),
    bridge: { method: "world.facts", params: (input) => expandFacts(input), result: annotateFacts },
  },
  {
    name: "world.district",
    title: "Read V's district",
    description:
      "Where V is in Night City's own terms, from the game's district system (the one the minimap and the police use): the innermost area, and above it the subdistrict and district (a place such as Kabuki_NoTellMotel inside Kabuki inside Watson), each with its name, type, crime multiplier and gangs, the police preset in force, Dogtown and Badlands flags, and the map's own location text as a cross-check. District is not position: player_state has the coordinates. Refused with no_district for a moment after a load, until the game has told its district system where V is. Read only." + NOT_READY,
    permission: "read",
    input: obj({}),
    bridge: { method: "world.district" },
  },
  {
    name: "player.status",
    title: "Read V's status",
    description:
      "V's life state in one read: health (points, maximum, percent), level and street cred with their experience, money (eddies), the wanted level (the police system's heat stage, the star state and whether the police chase V, beside the two quest facts for comparison), the vehicle V is in (mounted or not, which record, driver or passenger), an inventory summary (counts and quantities by item type, not a list; at most 1500 stacks are read, and total_stacks and truncated say when more were left), and the scanner (whether V is in scanner mode, how far the scan is, and what the scanner is on). parts picks some of vitals, progress, money, heat, vehicle, inventory and scanner (default all). Read only; player_state has V's position and movement." + NOT_READY,
    permission: "read",
    input: obj({
      parts: { type: "array", description: "Which parts (default all): vitals, progress, money, heat, vehicle, inventory, scanner.", items: oneOf("A part.", STATUS_PARTS), maxItems: STATUS_PARTS.length },
    }),
    bridge: { method: "player.status" },
  },
];
