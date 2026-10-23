// XF Runtime Bridge 0.8.7, a TEST PROBE (the -writes package only; [bridge] allow_test_hooks): the game-events probe of
// knowledge/game-events.md §12, log-only. Each hook writes one record through XFBridge_Event into the probe's own ring
// (test.events), apart from the session's 1,000-entry ring, so a firefight can't evict an answer; the plugin's rate guard
// drops and counts what goes over 20 a second per kind. The noisy hooks (status effects on every puppet, the stim tap) are
// counted and reported every 5 s instead of one record each. Nothing here changes the game: every wrap calls the game's own
// method first and unchanged, and the listeners only read. Ids, never names: entity ids as decimal strings, records as
// TweakDB ids, districts as enum names; no dialogue, journal or message text (it is the game's writing, and spoils it).
// Comes out, or moves into XF Lab, when XF Core's tracks C1 to C3 land (research/runtime/runtime-bridge-design.md §3.15).

module XFRuntimeBridge

// The probe's records: kind and a JSON object.
public abstract class XFProbeOut {
  public static func On() -> Bool {
    return (XFBridge_ProbeFlags() & 1) != 0;
  }

  public static func Stims() -> Bool {
    return (XFBridge_ProbeFlags() & 2) != 0;
  }

  // 0.8.9 (session 15: a hostile stand-in's death came with civilian true, a reactive civilian clone's class): how the victim
  // stood towards V (EAIAttitude: AIA_Friendly, AIA_Neutral, AIA_Hostile), "" when V isn't there.
  public static func Attitude(puppet: ref<ScriptedPuppet>) -> String {
    let player = GetPlayer(GetGameInstance());
    if !IsDefined(player) || !IsDefined(puppet) {
      return "";
    }
    let attitude = puppet.GetAttitudeTowards(player);
    return EnumValueToString("EAIAttitude", Cast<Int64>(EnumInt(attitude)));
  }

  // 0.8.7 (the Sol review, finding 2): the hooks' switch first, before anything is built; the game's and the simulation's clocks
  // only while the script gate is open (the live guard), else the record says live false and carries only what it was given.
  public static func Emit(kind: String, body: String) -> Void {
    if !XFProbeOut.On() {
      return;
    }
    let stamp = "\"live\":false";
    if XFBridge_Live() {
      let game = GetGameInstance();
      let clock = GameInstance.GetTimeSystem(game);
      let gameTime = IsDefined(clock) ? clock.GetGameTimeStamp() : -1.0;
      let sim = EngineTime.ToFloat(GameInstance.GetSimTime(game));
      stamp = "\"live\":true,\"game_s\":" + XFJson.Num(gameTime) + ",\"sim_s\":" + XFJson.Num(sim);
    }
    XFBridge_Event(kind, "{" + stamp + (StrLen(body) > 0 ? "," + body : "") + "}");
  }

  public static func Id(id: EntityID) -> String {
    return EntityID.ToDebugStringDecimal(id);
  }

  public static func Probe() -> ref<XFEventProbe> {
    let container = GameInstance.GetScriptableSystemsContainer(GetGameInstance());
    return IsDefined(container) ? container.Get(n"XFRuntimeBridge.XFEventProbe") as XFEventProbe : null;
  }
}

// The probe's ScriptableSystem: its listeners from OnPlayerAttach to OnDetach (a listener left on a dead blackboard after a
// load is a crash risk), its polls, and the counters it flushes.
public class XFEventProbe extends ScriptableSystem {
  private let m_on: Bool;
  private let m_wanted: Uint32;
  private let m_chase: Uint32;
  private let m_zone: Uint32;
  private let m_district: ref<CallbackHandle>;
  private let m_hubs: ref<CallbackHandle>;
  private let m_index: ref<CallbackHandle>;
  private let m_call: ref<CallbackHandle>;
  private let m_purchase: ref<CallbackHandle>;
  private let m_lastDistrict: String;
  // 0.8.9 (session 15: dialogue.index took 346 of the ring's 500 records, and a call's phase 1 came twice): only a change
  // is recorded.
  private let m_lastIndex: String;
  private let m_lastCall: String;
  private let m_interior: Int32;
  private let m_lastGame: Float;
  private let m_lastSim: Float;
  private let m_ticks: Int32;
  private let m_poll: ref<XFEventProbePoll>;
  // Counters flushed every 5 s: every status effect applied, and the allow-listed stims by type.
  private let m_statusCount: Int32;
  private let m_stimTypes: array<String>;
  private let m_stimCounts: array<Int32>;

  private func OnPlayerAttach(request: ref<PlayerAttachRequest>) -> Void {
    if this.m_on || !XFProbeOut.On() {
      return;
    }
    let game = this.GetGameInstance();
    let quests = GameInstance.GetQuestsSystem(game);
    this.m_wanted = quests.RegisterListener(n"wanted_level", this, n"OnXFWanted");
    this.m_chase = quests.RegisterListener(n"wanted_chase_active", this, n"OnXFChase");
    this.m_zone = quests.RegisterListener(n"CityAreaType", this, n"OnXFZone");
    let boards = GameInstance.GetBlackboardSystem(game);
    let defs = GetAllBlackboardDefs();
    this.m_district = boards.Get(defs.UI_Map).RegisterListenerString(defs.UI_Map.currentLocationEnumName, this, n"OnXFDistrict");
    this.m_hubs = boards.Get(defs.UIInteractions).RegisterDelayedListenerVariant(defs.UIInteractions.DialogChoiceHubs, this, n"OnXFHubs");
    this.m_index = boards.Get(defs.UIInteractions).RegisterListenerInt(defs.UIInteractions.SelectedIndex, this, n"OnXFIndex");
    this.m_call = boards.Get(defs.UI_ComDevice).RegisterListenerVariant(defs.UI_ComDevice.PhoneCallInformation, this, n"OnXFCall");
    this.m_purchase = boards.Get(defs.VehiclePurchaseData).RegisterListenerVariant(defs.VehiclePurchaseData.PurchasedVehicleRecordID, this, n"OnXFPurchase");
    let journal = GameInstance.GetJournalManager(game);
    journal.RegisterScriptCallback(this, n"OnXFJournal", gameJournalListenerType.State);
    journal.RegisterScriptCallback(this, n"OnXFJournalTracked", gameJournalListenerType.Tracked);
    journal.RegisterScriptCallback(this, n"OnXFJournalUntracked", gameJournalListenerType.Untracked);
    journal.RegisterScriptCallback(this, n"OnXFJournalCounter", gameJournalListenerType.Counter);
    this.m_on = true;
    this.m_interior = -1;
    this.m_lastGame = -1.0;
    this.m_ticks = 0;
    this.m_poll = new XFEventProbePoll();
    this.m_poll.probe = this;
    GameInstance.GetDelaySystem(game).DelayCallback(this.m_poll, 0.5, false);
    if XFBridge_Live() {
      XFProbeOut.Emit("probe", "\"what\":\"attached\",\"wanted_level\":" + IntToString(quests.GetFact(n"wanted_level")) + ",\"wanted_chase_active\":" + IntToString(quests.GetFact(n"wanted_chase_active"))
        + ",\"city_area_type\":" + IntToString(quests.GetFact(n"CityAreaType")));
    } else {
      XFProbeOut.Emit("probe", "\"what\":\"attached\"");
    }
  }

  private func OnDetach() -> Void {
    if !this.m_on {
      return;
    }
    this.m_on = false;
    let game = this.GetGameInstance();
    let quests = GameInstance.GetQuestsSystem(game);
    if IsDefined(quests) {
      quests.UnregisterListener(n"wanted_level", this.m_wanted);
      quests.UnregisterListener(n"wanted_chase_active", this.m_chase);
      quests.UnregisterListener(n"CityAreaType", this.m_zone);
    }
    let boards = GameInstance.GetBlackboardSystem(game);
    let defs = GetAllBlackboardDefs();
    if IsDefined(boards) {
      boards.Get(defs.UI_Map).UnregisterListenerString(defs.UI_Map.currentLocationEnumName, this.m_district);
      boards.Get(defs.UIInteractions).UnregisterDelayedListener(defs.UIInteractions.DialogChoiceHubs, this.m_hubs);
      boards.Get(defs.UIInteractions).UnregisterListenerInt(defs.UIInteractions.SelectedIndex, this.m_index);
      boards.Get(defs.UI_ComDevice).UnregisterListenerVariant(defs.UI_ComDevice.PhoneCallInformation, this.m_call);
      boards.Get(defs.VehiclePurchaseData).UnregisterListenerVariant(defs.VehiclePurchaseData.PurchasedVehicleRecordID, this.m_purchase);
    }
    let journal = GameInstance.GetJournalManager(game);
    if IsDefined(journal) {
      journal.UnregisterScriptCallback(this, n"OnXFJournal");
      journal.UnregisterScriptCallback(this, n"OnXFJournalTracked");
      journal.UnregisterScriptCallback(this, n"OnXFJournalUntracked");
      journal.UnregisterScriptCallback(this, n"OnXFJournalCounter");
    }
    if IsDefined(this.m_poll) {
      this.m_poll.probe = null;
      this.m_poll = null;
    }
  }

  public func IsOn() -> Bool {
    return this.m_on;
  }

  // ---- heat and zone (facts) -----------------------------------------------------------------------------------------------

  protected cb func OnXFWanted(value: Int32) -> Bool {
    XFProbeOut.Emit("heat", "\"fact\":\"wanted_level\",\"value\":" + IntToString(value));
    return false;
  }

  protected cb func OnXFChase(value: Int32) -> Bool {
    XFProbeOut.Emit("heat", "\"fact\":\"wanted_chase_active\",\"value\":" + IntToString(value));
    return false;
  }

  protected cb func OnXFZone(value: Int32) -> Bool {
    XFProbeOut.Emit("zone", "\"fact\":\"CityAreaType\",\"value\":" + IntToString(value));
    return false;
  }

  // ---- blackboards ---------------------------------------------------------------------------------------------------------

  protected cb func OnXFDistrict(value: String) -> Bool {
    let defs = GetAllBlackboardDefs();
    let board = GameInstance.GetBlackboardSystem(this.GetGameInstance()).Get(defs.UI_Map);
    let discovered = board.GetBool(defs.UI_Map.newLocationDiscovered);
    XFProbeOut.Emit("district", "\"name\":" + XFJson.Str(value) + ",\"previous\":" + XFJson.Str(this.m_lastDistrict) + ",\"new_location_discovered\":" + XFJson.Flag(discovered));
    this.m_lastDistrict = value;
    return false;
  }

  // Hub ids, activity states and choice counts only: the choices' text is the game's writing.
  protected cb func OnXFHubs(value: Variant) -> Bool {
    let hubs = FromVariant<DialogChoiceHubs>(value);
    let out = "\"hubs\":[";
    let i = 0;
    while i < ArraySize(hubs.choiceHubs) && i < 8 {
      let hub = hubs.choiceHubs[i];
      out += (i > 0 ? "," : "") + "{\"id\":" + IntToString(hub.id) + ",\"state\":" + IntToString(EnumInt(hub.activityState)) + ",\"choices\":" + IntToString(ArraySize(hub.choices)) + "}";
      i += 1;
    }
    XFProbeOut.Emit("dialogue.hub", out + "],\"count\":" + IntToString(ArraySize(hubs.choiceHubs)));
    return false;
  }

  protected cb func OnXFIndex(value: Int32) -> Bool {
    let defs = GetAllBlackboardDefs();
    let board = GameInstance.GetBlackboardSystem(this.GetGameInstance()).Get(defs.UIInteractions);
    let text = "\"index\":" + IntToString(value) + ",\"hub\":" + IntToString(board.GetInt(defs.UIInteractions.ActiveChoiceHubID));
    if Equals(text, this.m_lastIndex) {
      return false;
    }
    this.m_lastIndex = text;
    XFProbeOut.Emit("dialogue.index", text);
    return false;
  }

  protected cb func OnXFCall(value: Variant) -> Bool {
    let call = FromVariant<PhoneCallInformation>(value);
    let text = "\"contact\":" + XFJson.Str(NameToString(call.contactName)) + ",\"phase\":" + IntToString(EnumInt(call.callPhase)) + ",\"mode\":" + IntToString(EnumInt(call.callMode))
      + ",\"player_calling\":" + XFJson.Flag(call.isPlayerCalling) + ",\"player_triggered\":" + XFJson.Flag(call.isPlayerTriggered);
    if Equals(text, this.m_lastCall) {
      return false;
    }
    this.m_lastCall = text;
    XFProbeOut.Emit("call", text);
    return false;
  }

  protected cb func OnXFPurchase(value: Variant) -> Bool {
    let record = FromVariant<TweakDBID>(value);
    XFProbeOut.Emit("vehicle.acquired", "\"record\":" + XFJson.Str(TDBID.ToStringDEBUG(record)));
    return false;
  }

  // ---- the journal ---------------------------------------------------------------------------------------------------------

  private func Journal(what: String, hash: Uint32, className: CName, notifyOption: JournalNotifyOption, changeType: JournalChangeType) -> Void {
    let journal = GameInstance.GetJournalManager(this.GetGameInstance());
    let entry = journal.GetEntry(hash);
    let state = IsDefined(entry) ? EnumInt(journal.GetEntryState(entry)) : -1;
    // 0.8.7 (the Sol review, finding 5): the hash as its exact decimal digits, never through a Float.
    XFProbeOut.Emit("journal", "\"what\":" + XFJson.Str(what) + ",\"hash\":" + s"\(hash)" + ",\"class\":" + XFJson.Str(NameToString(className))
      + ",\"change\":" + IntToString(EnumInt(changeType)) + ",\"notify\":" + IntToString(EnumInt(notifyOption)) + ",\"state\":" + IntToString(state));
  }

  protected cb func OnXFJournal(hash: Uint32, className: CName, notifyOption: JournalNotifyOption, changeType: JournalChangeType) -> Bool {
    this.Journal("state", hash, className, notifyOption, changeType);
    return false;
  }

  protected cb func OnXFJournalTracked(hash: Uint32, className: CName, notifyOption: JournalNotifyOption, changeType: JournalChangeType) -> Bool {
    this.Journal("tracked", hash, className, notifyOption, changeType);
    return false;
  }

  protected cb func OnXFJournalUntracked(hash: Uint32, className: CName, notifyOption: JournalNotifyOption, changeType: JournalChangeType) -> Bool {
    this.Journal("untracked", hash, className, notifyOption, changeType);
    return false;
  }

  protected cb func OnXFJournalCounter(hash: Uint32, className: CName, notifyOption: JournalNotifyOption, changeType: JournalChangeType) -> Bool {
    this.Journal("counter", hash, className, notifyOption, changeType);
    return false;
  }

  // ---- counters (the noisy hooks) ------------------------------------------------------------------------------------------

  public func CountStatus() -> Void {
    this.m_statusCount += 1;
  }

  public func CountStim(name: String) -> Void {
    let i = 0;
    while i < ArraySize(this.m_stimTypes) {
      if Equals(this.m_stimTypes[i], name) {
        this.m_stimCounts[i] += 1;
        return;
      }
      i += 1;
    }
    ArrayPush(this.m_stimTypes, name);
    ArrayPush(this.m_stimCounts, 1);
  }

  private func Flush() -> Void {
    if this.m_statusCount > 0 {
      XFProbeOut.Emit("status.count", "\"n\":" + IntToString(this.m_statusCount) + ",\"over_s\":5");
      this.m_statusCount = 0;
    }
    if ArraySize(this.m_stimTypes) > 0 {
      let out = "\"over_s\":5,\"by_type\":{";
      let i = 0;
      while i < ArraySize(this.m_stimTypes) {
        out += (i > 0 ? "," : "") + XFJson.Str(this.m_stimTypes[i]) + ":" + IntToString(this.m_stimCounts[i]);
        i += 1;
      }
      XFProbeOut.Emit("stim.count", out + "}");
      ArrayClear(this.m_stimTypes);
      ArrayClear(this.m_stimCounts);
    }
  }

  // ---- polls: interior at 2 Hz, the clock each second, counters every 5 s ---------------------------------------------------

  public func Poll() -> Void {
    if !this.m_on {
      return;
    }
    let game = this.GetGameInstance();
    let player = GetPlayer(game);
    if IsDefined(player) {
      let inside = IsEntityInInteriorArea(player) ? 1 : 0;
      if inside != this.m_interior {
        if this.m_interior >= 0 {
          XFProbeOut.Emit("interior", "\"inside\":" + XFJson.Flag(inside == 1) + ",\"district\":" + XFJson.Str(this.m_lastDistrict));
        }
        this.m_interior = inside;
      }
    }
    this.m_ticks += 1;
    if this.m_ticks % 2 == 0 {
      let clock = GameInstance.GetTimeSystem(game);
      let gameNow = IsDefined(clock) ? clock.GetGameTimeStamp() : -1.0;
      let simNow = EngineTime.ToFloat(GameInstance.GetSimTime(game));
      if this.m_lastGame >= 0.0 {
        let gameDelta = gameNow - this.m_lastGame;
        let simDelta = simNow - this.m_lastSim;
        // A second of play moves the clock by a few game seconds; more than 10 game minutes in one poll is a jump.
        if gameDelta > 600.0 || gameDelta < -1.0 {
          XFProbeOut.Emit("time", "\"what\":\"jump\",\"game_delta_s\":" + XFJson.Num(gameDelta) + ",\"sim_delta_s\":" + XFJson.Num(simDelta));
        }
      }
      this.m_lastGame = gameNow;
      this.m_lastSim = simNow;
    }
    if this.m_ticks % 10 == 0 {
      this.Flush();
    }
    if IsDefined(this.m_poll) {
      GameInstance.GetDelaySystem(game).DelayCallback(this.m_poll, 0.5, false);
    }
  }
}

public class XFEventProbePoll extends DelayCallback {
  public let probe: wref<XFEventProbe>;

  public func Call() -> Void {
    if IsDefined(this.probe) {
      this.probe.Poll();
    }
  }
}

// ---- deaths, defeats, knockdowns ---------------------------------------------------------------------------------------------

@wrapMethod(ScriptedPuppet)
protected cb func OnDeath(evt: ref<gameDeathEvent>) -> Bool {
  let result = wrappedMethod(evt);
  if XFProbeOut.On() {
    let instigator = IsDefined(evt) ? evt.instigator : null;
    let byV = IsDefined(instigator) && IsDefined(instigator as PlayerPuppet);
    XFProbeOut.Emit("death", "\"victim\":" + XFJson.Str(XFProbeOut.Id(this.GetEntityID())) + ",\"record\":" + XFJson.Str(TDBID.ToStringDEBUG(this.GetRecordID()))
      + ",\"crowd\":" + XFJson.Flag(this.IsCrowd()) + ",\"civilian\":" + XFJson.Flag(this.IsCharacterCivilian()) + ",\"attitude\":" + XFJson.Str(XFProbeOut.Attitude(this)) + ",\"by_v\":" + XFJson.Flag(byV)
      + ",\"instigator\":" + XFJson.Str(IsDefined(instigator) ? XFProbeOut.Id(instigator.GetEntityID()) : ""));
  }
  return result;
}

@wrapMethod(ScriptedPuppet)
protected cb func OnDefeated(evt: ref<DefeatedEvent>) -> Bool {
  let result = wrappedMethod(evt);
  if XFProbeOut.On() {
    XFProbeOut.Emit("defeated", "\"victim\":" + XFJson.Str(XFProbeOut.Id(this.GetEntityID())) + ",\"record\":" + XFJson.Str(TDBID.ToStringDEBUG(this.GetRecordID()))
      + ",\"crowd\":" + XFJson.Flag(this.IsCrowd()) + ",\"civilian\":" + XFJson.Flag(this.IsCharacterCivilian()) + ",\"attitude\":" + XFJson.Str(XFProbeOut.Attitude(this)));
  }
  return result;
}

// Every status effect on every puppet: counted; a new knockdown is also recorded.
@wrapMethod(ScriptedPuppet)
protected cb func OnStatusEffectApplied(evt: ref<ApplyStatusEffectEvent>) -> Bool {
  let result = wrappedMethod(evt);
  if XFProbeOut.On() && IsDefined(evt) {
    let probe = XFProbeOut.Probe();
    if IsDefined(probe) {
      probe.CountStatus();
    }
    if evt.isNewApplication && IsDefined(evt.staticData) && IsDefined(evt.staticData.StatusEffectType())
      && Equals(evt.staticData.StatusEffectType().Type(), gamedataStatusEffectType.Knockdown) {
      XFProbeOut.Emit("knockdown", "\"victim\":" + XFJson.Str(XFProbeOut.Id(this.GetEntityID())) + ",\"instigator\":" + XFJson.Str(XFProbeOut.Id(evt.instigatorEntityID)));
    }
  }
  return result;
}

// ---- V: combat, vehicles ----------------------------------------------------------------------------------------------------

@wrapMethod(PlayerPuppet)
protected cb func OnCombatStateChanged(newState: Int32) -> Bool {
  let result = wrappedMethod(newState);
  XFProbeOut.Emit("combat", "\"state\":" + IntToString(newState));
  return result;
}

@wrapMethod(PlayerPuppet)
protected cb func OnMountingEvent(evt: ref<MountingEvent>) -> Bool {
  let result = wrappedMethod(evt);
  if XFProbeOut.On() && IsDefined(evt) && IsDefined(evt.request) {
    let info = evt.request.lowLevelMountingInfo;
    XFProbeOut.Emit("vehicle", "\"what\":\"mount\",\"parent\":" + XFJson.Str(XFProbeOut.Id(info.parentId)) + ",\"child\":" + XFJson.Str(XFProbeOut.Id(info.childId))
      + ",\"slot\":" + XFJson.Str(NameToString(info.slotId.id)));
  }
  return result;
}

@wrapMethod(PlayerPuppet)
protected cb func OnUnmountingEvent(evt: ref<UnmountingEvent>) -> Bool {
  let result = wrappedMethod(evt);
  if XFProbeOut.On() && IsDefined(evt) && IsDefined(evt.request) {
    let info = evt.request.lowLevelMountingInfo;
    XFProbeOut.Emit("vehicle", "\"what\":\"unmount\",\"parent\":" + XFJson.Str(XFProbeOut.Id(info.parentId)) + ",\"slot\":" + XFJson.Str(NameToString(info.slotId.id)));
  }
  return result;
}

@wrapMethod(VehicleObject)
private final func StealVehicle(thief: wref<GameObject>) -> Void {
  wrappedMethod(thief);
  if XFProbeOut.On() {
    XFProbeOut.Emit("vehicle.stolen", "\"vehicle\":" + XFJson.Str(XFProbeOut.Id(this.GetEntityID())) + ",\"record\":" + XFJson.Str(TDBID.ToStringDEBUG(this.GetRecordID()))
      + ",\"by_v\":" + XFJson.Flag(IsDefined(thief) && IsDefined(thief as PlayerPuppet)));
  }
}

// ---- time: the menu's skip ----------------------------------------------------------------------------------------------------

@wrapMethod(GameTimeUtils)
public final static func FastForwardPlayerState(player: ref<GameObject>) -> Void {
  wrappedMethod(player);
  XFProbeOut.Emit("time", "\"what\":\"menu_skip\"");
}

// ---- the stim tap (row 16): only while test.events {stims: true} switched it on; allow-listed types counted -----------------

@wrapMethod(StimBroadcasterComponent)
public final func TriggerSingleBroadcast(contextOwner: wref<GameObject>, gdStimType: gamedataStimType, opt radius: Float, opt investigateData: stimInvestigateData, opt propagationChange: Bool) -> Void {
  wrappedMethod(contextOwner, gdStimType, radius, investigateData, propagationChange);
  switch gdStimType {
    case gamedataStimType.CrimeWitness:
    case gamedataStimType.CrowdIllegalAction:
    case gamedataStimType.Gunshot:
    case gamedataStimType.Explosion:
    case gamedataStimType.DeadBody:
    case gamedataStimType.Terror:
    case gamedataStimType.Scream:
      if XFProbeOut.Stims() {
        let probe = XFProbeOut.Probe();
        if IsDefined(probe) {
          probe.CountStim(EnumValueToString("gamedataStimType", Cast<Int64>(EnumInt(gdStimType))));
        }
      }
      break;
    default:
      break;
  }
}
