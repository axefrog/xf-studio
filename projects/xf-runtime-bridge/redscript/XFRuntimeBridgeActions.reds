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
  private let m_cursorHidden: Bool;
  private let m_cursors: array<wref<CursorGameController>>;
  private let m_photoPuppet: wref<GameObject>;
  // cc.open's request, picked up by the idle menu scenario (OnXFBridgeOpenCreator below).
  private let m_ccOpenRequested: Bool;
  private let m_ccOpenMode: Int32;
  private let m_ccOpenAt: Float;
  private let m_ccOpenCid: String;

  // Null until a game session has scriptable systems. Guarded step by step: the cursor wrap below
  // runs in every menu, including the main menu, and a method called on a missing container would
  // reach a native member function without an object.
  public static func Get() -> ref<XFBridgeRegistry> {
    let game = GetGameInstance();
    if !GameInstance.IsValid(game) {
      return null;
    }
    let container = GameInstance.GetScriptableSystemsContainer(game);
    if !IsDefined(container) {
      return null;
    }
    return container.Get(n"XFRuntimeBridge.XFBridgeRegistry") as XFBridgeRegistry;
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
    this.m_photoPuppet = null;
  }

  // V's stand-in in photo mode (the entity PhotoModePlayerEntityComponent sets up), for photo.subject.
  public func SetPhotoPuppet(puppet: wref<GameObject>) -> Void {
    this.m_photoPuppet = puppet;
  }

  public func GetPhotoPuppet() -> wref<GameObject> {
    return this.m_photoPuppet;
  }

  // The mouse cursor, hidden with the photo-mode interface for clean captures. Every cursor
  // controller that plays a context is noted (the ProcessCursorContext wrap below); while the flag
  // is set, the wrap turns every context into Hide, so photo mode can't show the cursor again on its
  // own. Setting or clearing the flag replays each noted controller's state at once. The technique
  // (a context override behind a flag) was learned from Appearance Menu Mod's CET override of the
  // same function (knowledge/photo-mode.md §6); this is our own redscript. Cleared on show, when
  // photo mode closes, and by the kill switch.
  public func NoteCursor(controller: wref<CursorGameController>) -> Void {
    let i = 0;
    while i < ArraySize(this.m_cursors) {
      if this.m_cursors[i] == controller {
        return;
      }
      if !IsDefined(this.m_cursors[i]) {
        ArrayErase(this.m_cursors, i);
      } else {
        i += 1;
      }
    }
    ArrayPush(this.m_cursors, controller);
  }

  public func SetCursorHidden(hidden: Bool) -> Void {
    let changed = NotEquals(this.m_cursorHidden, hidden);
    this.m_cursorHidden = hidden;
    if !changed {
      return;
    }
    let i = 0;
    while i < ArraySize(this.m_cursors) {
      let controller = this.m_cursors[i];
      if IsDefined(controller) {
        controller.XFBridgeApplyCursor();
      }
      i += 1;
    }
  }

  public func IsCursorHidden() -> Bool {
    return this.m_cursorHidden;
  }

  public func CursorControllers() -> Int32 {
    return ArraySize(this.m_cursors);
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

  // cc.open: one pending request at a time, valid for three seconds of engine time. Only a request
  // made here lets the idle menu scenario open the appearance screen; any other event of that name
  // does nothing.
  public func RequestCreatorOpen(mode: Int32, now: Float, cid: String) -> Void {
    this.m_ccOpenRequested = true;
    this.m_ccOpenMode = mode;
    this.m_ccOpenAt = now;
    this.m_ccOpenCid = cid;
  }

  // The requested edit mode, once, or -1 when there is no fresh request.
  public func TakeCreatorOpen(now: Float) -> Int32 {
    if !this.m_ccOpenRequested {
      return -1;
    }
    this.m_ccOpenRequested = false;
    if now - this.m_ccOpenAt > 3.0 || now < this.m_ccOpenAt {
      XFBridgeLog.Warn(this.m_ccOpenCid, "cc.open request expired before the menu picked it up; nothing opened");
      return -1;
    }
    return this.m_ccOpenMode;
  }

  public func CreatorOpenCid() -> String {
    return this.m_ccOpenCid;
  }

  public func CancelCreatorOpen() -> Bool {
    let was = this.m_ccOpenRequested;
    this.m_ccOpenRequested = false;
    return was;
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
    registry.SetCursorHidden(false);
  }
  return result;
}

@wrapMethod(gameuiPhotoModeMenuController)
protected cb func OnHide() -> Bool {
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    // Give the cursor back before photo mode closes, so no later menu inherits a hidden cursor.
    registry.SetCursorHidden(false);
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

// V's photo-mode stand-in as the controller knows it (native-set; no script assigns it).
@addMethod(gameuiPhotoModeMenuController)
public func XFBridgeFakePlayer() -> wref<PlayerPuppet> {
  return this.m_fakePlayer;
}

// Notes every cursor controller, and plays Hide instead of any context while the bridge hides the
// cursor (signature from cursorGameController.script:343). Only while photo mode is open (RB-34): if
// photo mode ever closes without OnHide, no other menu inherits a hidden cursor, and Status and an
// idle disconnect clear the flag as well.
@wrapMethod(CursorGameController)
private final func ProcessCursorContext(const context: CName, data: ref<inkUserData>, opt force: Bool) -> Void {
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    registry.NoteCursor(this);
    if registry.IsCursorHidden() && XFPhoto.Active() {
      wrappedMethod(n"Hide", null, force);
      return;
    }
  }
  wrappedMethod(context, data, force);
}

// Replays the cursor's state now: Hide while the bridge hides it, otherwise Show or Hide as the
// controller's own visibility says.
@addMethod(CursorGameController)
public func XFBridgeApplyCursor() -> Void {
  if this.m_isCursorVisible {
    this.ProcessCursorContext(n"Show", null, true);
  } else {
    this.ProcessCursorContext(n"Hide", null, true);
  }
}

// Remembers V's photo-mode stand-in when photo mode sets it up (photoModePlayerEntity.script:378;
// called by the game, not by any script).
@wrapMethod(PhotoModePlayerEntityComponent)
private final func SetupInventory(isCurrentPlayerObjectCustomizable: Bool) -> Void {
  wrappedMethod(isCurrentPlayerObjectCustomizable);
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    registry.SetPhotoPuppet(this.GetEntity() as GameObject);
  }
}

@wrapMethod(characterCreationBodyMorphMenu)
protected cb func OnInitialize() -> Bool {
  let result = wrappedMethod();
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    registry.SetCharacterMenu(this);
    registry.CancelCreatorOpen();
  }
  return result;
}

// cc.page: points the creator's preview camera at one region, as hovering a row does (the base
// menu's own RequestCameraChange, characterCreationMenu.script:73; the slot names are the menu's
// GetSlotName ones). None returns it to the menu's starting view (m_defaultPreviewSlot).
@addMethod(characterCreationBodyMorphMenu)
public func XFBridgeCameraTo(slot: CName) -> Void {
  if Equals(slot, n"None") {
    this.RequestCameraChange(this.m_defaultPreviewSlot);
  } else {
    this.RequestCameraChange(slot);
  }
}

// cc.open: the idle menu scenario (normal play, no menu) switches to the mirror's own scenario when
// the bridge asked for it. Reached through the game's menu-event blackboard, which the in-game menu
// controller turns into this scenario event (GameObject.TriggerMenuEvent, gameObject.script:2480;
// inGameMenuGameController.script:294). The vanilla mirror scenario then marks the data as an edit of
// V's finalized look and opens the creator (inGameScenarios.script:217-247). Adding an event to a
// menu scenario is how Mod Settings adds its pause-menu entry; the route to the mirror scenario was
// learned from Character Customization Anywhere (knowledge/photo-mode.md §3.1). Our own code.
@addMethod(MenuScenario_Idle)
protected cb func OnXFBridgeOpenCreator() -> Bool {
  let registry = XFBridgeRegistry.Get();
  if !IsDefined(registry) {
    return false;
  }
  let game = GetGameInstance();
  let mode = registry.TakeCreatorOpen(EngineTime.ToFloat(GameInstance.GetEngineTime(game)));
  if mode < 0 {
    return false;
  }
  let cid = registry.CreatorOpenCid();
  let refusal = XFCharacter.OpenRefusal();
  if StrLen(refusal) > 0 {
    XFBridgeLog.Warn(cid, "cc.open: the moment passed before the menu picked the request up; nothing opened: " + refusal);
    return false;
  }
  let data = new MorphMenuUserData();
  if mode == 2 {
    data.m_editMode = gameuiCharacterCustomizationEditTag.Ripperdoc;
  } else {
    data.m_editMode = gameuiCharacterCustomizationEditTag.HairDresser;
  }
  this.SwitchToScenario(n"MenuScenario_CharacterCustomizationMirror", data);
  XFBridgeLog.Info(cid, "cc.open: switched to MenuScenario_CharacterCustomizationMirror (edit mode " + XFCharacter.ModeName(mode) + "); undo: cc.back");
  return true;
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
    // The cursor is hidden only for photo-mode captures: any other phase clears the flag (RB-34),
    // in case photo mode closed without its OnHide.
    if NotEquals(phase, "photo_mode") {
      let cursorRegistry = XFBridgeRegistry.Get();
      if IsDefined(cursorRegistry) && cursorRegistry.IsCursorHidden() {
        cursorRegistry.SetCursorHidden(false);
        XFBridgeLog.Info(cid, "cursor hide cleared: the game is in '" + phase + "', not photo mode");
      }
    }
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
        out += ",\"cursor_hidden\":" + XFJson.Flag(registry.IsCursorHidden());
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
    if registry.IsCursorHidden() {
      registry.SetCursorHidden(false);
      out += ",\"cursor_shown\":true";
    }
    if registry.CancelCreatorOpen() {
      out += ",\"creator_open_withdrawn\":true";
    }
    // An appearance screen the bridge opened stays open: Back discards its changes, and the player
    // decides. The save lock stays: whatever the bridge changed (a light, the clock, a creator option) may
    // still be live, and a save now would keep it. The lock is not persistent; loading a save
    // clears it.
    if registry.IsSaveLockHeld() {
      out += ",\"save_lock_kept\":true";
    }
    XFBridgeLog.Info(cid, "RestoreAfterKill " + out + "}");
    return out + "}";
  }

  // Called by the plugin when it drops a client for idleness (idle_disconnect_seconds): nobody is
  // driving photo mode any more, so the mouse cursor comes back (RB-34). The menu's fade is left to
  // the player's own photo-mode keys.
  public static func ReleaseCursor(cid: String) -> String {
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) || !registry.IsCursorHidden() {
      return "{\"ok\":true,\"cursor_shown\":false}";
    }
    registry.SetCursorHidden(false);
    XFBridgeLog.Info(cid, "cursor hide cleared after an idle disconnect");
    return "{\"ok\":true,\"cursor_shown\":true}";
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

  // Fades the photo-mode interface out or in; with cursor, also hides or shows the mouse cursor
  // (XFBridgeRegistry.SetCursorHidden).
  public static func SetUiVisible(cid: String, visible: Bool, cursor: Bool) -> String {
    if !XFPhoto.Active() {
      return XFJson.Fail("not_in_photo_mode", "photo mode is not open");
    }
    let controller = XFPhoto.Controller();
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(controller) || !IsDefined(registry) {
      return XFJson.Fail("unavailable", "the photo-mode menu has not been seen yet");
    }
    let before = !registry.IsPhotoUiHidden();
    let cursorBefore = registry.IsCursorHidden();
    controller.XFBridgeSetUiVisible(visible);
    registry.SetPhotoUiHidden(!visible);
    if cursor {
      registry.SetCursorHidden(!visible);
    }
    let cursorAfter = registry.IsCursorHidden();
    XFBridgeLog.Info(cid, "photo UI visible " + XFJson.Flag(before) + " -> " + XFJson.Flag(visible) + ", cursor hidden " + XFJson.Flag(cursorBefore) + " -> " + XFJson.Flag(cursorAfter) + "; undo: photo.hud.hide with hidden=" + XFJson.Flag(!before));
    return "{\"ok\":true,\"hidden\":" + XFJson.Flag(!visible) + ",\"was_hidden\":" + XFJson.Flag(!before) + ",\"cursor_hidden\":" + XFJson.Flag(cursorAfter) + ",\"was_cursor_hidden\":" + XFJson.Flag(cursorBefore) + ",\"cursor_controllers\":" + IntToString(registry.CursorControllers()) + "}";
  }

  // --- Subject and camera, for framing (photo.subject) ---------------------------------------

  public static func Vec(v: Vector4) -> String {
    return "{\"x\":" + XFJson.Num(v.X) + ",\"y\":" + XFJson.Num(v.Y) + ",\"z\":" + XFJson.Num(v.Z) + "}";
  }

  public static func Screen(v: Vector4) -> String {
    return "{\"x\":" + FloatToStringPrec(v.X, 6) + ",\"y\":" + FloatToStringPrec(v.Y, 6) + ",\"z\":" + FloatToStringPrec(v.Z, 6) + ",\"w\":" + FloatToStringPrec(v.W, 6) + "}";
  }

  public static func PoseItem(controller: wref<gameuiPhotoModeMenuController>, registry: ref<XFBridgeRegistry>, name: String, key: Uint32) -> String {
    let item = registry.FindItem(key);
    if !IsDefined(item) || !IsDefined(controller) || !XFPhoto.HasValue(controller, item) {
      return "\"" + name + "\":null";
    }
    let out = "\"" + name + "\":{\"value\":" + XFJson.Num(XFPhoto.CurrentValue(controller, item));
    if Equals(item.kind, "slider") {
      out += ",\"min\":" + XFJson.Num(item.minValue) + ",\"max\":" + XFJson.Num(item.maxValue) + ",\"step\":" + XFJson.Num(item.step);
    }
    return out + "}";
  }

  // Read-only. Where V's head is (the photo-mode stand-in's "Head" slot, plus an offset in metres:
  // up along the world's Z, forward and right along V's own facing) in the world and on screen, and
  // the photo-mode camera (CameraSystem: active camera transform, field of view, aspect ratio,
  // ProjectPoint). Screen positions are ProjectPoint's raw answer; "center" projects a point 5 m
  // straight ahead of the camera, so the caller can tell which screen space ProjectPoint uses.
  public static func Subject(cid: String, up: Float, forward: Float, right: Float) -> String {
    if !XFPhoto.Active() {
      return XFJson.Fail("not_in_photo_mode", "photo mode is not open");
    }
    let game = GetGameInstance();
    let registry = XFBridgeRegistry.Get();
    let controller = XFPhoto.Controller();
    if !IsDefined(registry) {
      return XFJson.Fail("unavailable", "no game session yet");
    }
    let source = "photo_puppet";
    let puppet: wref<GameObject> = registry.GetPhotoPuppet();
    if !IsDefined(puppet) && IsDefined(controller) {
      puppet = controller.XFBridgeFakePlayer();
      source = "photo_controller";
    }
    if !IsDefined(puppet) {
      return XFJson.Fail("unavailable", "V's photo-mode stand-in hasn't been seen yet; close and reopen photo mode");
    }
    let slot = "";
    let head: Vector4;
    let slotTransform: WorldTransform;
    let scripted = puppet as ScriptedPuppet;
    if IsDefined(scripted) {
      let slots = scripted.GetSlotComponent();
      if IsDefined(slots) && slots.GetSlotTransform(n"Head", slotTransform) {
        head = WorldPosition.ToVector4(WorldTransform.GetWorldPosition(slotTransform));
        slot = "Head";
      } else {
        let hitSlots = scripted.GetHitRepresantationSlotComponent();
        if IsDefined(hitSlots) && hitSlots.GetSlotTransform(n"Head", slotTransform) {
          head = WorldPosition.ToVector4(WorldTransform.GetWorldPosition(slotTransform));
          slot = "Head (hit representation)";
        }
      }
    }
    let approximate = false;
    if StrLen(slot) == 0 {
      // No head slot: V's position plus a standing head height. Good enough to centre roughly.
      head = puppet.GetWorldPosition();
      head.Z += 1.62;
      approximate = true;
    }
    let f = puppet.GetWorldForward();
    let r = new Vector4(f.Y, -f.X, 0.0, 0.0);
    let target = new Vector4(head.X + f.X * forward + r.X * right, head.Y + f.Y * forward + r.Y * right, head.Z + up + f.Z * forward, 1.0);
    let camera = GameInstance.GetCameraSystem(game);
    let camTransform: Transform;
    if !camera.GetActiveCameraWorldTransform(camTransform) {
      return XFJson.Fail("unavailable", "the camera system reported no active camera");
    }
    let camPos = camTransform.position;
    let cf = camera.GetActiveCameraForward();
    let cr = camera.GetActiveCameraRight();
    let cu = camera.GetActiveCameraUp();
    let center = new Vector4(camPos.X + cf.X * 5.0, camPos.Y + cf.Y * 5.0, camPos.Z + cf.Z * 5.0, 1.0);
    let upPoint = new Vector4(target.X + cu.X * 0.1, target.Y + cu.Y * 0.1, target.Z + cu.Z * 0.1, 1.0);
    let rightPoint = new Vector4(target.X + cr.X * 0.1, target.Y + cr.Y * 0.1, target.Z + cr.Z * 0.1, 1.0);
    let out = "{\"ok\":true,\"subject\":" + XFJson.Str(source) + ",\"slot\":" + XFJson.Str(slot) + ",\"approximate\":" + XFJson.Flag(approximate);
    out += ",\"head\":" + XFPhoto.Vec(head) + ",\"target\":" + XFPhoto.Vec(target) + ",\"subject_forward\":" + XFPhoto.Vec(f);
    out += ",\"offset\":{\"up\":" + XFJson.Num(up) + ",\"forward\":" + XFJson.Num(forward) + ",\"right\":" + XFJson.Num(right) + "}";
    out += ",\"camera\":{\"position\":" + XFPhoto.Vec(camPos) + ",\"forward\":" + XFPhoto.Vec(cf) + ",\"right\":" + XFPhoto.Vec(cr) + ",\"up\":" + XFPhoto.Vec(cu);
    out += ",\"fov\":" + XFJson.Num(camera.GetActiveCameraFOV()) + ",\"aspect\":" + XFJson.Num(camera.GetAspectRatio()) + "}";
    out += ",\"screen\":{\"target\":" + XFPhoto.Screen(camera.ProjectPoint(target)) + ",\"head\":" + XFPhoto.Screen(camera.ProjectPoint(head));
    out += ",\"center\":" + XFPhoto.Screen(camera.ProjectPoint(center)) + ",\"up\":" + XFPhoto.Screen(camera.ProjectPoint(upPoint)) + ",\"right\":" + XFPhoto.Screen(camera.ProjectPoint(rightPoint)) + "}";
    out += ",\"pose\":{" + XFPhoto.PoseItem(controller, registry, "fov", 1u) + "," + XFPhoto.PoseItem(controller, registry, "yaw", 7u) + "," + XFPhoto.PoseItem(controller, registry, "left_right", 8u);
    out += "," + XFPhoto.PoseItem(controller, registry, "near_far", 9u) + "," + XFPhoto.PoseItem(controller, registry, "up_down", 37u) + "," + XFPhoto.PoseItem(controller, registry, "look_at", 15u) + "}";
    XFBridgeLog.Debug(cid, "photo subject " + source + " slot=" + slot);
    return out + "}";
  }
}

// --- V's photo-mode face (face.rig.read, photo.expression.index) ---------------------------------
//
// Photo mode gives V's stand-in a head item, Items.PlayerWaPhotomodeHead or PlayerMaPhotomodeHead, in
// that item's placement slot (photoModePlayerEntity.script:430-439); the face graph is expected on
// that item, the animation controller on the stand-in (research/animation/expressions-evidence.md).
// face.rig.read finds components by name here and the plugin reads their animation setup; the
// expression route is the game's own photo-mode face input, AnimFeature_PhotomodeFacial
// (orphans.script:48825), queued with AnimationControllerComponent.ApplyFeature and followed by the
// face graph's updateFacialPose event (animationControllerComponent.script:30, 61).

// A component by name. Entity.FindComponentByName is protected (entity.script:32), so the bridge adds
// a public member that calls it.
@addMethod(Entity)
public func XFBridgeComponent(name: CName) -> ref<IComponent> {
  return this.FindComponentByName(name);
}

public abstract class XFFace {
  // 0: V's photo-mode stand-in; 1: the head item photo mode gave it. Null when not seen.
  public static func Target(target: Int32) -> ref<GameObject> {
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) || !XFPhoto.Active() {
      return null;
    }
    let puppet: ref<GameObject> = registry.GetPhotoPuppet();
    if !IsDefined(puppet) {
      let controller = registry.GetPhotoController();
      if IsDefined(controller) {
        puppet = controller.XFBridgeFakePlayer();
      }
    }
    if !IsDefined(puppet) || target == 0 {
      return puppet;
    }
    // Both photo-mode heads share one placement slot; asking for each finds whichever is there.
    let ts = GameInstance.GetTransactionSystem(puppet.GetGame());
    let heads: array<TweakDBID> = [t"Items.PlayerWaPhotomodeHead", t"Items.PlayerMaPhotomodeHead"];
    let i = 0;
    while i < ArraySize(heads) {
      let item = ts.GetItemInSlot(puppet, EquipmentSystem.GetPlacementSlot(ItemID.FromTDBID(heads[i])));
      if IsDefined(item) {
        return item;
      }
      i += 1;
    }
    return null;
  }

  public static func TargetName(target: Int32) -> String {
    if target == 0 {
      return "puppet";
    }
    return "head";
  }

  // Read-only: what the target is (class, appearance, the head item's record).
  public static func Describe(cid: String, target: Int32) -> String {
    if !XFPhoto.Active() {
      return XFJson.Fail("not_in_photo_mode", "photo mode is not open");
    }
    let obj = XFFace.Target(target);
    if !IsDefined(obj) {
      return XFJson.Fail("unavailable", "V's photo-mode " + XFFace.TargetName(target) + " hasn't been seen yet; close and reopen photo mode");
    }
    let out = "{\"ok\":true,\"target\":" + XFJson.Str(XFFace.TargetName(target)) + ",\"class\":" + XFJson.Name(obj.GetClassName());
    out += ",\"appearance\":" + XFJson.Name(obj.GetCurrentAppearanceName());
    let item = obj as ItemObject;
    if IsDefined(item) {
      out += ",\"record\":" + XFJson.Str(TDBID.ToStringDEBUG(ItemID.GetTDBID(item.GetItemID())));
    }
    XFBridgeLog.Debug(cid, "face target " + XFFace.TargetName(target) + " " + NameToString(obj.GetClassName()));
    return out + "}";
  }

  // One component of the target, by name, for the plugin to read (null when absent). Read-only.
  public static func Component(cid: String, target: Int32, name: CName) -> ref<IScriptable> {
    let obj = XFFace.Target(target);
    if !IsDefined(obj) {
      return null;
    }
    return obj.XFBridgeComponent(name);
  }

  // Applies a photo-mode face index directly: the input the photo-mode face graph reads, then the
  // event that makes it switch (1 s cross-fade). Unless unlisted, only an index the photo-mode
  // expression list offers. Reports the menu's expression, which the undo selects again.
  public static func ApplyIndex(cid: String, target: Int32, index: Int32, unlisted: Bool) -> String {
    if !XFPhoto.Active() {
      return XFJson.Fail("not_in_photo_mode", "photo mode is not open");
    }
    let registry = XFBridgeRegistry.Get();
    let controller = XFPhoto.Controller();
    let item: ref<XFPhotoItem>;
    if IsDefined(registry) {
      item = registry.FindItem(28u);
    }
    let menuKnown = IsDefined(controller) && IsDefined(item) && XFPhoto.HasValue(controller, item);
    if !unlisted {
      if !IsDefined(item) || !Equals(item.kind, "options") {
        return XFJson.Fail("unavailable", "the photo-mode expression list hasn't been seen yet; close and reopen photo mode, or pass unlisted");
      }
      if !ArrayContains(item.optionData, index) {
        return XFJson.Fail("bad_params", "index " + IntToString(index) + " is not one of the photo-mode expression values (" + IntToString(ArraySize(item.optionData)) + " of them; see photo.state with options); pass unlisted to apply it anyway");
      }
    }
    let obj = XFFace.Target(target);
    if !IsDefined(obj) {
      return XFJson.Fail("unavailable", "V's photo-mode " + XFFace.TargetName(target) + " hasn't been seen yet; close and reopen photo mode");
    }
    let menuValue = -1.0;
    if menuKnown {
      menuValue = XFPhoto.CurrentValue(controller, item);
    }
    XFBridgeActions.EnsureSaveLock(cid);
    let feature = new AnimFeature_PhotomodeFacial();
    feature.facialPoseIndex = index;
    AnimationControllerComponent.ApplyFeature(obj, n"PhotomodeFacial", feature);
    AnimationControllerComponent.PushEvent(obj, n"updateFacialPose");
    XFBridgeLog.Info(cid, "photo face index " + IntToString(index) + " on the " + XFFace.TargetName(target) + " (PhotomodeFacial, updateFacialPose); the menu shows " + FloatToString(menuValue) + "; undo: photo.expression.set to the menu's value");
    return "{\"ok\":true,\"target\":" + XFJson.Str(XFFace.TargetName(target)) + ",\"index\":" + IntToString(index) + ",\"unlisted\":" + XFJson.Flag(unlisted) + ",\"menu_value\":" + XFJson.Num(menuValue) + ",\"menu_value_known\":" + XFJson.Flag(menuKnown) + "}";
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
      out += "],\"labels\":[";
      i = 0;
      while i < count {
        if i > 0 {
          out += ",";
        }
        out += XFJson.Str(XFCharacter.ValueText(option, i));
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
    // Then by UI slot: the one active option in that slot (a slot holds one active option at a time),
    // so a colour row can be named by its slot, e.g. piercings_color, whichever style is chosen.
    matches = 0;
    i = 0;
    while i < ArraySize(options) {
      if IsDefined(options[i]) && IsDefined(options[i].info) && options[i].isActive && Equals(NameToString(options[i].info.uiSlot), wanted) {
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

  // A value's on-screen text (its localised name), where ValueLabel gives the internal name.
  public static func ValueText(option: ref<CharacterCustomizationOption>, index: Int32) -> String {
    let appearance = option.info as gameuiAppearanceInfo;
    if IsDefined(appearance) && index >= 0 && index < ArraySize(appearance.definitions) {
      return GetLocalizedText(appearance.definitions[index].localizedName);
    }
    let morph = option.info as gameuiMorphInfo;
    if IsDefined(morph) && index >= 0 && index < ArraySize(morph.morphNames) {
      return GetLocalizedText(morph.morphNames[index].localizedName);
    }
    let switcher = option.info as gameuiSwitcherInfo;
    if IsDefined(switcher) && index >= 0 && index < ArraySize(switcher.options) {
      return GetLocalizedText(switcher.options[index].localizedName);
    }
    return "";
  }

  // Whole numbers compare as numbers ("5" is "05", as the creator writes positions), other text
  // without regard to case.
  public static func SameText(a: String, b: String) -> Bool {
    if StrLen(a) == 0 || StrLen(b) == 0 {
      return false;
    }
    if Equals(StrLower(a), StrLower(b)) {
      return true;
    }
    return IsStringNumber(a) && IsStringNumber(b) && StrFindFirst(a, ".") < 0 && StrFindFirst(b, ".") < 0 && StringToInt(a) == StringToInt(b);
  }

  // The index of the value named or labelled `wanted`: an exact match of the internal name or the
  // on-screen text first, else the one value whose name or text contains it. -1: none; -2: several.
  public static func FindValue(option: ref<CharacterCustomizationOption>, wanted: String) -> Int32 {
    let count = XFCharacter.Count(option);
    let found = -1;
    let matches = 0;
    let i = 0;
    while i < count {
      if XFCharacter.SameText(XFCharacter.ValueLabel(option, i), wanted) || XFCharacter.SameText(XFCharacter.ValueText(option, i), wanted) {
        found = i;
        matches += 1;
      }
      i += 1;
    }
    if matches == 1 {
      return found;
    }
    if matches > 1 {
      return -2;
    }
    let lower = StrLower(wanted);
    i = 0;
    while i < count {
      if StrContains(StrLower(XFCharacter.ValueLabel(option, i)), lower) || StrContains(StrLower(XFCharacter.ValueText(option, i)), lower) {
        found = i;
        matches += 1;
      }
      i += 1;
    }
    if matches == 1 {
      return found;
    }
    if matches > 1 {
      return -2;
    }
    return -1;
  }

  // Up to eight values as "index name (text)", for refusals.
  public static func SomeValues(option: ref<CharacterCustomizationOption>) -> String {
    let count = XFCharacter.Count(option);
    let out = "";
    let i = 0;
    while i < count && i < 8 {
      if i > 0 {
        out += ", ";
      }
      out += IntToString(i) + " " + XFCharacter.ValueLabel(option, i);
      let text = XFCharacter.ValueText(option, i);
      if StrLen(text) > 0 {
        out += " (" + text + ")";
      }
      i += 1;
    }
    if count > 8 {
      out += ", ...";
    }
    return out;
  }

  // Read-only. Outside the appearance screen the option list is not trusted (the game rebuilds it
  // only when the menu opens), so only the finalized state's flags and tags are reported.
  public static func Appearance(cid: String, option: String) -> String {
    let game = GetGameInstance();
    if !GameInstance.IsValid(game) {
      return XFJson.Fail("game_not_ready", "no game instance yet");
    }
    // Step lines (debug) before the calls that crashed the first in-game run from a null script
    // context; flushed as written, so after a crash the last one names the call.
    XFBridgeLog.Debug(cid, "Appearance step: CharacterCustomizationSystem.GetState next");
    let system = GameInstance.GetCharacterCustomizationSystem(game);
    let state = system.GetState();
    let menuOpen = XFBridgeActions.CharacterMenuOpen();
    let out = "{\"ok\":true,\"character_menu_open\":" + XFJson.Flag(menuOpen);
    out += ",\"menu\":" + XFCharacter.MenuMode();
    if IsDefined(state) {
      out += ",\"state\":{\"body_male\":" + XFJson.Flag(state.IsBodyGenderMale()) + ",\"brain_male\":" + XFJson.Flag(state.IsBrainGenderMale());
      XFBridgeLog.Debug(cid, "Appearance step: TDBID.ToStringDEBUG next");
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
      XFBridgeLog.Debug(cid, "Appearance step: GetUnitedOptions next");
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

  // How the captured creator menu was opened: whether it edits V's finalized look (the mirror's mode;
  // false is the new-game mode, where Confirm moves on instead of keeping the look) and its edit tag
  // (0 NewGame, 1 HairDresser, 2 Ripperdoc). Answers the Character Customization Anywhere caveat in
  // knowledge/photo-mode.md §3.1 (open question 2).
  public static func MenuMode() -> String {
    let registry = XFBridgeRegistry.Get();
    let menu: wref<characterCreationBodyMorphMenu>;
    if IsDefined(registry) {
      menu = registry.GetCharacterMenu();
    }
    if !IsDefined(menu) {
      return "{\"seen\":false}";
    }
    let name = "NewGame";
    if Equals(menu.m_editMode, gameuiCharacterCustomizationEditTag.HairDresser) {
      name = "HairDresser";
    } else {
      if Equals(menu.m_editMode, gameuiCharacterCustomizationEditTag.Ripperdoc) {
        name = "Ripperdoc";
      }
    }
    return "{\"seen\":true,\"updating_finalized_state\":" + XFJson.Flag(menu.m_updatingFinalizedState) + ",\"edit_mode\":" + XFJson.Str(name) + ",\"busy\":" + XFJson.Flag(NotEquals(menu.m_busySwitchingAppearance, BusySwitchingReason.AVAILABLE)) + "}";
  }

  // Leaves the appearance screen through the menu's own functions (characterCreationBodyMorphMenu
  // .script:688-712; knowledge/photo-mode.md §3.3): keep = ConfirmCustomizedCharacter (ReFinalizeState,
  // then the menu moves on), otherwise ConfirmBackConfirmation (CancelFinalizedStateUpdate: every
  // change discarded). The plugin refuses both unless allow_creator_leave = true.
  public static func Leave(cid: String, keep: Bool) -> String {
    if !XFBridgeActions.CharacterMenuOpen() {
      return XFJson.Fail("not_in_character_menu", "the appearance screen (mirror or ripperdoc) is not open in its edit-V's-look mode");
    }
    let menu = XFBridgeRegistry.Get().GetCharacterMenu();
    if NotEquals(menu.m_busySwitchingAppearance, BusySwitchingReason.AVAILABLE) {
      return XFJson.Fail("busy", "the appearance screen is still applying the previous change");
    }
    if keep {
      XFBridgeActions.EnsureSaveLock(cid);
      menu.ConfirmCustomizedCharacter();
      XFBridgeLog.Info(cid, "cc.confirm: the look is kept (ReFinalizeState); undo: load the safety save");
    } else {
      menu.ConfirmBackConfirmation();
      XFBridgeLog.Info(cid, "cc.back: every change on the appearance screen discarded");
    }
    return "{\"ok\":true,\"kept\":" + XFJson.Flag(keep) + "}";
  }

  public static func ModeName(mode: Int32) -> String {
    if mode == 2 {
      return "Ripperdoc";
    }
    return "HairDresser";
  }

  // Why the appearance screen can't be opened now, as a failure answer, or "" when it can: V in
  // the world with no menu open (phase gameplay), not in combat, not in a vehicle, no scene playing,
  // the game allowing photo mode (the same "safe moment" check), and no combat, scene, tier or
  // moving-platform save lock from the game.
  public static func OpenRefusal() -> String {
    let game = GetGameInstance();
    let phase = XFBridgeActions.Phase();
    if NotEquals(phase, "gameplay") {
      return XFJson.Fail("not_in_gameplay", "the appearance screen opens only from normal play; the game is in '" + phase + "'");
    }
    let player = GetPlayer(game);
    if !IsDefined(player) {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    if player.IsInCombat() {
      return XFJson.Fail("not_safe_now", "V is in combat");
    }
    if VehicleComponent.IsMountedToVehicle(game, player) {
      return XFJson.Fail("not_safe_now", "V is in a vehicle");
    }
    let psm = player.GetPlayerStateMachineBlackboard();
    if IsDefined(psm) {
      let tier = psm.GetInt(GetAllBlackboardDefs().PlayerStateMachine.SceneTier);
      if tier > 1 {
        return XFJson.Fail("not_safe_now", "a scene is playing (scene tier " + IntToString(tier) + ")");
      }
    }
    if !GameInstance.GetPhotoModeSystem(game).CanPhotoModeBeEnabled() {
      return XFJson.Fail("not_safe_now", "the game doesn't allow photo mode here right now, which the bridge takes as not a safe moment");
    }
    let locks: array<gameSaveLock>;
    if GameInstance.IsSavingLocked(game, locks) {
      let i = 0;
      while i < ArraySize(locks) {
        let reason = locks[i].reason;
        if Equals(reason, gameSaveLockReason.Combat) || Equals(reason, gameSaveLockReason.Scene) || Equals(reason, gameSaveLockReason.Tier) || Equals(reason, gameSaveLockReason.PlayerOnMovingPlatform) {
          return XFJson.Fail("not_safe_now", "the game has locked saving for a combat, scene or moving-platform reason (" + IntToString(EnumInt(reason)) + ")");
        }
        i += 1;
      }
    }
    return "";
  }

  // cc.open, step 1: checks the moment and requests the bridge's save lock.
  public static func OpenPrepare(cid: String, mode: Int32) -> String {
    if XFBridgeActions.CharacterMenuOpen() {
      return "{\"ok\":true,\"already_open\":true}";
    }
    if mode != 1 && mode != 2 {
      return XFJson.Fail("bad_params", "unknown edit mode " + IntToString(mode));
    }
    let refusal = XFCharacter.OpenRefusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    if !IsDefined(XFBridgeRegistry.Get()) {
      return XFJson.Fail("game_not_ready", "no game session yet");
    }
    XFBridgeActions.EnsureSaveLock(cid);
    return "{\"ok\":true,\"save_lock_requested\":true}";
  }

  // cc.open, step 2 (a few ticks later): checks again, refuses unless saving is locked, then asks the
  // idle menu scenario to open the appearance screen through the menu-event blackboard (the way
  // GameObject.TriggerMenuEvent does: back to None first, so the same event can fire again).
  public static func Open(cid: String, mode: Int32) -> String {
    let game = GetGameInstance();
    if XFBridgeActions.CharacterMenuOpen() {
      return "{\"ok\":true,\"requested\":false,\"note\":\"the appearance screen is already open\"}";
    }
    let refusal = XFCharacter.OpenRefusal();
    if StrLen(refusal) > 0 {
      return refusal;
    }
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) || !registry.IsSaveLockHeld() {
      return XFJson.Fail("save_lock_not_held", "the bridge hasn't taken its save lock, so the appearance screen wasn't opened");
    }
    let locks: array<gameSaveLock>;
    if !GameInstance.IsSavingLocked(game, locks) {
      return XFJson.Fail("save_lock_not_held", "the game doesn't report saving as locked yet, so the appearance screen wasn't opened; try again in a moment");
    }
    let board = GameInstance.GetBlackboardSystem(game).Get(GetAllBlackboardDefs().MenuEventBlackboard);
    if !IsDefined(board) {
      return XFJson.Fail("unavailable", "the game's menu-event board isn't available");
    }
    registry.RequestCreatorOpen(mode, EngineTime.ToFloat(GameInstance.GetEngineTime(game)), cid);
    if IsNameValid(board.GetName(GetAllBlackboardDefs().MenuEventBlackboard.MenuEventToTrigger)) {
      board.SetName(GetAllBlackboardDefs().MenuEventBlackboard.MenuEventToTrigger, n"None");
    }
    board.SetName(GetAllBlackboardDefs().MenuEventBlackboard.MenuEventToTrigger, n"OnXFBridgeOpenCreator");
    XFBridgeLog.Info(cid, "cc.open requested (edit mode " + XFCharacter.ModeName(mode) + ", saving locked); the idle menu scenario opens the mirror's scenario");
    return "{\"ok\":true,\"requested\":true,\"edit_mode\":" + XFJson.Str(XFCharacter.ModeName(mode)) + ",\"saving_locked\":true,\"route\":\"menu_event\"}";
  }

  // cc.open gave up waiting: withdraw the request so a late menu event opens nothing.
  public static func CancelOpen(cid: String) -> String {
    let registry = XFBridgeRegistry.Get();
    let cancelled = IsDefined(registry) && registry.CancelCreatorOpen();
    XFBridgeLog.Info(cid, "cc.open request withdrawn=" + XFJson.Flag(cancelled));
    return "{\"ok\":true,\"withdrawn\":" + XFJson.Flag(cancelled) + "}";
  }

  // cc.page: the preview camera to a region (slot "" = the menu's starting view).
  public static func Page(cid: String, slot: String) -> String {
    if !XFBridgeActions.CharacterMenuOpen() {
      return XFJson.Fail("not_in_character_menu", "the appearance screen (mirror or ripperdoc) is not open");
    }
    let menu = XFBridgeRegistry.Get().GetCharacterMenu();
    if StrLen(slot) == 0 {
      menu.XFBridgeCameraTo(n"None");
    } else {
      menu.XFBridgeCameraTo(StringToName(slot));
    }
    XFBridgeLog.Info(cid, "cc.page camera slot '" + slot + "'; undo: cc.page default");
    return "{\"ok\":true,\"slot\":" + XFJson.Str(slot) + "}";
  }

  public static func HasOption(group: String, option: String, fpp: Bool) -> Bool {
    let state = GameInstance.GetCharacterCustomizationSystem(GetGameInstance()).GetState();
    return IsDefined(state) && state.HasOption(StringToName(group), StringToName(option), fpp);
  }

  // Sets one option on the open appearance screen, exactly as the menu's own controls do
  // (ApplyChangeToOption; characterCreationBodyMorphMenu.script:481, 814, 828). Never confirms:
  // the change stays a preview until the player confirms or backs out of the screen.
  public static func Apply(cid: String, option: String, index: Int32, value: String) -> String {
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
    let matchedBy = "index";
    if index < 0 {
      // By the value's name or on-screen label (the plugin passes index -1 with a value).
      index = XFCharacter.FindValue(match, value);
      matchedBy = "value";
      if index == -2 {
        return XFJson.Fail("bad_params", "more than one value of '" + option + "' matches '" + value + "'; use its index (" + XFCharacter.SomeValues(match) + ")");
      }
      if index < 0 {
        return XFJson.Fail("bad_params", "no value of '" + option + "' is named or labelled '" + value + "' (" + XFCharacter.SomeValues(match) + ")");
      }
    }
    if index < 0 || index >= count {
      return XFJson.Fail("bad_params", "option '" + option + "' has values 0 to " + IntToString(count - 1) + ", not " + IntToString(index));
    }
    XFBridgeActions.EnsureSaveLock(cid);
    let before = Cast<Int32>(match.currIndex);
    // Through the option's own row when it is on screen: the row shows the new value's name and
    // keeps its own index, then asks the menu to apply it (OnSliderChange / OnColorChange), exactly
    // as its arrows do. Otherwise straight through the system, as before (the row then keeps
    // showing the old name until the screen is reopened).
    let route = "row";
    if !XFCharacter.ApplyThroughRow(menu, match, index) {
      system.ApplyChangeToOption(match, Cast<Uint32>(index));
      route = "system";
    }
    XFBridgeLog.Info(cid, "cc.apply " + NameToString(match.info.name) + " " + IntToString(before) + " -> " + IntToString(index) + " via " + route + "; undo: cc.apply index " + IntToString(before) + ", or Back in the mirror (discards every change)");
    return "{\"ok\":true,\"option\":" + XFJson.Name(match.info.name) + ",\"label\":" + XFJson.Str(GetLocalizedText(match.info.localizedName)) + ",\"before\":" + IntToString(before) + ",\"after\":" + IntToString(index) + ",\"count\":" + IntToString(count) + ",\"value\":" + XFJson.Str(XFCharacter.ValueLabel(match, index)) + ",\"before_value\":" + XFJson.Str(XFCharacter.ValueLabel(match, before)) + ",\"value_label\":" + XFJson.Str(XFCharacter.ValueText(match, index)) + ",\"matched_by\":" + XFJson.Str(matchedBy) + ",\"route\":" + XFJson.Str(route) + ",\"row_updated\":" + XFJson.Flag(Equals(route, "row")) + "}";
  }

  // Selects index on the menu row that shows this option (matched by UI slot, as the menu's own
  // UpdateOption does; characterCreationBodyMorphMenu.script:436). The row's setter updates its
  // label and index and calls the menu back, which applies the change (OnSliderChange,
  // OnColorChange). False when no row shows the option.
  public static func ApplyThroughRow(menu: wref<characterCreationBodyMorphMenu>, option: ref<CharacterCustomizationOption>, index: Int32) -> Bool {
    let appearance = option.info as gameuiAppearanceInfo;
    let morph = option.info as gameuiMorphInfo;
    let switcher = option.info as gameuiSwitcherInfo;
    let count = inkCompoundRef.GetNumChildren(menu.m_optionsList);
    let i = 0;
    while i < count {
      let widget = inkCompoundRef.GetWidgetByIndex(menu.m_optionsList, i);
      if IsDefined(widget) {
        let row = widget.GetController() as characterCreationBodyMorphOption;
        if IsDefined(row) {
          let shown = row.GetSelectorOption();
          if IsDefined(shown) && Equals(shown.info.uiSlot, option.info.uiSlot) {
            if IsDefined(appearance) {
              row.SetSelectedAppearanceDefinition(appearance, index, true);
              return true;
            }
            if IsDefined(morph) {
              row.SetSelectedMorphName(morph, index, true);
              return true;
            }
            if IsDefined(switcher) {
              row.SetSelectedSwitcherOption(switcher, index, true);
              return true;
            }
            return false;
          }
        }
        let colorRow = widget.GetController() as characterCreationBodyMorphColorOption;
        if IsDefined(colorRow) {
          let shownColor = colorRow.GetColorPickerOption();
          if IsDefined(shownColor) && Equals(shownColor.info.uiSlot, option.info.uiSlot) && IsDefined(appearance) {
            colorRow.SetSelectedAppearanceDefinitionColor(appearance, index, true);
            return true;
          }
        }
      }
      i += 1;
    }
    return false;
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
  // (SetGameTimeBySeconds) when totalSeconds >= 0. In normal play, and with the appearance screen
  // open (edit mode): the game's own time-skip menu sets the clock while its full-screen menu is open
  // (timeSkipPopup.script:274), and the appearance screen only freezes the world with time dilation.
  // Not in photo mode (its own time slider) or any other menu.
  public static func SetTime(cid: String, hours: Int32, minutes: Int32, seconds: Int32, totalSeconds: Int32) -> String {
    let phase = XFBridgeActions.Phase();
    if NotEquals(phase, "gameplay") && NotEquals(phase, "character_menu") {
      return XFJson.Fail("not_in_gameplay", "the clock can be set in normal play or with the appearance screen open; the game is in '" + phase + "'");
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
    return "{\"ok\":true,\"phase\":" + XFJson.Str(phase) + ",\"before_total_seconds\":" + IntToString(before) + ",\"after_total_seconds\":" + IntToString(after) + "}";
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

// --- Settings (game.options.read) ---------------------------------------------------------------
//
// The player's graphics and display settings, read through the game's own user-settings API
// (UserSettings, ConfigGroup and the ConfigVar types; orphans.script and userSettingsData.script)
// from the groups the plugin names. Read-only: no setter is called.

public abstract class XFSettings {
  public static func Var(v: ref<ConfigVar>) -> String {
    let t = v.GetType();
    if Equals(t, ConfigVarType.Bool) {
      let b = v as ConfigVarBool;
      return "{\"type\":\"bool\",\"value\":" + XFJson.Flag(b.GetValue()) + "}";
    }
    if Equals(t, ConfigVarType.Int) {
      let i = v as ConfigVarInt;
      return "{\"type\":\"int\",\"value\":" + IntToString(i.GetValue()) + "}";
    }
    if Equals(t, ConfigVarType.Float) {
      let f = v as ConfigVarFloat;
      return "{\"type\":\"float\",\"value\":" + XFJson.Num(f.GetValue()) + "}";
    }
    if Equals(t, ConfigVarType.Name) {
      let n = v as ConfigVarName;
      return "{\"type\":\"name\",\"value\":" + XFJson.Name(n.GetValue()) + "}";
    }
    if Equals(t, ConfigVarType.IntList) {
      let il = v as ConfigVarListInt;
      return "{\"type\":\"int_list\",\"value\":" + IntToString(il.GetValue()) + ",\"index\":" + IntToString(il.GetIndex()) + "}";
    }
    if Equals(t, ConfigVarType.FloatList) {
      let fl = v as ConfigVarListFloat;
      return "{\"type\":\"float_list\",\"value\":" + XFJson.Num(fl.GetValue()) + ",\"index\":" + IntToString(fl.GetIndex()) + "}";
    }
    if Equals(t, ConfigVarType.StringList) {
      let sl = v as ConfigVarListString;
      return "{\"type\":\"string_list\",\"value\":" + XFJson.Str(sl.GetValue()) + ",\"index\":" + IntToString(sl.GetIndex()) + "}";
    }
    if Equals(t, ConfigVarType.NameList) {
      let nl = v as ConfigVarListName;
      return "{\"type\":\"name_list\",\"value\":" + XFJson.Name(nl.GetValue()) + ",\"index\":" + IntToString(nl.GetIndex()) + "}";
    }
    return "{\"type\":\"unknown\"}";
  }

  // groups: comma-separated group paths (the plugin allowlists them).
  public static func Read(cid: String, groups: String) -> String {
    let handler = new inkMenuScenario().GetSystemRequestsHandler();
    if !IsDefined(handler) {
      return XFJson.Fail("unavailable", "the game's settings aren't available yet");
    }
    let settings = handler.GetUserSettings();
    if !IsDefined(settings) {
      return XFJson.Fail("unavailable", "the game's settings aren't available yet");
    }
    let names = StrSplit(groups, ",");
    let out = "{\"ok\":true,\"groups\":{";
    let g = 0;
    while g < ArraySize(names) {
      if g > 0 {
        out += ",";
      }
      out += XFJson.Str(names[g]) + ":";
      let group = settings.GetGroup(StringToName(names[g]));
      if !IsDefined(group) {
        out += "null";
      } else {
        let vars = group.GetVars(false);
        out += "{";
        let i = 0;
        let n = 0;
        while i < ArraySize(vars) {
          if IsDefined(vars[i]) {
            if n > 0 {
              out += ",";
            }
            out += XFJson.Name(vars[i].GetName()) + ":" + XFSettings.Var(vars[i]);
            n += 1;
          }
          i += 1;
        }
        out += "}";
      }
      g += 1;
    }
    XFBridgeLog.Debug(cid, "settings read: " + groups);
    return out + "}}";
  }
}
