// XF Runtime Bridge: NPC direction (bridge 0.8; research/runtime/npc-direction-design.md, knowledge/npc-direction.md).
//
// The game side of npc.*: XF actors spawned through Codeware's dynamic entity system (never persistent: both persist flags
// off, a transient id, dropped at world detach), NPCs near V listed and picked under the world-object rule, AI commands
// (AIMoveToCommand, AIFollowTargetCommand, AIRotateToCommand, AITeleportCommand) sent, tracked and cancelled the way the
// game's own ForceMoveInCombat effector does, text lines on the subtitle blackboard (as Audioware posts them) and vanilla
// voiceset triggers, look-ats and facial reactions built as the reaction component builds them, body gestures through the
// XF gesture carrier (a workspot entity), and a dialogue hub added to the game's own dialogue widget, navigated with the
// player's usual choice keys (the technique of keanuWheeze's InteractionUI module, ported to redscript; no code copied).
//
// The native plugin decides everything (core/Npc.cpp: refusals, limits, undos, events); this file only acts and reports.
// Every change takes the bridge's save lock first; XFGame.BridgeHolds names spawned actors so game.save refuses while any
// exists. The kill switch calls XFNpc.ReleaseAll; a load needs nothing (the registry is per session and Codeware drops
// non-persistent entities with the world).
//
// Sources [source] 2.31: AIComponent (core/components/aiComponent.script:1-34), the AI commands (orphans.script:25056, 28774,
// 44519, 47141, 47171, 47349), AIPositionSpec (29704), quickhackEffectors.script:883-925 (build, send, stop or cancel),
// scnDialogLineData (44905) on UIGameData.ShowDialogLine / HideDialogLine (baseSubtitlesControllers.script:120-252),
// GameObject.PlayVoiceOver (gameObject.script:743-770), LookAtAddEvent / LookAtRemoveEvent (26560; lookAtEvents.script:2-10;
// reactionComponent.script:3539-3600), AnimFeature_FacialReaction (32382; reactionComponent.script:2869-2917),
// WorkspotGameSystem (18383-18415), ListChoiceHubData and DialogChoiceHubs (54489-54517, 42023), InteractionUIBase
// (interactionUIBase.script:32-107), dialogWidgetGameController (dialogUI.script:61-72), PlayerPuppet.OnAction
// (player.script:1202), ScriptedPuppet's classification (scriptedPuppet.script:1299-3002). Codeware 1.20.4:
// DynamicEntitySystem, DynamicEntitySpec, CreateCRUID, the resource depot.

module XFRuntimeBridge

// One NPC the bridge directs: an actor it spawned or a pick.
public class XFNpcEntry {
  public let who: String;
  public let kind: String; // "actor" or "pick"
  public let record: String;
  public let id: EntityID;
  public let prepared: Bool; // an actor made friendly and immortal once it exists
  public let command: ref<AICommand>;
  public let look: ref<LookAtAddEvent>;
  public let faced: Bool;
  public let lines: array<Int32>;
  public let carrier: EntityID;
  public let hasCarrier: Bool;
  public let clip: String;      // the gesture waiting for its carrier, or playing
  public let playing: Bool;
}

// One per game session: what the bridge holds on NPCs, and the dialogue hub it shows. A load starts a new one.
public class XFNpcRegistry extends ScriptableSystem {
  private let m_entries: array<ref<XFNpcEntry>>;
  private let m_hubShown: Bool;
  private let m_hub: ListChoiceHubData;
  private let m_hubWho: String;
  private let m_hubIndex: Int32;
  private let m_hubAnswer: Int32;
  private let m_lastInputAt: Float;
  private let m_voiceLines: array<Int32>; // lines from a voice with no body (npc.say without who)

  public static func Get() -> ref<XFNpcRegistry> {
    let game = GetGameInstance();
    if !GameInstance.IsValid(game) {
      return null;
    }
    let container = GameInstance.GetScriptableSystemsContainer(game);
    if !IsDefined(container) {
      return null;
    }
    return container.Get(n"XFRuntimeBridge.XFNpcRegistry") as XFNpcRegistry;
  }

  public func Add(entry: ref<XFNpcEntry>) -> Void {
    ArrayPush(this.m_entries, entry);
  }

  public func Entry(who: String) -> ref<XFNpcEntry> {
    for entry in this.m_entries {
      if Equals(entry.who, who) {
        return entry;
      }
    }
    return null;
  }

  public func Entries() -> array<ref<XFNpcEntry>> {
    return this.m_entries;
  }

  public func Forget(who: String) -> Void {
    let kept: array<ref<XFNpcEntry>>;
    for entry in this.m_entries {
      if NotEquals(entry.who, who) {
        ArrayPush(kept, entry);
      }
    }
    this.m_entries = kept;
  }

  public func ForgetAll() -> Void {
    ArrayClear(this.m_entries);
  }

  public func Actors() -> Int32 {
    let n = 0;
    for entry in this.m_entries {
      if Equals(entry.kind, "actor") {
        n += 1;
      }
    }
    return n;
  }

  // The entry whose entity is this id ("" when none): npc.list marks the session's own.
  public func WhoIs(id: EntityID) -> String {
    for entry in this.m_entries {
      if entry.id == id {
        return entry.who;
      }
    }
    return "";
  }

  public func ShowHub(hub: ListChoiceHubData, who: String) -> Void {
    this.m_hub = hub;
    this.m_hubWho = who;
    this.m_hubShown = true;
    this.m_hubIndex = 0;
    this.m_hubAnswer = -1;
  }

  public func HideHub() -> Void {
    this.m_hubShown = false;
  }

  public func HubShown() -> Bool {
    return this.m_hubShown;
  }

  public func Hub() -> ListChoiceHubData {
    return this.m_hub;
  }

  public func HubWho() -> String {
    return this.m_hubWho;
  }

  public func HubIndex() -> Int32 {
    return this.m_hubIndex;
  }

  public func SetHubIndex(index: Int32) -> Void {
    this.m_hubIndex = index;
  }

  public func HubAnswer() -> Int32 {
    return this.m_hubAnswer;
  }

  public func SetHubAnswer(index: Int32) -> Void {
    this.m_hubAnswer = index;
  }

  public func ClearHubAnswer() -> Void {
    this.m_hubAnswer = -1;
    let empty: ListChoiceHubData;
    this.m_hub = empty;
  }

  public func AddVoiceLine(line: Int32) -> Void {
    ArrayPush(this.m_voiceLines, line);
  }

  public func RemoveVoiceLine(line: Int32) -> Void {
    ArrayRemove(this.m_voiceLines, line);
  }

  public func TakeVoiceLines() -> array<Int32> {
    let lines = this.m_voiceLines;
    ArrayClear(this.m_voiceLines);
    return lines;
  }

  public func LastInputAt() -> Float {
    return this.m_lastInputAt;
  }

  public func SetLastInputAt(at: Float) -> Void {
    this.m_lastInputAt = at;
  }

  // What a save would keep (XFGame.BridgeHolds): the actors, named plainly; "" when none.
  public static func HoldsText() -> String {
    let registry = XFNpcRegistry.Get();
    if !IsDefined(registry) {
      return "";
    }
    let actors = registry.Actors();
    if actors == 0 {
      return "";
    }
    return IntToString(actors) + " XF actor(s) spawned by the bridge (npc_release all)";
  }
}

// V for the NPC commands' refusals (no Codeware needed).
public abstract class XFNpcV {
  public static func Where(cid: String) -> String {
    let phase = XFBridgeActions.Phase();
    let player = XFPlayer.Player();
    if !IsDefined(player) {
      return "{\"ok\":true,\"phase\":" + XFJson.Str(phase) + ",\"busy\":\"not_v\"}";
    }
    let position = player.GetWorldPosition();
    let yaw = player.GetWorldYaw();
    let busy = XFPlayer.Busy(player);
    let state = XFPlayer.BusyState(player);
    return "{\"ok\":true,\"phase\":" + XFJson.Str(phase) + ",\"position\":" + XFScene.Arr(position) + ",\"yaw\":" + XFJson.Num(yaw) + ",\"busy\":" + XFJson.Str(busy) + ",\"busy_state\":" + XFJson.Str(state) + "}";
  }
}

// The dialogue hub in the game's own widget (the InteractionUI technique): our hub is appended to whatever the game sends the
// widget, made the active one, and the player's choice keys move its highlight and pick. Only shown while no vanilla hub or
// interaction prompt is up (XFNpc.Hub refuses choices_busy), so it never competes with the game's own choices.
public abstract class XFNpcHub {
  public static func Board() -> ref<IBlackboard> {
    return GameInstance.GetBlackboardSystem(GetGameInstance()).Get(GetAllBlackboardDefs().UIInteractions);
  }

  // Whether the game shows its own dialogue choices or an interaction prompt now.
  public static func GameBusy() -> Bool {
    let board = XFNpcHub.Board();
    if !IsDefined(board) {
      return true;
    }
    let defs = GetAllBlackboardDefs().UIInteractions;
    let hubs = FromVariant<DialogChoiceHubs>(board.GetVariant(defs.DialogChoiceHubs));
    if ArraySize(hubs.choiceHubs) > 0 {
      return true;
    }
    let prompt = FromVariant<InteractionChoiceHubData>(board.GetVariant(defs.InteractionChoiceHub));
    return prompt.active;
  }

  // Makes every widget listening to the dialogue data draw again (our wrap below appends the hub), then selects our hub.
  public static func Refresh(select: Bool) -> Void {
    let board = XFNpcHub.Board();
    let registry = XFNpcRegistry.Get();
    if !IsDefined(board) || !IsDefined(registry) {
      return;
    }
    let defs = GetAllBlackboardDefs().UIInteractions;
    board.SetVariant(defs.DialogChoiceHubs, board.GetVariant(defs.DialogChoiceHubs), true);
    if select && registry.HubShown() {
      let hub = registry.Hub();
      board.SetInt(defs.ActiveChoiceHubID, hub.id, true);
      board.SetInt(defs.SelectedIndex, registry.HubIndex(), true);
    }
  }

  public static func Build(id: Int32, title: String, choices: String) -> ListChoiceHubData {
    let hub: ListChoiceHubData;
    hub.id = id;
    hub.title = title;
    hub.activityState = EVisualizerActivityState.Active;
    hub.isPhoneLockActive = false;
    let texts = StrSplit(choices, "\n");
    for text in texts {
      let choice: ListChoiceData;
      choice.localizedName = text;
      choice.inputActionName = n"None";
      ArrayPush(hub.choices, choice);
    }
    return hub;
  }

  // The player's ChoiceScrollUp, ChoiceScrollDown and ChoiceApply while our hub shows (PlayerPuppet.OnAction's wrap).
  // Answers true when it handled the action (the caller consumes it).
  public static func OnChoiceAction(name: CName, actionType: gameinputActionType) -> Bool {
    let registry = XFNpcRegistry.Get();
    if !IsDefined(registry) || !registry.HubShown() {
      return false;
    }
    if NotEquals(actionType, gameinputActionType.BUTTON_PRESSED) {
      return false;
    }
    // One input per frame (the module's guard against a doubled action).
    let now = EngineTime.ToFloat(GameInstance.GetEngineTime(GetGameInstance()));
    if now == registry.LastInputAt() {
      return true;
    }
    registry.SetLastInputAt(now);
    let hub = registry.Hub();
    let count = ArraySize(hub.choices);
    if count == 0 {
      return false;
    }
    let index = registry.HubIndex();
    if Equals(name, n"ChoiceScrollUp") {
      registry.SetHubIndex((index + count - 1) % count);
      XFNpcHub.Refresh(true);
      return true;
    }
    if Equals(name, n"ChoiceScrollDown") {
      registry.SetHubIndex((index + 1) % count);
      XFNpcHub.Refresh(true);
      return true;
    }
    if Equals(name, n"ChoiceApply") {
      registry.SetHubAnswer(index);
      registry.HideHub();
      XFNpcHub.Refresh(false);
      XFBridgeLog.Info("npc-hub", "the player chose " + IntToString(index) + " in hub " + IntToString(hub.id));
      return true;
    }
    return false;
  }
}

@wrapMethod(InteractionUIBase)
protected cb func OnDialogsData(value: Variant) -> Bool {
  let registry = XFNpcRegistry.Get();
  if IsDefined(registry) && registry.HubShown() {
    let data = FromVariant<DialogChoiceHubs>(value);
    ArrayPush(data.choiceHubs, registry.Hub());
    return wrappedMethod(ToVariant(data));
  }
  return wrappedMethod(value);
}

@wrapMethod(InteractionUIBase)
protected cb func OnInteractionData(value: Variant) -> Bool {
  // While our hub shows, the interaction prompt doesn't redraw over it (the module's flicker guard).
  let registry = XFNpcRegistry.Get();
  if IsDefined(registry) && registry.HubShown() {
    return true;
  }
  return wrappedMethod(value);
}

@wrapMethod(dialogWidgetGameController)
protected cb func OnDialogsActivateHub(activeHubId: Int32) -> Bool {
  let registry = XFNpcRegistry.Get();
  if IsDefined(registry) && registry.HubShown() {
    let hub = registry.Hub();
    return wrappedMethod(hub.id);
  }
  return wrappedMethod(activeHubId);
}

@wrapMethod(dialogWidgetGameController)
protected cb func OnDialogsSelectIndex(index: Int32) -> Bool {
  let registry = XFNpcRegistry.Get();
  if IsDefined(registry) && registry.HubShown() {
    return wrappedMethod(registry.HubIndex());
  }
  return wrappedMethod(index);
}

@wrapMethod(PlayerPuppet)
protected cb func OnAction(action: ListenerAction, consumer: ListenerActionConsumer) -> Bool {
  let name = ListenerAction.GetName(action);
  if Equals(name, n"ChoiceScrollUp") || Equals(name, n"ChoiceScrollDown") || Equals(name, n"ChoiceApply") {
    if XFNpcHub.OnChoiceAction(name, ListenerAction.GetType(action)) {
      ListenerActionConsumer.Consume(consumer);
    }
  }
  return wrappedMethod(action, consumer);
}

// Protection reasons for an NPC the bridge didn't spawn (npc.list, npc.pick): typed checks after a cast only (the world-object
// rule); every answer kept in a local.
public abstract class XFNpcCheck {
  public static func Reasons(puppet: ref<ScriptedPuppet>) -> String {
    let out = "";
    let quest = puppet.IsQuest();
    let companion = puppet.IsPlayerCompanion();
    let boss = puppet.IsBoss();
    let vendor = puppet.IsVendor();
    let police = puppet.IsCharacterPolice();
    let child = puppet.IsCharacterChildren();
    let autonomous = puppet.IsOnAutonomousAI();
    let id = puppet.GetEntityID();
    let scenes = GameInstance.GetSceneSystem(GetGameInstance()).GetScriptInterface();
    let inScene = IsDefined(scenes) && (scenes.IsEntityInScene(id) || scenes.IsEntityInDialogue(id));
    if quest {
      out += (StrLen(out) > 0 ? "," : "") + "\"quest\"";
    }
    if companion {
      out += (StrLen(out) > 0 ? "," : "") + "\"companion\"";
    }
    if boss {
      out += (StrLen(out) > 0 ? "," : "") + "\"boss\"";
    }
    if vendor {
      out += (StrLen(out) > 0 ? "," : "") + "\"vendor\"";
    }
    if police {
      out += (StrLen(out) > 0 ? "," : "") + "\"police\"";
    }
    if child {
      out += (StrLen(out) > 0 ? "," : "") + "\"child\"";
    }
    if !autonomous {
      out += (StrLen(out) > 0 ? "," : "") + "\"cinematic\"";
    }
    if inScene {
      out += (StrLen(out) > 0 ? "," : "") + "\"in_scene\"";
    }
    return out;
  }

  public static func Busy(puppet: ref<ScriptedPuppet>) -> String {
    let workspots = GameInstance.GetWorkspotSystem(GetGameInstance());
    let inWorkspot = IsDefined(workspots) && workspots.IsActorInWorkspot(puppet);
    if inWorkspot {
      return "workspot";
    }
    let combat = NPCPuppet.IsInCombat(puppet);
    if combat {
      return "combat";
    }
    return "";
  }
}

@if(ModuleExists("Codeware"))
public abstract class XFNpc {
  // The XF gesture carrier (tools/npc/gesture-carrier.ts builds it into the -writes package's archive).
  public static func CarrierPath() -> ResRef {
    return r"xfs\\bridge\\npc\\xfs_gesture_carrier.ent";
  }

  public static func Vec(v: Vector4) -> String {
    return XFScene.Arr(v);
  }

  // The entity behind a handle: an actor through the dynamic entity system, a pick by its id.
  public static func EntityOf(entry: ref<XFNpcEntry>) -> ref<Entity> {
    if !IsDefined(entry) {
      return null;
    }
    if Equals(entry.kind, "actor") {
      let system = GameInstance.GetDynamicEntitySystem();
      return IsDefined(system) ? system.GetEntity(entry.id) : null;
    }
    return GameInstance.FindEntityByID(GetGameInstance(), entry.id);
  }

  public static func PuppetOf(entry: ref<XFNpcEntry>) -> ref<ScriptedPuppet> {
    let entity = XFNpc.EntityOf(entry);
    return entity as ScriptedPuppet;
  }

  public static func Lost(who: String) -> String {
    return XFJson.Fail("npc_lost", who + " isn't in the world any more (streamed out or removed)");
  }

  // A command's or look's target: V, another handle's entity, or a point.
  public static func TargetEntity(kind: String, targetWho: String) -> ref<Entity> {
    if Equals(kind, "v") {
      return GetPlayer(GetGameInstance());
    }
    if Equals(kind, "who") {
      let registry = XFNpcRegistry.Get();
      return IsDefined(registry) ? XFNpc.EntityOf(registry.Entry(targetWho)) : null;
    }
    return null;
  }

  public static func Spec(kind: String, targetWho: String, x: Float, y: Float, z: Float, out spec: AIPositionSpec) -> Bool {
    let entity = XFNpc.TargetEntity(kind, targetWho);
    if IsDefined(entity) {
      AIPositionSpec.SetEntity(spec, entity);
      return true;
    }
    if Equals(kind, "point") {
      let wp: WorldPosition;
      WorldPosition.SetVector4(wp, new Vector4(x, y, z, 1.0));
      AIPositionSpec.SetWorldPosition(spec, wp);
      return true;
    }
    return false;
  }

  // Stops the actor's current XF command the way the game's effector does: stopped if executing, else cancelled.
  public static func CancelCommand(entry: ref<XFNpcEntry>, puppet: ref<ScriptedPuppet>) -> Void {
    if !IsDefined(entry.command) {
      return;
    }
    if IsDefined(puppet) {
      let ai = puppet.GetAIControllerComponent();
      if IsDefined(ai) {
        let state = ai.GetCommandState(entry.command);
        if Equals(state, AICommandState.Executing) {
          ai.StopExecutingCommand(entry.command, false);
        } else {
          ai.CancelCommand(entry.command);
        }
      }
    }
    entry.command = null;
  }

  public static func List(cid: String, radius: Float, max: Int32) -> String {
    let player = XFPlayer.Player();
    if !IsDefined(player) {
      return XFJson.Fail("not_in_world", "V isn't in the world");
    }
    let registry = XFNpcRegistry.Get();
    let from = player.GetWorldPosition();
    let npcs = player.GetNPCsAroundObject(radius);
    let out = "";
    let written = 0;
    for npc in npcs {
      if written < max && IsDefined(npc) {
      let puppet = npc as ScriptedPuppet;
      let identity = XFScene.Identity(npc, from);
      let position = npc.GetWorldPosition();
      let dead = npc.IsDead();
      let crowd = IsDefined(puppet) && puppet.IsCrowd();
      let reasons = IsDefined(puppet) ? XFNpcCheck.Reasons(puppet) : "\"not_a_puppet\"";
      let busy = IsDefined(puppet) ? XFNpcCheck.Busy(puppet) : "";
      let ours = IsDefined(registry) ? registry.WhoIs(npc.GetEntityID()) : "";
      out += (written > 0 ? "," : "") + "{" + identity + ",\"position\":" + XFScene.Arr(position) + ",\"dead\":" + XFJson.Flag(dead);
      out += ",\"crowd\":" + XFJson.Flag(crowd) + ",\"protected\":" + XFJson.Flag(StrLen(reasons) > 0) + ",\"reasons\":[" + reasons + "]";
      out += ",\"busy\":" + (StrLen(busy) > 0 ? XFJson.Str(busy) : "null") + (StrLen(ours) > 0 ? ",\"ours\":" + XFJson.Str(ours) : "") + "}";
      written += 1;
    }
    }
    return "{\"ok\":true,\"npcs\":[" + out + "],\"found\":" + IntToString(ArraySize(npcs)) + "}";
  }

  public static func Pick(cid: String, who: String, id: String) -> String {
    let player = XFPlayer.Player();
    let registry = XFNpcRegistry.Get();
    if !IsDefined(player) || !IsDefined(registry) {
      return XFJson.Fail("not_in_world", "V isn't in the world");
    }
    let from = player.GetWorldPosition();
    let npcs = player.GetNPCsAroundObject(40.0);
    for npc in npcs {
      let npcId: EntityID;
      if IsDefined(npc) {
        npcId = npc.GetEntityID();
      }
      if IsDefined(npc) && Equals(EntityID.ToDebugString(npcId), id) {
      let puppet = npc as ScriptedPuppet;
      if !IsDefined(puppet) {
        return XFJson.Fail("npc_protected", "that isn't an NPC the bridge can direct");
      }
      let dead = puppet.IsDead();
      if dead {
        return XFJson.Fail("npc_busy", "that NPC is dead");
      }
      let reasons = XFNpcCheck.Reasons(puppet);
      if StrLen(reasons) > 0 {
        return XFJson.Fail("npc_protected", "that NPC belongs to the game's story or services (" + StrReplaceAll(reasons, "\"", "") + "); the bridge leaves it alone");
      }
      let busy = XFNpcCheck.Busy(puppet);
      if StrLen(busy) > 0 {
        return XFJson.Fail("npc_busy", "that NPC is busy (" + busy + ")");
      }
      let position = puppet.GetWorldPosition();
      let distance = Vector4.Distance(position, from);
      if distance > 40.0 {
        return XFJson.Fail("too_far", "that NPC is more than 40 m from V");
      }
      let recordId = puppet.GetRecordID();
      let record = TDBID.ToStringDEBUG(recordId);
      let crowd = puppet.IsCrowd();
      let cls = puppet.GetClassName();
      let entry = new XFNpcEntry();
      entry.who = who;
      entry.kind = "pick";
      entry.record = record;
      entry.id = npcId;
      registry.Add(entry);
      XFBridgeLog.Info(cid, "npc picked " + who + " record=" + record);
      return "{\"ok\":true,\"record\":" + XFJson.Str(record) + ",\"class\":" + XFJson.Name(cls) + ",\"crowd\":" + XFJson.Flag(crowd) + ",\"position\":" + XFScene.Arr(position) + ",\"label\":\"Stranger\"}";
    }
    }
    return XFJson.Fail("npc_not_found", "no NPC with that id is near V now (npc_list again)");
  }

  public static func Spawn(cid: String, who: String, record: String, x: Float, y: Float, z: Float, yaw: Float, appearance: String, outOfView: Bool) -> String {
    let game = GetGameInstance();
    let system = GameInstance.GetDynamicEntitySystem();
    let registry = XFNpcRegistry.Get();
    if !IsDefined(system) || !system.IsReady() || !IsDefined(registry) {
      return XFJson.Fail("not_ready", "the game can't spawn NPCs yet; try again in a moment");
    }
    let recordId = TDBID.Create(record);
    if !IsDefined(TweakDBInterface.GetCharacterRecord(recordId)) {
      return XFJson.Fail("record_missing", "the XF actor record " + record + " isn't in the game's database: stage the bridge's -writes package (its TweakXL file) and make sure TweakXL is installed");
    }
    let target = new Vector4(x, y, z, 1.0);
    let navigation = GameInstance.GetNavigationSystem(game);
    if !navigation.IsNavmeshStreamedInLocation(target, 2.0) {
      return XFJson.Fail("not_streamed", "the world around that place isn't loaded (no walkable ground streamed in)");
    }
    let found = navigation.FindPointInSphereOnlyHumanNavmesh(target, 2.0, NavGenAgentSize.Human, true);
    if NotEquals(found.status, worldNavigationRequestStatus.OK) {
      return XFJson.Fail("not_walkable", "there is no walkable ground within 2 m of that place");
    }
    let player = XFPlayer.Player();
    if IsDefined(player) && Vector4.Distance(player.GetWorldPosition(), found.point) > 30.0 {
      return XFJson.Fail("too_far", "that place is more than 30 m from V");
    }
    let angles: EulerAngles;
    angles.Yaw = yaw;
    let spec = new DynamicEntitySpec();
    spec.recordID = recordId;
    spec.appearanceName = StringToName(appearance);
    spec.position = found.point;
    spec.orientation = EulerAngles.ToQuat(angles);
    // Never saved: no state and no respawn after a load (Codeware writes only specs with either flag; world detach drops
    // the rest).
    spec.persistState = false;
    spec.persistSpawn = false;
    spec.alwaysSpawned = true;
    spec.spawnInView = !outOfView;
    spec.active = true;
    ArrayPush(spec.tags, n"xfs_npc");
    XFBridgeActions.EnsureSaveLock(cid);
    let id = system.CreateEntity(spec);
    if !EntityID.IsDefined(id) {
      return XFJson.Fail("spawn_refused", "the game's entity spawner refused the actor");
    }
    let entry = new XFNpcEntry();
    entry.who = who;
    entry.kind = "actor";
    entry.record = record;
    entry.id = id;
    registry.Add(entry);
    XFBridgeLog.Info(cid, "npc spawned " + who + " record=" + record + " at " + XFScene.Arr(found.point) + " (non-persistent, tag xfs_npc)");
    return "{\"ok\":true,\"entity\":" + XFJson.Str(EntityID.ToDebugString(id)) + ",\"position\":" + XFScene.Arr(found.point) + "}";
  }

  // An actor's first moment in the world: friendly to V and immortal (AMM's Director does the same), gone with it.
  public static func Prepare(entry: ref<XFNpcEntry>, puppet: ref<ScriptedPuppet>) -> Void {
    let player = XFPlayer.Player();
    let agent = puppet.GetAttitudeAgent();
    if IsDefined(agent) && IsDefined(player) {
      agent.SetAttitudeTowards(player.GetAttitudeAgent(), EAIAttitude.AIA_Friendly);
    }
    let gods = GameInstance.GetGodModeSystem(GetGameInstance());
    if IsDefined(gods) {
      gods.AddGodMode(entry.id, gameGodModeType.Immortal, n"XFRuntimeBridge");
    }
    entry.prepared = true;
  }

  public static func Command(cid: String, who: String, kind: String, targetKind: String, targetWho: String, x: Float, y: Float, z: Float, gait: Int32, distance: Float, yaw: Float, hasYaw: Bool, faceV: Bool) -> String {
    let registry = XFNpcRegistry.Get();
    let entry = IsDefined(registry) ? registry.Entry(who) : null;
    let puppet = XFNpc.PuppetOf(entry);
    if !IsDefined(puppet) {
      if Equals(kind, "stop") && IsDefined(entry) {
        entry.command = null;
        return "{\"ok\":true,\"sent\":false}";
      }
      return XFNpc.Lost(who);
    }
    let ai = puppet.GetAIControllerComponent();
    if !IsDefined(ai) {
      return XFJson.Fail("no_ai", who + " has no AI to take commands");
    }
    let position = puppet.GetWorldPosition();
    let facing = puppet.GetWorldYaw();
    let before = "{\"position\":" + XFScene.Arr(position) + ",\"yaw\":" + XFJson.Num(facing) + "}";
    XFNpc.CancelCommand(entry, puppet);
    if Equals(kind, "stop") {
      return "{\"ok\":true,\"sent\":true,\"before\":" + before + "}";
    }
    XFBridgeActions.EnsureSaveLock(cid);
    if Equals(kind, "move") {
      let move = new AIMoveToCommand();
      let spec: AIPositionSpec;
      if !XFNpc.Spec(targetKind, targetWho, x, y, z, spec) {
        return XFJson.Fail("npc_lost", "the target isn't in the world");
      }
      move.movementTarget = spec;
      if faceV {
        AIPositionSpec.SetEntity(move.facingTarget, GetPlayer(GetGameInstance()));
        move.rotateEntityTowardsFacingTarget = true;
      }
      move.movementType = IntEnum<moveMovementType>(gait);
      move.desiredDistanceFromTarget = distance;
      move.finishWhenDestinationReached = true;
      move.ignoreNavigation = false;
      move.useStart = true;
      move.useStop = true;
      move.removeAfterCombat = true;
      move.ignoreInCombat = false;
      ai.SendCommand(move);
      entry.command = move;
    } else {
      if Equals(kind, "follow") {
        let target = XFNpc.TargetEntity(targetKind, targetWho) as GameObject;
        if !IsDefined(target) {
          return XFJson.Fail("npc_lost", "the one to follow isn't in the world");
        }
        let follow = new AIFollowTargetCommand();
        follow.target = target;
        follow.lookAtTarget = target;
        follow.desiredDistance = distance;
        follow.tolerance = 1.0;
        follow.stopWhenDestinationReached = false;
        follow.movementType = IntEnum<moveMovementType>(gait);
        follow.matchSpeed = true;
        follow.teleport = false;
        follow.removeAfterCombat = true;
        ai.SendCommand(follow);
        entry.command = follow;
      } else {
        if Equals(kind, "turn") {
          let turn = new AIRotateToCommand();
          let spec: AIPositionSpec;
          if !XFNpc.Spec(targetKind, targetWho, x, y, z, spec) {
            return XFJson.Fail("npc_lost", "the target isn't in the world");
          }
          turn.target = spec;
          turn.angleTolerance = 10.0;
          turn.angleOffset = 0.0;
          turn.speed = 1.0;
          ai.SendCommand(turn);
          entry.command = turn;
        } else {
          if Equals(kind, "place") {
            let teleport = new AITeleportCommand();
            teleport.position = new Vector4(x, y, z, 1.0);
            teleport.rotation = hasYaw ? yaw : facing;
            teleport.doNavTest = false;
            ai.SendCommand(teleport);
            entry.command = teleport;
          } else {
            return XFJson.Fail("bad_params", "unknown command " + kind);
          }
        }
      }
    }
    XFBridgeLog.Info(cid, "npc " + who + " command " + kind + " sent");
    return "{\"ok\":true,\"sent\":true,\"before\":" + before + "}";
  }

  public static func LineId(line: Int32) -> CRUID {
    return CreateCRUID(StringToUint64("5846" + IntToString(line)));
  }

  // who "" is a voice with no body (npc.say without who): OwnerlessRegular (type 9) needs no speaker entity
  // (baseSubtitlesControllers.script:523-533); holocall and subtitle lines get V as their carrier so the subtitle controller
  // shows them, with the voice's own name.
  public static func Say(cid: String, who: String, line: Int32, text: String, trigger: String, lineType: Int32, speaker: String, seconds: Float) -> String {
    let registry = XFNpcRegistry.Get();
    let voice = StrLen(who) == 0;
    let entry = IsDefined(registry) && !voice ? registry.Entry(who) : null;
    let npc = XFNpc.EntityOf(entry) as GameObject;
    if !voice && !IsDefined(npc) {
      return XFNpc.Lost(who);
    }
    XFBridgeActions.EnsureSaveLock(cid);
    if StrLen(trigger) > 0 && !voice {
      GameObject.PlayVoiceOver(npc, StringToName(trigger), n"Scripts:XFRuntimeBridge");
    }
    if StrLen(text) > 0 {
      let data: scnDialogLineData;
      data.id = XFNpc.LineId(line);
      data.text = text;
      data.type = IntEnum<scnDialogLineType>(lineType);
      if voice {
        if lineType != 9 {
          data.speaker = GetPlayer(GetGameInstance());
        }
      } else {
        data.speaker = npc;
      }
      data.speakerName = speaker;
      data.isPersistent = false;
      data.duration = seconds;
      let lines: array<scnDialogLineData>;
      ArrayPush(lines, data);
      let board = GameInstance.GetBlackboardSystem(GetGameInstance()).Get(GetAllBlackboardDefs().UIGameData);
      board.SetVariant(GetAllBlackboardDefs().UIGameData.ShowDialogLine, ToVariant(lines), true);
      if voice {
        if IsDefined(registry) {
          registry.AddVoiceLine(line);
        }
      } else {
        ArrayPush(entry.lines, line);
      }
    }
    return "{\"ok\":true,\"line_id\":" + IntToString(line) + "}";
  }

  public static func Hide(cid: String, who: String, line: Int32) -> String {
    let ids: array<CRUID>;
    ArrayPush(ids, XFNpc.LineId(line));
    let board = GameInstance.GetBlackboardSystem(GetGameInstance()).Get(GetAllBlackboardDefs().UIGameData);
    board.SetVariant(GetAllBlackboardDefs().UIGameData.HideDialogLine, ToVariant(ids), true);
    let registry = XFNpcRegistry.Get();
    let entry = IsDefined(registry) ? registry.Entry(who) : null;
    if IsDefined(entry) {
      ArrayRemove(entry.lines, line);
    }
    if IsDefined(registry) && StrLen(who) == 0 {
      registry.RemoveVoiceLine(line);
    }
    return "{\"ok\":true,\"hidden\":true}";
  }

  public static func Look(cid: String, who: String, targetKind: String, targetWho: String, x: Float, y: Float, z: Float, off: Bool) -> String {
    let registry = XFNpcRegistry.Get();
    let entry = IsDefined(registry) ? registry.Entry(who) : null;
    let npc = XFNpc.EntityOf(entry) as GameObject;
    if !IsDefined(npc) {
      if off && IsDefined(entry) {
        entry.look = null;
        return "{\"ok\":true,\"looking\":false}";
      }
      return XFNpc.Lost(who);
    }
    if IsDefined(entry.look) {
      LookAtRemoveEvent.QueueRemoveLookatEvent(npc, entry.look);
      entry.look = null;
    }
    if off {
      return "{\"ok\":true,\"looking\":false}";
    }
    XFBridgeActions.EnsureSaveLock(cid);
    // As the reaction component builds its look-at (reactionComponent.script:3539-3600).
    let evt = new LookAtAddEvent();
    let target = XFNpc.TargetEntity(targetKind, targetWho);
    if IsDefined(target) {
      evt.SetEntityTarget(target, n"pla_default_tgt", Vector4.EmptyVector());
    } else {
      evt.SetStaticTarget(new Vector4(x, y, z, 1.0));
    }
    evt.SetStyle(animLookAtStyle.Normal);
    evt.request.limits.softLimitDegrees = 360.0;
    evt.request.limits.hardLimitDegrees = 270.0;
    evt.request.limits.backLimitDegrees = 210.0;
    evt.request.calculatePositionInParentSpace = true;
    evt.bodyPart = n"Eyes";
    let parts: array<LookAtPartRequest>;
    let head: LookAtPartRequest;
    head.partName = n"Head";
    head.weight = 0.1;
    head.suppress = 1.0;
    head.mode = 0;
    ArrayPush(parts, head);
    let chest: LookAtPartRequest;
    chest.partName = n"Chest";
    chest.weight = 0.2;
    chest.suppress = 0.0;
    chest.mode = 0;
    ArrayPush(parts, chest);
    evt.SetAdditionalPartsArray(parts);
    npc.QueueEvent(evt);
    entry.look = evt;
    return "{\"ok\":true,\"looking\":true}";
  }

  public static func Face(cid: String, who: String, category: Int32, idle: Int32) -> String {
    let registry = XFNpcRegistry.Get();
    let entry = IsDefined(registry) ? registry.Entry(who) : null;
    let npc = XFNpc.EntityOf(entry) as GameObject;
    if !IsDefined(npc) {
      if category == 0 && IsDefined(entry) {
        entry.faced = false;
        return "{\"ok\":true,\"category\":0,\"idle\":0}";
      }
      return XFNpc.Lost(who);
    }
    if category != 0 {
      XFBridgeActions.EnsureSaveLock(cid);
    }
    let feature = new AnimFeature_FacialReaction();
    feature.category = category;
    feature.idle = idle;
    AnimationControllerComponent.ApplyFeatureToReplicate(npc, n"FacialReaction", feature);
    entry.faced = category != 0;
    return "{\"ok\":true,\"category\":" + IntToString(category) + ",\"idle\":" + IntToString(idle) + "}";
  }

  // A gesture: the carrier is spawned next to the actor; Poll starts the clip once it exists (PlayAct).
  public static func Act(cid: String, who: String, clip: String, off: Bool) -> String {
    let registry = XFNpcRegistry.Get();
    let entry = IsDefined(registry) ? registry.Entry(who) : null;
    if !IsDefined(entry) {
      return XFNpc.Lost(who);
    }
    XFNpc.StopAct(entry);
    if off {
      return "{\"ok\":true,\"playing\":false}";
    }
    let npc = XFNpc.EntityOf(entry) as GameObject;
    if !IsDefined(npc) {
      return XFNpc.Lost(who);
    }
    if !GameInstance.GetResourceDepot().ResourceExists(XFNpc.CarrierPath()) {
      return XFJson.Fail("carrier_missing", "the XF gesture carrier isn't loaded, so there are no body gestures in this build (faces, looks and lines still work)");
    }
    let system = GameInstance.GetDynamicEntitySystem();
    XFBridgeActions.EnsureSaveLock(cid);
    let position = npc.GetWorldPosition();
    let orientation = npc.GetWorldOrientation();
    let spec = new DynamicEntitySpec();
    spec.templatePath = XFNpc.CarrierPath();
    spec.position = position;
    spec.orientation = orientation;
    spec.persistState = false;
    spec.persistSpawn = false;
    spec.alwaysSpawned = true;
    spec.spawnInView = true;
    spec.active = true;
    ArrayPush(spec.tags, n"xfs_npc");
    ArrayPush(spec.tags, n"xfs_npc_carrier");
    entry.carrier = system.CreateEntity(spec);
    entry.hasCarrier = EntityID.IsDefined(entry.carrier);
    entry.clip = clip;
    entry.playing = false;
    if !entry.hasCarrier {
      return XFJson.Fail("carrier_missing", "the game refused to spawn the XF gesture carrier");
    }
    return "{\"ok\":true,\"playing\":true,\"pending_carrier\":true}";
  }

  // Poll's step: the carrier exists, so the actor enters its workspot and jumps to the clip (AMM's order [source]).
  public static func PlayAct(entry: ref<XFNpcEntry>) -> Void {
    if !entry.hasCarrier || entry.playing || StrLen(entry.clip) == 0 {
      return;
    }
    let system = GameInstance.GetDynamicEntitySystem();
    if !system.IsSpawned(entry.carrier) {
      return;
    }
    let carrier = system.GetEntity(entry.carrier) as GameObject;
    let npc = XFNpc.EntityOf(entry) as GameObject;
    if !IsDefined(carrier) || !IsDefined(npc) {
      return;
    }
    let workspots = GameInstance.GetWorkspotSystem(GetGameInstance());
    workspots.PlayInDeviceSimple(carrier, npc, false, n"xfs_gesture_workspot", n"xfs_gesture");
    workspots.SendJumpToAnimEnt(npc, StringToName(entry.clip), true);
    entry.playing = true;
  }

  public static func StopAct(entry: ref<XFNpcEntry>) -> Void {
    let npc = XFNpc.EntityOf(entry) as GameObject;
    let workspots = GameInstance.GetWorkspotSystem(GetGameInstance());
    if entry.playing && IsDefined(npc) && IsDefined(workspots) {
      workspots.StopInDevice(npc);
    }
    if entry.hasCarrier {
      let system = GameInstance.GetDynamicEntitySystem();
      if IsDefined(system) {
        system.DeleteEntity(entry.carrier);
      }
    }
    entry.hasCarrier = false;
    entry.playing = false;
    entry.clip = "";
  }

  public static func Hub(cid: String, show: Bool, id: Int32, who: String, title: String, choices: String) -> String {
    let registry = XFNpcRegistry.Get();
    if !IsDefined(registry) {
      return XFJson.Fail("not_in_world", "V isn't in the world");
    }
    if !show {
      let hub = registry.Hub();
      if registry.HubShown() && hub.id == id {
        registry.HideHub();
        registry.ClearHubAnswer();
        XFNpcHub.Refresh(false);
        return "{\"ok\":true,\"withdrawn\":true}";
      }
      if hub.id == id {
        registry.ClearHubAnswer(); // answered already: forget it
      }
      return "{\"ok\":true,\"withdrawn\":false}";
    }
    if XFNpcHub.GameBusy() {
      return XFJson.Fail("choices_busy", "the game shows its own dialogue choices or an interaction prompt right now; step away from doors and devices and try again");
    }
    let npc = XFNpc.EntityOf(registry.Entry(who)) as GameObject;
    let player = XFPlayer.Player();
    if !IsDefined(npc) || !IsDefined(player) {
      return XFNpc.Lost(who);
    }
    let distance = Vector4.Distance(npc.GetWorldPosition(), player.GetWorldPosition());
    if distance > 4.0 {
      return XFJson.Fail("too_far", "V is " + FloatToStringPrec(distance, 1) + " m from " + who + "; dialogue choices show within 4 m");
    }
    XFBridgeActions.EnsureSaveLock(cid);
    registry.ShowHub(XFNpcHub.Build(id, title, choices), who);
    XFNpcHub.Refresh(true);
    XFBridgeLog.Info(cid, "npc hub " + IntToString(id) + " shown for " + who);
    return "{\"ok\":true,\"shown\":true}";
  }

  // Everything held on one NPC, given back.
  public static func Undo(entry: ref<XFNpcEntry>) -> Void {
    let npc = XFNpc.EntityOf(entry) as GameObject;
    let puppet = npc as ScriptedPuppet;
    XFNpc.CancelCommand(entry, puppet);
    XFNpc.StopAct(entry);
    if ArraySize(entry.lines) > 0 {
      let ids: array<CRUID>;
      for line in entry.lines {
        ArrayPush(ids, XFNpc.LineId(line));
      }
      let board = GameInstance.GetBlackboardSystem(GetGameInstance()).Get(GetAllBlackboardDefs().UIGameData);
      board.SetVariant(GetAllBlackboardDefs().UIGameData.HideDialogLine, ToVariant(ids), true);
      ArrayClear(entry.lines);
    }
    if IsDefined(npc) {
      if IsDefined(entry.look) {
        LookAtRemoveEvent.QueueRemoveLookatEvent(npc, entry.look);
      }
      if entry.faced {
        let feature = new AnimFeature_FacialReaction();
        AnimationControllerComponent.ApplyFeatureToReplicate(npc, n"FacialReaction", feature);
      }
    }
    entry.look = null;
    entry.faced = false;
  }

  public static func Release(cid: String, who: String, how: String) -> String {
    let registry = XFNpcRegistry.Get();
    let entry = IsDefined(registry) ? registry.Entry(who) : null;
    if !IsDefined(entry) {
      return "{\"ok\":true,\"released\":false}";
    }
    if registry.HubShown() && Equals(registry.HubWho(), who) {
      registry.HideHub();
      registry.ClearHubAnswer();
      XFNpcHub.Refresh(false);
    }
    XFNpc.Undo(entry);
    if Equals(entry.kind, "actor") {
      let system = GameInstance.GetDynamicEntitySystem();
      if IsDefined(system) {
        system.DeleteEntity(entry.id);
      }
    }
    registry.Forget(who);
    XFBridgeLog.Info(cid, "npc released " + who + " (" + how + ")");
    return "{\"ok\":true,\"released\":true}";
  }

  public static func ReleaseAll(cid: String, reason: String) -> String {
    let registry = XFNpcRegistry.Get();
    let released = 0;
    if IsDefined(registry) {
      if registry.HubShown() {
        registry.HideHub();
        registry.ClearHubAnswer();
        XFNpcHub.Refresh(false);
      }
      for entry in registry.Entries() {
        XFNpc.Undo(entry);
        released += 1;
      }
      registry.ForgetAll();
      let voices = registry.TakeVoiceLines();
      if ArraySize(voices) > 0 {
        let ids: array<CRUID>;
        for voiceLine in voices {
          ArrayPush(ids, XFNpc.LineId(voiceLine));
        }
        let board = GameInstance.GetBlackboardSystem(GetGameInstance()).Get(GetAllBlackboardDefs().UIGameData);
        board.SetVariant(GetAllBlackboardDefs().UIGameData.HideDialogLine, ToVariant(ids), true);
      }
    }
    // Every actor and carrier by the bridge's tag, including any the registry lost track of.
    let system = GameInstance.GetDynamicEntitySystem();
    if IsDefined(system) {
      system.DeleteTagged(n"xfs_npc");
    }
    XFBridgeLog.Info(cid, "npc released all (" + reason + "): " + IntToString(released));
    return "{\"ok\":true,\"released\":" + IntToString(released) + ",\"reason\":" + XFJson.Str(reason) + "}";
  }

  public static func Poll(cid: String, whos: String) -> String {
    let registry = XFNpcRegistry.Get();
    let player = XFPlayer.Player();
    let system = GameInstance.GetDynamicEntitySystem();
    let vText = "{\"busy\":\"not_v\"}";
    if IsDefined(player) {
      let vPosition = player.GetWorldPosition();
      let busy = XFPlayer.Busy(player);
      vText = "{\"position\":" + XFScene.Arr(vPosition) + ",\"busy\":" + XFJson.Str(busy) + "}";
    }
    let out = "";
    if IsDefined(registry) {
      for who in StrSplit(whos, ",") {
        let entry = registry.Entry(who);
        let item = "{\"who\":" + XFJson.Str(who);
        if !IsDefined(entry) {
          item += ",\"exists\":false}";
        } else {
          let spawned = Equals(entry.kind, "pick") || (IsDefined(system) && system.IsSpawned(entry.id));
          let puppet = XFNpc.PuppetOf(entry);
          if !IsDefined(puppet) {
            item += ",\"exists\":false,\"spawned\":" + XFJson.Flag(spawned) + "}";
          } else {
            if Equals(entry.kind, "actor") && !entry.prepared {
              XFNpc.Prepare(entry, puppet);
            }
            XFNpc.PlayAct(entry);
            let position = puppet.GetWorldPosition();
            let yaw = puppet.GetWorldYaw();
            let dead = puppet.IsDead();
            let state = "NotExecuting";
            let ai = puppet.GetAIControllerComponent();
            if IsDefined(entry.command) && IsDefined(ai) {
              let commandState = ai.GetCommandState(entry.command);
              state = EnumValueToString("AICommandState", Cast<Int64>(EnumInt(commandState)));
            }
            item += ",\"exists\":true,\"spawned\":" + XFJson.Flag(spawned) + ",\"dead\":" + XFJson.Flag(dead) + ",\"position\":" + XFScene.Arr(position);
            item += ",\"yaw\":" + XFJson.Num(yaw) + ",\"command_state\":" + XFJson.Str(state) + "}";
          }
        }
        out += (StrLen(out) > 0 ? "," : "") + item;
      }
      // Keep our hub active and its highlight where the player left it (the module's per-frame update).
      if registry.HubShown() {
        XFNpcHub.Refresh(true);
      }
    }
    let hubText = "{\"id\":0,\"answer\":-1,\"shown\":false}";
    if IsDefined(registry) {
      let hub = registry.Hub();
      hubText = "{\"id\":" + IntToString(hub.id) + ",\"answer\":" + IntToString(registry.HubAnswer()) + ",\"shown\":" + XFJson.Flag(registry.HubShown()) + "}";
    }
    return "{\"ok\":true,\"v\":" + vText + ",\"npcs\":[" + out + "],\"hub\":" + hubText + "}";
  }
}

@if(!ModuleExists("Codeware"))
public abstract class XFNpc {
  public static func Missing() -> String {
    return XFJson.Fail("codeware_missing", "NPC direction spawns and tracks NPCs through Codeware, which isn't installed; install Codeware 1.20 or newer from its official release page");
  }

  public static func List(cid: String, radius: Float, max: Int32) -> String {
    return XFNpc.Missing();
  }

  public static func Pick(cid: String, who: String, id: String) -> String {
    return XFNpc.Missing();
  }

  public static func Spawn(cid: String, who: String, record: String, x: Float, y: Float, z: Float, yaw: Float, appearance: String, outOfView: Bool) -> String {
    return XFNpc.Missing();
  }

  public static func Command(cid: String, who: String, kind: String, targetKind: String, targetWho: String, x: Float, y: Float, z: Float, gait: Int32, distance: Float, yaw: Float, hasYaw: Bool, faceV: Bool) -> String {
    return XFNpc.Missing();
  }

  public static func Say(cid: String, who: String, line: Int32, text: String, trigger: String, lineType: Int32, speaker: String, seconds: Float) -> String {
    return XFNpc.Missing();
  }

  public static func Hide(cid: String, who: String, line: Int32) -> String {
    return "{\"ok\":true,\"hidden\":false}";
  }

  public static func Look(cid: String, who: String, targetKind: String, targetWho: String, x: Float, y: Float, z: Float, off: Bool) -> String {
    return off ? "{\"ok\":true,\"looking\":false}" : XFNpc.Missing();
  }

  public static func Face(cid: String, who: String, category: Int32, idle: Int32) -> String {
    return category == 0 ? "{\"ok\":true,\"category\":0,\"idle\":0}" : XFNpc.Missing();
  }

  public static func Act(cid: String, who: String, clip: String, off: Bool) -> String {
    return off ? "{\"ok\":true,\"playing\":false}" : XFNpc.Missing();
  }

  public static func Hub(cid: String, show: Bool, id: Int32, who: String, title: String, choices: String) -> String {
    return show ? XFNpc.Missing() : "{\"ok\":true,\"withdrawn\":false}";
  }

  // Nothing was spawned or picked without Codeware, so there is nothing to give back (the kill switch calls these).
  public static func Release(cid: String, who: String, how: String) -> String {
    return "{\"ok\":true,\"released\":false}";
  }

  public static func ReleaseAll(cid: String, reason: String) -> String {
    return "{\"ok\":true,\"released\":0,\"reason\":" + XFJson.Str(reason) + "}";
  }

  public static func Poll(cid: String, whos: String) -> String {
    return "{\"ok\":true,\"v\":{\"busy\":\"\"},\"npcs\":[],\"hub\":{\"id\":0,\"answer\":-1,\"shown\":false}}";
  }
}
