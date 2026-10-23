// Bridge 0.8 (bridge-080a: session 8's findings): the tools' side of the fixes that change what existing commands answer,
// applied to the catalogue by name (catalogue.ts calls applyCatalogue080 once), so the entries keep their place:
//   * wardrobe.state and wardrobe.equip: under Equipment-EX each area says what the outfit really shows (session 8's H2: the
//     helmet showed while the Head area read hidden);
//   * cyberware.equip and cyberware.unequip: holster the arm cyberware first when the game has it drawn (session 8's E4:
//     after photo mode the weapon slot still held the Gorilla Arms and every change was refused until a holster);
//   * refusals: each command's own refusal codes, for the MCP reference (the codes every command can answer, such as
//     no_bridge, killed or a closed write gate, are listed once there, not here).
// Only types come from catalogue.ts, so the two modules don't load each other.

import type { CommandContext, CommandDef, CommandResult } from "./catalogue.ts";
import { bool, type JsonSchema } from "./schema.ts";
import { NPC_REFUSALS } from "./catalogue080npc.ts";

type Json = Record<string, any>;

// --- wardrobe: Equipment-EX's outfit parts, area by area ------------------------------------------------------------------

/**
 * Which of the game's clothing areas each Equipment-EX outfit slot draws over: its "related" base attachment slots (Head,
 * Eyes, Chest, Torso, Legs, Feet) read as the equipment areas they belong to [source] Equipment-EX 3208ff4
 * scripts/OutfitConfig.reds (BaseSlots, OutfitSlots). Accessory slots (ears, neck, hands, wrists, fingers, toes, back,
 * waist) cover no clothing area and are left out.
 */
export const OUTFIT_SLOT_AREAS: Readonly<Record<string, readonly string[]>> = {
  Head: ["Head"],
  Balaclava: ["Head"],
  Mask: ["Face"],
  Glasses: ["Face"],
  Eyes: ["Face"],
  EyeLeft: ["Face"],
  EyeRight: ["Face"],
  Wreath: ["Face"],
  TorsoUnder: ["InnerChest"],
  TorsoInner: ["InnerChest"],
  TorsoMiddle: ["OuterChest"],
  TorsoOuter: ["OuterChest"],
  TorsoAux: ["OuterChest"],
  LegsInner: ["Legs"],
  LegsMiddle: ["Legs"],
  LegsOuter: ["Legs"],
  Feet: ["Feet"],
  BodyUnder: ["InnerChest", "Legs"],
  BodyInner: ["InnerChest", "Legs"],
  BodyMiddle: ["OuterChest", "Legs"],
  BodyOuter: ["OuterChest", "Legs"],
};

/**
 * A wardrobe state as V looks (session 8's H2): while a script mod's outfit (Equipment-EX) is on, the game's own areas all
 * read hidden, because that outfit hides them and draws its own parts instead. Each area its parts cover then shows
 * "script_outfit" with those parts' items and hidden false; the game's own flag stays as vanilla_hidden. Anything else is
 * answered unchanged.
 */
export function reconcileWardrobe(state: unknown): unknown {
  const s = state as Json | null;
  const outfit = s?.script_outfit as Json | undefined;
  if (!s || s.manager !== "script" || !outfit || outfit.active !== true || !Array.isArray(s.areas) || !Array.isArray(outfit.parts)) return state;
  const byArea = new Map<string, Json[]>();
  for (const part of outfit.parts as Json[]) {
    const slot = String(part?.slot ?? "").replace(/^OutfitSlots\./, "");
    for (const area of OUTFIT_SLOT_AREAS[slot] ?? []) byArea.set(area, [...(byArea.get(area) ?? []), part]);
  }
  const shownBy = typeof outfit.name === "string" ? outfit.name : "the script outfit";
  const areas = (s.areas as Json[]).map((area) => {
    const parts = byArea.get(String(area.area)) ?? [];
    if (!parts.length) return { ...area, vanilla_hidden: area.hidden, shown_by: shownBy };
    return { ...area, shows: "script_outfit", hidden: false, vanilla_hidden: area.hidden, shown_by: shownBy, outfit_items: parts.map((p) => String(p.item)) };
  });
  return { ...s, areas };
}

/** wardrobe.equip answers carry the state after the change (and sometimes before it): both as V looks. */
export function reconcileWardrobeAnswer(answer: unknown): unknown {
  const a = answer as Json | null;
  if (!a || typeof a !== "object") return answer;
  return { ...a, ...(a.state ? { state: reconcileWardrobe(a.state) } : {}), ...(a.before && Array.isArray(a.before.areas) ? { before: reconcileWardrobe(a.before) } : {}) };
}

// --- cyberware: holster first ---------------------------------------------------------------------------------------------

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });

const refused = (error: { code: string; message: string; detail?: string }) => Object.assign(new Error(error.message), { plain: error });

/**
 * cyberware.equip and cyberware.unequip (0.8): the bridge's own change, and when it is refused arms_drawn (the game has the
 * arm cyberware out: its weapon slot holds it) and holster_first isn't false, the game's own holster request
 * (player.action weapon.holster), a wait of up to 3 s until cyberware.state reads the arms holstered, and the change once
 * more. The answer says holstered_first. The holster needs the player class; without it the first refusal stands.
 */
export async function runCyberwareChange(method: "cyberware.equip" | "cyberware.unequip", input: Json, context: CommandContext): Promise<CommandResult> {
  const { holster_first: holsterFirst, ...params } = input;
  let response = await context.api.callBridge(method, params, context.cid, 12000, context.signal);
  let holstered = false;
  if (!response.ok && response.error.code === "arms_drawn" && holsterFirst !== false) {
    const holster = await context.api.callBridge("player.action", { name: "weapon.holster" }, context.cid, undefined, context.signal);
    if (!holster.ok) {
      throw refused({ ...response.error, detail: `${response.error.detail ?? ""} The holster first was refused too: ${holster.error.code} (${holster.error.message}).`.trim() });
    }
    holstered = true;
    for (let i = 0; i < 15 && !context.signal?.aborted; i++) {
      await sleep(200, context.signal);
      const state = await context.api.callBridge("cyberware.state", { areas: ["ArmsCW"] }, context.cid, undefined, context.signal);
      if (state.ok && (state.result as Json)?.arms?.drawn === false) break;
    }
    response = await context.api.callBridge(method, params, context.cid, 12000, context.signal);
  }
  if (!response.ok) throw refused(response.error);
  const value = response.result as Json;
  return {
    value: holstered
      ? { ...value, holstered_first: true, holster_note: "The game had V's arm cyberware out (after photo mode it stays in the weapon slot), so the tools holstered it first with the game's own request." }
      : value,
  };
}

export const HOLSTER_FIRST: JsonSchema = bool("When V has her arm cyberware out, holster it first with the game's own request and then make the change (default true); false refuses arms_drawn instead.");

// --- refusal codes per command (the MCP reference) ------------------------------------------------------------------------

/** Refusals of every player move or action: V's state (design §4.1). */
const PLAYER = ["not_in_gameplay", "not_v", "in_combat", "in_vehicle", "in_scene", "player_busy"];
/** Refusals of every photo-mode write. */
const PHOTO = ["not_in_photo_mode", "unavailable", "write_mismatch", "timeout"];
/** Refusals of every clothing and cyberware change. */
const INVENTORY = ["not_in_gameplay", "not_safe_now", "not_v", "not_in_inventory", "call_failed"];
const SHOWROOM = ["codeware_missing", "showroom_missing", "showroom_manifest_missing", "showroom_manifest_bad", "showroom_not_staged", "not_in_world", "not_ready", "too_far"];
const CAPTURE = ["capture_no_window", "capture_minimized", "capture_not_foreground", "capture_blank", "capture_failed"];

/**
 * Each command's own refusal codes (0.8, for the MCP reference): the codes its handlers raise (the tools' planError, the
 * plugin's MethodError, the redscript layer's XFJson.Fail) beyond those every command can answer.
 */
export const REFUSALS: Readonly<Record<string, readonly string[]>> = {
  "bridge.ping": [],
  "bridge.info": [],
  "bridge.kill": [],
  "capture.screenshot": [...CAPTURE, "expectation_failed"],
  "capture.recrop": ["bad_input", "not_found"],
  "capture.burst": CAPTURE,
  "scene.read": ["game_not_ready", "unavailable"],
  "scene.report": ["game_not_ready", "unavailable", "showroom_manifest_missing", "showroom_manifest_bad"],
  "session.events": [],
  "session.log": [],
  "session.note": [],
  "session.handover": [],
  "session.resume": [],
  "capture.sheet": ["bad_input", "too_many", ...CAPTURE],
  "game.status": [],
  "game.wait": ["wait_timeout", "interrupted"],
  "player.appearance": ["game_not_ready"],
  "game.options.read": ["unavailable", "timeout"],
  "photo.state": ["game_not_ready", "unavailable"],
  "photo.open": ["not_in_gameplay", "photo_not_allowed", "key_unsupported", "no_window", "photo_open_timeout", "interrupted"],
  "photo.enter": ["photo_key_needed", "not_in_gameplay", "unsupported", "rtti_missing", "rtti_signature", "unavailable"],
  "photo.exit": ["unavailable"],
  "photo.camera.set": PHOTO,
  "photo.camera.place": [...PHOTO, "too_far"],
  "photo.camera.preset": [...PHOTO, "tweakxl_missing"],
  "photo.light.set": PHOTO,
  "photo.hud.hide": ["not_in_photo_mode", "unavailable"],
  "photo.expression.set": [...PHOTO, "no_effect", "unverified_index", "face_table_unreadable"],
  "photo.expression.index": ["not_in_photo_mode", "unavailable", "no_effect", "unverified_index", "face_table_unreadable"],
  "photo.pose.set": [...PHOTO, "carrier_not_loaded"],
  "pose.live.read": ["live_pose_unavailable", "carrier_not_loaded", "clip_not_found", "layout_unrecognised", "game_not_ready"],
  "pose.live.apply": ["live_pose_disabled", "live_pose_unavailable", "carrier_not_loaded", "carrier_not_selected", "clip_not_found", "layout_unrecognised"],
  "face.rig.read": ["not_in_photo_mode", "unavailable"],
  "photo.subject": ["not_in_photo_mode", "unavailable"],
  "photo.frame": ["not_in_photo_mode", "framing_bound", "no_projection", "no_response", "no_capture", "not_found", "unavailable", "write_mismatch"],
  "cc.open": ["creator_leave_disabled", "not_in_gameplay", "not_safe_now", "not_v", "save_lock_not_held", "creator_open_timeout", "creator_open_uncertain", "unavailable"],
  "cc.apply": ["not_in_character_menu", "stale_match", "busy"],
  "cc.page": ["not_in_character_menu"],
  "cc.confirm": ["creator_leave_disabled", "not_in_character_menu", "busy"],
  "inventory.equip": [...INVENTORY, "timeout"],
  "inventory.list": ["unavailable", "game_not_ready"],
  "test.save.delay": ["test_hooks_off"],
  "wardrobe.state": ["not_in_gameplay", "unavailable"],
  "wardrobe.equip": [...INVENTORY, "no_active_outfit", "outfit_managed_elsewhere", "script_outfit_api_changed", "timeout"],
  "inventory.unequip": [...INVENTORY, "not_added_by_bridge", "timeout"],
  "cc.back": ["creator_leave_disabled", "not_in_character_menu"],
  "game.save": ["bridge_save_lock", "bridge_effects_active", "saving_locked", "no_free_slot", "save_failed", "save_uncertain", "not_in_gameplay"],
  "game.load": ["not_in_gameplay", "save_not_found", "metadata_pending", "unavailable", "timeout"],
  "game.continue": ["no_safe_route"],
  "ui.message": [],
  "ui.hud": [],
  "world.time.set": ["not_in_gameplay", "not_in_photo_mode", "unavailable"],
  "world.pause": ["not_in_gameplay", "game_not_ready"],
  "world.pin": ["not_in_world", "not_ready", "too_many_pins", "no_such_piece", "not_spawned_yet", "pin_refused"],
  "world.pin.clear": ["no_such_pin"],
  "showroom.spawn": [...SHOWROOM, "spawn_refused", "no_such_piece"],
  "showroom.light": [...SHOWROOM, "no_showroom", "no_such_piece", "spawn_refused"],
  "showroom.rotate": ["no_showroom", "no_such_piece", "not_spawned_yet", ...CAPTURE],
  "showroom.clear": [],
  "showroom.state": [],
  "behave.turntable": ["behaviour_limit", "no_showroom", "no_such_piece"],
  "behave.look": ["behaviour_limit", ...PLAYER, "user_took_over"],
  "behave.glide.path": ["behaviour_limit", ...PLAYER, "user_took_over", "no_path", "no_ground", "not_streamed", "too_far", "bridge_effects_active"],
  "behave.keep.framed": ["behaviour_limit", "not_in_photo_mode", "no_such_piece", "unavailable"],
  "behave.stop": ["no_such_behaviour"],
  "behave.list": [],
  "player.state": ["not_in_gameplay"],
  "player.teleport": [...PLAYER, "no_ground", "not_streamed", "too_far"],
  "player.look": [...PLAYER, "unavailable"],
  "player.look.stop": ["not_in_gameplay"],
  "player.stop": [],
  "player.interact.list": ["not_in_gameplay"],
  "player.action": [...PLAYER, "rate_limited"],
  "input.probe": [],
  "session.wait": ["question_gone"],
  "cyberware.state": ["not_in_gameplay", "unavailable"],
  "cyberware.equip": [...INVENTORY, "arms_drawn", "not_equippable", "unavailable"],
  "cyberware.unequip": [...INVENTORY, "arms_drawn", "not_added_by_bridge"],
  "world.state": ["game_not_ready"],
  "world.probe": ["unavailable"],
  "world.weather.set": ["codeware_missing", "quest_scene", "not_in_gameplay", "call_failed", "unavailable"],
  "ui.state": ["game_not_ready"],
  "game.saves": ["unavailable", "game_not_ready"],
  "photo.scene.set": ["not_in_photo_mode", "unavailable", "write_mismatch"],
  "overlay.state": [],
  // NPC direction (0.8, part B): its own map, kept beside its commands (catalogue080npc.ts).
  ...NPC_REFUSALS,
};

/**
 * The 0.8 changes on the catalogue's entries (by name), and each entry's refusals. Entries the map lacks (a later
 * command) get none; the catalogue test checks that every command has an entry.
 */
export function applyCatalogue080(list: CommandDef[]): CommandDef[] {
  return list.map((command) => {
    let out: CommandDef = { ...command, refusals: REFUSALS[command.name] ?? command.refusals };
    if (command.name === "wardrobe.state" && command.bridge) out = { ...out, bridge: { ...command.bridge, result: reconcileWardrobe } };
    if (command.name === "wardrobe.equip" && command.bridge) out = { ...out, bridge: { ...command.bridge, result: reconcileWardrobeAnswer } };
    return out;
  });
}
