// XF Runtime Bridge: redscript layer.
//
// Proves: native calls from script (XFBridge_*), a ScriptableSystem lifecycle, a @wrapMethod
// and an @addMethod on PlayerPuppet, reading a TweakXL-provided TweakDB flat, and a read-only
// query that the native layer calls back into (XFBridgeQuery.DescribeJson, bridge method
// `script.describe`). Every log line goes through XFBridge_Log into the plugin's RED4ext log,
// tagged layer=redscript, so all layers share one correlated file.
//
// Only APIs already used by published mods in the reference clones appear here (see the
// design page for citations); the file is linted against the game's own script bundle.

module XFRuntimeBridge

public abstract class XFBridgeLog {
  public static func Info(cid: String, message: String) -> Void {
    XFBridge_Log("redscript", "info", cid, message);
  }

  public static func Debug(cid: String, message: String) -> Void {
    XFBridge_Log("redscript", "debug", cid, message);
  }

  public static func Warn(cid: String, message: String) -> Void {
    XFBridge_Log("redscript", "warn", cid, message);
  }
}

public abstract class XFBridgeQuery {
  // TweakXL data layer marker: r6/tweaks/XFRuntimeBridge/xf_runtime_bridge.yaml sets it to 1.
  // -1 means the flat is absent (TweakXL missing or the YAML not loaded).
  public static func TweakMarker() -> Int32 {
    return TweakDBInterface.GetInt(t"XFRuntimeBridge.Meta.protocolVersion", -1);
  }

  // Read-only snapshot for the bridge method `script.describe`. Called by the native layer on
  // the game thread with the request's correlation id.
  public static func DescribeJson(cid: String) -> String {
    let game = GetGameInstance();
    let player = GameInstance.GetPlayerSystem(game).GetLocalPlayerMainGameObject();
    let hasPlayer = IsDefined(player);
    let marker = XFBridgeQuery.TweakMarker();
    XFBridgeLog.Info(cid, s"DescribeJson has_player=\(hasPlayer) tweak_marker=\(marker)");

    let position = "null";
    if hasPlayer {
      let pos = player.GetWorldPosition();
      position = s"[\(FloatToString(pos.X)),\(FloatToString(pos.Y)),\(FloatToString(pos.Z))]";
    }
    return s"{\"layer\":\"redscript\",\"cid\":\"\(cid)\",\"has_player\":\(hasPlayer),\"tweak_marker\":\(marker),\"position\":\(position)}";
  }
}

// Lifecycle logging. Scriptable systems are created by the game per session; OnAttach runs
// when the game instance attaches the system, OnPlayerAttach when the player puppet attaches.
public class XFBridgeSystem extends ScriptableSystem {
  private let m_playerAttachCount: Int32;

  private func OnAttach() -> Void {
    XFBridgeLog.Info("rs-attach", "XFBridgeSystem.OnAttach");
    let reply = XFBridge_Ping("redscript", "rs-attach");
    XFBridgeLog.Debug("rs-attach", s"native ping reply: \(reply)");
    let marker = XFBridgeQuery.TweakMarker();
    XFBridge_Announce("redscript", s"system attached; tweak_marker=\(marker)");
    if marker < 0 {
      XFBridgeLog.Warn("rs-attach", "TweakDB flat XFRuntimeBridge.Meta.protocolVersion missing (TweakXL data not loaded)");
    } else {
      XFBridge_Announce("tweakxl", s"XFRuntimeBridge.Meta.protocolVersion=\(marker)");
    }
  }

  private func OnDetach() -> Void {
    XFBridgeLog.Info("rs-detach", "XFBridgeSystem.OnDetach");
  }

  private func OnPlayerAttach(request: ref<PlayerAttachRequest>) -> Void {
    this.m_playerAttachCount += 1;
    XFBridgeLog.Info("rs-player", s"XFBridgeSystem.OnPlayerAttach count=\(this.m_playerAttachCount)");
  }

  public static func GetInstance(game: GameInstance) -> ref<XFBridgeSystem> {
    return GameInstance.GetScriptableSystemsContainer(game).Get(n"XFRuntimeBridge.XFBridgeSystem") as XFBridgeSystem;
  }
}

// @addMethod example: a harmless read-only helper on the player.
@addMethod(PlayerPuppet)
public func XFBridgeDescribe() -> String {
  let pos = this.GetWorldPosition();
  return s"replacer=\(this.IsReplacer()) x=\(FloatToString(pos.X)) y=\(FloatToString(pos.Y)) z=\(FloatToString(pos.Z))";
}

// @wrapMethod example: log each time a player puppet attaches, then defer to the game.
// Same wrap target and signature as Let There Be Flight and Cyberware-EX.
@wrapMethod(PlayerPuppet)
protected cb func OnGameAttached() -> Bool {
  let result = wrappedMethod();
  XFBridgeLog.Info("rs-player", s"PlayerPuppet.OnGameAttached \(this.XFBridgeDescribe())");
  return result;
}
