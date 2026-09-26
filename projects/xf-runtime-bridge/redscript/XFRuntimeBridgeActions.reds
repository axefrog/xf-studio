// XF Runtime Bridge: game actions called by the native plugin (bridge phase 2).
//
// The plugin validates every request's parameters, then calls one static function below on the
// game thread with typed arguments and a correlation id. Each returns a JSON object as a String:
// {"ok":true, ...} or {"ok":false,"code":"...","message":"..."}.
//
// Only vanilla 2.31 script types are used (no Codeware), and the file is linted against the
// game's own script bundle, so every name here exists with this signature in 2.31. Where a name
// comes from, and why it is safe, is recorded in research/runtime/runtime-bridge-design.md §7 and
// knowledge/runtime-access.md. Nothing here saves the game: every write first asks the game's
// own SaveLocksManager for a save lock (reason XFRuntimeBridge), kept after the kill switch and
// released only by loading a save.

module XFRuntimeBridge

// --- JSON text helpers -----------------------------------------------------------------------

public abstract class XFJson {
  public static func Str(s: String) -> String {
    let out = StrReplaceAll(s, "\\", "\\\\");
    out = StrReplaceAll(out, "\"", "\\\"");
    out = StrReplaceAll(out, "\n", "\\n");
    out = StrReplaceAll(out, "\r", "\\r");
    out = StrReplaceAll(out, "\t", "\\t");
    return "\"" + out + "\"";
  }

  public static func Name(n: CName) -> String {
    return XFJson.Str(NameToString(n));
  }

  public static func Flag(b: Bool) -> String {
    if b {
      return "true";
    }
    return "false";
  }

  public static func Num(f: Float) -> String {
    return FloatToStringPrec(f, 4);
  }

  public static func Fail(code: String, message: String) -> String {
    return "{\"ok\":false,\"code\":" + XFJson.Str(code) + ",\"message\":" + XFJson.Str(message) + "}";
  }
}

// --- Photo-mode menu model, captured from the menu controller's own setup callbacks -----------

public class XFPhotoItem {
  public let key: Uint32;
  public let label: String;
  public let page: Uint32;
  public let kind: String; // "item" until set up, then "slider", "hue" or "options"
  public let minValue: Float;
  public let maxValue: Float;
  public let step: Float;
  public let startValue: Float;
  public let optionTexts: array<String>;
  public let optionData: array<Int32>;
  public let startData: Int32;
}

// One per game session. Holds what the bridge must remember between calls: the live photo-mode
// menu controller, the menu model, the open character-creator menu, and what to undo on kill.
public class XFBridgeRegistry extends ScriptableSystem {
  private let m_photo: wref<gameuiPhotoModeMenuController>;
  private let m_items: array<ref<XFPhotoItem>>;
  private let m_ccMenu: wref<characterCreationBodyMorphMenu>;
  private let m_saveLockHeld: Bool;
  private let m_worldFrozen: Bool;
  private let m_photoUiHidden: Bool;

  public static func Get() -> ref<XFBridgeRegistry> {
    return GameInstance.GetScriptableSystemsContainer(GetGameInstance()).Get(n"XFRuntimeBridge.XFBridgeRegistry") as XFBridgeRegistry;
  }

  // Photo mode ---------------------------------------------------------------------------------

  public func SetPhotoController(controller: wref<gameuiPhotoModeMenuController>) -> Void {
    this.m_photo = controller;
  }

  public func ClearPhotoController(controller: wref<gameuiPhotoModeMenuController>) -> Void {
    if this.m_photo == controller {
      this.m_photo = null;
    }
    this.m_photoUiHidden = false;
  }

  public func GetPhotoController() -> wref<gameuiPhotoModeMenuController> {
    return this.m_photo;
  }

  public func SetPhotoUiHidden(hidden: Bool) -> Void {
    this.m_photoUiHidden = hidden;
  }

  public func IsPhotoUiHidden() -> Bool {
    return this.m_photoUiHidden;
  }

  public func FindItem(key: Uint32) -> ref<XFPhotoItem> {
    let i = 0;
    while i < ArraySize(this.m_items) {
      if this.m_items[i].key == key {
        return this.m_items[i];
      }
      i += 1;
    }
    return null;
  }

  public func Item(key: Uint32) -> ref<XFPhotoItem> {
    let item = this.FindItem(key);
    if !IsDefined(item) {
      item = new XFPhotoItem();
      item.key = key;
      item.kind = "item";
      ArrayPush(this.m_items, item);
    }
    return item;
  }

  public func ItemCount() -> Int32 {
    return ArraySize(this.m_items);
  }

  public func ItemAt(i: Int32) -> ref<XFPhotoItem> {
    return this.m_items[i];
  }

  // Character creator (the mirror's appearance screen) -----------------------------------------

  public func SetCharacterMenu(menu: wref<characterCreationBodyMorphMenu>) -> Void {
    this.m_ccMenu = menu;
  }

  public func ClearCharacterMenu(menu: wref<characterCreationBodyMorphMenu>) -> Void {
    if this.m_ccMenu == menu {
      this.m_ccMenu = null;
    }
  }

  public func GetCharacterMenu() -> wref<characterCreationBodyMorphMenu> {
    return this.m_ccMenu;
  }

  // Safety state -------------------------------------------------------------------------------

  public func SetSaveLockHeld(held: Bool) -> Void {
    this.m_saveLockHeld = held;
  }

  public func IsSaveLockHeld() -> Bool {
    return this.m_saveLockHeld;
  }

  public func SetWorldFrozen(frozen: Bool) -> Void {
    this.m_worldFrozen = frozen;
  }

  public func IsWorldFrozen() -> Bool {
    return this.m_worldFrozen;
  }
}

// --- Wraps: remember the live controllers. Signatures copied from the 2.31 scripts ------------
// (photoModeMenuController.script:291, 323, 475, 564, 574, 584; characterCreationBodyMorphMenu
// .script:149, 228). Each one calls the game's own method unchanged.

@wrapMethod(gameuiPhotoModeMenuController)
protected cb func OnShow(reversedUI: Bool) -> Bool {
  let result = wrappedMethod(reversedUI);
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    registry.SetPhotoController(this);
    registry.SetPhotoUiHidden(false);
  }
  return result;
}

@wrapMethod(gameuiPhotoModeMenuController)
protected cb func OnHide() -> Bool {
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    registry.ClearPhotoController(this);
  }
  return wrappedMethod();
}

@wrapMethod(gameuiPhotoModeMenuController)
protected cb func OnAddMenuItem(labelText: String, attributeKey: Uint32, page: Uint32) -> Bool {
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    let item = registry.Item(attributeKey);
    item.label = GetLocalizedText(labelText);
    item.page = page;
  }
  return wrappedMethod(labelText, attributeKey, page);
}

@wrapMethod(gameuiPhotoModeMenuController)
protected cb func OnSetupScrollBar(attribute: Uint32, startValue: Float, minValue: Float, maxValue: Float, step: Float, displayType: Uint32) -> Bool {
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    let item = registry.Item(attribute);
    item.kind = "slider";
    item.minValue = minValue;
    item.maxValue = maxValue;
    item.step = step;
    item.startValue = startValue;
  }
  return wrappedMethod(attribute, startValue, minValue, maxValue, step, displayType);
}

@wrapMethod(gameuiPhotoModeMenuController)
protected cb func OnSetupHueBar(attribute: Uint32, startValue: Float, minValue: Float, maxValue: Float, step: Float, displayType: Uint32) -> Bool {
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    let item = registry.Item(attribute);
    item.kind = "hue";
    item.minValue = minValue;
    item.maxValue = maxValue;
    item.step = step;
    item.startValue = startValue;
  }
  return wrappedMethod(attribute, startValue, minValue, maxValue, step, displayType);
}

@wrapMethod(gameuiPhotoModeMenuController)
protected cb func OnSetupOptionSelector(attribute: Uint32, values: array<PhotoModeOptionSelectorData>, startData: Int32, doApply: Bool) -> Bool {
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    let item = registry.Item(attribute);
    item.kind = "options";
    item.startData = startData;
    ArrayClear(item.optionTexts);
    ArrayClear(item.optionData);
    let i = 0;
    while i < ArraySize(values) {
      ArrayPush(item.optionTexts, GetLocalizedText(values[i].optionText));
      ArrayPush(item.optionData, values[i].optionData);
      i += 1;
    }
  }
  return wrappedMethod(attribute, values, startData, doApply);
}

// Fades the whole photo-mode UI out or in, as the game's own show/hide key does (OnFadeVisibility,
// photoModeMenuController.script:527). Opening photo mode again always shows it (OnShow sets opacity 1).
@addMethod(gameuiPhotoModeMenuController)
public func XFBridgeSetUiVisible(visible: Bool) -> Void {
  if visible {
    this.OnFadeVisibility(1.0);
  } else {
    this.OnFadeVisibility(0.0);
  }
}

@wrapMethod(characterCreationBodyMorphMenu)
protected cb func OnInitialize() -> Bool {
  let result = wrappedMethod();
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    registry.SetCharacterMenu(this);
  }
  return result;
}

@wrapMethod(characterCreationBodyMorphMenu)
protected cb func OnUninitialize() -> Bool {
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    registry.ClearCharacterMenu(this);
  }
  return wrappedMethod();
}

// --- Entry points called by the plugin ---------------------------------------------------------

public abstract class XFBridgeActions {
  // Game phase ---------------------------------------------------------------------------------

  public static func Phase() -> String {
    let game = GetGameInstance();
    if !GameInstance.IsValid(game) {
      return "starting";
    }
    let handler = new inkMenuScenario().GetSystemRequestsHandler();
    if IsDefined(handler) && handler.IsPreGame() {
      return "main_menu";
    }
    let player = GetPlayer(game);
    if !IsDefined(player) || !player.IsAttached() {
      return "loading";
    }
    if GameInstance.GetPhotoModeSystem(game).IsPhotoModeActive() {
      return "photo_mode";
    }
    if XFBridgeActions.CharacterMenuOpen() {
      return "character_menu";
    }
    let inMenu = GameInstance.GetBlackboardSystem(game).Get(GetAllBlackboardDefs().UI_System).GetBool(GetAllBlackboardDefs().UI_System.IsInMenu);
    if inMenu {
      return "menu";
    }
    if IsDefined(handler) && handler.IsGamePaused() {
      return "paused";
    }
    return "gameplay";
  }

  // The mirror's (or ripperdoc's) appearance screen: an edit of V's finalized look, with the
  // preview puppet live and the menu idle (characterCreationBodyMorphMenu.script:111-117, 477).
  public static func CharacterMenuOpen() -> Bool {
    let game = GetGameInstance();
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) {
      return false;
    }
    let menu = registry.GetCharacterMenu();
    if !IsDefined(menu) || !menu.m_updatingFinalizedState {
      return false;
    }
    return IsDefined(GameInstance.GetCharacterCustomizationSystem(game).GetPuppetPreviewGameController());
  }

  public static func Status(cid: String) -> String {
    let game = GetGameInstance();
    let phase = XFBridgeActions.Phase();
    let out = "{\"ok\":true,\"phase\":" + XFJson.Str(phase);
    if GameInstance.IsValid(game) {
      let handler = new inkMenuScenario().GetSystemRequestsHandler();
      if IsDefined(handler) {
        out += ",\"game_version\":" + XFJson.Str(handler.GetGameVersion());
        out += ",\"game_paused\":" + XFJson.Flag(handler.IsGamePaused());
      }
      let player = GetPlayer(game);
      out += ",\"player_present\":" + XFJson.Flag(IsDefined(player) && player.IsAttached());
      let photo = GameInstance.GetPhotoModeSystem(game);
      out += ",\"photo_mode_active\":" + XFJson.Flag(photo.IsPhotoModeActive());
      out += ",\"photo_mode_can_open\":" + XFJson.Flag(photo.CanPhotoModeBeEnabled());
      let time = GameInstance.GetTimeSystem(game);
      out += ",\"clock_paused\":" + XFJson.Flag(time.IsPausedState());
      let locks: array<gameSaveLock>;
      out += ",\"saving_locked\":" + XFJson.Flag(GameInstance.IsSavingLocked(game, locks));
      let registry = XFBridgeRegistry.Get();
      if IsDefined(registry) {
        out += ",\"bridge_save_lock\":" + XFJson.Flag(registry.IsSaveLockHeld());
        out += ",\"bridge_world_frozen\":" + XFJson.Flag(registry.IsWorldFrozen());
        out += ",\"photo_controller_seen\":" + XFJson.Flag(IsDefined(registry.GetPhotoController()));
        out += ",\"photo_ui_hidden\":" + XFJson.Flag(registry.IsPhotoUiHidden());
      }
    }
    XFBridgeLog.Debug(cid, "Status phase=" + phase);
    return out + "}";
  }

  // Saves --------------------------------------------------------------------------------------

  // Asks the game's SaveLocksManager for a save lock before the first change (the same request
  // vanilla uses for autodrive and remote control; core/systems/saveLocksManager.script:30-48).
  // It is queued, not persistent, and gone after loading a save.
  public static func EnsureSaveLock(cid: String) -> Void {
    let registry = XFBridgeRegistry.Get();
    if IsDefined(registry) && !registry.IsSaveLockHeld() {
      SaveLocksManager.RequestSaveLockAdd(GetGameInstance(), n"XFRuntimeBridge");
      registry.SetSaveLockHeld(true);
      XFBridgeLog.Info(cid, "save lock requested (reason XFRuntimeBridge); kept after the kill switch; cleared by loading a save");
    }
  }

  // Called by the plugin once after the kill switch: undoes what the bridge left switched on
  // (a world freeze, a hidden photo-mode menu). The save lock is deliberately kept.
  public static func RestoreAfterKill(cid: String) -> String {
    let game = GetGameInstance();
    let registry = XFBridgeRegistry.Get();
    let out = "{\"ok\":true";
    if !GameInstance.IsValid(game) || !IsDefined(registry) {
      return out + ",\"restored\":false}";
    }
    if registry.IsWorldFrozen() {
      let time = GameInstance.GetTimeSystem(game);
      time.UnsetTimeDilation(n"XFBridgeFreeze");
      time.UnsetTimeDilationOnLocalPlayerZero(n"XFBridgeFreeze");
      registry.SetWorldFrozen(false);
      out += ",\"world_unfrozen\":true";
    }
    let photo = registry.GetPhotoController();
    if registry.IsPhotoUiHidden() && IsDefined(photo) {
      photo.XFBridgeSetUiVisible(true);
      registry.SetPhotoUiHidden(false);
      out += ",\"photo_ui_shown\":true";
    }
    // The save lock stays: whatever the bridge changed (a light, the clock, a creator option) may
    // still be live, and a save now would keep it. The lock is not persistent; loading a save
    // clears it.
    if registry.IsSaveLockHeld() {
      out += ",\"save_lock_kept\":true";
    }
    XFBridgeLog.Info(cid, "RestoreAfterKill " + out + "}");
    return out + "}";
  }
}

// --- Photo mode ----------------------------------------------------------------------------------

public abstract class XFPhoto {
  public static func Controller() -> wref<gameuiPhotoModeMenuController> {
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) {
      return null;
    }
    return registry.GetPhotoController();
  }

  public static func Active() -> Bool {
    let game = GetGameInstance();
    return GameInstance.IsValid(game) && GameInstance.GetPhotoModeSystem(game).IsPhotoModeActive();
  }

  // Current value of a menu item: the slider value, or the selected option's data value.
  public static func CurrentValue(controller: wref<gameuiPhotoModeMenuController>, item: ref<XFPhotoItem>) -> Float {
    let listItem = controller.GetMenuItem(item.key);
    if !IsDefined(listItem) {
      return -1.0;
    }
    if Equals(item.kind, "options") {
      let index = listItem.GetSelectedOptionIndex();
      if index >= 0 && index < ArraySize(item.optionData) {
        return Cast<Float>(item.optionData[index]);
      }
      return -1.0;
    }
    return listItem.GetSliderValue();
  }

  // Whether CurrentValue reports a real value: an option list whose selected index is outside the
  // options seen has none (CurrentValue then says -1, which a slider could also legitimately hold).
  public static func HasValue(controller: wref<gameuiPhotoModeMenuController>, item: ref<XFPhotoItem>) -> Bool {
    let listItem = controller.GetMenuItem(item.key);
    if !IsDefined(listItem) {
      return false;
    }
    if Equals(item.kind, "options") {
      let index = listItem.GetSelectedOptionIndex();
      return index >= 0 && index < ArraySize(item.optionData);
    }
    return true;
  }

  // Whether the value the menu shows now is the one asked for: exactly, for an option list (whose
  // ForceValue truncates and falls back to the first option for an unknown value); within one
  // slider step (or 0.01) for a slider, which may snap to its step.
  public static func Matches(item: ref<XFPhotoItem>, wanted: Float, actual: Float) -> Bool {
    if Equals(item.kind, "options") {
      return actual == wanted;
    }
    return AbsF(actual - wanted) <= MaxF(item.step, 0.01);
  }

  public static func DescribeItem(controller: wref<gameuiPhotoModeMenuController>, item: ref<XFPhotoItem>, withOptions: Bool) -> String {
    let out = "{\"key\":" + IntToString(Cast<Int32>(item.key)) + ",\"label\":" + XFJson.Str(item.label) + ",\"page\":" + IntToString(Cast<Int32>(item.page)) + ",\"kind\":" + XFJson.Str(item.kind);
    if Equals(item.kind, "slider") || Equals(item.kind, "hue") {
      out += ",\"min\":" + XFJson.Num(item.minValue) + ",\"max\":" + XFJson.Num(item.maxValue) + ",\"step\":" + XFJson.Num(item.step) + ",\"start\":" + XFJson.Num(item.startValue);
    }
    if Equals(item.kind, "options") {
      out += ",\"option_count\":" + IntToString(ArraySize(item.optionData)) + ",\"start\":" + IntToString(item.startData);
      if withOptions {
        out += ",\"options\":[";
        let i = 0;
        while i < ArraySize(item.optionData) {
          if i > 0 {
            out += ",";
          }
          out += "{\"data\":" + IntToString(item.optionData[i]) + ",\"text\":" + XFJson.Str(item.optionTexts[i]) + "}";
          i += 1;
        }
        out += "]";
      }
    }
    if IsDefined(controller) {
      out += ",\"value\":" + XFJson.Num(XFPhoto.CurrentValue(controller, item));
    }
    return out + "}";
  }

  // Read-only: photo-mode flags and, with includeMenu, every captured menu item with its range,
  // options (withOptions) and current value.
  public static func State(cid: String, includeMenu: Bool, withOptions: Bool) -> String {
    let game = GetGameInstance();
    if !GameInstance.IsValid(game) {
      return XFJson.Fail("game_not_ready", "no game instance yet");
    }
    let system = GameInstance.GetPhotoModeSystem(game);
    let controller = XFPhoto.Controller();
    let registry = XFBridgeRegistry.Get();
    let out = "{\"ok\":true,\"active\":" + XFJson.Flag(system.IsPhotoModeActive());
    out += ",\"can_open\":" + XFJson.Flag(system.CanPhotoModeBeEnabled());
    out += ",\"exit_locked\":" + XFJson.Flag(system.IsExitLocked());
    out += ",\"controller\":" + XFJson.Flag(IsDefined(controller));
    let camera = GameInstance.GetCameraSystem(game);
    if IsDefined(camera) {
      out += ",\"camera_fov\":" + XFJson.Num(camera.GetActiveCameraFOV());
    }
    if IsDefined(registry) {
      out += ",\"ui_hidden\":" + XFJson.Flag(registry.IsPhotoUiHidden());
      out += ",\"menu_items_seen\":" + IntToString(registry.ItemCount());
      if includeMenu {
        out += ",\"menu\":[";
        let i = 0;
        while i < registry.ItemCount() {
          if i > 0 {
            out += ",";
          }
          let active: wref<gameuiPhotoModeMenuController> = null;
          if system.IsPhotoModeActive() {
            active = controller;
          }
          out += XFPhoto.DescribeItem(active, registry.ItemAt(i), withOptions);
          i += 1;
        }
        out += "]";
      }
    }
    return out + "}";
  }

  // Sets one photo-mode attribute the way the menu does (PhotoModeMenuListItem.ForceValue,
  // photoModeMenuController.script:1169). The plugin allowlists the keys per method; here the
  // value is checked against the range or options the game itself set up for that item, because
  // ForceValue silently picks the first option for an unknown option value.
  public static func SetAttribute(cid: String, key: Int32, value: Float) -> String {
    if !XFPhoto.Active() {
      return XFJson.Fail("not_in_photo_mode", "photo mode is not open");
    }
    let controller = XFPhoto.Controller();
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(controller) || !IsDefined(registry) {
      return XFJson.Fail("unavailable", "the photo-mode menu has not been seen yet; close and reopen photo mode");
    }
    let ukey = Cast<Uint32>(key);
    let item = registry.FindItem(ukey);
    let listItem = controller.GetMenuItem(ukey);
    if !IsDefined(item) || !IsDefined(listItem) {
      return XFJson.Fail("unavailable", "photo-mode setting " + IntToString(key) + " is not in the menu right now");
    }
    if Equals(item.kind, "options") {
      if Cast<Float>(RoundF(value)) != value {
        return XFJson.Fail("bad_params", "'" + item.label + "' takes one of its option values, a whole number, not " + FloatToString(value));
      }
      if !ArrayContains(item.optionData, RoundF(value)) {
        return XFJson.Fail("bad_params", "value " + FloatToString(value) + " is not one of the options of '" + item.label + "' (" + IntToString(ArraySize(item.optionData)) + " options; see photo.state with menu)");
      }
    } else {
      if Equals(item.kind, "slider") || Equals(item.kind, "hue") {
        if value < item.minValue || value > item.maxValue {
          return XFJson.Fail("bad_params", "'" + item.label + "' takes " + FloatToString(item.minValue) + " to " + FloatToString(item.maxValue) + ", not " + FloatToString(value));
        }
      } else {
        return XFJson.Fail("unavailable", "'" + item.label + "' is not a slider or option list");
      }
    }
    XFBridgeActions.EnsureSaveLock(cid);
    let beforeKnown = XFPhoto.HasValue(controller, item);
    let before = XFPhoto.CurrentValue(controller, item);
    listItem.ForceValue(value, true);
    let after = XFPhoto.CurrentValue(controller, item);
    if !XFPhoto.Matches(item, value, after) {
      // The menu took a different value (a stale option list, a changed range): put the earlier
      // value back when it is known, and refuse, so a wrong look is never reported as done.
      let restored = "its earlier value is unknown, so it was left as it is";
      if beforeKnown {
        listItem.ForceValue(before, true);
        restored = "it was set back to " + FloatToString(XFPhoto.CurrentValue(controller, item));
      }
      XFBridgeLog.Warn(cid, "photo attribute " + IntToString(key) + " (" + item.label + ") asked " + FloatToString(value) + ", got " + FloatToString(after) + "; " + restored);
      return XFJson.Fail("write_mismatch", "'" + item.label + "' became " + FloatToString(after) + " instead of " + FloatToString(value) + "; " + restored);
    }
    XFBridgeLog.Info(cid, "photo attribute " + IntToString(key) + " (" + item.label + ") " + FloatToString(before) + " -> " + FloatToString(after) + "; undo: set it back to " + FloatToString(before));
    return "{\"ok\":true,\"key\":" + IntToString(key) + ",\"label\":" + XFJson.Str(item.label) + ",\"before\":" + XFJson.Num(before) + ",\"before_known\":" + XFJson.Flag(beforeKnown) + ",\"after\":" + XFJson.Num(after) + "}";
  }

  // Restores every captured slider and option to the value it had when photo mode set it up.
  public static func ResetAttribute(cid: String, key: Int32) -> String {
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) {
      return XFJson.Fail("unavailable", "no photo-mode menu seen");
    }
    let item = registry.FindItem(Cast<Uint32>(key));
    if !IsDefined(item) {
      return XFJson.Fail("unavailable", "photo-mode setting " + IntToString(key) + " is not in the menu");
    }
    if Equals(item.kind, "options") {
      return XFPhoto.SetAttribute(cid, key, Cast<Float>(item.startData));
    }
    return XFPhoto.SetAttribute(cid, key, item.startValue);
  }

  // Leaves photo mode the way the menu's exit does when nothing needs confirming
  // (OnExitConfirmed(true), photoModeMenuController.script:140, 218).
  public static func Exit(cid: String) -> String {
    if !XFPhoto.Active() {
      return "{\"ok\":true,\"changed\":false,\"note\":\"photo mode was not open\"}";
    }
    let game = GetGameInstance();
    if GameInstance.GetPhotoModeSystem(game).IsExitLocked() {
      return XFJson.Fail("unavailable", "the game has locked photo mode's exit right now");
    }
    let controller = XFPhoto.Controller();
    if !IsDefined(controller) {
      return XFJson.Fail("unavailable", "the photo-mode menu has not been seen yet");
    }
    controller.OnExitConfirmed(true);
    XFBridgeLog.Info(cid, "photo mode exit requested; undo: photo.enter");
    return "{\"ok\":true,\"changed\":true}";
  }

  public static func SetUiVisible(cid: String, visible: Bool) -> String {
    if !XFPhoto.Active() {
      return XFJson.Fail("not_in_photo_mode", "photo mode is not open");
    }
    let controller = XFPhoto.Controller();
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(controller) || !IsDefined(registry) {
      return XFJson.Fail("unavailable", "the photo-mode menu has not been seen yet");
    }
    let before = !registry.IsPhotoUiHidden();
    controller.XFBridgeSetUiVisible(visible);
    registry.SetPhotoUiHidden(!visible);
    XFBridgeLog.Info(cid, "photo UI visible " + XFJson.Flag(before) + " -> " + XFJson.Flag(visible) + "; undo: photo.hud.hide with hidden=" + XFJson.Flag(!before));
    return "{\"ok\":true,\"hidden\":" + XFJson.Flag(!visible) + ",\"was_hidden\":" + XFJson.Flag(!before) + "}";
  }
}

// --- Character customisation (the mirror's appearance screen only) -------------------------------

public abstract class XFCharacter {
  public static func Count(option: ref<CharacterCustomizationOption>) -> Int32 {
    let appearance = option.info as gameuiAppearanceInfo;
    if IsDefined(appearance) {
      return ArraySize(appearance.definitions);
    }
    let morph = option.info as gameuiMorphInfo;
    if IsDefined(morph) {
      return ArraySize(morph.morphNames);
    }
    let switcher = option.info as gameuiSwitcherInfo;
    if IsDefined(switcher) {
      return ArraySize(switcher.options);
    }
    return 0;
  }

  public static func Kind(option: ref<CharacterCustomizationOption>) -> String {
    if IsDefined(option.info as gameuiAppearanceInfo) {
      return "appearance";
    }
    if IsDefined(option.info as gameuiMorphInfo) {
      return "morph";
    }
    if IsDefined(option.info as gameuiSwitcherInfo) {
      return "switcher";
    }
    return "unknown";
  }

  public static func ValueLabel(option: ref<CharacterCustomizationOption>, index: Int32) -> String {
    let appearance = option.info as gameuiAppearanceInfo;
    if IsDefined(appearance) && index >= 0 && index < ArraySize(appearance.definitions) {
      return NameToString(appearance.definitions[index].name);
    }
    let morph = option.info as gameuiMorphInfo;
    if IsDefined(morph) && index >= 0 && index < ArraySize(morph.morphNames) {
      return NameToString(morph.morphNames[index].morphName);
    }
    let switcher = option.info as gameuiSwitcherInfo;
    if IsDefined(switcher) && index >= 0 && index < ArraySize(switcher.options) {
      return GetLocalizedText(switcher.options[index].localizedName);
    }
    return "";
  }

  public static func Describe(option: ref<CharacterCustomizationOption>, withValues: Bool) -> String {
    let count = XFCharacter.Count(option);
    let out = "{\"name\":" + XFJson.Name(option.info.name) + ",\"label\":" + XFJson.Str(GetLocalizedText(option.info.localizedName)) + ",\"slot\":" + XFJson.Name(option.info.uiSlot) + ",\"kind\":" + XFJson.Str(XFCharacter.Kind(option));
    out += ",\"index\":" + IntToString(Cast<Int32>(option.currIndex)) + ",\"previous\":" + IntToString(Cast<Int32>(option.prevIndex)) + ",\"count\":" + IntToString(count);
    out += ",\"value\":" + XFJson.Str(XFCharacter.ValueLabel(option, Cast<Int32>(option.currIndex)));
    out += ",\"active\":" + XFJson.Flag(option.isActive) + ",\"editable\":" + XFJson.Flag(option.isEditable) + ",\"censored\":" + XFJson.Flag(option.isCensored);
    if withValues {
      out += ",\"values\":[";
      let i = 0;
      while i < count {
        if i > 0 {
          out += ",";
        }
        out += XFJson.Str(XFCharacter.ValueLabel(option, i));
        i += 1;
      }
      out += "]";
    }
    return out + "}";
  }

  // Finds an option by its internal name, or else by its on-screen label. Returns null when there
  // is no match or more than one.
  public static func Find(options: array<ref<CharacterCustomizationOption>>, wanted: String) -> ref<CharacterCustomizationOption> {
    let i = 0;
    while i < ArraySize(options) {
      if IsDefined(options[i]) && IsDefined(options[i].info) && Equals(NameToString(options[i].info.name), wanted) {
        return options[i];
      }
      i += 1;
    }
    let found: ref<CharacterCustomizationOption>;
    let matches = 0;
    i = 0;
    while i < ArraySize(options) {
      if IsDefined(options[i]) && IsDefined(options[i].info) && Equals(GetLocalizedText(options[i].info.localizedName), wanted) {
        found = options[i];
        matches += 1;
      }
      i += 1;
    }
    if matches == 1 {
      return found;
    }
    return null;
  }

  // Read-only. Outside the appearance screen the option list is not trusted (the game rebuilds it
  // only when the menu opens), so only the finalized state's flags and tags are reported.
  public static func Appearance(cid: String, option: String) -> String {
    let game = GetGameInstance();
    if !GameInstance.IsValid(game) {
      return XFJson.Fail("game_not_ready", "no game instance yet");
    }
    let system = GameInstance.GetCharacterCustomizationSystem(game);
    let state = system.GetState();
    let menuOpen = XFBridgeActions.CharacterMenuOpen();
    let out = "{\"ok\":true,\"character_menu_open\":" + XFJson.Flag(menuOpen);
    if IsDefined(state) {
      out += ",\"state\":{\"body_male\":" + XFJson.Flag(state.IsBodyGenderMale()) + ",\"brain_male\":" + XFJson.Flag(state.IsBrainGenderMale());
      out += ",\"life_path\":" + XFJson.Str(TDBID.ToStringDEBUG(state.GetLifePath()));
      out += ",\"hair_tags\":[";
      let tags: array<CName> = [n"Short", n"Long", n"Dreads", n"Buzz"];
      let first = true;
      let t = 0;
      while t < ArraySize(tags) {
        if state.HasTag(tags[t]) {
          if !first {
            out += ",";
          }
          out += XFJson.Name(tags[t]);
          first = false;
        }
        t += 1;
      }
      out += "]}";
    } else {
      out += ",\"state\":null";
    }
    if menuOpen {
      let options = system.GetUnitedOptions(true, true, true);
      if StrLen(option) > 0 {
        let match = XFCharacter.Find(options, option);
        if !IsDefined(match) {
          return XFJson.Fail("bad_params", "no single option named or labelled '" + option + "' on this screen");
        }
        out += ",\"option\":" + XFCharacter.Describe(match, true);
      } else {
        out += ",\"options\":[";
        let i = 0;
        let n = 0;
        while i < ArraySize(options) {
          if IsDefined(options[i]) && IsDefined(options[i].info) {
            if n > 0 {
              out += ",";
            }
            out += XFCharacter.Describe(options[i], false);
            n += 1;
          }
          i += 1;
        }
        out += "]";
      }
    }
    return out + "}";
  }

  public static func HasOption(group: String, option: String, fpp: Bool) -> Bool {
    let state = GameInstance.GetCharacterCustomizationSystem(GetGameInstance()).GetState();
    return IsDefined(state) && state.HasOption(StringToName(group), StringToName(option), fpp);
  }

  // Sets one option on the open appearance screen, exactly as the menu's own controls do
  // (ApplyChangeToOption; characterCreationBodyMorphMenu.script:481, 814, 828). Never confirms:
  // the change stays a preview until the player confirms or backs out of the screen.
  public static func Apply(cid: String, option: String, index: Int32) -> String {
    let game = GetGameInstance();
    if !XFBridgeActions.CharacterMenuOpen() {
      return XFJson.Fail("not_in_character_menu", "the appearance screen (mirror or ripperdoc) is not open");
    }
    let menu = XFBridgeRegistry.Get().GetCharacterMenu();
    if NotEquals(menu.m_busySwitchingAppearance, BusySwitchingReason.AVAILABLE) {
      return XFJson.Fail("busy", "the appearance screen is still applying the previous change");
    }
    let system = GameInstance.GetCharacterCustomizationSystem(game);
    let match = XFCharacter.Find(system.GetUnitedOptions(true, true, true), option);
    if !IsDefined(match) {
      return XFJson.Fail("bad_params", "no single option named or labelled '" + option + "' on this screen");
    }
    if !match.isActive || !match.isEditable || match.isCensored {
      return XFJson.Fail("bad_params", "option '" + option + "' can't be changed on this screen");
    }
    let count = XFCharacter.Count(match);
    if index < 0 || index >= count {
      return XFJson.Fail("bad_params", "option '" + option + "' has values 0 to " + IntToString(count - 1) + ", not " + IntToString(index));
    }
    XFBridgeActions.EnsureSaveLock(cid);
    let before = Cast<Int32>(match.currIndex);
    system.ApplyChangeToOption(match, Cast<Uint32>(index));
    XFBridgeLog.Info(cid, "cc.apply " + NameToString(match.info.name) + " " + IntToString(before) + " -> " + IntToString(index) + "; undo: cc.apply index " + IntToString(before) + ", or Back in the mirror (discards every change)");
    return "{\"ok\":true,\"option\":" + XFJson.Name(match.info.name) + ",\"label\":" + XFJson.Str(GetLocalizedText(match.info.localizedName)) + ",\"before\":" + IntToString(before) + ",\"after\":" + IntToString(index) + ",\"count\":" + IntToString(count) + ",\"value\":" + XFJson.Str(XFCharacter.ValueLabel(match, index)) + ",\"before_value\":" + XFJson.Str(XFCharacter.ValueLabel(match, before)) + "}";
  }
}

// --- World ---------------------------------------------------------------------------------------

public abstract class XFWorld {
  public static func Clock(cid: String) -> String {
    let time = GameInstance.GetTimeSystem(GetGameInstance());
    let now = time.GetGameTime();
    return "{\"ok\":true,\"day\":" + IntToString(GameTime.Days(now)) + ",\"hours\":" + IntToString(GameTime.Hours(now)) + ",\"minutes\":" + IntToString(GameTime.Minutes(now)) + ",\"seconds\":" + IntToString(GameTime.Seconds(now)) + ",\"total_seconds\":" + IntToString(GameTime.GetSeconds(now)) + "}";
  }

  // Only with V in the world: not in menus, photo mode (it has its own time slider) or the mirror.
  public static func RequireGameplay() -> String {
    let phase = XFBridgeActions.Phase();
    if Equals(phase, "gameplay") {
      return "";
    }
    return XFJson.Fail("not_in_gameplay", "the game is in phase '" + phase + "'");
  }

  // Sets the clock (SetGameTimeByHMS), or restores an exact earlier time including the day
  // (SetGameTimeBySeconds) when totalSeconds >= 0.
  public static func SetTime(cid: String, hours: Int32, minutes: Int32, seconds: Int32, totalSeconds: Int32) -> String {
    let refusal = XFWorld.RequireGameplay();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    XFBridgeActions.EnsureSaveLock(cid);
    let time = GameInstance.GetTimeSystem(GetGameInstance());
    let before = GameTime.GetSeconds(time.GetGameTime());
    if totalSeconds >= 0 {
      time.SetGameTimeBySeconds(totalSeconds);
    } else {
      time.SetGameTimeByHMS(hours, minutes, seconds);
    }
    let after = GameTime.GetSeconds(time.GetGameTime());
    XFBridgeLog.Info(cid, "world time " + IntToString(before) + " -> " + IntToString(after) + " s; undo: world.time.set total_seconds=" + IntToString(before));
    return "{\"ok\":true,\"before_total_seconds\":" + IntToString(before) + ",\"after_total_seconds\":" + IntToString(after) + "}";
  }

  // Freezes the world the way the appearance screen does (time dilation 0 on the world and on V,
  // characterCreationBodyMorphMenu.script:1107-1117), under our own reason so it never collides.
  public static func SetFrozen(cid: String, frozen: Bool) -> String {
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) {
      return XFJson.Fail("game_not_ready", "no game session yet");
    }
    let time = GameInstance.GetTimeSystem(GetGameInstance());
    if !frozen {
      let was = registry.IsWorldFrozen();
      time.UnsetTimeDilation(n"XFBridgeFreeze");
      time.UnsetTimeDilationOnLocalPlayerZero(n"XFBridgeFreeze");
      registry.SetWorldFrozen(false);
      XFBridgeLog.Info(cid, "world unfrozen");
      return "{\"ok\":true,\"frozen\":false,\"was_frozen\":" + XFJson.Flag(was) + "}";
    }
    let refusal = XFWorld.RequireGameplay();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    let wasFrozen = registry.IsWorldFrozen();
    XFBridgeActions.EnsureSaveLock(cid);
    time.SetTimeDilation(n"XFBridgeFreeze", 0.0);
    time.SetTimeDilationOnLocalPlayerZero(n"XFBridgeFreeze", 0.0);
    registry.SetWorldFrozen(true);
    XFBridgeLog.Info(cid, "world frozen (time dilation 0, reason XFBridgeFreeze); undo: world.pause paused=" + XFJson.Flag(wasFrozen) + ", or the kill switch");
    return "{\"ok\":true,\"frozen\":true,\"was_frozen\":" + XFJson.Flag(wasFrozen) + "}";
  }
}
