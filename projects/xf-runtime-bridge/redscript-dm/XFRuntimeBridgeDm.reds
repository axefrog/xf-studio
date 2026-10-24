// XF Runtime Bridge 0.8.12: the live-direction toolkit's game side (research/runtime/runtime-bridge-design.md §3.21,
// knowledge/player-channels.md, research/runtime/bridge-hook-inventory.md "0.8.12 live-direction toolkit").
//
// The -writes package only (like redscript-probes/): the wraps below sit on three HUD controllers and must not ship in the
// distribution package. The native plugin decides everything (core/DmService.cpp: refusals, limits, undos, events, the
// session of watchers, the call's state machine, timed lines and the quest records); this file only acts and reports, one
// static function per step, each answering a JSON object as a String (XFJson), like the other layers.
//
// What it drives, and the evidence ([source] 2.31 final.redscripts decompiled with redscript-cli 0.5.31, Codeware 1.20.6):
//   * Props and vehicles: Codeware's DynamicEntitySystem, never persistent (both persist flags off), tagged xfs_dm
//     (Codeware wiki "Spawning dynamic entities": a record for a vehicle, a template path for a prop).
//   * Doors: DoorControllerPS's own quest actions (ForceOpen, ForceClose, ForceLock, ForceUnlock, ForceSeal, ForceUnseal),
//     built the way GetQuestActionByName builds them (doorController.script:560-620, 1075-1262) and queued through the
//     persistency system. Vehicles: VehicleQuestChangeDoorStateEvent on the vehicle's PS (vehicleComponentPS.script:1365),
//     VehicleQuestToggleEngineEvent, VehicleLightQuestToggleEvent and VehicleRadioEvent on the entity (vehicleComponent.script).
//   * Sound: AudioSystem.Play / Stop (audioSystem.script) and GameObject.PlayVoiceOver.
//   * The phone: a real call through PhoneSystem's questTriggerCallRequest for a contact the player's journal has
//     (phoneSystem.script:79-120, incomingCallController.script, newHudPhoneGameController.script:909-1090); a call from a
//     name the journal lacks would run the HUD's null-contact calls (the family that crashed session 7), so it is refused.
//     A message toast is PhoneMessageNotificationViewData on the HUD phone controller, as Night City Allies pushes its own.
//   * The quest tracker: the tracked-mappin container of QuestTrackerGameController, filled the way the game fills it
//     (quest_tracker.script:153-171) with our own text through QuestTrackerObjectiveLogicController.SetData (plain strings; the
//     game itself passes a null objective entry here). Never the journal.
//   * Messages: the UI_Notifications blackboard's WarningMessage and OnscreenMessage (reactionComponent.script:3177), the quest
//     toasts through JournalNotificationQueue (journalNotification.script:206-440), subtitle lines on UIGameData.ShowDialogLine.
//   * Lights: LightComponent.SetColor / SetIntensity / SetRadius / SetFlickerParams and gameLightComponent.SetAngles /
//     ToggleLight on the first light component an entity holds (lightComponent.script, gameLightComponent.script).
//   * Reads: V, the camera, the targeting system's look-at, the player state machine, QuestsSystem facts, and the
//     UIInteractions blackboard (LastAttemptedChoice, SelectedIndex, DialogChoiceHubs), listened to only while a watcher wants
//     events and unregistered at detach.
// Every change takes the bridge's save lock first (XFBridgeActions.EnsureSaveLock). Every hook that fires from the game's own
// UI checks XFBridge_Live() first (a load closes the gate before it detaches).

module XFRuntimeBridge

// One thing the bridge brought in.
public class XFDmEntry {
  public let handle: Int32;
  public let kind: String;
  public let id: EntityID;
}

// One per game session: what the bridge brought in, the entities it has resolved, the HUD controllers it found, the events its
// listeners collected. A load starts a new one.
public class XFDmRegistry extends ScriptableSystem {
  private let m_entries: array<ref<XFDmEntry>>;
  private let m_known: array<EntityID>;
  private let m_events: array<String>;
  private let m_listening: Bool;
  private let m_attemptCb: ref<CallbackHandle>;
  private let m_indexCb: ref<CallbackHandle>;
  private let m_lastIndex: Int32;
  private let m_hubId: Int32;
  private let m_hubActive: Bool;
  private let m_hubCaptions: array<String>;
  private let m_tracker: String;
  private let m_trackerHost: wref<QuestTrackerGameController>;
  private let m_toastHost: wref<JournalNotificationQueue>;
  private let m_phoneHost: wref<NewHudPhoneGameController>;
  private let m_lines: array<Int32>;
  private let m_callContact: String;
  private let m_warning: String;
  private let m_onscreen: String;

  public static func Get() -> ref<XFDmRegistry> {
    let game = GetGameInstance();
    if !GameInstance.IsValid(game) {
      return null;
    }
    let container = GameInstance.GetScriptableSystemsContainer(game);
    if !IsDefined(container) {
      return null;
    }
    return container.Get(n"XFRuntimeBridge.XFDmRegistry") as XFDmRegistry;
  }

  private func OnDetach() -> Void {
    this.Listen(false);
  }

  public func Add(entry: ref<XFDmEntry>) -> Void {
    ArrayPush(this.m_entries, entry);
    this.Remember(entry.id);
  }

  public func Entries() -> array<ref<XFDmEntry>> {
    return this.m_entries;
  }

  public func ForgetEntry(id: EntityID) -> Void {
    let i = ArraySize(this.m_entries) - 1;
    while i >= 0 {
      if Equals(this.m_entries[i].id, id) { ArrayErase(this.m_entries, i); }
      i -= 1;
    }
  }

  public func ForgetEntries() -> Void {
    ArrayClear(this.m_entries);
  }

  // The entities this layer has resolved by id text, so a later call that names one finds it again (a decimal id is not
  // always convertible without Codeware).
  public func Remember(id: EntityID) -> Void {
    if !EntityID.IsDefined(id) {
      return;
    }
    let text = EntityID.ToDebugString(id);
    for known in this.m_known {
      if Equals(EntityID.ToDebugString(known), text) {
        return;
      }
    }
    if ArraySize(this.m_known) >= 64 {
      ArrayErase(this.m_known, 0);
    }
    ArrayPush(this.m_known, id);
  }

  public func Lookup(text: String, out id: EntityID) -> Bool {
    for known in this.m_known {
      if Equals(EntityID.ToDebugString(known), text) {
        id = known;
        return true;
      }
    }
    return false;
  }

  public func SetTrackerHost(host: ref<QuestTrackerGameController>) -> Void {
    this.m_trackerHost = host;
  }

  public func TrackerHost() -> wref<QuestTrackerGameController> {
    return this.m_trackerHost;
  }

  public func SetTracker(spec: String) -> Void {
    this.m_tracker = spec;
  }

  public func TrackerSpec() -> String {
    return this.m_tracker;
  }

  public func SetToastHost(host: ref<JournalNotificationQueue>) -> Void {
    this.m_toastHost = host;
  }

  public func ToastHost() -> wref<JournalNotificationQueue> {
    return this.m_toastHost;
  }

  public func SetPhoneHost(host: ref<NewHudPhoneGameController>) -> Void {
    this.m_phoneHost = host;
  }

  public func PhoneHost() -> wref<NewHudPhoneGameController> {
    return this.m_phoneHost;
  }

  public func AddLine(n: Int32) -> Void {
    if !ArrayContains(this.m_lines, n) { ArrayPush(this.m_lines, n); }
  }

  public func Lines() -> array<Int32> {
    return this.m_lines;
  }

  public func ForgetLine(n: Int32) -> Void {
    let i = ArraySize(this.m_lines) - 1;
    while i >= 0 {
      if this.m_lines[i] == n { ArrayErase(this.m_lines, i); }
      i -= 1;
    }
  }

  public func ForgetLines() -> Void {
    ArrayClear(this.m_lines);
  }

  public func SetCallContact(contact: String) -> Void {
    this.m_callContact = contact;
  }

  public func CallContact() -> String {
    return this.m_callContact;
  }

  public func SetBanner(style: String, text: String) -> Void {
    if Equals(style, "warning") { this.m_warning = text; } else { this.m_onscreen = text; }
  }

  public func BannerText(style: String) -> String {
    return Equals(style, "warning") ? this.m_warning : this.m_onscreen;
  }

  // The events the listeners collected since the last sample (JSON objects), at most 16.
  public func PushEvent(json: String) -> Void {
    if ArraySize(this.m_events) >= 16 {
      ArrayErase(this.m_events, 0);
    }
    ArrayPush(this.m_events, json);
  }

  public func DrainEvents() -> String {
    let out = "";
    for event in this.m_events {
      out += (StrLen(out) > 0 ? "," : "") + event;
    }
    ArrayClear(this.m_events);
    return out;
  }

  // The interaction listeners, registered only while a watcher wants events and taken down at detach: a listener left on a
  // blackboard that a load destroyed is a crash risk (knowledge/game-events.md).
  public func Listen(on: Bool) -> Void {
    if (on && this.m_listening) || (!on && !this.m_listening) {
      return;
    }
    let game = this.GetGameInstance();
    let defs = GetAllBlackboardDefs().UIInteractions;
    let board = GameInstance.GetBlackboardSystem(game).Get(defs);
    if !IsDefined(board) {
      this.m_listening = false;
      return;
    }
    if on {
      this.m_attemptCb = board.RegisterListenerVariant(defs.LastAttemptedChoice, this, n"OnXFDmAttempt");
      this.m_indexCb = board.RegisterListenerInt(defs.SelectedIndex, this, n"OnXFDmIndex");
      this.m_lastIndex = -1;
    } else {
      board.UnregisterListenerVariant(defs.LastAttemptedChoice, this.m_attemptCb);
      board.UnregisterListenerInt(defs.SelectedIndex, this.m_indexCb);
      this.m_attemptCb = null;
      this.m_indexCb = null;
      this.m_hubActive = false;
      this.m_hubId = -1;
      ArrayClear(this.m_hubCaptions);
    }
    this.m_listening = on;
  }

  public func Listening() -> Bool {
    return this.m_listening;
  }

  protected cb func OnXFDmAttempt(value: Variant) -> Bool {
    if !XFBridge_Live() {
      return false;
    }
    let attempt = FromVariant<InteractionAttemptedChoice>(value);
    let raw = attempt.choice.caption;
    let text = GetLocalizedText(raw);
    if StrLen(text) == 0 {
      text = raw;
    }
    let target = "";
    let player = XFPlayer.Player();
    let targeting = GameInstance.GetTargetingSystem(this.GetGameInstance());
    if IsDefined(player) && IsDefined(targeting) {
      let looked = targeting.GetLookAtObject(player, false, false);
      if IsDefined(looked) {
        target = EntityID.ToDebugString(looked.GetEntityID());
        this.Remember(looked.GetEntityID());
      }
    }
    this.PushEvent("{\"type\":\"interact\",\"caption\":" + XFJson.Str(text) + ",\"index\":" + IntToString(attempt.choiceIdx) + ",\"success\":" + XFJson.Flag(attempt.isSuccess) + ",\"target\":" + XFJson.Str(target) + "}");
    return true;
  }

  protected cb func OnXFDmIndex(value: Int32) -> Bool {
    this.m_lastIndex = value;
    return true;
  }

  // The dialogue hub the game shows: remembered while it is active; when it goes, the last highlighted choice is taken as the
  // pick (no script callback names a pick [hypothesis]).
  public func NoteHubs() -> Void {
    if !this.m_listening {
      return;
    }
    let defs = GetAllBlackboardDefs().UIInteractions;
    let board = GameInstance.GetBlackboardSystem(this.GetGameInstance()).Get(defs);
    if !IsDefined(board) {
      return;
    }
    let hubs = FromVariant<DialogChoiceHubs>(board.GetVariant(defs.DialogChoiceHubs));
    let activeId = -1;
    let captions: array<String>;
    for hub in hubs.choiceHubs {
      if Equals(hub.activityState, EVisualizerActivityState.Active) {
        activeId = hub.id;
        ArrayClear(captions);
        for choice in hub.choices {
          ArrayPush(captions, choice.localizedName);
        }
      }
    }
    if activeId >= 0 {
      this.m_hubActive = true;
      this.m_hubId = activeId;
      this.m_hubCaptions = captions;
      return;
    }
    if this.m_hubActive {
      let index = this.m_lastIndex;
      let caption = "";
      if index >= 0 && index < ArraySize(this.m_hubCaptions) {
        caption = this.m_hubCaptions[index];
      }
      this.PushEvent("{\"type\":\"choice\",\"index\":" + IntToString(index) + ",\"caption\":" + XFJson.Str(caption) + ",\"hub\":" + IntToString(this.m_hubId) + "}");
      this.m_hubActive = false;
      this.m_hubId = -1;
      ArrayClear(this.m_hubCaptions);
    }
  }
}

// --- ids and targets -------------------------------------------------------------------------------------------------------

@if(ModuleExists("Codeware"))
public abstract class XFDmIds {
  // An entity by the text this layer answered (EntityID.ToDebugString), or a decimal hash (Codeware converts it).
  public static func Find(text: String) -> ref<GameObject> {
    let registry = XFDmRegistry.Get();
    let id: EntityID;
    if IsDefined(registry) && registry.Lookup(text, id) {
      return GameInstance.FindEntityByID(GetGameInstance(), id) as GameObject;
    }
    let digits = text;
    if StrBeginsWith(digits, "EntityID(") {
      digits = StrMid(digits, 9, StrLen(digits) - 10);
    }
    let hash = StringToUint64(digits);
    if hash == 0ul {
      return null;
    }
    return GameInstance.FindEntityByID(GetGameInstance(), EntityID.FromHash(hash)) as GameObject;
  }
}

@if(!ModuleExists("Codeware"))
public abstract class XFDmIds {
  public static func Find(text: String) -> ref<GameObject> {
    let registry = XFDmRegistry.Get();
    let id: EntityID;
    if IsDefined(registry) && registry.Lookup(text, id) {
      return GameInstance.FindEntityByID(GetGameInstance(), id) as GameObject;
    }
    return null;
  }
}

public abstract class XFDmTarget {
  // "v", "look_at", "mounted", or an entity id text. Nothing for a target that isn't there.
  public static func Resolve(target: String) -> ref<GameObject> {
    let game = GetGameInstance();
    let player = XFPlayer.Player();
    if Equals(target, "v") {
      return player;
    }
    if Equals(target, "look_at") {
      let targeting = GameInstance.GetTargetingSystem(game);
      if !IsDefined(targeting) || !IsDefined(player) {
        return null;
      }
      let looked = targeting.GetLookAtObject(player, false, false);
      let registry = XFDmRegistry.Get();
      if IsDefined(looked) && IsDefined(registry) {
        registry.Remember(looked.GetEntityID());
      }
      return looked;
    }
    if Equals(target, "mounted") {
      let vehicle: wref<VehicleObject>;
      if !IsDefined(player) || !VehicleComponent.IsMountedToVehicle(game, player.GetEntityID()) || !VehicleComponent.GetVehicle(game, player.GetEntityID(), vehicle) || !IsDefined(vehicle) {
        return null;
      }
      let registry = XFDmRegistry.Get();
      if IsDefined(registry) {
        registry.Remember(vehicle.GetEntityID());
      }
      return vehicle;
    }
    return XFDmIds.Find(target);
  }

  public static func Missing(target: String) -> String {
    if Equals(target, "look_at") {
      return XFJson.Fail("target_missing", "V isn't looking at anything the bridge can name right now");
    }
    if Equals(target, "mounted") {
      return XFJson.Fail("target_missing", "V isn't in a vehicle");
    }
    return XFJson.Fail("target_missing", "that entity isn't in the world now (it streamed out, was removed, or its id isn't one the bridge has seen)");
  }
}

// --- props and vehicles, lights (Codeware's dynamic entities) ----------------------------------------------------------------

@if(ModuleExists("Codeware"))
public abstract class XFDmSpawn {
  public static func Spawn(cid: String, kind: String, template: ResRef, record: String, appearance: String, x: Float, y: Float, z: Float, yaw: Float, ground: Bool, handle: Int32) -> String {
    let game = GetGameInstance();
    let system = GameInstance.GetDynamicEntitySystem();
    let registry = XFDmRegistry.Get();
    if !IsDefined(system) || !system.IsReady() || !IsDefined(registry) {
      return XFJson.Fail("not_ready", "the game can't spawn entities yet; try again in a moment");
    }
    let spec = new DynamicEntitySpec();
    if StrLen(record) > 0 {
      let recordId = TDBID.Create(record);
      if Equals(kind, "vehicle") {
        if !IsDefined(TweakDBInterface.GetVehicleRecord(recordId)) {
          return XFJson.Fail("record_missing", "the game's database has no vehicle record " + record);
        }
      } else {
        if !IsDefined(TweakDBInterface.GetBaseObjectRecord(recordId)) {
          return XFJson.Fail("record_missing", "the game's database has no record " + record);
        }
      }
      spec.recordID = recordId;
    } else {
      if !GameInstance.GetResourceDepot().ResourceExists(template) {
        return XFJson.Fail("template_missing", "the game has no entity template at that path (a typo, or its archive isn't loaded)");
      }
      spec.templatePath = template;
    }
    let point = new Vector4(x, y, z, 1.0);
    let grounded = false;
    if ground {
      let queries = GameInstance.GetSpatialQueriesSystem(game);
      let result: TraceResult;
      if IsDefined(queries) && queries.SyncRaycastByCollisionGroup(new Vector4(x, y, z + 1.5, 1.0), new Vector4(x, y, z - 3.0, 1.0), n"Static", result, true, false) && TraceResult.IsValid(result) {
        point = Vector4.Vector3To4(result.position);
        grounded = true;
      }
    }
    if StrLen(appearance) > 0 {
      spec.appearanceName = StringToName(appearance);
    }
    let angles: EulerAngles;
    angles.Yaw = yaw;
    spec.position = point;
    spec.orientation = EulerAngles.ToQuat(angles);
    // Never saved: no state and no respawn after a load; the world detach drops them.
    spec.persistState = false;
    spec.persistSpawn = false;
    spec.alwaysSpawned = true;
    spec.spawnInView = true;
    spec.active = true;
    ArrayPush(spec.tags, n"xfs_dm");
    XFBridgeActions.EnsureSaveLock(cid);
    let id = system.CreateEntity(spec);
    if !EntityID.IsDefined(id) {
      return XFJson.Fail("spawn_refused", "the game's entity spawner refused it");
    }
    let entry = new XFDmEntry();
    entry.handle = handle;
    entry.kind = kind;
    entry.id = id;
    registry.Add(entry);
    XFBridgeLog.Info(cid, "dm spawned " + kind + " " + IntToString(handle) + " at " + XFScene.Arr(point) + " (non-persistent, tag xfs_dm)");
    return "{\"ok\":true,\"entity\":" + XFJson.Str(EntityID.ToDebugString(id)) + ",\"position\":" + XFScene.Arr(point) + ",\"yaw\":" + XFJson.Num(yaw) + ",\"grounded\":" + XFJson.Flag(grounded) + "}";
  }

  // A light: an entity template that holds a light component (the XF carrier in the -writes package once built, or a template
  // the caller names). The first light component found is set; an entity without one is removed again.
  public static func LightSpawn(cid: String, template: ResRef, useCarrier: Bool, x: Float, y: Float, z: Float, yaw: Float, red: Int32, green: Int32, blue: Int32, intensity: Float, radius: Float, inner: Float, outer: Float, handle: Int32) -> String {
    let system = GameInstance.GetDynamicEntitySystem();
    let registry = XFDmRegistry.Get();
    if !IsDefined(system) || !system.IsReady() || !IsDefined(registry) {
      return XFJson.Fail("not_ready", "the game can't spawn entities yet; try again in a moment");
    }
    if useCarrier {
      return XFJson.Fail("carrier_missing", "the XF light carrier (an empty entity the toolkit adds a light component to) isn't built yet; name a template that holds a light component with template, or spawn a lamp with world_spawn and steer it with light_set");
    }
    if !GameInstance.GetResourceDepot().ResourceExists(template) {
      return XFJson.Fail("template_missing", "the game has no entity template at that path (a typo, or its archive isn't loaded)");
    }
    let spec = new DynamicEntitySpec();
    spec.templatePath = template;
    let angles: EulerAngles;
    angles.Yaw = yaw;
    spec.position = new Vector4(x, y, z, 1.0);
    spec.orientation = EulerAngles.ToQuat(angles);
    spec.persistState = false;
    spec.persistSpawn = false;
    spec.alwaysSpawned = true;
    spec.spawnInView = true;
    spec.active = true;
    ArrayPush(spec.tags, n"xfs_dm");
    XFBridgeActions.EnsureSaveLock(cid);
    let id = system.CreateEntity(spec);
    if !EntityID.IsDefined(id) {
      return XFJson.Fail("spawn_refused", "the game's entity spawner refused it");
    }
    let entry = new XFDmEntry();
    entry.handle = handle;
    entry.kind = "light";
    entry.id = id;
    registry.Add(entry);
    XFBridgeLog.Info(cid, "dm light entity " + IntToString(handle) + " spawned; its component is set when the entity has appeared");
    return "{\"ok\":true,\"entity\":" + XFJson.Str(EntityID.ToDebugString(id)) + ",\"components\":0,\"pending\":true}";
  }

  public static func Despawn(cid: String, entity: String) -> String {
    let system = GameInstance.GetDynamicEntitySystem();
    let registry = XFDmRegistry.Get();
    if !IsDefined(system) || !IsDefined(registry) {
      return XFJson.Fail("not_ready", "the entity system is unavailable; deletion must be retried");
    }
    let removed = true; // no owned record means it was already removed
    for entry in registry.Entries() {
      if Equals(EntityID.ToDebugString(entry.id), entity) {
        // DeleteEntity confirms removal of the dynamic record, including a not-yet-streamed entity.
        removed = !system.IsManaged(entry.id) || system.DeleteEntity(entry.id);
        if removed { registry.ForgetEntry(entry.id); }
      }
    }
    XFBridgeLog.Info(cid, "dm despawned " + entity + " " + (removed ? "true" : "false"));
    return "{\"ok\":true,\"despawned\":" + XFJson.Flag(removed) + "}";
  }

  // Everything tagged xfs_dm, by tag, so an entity the registry lost track of goes too.
  public static func Clear(cid: String) -> Int32 {
    let system = GameInstance.GetDynamicEntitySystem();
    let registry = XFDmRegistry.Get();
    let count = 0;
    if IsDefined(registry) {
      let entries = registry.Entries();
      for entry in entries {
        if IsDefined(system) && (!system.IsManaged(entry.id) || system.DeleteEntity(entry.id)) {
          registry.ForgetEntry(entry.id);
          count += 1;
        }
      }
      let remaining = registry.Entries();
      if ArraySize(remaining) > 0 { return -1; }
    }
    if IsDefined(system) {
      system.DeleteTagged(n"xfs_dm");
    }
    return count;
  }
}

@if(!ModuleExists("Codeware"))
public abstract class XFDmSpawn {
  public static func Missing() -> String {
    return XFJson.Fail("codeware_missing", "bringing props, vehicles and lights in needs Codeware, which the game hasn't loaded; install Codeware 1.20 or newer from its official release page (the bridge never installs it), then restart the game");
  }

  public static func Spawn(cid: String, kind: String, template: ResRef, record: String, appearance: String, x: Float, y: Float, z: Float, yaw: Float, ground: Bool, handle: Int32) -> String {
    return XFDmSpawn.Missing();
  }

  public static func LightSpawn(cid: String, template: ResRef, useCarrier: Bool, x: Float, y: Float, z: Float, yaw: Float, red: Int32, green: Int32, blue: Int32, intensity: Float, radius: Float, inner: Float, outer: Float, handle: Int32) -> String {
    return XFDmSpawn.Missing();
  }

  public static func Despawn(cid: String, entity: String) -> String {
    return "{\"ok\":true,\"despawned\":false}";
  }

  public static func Clear(cid: String) -> Int32 {
    return 0;
  }
}

// --- lights --------------------------------------------------------------------------------------------------------------------

@if(ModuleExists("Codeware"))
public abstract class XFDmLight {
  // The first light component an entity holds.
  public static func Of(entity: ref<Entity>) -> ref<LightComponent> {
    if !IsDefined(entity) {
      return null;
    }
    for component in entity.GetComponents() {
      let light = component as LightComponent;
      if IsDefined(light) {
        return light;
      }
    }
    return null;
  }

  // light_set's step. colour < 0 leaves the colour; the others use NaN-free sentinels: a value below 0 is "unchanged" (an
  // intensity or radius of 0 is a real value, so the plugin passes -1 for unchanged). on: -1 unchanged, 0 off, 1 on.
  // flicker < 0: unchanged; 0: the engine's flicker off; above 0: its strength, with the period.
  public static func Set(cid: String, entity: String, red: Int32, green: Int32, blue: Int32, intensity: Float, radius: Float, inner: Float, outer: Float, on: Int32, flicker: Float, period: Float, fade: Float) -> String {
    let target = XFDmIds.Find(entity);
    if !IsDefined(target) {
      return XFDmTarget.Missing(entity);
    }
    let light = XFDmLight.Of(target);
    if !IsDefined(light) {
      return XFJson.Fail("no_light_component", "that entity holds no light component");
    }
    XFBridgeActions.EnsureSaveLock(cid);
    let game = light as gameLightComponent;
    if inner >= 0.0 && !IsDefined(game) {
      return XFJson.Fail("no_light_component", "this light component cannot take cone angles");
    }
    let before = "{";
    let wrote = false;
    if IsDefined(game) {
      let settings = game.GetCurrentSettings();
      before += "\"colour\":[" + IntToString(Cast<Int32>(settings.color.Red)) + "," + IntToString(Cast<Int32>(settings.color.Green)) + "," + IntToString(Cast<Int32>(settings.color.Blue)) + "],\"intensity\":" + XFJson.Num(settings.intensity) + ",\"radius\":" + XFJson.Num(settings.radius) + ",\"inner\":" + XFJson.Num(settings.innerAngle) + ",\"outer\":" + XFJson.Num(settings.outerAngle) + ",\"on\":" + XFJson.Flag(game.IsOn());
      wrote = true;
    }
    if red >= 0 {
      let color: Color;
      color.Red = Cast<Uint8>(red);
      color.Green = Cast<Uint8>(green);
      color.Blue = Cast<Uint8>(blue);
      color.Alpha = Cast<Uint8>(255);
      if IsDefined(game) {
        game.SetColor(color, fade);
      } else {
        light.SetColor(color);
      }
    }
    if intensity >= 0.0 {
      if IsDefined(game) {
        game.SetIntensity(intensity, fade);
      } else {
        light.SetIntensity(intensity);
      }
    }
    if radius >= 0.0 {
      if IsDefined(game) {
        game.SetRadius(radius, fade);
      } else {
        light.SetRadius(radius);
      }
    }
    if inner >= 0.0 && outer >= 0.0 && IsDefined(game) {
      game.SetAngles(inner, outer, fade);
    }
    if on >= 0 && IsDefined(game) {
      game.ToggleLight(on == 1);
    }
    if flicker >= 0.0 {
      light.SetFlickerParams(flicker, period, 0.0);
    }
    XFBridgeLog.Debug(cid, "dm light set " + entity);
    return "{\"ok\":true,\"before\":" + (wrote ? before + "}" : "{}") + "}";
  }

  // The tick's pattern value: the intensity only.
  public static func Intensity(cid: String, entity: String, intensity: Float) -> String {
    let target = XFDmIds.Find(entity);
    let light = XFDmLight.Of(target);
    if !IsDefined(light) {
      return XFJson.Fail("no_light_component", "that entity holds no light component");
    }
    light.SetIntensity(intensity);
    return "{\"ok\":true}";
  }
}

@if(!ModuleExists("Codeware"))
public abstract class XFDmLight {
  public static func Set(cid: String, entity: String, red: Int32, green: Int32, blue: Int32, intensity: Float, radius: Float, inner: Float, outer: Float, on: Int32, flicker: Float, period: Float, fade: Float) -> String {
    return XFDmSpawn.Missing();
  }

  public static func Intensity(cid: String, entity: String, intensity: Float) -> String {
    return XFDmSpawn.Missing();
  }
}

// --- lines (subtitles, a call's words) --------------------------------------------------------------------------------------

@if(ModuleExists("Codeware"))
public abstract class XFDmLines {
  public static func LineId(n: Int32) -> CRUID {
    return CreateCRUID(StringToUint64("5844" + IntToString(n)));
  }

  // lineType: 1 Regular, 2 Holocall, 9 OwnerlessRegular (the one the subtitle controller draws without a speaker entity); the
  // others get V as their carrier, with the speaker's own name (baseSubtitlesControllers.script:523-533).
  public static func Show(cid: String, n: Int32, lineType: Int32, speaker: String, text: String, seconds: Float) -> String {
    let data: scnDialogLineData;
    data.id = XFDmLines.LineId(n);
    data.text = text;
    data.type = IntEnum<scnDialogLineType>(lineType);
    if lineType != 9 {
      data.speaker = GetPlayer(GetGameInstance());
    }
    data.speakerName = speaker;
    data.isPersistent = false;
    data.duration = seconds;
    let lines: array<scnDialogLineData>;
    ArrayPush(lines, data);
    let board = GameInstance.GetBlackboardSystem(GetGameInstance()).Get(GetAllBlackboardDefs().UIGameData);
    board.SetVariant(GetAllBlackboardDefs().UIGameData.ShowDialogLine, ToVariant(lines), true);
    let registry = XFDmRegistry.Get();
    if IsDefined(registry) {
      registry.AddLine(n);
    }
    XFBridgeActions.EnsureSaveLock(cid);
    return "{\"ok\":true,\"line\":" + IntToString(n) + "}";
  }

  public static func Hide(cid: String, n: Int32) -> String {
    let ids: array<CRUID>;
    ArrayPush(ids, XFDmLines.LineId(n));
    let board = GameInstance.GetBlackboardSystem(GetGameInstance()).Get(GetAllBlackboardDefs().UIGameData);
    if !IsDefined(board) { return XFJson.Fail("not_ready", "the subtitle board is unavailable; hiding must be retried"); }
    board.SetVariant(GetAllBlackboardDefs().UIGameData.HideDialogLine, ToVariant(ids), true);
    let registry = XFDmRegistry.Get();
    if IsDefined(registry) { registry.ForgetLine(n); }
    return "{\"ok\":true,\"hidden\":true}";
  }

  public static func HideAll(cid: String) -> Int32 {
    let registry = XFDmRegistry.Get();
    if !IsDefined(registry) {
      return 0;
    }
    let ids: array<CRUID>;
    for n in registry.Lines() {
      ArrayPush(ids, XFDmLines.LineId(n));
    }
    let count = ArraySize(ids);
    if count > 0 {
      let board = GameInstance.GetBlackboardSystem(GetGameInstance()).Get(GetAllBlackboardDefs().UIGameData);
      if !IsDefined(board) { return -1; }
      board.SetVariant(GetAllBlackboardDefs().UIGameData.HideDialogLine, ToVariant(ids), true);
    }
    registry.ForgetLines();
    return count;
  }
}

@if(!ModuleExists("Codeware"))
public abstract class XFDmLines {
  public static func Show(cid: String, n: Int32, lineType: Int32, speaker: String, text: String, seconds: Float) -> String {
    return XFJson.Fail("codeware_missing", "subtitle lines are shown through Codeware, which the game hasn't loaded; install Codeware 1.20 or newer from its official release page");
  }

  public static func Hide(cid: String, n: Int32) -> String {
    return "{\"ok\":true,\"hidden\":false}";
  }

  public static func HideAll(cid: String) -> Int32 {
    return 0;
  }
}

// --- doors, vehicles, sound, voice ---------------------------------------------------------------------------------------------

@addMethod(DoorControllerPS)
public func XFDmQuest(what: String) -> Void {
  let action: ref<ScriptableDeviceAction>;
  if Equals(what, "open") {
    action = this.ActionQuestForceOpen();
  } else {
    if Equals(what, "close") {
      action = this.ActionQuestForceClose();
    } else {
      if Equals(what, "lock") {
        action = this.ActionQuestForceLock();
      } else {
        if Equals(what, "unlock") {
          action = this.ActionQuestForceUnlock();
        } else {
          if Equals(what, "seal") {
            action = this.ActionQuestForceSeal();
          } else {
            if Equals(what, "unseal") {
              action = this.ActionQuestForceUnseal();
            };
          };
        };
      };
    };
  };
  if IsDefined(action) {
    this.ExecutePSAction(action, this);
  };
}

public abstract class XFDmWorld {
  public static func DoorState(ps: ref<DoorControllerPS>) -> String {
    return "{\"open\":" + XFJson.Flag(ps.IsOpen()) + ",\"locked\":" + XFJson.Flag(ps.IsLocked()) + ",\"sealed\":" + XFJson.Flag(ps.IsSealed()) + "}";
  }

  // open, locked and sealed: -1 unchanged, 0 false, 1 true. The order matters: a door is unlocked and unsealed before it opens
  // and closed before it is locked or sealed (the quest actions do the same on their own).
  public static func Door(cid: String, target: String, open: Int32, locked: Int32, sealed: Int32) -> String {
    let object = XFDmTarget.Resolve(target);
    if !IsDefined(object) {
      return XFDmTarget.Missing(target);
    }
    let door = object as Door;
    if !IsDefined(door) {
      return XFJson.Fail("not_a_door", "that isn't a door");
    }
    let ps = door.GetDevicePS();
    if !IsDefined(ps) {
      return XFJson.Fail("not_a_door", "that door has no controller the bridge can drive");
    }
    XFBridgeActions.EnsureSaveLock(cid);
    let before = XFDmWorld.DoorState(ps);
    let id = EntityID.ToDebugString(door.GetEntityID());
    if open == 1 {
      if ps.IsSealed() {
        ps.XFDmQuest("unseal");
      }
      if ps.IsLocked() {
        ps.XFDmQuest("unlock");
      }
      ps.XFDmQuest("open");
    } else {
      if open == 0 {
        ps.XFDmQuest("close");
      }
      if locked == 1 {
        ps.XFDmQuest("lock");
      }
      if locked == 0 {
        ps.XFDmQuest("unlock");
      }
      if sealed == 1 {
        ps.XFDmQuest("seal");
      }
      if sealed == 0 {
        ps.XFDmQuest("unseal");
      }
    }
    XFBridgeLog.Info(cid, "dm door " + id + " open=" + IntToString(open) + " locked=" + IntToString(locked) + " sealed=" + IntToString(sealed));
    // The actions are queued; the state read back next tick is the truth, so the answer reports what was asked.
    return "{\"ok\":true,\"target_id\":" + XFJson.Str(id) + ",\"before\":" + before + ",\"asked\":{\"open\":" + IntToString(open) + ",\"locked\":" + IntToString(locked) + ",\"sealed\":" + IntToString(sealed) + "}}";
  }

  public static func DoorEnum(name: String) -> EVehicleDoor {
    if Equals(name, "seat_front_left") {
      return EVehicleDoor.seat_front_left;
    }
    if Equals(name, "seat_front_right") {
      return EVehicleDoor.seat_front_right;
    }
    if Equals(name, "seat_back_left") {
      return EVehicleDoor.seat_back_left;
    }
    if Equals(name, "seat_back_right") {
      return EVehicleDoor.seat_back_right;
    }
    if Equals(name, "trunk") {
      return EVehicleDoor.trunk;
    }
    return EVehicleDoor.hood;
  }

  public static func VehicleDoors(vehicle: ref<VehicleObject>) -> String {
    let ps = vehicle.GetVehiclePS();
    if !IsDefined(ps) {
      return "{}";
    }
    let names: array<String>;
    ArrayPush(names, "seat_front_left");
    ArrayPush(names, "seat_front_right");
    ArrayPush(names, "seat_back_left");
    ArrayPush(names, "seat_back_right");
    ArrayPush(names, "trunk");
    ArrayPush(names, "hood");
    let out = "{";
    let i = 0;
    while i < ArraySize(names) {
      let state = ps.GetDoorState(XFDmWorld.DoorEnum(names[i]));
      out += (i > 0 ? "," : "") + XFJson.Str(names[i]) + ":" + XFJson.Str(Equals(state, VehicleDoorState.Open) ? "open" : "closed");
      i += 1;
    }
    return out + "}";
  }

  public static func VehicleDoorEvent(vehicle: ref<VehicleObject>, door: String, state: String) -> Void {
    let ps = vehicle.GetVehiclePS();
    if !IsDefined(ps) {
      return;
    }
    let evt = new VehicleQuestChangeDoorStateEvent();
    let all = Equals(door, "all");
    if Equals(state, "open") {
      evt.newState = all ? EQuestVehicleDoorState.OpenAll : EQuestVehicleDoorState.ForceOpen;
    }
    if Equals(state, "closed") {
      evt.newState = all ? EQuestVehicleDoorState.CloseAll : EQuestVehicleDoorState.ForceClose;
    }
    if Equals(state, "locked") {
      evt.newState = all ? EQuestVehicleDoorState.LockAll : EQuestVehicleDoorState.ForceLock;
    }
    if Equals(state, "unlocked") {
      evt.newState = all ? EQuestVehicleDoorState.ResetInteractions : EQuestVehicleDoorState.ForceUnlock;
    }
    if !all {
      evt.door = XFDmWorld.DoorEnum(door);
    }
    GameInstance.GetPersistencySystem(GetGameInstance()).QueuePSEvent(ps.GetID(), ps.GetClassName(), evt);
  }

  // lights and engine: -1 unchanged, 0 off, 1 on. door "" leaves the doors.
  public static func Vehicle(cid: String, target: String, lights: Int32, engine: Int32, door: String, doorState: String) -> String {
    let object = XFDmTarget.Resolve(target);
    if !IsDefined(object) {
      return XFDmTarget.Missing(target);
    }
    let vehicle = object as VehicleObject;
    if !IsDefined(vehicle) {
      return XFJson.Fail("not_a_vehicle", "that isn't a vehicle");
    }
    XFBridgeActions.EnsureSaveLock(cid);
    let id = EntityID.ToDebugString(vehicle.GetEntityID());
    let engineOn = vehicle.IsEngineTurnedOn();
    let doorsNow = XFDmWorld.VehicleDoors(vehicle);
    let before = "{\"engine\":" + XFJson.Flag(engineOn) + ",\"doors\":" + doorsNow + "}";
    if lights >= 0 {
      let evt = new VehicleLightQuestToggleEvent();
      evt.toggle = lights == 1;
      evt.lightType = vehicleELightType.Default;
      vehicle.QueueEvent(evt);
    }
    if engine >= 0 {
      let evt = new VehicleQuestToggleEngineEvent();
      evt.toggle = engine == 1;
      vehicle.QueueEvent(evt);
    }
    if StrLen(door) > 0 {
      XFDmWorld.VehicleDoorEvent(vehicle, door, doorState);
    }
    XFBridgeLog.Info(cid, "dm vehicle " + id + " lights=" + IntToString(lights) + " engine=" + IntToString(engine) + " door=" + door + ":" + doorState);
    return "{\"ok\":true,\"target_id\":" + XFJson.Str(id) + ",\"before\":" + before + "}";
  }

  // A vehicle's radio: station -1 unchanged (0-13 the game's numbers), on -1 unchanged. The vehicle radio is the only one with
  // an exact-station event; a radio device only steps to the next station.
  public static func Radio(cid: String, target: String, station: Int32, on: Int32) -> String {
    let object = XFDmTarget.Resolve(target);
    if !IsDefined(object) {
      return XFDmTarget.Missing(target);
    }
    let vehicle = object as VehicleObject;
    if !IsDefined(vehicle) {
      return XFJson.Fail("no_radio", "that isn't a vehicle; only a vehicle's radio takes an exact station (a radio device only steps to its next station)");
    }
    XFBridgeActions.EnsureSaveLock(cid);
    let id = EntityID.ToDebugString(vehicle.GetEntityID());
    let wasOn = vehicle.IsRadioReceiverActive();
    let name = NameToString(vehicle.GetRadioReceiverStationName());
    let index = -1;
    let i = 0;
    while i < 14 {
      let label = StrLower(EnumValueToString("ERadioStationList", Cast<Int64>(i)));
      if StrLen(name) > 0 && StrContains(StrLower(name), label) {
        index = i;
      }
      i += 1;
    }
    if station >= 0 {
      let evt = new VehicleRadioEvent();
      evt.toggle = false;
      evt.setStation = true;
      evt.station = station;
      vehicle.QueueEvent(evt);
    } else {
      if on >= 0 && !Equals(on == 1, wasOn) {
        let evt = new VehicleRadioEvent();
        evt.toggle = on == 1;
        vehicle.QueueEvent(evt);
      }
    }
    if station >= 0 && on == 0 {
      let off = new VehicleRadioEvent();
      off.toggle = false;
      vehicle.QueueEvent(off);
    }
    XFBridgeLog.Info(cid, "dm radio " + id + " station=" + IntToString(station) + " on=" + IntToString(on));
    return "{\"ok\":true,\"target_id\":" + XFJson.Str(id) + ",\"before\":{\"on\":" + XFJson.Flag(wasOn) + ",\"station\":" + (index >= 0 ? IntToString(index) : "null") + ",\"station_name\":" + XFJson.Str(name) + "}}";
  }

  public static func AudioTarget(on: String) -> EntityID {
    let none: EntityID;
    if Equals(on, "global") {
      return none;
    }
    let object = XFDmTarget.Resolve(on);
    if !IsDefined(object) {
      return none;
    }
    return object.GetEntityID();
  }

  public static func Play(cid: String, event: String, on: String, emitter: String) -> String {
    let game = GetGameInstance();
    let audio = GameInstance.GetAudioSystem(game);
    if !IsDefined(audio) {
      return XFJson.Fail("not_ready", "the game's audio system isn't there yet");
    }
    if !Equals(on, "global") {
      let object = XFDmTarget.Resolve(on);
      if !IsDefined(object) {
        return XFDmTarget.Missing(on);
      }
      audio.Play(StringToName(event), object.GetEntityID(), StringToName(emitter));
      XFBridgeLog.Info(cid, "dm sound " + event + " on " + on);
      return "{\"ok\":true,\"on_id\":" + XFJson.Str(EntityID.ToDebugString(object.GetEntityID())) + "}";
    }
    audio.Play(StringToName(event));
    XFBridgeLog.Info(cid, "dm sound " + event + " global");
    return "{\"ok\":true,\"on_id\":\"global\"}";
  }

  public static func Stop(cid: String, event: String, on: String, emitter: String) -> String {
    let audio = GameInstance.GetAudioSystem(GetGameInstance());
    if !IsDefined(audio) {
      return XFJson.Fail("not_ready", "the audio system is unavailable; stopping must be retried");
    }
    if Equals(on, "global") {
      audio.Stop(StringToName(event));
    } else {
      let object = XFDmIds.Find(on);
      if IsDefined(object) {
        audio.Stop(StringToName(event), object.GetEntityID(), StringToName(emitter));
      } else {
        let player = XFPlayer.Player();
        if IsDefined(player) && Equals(on, EntityID.ToDebugString(player.GetEntityID())) {
          audio.Stop(StringToName(event), player.GetEntityID(), StringToName(emitter));
        }
      }
    }
    return "{\"ok\":true}";
  }

  // A voiceset line of an NPC's own voice (GameObject.PlayVoiceOver). Only a puppet has a voiceset.
  public static func Voice(cid: String, target: String, context: String) -> String {
    let object = XFDmTarget.Resolve(target);
    if !IsDefined(object) {
      return XFDmTarget.Missing(target);
    }
    let puppet = object as ScriptedPuppet;
    if !IsDefined(puppet) {
      return XFJson.Fail("not_an_npc", "that isn't someone with a voice of their own");
    }
    GameObject.PlayVoiceOver(puppet, StringToName(context), n"Scripts:XFRuntimeBridge");
    let voiceId = EntityID.ToDebugString(puppet.GetEntityID());
    XFBridgeLog.Info(cid, "dm voice " + context + " on " + voiceId);
    return "{\"ok\":true,\"target_id\":" + XFJson.Str(voiceId) + "}";
  }
}

// --- the phone -----------------------------------------------------------------------------------------------------------------

// Keep the game's request type for native dispatch; only tag the instances XF creates.
@addField(questTriggerCallRequest)
public let xfsDmOwned: Bool;

@wrapMethod(PhoneSystem)
private final func OnTriggerCall(request: ref<questTriggerCallRequest>) -> Void {
  if !XFBridge_Live() {
    if !request.xfsDmOwned { wrappedMethod(request); }
    return;
  }
  let registry = XFDmRegistry.Get();
  let owned = request.xfsDmOwned;
  // A ring/start still queued when teardown revoked ownership is cancelled too.
  if owned && (!IsDefined(registry) || !Equals(registry.CallContact(), NameToString(request.caller))) { return; }
  if owned && Equals(request.callPhase, questPhoneCallPhase.EndCall) {
    if !IsDefined(registry) || !Equals(registry.CallContact(), NameToString(request.caller)) ||
       NotEquals(this.m_LastCallInformation.contactName, request.caller) ||
       (!Equals(this.m_LastCallInformation.callPhase, questPhoneCallPhase.IncomingCall) && !Equals(this.m_LastCallInformation.callPhase, questPhoneCallPhase.StartCall)) {
      return;
    }
  }
  // A vanilla quest request supersedes bridge ownership, even for the same contact.
  if IsDefined(registry) && !owned { registry.SetCallContact(""); }
  wrappedMethod(request);
  if IsDefined(registry) && Equals(request.callPhase, questPhoneCallPhase.EndCall) { registry.SetCallContact(""); }
}

@wrapMethod(PhoneSystem)
private final func TriggerCall(callMode: questPhoneCallMode, isAudio: Bool, contactName: CName, isPlayerCalling: Bool, callPhase: questPhoneCallPhase, isPlayerTriggered: Bool, opt isRejectable: Bool, showAvatar: Bool, callVisuals: questPhoneCallVisuals) -> Void {
  if !XFBridge_Live() {
    wrappedMethod(callMode, isAudio, contactName, isPlayerCalling, callPhase, isPlayerTriggered, isRejectable, showAvatar, callVisuals);
    return;
  }
  let registry = XFDmRegistry.Get();
  if IsDefined(registry) && (Equals(callPhase, questPhoneCallPhase.EndCall) || !Equals(registry.CallContact(), NameToString(contactName))) {
    registry.SetCallContact("");
  }
  wrappedMethod(callMode, isAudio, contactName, isPlayerCalling, callPhase, isPlayerTriggered, isRejectable, showAvatar, callVisuals);
}

// Hang-up/rejection can write only the fact (OnTalkingTriggerRequest/OnPickupPhone), without TriggerCall.
@wrapMethod(PhoneSystem)
private final func SetPhoneFact(isPlayerCalling: Bool, contactName: CName, state: questPhoneTalkingState) -> Void {
  if XFBridge_Live() && (Equals(state, questPhoneTalkingState.Ended) || Equals(state, questPhoneTalkingState.Rejected)) {
    let registry = XFDmRegistry.Get();
    if IsDefined(registry) && Equals(registry.CallContact(), NameToString(contactName)) { registry.SetCallContact(""); }
  }
  wrappedMethod(isPlayerCalling, contactName, state);
}

public abstract class XFDmPhone {
  public static func System() -> ref<PhoneSystem> {
    let container = GameInstance.GetScriptableSystemsContainer(GetGameInstance());
    return IsDefined(container) ? container.Get(n"PhoneSystem") as PhoneSystem : null;
  }

  // The contacts the player has (active ones only: the ones still locked would tell a story the player hasn't reached).
  public static func Contacts(cid: String) -> String {
    let journal = GameInstance.GetJournalManager(GetGameInstance());
    if !IsDefined(journal) {
      return XFJson.Fail("not_ready", "the game's journal isn't there yet");
    }
    let context: JournalRequestContext;
    context.stateFilter.active = true;
    let entries: array<wref<JournalEntry>>;
    journal.GetContacts(context, entries);
    let out = "";
    let count = 0;
    for entry in entries {
      let contact = entry as JournalContact;
      if IsDefined(contact) {
        out += (count > 0 ? "," : "") + "{\"id\":" + XFJson.Str(contact.GetId()) + ",\"name\":" + XFJson.Str(contact.GetLocalizedName(journal)) + "}";
        count += 1;
      }
    }
    let phone = XFDmPhone.System();
    let calling = IsDefined(phone) && phone.IsCallingEnabled();
    return "{\"ok\":true,\"contacts\":[" + out + "],\"calling\":" + XFJson.Flag(calling) + "}";
  }

  public static func HasContact(id: String) -> Bool {
    let journal = GameInstance.GetJournalManager(GetGameInstance());
    if !IsDefined(journal) {
      return false;
    }
    let context: JournalRequestContext;
    context.stateFilter.active = true;
    let entries: array<wref<JournalEntry>>;
    journal.GetContacts(context, entries);
    for entry in entries {
      let contact = entry as JournalContact;
      if IsDefined(contact) && Equals(contact.GetId(), id) {
        return true;
      }
    }
    return false;
  }

  public static func Request(contact: String, phase: questPhoneCallPhase, mode: String, rejectable: Bool) -> ref<questTriggerCallRequest> {
    let request = new questTriggerCallRequest();
    request.xfsDmOwned = true;
    request.caller = StringToName(contact);
    request.addressee = n"Player";
    request.callPhase = phase;
    request.callMode = Equals(mode, "video") ? questPhoneCallMode.Video : questPhoneCallMode.Audio;
    request.isPlayerTriggered = false;
    request.isRejectable = rejectable;
    request.showAvatar = true;
    request.visuals = questPhoneCallVisuals.Default;
    return request;
  }

  public static func Why(player: ref<PlayerPuppet>) -> String {
    if player.IsInCombat() {
      return "V is in combat";
    }
    let defs = GetAllBlackboardDefs().PlayerStateMachine;
    let high = XFPlayer.Psm(player, defs.HighLevel);
    if high >= 3 && high <= 5 {
      return "V is in a story scene";
    }
    return "the phone is disabled or busy (a status effect, a device in use, another call)";
  }

  public static func Ring(cid: String, contact: String, mode: String, rejectable: Bool) -> String {
    let phone = XFDmPhone.System();
    let player = XFPlayer.Player();
    if !IsDefined(phone) || !IsDefined(player) {
      return XFJson.Fail("not_ready", "the game's phone system isn't there yet");
    }
    if !XFDmPhone.HasContact(contact) {
      return XFJson.Fail("contact_unknown", "the player's phone has no contact with the id " + contact + " (phone_state {contacts: true} lists them). A caller the journal doesn't hold would run the phone's code on a missing contact, so it is refused");
    }
    if !phone.IsCallingEnabled() {
      return XFJson.Fail("phone_blocked", "the phone can't take a call now: " + XFDmPhone.Why(player));
    }
    XFBridgeActions.EnsureSaveLock(cid);
    phone.QueueRequest(XFDmPhone.Request(contact, questPhoneCallPhase.IncomingCall, mode, rejectable));
    let registry = XFDmRegistry.Get();
    if IsDefined(registry) {
      registry.SetCallContact(contact);
    }
    XFBridgeLog.Info(cid, "dm call ringing from " + contact + " (" + mode + ")");
    return "{\"ok\":true}";
  }

  public static func Start(cid: String, contact: String, mode: String) -> String {
    let phone = XFDmPhone.System();
    if !IsDefined(phone) {
      return XFJson.Fail("not_ready", "the game's phone system isn't there yet");
    }
    phone.QueueRequest(XFDmPhone.Request(contact, questPhoneCallPhase.StartCall, mode, false));
    XFBridgeLog.Info(cid, "dm call started with " + contact);
    return "{\"ok\":true}";
  }

  public static func End(cid: String, contact: String) -> String {
    let registry = XFDmRegistry.Get();
    if !IsDefined(registry) || !Equals(registry.CallContact(), contact) { return "{\"ok\":true}"; }
    let phone = XFDmPhone.System();
    if !IsDefined(phone) {
      return XFJson.Fail("not_ready", "the phone system is unavailable; ending the owned call must be retried");
    }
    let board = GameInstance.GetBlackboardSystem(GetGameInstance()).Get(GetAllBlackboardDefs().UI_ComDevice);
    if !IsDefined(board) { return XFJson.Fail("not_ready", "the phone state is unavailable; ending the owned call must be retried"); }
    let current = FromVariant<PhoneCallInformation>(board.GetVariant(GetAllBlackboardDefs().UI_ComDevice.PhoneCallInformation));
    if NotEquals(current.contactName, StringToName(contact)) || (!Equals(current.callPhase, questPhoneCallPhase.IncomingCall) && !Equals(current.callPhase, questPhoneCallPhase.StartCall)) {
      registry.SetCallContact("");
      return "{\"ok\":true}";
    }
    phone.QueueRequest(XFDmPhone.Request(contact, questPhoneCallPhase.EndCall, "audio", false));
    XFBridgeLog.Info(cid, "dm call ended with " + contact);
    return "{\"ok\":true}";
  }

  // Our message view data takes plain text and bypasses the vanilla journal lookups and click action.
  public static func Text(cid: String, contact: String, text: String) -> String {
    let registry = XFDmRegistry.Get();
    let host = IsDefined(registry) ? registry.PhoneHost() : null;
    if !IsDefined(host) {
      return XFJson.Fail("hud_missing", "the HUD's phone isn't up (a menu or a loading screen); try again in normal play");
    }
    XFBridgeActions.EnsureSaveLock(cid);
    host.XFDmToast(contact, text);
    XFBridgeLog.Info(cid, "dm message toast from " + contact);
    return "{\"ok\":true,\"shown\":true}";
  }
}

@wrapMethod(NewHudPhoneGameController)
protected cb func OnInitialize() -> Bool {
  let result = wrappedMethod();
  let registry = XFDmRegistry.Get();
  if IsDefined(registry) {
    registry.SetPhoneHost(this);
  }
  return result;
}

public class XFDmNotificationRemove extends IScriptable {
  public let style: String;
}

// The vanilla removal handler reads a journal-request field before checking its cast.
// Only our subclasses consume XF requests; unrelated queued notifications must stay untouched.
@wrapMethod(QuestUpdateNotificationViewData)
public func OnRemoveNotification(data: ref<IScriptable>) -> Bool {
  if IsDefined(data as XFDmNotificationRemove) { return false; }
  return wrappedMethod(data);
}

public class XFDmMessageData extends PhoneMessageNotificationViewData {
  public func CanMerge(data: ref<GenericNotificationViewData>) -> Bool { return false; }
  public func OnRemoveNotification(data: ref<IScriptable>) -> Bool {
    let request = data as XFDmNotificationRemove;
    return IsDefined(request) && (StrLen(request.style) == 0 || Equals(request.style, "phone"));
  }
}

public class XFDmQuestData extends QuestUpdateNotificationViewData {
  public let style: String;
  public func OnRemoveNotification(data: ref<IScriptable>) -> Bool {
    let request = data as XFDmNotificationRemove;
    return IsDefined(request) && (StrLen(request.style) == 0 || Equals(request.style, this.style));
  }
}

// 2.31 MessengerNotification.SetNotificationData calls GetAvatarID and GetAttachmentPathHash without
// checking the journal lookups. Handle only our journal-free data before those native calls.
// Its native-base override is stored under the bare name; cb selects that symbol in redscript 0.5.31.
// Parameter/return types checked against the decompiled 2.31 method (lint alone cannot check cb signatures).
@wrapMethod(MessengerNotification)
public cb func SetNotificationData(notificationData: ref<GenericNotificationViewData>) -> Void {
  let owned = notificationData as XFDmMessageData;
  if !IsDefined(owned) { wrappedMethod(notificationData); return; }
  if !XFBridge_Live() { return; }
  if IsDefined(this.m_animProxy) { this.m_animProxy.Stop(); }
  this.m_messageData = owned;
  this.m_customInputActionName = n"None";
  inkTextRef.SetText(this.m_messageText, owned.SMSText);
  inkWidgetRef.SetFitToContent(this.m_messageText, StrLen(owned.SMSText) < this.m_textSizeLimit);
  InkImageUtils.RequestAvatarOrUnknown(this, this.m_avatar, t"");
  inkWidgetRef.SetVisible(this.m_mappinIcon, false);
  inkWidgetRef.SetVisible(this.m_envelopIcon, true);
  inkTextRef.SetLocalizedTextScript(this.m_descriptionText, n"Story-base-gameplay-gui-widgets-notifications-quest_update-_localizationString9");
  let playbackOptions: inkAnimOptions;
  playbackOptions.toMarker = n"OutroStart";
  this.m_animProxy = this.PlayLibraryAnimation(owned.animation, playbackOptions);
  this.m_animProxy.RegisterToCallback(inkanimEventType.OnFinish, this, n"OnNotificationShown");
  super.SetNotificationData(notificationData); // action is null: no journal-opening input action
}

@addMethod(NewHudPhoneGameController)
public func XFDmRemove(style: String) -> Void {
  let request = new XFDmNotificationRemove();
  request.style = style;
  this.RemoveNotification(request);
}

@addMethod(JournalNotificationQueue)
public func XFDmRemove(style: String) -> Void {
  let request = new XFDmNotificationRemove();
  request.style = style;
  this.RemoveNotification(request);
}

@addMethod(NewHudPhoneGameController)
public func XFDmToast(contact: String, text: String) -> Void {
  let notificationData: gameuiGenericNotificationData;
  let userData = new XFDmMessageData();
  userData.title = contact;
  userData.SMSText = text;
  userData.animation = n"notification_phone_MSG";
  userData.soundEvent = n"PhoneSmsPopup";
  userData.soundAction = n"OnOpen";
  notificationData.time = 6.70;
  notificationData.widgetLibraryItemName = n"notification_message";
  notificationData.notificationData = userData;
  this.AddNewNotificationData(notificationData);
}

// --- messages and the quest tracker --------------------------------------------------------------------------------------------

@wrapMethod(JournalNotificationQueue)
protected cb func OnInitialize() -> Bool {
  let result = wrappedMethod();
  let registry = XFDmRegistry.Get();
  if IsDefined(registry) {
    registry.SetToastHost(this);
  }
  return result;
}

// The game's quest toast widgets with the words we give them: the title is the game's own key unless one is given.
@addMethod(JournalNotificationQueue)
public func XFDmToast(style: String, title: String, text: String, seconds: Float) -> Void {
  let widget: CName;
  let heading: String;
  let sound: CName;
  if Equals(style, "quest_new") {
    widget = n"notification_new_quest_added";
    heading = "UI-Notifications-NewQuest";
    sound = n"QuestNewPopup";
  } else {
    if Equals(style, "quest_done") {
      widget = n"notification_quest_completed";
      heading = "UI-Notifications-QuestCompleted";
      sound = n"QuestSuccessPopup";
    } else {
      if Equals(style, "quest_failed") {
        widget = n"notification_quest_failed";
        heading = "LocKey#27566";
        sound = n"QuestFailedPopup";
      } else {
        widget = n"notification_quest_updated";
        heading = "UI-Notifications-QuestUpdated";
        sound = n"QuestUpdatePopup";
      };
    };
  };
  if StrLen(title) > 0 {
    heading = title;
  };
  let notificationData: gameuiGenericNotificationData;
  let userData = new XFDmQuestData();
  userData.style = style;
  userData.title = heading;
  userData.text = text;
  userData.canBeMerged = false;
  userData.soundEvent = sound;
  userData.soundAction = n"OnOpen";
  userData.animation = widget;
  notificationData.time = seconds;
  notificationData.widgetLibraryItemName = widget;
  notificationData.notificationData = userData;
  this.AddNewNotificationData(notificationData);
}

@wrapMethod(QuestTrackerGameController)
protected cb func OnInitialize() -> Bool {
  let result = wrappedMethod();
  let registry = XFDmRegistry.Get();
  if IsDefined(registry) {
    registry.SetTrackerHost(this);
    if StrLen(registry.TrackerSpec()) > 0 {
      this.XFDmDraw(registry.TrackerSpec());
    }
  }
  return result;
}

// The game sets its tracked-mappin row after every change of the tracked pin and would wipe ours: ours is drawn again after.
@wrapMethod(QuestTrackerGameController)
protected cb func OnTrackedMappinUpdated(value: Variant) -> Bool {
  if XFBridge_Live() {
    let registry = XFDmRegistry.Get();
    if IsDefined(registry) && StrLen(registry.TrackerSpec()) > 0 {
      this.m_currentMappin = FromVariant<ref<IScriptable>>(value) as IMappin;
      if IsDefined(this.m_trackedMappinSpawnRequest) { this.m_trackedMappinSpawnRequest.Cancel(); }
      this.XFDmDraw(registry.TrackerSpec());
      return false;
    }
  }
  return wrappedMethod(value);
}

// A completion already queued before XF took the container must not redraw over it.
@wrapMethod(QuestTrackerGameController)
protected cb func OnTrackedMappinSpawned(newItem: ref<inkWidget>, userData: ref<IScriptable>) -> Bool {
  if XFBridge_Live() {
    let registry = XFDmRegistry.Get();
    if IsDefined(registry) && StrLen(registry.TrackerSpec()) > 0 {
      this.XFDmDraw(registry.TrackerSpec());
      return false;
    }
  }
  return wrappedMethod(newItem, userData);
}

// spec: the quest's title, then one line per objective: state (active, done, failed), a tab, "o" for optional or "-", a tab,
// the words. Drawn in the tracked-mappin container the way OnTrackedMappinSpawned fills it.
@addMethod(QuestTrackerGameController)
public func XFDmDraw(spec: String) -> Void {
  if IsDefined(this.m_trackedMappinSpawnRequest) { this.m_trackedMappinSpawnRequest.Cancel(); }
  let lines = StrSplit(spec, "\n");
  inkCompoundRef.RemoveAllChildren(this.m_TrackedMappinObjectiveContainer);
  inkWidgetRef.SetVisible(this.m_TrackedMappinContainer, true);
  inkTextRef.SetText(this.m_TrackedMappinTitle, lines[0]);
  let i = 1;
  while i < ArraySize(lines) {
    let parts = StrSplit(lines[i], "\t");
    if ArraySize(parts) >= 3 {
      let widget = this.SpawnFromLocal(inkWidgetRef.Get(this.m_TrackedMappinObjectiveContainer), n"Objective");
      let controller = widget.GetController() as QuestTrackerObjectiveLogicController;
      if IsDefined(controller) {
        let optional = Equals(parts[1], "o");
        let words = parts[2];
        controller.SetData(words, !optional, optional, 0, 0, null, true);
        if Equals(parts[0], "done") {
          controller.SetFinished();
        } else {
          if Equals(parts[0], "failed") {
            controller.SetFailed();
          };
        };
      };
    };
    i += 1;
  };
}

// Hands the container back to the game: its own tracked pin, if any, is drawn again.
@addMethod(QuestTrackerGameController)
public func XFDmClear() -> Void {
  inkCompoundRef.RemoveAllChildren(this.m_TrackedMappinObjectiveContainer);
  inkWidgetRef.SetVisible(this.m_TrackedMappinContainer, IsDefined(this.m_currentMappin));
  this.blackboard.SignalVariant(this.uiSystemBB.TrackedMappin);
}

public abstract class XFDmHud {
  // The XF quest in the tracker: spec "" takes it down.
  public static func Tracker(cid: String, spec: String) -> String {
    let registry = XFDmRegistry.Get();
    if !IsDefined(registry) {
      return XFJson.Fail("not_ready", "the toolkit's registry isn't there yet");
    }
    registry.SetTracker(spec);
    let host = registry.TrackerHost();
    if !IsDefined(host) {
      return XFJson.Fail("hud_missing", "the HUD's quest tracker isn't up (a menu, photo mode or a loading screen); it is drawn when the HUD returns");
    }
    if StrLen(spec) > 0 {
      XFBridgeActions.EnsureSaveLock(cid);
      host.XFDmDraw(spec);
    } else {
      host.XFDmClear();
    }
    return "{\"ok\":true,\"drawn\":" + XFJson.Flag(StrLen(spec) > 0) + "}";
  }

  public static func Notify(cid: String, style: String, title: String, text: String, seconds: Float) -> String {
    let game = GetGameInstance();
    let registry = XFDmRegistry.Get();
    if !IsDefined(registry) { return XFJson.Fail("not_ready", "the toolkit's registry is unavailable"); }
    if Equals(style, "warning") || Equals(style, "onscreen") {
      let board = GameInstance.GetBlackboardSystem(game).Get(GetAllBlackboardDefs().UI_Notifications);
      if !IsDefined(board) {
        return XFJson.Fail("hud_missing", "the HUD's message board isn't there yet");
      }
      let message: SimpleScreenMessage;
      registry.SetBanner(style, text);
      message.isShown = true;
      message.duration = seconds;
      message.message = text;
      message.isInstant = true;
      message.type = SimpleMessageType.Neutral;
      if Equals(style, "warning") {
        board.SetVariant(GetAllBlackboardDefs().UI_Notifications.WarningMessage, ToVariant(message), true);
      } else {
        board.SetVariant(GetAllBlackboardDefs().UI_Notifications.OnscreenMessage, ToVariant(message), true);
      }
      XFBridgeLog.Info(cid, "dm " + style + " message shown");
      return "{\"ok\":true,\"shown\":true}";
    }
    let host = IsDefined(registry) ? registry.ToastHost() : null;
    if !IsDefined(host) {
      return XFJson.Fail("hud_missing", "the HUD's quest notifications aren't up (a menu or a loading screen); try again in normal play");
    }
    host.XFDmToast(style, title, text, seconds);
    XFBridgeLog.Info(cid, "dm " + style + " toast shown");
    return "{\"ok\":true,\"shown\":true}";
  }

  public static func NotifyHide(cid: String, style: String) -> String {
    let registry = XFDmRegistry.Get();
    if IsDefined(registry) {
      let phone = registry.PhoneHost();
      let quests = registry.ToastHost();
      if IsDefined(phone) { phone.XFDmRemove(style); }
      if IsDefined(quests) { quests.XFDmRemove(style); }
    }
    let board = GameInstance.GetBlackboardSystem(GetGameInstance()).Get(GetAllBlackboardDefs().UI_Notifications);
    if !IsDefined(board) {
      if IsDefined(registry) && (StrLen(registry.BannerText("warning")) > 0 || StrLen(registry.BannerText("onscreen")) > 0) {
        return XFJson.Fail("not_ready", "the message board is unavailable; hiding must be retried");
      }
      return "{\"ok\":true,\"banners_hidden\":false}";
    }
    let message: SimpleScreenMessage;
    message.isShown = false;
    if IsDefined(registry) && (StrLen(style) == 0 || Equals(style, "warning")) {
      let current = FromVariant<SimpleScreenMessage>(board.GetVariant(GetAllBlackboardDefs().UI_Notifications.WarningMessage));
      if StrLen(registry.BannerText("warning")) > 0 && Equals(current.message, registry.BannerText("warning")) {
        board.SetVariant(GetAllBlackboardDefs().UI_Notifications.WarningMessage, ToVariant(message), true);
      }
      registry.SetBanner("warning", "");
    }
    if IsDefined(registry) && (StrLen(style) == 0 || Equals(style, "onscreen")) {
      let current = FromVariant<SimpleScreenMessage>(board.GetVariant(GetAllBlackboardDefs().UI_Notifications.OnscreenMessage));
      if StrLen(registry.BannerText("onscreen")) > 0 && Equals(current.message, registry.BannerText("onscreen")) {
        board.SetVariant(GetAllBlackboardDefs().UI_Notifications.OnscreenMessage, ToVariant(message), true);
      }
      registry.SetBanner("onscreen", "");
    }
    return "{\"ok\":true,\"banners_hidden\":true}";
  }
}

// --- the reading for watchers and the call, the digest, the release ---------------------------------------------------------------

public abstract class XFDmSense {
  public static func TimeOfDay() -> Float {
    let time = GameInstance.GetTimeSystem(GetGameInstance());
    if !IsDefined(time) {
      return -1.0;
    }
    let now = time.GetGameTime();
    return Cast<Float>(GameTime.Hours(now) * 3600 + GameTime.Minutes(now) * 60 + GameTime.Seconds(now));
  }

  // wants: comma-separated tokens: look, occ, events, call:<contact id>. entities: key=entity id pairs, comma-separated.
  public static func Sample(cid: String, wants: String, entities: String) -> String {
    let game = GetGameInstance();
    let player = XFPlayer.Player();
    if !IsDefined(player) || !player.IsAttached() {
      return "{\"ok\":true}";
    }
    let want = StrSplit(wants, ",");
    let wantLook = false;
    let wantOcclusion = false;
    let wantEvents = false;
    let callContact = "";
    for token in want {
      if Equals(token, "look") {
        wantLook = true;
      }
      if Equals(token, "occ") {
        wantOcclusion = true;
      }
      if Equals(token, "events") {
        wantEvents = true;
      }
      if StrBeginsWith(token, "call:") {
        callContact = StrMid(token, 5);
      }
    }
    let registry = XFDmRegistry.Get();
    if IsDefined(registry) {
      registry.Listen(wantEvents);
      if wantEvents {
        registry.NoteHubs();
      }
    }
    let position = player.GetWorldPosition();
    let out = "{\"ok\":true,\"v\":" + XFScene.Arr(position) + ",\"yaw\":" + XFJson.Num(player.GetWorldYaw());
    let camera = GameInstance.GetCameraSystem(game);
    let transform: Transform;
    let cameraPosition = position;
    if IsDefined(camera) && camera.GetActiveCameraWorldTransform(transform) {
      cameraPosition = transform.position;
      out += ",\"cam\":" + XFScene.Arr(transform.position) + ",\"fwd\":" + XFScene.Arr(camera.GetActiveCameraForward());
    }
    out += ",\"combat\":" + XFJson.Flag(player.IsInCombat()) + ",\"vehicle\":" + XFJson.Flag(VehicleComponent.IsMountedToVehicle(game, player.GetEntityID()));
    out += ",\"weapon\":" + XFJson.Flag(IsDefined(ScriptedPuppet.GetActiveWeapon(player))) + ",\"tod\":" + XFJson.Num(XFDmSense.TimeOfDay());
    if wantLook {
      let targeting = GameInstance.GetTargetingSystem(game);
      let looked = IsDefined(targeting) ? targeting.GetLookAtObject(player, false, false) : null;
      out += ",\"look\":" + XFJson.Str(IsDefined(looked) ? EntityID.ToDebugString(looked.GetEntityID()) : "");
      if IsDefined(looked) && IsDefined(registry) {
        registry.Remember(looked.GetEntityID());
      }
    }
    if StrLen(callContact) > 0 {
      let quests = GameInstance.GetQuestsSystem(game);
      out += ",\"call_fact\":" + IntToString(quests.GetFactStr("phonecall_" + StrLower(callContact) + "_with_player"));
    }
    if StrLen(entities) > 0 {
      let pairs = StrSplit(entities, ",");
      let ents = "";
      let count = 0;
      for pair in pairs {
        let parts = StrSplit(pair, "=");
        let object: ref<GameObject>;
        if ArraySize(parts) >= 2 {
          object = XFDmIds.Find(parts[1]);
        }
        if IsDefined(object) {
          let at = object.GetWorldPosition();
          let objectId = EntityID.ToDebugString(object.GetEntityID());
          let entry = "{\"p\":" + XFScene.Arr(at) + ",\"id\":" + XFJson.Str(objectId);
          if wantOcclusion {
            let ray = XFScene.Ray(cameraPosition, new Vector4(at.X, at.Y, at.Z + 0.9, 1.0));
            entry += ",\"vis\":" + XFJson.Flag(!StrContains(ray, "\"blocked\":true"));
          }
          ents += (count > 0 ? "," : "") + XFJson.Str(parts[0]) + ":" + entry + "}";
          count += 1;
        }
      }
      out += ",\"ents\":{" + ents + "}";
    }
    if IsDefined(registry) {
      let events = registry.DrainEvents();
      if StrLen(events) > 0 {
        out += ",\"ev\":[" + events + "]";
      }
    }
    return out + "}";
  }

  // game.digest's game part.
  public static func Digest(cid: String, sky: Bool) -> String {
    let game = GetGameInstance();
    let player = XFPlayer.Player();
    if !IsDefined(player) || !player.IsAttached() {
      return XFJson.Fail("not_in_world", "V isn't in the world");
    }
    let out = "{\"ok\":true,\"v\":{\"position\":" + XFScene.Arr(player.GetWorldPosition()) + ",\"yaw\":" + XFJson.Num(player.GetWorldYaw());
    out += ",\"busy\":" + XFJson.Str(XFPlayer.Busy(player)) + ",\"vitals\":" + XFSenses.Vitals(game, player) + ",\"vehicle\":" + XFSenses.Vehicle(game, player);
    out += ",\"look_at\":" + XFScene.LookedAt(player) + "}";
    out += ",\"world\":{\"clock\":" + XFWorldState.Clock();
    if sky {
      out += ",\"rain\":" + XFWorldState.Rain() + ",\"weather\":" + XFWeather.Current(false);
    }
    out += ",\"heat\":" + XFSenses.Heat(game) + "}";
    return out + "}";
  }

  // Everything the script holds: the call ended, lines hidden, the tracker down, banners down, sounds are the plugin's to stop
  // (it tracks them), the entities deleted. Idempotent.
  public static func ReleaseAll(cid: String, reason: String) -> String {
    let registry = XFDmRegistry.Get();
    let lines = XFDmLines.HideAll(cid);
    let removed = XFDmSpawn.Clear(cid);
    let call = "";
    if IsDefined(registry) {
      call = registry.CallContact();
      registry.Listen(false);
      registry.SetTracker("");
      let host = registry.TrackerHost();
      if IsDefined(host) {
        host.XFDmClear();
      }
    }
    if StrLen(call) > 0 {
      let ended = XFDmPhone.End(cid, call);
      if StrContains(ended, "\"ok\":false") { return ended; }
    }
    let hidden = XFDmHud.NotifyHide(cid, "");
    if StrContains(hidden, "\"ok\":false") { return hidden; }
    if lines < 0 || removed < 0 { return XFJson.Fail("not_ready", "some toolkit cleanup could not be confirmed; ownership is retained for retry"); }
    XFBridgeLog.Info(cid, "dm released everything (" + reason + "): lines=" + IntToString(lines) + " entities=" + IntToString(removed));
    return "{\"ok\":true,\"lines_hidden\":" + IntToString(lines) + ",\"entities_removed\":" + IntToString(removed) + ",\"call_ended\":" + XFJson.Flag(StrLen(call) > 0) + "}";
  }
}
