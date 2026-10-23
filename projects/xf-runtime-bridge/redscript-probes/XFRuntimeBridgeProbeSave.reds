// XF Runtime Bridge 0.8.7, a TEST PROBE (the -writes package only; [bridge] allow_test_hooks): the save-identity probe of
// knowledge/save-identity.md's session card, log-only apart from its own test facts. It records each lifecycle point of a
// load and a save as a "session" record in the probe's ring (test.events): the game's OnGameRestored, Codeware's Session/*
// events, PlayerPuppet.OnGameAttached and OnTakeControl, and the bridge's OnPlayerAttach, each with the values of the test
// facts read there. test.save.identity writes and reads the test facts, all named xfs_probe_* so they can't be mistaken for
// the real save key: xfs_probe_a and xfs_probe_b (the page's fact pair) and the pin's five, xfs_probe_sk_c0, _c1, _b, _n and
// _k (the page's xfs_sk_* under the probe's prefix). Armed by test.save.identity {arm_before_save: true}, the Session/
// BeforeSave handler writes a fresh xfs_probe_b before each save (row 4). A delete in the Load menu is recorded too (row 9).
// Comes out, or moves into XF Lab, when XF Core's tracks C1 to C3 land (research/runtime/runtime-bridge-design.md §3.15).

module XFRuntimeBridge

public abstract class XFProbeSave {
  public static func Facts() -> String {
    let quests = GameInstance.GetQuestsSystem(GetGameInstance());
    if !IsDefined(quests) {
      return "\"facts\":null";
    }
    return "\"facts\":{\"a\":" + IntToString(quests.GetFact(n"xfs_probe_a")) + ",\"b\":" + IntToString(quests.GetFact(n"xfs_probe_b"))
      + ",\"sk_c0\":" + IntToString(quests.GetFact(n"xfs_probe_sk_c0")) + ",\"sk_c1\":" + IntToString(quests.GetFact(n"xfs_probe_sk_c1"))
      + ",\"sk_b\":" + IntToString(quests.GetFact(n"xfs_probe_sk_b")) + ",\"sk_n\":" + IntToString(quests.GetFact(n"xfs_probe_sk_n"))
      + ",\"sk_k\":" + IntToString(quests.GetFact(n"xfs_probe_sk_k")) + "}";
  }

  public static func Point(point: String, extra: String) -> Void {
    XFProbeOut.Emit("session", "\"point\":" + XFJson.Str(point) + "," + XFProbeSave.Facts() + extra);
  }

  // The plugin's test.save.identity (game thread; cid first, as every script entry the plugin calls). what: 1 set a, 2 set b,
  // 4 set the pin (c0, c1, br, n and the check k the plugin worked out), 8 clear the pin and the pair. Answers the facts after.
  public static func SaveIdentity(cid: String, what: Int32, a: Int32, b: Int32, c0: Int32, c1: Int32, br: Int32, n: Int32, k: Int32) -> String {
    let quests = GameInstance.GetQuestsSystem(GetGameInstance());
    if !IsDefined(quests) {
      return "{\"ok\":false,\"code\":\"game_not_ready\",\"message\":\"the quests system isn't there\"}";
    }
    if (what & 8) != 0 {
      quests.SetFact(n"xfs_probe_a", 0);
      quests.SetFact(n"xfs_probe_b", 0);
      quests.SetFact(n"xfs_probe_sk_c0", 0);
      quests.SetFact(n"xfs_probe_sk_c1", 0);
      quests.SetFact(n"xfs_probe_sk_b", 0);
      quests.SetFact(n"xfs_probe_sk_n", 0);
      quests.SetFact(n"xfs_probe_sk_k", 0);
    }
    if (what & 1) != 0 {
      quests.SetFact(n"xfs_probe_a", a);
    }
    if (what & 2) != 0 {
      quests.SetFact(n"xfs_probe_b", b);
    }
    if (what & 4) != 0 {
      // The check last, as the page's commit rule writes it.
      quests.SetFact(n"xfs_probe_sk_c0", c0);
      quests.SetFact(n"xfs_probe_sk_c1", c1);
      quests.SetFact(n"xfs_probe_sk_b", br);
      quests.SetFact(n"xfs_probe_sk_n", n);
      quests.SetFact(n"xfs_probe_sk_k", k);
    }
    if what != 0 {
      XFProbeSave.Point("written", ",\"what\":" + IntToString(what));
    }
    return "{\"ok\":true," + XFProbeSave.Facts() + "}";
  }
}

// ---- lifecycle points ------------------------------------------------------------------------------------------------------

@wrapMethod(PlayerSystem)
protected final cb func OnGameRestored() -> Bool {
  let result = wrappedMethod();
  XFProbeSave.Point("game_restored", "");
  return result;
}

@wrapMethod(PlayerPuppet)
protected cb func OnGameAttached() -> Bool {
  let result = wrappedMethod();
  if this.IsControlledByLocalPeer() || this.IsPlayer() {
    XFProbeSave.Point("game_attached", "");
  }
  return result;
}

@wrapMethod(PlayerPuppet)
protected cb func OnTakeControl(ri: EntityResolveComponentsInterface) -> Bool {
  let result = wrappedMethod(ri);
  XFProbeSave.Point("take_control", "");
  return result;
}

// The bridge's own script gate opening (its ScriptableSystem's OnPlayerAttach), seen from a probe system of its own.
public class XFProbeSaveSystem extends ScriptableSystem {
  private func OnPlayerAttach(request: ref<PlayerAttachRequest>) -> Void {
    XFProbeSave.Point("player_attach", "");
  }

  private func OnDetach() -> Void {
    XFProbeSave.Point("detach", "");
  }
}

// Codeware's session events, with restored and pre_game; BeforeSave writes a fresh xfs_probe_b when armed.
@if(ModuleExists("Codeware"))
public class XFProbeSessionService extends ScriptableService {
  private cb func OnLoad() {
    let callbacks = GameInstance.GetCallbackSystem();
    callbacks.RegisterCallback(n"Session/BeforeStart", this, n"OnXFSession");
    callbacks.RegisterCallback(n"Session/Start", this, n"OnXFSession");
    callbacks.RegisterCallback(n"Session/Ready", this, n"OnXFSession");
    callbacks.RegisterCallback(n"Session/BeforeSave", this, n"OnXFBeforeSave");
    callbacks.RegisterCallback(n"Session/AfterSave", this, n"OnXFSession");
    callbacks.RegisterCallback(n"Session/BeforeEnd", this, n"OnXFSession");
    callbacks.RegisterCallback(n"Session/End", this, n"OnXFSession");
  }

  private cb func OnXFSession(event: ref<GameSessionEvent>) {
    let name = NameToString(event.GetEventName());
    // Session/BeforeStart and Start come before the game's systems run, so only what needs no game is read there.
    if Equals(name, "Session/BeforeStart") || Equals(name, "Session/End") {
      XFProbeOut.Emit("session", "\"point\":" + XFJson.Str(name) + ",\"restored\":" + XFJson.Flag(event.IsRestored()) + ",\"pre_game\":" + XFJson.Flag(event.IsPreGame()));
      return;
    }
    XFProbeSave.Point(name, ",\"restored\":" + XFJson.Flag(event.IsRestored()) + ",\"pre_game\":" + XFJson.Flag(event.IsPreGame()));
  }

  private cb func OnXFBeforeSave(event: ref<GameSessionEvent>) {
    let written = -1;
    if (XFBridge_ProbeFlags() & 4) != 0 {
      let quests = GameInstance.GetQuestsSystem(GetGameInstance());
      if IsDefined(quests) {
        written = RandRange(1000, 2000000000);
        quests.SetFact(n"xfs_probe_b", written);
      }
    }
    XFProbeSave.Point("Session/BeforeSave", ",\"b_written\":" + IntToString(written));
  }
}

// ---- a delete in the Load menu (row 9) --------------------------------------------------------------------------------------

@wrapMethod(LoadGameMenuGameController)
protected cb func OnRelease(e: ref<inkPointerEvent>) -> Bool {
  if IsDefined(e) && e.IsAction(n"delete_save") {
    let target = e.GetCurrentTarget();
    let item = IsDefined(target) ? target.GetController() as LoadListItem : null;
    XFProbeOut.Emit("session", "\"point\":\"load_menu_delete\",\"index\":" + IntToString(IsDefined(item) ? item.Index() : -1));
  }
  return wrappedMethod(e);
}
