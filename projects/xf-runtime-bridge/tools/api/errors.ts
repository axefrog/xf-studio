// Plain-language wording for everything that can go wrong, shared by every frontend. Each
// message says what happened and the one next step; the bridge's own technical message is kept
// separately as `detail` for logs and bug reports.

export type PlainError = { code: string; message: string; detail?: string };

const BRIDGE_MESSAGES: Record<string, string> = {
  bad_request: "The game bridge didn't understand the request. This is a bug in the tool that sent it.",
  bad_params: "Some of the values given aren't valid for this action.",
  bad_version: "The game bridge speaks a different protocol version. Update XF Runtime Bridge and the XF tools together.",
  unauthorized: "The game bridge refused the connection key. Restart the game so the bridge writes a fresh session file.",
  killed:
    "The game bridge was switched off with its kill switch. In the game, open the Cyber Engine Tweaks overlay and press Reconnect in the XF Runtime Bridge window (test builds), or restart the game.",
  rate_limited:
    "The game bridge was sent too many requests in a short time, and it was still refusing after the tools waited a few seconds. Nothing was changed by the refused request. Wait a moment and try again.",
  game_loading:
    "The game is loading (or still starting), so the bridge doesn't call into it until the loaded session's player is in; nothing was called or changed. Wait with game_wait for phase gameplay, then try again.",
  unknown_method: "The running game bridge doesn't know this action. It may be an older build: stage the current XF Runtime Bridge build.",
  write_class_disabled:
    "This kind of change is switched off in the bridge's config.ini (allow_write_classes lists the kinds allowed: photo, world, character, inventory, save, showroom; inventory stays off until the maintainer allows it, and showroom is listed only by the XF test profile's build). Nothing was changed.",
  write_mismatch:
    "The game took a different value than the one asked for (its menu may have changed since photo_state was read), so the bridge put the earlier value back where it knew it. Read photo_state and try again.",
  writes_paused:
    "Changes are paused in the game's XF Runtime Bridge window (Cyber Engine Tweaks overlay). Nothing was changed. Resume them there to continue.",
  writes_disabled:
    "Changing the game is switched off in this setup. It is allowed only in the dedicated test profile, where the bridge's config.ini has allow_writes = true.",
  game_not_running: "The game hasn't finished starting. Wait for the main menu, then try again.",
  game_not_ready: "The game isn't ready for this yet. Load a save and wait until you can move, then try again.",
  timeout: "The game was too busy to answer in time, and nothing was changed. Try again in a moment.",
  timeout_after_start:
    "The game started this action but took too long to confirm it. It may still have happened: check the game (or the plugin log) before repeating it.",
  busy: "The game has too many requests waiting. Wait a moment and try again.",
  too_large: "The request was too large for the game bridge.",
  rtti_missing:
    "This game version doesn't have a function the bridge needs for this action, so nothing was changed. The game may have been updated: the bridge needs a rebuild for it.",
  rtti_signature:
    "A game function this action uses has changed shape in this game version, so the bridge refused to call it and nothing was changed. The bridge needs updating for this game version.",
  call_failed: "The game refused the call, and nothing is known to have changed.",
  script_calls_unavailable:
    "The bridge can't call into this game version (an engine address it needs is missing from RED4ext's address library), so it refuses every game action this session and nothing changed. Update RED4ext, or rebuild the bridge for this game version.",
  script_layer_missing:
    "The bridge's script part isn't loaded (redscript didn't compile it). Check that redscript is installed and look for a script error at game start.",
  not_in_photo_mode: "This only works in photo mode. Open it with photo_open (or ask the player to press the photo mode key), then try again.",
  photo_key_needed:
    "The game offers no way to open the full photo mode from inside. Use photo_open, which presses the photo mode key in the game window, or ask the player to press it; game_wait with phase photo_mode notices when it opens.",
  creator_leave_disabled:
    "Opening, confirming or backing out of the appearance screen is switched off in this bridge's config.ini (allow_creator_leave; only the XF test profile's build allows it). Ask the player to open it, or to press Confirm or Back.",
  not_safe_now:
    "The game isn't at a safe moment for the appearance screen (combat, a scene, a vehicle, or somewhere photo mode isn't allowed). Nothing was opened. Walk V somewhere quiet and try again.",
  save_lock_not_held:
    "The appearance screen wasn't opened because the game hasn't confirmed the bridge's save lock yet. Saving stays locked until a save is loaded. Try again in a moment.",
  creator_open_timeout:
    "The game was asked to open the appearance screen but didn't within the wait, so the request was withdrawn and the appearance screen won't open (the pause menu may open instead: close it with Esc). Saving stays locked until a save is loaded. Close any menu and try again, or ask the player to open it (a mirror, or F12 with Character Customization Anywhere).",
  creator_open_uncertain:
    "The game took the request to open the appearance screen but it hadn't opened by the end of the wait, so it may still open. Check game_status: if the phase is character_menu, use cc_back to close it. Saving stays locked until a save is loaded.",
  not_v:
    "The player isn't V right now (a Johnny section, or someone else the story puts in V's place), so the appearance screen wasn't opened. Try again once V is back.",
  live_pose_disabled:
    "Writing the live-pose carrier is switched off in this bridge's config.ini (allow_live_pose; only the XF test profile's -writes build allows it). Nothing was changed.",
  live_pose_unavailable:
    "The live-pose commands can't run on this game version (an engine address they need is missing from RED4ext's address library), so nothing was read or changed.",
  carrier_not_loaded:
    "The animation set isn't loaded. For the XF live carrier: install the XF Live Pose test package, open photo mode and select the carrier pose (photo_pose_set with record xfs_live_carrier), then try again.",
  clip_not_found: "The animation set is loaded but has no clip with that name. Check the name, or the test package's build.",
  carrier_not_selected:
    "The XF live carrier isn't the selected photo-mode pose, so nothing was written. Select it with photo_pose_set (record xfs_live_carrier), then try again.",
  layout_unrecognised:
    "The clip's keys aren't laid out the way the bridge expects on this game version, so it stopped without writing anything. Keep the answer (its detail lists every mismatch) and stop the live-pose steps.",
  not_in_gameplay: "This needs V in the world (or, for the clock, the appearance screen or photo mode): load a save and close any other menus first.",
  no_effect:
    "That would change nothing in the game, so it wasn't sent: V's photo-mode face animation runs on the stand-in (target puppet, the default), not on the head item. Leave target out.",
  unverified_index:
    "That face table index matches an expression only by its place in the list, which isn't reliable with an expression pack installed, so nothing was applied. Use an index photo_state found by name (table_index_verified), or pass force: true to apply it anyway.",
  face_table_unreadable:
    "Photo mode's expression records couldn't be read, so the bridge can't check which face table index an expression has; nothing was applied. Pass unlisted: true to apply the index anyway (photo_state with options shows face_table).",
  stale_match:
    "The appearance screen changed between reading the option and applying the value (another row is in use, or the value at that position has another name), so nothing was applied. Try again; it reads the option afresh.",
  not_in_character_menu:
    "Character options can only be changed while the appearance screen (a mirror, or the ripperdoc's appearance menu) is open. Open it in the game first.",
  bridge_save_lock:
    "The bridge has changed the game since the last load, so it keeps saving locked (a save now would keep those changes). Nothing was saved. Load a save first, or ask again with override_lock if the save should keep them.",
  saving_locked: "The game doesn't allow saving right now (combat, a scene, or another lock). Nothing was saved. Try again from a quiet moment in normal play.",
  no_free_slot: "The game has no free manual save slot. Nothing was saved. Delete an old manual save in the game's Load menu, then try again.",
  save_failed: "The game answered that the save failed. Nothing new was saved. Check free disk space and the game's save folder.",
  save_uncertain:
    "The game took the save request but didn't confirm it in time. Check the game's Load menu before saving again, so no duplicate save is made.",
  save_not_found: "No save has that name in the game's list, so nothing was loaded. The detail lists some of the names the game shows.",
  not_in_inventory: "V doesn't have that item. Nothing was changed. Ask again with add_if_missing to add one to V's inventory first.",
  not_added_by_bridge: "That item wasn't added by the bridge this session, so it stays in V's inventory. Nothing was removed.",
  codeware_missing:
    "The showroom spawns its heads and lights through Codeware, which the game hasn't loaded. Install Codeware 1.20 or newer from its official release page (the bridge never installs it), then restart the game. Nothing was spawned.",
  showroom_missing:
    "The game doesn't have the XF Finish Showroom build these heads come from. Stage that showroom build in the test profile (the coordinator does this), restart the game, then try again. Nothing was spawned.",
  not_in_world: "The showroom works while V is in the world or in photo mode. Close menus (or leave the appearance screen) and try again.",
  too_far: "That place is more than 30 m from V, so nothing was spawned there. Move V closer or spawn nearer (distance_m).",
  not_spawned_yet: "That head isn't in the world yet (the game spawns them over a few frames). Try again in a moment; showroom_state shows when it is in.",
  no_such_piece: "The showroom has no head with that index. showroom_state lists the heads it has.",
  spawn_refused: "The game's entity spawner refused the showroom entity, so nothing was spawned. The plugin log has the details.",
  not_ready: "The game can't spawn entities yet. Wait until V can move, then try again.",
  no_active_outfit:
    "V isn't wearing a wardrobe outfit, so what is equipped already shows. Nothing was changed. Use inventory_equip, or wardrobe_equip with set to put an outfit on first.",
  unsupported: "This game doesn't offer a safe way to do that yet.",
  unavailable: "That part of the game isn't available right now.",
  failed: "Something went wrong inside the game bridge. The plugin log has the details.",
  disconnected: "The connection to the game closed. Is the game still running?",
  client_timeout: "The game bridge didn't answer. The game may be frozen or loading; try again shortly.",
};

export function plainBridgeError(code: string | undefined, detail?: string): PlainError {
  const known = code && BRIDGE_MESSAGES[code];
  return {
    code: code ?? "failed",
    message: known || "The game bridge reported a problem it didn't explain.",
    ...(detail ? { detail } : {}),
  };
}

export const NO_BRIDGE: PlainError = {
  code: "no_bridge",
  message:
    "The game bridge isn't running. Start the game from the XF test profile (with XF Runtime Bridge enabled) and wait for the main menu; the bridge opens its connection when the game starts.",
};

export function connectError(kind: string, detail: string): PlainError {
  switch (kind) {
    case "not_found":
      return { code: "no_bridge", message: "The game bridge's connection is gone: the game has probably closed or crashed. Start it again from the XF test profile.", detail };
    case "busy":
      return { code: "bridge_busy", message: "Another XF tool is connected to the game bridge right now. Close it (or wait a few seconds) and try again.", detail };
    case "wrong_server":
      return {
        code: "wrong_server",
        message: "Something other than the game is answering on the bridge's connection, so the XF tools refused to talk to it. Restart the game.",
        detail,
      };
    case "access_denied":
      return { code: "access_denied", message: "Windows refused access to the game bridge. Run the XF tools as the same Windows user as the game.", detail };
    default:
      return { code: "connect_failed", message: "Couldn't connect to the game bridge. Restart the game and try again.", detail };
  }
}
