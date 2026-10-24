module XFRuntimeBridge

// Autonomous -writes only. Called on the game thread behind ScriptCall's live guard.
// No NPC poll: its hub refresh changes state. These reads resolve each selected puppet afresh.
public abstract class XFRecording {
  public static func Sample(cid: String, channel: String, whos: String) -> String {
    if !XFBridge_Live() { return XFJson.Fail("game_loading", "Recorder live gate closed"); }
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
