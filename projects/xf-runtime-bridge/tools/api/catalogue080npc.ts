// Bridge 0.8's NPC direction (research/runtime/npc-direction-design.md): list and pick NPCs near V, spawn XF actors (our own
// clones of base-game civilians, never saved), walk, follow, turn and place them, give them lines (text and vanilla voice
// lines), a gaze, a face and a gesture, offer V dialogue choices in the game's own widget, release them, and run a whole
// scene as data (npc.scenario, tools/npc/scenario.ts). catalogue.ts places these; only types come from there, so the two
// modules don't load each other.

import type { CommandContext, CommandDef, CommandResult } from "./catalogue.ts";
import { bool, int, num, obj, oneOf, str, type JsonSchema } from "./schema.ts";
import { point3 } from "./catalogue060.ts";

type Json = Record<string, any>;

/** The XF actors npc.spawn offers (core/Npc.cpp Casts(); tweaks/test-profile/xf_npc_actors.yaml). */
export const NPC_CASTS = ["woman_corpo", "man_corpo", "woman_nightlife", "man_youngster", "woman_lowlife", "man_lowlife", "woman_masked", "man_masked", "research_crowd_record", "research_npc_base"] as const;
/** Facial reactions (core/Npc.cpp Expressions()). */
export const NPC_EXPRESSIONS = ["neutral", "joy", "smile", "sad", "surprise", "aggressive", "anger", "interested", "disinterested", "disappointed", "disgust", "nervous", "fear"] as const;
/** Vanilla voice triggers npc.say may play (core/Npc.cpp VoiceTriggers()). */
export const NPC_TRIGGERS = ["greeting", "bump", "stlh_curious_grunt", "coop_irritation", "battlecry_curse", "fear_foll", "fear_beg", "fear_run", "danger", "vehicle_bump"] as const;
/** Gestures in the XF gesture carrier (core/Npc.cpp Gestures()). */
export const NPC_GESTURES = ["talk", "talk_hips", "wave", "shrug", "nod", "arms_crossed", "facepalm", "check_phone"] as const;
/** The npc.* events in the session's event stream (session_wait's kinds). */
export const NPC_WAIT_KINDS = [
  "npc.spawned",
  "npc.arrived",
  "npc.blocked",
  "npc.move_failed",
  "npc.follow_ended",
  "npc.turned",
  "npc.said",
  "npc.act_done",
  "npc.choice",
  "npc.released",
  "npc.dissolved",
  "npc.handed_back",
  "npc.lost",
  "npc.died",
  "npc.auto_released",
] as const;

const HANDLE = "^[ap][0-9]{1,5}$";
const TARGET = "^(v|[ap][0-9]{1,5})$";
const who = (description = "The NPC: its handle from npc_spawn (a1, a2, ...) or npc_pick (p1, ...).") => str(description, { pattern: HANDLE });
const target = (description: string) => str(description, { pattern: TARGET });
const gait = oneOf("How it moves: walk (default), run or sprint.", ["walk", "run", "sprint"]);

/** Catalogue input to the bridge's parameters: the point forms join their plain form (to_point -> to, and so on). */
export function npcParams(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  const join = (plain: string, point: string) => {
    if (out[point] !== undefined) {
      out[plain] = out[point];
      delete out[point];
    }
  };
  join("to", "to_point");
  join("at", "at_point");
  join("face", "face_point");
  join("away_from", "away_from_point");
  // V16: an out-of-sight spot is the bridge's own at form.
  if (out.out_of_sight === true) out.at = "out_of_sight";
  delete out.out_of_sight;
  if (out.ahead_m !== undefined || out.side_m !== undefined) {
    out.at = { ahead_m: out.ahead_m ?? 0, ...(out.side_m !== undefined ? { side_m: out.side_m } : {}) };
    delete out.ahead_m;
    delete out.side_m;
  }
  return out;
}

const bridgeNpc = (method: string) => ({ method, params: npcParams });

/** V's state: every npc write (and a pick) is refused while V is out of normal play, fighting, driving or in a scene. */
const V_STATE = ["not_in_world", "in_combat", "in_vehicle", "in_scene", "not_v"];
const OURS = ["npc_unknown", "not_ours", "npc_lost", "npc_handed_back", "npc_dead"];
/**
 * Each npc command's own refusal codes (for the MCP reference; with bridge 0.8a's catalogue080.ts they join its REFUSALS):
 * what core/Npc.cpp, the redscript layer (XFNpc) and the scenario runner raise, beyond the codes every command can answer.
 * Their plain words are errors080npc.ts.
 */
export const NPC_REFUSALS: Readonly<Record<string, readonly string[]>> = {
  "npc.list": ["not_in_world", "codeware_missing"],
  "npc.pick": [...V_STATE, "codeware_missing", "npc_protected", "npc_busy", "npc_not_found", "too_far", "limit"],
  "npc.status": [],
  "npc.spawn": [...V_STATE, "cast_unknown", "codeware_missing", "record_missing", "not_ready", "not_streamed", "not_walkable", "spawn_refused", "too_far", "limit", "no_hidden_spot"],
  "npc.move": [...V_STATE, ...OURS, "npc_not_spawned", "npc_releasing", "not_walkable", "too_far", "no_ai"],
  "npc.follow": [...V_STATE, ...OURS, "npc_not_spawned", "npc_releasing", "too_far", "no_ai"],
  "npc.turn": [...V_STATE, ...OURS, "npc_not_spawned", "npc_releasing", "no_ai"],
  "npc.place": [...V_STATE, ...OURS, "npc_releasing", "not_streamed", "not_walkable", "too_far", "no_ai"],
  "npc.stop": ["npc_unknown", "not_ours", "npc_releasing"],
  "npc.say": [...V_STATE, "npc_unknown", "npc_lost", "npc_handed_back", "npc_dead", "line_too_long", "trigger_unknown"],
  "npc.look": [...V_STATE, "npc_unknown", "npc_lost", "npc_handed_back", "npc_dead", "npc_not_spawned"],
  "npc.face": [...V_STATE, "npc_unknown", "npc_lost", "npc_handed_back", "npc_dead", "expression_unknown"],
  "npc.act": [...V_STATE, ...OURS, "npc_moving", "gesture_unknown", "rig_unsupported", "carrier_missing"],
  "npc.choices": [...V_STATE, "npc_unknown", "npc_lost", "npc_handed_back", "npc_dead", "choices_busy", "one_hub_at_a_time", "too_far", "choice_too_long"],
  "npc.release": ["npc_unknown"],
  "npc.scenario": ["scenario_invalid"],
};

const withRefusals = (command: CommandDef) => Object.assign(command, { refusals: NPC_REFUSALS[command.name] ?? [] });

const DEFINITIONS: CommandDef[] = [
  {
    name: "npc.list",
    title: "List the NPCs near V",
    description:
      "The NPCs within radius_m of V (default 15, at most 40): each one's id (for npc_pick), record, distance and place, whether it is part of the street crowd, whether it is protected (a quest character, a companion, a vendor, police, a child, a boss, or in a story scene) with the reasons, whether it is busy (sitting or leaning somewhere, fighting, hostile to V), whether npc_pick would take it (pickable: a plain passer-by of the street crowd, not busy), and which are the session's own. Changes nothing.",
    permission: "read",
    input: obj({ radius_m: num("How far from V to look, 1 to 40 metres. Default 15.", 1, 40), max: int("At most this many, 1 to 40. Default 20.", 1, 40) }),
    bridge: { method: "npc.list" },
  },
  {
    name: "npc.pick",
    title: "Pick an NPC near V",
    description:
      "Adopts one plain passer-by of the street crowd within 30 m of V (its id from npc_list, pickable) so the bridge can make it look at someone, change its face and say a line; it is never moved, placed, turned, given a gesture or a stance, or removed, and it keeps walking its own way. Anyone else is refused: protected NPCs (story characters, companions, vendors, police, children, bosses, anyone in a scene) and every NPC outside the street crowd (a quest may use one without marking it), and busy ones (sitting or leaning somewhere, fighting, hostile to V). A pick that becomes busy or protected later is given back at once (npc.auto_released), and its gaze, face and lines are taken back on its release, the kill switch, the pause and a handover; a load takes the NPC itself away. Answers the NPC's handle (p1, p2, ...). Changes nothing by itself.",
    permission: "read",
    input: obj({ id: str("The NPC's id from npc_list.", { minLength: 1, maxLength: 64 }) }, ["id"]),
    bridge: { method: "npc.pick" },
  },
  {
    name: "npc.status",
    title: "Read the NPCs the bridge directs",
    description:
      "The session's actors and picked NPCs: each one's handle, cast or record, whether it has appeared, where it is, what it is doing (walking, following, turning), its lines still showing, its gaze, face and gesture; the dialogue choices showing, if any; and the limits (3 actors, 4 picks, 30 m). Changes nothing.",
    permission: "read",
    input: obj({}),
    bridge: { method: "npc.status" },
  },
  {
    name: "npc.spawn",
    title: "Bring in an XF actor",
    description:
      "Brings an XF actor into the world near V: cast is one of XF's own passers-by (a copy of an ordinary base-game civilian, never a story character), placed ahead_m metres along V's facing and side_m to her right (or at a world point), on walkable ground within 30 m of V, facing V (or face another NPC or face_point). out_of_sight lets the bridge choose a walkable spot V can't see (outside her view or behind a wall, min_m to max_m from her, 12 to 25 by default), so the actor walks in from somewhere rather than appearing; out_of_view waits until the spot isn't on screen. The masked casts cover the mouth with a mask or respirator, so lines without lip movement read naturally. By default the actor is friendly to V, can't be killed and has calm reactions; attitude neutral or hostile, immortal false and reactions game make a stand-in that can be shot (when a fight begins the bridge stops directing it and its own AI takes over, npc.handed_back; if it dies its body stays until released). It is never saved: npc_release, the kill switch or loading a save removes it, and game_save refuses while one is out. At most 3 at once. Answers its handle (a1, a2, a3) at once; npc.spawned follows in the event stream when it appears. Returns traffic_check at the final snapped point: lane containment and nearest pavement are INCONCLUSIVE. Needs Codeware and the -writes package's actor records.",
    permission: "write-npc",
    input: obj(
      {
        cast: oneOf(
          "Which actor: woman_corpo, man_corpo, woman_nightlife, man_youngster, woman_lowlife or man_lowlife; woman_masked or man_masked wear a mask or respirator over the mouth (for lines without lip movement); research_crowd_record and research_npc_base are for the session-9 comparison only.",
          [...NPC_CASTS],
        ),
        ahead_m: num("Metres along V's facing (negative: behind her), -30 to 30.", -30, 30),
        side_m: num("Metres to V's right (negative: left), -30 to 30. Default 0.", -30, 30),
        at_point: point3("A world point instead of ahead_m and side_m."),
        face: target("Face V (\"v\", the default) or another NPC (its handle)."),
        face_point: point3("Face this world point instead."),
        appearance: str("One of the actor's appearances by name (default: the cast's own look, or random).", { pattern: "^[A-Za-z0-9_]+$", maxLength: 96 }),
        variant: int("Which of the cast's own looks (npc_status lists them per cast), from 0. Default 0.", 0, 31),
        out_of_view: bool("Appear only when the spot isn't on screen."),
        out_of_sight: bool("Let the bridge pick a walkable spot V can't see (outside her view, or behind static geometry), instead of ahead_m or at_point."),
        min_m: num("With out_of_sight: at least this far from V, 3 to 30 m. Default 12.", 3, 30),
        max_m: num("With out_of_sight: at most this far from V, 3 to 30 m. Default 25.", 3, 30),
        attitude: oneOf("How it stands towards V: friendly (the default), neutral or hostile.", ["friendly", "neutral", "hostile"]),
        immortal: bool("Whether it can't be hurt or killed (default true); false makes a mortal stand-in."),
        reactions: oneOf("quiet (the default: no crime or panic reactions) or game (an ordinary passer-by's own reactions).", ["quiet", "game"]),
        label: str("The name its lines and dialogue choices show (default Stranger).", { minLength: 1, maxLength: 40 }),
      },
      ["cast"],
    ),
    undo: "The result's undo releases the actor (npc_release with how despawn); the kill switch and loading a save remove it too.",
    bridge: bridgeNpc("npc.spawn"),
  },
  {
    name: "npc.move",
    title: "Walk an actor somewhere",
    description:
      "Sends one of the bridge's actors walking (or running) to V (\"v\"), to another NPC (its handle) or to a world point (to_point), stopping stop_m metres short (default 1.6); face_v sends V as the walk's facing target, off by default because the game keeps a facing target after the walk and a later walk then faces V (npc_turn after arriving faces her to V). It uses the game's own walking along walkable ground. npc.arrived follows when it gets there; npc.blocked when it makes no headway for 4 seconds (it keeps trying) or can't go on; npc.move_failed with the reason (no path, interrupted, or max_s passed, default 60). A new move replaces the last one. Picked NPCs aren't moved.",
    permission: "write-npc",
    input: obj(
      {
        who: who("The actor (a1, a2, a3)."),
        to: target("Where to: \"v\" or another NPC's handle."),
        to_point: point3("A world point instead."),
        gait,
        stop_m: num("Stop this far short of the target, 0.3 to 10 m. Default 1.6.", 0.3, 10),
        face_v: bool("Send V as the walk's facing target (default false: the game keeps it after the walk; npc_turn faces her to V on arrival)."),
        max_s: num("Give up after this many seconds, 1 to 60. Default 60.", 1, 60),
      },
      ["who"],
    ),
    undo: "npc_stop halts the actor where it is; it doesn't walk back.",
    bridge: bridgeNpc("npc.move"),
  },
  {
    name: "npc.follow",
    title: "Have an actor follow",
    description:
      "One of the bridge's actors follows V (the default) or another NPC at distance_m (default 2), matching its pace, until npc_stop or max_s (default 300 seconds); npc.follow_ended says when it stopped by itself.",
    permission: "write-npc",
    input: obj(
      {
        who: who("The actor."),
        target: target("Follow V (\"v\") or another NPC (its handle)."),
        distance_m: num("Keep this far behind, 1 to 10 m. Default 2.", 1, 10),
        gait,
        max_s: num("Stop following after this many seconds, 1 to 300. Default 300.", 1, 300),
      },
      ["who"],
    ),
    undo: "npc_stop ends the follow where the actor is.",
    bridge: bridgeNpc("npc.follow"),
  },
  {
    name: "npc.turn",
    title: "Turn an actor",
    description:
      "One of the bridge's actors turns on the spot to face V (\"v\"), another NPC (its handle) or a world point (to_point), or turns its back on one of them (away_from, away_from_point). hold keeps that facing (turning again whenever V or the other NPC moves round it, and after a walk ends) until npc_turn with off, a new turn or its release. npc.turned follows each turn.",
    permission: "write-npc",
    input: obj(
      {
        who: who("The actor."),
        to: target("Face V (\"v\") or another NPC (its handle)."),
        to_point: point3("Face this world point instead."),
        away_from: target("Turn its back on V (\"v\") or another NPC (its handle)."),
        away_from_point: point3("Turn its back on this world point."),
        hold: bool("Keep this facing until off, a new turn or the release."),
        off: bool("Stop holding a facing (it keeps facing where it faces)."),
      },
      ["who"],
    ),
    undo: "npc_stop ends a turn where it is; a held facing's undo is npc_turn with off.",
    bridge: bridgeNpc("npc.turn"),
  },
  {
    name: "npc.place",
    title: "Place an actor",
    description: "Puts one of the bridge's actors at a world point within 30 m of V, facing yaw degrees if given, at once (for staging a shot, not for drama). Unknown traffic classification proceeds with traffic_risk unknown and a warning; nearest pavement is unavailable. The answer's undo puts it back where it stood.",
    permission: "write-npc",
    input: obj({ who: who("The actor."), at: point3("The world point [x, y, z]."), yaw: num("Its facing in degrees (the game's yaw).", -360, 360) }, ["who", "at"]),
    undo: "The result's undo places the actor back where it stood.",
    bridge: { method: "npc.place" },
  },
  {
    name: "npc.stop",
    title: "Stop an actor",
    description: "Stops one of the bridge's actors walking, following or turning; it stays where it is.",
    permission: "write-npc",
    input: obj({ who: who("The actor.") }, ["who"]),
    undo: "Nothing to undo: the actor holds its place.",
    bridge: { method: "npc.stop" },
  },
  {
    name: "npc.say",
    title: "Give an NPC a line",
    description:
      "An NPC (an actor or a picked one) says something: text (up to 200 characters) shown as a subtitle with its name (style subtitle, the default), in a bubble above its head (overhead) or as a caller's subtitle (call_subtitle: the game's holocall line type, drawn as a subtitle with no call frame), for seconds seconds (default from its length); and/or trigger, one of the game's own voice lines for that NPC's voice (greeting, bump, stlh_curious_grunt, coop_irritation, battlecry_curse, fear_foll, fear_beg, fear_run, danger, vehicle_bump: the voice picks the words, not us; greeting also sets a smile unless a face is directed). speaker changes the name shown for this line. Without who, speaker is a voice with no body speaking to V from elsewhere: its text shows with that name and no NPC (style ownerless, the default, or call_subtitle or subtitle). The player's subtitle settings still apply. npc.said follows when the line's time ends. hide takes a shown line down by its id.",
    permission: "write-npc",
    input: obj({
      who: who("The NPC speaking (leave out for a voice with no body)."),
      speaker: str("The name shown with the line (a voice with no body needs one).", { minLength: 1, maxLength: 40 }),
      text: str("The line, up to 200 characters.", { minLength: 1, maxLength: 200 }),
      trigger: oneOf("A vanilla voice line in the NPC's own voice.", [...NPC_TRIGGERS]),
      style: oneOf("How the text shows: subtitle (default for NPCs), overhead, call_subtitle (the game's holocall line type: a subtitle with the caller's name, no call frame) or ownerless (default for a voice with no body).", ["subtitle", "overhead", "call_subtitle", "ownerless"]),
      seconds: num("How long the text shows, 1 to 15 seconds.", 1, 15),
      hide: str("Take down this line (its id from an earlier answer, such as l3) instead.", { pattern: "^l[0-9]{1,9}$" }),
      near_m: num("Refuse the line (too_far) unless the NPC stands within this many metres of V, 0.5 to 30: a scene's speech waits on a real arrival.", 0.5, 30),
    }),
    undo: "The result's undo hides the line; a voice line can't be taken back once it plays.",
    bridge: { method: "npc.say" },
  },
  {
    name: "npc.look",
    title: "Point an NPC's gaze",
    description: "An NPC (an actor or a picked one) looks at V (\"v\"), another NPC (its handle) or a world point (at_point), with its eyes, head and a little of its upper body; off: true gives its gaze back.",
    permission: "write-npc",
    input: obj({ who: who(), at: target("Look at V (\"v\") or another NPC (its handle)."), at_point: point3("Look at this world point instead."), off: bool("Stop looking.") }, ["who"]),
    undo: "The result's undo gives the gaze back (or to the earlier target).",
    bridge: bridgeNpc("npc.look"),
  },
  {
    name: "npc.face",
    title: "Set an NPC's expression",
    description: `An NPC (an actor or a picked one) shows a facial expression: ${NPC_EXPRESSIONS.join(", ")}; off: true relaxes it again.`,
    permission: "write-npc",
    input: obj({ who: who(), expression: oneOf("The expression.", [...NPC_EXPRESSIONS]), off: bool("Relax the face again.") }, ["who"]),
    undo: "The result's undo gives the face back.",
    bridge: { method: "npc.face" },
  },
  {
    name: "npc.act",
    title: "Play a gesture",
    description: `One of the bridge's actors plays a body gesture standing where it is: ${NPC_GESTURES.join(", ")}, for seconds (default the gesture's own length); npc.act_done follows. Needs the XF gesture carrier, which no package carries yet: until it is built every gesture is refused (carrier_missing), and lines, faces and looks still work. Not while it walks.`,
    permission: "write-npc",
    input: obj({ who: who("The actor."), gesture: oneOf("The gesture.", [...NPC_GESTURES]), off: bool("End the gesture now."), seconds: num("How long it plays, 0.5 to 30 seconds.", 0.5, 30) }, ["who"]),
    undo: "The result's undo ends the gesture.",
    bridge: { method: "npc.act" },
  },
  {
    name: "npc.choices",
    title: "Offer V dialogue choices",
    description:
      "Shows 2 to 4 dialogue choices for V in the game's own dialogue widget, titled with the NPC's name (or title), while V stands within 4 m of that NPC and the game shows no choices or interaction prompt of its own (choices_busy otherwise). The player picks with their usual keys; the pick arrives in the event stream as npc.choice with its index and text (session_wait with kinds npc.choice returns it), or with timeout after max_s (default 120), or walked_away when V leaves. One set at a time; withdraw takes one down by its hub number.",
    permission: "write-npc",
    input: obj(
      {
        who: who("The NPC V is talking to."),
        title: str("The widget's title (default the NPC's name).", { minLength: 1, maxLength: 40 }),
        choices: { type: "array", description: "What V can say: 2 to 4 short lines.", items: str("One choice, up to 90 characters.", { minLength: 1, maxLength: 90 }), minItems: 2, maxItems: 4 },
        max_s: num("Take the choices down after this many seconds, 5 to 120. Default 120.", 5, 120),
        withdraw: int("Take down the choices with this hub number (an earlier answer's hub) instead.", 1, 2147483647),
      },
    ),
    undo: "The result's undo withdraws the choices.",
    bridge: { method: "npc.choices" },
  },
  {
    name: "npc.release",
    title: "Release an NPC",
    description:
      "Ends what the bridge does with an NPC: its lines, gaze, face, gesture, walk and dialogue choices are taken back, then an actor is removed (how despawn, the default), walks 15 m away from V first and is removed there (walk_away), or walks off and is removed only once V can't see it and it is at least distance_m from her (dissolve; with walk false it stays where it is until V walks away; no time limit, and despawn removes it at once), and a picked NPC goes back to its own business (leave). who all releases everyone. npc.released follows (and npc.dissolved for a dissolve).",
    permission: "write-npc",
    input: obj(
      {
        who: str("The NPC's handle, or all.", { pattern: "^(all|[ap][0-9]{1,5})$" }),
        how: oneOf("despawn (actors, default), walk_away (actors), dissolve (actors) or leave (picked NPCs).", ["despawn", "walk_away", "dissolve", "leave"]),
        walk: bool("With dissolve: walk off first (default true)."),
        distance_m: num("With dissolve: removed only this far from V, 5 to 30 m. Default 15.", 5, 30),
      },
      ["who"],
    ),
    undo: "Nothing to undo; spawn a new actor if wanted.",
    bridge: { method: "npc.release" },
  },
  {
    name: "npc.scenario",
    title: "Run an NPC scene",
    description:
      "Runs a short NPC scene written as data (tools/npc/scenarios): name picks a bundled one (stranger_question: an XF actor walks up to V, greets her, asks a question, offers two answers and reacts to the one the player picks), or file a scene file. Each step is an npc command or a wait for an event; the player's pick decides the branch. When the scene ends, fails or is stopped, every actor it brought in is released. dry_run checks the scene and lists its steps without touching the game. Answers the steps taken, the events, the player's answer and how long each part took.",
    permission: "write-npc",
    input: obj({
      name: oneOf("A bundled scene.", ["stranger_question"]),
      file: str("A scene file (JSON) instead.", { minLength: 1, maxLength: 400 }),
      dry_run: bool("Check the scene and list its steps; nothing reaches the game."),
    }),
    undo: "The scene releases every actor it brought in when it ends, fails or is stopped; the kill switch and loading a save do too.",
    local: async (input: Json, context: CommandContext): Promise<CommandResult> => {
      const { loadScenario, runScenario, SCENARIO_DIR } = await import("../npc/scenario.ts");
      const { join } = await import("node:path");
      if (!input.name && !input.file) throw Object.assign(new Error("give name or file"), { plain: { code: "bad_input", message: "Give name (a bundled scene) or file (a scene file)." } });
      const path = input.file ? String(input.file) : join(SCENARIO_DIR, `${input.name}.json`);
      const scenario = loadScenario(path);
      const report = await runScenario(scenario, context, { dryRun: input.dry_run === true });
      return { value: report };
    },
  },
];

export const COMMANDS_080_NPC: CommandDef[] = DEFINITIONS.map(withRefusals);

export type { JsonSchema };
