module XFRuntimeBridge

// One death/defeat/status/combat wrapper per target. Optional old consumers are fan-outs, not nested wraps.
public abstract class XFWorldHooks {
  @if(ModuleExists("XFRuntimeBridge.Probes"))
  public static func Probe(kind: String, fields: String) -> Void { XFProbeOut.Emit(kind, fields); }
  @if(!ModuleExists("XFRuntimeBridge.Probes"))
  public static func Probe(kind: String, fields: String) -> Void {}
  @if(ModuleExists("XFRuntimeBridge.Autonomous"))
  public static func Incident(victim: ref<ScriptedPuppet>, instigator: ref<GameObject>, token: String) -> Void {
    if XFIncidentTap.On() { XFIncidentTap.Death(victim, instigator, token); }
  }
  @if(!ModuleExists("XFRuntimeBridge.Autonomous"))
  public static func Incident(victim: ref<ScriptedPuppet>, instigator: ref<GameObject>, token: String) -> Void {}
  @if(ModuleExists("XFRuntimeBridge.Probes"))
  public static func ProbeDeath(victim: ref<ScriptedPuppet>, instigator: ref<GameObject>) -> Void {
    if XFProbeOut.On() && XFBridge_Live() {

      let byV = IsDefined(instigator) && IsDefined(instigator as PlayerPuppet);
      let victimID = victim.GetEntityID();
      let recordID = victim.GetRecordID();
      let crowd = victim.IsCrowd();
      let civilian = victim.IsCharacterCivilian();
      let instigatorID = IsDefined(instigator) ? XFProbeOut.Id(instigator.GetEntityID()) : "";
      XFProbeOut.Emit("death", "\"victim\":" + XFJson.Str(XFProbeOut.Id(victimID)) + ",\"record\":" + XFJson.Str(TDBID.ToStringDEBUG(recordID))
        + ",\"crowd\":" + XFJson.Flag(crowd) + ",\"civilian\":" + XFJson.Flag(civilian) + ",\"attitude\":" + XFJson.Str(XFProbeOut.Attitude(victim)) + ",\"by_v\":" + XFJson.Flag(byV)
        + ",\"instigator\":" + XFJson.Str(instigatorID));
    }
  }
  @if(!ModuleExists("XFRuntimeBridge.Probes"))
  public static func ProbeDeath(victim: ref<ScriptedPuppet>, instigator: ref<GameObject>) -> Void {}
  @if(ModuleExists("XFRuntimeBridge.Probes"))
  public static func ProbeDefeat(victim: ref<ScriptedPuppet>) -> Void {
    if XFProbeOut.On() && XFBridge_Live() {
      let victimID = victim.GetEntityID();
      let recordID = victim.GetRecordID();
      let crowd = victim.IsCrowd();
      let civilian = victim.IsCharacterCivilian();
      XFProbeOut.Emit("defeated", "\"victim\":" + XFJson.Str(XFProbeOut.Id(victimID)) + ",\"record\":" + XFJson.Str(TDBID.ToStringDEBUG(recordID))
        + ",\"crowd\":" + XFJson.Flag(crowd) + ",\"civilian\":" + XFJson.Flag(civilian) + ",\"attitude\":" + XFJson.Str(XFProbeOut.Attitude(victim)));
    }
  }
  @if(!ModuleExists("XFRuntimeBridge.Probes"))
  public static func ProbeDefeat(victim: ref<ScriptedPuppet>) -> Void {}
  @if(ModuleExists("XFRuntimeBridge.Probes"))
  public static func ProbeStatus(victim: ref<ScriptedPuppet>, evt: ref<ApplyStatusEffectEvent>) -> Void {
    if XFProbeOut.On() && IsDefined(evt) {
      let probe = XFProbeOut.Probe();
      if IsDefined(probe) {
        probe.CountStatus();
      }
      if evt.isNewApplication && IsDefined(evt.staticData) && IsDefined(evt.staticData.StatusEffectType())
        && Equals(evt.staticData.StatusEffectType().Type(), gamedataStatusEffectType.Knockdown) {
        let victimID = victim.GetEntityID();
        XFProbeOut.Emit("knockdown", "\"victim\":" + XFJson.Str(XFProbeOut.Id(victimID)) + ",\"instigator\":" + XFJson.Str(XFProbeOut.Id(evt.instigatorEntityID)));
      }
    }
  }
  @if(!ModuleExists("XFRuntimeBridge.Probes"))
  public static func ProbeStatus(victim: ref<ScriptedPuppet>, evt: ref<ApplyStatusEffectEvent>) -> Void {}

  public static func Death(victim: ref<ScriptedPuppet>, instigator: ref<GameObject>, what: String) -> Void {
    let on = XFWorldOut.On() && XFBridge_Live();
    let token = "";
    if on {
      let feed = XFWorldOut.System();
      if IsDefined(feed) { token = feed.Token(); }
    }
    // The incident ingress returns a receipt carrying exactly this token, so there is no time/victim heuristic join.
    XFWorldHooks.Incident(victim, instigator, token);
    if Equals(what, "death") { XFWorldHooks.ProbeDeath(victim, instigator); } else { XFWorldHooks.ProbeDefeat(victim); }
    if !on { return; }
    let crowd = victim.IsCrowd();
    let civilian = victim.IsCharacterCivilian();
    let byV = IsDefined(instigator as PlayerPuppet);
    let at = victim.GetWorldPosition();
    let record = victim.GetRecordID();
    XFWorldOut.Emit("death", "\"what\":" + XFJson.Str(what) + ",\"victim\":" + XFWorldOut.Id(victim) + ",\"record\":" + XFJson.Str(TDBID.ToStringDEBUG(record))
      + ",\"crowd\":" + XFJson.Flag(crowd) + ",\"civilian\":" + XFJson.Flag(civilian) + ",\"by_v\":" + XFJson.Flag(byV)
      + ",\"instigator\":" + XFWorldOut.Id(instigator) + ",\"pos\":[" + XFJson.Num(at.X) + "," + XFJson.Num(at.Y) + "," + XFJson.Num(at.Z) + "]"
      + ",\"incident_token\":" + XFJson.Str(token));
  }
}
@wrapMethod(ScriptedPuppet)
protected cb func OnDeath(evt: ref<gameDeathEvent>) -> Bool {
  let result = wrappedMethod(evt);
  XFWorldHooks.Death(this, IsDefined(evt) ? evt.instigator as GameObject : null, "death");
  return result;
}
@wrapMethod(ScriptedPuppet)
protected cb func OnDefeated(evt: ref<DefeatedEvent>) -> Bool {
  let result = wrappedMethod(evt);
  // Preserve incidents' killer lookup only when one of the consumers needs it.
  if XFBridge_Live() && (XFWorldOut.On() || (XFBridge_ProbeFlags() & 16) != 0) { XFWorldHooks.Death(this, this.GetKiller() as GameObject, "defeated"); }
  else { XFWorldHooks.ProbeDefeat(this); }
  return result;
}
@wrapMethod(ScriptedPuppet)
protected cb func OnStatusEffectApplied(evt: ref<ApplyStatusEffectEvent>) -> Bool {
  let result = wrappedMethod(evt);
  XFWorldHooks.ProbeStatus(this, evt);
  if XFWorldOut.On() && XFBridge_Live() && IsDefined(evt) && evt.isNewApplication && IsDefined(evt.staticData) {
    let type = evt.staticData.StatusEffectType();
    if IsDefined(type) && Equals(type.Type(), gamedataStatusEffectType.Knockdown) {
      XFWorldOut.Emit("death", "\"what\":\"knockdown\",\"victim\":" + XFWorldOut.Id(this) + ",\"instigator\":" + XFJson.Str(EntityID.ToDebugStringDecimal(evt.instigatorEntityID)));
    }
  }
  return result;
}
@wrapMethod(PlayerPuppet)
protected cb func OnCombatStateChanged(newState: Int32) -> Bool {
  let result = wrappedMethod(newState);
  let fields = "\"state\":" + IntToString(newState);
  XFWorldHooks.Probe("combat", fields);
  if XFBridge_Live() { XFWorldOut.Emit("combat", fields); }
  return result;
}
