// XF Runtime Bridge: V's clothing, manual saves and loading (bridge 0.4, requested after session 3 so
// fewer steps need the player's hands).
//
// Called by the native plugin like XFRuntimeBridgeActions.reds: one static function per step, each
// answering a JSON object as a String. The plugin gates every one of them: inventory.* behind the
// "inventory" write class (off by default, and off in every package until the maintainer approves it),
// game.save and game.load behind the "save" write class. Vanilla 2.31 script types only, linted against
// the game's own script bundle.
//
// What each call may change, and its undo:
//   inventory.equip    adds the item to V's inventory only when asked (add_if_missing) and remembers it,
//                      then queues the equipment system's own EquipRequest, as the inventory screen does
//                      (temp_armor_equip.script, invisibleSceneStash.script:77-90). Undo: the earlier
//                      item back (or the slot emptied), and an added item removed again.
//   inventory.unequip  the equipment system's UnequipRequest for one clothing slot; removes an item only
//                      if the bridge itself added it this session (remove_added).
//   game.save          one new manual save through the game's own ManualSave("ManualSave-"), exactly as
//                      the save menu's empty slot does (saveGameMenu.script:156-158). Never overwrites or
//                      deletes a save. Refused while the bridge holds its own save lock unless the caller
//                      overrides it, and then the lock goes back on as soon as the save finishes.
//   game.load          the game's quick-load path (LoadLastCheckpoint, inGameMenuGameController.script
//                      :559-566) or one save by name from the game's own save list (LoadSavedGame).

module XFRuntimeBridge

public abstract class XFInventory {
  // Clothing only: the areas the inventory's wardrobe slots use. Weapons, cyberware and quest items are
  // never touched.
  public static func AreaByName(name: String) -> gamedataEquipmentArea {
    if Equals(name, "Head") {
      return gamedataEquipmentArea.Head;
    }
    if Equals(name, "Face") {
      return gamedataEquipmentArea.Face;
    }
    if Equals(name, "OuterChest") {
      return gamedataEquipmentArea.OuterChest;
    }
    if Equals(name, "InnerChest") {
      return gamedataEquipmentArea.InnerChest;
    }
    if Equals(name, "Legs") {
      return gamedataEquipmentArea.Legs;
    }
    if Equals(name, "Feet") {
      return gamedataEquipmentArea.Feet;
    }
    if Equals(name, "Outfit") {
      return gamedataEquipmentArea.Outfit;
    }
    return gamedataEquipmentArea.Invalid;
  }

  public static func AreaName(area: gamedataEquipmentArea) -> String {
    switch area {
      case gamedataEquipmentArea.Head:
        return "Head";
      case gamedataEquipmentArea.Face:
        return "Face";
      case gamedataEquipmentArea.OuterChest:
        return "OuterChest";
      case gamedataEquipmentArea.InnerChest:
        return "InnerChest";
      case gamedataEquipmentArea.Legs:
        return "Legs";
      case gamedataEquipmentArea.Feet:
        return "Feet";
      case gamedataEquipmentArea.Outfit:
        return "Outfit";
    }
    return "";
  }

  public static func Player() -> ref<PlayerPuppet> {
    return GetPlayer(GetGameInstance());
  }

  // The item record's equipment area, or Invalid when the record doesn't exist or isn't clothing.
  public static func ItemArea(tdbid: TweakDBID) -> gamedataEquipmentArea {
    let record = TweakDBInterface.GetItemRecord(tdbid);
    if !IsDefined(record) {
      return gamedataEquipmentArea.Invalid;
    }
    let area = record.EquipArea();
    if !IsDefined(area) {
      return gamedataEquipmentArea.Invalid;
    }
    let type = area.Type();
    if StrLen(XFInventory.AreaName(type)) == 0 {
      return gamedataEquipmentArea.Invalid;
    }
    return type;
  }

  // V's first inventory item made from this record, or an invalid ItemID.
  public static func FindItem(player: ref<PlayerPuppet>, tdbid: TweakDBID) -> ItemID {
    let items: array<wref<gameItemData>>;
    let none: ItemID;
    if !GameInstance.GetTransactionSystem(GetGameInstance()).GetItemList(player, items) {
      return none;
    }
    let i = 0;
    while i < ArraySize(items) {
      if IsDefined(items[i]) && ItemID.GetTDBID(items[i].GetID()) == tdbid {
        return items[i].GetID();
      }
      i += 1;
    }
    return none;
  }

  public static func Equipped(player: ref<PlayerPuppet>, area: gamedataEquipmentArea) -> ItemID {
    return EquipmentSystem.GetInstance(player).GetItemInEquipSlot(player, area, 0);
  }

  public static func ItemName(id: ItemID) -> String {
    if !ItemID.IsValid(id) {
      return "";
    }
    return TDBID.ToStringDEBUG(ItemID.GetTDBID(id));
  }

  // An item's exact identity (0.6.1, RB-84): its combined hash, as decimal text; "" for no item.
  public static func Hash(id: ItemID) -> String {
    return ItemID.IsValid(id) ? ToString(ItemID.GetCombinedHash(id)) : "";
  }

  // The snapshot JSON's `"id"` field for an item ("" for none), so an undo can find the same copy again.
  public static func IdField(id: ItemID) -> String {
    return ItemID.IsValid(id) ? ",\"id\":" + XFJson.Str(XFInventory.Hash(id)) : "";
  }

  // The item a snapshot named (RB-84): the exact copy by its identity (the wardrobe's stored copy, then V's inventory)
  // when `hash` is given and one matches; otherwise the first copy of the record (the wardrobe's, then V's inventory).
  public static func ExactItem(player: ref<PlayerPuppet>, tdbid: TweakDBID, hash: String) -> ItemID {
    if StrLen(hash) > 0 {
      let stored = GameInstance.GetWardrobeSystem(GetGameInstance()).GetStoredItemID(tdbid);
      if ItemID.IsValid(stored) && Equals(XFInventory.Hash(stored), hash) {
        return stored;
      }
      let items: array<wref<gameItemData>>;
      if GameInstance.GetTransactionSystem(GetGameInstance()).GetItemList(player, items) {
        let i = 0;
        while i < ArraySize(items) {
          if IsDefined(items[i]) && ItemID.GetTDBID(items[i].GetID()) == tdbid && Equals(XFInventory.Hash(items[i].GetID()), hash) {
            return items[i].GetID();
          }
          i += 1;
        }
      }
    }
    return XFWardrobe.VisualItem(player, tdbid);
  }

  public static func Refusal() -> String {
    let phase = XFBridgeActions.Phase();
    if NotEquals(phase, "gameplay") {
      return XFJson.Fail("not_in_gameplay", "V's clothing is changed only in normal play; the game is in '" + phase + "'");
    }
    let player = XFInventory.Player();
    if !IsDefined(player) || player.IsReplacer() {
      return XFJson.Fail("not_v", "the player isn't V right now");
    }
    if player.IsInCombat() {
      return XFJson.Fail("not_safe_now", "V is in combat");
    }
    // The inventory's own rule: no equipping in scene tiers 3 to 5 (inventoryItemData.script:842-847).
    if InventoryGPRestrictionHelper.BlockedBySceneTier(player) {
      return XFJson.Fail("not_safe_now", "a scene is playing, where the game doesn't allow changing clothes");
    }
    return "";
  }

  // Step 1 of inventory.equip: checks, adds the item if asked, queues the equip request.
  public static func Equip(cid: String, item: String, area: String, addIfMissing: Bool) -> String {
    let refusal = XFInventory.Refusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    let player = XFInventory.Player();
    let tdbid = TDBID.Create(item);
    let itemArea = XFInventory.ItemArea(tdbid);
    if Equals(itemArea, gamedataEquipmentArea.Invalid) {
      return XFJson.Fail("bad_params", "'" + item + "' isn't a clothing item record (Head, Face, OuterChest, InnerChest, Legs, Feet or Outfit)");
    }
    if StrLen(area) > 0 && NotEquals(XFInventory.AreaByName(area), itemArea) {
      return XFJson.Fail("bad_params", "'" + item + "' goes in the " + XFInventory.AreaName(itemArea) + " slot, not " + area);
    }
    let system = GameInstance.GetTransactionSystem(GetGameInstance());
    let id = XFInventory.FindItem(player, tdbid);
    let added = false;
    if !ItemID.IsValid(id) {
      if !addIfMissing {
        return XFJson.Fail("not_in_inventory", "V doesn't have '" + item + "'; pass add_if_missing to add one");
      }
      XFBridgeActions.EnsureSaveLock(cid);
      if !system.GiveItemByTDBID(player, tdbid, 1) {
        return XFJson.Fail("call_failed", "the game didn't add '" + item + "' to V's inventory");
      }
      id = XFInventory.FindItem(player, tdbid);
      if !ItemID.IsValid(id) {
        return XFJson.Fail("call_failed", "'" + item + "' was added but can't be found in V's inventory");
      }
      added = true;
      XFBridgeRegistry.Get().NoteAddedItem(id);
    }
    let previous = XFInventory.Equipped(player, itemArea);
    let already = ItemID.IsValid(previous) && previous == id;
    if !already {
      XFBridgeActions.EnsureSaveLock(cid);
      let request = new EquipRequest();
      request.owner = player;
      request.itemID = id;
      request.slotIndex = 0;
      request.addToInventory = false;
      EquipmentSystem.GetInstance(player).QueueRequest(request);
    }
    XFBridgeLog.Info(cid, "inventory.equip " + item + " in " + XFInventory.AreaName(itemArea) + " (added=" + XFJson.Flag(added) + ", before '" + XFInventory.ItemName(previous) + "'); undo: equip the earlier item, or unequip, and remove an added item");
    // 0.5.2: an active wardrobe outfit (or a hidden area) decides what the area shows, whatever is equipped there.
    return "{\"ok\":true,\"item\":" + XFJson.Str(item) + ",\"slot\":" + XFJson.Str(XFInventory.AreaName(itemArea)) + ",\"added\":" + XFJson.Flag(added) + ",\"already_equipped\":" + XFJson.Flag(already) + ",\"previous\":" + XFJson.Str(XFInventory.ItemName(previous)) + XFWardrobe.AreaNote(player, itemArea) + "}";
  }

  // What a slot holds now (the second step reads it a few frames after the request).
  public static func Slot(cid: String, area: String, item: String) -> String {
    let player = XFInventory.Player();
    if !IsDefined(player) {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    let type = XFInventory.AreaByName(area);
    if StrLen(item) > 0 {
      type = XFInventory.ItemArea(TDBID.Create(item));
    }
    if Equals(type, gamedataEquipmentArea.Invalid) {
      return XFJson.Fail("bad_params", "unknown clothing slot '" + area + "'");
    }
    let now = XFInventory.Equipped(player, type);
    // Whether the slot holds the item asked about, compared by record ID here rather than by debug name in
    // the plugin (RB-63).
    let matches = StrLen(item) > 0 && ItemID.IsValid(now) && ItemID.GetTDBID(now) == TDBID.Create(item);
    return "{\"ok\":true,\"slot\":" + XFJson.Str(XFInventory.AreaName(type)) + ",\"item\":" + XFJson.Str(XFInventory.ItemName(now)) + ",\"empty\":" + XFJson.Flag(!ItemID.IsValid(now)) + ",\"matches\":" + XFJson.Flag(matches) + "}";
  }

  // Step 1 of inventory.unequip: the slot by name, or the slot the item's record uses.
  public static func Unequip(cid: String, area: String, item: String) -> String {
    let refusal = XFInventory.Refusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    let player = XFInventory.Player();
    let type = XFInventory.AreaByName(area);
    if StrLen(item) > 0 {
      type = XFInventory.ItemArea(TDBID.Create(item));
      if Equals(type, gamedataEquipmentArea.Invalid) {
        return XFJson.Fail("bad_params", "'" + item + "' isn't a clothing item record");
      }
    }
    if Equals(type, gamedataEquipmentArea.Invalid) {
      return XFJson.Fail("bad_params", "unknown clothing slot '" + area + "' (Head, Face, OuterChest, InnerChest, Legs, Feet or Outfit)");
    }
    let before = XFInventory.Equipped(player, type);
    if StrLen(item) > 0 && ItemID.IsValid(before) && ItemID.GetTDBID(before) != TDBID.Create(item) {
      return XFJson.Fail("bad_params", "the " + XFInventory.AreaName(type) + " slot holds '" + XFInventory.ItemName(before) + "', not '" + item + "'");
    }
    if ItemID.IsValid(before) {
      XFBridgeActions.EnsureSaveLock(cid);
      let request = new UnequipRequest();
      request.owner = player;
      request.areaType = type;
      request.slotIndex = 0;
      EquipmentSystem.GetInstance(player).QueueRequest(request);
    }
    XFBridgeLog.Info(cid, "inventory.unequip " + XFInventory.AreaName(type) + " (held '" + XFInventory.ItemName(before) + "'); undo: equip it again");
    return "{\"ok\":true,\"slot\":" + XFJson.Str(XFInventory.AreaName(type)) + ",\"previous\":" + XFJson.Str(XFInventory.ItemName(before)) + ",\"was_empty\":" + XFJson.Flag(!ItemID.IsValid(before)) + "}";
  }

  // Removes an item from V's inventory, only the copy the bridge itself added this session (its own ItemID,
  // RB-63: never another copy of the same record V has), and only when it isn't worn.
  public static func RemoveAdded(cid: String, item: String) -> String {
    let player = XFInventory.Player();
    if !IsDefined(player) {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) {
      return XFJson.Fail("game_not_ready", "no game session yet");
    }
    let id = registry.AddedItemFor(TDBID.Create(item));
    if !ItemID.IsValid(id) {
      return XFJson.Fail("not_added_by_bridge", "'" + item + "' wasn't added by the bridge this session, so it stays in V's inventory");
    }
    let system = GameInstance.GetTransactionSystem(GetGameInstance());
    if !system.HasItem(player, id) {
      registry.ForgetAddedItem(id);
      return "{\"ok\":true,\"removed\":false,\"note\":\"V no longer has the copy the bridge added\"}";
    }
    if EquipmentSystem.GetInstance(player).IsEquipped(player, id) {
      return XFJson.Fail("busy", "'" + item + "' is still worn; unequip it first");
    }
    let removed = system.RemoveItem(player, id, 1);
    if removed {
      registry.ForgetAddedItem(id);
    }
    XFBridgeLog.Info(cid, "inventory: removed the item the bridge added, '" + item + "': " + XFJson.Flag(removed));
    return "{\"ok\":true,\"removed\":" + XFJson.Flag(removed) + "}";
  }
}

public abstract class XFGame {
  public static func Handler() -> ref<inkISystemRequestsHandler> {
    return new inkMenuScenario().GetSystemRequestsHandler();
  }

  // Save-lock reasons other than the bridge's in the game's SaveLocksManager (its list is private; the
  // added method below reads it without changing anything).
  public static func OtherScriptLocks() -> Int32 {
    let container = GameInstance.GetScriptableSystemsContainer(GetGameInstance());
    if !IsDefined(container) {
      return 0;
    }
    let manager = container.Get(n"SaveLocksManager") as SaveLocksManager;
    if !IsDefined(manager) {
      return 0;
    }
    return manager.XFBridgeOtherLocks(n"XFRuntimeBridge");
  }

  // Step 1 of game.save: only from normal play; the bridge's own save lock refuses unless overridden, and
  // then it is released for the one save (and taken again when the save finishes).
  public static func SavePrepare(cid: String, overrideLock: Bool) -> String {
    let game = GetGameInstance();
    let phase = XFBridgeActions.Phase();
    if NotEquals(phase, "gameplay") {
      return XFJson.Fail("not_in_gameplay", "a manual save is made only from normal play; the game is in '" + phase + "'");
    }
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) {
      return XFJson.Fail("game_not_ready", "no game session yet");
    }
    if Equals(registry.SaveState(), "pending") {
      return XFJson.Fail("busy", "the previous save hasn't finished yet");
    }
    let ownLock = registry.IsSaveLockHeld() || XFBridgeActions.OwnSaveLockHeld();
    if ownLock && !overrideLock {
      return XFJson.Fail("bridge_save_lock", "the bridge has changed the game since the last load, so it keeps saving locked; a save now would keep those changes. Load a save first, or pass override_lock to save anyway");
    }
    // Only the bridge's own lock may be overridden. Any lock the game holds itself (combat, a scene, a tier,
    // a quest) refuses, and so does a script lock that isn't the bridge's (another system's
    // SaveLocksManager reason).
    let locks: array<gameSaveLock>;
    if GameInstance.IsSavingLocked(game, locks) {
      let i = 0;
      while i < ArraySize(locks) {
        if NotEquals(locks[i].reason, gameSaveLockReason.Script) {
          return XFJson.Fail("saving_locked", "the game doesn't allow saving right now (lock reason " + IntToString(EnumInt(locks[i].reason)) + ")");
        }
        i += 1;
      }
      if XFGame.OtherScriptLocks() > 0 || !ownLock {
        return XFJson.Fail("saving_locked", "another game system holds a save lock right now");
      }
    }
    if ownLock {
      SaveLocksManager.RequestSaveLockRemove(game, n"XFRuntimeBridge");
      registry.SetSaveLockHeld(false);
      registry.SetRelockAfterSave(true);
      XFBridgeLog.Warn(cid, "game.save with override_lock: the bridge's save lock is released for one save and taken again when it finishes");
    }
    return "{\"ok\":true,\"lock_released\":" + XFJson.Flag(ownLock) + "}";
  }

  // What the bridge holds on V that a save would keep (RB-83, game.save refuses while anything is listed): the status
  // effects it applied (a glide's movement hold, a forced crouch) and an outfit it suspended with the story's request.
  public static func BridgeHolds(cid: String) -> String {
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) {
      return "{\"ok\":true,\"holds\":[]}";
    }
    let effects = registry.PlayerEffectsJson();
    let out = StrMid(effects, 1, StrLen(effects) - 2);
    if registry.IsWardrobeSuspended() {
      out += (StrLen(out) > 0 ? "," : "") + "\"outfit suspended by the bridge\"";
    }
    return "{\"ok\":true,\"holds\":[" + out + "]}";
  }

  // Whether saving is locked right now (the plugin waits for the released lock before step 2).
  public static func SavingLocked(cid: String) -> String {
    let locks: array<gameSaveLock>;
    return "{\"ok\":true,\"locked\":" + XFJson.Flag(GameInstance.IsSavingLocked(GetGameInstance(), locks)) + ",\"state\":" + XFJson.Str(XFBridgeRegistry.Get().SaveState()) + "}";
  }

  // Step 2 of game.save: one new manual save, as the save menu's empty slot does.
  public static func Save(cid: String, label: String) -> String {
    let game = GetGameInstance();
    let registry = XFBridgeRegistry.Get();
    let handler = XFGame.Handler();
    let locks: array<gameSaveLock>;
    if !IsDefined(handler) || !IsDefined(registry) {
      return XFJson.Fail("unavailable", "the game's save handler isn't available");
    }
    if GameInstance.IsSavingLocked(game, locks) {
      XFGame.Relock(cid);
      return XFJson.Fail("saving_locked", "the game still reports saving locked, so nothing was saved");
    }
    if !handler.HasFreeSaveSlot("ManualSave-") {
      XFGame.Relock(cid);
      return XFJson.Fail("no_free_slot", "the game has no free manual save slot; delete an old manual save in the game's Load menu, then try again");
    }
    registry.SetSaveState("pending");
    handler.RegisterToCallback(n"OnSavingComplete", registry, n"OnXFBridgeSavingComplete");
    handler.ManualSave("ManualSave-");
    XFBridgeLog.Info(cid, "game.save requested a new manual save (label '" + label + "'); undo: none (delete it in the game's Load menu if unwanted)");
    return "{\"ok\":true,\"requested\":true}";
  }

  public static func Relock(cid: String) -> Void {
    let registry = XFBridgeRegistry.Get();
    if IsDefined(registry) && registry.RelockAfterSave() {
      registry.SetRelockAfterSave(false);
      XFBridgeActions.EnsureSaveLock(cid);
    }
  }

  // The plugin's last step of every game.save that released the lock, whatever happened (RB-52): takes the
  // bridge's save lock back now (nothing to do when the save's completion already did) and cancels the
  // pending relock, so a save finishing later doesn't ask for it twice.
  public static func Retake(cid: String) -> String {
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) {
      return XFJson.Fail("game_not_ready", "no game session yet");
    }
    registry.SetRelockAfterSave(false);
    XFBridgeActions.EnsureSaveLock(cid);
    return "{\"ok\":true,\"save_lock_held\":" + XFJson.Flag(registry.IsSaveLockHeld()) + "}";
  }

  public static func LoadRefusal() -> String {
    let phase = XFBridgeActions.Phase();
    if Equals(phase, "gameplay") || Equals(phase, "menu") || Equals(phase, "paused") {
      return "";
    }
    return XFJson.Fail("not_in_gameplay", "a save is loaded from normal play or the pause menu; the game is in '" + phase + "' (leave photo mode or the appearance screen first)");
  }

  // game.load latest: the game's quick-load path (the most recent save of this playthrough).
  public static func LoadLatest(cid: String) -> String {
    let refusal = XFGame.LoadRefusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    let handler = XFGame.Handler();
    if !IsDefined(handler) || !handler.HasLastCheckpoint() {
      return XFJson.Fail("unavailable", "the game has no save to load for this playthrough");
    }
    XFBridgeLog.Warn(cid, "game.load: loading the latest save (LoadLastCheckpoint); everything since it is discarded, the bridge's save lock with it");
    handler.LoadLastCheckpoint(true);
    return "{\"ok\":true,\"requested\":true,\"route\":\"latest\"}";
  }

  // game.load by name, step 1: ask the game for its save list (answered by OnXFBridgeSavesReady).
  public static func ListSaves(cid: String) -> String {
    let refusal = XFGame.LoadRefusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    let handler = XFGame.Handler();
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(handler) || !IsDefined(registry) {
      return XFJson.Fail("unavailable", "the game's save handler isn't available");
    }
    registry.ClearSaves();
    handler.RegisterToCallback(n"OnSavesForLoadReady", registry, n"OnXFBridgeSavesReady");
    handler.RequestSavesForLoad();
    return "{\"ok\":true,\"requested\":true}";
  }

  public static func Saves(cid: String) -> String {
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) || !registry.SavesReady() {
      return "{\"ok\":true,\"ready\":false,\"saves\":[]}";
    }
    let saves = registry.Saves();
    let out = "{\"ok\":true,\"ready\":true,\"saves\":[";
    let i = 0;
    while i < ArraySize(saves) {
      if i > 0 {
        out += ",";
      }
      out += XFJson.Str(saves[i]);
      i += 1;
    }
    return out + "]}";
  }

  // game.load by name, step 2: looks the exact name up in the list the game just sent (fetched again for
  // this load) and loads that position, in the same game-thread step (RB-58). A name that is missing or
  // listed twice loads nothing.
  public static func LoadNamed(cid: String, name: String) -> String {
    let refusal = XFGame.LoadRefusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    let registry = XFBridgeRegistry.Get();
    let handler = XFGame.Handler();
    if !IsDefined(registry) || !IsDefined(handler) || !registry.SavesReady() {
      return XFJson.Fail("unavailable", "the game's save list isn't available; nothing was loaded");
    }
    let saves = registry.Saves();
    let index = -1;
    let i = 0;
    while i < ArraySize(saves) {
      if Equals(saves[i], name) {
        if index >= 0 {
          return XFJson.Fail("save_not_found", "the game lists more than one save named '" + name + "'; nothing was loaded");
        }
        index = i;
      }
      i += 1;
    }
    if index < 0 {
      return XFJson.Fail("save_not_found", "the game's save list no longer has '" + name + "'; nothing was loaded");
    }
    XFBridgeLog.Warn(cid, "game.load: loading '" + name + "' (position " + IntToString(index) + "); everything since it is discarded, the bridge's save lock with it");
    handler.LoadSavedGame(index);
    return "{\"ok\":true,\"requested\":true,\"route\":\"name\",\"name\":" + XFJson.Str(name) + "}";
  }
}

@addMethod(SaveLocksManager)
public func XFBridgeOtherLocks(reason: CName) -> Int32 {
  let count = 0;
  let i = 0;
  while i < ArraySize(this.m_saveLocks) {
    if NotEquals(this.m_saveLocks[i], reason) {
      count += 1;
    }
    i += 1;
  }
  return count;
}
