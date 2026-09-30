// XF Runtime Bridge: V's cyberware (bridge 0.7; research/runtime/bridge-hook-inventory.md, the render study's capture C6).
//
// Read: what each cyberware area holds (EquipmentSystemPlayerData's slots, as the ripperdoc's grids read them), and for the
// arms the chain the creator's holster state follows (knowledge/body-rendering.md §1.1): the ArmsCW item's holsteredItem ->
// its appearanceName (holstered_strong, holstered_mantis, holstered_nanowire, holstered_launcher; holstered_default for
// the base fists), next to what the right-arm and weapon slots hold now (the live truth: the holstered item, or the drawn
// weapon).
//
// Write (the inventory class, like clothing): equip and unequip through the equipment system's own requests, exactly as the
// ripperdoc screen's EquipCyberware / UnequipCyberware queue them (EquipRequest{owner, itemID, slotIndex},
// UnequipRequest{owner, areaType, slotIndex}; ui/fullscreen/ripperdoc/ripperdoc.script:1231-1443) [source] 2.31. Only
// cyberware areas; an item V doesn't have is added only with add_if_missing and remembered, so unequip {remove_added}
// removes only that copy. No capacity or humanity is checked by the equip request itself (the ripperdoc's own checks are UI
// side), so the bridge reports V's capacity before and after and refuses nothing more than the game's IsEquippable does.
// Every answer names the earlier item for the undo. The save lock is held from the first change; the session ends by
// loading its save.
//
// Deep review of 0.7.0: an item V can't equip is refused before anything changes, and a copy added for it is taken out
// again (RB-101); an undo names the exact earlier copy (RB-109); the arms aren't swapped or emptied while their weapon is
// drawn, and a slot outside the area's unlocked slots is refused (RB-112). The slots as they were before the bridge's first
// change are kept (XFCyberwareSnapshot): game.save refuses while anything differs or an added copy is still in V's
// inventory, and the kill switch puts them back (RB-102).

module XFRuntimeBridge

// V's cyberware slots before the bridge's first change this session (RB-102).
public class XFCyberwareSnapshot {
  public let areas: array<gamedataEquipmentArea>;
  public let slots: array<Int32>;
  public let items: array<ItemID>;
}

// The kill switch's restore removes the copies the bridge added once the queued requests have taken them out of their slots.
public class XFCyberwareRemoveLater extends DelayCallback {
  public func Call() -> Void {
    // Like XFWardrobeRestoreLater (RB-93): the script gate and normal play first; a load discards the change anyway.
    if !XFBridge_Live() {
      return;
    }
    if NotEquals(XFBridgeActions.Phase(), "gameplay") {
      XFBridgeLog.Info("kill-restore", "cyberware copies the bridge added left in place: the game isn't in normal play");
      return;
    }
    let removed = XFCyberware.RemoveAddedCopies("kill-restore");
    XFBridgeLog.Info("kill-restore", "cyberware copies the bridge added removed after the restore: " + IntToString(removed));
  }
}

public abstract class XFCyberware {
  public static func Areas() -> array<gamedataEquipmentArea> {
    let areas: array<gamedataEquipmentArea>;
    ArrayPush(areas, gamedataEquipmentArea.ArmsCW);
    ArrayPush(areas, gamedataEquipmentArea.HandsCW);
    ArrayPush(areas, gamedataEquipmentArea.EyesCW);
    ArrayPush(areas, gamedataEquipmentArea.FaceCW);
    ArrayPush(areas, gamedataEquipmentArea.FrontalCortexCW);
    ArrayPush(areas, gamedataEquipmentArea.SystemReplacementCW);
    ArrayPush(areas, gamedataEquipmentArea.NervousSystemCW);
    ArrayPush(areas, gamedataEquipmentArea.CardiovascularSystemCW);
    ArrayPush(areas, gamedataEquipmentArea.ImmuneSystemCW);
    ArrayPush(areas, gamedataEquipmentArea.IntegumentarySystemCW);
    ArrayPush(areas, gamedataEquipmentArea.MusculoskeletalSystemCW);
    ArrayPush(areas, gamedataEquipmentArea.LegsCW);
    return areas;
  }

  public static func AreaName(area: gamedataEquipmentArea) -> String {
    return EnumValueToString("gamedataEquipmentArea", Cast<Int64>(EnumInt(area)));
  }

  // A cyberware area by its enum name ("ArmsCW"), or Invalid for anything else (clothing and weapons are never touched here).
  public static func AreaByName(name: String) -> gamedataEquipmentArea {
    let areas = XFCyberware.Areas();
    let i = 0;
    while i < ArraySize(areas) {
      if Equals(XFCyberware.AreaName(areas[i]), name) {
        return areas[i];
      }
      i += 1;
    }
    return gamedataEquipmentArea.Invalid;
  }

  // The record's equipment area when it is a cyberware area, else Invalid.
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
    let areas = XFCyberware.Areas();
    return ArrayContains(areas, type) ? type : gamedataEquipmentArea.Invalid;
  }

  public static func Record(id: ItemID) -> String {
    if !ItemID.IsValid(id) {
      return "";
    }
    let tdbid = ItemID.GetTDBID(id);
    return TDBID.ToStringDEBUG(tdbid);
  }

  // The item's on-screen name from its record (record data, never an object's display-name native).
  public static func Label(id: ItemID) -> String {
    if !ItemID.IsValid(id) {
      return "";
    }
    let record = TweakDBInterface.GetItemRecord(ItemID.GetTDBID(id));
    if !IsDefined(record) {
      return "";
    }
    let key = record.DisplayName();
    return GetLocalizedTextByKey(key);
  }

  public static func ItemJson(slot: Int32, id: ItemID) -> String {
    let record = XFCyberware.Record(id);
    let label = XFCyberware.Label(id);
    return "{\"slot\":" + IntToString(slot) + ",\"item\":" + XFJson.Str(record) + ",\"label\":" + XFJson.Str(label) + XFInventory.IdField(id) + "}";
  }

  // The holstered item a weapon record names (the arms' holster chain), or "" when it names none.
  public static func HolsterAppearance(tdbid: TweakDBID, out holstered: String) -> String {
    let weapon = TweakDBInterface.GetWeaponItemRecord(tdbid);
    if !IsDefined(weapon) {
      return "";
    }
    let item = weapon.HolsteredItem();
    if !IsDefined(item) {
      return "";
    }
    holstered = TDBID.ToStringDEBUG(item.GetID());
    let appearance = item.AppearanceName();
    return NameToString(appearance);
  }

  // What an attachment slot on V holds now: {item, appearance} or null.
  public static func SlotJson(player: ref<PlayerPuppet>, slot: TweakDBID) -> String {
    let object = GameInstance.GetTransactionSystem(GetGameInstance()).GetItemInSlot(player, slot);
    if !IsDefined(object) {
      return "null";
    }
    let id = object.GetItemID();
    let record = XFCyberware.Record(id);
    let appearance = "";
    let itemRecord = TweakDBInterface.GetItemRecord(ItemID.GetTDBID(id));
    if IsDefined(itemRecord) {
      appearance = NameToString(itemRecord.AppearanceName());
    }
    return "{\"item\":" + XFJson.Str(record) + ",\"appearance\":" + XFJson.Str(appearance) + "}";
  }

  public static func Arms(player: ref<PlayerPuppet>, data: ref<EquipmentSystemPlayerData>) -> String {
    let item = data.GetItemInEquipSlot(gamedataEquipmentArea.ArmsCW, 0);
    let expected = "holstered_default";
    let holstered = "Items.HolsteredFists";
    let chain = "no arm cyberware: the base fists' holstered item";
    if ItemID.IsValid(item) {
      let named = "";
      let appearance = XFCyberware.HolsterAppearance(ItemID.GetTDBID(item), named);
      if StrLen(appearance) > 0 {
        expected = appearance;
        holstered = named;
        chain = "the ArmsCW item's holsteredItem";
      } else {
        expected = "";
        holstered = "";
        chain = "the ArmsCW item names no holstered item the bridge can read";
      }
    }
    let active = data.GetActiveItem(gamedataEquipmentArea.ArmsCW);
    let out = "{\"item\":" + XFJson.Str(XFCyberware.Record(item)) + ",\"label\":" + XFJson.Str(XFCyberware.Label(item));
    out += ",\"holstered_item\":" + XFJson.Str(holstered) + ",\"holster_state\":" + XFJson.Str(expected) + ",\"creator_group\":" + XFJson.Str(StrLen(expected) > 0 ? expected + "_tpp" : "");
    out += ",\"chain\":" + XFJson.Str(chain) + ",\"active_item\":" + XFJson.Str(XFCyberware.Record(active));
    out += ",\"right_arm_slot\":" + XFCyberware.SlotJson(player, t"AttachmentSlots.RightArm") + ",\"weapon_right_slot\":" + XFCyberware.SlotJson(player, t"AttachmentSlots.WeaponRight");
    let blocked = StatusEffectSystem.ObjectHasStatusEffectWithTag(player, n"NoArmsCW");
    out += ",\"no_arms_cw_effect\":" + XFJson.Flag(blocked) + "}";
    return out;
  }

  // cyberware.state (read). areas: a comma list of area names, or "" for all.
  public static func State(cid: String, areas: String) -> String {
    let player = XFInventory.Player();
    if !IsDefined(player) || !player.IsAttached() {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    let data = EquipmentSystem.GetData(player);
    if !IsDefined(data) {
      return XFJson.Fail("unavailable", "the equipment system has no data for V");
    }
    let out = "{\"ok\":true,\"areas\":[";
    let all = XFCyberware.Areas();
    let written = 0;
    let i = 0;
    while i < ArraySize(all) {
      let name = XFCyberware.AreaName(all[i]);
      if StrLen(areas) == 0 || StrContains("," + areas + ",", "," + name + ",") {
        let slots = data.GetNumberOfSlots(all[i], false);
        if written > 0 {
          out += ",";
        }
        out += "{\"area\":" + XFJson.Str(name) + ",\"slots\":" + IntToString(slots) + ",\"items\":[";
        let s = 0;
        let items = 0;
        while s < slots {
          let id = data.GetItemInEquipSlot(all[i], s);
          if ItemID.IsValid(id) {
            if items > 0 {
              out += ",";
            }
            out += XFCyberware.ItemJson(s, id);
            items += 1;
          }
          s += 1;
        }
        out += "]}";
        written += 1;
      }
      i += 1;
    }
    out += "],\"arms\":" + XFCyberware.Arms(player, data);
    let stats = GameInstance.GetStatsSystem(GetGameInstance());
    let owner = Cast<StatsObjectID>(player.GetEntityID());
    out += ",\"capacity\":{\"humanity_available\":" + XFJson.Num(stats.GetStatValue(owner, gamedataStatType.HumanityAvailable)) + ",\"humanity_total\":" + XFJson.Num(stats.GetStatValue(owner, gamedataStatType.Humanity)) + "}";
    XFBridgeLog.Debug(cid, "cyberware state areas=" + areas);
    return out + "}";
  }

  public static func Refusal() -> String {
    // The clothing rules (normal play, V, no combat, no scene tier 3 to 5) hold for cyberware too.
    return XFInventory.Refusal();
  }

  // RB-112: whether V has an arm cyberware weapon out (the right weapon slot holds an ArmsCW item).
  public static func ArmsDrawn(player: ref<PlayerPuppet>) -> Bool {
    let object = GameInstance.GetTransactionSystem(GetGameInstance()).GetItemInSlot(player, t"AttachmentSlots.WeaponRight");
    if !IsDefined(object) {
      return false;
    }
    let drawn = object.GetItemID();
    if !ItemID.IsValid(drawn) {
      return false;
    }
    let area = XFCyberware.ItemArea(ItemID.GetTDBID(drawn));
    return Equals(area, gamedataEquipmentArea.ArmsCW);
  }

  // RB-102: the slots as they are now, kept once, before the bridge's first cyberware change this session.
  public static func NoteSnapshot(player: ref<PlayerPuppet>, data: ref<EquipmentSystemPlayerData>) -> Void {
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) || IsDefined(registry.CyberwareSnapshot()) {
      return;
    }
    let snapshot = new XFCyberwareSnapshot();
    let areas = XFCyberware.Areas();
    let i = 0;
    while i < ArraySize(areas) {
      let count = data.GetNumberOfSlots(areas[i], false);
      let s = 0;
      while s < count {
        let held = data.GetItemInEquipSlot(areas[i], s);
        ArrayPush(snapshot.areas, areas[i]);
        ArrayPush(snapshot.slots, s);
        ArrayPush(snapshot.items, held);
        s += 1;
      }
      i += 1;
    }
    registry.SetCyberwareSnapshot(snapshot);
  }

  // The copies of cyberware the bridge added this session that V still has.
  public static func AddedCopies(player: ref<PlayerPuppet>) -> array<ItemID> {
    let out: array<ItemID>;
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) || !IsDefined(player) {
      return out;
    }
    let system = GameInstance.GetTransactionSystem(GetGameInstance());
    let added = registry.AddedItems();
    let i = 0;
    while i < ArraySize(added) {
      let area = XFCyberware.ItemArea(ItemID.GetTDBID(added[i]));
      if NotEquals(area, gamedataEquipmentArea.Invalid) && system.HasItem(player, added[i]) {
        ArrayPush(out, added[i]);
      }
      i += 1;
    }
    return out;
  }

  // RB-102 (game.save's holds): whether the bridge's cyberware changes are still on V: a slot that differs from the
  // snapshot, or an added copy V still has.
  public static func Changed() -> Bool {
    let player = XFInventory.Player();
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(player) || !IsDefined(registry) {
      return false;
    }
    let copies = XFCyberware.AddedCopies(player);
    if ArraySize(copies) > 0 {
      return true;
    }
    let snapshot = registry.CyberwareSnapshot();
    if !IsDefined(snapshot) {
      return false;
    }
    let data = EquipmentSystem.GetData(player);
    if !IsDefined(data) {
      return false;
    }
    let i = 0;
    while i < ArraySize(snapshot.areas) {
      let now = data.GetItemInEquipSlot(snapshot.areas[i], snapshot.slots[i]);
      if now != snapshot.items[i] {
        return true;
      }
      i += 1;
    }
    return false;
  }

  // Removes the added copies that are out of their slots; returns how many.
  public static func RemoveAddedCopies(cid: String) -> Int32 {
    let player = XFInventory.Player();
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(player) || !IsDefined(registry) {
      return 0;
    }
    let system = GameInstance.GetTransactionSystem(GetGameInstance());
    let copies = XFCyberware.AddedCopies(player);
    let removed = 0;
    let i = 0;
    while i < ArraySize(copies) {
      let equipped = EquipmentSystem.GetInstance(player).IsEquipped(player, copies[i]);
      if !equipped && system.RemoveItem(player, copies[i], 1) {
        registry.ForgetAddedItem(copies[i]);
        removed += 1;
      }
      i += 1;
    }
    return removed;
  }

  // RB-102, the kill switch: every slot back to what the snapshot holds (the ripperdoc's own requests), then, a moment
  // later, the copies the bridge added removed. "" when the bridge changed no cyberware.
  public static func RestoreAfterKill(cid: String) -> String {
    let registry = XFBridgeRegistry.Get();
    let player = XFInventory.Player();
    if !IsDefined(registry) || !IsDefined(player) {
      return "";
    }
    let snapshot = registry.CyberwareSnapshot();
    let copies = XFCyberware.AddedCopies(player);
    let pending = ArraySize(copies);
    if !IsDefined(snapshot) && pending == 0 {
      return "";
    }
    let restored = 0;
    if IsDefined(snapshot) {
      let data = EquipmentSystem.GetData(player);
      let equipment = EquipmentSystem.GetInstance(player);
      let system = GameInstance.GetTransactionSystem(GetGameInstance());
      let i = 0;
      while i < ArraySize(snapshot.areas) {
        let now = data.GetItemInEquipSlot(snapshot.areas[i], snapshot.slots[i]);
        let before = snapshot.items[i];
        if now != before {
          if ItemID.IsValid(now) {
            let off = new UnequipRequest();
            off.owner = player;
            off.areaType = snapshot.areas[i];
            off.slotIndex = snapshot.slots[i];
            equipment.QueueRequest(off);
          }
          if ItemID.IsValid(before) && system.HasItem(player, before) {
            let on = new EquipRequest();
            on.owner = player;
            on.itemID = before;
            on.slotIndex = snapshot.slots[i];
            equipment.QueueRequest(on);
          }
          restored += 1;
        }
        i += 1;
      }
      registry.SetCyberwareSnapshot(null);
    }
    if pending > 0 {
      GameInstance.GetDelaySystem(GetGameInstance()).DelayCallback(new XFCyberwareRemoveLater(), 1.0, false);
    }
    return ",\"cyberware_restored\":" + IntToString(restored) + ",\"cyberware_added_to_remove\":" + IntToString(pending);
  }

  // cyberware.equip, step 1: checks, adds the item if asked, queues the equip request into slot (-1: the first empty slot,
  // else slot 0). Answers the earlier item in that slot (and its exact copy, `id`) for the undo. hash: the exact copy to
  // equip (an undo's), "" for any copy of the record.
  public static func Equip(cid: String, item: String, hash: String, slot: Int32, addIfMissing: Bool) -> String {
    let refusal = XFCyberware.Refusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    let player = XFInventory.Player();
    let tdbid = TDBID.Create(item);
    let area = XFCyberware.ItemArea(tdbid);
    if Equals(area, gamedataEquipmentArea.Invalid) {
      return XFJson.Fail("bad_params", "'" + item + "' isn't a cyberware item record (an item whose equipment area is a cyberware area such as ArmsCW)");
    }
    let data = EquipmentSystem.GetData(player);
    let slots = data.GetNumberOfSlots(area, false);
    if slots <= 0 {
      return XFJson.Fail("unavailable", "V has no unlocked slot in " + XFCyberware.AreaName(area));
    }
    let index = slot;
    if index < 0 {
      index = 0;
      let s = 0;
      while s < slots {
        if !ItemID.IsValid(data.GetItemInEquipSlot(area, s)) {
          index = s;
          break;
        }
        s += 1;
      }
    }
    if index >= slots {
      return XFJson.Fail("bad_params", XFCyberware.AreaName(area) + " has " + IntToString(slots) + " unlocked slot(s); slot " + IntToString(index) + " doesn't exist");
    }
    let previous = data.GetItemInEquipSlot(area, index);
    if Equals(area, gamedataEquipmentArea.ArmsCW) && ItemID.IsValid(previous) && XFCyberware.ArmsDrawn(player) {
      return XFJson.Fail("arms_drawn", "V has her arm cyberware out; holster it first (player_action weapon.holster), then swap it");
    }
    let system = GameInstance.GetTransactionSystem(GetGameInstance());
    let id = StrLen(hash) > 0 ? XFInventory.ExactItem(player, tdbid, hash) : XFInventory.FindItem(player, tdbid);
    let added = false;
    if ItemID.IsValid(id) {
      // RB-101: the game's own requirement check before anything changes.
      let owned = system.GetItemData(player, id);
      if IsDefined(owned) && !data.IsEquippable(owned) {
        return XFJson.Fail("not_equippable", "the game says V can't equip '" + item + "' now (a requirement such as level or an attribute isn't met); nothing changed");
      }
    } else {
      if !addIfMissing {
        return XFJson.Fail("not_in_inventory", "V doesn't have '" + item + "'; pass add_if_missing to add one");
      }
      XFCyberware.NoteSnapshot(player, data);
      XFBridgeActions.EnsureSaveLock(cid);
      if !system.GiveItemByTDBID(player, tdbid, 1) {
        return XFJson.Fail("call_failed", "the game didn't add '" + item + "' to V's inventory");
      }
      id = XFInventory.FindItem(player, tdbid);
      if !ItemID.IsValid(id) {
        return XFJson.Fail("call_failed", "'" + item + "' was added but can't be found in V's inventory");
      }
      // RB-101: the requirement is checked on the added copy (a record has no item data before it exists); a copy V can't
      // equip is taken out again before the refusal, so the refusal leaves nothing behind.
      let addedData = system.GetItemData(player, id);
      if IsDefined(addedData) && !data.IsEquippable(addedData) {
        let takenOut = system.RemoveItem(player, id, 1);
        return XFJson.Fail("not_equippable", "the game says V can't equip '" + item + "' now (a requirement such as level or an attribute isn't met); the copy the bridge added was " + (takenOut ? "taken out again" : "left in V's inventory (the game didn't remove it)"));
      }
      added = true;
      XFBridgeRegistry.Get().NoteAddedItem(id);
    }
    let already = ItemID.IsValid(previous) && previous == id;
    if !already {
      XFCyberware.NoteSnapshot(player, data);
      XFBridgeActions.EnsureSaveLock(cid);
      if ItemID.IsValid(previous) {
        // The ripperdoc takes the earlier item out first (UnequipCyberware, then EquipRequest).
        let off = new UnequipRequest();
        off.owner = player;
        off.areaType = area;
        off.slotIndex = index;
        EquipmentSystem.GetInstance(player).QueueRequest(off);
      }
      let request = new EquipRequest();
      request.owner = player;
      request.itemID = id;
      request.slotIndex = index;
      EquipmentSystem.GetInstance(player).QueueRequest(request);
    }
    XFBridgeLog.Info(cid, "cyberware.equip " + item + " in " + XFCyberware.AreaName(area) + " slot " + IntToString(index) + " (added=" + XFJson.Flag(added) + ", before '" + XFCyberware.Record(previous) + "'); undo: the earlier item back, or the slot emptied, and an added item removed");
    return "{\"ok\":true,\"item\":" + XFJson.Str(item) + ",\"area\":" + XFJson.Str(XFCyberware.AreaName(area)) + ",\"slot\":" + IntToString(index) + ",\"added\":" + XFJson.Flag(added) + ",\"already_equipped\":" + XFJson.Flag(already) + ",\"previous\":" + XFJson.Str(XFCyberware.Record(previous)) + XFInventory.IdField(previous) + "}";
  }

  // cyberware.unequip, step 1: empties one slot of a cyberware area (the item's area when an item is named).
  public static func Unequip(cid: String, area: String, slot: Int32, item: String) -> String {
    let refusal = XFCyberware.Refusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    let player = XFInventory.Player();
    let type = XFCyberware.AreaByName(area);
    if StrLen(item) > 0 {
      type = XFCyberware.ItemArea(TDBID.Create(item));
    }
    if Equals(type, gamedataEquipmentArea.Invalid) {
      return XFJson.Fail("bad_params", "unknown cyberware area '" + area + "'" + (StrLen(item) > 0 ? " for '" + item + "'" : ""));
    }
    let data = EquipmentSystem.GetData(player);
    let slots = data.GetNumberOfSlots(type, false);
    let index = slot < 0 ? 0 : slot;
    // RB-112: only the area's unlocked slots.
    if index >= slots {
      return XFJson.Fail("bad_params", XFCyberware.AreaName(type) + " has " + IntToString(slots) + " unlocked slot(s); slot " + IntToString(index) + " doesn't exist");
    }
    if Equals(type, gamedataEquipmentArea.ArmsCW) && XFCyberware.ArmsDrawn(player) {
      return XFJson.Fail("arms_drawn", "V has her arm cyberware out; holster it first (player_action weapon.holster), then take it off");
    }
    if StrLen(item) > 0 && slot < 0 {
      let s = 0;
      while s < slots {
        let held = data.GetItemInEquipSlot(type, s);
        if ItemID.IsValid(held) && ItemID.GetTDBID(held) == TDBID.Create(item) {
          index = s;
          break;
        }
        s += 1;
      }
    }
    let before = data.GetItemInEquipSlot(type, index);
    if StrLen(item) > 0 && (!ItemID.IsValid(before) || ItemID.GetTDBID(before) != TDBID.Create(item)) {
      return XFJson.Fail("bad_params", XFCyberware.AreaName(type) + " slot " + IntToString(index) + " holds '" + XFCyberware.Record(before) + "', not '" + item + "'");
    }
    if ItemID.IsValid(before) {
      XFCyberware.NoteSnapshot(player, data);
      XFBridgeActions.EnsureSaveLock(cid);
      let request = new UnequipRequest();
      request.owner = player;
      request.areaType = type;
      request.slotIndex = index;
      EquipmentSystem.GetInstance(player).QueueRequest(request);
    }
    XFBridgeLog.Info(cid, "cyberware.unequip " + XFCyberware.AreaName(type) + " slot " + IntToString(index) + " (held '" + XFCyberware.Record(before) + "'); undo: equip it again");
    return "{\"ok\":true,\"area\":" + XFJson.Str(XFCyberware.AreaName(type)) + ",\"slot\":" + IntToString(index) + ",\"previous\":" + XFJson.Str(XFCyberware.Record(before)) + XFInventory.IdField(before) + ",\"was_empty\":" + XFJson.Flag(!ItemID.IsValid(before)) + "}";
  }

  // What one slot holds now (the second step reads it a few frames after the request).
  public static func Slot(cid: String, area: String, slot: Int32) -> String {
    let player = XFInventory.Player();
    if !IsDefined(player) {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    let type = XFCyberware.AreaByName(area);
    if Equals(type, gamedataEquipmentArea.Invalid) {
      return XFJson.Fail("bad_params", "unknown cyberware area '" + area + "'");
    }
    let data = EquipmentSystem.GetData(player);
    if slot < 0 || slot >= data.GetNumberOfSlots(type, false) {
      return XFJson.Fail("bad_params", XFCyberware.AreaName(type) + " has no slot " + IntToString(slot));
    }
    let now = data.GetItemInEquipSlot(type, slot);
    return "{\"ok\":true,\"area\":" + XFJson.Str(area) + ",\"slot\":" + IntToString(slot) + ",\"item\":" + XFJson.Str(XFCyberware.Record(now)) + ",\"empty\":" + XFJson.Flag(!ItemID.IsValid(now)) + "}";
  }
}
