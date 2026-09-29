// Lint stub, never shipped: the part of Equipment-EX's public API the bridge's XFRuntimeBridgeEquipmentEx.reds uses, with
// the signatures of Equipment-EX 1.2.9 as installed (r6/scripts/EquipmentEx/EquipmentEx.reds, class OutfitSystem; the
// same as the repository at 3208ff4, scripts/OutfitSystem.reds). Since 0.6.1 (RB-85) the bridge names none of these at
// compile time: it looks each function up by name and parameter types through Codeware's reflection at run time, so this
// stub only makes ModuleExists("EquipmentEx") true for the lint and records the signatures that lookup expects.
// Equipment-EX's own scripts need Codeware, ArchiveXL and TweakXL declarations to compile, so the lint checks the bridge
// against this stub instead:
//   bun tools/lint-redscript.ts --bundle <copy> --codeware <Codeware scripts> --extra tools/lint-stubs/equipment-ex
module EquipmentEx

public class OutfitSystem extends ScriptableSystem {
  public func IsBlocked() -> Bool { return false; }
  public func IsDisabled() -> Bool { return false; }
  public func IsActive() -> Bool { return false; }
  public func Activate() {}
  public func Reactivate() {}
  public func Deactivate() {}
  public func IsEquippable(recordID: TweakDBID) -> Bool { return false; }
  public func IsEquippable(itemID: ItemID) -> Bool { return false; }
  public func EquipItem(recordID: TweakDBID, opt slotID: TweakDBID) -> Bool { return false; }
  public func EquipItem(itemID: ItemID, opt slotID: TweakDBID) -> Bool { return false; }
  public func UnequipItem(itemID: ItemID) -> Bool { return false; }
  public func UnequipSlot(slotID: TweakDBID) -> Bool { return false; }
  public func GetUsedSlots() -> array<TweakDBID> { let slots: array<TweakDBID>; return slots; }
  public static func GetInstance(game: GameInstance) -> ref<OutfitSystem> { return null; }
}
