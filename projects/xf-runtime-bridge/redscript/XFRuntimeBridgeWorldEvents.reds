module XFRuntimeBridge

// Passive first-cut feed. No timer: every producer is a game notification. Listener lifetime belongs to XFBridgeSystem.
public abstract class XFWorldOut {
  public static func On() -> Bool { return (XFBridge_ProbeFlags() & 32) != 0; }
  public static func GameTimeSeconds() -> String {
    if !XFBridge_Live() { return "null"; }
    let time = GameInstance.GetTimeSystem(GetGameInstance());
    if !IsDefined(time) { return "null"; }
    let now = time.GetGameTime();
    return IntToString(GameTime.GetSeconds(now));
  }
  public static func Emit(kind: String, fields: String) -> Void {
    if !XFWorldOut.On() { return; }
    XFBridge_Event(kind, "{\"world_feed\":true,\"game_time_s\":" + XFWorldOut.GameTimeSeconds() + "," + fields + "}");
  }
  @if(ModuleExists("Codeware"))
  public static func Codeware() -> Bool { return true; }
  @if(!ModuleExists("Codeware"))
  public static func Codeware() -> Bool { return false; }
  public static func Session(phase: String, fields: String) -> Void {
    XFWorldOut.Emit("session", "\"phase\":" + XFJson.Str(phase) + ",\"codeware\":" + XFJson.Flag(XFWorldOut.Codeware()) + fields);
  }
  public static func System() -> ref<XFWorldFeed> {
    return GameInstance.GetScriptableSystemsContainer(GetGameInstance()).Get(n"XFRuntimeBridge.XFWorldFeed") as XFWorldFeed;
  }
  public static func Id(obj: ref<GameObject>) -> String {
    return IsDefined(obj) ? XFJson.Str(EntityID.ToDebugStringDecimal(obj.GetEntityID())) : "null";
  }
}

@if(ModuleExists("Codeware"))
public class XFWorldSessions extends ScriptableService {
  private cb func OnLoad() {
    let callbacks = GameInstance.GetCallbackSystem();
    callbacks.RegisterCallback(n"Session/BeforeStart", this, n"BeforeStart");
    callbacks.RegisterCallback(n"Session/Start", this, n"Start");
    callbacks.RegisterCallback(n"Session/Ready", this, n"Ready");
    callbacks.RegisterCallback(n"Session/BeforeSave", this, n"BeforeSave");
    callbacks.RegisterCallback(n"Session/AfterSave", this, n"AfterSave");
    callbacks.RegisterCallback(n"Session/BeforeEnd", this, n"BeforeEnd");
    callbacks.RegisterCallback(n"Session/End", this, n"End");
  }
  private func Note(phase: String, event: ref<GameSessionEvent>) -> Void {
    // Before the native script gate, this path calls native bookkeeping only. In particular, no system lookup.
    XFWorldOut.Session(phase, ",\"restored\":" + XFJson.Flag(event.IsRestored()) + ",\"pre_game\":" + XFJson.Flag(event.IsPreGame()));
  }
  private cb func BeforeStart(event: ref<GameSessionEvent>) { this.Note("before_start", event); }
  private cb func Start(event: ref<GameSessionEvent>) { this.Note("start", event); }
  private cb func Ready(event: ref<GameSessionEvent>) { this.Note("ready", event); }
  private cb func BeforeSave(event: ref<GameSessionEvent>) { this.Note("before_save", event); }
  private cb func AfterSave(event: ref<GameSessionEvent>) { this.Note("after_save", event); }
  private cb func BeforeEnd(event: ref<GameSessionEvent>) { this.Note("before_end", event); }
  private cb func End(event: ref<GameSessionEvent>) { this.Note("end", event); }
}

public class XFWorldFeed extends ScriptableSystem {
  private let m_on: Bool;
  private let m_quests: ref<QuestsSystem>;
  private let m_journal: ref<JournalManager>;
  private let m_interactions: ref<IBlackboard>;
  private let m_phone: ref<IBlackboard>;
  private let m_index: ref<CallbackHandle>;
  private let m_call: ref<CallbackHandle>;
  private let m_wanted: Uint32;
  private let m_chase: Uint32;
  private let m_facts: array<Uint32>;
  private let m_lastIndex: String;
  private let m_lastCall: String;
  private let m_lastHubs: String;
  private let m_serial: Int32;
  // QPC-based admission before the bounded copy: pause and time dilation do not freeze the budget.
  public func DialogueAdmit() -> Bool {
    if !this.m_on || !XFWorldOut.On() || !XFBridge_Live() { return false; }
    return XFBridge_Event("dialogue", "{\"world_admit\":true}");
  }
  public func Token() -> String {
    this.m_serial = this.m_serial >= 2000000000 ? 1 : this.m_serial + 1;
    return IntToString(this.m_serial);
  }
  public func Attach() -> Void {
    if this.m_on || !XFWorldOut.On() || !XFBridge_Live() { return; }
    let game = this.GetGameInstance();
    this.m_quests = GameInstance.GetQuestsSystem(game);
    this.m_journal = GameInstance.GetJournalManager(game);
    let boards = GameInstance.GetBlackboardSystem(game);
    let defs = GetAllBlackboardDefs();
    this.m_interactions = boards.Get(defs.UIInteractions);
    this.m_phone = boards.Get(defs.UI_ComDevice);
    this.m_on = true;
    this.m_wanted = this.m_quests.RegisterListener(n"wanted_level", this, n"Wanted");
    this.m_chase = this.m_quests.RegisterListener(n"wanted_chase_active", this, n"Chase");
    if IsDefined(this.m_interactions) { this.m_index = this.m_interactions.RegisterListenerInt(defs.UIInteractions.SelectedIndex, this, n"Index"); }
    if IsDefined(this.m_phone) { this.m_call = this.m_phone.RegisterListenerVariant(defs.UI_ComDevice.PhoneCallInformation, this, n"Call"); }
    this.m_journal.RegisterScriptCallback(this, n"State", gameJournalListenerType.State);
    this.m_journal.RegisterScriptCallback(this, n"Tracked", gameJournalListenerType.Tracked);
    this.m_journal.RegisterScriptCallback(this, n"Counter", gameJournalListenerType.Counter);
    this.AttachFacts();
  }
  public func Detach() -> Void {
    if !this.m_on { return; }
    this.m_on = false;
    let defs = GetAllBlackboardDefs();
    if IsDefined(this.m_interactions) { this.m_interactions.UnregisterListenerInt(defs.UIInteractions.SelectedIndex, this.m_index); }
    if IsDefined(this.m_phone) { this.m_phone.UnregisterListenerVariant(defs.UI_ComDevice.PhoneCallInformation, this.m_call); }
    if IsDefined(this.m_quests) {
      this.m_quests.UnregisterListener(n"wanted_level", this.m_wanted);
      this.m_quests.UnregisterListener(n"wanted_chase_active", this.m_chase);
      this.DetachFacts();
    }
    if IsDefined(this.m_journal) {
      this.m_journal.UnregisterScriptCallback(this, n"State");
      this.m_journal.UnregisterScriptCallback(this, n"Tracked");
      this.m_journal.UnregisterScriptCallback(this, n"Counter");
    }
    this.m_interactions = null; this.m_phone = null; this.m_quests = null; this.m_journal = null;
    this.m_lastIndex = ""; this.m_lastHubs = ""; this.m_lastCall = "";
  }
  private func Heat(fact: String, value: Int32) -> Void {
    if !this.m_on || !XFBridge_Live() { return; }
    let fields = "\"fact\":" + XFJson.Str(fact) + ",\"value\":" + IntToString(value);
    XFWorldOut.Emit("heat", fields);
    XFWorldHooks.Probe("heat", fields);
  }
  protected cb func Wanted(value: Int32) -> Bool { this.Heat("wanted_level", value); return false; }
  protected cb func Chase(value: Int32) -> Bool { this.Heat("wanted_chase_active", value); return false; }
  protected cb func Index(value: Int32) -> Bool {
    if !this.DialogueAdmit() { return false; }
    let hub = this.m_interactions.GetInt(GetAllBlackboardDefs().UIInteractions.ActiveChoiceHubID);
    let fields = "\"what\":\"index\",\"hub\":" + IntToString(hub) + ",\"index\":" + IntToString(value);
    if NotEquals(fields, this.m_lastIndex) { this.m_lastIndex = fields; XFWorldOut.Emit("dialogue", fields); }
    return false;
  }
  public func Hubs(const data: script_ref<DialogChoiceHubs>) -> Void {
    if !this.DialogueAdmit() { return; }
    let count = ArraySize(Deref(data).choiceHubs);
    let fields = "\"what\":\"hubs\",\"partner\":null,\"partner_available\":false,\"count\":" + IntToString(count) + ",\"hubs\":[";
    let i = 0;
    while i < count && i < 2 {
      let hub = Deref(data).choiceHubs[i];
      fields += (i > 0 ? "," : "") + "{\"id\":" + IntToString(hub.id) + ",\"state\":" + IntToString(EnumInt(hub.activityState)) + ",\"count\":" + IntToString(ArraySize(hub.choices)) + ",\"choices\":[";
      let j = 0;
      while j < ArraySize(hub.choices) && j < 4 {
        let text = hub.choices[j].localizedName;
        fields += (j > 0 ? "," : "") + "{\"index\":" + IntToString(j) + ",\"text\":" + XFJson.Str(StrLeft(text, 48)) + ",\"truncated\":" + XFJson.Flag(StrLen(text) > 48) + "}";
        j += 1;
      }
      fields += "],\"truncated\":" + XFJson.Flag(ArraySize(hub.choices) > 4) + "}";
      i += 1;
    }
    fields += "],\"truncated\":" + XFJson.Flag(count > 2);
    if NotEquals(fields, this.m_lastHubs) { this.m_lastHubs = fields; XFWorldOut.Emit("dialogue", fields); }
  }
  private func Journal(what: String, hash: Uint32, className: CName, notify: JournalNotifyOption, change: JournalChangeType) -> Void {
    if !this.m_on || !XFWorldOut.On() || !XFBridge_Live() { return; }
    let entry = this.m_journal.GetEntry(hash);
    let current = entry;
    let path = "";
    let depth = 0;
    let clipped = false;
    while IsDefined(current) && depth < 16 {
      let id = current.GetId();
      clipped = clipped || StrLen(id) > 24;
      path = StrLeft(id, 24) + (depth > 0 ? "/" + path : "");
      current = this.m_journal.GetParentEntry(current);
      depth += 1;
    }
    let state = IsDefined(entry) ? IntToString(EnumInt(this.m_journal.GetEntryState(entry))) : "null";
    let objective = entry as JournalQuestObjective;
    let counter = IsDefined(objective) ? IntToString(this.m_journal.GetObjectiveCurrentCounter(objective)) : "null";
    XFWorldOut.Emit("journal", "\"what\":" + XFJson.Str(what) + ",\"hash\":" + ToString(hash) + ",\"class\":" + XFJson.Str(NameToString(className))
      + ",\"path\":" + (IsDefined(entry) ? XFJson.Str(path) : "null") + ",\"path_complete\":" + XFJson.Flag(IsDefined(entry) && !IsDefined(current) && !clipped)
      + ",\"state\":" + state + ",\"counter\":" + counter + ",\"notify\":" + IntToString(EnumInt(notify)) + ",\"change\":" + IntToString(EnumInt(change)));
  }
  protected cb func State(hash: Uint32, className: CName, notify: JournalNotifyOption, change: JournalChangeType) -> Bool { this.Journal("state", hash, className, notify, change); return false; }
  protected cb func Tracked(hash: Uint32, className: CName, notify: JournalNotifyOption, change: JournalChangeType) -> Bool { this.Journal("tracked", hash, className, notify, change); return false; }
  protected cb func Counter(hash: Uint32, className: CName, notify: JournalNotifyOption, change: JournalChangeType) -> Bool { this.Journal("counter", hash, className, notify, change); return false; }
  protected cb func Call(value: Variant) -> Bool {
    if !this.m_on || !XFWorldOut.On() || !XFBridge_Live() { return false; }
    let call = FromVariant<PhoneCallInformation>(value);
    let fields = "\"phase\":" + XFJson.Str(EnumValueToString("questPhoneCallPhase", Cast<Int64>(EnumInt(call.callPhase))))
      + ",\"contact\":" + XFJson.Str(StrLeft(NameToString(call.contactName), 128)) + ",\"mode\":" + IntToString(EnumInt(call.callMode))
      + ",\"player_calling\":" + XFJson.Flag(call.isPlayerCalling) + ",\"player_triggered\":" + XFJson.Flag(call.isPlayerTriggered);
    if NotEquals(fields, this.m_lastCall) { this.m_lastCall = fields; XFWorldOut.Emit("call", fields); }
    return false;
  }
  private func Fact(name: String, value: Int32) -> Void {
    if this.m_on && XFBridge_Live() { XFWorldOut.Emit("fact", "\"fact\":" + XFJson.Str(name) + ",\"value\":" + IntToString(value)); }
  }
  // Names from research/story-engine/main-story-facts.json; one bounded subscription per watched fact.
  private func AttachFacts() -> Void {
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q000_street_kid_background", this, n"Fact0"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q000_nomad_background", this, n"Fact1"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q000_corpo_background", this, n"Fact2"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q000_done", this, n"Fact3"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q001_done", this, n"Fact4"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q003_done", this, n"Fact5"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q004_done", this, n"Fact6"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q005_done", this, n"Fact7"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q003_brick_dead", this, n"Fact8"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q003_dumdum_dead", this, n"Fact9"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q003_royce_dead", this, n"Fact10"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q105_woodman_dead", this, n"Fact11"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q105_fingers_dead", this, n"Fact12"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q101_done", this, n"Fact13"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q103_done", this, n"Fact14"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q104_done", this, n"Fact15"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q105_done", this, n"Fact16"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q108_done", this, n"Fact17"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q110_done", this, n"Fact18"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q112_done", this, n"Fact19"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q113_active", this, n"Fact20"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q114_done", this, n"Fact21"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_done", this, n"Fact22"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q116_done", this, n"Fact23"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q104_mitch_rescued", this, n"Fact24"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q110_placide_dead", this, n"Fact25"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q112_takemura_dead", this, n"Fact26"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q112_oda_dead", this, n"Fact27"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q112_hanako_meeting_set_up", this, n"Fact28"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_point_of_no_return", this, n"Fact29"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_no_return", this, n"Fact30"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_02_hanako_help", this, n"Fact31"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_02_panam_help", this, n"Fact32"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_call_panam_done", this, n"Fact33"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_v_johnny_solo_ending", this, n"Fact34"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_02b_made_final_choice", this, n"Fact35"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_suicide_option", this, n"Fact36"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_suicide_ending", this, n"Fact37"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_jungle_weyland_saved", this, n"Fact38"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_weyland_dead", this, n"Fact39"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_did_it_solo", this, n"Fact40"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q116_rogue_dead", this, n"Fact41"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q116_saul_dead", this, n"Fact42"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q116_smasher_defeated", this, n"Fact43"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q201_done", this, n"Fact44"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q202_done", this, n"Fact45"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q203_done", this, n"Fact46"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q204_done", this, n"Fact47"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_panam_romance_chosen", this, n"Fact48"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_judy_romance_chosen", this, n"Fact49"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_kerry_romance_chosen", this, n"Fact50"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q115_river_romance_chosen", this, n"Fact51"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq027_panam_lover", this, n"Fact52"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq028_kerry_relationship", this, n"Fact53"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq029_river_lover", this, n"Fact54"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq030_judy_lover", this, n"Fact55"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq027_panam_ratted_out", this, n"Fact56"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq027_done", this, n"Fact57"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq027_failed", this, n"Fact58"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq028_kerry_dislike", this, n"Fact59"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq028_kerry_ignored", this, n"Fact60"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq030_done", this, n"Fact61"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq030_failed", this, n"Fact62"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq030_broken", this, n"Fact63"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq021_river_dead", this, n"Fact64"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq021_river_hates_v", this, n"Fact65"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq021_randy_saved", this, n"Fact66"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq021_sobchak_friend", this, n"Fact67"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq032_johnny_friend", this, n"Fact68"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq031_rogue_met_johnny", this, n"Fact69"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"sq031_done", this, n"Fact70"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"ep1_installed", this, n"Fact71"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"ep1_standalone", this, n"Fact72"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"ep1_active", this, n"Fact73"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"ep1_side_content", this, n"Fact74"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q301_00_done", this, n"Fact75"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q301_done", this, n"Fact76"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q302_done", this, n"Fact77"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q303_done", this, n"Fact78"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q304_done", this, n"Fact79"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q304_songbirds_path", this, n"Fact80"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q305_done", this, n"Fact81"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q305_songbird_alive", this, n"Fact82"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q306_done", this, n"Fact83"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q306_finale_deal_done", this, n"Fact84"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q306_reed_killed", this, n"Fact85"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q306_reed_trusted", this, n"Fact86"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q306_somi_betrayed", this, n"Fact87"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q307_aborted", this, n"Fact88"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q307_main_game_killed", this, n"Fact89"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q307_done", this, n"Fact90"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q302_jacob_killed", this, n"Fact91"));
    ArrayPush(this.m_facts, this.m_quests.RegisterListener(n"q304_kurt_dead", this, n"Fact92"));
  }
  private func DetachFacts() -> Void {
    this.m_quests.UnregisterListener(n"q000_street_kid_background", this.m_facts[0]);
    this.m_quests.UnregisterListener(n"q000_nomad_background", this.m_facts[1]);
    this.m_quests.UnregisterListener(n"q000_corpo_background", this.m_facts[2]);
    this.m_quests.UnregisterListener(n"q000_done", this.m_facts[3]);
    this.m_quests.UnregisterListener(n"q001_done", this.m_facts[4]);
    this.m_quests.UnregisterListener(n"q003_done", this.m_facts[5]);
    this.m_quests.UnregisterListener(n"q004_done", this.m_facts[6]);
    this.m_quests.UnregisterListener(n"q005_done", this.m_facts[7]);
    this.m_quests.UnregisterListener(n"q003_brick_dead", this.m_facts[8]);
    this.m_quests.UnregisterListener(n"q003_dumdum_dead", this.m_facts[9]);
    this.m_quests.UnregisterListener(n"q003_royce_dead", this.m_facts[10]);
    this.m_quests.UnregisterListener(n"q105_woodman_dead", this.m_facts[11]);
    this.m_quests.UnregisterListener(n"q105_fingers_dead", this.m_facts[12]);
    this.m_quests.UnregisterListener(n"q101_done", this.m_facts[13]);
    this.m_quests.UnregisterListener(n"q103_done", this.m_facts[14]);
    this.m_quests.UnregisterListener(n"q104_done", this.m_facts[15]);
    this.m_quests.UnregisterListener(n"q105_done", this.m_facts[16]);
    this.m_quests.UnregisterListener(n"q108_done", this.m_facts[17]);
    this.m_quests.UnregisterListener(n"q110_done", this.m_facts[18]);
    this.m_quests.UnregisterListener(n"q112_done", this.m_facts[19]);
    this.m_quests.UnregisterListener(n"q113_active", this.m_facts[20]);
    this.m_quests.UnregisterListener(n"q114_done", this.m_facts[21]);
    this.m_quests.UnregisterListener(n"q115_done", this.m_facts[22]);
    this.m_quests.UnregisterListener(n"q116_done", this.m_facts[23]);
    this.m_quests.UnregisterListener(n"q104_mitch_rescued", this.m_facts[24]);
    this.m_quests.UnregisterListener(n"q110_placide_dead", this.m_facts[25]);
    this.m_quests.UnregisterListener(n"q112_takemura_dead", this.m_facts[26]);
    this.m_quests.UnregisterListener(n"q112_oda_dead", this.m_facts[27]);
    this.m_quests.UnregisterListener(n"q112_hanako_meeting_set_up", this.m_facts[28]);
    this.m_quests.UnregisterListener(n"q115_point_of_no_return", this.m_facts[29]);
    this.m_quests.UnregisterListener(n"q115_no_return", this.m_facts[30]);
    this.m_quests.UnregisterListener(n"q115_02_hanako_help", this.m_facts[31]);
    this.m_quests.UnregisterListener(n"q115_02_panam_help", this.m_facts[32]);
    this.m_quests.UnregisterListener(n"q115_call_panam_done", this.m_facts[33]);
    this.m_quests.UnregisterListener(n"q115_v_johnny_solo_ending", this.m_facts[34]);
    this.m_quests.UnregisterListener(n"q115_02b_made_final_choice", this.m_facts[35]);
    this.m_quests.UnregisterListener(n"q115_suicide_option", this.m_facts[36]);
    this.m_quests.UnregisterListener(n"q115_suicide_ending", this.m_facts[37]);
    this.m_quests.UnregisterListener(n"q115_jungle_weyland_saved", this.m_facts[38]);
    this.m_quests.UnregisterListener(n"q115_weyland_dead", this.m_facts[39]);
    this.m_quests.UnregisterListener(n"q115_did_it_solo", this.m_facts[40]);
    this.m_quests.UnregisterListener(n"q116_rogue_dead", this.m_facts[41]);
    this.m_quests.UnregisterListener(n"q116_saul_dead", this.m_facts[42]);
    this.m_quests.UnregisterListener(n"q116_smasher_defeated", this.m_facts[43]);
    this.m_quests.UnregisterListener(n"q201_done", this.m_facts[44]);
    this.m_quests.UnregisterListener(n"q202_done", this.m_facts[45]);
    this.m_quests.UnregisterListener(n"q203_done", this.m_facts[46]);
    this.m_quests.UnregisterListener(n"q204_done", this.m_facts[47]);
    this.m_quests.UnregisterListener(n"q115_panam_romance_chosen", this.m_facts[48]);
    this.m_quests.UnregisterListener(n"q115_judy_romance_chosen", this.m_facts[49]);
    this.m_quests.UnregisterListener(n"q115_kerry_romance_chosen", this.m_facts[50]);
    this.m_quests.UnregisterListener(n"q115_river_romance_chosen", this.m_facts[51]);
    this.m_quests.UnregisterListener(n"sq027_panam_lover", this.m_facts[52]);
    this.m_quests.UnregisterListener(n"sq028_kerry_relationship", this.m_facts[53]);
    this.m_quests.UnregisterListener(n"sq029_river_lover", this.m_facts[54]);
    this.m_quests.UnregisterListener(n"sq030_judy_lover", this.m_facts[55]);
    this.m_quests.UnregisterListener(n"sq027_panam_ratted_out", this.m_facts[56]);
    this.m_quests.UnregisterListener(n"sq027_done", this.m_facts[57]);
    this.m_quests.UnregisterListener(n"sq027_failed", this.m_facts[58]);
    this.m_quests.UnregisterListener(n"sq028_kerry_dislike", this.m_facts[59]);
    this.m_quests.UnregisterListener(n"sq028_kerry_ignored", this.m_facts[60]);
    this.m_quests.UnregisterListener(n"sq030_done", this.m_facts[61]);
    this.m_quests.UnregisterListener(n"sq030_failed", this.m_facts[62]);
    this.m_quests.UnregisterListener(n"sq030_broken", this.m_facts[63]);
    this.m_quests.UnregisterListener(n"sq021_river_dead", this.m_facts[64]);
    this.m_quests.UnregisterListener(n"sq021_river_hates_v", this.m_facts[65]);
    this.m_quests.UnregisterListener(n"sq021_randy_saved", this.m_facts[66]);
    this.m_quests.UnregisterListener(n"sq021_sobchak_friend", this.m_facts[67]);
    this.m_quests.UnregisterListener(n"sq032_johnny_friend", this.m_facts[68]);
    this.m_quests.UnregisterListener(n"sq031_rogue_met_johnny", this.m_facts[69]);
    this.m_quests.UnregisterListener(n"sq031_done", this.m_facts[70]);
    this.m_quests.UnregisterListener(n"ep1_installed", this.m_facts[71]);
    this.m_quests.UnregisterListener(n"ep1_standalone", this.m_facts[72]);
    this.m_quests.UnregisterListener(n"ep1_active", this.m_facts[73]);
    this.m_quests.UnregisterListener(n"ep1_side_content", this.m_facts[74]);
    this.m_quests.UnregisterListener(n"q301_00_done", this.m_facts[75]);
    this.m_quests.UnregisterListener(n"q301_done", this.m_facts[76]);
    this.m_quests.UnregisterListener(n"q302_done", this.m_facts[77]);
    this.m_quests.UnregisterListener(n"q303_done", this.m_facts[78]);
    this.m_quests.UnregisterListener(n"q304_done", this.m_facts[79]);
    this.m_quests.UnregisterListener(n"q304_songbirds_path", this.m_facts[80]);
    this.m_quests.UnregisterListener(n"q305_done", this.m_facts[81]);
    this.m_quests.UnregisterListener(n"q305_songbird_alive", this.m_facts[82]);
    this.m_quests.UnregisterListener(n"q306_done", this.m_facts[83]);
    this.m_quests.UnregisterListener(n"q306_finale_deal_done", this.m_facts[84]);
    this.m_quests.UnregisterListener(n"q306_reed_killed", this.m_facts[85]);
    this.m_quests.UnregisterListener(n"q306_reed_trusted", this.m_facts[86]);
    this.m_quests.UnregisterListener(n"q306_somi_betrayed", this.m_facts[87]);
    this.m_quests.UnregisterListener(n"q307_aborted", this.m_facts[88]);
    this.m_quests.UnregisterListener(n"q307_main_game_killed", this.m_facts[89]);
    this.m_quests.UnregisterListener(n"q307_done", this.m_facts[90]);
    this.m_quests.UnregisterListener(n"q302_jacob_killed", this.m_facts[91]);
    this.m_quests.UnregisterListener(n"q304_kurt_dead", this.m_facts[92]);
    ArrayClear(this.m_facts);
  }
  protected cb func Fact0(value: Int32) -> Bool { this.Fact("q000_street_kid_background", value); return false; }
  protected cb func Fact1(value: Int32) -> Bool { this.Fact("q000_nomad_background", value); return false; }
  protected cb func Fact2(value: Int32) -> Bool { this.Fact("q000_corpo_background", value); return false; }
  protected cb func Fact3(value: Int32) -> Bool { this.Fact("q000_done", value); return false; }
  protected cb func Fact4(value: Int32) -> Bool { this.Fact("q001_done", value); return false; }
  protected cb func Fact5(value: Int32) -> Bool { this.Fact("q003_done", value); return false; }
  protected cb func Fact6(value: Int32) -> Bool { this.Fact("q004_done", value); return false; }
  protected cb func Fact7(value: Int32) -> Bool { this.Fact("q005_done", value); return false; }
  protected cb func Fact8(value: Int32) -> Bool { this.Fact("q003_brick_dead", value); return false; }
  protected cb func Fact9(value: Int32) -> Bool { this.Fact("q003_dumdum_dead", value); return false; }
  protected cb func Fact10(value: Int32) -> Bool { this.Fact("q003_royce_dead", value); return false; }
  protected cb func Fact11(value: Int32) -> Bool { this.Fact("q105_woodman_dead", value); return false; }
  protected cb func Fact12(value: Int32) -> Bool { this.Fact("q105_fingers_dead", value); return false; }
  protected cb func Fact13(value: Int32) -> Bool { this.Fact("q101_done", value); return false; }
  protected cb func Fact14(value: Int32) -> Bool { this.Fact("q103_done", value); return false; }
  protected cb func Fact15(value: Int32) -> Bool { this.Fact("q104_done", value); return false; }
  protected cb func Fact16(value: Int32) -> Bool { this.Fact("q105_done", value); return false; }
  protected cb func Fact17(value: Int32) -> Bool { this.Fact("q108_done", value); return false; }
  protected cb func Fact18(value: Int32) -> Bool { this.Fact("q110_done", value); return false; }
  protected cb func Fact19(value: Int32) -> Bool { this.Fact("q112_done", value); return false; }
  protected cb func Fact20(value: Int32) -> Bool { this.Fact("q113_active", value); return false; }
  protected cb func Fact21(value: Int32) -> Bool { this.Fact("q114_done", value); return false; }
  protected cb func Fact22(value: Int32) -> Bool { this.Fact("q115_done", value); return false; }
  protected cb func Fact23(value: Int32) -> Bool { this.Fact("q116_done", value); return false; }
  protected cb func Fact24(value: Int32) -> Bool { this.Fact("q104_mitch_rescued", value); return false; }
  protected cb func Fact25(value: Int32) -> Bool { this.Fact("q110_placide_dead", value); return false; }
  protected cb func Fact26(value: Int32) -> Bool { this.Fact("q112_takemura_dead", value); return false; }
  protected cb func Fact27(value: Int32) -> Bool { this.Fact("q112_oda_dead", value); return false; }
  protected cb func Fact28(value: Int32) -> Bool { this.Fact("q112_hanako_meeting_set_up", value); return false; }
  protected cb func Fact29(value: Int32) -> Bool { this.Fact("q115_point_of_no_return", value); return false; }
  protected cb func Fact30(value: Int32) -> Bool { this.Fact("q115_no_return", value); return false; }
  protected cb func Fact31(value: Int32) -> Bool { this.Fact("q115_02_hanako_help", value); return false; }
  protected cb func Fact32(value: Int32) -> Bool { this.Fact("q115_02_panam_help", value); return false; }
  protected cb func Fact33(value: Int32) -> Bool { this.Fact("q115_call_panam_done", value); return false; }
  protected cb func Fact34(value: Int32) -> Bool { this.Fact("q115_v_johnny_solo_ending", value); return false; }
  protected cb func Fact35(value: Int32) -> Bool { this.Fact("q115_02b_made_final_choice", value); return false; }
  protected cb func Fact36(value: Int32) -> Bool { this.Fact("q115_suicide_option", value); return false; }
  protected cb func Fact37(value: Int32) -> Bool { this.Fact("q115_suicide_ending", value); return false; }
  protected cb func Fact38(value: Int32) -> Bool { this.Fact("q115_jungle_weyland_saved", value); return false; }
  protected cb func Fact39(value: Int32) -> Bool { this.Fact("q115_weyland_dead", value); return false; }
  protected cb func Fact40(value: Int32) -> Bool { this.Fact("q115_did_it_solo", value); return false; }
  protected cb func Fact41(value: Int32) -> Bool { this.Fact("q116_rogue_dead", value); return false; }
  protected cb func Fact42(value: Int32) -> Bool { this.Fact("q116_saul_dead", value); return false; }
  protected cb func Fact43(value: Int32) -> Bool { this.Fact("q116_smasher_defeated", value); return false; }
  protected cb func Fact44(value: Int32) -> Bool { this.Fact("q201_done", value); return false; }
  protected cb func Fact45(value: Int32) -> Bool { this.Fact("q202_done", value); return false; }
  protected cb func Fact46(value: Int32) -> Bool { this.Fact("q203_done", value); return false; }
  protected cb func Fact47(value: Int32) -> Bool { this.Fact("q204_done", value); return false; }
  protected cb func Fact48(value: Int32) -> Bool { this.Fact("q115_panam_romance_chosen", value); return false; }
  protected cb func Fact49(value: Int32) -> Bool { this.Fact("q115_judy_romance_chosen", value); return false; }
  protected cb func Fact50(value: Int32) -> Bool { this.Fact("q115_kerry_romance_chosen", value); return false; }
  protected cb func Fact51(value: Int32) -> Bool { this.Fact("q115_river_romance_chosen", value); return false; }
  protected cb func Fact52(value: Int32) -> Bool { this.Fact("sq027_panam_lover", value); return false; }
  protected cb func Fact53(value: Int32) -> Bool { this.Fact("sq028_kerry_relationship", value); return false; }
  protected cb func Fact54(value: Int32) -> Bool { this.Fact("sq029_river_lover", value); return false; }
  protected cb func Fact55(value: Int32) -> Bool { this.Fact("sq030_judy_lover", value); return false; }
  protected cb func Fact56(value: Int32) -> Bool { this.Fact("sq027_panam_ratted_out", value); return false; }
  protected cb func Fact57(value: Int32) -> Bool { this.Fact("sq027_done", value); return false; }
  protected cb func Fact58(value: Int32) -> Bool { this.Fact("sq027_failed", value); return false; }
  protected cb func Fact59(value: Int32) -> Bool { this.Fact("sq028_kerry_dislike", value); return false; }
  protected cb func Fact60(value: Int32) -> Bool { this.Fact("sq028_kerry_ignored", value); return false; }
  protected cb func Fact61(value: Int32) -> Bool { this.Fact("sq030_done", value); return false; }
  protected cb func Fact62(value: Int32) -> Bool { this.Fact("sq030_failed", value); return false; }
  protected cb func Fact63(value: Int32) -> Bool { this.Fact("sq030_broken", value); return false; }
  protected cb func Fact64(value: Int32) -> Bool { this.Fact("sq021_river_dead", value); return false; }
  protected cb func Fact65(value: Int32) -> Bool { this.Fact("sq021_river_hates_v", value); return false; }
  protected cb func Fact66(value: Int32) -> Bool { this.Fact("sq021_randy_saved", value); return false; }
  protected cb func Fact67(value: Int32) -> Bool { this.Fact("sq021_sobchak_friend", value); return false; }
  protected cb func Fact68(value: Int32) -> Bool { this.Fact("sq032_johnny_friend", value); return false; }
  protected cb func Fact69(value: Int32) -> Bool { this.Fact("sq031_rogue_met_johnny", value); return false; }
  protected cb func Fact70(value: Int32) -> Bool { this.Fact("sq031_done", value); return false; }
  protected cb func Fact71(value: Int32) -> Bool { this.Fact("ep1_installed", value); return false; }
  protected cb func Fact72(value: Int32) -> Bool { this.Fact("ep1_standalone", value); return false; }
  protected cb func Fact73(value: Int32) -> Bool { this.Fact("ep1_active", value); return false; }
  protected cb func Fact74(value: Int32) -> Bool { this.Fact("ep1_side_content", value); return false; }
  protected cb func Fact75(value: Int32) -> Bool { this.Fact("q301_00_done", value); return false; }
  protected cb func Fact76(value: Int32) -> Bool { this.Fact("q301_done", value); return false; }
  protected cb func Fact77(value: Int32) -> Bool { this.Fact("q302_done", value); return false; }
  protected cb func Fact78(value: Int32) -> Bool { this.Fact("q303_done", value); return false; }
  protected cb func Fact79(value: Int32) -> Bool { this.Fact("q304_done", value); return false; }
  protected cb func Fact80(value: Int32) -> Bool { this.Fact("q304_songbirds_path", value); return false; }
  protected cb func Fact81(value: Int32) -> Bool { this.Fact("q305_done", value); return false; }
  protected cb func Fact82(value: Int32) -> Bool { this.Fact("q305_songbird_alive", value); return false; }
  protected cb func Fact83(value: Int32) -> Bool { this.Fact("q306_done", value); return false; }
  protected cb func Fact84(value: Int32) -> Bool { this.Fact("q306_finale_deal_done", value); return false; }
  protected cb func Fact85(value: Int32) -> Bool { this.Fact("q306_reed_killed", value); return false; }
  protected cb func Fact86(value: Int32) -> Bool { this.Fact("q306_reed_trusted", value); return false; }
  protected cb func Fact87(value: Int32) -> Bool { this.Fact("q306_somi_betrayed", value); return false; }
  protected cb func Fact88(value: Int32) -> Bool { this.Fact("q307_aborted", value); return false; }
  protected cb func Fact89(value: Int32) -> Bool { this.Fact("q307_main_game_killed", value); return false; }
  protected cb func Fact90(value: Int32) -> Bool { this.Fact("q307_done", value); return false; }
  protected cb func Fact91(value: Int32) -> Bool { this.Fact("q302_jacob_killed", value); return false; }
  protected cb func Fact92(value: Int32) -> Bool { this.Fact("q304_kurt_dead", value); return false; }
}

// Source: 2.31 cyberpunk/UI/interactions/dialogUI.script:57. This script consumer is hookable; no native wrapper or poll.
@wrapMethod(dialogWidgetGameController)
protected func UpdateDialogsData(const data: script_ref<DialogChoiceHubs>) -> Void {
  wrappedMethod(data);
  if XFWorldOut.On() && XFBridge_Live() {
    let feed = XFWorldOut.System();
    if IsDefined(feed) { feed.Hubs(data); }
  }
}

@wrapMethod(PreventionSystem)
private final func ChangeHeatStage(newHeatStage: EPreventionHeatStage, heatChangeReason: String) -> Void {
  wrappedMethod(newHeatStage, heatChangeReason);
  if XFWorldOut.On() && XFBridge_Live() {
    XFWorldOut.Emit("heat", "\"what\":\"stage\",\"stage\":" + IntToString(EnumInt(newHeatStage)) + ",\"reason\":" + XFJson.Str(StrLeft(heatChangeReason, 256)));
  }
}
