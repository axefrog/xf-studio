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
//
// Who decides what V's clothing shows (0.6, session 6's contradiction: set 0 with active true) [source] 2.31
// equipmentSystem.script:1537 and wardrobeSystem.script:36: the wardrobe's active outfit index is Slot1-Slot7 or
// INVALID, and number 0 here is INVALID, the vanilla "no outfit". EquipmentSystemPlayerData.IsVisualSetActive() is that
// index being valid, but a script mod can wrap it: EquipmentEx ORs in its own outfit system and replaces
// EquipWardrobeSet, UnequipWardrobeSet, QuestHideSlot and QuestRestoreSlot with no-ops, and blocks the appearance resets
// UnequipVisuals relies on [source] EquipmentEx 3208ff4 scripts/Overrides/EquipmentSystem.reds. So:
//   manager "wardrobe": the vanilla wardrobe's outfit (set 1-7) decides;
//   manager "script":   IsVisualSetActive() is true with no wardrobe outfit: a script outfit system decides, and the
//                       vanilla requests don't reach it (session 6: EquipmentEx on the test profile);
//   manager "none":     what is equipped shows.
// The one route every manager honours is the story's own: QuestDisableWardrobeSetRequest (the game's "disable visual
// override" and undress scenes; player.script:6312, invisibleSceneStash.script:17) takes the outfit off and remembers it,
// and QuestRestoreWardrobeSetRequest puts it back; EquipmentEx answers them with its own Deactivate and Reactivate, which
// keep the outfit's parts. wardrobe.equip {suspend} and {resume} use that pair, so equipped gear draws under any manager.

module XFRuntimeBridge

public class XFWardrobeSnapshot {
  public let set: Int32; // 0: no outfit active; 1-7: the wardrobe's outfit slots
  public let areas: array<gamedataEquipmentArea>;
  public let items: array<ItemID>;
  public let hidden: array<Bool>;
  // 0.6: a script outfit system's outfit (Equipment-EX: XFRuntimeBridgeEquipmentEx.reds), when one is installed.
  public let scriptKnown: Bool;
  public let scriptActive: Bool;
  public let scriptSlots: array<TweakDBID>;
  public let scriptItems: array<ItemID>;
  // 0.6.1 (RB-84): what a restore being assembled couldn't find any more (an area or outfit slot and the item); the rest
  // is still put back, and the answer names these.
  public let missing: array<String>;
}

// The kill switch's restore under a script outfit system after the bridge suspended it (RB-84): the story's restore
// request is queued, so the outfit's parts go back a moment later, once that request has switched the outfit on again.
public class XFWardrobeRestoreLater extends DelayCallback {
  public let snapshot: ref<XFWardrobeSnapshot>;

  public func Call() -> Void {
    let player = XFInventory.Player();
    if !IsDefined(player) || !IsDefined(this.snapshot) {
      return;
    }
    let applied = XFWardrobe.Apply(player, this.snapshot);
    XFBridgeLog.Info("kill-restore", "wardrobe restored after the resume: " + applied);
  }
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

  // Who decides what V's clothing shows: "wardrobe", "script" or "none" (see the header).
  public static func Manager(data: ref<EquipmentSystemPlayerData>) -> String {
    let system = GameInstance.GetWardrobeSystem(GetGameInstance());
    if IsDefined(system) && NotEquals(system.GetActiveClothingSetIndex(), gameWardrobeClothingSetIndex.INVALID) {
      return "wardrobe";
    }
    if IsDefined(data) && data.IsVisualSetActive() {
      return "script";
    }
    return "none";
  }

  public static func ManagerJson(data: ref<EquipmentSystemPlayerData>) -> String {
    let manager = XFWardrobe.Manager(data);
    let out = "\"manager\":" + XFJson.Str(manager);
    if Equals(manager, "script") {
      out += ",\"managed_by\":" + XFJson.Str(XFScriptOutfit.Name());
    }
    let registry = XFBridgeRegistry.Get();
    out += ",\"suspended_by_bridge\":" + XFJson.Flag(IsDefined(registry) && registry.IsWardrobeSuspended());
    return out;
  }

  public static func ManagedElsewhere(data: ref<EquipmentSystemPlayerData>) -> String {
    let name = XFScriptOutfit.Name();
    let who = StrLen(name) > 0 ? name : "a script mod's outfit system";
    let also = XFScriptOutfit.Present() ? "; wardrobe_equip with item puts an item into that outfit" : "";
    return XFJson.Fail("outfit_managed_elsewhere", "V's outfit is managed by " + who + ", which replaces the wardrobe's own requests, so this change would do nothing; wardrobe_equip with suspend: true takes that outfit off for now (the story's own request), so equipped clothing shows, and resume: true puts it back" + also);
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
    if XFScriptOutfit.Present() {
      XFScriptOutfit.Snapshot(player, snapshot);
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
      out += "{\"area\":" + XFJson.Str(XFInventory.AreaName(snapshot.areas[i])) + ",\"item\":" + XFJson.Str(XFInventory.ItemName(snapshot.items[i])) + XFInventory.IdField(snapshot.items[i]) + ",\"hidden\":" + XFJson.Flag(snapshot.hidden[i]) + "}";
      i += 1;
    }
    out += "]";
    if snapshot.scriptKnown {
      out += ",\"script_outfit\":{\"active\":" + XFJson.Flag(snapshot.scriptActive) + ",\"parts\":[";
      i = 0;
      while i < ArraySize(snapshot.scriptSlots) {
        if i > 0 {
          out += ",";
        }
        out += "{\"slot\":" + XFJson.Str(TDBID.ToStringDEBUG(snapshot.scriptSlots[i])) + ",\"item\":" + XFJson.Str(XFInventory.ItemName(snapshot.scriptItems[i])) + XFInventory.IdField(snapshot.scriptItems[i]) + "}";
        i += 1;
      }
      out += "]}";
    }
    return out + "}";
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
    return ",\"outfit\":{" + XFWardrobe.ManagerJson(data) + ",\"set\":" + IntToString(XFWardrobe.ActiveSet()) + ",\"area\":" + XFJson.Str(XFInventory.AreaName(area)) + ",\"shows\":" + XFJson.Str(shows) + ",\"outfit_item\":" + XFJson.Str(XFInventory.ItemName(data.GetSlotOverridenVisualItem(area))) + "}";
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
    let out = "{\"ok\":true,\"set\":" + IntToString(XFWardrobe.ActiveSet()) + ",\"active\":" + XFJson.Flag(data.IsVisualSetActive()) + "," + XFWardrobe.ManagerJson(data) + ",\"enabled\":" + XFJson.Flag(data.IsWardrobeEnabled()) + ",\"areas\":[";
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
    return out + "],\"script_outfit\":" + XFScriptOutfit.StateJson(player) + "}";
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
  // "equipped" or "hidden" (an area shows what is equipped there, or nothing), "suspend" or "resume" (0.6: the story's
  // own request takes the outfit off, whoever manages it, and puts it back).
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
    let registry = XFBridgeRegistry.Get();
    let manager = XFWardrobe.Manager(data);
    let before = XFWardrobe.Snapshot(player);
    if Equals(mode, "resume") {
      // Only the bridge's own suspend is resumed: a story scene's is the story's to end.
      if !registry.IsWardrobeSuspended() {
        return "{\"ok\":true,\"changed\":false,\"note\":\"the bridge hasn't taken an outfit off, so there is nothing to put back\"," + XFWardrobe.ManagerJson(data) + ",\"before\":" + XFWardrobe.SnapshotJson(before) + "}";
      }
      XFBridgeActions.EnsureSaveLock(cid);
      XFWardrobe.Queue(player, new QuestRestoreWardrobeSetRequest());
      registry.SetWardrobeSuspended(false);
      XFBridgeLog.Info(cid, "wardrobe.equip resume: the outfit the bridge took off is put back (QuestRestoreWardrobeSetRequest)");
      return "{\"ok\":true,\"changed\":true,\"manager_before\":" + XFJson.Str(manager) + ",\"before\":" + XFWardrobe.SnapshotJson(before) + "}";
    }
    if !data.IsWardrobeEnabled() {
      return XFJson.Fail("not_safe_now", "the story has the wardrobe switched off right now");
    }
    if Equals(mode, "suspend") {
      if Equals(manager, "none") {
        return "{\"ok\":true,\"changed\":false,\"note\":\"no outfit decides what V shows, so what is equipped already draws\"," + XFWardrobe.ManagerJson(data) + ",\"before\":" + XFWardrobe.SnapshotJson(before) + "}";
      }
      XFBridgeActions.EnsureSaveLock(cid);
      registry.NoteWardrobeSnapshot(before);
      let off = new QuestDisableWardrobeSetRequest();
      off.blockReequipping = false;
      XFWardrobe.Queue(player, off);
      registry.SetWardrobeSuspended(true);
      XFBridgeLog.Info(cid, "wardrobe.equip suspend: the " + manager + " outfit taken off with the story's request (QuestDisableWardrobeSetRequest); undo: resume");
      return "{\"ok\":true,\"changed\":true,\"manager_before\":" + XFJson.Str(manager) + ",\"before\":" + XFWardrobe.SnapshotJson(before) + "}";
    }
    // Every other change goes through the vanilla wardrobe's requests, which a script outfit system replaces with
    // no-ops (session 6: EquipmentEx), so it is refused there with the route that works.
    if Equals(manager, "script") {
      // A script outfit system the bridge can drive (Equipment-EX): an item goes into its outfit, as its own screen
      // puts it (the snapshot, with the outfit's parts, is the undo); nothing else maps onto it.
      if Equals(mode, "item") && XFScriptOutfit.Present() {
        let wanted = TDBID.Create(item);
        let own = XFInventory.FindItem(player, wanted);
        let id = ItemID.IsValid(own) ? own : XFWardrobe.VisualItem(player, wanted);
        if !ItemID.IsValid(id) {
          return XFJson.Fail("not_in_inventory", "neither the wardrobe nor V's inventory has '" + item + "'; add it first (inventory_equip with add_if_missing)");
        }
        XFBridgeActions.EnsureSaveLock(cid);
        let refused = XFScriptOutfit.Equip(player, id);
        if StrLen(refused) > 0 {
          return refused;
        }
        registry.NoteWardrobeSnapshot(before);
        XFBridgeLog.Info(cid, "wardrobe.equip item " + item + " into " + XFScriptOutfit.Name() + "'s outfit; undo: restore the snapshot (its parts)");
        return "{\"ok\":true,\"changed\":true,\"route\":" + XFJson.Str(XFScriptOutfit.Name()) + ",\"before\":" + XFWardrobe.SnapshotJson(before) + "}";
      }
      return XFWardrobe.ManagedElsewhere(data);
    }
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

  // The undo, and the kill switch's restore: the outfit, then each area exactly as the snapshot had it. With no outfit
  // (set 0) the areas are put back too (0.6, session 6's T9: a hidden Head came back shown because set 0 skipped them):
  // hidden again where it was hidden, shown where it wasn't; an area already as recorded gets no request. Under a script
  // outfit system nothing is queued (its no-ops would only pretend); the answer says so.
  public static func Apply(player: ref<PlayerPuppet>, snapshot: ref<XFWardrobeSnapshot>) -> String {
    let data = XFWardrobe.Data(player);
    // A script outfit system the bridge can drive goes back first (synchronously, through its own functions); under an
    // outfit it had on, the vanilla areas are its business.
    let script = "";
    if snapshot.scriptKnown && XFScriptOutfit.Present() {
      script = XFScriptOutfit.Apply(player, snapshot);
      if snapshot.scriptActive {
        return "script:" + script;
      }
    }
    if Equals(XFWardrobe.Manager(data), "script") {
      return "script";
    }
    if snapshot.set == 0 {
      if XFWardrobe.ActiveSet() != 0 {
        XFWardrobe.Queue(player, new UnequipWardrobeSetRequest());
      }
    } else {
      let request = new EquipWardrobeSetRequest();
      request.setID = WardrobeSystem.NumberToWardrobeClothingSetIndex(snapshot.set - 1);
      XFWardrobe.Queue(player, request);
    }
    let i = 0;
    while i < ArraySize(snapshot.areas) {
      if ItemID.IsValid(snapshot.items[i]) && snapshot.set != 0 {
        let show = new EquipVisualsRequest();
        show.itemID = snapshot.items[i];
        XFWardrobe.Queue(player, show);
      } else {
        if snapshot.hidden[i] {
          if snapshot.set != 0 || !data.IsSlotHidden(snapshot.areas[i]) {
            let hide = new QuestHideSlotRequest();
            hide.slot = snapshot.areas[i];
            XFWardrobe.Queue(player, hide);
          }
        } else {
          if snapshot.set != 0 || data.IsSlotHidden(snapshot.areas[i]) {
            let equipped = new UnequipVisualsRequest();
            equipped.area = snapshot.areas[i];
            XFWardrobe.Queue(player, equipped);
          }
        }
      }
      i += 1;
    }
    return StrLen(script) > 0 ? "script:" + script + ",applied" : "applied";
  }

  // wardrobe.equip {restore}: the plugin passes the snapshot area by area (Begin, one Slot each, then Finish), all in
  // one game-thread step.
  public static func RestoreBegin(cid: String, set: Int32, scriptKnown: Bool, scriptActive: Bool) -> String {
    let refusal = XFInventory.Refusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    if set < 0 || set > 7 {
      return XFJson.Fail("bad_params", "outfit " + IntToString(set) + " is outside 0-7");
    }
    let snapshot = new XFWardrobeSnapshot();
    snapshot.set = set;
    snapshot.scriptKnown = scriptKnown;
    snapshot.scriptActive = scriptActive;
    XFBridgeRegistry.Get().SetWardrobeRestore(snapshot);
    return "{\"ok\":true}";
  }

  // One part of a script outfit (its outfit slot and item) in a restore being assembled. The exact copy by its identity
  // (hash, from the snapshot's "id") when V still has it, else the record's first copy (RB-84); an item neither the
  // wardrobe nor V's inventory has any more is left out and named in the answer, and the rest is still put back.
  public static func RestorePart(cid: String, slot: String, item: String, hash: String) -> String {
    let snapshot = XFBridgeRegistry.Get().WardrobeRestore();
    if !IsDefined(snapshot) {
      return XFJson.Fail("bad_params", "no wardrobe restore was begun");
    }
    let id = XFInventory.ExactItem(XFInventory.Player(), TDBID.Create(item), hash);
    if !ItemID.IsValid(id) {
      ArrayPush(snapshot.missing, slot + ": " + item);
      return "{\"ok\":true,\"missing\":true}";
    }
    ArrayPush(snapshot.scriptSlots, TDBID.Create(slot));
    ArrayPush(snapshot.scriptItems, id);
    return "{\"ok\":true,\"exact\":" + XFJson.Flag(StrLen(hash) > 0 && Equals(XFInventory.Hash(id), hash)) + "}";
  }

  public static func RestoreSlot(cid: String, area: String, item: String, hidden: Bool, hash: String) -> String {
    let registry = XFBridgeRegistry.Get();
    let snapshot = registry.WardrobeRestore();
    let type = XFInventory.AreaByName(area);
    if !IsDefined(snapshot) || Equals(type, gamedataEquipmentArea.Invalid) || Equals(type, gamedataEquipmentArea.Outfit) {
      return XFJson.Fail("bad_params", "unknown area '" + area + "'");
    }
    let id: ItemID;
    if StrLen(item) > 0 {
      id = XFInventory.ExactItem(XFInventory.Player(), TDBID.Create(item), hash);
      if !ItemID.IsValid(id) {
        // Left out (RB-84): the area stays as it is now, and the answer names it.
        ArrayPush(snapshot.missing, area + ": " + item);
        return "{\"ok\":true,\"missing\":true}";
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
    let data = XFWardrobe.Data(player);
    if Equals(XFWardrobe.Manager(data), "script") && !XFScriptOutfit.Present() {
      registry.SetWardrobeRestore(null);
      return XFWardrobe.ManagedElsewhere(data);
    }
    let before = XFWardrobe.Snapshot(player);
    XFBridgeActions.EnsureSaveLock(cid);
    registry.NoteWardrobeSnapshot(before);
    let applied = XFWardrobe.Apply(player, snapshot);
    registry.SetWardrobeRestore(null);
    let missing = "";
    for entry in snapshot.missing {
      missing += (StrLen(missing) > 0 ? "," : "") + XFJson.Str(entry);
    }
    XFBridgeLog.Info(cid, "wardrobe.equip restore: outfit " + IntToString(snapshot.set) + ", " + IntToString(ArraySize(snapshot.areas)) + " areas, " + IntToString(ArraySize(snapshot.scriptSlots)) + " script outfit parts (" + applied + "), " + IntToString(ArraySize(snapshot.missing)) + " left out");
    return "{\"ok\":true,\"changed\":true,\"applied\":" + XFJson.Str(applied) + ",\"not_restored\":[" + missing + "],\"before\":" + XFWardrobe.SnapshotJson(before) + "}";
  }

  // The kill switch: an outfit the bridge took off goes back on first (the story's restore request), then the wardrobe as
  // it was before the bridge's first change this session ("" when it changed nothing).
  public static func RestoreAfterKill(cid: String) -> String {
    let registry = XFBridgeRegistry.Get();
    let player = XFInventory.Player();
    if !IsDefined(registry) || !IsDefined(player) {
      return "";
    }
    let out = "";
    let resumed = false;
    if registry.IsWardrobeSuspended() {
      XFWardrobe.Queue(player, new QuestRestoreWardrobeSetRequest());
      registry.SetWardrobeSuspended(false);
      resumed = true;
      out += ",\"wardrobe_resumed\":true";
    }
    let snapshot = registry.TakeWardrobeSnapshot();
    if !IsDefined(snapshot) {
      return out;
    }
    // RB-84: a script outfit system's parts go back only after the queued resume has switched its outfit on again (its
    // own Reactivate), a moment later; applied now they would run first and be undone by it.
    if resumed && snapshot.scriptKnown && XFScriptOutfit.Present() {
      let later = new XFWardrobeRestoreLater();
      later.snapshot = snapshot;
      GameInstance.GetDelaySystem(GetGameInstance()).DelayCallback(later, 0.5, false);
      return out + ",\"wardrobe_restored\":" + XFWardrobe.SnapshotJson(snapshot) + ",\"wardrobe_restore\":\"after_resume\"";
    }
    let applied = XFWardrobe.Apply(player, snapshot);
    return out + ",\"wardrobe_restored\":" + XFWardrobe.SnapshotJson(snapshot) + ",\"wardrobe_restore\":" + XFJson.Str(applied);
  }
}
