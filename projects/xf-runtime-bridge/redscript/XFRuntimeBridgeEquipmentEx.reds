// XF Runtime Bridge: V's outfit when Equipment-EX manages it (bridge 0.6).
//
// Session 6 (29 September 2026) met Equipment-EX (psiberx, MIT) on the test profile: its outfit system wraps
// EquipmentSystemPlayerData.IsVisualSetActive (so the wardrobe read "active" with no wardrobe outfit), clears every vanilla
// clothing area's visuals while an outfit is on, and replaces EquipWardrobeSet, UnequipWardrobeSet, QuestHideSlot and
// QuestRestoreSlot with no-ops [source] Equipment-EX 1.2.9 as installed (r6/scripts/EquipmentEx/EquipmentEx.reds; the same
// code as the repository at 3208ff4, scripts/Overrides/EquipmentSystem.reds and scripts/OutfitSystem.reds). Its outfit is a
// list of parts, each an item attached to one of its own outfit slots (TweakDB attachment slots such as OutfitSlots.Head),
// and its own screen changes it through OutfitSystem's public functions. The bridge reads and drives that system directly
// (not its screen): EquipItem(itemID) puts an item V has into the outfit (the route the maintainer's helmet drew by in
// session 6), UnequipSlot empties a slot, Activate/Deactivate switch the outfit on and off; a snapshot of the parts is the
// undo. Everything here compiles only when the EquipmentEx module is present; otherwise XFScriptOutfit says it is absent
// and wardrobe.equip keeps to the vanilla wardrobe and the story's own requests (suspend, resume).

module XFRuntimeBridge

@if(ModuleExists("EquipmentEx"))
import EquipmentEx.OutfitSystem

@if(ModuleExists("EquipmentEx"))
public abstract class XFScriptOutfit {
  public static func Present() -> Bool {
    return true;
  }

  public static func Name() -> String {
    return "EquipmentEx";
  }

  public static func System() -> ref<OutfitSystem> {
    return OutfitSystem.GetInstance(GetGameInstance());
  }

  public static func Active() -> Bool {
    let system = XFScriptOutfit.System();
    return IsDefined(system) && system.IsActive();
  }

  // The outfit's parts: each used outfit slot and the item attached there (read through the transaction system, which
  // is where the outfit's visuals live).
  public static func PartsJson(player: ref<PlayerPuppet>) -> String {
    let system = XFScriptOutfit.System();
    let out = "[";
    if !IsDefined(system) || !IsDefined(player) {
      return "[]";
    }
    let slots = system.GetUsedSlots();
    let transactions = GameInstance.GetTransactionSystem(GetGameInstance());
    let i = 0;
    while i < ArraySize(slots) {
      let item: ItemID;
      let object = transactions.GetItemInSlot(player, slots[i]);
      if IsDefined(object) {
        item = object.GetItemID();
      }
      if i > 0 {
        out += ",";
      }
      out += "{\"slot\":" + XFJson.Str(TDBID.ToStringDEBUG(slots[i])) + ",\"item\":" + XFJson.Str(XFInventory.ItemName(item)) + "}";
      i += 1;
    }
    return out + "]";
  }

  public static func StateJson(player: ref<PlayerPuppet>) -> String {
    let system = XFScriptOutfit.System();
    if !IsDefined(system) {
      return "{\"present\":true,\"available\":false}";
    }
    return "{\"present\":true,\"available\":true,\"name\":\"EquipmentEx\",\"active\":" + XFJson.Flag(system.IsActive()) + ",\"blocked\":" + XFJson.Flag(system.IsBlocked()) + ",\"parts\":" + XFScriptOutfit.PartsJson(player) + "}";
  }

  // The parts as the snapshot keeps them (for the undo and the kill switch).
  public static func Snapshot(player: ref<PlayerPuppet>, snapshot: ref<XFWardrobeSnapshot>) -> Void {
    let system = XFScriptOutfit.System();
    if !IsDefined(system) {
      return;
    }
    snapshot.scriptKnown = true;
    snapshot.scriptActive = system.IsActive();
    let slots = system.GetUsedSlots();
    let transactions = GameInstance.GetTransactionSystem(GetGameInstance());
    let i = 0;
    while i < ArraySize(slots) {
      let object = transactions.GetItemInSlot(player, slots[i]);
      if IsDefined(object) {
        ArrayPush(snapshot.scriptSlots, slots[i]);
        ArrayPush(snapshot.scriptItems, object.GetItemID());
      }
      i += 1;
    }
  }

  // An item V has into the outfit, in its own slot (EquipmentEx picks the slot from the item's placement slots). The
  // outfit must be on. Answers "" or the refusal.
  public static func Equip(player: ref<PlayerPuppet>, item: ItemID) -> String {
    let system = XFScriptOutfit.System();
    if !IsDefined(system) {
      return XFJson.Fail("unavailable", "EquipmentEx's outfit system isn't available");
    }
    if system.IsBlocked() {
      return XFJson.Fail("not_safe_now", "EquipmentEx's outfit is blocked right now (switched off by the story, or an outfit item V can't take off)");
    }
    if !system.IsEquippable(item) {
      return XFJson.Fail("bad_params", "EquipmentEx has no outfit slot for '" + XFInventory.ItemName(item) + "' (it takes clothing only)");
    }
    if !system.EquipItem(item) {
      return XFJson.Fail("failed", "EquipmentEx refused to put '" + XFInventory.ItemName(item) + "' into the outfit");
    }
    return "";
  }

  // The undo and the kill switch's restore: the outfit on or off as recorded, and each slot holding exactly the recorded
  // item (a slot now in use that the snapshot didn't use is emptied). Only slots that differ are touched.
  public static func Apply(player: ref<PlayerPuppet>, snapshot: ref<XFWardrobeSnapshot>) -> String {
    let system = XFScriptOutfit.System();
    if !IsDefined(system) || !snapshot.scriptKnown {
      return "skipped";
    }
    let transactions = GameInstance.GetTransactionSystem(GetGameInstance());
    if snapshot.scriptActive {
      let now = system.GetUsedSlots();
      let i = 0;
      while i < ArraySize(now) {
        if !ArrayContains(snapshot.scriptSlots, now[i]) {
          system.UnequipSlot(now[i]);
        }
        i += 1;
      }
      i = 0;
      while i < ArraySize(snapshot.scriptSlots) {
        let object = transactions.GetItemInSlot(player, snapshot.scriptSlots[i]);
        if !IsDefined(object) || !Equals(object.GetItemID(), snapshot.scriptItems[i]) {
          system.EquipItem(snapshot.scriptItems[i], snapshot.scriptSlots[i]);
        }
        i += 1;
      }
      return "parts";
    }
    if system.IsActive() {
      system.Deactivate();
      return "deactivated";
    }
    return "unchanged";
  }

  public static func HasItem(player: ref<PlayerPuppet>, item: String) -> Bool {
    let system = XFScriptOutfit.System();
    if !IsDefined(system) {
      return false;
    }
    let slots = system.GetUsedSlots();
    let transactions = GameInstance.GetTransactionSystem(GetGameInstance());
    let wanted = TDBID.Create(item);
    let i = 0;
    while i < ArraySize(slots) {
      let object = transactions.GetItemInSlot(player, slots[i]);
      if IsDefined(object) && ItemID.GetTDBID(object.GetItemID()) == wanted {
        return true;
      }
      i += 1;
    }
    return false;
  }
}

@if(!ModuleExists("EquipmentEx"))
public abstract class XFScriptOutfit {
  public static func Present() -> Bool {
    return false;
  }

  public static func Name() -> String {
    return "";
  }

  public static func Active() -> Bool {
    return false;
  }

  public static func StateJson(player: ref<PlayerPuppet>) -> String {
    return "{\"present\":false}";
  }

  public static func Snapshot(player: ref<PlayerPuppet>, snapshot: ref<XFWardrobeSnapshot>) -> Void {}

  public static func Equip(player: ref<PlayerPuppet>, item: ItemID) -> String {
    return XFJson.Fail("outfit_managed_elsewhere", "V's outfit is managed by a script mod the bridge can't drive; wardrobe_equip with suspend: true takes it off for now");
  }

  public static func Apply(player: ref<PlayerPuppet>, snapshot: ref<XFWardrobeSnapshot>) -> String {
    return "skipped";
  }

  public static func HasItem(player: ref<PlayerPuppet>, item: String) -> Bool {
    return false;
  }
}
