// Bridge 0.7's commands (research/runtime/bridge-hook-inventory.md): V's cyberware (read, and equip for the render study's
// arm captures), the world's state and streaming probes, the weather, the UI's state, the save list, photo mode's scene rows,
// the overlay host's state, and session.wait (block until the player answers a question or comments from the game,
// session 7's in-game driving). catalogue.ts places them; only types come from there, so the two modules don't load each
// other.

import type { CommandContext, CommandDef, CommandResult } from "./catalogue.ts";
import { bool, int, num, obj, oneOf, str, type JsonSchema } from "./schema.ts";
import { point3 } from "./catalogue060.ts";
import { NPC_WAIT_KINDS } from "./catalogue080npc.ts";
import { HOLSTER_FIRST, runCyberwareChange } from "./catalogue080.ts";

type Json = Record<string, any>;

const planError = (code: string, message: string, detail?: unknown) =>
  Object.assign(new Error(message), { plain: { code, message, ...(detail !== undefined ? { detail: typeof detail === "string" ? detail : JSON.stringify(detail) } : {}) } });

async function call(context: CommandContext, method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<Json> {
  const response = await context.api.callBridge(method, params, context.cid, timeoutMs, context.signal);
  if (!response.ok) throw Object.assign(new Error(response.error.message), { plain: response.error });
  return response.result as Json;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

export const CYBERWARE_AREAS = [
  "ArmsCW",
  "HandsCW",
  "EyesCW",
  "FaceCW",
  "FrontalCortexCW",
  "SystemReplacementCW",
  "NervousSystemCW",
  "CardiovascularSystemCW",
  "ImmuneSystemCW",
  "IntegumentarySystemCW",
  "MusculoskeletalSystemCW",
  "LegsCW",
] as const;

const recordName = (description: string): JsonSchema => str(description, { pattern: "^[A-Za-z0-9_]+\\.[A-Za-z0-9_.]+$", maxLength: 128 });

// --- session.wait -----------------------------------------------------------------------------------

// 0.8: the npc.* events too (npc.choice brings the player's pick from npc_choices).
export const WAIT_KINDS = ["answer", "comment", "note", "behaviour", "kill", "handover", "resume", "write", "refused", ...NPC_WAIT_KINDS] as const;

/**
 * session.wait (0.7): blocks until the session's event stream has an event of the given kinds, then answers those events.
 * The tools poll the plugin's stream a few times a second (paced like every call), so the agent makes one call instead of
 * polling session_log; an abort (the MCP client's cancel) ends the wait early.
 *
 * - Where it starts: after `after` when given, else at the newest event when the call starts; but with `message_id` and no
 *   `after`, the question's own answer counts even when the player gave it before the wait began (RB-96: the answer between
 *   ui_message and session_wait was skipped). The stream is searched from its start for that answer first.
 * - message_id covers answers only: with it, only the answer to that question counts, and the other kinds asked for
 *   (comment, note, ...) still end the wait from the call on (RB-115).
 * - Notes count only from the game (source "game": Mark this moment, the CET window), never a client's own session.note
 *   (RB-115).
 * - With message_id the question's state is read too (ui.ask.state): withdrawn, cleared or expired without an answer ends
 *   the wait with `question_gone` (RB-103); answered while its event is no longer in the stream returns the answer from the
 *   board.
 */
export async function runSessionWait(input: Json, context: CommandContext): Promise<CommandResult> {
  const messageId = input.message_id as number | undefined;
  const kinds = ((input.kinds as string[] | undefined) ?? ["answer", "comment"]).slice();
  if (messageId !== undefined && !kinds.includes("answer")) kinds.push("answer");
  const timeoutMs = Math.round(((input.timeout_s as number | undefined) ?? 120) * 1000);
  const started = Date.now();
  const deadline = started + timeoutMs;
  const waited = () => Math.round((Date.now() - started) / 100) / 10;
  const interval = (input.poll_ms as number | undefined) ?? 400;
  const latest = Number((await call(context, "session.events", { since: 0, limit: 1 })).latest ?? 0);
  let since = (input.after as number | undefined) ?? latest;

  const counts = (e: Json) =>
    (e.kind !== "answer" || messageId === undefined || e.data?.message_id === messageId) && (e.kind !== "note" || e.source === "game");
  const answered = (events: Json[], extra: Json = {}): CommandResult => {
    const answer = events.find((e) => e.kind === "answer");
    const comments = events.filter((e) => e.kind === "comment");
    return {
      value: {
        waited_s: waited(),
        events,
        next: since,
        ...(answer ? { answer: { label: answer.data?.label, choice: answer.data?.choice, message_id: answer.data?.message_id, via: answer.data?.via } } : {}),
        ...(comments.length ? { comments: comments.map((e) => e.data?.text ?? e.text) } : {}),
        ...extra,
      },
    };
  };
  const askState = async (): Promise<Json | null> => {
    const response = await context.api.callBridge("ui.ask.state", { id: messageId }, context.cid, undefined, context.signal);
    return response.ok ? (response.result as Json) : null; // an older plugin without it: poll the stream only
  };

  // RB-96: the player may have answered already (between ui_message and this call). Look back through the stream.
  if (messageId !== undefined && input.after === undefined) {
    let cursor = 0;
    for (let page = 0; page < 20 && cursor < latest; page++) {
      const read = await call(context, "session.events", { since: cursor, limit: 100, kinds: ["answer"] });
      const hit = ((read.events as Json[] | undefined) ?? []).find((e) => e.data?.message_id === messageId);
      if (hit) return answered([hit], { answered_before_wait: true });
      const next = Number(read.next ?? cursor);
      if (next <= cursor) break;
      cursor = next;
    }
  }

  let checkedAnswered = false;
  while (Date.now() < deadline && !context.signal?.aborted) {
    const read = await call(context, "session.events", { since, limit: 100, kinds });
    since = Number(read.next ?? since);
    const wanted = ((read.events as Json[] | undefined) ?? []).filter(counts);
    if (wanted.length) return answered(wanted);
    if (messageId !== undefined) {
      const state = await askState();
      if (state?.state === "gone") {
        return { value: { question_gone: true, message_id: messageId, why: "the question was withdrawn, cleared or ran out of time without an answer", waited_s: waited(), events: [], next: since } };
      }
      if (state?.state === "answered") {
        // Its event is pushed a moment after the board marks it: read the stream once more before answering from the board.
        if (checkedAnswered) {
          return {
            value: { waited_s: waited(), events: [], next: since, answer: { label: state.answer?.label, choice: state.answer?.choice, message_id: messageId, via: null }, from: "question_state" },
          };
        }
        checkedAnswered = true;
        continue;
      }
    }
    // 0.8.2 (session 9: a waiting session_wait held the pipe, so every other XF tool's call was refused bridge_busy): the
    // connection is let go between polls, and the next poll opens it again.
    context.api.release();
    await sleep(interval, context.signal);
  }
  return { value: { timed_out: !context.signal?.aborted, aborted: context.signal?.aborted === true, waited_s: waited(), events: [], next: since } };
}

// --- the catalogue's new entries ---------------------------------------------------------------------

export const COMMANDS_070: CommandDef[] = [
  {
    name: "session.wait",
    title: "Wait for the player's answer",
    description:
      "Waits until the player answers a question from the game or sends a comment (or another event kind you name), then returns it: kinds (default answer and comment; note catches notes from the game, such as Mark this moment, never a client's own), message_id (only the answer to that ui_message question counts, even one given before this call; other kinds still end the wait from now on; a question withdrawn, cleared or run out of time without an answer ends it with question_gone), after (the event sequence to wait after; default: now) and timeout_s (1 to 600, default 120). Answers come from the answer keys or the buttons in the XF Runtime Bridge window of the Cyber Engine Tweaks overlay; comments from that window's comment box. Use it after ui_message with level ask instead of polling session_log. Changes nothing.",
    permission: "read",
    input: obj({
      kinds: { type: "array", description: "Event kinds that end the wait (default answer and comment).", items: oneOf("An event kind.", [...WAIT_KINDS]), minItems: 1, maxItems: WAIT_KINDS.length },
      message_id: int("Only the answer to this question (ui_message's id) ends the wait, even one given before the call; other kinds still count.", 1, 1e9),
      after: int("Wait for events after this sequence number (session_events' next); default: the newest when the call starts.", 0, 1e12),
      timeout_s: num("Give up after this many seconds, 1 to 600. Default 120.", 1, 600),
      poll_ms: int("How often the stream is read, 200 to 2000 ms. Default 400.", 200, 2000),
    }),
    local: runSessionWait,
  },
  {
    name: "cyberware.state",
    title: "Read V's cyberware",
    description:
      "What each of V's cyberware areas holds (ArmsCW, HandsCW, EyesCW, FaceCW, FrontalCortexCW, SystemReplacementCW, NervousSystemCW, CardiovascularSystemCW, ImmuneSystemCW, IntegumentarySystemCW, MusculoskeletalSystemCW, LegsCW), slot by slot with each item's record and name; for the arms, the chain the character creator's holster state follows (the ArmsCW item's holstered item and its appearance, such as holstered_mantis, and the creator group that draws it), what the right-arm and weapon slots hold now, drawn (the arm cyberware is out, by the rule cyberware changes are refused by), and whether a no-arm-cyberware effect is on; V's humanity. areas limits the list.",
    permission: "read",
    input: obj({ areas: { type: "array", description: "Only these areas (default all).", items: oneOf("A cyberware area.", [...CYBERWARE_AREAS]), minItems: 1, maxItems: CYBERWARE_AREAS.length } }),
    bridge: { method: "cyberware.state" },
  },
  {
    name: "cyberware.equip",
    title: "Equip a cyberware item",
    description:
      "Puts a cyberware item into its area's slot through the game's own equipment request, as a ripperdoc's screen does (the earlier item in that slot comes out first): item is its record (Items.StrongArms, Items.MantisBlades, Items.NanoWires, Items.ProjectileLauncher, ...), slot the slot (default the first empty one), add_if_missing adds it to V's inventory first and remembers it. Only in normal play, outside combat and scenes; while the arm cyberware is drawn (after photo mode it stays drawn) the tools holster it first with the game's own request (holster_first: false refuses arms_drawn instead); the game's own equip requirements are checked before anything changes (not_equippable leaves nothing added). The answer reads the slot back and carries the undo (the exact earlier copy back, with a copy the bridge added removed, or the slot emptied and an added item removed); if the slot can't be read back, equipped is unknown and the undo is still given. V's look and stats change until the undo, the kill switch or a load; the save lock is held meanwhile and game_save refuses until it is undone. In the inventory class, off unless allowed.",
    permission: "write-inventory",
    input: obj(
      {
        item: recordName("The cyberware item's record, such as Items.MantisBlades."),
        slot: int("The slot, 0 to 9 (default: the first empty one).", 0, 9),
        add_if_missing: bool("Add the item to V's inventory first if V doesn't have it (removed again by the undo)."),
        id: str("The exact copy to equip, as an undo names it (digits).", { pattern: "^[0-9]{1,24}$" }),
        remove_added_item: recordName("After the equip, remove the copy of this record the bridge added (a swap's undo gives it)."),
        holster_first: HOLSTER_FIRST,
      },
      ["item"],
    ),
    undo: "The result's undo puts the earlier item back, or empties the slot and removes an item the bridge added; loading the save undoes it too.",
    local: (input, context) => runCyberwareChange("cyberware.equip", input, context),
  },
  {
    name: "cyberware.unequip",
    title: "Empty a cyberware slot",
    description:
      "Takes a cyberware item out of its slot through the game's own unequip request: area (ArmsCW, ...) and slot (one of the area's unlocked slots), or item (its record; its own slot is found). remove_added also removes an item the bridge itself added this session. Normal play only; while the arm cyberware is drawn the tools holster it first (holster_first: false refuses arms_drawn instead). The answer reads the slot back and carries the undo (the item equipped again).",
    permission: "write-inventory",
    input: obj({
      area: oneOf("The cyberware area.", [...CYBERWARE_AREAS]),
      item: recordName("The item's record (instead of area)."),
      slot: int("The slot, 0 to 9 (default 0, or the item's slot).", 0, 9),
      remove_added: bool("Also remove the item from V's inventory when the bridge added it (with item)."),
      holster_first: HOLSTER_FIRST,
    }),
    undo: "The result's undo equips the item again; loading the save undoes it too.",
    local: (input, context) => runCyberwareChange("cyberware.unequip", input, context),
  },
  {
    name: "world.state",
    title: "Read the world's state",
    description:
      "The world as it is now: the clock (day, time, paused, time dilation, the bridge's freeze), the rain (type, intensity, puddles, moisture), the weather state's name and this world's weather states (with Codeware; without it only the rain is readable), named quest facts (facts: their values, read only), and in photo mode its own time, weather, NPC and game-speed rows with their options. Changes nothing.",
    permission: "read",
    input: obj({ facts: { type: "array", description: "Quest fact names to read (at most 16).", items: str("A fact name.", { pattern: "^[A-Za-z0-9_.]+$", maxLength: 96 }), maxItems: 16 } }),
    bridge: { method: "world.state" },
  },
  {
    name: "world.probe",
    title: "Probe the world at points",
    description:
      "Observe only: at each point (points, up to 16, or a ring around V with around_v), whether the walkable ground around it is loaded (streamed), the nearest walkable point within radius_m, the ground below (a static-geometry ray down_m down) and the ceiling above, and the distance from V. For choosing a place before a teleport, a glide or a showroom; nothing is moved or loaded.",
    permission: "read",
    input: obj({
      points: { type: "array", description: "World points to probe.", items: point3("A world point [x, y, z]."), minItems: 1, maxItems: 16 },
      around_v: bool("Probe V's place and a ring around her instead of points."),
      ring_m: num("The ring's radius, 0.5 to 50 m. Default 3.", 0.5, 50),
      count: int("Points on the ring, 1 to 15. Default 8.", 1, 15),
      radius_m: num("How far to look for walkable ground from each point, 0.2 to 10 m. Default 2.", 0.2, 10),
      down_m: num("How far below each point the ground ray looks, 0.5 to 100 m. Default 10.", 0.5, 100),
      clearance_m: num("Also cast eight level rays this long from each point and report which are blocked (free space), 0.05 to 3 m.", 0.05, 3),
      sight_from: point3("Also check the sight line from this world point to each point (static geometry between)."),
    }),
    bridge: { method: "world.probe", timeoutMs: () => 15000 },
  },
  {
    name: "world.weather.set",
    title: "Set the weather",
    description:
      "Holds one of this world's weather states (name, as world_state lists them, blending over blend_s seconds), which stops the game's own weather cycle, or gives the weather back to the cycle (cycle: true, with or without a name). Needs Codeware (detected, never installed). Refused in a story scene (quest_scene), where the story may hold the weather; elsewhere a quest's own weather hold can still win, and giving the weather back to the cycle ends such a hold too (the answer's note says so). The answer carries the undo (the earlier state and the cycle back on); the kill switch does the same. A save made meanwhile would keep the weather, so the save lock stays on and game_save refuses until it is undone.",
    permission: "write-world",
    input: obj({
      name: str("The weather state, such as 24h_weather_rain.", { pattern: "^[A-Za-z0-9_.-]+$", maxLength: 96 }),
      blend_s: num("Blend time, 0 to 60 seconds. Default 2.", 0, 60),
      cycle: bool("Give the weather back to the game's own cycle (after setting name, if given)."),
    }),
    undo: "The result's undo sets the earlier weather and turns the game's cycle back on; the kill switch does the same.",
    bridge: { method: "world.weather.set" },
  },
  {
    name: "ui.state",
    title: "Read what the game's UI shows",
    description:
      "What is on screen besides the world: the game's phase, a menu or popup, the appearance screen, photo mode and whether the bridge hid its menu or the cursor, the gameplay tier, the HUD's interaction prompt and dialogue choices, whether Cyber Engine Tweaks' overlay is open (its windows would be in a capture), the ink panel, the status surface showing, the XF pins and what drew each, the question waiting for the player's answer, and the XF overlay host's state. Changes nothing.",
    permission: "read",
    input: obj({}),
    bridge: { method: "ui.state" },
  },
  {
    name: "game.saves",
    title: "List the saves",
    description:
      "The game's save list with each save's details as the Load menu shows them: its name, type (manual, auto, quick, point of no return), location, tracked quest, level, life path, time, play time, game version and whether it was made with mods, newest first (limit, default 20), from normal play, the pause menu or the main menu. The details of the newest limit saves are asked for the way the Load menu asks (each save's screenshot request), and the game sends them a moment after the list; wait_ms (default 3000) waits for them. Loads nothing.",
    permission: "read",
    input: obj({ limit: int("How many saves' details, 1 to 200. Default 20.", 1, 200), wait_ms: int("How long to wait for the details, 500 to 10000 ms. Default 3000.", 500, 10000) }),
    bridge: { method: "game.saves", timeoutMs: (input) => ((input.wait_ms as number | undefined) ?? 3000) + 6000 },
  },
  {
    name: "photo.scene.set",
    title: "Set photo mode's scene rows",
    description:
      "Photo mode's own scene rows, through its menu like every other setting: npcs (the surrounding NPCs row), weather (its weather row) and game_speed (0 to 1). npcs and weather each take {value} (the option's value from photo_state with options) or {label} (its on-screen text, matched loosely). Photo mode only; gone when photo mode closes. The answer carries the undo (the rows' earlier values).",
    permission: "write-photo",
    input: obj({
      npcs: { description: "The surrounding NPCs row: {value} or {label}.", ...obj({ value: num("The option's value (photo_state's data).", -1000, 1000), label: str("The option's label.", { minLength: 1, maxLength: 64 }) }) },
      weather: { description: "The weather row: {value} or {label}.", ...obj({ value: num("The option's value (photo_state's data).", -1000, 1000), label: str("The option's label.", { minLength: 1, maxLength: 64 }) }) },
      game_speed: num("The game-speed row, 0 to 1.", 0, 1),
    }),
    undo: "The result's undo sets the rows back; closing photo mode drops them too.",
    bridge: { method: "photo.scene.set" },
  },
  {
    name: "overlay.state",
    title: "Read the XF overlay's state",
    description:
      "The XF overlay host (a test feature: XF's own panel drawn over the game, one diagnostic panel, no input yet): whether it is on in this build, hooked, drawing or why not (HDR, the back buffer's format, a missing engine address), the back buffer, the theme (dark or light, from the XF Studio's own colours), frames drawn and its CPU time per frame, whether it is hidden for a capture or yielding to Cyber Engine Tweaks' overlay, and which frame-generation modules the game has loaded. Changes nothing.",
    permission: "read",
    input: obj({}),
    bridge: { method: "overlay.state" },
  },
];
