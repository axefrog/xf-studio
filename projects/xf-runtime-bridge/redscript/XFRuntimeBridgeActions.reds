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
  // cc.open's request, picked up by the pause menu's scenario (the MenuScenario_PauseMenu wrap below).
  private let m_ccOpenRequested: Bool;
  private let m_ccOpenMode: Int32;
  private let m_ccOpenAt: Float;
  private let m_ccOpenCid: String;
  // player.appearance's last full reading in the creator (0.4.2) and its engine time.
  private let m_lastCreatorReading: String;
  private let m_lastCreatorReadingAt: Float;
  // What became of the last request the menu took ("switched", "refused" or "expired") and whose it was,
  // so a cc.open that timed out can tell "nothing will open" from "the screen may still open" (RB-42).
  private let m_ccOpenOutcome: String;
  private let m_ccOpenOutcomeCid: String;
  // The appearance screen's changes (session 3's busy flag): how many change events the screen had since it
  // opened (a row, the system route, a colour, a preset, randomize; RB-51), when the last row change started
  // (engine time; 0 when none is pending), when the bridge first saw the busy flag set without a pending
  // change it knows of, whether a change still in flight was logged, and every option's value when the
  // screen set its options up (cc.confirm closes with Back only when nothing differs from it).
  private let m_ccChanges: Int32;
  private let m_ccPendingSince: Float;
  private let m_ccBusySeenAt: Float;
  private let m_ccInFlightLogged: Bool;
  private let m_ccSnapshot: String;
  // inventory.equip: items the bridge itself added to V's inventory this session (only these may be removed again).
  private let m_addedItems: array<ItemID>;
  // game.save: the last manual save's state ("none", "pending", "saved", "failed"), and whether the
  // bridge's save lock goes back on once it finishes (a save with override_lock).
  private let m_saveState: String;
  private let m_relockAfterSave: Bool;
  // game.load by name: the save list the game answered with (OnSavesForLoadReady).
  private let m_saves: array<String>;
  private let m_savesReady: Bool;

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
  // made here makes the pause menu's scenario open the appearance screen instead; any other pause
  // (the player's own Esc) opens the pause menu as usual.
  public func RequestCreatorOpen(mode: Int32, now: Float, cid: String) -> Void {
    this.m_ccOpenRequested = true;
    this.m_ccOpenMode = mode;
    this.m_ccOpenAt = now;
    this.m_ccOpenCid = cid;
  }

  // player.appearance outside the creator (0.4.2): the last full option list read in the creator, and when
  // (engine time; ages are differences of it). Session-only: gone when the game restarts.
  public func SetLastCreatorReading(options: String, at: Float) -> Void {
    this.m_lastCreatorReading = options;
    this.m_lastCreatorReadingAt = at;
  }

  public func HasLastCreatorReading() -> Bool {
    return StrLen(this.m_lastCreatorReading) > 0;
  }

  public func LastCreatorReading() -> String {
    return this.m_lastCreatorReading;
  }

  public func LastCreatorReadingAt() -> Float {
    return this.m_lastCreatorReadingAt;
  }

  // Whether a cc.open request waits for the pause menu (taken or expired by TakeCreatorOpen).
  public func CreatorOpenPending() -> Bool {
    return this.m_ccOpenRequested;
  }

  // The requested edit mode, once, or -1 when there is no fresh request.
  public func TakeCreatorOpen(now: Float) -> Int32 {
    if !this.m_ccOpenRequested {
      return -1;
    }
    this.m_ccOpenRequested = false;
    this.m_ccOpenOutcomeCid = this.m_ccOpenCid;
    if now - this.m_ccOpenAt > 3.0 || now < this.m_ccOpenAt {
      this.m_ccOpenOutcome = "expired";
      XFBridgeLog.Warn(this.m_ccOpenCid, "cc.open request expired before the menu picked it up; nothing opened");
      return -1;
    }
    this.m_ccOpenOutcome = "taken";
    return this.m_ccOpenMode;
  }

  // The menu's answer to the request it took: "switched" (the screen is opening) or "refused".
  public func NoteCreatorOpenOutcome(outcome: String) -> Void {
    this.m_ccOpenOutcome = outcome;
  }

  // The outcome of cid's request once the menu took it, or "" if it never did.
  public func CreatorOpenOutcome(cid: String) -> String {
    if Equals(this.m_ccOpenOutcomeCid, cid) {
      return this.m_ccOpenOutcome;
    }
    return "";
  }

  public func CreatorOpenCid() -> String {
    return this.m_ccOpenCid;
  }

  public func CancelCreatorOpen() -> Bool {
    let was = this.m_ccOpenRequested;
    this.m_ccOpenRequested = false;
    return was;
  }

  // The appearance screen's changes ------------------------------------------------------------

  public func NoteCreatorOpened() -> Void {
    this.m_ccChanges = 0;
    this.m_ccPendingSince = 0.0;
    this.m_ccBusySeenAt = 0.0;
    this.m_ccInFlightLogged = false;
    this.m_ccSnapshot = "";
  }

  // The options as the screen set them up (OnInitializeOptionsList); "" until then.
  public func NoteCreatorSnapshot(snapshot: String) -> Void {
    this.m_ccSnapshot = snapshot;
  }

  // True only when the screen's options were recorded when it set them up and every one still has that value.
  public func CreatorUnchangedSince(now: String) -> Bool {
    return StrLen(this.m_ccSnapshot) > 0 && Equals(this.m_ccSnapshot, now);
  }

  // A row change that sets the busy flag: counted, and pending until its completion event.
  public func NoteCreatorChange(now: Float) -> Void {
    this.m_ccChanges += 1;
    this.m_ccPendingSince = MaxF(now, 0.001);
    this.m_ccBusySeenAt = 0.0;
    this.m_ccInFlightLogged = false;
  }

  // Any other change event (the system route, a colour, a preset, randomize, the system's option updates):
  // counted only.
  public func NoteCreatorChangeEvent() -> Void {
    this.m_ccChanges += 1;
  }

  public func NoteCreatorChangeDone() -> Void {
    this.m_ccPendingSince = 0.0;
    this.m_ccBusySeenAt = 0.0;
    this.m_ccInFlightLogged = false;
  }

  // Every completion event restarts the busy flag's stale clock (RB-54), even when the flag stays set.
  public func NoteCreatorCompletion() -> Void {
    this.m_ccBusySeenAt = 0.0;
  }

  // Once per pending change: true the first time (the "still in flight" line is logged once).
  public func TakeCreatorInFlightLog() -> Bool {
    let first = !this.m_ccInFlightLogged;
    this.m_ccInFlightLogged = true;
    return first;
  }

  public func CreatorChanges() -> Int32 {
    return this.m_ccChanges;
  }

  public func CreatorPendingSince() -> Float {
    return this.m_ccPendingSince;
  }

  // Engine time the busy flag was first seen with no pending change (set on the first call).
  public func CreatorBusySeenAt(now: Float) -> Float {
    if this.m_ccBusySeenAt <= 0.0 {
      this.m_ccBusySeenAt = MaxF(now, 0.001);
    }
    return this.m_ccBusySeenAt;
  }

  // Inventory ----------------------------------------------------------------------------------

  public func NoteAddedItem(id: ItemID) -> Void {
    if !ArrayContains(this.m_addedItems, id) {
      ArrayPush(this.m_addedItems, id);
    }
  }

  public func WasAddedByBridge(id: ItemID) -> Bool {
    return ArrayContains(this.m_addedItems, id);
  }

  // The copy of this record the bridge added this session (the last one), or an invalid ItemID.
  public func AddedItemFor(tdbid: TweakDBID) -> ItemID {
    let none: ItemID;
    let i = ArraySize(this.m_addedItems) - 1;
    while i >= 0 {
      if ItemID.GetTDBID(this.m_addedItems[i]) == tdbid {
        return this.m_addedItems[i];
      }
      i -= 1;
    }
    return none;
  }

  public func ForgetAddedItem(id: ItemID) -> Void {
    ArrayRemove(this.m_addedItems, id);
  }

  // Saves --------------------------------------------------------------------------------------

  public func SetSaveState(state: String) -> Void {
    this.m_saveState = state;
  }

  public func SaveState() -> String {
    if StrLen(this.m_saveState) == 0 {
      return "none";
    }
    return this.m_saveState;
  }

  public func SetRelockAfterSave(relock: Bool) -> Void {
    this.m_relockAfterSave = relock;
  }

  public func RelockAfterSave() -> Bool {
    return this.m_relockAfterSave;
  }

  // The game answers ManualSave through this callback (registered by XFGame.Save; the same callback
  // the pause menu's quick save uses, pauseMenu.script:65, 185).
  protected cb func OnXFBridgeSavingComplete(success: Bool, locks: array<gameSaveLock>) -> Bool {
    let handler = new inkMenuScenario().GetSystemRequestsHandler();
    if IsDefined(handler) {
      handler.UnregisterFromCallback(n"OnSavingComplete", this, n"OnXFBridgeSavingComplete");
    }
    if success {
      this.m_saveState = "saved";
    } else {
      this.m_saveState = "failed";
    }
    XFBridgeLog.Info("game-save", "manual save finished: success=" + XFJson.Flag(success) + " locks=" + IntToString(ArraySize(locks)));
    if this.m_relockAfterSave {
      this.m_relockAfterSave = false;
      SaveLocksManager.RequestSaveLockAdd(GetGameInstance(), n"XFRuntimeBridge");
      this.m_saveLockHeld = true;
      XFBridgeLog.Info("game-save", "save lock taken again after the save (reason XFRuntimeBridge)");
    }
    return true;
  }

  // The game answers RequestSavesForLoad through this callback (loadGameMenu.script:109, 381).
  protected cb func OnXFBridgeSavesReady(saves: array<String>) -> Bool {
    let handler = new inkMenuScenario().GetSystemRequestsHandler();
    if IsDefined(handler) {
      handler.UnregisterFromCallback(n"OnSavesForLoadReady", this, n"OnXFBridgeSavesReady");
    }
    this.m_saves = saves;
    this.m_savesReady = true;
    return true;
  }

  public func ClearSaves() -> Void {
    ArrayClear(this.m_saves);
    this.m_savesReady = false;
  }

  public func SavesReady() -> Bool {
    return this.m_savesReady;
  }

  public func Saves() -> array<String> {
    return this.m_saves;
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

// A photo-mode light's entity (index 0-2): the light indicator keeps one screen projection per light,
// and each projection names the entity it follows (photoModeLightIndicatorController.script:18-66;
// inkScreenProjection.GetEntity). The lights are gamePhotomodeLightObject entities, game objects
// (RED4ext.SDK game/PhotomodeLightObject.hpp). Null when the indicator or the projection isn't there.
@addMethod(gameuiPhotoModeMenuController)
public func XFBridgeLightEntity(index: Int32) -> ref<Entity> {
  if !inkWidgetRef.IsValid(this.m_lightIndicator) {
    return null;
  }
  let indicator = inkWidgetRef.GetController(this.m_lightIndicator) as PhotomodeLightIndicatorController;
  if !IsDefined(indicator) {
    return null;
  }
  let projection = indicator.GetProjection(index);
  if !IsDefined(projection) {
    return null;
  }
  return projection.GetEntity();
}

// The light the menu's light indicator follows (0-2), or -1 when it shows none (the light tab isn't
// active or the light is off; PhotomodeSetActiveLightEvent.GetIndex).
@addMethod(gameuiPhotoModeMenuController)
public func XFBridgeLightIndicatorIndex() -> Int32 {
  if !inkWidgetRef.IsValid(this.m_lightIndicator) {
    return -1;
  }
  let indicator = inkWidgetRef.GetController(this.m_lightIndicator) as PhotomodeLightIndicatorController;
  if !IsDefined(indicator) {
    return -1;
  }
  return indicator.m_activeIndex;
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
    registry.NoteCreatorOpened();
  }
  return result;
}

// A row's change (its arrows, or cc.apply through the row) sets the menu's busy flag to SWAPPING, which
// only the system's OnAppearanceAppliedEvent clears (characterCreationBodyMorphMenu.script:309-313,
// 473-483). Selecting the value a row already shows applies nothing, so that event never comes and the
// flag stays set for good: Confirm, presets and every later cc.apply are refused. Session 3 hit this
// with a skin-type re-apply (0 -> 0; plugin log 04:14:44). So a change to the same value puts the flag
// back, and a real change is noted (with its start time) for cc.confirm and the stale-busy check.
@wrapMethod(characterCreationBodyMorphMenu)
protected cb func OnSliderChange(widget: wref<inkWidget>) -> Bool {
  let row = widget.GetController() as characterCreationBodyMorphOption;
  let same = false;
  if IsDefined(row) {
    let option = row.GetSelectorOption();
    same = IsDefined(option) && option.currIndex == row.GetSelectorIndex();
  }
  let wasAvailable = Equals(this.m_busySwitchingAppearance, BusySwitchingReason.AVAILABLE);
  let result = wrappedMethod(widget);
  if same && wasAvailable {
    this.m_busySwitchingAppearance = BusySwitchingReason.AVAILABLE;
  } else {
    if !same {
      let registry = XFBridgeRegistry.Get();
      if IsDefined(registry) {
        registry.NoteCreatorChange(EngineTime.ToFloat(GameInstance.GetEngineTime(GetGameInstance())));
      }
    }
  }
  return result;
}

// A colour row's change (no busy flag; characterCreationBodyMorphMenu.script:821-830) counts as a change.
@wrapMethod(characterCreationBodyMorphMenu)
protected cb func OnColorChange(widget: wref<inkWidget>) -> Bool {
  let row = widget.GetController() as characterCreationBodyMorphColorOption;
  let same = false;
  if IsDefined(row) {
    let option = row.GetColorPickerOption();
    same = IsDefined(option) && option.currIndex == row.GetColorIndex();
  }
  let result = wrappedMethod(widget);
  if !same {
    let registry = XFBridgeRegistry.Get();
    if IsDefined(registry) {
      registry.NoteCreatorChange(EngineTime.ToFloat(GameInstance.GetEngineTime(GetGameInstance())));
      registry.NoteCreatorChangeDone();
    }
  }
  return result;
}

// The game's own completion signal for a row's change: the busy flag clears here.
@wrapMethod(characterCreationBodyMorphMenu)
protected cb func OnAppearanceAppliedEvent(evt: ref<gameuiCharacterCustomizationSystem_OnAppearanceAppliedEvent>) -> Bool {
  let result = wrappedMethod(evt);
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    registry.NoteCreatorCompletion();
    if Equals(this.m_busySwitchingAppearance, BusySwitchingReason.AVAILABLE) {
      registry.NoteCreatorChangeDone();
    }
  }
  return result;
}

// The screen's options once it has set them up (from V's finalized state in the mirror's edit mode;
// characterCreationBodyMorphMenu.script:281-301): the snapshot cc.confirm compares against (RB-51).
@wrapMethod(characterCreationBodyMorphMenu)
protected cb func OnInitializeOptionsList(evt: ref<gameuiCharacterCustomizationSystem_OnInitializeOptionsListEvent>) -> Bool {
  let result = wrappedMethod(evt);
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    registry.NoteCreatorSnapshot(XFCharacter.Snapshot());
  }
  return result;
}

// Every other way the screen's options change counts as a change for cc.confirm (RB-51): the system's own
// option updates (a row, cc.apply's system route, the colour picker), a preset and randomize
// (characterCreationBodyMorphMenu.script:303-313, 382-425).
@wrapMethod(characterCreationBodyMorphMenu)
protected cb func OnOptionUpdated(evt: ref<gameuiCharacterCustomizationSystem_OnOptionUpdatedEvent>) -> Bool {
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    registry.NoteCreatorChangeEvent();
  }
  return wrappedMethod(evt);
}

@wrapMethod(characterCreationBodyMorphMenu)
protected cb func OnAppearanceSwitched(evt: ref<gameuiCharacterCustomizationSystem_OnAppearanceSwitchedEvent>) -> Bool {
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    registry.NoteCreatorChangeEvent();
  }
  return wrappedMethod(evt);
}

@wrapMethod(characterCreationBodyMorphMenu)
protected cb func OnPresetAppliedEvent(evt: ref<gameuiCharacterCustomizationSystem_OnPresetAppliedEvent>) -> Bool {
  let result = wrappedMethod(evt);
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    registry.NoteCreatorChangeEvent();
    registry.NoteCreatorChangeDone();
  }
  return result;
}

@wrapMethod(characterCreationBodyMorphMenu)
protected cb func OnRandomizeComplete(evt: ref<gameuiCharacterCustomizationSystem_OnRandomizeCompleteEvent>) -> Bool {
  let result = wrappedMethod(evt);
  let registry = XFBridgeRegistry.Get();
  if IsDefined(registry) {
    registry.NoteCreatorChangeEvent();
    registry.NoteCreatorChangeDone();
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

// cc.open (0.4.2): Character Customization Anywhere's route. Session 4 (28 September 2026) found that
// switching to the mirror's scenario straight from the idle scenario (0.3-0.4.1), away from a mirror,
// left the creator's backdrop half open over gameplay with its busy flag stuck, and only loading a save
// recovered it; CCA's hotkey opens the creator anywhere. CCA (Nexus 3930, keanuWheeze;
// knowledge/photo-mode.md section 3.1) opens the pause menu (the in-game menu controller's
// SpawnMenuInstanceEvent(n"OnOpenPauseMenu"), what the pause key does, inGameMenuGameController.script:210)
// and, while its flag is set, makes the pause menu's scenario switch to MenuScenario_CharacterCustomizationMirror
// instead of opening the pause menu. The bridge does the same: XFCharacter.Open raises OnOpenPauseMenu
// through the menu-event blackboard (the controller's OnTriggerMenuEvent makes the same
// SpawnMenuInstanceEvent call, inGameMenuGameController.script:294), and the wrap below redirects the pause
// menu's scenario only for a fresh bridge request (three seconds), passing the creator's data with the
// edit tag, so the vanilla mirror scenario marks it an edit of V's look (inGameScenarios.script:217-247).
// Without a request, or when the moment passed, the pause menu opens as usual. Our own code.
@wrapMethod(MenuScenario_PauseMenu)
protected cb func OnEnterScenario(prevScenario: CName, userData: ref<IScriptable>) -> Bool {
  let registry = XFBridgeRegistry.Get();
  if !IsDefined(registry) || !registry.CreatorOpenPending() {
    return wrappedMethod(prevScenario, userData);
  }
  let game = GetGameInstance();
  let mode = registry.TakeCreatorOpen(EngineTime.ToFloat(GameInstance.GetEngineTime(game)));
  if mode < 0 {
    return wrappedMethod(prevScenario, userData);
  }
  let cid = registry.CreatorOpenCid();
  // The pause menu is opening, so the game is no longer in normal play: check what can change in a moment
  // (combat, a scene, a vehicle, the player) but not the phase or photo mode's permission.
  let refusal = XFCharacter.OpenRefusalAt(true);
  if StrLen(refusal) > 0 {
    registry.NoteCreatorOpenOutcome("refused");
    XFBridgeLog.Warn(cid, "cc.open: the moment passed before the pause menu opened; the pause menu opens as usual instead: " + refusal);
    return wrappedMethod(prevScenario, userData);
  }
  registry.NoteCreatorOpenOutcome("switched");
  let data = new MorphMenuUserData();
  if mode == 2 {
    data.m_editMode = gameuiCharacterCustomizationEditTag.Ripperdoc;
  } else {
    data.m_editMode = gameuiCharacterCustomizationEditTag.HairDresser;
  }
  this.SwitchToScenario(n"MenuScenario_CharacterCustomizationMirror", data);
  XFBridgeLog.Info(cid, "cc.open: the pause menu's scenario switched to MenuScenario_CharacterCustomizationMirror (edit mode " + XFCharacter.ModeName(mode) + ", Character Customization Anywhere's route); undo: cc.back");
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

// Whether the game's save-lock manager holds a lock for this reason (its list is private; an added
// method reads it without changing anything; saveLocksManager.script:3).
@addMethod(SaveLocksManager)
public func XFBridgeHolds(reason: CName) -> Bool {
  return ArrayContains(this.m_saveLocks, reason);
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
        out += ",\"save_state\":" + XFJson.Str(registry.SaveState());
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

  // The plugin's own writes that don't go through a script function (pose.live.apply) take the lock here.
  public static func SaveLock(cid: String) -> String {
    XFBridgeActions.EnsureSaveLock(cid);
    return "{\"ok\":true,\"save_lock_held\":true}";
  }

  // Whether the game's SaveLocksManager holds the bridge's own lock (reason XFRuntimeBridge). The request
  // is queued, so this turns true a few ticks after EnsureSaveLock; any other lock doesn't count (RB-45).
  public static func OwnSaveLockHeld() -> Bool {
    let game = GetGameInstance();
    if !GameInstance.IsValid(game) {
      return false;
    }
    let container = GameInstance.GetScriptableSystemsContainer(game);
    if !IsDefined(container) {
      return false;
    }
    let manager = container.Get(n"SaveLocksManager") as SaveLocksManager;
    return IsDefined(manager) && manager.XFBridgeHolds(n"XFRuntimeBridge");
  }

  // Called by the plugin once after the kill switch: undoes what the bridge left switched on
  // (a world freeze, a hidden photo-mode menu). The save lock is deliberately kept, and taken back when a
  // save with override_lock had released it.
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
    // A game.save with override_lock that the kill switch cut off: its lock goes back on now, not only
    // when (if) the save finishes (RB-52).
    if registry.RelockAfterSave() {
      registry.SetRelockAfterSave(false);
      XFBridgeActions.EnsureSaveLock(cid);
      out += ",\"save_lock_retaken\":true";
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
          out += "{\"data\":" + IntToString(item.optionData[i]) + ",\"text\":" + XFJson.Str(item.optionTexts[i]);
          if item.key == 28u {
            out += XFPhoto.FaceTableIndex(item.optionTexts[i], item.optionData[i]);
          }
          out += "}";
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

  // photo.state (0.4.2): an expression option's face table index next to the menu's value. The menu's
  // option data is the option's position in the list, while the face animation is chosen by the record's
  // faceId (session 4, R2: menu 56 "Static: Sleeping" was table index 60 with the Mega Pack installed).
  // The records are photo_mode.character.faceAnimations (PhotoModeFace records: displayName, faceId;
  // knowledge/facial-expressions.md). Matched by the option's text against each record's display name when
  // exactly one matches ("label"), else by position in that list ("position", a hypothesis); "" if neither.
  public static func FaceTableIndex(text: String, data: Int32) -> String {
    let records = TweakDBInterface.GetForeignKeyArray(t"photo_mode.character.faceAnimations");
    let found = -1;
    let matches = 0;
    let i = 0;
    while i < ArraySize(records) {
      let record = TweakDBInterface.GetPhotoModeFaceRecord(records[i]);
      if IsDefined(record) && Equals(XFPose.Label(record.DisplayName()), text) {
        found = record.FaceId();
        matches += 1;
      }
      i += 1;
    }
    if matches == 1 {
      return ",\"table_index\":" + IntToString(found) + ",\"table_index_by\":\"label\"";
    }
    if data >= 0 && data < ArraySize(records) {
      let byPosition = TweakDBInterface.GetPhotoModeFaceRecord(records[data]);
      if IsDefined(byPosition) {
        return ",\"table_index\":" + IntToString(byPosition.FaceId()) + ",\"table_index_by\":\"position\"";
      }
    }
    return "";
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

  // --- Photo-mode light placement (photo.light.set place) -------------------------------------
  //
  // Photo mode places a light where the camera is when the light is switched on, and no menu value moves
  // it (session 3; knowledge/photo-mode-lights.md). The placement route here moves the light's own
  // entity with the teleportation facility, as CharLi moves its spawned lights about V; whether photo
  // mode keeps a moved light there is what LightPosition reads back a few frames later.

  // Light 1-3's entity, only when it is certainly that photo-mode light (RB-57): the indicator's projection
  // for that index names a gamePhotomodeLightObject (by class name: the type has no script declaration),
  // no other light's projection names the same entity, and the indicator, when it shows a light, shows
  // this one (LightSet selects the light first). Otherwise null, with the reason in why.
  public static func LightEntity(light: Int32, out why: String) -> ref<GameObject> {
    let controller = XFPhoto.Controller();
    if !IsDefined(controller) || light < 1 || light > 3 {
      why = "photo mode's menu isn't available";
      return null;
    }
    let entity = controller.XFBridgeLightEntity(light - 1);
    if !IsDefined(entity) {
      why = "photo mode's light " + IntToString(light) + " entity wasn't found (the light indicator has no projection for it)";
      return null;
    }
    if !entity.IsA(n"gamePhotomodeLightObject") {
      why = "the light indicator's projection " + IntToString(light) + " follows a " + NameToString(entity.GetClassName()) + ", not a photo-mode light, so nothing was moved";
      return null;
    }
    let other = 0;
    while other < 3 {
      if other != light - 1 && controller.XFBridgeLightEntity(other) == entity {
        why = "the light indicator names the same entity for lights " + IntToString(light) + " and " + IntToString(other + 1) + ", so which light it is isn't certain";
        return null;
      }
      other += 1;
    }
    let shown = controller.XFBridgeLightIndicatorIndex();
    if shown >= 0 && shown != light - 1 {
      why = "the menu's light indicator shows light " + IntToString(shown + 1) + ", not light " + IntToString(light);
      return null;
    }
    why = "";
    return entity as GameObject;
  }

  // Where V's head is (the stand-in's Head slot) and which way V faces, for placing lights about V.
  public static func HeadAndFacing(out head: Vector4, out facing: Vector4) -> Bool {
    let registry = XFBridgeRegistry.Get();
    let controller = XFPhoto.Controller();
    let puppet: wref<GameObject>;
    if IsDefined(registry) {
      puppet = registry.GetPhotoPuppet();
    }
    if !IsDefined(puppet) && IsDefined(controller) {
      puppet = controller.XFBridgeFakePlayer();
    }
    if !IsDefined(puppet) {
      return false;
    }
    let slotTransform: WorldTransform;
    let scripted = puppet as ScriptedPuppet;
    let found = false;
    if IsDefined(scripted) {
      let slots = scripted.GetSlotComponent();
      if IsDefined(slots) && slots.GetSlotTransform(n"Head", slotTransform) {
        head = WorldPosition.ToVector4(WorldTransform.GetWorldPosition(slotTransform));
        found = true;
      }
    }
    if !found {
      head = puppet.GetWorldPosition();
      head.Z += 1.62;
    }
    facing = puppet.GetWorldForward();
    return true;
  }

  public static func LightPosition(cid: String, light: Int32) -> String {
    if !XFPhoto.Active() {
      return XFJson.Fail("not_in_photo_mode", "photo mode is not open");
    }
    let why: String;
    let entity = XFPhoto.LightEntity(light, why);
    if !IsDefined(entity) {
      return XFJson.Fail("unavailable", why);
    }
    return "{\"ok\":true,\"light\":" + IntToString(light) + ",\"position\":" + XFPhoto.Vec(entity.GetWorldPosition()) + ",\"forward\":" + XFPhoto.Vec(entity.GetWorldForward()) + "}";
  }

  // mode 1: about V's head: azimuth (degrees from V's facing, counter-clockwise seen from above, so 90 is
  // V's left), elevation (degrees above level) and distance (metres); mode 2: the world position (a, b, c).
  // The light is turned to point at V's head in both.
  public static func PlaceLight(cid: String, light: Int32, mode: Int32, a: Float, b: Float, c: Float) -> String {
    if !XFPhoto.Active() {
      return XFJson.Fail("not_in_photo_mode", "photo mode is not open");
    }
    let why: String;
    let entity = XFPhoto.LightEntity(light, why);
    if !IsDefined(entity) {
      return XFJson.Fail("unavailable", why);
    }
    let head: Vector4;
    let facing: Vector4;
    if !XFPhoto.HeadAndFacing(head, facing) {
      return XFJson.Fail("unavailable", "V's photo-mode stand-in hasn't been seen yet; close and reopen photo mode");
    }
    let target: Vector4;
    if mode == 2 {
      target = new Vector4(a, b, c, 1.0);
    } else {
      let az = Deg2Rad(a);
      let el = Deg2Rad(b);
      let fx = facing.X * CosF(az) - facing.Y * SinF(az);
      let fy = facing.X * SinF(az) + facing.Y * CosF(az);
      let n = SqrtF(fx * fx + fy * fy);
      if n < 0.0001 {
        return XFJson.Fail("unavailable", "V's facing couldn't be read");
      }
      target = new Vector4(head.X + c * CosF(el) * fx / n, head.Y + c * CosF(el) * fy / n, head.Z + c * SinF(el), 1.0);
    }
    let aim = new Vector4(head.X - target.X, head.Y - target.Y, head.Z - target.Z, 0.0);
    let aimLength = SqrtF(aim.X * aim.X + aim.Y * aim.Y + aim.Z * aim.Z);
    if aimLength < 0.05 {
      return XFJson.Fail("bad_params", "the light would sit inside V's head; give a distance of at least 0.05 m");
    }
    let angles = Quaternion.ToEulerAngles(Quaternion.BuildFromDirectionVector(new Vector4(aim.X / aimLength, aim.Y / aimLength, aim.Z / aimLength, 0.0), new Vector4(0.0, 0.0, 1.0, 0.0)));
    let before = entity.GetWorldPosition();
    XFBridgeActions.EnsureSaveLock(cid);
    GameInstance.GetTeleportationFacility(GetGameInstance()).Teleport(entity, target, angles);
    XFBridgeLog.Info(cid, "photo light " + IntToString(light) + " moved from " + XFPhoto.Vec(before) + " to " + XFPhoto.Vec(target) + " aimed at V's head; undo: place it back at the earlier position");
    return "{\"ok\":true,\"light\":" + IntToString(light) + ",\"before\":" + XFPhoto.Vec(before) + ",\"after\":" + XFPhoto.Vec(target) + ",\"head\":" + XFPhoto.Vec(head) + ",\"distance\":" + XFJson.Num(aimLength) + "}";
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

  // The one active option in a UI slot (a slot holds one active option at a time), or null.
  public static func ActiveInSlot(options: array<ref<CharacterCustomizationOption>>, slot: CName) -> ref<CharacterCustomizationOption> {
    let found: ref<CharacterCustomizationOption>;
    let matches = 0;
    let i = 0;
    while i < ArraySize(options) {
      if IsDefined(options[i]) && IsDefined(options[i].info) && options[i].isActive && Equals(options[i].info.uiSlot, slot) {
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

  // The index of the value named or labelled exactly `wanted` (a whole number matches as a number: "5"
  // is "05"). -1: none; -2: several.
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
    return -1;
  }

  // The one value whose name or on-screen text contains `wanted`, for words only: a number never matches
  // part of a name, since "12" inside "h012" is a different position (RB-44). -1: none (or a number);
  // -2: several. Apply reports such a match as matched_by "partial".
  public static func FindPartialValue(option: ref<CharacterCustomizationOption>, wanted: String) -> Int32 {
    if IsStringNumber(wanted) {
      return -1;
    }
    let count = XFCharacter.Count(option);
    let found = -1;
    let matches = 0;
    let lower = StrLower(wanted);
    let i = 0;
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
    let registry = XFBridgeRegistry.Get();
    let now = EngineTime.ToFloat(GameInstance.GetEngineTime(game));
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
        let list = "[";
        let i = 0;
        let n = 0;
        while i < ArraySize(options) {
          if IsDefined(options[i]) && IsDefined(options[i].info) {
            if n > 0 {
              list += ",";
            }
            list += XFCharacter.Describe(options[i], false);
            n += 1;
          }
          i += 1;
        }
        list += "]";
        out += ",\"options\":" + list;
        // Kept for readings outside the creator (0.4.2), where the game's option list isn't trustworthy.
        if IsDefined(registry) {
          registry.SetLastCreatorReading(list, now);
        }
      }
    } else {
      // Outside the creator the game rebuilds its option list only when the screen opens, so only the
      // finalized look's flags above are live. The last full reading made in the creator this game session is
      // returned as it was then, with its age; a Back after it discarded any change it shows.
      if IsDefined(registry) && registry.HasLastCreatorReading() {
        out += ",\"last_creator_reading\":{\"age_seconds\":" + XFJson.Num(now - registry.LastCreatorReadingAt()) + ",\"note\":\"read while the appearance screen was open; not live: the screen's Back discards changes made after it, Confirm keeps them\",\"options\":" + registry.LastCreatorReading() + "}";
      } else {
        out += ",\"last_creator_reading\":null";
      }
      out += ",\"note\":\"outside the appearance screen only the finalized look's flags are live; open it (cc.open) for every option\"";
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
    let changes = 0;
    let pending = false;
    if IsDefined(registry) {
      changes = registry.CreatorChanges();
      pending = registry.CreatorPendingSince() > 0.0;
    }
    return "{\"seen\":true,\"updating_finalized_state\":" + XFJson.Flag(menu.m_updatingFinalizedState) + ",\"edit_mode\":" + XFJson.Str(name) + ",\"busy\":" + XFJson.Flag(NotEquals(menu.m_busySwitchingAppearance, BusySwitchingReason.AVAILABLE)) + ",\"change_pending\":" + XFJson.Flag(pending) + ",\"changes\":" + IntToString(changes) + "}";
  }

  // What cc.confirm needs to choose how to leave (the plugin chooses, core/Writes.cpp ChooseLeave): the
  // change events since the screen opened and whether every option still equals the snapshot taken when
  // the screen set its options up (false when there is no snapshot).
  public static func LeaveState(cid: String) -> String {
    if !XFBridgeActions.CharacterMenuOpen() {
      return XFJson.Fail("not_in_character_menu", "the appearance screen (mirror or ripperdoc) is not open in its edit-V's-look mode");
    }
    let registry = XFBridgeRegistry.Get();
    let unchanged = registry.CreatorUnchangedSince(XFCharacter.Snapshot());
    return "{\"ok\":true,\"changes\":" + IntToString(registry.CreatorChanges()) + ",\"unchanged\":" + XFJson.Flag(unchanged) + "}";
  }

  // Leaves the appearance screen through the menu's own functions (characterCreationBodyMorphMenu
  // .script:688-712; knowledge/photo-mode.md §3.3): Confirm = ConfirmCustomizedCharacter (ReFinalizeState,
  // then the menu moves on); Back = ConfirmBackConfirmation (CancelFinalizedStateUpdate: every change
  // discarded). The plugin refuses both unless allow_creator_leave = true.
  //
  // mode (the plugin's choice): 0 Back (cc.back), 1 Confirm, 2 nothing to confirm. cc.confirm never
  // discards a change (RB-51): mode 2 closes through Back only when it is still certain nothing changed (no
  // change event of any kind since the screen opened, every option as when the screen set them up);
  // otherwise it confirms.
  public static func Leave(cid: String, mode: Int32) -> String {
    if !XFBridgeActions.CharacterMenuOpen() {
      return XFJson.Fail("not_in_character_menu", "the appearance screen (mirror or ripperdoc) is not open in its edit-V's-look mode");
    }
    let registry = XFBridgeRegistry.Get();
    let menu = registry.GetCharacterMenu();
    let changes = registry.CreatorChanges();
    let unchanged = changes == 0 && registry.CreatorUnchangedSince(XFCharacter.Snapshot());
    // Certainly nothing changed: there is nothing to confirm, so Confirm's ReFinalizeState isn't needed
    // (and a stuck busy flag can't block leaving). The screen closes through Back, which discards nothing.
    if mode == 2 && unchanged {
      menu.m_busySwitchingAppearance = BusySwitchingReason.AVAILABLE;
      menu.ConfirmBackConfirmation();
      XFBridgeLog.Info(cid, "cc.confirm: nothing to confirm (no change event, every option as when the screen opened); closed with Back, nothing discarded");
      return "{\"ok\":true,\"kept\":false,\"changed\":false,\"closed_with\":\"back\",\"note\":\"nothing to confirm: no option changed on this screen, so it was closed with Back (nothing was discarded)\"}";
    }
    let keep = mode != 0;
    if XFCharacter.Busy(cid, menu) {
      return XFJson.Fail("busy", "the appearance screen is still applying the previous change");
    }
    let closedWith = "back";
    if keep {
      closedWith = "confirm";
      XFBridgeActions.EnsureSaveLock(cid);
      menu.ConfirmCustomizedCharacter();
      XFBridgeLog.Info(cid, "cc.confirm: the look is kept (ReFinalizeState; " + IntToString(changes) + " change event(s), unchanged=" + XFJson.Flag(unchanged) + "); undo: load the safety save");
    } else {
      menu.ConfirmBackConfirmation();
      XFBridgeLog.Info(cid, "cc.back: every change on the appearance screen discarded");
    }
    return "{\"ok\":true,\"kept\":" + XFJson.Flag(keep) + ",\"changed\":" + XFJson.Flag(!unchanged) + ",\"changes\":" + IntToString(changes) + ",\"closed_with\":" + XFJson.Str(closedWith) + "}";
  }

  // Every option on the screen and its value, as one line ("" when the system has none), for cc.confirm's
  // comparison with the options as the screen set them up.
  public static func Snapshot() -> String {
    let system = GameInstance.GetCharacterCustomizationSystem(GetGameInstance());
    if !IsDefined(system) {
      return "";
    }
    let options = system.GetUnitedOptions(true, true, true);
    let out = "";
    let i = 0;
    while i < ArraySize(options) {
      if IsDefined(options[i]) && IsDefined(options[i].info) {
        out += NameToString(options[i].info.name) + "=" + IntToString(Cast<Int32>(options[i].currIndex)) + ";";
      }
      i += 1;
    }
    return out;
  }

  // Whether the appearance screen is still applying a change. The menu's busy flag is the game's own
  // readiness signal, but it can be left set when no completion will ever come (a change to the value
  // already shown, before this build's OnSliderChange wrap). With no change pending, such a flag is
  // stale once it has stayed set for 8 s with no completion event in between (every completion event
  // restarts that clock); a stale flag is cleared (set back to AVAILABLE, as the completion event
  // would) and logged. A real change still in flight is never forced (RB-54): after 12 s it is logged
  // once and the answer stays "busy" (cc.back still leaves).
  public static func Busy(cid: String, menu: wref<characterCreationBodyMorphMenu>) -> Bool {
    if Equals(menu.m_busySwitchingAppearance, BusySwitchingReason.AVAILABLE) {
      return false;
    }
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) {
      return true;
    }
    let now = EngineTime.ToFloat(GameInstance.GetEngineTime(GetGameInstance()));
    let pending = registry.CreatorPendingSince();
    if pending > 0.0 {
      if now - pending > 12.0 && registry.TakeCreatorInFlightLog() {
        XFBridgeLog.Warn(cid, "appearance screen: a change started " + FloatToStringPrec(now - pending, 1) + " s ago is still in flight (no completion yet); not forcing it");
      }
      return true;
    }
    if now - registry.CreatorBusySeenAt(now) <= 8.0 {
      return true;
    }
    menu.m_busySwitchingAppearance = BusySwitchingReason.AVAILABLE;
    registry.NoteCreatorChangeDone();
    XFBridgeLog.Warn(cid, "appearance screen busy flag was stale (no change pending, no completion for 8 s); cleared");
    return false;
  }

  public static func ModeName(mode: Int32) -> String {
    if mode == 2 {
      return "Ripperdoc";
    }
    return "HairDresser";
  }

  // Why the appearance screen can't be opened now, as a failure answer, or "" when it can: V in
  // the world with no menu open (phase gameplay), not in combat, not in a vehicle, no real scene
  // playing (scene tier 3 or above), the game allowing photo mode (the same "safe moment" check), and no
  // combat, scene, tier or moving-platform save lock from the game.
  //
  // Scene tiers (GameplayTier): 1 full gameplay, 2 staged gameplay, 3 limited gameplay, 4 first-person
  // cinematic, 5 cinematic. Tier 2 is the normal state in V's apartment (session 3: every cc.open there
  // was refused at tier 2, where Character Customization Anywhere's F12 works). The game itself treats
  // tier 2 as free enough to change clothes: the inventory blocks equipping only at tiers 3 to 5
  // (InventoryGPRestrictionHelper.BlockedBySceneTier, inventoryItemData.script:842-847). So tier 2 is
  // accepted and tiers 3 and above are refused.
  public static func OpenRefusal() -> String {
    return XFCharacter.OpenRefusalAt(false);
  }

  // fromPauseMenu: the re-check as the pause menu's scenario opens (cc.open's redirect). The game is then
  // in a menu, so the phase and photo mode's permission (both checked a moment before, in normal play) are
  // skipped; the rest is checked again.
  public static func OpenRefusalAt(fromPauseMenu: Bool) -> String {
    let game = GetGameInstance();
    let phase = XFBridgeActions.Phase();
    if !fromPauseMenu && NotEquals(phase, "gameplay") {
      return XFJson.Fail("not_in_gameplay", "the appearance screen opens only from normal play; the game is in '" + phase + "'");
    }
    if fromPauseMenu && (Equals(phase, "photo_mode") || Equals(phase, "character_menu") || Equals(phase, "loading") || Equals(phase, "main_menu")) {
      return XFJson.Fail("not_in_gameplay", "the game is in '" + phase + "'");
    }
    let player = GetPlayer(game);
    if !IsDefined(player) {
      return XFJson.Fail("not_in_gameplay", "V isn't in the world");
    }
    // A Johnny section (or any other stand-in the story puts in V's place): the creator would edit the
    // wrong character (player.script:590, 606).
    if player.IsReplacer() {
      if player.IsJohnnyReplacer() {
        return XFJson.Fail("not_v", "the player is Johnny right now, not V; the appearance screen opens only for V");
      }
      return XFJson.Fail("not_v", "the player isn't V right now (the story has put someone else in V's place)");
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
      if tier > 2 {
        return XFJson.Fail("not_safe_now", "a scene is playing (scene tier " + IntToString(tier) + "; tiers 1 and 2 are normal play)");
      }
    }
    if !fromPauseMenu && !GameInstance.GetPhotoModeSystem(game).CanPhotoModeBeEnabled() {
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

  // cc.open, step 2 (a few ticks later): checks again, refuses unless saving is locked, then opens the
  // pause menu through the menu-event blackboard (the way GameObject.TriggerMenuEvent does: back to None
  // first, so the same event can fire again), whose scenario the wrap above redirects to the appearance
  // screen (Character Customization Anywhere's route).
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
    // The bridge's own lock, not just any lock: another system's lock may go away while the screen is open.
    if !XFBridgeActions.OwnSaveLockHeld() {
      return XFJson.Fail("save_lock_not_held", "the game hasn't registered the bridge's save lock yet, so the appearance screen wasn't opened; try again in a moment");
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
    board.SetName(GetAllBlackboardDefs().MenuEventBlackboard.MenuEventToTrigger, n"OnOpenPauseMenu");
    XFBridgeLog.Info(cid, "cc.open requested (edit mode " + XFCharacter.ModeName(mode) + ", saving locked); the pause menu opens and its scenario switches to the mirror's");
    return "{\"ok\":true,\"requested\":true,\"edit_mode\":" + XFJson.Str(XFCharacter.ModeName(mode)) + ",\"saving_locked\":true,\"route\":\"pause_menu\"}";
  }

  // cc.open gave up waiting: withdraw the request so a late menu event opens nothing, and say what became
  // of it. withdrawn: nothing will open (still waiting, or the menu refused it or found it expired);
  // taken: the menu switched to the appearance screen for it, which may still be opening (RB-42).
  public static func CancelOpen(cid: String) -> String {
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) {
      return "{\"ok\":true,\"withdrawn\":false,\"taken\":false,\"outcome\":\"unknown\"}";
    }
    let cancelled = registry.CancelCreatorOpen();
    let outcome = registry.CreatorOpenOutcome(cid);
    if cancelled {
      outcome = "withdrawn";
    }
    let nothingOpens = cancelled || Equals(outcome, "refused") || Equals(outcome, "expired");
    let taken = Equals(outcome, "switched") || Equals(outcome, "taken");
    XFBridgeLog.Info(cid, "cc.open request withdrawn=" + XFJson.Flag(cancelled) + " outcome=" + outcome);
    return "{\"ok\":true,\"withdrawn\":" + XFJson.Flag(nothingOpens) + ",\"taken\":" + XFJson.Flag(taken && !nothingOpens) + ",\"outcome\":" + XFJson.Str(outcome) + "}";
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
    if XFCharacter.Busy(cid, menu) {
      return XFJson.Fail("busy", "the appearance screen is still applying the previous change");
    }
    let system = GameInstance.GetCharacterCustomizationSystem(game);
    let match = XFCharacter.Find(system.GetUnitedOptions(true, true, true), option);
    if !IsDefined(match) {
      return XFJson.Fail("bad_params", "no single option named or labelled '" + option + "' on this screen");
    }
    if !match.isActive {
      // Session 4: makeupLips_08 is the colour row of lip style 08, but style 09 (index 8) was chosen, so its
      // colour row was makeupLips_09. The slot names whichever row is in use.
      let inUse = XFCharacter.ActiveInSlot(system.GetUnitedOptions(true, true, true), match.info.uiSlot);
      let hint = "";
      if IsDefined(inUse) {
        hint = "; the row in use in its slot is '" + NameToString(inUse.info.name) + "': give option '" + NameToString(match.info.uiSlot) + "' (the slot) to change whichever row is in use";
      }
      return XFJson.Fail("bad_params", "option '" + option + "' isn't in use on this screen (another choice, such as the style above it, decides which row shows)" + hint);
    }
    if !match.isEditable || match.isCensored {
      return XFJson.Fail("bad_params", "option '" + option + "' can't be changed on this screen (this mode doesn't allow it; cc.open mode ripperdoc allows more rows)");
    }
    let count = XFCharacter.Count(match);
    let matchedBy = "index";
    if index < 0 {
      // By the value's name or on-screen label (the plugin passes index -1 with a value).
      index = XFCharacter.FindValue(match, value);
      matchedBy = "value";
      if index == -1 {
        index = XFCharacter.FindPartialValue(match, value);
        matchedBy = "partial";
      }
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
    let before = Cast<Int32>(match.currIndex);
    // The value already shown: applying it would change nothing, and through the row it would leave the
    // screen's busy flag set for good (session 3). Nothing is sent; the answer says so.
    if index == before {
      XFBridgeLog.Info(cid, "cc.apply " + NameToString(match.info.name) + " already " + IntToString(index) + "; nothing applied");
      return "{\"ok\":true,\"option\":" + XFJson.Name(match.info.name) + ",\"label\":" + XFJson.Str(GetLocalizedText(match.info.localizedName)) + ",\"before\":" + IntToString(before) + ",\"after\":" + IntToString(index) + ",\"count\":" + IntToString(count) + ",\"value\":" + XFJson.Str(XFCharacter.ValueLabel(match, index)) + ",\"value_label\":" + XFJson.Str(XFCharacter.ValueText(match, index)) + ",\"matched_by\":" + XFJson.Str(matchedBy) + ",\"changed\":false,\"route\":\"none\",\"note\":\"already set; nothing applied\"}";
    }
    XFBridgeActions.EnsureSaveLock(cid);
    // Through the option's own row when it is on screen: the row shows the new value's name and
    // keeps its own index, then asks the menu to apply it (OnSliderChange / OnColorChange), exactly
    // as its arrows do. Otherwise straight through the system, as before (the row then keeps
    // showing the old name until the screen is reopened).
    let route = "row";
    if !XFCharacter.ApplyThroughRow(menu, match, index) {
      system.ApplyChangeToOption(match, Cast<Uint32>(index));
      route = "system";
      // Counted here as well, so cc.confirm knows of the change even before the system's update event (RB-51).
      XFBridgeRegistry.Get().NoteCreatorChangeEvent();
    }
    XFBridgeLog.Info(cid, "cc.apply " + NameToString(match.info.name) + " " + IntToString(before) + " -> " + IntToString(index) + " via " + route + "; undo: cc.apply index " + IntToString(before) + ", or Back in the mirror (discards every change)");
    return "{\"ok\":true,\"option\":" + XFJson.Name(match.info.name) + ",\"label\":" + XFJson.Str(GetLocalizedText(match.info.localizedName)) + ",\"before\":" + IntToString(before) + ",\"after\":" + IntToString(index) + ",\"count\":" + IntToString(count) + ",\"value\":" + XFJson.Str(XFCharacter.ValueLabel(match, index)) + ",\"before_value\":" + XFJson.Str(XFCharacter.ValueLabel(match, before)) + ",\"value_label\":" + XFJson.Str(XFCharacter.ValueText(match, index)) + ",\"matched_by\":" + XFJson.Str(matchedBy) + ",\"route\":" + XFJson.Str(route) + ",\"row_updated\":" + XFJson.Flag(Equals(route, "row")) + ",\"changed\":true}";
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

// --- Photo-mode poses --------------------------------------------------------------------------------

// photo.pose.set and the live-pose carrier's check. Poses are chosen through the menu, as the player does:
// attribute 5 is the category, 6 the pose in that category (knowledge/poses.md §4). Both lists come from the
// menu's own option setup (captured in XFBridgeRegistry), so labels are the menu's texts.
public abstract class XFPose {
  public static func CategoryKey() -> Int32 {
    return 5;
  }

  public static func PoseKey() -> Int32 {
    return 6;
  }

  // A record's display name as the menu shows it: a localisation key, else the literal text.
  public static func Label(name: CName) -> String {
    let text = GetLocalizedTextByKey(name);
    if StrLen(text) == 0 {
      text = GetLocalizedText(NameToString(name));
    }
    return text;
  }

  // The option index whose text is `text` (or whose data is `value` when value >= 0); -1 none, -2 several.
  public static func FindOption(item: ref<XFPhotoItem>, text: String, value: Int32) -> Int32 {
    let found = -1;
    let matches = 0;
    let i = 0;
    while i < ArraySize(item.optionData) {
      let hit = false;
      if value >= 0 {
        hit = item.optionData[i] == value;
      } else {
        hit = Equals(item.optionTexts[i], text) || Equals(StrLower(item.optionTexts[i]), StrLower(text));
      }
      if hit {
        found = i;
        matches += 1;
      }
      i += 1;
    }
    if matches > 1 {
      return -2;
    }
    return found;
  }

  public static func Item(key: Int32) -> ref<XFPhotoItem> {
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) {
      return null;
    }
    return registry.FindItem(Cast<Uint32>(key));
  }

  // Step 1: the category (from the record, the label or the option data) and the menu's values before.
  public static func SelectCategory(cid: String, record: String, category: String, value: Int32) -> String {
    if !XFPhoto.Active() {
      return XFJson.Fail("not_in_photo_mode", "photo mode is not open");
    }
    let controller = XFPhoto.Controller();
    let categories = XFPose.Item(XFPose.CategoryKey());
    let poses = XFPose.Item(XFPose.PoseKey());
    if !IsDefined(controller) || !IsDefined(categories) || !IsDefined(poses) || !Equals(categories.kind, "options") {
      return XFJson.Fail("unavailable", "the photo-mode pose menu hasn't been seen yet; open the pose tab once, or close and reopen photo mode");
    }
    let beforeKnown = XFPhoto.HasValue(controller, categories) && XFPhoto.HasValue(controller, poses);
    let beforeCategory = XFPhoto.CurrentValue(controller, categories);
    let beforePose = XFPhoto.CurrentValue(controller, poses);
    let out = "{\"ok\":true,\"before_known\":" + XFJson.Flag(beforeKnown) + ",\"before_category\":" + IntToString(RoundF(beforeCategory)) + ",\"before_pose\":" + IntToString(RoundF(beforePose));
    let wantedText = category;
    if StrLen(record) > 0 {
      let pose = TweakDBInterface.GetPhotoModePoseRecord(TDBID.Create(record));
      if !IsDefined(pose) {
        return XFJson.Fail("bad_params", "no photo-mode pose record named " + record);
      }
      out += ",\"pose_text\":" + XFJson.Str(XFPose.Label(pose.DisplayName())) + ",\"animation\":" + XFJson.Name(pose.AnimationName());
      let categoryName = NameToString(pose.Category());
      let categoryRecord = TweakDBInterface.GetPhotoModePoseCategoryRecord(TDBID.Create(categoryName));
      if !IsDefined(categoryRecord) {
        categoryRecord = TweakDBInterface.GetPhotoModePoseCategoryRecord(TDBID.Create("PhotoModePoseCategories." + categoryName));
      }
      if !IsDefined(categoryRecord) {
        return XFJson.Fail("unavailable", "the pose record " + record + " names a category (" + categoryName + ") the bridge can't find; select it by label instead");
      }
      wantedText = XFPose.Label(categoryRecord.DisplayName());
    }
    if StrLen(wantedText) == 0 && value < 0 {
      // No category asked for: the pose is looked for in the list shown now.
      return out + ",\"changed\":false,\"category_value\":" + IntToString(RoundF(beforeCategory)) + "}";
    }
    let index = XFPose.FindOption(categories, wantedText, value);
    if index == -2 {
      return XFJson.Fail("bad_params", "more than one pose category is labelled '" + wantedText + "'; use category_value (photo.state lists the options)");
    }
    if index < 0 {
      return XFJson.Fail("bad_params", "no pose category labelled '" + wantedText + "' in the menu (" + IntToString(ArraySize(categories.optionData)) + " categories; photo.state lists them)");
    }
    let data = categories.optionData[index];
    out += ",\"category_value\":" + IntToString(data) + ",\"category_text\":" + XFJson.Str(categories.optionTexts[index]);
    if Cast<Float>(data) == beforeCategory && beforeKnown {
      return out + ",\"changed\":false}";
    }
    let set = XFPhoto.SetAttribute(cid, XFPose.CategoryKey(), Cast<Float>(data));
    if StrFindFirst(set, "\"ok\":true") < 0 {
      return set;
    }
    return out + ",\"changed\":true}";
  }

  // Step 2 (after the menu rebuilt the pose list): the pose by label or option data.
  public static func SelectPose(cid: String, pose: String, value: Int32) -> String {
    if !XFPhoto.Active() {
      return XFJson.Fail("not_in_photo_mode", "photo mode is not open");
    }
    let controller = XFPhoto.Controller();
    let poses = XFPose.Item(XFPose.PoseKey());
    if !IsDefined(controller) || !IsDefined(poses) || !Equals(poses.kind, "options") {
      return XFJson.Fail("unavailable", "the photo-mode pose list hasn't been seen yet");
    }
    let index = XFPose.FindOption(poses, pose, value);
    if index == -2 {
      return XFJson.Fail("bad_params", "more than one pose in this category is labelled '" + pose + "'; use pose_value (photo.state lists the options)");
    }
    if index < 0 {
      return XFJson.Fail("bad_params", "no pose labelled '" + pose + "' in the current category (" + IntToString(ArraySize(poses.optionData)) + " poses; photo.state lists them)");
    }
    let data = poses.optionData[index];
    let before = XFPhoto.CurrentValue(controller, poses);
    let out = ",\"pose_value\":" + IntToString(data) + ",\"pose_text\":" + XFJson.Str(poses.optionTexts[index]);
    if Cast<Float>(data) == before && XFPhoto.HasValue(controller, poses) {
      return "{\"ok\":true,\"changed\":false" + out + "}";
    }
    let set = XFPhoto.SetAttribute(cid, XFPose.PoseKey(), Cast<Float>(data));
    if StrFindFirst(set, "\"ok\":true") < 0 {
      return set;
    }
    XFBridgeLog.Info(cid, "photo pose '" + poses.optionTexts[index] + "' selected; undo: photo.pose.set with the earlier category and pose");
    return "{\"ok\":true,\"changed\":true" + out + "}";
  }

  // pose.live.apply's precondition: photo mode open with the XF live carrier as the selected pose (its
  // record's label, core/LivePose.hpp kCarrierPoseLabel).
  public static func CarrierSelected(cid: String) -> String {
    if !XFPhoto.Active() {
      return "{\"ok\":true,\"selected\":false,\"pose\":\"none (photo mode is not open)\"}";
    }
    let controller = XFPhoto.Controller();
    let poses = XFPose.Item(XFPose.PoseKey());
    if !IsDefined(controller) || !IsDefined(poses) {
      return "{\"ok\":true,\"selected\":false,\"pose\":\"unknown (the pose menu hasn't been seen)\"}";
    }
    let listItem = controller.GetMenuItem(poses.key);
    if !IsDefined(listItem) {
      return "{\"ok\":true,\"selected\":false,\"pose\":\"unknown\"}";
    }
    let index = listItem.GetSelectedOptionIndex();
    if index < 0 || index >= ArraySize(poses.optionTexts) {
      return "{\"ok\":true,\"selected\":false,\"pose\":\"unknown\"}";
    }
    let text = poses.optionTexts[index];
    let carrier = TweakDBInterface.GetPhotoModePoseRecord(TDBID.Create("PhotoModePoses.xfs_live_carrier"));
    let wanted = "XF Live Carrier";
    if IsDefined(carrier) {
      wanted = XFPose.Label(carrier.DisplayName());
    }
    return "{\"ok\":true,\"selected\":" + XFJson.Flag(Equals(text, wanted)) + ",\"pose\":" + XFJson.Str(text) + "}";
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
  // In photo mode (0.4.2; session 4 needed 02:00 there): photo mode's own time-of-day slider, see PhotoTime.
  // Not in any other menu.
  public static func SetTime(cid: String, hours: Int32, minutes: Int32, seconds: Int32, totalSeconds: Int32) -> String {
    let phase = XFBridgeActions.Phase();
    if Equals(phase, "photo_mode") {
      return XFWorld.PhotoTime(cid, hours, minutes, seconds, totalSeconds);
    }
    if NotEquals(phase, "gameplay") && NotEquals(phase, "character_menu") {
      return XFJson.Fail("not_in_gameplay", "the clock can be set in normal play, with the appearance screen open or in photo mode; the game is in '" + phase + "'");
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

  // world.time.set in photo mode: photo mode keeps its own time of day (the Environment tab's TIME OF DAY
  // slider, attribute 70, 0-1440 minutes in the first session's menu dump) and restores the world's when it
  // closes, so the bridge sets that slider through the menu (XFPhoto.SetAttribute, checked against the
  // range the menu set up), the same as the player's own slider, rather than the world clock underneath
  // it. Hours and minutes only: total_seconds (a time with its day) belongs to the world clock.
  public static func PhotoTime(cid: String, hours: Int32, minutes: Int32, seconds: Int32, totalSeconds: Int32) -> String {
    if totalSeconds >= 0 {
      return XFJson.Fail("bad_params", "in photo mode the time is photo mode's own time-of-day slider, set with hours and minutes; total_seconds (an exact time with its day) applies only outside photo mode");
    }
    let controller = XFPhoto.Controller();
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(controller) || !IsDefined(registry) {
      return XFJson.Fail("unavailable", "the photo-mode menu has not been seen yet; close and reopen photo mode");
    }
    let item = registry.FindItem(70u);
    // The key can shift with the game version or mods that add rows: only a slider over a day's range is taken.
    if !IsDefined(item) || !Equals(item.kind, "slider") || item.maxValue < 23.0 || item.maxValue > 1441.0 {
      return XFJson.Fail("unavailable", "photo mode's time-of-day slider (attribute 70) isn't in the menu as expected, so the time wasn't set");
    }
    let inHours = item.maxValue <= 24.5;
    let wanted = Cast<Float>(hours * 60 + minutes) + Cast<Float>(seconds) / 60.0;
    let value = wanted;
    if inHours {
      value = wanted / 60.0;
    }
    let beforeKnown = XFPhoto.HasValue(controller, item);
    let before = XFPhoto.CurrentValue(controller, item);
    let set = XFPhoto.SetAttribute(cid, 70, value);
    if StrFindFirst(set, "\"ok\":true") < 0 {
      return set;
    }
    let after = XFPhoto.CurrentValue(controller, item);
    let scale = 1.0;
    if inHours {
      scale = 60.0;
    }
    XFBridgeLog.Info(cid, "photo-mode time of day " + FloatToString(before * scale) + " -> " + FloatToString(after * scale) + " minutes (attribute 70); undo: world.time.set with the earlier hours and minutes, or leave photo mode");
    return "{\"ok\":true,\"phase\":\"photo_mode\",\"route\":\"photo_time\",\"key\":70,\"label\":" + XFJson.Str(item.label) + ",\"unit\":\"minutes\",\"before_minutes\":" + XFJson.Num(before * scale) + ",\"before_known\":" + XFJson.Flag(beforeKnown) + ",\"after_minutes\":" + XFJson.Num(after * scale) + ",\"note\":\"photo mode's own time of day; the world's clock comes back when photo mode closes\"}";
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
