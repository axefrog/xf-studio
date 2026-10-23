// XF Runtime Bridge: TEMPORARY TEST FEATURE (bridge 0.5.3), Demo C: XF map pins (world.pin, world.pin.clear).
//
// A pin is a runtime mappin registered through the game's own mappin system (MappinSystem.RegisterMappin, or
// RegisterMappinWithObject so a pin above a showroom head follows it), the way the game's drop points and devices add
// theirs (dropPointSystem.script, dropPoint.script) and published mods add custom ones. Its type is the game's
// Mappins.DefaultStaticMappin; its variant (custom, apartment, clothes, default) decides the world map's filter group and
// the fallback icon. The label goes in the mappin data's debugCaption, which IMappin.GetDisplayName answers.
//
// The XF icon is drawn in ink, with no texture asset: wraps of the mappin controllers' UpdateIcon (the world map, the
// in-world pin and the minimap) recognise our pins by their NewMappinID in this session's registry and add a small badge
// (a cyan diamond with "XF", and the label under it) above the variant's own icon; a controller reused for another mappin
// loses the badge again. The world map's tooltip names the pin. Every wrap calls the game first and only adds; an unknown
// mappin costs one registry lookup.
//
// 0.8 (session 8's G5: no pin anywhere, in the world, on the minimap or on the map): the wraps faded the variant's icon out
// and hid the in-world name line, so when the badge didn't draw nothing did. Now the game's own icon and name line always
// stay (the name line shows the label), the badge only adds, and each view that draws a pin is recorded once (the plugin
// log's "world.pin N drawn by <controller>" and world.pin's drawn_by), so the next session sees which views ran. The
// mappin data follows Appearance Menu Mod's markers exactly (Mappins.QuestDynamicMappinDefinition, visible through walls,
// active left unset), which draw in the world, on the minimap and on the map [runtime, AMM's users]; the default variant is
// CustomPositionVariant, the one variant the minimap spawns a widget for on any runtime mappin (minimap.script
// CreateMappinUIProfile, "Always").
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
  // 0.8: the views that have drawn this pin so far (controller class names), for world.pin's answer and the log.
  public let drawnBy: array<String>;
  // 0.8.3: the bridge's own mark in the world (XFRuntimeBridgeInk.reds PlacePinMark) as the overlay last placed it: shown
  // this tick, its top-left corner in the overlay's units and in window pixels (the game's own layout), on screen or not.
  public let markShown: Bool;
  public let markPlacedNow: Bool;
  public let markAt: Vector2;
  public let markPx: Vector2;
  public let markOnScreen: Bool;
  // 0.8.7: the mark is held at the screen's edge, pointing the way to a pin off the screen (as the game's own edge marker does).
  public let markAtEdge: Bool;
  // 0.8.4: the pin's own point projected into window pixels this tick (where the game's marker is anchored), so a screenshot
  // shows how far above it the game draws its marker and the XF mark.
  public let pointPx: Vector2;
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
    // 0.8: Appearance Menu Mod's trigger markers' variant (drawn in the world; not on the minimap).
    if Equals(name, "interaction") {
      return gamedataMappinVariant.DefaultInteractionVariant;
    }
    return gamedataMappinVariant.CustomPositionVariant;
  }

  // 0.8: records the first time a view draws an XF pin (the plugin log and world.pin's drawn_by).
  public static func NoteDrawn(entry: ref<XFPinEntry>, view: String) -> Void {
    if !IsDefined(entry) || ArrayContains(entry.drawnBy, view) {
      return;
    }
    ArrayPush(entry.drawnBy, view);
    XFBridgeLog.Info("pins", "world.pin " + IntToString(entry.id) + " '" + entry.label + "' drawn by " + view);
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
    let drawn = "";
    for view in entry.drawnBy {
      drawn += (StrLen(drawn) > 0 ? "," : "") + XFJson.Str(view);
    }
    return "{\"id\":" + IntToString(entry.id) + ",\"label\":" + XFJson.Str(entry.label) + ",\"variant\":" + XFJson.Str(entry.variant)
      + ",\"target\":" + XFJson.Str(entry.target) + ",\"piece\":" + IntToString(entry.piece) + ",\"bound\":" + XFJson.Str(entry.bound ? "object" : "position")
      + ",\"position\":[" + XFJson.Num(entry.position.X) + "," + XFJson.Num(entry.position.Y) + "," + XFJson.Num(entry.position.Z) + "],\"drawn_by\":[" + drawn + "]"
      + ",\"xf_mark\":{\"shown\":" + XFJson.Flag(entry.markShown) + ",\"at\":[" + XFJson.Num(entry.markAt.X) + "," + XFJson.Num(entry.markAt.Y)
      + "],\"px\":[" + XFJson.Num(entry.markPx.X) + "," + XFJson.Num(entry.markPx.Y) + "],\"point_px\":[" + XFJson.Num(entry.pointPx.X) + "," + XFJson.Num(entry.pointPx.Y)
      + "],\"on_screen\":" + XFJson.Flag(entry.markShown && entry.markOnScreen) + ",\"at_edge\":" + XFJson.Flag(entry.markShown && entry.markAtEdge) + "}}";
  }

  // 0.8.2: ui.state's pins, with the views that have drawn each by now.
  public static func Pins(cid: String) -> String {
    let registry = XFPinRegistry.Get();
    if !IsDefined(registry) {
      return "{\"ok\":true,\"pins\":[]}";
    }
    return "{\"ok\":true,\"pins\":" + XFInkPins.List(registry) + "}";
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
    // 0.7 (session 7: the position pin didn't show in the world, and neither pin on the minimap): the quest system's
    // dynamic mappin type, which draws in the world, on the map and on the minimap for a plain position, as Appearance
    // Menu Mod's markers use it (Modules/util.lua SetMarkerAtPosition); DefaultStaticMappin showed on the world map only.
    data.mappinType = t"Mappins.QuestDynamicMappinDefinition";
    data.variant = XFInkPins.Variant(variant);
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
      // The head's eyes stand 1.69 m above its entity's origin (the showroom build's head joint plus 5 cm); lift defaults to
      // 0.12 m, the crown (0.8.4, session 11's G4: 0.25 drew the game's marker about a head's height above it). 0.7 (session 7:
      // the object-bound pin drew well above the head, as the game's default circle): the pin is placed at that point, not
      // bound to the entity, so its height is exactly the eyes plus lift; turning a head doesn't move it, and clearing the
      // heads removes it (RB-87).
      let origin = entity.GetWorldPosition();
      entry.piece = piece;
      entry.position = new Vector4(origin.X, origin.Y, origin.Z + 1.69 + lift, 1.0);
      entry.mappin = mappins.RegisterMappin(data, entry.position);
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

  // The XF badge: a cyan diamond with "XF" and the label under it, added once to a pin's root widget, above the game's own
  // icon (0.8: which stays).
  public static func Badge(root: wref<inkCompoundWidget>, label: String, showLabel: Bool) -> Void {
    if !IsDefined(root) {
      return;
    }
    let badge = root.GetWidgetByPathName(n"xfs_pin_badge") as inkCanvas;
    if !IsDefined(badge) {
      badge = new inkCanvas();
      badge.SetName(n"xfs_pin_badge");
      badge.SetAnchor(inkEAnchor.Centered);
      badge.SetAnchorPoint(new Vector2(0.5, 1.0));
      badge.SetTranslation(new Vector2(0.0, -28.0));
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

  // ---- 0.8.3: the bridge's own mark in the world (XFRuntimeBridgeInk.reds PinMark), in a canvas of a fixed size ----------

  public static func MarkWidth() -> Float {
    return 360.0;
  }

  public static func MarkHeight() -> Float {
    return 96.0;
  }

  // The diamond with "XF" at the top centre, the label under it; every part placed by a margin from the canvas's top-left.
  public static func BuildMark(mark: ref<inkCanvas>) -> Void {
    let w = XFInkPins.MarkWidth();
    // 0.8.7 (session 14's U2: readable over a bright sky, but only just): a dark halo under the diamond and a dark plate under
    // the label, half see-through, so both keep their contrast over sky and neon alike.
    let halo = new inkRectangle();
    halo.SetName(n"halo");
    halo.SetAnchor(inkEAnchor.TopLeft);
    halo.SetSize(new Vector2(44.0, 44.0));
    halo.SetRenderTransformPivot(new Vector2(0.5, 0.5));
    halo.SetRotation(45.0);
    halo.SetMargin(new inkMargin(w * 0.5 - 22.0, 2.0, 0.0, 0.0));
    halo.SetTintColor(new HDRColor(0.0, 0.0, 0.0, 1.0));
    halo.SetOpacity(0.55);
    halo.Reparent(mark);
    let plate = new inkRectangle();
    plate.SetName(n"plate");
    plate.SetAnchor(inkEAnchor.TopLeft);
    plate.SetSize(new Vector2(w, 34.0));
    plate.SetMargin(new inkMargin(0.0, 54.0, 0.0, 0.0));
    plate.SetTintColor(new HDRColor(0.0, 0.0, 0.0, 1.0));
    plate.SetOpacity(0.5);
    plate.Reparent(mark);
    let frame = new inkRectangle();
    frame.SetName(n"frame");
    frame.SetAnchor(inkEAnchor.TopLeft);
    frame.SetSize(new Vector2(34.0, 34.0));
    frame.SetRenderTransformPivot(new Vector2(0.5, 0.5));
    frame.SetRotation(45.0);
    frame.SetMargin(new inkMargin(w * 0.5 - 17.0, 7.0, 0.0, 0.0));
    XFInkStyle.Bind(frame, n"MainColors.Blue");
    frame.Reparent(mark);
    let inner = new inkRectangle();
    inner.SetName(n"inner");
    inner.SetAnchor(inkEAnchor.TopLeft);
    inner.SetSize(new Vector2(27.0, 27.0));
    inner.SetRenderTransformPivot(new Vector2(0.5, 0.5));
    inner.SetRotation(45.0);
    inner.SetMargin(new inkMargin(w * 0.5 - 13.5, 10.5, 0.0, 0.0));
    inner.SetTintColor(new HDRColor(0.035, 0.035, 0.06, 1.0));
    inner.Reparent(mark);
    let tag = XFInkStyle.Text(n"mark", 18, n"Bold", n"MainColors.Blue", true);
    tag.SetText("XF");
    tag.SetAnchor(inkEAnchor.TopLeft);
    tag.SetFitToContent(false);
    tag.SetSize(new Vector2(w, 24.0));
    tag.SetMargin(new inkMargin(0.0, 12.0, 0.0, 0.0));
    tag.SetHorizontalAlignment(textHorizontalAlignment.Center);
    tag.Reparent(mark);
    let name = XFInkStyle.Text(n"label", 24, n"Semi-Bold", n"MainColors.Blue", true);
    name.SetAnchor(inkEAnchor.TopLeft);
    name.SetFitToContent(false);
    name.SetSize(new Vector2(w, 34.0));
    name.SetMargin(new inkMargin(0.0, 54.0, 0.0, 0.0));
    name.SetHorizontalAlignment(textHorizontalAlignment.Center);
    name.Reparent(mark);
  }

  public static func MarkLabel(mark: ref<inkCanvas>, label: String) -> Void {
    let text = mark.GetWidgetByPathName(n"label") as inkText;
    if IsDefined(text) {
      text.SetText(label);
    }
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

// Shared by every mappin controller's wrap below: our pin gets the badge (0.8: the game's icon stays as it is); any other
// mappin loses a badge an earlier XF pin left on a reused controller.
@addMethod(BaseMappinBaseController)
protected final func XFBridgeDecorate(showLabel: Bool, view: String) -> Bool {
  let entry = XFInkPins.Entry(this.GetMappin());
  if IsDefined(entry) {
    XFInkPins.Badge(this.GetRootCompoundWidget(), entry.label, showLabel);
    XFInkPins.NoteDrawn(entry, view);
    return true;
  }
  XFInkPins.Unbadge(this.GetRootCompoundWidget());
  return false;
}

// The world map.
@wrapMethod(BaseWorldMapMappinController)
protected func UpdateIcon() -> Void {
  wrappedMethod();
  this.XFBridgeDecorate(true, "world_map");
}

// The pin in the world (and its screen-edge clamp). 0.8: the game's name line stays and says the label (the badge's own
// label is off here, so it isn't said twice).
@wrapMethod(QuestMappinController)
protected func UpdateIcon() -> Void {
  wrappedMethod();
  let entry = XFInkPins.Entry(this.GetMappin());
  if IsDefined(entry) && inkWidgetRef.IsValid(this.displayName) {
    inkTextRef.SetText(this.displayName, entry.label);
    inkWidgetRef.SetVisible(this.displayName, true);
  }
  this.XFBridgeDecorate(!inkWidgetRef.IsValid(this.displayName), "world");
}

@wrapMethod(GameplayMappinController)
private func UpdateIcon() -> Void {
  wrappedMethod();
  this.XFBridgeDecorate(true, "world_gameplay");
}

// The minimap: the badge without its label.
@wrapMethod(MinimapPOIMappinController)
protected final func UpdateIcon() -> Void {
  wrappedMethod();
  this.XFBridgeDecorate(false, "minimap");
}

// The world map's tooltip names an XF pin.
@wrapMethod(WorldMapTooltipController)
public func SetData(const data: script_ref<WorldMapTooltipData>, menu: ref<WorldMapMenuGameController>) -> Void {
  wrappedMethod(data, menu);
  let entry = XFInkPins.Entry(Deref(data).mappin);
  if IsDefined(entry) {
    inkTextRef.SetText(this.m_titleText, entry.label);
    inkTextRef.SetText(this.m_descText, "Test pin from XF Studio. Stopping the bridge or loading a save removes it."); // 0.8.4: the UI review's fix 7
  }
}
