// XF Runtime Bridge: XF Finish Showroom (bridge 0.5). Spawns the XF Finish Showroom test mod's mannequin heads and
// creator-style light rigs in front of V, turns the heads for highlight sweeps, and removes them again.
//
// Called by the native plugin like the other layers: one static function per step, each answering a JSON object as a
// String. The plugin gates every write behind the "showroom" write class, which only the test profile's -writes build
// lists, and checks the templates before they get here (only the showroom's own two entities, core/Showroom.cpp).
//
// Spawning goes through Codeware's static entity system (StaticEntitySystem: no persistence, no streaming, tags remove a
// group; knowledge/skin-on-spawned-objects.md §3). Codeware is detected, never required: without it this file compiles
// the second XFShowroom below, whose functions refuse with codeware_missing and a plain next step. Loading a save removes
// every spawned entity with the world, and this session's registry with it; the kill switch calls Clear("all").
// Vanilla 2.31 script types plus Codeware's; linted against the game's bundle with Codeware's scripts
// (tools/lint-redscript.ts --codeware).

module XFRuntimeBridge

// One spawned head or rig, as the bridge placed it.
public class XFShowroomItem {
  public let kind: String; // "pieces" or "lights"
  public let index: Int32;
  public let label: String;
  public let appearance: String;
  public let id: EntityID;
  public let position: Vector4;
  public let baseYaw: Float;
  public let yaw: Float;
}

// One per game session: what the bridge spawned. A loaded save starts a new one, as the entities went with the old world.
public class XFShowroomRegistry extends ScriptableSystem {
  private let m_items: array<ref<XFShowroomItem>>;

  public static func Get() -> ref<XFShowroomRegistry> {
    let game = GetGameInstance();
    if !GameInstance.IsValid(game) {
      return null;
    }
    let container = GameInstance.GetScriptableSystemsContainer(game);
    if !IsDefined(container) {
      return null;
    }
    return container.Get(n"XFRuntimeBridge.XFShowroomRegistry") as XFShowroomRegistry;
  }

  public func Add(item: ref<XFShowroomItem>) -> Void {
    ArrayPush(this.m_items, item);
  }

  public func Items() -> array<ref<XFShowroomItem>> {
    return this.m_items;
  }

  public func Piece(index: Int32) -> ref<XFShowroomItem> {
    for item in this.m_items {
      if Equals(item.kind, "pieces") && item.index == index {
        return item;
      }
    }
    return null;
  }

  // Forgets every item of a kind ("pieces", "lights" or "all"); answers how many.
  public func Forget(what: String) -> Int32 {
    let kept: array<ref<XFShowroomItem>>;
    let removed = 0;
    for item in this.m_items {
      if Equals(what, "all") || Equals(what, item.kind) {
        removed += 1;
      } else {
        ArrayPush(kept, item);
      }
    }
    this.m_items = kept;
    return removed;
  }

  public func Count(kind: String) -> Int32 {
    let n = 0;
    for item in this.m_items {
      if Equals(item.kind, kind) {
        n += 1;
      }
    }
    return n;
  }
}

public abstract class XFShowroomText {
  public static func Arr(v: Vector4) -> String {
    return "[" + XFJson.Num(v.X) + "," + XFJson.Num(v.Y) + "," + XFJson.Num(v.Z) + "]";
  }

  public static func Tag(kind: String) -> CName {
    if Equals(kind, "pieces") {
      return n"xfs_showroom_piece";
    }
    return n"xfs_showroom_light";
  }

  // V in the world, or V's photo-mode stand-in while photo mode is open.
  public static func V() -> ref<GameObject> {
    let registry = XFBridgeRegistry.Get();
    if XFPhoto.Active() && IsDefined(registry) {
      let puppet: ref<GameObject> = registry.GetPhotoPuppet();
      if IsDefined(puppet) {
        return puppet;
      }
    }
    return GetPlayer(GetGameInstance());
  }

  public static func Refusal() -> String {
    let phase = XFBridgeActions.Phase();
    if NotEquals(phase, "gameplay") && NotEquals(phase, "photo_mode") {
      return XFJson.Fail("not_in_world", "the showroom works in normal play and photo mode; the game is in '" + phase + "'");
    }
    let player = GetPlayer(GetGameInstance());
    if !IsDefined(player) || player.IsReplacer() {
      return XFJson.Fail("not_v", "the player isn't V right now");
    }
    return "";
  }

  // Where V (or her photo-mode stand-in) and the camera are and which way they face, for the tools' layout.
  public static func Anchor(codeware: Bool, version: String) -> String {
    let out = "{\"ok\":true,\"codeware\":" + XFJson.Flag(codeware);
    if codeware {
      out += ",\"codeware_version\":" + XFJson.Str(version);
    }
    out += ",\"phase\":" + XFJson.Str(XFBridgeActions.Phase());
    let v = XFShowroomText.V();
    if IsDefined(v) {
      out += ",\"v\":{\"position\":" + XFShowroomText.Arr(v.GetWorldPosition()) + ",\"forward\":" + XFShowroomText.Arr(v.GetWorldForward());
      out += ",\"stand_in\":" + XFJson.Flag(v != GetPlayer(GetGameInstance())) + "}";
    }
    let camera = GameInstance.GetCameraSystem(GetGameInstance());
    let transform: Transform;
    if IsDefined(camera) && camera.GetActiveCameraWorldTransform(transform) {
      out += ",\"camera\":{\"position\":" + XFShowroomText.Arr(transform.position) + ",\"forward\":" + XFShowroomText.Arr(camera.GetActiveCameraForward()) + "}";
    }
    return out + "}";
  }
}

@if(ModuleExists("Codeware"))
public abstract class XFShowroom {
  public static func Anchor(cid: String) -> String {
    XFBridgeLog.Debug(cid, "showroom anchor");
    return XFShowroomText.Anchor(true, Codeware.Version());
  }

  public static func Spawn(cid: String, kind: String, template: ResRef, appearance: String, label: String, index: Int32, x: Float, y: Float, z: Float, yaw: Float) -> String {
    let refusal = XFShowroomText.Refusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    let system = GameInstance.GetStaticEntitySystem();
    let registry = XFShowroomRegistry.Get();
    if !IsDefined(system) || !system.IsReady() || !IsDefined(registry) {
      return XFJson.Fail("not_ready", "the game can't spawn entities yet; try again in a moment");
    }
    if !GameInstance.GetResourceDepot().ResourceExists(template) {
      return XFJson.Fail("showroom_missing", "the XF Finish Showroom archive that holds this " + kind + " entity isn't loaded; stage the showroom build and restart the game");
    }
    let player = GetPlayer(GetGameInstance());
    let position = new Vector4(x, y, z, 1.0);
    if Vector4.Distance(player.GetWorldPosition(), position) > 30.0 {
      return XFJson.Fail("too_far", "that place is more than 30 m from V");
    }
    let angles: EulerAngles;
    angles.Yaw = yaw;
    let spec = new StaticEntitySpec();
    spec.templatePath = template;
    spec.appearanceName = StringToName(appearance);
    spec.position = position;
    spec.orientation = EulerAngles.ToQuat(angles);
    spec.attached = true;
    ArrayPush(spec.tags, n"xfs_showroom");
    ArrayPush(spec.tags, XFShowroomText.Tag(kind));
    let id = system.SpawnEntity(spec);
    if !EntityID.IsDefined(id) {
      return XFJson.Fail("spawn_refused", "the game's entity spawner refused the " + kind + " entity");
    }
    let item = new XFShowroomItem();
    item.kind = kind;
    item.index = index;
    item.label = label;
    item.appearance = appearance;
    item.id = id;
    item.position = position;
    item.baseYaw = yaw;
    item.yaw = yaw;
    registry.Add(item);
    // A spawned entity is a change a save would keep only if it persisted; static entities don't, but the save lock is
    // held anyway while the bridge has changed the world.
    XFBridgeActions.EnsureSaveLock(cid);
    XFBridgeLog.Info(cid, "showroom spawned " + kind + " " + IntToString(index) + " " + appearance);
    return "{\"ok\":true,\"entity\":" + XFJson.Str(EntityID.ToDebugString(id)) + ",\"spawning\":true}";
  }

  public static func Turn(cid: String, index: Int32, yaw: Float) -> String {
    let refusal = XFShowroomText.Refusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    let registry = XFShowroomRegistry.Get();
    let item = IsDefined(registry) ? registry.Piece(index) : null;
    if !IsDefined(item) {
      return XFJson.Fail("no_such_piece", "the showroom has no piece " + IntToString(index));
    }
    let system = GameInstance.GetStaticEntitySystem();
    let entity = system.GetEntity(item.id) as GameObject;
    if !system.IsSpawned(item.id) || !IsDefined(entity) {
      return XFJson.Fail("not_spawned_yet", "piece " + IntToString(index) + " isn't in the world yet; try again in a moment");
    }
    let previous = item.yaw;
    let angles: EulerAngles;
    angles.Yaw = yaw;
    GameInstance.GetTeleportationFacility(GetGameInstance()).Teleport(entity, item.position, angles);
    item.yaw = yaw;
    XFBridgeLog.Debug(cid, "showroom turned piece " + IntToString(index) + " to " + FloatToString(yaw));
    return "{\"ok\":true,\"index\":" + IntToString(index) + ",\"previous_yaw\":" + XFJson.Num(previous) + ",\"yaw\":" + XFJson.Num(yaw) + "}";
  }

  public static func Clear(cid: String, what: String) -> String {
    let system = GameInstance.GetStaticEntitySystem();
    let registry = XFShowroomRegistry.Get();
    let pieces = 0;
    let lights = 0;
    if IsDefined(registry) {
      if Equals(what, "all") || Equals(what, "pieces") {
        pieces = registry.Forget("pieces");
      }
      if Equals(what, "all") || Equals(what, "lights") {
        lights = registry.Forget("lights");
      }
    }
    if IsDefined(system) {
      // By tag, so an entity the registry lost track of goes too.
      if Equals(what, "all") || Equals(what, "pieces") {
        system.DespawnTagged(n"xfs_showroom_piece");
      }
      if Equals(what, "all") || Equals(what, "lights") {
        system.DespawnTagged(n"xfs_showroom_light");
      }
    }
    XFBridgeLog.Info(cid, "showroom cleared " + what + ": pieces=" + IntToString(pieces) + " lights=" + IntToString(lights));
    return "{\"ok\":true,\"removed_pieces\":" + IntToString(pieces) + ",\"removed_lights\":" + IntToString(lights) + "}";
  }

  public static func Status(cid: String) -> String {
    let system = GameInstance.GetStaticEntitySystem();
    let registry = XFShowroomRegistry.Get();
    let pieces = "";
    let lights = "";
    let pending = 0;
    if IsDefined(registry) && IsDefined(system) {
      for item in registry.Items() {
        let spawned = system.IsSpawned(item.id);
        if !spawned {
          pending += 1;
        }
        let position = item.position;
        let entity = system.GetEntity(item.id);
        if spawned && IsDefined(entity) {
          position = entity.GetWorldPosition();
        }
        let entry = "{\"index\":" + IntToString(item.index) + ",\"label\":" + XFJson.Str(item.label) + ",\"appearance\":" + XFJson.Str(item.appearance);
        entry += ",\"entity\":" + XFJson.Str(EntityID.ToDebugString(item.id)) + ",\"spawned\":" + XFJson.Flag(spawned);
        entry += ",\"position\":" + XFShowroomText.Arr(position) + ",\"yaw\":" + XFJson.Num(item.yaw) + ",\"base_yaw\":" + XFJson.Num(item.baseYaw) + "}";
        if Equals(item.kind, "pieces") {
          pieces += (StrLen(pieces) > 0 ? "," : "") + entry;
        } else {
          lights += (StrLen(lights) > 0 ? "," : "") + entry;
        }
      }
    }
    XFBridgeLog.Debug(cid, "showroom status pending=" + IntToString(pending));
    return "{\"ok\":true,\"codeware\":true,\"pieces\":[" + pieces + "],\"lights\":[" + lights + "],\"pending\":" + IntToString(pending) + "}";
  }
}

@if(!ModuleExists("Codeware"))
public abstract class XFShowroom {
  public static func Missing() -> String {
    return XFJson.Fail("codeware_missing", "the showroom spawns its heads and lights through Codeware, which isn't installed; install Codeware 1.20 or newer from its official release page");
  }

  public static func Anchor(cid: String) -> String {
    return XFShowroomText.Anchor(false, "");
  }

  public static func Spawn(cid: String, kind: String, template: ResRef, appearance: String, label: String, index: Int32, x: Float, y: Float, z: Float, yaw: Float) -> String {
    return XFShowroom.Missing();
  }

  public static func Turn(cid: String, index: Int32, yaw: Float) -> String {
    return XFShowroom.Missing();
  }

  // Nothing was spawned without Codeware, so there is nothing to clear (the kill switch calls this).
  public static func Clear(cid: String, what: String) -> String {
    return "{\"ok\":true,\"removed_pieces\":0,\"removed_lights\":0}";
  }

  public static func Status(cid: String) -> String {
    return "{\"ok\":true,\"codeware\":false,\"pieces\":[],\"lights\":[],\"pending\":0}";
  }
}
