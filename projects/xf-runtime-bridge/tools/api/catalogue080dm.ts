// Bridge 0.8.12's live-direction toolkit (research/runtime/runtime-bridge-design.md §3.21; core/DmService.cpp): bring props,
// vehicles and lights into the world, change doors and vehicles, play sounds and a radio, send a message toast or a real
// incoming call from a contact the player has, put an XF quest in the HUD's tracker, show the game's own banners and quest toasts,
// and arm watchers that fire micro-actions inside the game without the agent. All of it is in the dm class (write-dm), listed
// only by the test profile's -writes build, never saved, and undone by each answer's undo, the kill switch, the pause, a handover
// and loading a save. catalogue.ts places these; only types come from there, so the two modules don't load each other.

import type { CommandDef } from "./catalogue.ts";
import { bool, int, num, obj, oneOf, str, type JsonSchema } from "./schema.ts";
import { point3 } from "./catalogue060.ts";

/** The dm.* events in the session's event stream (session_wait's kinds). */
export const DM_WAIT_KINDS = ["dm.watch", "dm.micro", "dm.phone", "dm.quest", "dm.world", "dm.audio", "dm.light", "dm.notify", "dm.released"] as const;
/** The notify styles (core/Dm080.hpp NotifyStyles()). */
export const DM_NOTIFY_STYLES = ["quest_new", "quest_update", "quest_done", "quest_failed", "onscreen", "warning", "subtitle"] as const;
/** The radio stations by name (core/Dm080.cpp RadioStations(); the game's own numbering, 0 to 13). */
export const DM_RADIO_STATIONS = [
  "aggro_industrial",
  "electro_industrial",
  "hip_hop",
  "aggro_techno",
  "downtempo",
  "attitude_rock",
  "pop",
  "latino",
  "metal",
  "minimal_techno",
  "jazz",
  "growl",
  "dark_star",
  "impulse_fm",
] as const;
export const DM_VEHICLE_DOORS = ["all", "seat_front_left", "seat_front_right", "seat_back_left", "seat_back_right", "trunk", "hood"] as const;
export const DM_LIGHT_PATTERNS = ["steady", "flicker", "pulse", "strobe", "broken", "candle"] as const;
export const DM_WATCH_KINDS = ["enter", "leave", "gaze", "weapon", "combat", "vehicle", "interact", "choice", "timer", "clock"] as const;

const ID = "^[A-Za-z0-9_.-]{1,48}$";
const ENTITY = "(?:dynamic|static): '[0-9]{1,20}'|EntityID\\([0-9]{1,20}\\)|[0-9]{1,20}|spawn:[1-9][0-9]{0,5}";
const targetOf = (words: string[]) => `^(${[...words, ENTITY].join("|")})$`;
const target = (description: string, words: string[]) => str(description, { pattern: targetOf(words), maxLength: 40 });
const handle = (description: string) => int(description, 1, 1000000);
const colour: JsonSchema = {
  anyOf: [
    str("A colour as #rrggbb.", { pattern: "^#[0-9A-Fa-f]{6}$" }),
    { type: "array", description: "A colour as [red, green, blue], each 0 to 255.", items: int("One colour channel, 0 to 255.", 0, 255), minItems: 3, maxItems: 3 },
  ],
  description: "A colour: #rrggbb or [red, green, blue] (0 to 255).",
};
/** An object schema with its description (the catalogue test wants every nested field described). */
const described = (description: string, schema: JsonSchema): JsonSchema => ({ ...schema, description });
const place = {
  at: point3("A world point [x, y, z] (within 60 m of V) instead of offset."),
  offset: described(
    "A place relative to V: forward, right and up in metres from her feet (default two metres ahead).",
    obj(
      {
        forward: num("Metres along V's facing (negative: behind her), -60 to 60. Default 2.", -60, 60),
        right: num("Metres to V's right (negative: left), -60 to 60. Default 0.", -60, 60),
        up: num("Metres up from her feet (negative: down), -20 to 20. Default 0.", -20, 20),
      },
      [],
    ),
  ),
  yaw: num("Its facing in degrees (the game's yaw: 0 faces north, 90 faces west).", -360, 360),
  face_v: bool("Face V."),
};
const pattern: JsonSchema = {
  anyOf: [
    oneOf("A named pattern: steady, flicker (the engine's own), pulse, strobe, broken (a failing tube) or candle.", [...DM_LIGHT_PATTERNS]),
    described(
      "A pattern with its settings.",
      obj({
        kind: oneOf("steady, flicker, pulse, strobe, broken or candle.", [...DM_LIGHT_PATTERNS]),
        period: num("Seconds for one cycle, 0.05 to 30.", 0.05, 30),
        low: num("The dimmest share of the intensity, 0 to 1.", 0, 1),
        strength: num("Flicker's strength, 0 to 1.", 0, 1),
        seed: int("Makes a broken or candle pattern repeatable, 0 to 1000000.", 0, 1000000),
      }),
    ),
  ],
  description: "How the light behaves over time: a name, or {kind, period, low, strength, seed}.",
};
const contact = str("The contact's id as the player's journal has it (phone_state {contacts: true} lists them).", { pattern: "^[A-Za-z0-9_.-]{1,64}$" });
const quest = str("The quest's id.", { pattern: ID });

/** Each dm command's own refusal codes (for the MCP reference): what core/DmService.cpp and the script layer raise, beyond the codes every command can answer. */
const WORLD = ["not_in_world", "not_v"];
const TARGET = ["target_unknown", "target_missing"];
export const DM_REFUSALS: Readonly<Record<string, readonly string[]>> = {
  "world.spawn": [...WORLD, "limit", "too_far", "codeware_missing", "not_ready", "record_missing", "template_missing", "spawn_refused", "script_layer_missing"],
  "world.despawn": ["target_unknown", "use_light_remove"],
  "world.spawned": [],
  "world.door": [...WORLD, ...TARGET, "not_a_door"],
  "vehicle.set": [...WORLD, ...TARGET, "not_a_vehicle"],
  "audio.play": [...WORLD, ...TARGET, "limit", "not_ready"],
  "audio.stop": ["not_found"],
  "audio.radio": [...WORLD, ...TARGET, "no_radio"],
  "audio.voice": [...WORLD, ...TARGET, "not_an_npc"],
  "phone.text": [...WORLD, "hud_missing"],
  "phone.call": [...WORLD, "busy", "contact_unknown", "phone_blocked", "not_ready"],
  "phone.end": [],
  "phone.state": [],
  "quest.set": [...WORLD, "too_many"],
  "quest.objective": [...WORLD, "not_found"],
  "quest.clear": ["not_found"],
  "quest.state": [],
  "notify.show": [...WORLD, "hud_missing", "codeware_missing"],
  "notify.hide": [],
  "light.spawn": [...WORLD, "limit", "too_far", "codeware_missing", "carrier_missing", "template_missing", "spawn_refused", "not_ready"],
  "light.set": [...WORLD, "target_unknown", "target_missing", "no_light_component"],
  "light.remove": ["target_unknown"],
  "watch.arm": [...WORLD, "too_many"],
  "watch.disarm": ["not_found"],
  "watch.list": [],
  "game.digest": ["not_in_world"],
};

const withRefusals = (command: CommandDef): CommandDef => Object.assign(command, { refusals: DM_REFUSALS[command.name] ?? [] });

const DEFINITIONS: CommandDef[] = [
  {
    name: "world.spawn",
    title: "Bring in a prop or a vehicle",
    description:
      "Brings a prop or a vehicle into the world near V: a prop from an entity template (the depot path of a .ent file) or a record, a vehicle from its record (such as Vehicle.v_standard2_archer_hella_player), placed offset metres from V along her facing (default two metres ahead) or at a world point within 60 m, snapped to the ground below unless ground is false, facing yaw, or V with face_v. It is never saved: world_despawn, the kill switch, a pause, a handover or loading a save removes it, and game_save refuses while one exists. At most 24 spawned things (props, vehicles and lights together). Answers its handle (use spawn:<n> as a target in other commands) and its entity id at once; the thing appears a moment later. Traffic classification at the final placement is INCONCLUSIVE; nearest pavement is unavailable and this is not safe placement proof. Needs Codeware and the -writes package's toolkit scripts.",
    permission: "write-dm",
    input: obj(
      {
        kind: oneOf("prop (the default) or vehicle.", ["prop", "vehicle"]),
        template: str("A prop's entity template: its depot path ending in .ent.", { maxLength: 200 }),
        record: str("A TweakDB record to spawn (a vehicle's, or a prop's), such as Vehicle.v_standard2_archer_hella_player.", { maxLength: 128 }),
        appearance: str("An appearance by name (default: the template's or record's own).", { maxLength: 64 }),
        ...place,
        label: str("A name for it in answers and events.", { minLength: 1, maxLength: 48 }),
        ground: bool("Snap to the ground below the place (default true); false puts it exactly where asked."),
      },
      [],
    ),
    undo: "The result's undo is world_despawn of its handle; the kill switch, a pause, a handover and loading a save remove everything the bridge spawned.",
    bridge: { method: "world.spawn" },
  },
  {
    name: "world.despawn",
    title: "Remove spawned props and vehicles",
    description:
      "Removes a prop or vehicle the bridge brought in (its handle, from world_spawn), or every one with all (lights are removed with light_remove). The answer's undo (or undo_all, one per thing) spawns each again where it stood, under a new handle.",
    permission: "write-dm",
    input: obj({ id: handle("The handle world_spawn answered."), all: bool("Remove every spawned prop and vehicle.") }),
    undo: "The result's undo spawns it again where it stood (a new handle); undo_all does so for each when several were removed.",
    bridge: { method: "world.despawn" },
  },
  {
    name: "world.spawned",
    title: "What the bridge brought in",
    description: "The props, vehicles and lights the bridge has brought in this session: each one's handle, entity id, kind, label and where it stands now, and the sounds it tracks. Changes nothing.",
    permission: "read",
    input: obj({}),
    bridge: { method: "world.spawned" },
  },
  {
    name: "world.door",
    title: "Open, close, lock or seal a door",
    description:
      "Opens, closes, locks, unlocks, seals or unseals the door V is looking at (target look_at), a door by its entity id, or one the bridge spawned: open true unlocks and unseals it first (as the game's own quest actions do), and an open door can't be locked or sealed in the same call. The first state each door had is remembered: the kill switch, a pause and a handover put every door back, and game_save refuses while one is changed.",
    permission: "write-dm",
    input: obj(
      {
        target: target("The door: look_at (what V looks at), spawn:<n> (something the bridge spawned) or an entity id such as EntityID(123).", ["look_at"]),
        open: bool("Open (true) or close (false) it."),
        locked: bool("Lock (true) or unlock (false) it."),
        sealed: bool("Seal (true) or unseal (false) it."),
      },
      ["target"],
    ),
    undo: "The result's undo puts the door back as it was; the kill switch, a pause and a handover put every changed door back.",
    bridge: { method: "world.door" },
  },
  {
    name: "vehicle.set",
    title: "Change a vehicle's lights, engine or doors",
    description:
      "Switches a vehicle's lights or engine, or opens, closes, locks or unlocks one of its doors (or all of them). The vehicle is mounted (the one V sits in), look_at (the one she looks at), a spawned one (spawn:<n>) or an entity id. The game offers no read of the headlights, so the lights' undo switches them the other way. The first engine and door states are remembered: the kill switch, a pause and a handover put them back.",
    permission: "write-dm",
    input: obj(
      {
        target: target("The vehicle: mounted, look_at, spawn:<n> or an entity id such as EntityID(123).", ["mounted", "look_at"]),
        lights: bool("Switch the lights on or off."),
        engine: bool("Switch the engine on or off."),
        door: oneOf("Which door: all, seat_front_left, seat_front_right, seat_back_left, seat_back_right, trunk or hood.", [...DM_VEHICLE_DOORS]),
        door_state: oneOf("What to do to it: open, closed, locked or unlocked. Needs door.", ["open", "closed", "locked", "unlocked"]),
      },
      ["target"],
    ),
    undo: "The result's undo puts back the engine and the doors it could read and switches the lights the other way; the kill switch, a pause and a handover put the vehicle back.",
    bridge: { method: "vehicle.set" },
  },
  {
    name: "audio.play",
    title: "Play a sound event",
    description:
      "Plays one of the game's sound events (by its event name, such as ui_phone_sms) on V (the default), in the world with no place (on global), on what V looks at, or on something the bridge spawned. loop keeps it playing until audio_stop (and the kill switch, a pause, a handover or a load stop it); other sounds are tracked for seconds (default 10). At most 16 tracked sounds. Answers the sound's id.",
    permission: "write-dm",
    input: obj(
      {
        event: str("The sound event's name: letters, digits and _.", { pattern: "^[A-Za-z0-9_]{1,96}$" }),
        on: target("Where it plays: v (the default), global, look_at, spawn:<n> or an entity id.", ["v", "global", "look_at"]),
        emitter: str("An emitter name on that entity (optional).", { pattern: "^[A-Za-z0-9_]{1,64}$" }),
        loop: bool("Keep it playing until audio_stop."),
        seconds: num("How long a one-shot is tracked, 0.5 to 3600. Default 10.", 0.5, 3600),
      },
      ["event"],
    ),
    undo: "The result's undo stops the sound; a sound already played can't be unheard.",
    bridge: { method: "audio.play" },
  },
  {
    name: "audio.stop",
    title: "Stop a sound",
    description: "Stops a sound the bridge started (its id from audio_play), or every one it tracks with all.",
    permission: "write-dm",
    input: obj({ id: handle("The id audio_play answered."), all: bool("Stop every tracked sound.") }),
    undo: "A sound can't be resumed; the answer's undo_list plays each again from the start.",
    bridge: { method: "audio.stop" },
  },
  {
    name: "audio.radio",
    title: "Set a vehicle's radio",
    description:
      "Turns a vehicle's radio on or off and tunes it to one of the game's fourteen stations (0 to 13, or by name: aggro_industrial, electro_industrial, hip_hop, aggro_techno, downtempo, attitude_rock, pop, latino, metal, minimal_techno, jazz, growl, dark_star, impulse_fm). Only a vehicle's radio takes an exact station; a radio device in the world only steps to its next station, which this does not drive. The first station and state are remembered and put back by the kill switch, a pause and a handover.",
    permission: "write-dm",
    input: obj(
      {
        target: target("The vehicle: mounted, look_at, spawn:<n> or an entity id.", ["mounted", "look_at"]),
        station: { anyOf: [int("A station number, 0 to 13.", 0, 13), oneOf("A station by name.", [...DM_RADIO_STATIONS])], description: "A station number 0 to 13 or its name." },
        on: bool("Turn the radio on (true) or off (false)."),
      },
      ["target"],
    ),
    undo: "The result's undo puts the earlier station and state back (the station only when the game's name for it matches one of the fourteen).",
    bridge: { method: "audio.radio" },
  },
  {
    name: "audio.voice",
    title: "Have an NPC say a line of its own voice",
    description:
      "Plays a line from an NPC's own voiceset by its context (such as greeting): the NPC V looks at (look_at), one the bridge spawned or an entity id. The game picks the line, the voice and the lip movement; a context the voice lacks plays nothing. Only someone with a voice of their own takes it.",
    permission: "write-dm",
    input: obj(
      {
        target: target("The NPC: look_at, spawn:<n> or an entity id.", ["look_at"]),
        context: str("The voiceset context: letters, digits and _.", { pattern: "^[A-Za-z0-9_]{1,96}$" }),
      },
      ["target", "context"],
    ),
    undo: "A spoken line can't be taken back.",
    bridge: { method: "audio.voice" },
  },
  {
    name: "phone.text",
    title: "Show a message toast",
    description:
      "Shows a message toast on the HUD's phone from a name, with the text in it (up to 500 characters; the toast shows for about seven seconds and carries the whole text). It is not a message in the phone's inbox and nothing is saved: the player can't open or answer it. The messages shown are listed by phone_state.",
    permission: "write-dm",
    input: obj({ contact: str("The sender's name as the toast shows it.", { minLength: 1, maxLength: 48 }), text: str("The message.", { minLength: 1, maxLength: 500 }) }, ["contact", "text"]),
    undo: "A toast can't be taken back; it fades by itself.",
    bridge: { method: "phone.text" },
  },
  {
    name: "phone.call",
    title: "Ring V with a call",
    description:
      "Rings V's phone with a real incoming call from a contact the player has (ids from phone_state {contacts: true}; the game's own ring, name and picture). When the player answers it, the bridge starts the call and shows the lines one after another as subtitles in the call's style, then ends the call; a rejected call, a missed one and a hang-up are events (dm.phone). mode audio (the default) shows the contact's picture; video asks for the holocall frame, which the game fills only with a camera feed it stages for its own calls. A caller the journal doesn't hold is refused: the phone's code would run on a missing contact. Refused while the phone is blocked (combat, a story scene). One call at a time.",
    permission: "write-dm",
    input: obj(
      {
        contact,
        lines: {
          type: "array",
          description: "What is said once the call is answered, 1 to 16 lines in order.",
          minItems: 1,
          maxItems: 16,
          items: described(
            "One line: its words, who says it and how long it shows.",
            obj(
              {
                text: str("The words, up to 300 characters.", { minLength: 1, maxLength: 300 }),
                speaker: str("The name shown (default the contact's id).", { minLength: 1, maxLength: 48 }),
                seconds: num("How long the line shows, 0.5 to 20 (default from its length).", 0.5, 20),
              },
              ["text"],
            ),
          ),
        },
        ring_s: num("How long it rings before it is missed, 3 to 120. Default 20.", 3, 120),
        mode: oneOf("audio (the default) or video.", ["audio", "video"]),
        rejectable: bool("Whether the player can reject it (default true)."),
      },
      ["contact", "lines"],
    ),
    undo: "The result's undo is phone_end, which ends the ring or the call; an unanswered call ends by itself.",
    bridge: { method: "phone.call" },
  },
  {
    name: "phone.end",
    title: "End the call",
    description: "Ends the call that is ringing or running (the ring stops, the lines go, the phone is free). Nothing happens when there is none.",
    permission: "write-dm",
    input: obj({}),
    undo: "A call can't be resumed; start another with phone_call.",
    bridge: { method: "phone.end" },
  },
  {
    name: "phone.state",
    title: "The call and the messages",
    description:
      "The call (ringing, answered, declined, missed, ended, cancelled, hung_up or failed, with the contact) and the messages shown. With contacts true, also the journal contacts the player has (their ids and names), and whether the phone can take a call now. Locked contacts are never listed. Changes nothing.",
    permission: "read",
    input: obj({ contacts: bool("Also list the player's journal contacts.") }),
    bridge: { method: "phone.state" },
  },
  {
    name: "quest.set",
    title: "Put an XF quest in the tracker",
    description:
      "Puts a quest of the bridge's own in the HUD's quest tracker (the area under the minimap): a title and up to 8 objectives, each active, done, failed or hidden, optionally with an area on the map (radius_m metres round a point) and complete_on_enter, which arms a watcher that marks the objective done when V walks in. It is not in the journal and not in a save: the tracker shows one quest at a time, the one set or changed last. notify new or update raises the game's own quest toast with the title. At most 4 quests at once. A save is not refused (nothing is kept), but a load, the kill switch, a pause and a handover take it down.",
    permission: "write-dm",
    input: obj(
      {
        id: quest,
        title: str("The quest's name as the tracker shows it.", { minLength: 1, maxLength: 80 }),
        text: str("A line about the quest, kept for quest_state (the tracker shows the title and the objectives).", { maxLength: 300 }),
        objectives: {
          type: "array",
          description: "Up to 8 objectives.",
          maxItems: 8,
          items: described(
            "One objective.",
            obj(
              {
                id: str("The objective's id.", { pattern: ID }),
                text: str("The objective as the tracker shows it.", { minLength: 1, maxLength: 120 }),
                state: oneOf("active (the default), done, failed or hidden.", ["active", "done", "failed", "hidden"]),
                optional: bool("Mark it optional."),
                area: described(
                  "A place on the map for the objective.",
                  obj(
                    {
                      at: point3("The world point [x, y, z]."),
                      radius_m: num("The radius in metres, 0.5 to 200. Default 5.", 0.5, 200),
                      complete_on_enter: bool("Mark the objective done when V enters the radius."),
                    },
                    ["at"],
                  ),
                ),
              },
              ["id", "text"],
            ),
          ),
        },
        show: bool("Show it in the tracker (default true)."),
        notify: oneOf("Raise the game's quest toast: new, update, or none (the default).", ["none", "new", "update"]),
      },
      ["id", "title"],
    ),
    undo: "The result's undo puts the earlier quest back (or clears a new one).",
    bridge: { method: "quest.set" },
  },
  {
    name: "quest.objective",
    title: "Change an XF quest's objective",
    description:
      "Sets one objective of an XF quest to active, done, failed or hidden and/or changes its words, and redraws the tracker (a finished objective is drawn once with its tick or cross). notify (default true) raises the game's quest toast: update for a change, done when the last non-optional objective is done, failed for a failed one. The answer says whether the whole quest is complete.",
    permission: "write-dm",
    input: obj(
      {
        quest,
        objective: str("The objective's id.", { pattern: ID }),
        state: oneOf("active, done, failed or hidden.", ["active", "done", "failed", "hidden"]),
        text: str("New words for the objective.", { minLength: 1, maxLength: 120 }),
        notify: bool("Raise the quest toast (default true)."),
      },
      ["quest", "objective"],
    ),
    undo: "The result's undo puts the objective's earlier state and words back.",
    bridge: { method: "quest.objective" },
  },
  {
    name: "quest.clear",
    title: "Remove an XF quest",
    description: "Removes an XF quest from the tracker (its id), or every one with all. The answer's undo sets a removed quest again.",
    permission: "write-dm",
    input: obj({ id: quest, all: bool("Remove every XF quest.") }),
    undo: "The result's undo sets the quest again (undo_list for several).",
    bridge: { method: "quest.clear" },
  },
  {
    name: "quest.state",
    title: "The XF quests",
    description: "The XF quests the bridge holds and each objective's state. Changes nothing.",
    permission: "read",
    input: obj({}),
    bridge: { method: "quest.state" },
  },
  {
    name: "notify.show",
    title: "Show a message the game's way",
    description:
      "Shows words on one of the game's own message surfaces: warning (the banner at the top), onscreen (the game's cinematic on-screen message, at its HUD-defined position), quest_new, quest_update, quest_done or quest_failed (the quest toasts; text is the line they show, title replaces the heading), or subtitle (a line in the dialogue subtitle area with speaker's name, shown for seconds). Plain text; nothing is saved. Banners and toasts need the HUD up (a menu or a loading screen refuses hud_missing).",
    permission: "write-dm",
    input: obj(
      {
        style: oneOf("warning, onscreen, quest_new, quest_update, quest_done, quest_failed or subtitle.", [...DM_NOTIFY_STYLES]),
        text: str("The words, up to 300 characters.", { minLength: 1, maxLength: 300 }),
        title: str("A heading for a quest toast (default the game's own).", { maxLength: 80 }),
        speaker: str("The name a subtitle shows (required for a subtitle).", { minLength: 1, maxLength: 48 }),
        seconds: num("How long it shows, 0.5 to 30. Default 5 (4 for a subtitle).", 0.5, 30),
      },
      ["style", "text"],
    ),
    undo: "The result's undo takes a banner, an on-screen message or the subtitle lines down; a quest toast fades by itself.",
    bridge: { method: "notify.show" },
  },
  {
    name: "notify.hide",
    title: "Take messages down",
    description: "Takes down the banner, the on-screen message and the bridge's subtitle lines (or only those of the given style).",
    permission: "write-dm",
    input: obj({ style: oneOf("Only this style: warning, onscreen or subtitle (default all).", ["warning", "onscreen", "subtitle", "quest_new", "quest_update", "quest_done", "quest_failed"]) }),
    undo: "Show it again with notify_show.",
    bridge: { method: "notify.hide" },
  },
  {
    name: "light.spawn",
    title: "Bring in a light",
    description:
      "Brings in a light: an entity whose template holds a light component, set to the colour, intensity (in the component's own units), radius and, for a spot, the cone (inner and outer, full angles in degrees), placed like a prop. With no template it uses the XF light carrier, which is not built yet (carrier_missing); name a template that holds a light component (for example a lamp's), or bring a lamp in with world_spawn and steer it with light_set. pattern sets the engine's flicker or one the tick drives (pulse, strobe, broken, candle; at most 4 at once). Never saved; counts among the 24 spawned things, at most 8 lights.",
    permission: "write-dm",
    input: obj(
      {
        template: str("An entity template with a light component: its depot path ending in .ent.", { maxLength: 200 }),
        ...place,
        colour,
        intensity: num("The component's intensity, 0 to 100000. Default 100.", 0, 100000),
        radius: num("The reach in metres, 0.1 to 50. Default 8.", 0.1, 50),
        inner: num("A spot's inner cone angle, 1 to 179.", 1, 179),
        outer: num("A spot's outer cone angle, 1 to 179 (at least inner).", 1, 179),
        pattern,
        label: str("A name for it in answers and events.", { minLength: 1, maxLength: 48 }),
      },
      [],
    ),
    undo: "The result's undo is light_remove of its handle; the kill switch, a pause, a handover and loading a save remove every light.",
    bridge: { method: "light.spawn" },
  },
  {
    name: "light.set",
    title: "Change a light",
    description:
      "Changes the colour, intensity, radius, cone, on/off state or pattern of a light (the handle from light_spawn or world_spawn: any thing the bridge spawned whose entity holds a light component takes it). fade_s fades the change in (0 to 10 s). The answer carries the earlier values and an undo that puts them and the earlier pattern back.",
    permission: "write-dm",
    input: obj(
      {
        id: handle("The handle (spawn:<n>'s n)."),
        colour,
        intensity: num("The component's intensity, 0 to 100000.", 0, 100000),
        radius: num("The reach in metres, 0.1 to 50.", 0.1, 50),
        inner: num("The inner cone angle, 1 to 179 (with outer).", 1, 179),
        outer: num("The outer cone angle, 1 to 179 (with inner).", 1, 179),
        on: bool("Switch it on or off."),
        pattern,
        fade_s: num("Fade the change in over this many seconds, 0 to 10.", 0, 10),
      },
      ["id"],
    ),
    undo: "The result's undo puts the earlier values and pattern back.",
    bridge: { method: "light.set" },
  },
  {
    name: "light.remove",
    title: "Remove a light",
    description: "Removes a light (its handle), or every light with all. The answer's undo brings a removed light back (a new handle; its pattern is not restored).",
    permission: "write-dm",
    input: obj({ id: handle("The handle light_spawn answered."), all: bool("Remove every light.") }),
    undo: "The result's undo brings the light back under a new handle.",
    bridge: { method: "light.remove" },
  },
  {
    name: "watch.arm",
    title: "Arm an in-game watcher",
    description:
      "Arms a watcher that runs inside the game and, when its condition holds, logs an event (dm.watch) and runs up to 8 micro-actions (bridge commands, each with its own delay_s) without the agent: enter or leave (V inside or outside radius_m of a point or an entity), gaze (V looks at an entity for seconds, by a cone or by the game's look-at), weapon, combat or vehicle (the edge on or off), interact (V uses something; caption part, target), choice (V picks a dialogue choice; caption part, index), timer (seconds after arming) or clock (the game's time of day passes a mark). repeat keeps it armed with a cooldown; it ends at expires_s (default 600, at most 3600), when it fires (unless repeat), by watch_disarm, the kill switch, a pause, a handover and a load. At most 16 at once. A micro-action goes through the bridge's own gates like any request; saving, loading, the kill switch, handing over and the creator's buttons are never allowed, and a watcher armed by an action carries no actions of its own. The pick of a dialogue choice is inferred from the game's choice list going away [unverified].",
    permission: "write-dm",
    input: obj(
      {
        id: str("A short id (default w1, w2, ...); an armed id is replaced.", { pattern: ID }),
        kind: oneOf("What it watches.", [...DM_WATCH_KINDS]),
        at: point3("A world point (enter, leave)."),
        target: target("An entity (spawn:<n> or an entity id) for enter, leave, gaze and interact; any for interact.", ["any"]),
        radius_m: num("Enter and leave: the radius, 0.5 to 500. Default 5.", 0.5, 500),
        seconds: num("Gaze: the dwell; timer: the delay (0.1 to 3600).", 0, 3600),
        cone_deg: num("Gaze: the half-angle of the cone, 1 to 60. Default 12.", 1, 60),
        max_m: num("Gaze: the farthest distance, 1 to 300. Default 30.", 1, 300),
        look_at: bool("Gaze: use the game's look-at instead of the cone."),
        edge: oneOf("Weapon, combat, vehicle: on (the default) or off.", ["on", "off"]),
        now: bool("Fire at once when it already holds on the first sample (default true except for leave)."),
        caption: str("Interact and choice: part of the caption (case does not matter).", { maxLength: 64 }),
        index: int("Choice: the index of the choice, 0 to 9.", 0, 9),
        clock: str("Clock: the time of day as HH:MM.", { pattern: "^[0-2][0-9]:[0-5][0-9]$" }),
        expires_s: num("Seconds until it ends, 1 to 3600. Default 600.", 1, 3600),
        repeat: bool("Keep it armed after it fires."),
        cooldown_s: num("The least seconds between two firings, 0 to 600. Default 2.", 0, 600),
        hz: num("How often it is sampled, 1 to 30 a second.", 1, 30),
        actions: {
          type: "array",
          description: "Up to 8 micro-actions, run in order when it fires.",
          maxItems: 8,
          items: described(
            "One micro-action: a bridge command, its parameters and a delay.",
            obj(
              {
                method: str("A bridge method such as notify.show or audio.play.", { pattern: "^[a-z]+(\\.[a-z]+)+$", maxLength: 64 }),
                params: { description: "Its parameters, an object (under 4 KiB)." },
                delay_s: num("Wait this long first, 0 to 30.", 0, 30),
              },
              ["method"],
            ),
          ),
        },
      },
      ["kind"],
    ),
    undo: "The result's undo is watch_disarm; a watcher also ends when it fires (unless repeat), expires, by the kill switch and when a save loads.",
    bridge: { method: "watch.arm" },
  },
  {
    name: "watch.disarm",
    title: "Disarm watchers",
    description: "Disarms a watcher (its id) or every one with all, and drops the micro-actions of it still waiting.",
    permission: "write-dm",
    input: obj({ id: str("The watcher's id.", { pattern: ID }), all: bool("Disarm every watcher.") }),
    undo: "Arm it again with watch_arm.",
    bridge: { method: "watch.disarm" },
  },
  {
    name: "watch.list",
    title: "The armed watchers",
    description: "The watchers armed now: each one's condition, time left, how many times it fired and its actions. Changes nothing.",
    permission: "read",
    input: obj({}),
    bridge: { method: "watch.list" },
  },
  {
    name: "game.digest",
    title: "One compact read of the game",
    description:
      "One compact read for an agent: V (place, facing, whether she is busy, health, the vehicle she is in, what she looks at), the world (the clock, and with sky the rain and the weather), the police heat, what the bridge has placed and changed, the watchers armed, the XF quests, the phone call, and the most recent events that happened without the agent's own command (watchers fired, micro-actions run, the player's side of the phone, quests moved by an area, releases, answers, comments, notes, a kill or a handover; events from the last kinds you ask for). Changes nothing.",
    permission: "read",
    input: obj({
      events: int("How many recent events, 0 to 32. Default 8.", 0, 32),
      kinds: { type: "array", description: "Which event kinds (default the ones above).", maxItems: 16, items: str("An event kind such as dm.watch.", { pattern: "^[a-z.]{1,32}$" }) },
      sky: bool("Include the rain and the weather (default true)."),
    }),
    bridge: { method: "game.digest" },
  },
];

export const COMMANDS_080_DM: CommandDef[] = DEFINITIONS.map(withRefusals);
