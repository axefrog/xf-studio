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
// 0.8.19 (Story Engine V17, route (a)): npc.substitute replaces a crowd person with an XF actor of the same look. The original is
// held with the game's own stop levers on a crowd member (CrowdMemberComponent.TryStopTrafficMovement, AllowWorkspotsUsage),
// removed only once the actor stands there with gamePuppet.HideIrreversibly (the call the game itself makes to take a puppet out
// of the world, NPCPuppet.script:3795) plus ReactionSystem.MarkDespawnCandidate (the crowd system's own recycle mark), and given
// back with ChangeMoveType and AllowWorkspotsUsage when the swap does not happen. Never the aggressive-crowd entry (that is
// combat), never a density or settings write. A community NPC's identity is read from its persistent stub record
// (gameEntityStubComponentPS) the way NPCPuppet.CheckStubData does (knowledge/crowd-adoption-and-identity.md).
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
  public let prepared: Bool; // an actor given its attitude (and god mode) once it exists
  public let attitude: Int32; // V15: 0 friendly (the default), 1 neutral, 2 hostile towards V
  public let immortal: Bool;  // V15: god mode (the default); false lets it be hurt and killed
  public let engage: Bool;    // 0.8.18: hostile, and V is put in its own threat list at its first moment (the game's InjectThreat)
  public let command: ref<AICommand>;
  public let look: ref<LookAtAddEvent>;
  public let faced: Bool;
  public let facingSet: Bool; // 0.8.11: a move was sent with a facing target (the behaviour keeps it until something clears it)
  public let facingLogged: Int32;
  public let faceLogged: Int32;
  public let held: Int32; // 0.8.10: how many of the game's own reactions were held back on it (npc-reactions in the plugin log)
  public let lines: array<Int32>;
  public let carrier: EntityID;
  public let hasCarrier: Bool;
  public let clip: String;      // the gesture waiting for its carrier, or playing
  public let playing: Bool;

  // BEGIN XFB_AUTONOMOUS_TEST_HOOKS
  private let xfbRecordedCategory: Int32;
  private let xfbRecordedIdle: Int32;
  private let xfbRecordedFace: Bool;
  public func XFRecordingFaceKind(category: Int32, idle: Int32) -> String {
    let resend = this.faced && this.xfbRecordedFace && this.xfbRecordedCategory == category && this.xfbRecordedIdle == idle;
    this.xfbRecordedFace = category != 0;
    this.xfbRecordedCategory = category;
    this.xfbRecordedIdle = idle;
    return category == 0 ? "face.bridge_reset" : resend ? "face.bridge_resend" : "face.bridge_submit";
  }
  // END XFB_AUTONOMOUS_TEST_HOOKS
}

// One per game session: what the bridge holds on NPCs, and the dialogue hub it shows. A load starts a new one.
public class XFNpcRegistry extends ScriptableSystem {
  private let m_entries: array<ref<XFNpcEntry>>;
  private let m_hubShown: Bool;
  private let m_hub: ListChoiceHubData;
  private let m_hubWho: String;
  private let m_hubIndex: Int32;
  private let m_hubAnswer: Int32;
  private let m_hubWithdrawn: String; // "busy": the game's own prompt or dialogue came up while ours showed
  private let m_lastInputAt: Float;
  private let m_hubGeneration: Int32;
  private let m_voiceLines: array<Int32>; // lines from a voice with no body (npc.say without who)
  private let m_detached: array<EntityID>;  // 0.8.19: crowd people held still for a substitution (given back by the kill switch)
  private let m_restoring: array<EntityID>; // 0.8.19: fresh crowd people left by restore, until they are seen in the crowd
  private let m_originals: array<EntityID>; // 0.8.19: the last crowd people read for a substitution, so one is found again by its own id wherever it is

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

  public func Remember(id: EntityID) -> Void {
    for held in this.m_originals {
      if Equals(EntityID.ToDebugString(held), EntityID.ToDebugString(id)) { return; }
    }
    if ArraySize(this.m_originals) >= 16 {
      ArrayErase(this.m_originals, 0);
    }
    ArrayPush(this.m_originals, id);
  }

  // A held or recently read original by the text of its id (the id npc_list gave), whether or not it is near V.
  public func Original(text: String) -> EntityID {
    for held in this.m_detached {
      if Equals(EntityID.ToDebugString(held), text) { return held; }
    }
    for held in this.m_originals {
      if Equals(EntityID.ToDebugString(held), text) { return held; }
    }
    let none: EntityID;
    return none;
  }

  public func Detached() -> array<EntityID> {
    return this.m_detached;
  }

  public func RestoringCount() -> Int32 {
    return ArraySize(this.m_restoring);
  }

  public func AddDetached(id: EntityID) -> Void {
    for held in this.m_detached {
      if Equals(EntityID.ToDebugString(held), EntityID.ToDebugString(id)) { return; }
    }
    ArrayPush(this.m_detached, id);
  }

  public func RemoveDetached(id: EntityID) -> Void {
    let kept: array<EntityID>;
    for held in this.m_detached {
      if NotEquals(EntityID.ToDebugString(held), EntityID.ToDebugString(id)) { ArrayPush(kept, held); }
    }
    this.m_detached = kept;
  }

  public func TakeDetached() -> array<EntityID> {
    let all = this.m_detached;
    ArrayClear(this.m_detached);
    return all;
  }

  public func AddRestoring(id: EntityID) -> Void {
    ArrayPush(this.m_restoring, id);
  }

  public func Restoring(text: String) -> EntityID {
    for held in this.m_restoring {
      if Equals(EntityID.ToDebugString(held), text) { return held; }
    }
    let none: EntityID;
    return none;
  }

  public func RemoveRestoring(id: EntityID) -> Void {
    let kept: array<EntityID>;
    for held in this.m_restoring {
      if NotEquals(EntityID.ToDebugString(held), EntityID.ToDebugString(id)) { ArrayPush(kept, held); }
    }
    this.m_restoring = kept;
  }

  public func TakeRestoring() -> array<EntityID> {
    let all = this.m_restoring;
    ArrayClear(this.m_restoring);
    return all;
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

  // 0.8.9 (session 15's NB1, NB2 and NC1: with reactions quiet, the actor still got "pissy" and barked "whaddya want?" over
  // npc.face's smile and the greeting): whether the game's own look-at reaction is held back on this entity. That reaction
  // (ReactionManagerComponent.TriggerFacialLookAtReaction, reactionComponent.script:2835-2874) gives an NPC outside the
  // crowd, as every XF actor is, the aggressive face (category 3, idle 1) and the voiceset's "greeting" bark whenever V
  // comes close, stands in front of it or lingers (the proximity look-at, the comfort zone and the repeat look-at); the
  // preset guard (CanTriggerExpressionLookAt) only stops presets of the NoReaction type, which Civilian_NoReaction isn't.
  // Held back always on a quiet actor (what reactions quiet promises), and on any actor or pick while the bridge directs
  // its face, its look or a line.
  public func HoldsReactions(id: EntityID, what: String) -> Bool {
    for entry in this.m_entries {
      if entry.id == id {
        // 0.8.18: a combat stand-in (a street-gang grunt) always has its own reactions; only what the bridge directs is held.
        let ownReactions = StrEndsWith(entry.record, "_reactive") || StrContains(entry.record, "xfs_actor_fighter_");
        let holds = (Equals(entry.kind, "actor") && !ownReactions) || entry.faced || IsDefined(entry.look) || ArraySize(entry.lines) > 0;
        if holds {
          // 0.8.10 (session 16's N5: an actor barked on arrival and nothing said whether the game's reaction or our own greeting
          // did it): the first few holds per actor are logged, so the log shows whether the stand-down was at work and when.
          entry.held += 1;
          if entry.held <= 6 {
            XFBridgeLog.Info("npc-reactions", entry.who + " held the game's " + what + " (" + IntToString(entry.held) + ")");
          }
        }
        return holds;
      }
    }
    return false;
  }

  public static func HoldsReactionsOf(owner: ref<GameObject>, what: String) -> Bool {
    // The Sol review of 0.8.9, finding 1: these wraps run from the game's own reaction callbacks, outside ScriptCall's gate,
    // so while the scripts aren't live they pass straight through without asking any system.
    if !XFBridge_Live() || !IsDefined(owner) {
      return false;
    }
    let registry = XFNpcRegistry.Get();
    if !IsDefined(registry) || ArraySize(registry.m_entries) == 0 {
      return false;
    }
    return registry.HoldsReactions(owner.GetEntityID(), what);
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
    this.m_hubGeneration += 1;
    this.m_hub = hub;
    this.m_hubWho = who;
    this.m_hubShown = true;
    this.m_hubIndex = 0;
    this.m_hubAnswer = -1;
    this.m_hubWithdrawn = "";
  }

  // The game's own interaction prompt or dialogue came up: ours goes (the game's comes first); the tick reads why.
  public func WithdrawForGame() -> Void {
    this.m_hubShown = false;
    this.m_hubWithdrawn = "busy";
  }

  public func HubWithdrawn() -> String {
    return this.m_hubWithdrawn;
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

  public func HubGeneration() -> Int32 {
    return this.m_hubGeneration;
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
    this.m_hubWithdrawn = "";
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

// V for the NPC commands' refusals, her camera, and the probes an out-of-sight spawn and a dissolve use (no Codeware needed).
public abstract class XFNpcV {
  // ,"camera":{position, forward, fov, aspect} (V16: what V sees), or "" when the camera system has none. Every native answer
  // is kept in a local first.
  public static func Camera() -> String {
    let cameraSystem = GameInstance.GetCameraSystem(GetGameInstance());
    if !IsDefined(cameraSystem) {
      return "";
    }
    let transform: Transform;
    let has = cameraSystem.GetActiveCameraWorldTransform(transform);
    if !has {
      return "";
    }
    let position = transform.position;
    let forward = cameraSystem.GetActiveCameraForward();
    let fov = cameraSystem.GetActiveCameraFOV();
    let aspect = cameraSystem.GetAspectRatio();
    return ",\"camera\":{\"position\":" + XFScene.Arr(position) + ",\"forward\":" + XFScene.Arr(forward) + ",\"fov\":" + XFJson.Num(fov) + ",\"aspect\":" + XFJson.Num(aspect) + "}";
  }

  // V16: walkable ground within 2 m of a point (human navmesh), as XFNpc.Spawn snaps its spot. Never fails.
  public static func Ground(cid: String, x: Float, y: Float, z: Float) -> String {
    let target = new Vector4(x, y, z, 1.0);
    let navigation = GameInstance.GetNavigationSystem(GetGameInstance());
    if !IsDefined(navigation) {
      return "{\"ok\":true,\"walkable\":false,\"streamed\":false}";
    }
    let streamed = navigation.IsNavmeshStreamedInLocation(target, 2.0);
    if !streamed {
      return "{\"ok\":true,\"walkable\":false,\"streamed\":false}";
    }
    let found = navigation.FindPointInSphereOnlyHumanNavmesh(target, 2.0, NavGenAgentSize.Human, true);
    if NotEquals(found.status, worldNavigationRequestStatus.OK) {
      return "{\"ok\":true,\"walkable\":false,\"streamed\":true}";
    }
    return "{\"ok\":true,\"walkable\":true,\"streamed\":true,\"point\":" + XFScene.Arr(found.point) + ",\"traffic_check\":" + XFNavigation.Classify(found.point, 10.0) + "}";
  }

  // V16: whether static geometry blocks the line between two points (scene.read's occlusion ray, XFScene.Ray).
  public static func Ray(cid: String, fx: Float, fy: Float, fz: Float, tx: Float, ty: Float, tz: Float) -> String {
    let ray = XFScene.Ray(new Vector4(fx, fy, fz, 1.0), new Vector4(tx, ty, tz, 1.0));
    return "{\"ok\":true," + StrMid(ray, 1, StrLen(ray) - 1);
  }

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
    let camera = XFNpcV.Camera();
    // The Sol review of 0.8.10, finding 3: V's real head (her Head slot, so a crouch lowers it) is where sight lines start.
    let head: Vector4;
    let headText = "";
    if XFScene.Head(player, head) {
      headText = ",\"head\":" + XFScene.Arr(head);
    }
    return "{\"ok\":true,\"phase\":" + XFJson.Str(phase) + ",\"position\":" + XFScene.Arr(position) + headText + ",\"yaw\":" + XFJson.Num(yaw) + ",\"busy\":" + XFJson.Str(busy) + ",\"busy_state\":" + XFJson.Str(state) + camera + "}";
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
    if prompt.active {
      return true;
    }
    return XFNpcHub.DeviceFocus();
  }

  // 0.8.9 (session 15's NB6/NB6b: at a vending machine's in-world screen, with the hand cursor over an item, our choices
  // showed and stayed, and F bought from the machine): an in-world device screen shows no interaction prompt, so the prompt
  // check missed it. V is busy with a device while the player state machine says she interacts with, zooms into or controls
  // one, or while she looks at a device within 3.5 m (the distance its screen takes the cursor from).
  public static func DeviceFocus() -> Bool {
    // Also reached from PlayerPuppet.OnAction's wrap, outside ScriptCall's gate (the Sol review of 0.8.9, finding 1).
    if !XFBridge_Live() {
      return false;
    }
    let player = XFPlayer.Player();
    if !IsDefined(player) {
      return false;
    }
    let psmDefs = GetAllBlackboardDefs().PlayerStateMachine;
    let psm = GameInstance.GetBlackboardSystem(GetGameInstance()).GetLocalInstanced(player.GetEntityID(), psmDefs);
    if IsDefined(psm) {
      let interacting = psm.GetBool(psmDefs.IsInteractingWithDevice);
      let zoomed = psm.GetBool(psmDefs.IsUIZoomDevice);
      let controlling = psm.GetBool(psmDefs.IsControllingDevice);
      if interacting || zoomed || controlling {
        return true;
      }
    }
    let targeting = GameInstance.GetTargetingSystem(GetGameInstance());
    if !IsDefined(targeting) {
      return false;
    }
    let looked = targeting.GetLookAtObject(player, false, false);
    let device = looked as Device;
    if IsDefined(device) {
      let distance = Vector4.Distance(device.GetWorldPosition(), player.GetWorldPosition());
      return distance <= 3.5;
    }
    return false;
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
    // 0.8.9: a device screen in focus takes the key, and our choices go (between two polls).
    if XFNpcHub.DeviceFocus() {
      registry.WithdrawForGame();
      XFNpcHub.Refresh(false);
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
    // The review's finding 8: the game's own dialogue choices came up: ours goes, theirs draw as the game sent them.
    if ArraySize(data.choiceHubs) > 0 {
      registry.WithdrawForGame();
      let ours = registry.Hub();
      XFBridgeLog.Info("npc-hub", "the game showed its own dialogue choices; hub " + IntToString(ours.id) + " withdrawn");
      return wrappedMethod(value);
    }
    ArrayPush(data.choiceHubs, registry.Hub());
    return wrappedMethod(ToVariant(data));
  }
  return wrappedMethod(value);
}

@wrapMethod(InteractionUIBase)
protected cb func OnInteractionData(value: Variant) -> Bool {
  let registry = XFNpcRegistry.Get();
  if IsDefined(registry) && registry.HubShown() {
    let prompt = FromVariant<InteractionChoiceHubData>(value);
    if prompt.active {
      // The review's finding 8: a door or device prompt came up while our hub showed: ours goes and the widget is redrawn
      // without it, so the prompt shows and the player's keys reach it.
      registry.WithdrawForGame();
      XFNpcHub.Refresh(false);
      let ours = registry.Hub();
      XFBridgeLog.Info("npc-hub", "an interaction prompt came up; hub " + IntToString(ours.id) + " withdrawn");
      return wrappedMethod(value);
    }
    // An empty update while ours shows isn't drawn over it (the module's flicker guard).
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

// 0.8.9: the actor's own look-at reactions (the annoyed face and bark) and the resets of its face held back while
// XFNpcRegistry.HoldsReactions says so; every other reaction (fear, combat, bumps) runs as the game has it.
@wrapMethod(ReactionManagerComponent)
private final func TriggerFacialLookAtReaction(opt forceFear: Bool, opt playVO: Bool) -> Void {
  if XFNpcRegistry.HoldsReactionsOf(this.GetOwner(), "look-at face and greeting") {
    return;
  }
  wrappedMethod(forceFear, playVO);
}

@wrapMethod(ReactionManagerComponent)
private final func CanTriggerExpressionLookAt() -> Bool {
  if XFNpcRegistry.HoldsReactionsOf(this.GetOwner(), "expression look-at check") {
    return false;
  }
  return wrappedMethod();
}

// 0.8.9 (session 15's NC1: she "walked backwards" to V and away again): the reaction's own look-at twists the chest towards
// V at weight 2.0 within a 210-degree back limit and, for an NPC outside the crowd, never ends by itself
// (reactionComponent.script:3539-3600); walking while it held made the body walk one way and face the other. Held back as
// the face and bark are, and ended when the bridge sends a walk (XFBridgeEndReactionLook).
@wrapMethod(ReactionManagerComponent)
private func ActivateReactionLookAt(targetEntity: ref<Entity>, opt end: Bool, opt repeat: Bool, opt duration: Float, opt upperBody: Bool, opt inVehicle: Bool) -> Bool {
  if XFNpcRegistry.HoldsReactionsOf(this.GetOwner(), "reaction look-at") {
    return false;
  }
  return wrappedMethod(targetEntity, end, repeat, duration, upperBody, inVehicle);
}

@addMethod(ReactionManagerComponent)
public func XFBridgeEndReactionLook() -> Void {
  if IsDefined(this.m_lookatEvent) {
    this.DeactiveLookAt();
  }
}

@wrapMethod(ReactionManagerComponent)
private final func ResetFacial(cooldown: Float) -> Void {
  if XFNpcRegistry.HoldsReactionsOf(this.GetOwner(), "face reset") {
    return;
  }
  wrappedMethod(cooldown);
}

@wrapMethod(ReactionManagerComponent)
protected cb func OnResetFacialEvent(evt: ref<ResetFacialEvent>) -> Bool {
  if XFNpcRegistry.HoldsReactionsOf(this.GetOwner(), "face reset event") {
    return true;
  }
  return wrappedMethod(evt);
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
    let player = XFPlayer.Player();
    if IsDefined(player) {
      let attitude = GameObject.GetAttitudeBetween(puppet, player);
      if Equals(attitude, EAIAttitude.AIA_Hostile) {
        return "hostile";
      }
    }
    return "";
  }

  // The review's finding 1: who may be picked at all. Quest reservation can't be read safely (IsQuest only sees a quest mark or
  // quest items, and a quest can use an unmarked community NPC), so only plain passers-by of the street crowd are picked:
  // a crowd NPC with no protection reason. Returns "" when it may be picked, else the reasons (JSON strings).
  public static func PickRefusal(puppet: ref<ScriptedPuppet>) -> String {
    let reasons = XFNpcCheck.Reasons(puppet);
    let crowd = puppet.IsCrowd();
    if !crowd {
      reasons += (StrLen(reasons) > 0 ? "," : "") + "\"not_crowd\"";
    }
    return reasons;
  }
}

@if(ModuleExists("Codeware"))
public abstract class XFNpc {
  // The XF gesture carrier: an archive a -writes package carries only when made with --npc-carrier (not built yet).
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
      let refusal = IsDefined(puppet) ? XFNpcCheck.PickRefusal(puppet) : "\"not_a_puppet\"";
      let pickable = StrLen(refusal) == 0 && StrLen(busy) == 0 && !dead;
      let ours = IsDefined(registry) ? registry.WhoIs(npc.GetEntityID()) : "";
      out += (written > 0 ? "," : "") + "{" + identity + ",\"position\":" + XFScene.Arr(position) + ",\"dead\":" + XFJson.Flag(dead);
      // 0.8.19 (probe 1 of the crowd substitution checklist): what defines the look, and which way they face.
      if IsDefined(puppet) {
        let lookName = puppet.GetCurrentAppearanceName();
        let lookVariant = puppet.GetCurrentColorVariantName();
        let heading = puppet.GetWorldYaw();
        out += ",\"appearance\":" + XFJson.Name(lookName) + ",\"variant\":" + XFJson.Name(lookVariant) + ",\"yaw\":" + XFJson.Num(heading);
      }
      out += ",\"crowd\":" + XFJson.Flag(crowd) + ",\"protected\":" + XFJson.Flag(StrLen(reasons) > 0) + ",\"reasons\":[" + reasons + "]";
      out += ",\"busy\":" + (StrLen(busy) > 0 ? XFJson.Str(busy) : "null") + ",\"pickable\":" + XFJson.Flag(pickable) + (StrLen(ours) > 0 ? ",\"ours\":" + XFJson.Str(ours) : "") + "}";
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
      let reasons = XFNpcCheck.PickRefusal(puppet);
      if StrLen(reasons) > 0 {
        return XFJson.Fail("npc_protected", "only plain passers-by are picked; that NPC isn't one (" + StrReplaceAll(reasons, "\"", "") + "), so the bridge leaves it alone");
      }
      let busy = XFNpcCheck.Busy(puppet);
      if StrLen(busy) > 0 {
        return XFJson.Fail("npc_busy", "that NPC is busy (" + busy + ")");
      }
      let position = puppet.GetWorldPosition();
      let distance = Vector4.Distance(position, from);
      if distance > 30.0 {
        return XFJson.Fail("too_far", "that NPC is more than 30 m from V");
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

  public static func Spawn(cid: String, who: String, record: String, x: Float, y: Float, z: Float, yaw: Float, appearance: String, outOfView: Bool, attitude: Int32, immortal: Bool) -> String {
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
    entry.attitude = attitude;
    // 0.8.18: the stance arrives as one number: 3 is hostile with engage.
    if attitude == 3 {
      entry.attitude = 2;
      entry.engage = true;
    }
    entry.immortal = immortal;
    registry.Add(entry);
    XFNavigation.Note(found.point, who);
    XFBridgeLog.Info(cid, "npc spawned " + who + " record=" + record + " at " + XFScene.Arr(found.point) + " attitude=" + IntToString(attitude) + " immortal=" + (immortal ? "true" : "false") + " (non-persistent, tag xfs_npc)");
    return "{\"ok\":true,\"entity\":" + XFJson.Str(EntityID.ToDebugString(id)) + ",\"position\":" + XFScene.Arr(found.point) + ",\"traffic_check\":" + XFNavigation.Classify(found.point, 10.0) + "}";
  }

  // An actor's first moment in the world: its attitude towards V (friendly by default, as AMM's Director sets its actors;
  // V15: neutral or hostile) and, unless it was spawned mortal, god mode; both go with it.
  // 0.8.18 (review): a combat stand-in must not be hostile to anyone but V. Its record puts it in the isolated attitude group
  // xfs_fighter (tweaks/test-profile/xf_npc_actors.yaml), whose only hostile pair is none; this checks that the group took
  // (a record or group missing from TweakDB would leave the Scavengers' own group, hostile to the Maelstrom) and that the
  // group is not hostile to the common gangs, police and civilians, and otherwise moves the actor to the plain neutral
  // group every ordinary NPC starts in. It only reads the attitude system; no shared relation is ever written.
  public static func Isolate(entry: ref<XFNpcEntry>, puppet: ref<ScriptedPuppet>) -> Void {
    let agent = puppet.GetAttitudeAgent();
    if !IsDefined(agent) { return; }
    let group = agent.GetAttitudeGroup();
    let isolated = Equals(group, n"xfs_fighter");
    let hostileTo = "";
    if isolated {
      let attitudes = GameInstance.GetAttitudeSystem(GetGameInstance());
      let others: array<CName>;
      ArrayPush(others, n"maelstrom"); ArrayPush(others, n"scavenger"); ArrayPush(others, n"tygerClaws"); ArrayPush(others, n"valentinos");
      ArrayPush(others, n"animals"); ArrayPush(others, n"6thStreet"); ArrayPush(others, n"wraiths"); ArrayPush(others, n"voodooBoys");
      ArrayPush(others, n"police"); ArrayPush(others, n"civilian"); ArrayPush(others, n"neutral");
      if IsDefined(attitudes) {
        for other in others {
          if Equals(attitudes.GetAttitudeRelation(group, other), EAIAttitude.AIA_Hostile) { hostileTo += NameToString(other) + " "; }
        }
      }
    }
    if isolated && StrLen(hostileTo) == 0 {
      XFBridgeLog.Info("npc-attitude", entry.who + " is in the isolated group xfs_fighter, hostile to none of the common groups");
      return;
    }
    agent.SetAttitudeGroup(n"neutral");
    XFBridgeLog.Warn("npc-attitude", entry.who + " was not isolated (group " + NameToString(group) + ", hostile to: " + hostileTo + "): moved to the plain neutral group");
  }

  public static func Prepare(entry: ref<XFNpcEntry>, puppet: ref<ScriptedPuppet>) -> Void {
    let player = XFPlayer.Player();
    let agent = puppet.GetAttitudeAgent();
    if StrContains(entry.record, "xfs_actor_fighter_") { XFNpc.Isolate(entry, puppet); }
    if IsDefined(agent) && IsDefined(player) {
      let stance = EAIAttitude.AIA_Friendly;
      if entry.attitude == 1 {
        stance = EAIAttitude.AIA_Neutral;
      }
      if entry.attitude == 2 {
        stance = EAIAttitude.AIA_Hostile;
      }
      agent.SetAttitudeTowards(player.GetAttitudeAgent(), stance);
    }
    // 0.8.18: engage, for a hostile actor whose own AI doesn't start the fight from the attitude alone. The game's own
    // threat route (what a quest's combat order and AIActionHelper.TryStartCombatWithTarget use): V goes into the actor's
    // threat list. TryStartCombatWithTarget itself isn't used, because for a non-hostile pair it changes the whole
    // attitude group's stance; here the actor's attitude towards V is checked first. Nothing is written to V.
    if entry.engage && IsDefined(player) {
      if Equals(GameObject.GetAttitudeBetween(puppet, player), EAIAttitude.AIA_Hostile) {
        TargetTrackingExtension.InjectThreat(puppet, player);
        XFBridgeLog.Info("npc-engage", entry.who + " was given V as a threat (hostile attitude confirmed)");
      } else {
        XFBridgeLog.Info("npc-engage", entry.who + " was not given V as a threat: its attitude towards V isn't hostile yet");
      }
    }
    if entry.immortal {
      let gods = GameInstance.GetGodModeSystem(GetGameInstance());
      if IsDefined(gods) {
        gods.AddGodMode(entry.id, gameGodModeType.Immortal, n"XFRuntimeBridge");
      }
    }
    entry.prepared = true;
  }

  // 0.8.11 (session 17's N1 and N3: she turned the right way, then swivelled back to V and walked away backwards): the move
  // command handler writes its facing target into the behaviour's argument only when there is one, and never clears it
  // (aiMoveToCommandHandler.script:47-51; the spline handler writes null, 131), so a move to V left V as the facing target
  // for every later walk. Cleared the way the game clears its own behaviour arguments (SetBehaviorArgument with null:
  // aiRole.script:229, targetTrackingComponent.script:514). The argument's name is the tree's own and not in the scripts;
  // "FacingTarget" is the mapping's name by analogy with MovementTarget [hypothesis], so the first few clears log what the
  // argument held before and after, and Command also stops sending V as the facing target unless asked.
  public static func ClearFacing(entry: ref<XFNpcEntry>, puppet: ref<ScriptedPuppet>, cid: String, why: String) -> Void {
    let ai = puppet.GetAIControllerComponent();
    if !IsDefined(ai) {
      return;
    }
    // The Sol review of 0.8.11, finding 1: only a target our own move set is cleared. An actor handed back to the game after a
    // fight, or a crowd member the bridge picked, keeps whatever its own AI holds.
    if !entry.facingSet {
      return;
    }
    let before = FromVariant<wref<GameObject>>(ai.GetBehaviorArgument(n"FacingTarget"));
    let none: wref<GameObject>;
    ai.SetBehaviorArgument(n"FacingTarget", ToVariant(none));
    if entry.facingLogged < 4 {
      entry.facingLogged += 1;
      let after = FromVariant<wref<GameObject>>(ai.GetBehaviorArgument(n"FacingTarget"));
      XFBridgeLog.Info(cid, "npc " + entry.who + " facing target cleared (" + why + "): held " + (IsDefined(before) ? "an entity" : "nothing") + " before, " + (IsDefined(after) ? "an entity" : "nothing") + " after");
    }
    entry.facingSet = false;
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
    // 0.8.11: whatever facing target an earlier move left goes before the next command, unless this move sets its own.
    if !(Equals(kind, "move") && faceV) {
      XFNpc.ClearFacing(entry, puppet, cid, kind);
    }
    if Equals(kind, "stop") {
      return "{\"ok\":true,\"sent\":true,\"before\":" + before + (Equals(kind, "place") ? ",\"traffic_check\":" + XFNavigation.Classify(new Vector4(x, y, z, 1.0), 10.0) : "") + "}";
    }
    XFBridgeActions.EnsureSaveLock(cid);
    // 0.8.9: a walk ends the reaction's own look-at first (it twisted the walker's body towards V).
    let reactions = puppet.GetStimReactionComponent();
    if IsDefined(reactions) && (Equals(kind, "move") || Equals(kind, "follow")) {
      reactions.XFBridgeEndReactionLook();
    }
    if Equals(kind, "move") {
      let move = new AIMoveToCommand();
      let spec: AIPositionSpec;
      if !XFNpc.Spec(targetKind, targetWho, x, y, z, spec) {
        return XFJson.Fail("npc_lost", "the target isn't in the world");
      }
      move.movementTarget = spec;
      // 0.8.9 (session 15's NC1): V as the facing target only, as the game's own move-to-V does (quickhackEffectors.script
      // 911-918). rotateEntityTowardsFacingTarget made it a strafing target (aiMoveToCommandHandler.script:317-324), the body
      // held towards V for the whole walk. Whether the facing target alone turns it to V at the end, as the game's does, is
      // session 16's to see [hypothesis]; the scenario turns it with npc.turn after arriving either way.
      if faceV {
        AIPositionSpec.SetEntity(move.facingTarget, GetPlayer(GetGameInstance()));
        entry.facingSet = true;
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
    if Equals(kind, "place") { XFNavigation.Note(new Vector4(x, y, z, 1.0), who); }
    XFBridgeLog.Info(cid, "npc " + who + " command " + kind + " sent");
    return "{\"ok\":true,\"sent\":true,\"before\":" + before + (Equals(kind, "place") ? ",\"traffic_check\":" + XFNavigation.Classify(new Vector4(x, y, z, 1.0), 10.0) : "") + "}";
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
      // 0.8.9: the greeting comes with a smile (held like npc.face's, until npc.face reset or the release) unless a face is
      // directed already; the voiceset's line itself is the game's choice (a civilian's greeting can sound curt).
      if Equals(trigger, "greeting") && !entry.faced {
        let smile = new AnimFeature_FacialReaction();
        smile.category = 3;
        smile.idle = 6;
        AnimationControllerComponent.ApplyFeatureToReplicate(npc, n"FacialReaction", smile);
        entry.faced = true;
      }
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

  // BEGIN XFB_AUTONOMOUS_TEST_HOOKS
    if XFRecordingTap.On("face") {
      XFRecordingTap.Emit("face", entry.XFRecordingFaceKind(category, idle), XFRecordingFace.Body(npc)
        + ",\"source\":\"bridge.XFNpc.Face\",\"cid\":" + XFJson.Str(cid) + ",\"category\":" + IntToString(category) + ",\"idle\":" + IntToString(idle));
    }
  // END XFB_AUTONOMOUS_TEST_HOOKS
    let feature = new AnimFeature_FacialReaction();
    feature.category = category;
    feature.idle = idle;
    AnimationControllerComponent.ApplyFeatureToReplicate(npc, n"FacialReaction", feature);
    entry.faced = category != 0;
    // 0.8.11: the plugin sends a held face again on a schedule; the first few sends per actor are logged with whether the actor
    // had attitude/immortality preparation. This cannot show whether an early send reached a graph.
    if category != 0 && entry.faceLogged < 6 {
      entry.faceLogged += 1;
      XFBridgeLog.Info(cid, "npc " + entry.who + " face " + IntToString(category) + "/" + IntToString(idle) + " sent (" + IntToString(entry.faceLogged) + "), prepared " + XFJson.Flag(entry.prepared));
    }
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

  // Whether a gesture's carrier exists and its clip waits to start (the poll reports it; StartGesture starts it).
  public static func GestureReady(entry: ref<XFNpcEntry>) -> Bool {
    if !entry.hasCarrier || entry.playing || StrLen(entry.clip) == 0 {
      return false;
    }
    let system = GameInstance.GetDynamicEntitySystem();
    return IsDefined(system) && system.IsSpawned(entry.carrier);
  }

  // The tick's gated steps (the review's finding 2): an actor's attitude and god mode once it exists, and a gesture's start.
  public static func PrepareActor(cid: String, who: String) -> String {
    let registry = XFNpcRegistry.Get();
    let entry = IsDefined(registry) ? registry.Entry(who) : null;
    let puppet = XFNpc.PuppetOf(entry);
    if !IsDefined(puppet) || !Equals(entry.kind, "actor") {
      return XFNpc.Lost(who);
    }
    if !entry.prepared {
      XFNpc.Prepare(entry, puppet);
    }
    return "{\"ok\":true,\"prepared\":true}";
  }

  public static func StartGesture(cid: String, who: String) -> String {
    let registry = XFNpcRegistry.Get();
    let entry = IsDefined(registry) ? registry.Entry(who) : null;
    if !IsDefined(entry) {
      return XFNpc.Lost(who);
    }
    XFNpc.PlayAct(entry);
    return "{\"ok\":true,\"playing\":" + XFJson.Flag(entry.playing) + "}";
  }

  // The carrier exists, so the actor enters its workspot and jumps to the clip (AMM's order [source]).
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
      return XFJson.Fail("choices_busy", "the game shows its own dialogue choices, an interaction prompt or a device's screen right now; step away from doors and devices and try again");
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

  // ---- 0.8.19: npc.substitute -----------------------------------------------------------------------------------------------

  // The NPC V is looking at, by the world-object rule (the targeting system's look-at object, a typed check after the cast).
  public static func LookedAt(cid: String) -> String {
    let player = XFPlayer.Player();
    if !IsDefined(player) {
      return XFJson.Fail("not_in_world", "V isn't in the world");
    }
    let targeting = GameInstance.GetTargetingSystem(GetGameInstance());
    if !IsDefined(targeting) {
      return XFJson.Fail("npc_not_found", "the game's targeting isn't available");
    }
    let looked = targeting.GetLookAtObject(player, true, false);
    let puppet = looked as ScriptedPuppet;
    if !IsDefined(puppet) {
      return XFJson.Fail("npc_not_found", "V isn't looking at an NPC");
    }
    let lookedId = puppet.GetEntityID();
    return "{\"ok\":true,\"id\":" + XFJson.Str(EntityID.ToDebugString(lookedId)) + "}";
  }

  // The puppet with this entity id among the NPCs around V (within 50 m); null when it isn't there.
  public static func Around(id: String) -> ref<ScriptedPuppet> {
    let player = XFPlayer.Player();
    if !IsDefined(player) {
      return null;
    }
    let npcs = player.GetNPCsAroundObject(50.0);
    for npc in npcs {
      if IsDefined(npc) && Equals(EntityID.ToDebugString(npc.GetEntityID()), id) {
        return npc;
      }
    }
    return null;
  }

  // The crowd person with this id wherever it is: by the id the registry remembers (the game's own lookup, whatever V's distance),
  // else among the NPCs around V. A held original is given back through this, so a walk or a stream away never abandons it.
  public static func Resolve(id: String) -> ref<ScriptedPuppet> {
    let registry = XFNpcRegistry.Get();
    if IsDefined(registry) {
      let known = registry.Original(id);
      if EntityID.IsDefined(known) {
        let found = GameInstance.FindEntityByID(GetGameInstance(), known) as ScriptedPuppet;
        if IsDefined(found) {
          return found;
        }
      }
    }
    return XFNpc.Around(id);
  }

  // The persistent stub every community NPC carries, as the game's own CheckStubData reads it (NPCPuppet.script:766-775):
  // {"spawner", "entry", "ordinal"} or "null". The ordinal is the puppet's index in the community's fixed entity list
  // (GetFixedEntityIdsFromSpawnerEntityID); -1 when the list does not hold it. A lane-crowd pedestrian has no stub.
  public static func StubOf(puppet: ref<ScriptedPuppet>) -> String {
    let id = puppet.GetEntityID();
    let persistent = CreatePersistentID(id, gameEntityStubComponentPS.GetPSComponentName());
    let state = GameInstance.GetPersistencySystem(GetGameInstance()).GetConstAccessToPSObject(persistent, n"gameEntityStubComponentPS");
    let stub = state as gameEntityStubComponentPS;
    if !IsDefined(stub) {
      return "null";
    }
    let spawner = stub.GetSpawnerID();
    let entry = stub.GetOwnerCommunityEntryName();
    if !EntityID.IsDefined(spawner) || !IsNameValid(entry) {
      return "null";
    }
    let names: array<CName>;
    ArrayPush(names, entry);
    let ids: array<EntityID>;
    GetFixedEntityIdsFromSpawnerEntityID(spawner, names, GetGameInstance(), ids);
    let ordinal = -1;
    let mine = EntityID.ToDebugString(id);
    let i = 0;
    while i < ArraySize(ids) {
      if Equals(EntityID.ToDebugString(ids[i]), mine) {
        ordinal = i;
      }
      i += 1;
    }
    return "{\"spawner\":" + XFJson.Str(EntityID.ToDebugString(spawner)) + ",\"entry\":" + XFJson.Name(entry) + ",\"ordinal\":" + IntToString(ordinal) + "}";
  }

  // The crowd person with this id, read afresh with npc.pick's eligibility (the same refusals, in the same words): what defines
  // their look, where they stand and which way they face. Changes nothing.
  public static func ReadLook(cid: String, id: String) -> String {
    let player = XFPlayer.Player();
    let registry = XFNpcRegistry.Get();
    if !IsDefined(player) || !IsDefined(registry) {
      return XFJson.Fail("not_in_world", "V isn't in the world");
    }
    let from = player.GetWorldPosition();
    let puppet = XFNpc.Around(id);
    if !IsDefined(puppet) {
      return XFJson.Fail("npc_not_found", "no NPC with that id is near V now (npc_list again)");
    }
    if StrLen(registry.WhoIs(puppet.GetEntityID())) > 0 {
      return XFJson.Fail("npc_protected", "that is one of the bridge's own NPCs, not a passer-by of the crowd");
    }
    if puppet.IsDead() {
      return XFJson.Fail("npc_busy", "that NPC is dead");
    }
    let reasons = XFNpcCheck.PickRefusal(puppet);
    if StrLen(reasons) > 0 {
      return XFJson.Fail("npc_protected", "only plain passers-by are replaced; that NPC isn't one (" + StrReplaceAll(reasons, "\"", "") + "), so the bridge leaves it alone");
    }
    let busy = XFNpcCheck.Busy(puppet);
    if StrLen(busy) > 0 {
      return XFJson.Fail("npc_busy", "that NPC is busy (" + busy + ")");
    }
    let position = puppet.GetWorldPosition();
    if Vector4.Distance(position, from) > 30.0 {
      return XFJson.Fail("too_far", "that NPC is more than 30 m from V");
    }
    registry.Remember(puppet.GetEntityID());
    let recordId = puppet.GetRecordID();
    let record = TDBID.ToStringDEBUG(recordId);
    let className = puppet.GetClassName();
    let lookName = puppet.GetCurrentAppearanceName();
    let lookVariant = puppet.GetCurrentColorVariantName();
    let gender = puppet.GetResolvedGenderName();
    let bodyType = puppet.GetBodyType();
    let crowd = puppet.IsCrowd();
    let heading = puppet.GetWorldYaw();
    let stub = XFNpc.StubOf(puppet);
    return "{\"ok\":true,\"entity\":" + XFJson.Str(id) + ",\"record\":" + XFJson.Str(record) + ",\"class\":" + XFJson.Name(className)
      + ",\"appearance\":" + XFJson.Name(lookName) + ",\"variant\":" + XFJson.Name(lookVariant)
      + ",\"gender\":" + XFJson.Name(gender) + ",\"body_type\":" + XFJson.Name(bodyType)
      + ",\"crowd\":" + XFJson.Flag(crowd) + ",\"position\":" + XFScene.Arr(position) + ",\"yaw\":" + XFJson.Num(heading)
      + ",\"stub\":" + stub + "}";
  }

  // Holds the original still while the actor appears: the game's own stop levers on a crowd member (the response to a ragdoll or
  // a hit, NPCPuppet.script:1990-2003). Not recycled while held (UnmarkDespawnCandidate, which the crowd system's own swap does).
  public static func DetachOriginal(cid: String, id: String) -> String {
    let registry = XFNpcRegistry.Get();
    let puppet = XFNpc.Resolve(id);
    if !IsDefined(puppet) || !IsDefined(registry) {
      return XFJson.Fail("npc_not_found", "that NPC isn't near V any more");
    }
    let crowd = puppet.GetCrowdMemberComponent();
    if !IsDefined(crowd) {
      return "{\"ok\":true,\"detached\":false,\"why\":\"no crowd component\"}";
    }
    crowd.TryStopTrafficMovement();
    crowd.AllowWorkspotsUsage(false);
    let reactions = GameInstance.GetReactionSystem(GetGameInstance());
    if IsDefined(reactions) {
      reactions.UnmarkDespawnCandidate(puppet.GetEntityID());
    }
    registry.AddDetached(puppet.GetEntityID());
    XFBridgeLog.Info(cid, "npc substitution holds the original " + id + " still");
    return "{\"ok\":true,\"detached\":true,\"in_crowd_after\":" + XFJson.Flag(crowd.IsInCrowd()) + "}";
  }

  // Gives a held original back to the crowd: walk at the normal pace (what the release of a pick does) and use workspots again.
  public static func ReattachOne(puppet: ref<ScriptedPuppet>) -> Void {
    let crowd = puppet.GetCrowdMemberComponent();
    if IsDefined(crowd) {
      crowd.AllowWorkspotsUsage(true);
      crowd.ChangeMoveType(n"normal");
    }
  }

  // Found by its own id, wherever it is. A positive answer means it was found and given back; anything else leaves it owned in the
  // registry (the caller retries, and the kill switch tries again).
  public static func ReattachOriginal(cid: String, id: String) -> String {
    let registry = XFNpcRegistry.Get();
    let puppet = XFNpc.Resolve(id);
    if IsDefined(puppet) {
      XFNpc.ReattachOne(puppet);
      if IsDefined(registry) { registry.RemoveDetached(puppet.GetEntityID()); }
      XFBridgeLog.Info(cid, "npc substitution gave the original " + id + " back to the crowd");
      return "{\"ok\":true,\"reattached\":true}";
    }
    return "{\"ok\":true,\"reattached\":false,\"why\":\"the crowd person isn't found now (streamed out or removed); it stays owned and is tried again\"}";
  }

  // The original as it is now, for the checks just before its removal. A held crowd person is no longer a lane walker, so this does
  // not ask for that; it reads what must still be true: nobody protects it, and it is not a community NPC.
  public static func OriginalState(cid: String, id: String) -> String {
    let puppet = XFNpc.Resolve(id);
    if !IsDefined(puppet) {
      return "{\"ok\":true,\"found\":false}";
    }
    let reasons = XFNpcCheck.Reasons(puppet);
    let position = puppet.GetWorldPosition();
    let heading = puppet.GetWorldYaw();
    let stub = XFNpc.StubOf(puppet);
    return "{\"ok\":true,\"found\":true,\"position\":" + XFScene.Arr(position) + ",\"yaw\":" + XFJson.Num(heading) + ",\"reasons\":[" + reasons + "],\"community\":" + XFJson.Flag(!Equals(stub, "null")) + "}";
  }

  // Removes the original: held still, hidden for good and marked for the crowd system to recycle. Re-checks the protections first
  // (a person who became a quest participant meanwhile is left alone and the swap is undone).
  public static func RemoveOriginal(cid: String, id: String) -> String {
    let registry = XFNpcRegistry.Get();
    let puppet = XFNpc.Resolve(id);
    if !IsDefined(puppet) {
      return XFJson.Fail("npc_not_found", "the original isn't found any more");
    }
    let reasons = XFNpcCheck.Reasons(puppet);
    if StrLen(reasons) > 0 {
      return XFJson.Fail("npc_protected", "the original became protected (" + StrReplaceAll(reasons, "\"", "") + "), so it was left alone");
    }
    // The last word before the removal that cannot be undone: a community NPC (a quest can reserve one unmarked) is never hidden.
    let stub = XFNpc.StubOf(puppet);
    if !Equals(stub, "null") {
      return XFJson.Fail("community_npc", "the original is a community NPC, so it was left alone");
    }
    let crowd = puppet.GetCrowdMemberComponent();
    if IsDefined(crowd) {
      crowd.TryStopTrafficMovement();
      crowd.AllowWorkspotsUsage(false);
    }
    puppet.HideIrreversibly();
    let reactions = GameInstance.GetReactionSystem(GetGameInstance());
    if IsDefined(reactions) {
      reactions.MarkDespawnCandidate(puppet.GetEntityID());
    }
    if IsDefined(registry) { registry.RemoveDetached(puppet.GetEntityID()); }
    XFBridgeLog.Info(cid, "npc substitution removed the original " + id + " (hidden, marked for the crowd system to recycle)");
    return "{\"ok\":true,\"removed\":true,\"method\":\"hide_irreversibly+despawn_candidate\"}";
  }

  // restore: a fresh crowd person (the vanilla record itself, the original look) where an actor stood. The crowd record is a lane
  // walker, so the game's own crowd logic takes it from here (RestoreStep asks it to join the crowd).
  public static func Restore(cid: String, record: String, appearance: String, x: Float, y: Float, z: Float, yaw: Float) -> String {
    let system = GameInstance.GetDynamicEntitySystem();
    let registry = XFNpcRegistry.Get();
    if !IsDefined(system) || !system.IsReady() || !IsDefined(registry) {
      return XFJson.Fail("not_ready", "the game can't spawn NPCs yet");
    }
    if registry.RestoringCount() >= 5 {
      return XFJson.Fail("limit", "five fresh crowd people are still on their way to the crowd; no more are left");
    }
    let recordId = TDBID.Create(record);
    if !IsDefined(TweakDBInterface.GetCharacterRecord(recordId)) {
      return XFJson.Fail("record_missing", "the crowd record " + record + " isn't in the game's database");
    }
    let angles: EulerAngles;
    angles.Yaw = yaw;
    let spec = new DynamicEntitySpec();
    spec.recordID = recordId;
    if StrLen(appearance) > 0 {
      spec.appearanceName = StringToName(appearance);
    }
    spec.position = new Vector4(x, y, z, 1.0);
    spec.orientation = EulerAngles.ToQuat(angles);
    spec.persistState = false;
    spec.persistSpawn = false;
    spec.alwaysSpawned = false;
    spec.spawnInView = false;
    spec.active = true;
    ArrayPush(spec.tags, n"xfs_crowd_restore");
    let id = system.CreateEntity(spec);
    if !EntityID.IsDefined(id) {
      return XFJson.Fail("spawn_refused", "the game's entity spawner refused the crowd person");
    }
    registry.AddRestoring(id);
    XFBridgeLog.Info(cid, "npc restore left a fresh crowd person of " + record);
    return "{\"ok\":true,\"entity\":" + XFJson.Str(EntityID.ToDebugString(id)) + "}";
  }

  // A fresh crowd person that never joined the crowd: deleted, or its spawn request cancelled (Codeware's DeleteEntity does either).
  public static func RestoreCancel(cid: String, entity: String) -> String {
    let system = GameInstance.GetDynamicEntitySystem();
    let registry = XFNpcRegistry.Get();
    if !IsDefined(registry) {
      return "{\"ok\":true,\"cancelled\":true,\"why\":\"nothing held\"}";
    }
    let id = registry.Restoring(entity);
    if !EntityID.IsDefined(id) {
      return "{\"ok\":true,\"cancelled\":true,\"why\":\"not held any more\"}";
    }
    if !IsDefined(system) {
      return "{\"ok\":true,\"cancelled\":false}";
    }
    system.DeleteEntity(id);
    registry.RemoveRestoring(id);
    XFBridgeLog.Info(cid, "npc restore removed a fresh crowd person that never joined the crowd");
    return "{\"ok\":true,\"cancelled\":true}";
  }

  public static func RestoreStep(cid: String, entity: String, send: Bool) -> String {
    let system = GameInstance.GetDynamicEntitySystem();
    let registry = XFNpcRegistry.Get();
    if !IsDefined(system) || !IsDefined(registry) {
      return "{\"ok\":true,\"spawned\":false}";
    }
    let id = registry.Restoring(entity);
    if !EntityID.IsDefined(id) || !system.IsSpawned(id) {
      return "{\"ok\":true,\"spawned\":false}";
    }
    let puppet = system.GetEntity(id) as ScriptedPuppet;
    if !IsDefined(puppet) {
      return "{\"ok\":true,\"spawned\":false}";
    }
    if send {
      let ai = puppet.GetAIControllerComponent();
      if IsDefined(ai) {
        let join = new AIJoinCrowdCommand();
        ai.SendCommand(join);
      }
    }
    let crowd = puppet.GetCrowdMemberComponent();
    let inCrowd = IsDefined(crowd) && crowd.IsInCrowd();
    if inCrowd {
      registry.RemoveRestoring(id);
    }
    return "{\"ok\":true,\"spawned\":true,\"in_crowd\":" + XFJson.Flag(inCrowd) + "}";
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
    // 0.8.9 (session 15's NB8: a released pick stood about 20 s before walking on): a crowd member is told to walk on at its
    // normal pace, as the reaction component does after its own reactions (reactionComponent.script:3241-3243).
    if Equals(entry.kind, "pick") {
      let picked = XFNpc.PuppetOf(entry);
      if IsDefined(picked) && picked.IsCrowd() {
        let crowd = picked.GetCrowdMemberComponent();
        if IsDefined(crowd) {
          crowd.ChangeMoveType(n"normal");
        }
      }
    }
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
    // 0.8.19: crowd people held for a substitution that did not finish go back to the crowd, each found by its own id wherever it is.
    // One that cannot be found now stays owned in the registry and is reported, so the caller retries; a fresh crowd person not yet
    // seen in the crowd is removed (one that joined is the game's now).
    let unresolved = "";
    if IsDefined(registry) {
      let held = registry.Detached();
      for id in held {
        let found = GameInstance.FindEntityByID(GetGameInstance(), id) as ScriptedPuppet;
        if IsDefined(found) {
          XFNpc.ReattachOne(found);
          registry.RemoveDetached(id);
        } else {
          unresolved += (StrLen(unresolved) > 0 ? "," : "") + XFJson.Str(EntityID.ToDebugString(id));
        }
      }
      let restoring = registry.TakeRestoring();
      if IsDefined(system) {
        for id in restoring { system.DeleteEntity(id); }
      }
    }
    XFBridgeLog.Info(cid, "npc released all (" + reason + "): " + IntToString(released));
    return "{\"ok\":true,\"released\":" + IntToString(released) + ",\"reason\":" + XFJson.Str(reason) + ",\"unresolved\":[" + unresolved + "]}";
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
            item += ",\"yaw\":" + XFJson.Num(yaw) + ",\"command_state\":" + XFJson.Str(state);
            if Equals(entry.kind, "actor") {
              let ready = XFNpc.GestureReady(entry);
              item += ",\"prepared\":" + XFJson.Flag(entry.prepared) + ",\"gesture_ready\":" + XFJson.Flag(ready);
              // 0.8.19: the look the substitution reports against (appearance and colour variant as the game has them now).
              let lookName = puppet.GetCurrentAppearanceName();
              let lookVariant = puppet.GetCurrentColorVariantName();
              item += ",\"appearance\":" + XFJson.Name(lookName) + ",\"variant\":" + XFJson.Name(lookVariant);
            } else {
              let pickBusy = XFNpcCheck.Busy(puppet);
              let pickRefusal = XFNpcCheck.PickRefusal(puppet);
              item += ",\"busy\":" + XFJson.Str(pickBusy) + ",\"protected\":" + XFJson.Flag(StrLen(pickRefusal) > 0);
            }
            item += "}";
          }
        }
        out += (StrLen(out) > 0 ? "," : "") + item;
      }
      // Keep our hub active and its highlight where the player left it (the module's per-frame update). 0.8.9: a device
      // screen V turned to withdraws it, as a prompt does (the game's comes first).
      if registry.HubShown() {
        if XFNpcHub.DeviceFocus() {
          registry.WithdrawForGame();
          XFNpcHub.Refresh(false);
          let ours = registry.Hub();
          XFBridgeLog.Info("npc-hub", "V turned to a device's screen; hub " + IntToString(ours.id) + " withdrawn");
        } else {
          XFNpcHub.Refresh(true);
        }
      }
    }
    let hubText = "{\"id\":0,\"answer\":-1,\"shown\":false}";
    if IsDefined(registry) {
      let hub = registry.Hub();
      hubText = "{\"id\":" + IntToString(hub.id) + ",\"answer\":" + IntToString(registry.HubAnswer()) + ",\"shown\":" + XFJson.Flag(registry.HubShown()) + ",\"withdrawn\":" + XFJson.Str(registry.HubWithdrawn()) + "}";
    }
    let camera = XFNpcV.Camera();
    return "{\"ok\":true,\"v\":" + vText + camera + ",\"npcs\":[" + out + "],\"hub\":" + hubText + "}";
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

  public static func Spawn(cid: String, who: String, record: String, x: Float, y: Float, z: Float, yaw: Float, appearance: String, outOfView: Bool, attitude: Int32, immortal: Bool) -> String {
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
  public static func LookedAt(cid: String) -> String {
    return XFNpc.Missing();
  }

  public static func ReadLook(cid: String, id: String) -> String {
    return XFNpc.Missing();
  }

  public static func DetachOriginal(cid: String, id: String) -> String {
    return XFNpc.Missing();
  }

  public static func ReattachOriginal(cid: String, id: String) -> String {
    return "{\"ok\":true,\"reattached\":false}";
  }

  public static func RemoveOriginal(cid: String, id: String) -> String {
    return XFNpc.Missing();
  }

  public static func OriginalState(cid: String, id: String) -> String {
    return XFNpc.Missing();
  }

  public static func RestoreCancel(cid: String, entity: String) -> String {
    return "{\"ok\":true,\"cancelled\":true}";
  }

  public static func Restore(cid: String, record: String, appearance: String, x: Float, y: Float, z: Float, yaw: Float) -> String {
    return XFNpc.Missing();
  }

  public static func RestoreStep(cid: String, entity: String, send: Bool) -> String {
    return "{\"ok\":true,\"spawned\":false}";
  }

  public static func Release(cid: String, who: String, how: String) -> String {
    return "{\"ok\":true,\"released\":false}";
  }

  public static func ReleaseAll(cid: String, reason: String) -> String {
    return "{\"ok\":true,\"released\":0,\"reason\":" + XFJson.Str(reason) + "}";
  }

  public static func Poll(cid: String, whos: String) -> String {
    return "{\"ok\":true,\"v\":{\"busy\":\"\"},\"npcs\":[],\"hub\":{\"id\":0,\"answer\":-1,\"shown\":false}}";
  }

  public static func PrepareActor(cid: String, who: String) -> String {
    return XFNpc.Missing();
  }

  public static func StartGesture(cid: String, who: String) -> String {
    return XFNpc.Missing();
  }
}
