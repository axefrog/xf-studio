module XFRuntimeBridge

// Autonomous -writes only. Called on the game thread behind ScriptCall's live guard.
// No NPC poll: its hub refresh changes state. These reads resolve each selected puppet afresh.
public abstract class XFRecording {
  public static func Sample(cid: String, channel: String, whos: String) -> String {
    if !XFBridge_Live() { return XFJson.Fail("game_loading", "Recorder live gate closed"); }
    if Equals(channel, "subtitles") || Equals(channel, "voice") { return XFRecordingTap.Status(channel); }
    if Equals(channel, "face") { return XFRecordingFace.Status(); }
    if Equals(channel, "ui") { return XFRecordingUi.Sample(); }
    if Equals(channel, "camera") {
      let camera = XFPlayer.CameraJson();
      return "{\"ok\":true,\"valid\":" + XFJson.Flag(NotEquals(camera, "null")) + ",\"camera\":" + camera + "}";
    }
    if Equals(channel, "actors") {
      return XFRecordingActors.Sample(whos);
    }
    let player = XFPlayer.Player();
    if !IsDefined(player) || !player.IsAttached() {
      return "{\"ok\":true,\"valid\":false,\"reason\":\"not_v\"}";
    }
    let game = GetGameInstance();
    let defs = GetAllBlackboardDefs().PlayerStateMachine;
    let position = player.GetWorldPosition();
    let yaw = player.GetWorldYaw();
    let velocity = player.GetVelocity();
    let id = player.GetEntityID();
    let vitals = XFSenses.Vitals(game, player);
    let heat = XFSenses.Heat(game);
    return "{\"ok\":true,\"valid\":true,\"entity\":" + XFJson.Str(EntityID.ToDebugString(id)) + ",\"position\":" + XFScene.Arr(position) + ",\"yaw\":" + XFJson.Num(yaw) + ",\"velocity\":" + XFScene.Arr(velocity) + ",\"vitals\":" + vitals + ",\"heat\":" + heat + ",\"psm\":{\"locomotion\":" + IntToString(XFPlayer.Psm(player, defs.Locomotion)) + ",\"high_level\":" + IntToString(XFPlayer.Psm(player, defs.HighLevel)) + ",\"combat\":" + IntToString(XFPlayer.Psm(player, defs.Combat)) + "}}";
  }
}

@if(ModuleExists("Codeware"))
public abstract class XFRecordingActors {
  public static func Sample(whos: String) -> String {
    if !XFBridge_Live() { return XFJson.Fail("game_loading", "Recorder live gate closed"); }
    let registry = XFNpcRegistry.Get();
    if !IsDefined(registry) {
      return "{\"ok\":true,\"valid\":false,\"reason\":\"registry_unavailable\"}";
    }
    let out = "";
    let valid = true;
    if StrLen(whos) > 0 {
      for who in StrSplit(whos, ",") {
        let entry = registry.Entry(who);
        let puppet: ref<ScriptedPuppet>;
        if IsDefined(entry) { puppet = XFNpc.PuppetOf(entry); }
        if !IsDefined(puppet) { valid = false; }
        let item = "{\"who\":" + XFJson.Str(who) + ",\"valid\":" + XFJson.Flag(IsDefined(puppet));
        if IsDefined(puppet) {
          let id = puppet.GetEntityID();
          let position = puppet.GetWorldPosition();
          let yaw = puppet.GetWorldYaw();
          let state = "NotExecuting";
          let ai = puppet.GetAIControllerComponent();
          if IsDefined(entry.command) && IsDefined(ai) {
            let commandState = ai.GetCommandState(entry.command);
            state = EnumValueToString("AICommandState", Cast<Int64>(EnumInt(commandState)));
          }
          item += ",\"entity\":" + XFJson.Str(EntityID.ToDebugString(id)) + ",\"position\":" + XFScene.Arr(position) + ",\"yaw\":" + XFJson.Num(yaw) + ",\"command_state\":" + XFJson.Str(state) + ",\"prepared\":" + XFJson.Flag(entry.prepared);
        }
        out += (StrLen(out) > 0 ? "," : "") + item + "}";
      }
    }
    return "{\"ok\":true,\"valid\":" + XFJson.Flag(valid) + ",\"actors\":[" + out + "]}";
  }
}
@if(!ModuleExists("Codeware"))
public abstract class XFRecordingActors {
  public static func Sample(whos: String) -> String {
    if !XFBridge_Live() { return XFJson.Fail("game_loading", "Recorder live gate closed"); }
    return "{\"ok\":true,\"valid\":false,\"reason\":\"codeware_missing\"}";
  }
}

// Only the autonomous package carries this file. No timer, per-frame widget walk or second event ring.
// The source listener uses immediate notifications. Consumer delayed callbacks are independently tapped.
@if(ModuleExists("Codeware"))
public abstract class XFRecordingTap {
  public static func Get() -> ref<XFRecordingListeners> {
    let container = GameInstance.GetScriptableSystemsContainer(GetGameInstance());
    return IsDefined(container) ? container.Get(n"XFRuntimeBridge.XFRecordingListeners") as XFRecordingListeners : null;
  }
  public static func On(channel: String) -> Bool { return XFBridge_RecordEnabled(channel); }
  public static func Emit(channel: String, event: String, body: String) -> Void {
    if XFRecordingTap.On(channel) { XFBridge_Record(channel, "{\"event\":" + XFJson.Str(event) + "," + body + "}"); }
  }
  public static func NewId() -> String {
    let taps = XFRecordingTap.Get();
    return IsDefined(taps) ? taps.NextId() : "";
  }
  public static func Id(id: CRUID) -> String { return ToString(CRUIDToHash(id)); }
  public static func Entity(obj: wref<GameObject>) -> String {
    return IsDefined(obj) ? EntityID.ToDebugString(obj.GetEntityID()) : "";
  }
  public static func Line(line: scnDialogLineData) -> String {
    let display = scnDialogLineData.GetDisplayText(line);
    return "\"line_id\":" + XFJson.Str(XFRecordingTap.Id(line.id)) + ",\"speaker\":" + XFJson.Str(XFRecordingTap.Entity(line.speaker))
      + ",\"speaker_name\":" + XFJson.Str(line.speakerName) + ",\"text\":" + XFJson.Str(line.text)
      + ",\"display_text\":" + XFJson.Str(display.text) + ",\"type\":" + XFJson.Str(EnumValueToString("scnDialogLineType", Cast<Int64>(EnumInt(line.type))))
      + ",\"duration_s\":" + XFJson.Num(line.duration) + ",\"persistent\":" + XFJson.Flag(line.isPersistent);
  }
  public static func Widget(widget: wref<inkWidget>) -> String {
    if !IsDefined(widget) { return "\"widget_defined\":false"; }
    let visible = true;
    let opacity = 1.0;
    let parent = widget;
    let depth = 0;
    while IsDefined(parent) && depth < 32 {
      visible = visible && parent.IsVisible(); opacity *= parent.GetOpacity();
      parent = parent.parentWidget; depth += 1;
    }
    let bounds = GetScreenPosition(widget);
    return XFRecordingTap.WidgetIdentity(widget) + ",\"widget_defined\":true,\"effective_visible\":" + XFJson.Flag(visible && opacity > 0.0)
      + ",\"opacity\":" + XFJson.Num(opacity) + ",\"ancestor_limit\":" + XFJson.Flag(IsDefined(parent))
      + ",\"rect\":[" + XFJson.Num(bounds.Left) + "," + XFJson.Num(bounds.Top) + "," + XFJson.Num(bounds.Right) + "," + XFJson.Num(bounds.Bottom) + "],\"geometry_phase\":\"callback_not_settled\",\"context_found\":null,\"pixel_rect\":null,\"coordinate_space\":\"owning_ink_window\"";
  }
  public static func WidgetIdentity(widget: wref<inkWidget>) -> String {
    let controller = IsDefined(widget) ? widget.GetController() as BaseSubtitleLineLogicController : null;
    return IsDefined(controller) ? "\"widget_id\":" + XFJson.Str(controller.xfbRecordingWidgetId) + ",\"consumer\":" + (StrLen(controller.xfbRecordingConsumer) > 0 ? controller.xfbRecordingConsumer : "null") : "\"widget_id\":null";
  }
  public static func Status(channel: String) -> String {
    let taps = XFRecordingTap.Get();
    return IsDefined(taps) ? taps.Status(channel) : "{\"valid\":false,\"reason\":\"listeners_missing\"}";
  }
  public static func Voice(event: String, obj: wref<GameObject>, trigger: CName, context: CName, delay: Float, extra: String) -> Void {
    if !XFRecordingTap.On("voice") { return; }
    XFRecordingTap.Emit("voice", event, "\"coverage\":\"script_request\",\"entity\":" + XFJson.Str(XFRecordingTap.Entity(obj))
      + ",\"trigger\":" + XFJson.Str(NameToString(trigger)) + ",\"initial_context\":" + XFJson.Str(NameToString(context))
      + ",\"delay_s\":" + XFJson.Num(delay) + extra);
  }
}
@if(!ModuleExists("Codeware"))
public abstract class XFRecordingTap {
  public static func Status(channel: String) -> String { return "{\"valid\":false,\"reason\":\"codeware_missing\"}"; }
}

@if(ModuleExists("Codeware"))
public class XFRecordingListeners extends ScriptableSystem {
  private let m_nextId: Int32;
  public func NextId() -> String { this.m_nextId += 1; return IntToString(this.m_nextId); }
  private let m_board: wref<IBlackboard>;
  private let m_show: ref<CallbackHandle>;
  private let m_hide: ref<CallbackHandle>;
  private let m_hideData: ref<CallbackHandle>;
  private let m_controllers: array<wref<BaseSubtitlesGameController>>;
  private let m_overflow: Bool;
  private let m_showBatches: Int32;
  private let m_hideBatches: Int32;
  private func OnPlayerAttach(request: ref<PlayerAttachRequest>) -> Void {
    if IsDefined(this.m_board) || (XFBridge_ProbeFlags() & 1) == 0 { return; }
    this.m_board = GameInstance.GetBlackboardSystem(this.GetGameInstance()).Get(GetAllBlackboardDefs().UIGameData);
    this.m_show = this.m_board.RegisterListenerVariant(GetAllBlackboardDefs().UIGameData.ShowDialogLine, this, n"OnXFShow");
    this.m_hide = this.m_board.RegisterListenerVariant(GetAllBlackboardDefs().UIGameData.HideDialogLine, this, n"OnXFHide");
    this.m_hideData = this.m_board.RegisterListenerVariant(GetAllBlackboardDefs().UIGameData.HideDialogLineByData, this, n"OnXFHideData");
  }
  private func OnDetach() -> Void {
    if IsDefined(this.m_board) {
      this.m_board.UnregisterListenerVariant(GetAllBlackboardDefs().UIGameData.ShowDialogLine, this.m_show);
      this.m_board.UnregisterListenerVariant(GetAllBlackboardDefs().UIGameData.HideDialogLine, this.m_hide);
      this.m_board.UnregisterListenerVariant(GetAllBlackboardDefs().UIGameData.HideDialogLineByData, this.m_hideData);
    }
    this.m_board = null; this.m_show = null; this.m_hide = null; this.m_hideData = null;
    ArrayClear(this.m_controllers);
  }
  public func Track(controller: ref<BaseSubtitlesGameController>) -> Void {
    let i = ArraySize(this.m_controllers) - 1;
    while i >= 0 {
      if !IsDefined(this.m_controllers[i]) { ArrayErase(this.m_controllers, i); }
      i -= 1;
    }
    if ArrayContains(this.m_controllers, controller) { return; }
    if ArraySize(this.m_controllers) >= 16 { this.m_overflow = true; return; }
    ArrayPush(this.m_controllers, controller);
  }
  public func Status(channel: String) -> String {
    let count = 0; let subscriptions = 0; let widgets = 0; let controllers = "";
    let subtitles = false; let chatters = false;
    for controller in this.m_controllers {
      if IsDefined(controller) && controller.xfbRecordingSubscribed {
        count += 1; subscriptions += controller.XFRecordingListenerCount(); widgets += controller.XFRecordingWidgetCount();
        subtitles = subtitles || Equals(controller.GetClassName(), n"SubtitlesGameController");
        chatters = chatters || Equals(controller.GetClassName(), n"ChattersGameController");
        controllers += (StrLen(controllers) > 0 ? "," : "") + controller.XFRecordingIdentity();
      }
    }
    let listeners = (IsDefined(this.m_show) ? 1 : 0) + (IsDefined(this.m_hide) ? 1 : 0) + (IsDefined(this.m_hideData) ? 1 : 0);
    return "{\"event\":\"tap.coverage\",\"valid\":" + XFJson.Flag(listeners == 3 && !this.m_overflow && count == 2 && subscriptions == 6 && subtitles && chatters)
      + ",\"source_listeners\":" + IntToString(listeners) + ",\"controller_count\":" + IntToString(count)
      + ",\"controller_listeners\":" + IntToString(subscriptions) + ",\"active_widgets\":" + IntToString(widgets)
      + ",\"controllers\":[" + controllers + "],\"source_show_batches\":" + IntToString(this.m_showBatches)
      + ",\"source_hide_batches\":" + IntToString(this.m_hideBatches) + ",\"registry_overflow\":" + XFJson.Flag(this.m_overflow)
      + ",\"coverage\":\"immediate_blackboard_notifications; delayed_controller_delivery; PlayVoiceOver; reaction_and_AI_callers\",\"audible_proof\":false}";
  }
  protected cb func OnXFShow(value: Variant) -> Bool {
    if !XFRecordingTap.On("subtitles") { return false; }
    this.m_showBatches += 1;
    let lines = FromVariant<array<scnDialogLineData>>(value);
    if ArraySize(lines) > 64 { XFRecordingTap.Emit("subtitles", "tap.truncated", "\"valid\":false"); }
    let i = 0;
    while i < Min(ArraySize(lines), 64) {
      XFRecordingTap.Emit("subtitles", "line.requested", XFRecordingTap.Line(lines[i])); i += 1;
    }
  }
  protected cb func OnXFHide(value: Variant) -> Bool {
    if !XFRecordingTap.On("subtitles") { return false; }
    this.m_hideBatches += 1;
    let ids = FromVariant<array<CRUID>>(value);
    if ArraySize(ids) > 64 { XFRecordingTap.Emit("subtitles", "tap.truncated", "\"valid\":false"); }
    let i = 0;
    while i < Min(ArraySize(ids), 64) {
      XFRecordingTap.Emit("subtitles", "line.hidden", "\"by\":\"id\",\"line_id\":" + XFJson.Str(XFRecordingTap.Id(ids[i]))); i += 1;
    }
  }
  protected cb func OnXFHideData(value: Variant) -> Bool {
    if !XFRecordingTap.On("subtitles") { return false; }
    this.m_hideBatches += 1;
    let lines = FromVariant<array<scnDialogLineData>>(value);
    if ArraySize(lines) > 64 { XFRecordingTap.Emit("subtitles", "tap.truncated", "\"valid\":false"); }
    let i = 0;
    while i < Min(ArraySize(lines), 64) {
      XFRecordingTap.Emit("subtitles", "line.hidden", "\"by\":\"data\"," + XFRecordingTap.Line(lines[i])); i += 1;
    }
  }
}

@if(ModuleExists("Codeware"))
@addField(BaseSubtitlesGameController)
public let xfbRecordingSubscribed: Bool;
@if(ModuleExists("Codeware"))
@addField(BaseSubtitlesGameController)
private let xfbRecordingId: String;
@if(ModuleExists("Codeware"))
@addMethod(BaseSubtitlesGameController)
public func XFRecordingIdentity() -> String {
  if StrLen(this.xfbRecordingId) == 0 { this.xfbRecordingId = XFRecordingTap.NewId(); }
  return "{\"controller\":" + XFJson.Str(NameToString(this.GetClassName())) + ",\"controller_id\":" + XFJson.Str(this.xfbRecordingId) + "}";
}
@if(ModuleExists("Codeware"))
@addMethod(BaseSubtitlesGameController)
public func XFRecordingListenerCount() -> Int32 {
  return (IsDefined(this.m_bbCbShowDialogLine) ? 1 : 0) + (IsDefined(this.m_bbCbHideDialogLine) ? 1 : 0) + (IsDefined(this.m_bbCbHideDialogLineByData) ? 1 : 0);
}
@if(ModuleExists("Codeware"))
@addMethod(BaseSubtitlesGameController)
public func XFRecordingBody() -> String {
  return "\"consumer\":" + this.XFRecordingIdentity() + ",\"mapped_widgets\":" + IntToString(ArraySize(this.m_lineMap)) + ",\"disabled_by_settings\":" + XFJson.Flag(this.m_disabledBySettings) + ",\"radio_enabled\":" + XFJson.Flag(this.m_isRadioSubtitleEnabled);
}
@if(ModuleExists("Codeware"))
@addMethod(BaseSubtitlesGameController)
private func XFRecordingTrack() -> Void {
  if (XFBridge_ProbeFlags() & 1) == 0 || !XFBridge_Live() { return; }
  let taps = XFRecordingTap.Get();
  if IsDefined(taps) { taps.Track(this); }
}
@if(ModuleExists("Codeware"))
@wrapMethod(BaseSubtitlesGameController)
private final func RegisterToDialogBlackboard(value: Bool) -> Void {
  wrappedMethod(value);
  this.xfbRecordingSubscribed = value;
  // Before the live gate opens, keep only this controller's own bookkeeping. A later
  // delivered line discovers it without querying session systems during initialization/teardown.
  this.XFRecordingTrack();
  if XFRecordingTap.On("subtitles") {
    XFRecordingTap.Emit("subtitles", "controller.listeners", this.XFRecordingBody() + ",\"registered\":" + XFJson.Flag(value));
  }
}
@if(ModuleExists("Codeware"))
@wrapMethod(BaseSubtitlesGameController)
protected cb func OnShowDialogLine(value: Variant) -> Bool {
  this.XFRecordingTrack();
  if XFRecordingTap.On("subtitles") {
    let lines = FromVariant<array<scnDialogLineData>>(value);
    let i = 0;
    while i < Min(ArraySize(lines), 64) {
      XFRecordingTap.Emit("subtitles", "line.delivered", this.XFRecordingBody() + "," + XFRecordingTap.Line(lines[i])); i += 1;
    }
    if ArraySize(lines) > 64 { XFRecordingTap.Emit("subtitles", "tap.truncated", "\"valid\":false"); }
  }
  return wrappedMethod(value);
}
@if(ModuleExists("Codeware"))
@wrapMethod(BaseSubtitlesGameController)
private final func SpawnDialogLine(const lineData: script_ref<scnDialogLineData>) -> Void {
  if XFRecordingTap.On("subtitles") { XFRecordingTap.Emit("subtitles", "line.accepted", this.XFRecordingBody() + "," + XFRecordingTap.Line(Deref(lineData))); }
  wrappedMethod(lineData);
}
@if(ModuleExists("Codeware"))
@wrapMethod(BaseSubtitlesGameController)
protected cb func OnLineSpawned(widget: ref<inkWidget>, userData: ref<IScriptable>) -> Bool {
  this.XFRecordingTrack();
  // The async spawn callback owns a real newly-created widget at entry; pending hides can remove it inside wrappedMethod.
  if XFRecordingTap.On("subtitles") {
    let spawn = userData as LineSpawnData;
    if IsDefined(widget) {
      let controller = widget.GetController() as BaseSubtitleLineLogicController;
      if IsDefined(controller) { controller.xfbRecordingWidgetId = XFRecordingTap.NewId(); controller.xfbRecordingConsumer = this.XFRecordingIdentity(); }
    }
    if IsDefined(spawn) { XFRecordingTap.Emit("subtitles", IsDefined(widget) ? "line.widget_created" : "line.spawn_failed", XFRecordingTap.Line(spawn.m_lineData) + "," + XFRecordingTap.Widget(widget)); }
  }
  let result = wrappedMethod(widget, userData);
  if XFRecordingTap.On("subtitles") && IsDefined(widget) && IsDefined(widget.parentWidget) {
    let spawn = userData as LineSpawnData;
    if IsDefined(spawn) { XFRecordingTap.Emit("subtitles", "line.widget_state", XFRecordingTap.Line(spawn.m_lineData) + "," + XFRecordingTap.Widget(widget)); }
  }
  return result;
}

@if(ModuleExists("Codeware"))
@wrapMethod(GameObject)
public final static func PlayVoiceOver(self: ref<GameObject>, voName: CName, debugInitialContext: CName, opt delay: Float, opt answeringEntityID: EntityID, opt canPlayInVehicle: Bool) -> DelayID {
  if XFRecordingTap.On("voice") {
    XFRecordingTap.Voice("voice.requested", self, voName, debugInitialContext, delay,
      ",\"can_play_in_vehicle\":" + XFJson.Flag(canPlayInVehicle) + ",\"answering_entity\":" + XFJson.Str(EntityID.ToDebugString(answeringEntityID)));
  }
  return wrappedMethod(self, voName, debugInitialContext, delay, answeringEntityID, canPlayInVehicle);
}
@if(ModuleExists("Codeware"))
@wrapMethod(ReactionManagerComponent)
private final func TriggerFacialLookAtReaction(opt forceFear: Bool, opt playVO: Bool) -> Void {
  if XFRecordingTap.On("voice") { XFRecordingTap.Voice("voice.reaction_caller", this.GetOwner(), n"", n"Scripts:TriggerLookAtReaction", 0.0, ",\"force_fear\":" + XFJson.Flag(forceFear) + ",\"play_vo_argument\":" + XFJson.Flag(playVO)); }
  wrappedMethod(forceFear, playVO);
}
@if(ModuleExists("Codeware"))
@wrapMethod(ReactionManagerComponent)
public final static func SendVOEventToSquad(owner: wref<GameObject>, voEvent: CName, opt setOwnerAsAnsweringEntity: Bool, opt onlyForMembersInCombat: Bool) -> Void {
  if XFRecordingTap.On("voice") { XFRecordingTap.Voice("voice.squad_caller", owner, voEvent, n"Scripts:SendVOEventToSquad", 0.0, ""); }
  wrappedMethod(owner, voEvent, setOwnerAsAnsweringEntity, onlyForMembersInCombat);
}
@if(ModuleExists("Codeware"))
@wrapMethod(AISubActionPlayVoiceOver_Record_Implementation)
public final static func SendVoiceOverEvent(context: ScriptExecutionContext, record: wref<AISubActionPlayVoiceOver_Record>, debugInitContext: CName) -> Void {
  if XFRecordingTap.On("voice") { XFRecordingTap.Voice("voice.ai_caller", ScriptExecutionContext.GetOwner(context), record.Name(), debugInitContext, record.Delay(), ""); }
  wrappedMethod(context, record, debugInitContext);
}

@if(ModuleExists("Codeware"))
@wrapMethod(SubtitlesGameController)
protected func OnHideLine(const lineData: script_ref<subtitleLineMapEntry>) -> Void {
  let identity = XFRecordingTap.On("subtitles") ? XFRecordingTap.WidgetIdentity(Deref(lineData).widget) : "";
  wrappedMethod(lineData);
  if XFRecordingTap.On("subtitles") {
    XFRecordingTap.Emit("subtitles", "line.widget_removed", identity + ",\"line_id\":" + XFJson.Str(XFRecordingTap.Id(Deref(lineData).id)) + ",\"speaker\":" + XFJson.Str(XFRecordingTap.Entity(Deref(lineData).owner)) + ",\"reason\":\"OnHideLine\",\"detached\":" + XFJson.Flag(!IsDefined(Deref(lineData).widget) || !IsDefined(Deref(lineData).widget.parentWidget)));
  }
}

@if(ModuleExists("Codeware"))
@wrapMethod(SubtitlesGameController)
protected func OnHideLineByData(const lineData: script_ref<subtitleLineMapEntry>) -> Void {
  let identity = XFRecordingTap.On("subtitles") ? XFRecordingTap.WidgetIdentity(Deref(lineData).widget) : "";
  wrappedMethod(lineData);
  if XFRecordingTap.On("subtitles") {
    XFRecordingTap.Emit("subtitles", "line.widget_removed", identity + ",\"line_id\":" + XFJson.Str(XFRecordingTap.Id(Deref(lineData).id)) + ",\"speaker\":" + XFJson.Str(XFRecordingTap.Entity(Deref(lineData).owner)) + ",\"reason\":\"OnHideLineByData\",\"detached\":" + XFJson.Flag(!IsDefined(Deref(lineData).widget) || !IsDefined(Deref(lineData).widget.parentWidget)));
  }
}

@if(ModuleExists("Codeware"))
@wrapMethod(ChattersGameController)
protected func OnHideLine(const lineData: script_ref<subtitleLineMapEntry>) -> Void {
  let identity = XFRecordingTap.On("subtitles") ? XFRecordingTap.WidgetIdentity(Deref(lineData).widget) : "";
  wrappedMethod(lineData);
  if XFRecordingTap.On("subtitles") {
    XFRecordingTap.Emit("subtitles", "line.widget_removed", identity + ",\"line_id\":" + XFJson.Str(XFRecordingTap.Id(Deref(lineData).id)) + ",\"speaker\":" + XFJson.Str(XFRecordingTap.Entity(Deref(lineData).owner)) + ",\"reason\":\"OnHideLine\",\"detached\":" + XFJson.Flag(!IsDefined(Deref(lineData).widget) || !IsDefined(Deref(lineData).widget.parentWidget)));
  }
}

@if(ModuleExists("Codeware"))
@wrapMethod(ChattersGameController)
protected func OnHideLineByData(const lineData: script_ref<subtitleLineMapEntry>) -> Void {
  let identity = XFRecordingTap.On("subtitles") ? XFRecordingTap.WidgetIdentity(Deref(lineData).widget) : "";
  wrappedMethod(lineData);
  if XFRecordingTap.On("subtitles") {
    XFRecordingTap.Emit("subtitles", "line.widget_removed", identity + ",\"line_id\":" + XFJson.Str(XFRecordingTap.Id(Deref(lineData).id)) + ",\"speaker\":" + XFJson.Str(XFRecordingTap.Entity(Deref(lineData).owner)) + ",\"reason\":\"OnHideLineByData\",\"detached\":" + XFJson.Flag(!IsDefined(Deref(lineData).widget) || !IsDefined(Deref(lineData).widget.parentWidget)));
  }
}

@if(ModuleExists("Codeware"))
@wrapMethod(SubtitleLineLogicController)
public func SetLineData(const lineData: script_ref<scnDialogLineData>) -> Void {
  wrappedMethod(lineData);
  if !XFRecordingTap.On("subtitles") { return; }
  let text = inkWidgetRef.Get(this.m_targetTextWidgetRef) as inkText;
  let actual = IsDefined(text) ? text.GetText() : "";
  XFRecordingTap.Emit("subtitles", "line.widget_bound", XFRecordingTap.Line(Deref(lineData)) + ",\"actual_text\":" + XFJson.Str(actual) + ",\"line_controller\":\"SubtitleLineLogicController\"," + XFRecordingTap.Widget(this.GetRootWidget()));
}

@if(ModuleExists("Codeware"))
@wrapMethod(ChatterLineLogicController)
public func SetLineData(const lineData: script_ref<scnDialogLineData>) -> Void {
  wrappedMethod(lineData);
  if !XFRecordingTap.On("subtitles") { return; }
  let normal = inkWidgetRef.Get(this.m_text_normal) as inkText;
  let wide = inkWidgetRef.Get(this.m_text_wide) as inkText;
  let actual = IsDefined(normal) && normal.IsVisible() ? normal.GetText() : IsDefined(wide) ? wide.GetText() : "";
  XFRecordingTap.Emit("subtitles", "line.widget_bound", XFRecordingTap.Line(Deref(lineData)) + ",\"actual_text\":" + XFJson.Str(actual) + ",\"line_controller\":\"ChatterLineLogicController\"," + XFRecordingTap.Widget(this.GetRootWidget()));
}

@if(ModuleExists("Codeware"))
@addField(BaseSubtitleLineLogicController)
public let xfbRecordingWidgetId: String;
@if(ModuleExists("Codeware"))
@addField(BaseSubtitleLineLogicController)
public let xfbRecordingConsumer: String;
@if(ModuleExists("Codeware"))
@addMethod(BaseSubtitlesGameController)
public func XFRecordingWidgetCount() -> Int32 { return ArraySize(this.m_lineMap); }

// F: script producers only. Native controller receipt/applied graph input remains R3 commissioning work.
@if(ModuleExists("Codeware"))
public abstract class XFRecordingFace {
  public static func Status() -> String { return "{\"valid\":true,\"coverage\":\"script_ApplyFeature_and_bridge_face; native_writers_and_evaluated_output_unavailable\",\"prepared_meaning\":\"attitude_and_immortality_only\"}"; }
  public static func Body(obj: ref<GameObject>) -> String {
    let registry = XFNpcRegistry.Get();
    let who = "";
    let prepared = "null";
    if IsDefined(registry) && IsDefined(obj) {
      for entry in registry.Entries() {
        if Equals(entry.id, obj.GetEntityID()) {
          who = entry.who;
          prepared = Equals(entry.kind, "actor") ? XFJson.Flag(entry.prepared) : "null";
        }
      }
    }
    return "\"entity\":" + XFJson.Str(XFRecordingTap.Entity(obj)) + ",\"who\":" + XFJson.Str(who)
      + ",\"attitude_prepared\":" + prepared + ",\"prepared_meaning\":\"attitude_and_immortality_only\",\"evaluated_face\":null";
  }
}

@if(ModuleExists("Codeware"))
@wrapMethod(AnimationControllerComponent)
public final static func ApplyFeature(obj: ref<GameObject>, inputName: CName, value: ref<AnimFeature>, opt delay: Float) -> Void {
  if XFRecordingTap.On("face") && Equals(inputName, n"FacialReaction") {
    let face = value as AnimFeature_FacialReaction;
    if IsDefined(face) {
      XFRecordingTap.Emit("face", face.category == 0 ? "face.reset_submitted" : "face.submitted",
        XFRecordingFace.Body(obj) + ",\"source\":\"script.AnimationControllerComponent.ApplyFeature\",\"category\":" + IntToString(face.category)
        + ",\"idle\":" + IntToString(face.idle) + ",\"delay_s\":" + XFJson.Num(delay));
    }
  }
  wrappedMethod(obj, inputName, value, delay);
}

// U: read the current widgets through their existing owners, without refreshing HUD frames or changing layout.
@if(ModuleExists("Codeware"))
public abstract class XFRecordingUi {
  public static func Rect(widget: ref<inkWidget>) -> String {
    if !IsDefined(widget) { return "null"; }
    let rect = GetScreenPosition(widget);
    return "[" + XFJson.Num(rect.Left) + "," + XFJson.Num(rect.Top) + "," + XFJson.Num(rect.Right) + "," + XFJson.Num(rect.Bottom) + "]";
  }
  public static func Text(widget: ref<inkText>) -> String {
    if !IsDefined(widget) { return "null"; }
    let text = widget.GetText();
    let letterCase = widget.GetLetterCase();
    let display = Equals(letterCase, textLetterCase.UpperCase) ? StrUpper(text) : Equals(letterCase, textLetterCase.LowerCase) ? StrLower(text) : text;
    return "{\"text\":" + XFJson.Str(text) + ",\"display_text\":" + XFJson.Str(display)
      + ",\"letter_case\":" + XFJson.Str(EnumValueToString("textLetterCase", Cast<Int64>(EnumInt(letterCase))))
      + ",\"visible\":" + XFJson.Flag(widget.IsVisible()) + ",\"rect\":" + XFRecordingUi.Rect(widget) + "}";
  }
  public static func Sample() -> String {
    let overlay = XFInkOverlay.Get();
    let photo = XFPhotoMenuPanel.Current();
    return "{\"valid\":true,\"geometry\":\"GetScreenPosition_draw_bounds_candidate\",\"context_found\":null,\"pixel_rect\":null,\"window_to_output_valid\":false,\"coordinate_space\":\"owning_ink_window\",\"clip_rect\":null,\"pointer_hit_target\":null,\"hud\":"
      + (IsDefined(overlay) ? overlay.XFRecordingUi() : "null") + ",\"photo\":" + (IsDefined(photo) ? photo.XFRecordingUi() : "null")
      + ",\"outfits\":" + XFRecordingUi.Outfits() + "}";
  }
  public static func Outfits() -> String {
    let player = XFInventory.Player();
    let data = IsDefined(player) ? XFWardrobe.Data(player) : null;
    if !IsDefined(data) { return "null"; }
    let out = "";
    for area in XFWardrobe.Areas() {
      let item = XFWardrobe.OutfitItem(data, area);
      out += (StrLen(out) > 0 ? "," : "") + "{\"area\":" + XFJson.Str(XFInventory.AreaName(area)) + ",\"shows\":" + XFJson.Str(XFWardrobe.Shows(data, area))
        + ",\"record\":" + XFJson.Str(XFInventory.ItemName(item)) + XFInventory.IdField(item) + "}";
    }
    return "[" + out + "]";
  }
}
@if(!ModuleExists("Codeware"))
public abstract class XFRecordingUi {
  public static func Sample() -> String { return "{\"valid\":false,\"reason\":\"codeware_missing\"}"; }
}

@if(!ModuleExists("Codeware"))
public abstract class XFRecordingFace {
  public static func Status() -> String { return "{\"valid\":false,\"reason\":\"codeware_missing\"}"; }
}
