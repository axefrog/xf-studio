// XF Runtime Bridge: player control, phase 1 (bridge 0.6; research/runtime/player-control-design.md §6 step 1).
//
// Script routes only, no new native hooks: V's state (position, facing, camera, the player state machine), a teleport with
// ground checks, looking (the targeting system's own look-at, as the scanner and melee use it), the system-driven actions
// (crouch through the sniper nest's status effect, weapons through the equipment system's own requests, hub menus through
// the UI system's events), and what the HUD offers to interact with. Glides and smooth looks run as behaviours
// (core/Behaviours.hpp), which call Teleport, LookAt, Path and Hold below. Every change checks V's state first and refuses
// with a named reason (design §4.1: 0.6.1 adds a fall or landing, swimming, a workspot, a takedown and a carried body);
// status effects the bridge applies are remembered, removed by player.stop, a handover and the kill switch, and never saved
// (game.save refuses while any is on; the session ends by loading its save). A glide checks V before every step and ends
// when the player's own input moves her (user_took_over, design §4.2).
//
// Sources [source] 2.31: TeleportationFacility.Teleport (orphans.script:31933), NavigationSystem
// (core/systems/navigationSystem.script), TargetingSystem.LookAt / BreakLookAt / GetLookAtObject (orphans.script:22401-22423),
// the PlayerStateMachine blackboard (blackboardDefinitions.script), StatusEffectHelper (statusEffectSystem.script:4, 47),
// GameplayRestriction.ForceCrouch (sniperNest.script:346, 359) and NoMovement (braindanceControlsTransitions.script:515),
// EquipmentSystemWeaponManipulationRequest (orphans.script:28176), StartHubMenuEvent (orphans.script; scriptedPuppet.script:
// 564-568), the wardrobe's inkMenuInstance_SpawnEvent (wardrobeController.script:43-53).

module XFRuntimeBridge

public abstract class XFPlayer {
  public static func Player() -> ref<PlayerPuppet> {
    return GetPlayer(GetGameInstance());
  }

  public static func Psm(player: ref<PlayerPuppet>, id: BlackboardID_Int) -> Int32 {
    let board = player.GetPlayerStateMachineBlackboard();
    return IsDefined(board) ? board.GetInt(id) : -1;
  }

  // Script producers, NOT the stale gamePSMWeaponStates enum (R6 §8).
  // 2.31 weaponTransitions.script:756–769 Ready=5, :1789–1819 Reload=2,
  // :1930–1935 Shoot=8; :888–892 Safe=6; upperBodyTransitions.script:1326 Aiming=6.
  // 0.8.18 (Borg 3, SN6: raw 0 and "unknown" with a weapon drawn, the weapon watcher firing): the PSM's Weapon value belongs to
  // ranged weapons only; a melee weapon (or the arm cyberware) in hand is the MeleeWeapon value's (meleeTransitions.script,
  // gamePSMMeleeWeapon), and a ranged weapon the game holds NotReady writes 0 on purpose (NotReadyEvents, weaponTransitions.script:
  // 840-850) while a status effect, a sliding or dodging V, a takedown, a consumable or a scene tier keeps it from being ready
  // (IsWeaponReadyToShoot, :594-740). The reader now says what is in hand (kind, from the active weapon object), reads both values,
  // names the one that applies (a drawn weapon at 0 is NotReady, never "unknown") and lists the readiness blockers it can see.
  public static func RangedStateName(weapon: Int32) -> String {
    switch weapon {
      case 0: return "NotReady";
      case 1: return "Charging";
      case 2: return "Reload";
      case 3: return "QuickMelee";
      case 4: return "NoAmmo";
      case 5: return "Ready";
      case 6: return "Safe";
      case 7: return "Overheat";
      case 8: return "Shoot";
    }
    return "unknown";
  }

  public static func MeleeStateName(melee: Int32) -> String {
    switch melee {
      case 0: return "NotReady";
      case 1: return "Equipping";
      case 2: return "Idle";
      case 3: return "Safe";
      case 4: return "PublicSafe";
      case 5: return "Parried";
      case 6: return "Hold";
      case 7: return "ChargedHold";
      case 8: return "Block";
      case 9: return "Targeting";
      case 10: return "Deflect";
      case 11: return "ComboAttack";
      case 12: return "FinalAttack";
      case 13: return "StrongAttack";
      case 14: return "SafeAttack";
      case 15: return "BlockAttack";
      case 16: return "SprintAttack";
      case 17: return "CrouchAttack";
      case 18: return "JumpAttack";
      case 19: return "ThrowAttack";
      case 20: return "DeflectAttack";
      case 21: return "EquipAttack";
      case 22: return "Default";
    }
    return "unknown";
  }

  // What the game's own readiness check can be seen to hold against (a subset of IsWeaponReadyToShoot: the status effects and the
  // scene tier; the weapon's equip state and the other state machines are not readable from here).
  public static func WeaponBlockers(player: ref<PlayerPuppet>) -> String {
    let defs = GetAllBlackboardDefs().PlayerStateMachine;
    let out = "";
    let noCombat = StatusEffectSystem.ObjectHasStatusEffectWithTag(player, n"NoCombat");
    let fastForward = StatusEffectSystem.ObjectHasStatusEffectWithTag(player, n"FastForward");
    if noCombat && !fastForward { out += (StrLen(out) > 0 ? "," : "") + "\"no_combat_status\""; }
    let vehicleScene = StatusEffectSystem.ObjectHasStatusEffectWithTag(player, n"VehicleScene");
    if vehicleScene { out += (StrLen(out) > 0 ? "," : "") + "\"vehicle_scene_status\""; }
    let stunned = StatusEffectSystem.ObjectHasStatusEffectOfType(player, gamedataStatusEffectType.Stunned);
    if stunned { out += (StrLen(out) > 0 ? "," : "") + "\"stunned\""; }
    let jammed = StatusEffectSystem.ObjectHasStatusEffectOfType(player, gamedataStatusEffectType.Jam);
    if jammed { out += (StrLen(out) > 0 ? "," : "") + "\"weapon_jammed\""; }
    let tier = XFPlayer.Psm(player, defs.HighLevel);
    if tier > 1 && tier <= 5 { out += (StrLen(out) > 0 ? "," : "") + "\"scene_tier\""; }
    let takedown = XFPlayer.Psm(player, defs.Takedown);
    if takedown == 2 || takedown == 3 || takedown == 4 { out += (StrLen(out) > 0 ? "," : "") + "\"takedown\""; }
    let gadget = XFPlayer.Psm(player, defs.CombatGadget);
    if gadget > 0 && gadget < 5 { out += (StrLen(out) > 0 ? "," : "") + "\"combat_gadget\""; }
    return "[" + out + "]";
  }

  public static func WeaponState(player: ref<PlayerPuppet>) -> String {
    let defs = GetAllBlackboardDefs().PlayerStateMachine;
    let weapon = XFPlayer.Psm(player, defs.Weapon);
    let melee = XFPlayer.Psm(player, defs.MeleeWeapon);
    let upper = XFPlayer.Psm(player, defs.UpperBody);
    let active = ScriptedPuppet.GetActiveWeapon(player);
    let drawn = IsDefined(active);
    let kind = "none";
    if drawn {
      let isMelee = active.IsMelee();
      let isRanged = active.IsRanged();
      kind = isMelee ? "melee" : isRanged ? "ranged" : "other";
    }
    let name = "unknown";
    if Equals(kind, "melee") {
      name = XFPlayer.MeleeStateName(melee);
    } else {
      if Equals(kind, "none") {
        name = weapon == 0 ? "none" : XFPlayer.RangedStateName(weapon);
      } else {
        name = XFPlayer.RangedStateName(weapon);
      }
    }
    let blockers = "[]";
    if Equals(kind, "ranged") && weapon == 0 {
      blockers = XFPlayer.WeaponBlockers(player);
    }
    return "{\"raw\":" + IntToString(weapon) + ",\"script_name\":" + XFJson.Str(name) + ",\"melee_raw\":" + IntToString(melee)
      + ",\"kind\":" + XFJson.Str(kind) + ",\"drawn\":" + XFJson.Flag(drawn) + ",\"not_ready_blockers\":" + blockers
      + ",\"upper_body_raw\":" + IntToString(upper) + ",\"aiming\":" + XFJson.Flag(upper == 6)
      + ",\"source\":\"2.31 PSM script writers; R6 section 8\",\"can_fire\":null}";
  }

  // Why the bridge won't move V now: "" when it may, or a refusal code (design §4.1). BusyState names the state behind a
  // player_busy (RB-79: a fall or landing, swimming, a workspot, a takedown or grapple, carrying a body, any locomotion but
  // standing or crouching, a menu or photo mode, death); a teleport in the middle of one of them may leave the player state
  // machine stuck.
  public static func Busy(player: ref<PlayerPuppet>) -> String {
    let game = GetGameInstance();
    let phase = XFBridgeActions.Phase();
    if !Equals(phase, "gameplay") {
      return "player_busy";
    }
    if !IsDefined(player) || player.IsReplacer() {
      return "not_v";
    }
    if player.IsDead() {
      return "player_busy";
    }
    if player.IsInCombat() {
      return "in_combat";
    }
    if VehicleComponent.IsMountedToVehicle(game, player) {
      return "in_vehicle";
    }
    // 0.7 (session 7): the gameplay tiers, as the player state machine's high level reports them (gamePSMHighLevel 0-5,
    // orphans.script:6685; GameplayTier Tier1_FullGameplay .. Tier5_Cinematic, orphans.script:3105; highLevelTransitions.script
    // SceneTierII..V). Tiers 3 to 5 are the scene holding V (limited gameplay on a spline, first-person cinematic, cinematic):
    // refused. Tier 2 is staged gameplay (V's apartment, clubs: weapons away, walking pace set by the scene) and tier 1 full
    // gameplay: the bridge's reversible moves are allowed, like the player's own walking. The scene system's
    // IsEntityInScene(V) is no guide: session 7 read it true in V's apartment (tier 2) and on a walkway during The Pickup
    // (tier 1), where every move was refused; it is reported (player.state in_scene, staged_scene) but not used. A dialogue
    // is refused in every tier.
    let defs = GetAllBlackboardDefs().PlayerStateMachine;
    let high = XFPlayer.Psm(player, defs.HighLevel);
    if high >= 3 && high <= 5 {
      return "in_scene";
    }
    let scenes = GameInstance.GetSceneSystem(game).GetScriptInterface();
    if IsDefined(scenes) && scenes.IsEntityInDialogue(player.GetEntityID()) {
      return "in_scene";
    }
    return StrLen(XFPlayer.BusyState(player)) > 0 ? "player_busy" : "";
  }

  // The gameplay tier by name (0.7): full (Default, SceneTier1), staged (SceneTier2), limited (SceneTier3), fpp_cinematic
  // (SceneTier4), cinematic (SceneTier5), swimming, or unknown.
  public static func TierName(high: Int32) -> String {
    switch high {
      case 0:
        return "full";
      case 1:
        return "full";
      case 2:
        return "staged";
      case 3:
        return "limited";
      case 4:
        return "fpp_cinematic";
      case 5:
        return "cinematic";
      case 6:
        return "swimming";
    }
    return "unknown";
  }

  // The player state machine's own reason V is busy, or "" (only what Busy doesn't already name: combat, vehicles and scenes
  // have their own codes). Values [source] 2.31 orphans.script enums gamePSMHighLevel, gamePSMLocomotionStates,
  // gamePSMFallStates, gamePSMLandingState, gamePSMSwimming, gamePSMTakedown, gamePSMBodyCarrying; the fields
  // blackboardDefinitions.script PlayerStateMachine.Fall, Landing, Swimming, IsInWorkspot, Takedown, BodyCarrying.
  public static func BusyState(player: ref<PlayerPuppet>) -> String {
    let phase = XFBridgeActions.Phase();
    if !Equals(phase, "gameplay") {
      return phase;
    }
    if !IsDefined(player) {
      return "no_player";
    }
    if player.IsDead() {
      return "dead";
    }
    let defs = GetAllBlackboardDefs().PlayerStateMachine;
    if XFPlayer.Psm(player, defs.HighLevel) == 6 || XFPlayer.Psm(player, defs.Swimming) > 0 {
      return "swimming";
    }
    if XFPlayer.Psm(player, defs.Fall) > 0 {
      return "falling";
    }
    if XFPlayer.Psm(player, defs.Landing) > 0 {
      return "landing";
    }
    if XFPlayer.Psm(player, defs.IsInWorkspot) > 0 {
      return "workspot";
    }
    if XFPlayer.Psm(player, defs.Takedown) > 0 {
      return "takedown";
    }
    if XFPlayer.Psm(player, defs.BodyCarrying) > 0 {
      return "carrying_body";
    }
    let locomotion = XFPlayer.Psm(player, defs.Locomotion);
    if locomotion != 0 && locomotion != 1 {
      return "locomotion:" + EnumValueToString("gamePSMLocomotionStates", Cast<Int64>(locomotion));
    }
    return "";
  }

  public static func CameraJson() -> String {
    let camera = GameInstance.GetCameraSystem(GetGameInstance());
    let transform: Transform;
    if !IsDefined(camera) || !camera.GetActiveCameraWorldTransform(transform) {
      return "null";
    }
    let f = camera.GetActiveCameraForward();
    let yaw = Rad2Deg(AtanF(-f.X, f.Y));
    let pitch = Rad2Deg(AsinF(ClampF(f.Z, -1.0, 1.0)));
    return "{\"position\":" + XFScene.Arr(transform.position) + ",\"forward\":" + XFScene.Arr(f) + ",\"right\":" + XFScene.Arr(camera.GetActiveCameraRight()) + ",\"up\":" + XFScene.Arr(camera.GetActiveCameraUp()) + ",\"yaw\":" + XFJson.Num(yaw) + ",\"pitch\":" + XFJson.Num(pitch) + ",\"fov\":" + XFJson.Num(camera.GetActiveCameraFOV()) + ",\"aspect\":" + XFJson.Num(camera.GetAspectRatio()) + "}";
  }

  // player.state (read).
  public static func State(cid: String) -> String {
    let game = GetGameInstance();
    let player = XFPlayer.Player();
    if !IsDefined(player) || !player.IsAttached() {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    let defs = GetAllBlackboardDefs().PlayerStateMachine;
    let out = "{\"ok\":true,\"phase\":" + XFJson.Str(XFBridgeActions.Phase()) + ",\"position\":" + XFScene.Arr(player.GetWorldPosition()) + ",\"yaw\":" + XFJson.Num(player.GetWorldYaw());
    out += ",\"weapon_state\":" + XFPlayer.WeaponState(player);
    out += ",\"forward\":" + XFScene.Arr(player.GetWorldForward()) + ",\"camera\":" + XFPlayer.CameraJson();
    out += ",\"psm\":{\"locomotion\":" + IntToString(XFPlayer.Psm(player, defs.Locomotion)) + ",\"locomotion_name\":" + XFJson.Str(EnumValueToString("gamePSMLocomotionStates", Cast<Int64>(XFPlayer.Psm(player, defs.Locomotion))));
    out += ",\"high_level\":" + IntToString(XFPlayer.Psm(player, defs.HighLevel)) + ",\"high_level_name\":" + XFJson.Str(EnumValueToString("gamePSMHighLevel", Cast<Int64>(XFPlayer.Psm(player, defs.HighLevel))));
    out += ",\"vehicle\":" + IntToString(XFPlayer.Psm(player, defs.Vehicle)) + ",\"combat\":" + IntToString(XFPlayer.Psm(player, defs.Combat)) + "}";
    out += ",\"in_combat\":" + XFJson.Flag(player.IsInCombat()) + ",\"in_vehicle\":" + XFJson.Flag(VehicleComponent.IsMountedToVehicle(game, player));
    let high = XFPlayer.Psm(player, defs.HighLevel);
    out += ",\"tier\":" + XFJson.Str(XFPlayer.TierName(high));
    let scenes = GameInstance.GetSceneSystem(game).GetScriptInterface();
    if IsDefined(scenes) {
      let inScene = scenes.IsEntityInScene(player.GetEntityID());
      let inDialogue = scenes.IsEntityInDialogue(player.GetEntityID());
      // staged_scene (0.7): the scene system counts V as in a scene while the tier leaves her free (tier 2, V's apartment).
      out += ",\"in_scene\":" + XFJson.Flag(inScene) + ",\"in_dialogue\":" + XFJson.Flag(inDialogue) + ",\"staged_scene\":" + XFJson.Flag(inScene && !inDialogue && high <= 2);
    }
    out += ",\"busy\":" + XFJson.Str(XFPlayer.Busy(player)) + ",\"busy_state\":" + XFJson.Str(XFPlayer.BusyState(player)) + ",\"dead\":" + XFJson.Flag(player.IsDead());
    out += ",\"psm_detail\":{\"fall\":" + IntToString(XFPlayer.Psm(player, defs.Fall)) + ",\"landing\":" + IntToString(XFPlayer.Psm(player, defs.Landing)) + ",\"swimming\":" + IntToString(XFPlayer.Psm(player, defs.Swimming)) + ",\"workspot\":" + IntToString(XFPlayer.Psm(player, defs.IsInWorkspot)) + ",\"takedown\":" + IntToString(XFPlayer.Psm(player, defs.Takedown)) + ",\"body_carrying\":" + IntToString(XFPlayer.Psm(player, defs.BodyCarrying));
    // 0.7 (session 7: a teleport mid-jump was refused while a later player_state read all zeros): the locomotion state
    // (Jump, DodgeAir, SlideFall ...) and whether V stands on the ground now, sampled with the busy state above.
    // 0.8 (session 8's D3: on_ground stayed true mid-jump): the navigation system's check only asks whether walkable
    // ground lies within 0.35 m, which it does during a jump; on_ground is now the player state machine's own IsOnGround
    // flag (blackboardDefinitions.script PlayerStateMachine.IsOnGround, the flag isPlayerOnGroundPrereq.script listens to),
    // and false in an airborne locomotion state (Jump, DodgeAir, SlideFall) or a fall. near_navmesh keeps the old reading.
    let locomotion = XFPlayer.Psm(player, defs.Locomotion);
    let board = player.GetPlayerStateMachineBlackboard();
    let psmGround = IsDefined(board) ? board.GetBool(defs.IsOnGround) : true;
    let airborne = locomotion == 4 || locomotion == 7 || locomotion == 10 || XFPlayer.Psm(player, defs.Fall) > 0;
    let nearNavmesh = GameInstance.GetNavigationSystem(game).IsOnGround(player, 0.35);
    out += ",\"locomotion\":" + IntToString(locomotion) + ",\"locomotion_name\":" + XFJson.Str(EnumValueToString("gamePSMLocomotionStates", Cast<Int64>(locomotion))) + ",\"on_ground\":" + XFJson.Flag(psmGround && !airborne);
    out += ",\"psm_on_ground\":" + XFJson.Flag(psmGround) + ",\"near_navmesh\":" + XFJson.Flag(nearNavmesh) + "}";
    out += ",\"look_at\":" + XFScene.LookedAt(player) + ",\"hud_prompt\":" + XFScene.Prompt(game);
    let registry = XFBridgeRegistry.Get();
    if IsDefined(registry) {
      out += ",\"bridge_effects\":" + registry.PlayerEffectsJson();
    }
    return out + "}";
  }

  // Busy's refusal with the state behind it, for the answers.
  public static func BusyText(player: ref<PlayerPuppet>, busy: String) -> String {
    let state = XFPlayer.BusyState(player);
    return StrLen(state) > 0 ? busy + ": " + state : busy;
  }

  // player.teleport: to (x, y, z) facing yaw (hasYaw) or keeping the facing; ground 0 = snap to walkable ground within 2 m
  // (refused without it), 1 = exact (no snap: the caller's risk). Either way a destination more than 0.5 m away must have
  // the world streamed in around it (RB-80: exact used to skip that, so exact plus far had no check at all); a turn in
  // place (player.look's instant yaw) stays where V already stands. far lifts the 50 m cap.
  public static func Teleport(cid: String, x: Float, y: Float, z: Float, yaw: Float, hasYaw: Bool, ground: Int32, far: Bool, allowRoad: Bool) -> String {
    let player = XFPlayer.Player();
    let busy = XFPlayer.Busy(player);
    if StrLen(busy) > 0 {
      return XFJson.Fail(busy, "V can't be moved now (" + XFPlayer.BusyText(player, busy) + ")");
    }
    let registry = XFBridgeRegistry.Get();
    if IsDefined(registry) && registry.HasPlayerEffect(TDBID.Create("GameplayRestriction.NoMovement")) {
      return XFJson.Fail("bridge_effects_active", "the bridge still holds something that a save would keep (GameplayRestriction.NoMovement); player_stop before teleporting");
    }
    let game = GetGameInstance();
    let before = player.GetWorldPosition();
    let beforeYaw = player.GetWorldYaw();
    let target = new Vector4(x, y, z, 1.0);
    let distance = Vector4.Distance(before, target);
    if distance > 50.0 && !far {
      return XFJson.Fail("too_far", "that place is " + FloatToStringPrec(distance, 1) + " m away; the bridge teleports at most 50 m unless far is given");
    }
    let navigation = GameInstance.GetNavigationSystem(game);
    if distance > 0.5 && !navigation.IsNavmeshStreamedInLocation(target, 2.0) {
      return XFJson.Fail("not_streamed", "the world around that place isn't loaded (no walkable ground streamed in)");
    }
    if ground == 0 {
      let found = navigation.FindPointInSphereOnlyHumanNavmesh(target, 2.0, NavGenAgentSize.Human, true);
      if NotEquals(found.status, worldNavigationRequestStatus.OK) {
        return XFJson.Fail("no_ground", "there is no walkable ground within 2 m of that place");
      }
      target = found.point;
    }
    // Check the final snapped point, in the execution frame, before any save lock or movement.
    // No positive memberships are available yet. Unknown proceeds under the coordinator's policy.
    if XFNavigation.Refuses(false, false, allowRoad) { return XFJson.Fail("on_road", "Road placement requires allow_road:true; CrossWalk remains allowed with a caution."); }
    let traffic = XFNavigation.Classify(target, 10.0);
    let angles: EulerAngles;
    angles.Yaw = hasYaw ? yaw : beforeYaw;
    XFBridgeActions.EnsureSaveLock(cid);
    GameInstance.GetTeleportationFacility(game).Teleport(player, target, angles);
    XFNavigation.Note(target, "V");
    XFBridgeLog.Info(cid, "player teleported from " + XFScene.Arr(before) + " to " + XFScene.Arr(target) + "; undo: teleport back");
    return "{\"ok\":true,\"before\":{\"position\":" + XFScene.Arr(before) + ",\"yaw\":" + XFJson.Num(beforeYaw) + "},\"target\":" + XFScene.Arr(target) + ",\"yaw\":" + XFJson.Num(angles.Yaw) + ",\"snapped\":" + XFJson.Flag(ground == 0) + ",\"traffic_check\":" + traffic + "}";
  }

  // A glide's step (behave.glide.path): V to the next point on her path, facing along it. No log line per tick. Before
  // each step (RB-79, RB-81): the player's own movement, jump, crouch, sprint, dodge or camera input since the glide took
  // hold ends it (user_took_over, design §4.2), and so does any state Busy refuses (a fall, a landing, swimming, a workspot,
  // a takedown, a carried body, combat, a vehicle, a scene).
  public static func Step(cid: String, x: Float, y: Float, z: Float, yaw: Float) -> String {
    let player = XFPlayer.Player();
    if !IsDefined(player) || !Equals(XFBridgeActions.Phase(), "gameplay") {
      return XFJson.Fail("player_busy", "V left normal play");
    }
    let refusal = XFPlayer.GlideRefusal(player);
    if StrLen(refusal) > 0 {
      return refusal;
    }
    // Unknown lane membership is permitted. The behaviour emits one traffic-risk note on start.
    let angles: EulerAngles;
    angles.Yaw = yaw;
    GameInstance.GetTeleportationFacility(GetGameInstance()).Teleport(player, new Vector4(x, y, z, 1.0), angles);
    return "{\"ok\":true}";
  }

  // Why a glide must stop now: the refusal's JSON, or "".
  public static func GlideRefusal(player: ref<PlayerPuppet>) -> String {
    let registry = XFBridgeRegistry.Get();
    let touched = IsDefined(registry) ? registry.GlideInputTouched() : "";
    if StrLen(touched) > 0 {
      return XFJson.Fail("user_took_over", "the player moved V (" + touched + "), so the glide gave her back");
    }
    let busy = XFPlayer.Busy(player);
    if StrLen(busy) > 0 {
      return XFJson.Fail(busy, "V is no longer free to move (" + XFPlayer.BusyText(player, busy) + ")");
    }
    return "";
  }

  // Where V is now (the teleport's read-back two ticks later; a glide's check on the ticks it doesn't move her). took_over:
  // the player's own input the glide's watch saw ("" when none).
  public static func Where(cid: String) -> String {
    let player = XFPlayer.Player();
    if !IsDefined(player) {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    let registry = XFBridgeRegistry.Get();
    let touched = IsDefined(registry) ? registry.GlideInputTouched() : "";
    return "{\"ok\":true,\"position\":" + XFScene.Arr(player.GetWorldPosition()) + ",\"yaw\":" + XFJson.Num(player.GetWorldYaw()) + ",\"busy\":" + XFJson.Str(XFPlayer.Busy(player)) + ",\"busy_state\":" + XFJson.Str(XFPlayer.BusyState(player)) + ",\"took_over\":" + XFJson.Str(touched) + "}";
  }

  // 0.7 (session 7: the maintainer's mouse didn't end a look behaviour): the player's own input watch without a movement hold,
  // for a look (design §4.2). Off leaves the watch on while a glide's hold is on (the glide owns it then).
  public static func WatchInput(cid: String, on: Bool) -> String {
    let player = XFPlayer.Player();
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(player) || !IsDefined(registry) {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    if on {
      registry.StartGlideInputWatch(player);
    } else {
      if !registry.HasPlayerEffect(TDBID.Create("GameplayRestriction.NoMovement")) {
        registry.StopGlideInputWatch(player);
      }
    }
    return "{\"ok\":true,\"watching\":" + XFJson.Flag(on) + "}";
  }

  // The player's camera turns towards a world point over duration seconds (the targeting system's own look-at; the
  // player's mouse or stick breaks it, as it breaks the scanner's).
  public static func LookAt(cid: String, x: Float, y: Float, z: Float, duration: Float) -> String {
    let player = XFPlayer.Player();
    let busy = XFPlayer.Busy(player);
    if StrLen(busy) > 0 && !Equals(busy, "player_busy") {
      return XFJson.Fail(busy, "the bridge won't turn V's view now (" + busy + ")");
    }
    if !Equals(XFBridgeActions.Phase(), "gameplay") {
      return XFJson.Fail("not_in_gameplay", "V's view turns only in normal play");
    }
    let request: AimRequest;
    request.lookAtTarget = new Vector4(x, y, z, 1.0);
    request.duration = duration;
    request.maxDuration = duration + 1.0;
    request.easeIn = true;
    request.easeOut = true;
    request.precision = 0.1;
    request.adjustPitch = true;
    request.adjustYaw = true;
    request.checkRange = false;
    request.endOnTargetReached = true;
    request.endOnTimeExceeded = true;
    request.endOnCameraInputApplied = true;
    request.processAsInput = true;
    XFBridgeActions.EnsureSaveLock(cid);
    GameInstance.GetTargetingSystem(GetGameInstance()).LookAt(player, request);
    return "{\"ok\":true,\"camera_before\":" + XFPlayer.CameraJson() + "}";
  }

  public static func BreakLook(cid: String) -> String {
    let player = XFPlayer.Player();
    if IsDefined(player) {
      GameInstance.GetTargetingSystem(GetGameInstance()).BreakLookAt(player);
    }
    return "{\"ok\":true}";
  }

  // A walkable path between two points on the human navmesh, as a list of points.
  public static func Path(cid: String, x0: Float, y0: Float, z0: Float, x1: Float, y1: Float, z1: Float) -> String {
    let navigation = GameInstance.GetNavigationSystem(GetGameInstance());
    let path = navigation.CalculatePathOnlyHumanNavmesh(new Vector4(x0, y0, z0, 1.0), new Vector4(x1, y1, z1, 1.0), NavGenAgentSize.Human, 1.0);
    if !IsDefined(path) || ArraySize(path.path) < 2 {
      return XFJson.Fail("no_path", "the game found no walkable path between those points");
    }
    let out = "{\"ok\":true,\"length\":" + XFJson.Num(path.CalculateLength()) + ",\"points\":[";
    let i = 0;
    while i < ArraySize(path.path) {
      if i > 0 {
        out += ",";
      }
      out += XFScene.Arr(path.path[i]);
      i += 1;
    }
    return out + "]}";
  }

  // A status effect the bridge applies to V (remembered; player.stop and the kill switch remove it).
  public static func Effect(cid: String, effect: String, on: Bool) -> String {
    let player = XFPlayer.Player();
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(player) || !IsDefined(registry) {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    let id = TDBID.Create(effect);
    // A glide's movement hold also watches the player's own input while it is on (RB-81).
    let hold = Equals(effect, "GameplayRestriction.NoMovement");
    if on {
      XFBridgeActions.EnsureSaveLock(cid);
      if !registry.HasPlayerEffect(id) {
        StatusEffectHelper.ApplyStatusEffect(player, id);
        registry.NotePlayerEffect(id, true);
      }
      if hold {
        registry.StartGlideInputWatch(player);
      }
      return "{\"ok\":true,\"applied\":" + XFJson.Str(effect) + "}";
    }
    if hold {
      registry.StopGlideInputWatch(player);
    }
    if registry.HasPlayerEffect(id) {
      StatusEffectHelper.RemoveStatusEffect(player, id);
      registry.NotePlayerEffect(id, false);
      return "{\"ok\":true,\"removed\":" + XFJson.Str(effect) + "}";
    }
    return "{\"ok\":true,\"removed\":null,\"note\":\"the bridge hadn't applied it\"}";
  }

  // player.action: the system-driven actions. Answers {ok, action, undo_action} or a refusal.
  public static func Action(cid: String, name: String, arg: Int32) -> String {
    let game = GetGameInstance();
    let player = XFPlayer.Player();
    if !IsDefined(player) {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    let busy = XFPlayer.Busy(player);
    if Equals(name, "crouch") || Equals(name, "stand") {
      if StrLen(busy) > 0 {
        return XFJson.Fail(busy, "V can't crouch or stand now (" + XFPlayer.BusyText(player, busy) + ")");
      }
      let result = XFPlayer.Effect(cid, "GameplayRestriction.ForceCrouch", Equals(name, "crouch"));
      return result;
    }
    if StrBeginsWith(name, "weapon.") {
      if StrLen(busy) > 0 && !Equals(busy, "in_combat") {
        return XFJson.Fail(busy, "V's weapons can't be changed now (" + busy + ")");
      }
      let request = new EquipmentSystemWeaponManipulationRequest();
      request.owner = player;
      if Equals(name, "weapon.draw") {
        request.requestType = EquipmentManipulationAction.RequestLastUsedOrFirstAvailableWeapon;
      } else {
        if Equals(name, "weapon.arms") {
          // 0.7: the arm cyberware's weapon (the quick-slot manager's RequestActiveMeleeware, quickSlotsManager.script:471).
          request.requestType = EquipmentManipulationAction.RequestActiveMeleeware;
        } else {
          if Equals(name, "weapon.holster") {
            request.requestType = EquipmentManipulationAction.UnequipWeapon;
          } else {
            if arg < 1 || arg > 3 {
              return XFJson.Fail("bad_params", "weapon.slot takes a slot 1-3");
            }
            request.requestType = IntEnum<EquipmentManipulationAction>(26 + arg);
          }
        }
      }
      XFBridgeActions.EnsureSaveLock(cid);
      EquipmentSystem.GetInstance(player).QueueRequest(request);
      return "{\"ok\":true,\"action\":" + XFJson.Str(name) + ",\"weapon_state\":" + XFPlayer.WeaponState(player) + ",\"readback\":\"immediate_after_queue_not_settled\"}";
    }
    if Equals(name, "menu.close") {
      GameInstance.GetUISystem(game).QueueEvent(new ForceCloseHubMenuEvent());
      return "{\"ok\":true,\"action\":\"menu.close\"}";
    }
    if StrBeginsWith(name, "menu.") {
      if StrLen(busy) > 0 {
        return XFJson.Fail(busy, "the bridge opens menus only from normal play (" + busy + ")");
      }
      let menu = StrAfterFirst(name, "menu.");
      XFBridgeActions.EnsureSaveLock(cid);
      if Equals(menu, "wardrobe") {
        let spawn = new inkMenuInstance_SpawnEvent();
        spawn.Init(n"OnOpenWardrobeMenu", new WardrobeUserData());
        GameInstance.GetUISystem(game).QueueEvent(spawn);
        return "{\"ok\":true,\"action\":\"menu.wardrobe\"}";
      }
      let hub: CName;
      if Equals(menu, "inventory") {
        hub = n"inventory_screen";
      } else {
        if Equals(menu, "map") {
          hub = n"world_map";
        } else {
          if Equals(menu, "journal") {
            hub = n"quest_log";
          } else {
            if Equals(menu, "perks") {
              hub = n"new_perks";
            } else {
              if Equals(menu, "crafting") {
                hub = n"crafting_main";
              } else {
                return XFJson.Fail("bad_params", "unknown menu '" + menu + "' (inventory, map, journal, perks, crafting, wardrobe)");
              }
            }
          }
        }
      }
      let event = new StartHubMenuEvent();
      event.SetStartMenu(hub);
      GameInstance.GetUISystem(game).QueueEvent(event);
      return "{\"ok\":true,\"action\":" + XFJson.Str(name) + "}";
    }
    return XFJson.Fail("bad_params", "unknown action '" + name + "'");
  }

  // player.stop and the kill switch: every look-at broken and every status effect the bridge applied removed.
  public static func Stop(cid: String) -> String {
    let player = XFPlayer.Player();
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(player) || !IsDefined(registry) {
      return "{\"ok\":true,\"removed\":[]}";
    }
    GameInstance.GetTargetingSystem(GetGameInstance()).BreakLookAt(player);
    registry.StopGlideInputWatch(player);
    let removed = "[";
    let effects = registry.TakePlayerEffects();
    let i = 0;
    while i < ArraySize(effects) {
      StatusEffectHelper.RemoveStatusEffect(player, effects[i]);
      if i > 0 {
        removed += ",";
      }
      removed += XFJson.Str(TDBID.ToStringDEBUG(effects[i]));
      i += 1;
    }
    return "{\"ok\":true,\"removed\":" + removed + "]}";
  }

  public static func RestoreAfterKill(cid: String) -> String {
    let registry = XFBridgeRegistry.Get();
    let player = XFPlayer.Player();
    if IsDefined(player) {
      GameInstance.GetTargetingSystem(GetGameInstance()).BreakLookAt(player); // harmless when no look-at runs
      if IsDefined(registry) {
        registry.StopGlideInputWatch(player);
      }
    }
    if !IsDefined(registry) || !registry.HasAnyPlayerEffect() {
      return "";
    }
    let stopped = XFPlayer.Stop(cid);
    return ",\"player_stopped\":" + StrReplace(stopped, "{\"ok\":true,", "{");
  }

  public static func Interactions(cid: String) -> String {
    return "{\"ok\":true,\"interaction\":" + XFScene.Interactions(GetGameInstance()) + "}";
  }
}

// The player's own input while a glide holds V's movement (RB-81, design §4.2 user_took_over): a listener the registry
// registers on V for the movement, jump, crouch, sprint, dodge and camera actions when the hold goes on, and removes when it
// goes off (player.stop and the kill switch too). It records only the first action it sees; the glide's next step reads it
// and stops. With the movement held, the player's input still reaches listeners [plausible: the takeover system reads the
// same camera actions while it drives a camera, takeOverControlSystem.script:540-570]; session 7 checks it.
public class XFGlideInput extends IScriptable {
  public let touched: String;
  // BEGIN XFB_AUTONOMOUS_TEST_HOOKS
  public let xfSupervisorWatch: Bool;
  // END XFB_AUTONOMOUS_TEST_HOOKS

  // 0.8: the raw watch reports here (the first input seen wins, as for the actions).
  public func Touch(name: String) -> Void {
    if StrLen(this.touched) == 0 {
      this.touched = name;
      // BEGIN XFB_AUTONOMOUS_TEST_HOOKS
      if this.xfSupervisorWatch && XFBridge_RecordEnabled("supervisor") {
        XFBridge_Record("supervisor", "{\"event\":\"supervisor.input\",\"action\":" + XFJson.Str(name) + "}");
      }
      // END XFB_AUTONOMOUS_TEST_HOOKS
    }
  }

  public static func Actions() -> array<CName> {
    let names: array<CName>;
    ArrayPush(names, n"MoveX");
    ArrayPush(names, n"MoveY");
    ArrayPush(names, n"Jump");
    ArrayPush(names, n"ToggleCrouch");
    ArrayPush(names, n"Crouch");
    ArrayPush(names, n"ToggleSprint");
    ArrayPush(names, n"Sprint");
    ArrayPush(names, n"Dodge");
    ArrayPush(names, n"CameraMouseX");
    ArrayPush(names, n"CameraMouseY");
    ArrayPush(names, n"CameraX");
    ArrayPush(names, n"CameraY");
    return names;
  }

  protected cb func OnAction(action: ListenerAction, consumer: ListenerActionConsumer) -> Bool {
    if StrLen(this.touched) > 0 {
      return false;
    }
    let name = ListenerAction.GetName(action);
    let value = AbsF(ListenerAction.GetValue(action));
    let moved = false;
    if Equals(name, n"CameraMouseX") || Equals(name, n"CameraMouseY") {
      moved = value >= 3.0; // mouse deltas: a deliberate move, not sensor noise
    } else {
      if Equals(name, n"MoveX") || Equals(name, n"MoveY") || Equals(name, n"CameraX") || Equals(name, n"CameraY") {
        moved = value >= 0.3; // stick and key axes, past a dead zone
      } else {
        moved = ListenerAction.IsButtonJustPressed(action);
        // BEGIN XFB_AUTONOMOUS_TEST_HOOKS
        // Mapped combat triggers may arrive as values; raw fallback only covers axes.
        if this.xfSupervisorWatch { moved = moved || value >= 0.3; }
        // END XFB_AUTONOMOUS_TEST_HOOKS
      }
    }
    if moved {
      this.Touch(NameToString(name));
    }
    return false;
  }
}

// 0.8 (session 8's D4: the maintainer's mouse didn't end a look; the game's look-at keeps the camera actions from the
// player's listeners while it turns the camera): the raw devices themselves, through Codeware's Input/Axis callback (the
// engine's raw input buffer, before any action mapping; Codeware src/App/Callback/Controllers/RawInputHook.hpp). Registered
// only while a watch is on. A deliberate mouse move (15 counts in total, or 6 in one report) or a stick past its dead zone
// ends the look or glide, named "raw:<key>". Without Codeware nothing is registered and the action listener and the
// behaviour's own camera-drift check remain.
@if(ModuleExists("Codeware"))
public class XFRawAxisWatch extends IScriptable {
  public let watch: wref<XFGlideInput>;
  public let mouse: Float;

  public static func Start(watch: ref<XFGlideInput>) -> ref<IScriptable> {
    let raw = new XFRawAxisWatch();
    raw.watch = watch;
    GameInstance.GetCallbackSystem().RegisterCallback(n"Input/Axis", raw, n"OnXFAxis");
    return raw;
  }

  public static func Stop(raw: ref<IScriptable>) -> Void {
    let me = raw as XFRawAxisWatch;
    if IsDefined(me) {
      GameInstance.GetCallbackSystem().UnregisterCallback(n"Input/Axis", me, n"OnXFAxis");
    }
  }

  private cb func OnXFAxis(event: ref<AxisInputEvent>) {
    if !IsDefined(this.watch) {
      return;
    }
    let key = event.GetKey();
    let value = AbsF(event.GetValue());
    let name = EnumValueToString("EInputKey", Cast<Int64>(EnumInt(key)));
    if Equals(key, EInputKey.IK_MouseX) || Equals(key, EInputKey.IK_MouseY) {
      this.mouse += value;
      if value >= 6.0 || this.mouse >= 15.0 {
        this.watch.Touch("raw:" + name);
      }
    } else {
      if (Equals(key, EInputKey.IK_Pad_RightAxisX) || Equals(key, EInputKey.IK_Pad_RightAxisY) || Equals(key, EInputKey.IK_Pad_LeftAxisX) || Equals(key, EInputKey.IK_Pad_LeftAxisY)) && value >= 0.3 {
        this.watch.Touch("raw:" + name);
      }
    }
  }
}

@if(!ModuleExists("Codeware"))
public class XFRawAxisWatch extends IScriptable {
  public static func Start(watch: ref<XFGlideInput>) -> ref<IScriptable> {
    return null;
  }

  public static func Stop(raw: ref<IScriptable>) -> Void {}
}
