// Plain-language wording for the live-direction toolkit's refusals (bridge 0.8.12). errors.ts uses these for the toolkit's own
// methods first, so a code the showroom or the NPC layer also uses (too_far, limit, not_in_world) reads right for them. Each says
// what happened and the one next step; the bridge's own message stays in `detail`.

/** The toolkit's methods (the catalogue's names), for errors.ts. */
export const DM_METHODS: ReadonlySet<string> = new Set([
  "world.spawn",
  "world.despawn",
  "world.spawned",
  "world.door",
  "vehicle.set",
  "audio.play",
  "audio.stop",
  "audio.radio",
  "audio.voice",
  "phone.text",
  "phone.call",
  "phone.end",
  "phone.state",
  "quest.set",
  "quest.objective",
  "quest.clear",
  "quest.state",
  "notify.show",
  "notify.hide",
  "light.spawn",
  "light.set",
  "light.remove",
  "watch.arm",
  "watch.disarm",
  "watch.list",
  "game.digest",
]);

export const DM_MESSAGES: Record<string, string> = {
  not_in_world: "The toolkit works in normal play only (not in menus, photo mode, the character creator or a loading screen). Nothing was changed.",
  not_v: "The player isn't V right now, so the bridge leaves the world alone. Nothing was changed.",
  limit: "The bridge already holds as many of these as it allows (24 spawned things in all, 8 of them lights, 16 sounds). Remove some with world_despawn, light_remove or audio_stop first.",
  too_far: "That place is more than 60 m from V. Pick a place nearer her. Nothing was spawned.",
  too_many: "The bridge already holds as many of these as it allows (16 watchers, 4 quests, 4 lights running a pattern). Remove one first.",
  codeware_missing:
    "Bringing props, vehicles and lights in, and showing subtitle lines, need Codeware, which the game hasn't loaded. Install Codeware 1.20 or newer from its official release page (the bridge never installs it), then restart the game. Nothing was changed.",
  not_ready: "The game can't do that yet (its spawner, phone or audio isn't up). Try again in a moment.",
  record_missing: "The game's database has no such record. Check the spelling (a vehicle's record looks like Vehicle.v_standard2_archer_hella_player). Nothing was spawned.",
  template_missing: "The game has no entity template at that path (a typo, or its archive isn't loaded). Nothing was spawned.",
  spawn_refused: "The game's spawner refused it. Try another place or another template. Nothing was spawned.",
  target_unknown: "The bridge has no spawned thing with that handle in this session (world_spawned lists them; loading a save forgets them all).",
  target_missing: "That target isn't there now: V isn't looking at anything, isn't in a vehicle, or the entity streamed out or was removed. Nothing was changed.",
  use_light_remove: "That handle is a light; light_remove takes it away.",
  not_a_door: "That isn't a door the bridge can drive. Look straight at a door, or name one by its entity id.",
  not_a_vehicle: "That isn't a vehicle. Get V into one (target mounted), look at one, or name one by its entity id.",
  no_radio: "That has no radio the bridge can tune to an exact station: only a vehicle's does (a radio device in the world only steps to its next station).",
  not_an_npc: "That isn't someone with a voice of their own, so there is no voiceset to play. Look at a person, or name one by its entity id.",
  not_found: "No such sound, watcher or XF quest is held (the matching state command lists them; the kill switch, a pause, a handover and a load clear them).",
  contact_unknown:
    "The player's phone has no contact with that id (phone_state with contacts true lists them). A caller the journal doesn't hold would run the phone's code on a missing contact, so it is refused. Nothing rang.",
  phone_blocked: "The phone can't take a call now (V is in combat or a story scene, or a status effect or device has it). Try again when it is free. Nothing rang.",
  busy: "A call is already ringing or running. End it with phone_end first.",
  hud_missing: "The HUD part this needs isn't up (a menu, photo mode or a loading screen). Try again in normal play; a quest in the tracker is drawn again when the HUD returns.",
  carrier_missing:
    "A light needs an entity that holds a light component. The XF light carrier (an empty entity the toolkit adds one to) isn't built in this build: name a template that holds one with template, or bring a lamp in with world_spawn and steer it with light_set. Nothing was spawned.",
  no_light_component: "That entity holds no light component, so there is nothing to set. Use a template or a lamp that has one.",
  script_layer_missing:
    "The toolkit's scripts aren't in this build. Only the -writes package carries them (Scripts/XFRuntimeBridgeDm.reds); stage it and restart the game. Nothing was changed.",
};
