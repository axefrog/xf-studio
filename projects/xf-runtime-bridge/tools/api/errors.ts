// Plain-language wording for everything that can go wrong, shared by every frontend. Each
// message says what happened and the one next step; the bridge's own technical message is kept
// separately as `detail` for logs and bug reports.

export type PlainError = { code: string; message: string; detail?: string };

const BRIDGE_MESSAGES: Record<string, string> = {
  bad_request: "The game bridge didn't understand the request. This is a bug in the tool that sent it.",
  bad_params: "Some of the values given aren't valid for this action.",
  bad_version: "The game bridge speaks a different protocol version. Update XF Runtime Bridge and the XF tools together.",
  unauthorized: "The game bridge refused the connection key. Restart the game so the bridge writes a fresh session file.",
  killed: "The game bridge was switched off with its kill switch. Restart the game to use it again.",
  rate_limited: "Too many requests in a short time. Wait a second and try again.",
  unknown_method: "The running game bridge doesn't know this action. It may be an older build: stage the current XF Runtime Bridge build.",
  write_class_disabled:
    "This kind of change is switched off in the bridge's config.ini (allow_write_classes lists the kinds allowed: photo, world, character). Nothing was changed.",
  write_mismatch:
    "The game took a different value than the one asked for (its menu may have changed since photo_state was read), so the bridge put the earlier value back where it knew it. Read photo_state and try again.",
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
  script_layer_missing:
    "The bridge's script part isn't loaded (redscript didn't compile it). Check that redscript is installed and look for a script error at game start.",
  not_in_photo_mode: "This only works in photo mode. Open photo mode first (photo_enter), then try again.",
  not_in_gameplay: "This needs V in the world: load a save and close any menus first.",
  not_in_character_menu:
    "Character options can only be changed while the appearance screen (a mirror, or the ripperdoc's appearance menu) is open. Open it in the game first.",
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
