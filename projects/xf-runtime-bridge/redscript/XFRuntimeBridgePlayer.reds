// XF Runtime Bridge: player control, phase 1 (bridge 0.6; research/runtime/player-control-design.md §6 step 1).
//
// Script routes only, no new native hooks: V's state (position, facing, camera, the player state machine), a teleport with
// ground checks, looking (the targeting system's own look-at, as the scanner and melee use it), the system-driven actions
// (crouch through the sniper nest's status effect, weapons through the equipment system's own requests, hub menus through
// the UI system's events), and what the HUD offers to interact with. Glides and smooth looks run as behaviours
// (core/Behaviours.hpp), which call Teleport, LookAt, Path and Hold below. Every change checks V's state first and refuses
// with a named reason (design §4.1); status effects the bridge applies are remembered, removed by player.stop and the kill
// switch, and never saved (the session ends by loading its save).
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

  // Why the bridge won't move V now: "" when it may, or a refusal code (design §4.1).
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
    let defs = GetAllBlackboardDefs().PlayerStateMachine;
    let high = XFPlayer.Psm(player, defs.HighLevel);
    if high >= 3 && high <= 5 {
      return "in_scene";
    }
    let scenes = GameInstance.GetSceneSystem(game).GetScriptInterface();
    if IsDefined(scenes) && (scenes.IsEntityInScene(player.GetEntityID()) || scenes.IsEntityInDialogue(player.GetEntityID())) {
      return "in_scene";
    }
    if high == 6 {
      return "player_busy";
    }
    let locomotion = XFPlayer.Psm(player, defs.Locomotion);
    if locomotion != 0 && locomotion != 1 {
      return "player_busy";
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
    out += ",\"forward\":" + XFScene.Arr(player.GetWorldForward()) + ",\"camera\":" + XFPlayer.CameraJson();
    out += ",\"psm\":{\"locomotion\":" + IntToString(XFPlayer.Psm(player, defs.Locomotion)) + ",\"locomotion_name\":" + XFJson.Str(EnumValueToString("gamePSMLocomotionStates", Cast<Int64>(XFPlayer.Psm(player, defs.Locomotion))));
    out += ",\"high_level\":" + IntToString(XFPlayer.Psm(player, defs.HighLevel)) + ",\"high_level_name\":" + XFJson.Str(EnumValueToString("gamePSMHighLevel", Cast<Int64>(XFPlayer.Psm(player, defs.HighLevel))));
    out += ",\"vehicle\":" + IntToString(XFPlayer.Psm(player, defs.Vehicle)) + ",\"combat\":" + IntToString(XFPlayer.Psm(player, defs.Combat)) + "}";
    out += ",\"in_combat\":" + XFJson.Flag(player.IsInCombat()) + ",\"in_vehicle\":" + XFJson.Flag(VehicleComponent.IsMountedToVehicle(game, player));
    let scenes = GameInstance.GetSceneSystem(game).GetScriptInterface();
    if IsDefined(scenes) {
      out += ",\"in_scene\":" + XFJson.Flag(scenes.IsEntityInScene(player.GetEntityID())) + ",\"in_dialogue\":" + XFJson.Flag(scenes.IsEntityInDialogue(player.GetEntityID()));
    }
    out += ",\"busy\":" + XFJson.Str(XFPlayer.Busy(player)) + ",\"dead\":" + XFJson.Flag(player.IsDead());
    let targeting = GameInstance.GetTargetingSystem(game);
    let looked = targeting.GetLookAtObject(player, true, false);
    if IsDefined(looked) {
      let interactions = GameInstance.GetInteractionManager(game);
      out += ",\"look_at\":{\"id\":" + XFJson.Str(EntityID.ToDebugString(looked.GetEntityID())) + ",\"class\":" + XFJson.Name(looked.GetClassName()) + ",\"name\":" + XFJson.Str(looked.GetDisplayName());
      out += ",\"distance\":" + XFJson.Num(Vector4.Distance(looked.GetWorldPosition(), player.GetWorldPosition())) + ",\"interaction_target\":" + XFJson.Flag(IsDefined(interactions) && interactions.IsInteractionLookAtTarget(player, looked)) + "}";
    } else {
      out += ",\"look_at\":null";
    }
    let registry = XFBridgeRegistry.Get();
    if IsDefined(registry) {
      out += ",\"bridge_effects\":" + registry.PlayerEffectsJson();
    }
    return out + "}";
  }

  // player.teleport: to (x, y, z) facing yaw (hasYaw) or keeping the facing; ground 0 = snap to walkable ground within 2 m
  // (refused without it), 1 = exact (the caller's risk). far lifts the 50 m cap (the destination must be streamed in).
  public static func Teleport(cid: String, x: Float, y: Float, z: Float, yaw: Float, hasYaw: Bool, ground: Int32, far: Bool) -> String {
    let player = XFPlayer.Player();
    let busy = XFPlayer.Busy(player);
    if StrLen(busy) > 0 {
      return XFJson.Fail(busy, "V can't be moved now (" + busy + ")");
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
    if ground == 0 {
      if !navigation.IsNavmeshStreamedInLocation(target, 2.0) {
        return XFJson.Fail("not_streamed", "the world around that place isn't loaded (no walkable ground streamed in)");
      }
      let found = navigation.FindPointInSphereOnlyHumanNavmesh(target, 2.0, NavGenAgentSize.Human, true);
      if NotEquals(found.status, worldNavigationRequestStatus.OK) {
        return XFJson.Fail("no_ground", "there is no walkable ground within 2 m of that place");
      }
      target = found.point;
    }
    let angles: EulerAngles;
    angles.Yaw = hasYaw ? yaw : beforeYaw;
    XFBridgeActions.EnsureSaveLock(cid);
    GameInstance.GetTeleportationFacility(game).Teleport(player, target, angles);
    XFBridgeLog.Info(cid, "player teleported from " + XFScene.Arr(before) + " to " + XFScene.Arr(target) + "; undo: teleport back");
    return "{\"ok\":true,\"before\":{\"position\":" + XFScene.Arr(before) + ",\"yaw\":" + XFJson.Num(beforeYaw) + "},\"target\":" + XFScene.Arr(target) + ",\"yaw\":" + XFJson.Num(angles.Yaw) + ",\"snapped\":" + XFJson.Flag(ground == 0) + "}";
  }

  // A glide's step (behave.glide.path, every tick): V to the next point on her path, facing along it. No checks and no log
  // line here: the behaviour checked V when it started, holds her movement off, and checks her state every 15 ticks.
  public static func Step(cid: String, x: Float, y: Float, z: Float, yaw: Float) -> String {
    let player = XFPlayer.Player();
    if !IsDefined(player) || !Equals(XFBridgeActions.Phase(), "gameplay") {
      return XFJson.Fail("player_busy", "V left normal play");
    }
    let angles: EulerAngles;
    angles.Yaw = yaw;
    GameInstance.GetTeleportationFacility(GetGameInstance()).Teleport(player, new Vector4(x, y, z, 1.0), angles);
    return "{\"ok\":true}";
  }

  // Where V is now (the teleport's read-back two ticks later).
  public static func Where(cid: String) -> String {
    let player = XFPlayer.Player();
    if !IsDefined(player) {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    return "{\"ok\":true,\"position\":" + XFScene.Arr(player.GetWorldPosition()) + ",\"yaw\":" + XFJson.Num(player.GetWorldYaw()) + ",\"busy\":" + XFJson.Str(XFPlayer.Busy(player)) + "}";
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
    if on {
      XFBridgeActions.EnsureSaveLock(cid);
      if !registry.HasPlayerEffect(id) {
        StatusEffectHelper.ApplyStatusEffect(player, id);
        registry.NotePlayerEffect(id, true);
      }
      return "{\"ok\":true,\"applied\":" + XFJson.Str(effect) + "}";
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
        return XFJson.Fail(busy, "V can't crouch or stand now (" + busy + ")");
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
        if Equals(name, "weapon.holster") {
          request.requestType = EquipmentManipulationAction.UnequipWeapon;
        } else {
          if arg < 1 || arg > 3 {
            return XFJson.Fail("bad_params", "weapon.slot takes a slot 1-3");
          }
          request.requestType = IntEnum<EquipmentManipulationAction>(26 + arg);
        }
      }
      XFBridgeActions.EnsureSaveLock(cid);
      EquipmentSystem.GetInstance(player).QueueRequest(request);
      return "{\"ok\":true,\"action\":" + XFJson.Str(name) + "}";
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
