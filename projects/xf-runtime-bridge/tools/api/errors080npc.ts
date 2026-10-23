// Plain-language wording for the npc.* refusals (bridge 0.8). errors.ts uses these for npc methods first, so a code the
// showroom also uses (too_far, codeware_missing) reads right for NPCs. Each says what happened and the one next step; the
// bridge's own message stays in `detail`.

export const NPC_MESSAGES: Record<string, string> = {
  codeware_missing:
    "Directing NPCs needs Codeware, which the game hasn't loaded. Install Codeware 1.20 or newer from its official release page (the bridge never installs it), then restart the game. Nothing was changed.",
  record_missing:
    "The XF actors aren't in the game's database: stage the bridge's -writes package (it carries their TweakXL file) with TweakXL installed, then restart the game. Nothing was spawned.",
  cast_unknown: "That isn't one of the XF actors. npc_spawn's cast lists them.",
  too_far: "That's too far from V (NPCs are directed within 30 m of her, and dialogue choices show within 4 m). Move V closer or pick a nearer place. Nothing was changed.",
  not_walkable: "There's no walkable ground there (or no path to it). Pick a spot on open pavement. Nothing was changed.",
  not_streamed: "The world around that place isn't loaded right now. Pick a spot nearer V. Nothing was changed.",
  not_ready: "The game can't spawn NPCs yet. Try again in a moment.",
  spawn_refused: "The game refused to spawn the actor. Try another spot or cast.",
  limit: "The bridge already has as many NPCs out as it allows (3 actors, 4 picked NPCs). Release one with npc_release first.",
  not_in_world: "NPCs are directed in normal play only (not in menus, photo mode or the character creator). Nothing was changed.",
  in_combat: "V is in combat, so the bridge leaves NPCs alone. Try again when the fight is over.",
  in_vehicle: "V is in a vehicle, so the bridge leaves NPCs alone. Get out first.",
  in_scene: "V is in a story scene or a conversation, so the bridge leaves NPCs alone. Try again when it's over.",
  not_v: "The player isn't V right now, so the bridge leaves NPCs alone.",
  npc_protected:
    "That NPC belongs to the game's story or services (a quest character, companion, vendor, police officer, child, boss, or someone in a scene), so the bridge leaves it alone. Pick an ordinary passer-by from npc_list, or bring in an XF actor.",
  npc_busy: "That NPC is busy (sitting, leaning or fighting), so the bridge leaves it alone. Pick another one.",
  npc_not_found: "That NPC isn't near V any more. Run npc_list again.",
  npc_unknown: "No NPC has that handle in this session (loading a save forgets them all). npc_status lists the current ones.",
  npc_lost: "That NPC isn't in the world any more (it streamed out or the game removed it).",
  npc_not_spawned: "That actor hasn't appeared yet. Wait for its npc.spawned event and try again.",
  not_ours: "That NPC was picked, not brought in by the bridge: it can be made to look, change its face and speak, but not moved or given gestures.",
  npc_moving: "That actor is walking. Stop it (npc_stop) or wait for npc.arrived before a gesture.",
  npc_releasing: "That actor is walking away to be released.",
  no_ai: "That NPC has no AI that takes commands.",
  line_too_long: "A line is at most 200 characters. Split it into two lines.",
  trigger_unknown: "That isn't one of the allowed voice lines. npc_say's trigger lists them.",
  expression_unknown: "That isn't one of the expressions. npc_face lists them.",
  gesture_unknown: "That isn't one of the gestures. npc_act lists them.",
  rig_unsupported: "That actor's body has no gesture clips in the XF gesture carrier.",
  carrier_missing:
    "Body gestures need the XF gesture carrier, which isn't in this build. Faces, looks, lines and choices still work; the carrier comes with a -writes package built with it.",
  choices_busy: "The game shows its own dialogue choices or an interaction prompt right now. Step away from doors, devices and other NPCs' prompts and try again.",
  one_hub_at_a_time: "Dialogue choices are showing already. Wait for the player's pick (npc.choice) or withdraw them first.",
  choice_too_long: "A choice is at most 90 characters. Shorten it.",
  no_hidden_spot:
    "The bridge found no walkable spot out of V's sight in that range. Turn V towards a wall or more open ground, widen min_m and max_m, or give a place with ahead_m or at_point. Nothing was spawned.",
  npc_handed_back: "That actor was handed back to its own AI when the fight began, so the bridge no longer directs it. Release it with npc_release (despawn, or dissolve once V can't see it).",
  npc_dead: "That actor is dead; its body stays until it is released. Release it with npc_release (despawn, or dissolve once V can't see it).",
  scenario_invalid: "The scene file isn't valid, so nothing ran. The message names each problem; fix the file and run it again (dry_run checks it without touching the game).",
};
