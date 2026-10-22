// XF Runtime Bridge: V's outfit when Equipment-EX manages it (bridge 0.6; called by reflection since 0.6.1).
//
// Session 6 (29 September 2026) met Equipment-EX (psiberx, MIT) on the test profile: its outfit system wraps
// EquipmentSystemPlayerData.IsVisualSetActive (so the wardrobe read "active" with no wardrobe outfit), clears every vanilla
// clothing area's visuals while an outfit is on, and replaces EquipWardrobeSet, UnequipWardrobeSet, QuestHideSlot and
// QuestRestoreSlot with no-ops [source] Equipment-EX 1.2.9 as installed (r6/scripts/EquipmentEx/EquipmentEx.reds; the same
// code as the repository at 3208ff4, scripts/Overrides/EquipmentSystem.reds and scripts/OutfitSystem.reds). Its outfit is a
// list of parts, each an item attached to one of its own outfit slots (TweakDB attachment slots such as OutfitSlots.Head),
// and its own screen changes it through OutfitSystem's public functions. The bridge reads and drives that system directly
// (not its screen): EquipItem(itemID, slotID) puts an item V has into the outfit (the route the maintainer's helmet drew by
// in session 6), UnequipSlot empties a slot, Activate/Deactivate switch the outfit on and off; a snapshot of the parts is
// the undo.
//
// RB-85 (0.6.1): nothing here names Equipment-EX's types or signatures at compile time, so a later Equipment-EX that changes
// a signature can't break the redscript compile (which would disable every script mod for that launch). The system is found
// in the scriptable systems container by its class name, and each function it needs is looked up at run time through
// Codeware's reflection (Codeware is a hard dependency of Equipment-EX) by its name and parameter types. When one is missing
// or its parameters differ, the Equipment-EX route is refused for the session (`script_outfit_api_changed`, naming the
// installed version and what differs) and wardrobe.equip keeps to the story's own requests (suspend, resume), exactly as
// with a script outfit system the bridge doesn't know. Tested against 1.2.9's signatures (tools/lint-stubs/equipment-ex).
// Everything here compiles only when both the EquipmentEx and Codeware modules are present; otherwise XFScriptOutfit says
// it is absent.

module XFRuntimeBridge

@if(ModuleExists("EquipmentEx") && ModuleExists("Codeware"))
public class XFOutfitApi {
  public let ok: Bool;
  public let why: String;
  public let missing: String;
  public let version: String;
  public let system: ref<IScriptable>;
  public let isActive: ref<ReflectionMemberFunc>;
  public let isBlocked: ref<ReflectionMemberFunc>;
  public let activate: ref<ReflectionMemberFunc>;
  public let deactivate: ref<ReflectionMemberFunc>;
  public let isEquippable: ref<ReflectionMemberFunc>;
  public let equipItem: ref<ReflectionMemberFunc>;
  public let unequipSlot: ref<ReflectionMemberFunc>;
  public let usedSlots: ref<ReflectionMemberFunc>;
}

// RB-95 (0.7): XFScriptOutfit.Api's answer for the game session.
@if(ModuleExists("EquipmentEx") && ModuleExists("Codeware"))
public class XFOutfitApiCache extends ScriptableSystem {
  public let api: ref<XFOutfitApi>;
}

@if(ModuleExists("EquipmentEx") && ModuleExists("Codeware"))
public abstract class XFScriptOutfit {
  // The Equipment-EX version these signatures were checked against (its Facade's EquipmentEx.Version()).
  public static func TestedWith() -> String {
    return "1.2.9";
  }

  // A reflected type's name matches the wanted one (the RTTI names ItemID gameItemID).
  public static func TypeIs(actual: CName, wanted: CName) -> Bool {
    if Equals(actual, wanted) {
      return true;
    }
    return Equals(wanted, n"ItemID") && Equals(actual, n"gameItemID");
  }

  // One of OutfitSystem's functions by its short name and exact parameter types (overloads differ by those), or null
  // (then named in api.missing).
  public static func Find(api: ref<XFOutfitApi>, cls: ref<ReflectionClass>, name: CName, params: array<CName>) -> ref<ReflectionMemberFunc> {
    for fn in cls.GetFunctions() {
      if Equals(fn.GetName(), name) {
        let found = fn.GetParameters();
        if ArraySize(found) == ArraySize(params) {
          let same = true;
          let i = 0;
          while i < ArraySize(found) {
            if !XFScriptOutfit.TypeIs(found[i].GetType().GetName(), params[i]) {
              same = false;
            }
            i += 1;
          }
          if same {
            return fn;
          }
        }
      }
    }
    let text = NameToString(name) + "(";
    let j = 0;
    while j < ArraySize(params) {
      text += (j > 0 ? ", " : "") + NameToString(params[j]);
      j += 1;
    }
    api.missing += (StrLen(api.missing) > 0 ? "; " : "") + text + ")";
    return null;
  }

  public static func Names(a: CName, opt b: CName) -> array<CName> {
    let out: array<CName>;
    if NotEquals(a, n"") {
      ArrayPush(out, a);
    }
    if NotEquals(b, n"") {
      ArrayPush(out, b);
    }
    return out;
  }

  // The installed version, for the answers (informational: the check is by signature).
  // 0.7 (session 7 read "unknown"): a redscript class's static functions aren't registered on the class; they are global
  // functions named "<Class>::<Name>;<parameter types>" (runtime-bridge-design §3.5). Equipment-EX's facade class
  // EquipmentEx has no module (its scripts/Facade.reds), so Version is the global "EquipmentEx::Version;".
  public static func Version() -> String {
    let fn = Reflection.GetGlobalFunction(n"EquipmentEx::Version;");
    if !IsDefined(fn) {
      for candidate in Reflection.GetGlobalFunctions() {
        if StrBeginsWith(NameToString(candidate.GetName()), "EquipmentEx::Version") || StrBeginsWith(NameToString(candidate.GetFullName()), "EquipmentEx::Version") {
          fn = candidate;
          break;
        }
      }
    }
    if !IsDefined(fn) {
      let facade = Reflection.GetClass(n"EquipmentEx");
      fn = IsDefined(facade) ? facade.GetStaticFunction(n"Version") : null;
    }
    return IsDefined(fn) ? FromVariant<String>(fn.Call()) : "unknown";
  }

  // Equipment-EX's outfit system and the functions the bridge calls, checked by name and parameter types.
  // RB-95 (0.7): the lookup below scans the class's functions and reads the version, so its answer is kept for the game
  // session in a scriptable system of our own (one per session, gone with it) and reused by every call after the first.
  public static func Api() -> ref<XFOutfitApi> {
    let container = GameInstance.GetScriptableSystemsContainer(GetGameInstance());
    let cache = IsDefined(container) ? container.Get(n"XFRuntimeBridge.XFOutfitApiCache") as XFOutfitApiCache : null;
    if IsDefined(cache) && IsDefined(cache.api) {
      return cache.api;
    }
    let api = XFScriptOutfit.Lookup();
    if IsDefined(cache) {
      cache.api = api;
    }
    return api;
  }

  public static func Lookup() -> ref<XFOutfitApi> {
    let api = new XFOutfitApi();
    api.version = XFScriptOutfit.Version();
    let container = GameInstance.GetScriptableSystemsContainer(GetGameInstance());
    let cls = Reflection.GetClass(n"EquipmentEx.OutfitSystem");
    api.system = IsDefined(container) ? container.Get(n"EquipmentEx.OutfitSystem") : null;
    if !IsDefined(cls) || !IsDefined(api.system) {
      api.why = "Equipment-EX's outfit system isn't in this game session";
      return api;
    }
    let none: array<CName>;
    api.isActive = XFScriptOutfit.Find(api, cls, n"IsActive", none);
    api.isBlocked = XFScriptOutfit.Find(api, cls, n"IsBlocked", none);
    api.activate = XFScriptOutfit.Find(api, cls, n"Activate", none);
    api.deactivate = XFScriptOutfit.Find(api, cls, n"Deactivate", none);
    api.isEquippable = XFScriptOutfit.Find(api, cls, n"IsEquippable", XFScriptOutfit.Names(n"ItemID"));
    api.equipItem = XFScriptOutfit.Find(api, cls, n"EquipItem", XFScriptOutfit.Names(n"ItemID", n"TweakDBID"));
    api.unequipSlot = XFScriptOutfit.Find(api, cls, n"UnequipSlot", XFScriptOutfit.Names(n"TweakDBID"));
    api.usedSlots = XFScriptOutfit.Find(api, cls, n"GetUsedSlots", none);
    if StrLen(api.missing) > 0 {
      api.why = "Equipment-EX " + api.version + " doesn't offer what the bridge calls (checked with " + XFScriptOutfit.TestedWith() + "): " + api.missing;
      return api;
    }
    api.ok = true;
    return api;
  }

  public static func Flag(api: ref<XFOutfitApi>, fn: ref<ReflectionMemberFunc>) -> Bool {
    return FromVariant<Bool>(fn.Call(api.system));
  }

  public static func Slots(api: ref<XFOutfitApi>) -> array<TweakDBID> {
    return FromVariant<array<TweakDBID>>(api.usedSlots.Call(api.system));
  }

  public static func EquipInto(api: ref<XFOutfitApi>, item: ItemID, slot: TweakDBID) -> Bool {
    let called: Bool;
    return XFScriptOutfit.EquipIntoChecked(api, item, slot, called);
  }

  // 0.7: the call's own status apart from Equipment-EX's answer (a failed reflection call also reads as false).
  public static func EquipIntoChecked(api: ref<XFOutfitApi>, item: ItemID, slot: TweakDBID, out called: Bool) -> Bool {
    let args: array<Variant>;
    ArrayPush(args, ToVariant(item));
    ArrayPush(args, ToVariant(slot));
    let status = false;
    let answer = api.equipItem.Call(api.system, args, status);
    called = status;
    return status && FromVariant<Bool>(answer);
  }

  // Equipment-EX's own slot for an item (its OutfitSystem.GetItemSlot: the last of the record's placementSlots, which its
  // tweaks append), or an invalid ID when that isn't one of its OutfitSlots.
  public static func OutfitSlotFor(item: ItemID) -> TweakDBID {
    let slots = TweakDBInterface.GetForeignKeyArray(ItemID.GetTDBID(item) + t".placementSlots");
    if ArraySize(slots) == 0 {
      return TDBID.None();
    }
    let last = ArrayLast(slots);
    return StrBeginsWith(TDBID.ToStringDEBUG(last), "OutfitSlots.") ? last : TDBID.None();
  }

  // Whether an outfit slot now holds this exact item (the transaction system's attachment slot, as PartsJson reads it).
  public static func InOutfit(api: ref<XFOutfitApi>, player: ref<PlayerPuppet>, item: ItemID) -> Bool {
    let transactions = GameInstance.GetTransactionSystem(GetGameInstance());
    for slot in XFScriptOutfit.Slots(api) {
      let object = transactions.GetItemInSlot(player, slot);
      if IsDefined(object) && object.GetItemID() == item {
        return true;
      }
    }
    return false;
  }

  public static func Unequip(api: ref<XFOutfitApi>, slot: TweakDBID) -> Void {
    let args: array<Variant>;
    ArrayPush(args, ToVariant(slot));
    api.unequipSlot.Call(api.system, args);
  }

  // Present: installed and callable (the signatures match). A changed API counts as absent, so the wardrobe keeps to the
  // story's own requests.
  public static func Present() -> Bool {
    return XFScriptOutfit.Api().ok;
  }

  public static func Name() -> String {
    return "EquipmentEx";
  }

  public static func Active() -> Bool {
    let api = XFScriptOutfit.Api();
    return api.ok && XFScriptOutfit.Flag(api, api.isActive);
  }

  // The outfit's parts: each used outfit slot and the item attached there (read through the transaction system, which
  // is where the outfit's visuals live); id is the item's exact identity (its combined hash) for the undo.
  public static func PartsJson(api: ref<XFOutfitApi>, player: ref<PlayerPuppet>) -> String {
    let out = "[";
    if !api.ok || !IsDefined(player) {
      return "[]";
    }
    let slots = XFScriptOutfit.Slots(api);
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
      out += "{\"slot\":" + XFJson.Str(TDBID.ToStringDEBUG(slots[i])) + ",\"item\":" + XFJson.Str(XFInventory.ItemName(item)) + XFInventory.IdField(item) + "}";
      i += 1;
    }
    return out + "]";
  }

  public static func StateJson(player: ref<PlayerPuppet>) -> String {
    let api = XFScriptOutfit.Api();
    if !api.ok {
      return "{\"present\":true,\"available\":false,\"version\":" + XFJson.Str(api.version) + ",\"why\":" + XFJson.Str(api.why) + "}";
    }
    return "{\"present\":true,\"available\":true,\"name\":\"EquipmentEx\",\"version\":" + XFJson.Str(api.version) + ",\"api\":\"checked\",\"active\":" + XFJson.Flag(XFScriptOutfit.Flag(api, api.isActive)) + ",\"blocked\":" + XFJson.Flag(XFScriptOutfit.Flag(api, api.isBlocked)) + ",\"parts\":" + XFScriptOutfit.PartsJson(api, player) + "}";
  }

  // The parts as the snapshot keeps them (for the undo and the kill switch).
  public static func Snapshot(player: ref<PlayerPuppet>, snapshot: ref<XFWardrobeSnapshot>) -> Void {
    let api = XFScriptOutfit.Api();
    if !api.ok {
      return;
    }
    snapshot.scriptKnown = true;
    snapshot.scriptActive = XFScriptOutfit.Flag(api, api.isActive);
    let slots = XFScriptOutfit.Slots(api);
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
    let api = XFScriptOutfit.Api();
    if !api.ok {
      return XFJson.Fail("script_outfit_api_changed", api.why + "; wardrobe_equip with suspend: true takes the outfit off for now");
    }
    if XFScriptOutfit.Flag(api, api.isBlocked) {
      return XFJson.Fail("not_safe_now", "EquipmentEx's outfit is blocked right now (switched off by the story, or an outfit item V can't take off)");
    }
    let args: array<Variant>;
    ArrayPush(args, ToVariant(item));
    if !FromVariant<Bool>(api.isEquippable.Call(api.system, args)) {
      return XFJson.Fail("bad_params", "EquipmentEx has no outfit slot for '" + XFInventory.ItemName(item) + "' (it takes clothing only)");
    }
    // 0.7 (session 7: "refused" for a helmet, with IsEquippable true and the outfit not blocked): the item's own outfit slot
    // is passed explicitly (RB-95: no reliance on an empty ID meaning "omitted"), the reflection call's status is told
    // apart from Equipment-EX's answer, and an item that is in the outfit afterwards counts, whatever the call answered.
    let slot = XFScriptOutfit.OutfitSlotFor(item);
    let called = false;
    let answered = XFScriptOutfit.EquipIntoChecked(api, item, slot, called);
    if !answered && XFScriptOutfit.InOutfit(api, player, item) {
      XFBridgeLog.Info("wardrobe", "EquipmentEx's EquipItem answered false (call ran: " + XFJson.Flag(called) + ") but '" + XFInventory.ItemName(item) + "' is in the outfit");
      return "";
    }
    if !answered {
      let why = called ? "EquipmentEx answered false" : "the call through Codeware's reflection didn't run";
      return XFJson.Fail("failed", "EquipmentEx didn't put '" + XFInventory.ItemName(item) + "' into the outfit (" + why + "; its outfit slot " + (TDBID.IsValid(slot) ? TDBID.ToStringDEBUG(slot) : "none: the item's placement slots end in no OutfitSlots entry") + ")");
    }
    return "";
  }

  // The undo and the kill switch's restore: the outfit on or off as recorded (RB-84: switched on again when the snapshot
  // had it on and it is off now), and each slot holding exactly the recorded item (a slot now in use that the snapshot
  // didn't use is emptied). Only slots that differ are touched.
  public static func Apply(player: ref<PlayerPuppet>, snapshot: ref<XFWardrobeSnapshot>) -> String {
    let api = XFScriptOutfit.Api();
    if !api.ok || !snapshot.scriptKnown {
      return "skipped";
    }
    let transactions = GameInstance.GetTransactionSystem(GetGameInstance());
    if snapshot.scriptActive {
      let switched = "";
      if !XFScriptOutfit.Flag(api, api.isActive) {
        api.activate.Call(api.system);
        if !XFScriptOutfit.Flag(api, api.isActive) {
          return "not_activated"; // blocked (the story or an item V can't take off): nothing else is touched
        }
        switched = "activated,";
      }
      let now = XFScriptOutfit.Slots(api);
      let i = 0;
      while i < ArraySize(now) {
        if !ArrayContains(snapshot.scriptSlots, now[i]) {
          XFScriptOutfit.Unequip(api, now[i]);
        }
        i += 1;
      }
      i = 0;
      while i < ArraySize(snapshot.scriptSlots) {
        let object = transactions.GetItemInSlot(player, snapshot.scriptSlots[i]);
        if !IsDefined(object) || !Equals(object.GetItemID(), snapshot.scriptItems[i]) {
          XFScriptOutfit.EquipInto(api, snapshot.scriptItems[i], snapshot.scriptSlots[i]);
        }
        i += 1;
      }
      return switched + "parts";
    }
    if XFScriptOutfit.Flag(api, api.isActive) {
      api.deactivate.Call(api.system);
      return "deactivated";
    }
    return "unchanged";
  }

  public static func HasItem(player: ref<PlayerPuppet>, item: String) -> Bool {
    let api = XFScriptOutfit.Api();
    if !api.ok {
      return false;
    }
    let slots = XFScriptOutfit.Slots(api);
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

@if(!ModuleExists("EquipmentEx") || !ModuleExists("Codeware"))
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
