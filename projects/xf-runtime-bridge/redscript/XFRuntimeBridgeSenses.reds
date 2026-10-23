// XF Runtime Bridge: the senses for the Story Engine (read-only; research/story-engine/runtime-requirements.md S2 to S6).
//
// Five reads, none of which changes the game:
//   world.facts (XFSenses.Facts)       a batch of named quest facts, validated by the plugin (up to 128 names)
//   world.district (XFSenses.District) the district stack's innermost area and its parents: district, subdistrict, place
//   player.status (XFSenses.Status)    V's health, level and street cred, money, wanted level, current vehicle, an inventory
//                                      summary by item type, and the scanner (is V scanning, and what)
//   scene.read's npc_detail (XFSenses.Characters) each NPC's character record: affiliation, type, rarity, archetype, crowd
//                                      flags, attitude group (looked up by the record name the scene read already gave)
//
// With no world to read, a caller sees one of two refusals. The plugin's gate (the script layer, checked on the game thread
// before any script is called) answers game_loading on the main menu, between sessions and during a load, so the script is
// never reached then. This script's own game_not_ready (NotReady) is for when the gate is open but the game's phase has no
// world (starting, main_menu, loading, shutting_down). Every read runs inside that gate like any game-thread method. The world-object rule holds (XFScene.Identity): on a world
// object of unknown type (the vehicle, the scanned object) every native's answer is kept in a local before any text is built.
//
// Sources [source] 2.31 (the game's scripts, decompiled with redscript-cli 0.5.31 from final.redscripts, SHA-256
// 2119046f..ee86; none of these reads has run in game yet): PreventionSystem.GetCurrentDistrict, GetHeatStage, GetStarState,
// IsChasingPlayer (core/systems/preventionSystem.script:340-404), District and DistrictManager (core/systems/prevention/
// districtManager.script), District_Record (orphans.script), the UI_Map blackboard (blackboardDefinitions.script:1702),
// Character_Record and Affiliation_Record (orphans.script), StatPoolsSystem.GetStatPoolValue, PlayerDevelopmentSystem.
// GetProficiencyLevel (cyberpunk/systems/playerDevelopmentSystem.script:3101), TransactionSystem.GetItemQuantity and
// GetItemList, MarketSystem.Money (cyberpunk/systems/marketSystem/marketSystem.script:133), VehicleComponent.GetVehicle
// (core/components/scriptComponents/vehicleComponent.script:337), the UI_Scanner blackboard (ScannedObject, CurrentProgress,
// ScannerLookAt) and the player state machine's Vision (gamePSMVision.Focus). CityAreaType is not read anywhere here: it read
// 0 everywhere in session 14, so it is not a district or zone signal (knowledge/game-events.md section 5).

module XFRuntimeBridge

public abstract class XFSenses {
  // The phase in which there is no world to read, or "" when the senses may read.
  public static func NotReady() -> String {
    let phase = XFBridgeActions.Phase();
    if Equals(phase, "starting") || Equals(phase, "main_menu") || Equals(phase, "loading") || Equals(phase, "shutting_down") {
      return phase;
    }
    return "";
  }

  public static func NotReadyFail(phase: String) -> String {
    return XFJson.Fail("game_not_ready", "There is no world to read yet (the game is at: " + phase + "). Load a save and try again once V is in the world.");
  }

  // --- world.facts --------------------------------------------------------------------------------------------------

  // names: a comma list the plugin has validated (letters, digits, "_" and "."; at most 128). A fact the game never set
  // reads 0, like a fact set to 0.
  public static func Facts(cid: String, names: String) -> String {
    let why = XFSenses.NotReady();
    if StrLen(why) > 0 {
      return XFSenses.NotReadyFail(why);
    }
    let quests = GameInstance.GetQuestsSystem(GetGameInstance());
    if !IsDefined(quests) {
      return XFJson.Fail("unavailable", "the quest system isn't available");
    }
    XFBridgeLog.Debug(cid, "world facts");
    return "{\"ok\":true,\"facts\":" + XFWorldState.Facts(names) + "}";
  }

  // --- world.district -----------------------------------------------------------------------------------------------

  public static func DistrictRecordJson(record: wref<District_Record>) -> String {
    if !IsDefined(record) {
      return "null";
    }
    let id = TDBID.ToStringDEBUG(record.GetID());
    let enumName = record.EnumName();
    let key = record.LocalizedName();
    let text = StrLen(key) > 0 ? GetLocalizedText(key) : "";
    let type = EnumValueToString("gamedataDistrict", Cast<Int64>(EnumInt(record.Type())));
    let out = "{\"id\":" + XFJson.Str(id) + ",\"enum\":" + XFJson.Str(enumName) + ",\"name\":" + XFJson.Str(text) + ",\"name_key\":" + XFJson.Str(key);
    out += ",\"type\":" + XFJson.Str(type) + ",\"quest_district\":" + XFJson.Flag(record.IsQuestDistrict()) + ",\"crime_multiplier\":" + XFJson.Num(record.CrimeMultiplier());
    out += ",\"gangs\":[";
    let count = record.GetGangsCount();
    let i = 0;
    let emitted = 0;
    while i < count {
      let gang = record.GetGangsItem(i);
      // The separator follows the entries written, not the index: a skipped record must not leave a comma behind.
      if IsDefined(gang) {
        if emitted > 0 {
          out += ",";
        }
        out += XFJson.Name(gang.EnumName());
        emitted += 1;
      }
      i += 1;
    }
    return out + "]}";
  }

  // The innermost area V is in and its parents (a place inside a subdistrict inside a district), the effective prevention
  // preset, and the map's own location strings as a cross-check. District is not position: player.state has the position.
  public static func District(cid: String) -> String {
    let why = XFSenses.NotReady();
    if StrLen(why) > 0 {
      return XFSenses.NotReadyFail(why);
    }
    let game = GetGameInstance();
    let prevention = GameInstance.GetScriptableSystemsContainer(game).Get(n"PreventionSystem") as PreventionSystem;
    if !IsDefined(prevention) {
      return XFJson.Fail("unavailable", "the prevention system (which keeps the district stack) isn't available");
    }
    let current = prevention.GetCurrentDistrict();
    if !IsDefined(current) {
      return XFJson.Fail("no_district", "The game hasn't told its district system where V is yet. It does so when V crosses an area border, so a moment after a load, or after V moves, it will.");
    }
    let record = current.GetDistrictRecord();
    if !IsDefined(record) {
      return XFJson.Fail("no_district", "The current district has no record.");
    }
    let chain: array<wref<District_Record>>;
    let walk: wref<District_Record> = record;
    while IsDefined(walk) && ArraySize(chain) < 4 {
      ArrayPush(chain, walk);
      walk = walk.ParentDistrict();
    }
    let size = ArraySize(chain);
    let out = "{\"ok\":true,\"levels\":" + IntToString(size) + ",\"area\":" + XFSenses.DistrictRecordJson(chain[0]);
    // The outermost record is the district (Watson), the one inside it the subdistrict (Kabuki), the innermost of three a place
    // (Kabuki_NoTellMotel). With one or two levels the finer names are null.
    out += ",\"district\":" + XFSenses.DistrictRecordJson(chain[size - 1]);
    out += ",\"subdistrict\":" + (size >= 2 ? XFSenses.DistrictRecordJson(chain[size - 2]) : "null");
    out += ",\"place\":" + (size >= 3 ? XFSenses.DistrictRecordJson(chain[size - 3]) : "null");
    out += ",\"chain\":[";
    let i = 0;
    while i < size {
      if i > 0 {
        out += ",";
      }
      out += XFJson.Str(chain[i].EnumName());
      i += 1;
    }
    out += "],\"prevention_preset\":" + XFJson.Str(TDBID.ToStringDEBUG(current.GetPresetID())) + ",\"dogtown\":" + XFJson.Flag(current.IsDogTown()) + ",\"badlands\":" + XFJson.Flag(current.IsBadlands());
    let defs = GetAllBlackboardDefs().UI_Map;
    let board = GameInstance.GetBlackboardSystem(game).Get(defs);
    if IsDefined(board) {
      let mapEnum = board.GetString(defs.currentLocationEnumName);
      let mapName = board.GetString(defs.currentLocation);
      out += ",\"map\":{\"enum\":" + XFJson.Str(mapEnum) + ",\"name_key\":" + XFJson.Str(mapName) + ",\"agrees\":" + XFJson.Flag(Equals(mapEnum, record.EnumName())) + ",\"new_location\":" + XFJson.Flag(board.GetBool(defs.newLocationDiscovered)) + "}";
    }
    let player = GetPlayer(game);
    if IsDefined(player) {
      out += ",\"position\":" + XFScene.Arr(player.GetWorldPosition());
    }
    XFBridgeLog.Debug(cid, "world district " + record.EnumName());
    return out + "}";
  }

  // --- scene.read's npc_detail --------------------------------------------------------------------------------------

  public static func CharacterJson(record: ref<Character_Record>) -> String {
    if !IsDefined(record) {
      return "null";
    }
    let affiliation = record.Affiliation();
    let npcType = record.CharacterType();
    let rarity = record.Rarity();
    let quest = record.Quest();
    let archetype = record.ArchetypeData();
    let archetypeType: wref<ArchetypeType_Record>;
    if IsDefined(archetype) {
      archetypeType = archetype.Type();
    }
    let out = "{\"affiliation\":" + (IsDefined(affiliation) ? "{\"record\":" + XFJson.Str(TDBID.ToStringDEBUG(affiliation.GetID())) + ",\"name\":" + XFJson.Name(affiliation.EnumName()) + "}" : "null");
    out += ",\"npc_type\":" + (IsDefined(npcType) ? XFJson.Name(npcType.EnumName()) : "null");
    out += ",\"rarity\":" + (IsDefined(rarity) ? XFJson.Name(rarity.EnumName()) : "null");
    out += ",\"quest_affiliation\":" + (IsDefined(quest) ? XFJson.Name(quest.EnumName()) : "null");
    out += ",\"archetype\":" + (IsDefined(archetypeType) ? XFJson.Name(archetypeType.EnumName()) : "null");
    out += ",\"attitude_group\":" + XFJson.Name(record.BaseAttitudeGroup()) + ",\"voice_tag\":" + XFJson.Name(record.VoiceTag()) + ",\"display_name\":" + XFJson.Name(record.DisplayName());
    out += ",\"crowd\":" + XFJson.Flag(record.IsCrowd()) + ",\"light_crowd\":" + XFJson.Flag(record.IsLightCrowd()) + ",\"child\":" + XFJson.Flag(record.IsChild());
    return out + "}";
  }

  // records: a comma list of character record names the plugin took from the scene read's own rows. The answer is keyed by
  // record name; a name the game has no record for answers null.
  public static func Characters(cid: String, records: String) -> String {
    let why = XFSenses.NotReady();
    if StrLen(why) > 0 {
      return XFSenses.NotReadyFail(why);
    }
    let list = StrSplit(records, ",");
    let out = "{\"ok\":true,\"characters\":{";
    let i = 0;
    while i < ArraySize(list) {
      if i > 0 {
        out += ",";
      }
      let record = TweakDBInterface.GetCharacterRecord(TDBID.Create(list[i]));
      out += XFJson.Str(list[i]) + ":" + XFSenses.CharacterJson(record);
      i += 1;
    }
    XFBridgeLog.Debug(cid, "characters " + IntToString(ArraySize(list)));
    return out + "}}";
  }

  // --- player.status ------------------------------------------------------------------------------------------------

  public static func Vitals(game: GameInstance, player: ref<PlayerPuppet>) -> String {
    let pools = GameInstance.GetStatPoolsSystem(game);
    if !IsDefined(pools) {
      return "null";
    }
    let id = Cast<StatsObjectID>(player.GetEntityID());
    let value = pools.GetStatPoolValue(id, gamedataStatPoolType.Health, false);
    let percent = pools.GetStatPoolValue(id, gamedataStatPoolType.Health, true);
    let maximum = pools.GetStatPoolMaxPointValue(id, gamedataStatPoolType.Health);
    return "{\"health\":" + XFJson.Num(value) + ",\"health_max\":" + XFJson.Num(maximum) + ",\"health_percent\":" + XFJson.Num(percent) + ",\"dead\":" + XFJson.Flag(player.IsDead()) + ",\"in_combat\":" + XFJson.Flag(player.IsInCombat()) + "}";
  }

  public static func Progress(game: GameInstance, player: ref<PlayerPuppet>) -> String {
    let development = PlayerDevelopmentSystem.GetInstance(player);
    if !IsDefined(development) {
      return "null";
    }
    let level = development.GetProficiencyLevel(player, gamedataProficiencyType.Level);
    let levelExp = development.GetCurrentLevelProficiencyExp(player, gamedataProficiencyType.Level);
    let levelRemaining = development.GetRemainingExpForLevelUp(player, gamedataProficiencyType.Level);
    let cred = development.GetProficiencyLevel(player, gamedataProficiencyType.StreetCred);
    let credExp = development.GetCurrentLevelProficiencyExp(player, gamedataProficiencyType.StreetCred);
    let credRemaining = development.GetRemainingExpForLevelUp(player, gamedataProficiencyType.StreetCred);
    return "{\"level\":" + IntToString(level) + ",\"level_exp\":" + IntToString(levelExp) + ",\"level_exp_to_next\":" + IntToString(levelRemaining) + ",\"street_cred\":" + IntToString(cred) + ",\"street_cred_exp\":" + IntToString(credExp) + ",\"street_cred_exp_to_next\":" + IntToString(credRemaining) + "}";
  }

  public static func Money(game: GameInstance, player: ref<PlayerPuppet>) -> String {
    let transactions = GameInstance.GetTransactionSystem(game);
    if !IsDefined(transactions) {
      return "null";
    }
    return IntToString(transactions.GetItemQuantity(player, MarketSystem.Money()));
  }

  // The prevention system's heat (the wanted stars): the stage 0 to 5, the star state (Default, Active, Searching, Blinking)
  // and whether the police chase V, with the two quest facts session 14 read beside a real chase (wanted_level and
  // wanted_chase_active) so the two sources can be compared.
  public static func Heat(game: GameInstance) -> String {
    let prevention = GameInstance.GetScriptableSystemsContainer(game).Get(n"PreventionSystem") as PreventionSystem;
    if !IsDefined(prevention) {
      return "null";
    }
    let stage = EnumInt(prevention.GetHeatStage());
    let starState = EnumValueToString("EStarState", Cast<Int64>(EnumInt(prevention.GetStarState())));
    let quests = GameInstance.GetQuestsSystem(game);
    let out = "{\"stage\":" + IntToString(stage) + ",\"star_state\":" + XFJson.Str(starState) + ",\"chasing\":" + XFJson.Flag(prevention.IsChasingPlayer()) + ",\"system_enabled\":" + XFJson.Flag(prevention.IsSystemEnabled()) + ",\"system_locked\":" + XFJson.Flag(prevention.IsSystemLocked());
    if IsDefined(quests) {
      out += ",\"facts\":{\"wanted_level\":" + IntToString(quests.GetFactStr("wanted_level")) + ",\"wanted_chase_active\":" + IntToString(quests.GetFactStr("wanted_chase_active")) + "}";
    }
    return out + "}";
  }

  public static func Vehicle(game: GameInstance, player: ref<PlayerPuppet>) -> String {
    let vehicle: wref<VehicleObject>;
    if !VehicleComponent.IsMountedToVehicle(game, player.GetEntityID()) || !VehicleComponent.GetVehicle(game, player.GetEntityID(), vehicle) || !IsDefined(vehicle) {
      return "{\"mounted\":false}";
    }
    // The world-object rule: every native's answer in a local before any text is built.
    let recordId = vehicle.GetRecordID();
    let record = TDBID.ToStringDEBUG(recordId);
    let entityId = EntityID.ToDebugString(vehicle.GetEntityID());
    let className = vehicle.GetClassName();
    let ownedByV = vehicle.IsPlayerVehicle();
    let at = vehicle.GetWorldPosition();
    let driver = VehicleComponent.IsDriver(game, player);
    return "{\"mounted\":true,\"record\":" + XFJson.Str(record) + ",\"id\":" + XFJson.Str(entityId) + ",\"class\":" + XFJson.Name(className) + ",\"driver\":" + XFJson.Flag(driver) + ",\"player_vehicle\":" + XFJson.Flag(ownedByV) + ",\"position\":" + XFScene.Arr(at) + "}";
  }

  // The inventory summary reads at most this many stacks (the list itself is the game's, built whole by GetItemList; what is
  // bounded is the per-stack native calls made on the game thread). A bigger inventory is cut and says so (truncated).
  public static func InventoryCap() -> Int32 {
    return 1500;
  }

  // Item types are indexed by their enum value in plain arrays (no search); a value outside this range is counted as other.
  public static func InventoryTypeLimit() -> Int32 {
    return 512;
  }

  // Counts by item type (the game's gamedataItemType names), not a list: stacks (entries in the inventory) and the quantity
  // summed over them, plus how many stacks carry the Quest tag. Money is an item too, so its type's quantity is the eddies.
  // Bounded work (InventoryCap): the first stacks only, with total_stacks, stacks (the ones read) and truncated saying how much.
  public static func Inventory(game: GameInstance, player: ref<PlayerPuppet>) -> String {
    let transactions = GameInstance.GetTransactionSystem(game);
    if !IsDefined(transactions) {
      return "null";
    }
    let items: array<wref<gameItemData>>;
    if !transactions.GetItemList(player, items) {
      return "{\"stacks\":0,\"total_stacks\":0,\"truncated\":false,\"quest_stacks\":0,\"other_stacks\":0,\"types\":[]}";
    }
    let total = ArraySize(items);
    let limit = XFSenses.InventoryCap();
    let truncated = total > limit;
    if !truncated {
      limit = total;
    }
    let typeLimit = XFSenses.InventoryTypeLimit();
    let stacks: array<Int32>;
    let quantity: array<Int32>;
    let quest = 0;
    let read = 0;
    let other = 0;
    let i = 0;
    while i < limit {
      let item = items[i];
      if IsDefined(item) {
        let type = EnumInt(item.GetItemType());
        if type >= 0 && type < typeLimit {
          while ArraySize(stacks) <= type {
            ArrayPush(stacks, 0);
            ArrayPush(quantity, 0);
          }
          stacks[type] += 1;
          quantity[type] += item.GetQuantity();
        } else {
          other += 1;
        }
        if item.HasTag(n"Quest") {
          quest += 1;
        }
        read += 1;
      }
      i += 1;
    }
    let out = "{\"stacks\":" + IntToString(read) + ",\"total_stacks\":" + IntToString(total) + ",\"truncated\":" + XFJson.Flag(truncated) + ",\"quest_stacks\":" + IntToString(quest) + ",\"other_stacks\":" + IntToString(other) + ",\"types\":[";
    let emitted = 0;
    i = 0;
    while i < ArraySize(stacks) {
      if stacks[i] > 0 {
        if emitted > 0 {
          out += ",";
        }
        out += "{\"type\":" + XFJson.Str(EnumValueToString("gamedataItemType", Cast<Int64>(i))) + ",\"stacks\":" + IntToString(stacks[i]) + ",\"quantity\":" + IntToString(quantity[i]) + "}";
        emitted += 1;
      }
      i += 1;
    }
    return out + "]}";
  }

  // Whether V is in scanner mode (the player state machine's Vision is Focus) and what the scanner has: the entity the
  // scanner panel is on (the UI_Scanner blackboard's ScannedObject; the game leaves the last one set, so scanning says whether
  // it is live), the scan's progress and whether the scanner's look-at is on. The object is described by the world-object
  // rule (id, class, distance, record).
  public static func Scanner(game: GameInstance, player: ref<PlayerPuppet>) -> String {
    let psmDefs = GetAllBlackboardDefs().PlayerStateMachine;
    let vision = XFPlayer.Psm(player, psmDefs.Vision);
    let defs = GetAllBlackboardDefs().UI_Scanner;
    let board = GameInstance.GetBlackboardSystem(game).Get(defs);
    let out = "{\"scanning\":" + XFJson.Flag(vision == 1) + ",\"vision\":" + IntToString(vision);
    if !IsDefined(board) {
      return out + ",\"scanned_object\":null}";
    }
    let scannedId = board.GetEntityID(defs.ScannedObject);
    let progress = board.GetFloat(defs.CurrentProgress);
    let lookAt = board.GetBool(defs.ScannerLookAt);
    out += ",\"progress\":" + XFJson.Num(progress) + ",\"scanner_look_at\":" + XFJson.Flag(lookAt);
    if !EntityID.IsDefined(scannedId) {
      return out + ",\"scanned_object\":null}";
    }
    let scanned = GameInstance.FindEntityByID(game, scannedId) as GameObject;
    if !IsDefined(scanned) {
      return out + ",\"scanned_object\":{\"id\":" + XFJson.Str(EntityID.ToDebugString(scannedId)) + ",\"loaded\":false}}";
    }
    return out + ",\"scanned_object\":{" + XFScene.Identity(scanned, player.GetWorldPosition()) + ",\"loaded\":true}}";
  }

  // player.status. parts: a comma list of vitals, progress, money, heat, vehicle, inventory, scanner ("" = all).
  public static func Status(cid: String, parts: String) -> String {
    let why = XFSenses.NotReady();
    if StrLen(why) > 0 {
      return XFSenses.NotReadyFail(why);
    }
    let game = GetGameInstance();
    let player = GetPlayer(game);
    if !IsDefined(player) || !player.IsAttached() {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    let out = "{\"ok\":true,\"phase\":" + XFJson.Str(XFBridgeActions.Phase());
    if XFScene.Has(parts, "vitals") {
      out += ",\"vitals\":" + XFSenses.Vitals(game, player);
    }
    if XFScene.Has(parts, "progress") {
      out += ",\"progress\":" + XFSenses.Progress(game, player);
    }
    if XFScene.Has(parts, "money") {
      out += ",\"money\":" + XFSenses.Money(game, player);
    }
    if XFScene.Has(parts, "heat") {
      out += ",\"heat\":" + XFSenses.Heat(game);
    }
    if XFScene.Has(parts, "vehicle") {
      out += ",\"vehicle\":" + XFSenses.Vehicle(game, player);
    }
    if XFScene.Has(parts, "inventory") {
      out += ",\"inventory\":" + XFSenses.Inventory(game, player);
    }
    if XFScene.Has(parts, "scanner") {
      out += ",\"scanner\":" + XFSenses.Scanner(game, player);
    }
    XFBridgeLog.Debug(cid, "player status parts=" + parts);
    return out + "}";
  }
}
