// Plain-language wording for everything that can go wrong, shared by every frontend. Each
// message says what happened and the one next step; the bridge's own technical message is kept
// separately as `detail` for logs and bug reports.

import { NPC_MESSAGES } from "./errors080npc.ts";
import { DM_MESSAGES, DM_METHODS } from "./errors080dm.ts";

/** cause (0.8.1): for a superseded command, the code it stopped with. */
export type PlainError = { code: string; message: string; detail?: string; cause?: string };

/** The shared plain wording per refusal code (also published in docs/mcp-reference.md). */
export const BRIDGE_MESSAGES: Readonly<Record<string, string>> = {
  permission_denied: "The caller did not allow every capability this policy needs. Grant the required classes explicitly or choose a narrower policy; nothing was started.",
  actor_unavailable: "This supervisor supports V and the bridge's own XF actors (a1, a2, ...). Picked passers-by and spawned objects need their own validated actor adapter.",
  supervisor_unavailable: "Supervision needs an observed, living actor (V, with an available input listener, or an XF actor that has appeared) in unpaused gameplay. Read the game state before arming again.",
  supervisor_limit: "The supervisor already holds five entries (V plus four XF actors, or five actors). Clear one with supervisor_clear and its actor before arming another.",
  no_safe_position: "The supervisor has no recorded quiet position yet. Let V stand quietly for the configured interval before testing a return.",
  supervisor_busy: "The bounded supervisor action queue is full. Read its receipts and clear or replace the entry before trying again.",
  plan_unavailable: "The supervisor could not safely resolve its action targets. Read the action result and current actor state before replacing the entry.",
  precondition_failed: "The game state changed before this step could act. The detail contains the required and observed state; read catch-up and prepare the next action.",
  precondition_unavailable: "This route cannot compare conditions on the executing game frame. Use the autonomous test candidate's native action route.",
  duplicate_id: "That incident id is open already, or the bridge still remembers a closed incident under it. Close the open one (incidents_close) or declare this one under a new id.",
  incident_unknown: "No declared incident is open under that id (it may have closed already: incidents_list with id shows how). Declare it first with incidents_declare.",
  incident_limit: "A declared incident holds at most five actors, and at most four are open at once. Close one with incidents_close first.",
  tap_off: "The incident taps are off, and a declared incident needs them for the clock and for the sight samples. incidents_list with tap true switches them on.",
  npc_not_found: "That handle isn't one of the bridge's XF actors (npc_status lists them), and a declared incident names XF actors only, never V or a picked passer-by.",
  no_place: "None of those actors has a known place yet (one that is still appearing has none). Give at, or wait for npc.spawned and declare again.",
  recording_busy: "The recorder is still active or draining. Stop it and finish saving its records before starting another run.",
  recording_changed: "That recording is no longer current. Use the run identifier returned by its start; never join samples from different runs.",
  test_build_required: "This action needs the separate autonomous test candidate. Stage that candidate in the dedicated test profile.",
  test_run_required: "Arm a bounded test fixture before submitting this input.",
  stale_context: "The expected game screen or choices changed. Read the current state and prepare a fresh fixture.",
  choice_changed: "The dialogue offer changed before the requested line was confirmed. Read it again before choosing.",
  choice_unsupported: "This dialogue's input and eligibility rules have not been validated. Leave this choice to the player.",
  input_unavailable: "The native input adapter has not been commissioned for this game build. No input was sent.",
  input_busy: "An input test is already pending. Wait for its receipt before starting another.",
  input_overlap: "A real held control overlaps this test. Release it before preparing another pulse.",
  activation_expired: "The test activation expired. Check the current screen before arming a fresh fixture.",
  ui_target_unavailable: "Save anyway is not currently offered. Wait for a real save-lock offer in the open CET window.",
  ui_target_not_drawn: "The target button was not drawn and available. Open the CET window and let its layout settle.",
  bad_request: "The game bridge didn't understand the request. This is a bug in the tool that sent it.",
  bad_params: "Some of the values given aren't valid for this action.",
  test_hooks_off: "Test hooks are off in this build. Only the -writes package for the dedicated XF test profile has them ([bridge] allow_test_hooks in its config.ini).",
  not_in_this_package:
    "This package doesn't carry that test probe. Only the -writes package for the dedicated XF test profile has it (the companion probe's xfb_companion_probe.exe beside the plugin).",
  save_in_progress: "Another save is being made right now (game_save, or Save anyway in the XF Runtime Bridge window). Nothing was saved by this request; try again when it has finished.",
  companion_running: "A sleeping companion probe is already running. End it with test_companion_probe {mode: \"stop\"}, or quit the game, which ends it.",
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
    "This kind of change is switched off in the bridge's config.ini (allow_write_classes lists the kinds allowed: photo, world, character, inventory, save, showroom, player, act, npc, dm; inventory stays off until the maintainer allows it, and showroom, player, act, npc and dm are listed only by the XF test profile's build). Nothing was changed.",
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
  superseded:
    "An emergency control (bridge_kill or session_handover) came after this command and cancelled it: a command still waiting never ran, and a running one stopped at its next step. Check the game's state, then send it again if it is still wanted.",
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
  outfit_managed_elsewhere:
    "V's outfit is managed by a script mod's outfit system (such as EquipmentEx), which replaces the wardrobe's own requests, so this change would do nothing. Nothing was changed. wardrobe_equip with suspend: true takes that outfit off for now (the story's own request) so equipped clothing draws; resume: true puts it back.",
  bridge_effects_active: "Saving is refused while the bridge holds changes. Release the holders named in detail, then save again.",
  script_outfit_api_changed:
    "The installed Equipment-EX doesn't offer the outfit functions the bridge calls (a different version changed them), so the bridge won't drive its outfit; nothing was changed. wardrobe_equip with suspend: true still takes the outfit off (the story's own request); wardrobe_state names the version and what differs.",
  handed_over:
    "The session is handed over to the player (session_handover), so the bridge changes nothing until session_resume. Nothing was changed.",
  in_combat: "V is in combat, so the bridge won't move or act for her now. Nothing was changed. Try again once the fight is over.",
  in_vehicle: "V is in a vehicle, so the bridge won't move her or act for her now. Nothing was changed. Get out first.",
  in_scene: "A scene is playing (or V is in a dialogue), where the bridge doesn't move or act for V. Nothing was changed. Wait for the scene to end.",
  player_busy:
    "V is busy (jumping, sliding, falling or landing, swimming, in a workspot, a takedown or grapple, carrying a body, in a menu, or photo mode is open), so the bridge won't move her now. Nothing was changed. Try again once she stands still in normal play; player_state's busy_state says which.",
  user_took_over:
    "The player took over (their own movement, jump, crouch, sprint, dodge, mouse or stick), so the glide or look stopped and gave V back. Nothing more was changed. Start it again once the player has let go.",
  // 0.8 (the MCP documentation work): three codes that fell through to the unexplained message.
  quest_scene:
    "A story scene is playing, and the story may hold the weather itself, so the bridge didn't change it. Nothing was changed. Try again once the scene is over.",
  arms_drawn:
    "V has her arm cyberware out, and the game doesn't swap arm cyberware while it is drawn. Nothing was changed. Holster it first (player_action with weapon.holster), or leave holster_first on so the tools do it.",
  not_equippable:
    "The game says V can't equip that cyberware (a requirement isn't met or its slot doesn't take it), so nothing was changed and nothing was added. cyberware_state shows what the slot holds now.",
  metadata_pending:
    "The game hadn't sent that save's details yet, so nothing was loaded. Try again in a moment.",
  no_ground: "There is no walkable ground near that point, so V wasn't moved there. Pick a point on the floor (or pass ground: exact at your own risk).",
  not_streamed: "The world around that point isn't loaded yet, so V wasn't moved there (with ground: exact too). Move V closer first, then try again.",
  no_path: "The game found no walkable path to that point, so V didn't move. Pick a point on the same floor and within reach.",
  behaviour_limit: "Too many behaviours are running already (at most 4), so this one didn't start. Stop one with behave_stop first.",
  no_such_behaviour: "No behaviour with that id is running. behave_list shows the ones that are.",
  expectation_failed: "The pre-capture check failed, so no screenshot was taken. The answer lists which check failed and why; fix the framing or light and try again, or pass on_fail: warn to capture anyway.",
  unsupported: "This game doesn't offer a safe way to do that yet.",
  unavailable: "That part of the game isn't available right now.",
  no_district: "The game hasn't told its district system where V is yet. It does so when V crosses an area border, so a moment after a load, or once V moves, it will.",
  failed: "Something went wrong inside the game bridge. The plugin log has the details.",
  disconnected: "The connection to the game closed. Is the game still running?",
  client_timeout: "The game bridge didn't answer. The game may be frozen or loading; try again shortly.",
};

/**
 * 0.8 (session 8's D3: "V is busy" didn't say what she was doing): the state the bridge names in its own message
 * ("V can't be moved now (player_busy: locomotion:Jump)"), in plain words.
 */
export function busyState(detail: string | undefined): string | null {
  const match = detail?.match(/player_busy: ([A-Za-z_]+(?::[A-Za-z_]+)?)/);
  return match ? match[1]! : null;
}

const BUSY_WORDS: Record<string, string> = {
  falling: "falling",
  landing: "landing",
  swimming: "swimming",
  workspot: "in a workspot",
  takedown: "in a takedown or grapple",
  carrying_body: "carrying a body",
  dead: "dead",
  photo_mode: "in photo mode",
  menu: "in a menu",
  paused: "in the pause menu",
  character_menu: "in the appearance screen",
  loading: "loading",
  "locomotion:Jump": "jumping",
  "locomotion:DodgeAir": "dodging in the air",
  "locomotion:SlideFall": "sliding into a fall",
  "locomotion:Slide": "sliding",
  "locomotion:Dodge": "dodging",
  "locomotion:Sprint": "sprinting",
  "locomotion:Vault": "vaulting",
  "locomotion:Kereznikov": "in Kerenzikov time",
  "locomotion:Workspot": "in a workspot",
  "locomotion:CrouchSprint": "crouch-sprinting",
  "locomotion:CrouchDodge": "dodging from a crouch",
};

export function plainBridgeError(code: string | undefined, detail?: string, method?: string): PlainError {
  // 0.8: the npc.* methods have their own wording first (a code like too_far means something else for the showroom).
  // 0.8.12: the live-direction toolkit's methods have their own wording too (a code like limit or busy means something else there).
  const known = code && ((method?.startsWith("npc.") ? NPC_MESSAGES[code] : method && DM_METHODS.has(method) ? DM_MESSAGES[code] : undefined) ?? BRIDGE_MESSAGES[code]);
  const state = code === "player_busy" ? busyState(detail) : null;
  const holders = code === "bridge_effects_active" ? detail?.match(/(?:keep|prepared) \((.*)\);/)?.[1] : undefined;
  const release = holders && /NoMovement|ForceCrouch|behaviours running/.test(holders) ? "Use player_stop to release these holders" : "Release these holders";
  const action = method === "player.teleport" ? "Teleporting" : "Saving";
  const retry = method === "player.teleport" ? "try the teleport again" : "save again";
  const message = holders ? `${action} refused while the bridge holds: ${holders}. ${release}, then ${retry}.` : state
    ? `V is busy (${BUSY_WORDS[state] ?? state}; the game's state ${state}), so the bridge won't move her now. Nothing was changed. Try again once she stands still in normal play.`
    : known || "The game bridge reported a problem it didn't explain.";
  return {
    code: code ?? "failed",
    message,
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
