// XF Runtime Bridge: the scene as the camera sees it (bridge 0.6, scene.read). Read-only.
//
// One call gathers what an agent needs to judge a shot without looking at it: the active camera's pose, field of view
// and aspect, three calibration points pushed through the game's own projection (the tools build an exact pinhole model
// from them: tools/scene/camera.ts), V (or her photo-mode stand-in), the NPCs near V, XF Finish Showroom's heads and light
// rigs, photo mode's three lights, and the world and UI state. Occlusion is a static-geometry ray from the camera to each
// face (and from each light to V's face), as the game's own spatial queries test sight lines
// (core/systems/spatialQueriesSystem.script:33). Nothing here changes the game.
//
// Sources [source] 2.31: CameraSystem (ProjectPoint, GetActiveCamera*), GameObject.GetNPCsAroundObject (a targeting-system
// query, gameObject.script:685-731), SpatialQueriesSystem.SyncRaycastByCollisionGroup, WeatherSystem (rain only: the
// weather state's name isn't script-readable in vanilla), the UIInteractions blackboard (interactionUIBase.script:30-107).

module XFRuntimeBridge

public abstract class XFScene {
  public static func Arr(v: Vector4) -> String {
    return "[" + XFJson.Num(v.X) + "," + XFJson.Num(v.Y) + "," + XFJson.Num(v.Z) + "]";
  }

  public static func Has(parts: String, part: String) -> Bool {
    return StrLen(parts) == 0 || StrContains("," + parts + ",", "," + part + ",");
  }

  // The world-object rule (0.7, session 7's crash): on a world object of unknown type (what V looks at, an NPC, anything a
  // query returns) the bridge calls only the natives every entity answers (GetEntityID, GetClassName, GetWorldPosition,
  // GetWorldForward, GetWorldYaw), keeps each answer in a local before building text, and reads a record name only after a
  // cast to the class that declares GetRecordID (gamePuppetBase, VehicleObject). It never calls display-name, interaction or
  // device natives on such an object: session 7's player_state on V's apartment door ended in the script VM's String +
  // String operator with a null right operand (exe+0x60a893, the concatenation helper, reached from the operator's native
  // handler at exe+0x285ccc), after GetDisplayName and IsInteractionLookAtTarget on the door (knowledge/game-crashes.md §2.4).
  public static func Identity(object: ref<GameObject>, from: Vector4) -> String {
    let id = EntityID.ToDebugString(object.GetEntityID());
    let cls = object.GetClassName();
    let at = object.GetWorldPosition();
    let distance = Vector4.Distance(at, from);
    let record = "";
    let puppet = object as gamePuppetBase;
    if IsDefined(puppet) {
      let recordId = puppet.GetRecordID();
      record = TDBID.ToStringDEBUG(recordId);
    } else {
      let vehicle = object as VehicleObject;
      if IsDefined(vehicle) {
        let vehicleRecord = vehicle.GetRecordID();
        record = TDBID.ToStringDEBUG(vehicleRecord);
      }
    }
    let out = "\"id\":" + XFJson.Str(id) + ",\"class\":" + XFJson.Name(cls) + ",\"distance\":" + XFJson.Num(distance);
    if StrLen(record) > 0 {
      out += ",\"record\":" + XFJson.Str(record);
    }
    return out;
  }

  // What V looks at (the targeting system's look-at object), by the world-object rule; "null" for nothing.
  public static func LookedAt(player: ref<PlayerPuppet>) -> String {
    let targeting = GameInstance.GetTargetingSystem(GetGameInstance());
    if !IsDefined(targeting) || !IsDefined(player) {
      return "null";
    }
    let looked = targeting.GetLookAtObject(player, true, false);
    if !IsDefined(looked) {
      return "null";
    }
    let from = player.GetWorldPosition();
    return "{" + XFScene.Identity(looked, from) + "}";
  }

  // The HUD's world interaction prompt as the HUD shows it (the UIInteractions blackboard, data only; 0.7: stands in for the
  // look-at object's interaction query, which the world-object rule leaves out).
  public static func Prompt(game: GameInstance) -> String {
    let defs = GetAllBlackboardDefs().UIInteractions;
    let board = GameInstance.GetBlackboardSystem(game).Get(defs);
    if !IsDefined(board) {
      return "null";
    }
    let hub = FromVariant<InteractionChoiceHubData>(board.GetVariant(defs.InteractionChoiceHub));
    let title = GetLocalizedText(hub.title);
    let count = ArraySize(hub.choices);
    return "{\"active\":" + XFJson.Flag(hub.active) + ",\"title\":" + XFJson.Str(title) + ",\"choices\":" + IntToString(count) + "}";
  }

  // A static-geometry ray from a point to a target: blocked when something static is hit more than 12 cm before it.
  public static func Ray(from: Vector4, to: Vector4) -> String {
    let result: TraceResult;
    let d = new Vector4(to.X - from.X, to.Y - from.Y, to.Z - from.Z, 0.0);
    let distance = SqrtF(d.X * d.X + d.Y * d.Y + d.Z * d.Z);
    if distance < 0.3 {
      return "{\"checked\":false,\"why\":\"closer than 30 cm\"}";
    }
    let hit = GameInstance.GetSpatialQueriesSystem(GetGameInstance()).SyncRaycastByCollisionGroup(from, to, n"Static", result, true, false);
    if !hit || !TraceResult.IsValid(result) {
      return "{\"checked\":true,\"blocked\":false,\"target_distance\":" + XFJson.Num(distance) + "}";
    }
    let at = Vector4.Vector3To4(result.position);
    let h = new Vector4(at.X - from.X, at.Y - from.Y, at.Z - from.Z, 0.0);
    let hitDistance = SqrtF(h.X * h.X + h.Y * h.Y + h.Z * h.Z);
    let blocked = hitDistance < distance - 0.12;
    return "{\"checked\":true,\"blocked\":" + XFJson.Flag(blocked) + ",\"hit\":" + XFScene.Arr(at) + ",\"hit_distance\":" + XFJson.Num(hitDistance) + ",\"target_distance\":" + XFJson.Num(distance) + ",\"material\":" + XFJson.Name(result.material) + "}";
  }

  // An object's Head slot (as photo.subject finds V's), else its position plus a standing head height (approximate).
  public static func Head(object: ref<GameObject>, out head: Vector4) -> Bool {
    let transform: WorldTransform;
    let scripted = object as ScriptedPuppet;
    if IsDefined(scripted) {
      let slots = scripted.GetSlotComponent();
      if IsDefined(slots) && slots.GetSlotTransform(n"Head", transform) {
        head = WorldPosition.ToVector4(WorldTransform.GetWorldPosition(transform));
        return true;
      }
    }
    head = object.GetWorldPosition();
    head.Z += 1.62;
    return false;
  }

  // The face point a camera judges an object by: 4.5 cm above the head joint and 8 cm in front (photo.frame's face).
  public static func Face(head: Vector4, forward: Vector4) -> Vector4 {
    return new Vector4(head.X + forward.X * 0.08, head.Y + forward.Y * 0.08, head.Z + 0.045, 1.0);
  }

  // RB-113 (the world-object rule): every native answer in a local before any text is built.
  public static func Subject(object: ref<GameObject>, camera: Vector4, occlusion: Bool) -> String {
    let head: Vector4;
    let slot = XFScene.Head(object, head);
    let forward = object.GetWorldForward();
    let position = object.GetWorldPosition();
    let yaw = object.GetWorldYaw();
    let face = XFScene.Face(head, forward);
    let out = "\"position\":" + XFScene.Arr(position) + ",\"head\":" + XFScene.Arr(head) + ",\"head_slot\":" + XFJson.Flag(slot);
    out += ",\"forward\":" + XFScene.Arr(forward) + ",\"yaw\":" + XFJson.Num(yaw) + ",\"face\":" + XFScene.Arr(face);
    if occlusion {
      out += ",\"occlusion\":" + XFScene.Ray(camera, face);
    }
    return out;
  }

  // scene.read. parts: a comma list of camera, v, npcs, showroom, lights, world, ui ("" = all). radius and maxNpcs bound
  // the NPC query; pieceEyes is a showroom head's eyes in its entity frame (from the showroom build's manifest).
  public static func Read(cid: String, parts: String, radius: Float, maxNpcs: Int32, occlusion: Bool, eyeX: Float, eyeY: Float, eyeZ: Float) -> String {
    let game = GetGameInstance();
    let phase = XFBridgeActions.Phase();
    let out = "{\"ok\":true,\"phase\":" + XFJson.Str(phase);
    let cameraSystem = GameInstance.GetCameraSystem(game);
    let transform: Transform;
    let hasCamera = IsDefined(cameraSystem) && cameraSystem.GetActiveCameraWorldTransform(transform);
    let camPos = transform.position;
    let photo = GameInstance.GetPhotoModeSystem(game).IsPhotoModeActive();
    if hasCamera {
      let f = cameraSystem.GetActiveCameraForward();
      let r = cameraSystem.GetActiveCameraRight();
      let u = cameraSystem.GetActiveCameraUp();
      out += ",\"camera\":{\"position\":" + XFScene.Arr(camPos) + ",\"forward\":" + XFScene.Arr(f) + ",\"right\":" + XFScene.Arr(r) + ",\"up\":" + XFScene.Arr(u);
      out += ",\"fov\":" + XFJson.Num(cameraSystem.GetActiveCameraFOV()) + ",\"aspect\":" + XFJson.Num(cameraSystem.GetAspectRatio()) + ",\"mode\":" + XFJson.Str(photo ? "photo" : phase) + "}";
      let center = new Vector4(camPos.X + f.X, camPos.Y + f.Y, camPos.Z + f.Z, 1.0);
      let up = new Vector4(center.X + u.X * 0.1, center.Y + u.Y * 0.1, center.Z + u.Z * 0.1, 1.0);
      let right = new Vector4(center.X + r.X * 0.1, center.Y + r.Y * 0.1, center.Z + r.Z * 0.1, 1.0);
      let far = new Vector4(camPos.X + f.X * 5.0, camPos.Y + f.Y * 5.0, camPos.Z + f.Z * 5.0, 1.0);
      out += ",\"calibration\":{\"center\":" + XFPhoto.Screen(cameraSystem.ProjectPoint(center)) + ",\"up\":" + XFPhoto.Screen(cameraSystem.ProjectPoint(up));
      out += ",\"right\":" + XFPhoto.Screen(cameraSystem.ProjectPoint(right)) + ",\"far\":" + XFPhoto.Screen(cameraSystem.ProjectPoint(far)) + "}";
    }
    let player = GetPlayer(game);
    let registry = XFBridgeRegistry.Get();
    if XFScene.Has(parts, "v") && IsDefined(player) {
      let subject: wref<GameObject> = player;
      let source = "player";
      if photo && IsDefined(registry) && IsDefined(registry.GetPhotoPuppet()) {
        subject = registry.GetPhotoPuppet();
        source = "photo_puppet";
      }
      out += ",\"v\":{\"source\":" + XFJson.Str(source) + "," + XFScene.Subject(subject, camPos, occlusion && hasCamera && photo) + "}";
    }
    if XFScene.Has(parts, "npcs") && IsDefined(player) && maxNpcs > 0 && radius > 0.0 {
      let npcs = player.GetNPCsAroundObject(radius);
      out += ",\"npcs\":[";
      let written = 0;
      let i = 0;
      while i < ArraySize(npcs) && written < maxNpcs {
        let npc = npcs[i];
        if IsDefined(npc) && npc != player {
          if written > 0 {
            out += ",";
          }
          // 0.7: the world-object rule (Identity): the record name instead of GetDisplayName.
          let dead = npc.IsDead();
          out += "{" + XFScene.Identity(npc, player.GetWorldPosition()) + ",\"dead\":" + XFJson.Flag(dead) + "," + XFScene.Subject(npc, camPos, occlusion && hasCamera) + "}";
          written += 1;
        }
        i += 1;
      }
      out += "],\"npcs_found\":" + IntToString(ArraySize(npcs));
    }
    if XFScene.Has(parts, "showroom") {
      out += ",\"showroom\":" + XFScene.Showroom(camPos, occlusion && hasCamera, new Vector4(eyeX, eyeY, eyeZ, 0.0));
    }
    if XFScene.Has(parts, "lights") {
      out += ",\"lights\":" + XFScene.Lights(player, registry, photo);
    }
    if XFScene.Has(parts, "world") {
      let time = GameInstance.GetTimeSystem(game);
      let now = time.GetGameTime();
      let weather = GameInstance.GetWeatherSystem(game);
      out += ",\"world\":{\"time\":{\"hours\":" + IntToString(GameTime.Hours(now)) + ",\"minutes\":" + IntToString(GameTime.Minutes(now)) + ",\"seconds\":" + IntToString(GameTime.Seconds(now)) + "}";
      out += ",\"clock_paused\":" + XFJson.Flag(time.IsPausedState());
      if IsDefined(weather) {
        out += ",\"rain\":{\"type\":" + XFJson.Str(EnumValueToString("worldRainIntensity", Cast<Int64>(EnumInt(weather.GetRainIntensityType())))) + ",\"intensity\":" + XFJson.Num(weather.GetRainIntensity()) + ",\"puddles\":" + XFJson.Num(weather.GetRainPuddles()) + "}";
      }
      if IsDefined(registry) {
        out += ",\"bridge_world_frozen\":" + XFJson.Flag(registry.IsWorldFrozen());
      }
      out += "}";
    }
    if XFScene.Has(parts, "ui") {
      out += ",\"ui\":" + XFScene.Ui(game, registry, photo);
    }
    XFBridgeLog.Debug(cid, "scene read parts=" + parts);
    return out + "}";
  }

  public static func Showroom(camPos: Vector4, occlusion: Bool, eyes: Vector4) -> String {
    let registry = XFShowroomRegistry.Get();
    if !IsDefined(registry) {
      return "{\"pieces\":[],\"rigs\":[]}";
    }
    let pieces = "[";
    let rigs = "[";
    for item in registry.Items() {
      let yaw = Deg2Rad(item.yaw);
      let c = CosF(yaw);
      let s = SinF(yaw);
      let at = new Vector4(item.position.X + c * eyes.X - s * eyes.Y, item.position.Y + s * eyes.X + c * eyes.Y, item.position.Z + eyes.Z, 1.0);
      let text = "{\"index\":" + IntToString(item.index) + ",\"label\":" + XFJson.Str(item.label) + ",\"appearance\":" + XFJson.Str(item.appearance) + ",\"position\":" + XFScene.Arr(item.position) + ",\"yaw\":" + XFJson.Num(item.yaw) + ",\"base_yaw\":" + XFJson.Num(item.baseYaw);
      if Equals(item.kind, "pieces") {
        text += ",\"eyes\":" + XFScene.Arr(at);
        if occlusion {
          text += ",\"occlusion\":" + XFScene.Ray(camPos, at);
        }
        if StrLen(pieces) > 1 {
          pieces += ",";
        }
        pieces += text + "}";
      } else {
        if StrLen(rigs) > 1 {
          rigs += ",";
        }
        rigs += text + "}";
      }
    }
    return "{\"pieces\":" + pieces + "],\"rigs\":" + rigs + "]}";
  }

  // Photo mode's three lights: whether the menu's light indicator names each one's entity, where it is and where it points,
  // and a static-geometry ray from it to V's face (does it reach). The menu's values (on, brightness, colour) belong to the
  // selected light only; the tools add them from photo.state. The light components' own values aren't script-readable
  // (knowledge/photo-mode-lights.md, open question 1).
  public static func Lights(player: ref<PlayerPuppet>, registry: ref<XFBridgeRegistry>, photo: Bool) -> String {
    let out = "{\"photo\":[";
    if photo {
      let head: Vector4;
      let facing: Vector4;
      let hasHead = XFPhoto.HeadAndFacing(head, facing);
      let face = XFScene.Face(head, facing);
      let i = 1;
      while i <= 3 {
        if i > 1 {
          out += ",";
        }
        // A read needs less certainty than a move (XFPhoto.LightEntity also wants the menu to show this light): the light
        // indicator's projection for the light, if it follows a photo-mode light object.
        let controller = XFPhoto.Controller();
        let entity: ref<Entity>;
        if IsDefined(controller) {
          entity = controller.XFBridgeLightEntity(i - 1);
        }
        let light = IsDefined(entity) && entity.IsA(n"gamePhotomodeLightObject") ? entity as GameObject : null;
        out += "{\"light\":" + IntToString(i) + ",\"found\":" + XFJson.Flag(IsDefined(light));
        if IsDefined(light) {
          // RB-113: the light's answers in locals before the text is built (the world-object rule).
          let lightAt = light.GetWorldPosition();
          let lightForward = light.GetWorldForward();
          out += ",\"position\":" + XFScene.Arr(lightAt) + ",\"forward\":" + XFScene.Arr(lightForward);
          if IsDefined(controller) {
            out += ",\"selected\":" + XFJson.Flag(controller.XFBridgeLightIndicatorIndex() == i - 1);
          }
          if hasHead {
            out += ",\"to_face\":" + XFScene.Ray(lightAt, face);
          }
        } else {
          out += ",\"why\":" + XFJson.Str(IsDefined(entity) ? "the light indicator follows something that isn't a photo-mode light" : "no light entity for it (off, or not placed yet)");
        }
        out += "}";
        i += 1;
      }
      out += "]";
    } else {
      out += "]";
    }
    return out + ",\"world_lights\":\"not read: the world's own lights aren't listed to scripts (research)\"}";
  }

  public static func Ui(game: GameInstance, registry: ref<XFBridgeRegistry>, photo: Bool) -> String {
    let defs = GetAllBlackboardDefs();
    let system = GameInstance.GetBlackboardSystem(game);
    let out = "{\"menu_open\":" + XFJson.Flag(system.Get(defs.UI_System).GetBool(defs.UI_System.IsInMenu)) + ",\"photo_mode\":" + XFJson.Flag(photo);
    if IsDefined(registry) {
      out += ",\"photo_ui_hidden\":" + XFJson.Flag(registry.IsPhotoUiHidden()) + ",\"cursor_hidden\":" + XFJson.Flag(registry.IsCursorHidden());
    }
    out += ",\"interaction\":" + XFScene.Interactions(game) + "}";
    return out;
  }

  // What the HUD offers: the world interaction prompt and the dialogue hubs, as the HUD's own controllers read them
  // (player.interact.list's answer too).
  public static func Interactions(game: GameInstance) -> String {
    let defs = GetAllBlackboardDefs().UIInteractions;
    let board = GameInstance.GetBlackboardSystem(game).Get(defs);
    if !IsDefined(board) {
      return "{\"available\":false}";
    }
    let hub = FromVariant<InteractionChoiceHubData>(board.GetVariant(defs.InteractionChoiceHub));
    let out = "{\"available\":true,\"hub\":{\"id\":" + IntToString(hub.id) + ",\"active\":" + XFJson.Flag(hub.active) + ",\"title\":" + XFJson.Str(GetLocalizedText(hub.title)) + ",\"choices\":[";
    let i = 0;
    while i < ArraySize(hub.choices) {
      if i > 0 {
        out += ",";
      }
      let choice = hub.choices[i];
      out += "{\"index\":" + IntToString(i) + ",\"label\":" + XFJson.Str(GetLocalizedText(choice.localizedName)) + ",\"input_action\":" + XFJson.Name(choice.inputAction) + ",\"hold\":" + XFJson.Flag(choice.isHoldAction) + "}";
      i += 1;
    }
    out += "]},\"dialog\":[";
    let dialog = FromVariant<DialogChoiceHubs>(board.GetVariant(defs.DialogChoiceHubs));
    i = 0;
    while i < ArraySize(dialog.choiceHubs) {
      if i > 0 {
        out += ",";
      }
      let list = dialog.choiceHubs[i];
      out += "{\"id\":" + IntToString(list.id) + ",\"title\":" + XFJson.Str(GetLocalizedText(list.title)) + ",\"choices\":[";
      let j = 0;
      while j < ArraySize(list.choices) {
        if j > 0 {
          out += ",";
        }
        out += "{\"index\":" + IntToString(j) + ",\"label\":" + XFJson.Str(GetLocalizedText(list.choices[j].localizedName)) + ",\"input_action\":" + XFJson.Name(list.choices[j].inputActionName) + "}";
        j += 1;
      }
      out += "]}";
      i += 1;
    }
    out += "],\"active_hub\":" + IntToString(board.GetInt(defs.ActiveChoiceHubID)) + ",\"selected\":" + IntToString(board.GetInt(defs.SelectedIndex)) + "}";
    return out;
  }

  // scene.read's points: one world point through the game's own projection.
  public static func Project(cid: String, x: Float, y: Float, z: Float) -> String {
    let cameraSystem = GameInstance.GetCameraSystem(GetGameInstance());
    if !IsDefined(cameraSystem) {
      return XFJson.Fail("unavailable", "the camera system isn't available");
    }
    return "{\"ok\":true,\"screen\":" + XFPhoto.Screen(cameraSystem.ProjectPoint(new Vector4(x, y, z, 1.0))) + "}";
  }
}
