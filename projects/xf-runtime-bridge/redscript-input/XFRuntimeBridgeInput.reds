// Autonomous -writes candidate only. Known consumers, never a fabricated ListenerAction.
module XFRuntimeBridge

public abstract class XFInputActions {
  public static func ObserveChoices(cid: String) -> String {
    if !XFBridge_Live() { return XFJson.Fail("game_loading", "Wait for the live session"); }
    let observer = GameInstance.GetScriptableSystemsContainer(GetGameInstance()).Get(n"XFRuntimeBridge.XFChoiceObserver") as XFChoiceObserver;
    if IsDefined(observer) { observer.Seed(); }
    return "{\"ok\":true}";
  }
  public static func Context(cid: String) -> String {
    if !XFBridge_Live() { return XFJson.Fail("game_loading", "Wait for the live session"); }
    return "{\"ok\":true,\"phase\":" + XFJson.Str(XFBridgeActions.Phase()) + "}";
  }

  public static func HubState(cid: String) -> String {
    if !XFBridge_Live() { return XFJson.Fail("game_loading", "Wait for the live session"); }
    let registry = XFNpcRegistry.Get();
    if !IsDefined(registry) { return XFJson.Fail("choice_changed", "No XF hub is active"); }
    let hub = registry.Hub();
    return "{\"ok\":true,\"id\":" + IntToString(hub.id) + ",\"generation\":" + IntToString(registry.HubGeneration()) + ",\"index\":" + IntToString(registry.HubIndex()) + ",\"count\":" + IntToString(ArraySize(hub.choices)) + ",\"shown\":" + XFJson.Flag(registry.HubShown()) + ",\"busy\":" + XFJson.Flag(XFNpcHub.GameBusy()) + "}";
  }

  public static func ChoiceStep(cid: String, id: Int32, generation: Int32, index: Int32, apply: Bool) -> String {
    if !XFBridge_Live() || (XFBridge_ProbeFlags() & 8) == 0 { return XFJson.Fail("test_hooks_off", "The autonomous fixture is off"); }
    let registry = XFNpcRegistry.Get();
    if !IsDefined(registry) || !registry.HubShown() { return XFJson.Fail("choice_changed", "The XF hub is no longer shown"); }
    let hub = registry.Hub();
    if hub.id != id || registry.HubGeneration() != generation || index < 0 || index >= ArraySize(hub.choices) { return XFJson.Fail("stale_context", "The expected XF choices changed"); }
    if XFNpcHub.GameBusy() { return XFJson.Fail("choices_busy", "The game's own input takes priority"); }
    let now = EngineTime.ToFloat(GameInstance.GetEngineTime(GetGameInstance()));
    if now == registry.LastInputAt() { return "{\"ok\":true,\"applied\":false,\"deferred\":true}"; }
    let action = n"ChoiceScrollDown";
    if apply {
      if registry.HubIndex() != index { return XFJson.Fail("choice_changed", "The highlight changed before apply"); }
      action = n"ChoiceApply";
    }
    let handled = XFNpcHub.OnChoiceAction(action, gameinputActionType.BUTTON_PRESSED);
    return "{\"ok\":true,\"handled\":" + XFJson.Flag(handled) + ",\"applied\":" + XFJson.Flag(apply && handled && registry.HubAnswer() == index) + "}";
  }

  public static func PhotoState(cid: String) -> String {
    if !XFBridge_Live() { return XFJson.Fail("game_loading", "Wait for the live session"); }
    let controller = XFPhoto.Controller();
    if !IsDefined(controller) { return "{\"ok\":true,\"shown\":false,\"generation\":0}"; }
    return controller.XFBridgeInputPhotoState();
  }

  @if(ModuleExists("Codeware"))
  public static func PhotoExitAttempt(cid: String, generation: Int32) -> String {
    if !XFBridge_Live() || (XFBridge_ProbeFlags() & 8) == 0 { return XFJson.Fail("test_hooks_off", "The autonomous fixture is off"); }
    let controller = XFPhoto.Controller();
    if !IsDefined(controller) || !controller.XFBridgeInputPhotoReady(generation) { return XFJson.Fail("stale_context", "Read the currently shown photo controller first"); }
    GameInstance.GetUISystem(GetGameInstance()).QueueEvent(new TryExitPhotomodeEvent());
    return "{\"ok\":true,\"submitted\":true,\"coverage\":\"native_exit_event\"}";
  }

  @if(!ModuleExists("Codeware"))
  public static func PhotoExitAttempt(cid: String, generation: Int32) -> String {
    return XFJson.Fail("codeware_missing", "This test needs Codeware's native photo exit event import");
  }

  // Comparison control: calls the public shim, which enters the normal wrapped callback.
  public static func PhotoExitControl(cid: String, generation: Int32) -> String {
    if !XFBridge_Live() || (XFBridge_ProbeFlags() & 8) == 0 { return XFJson.Fail("test_hooks_off", "The autonomous fixture is off"); }
    let controller = XFPhoto.Controller();
    if !IsDefined(controller) || !controller.XFBridgeInputPhotoReady(generation) { return XFJson.Fail("stale_context", "Read the currently shown photo controller first"); }
    controller.XFBridgeInputPhotoControl();
    return "{\"ok\":true,\"submitted\":true,\"coverage\":\"consumer_callback\"}";
  }
}

@addMethod(gameuiPhotoModeMenuController)
public func XFBridgeInputPhotoControl() -> Void {
  this.OnTryExitPhotomode();
}

// Immediate notifications. Seed offers, NEVER the retained LastAttemptedChoice.
public class XFChoiceObserver extends ScriptableSystem {
  private let m_board: ref<IBlackboard>;
  private let m_offer: ref<CallbackHandle>;
  private let m_active: ref<CallbackHandle>;
  private let m_index: ref<CallbackHandle>;
  private let m_attempt: ref<CallbackHandle>;
  private let m_generation: Int32;

  public func Seed() -> Void {
    if XFBridge_Live() && IsDefined(this.m_board) {
      this.OnXFOffer(this.m_board.GetVariant(GetAllBlackboardDefs().UIInteractions.DialogChoiceHubs));
    }
  }

  private func OnPlayerAttach(request: ref<PlayerAttachRequest>) -> Void {
    if (XFBridge_ProbeFlags() & 8) == 0 || IsDefined(this.m_board) { return; }
    let defs = GetAllBlackboardDefs().UIInteractions;
    this.m_board = GameInstance.GetBlackboardSystem(this.GetGameInstance()).Get(defs);
    if !IsDefined(this.m_board) { return; }
    this.m_offer = this.m_board.RegisterListenerVariant(defs.DialogChoiceHubs, this, n"OnXFOffer");
    this.m_active = this.m_board.RegisterListenerInt(defs.ActiveChoiceHubID, this, n"OnXFActive");
    this.m_index = this.m_board.RegisterListenerInt(defs.SelectedIndex, this, n"OnXFIndex");
    this.m_attempt = this.m_board.RegisterListenerVariant(defs.LastAttemptedChoice, this, n"OnXFAttempt");
    this.OnXFOffer(this.m_board.GetVariant(defs.DialogChoiceHubs));
  }

  private func OnDetach() -> Void {
    // Listener removal uses only the board we registered on, as in the existing probe's teardown.
    if IsDefined(this.m_board) {
      let defs = GetAllBlackboardDefs().UIInteractions;
      this.m_board.UnregisterListenerVariant(defs.DialogChoiceHubs, this.m_offer);
      this.m_board.UnregisterListenerInt(defs.ActiveChoiceHubID, this.m_active);
      this.m_board.UnregisterListenerInt(defs.SelectedIndex, this.m_index);
      this.m_board.UnregisterListenerVariant(defs.LastAttemptedChoice, this.m_attempt);
      this.m_board = null;
    }
  }

  protected cb func OnXFOffer(value: Variant) -> Bool {
    if !XFBridge_Live() || (XFBridge_ProbeFlags() & 8) == 0 { return false; }
    this.m_generation += 1;
    let data = FromVariant<DialogChoiceHubs>(value);
    let out = "";
    let count = 0;
    let truncated = ArraySize(data.choiceHubs) > 2;
    for hub in data.choiceHubs {
      if count >= 2 { break; }
      let choices = "";
      let lines = 0;
      truncated = truncated || ArraySize(hub.choices) > 8;
      for choice in hub.choices {
        if lines >= 8 { break; }
        truncated = truncated || StrLen(choice.localizedName) > 40;
        choices += (StrLen(choices) > 0 ? "," : "") + XFJson.Str(StrMid(choice.localizedName, 0, 40));
        lines += 1;
      }
      out += (StrLen(out) > 0 ? "," : "") + "{\"ok\":true,\"id\":" + IntToString(hub.id) + ",\"choices\":[" + choices + "]}";
      count += 1;
    }
    // [source] Seed current highlight along with the offer; never seed LastAttemptedChoice.
    // Eligibility/dedicated-action semantics are uncommissioned: do not publish input_eligible.
    let defs = GetAllBlackboardDefs().UIInteractions;
    XFBridge_Event("choice.offer", "{\"generation\":" + IntToString(this.m_generation) + ",\"active_hub\":" + IntToString(this.m_board.GetInt(defs.ActiveChoiceHubID)) + ",\"index\":" + IntToString(this.m_board.GetInt(defs.SelectedIndex)) + ",\"truncated\":" + XFJson.Flag(truncated) + ",\"hubs\":[" + out + "]}");
  }
  protected cb func OnXFActive(value: Int32) -> Bool {
    if XFBridge_Live() { XFBridge_Event("choice.selection", "{\"ok\":true,\"active_hub\":" + IntToString(value) + "}"); }
  }
  protected cb func OnXFIndex(value: Int32) -> Bool {
    if XFBridge_Live() { XFBridge_Event("choice.selection", "{\"ok\":true,\"index\":" + IntToString(value) + "}"); }
  }
  protected cb func OnXFAttempt(value: Variant) -> Bool {
    if !XFBridge_Live() || (XFBridge_ProbeFlags() & 8) == 0 || !IsDefined(this.m_board) { return false; }
    let attempt = FromVariant<InteractionAttemptedChoice>(value);
    let defs = GetAllBlackboardDefs().UIInteractions;
    XFBridge_Event("choice.attempt", "{\"ok\":true,\"success\":" + XFJson.Flag(attempt.isSuccess) + ",\"dialog\":" + XFJson.Flag(Equals(attempt.visualizerType, EVisualizerType.Dialog)) + ",\"index\":" + IntToString(attempt.choiceIdx) + ",\"caption\":" + XFJson.Str(StrMid(attempt.choice.caption, 0, 40)) + ",\"active_hub\":" + IntToString(this.m_board.GetInt(defs.ActiveChoiceHubID)) + ",\"generation\":" + IntToString(this.m_generation) + "}");
  }
}
