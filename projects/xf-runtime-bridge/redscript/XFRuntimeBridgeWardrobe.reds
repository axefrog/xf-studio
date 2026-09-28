// XF Runtime Bridge: the wardrobe (bridge 0.5.2).
//
// Sessions 4 and 5 equipped a helmet (inventory.equip: slot Head, added) that never drew on V: an active wardrobe
// outfit (2.x transmog) decides what each clothing area shows, and an area the outfit leaves empty is hidden, so an
// equipped item there draws with the empty appearance (EquipmentSystemPlayerData.AddItemToSlot: IsSlotHidden ->
// "empty_appearance_default") [source] 2.31 equipmentSystem.script. The wardrobe screen drives it through the
// equipment system's own requests, which is what this layer queues too; it never edits or saves a stored outfit:
//   EquipWardrobeSetRequest{setID}   apply outfit n (the wardrobe screen's Equip; wardrobeUIController.script:223)
//   UnequipWardrobeSetRequest        take the outfit off (its Unequip; :230)
//   EquipVisualsRequest{itemID}      show an item in an area of the active outfit (inventoryDataManagerV2.script:2615)
//   UnequipVisualsRequest{area}      show what is equipped in that area instead (:2625)
//   QuestHideSlotRequest{slot}       hide an area (the outfit's empty area; the quest system's own request)
// A snapshot (the active outfit and, per area, the item it shows or whether it hides it) is taken before every change
// and returned as the undo; the first one of a session is kept for the kill switch's restore. Called by the plugin
// behind the inventory write class, like XFInventory.

module XFRuntimeBridge

public class XFWardrobeSnapshot {
  public let set: Int32; // 0: no outfit active; 1-7: the wardrobe's outfit slots
  public let areas: array<gamedataEquipmentArea>;
  public let items: array<ItemID>;
  public let hidden: array<Bool>;
}

public abstract class XFWardrobe {
  public static func Areas() -> array<gamedataEquipmentArea> {
    let areas: array<gamedataEquipmentArea>;
    ArrayPush(areas, gamedataEquipmentArea.Head);
    ArrayPush(areas, gamedataEquipmentArea.Face);
    ArrayPush(areas, gamedataEquipmentArea.OuterChest);
    ArrayPush(areas, gamedataEquipmentArea.InnerChest);
    ArrayPush(areas, gamedataEquipmentArea.Legs);
    ArrayPush(areas, gamedataEquipmentArea.Feet);
    return areas;
  }

  public static func Data(player: ref<PlayerPuppet>) -> ref<EquipmentSystemPlayerData> {
    return EquipmentSystem.GetData(player);
  }

  // The active outfit, 1-7, or 0 when none is.
  public static func ActiveSet() -> Int32 {
    let system = GameInstance.GetWardrobeSystem(GetGameInstance());
    if !IsDefined(system) {
      return 0;
    }
    return WardrobeSystem.WardrobeClothingSetIndexToNumber(system.GetActiveClothingSetIndex()) + 1;
  }

  public static func Snapshot(player: ref<PlayerPuppet>) -> ref<XFWardrobeSnapshot> {
    let data = XFWardrobe.Data(player);
    let snapshot = new XFWardrobeSnapshot();
    snapshot.set = XFWardrobe.ActiveSet();
    let areas = XFWardrobe.Areas();
    let i = 0;
    while i < ArraySize(areas) {
      ArrayPush(snapshot.areas, areas[i]);
      ArrayPush(snapshot.items, data.GetSlotOverridenVisualItem(areas[i]));
      ArrayPush(snapshot.hidden, data.IsSlotHidden(areas[i]));
      i += 1;
    }
    return snapshot;
  }

  public static func SnapshotJson(snapshot: ref<XFWardrobeSnapshot>) -> String {
    let out = "{\"set\":" + IntToString(snapshot.set) + ",\"slots\":[";
    let i = 0;
    while i < ArraySize(snapshot.areas) {
      if i > 0 {
        out += ",";
      }
      out += "{\"area\":" + XFJson.Str(XFInventory.AreaName(snapshot.areas[i])) + ",\"item\":" + XFJson.Str(XFInventory.ItemName(snapshot.items[i])) + ",\"hidden\":" + XFJson.Flag(snapshot.hidden[i]) + "}";
      i += 1;
    }
    return out + "]}";
  }

  // What an area shows now: "outfit" (the active outfit's item), "hidden", "equipped" or "empty".
  public static func Shows(data: ref<EquipmentSystemPlayerData>, area: gamedataEquipmentArea) -> String {
    if data.IsSlotHidden(area) {
      return "hidden";
    }
    if data.IsVisualSetActive() && data.IsSlotOverriden(area) {
      return "outfit";
    }
    return ItemID.IsValid(data.GetActiveItem(area)) ? "equipped" : "empty";
  }

  // inventory.equip's note: what the area shows once an item is equipped there, when that isn't the item.
  public static func AreaNote(player: ref<PlayerPuppet>, area: gamedataEquipmentArea) -> String {
    let data = XFWardrobe.Data(player);
    if !IsDefined(data) {
      return "";
    }
    let shows = XFWardrobe.Shows(data, area);
    if Equals(shows, "equipped") || Equals(shows, "empty") {
      return "";
    }
    return ",\"outfit\":{\"set\":" + IntToString(XFWardrobe.ActiveSet()) + ",\"area\":" + XFJson.Str(XFInventory.AreaName(area)) + ",\"shows\":" + XFJson.Str(shows) + ",\"outfit_item\":" + XFJson.Str(XFInventory.ItemName(data.GetSlotOverridenVisualItem(area))) + "}";
  }

  // wardrobe.state (read).
  public static func State(cid: String) -> String {
    let player = XFInventory.Player();
    if !IsDefined(player) {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    let data = XFWardrobe.Data(player);
    if !IsDefined(data) {
      return XFJson.Fail("unavailable", "V's equipment data isn't available");
    }
    let out = "{\"ok\":true,\"set\":" + IntToString(XFWardrobe.ActiveSet()) + ",\"active\":" + XFJson.Flag(data.IsVisualSetActive()) + ",\"enabled\":" + XFJson.Flag(data.IsWardrobeEnabled()) + ",\"areas\":[";
    let areas = XFWardrobe.Areas();
    let i = 0;
    while i < ArraySize(areas) {
      if i > 0 {
        out += ",";
      }
      out += "{\"area\":" + XFJson.Str(XFInventory.AreaName(areas[i])) + ",\"shows\":" + XFJson.Str(XFWardrobe.Shows(data, areas[i])) + ",\"outfit_item\":" + XFJson.Str(XFInventory.ItemName(data.GetSlotOverridenVisualItem(areas[i]))) + ",\"hidden\":" + XFJson.Flag(data.IsSlotHidden(areas[i])) + ",\"equipped\":" + XFJson.Str(XFInventory.ItemName(data.GetActiveItem(areas[i]))) + "}";
      i += 1;
    }
    out += "],\"sets\":[";
    let sets = GameInstance.GetWardrobeSystem(GetGameInstance()).GetClothingSets();
    let first = true;
    i = 0;
    while i < ArraySize(sets) {
      if IsDefined(sets[i]) && !ClothingSet.IsEmpty(sets[i]) {
        if !first {
          out += ",";
        }
        first = false;
        out += "{\"set\":" + IntToString(WardrobeSystem.WardrobeClothingSetIndexToNumber(sets[i].setID) + 1) + ",\"items\":[";
        let j = 0;
        let written = 0;
        while j < ArraySize(sets[i].clothingList) {
          if ItemID.IsValid(sets[i].clothingList[j].visualItem) {
            if written > 0 {
              out += ",";
            }
            out += "{\"area\":" + XFJson.Str(XFInventory.AreaName(sets[i].clothingList[j].areaType)) + ",\"item\":" + XFJson.Str(XFInventory.ItemName(sets[i].clothingList[j].visualItem)) + "}";
            written += 1;
          }
          j += 1;
        }
        out += "]}";
      }
      i += 1;
    }
    return out + "]}";
  }

  // The ItemID to show for a record: the wardrobe's stored copy (as the wardrobe screen uses), else V's own.
  public static func VisualItem(player: ref<PlayerPuppet>, tdbid: TweakDBID) -> ItemID {
    let stored = GameInstance.GetWardrobeSystem(GetGameInstance()).GetStoredItemID(tdbid);
    if ItemID.IsValid(stored) {
      return stored;
    }
    return XFInventory.FindItem(player, tdbid);
  }

  public static func Queue(player: ref<PlayerPuppet>, request: ref<PlayerScriptableSystemRequest>) -> Void {
    request.owner = player;
    EquipmentSystem.GetInstance(player).QueueRequest(request);
  }

  // wardrobe.equip, step 1: checks, the snapshot (the undo; the session's first also kept for the kill switch), then
  // one request. mode: "set" (outfit 1-7), "clear", "item" (a record shown in its area of the active outfit),
  // "equipped" or "hidden" (an area shows what is equipped there, or nothing).
  public static func Change(cid: String, mode: String, set: Int32, item: String, area: String) -> String {
    let refusal = XFInventory.Refusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    let player = XFInventory.Player();
    let data = XFWardrobe.Data(player);
    if !IsDefined(data) {
      return XFJson.Fail("unavailable", "V's equipment data isn't available");
    }
    if !data.IsWardrobeEnabled() {
      return XFJson.Fail("not_safe_now", "the story has the wardrobe switched off right now");
    }
    let registry = XFBridgeRegistry.Get();
    let before = XFWardrobe.Snapshot(player);
    if Equals(mode, "set") {
      let index = WardrobeSystem.NumberToWardrobeClothingSetIndex(set - 1);
      let found = data.FindWardrobeClothingSetByID(index);
      if Equals(index, gameWardrobeClothingSetIndex.INVALID) || !IsDefined(found) || ArraySize(found.clothingList) == 0 {
        return XFJson.Fail("bad_params", "the wardrobe has no outfit in slot " + IntToString(set) + " (wardrobe_state lists them)");
      }
      XFBridgeActions.EnsureSaveLock(cid);
      registry.NoteWardrobeSnapshot(before);
      let request = new EquipWardrobeSetRequest();
      request.setID = index;
      XFWardrobe.Queue(player, request);
    } else {
      if Equals(mode, "clear") {
        if before.set == 0 {
          return "{\"ok\":true,\"changed\":false,\"before\":" + XFWardrobe.SnapshotJson(before) + "}";
        }
        XFBridgeActions.EnsureSaveLock(cid);
        registry.NoteWardrobeSnapshot(before);
        XFWardrobe.Queue(player, new UnequipWardrobeSetRequest());
      } else {
        if Equals(mode, "item") {
          if before.set == 0 {
            return XFJson.Fail("no_active_outfit", "no wardrobe outfit is active, so V shows what is equipped; use inventory_equip instead");
          }
          let tdbid = TDBID.Create(item);
          let itemArea = XFInventory.ItemArea(tdbid);
          if Equals(itemArea, gamedataEquipmentArea.Invalid) || Equals(itemArea, gamedataEquipmentArea.Outfit) {
            return XFJson.Fail("bad_params", "'" + item + "' isn't a clothing item for one area (Head, Face, OuterChest, InnerChest, Legs or Feet)");
          }
          let id = XFWardrobe.VisualItem(player, tdbid);
          if !ItemID.IsValid(id) {
            return XFJson.Fail("not_in_inventory", "neither the wardrobe nor V's inventory has '" + item + "'; add it first (inventory_equip with add_if_missing)");
          }
          XFBridgeActions.EnsureSaveLock(cid);
          registry.NoteWardrobeSnapshot(before);
          let show = new EquipVisualsRequest();
          show.itemID = id;
          XFWardrobe.Queue(player, show);
        } else {
          let type = XFInventory.AreaByName(area);
          if !(Equals(mode, "equipped") || Equals(mode, "hidden")) {
            return XFJson.Fail("bad_params", "unknown wardrobe change '" + mode + "'");
          }
          if Equals(type, gamedataEquipmentArea.Invalid) || Equals(type, gamedataEquipmentArea.Outfit) {
            return XFJson.Fail("bad_params", "unknown area '" + area + "' (Head, Face, OuterChest, InnerChest, Legs or Feet)");
          }
          XFBridgeActions.EnsureSaveLock(cid);
          registry.NoteWardrobeSnapshot(before);
          if Equals(mode, "hidden") {
            let hide = new QuestHideSlotRequest();
            hide.slot = type;
            XFWardrobe.Queue(player, hide);
          } else {
            let equipped = new UnequipVisualsRequest();
            equipped.area = type;
            XFWardrobe.Queue(player, equipped);
          }
        }
      }
    }
    XFBridgeLog.Info(cid, "wardrobe.equip " + mode + " (before: outfit " + IntToString(before.set) + "); undo: restore the snapshot");
    return "{\"ok\":true,\"changed\":true,\"before\":" + XFWardrobe.SnapshotJson(before) + "}";
  }

  // The undo, and the kill switch's restore: the outfit, then each area exactly as the snapshot had it.
  public static func Apply(player: ref<PlayerPuppet>, snapshot: ref<XFWardrobeSnapshot>) -> Void {
    if snapshot.set == 0 {
      if XFWardrobe.ActiveSet() != 0 {
        XFWardrobe.Queue(player, new UnequipWardrobeSetRequest());
      }
      return;
    }
    let request = new EquipWardrobeSetRequest();
    request.setID = WardrobeSystem.NumberToWardrobeClothingSetIndex(snapshot.set - 1);
    XFWardrobe.Queue(player, request);
    let i = 0;
    while i < ArraySize(snapshot.areas) {
      if ItemID.IsValid(snapshot.items[i]) {
        let show = new EquipVisualsRequest();
        show.itemID = snapshot.items[i];
        XFWardrobe.Queue(player, show);
      } else {
        if snapshot.hidden[i] {
          let hide = new QuestHideSlotRequest();
          hide.slot = snapshot.areas[i];
          XFWardrobe.Queue(player, hide);
        } else {
          let equipped = new UnequipVisualsRequest();
          equipped.area = snapshot.areas[i];
          XFWardrobe.Queue(player, equipped);
        }
      }
      i += 1;
    }
  }

  // wardrobe.equip {restore}: the plugin passes the snapshot area by area (Begin, one Slot each, then Finish), all in
  // one game-thread step.
  public static func RestoreBegin(cid: String, set: Int32) -> String {
    let refusal = XFInventory.Refusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    if set < 0 || set > 7 {
      return XFJson.Fail("bad_params", "outfit " + IntToString(set) + " is outside 0-7");
    }
    let snapshot = new XFWardrobeSnapshot();
    snapshot.set = set;
    XFBridgeRegistry.Get().SetWardrobeRestore(snapshot);
    return "{\"ok\":true}";
  }

  public static func RestoreSlot(cid: String, area: String, item: String, hidden: Bool) -> String {
    let registry = XFBridgeRegistry.Get();
    let snapshot = registry.WardrobeRestore();
    let type = XFInventory.AreaByName(area);
    if !IsDefined(snapshot) || Equals(type, gamedataEquipmentArea.Invalid) || Equals(type, gamedataEquipmentArea.Outfit) {
      return XFJson.Fail("bad_params", "unknown area '" + area + "'");
    }
    let id: ItemID;
    if StrLen(item) > 0 {
      id = XFWardrobe.VisualItem(XFInventory.Player(), TDBID.Create(item));
      if !ItemID.IsValid(id) {
        return XFJson.Fail("not_in_inventory", "neither the wardrobe nor V's inventory has '" + item + "' any more");
      }
    }
    ArrayPush(snapshot.areas, type);
    ArrayPush(snapshot.items, id);
    ArrayPush(snapshot.hidden, hidden);
    return "{\"ok\":true}";
  }

  public static func RestoreFinish(cid: String) -> String {
    let player = XFInventory.Player();
    let registry = XFBridgeRegistry.Get();
    let snapshot = registry.WardrobeRestore();
    if !IsDefined(snapshot) || !IsDefined(player) {
      return XFJson.Fail("bad_params", "no wardrobe restore was begun");
    }
    let before = XFWardrobe.Snapshot(player);
    XFBridgeActions.EnsureSaveLock(cid);
    registry.NoteWardrobeSnapshot(before);
    XFWardrobe.Apply(player, snapshot);
    registry.SetWardrobeRestore(null);
    XFBridgeLog.Info(cid, "wardrobe.equip restore: outfit " + IntToString(snapshot.set));
    return "{\"ok\":true,\"changed\":true,\"before\":" + XFWardrobe.SnapshotJson(before) + "}";
  }

  // The kill switch: the wardrobe as it was before the bridge's first change this session ("" when it changed nothing).
  public static func RestoreAfterKill(cid: String) -> String {
    let registry = XFBridgeRegistry.Get();
    let player = XFInventory.Player();
    if !IsDefined(registry) || !IsDefined(player) {
      return "";
    }
    let snapshot = registry.TakeWardrobeSnapshot();
    if !IsDefined(snapshot) {
      return "";
    }
    XFWardrobe.Apply(player, snapshot);
    return ",\"wardrobe_restored\":" + XFWardrobe.SnapshotJson(snapshot);
  }
}
