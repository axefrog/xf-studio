// XF Runtime Bridge: TEMPORARY TEST FEATURE (bridge 0.5.3), Demo C: XF map pins (world.pin, world.pin.clear).
//
// A pin is a runtime mappin registered through the game's own mappin system (MappinSystem.RegisterMappin, or
// RegisterMappinWithObject so a pin above a showroom head follows it), the way the game's drop points and devices add
// theirs (dropPointSystem.script, dropPoint.script) and published mods add custom ones. Its type is the game's
// Mappins.DefaultStaticMappin; its variant (custom, apartment, clothes, default) decides the world map's filter group and
// the fallback icon. The label goes in the mappin data's debugCaption, which IMappin.GetDisplayName answers.
//
// The XF icon is drawn in ink, with no texture asset: wraps of the mappin controllers' UpdateIcon (the world map, the
// in-world pin and the minimap) recognise our pins by their NewMappinID in this session's registry, fade the variant's
// icon out and add a small badge (a cyan diamond with "XF", and the label under it) to the pin's root widget; a controller
// reused for another mappin loses the badge again. The world map's tooltip names the pin. Every wrap calls the game first
// and only adds; an unknown mappin costs one registry lookup.
//
// Cleared by world.pin.clear, the kill switch (the plugin calls XFInkPins.Clear(-1)) and loading a save: the registry is a
// scriptable system of the session, and the mappins belong to the session's mappin system [the latter is session 7's
// check]. The bridge's save lock is held from the first pin, so no save contains one. Vanilla 2.31 APIs only.

module XFRuntimeBridge

public class XFPinEntry {
  public let id: Int32;
  public let mappin: NewMappinID;
  public let label: String;
  public let variant: String;
  public let target: String;
  public let piece: Int32;
  public let position: Vector4;
  public let bound: Bool;
}

public class XFPinRegistry extends ScriptableSystem {
  private let m_pins: array<ref<XFPinEntry>>;
  private let m_last: Int32;

  public static func Get() -> ref<XFPinRegistry> {
    let game = GetGameInstance();
    if !GameInstance.IsValid(game) {
      return null;
    }
    let container = GameInstance.GetScriptableSystemsContainer(game);
    if !IsDefined(container) {
      return null;
    }
    return container.Get(n"XFRuntimeBridge.XFPinRegistry") as XFPinRegistry;
  }

  public func NextId() -> Int32 {
    this.m_last += 1;
    return this.m_last;
  }

  public func Add(entry: ref<XFPinEntry>) -> Void {
    ArrayPush(this.m_pins, entry);
  }

  public func Pins() -> array<ref<XFPinEntry>> {
    return this.m_pins;
  }

  public func Count() -> Int32 {
    return ArraySize(this.m_pins);
  }

  public func Find(id: NewMappinID) -> ref<XFPinEntry> {
    for entry in this.m_pins {
      if Equals(entry.mappin, id) {
        return entry;
      }
    }
    return null;
  }

  // Forgets one pin (by our id) or all (-1); answers the removed entries.
  public func Take(id: Int32) -> array<ref<XFPinEntry>> {
    let kept: array<ref<XFPinEntry>>;
    let taken: array<ref<XFPinEntry>>;
    for entry in this.m_pins {
      if id < 0 || entry.id == id {
        ArrayPush(taken, entry);
      } else {
        ArrayPush(kept, entry);
      }
    }
    this.m_pins = kept;
    return taken;
  }

  // Forgets every pin bound to a showroom head (RB-87: showroom.clear takes the heads they follow away).
  public func TakeBound() -> array<ref<XFPinEntry>> {
    let kept: array<ref<XFPinEntry>>;
    let taken: array<ref<XFPinEntry>>;
    for entry in this.m_pins {
      if Equals(entry.target, "piece") {
        ArrayPush(taken, entry);
      } else {
        ArrayPush(kept, entry);
      }
    }
    this.m_pins = kept;
    return taken;
  }
}

public abstract class XFInkPins {
  public static func Variant(name: String) -> gamedataMappinVariant {
    if Equals(name, "apartment") {
      return gamedataMappinVariant.ApartmentVariant;
    }
    if Equals(name, "clothes") {
      return gamedataMappinVariant.ServicePointClothesVariant;
    }
    if Equals(name, "default") {
      return gamedataMappinVariant.DefaultVariant;
    }
    return gamedataMappinVariant.CustomPositionVariant;
  }

  public static func Entry(mappin: wref<IMappin>) -> ref<XFPinEntry> {
    if !IsDefined(mappin) {
      return null;
    }
    let registry = XFPinRegistry.Get();
    if !IsDefined(registry) || registry.Count() == 0 {
      return null;
    }
    return registry.Find(mappin.GetNewMappinID());
  }

  public static func Json(entry: ref<XFPinEntry>) -> String {
    return "{\"id\":" + IntToString(entry.id) + ",\"label\":" + XFJson.Str(entry.label) + ",\"variant\":" + XFJson.Str(entry.variant)
      + ",\"target\":" + XFJson.Str(entry.target) + ",\"piece\":" + IntToString(entry.piece) + ",\"bound\":" + XFJson.Str(entry.bound ? "object" : "position")
      + ",\"position\":[" + XFJson.Num(entry.position.X) + "," + XFJson.Num(entry.position.Y) + "," + XFJson.Num(entry.position.Z) + "]}";
  }

  public static func List(registry: ref<XFPinRegistry>) -> String {
    let out = "";
    for entry in registry.Pins() {
      out += (StrLen(out) > 0 ? "," : "") + XFInkPins.Json(entry);
    }
    return "[" + out + "]";
  }

  // world.pin. target: "position" (x, y, z), "piece" (a showroom head: above its eyes, following it) or "v" (above V, where
  // she stands now); lift: metres up from that point.
  public static func Place(cid: String, target: String, x: Float, y: Float, z: Float, piece: Int32, label: String, variant: String, lift: Float) -> String {
    let phase = XFBridgeActions.Phase();
    if NotEquals(phase, "gameplay") && NotEquals(phase, "photo_mode") {
      return XFJson.Fail("not_in_world", "map pins need V in the world; the game is in '" + phase + "'");
    }
    let game = GetGameInstance();
    let player = GetPlayer(game);
    let registry = XFPinRegistry.Get();
    let mappins = GameInstance.GetMappinSystem(game);
    if !IsDefined(player) || !IsDefined(registry) || !IsDefined(mappins) {
      return XFJson.Fail("not_ready", "the game's mappin system isn't ready yet; try again in a moment");
    }
    if registry.Count() >= 8 {
      return XFJson.Fail("too_many_pins", "the bridge already shows 8 XF pins; remove one with world.pin.clear");
    }
    let data: MappinData;
    data.mappinType = t"Mappins.DefaultStaticMappin";
    data.variant = XFInkPins.Variant(variant);
    data.active = true;
    data.visibleThroughWalls = true;
    data.debugCaption = label;
    let entry = new XFPinEntry();
    entry.label = label;
    entry.variant = variant;
    entry.target = target;
    entry.piece = -1;
    if Equals(target, "piece") {
      let showroom = XFShowroomRegistry.Get();
      let item = IsDefined(showroom) ? showroom.Piece(piece) : null;
      if !IsDefined(item) {
        return XFJson.Fail("no_such_piece", "the showroom has no piece " + IntToString(piece));
      }
      let entity = XFInkHost.Entity(item.id);
      if !IsDefined(entity) {
        return XFJson.Fail("not_spawned_yet", "piece " + IntToString(piece) + " isn't in the world yet; try again in a moment");
      }
      // The head's eyes stand 1.69 m above its entity's origin (the showroom build's head joint plus 5 cm).
      let origin = entity.GetWorldPosition();
      entry.piece = piece;
      entry.position = new Vector4(origin.X, origin.Y, origin.Z + 1.69 + lift, 1.0);
      let owner = entity as GameObject;
      if IsDefined(owner) {
        entry.mappin = mappins.RegisterMappinWithObject(data, owner, n"", new Vector3(0.0, 0.0, 1.69 + lift));
        entry.bound = true;
      } else {
        entry.mappin = mappins.RegisterMappin(data, entry.position);
      }
    } else {
      if Equals(target, "v") {
        let at = player.GetWorldPosition();
        entry.position = new Vector4(at.X, at.Y, at.Z + 1.8 + lift, 1.0);
      } else {
        entry.position = new Vector4(x, y, z + lift, 1.0);
      }
      entry.mappin = mappins.RegisterMappin(data, entry.position);
    }
    let none: NewMappinID;
    if Equals(entry.mappin, none) {
      return XFJson.Fail("pin_refused", "the game's mappin system didn't register the pin");
    }
    entry.id = registry.NextId();
    registry.Add(entry);
    XFBridgeActions.EnsureSaveLock(cid);
    XFBridgeLog.Info(cid, "world.pin placed " + IntToString(entry.id) + " '" + label + "' " + target + " variant=" + variant);
    return "{\"ok\":true,\"id\":" + IntToString(entry.id) + ",\"pin\":" + XFInkPins.Json(entry) + ",\"pins\":" + XFInkPins.List(registry) + "}";
  }

  // world.pin.clear, and the kill switch (id -1: every XF pin).
  public static func Clear(cid: String, id: Int32) -> String {
    let registry = XFPinRegistry.Get();
    if !IsDefined(registry) {
      return "{\"ok\":true,\"removed\":[],\"pins\":[]}";
    }
    let mappins = GameInstance.GetMappinSystem(GetGameInstance());
    let taken = registry.Take(id);
    if id >= 0 && ArraySize(taken) == 0 {
      return XFJson.Fail("no_such_pin", "no XF pin has id " + IntToString(id));
    }
    let removed = "";
    for entry in taken {
      if IsDefined(mappins) {
        mappins.UnregisterMappin(entry.mappin);
      }
      removed += (StrLen(removed) > 0 ? "," : "") + IntToString(entry.id);
    }
    if ArraySize(taken) > 0 {
      XFBridgeLog.Info(cid, "world.pin cleared " + IntToString(ArraySize(taken)));
    }
    return "{\"ok\":true,\"removed\":[" + removed + "],\"pins\":" + XFInkPins.List(registry) + "}";
  }

  // showroom.clear of the heads (RB-87): every pin placed above a showroom head goes with them, so no pin is left bound to a
  // despawned owner. Answers how many were removed.
  public static func ClearBound(cid: String) -> Int32 {
    let registry = XFPinRegistry.Get();
    if !IsDefined(registry) {
      return 0;
    }
    let mappins = GameInstance.GetMappinSystem(GetGameInstance());
    let taken = registry.TakeBound();
    for entry in taken {
      if IsDefined(mappins) {
        mappins.UnregisterMappin(entry.mappin);
      }
    }
    if ArraySize(taken) > 0 {
      XFBridgeLog.Info(cid, "world.pin cleared " + IntToString(ArraySize(taken)) + " pin(s) above showroom heads with the heads");
    }
    return ArraySize(taken);
  }

  // The XF badge: a cyan diamond with "XF" and the label under it, added once to a pin's root widget.
  public static func Badge(root: wref<inkCompoundWidget>, label: String, showLabel: Bool) -> Void {
    if !IsDefined(root) {
      return;
    }
    let badge = root.GetWidgetByPathName(n"xfs_pin_badge") as inkCanvas;
    if !IsDefined(badge) {
      badge = new inkCanvas();
      badge.SetName(n"xfs_pin_badge");
      badge.SetAnchor(inkEAnchor.Centered);
      badge.SetAnchorPoint(new Vector2(0.5, 0.5));
      badge.SetSize(new Vector2(48.0, 48.0));
      badge.SetInteractive(false);
      let frame = new inkRectangle();
      frame.SetName(n"frame");
      frame.SetAnchor(inkEAnchor.Centered);
      frame.SetAnchorPoint(new Vector2(0.5, 0.5));
      frame.SetSize(new Vector2(34.0, 34.0));
      frame.SetRotation(45.0);
      XFInkStyle.Bind(frame, n"MainColors.Blue");
      frame.Reparent(badge);
      let inner = new inkRectangle();
      inner.SetName(n"inner");
      inner.SetAnchor(inkEAnchor.Centered);
      inner.SetAnchorPoint(new Vector2(0.5, 0.5));
      inner.SetSize(new Vector2(27.0, 27.0));
      inner.SetRotation(45.0);
      inner.SetTintColor(new HDRColor(0.035, 0.035, 0.06, 1.0));
      inner.Reparent(badge);
      let mark = XFInkStyle.Text(n"mark", 20, n"Bold", n"MainColors.Blue", true);
      mark.SetText("XF");
      mark.SetAnchor(inkEAnchor.Centered);
      mark.SetAnchorPoint(new Vector2(0.5, 0.5));
      mark.Reparent(badge);
      let name = XFInkStyle.Text(n"label", 22, n"Semi-Bold", n"MainColors.Blue", true);
      name.SetAnchor(inkEAnchor.BottomCenter);
      name.SetAnchorPoint(new Vector2(0.5, 0.0));
      name.SetMargin(new inkMargin(0.0, 0.0, 0.0, -8.0));
      name.Reparent(badge);
      badge.Reparent(root);
    }
    let text = badge.GetWidgetByPathName(n"label") as inkText;
    if IsDefined(text) {
      text.SetText(label);
      text.SetVisible(showLabel);
    }
    badge.SetVisible(true);
  }

  public static func Unbadge(root: wref<inkCompoundWidget>) -> Bool {
    if !IsDefined(root) {
      return false;
    }
    let badge = root.GetWidgetByPathName(n"xfs_pin_badge");
    if IsDefined(badge) {
      root.RemoveChild(badge);
      return true;
    }
    return false;
  }
}

// Shared by every mappin controller's wrap below: our pin gets the badge and a faded variant icon; any other mappin loses a
// badge an earlier XF pin left on a reused controller.
@addMethod(BaseMappinBaseController)
protected final func XFBridgeDecorate(showLabel: Bool) -> Bool {
  let entry = XFInkPins.Entry(this.GetMappin());
  if IsDefined(entry) {
    XFInkPins.Badge(this.GetRootCompoundWidget(), entry.label, showLabel);
    inkWidgetRef.SetOpacity(this.iconWidget, 0.0);
    return true;
  }
  if XFInkPins.Unbadge(this.GetRootCompoundWidget()) {
    inkWidgetRef.SetOpacity(this.iconWidget, 1.0);
  }
  return false;
}

// The world map.
@wrapMethod(BaseWorldMapMappinController)
protected func UpdateIcon() -> Void {
  wrappedMethod();
  this.XFBridgeDecorate(true);
}

// The pin in the world (and its screen-edge clamp).
@wrapMethod(QuestMappinController)
protected func UpdateIcon() -> Void {
  wrappedMethod();
  if this.XFBridgeDecorate(true) && inkWidgetRef.IsValid(this.displayName) {
    // The badge carries the label; the vanilla name line would repeat it.
    inkWidgetRef.SetVisible(this.displayName, false);
  }
}

@wrapMethod(GameplayMappinController)
private func UpdateIcon() -> Void {
  wrappedMethod();
  this.XFBridgeDecorate(true);
}

// The minimap: the badge without its label.
@wrapMethod(MinimapPOIMappinController)
protected final func UpdateIcon() -> Void {
  wrappedMethod();
  this.XFBridgeDecorate(false);
}

// The world map's tooltip names an XF pin.
@wrapMethod(WorldMapTooltipController)
public func SetData(const data: script_ref<WorldMapTooltipData>, menu: ref<WorldMapMenuGameController>) -> Void {
  wrappedMethod(data, menu);
  let entry = XFInkPins.Entry(Deref(data).mappin);
  if IsDefined(entry) {
    inkTextRef.SetText(this.m_titleText, entry.label);
    inkTextRef.SetText(this.m_descText, "XF Runtime Bridge test pin (temporary). XF Studio placed it; the kill switch or loading a save removes it.");
  }
}
