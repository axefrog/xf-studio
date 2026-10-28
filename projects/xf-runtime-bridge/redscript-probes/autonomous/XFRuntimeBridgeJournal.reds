module XFRuntimeBridge

// Autonomous test package only. Does not create journal entries or advance any quest.
public abstract class XFJournalTest {
  public static func Track(hash: Uint32, path: String) -> String {
    if (XFBridge_ProbeFlags() & 9) != 9 { return XFJson.Fail("test_hooks_off", "Journal tracking needs autonomous test hooks"); }
    if !XFBridge_Live() { return XFJson.Fail("game_loading", "Wait for player attachment"); }
    let journal = GameInstance.GetJournalManager(GetGameInstance());
    if !IsDefined(journal) { return XFJson.Fail("game_not_ready", "Journal manager unavailable"); }
    let entry: wref<JournalEntry>;
    if StrLen(path) > 0 {
      entry = journal.GetEntryByString(path, "gameJournalQuest");
      if !IsDefined(entry) { entry = journal.GetEntryByString(path, "gameJournalQuestObjective"); }
    } else {
      entry = journal.GetEntry(hash);
    }
    if !IsDefined(entry) { return XFJson.Fail("bad_params", "No existing journal quest/objective matches entry"); }
    let quest = entry as JournalQuest;
    let objective = entry as JournalQuestObjective;
    if !IsDefined(quest) && !IsDefined(objective) { return XFJson.Fail("bad_params", "Only an existing quest or objective can be tracked"); }
    let state = journal.GetEntryState(entry);
    if NotEquals(state, gameJournalEntryState.Active) { return XFJson.Fail("precondition_failed", "Choose an active journal quest/objective"); }
    let already = journal.IsEntryTracked(entry);
    if already { return XFJson.Fail("precondition_failed", "Choose a different active entry; this one is already tracked"); }
    let previous = journal.GetTrackedEntry();
    let previousHash = IsDefined(previous) ? ToString(Cast<Uint32>(journal.GetEntryHash(previous))) : "null";
    let requestedHash = Cast<Uint32>(journal.GetEntryHash(entry));
    journal.TrackEntry(entry);
    let tracked = journal.GetTrackedEntry();
    let trackedHash = IsDefined(tracked) ? ToString(Cast<Uint32>(journal.GetEntryHash(tracked))) : "null";
    return "{\"ok\":true,\"submitted\":true,\"requested_hash\":" + ToString(requestedHash) + ",\"previous_hash\":" + previousHash + ",\"tracked_hash\":" + trackedHash + "}";
  }
}
