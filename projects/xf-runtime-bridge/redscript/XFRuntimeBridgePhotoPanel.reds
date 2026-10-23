// XF Runtime Bridge 0.8.6: the ink panel inside photo mode's menu (knowledge/photo-mode.md §15.6, the recommended route).
//
// While photo mode is open the game hides its HUD, and with it the HUD-layer ink panel, so 0.8.2 to 0.8.5 showed the XF box
// there instead. The maintainer's direction: the ink panel itself lives inside photo mode's menu, with the XF box as the
// fallback. This file is that panel: the same widgets as the HUD panel (XFInkPanel), filled from the same frame
// (XFBridge_Hud), on a layer of the bridge's own under the photo-mode menu controller's root, so it fades with the menu for
// the hide-UI key, photo_hud_hide and screenshots, and photo mode's own camera, keys and menu keep working around it.
//
// The route, from the five mods §15 read (Photo Mode UI Improvements and Advanced Pose Mod above all; credited in
// docs/community-credits.md), with their pitfalls designed out:
//   * Where: a Fill-anchored, non-interactive inkCanvas named xfPhotoLayer under gameuiPhotoModeMenuController's root
//     (GetRootCompoundWidget), built from the bridge's existing OnShow wrap and ENSURED, never rebuilt: the controller
//     outlives a photo-mode session, so the layer is looked up and reused (the ink_tree event says created or reused). Nothing
//     is built in OnInitialize. On a backward root (its first child draws on top) the layer is fronted once per open, never
//     per frame (two mods fronting every frame would trade places).
//   * Updates: from the controller's own OnUpdate (it runs only while photo mode's menu is live), reading the frame about five
//     times a second as the HUD overlay does; the plugin never calls in.
//   * The camera's mouse: over the panel, the camera must not take the mouse, so the panel sets the controller's own hover
//     block (m_IsHoverOver, OnHoverStateChanged, SetCursorContext Hover) as the vanilla menu area does, and clears it on
//     leaving unless the vanilla menu is hovered. It takes no hover while a mouse button is held (a camera drag crossing the
//     panel keeps turning: XFBridge_MouseHeld) or the menu is faded out, and takes it once the button is released.
//   * Clicks: an answer is clicked (OnRelease with the click action, then handled), and goes to the session's events as
//     ink_pointer; the answer keys still answer through XFAnswerKeys (Codeware's key callback).
//   * ui.hud's modal (research): pushes one ModalPopup game context while set, which holds off photo mode's own keys
//     [community]; one bool per push, popped when modal goes off, on OnHide, when photo mode is found closed and by a stop.
//   * Teardown on OnHide, a load (photo mode found closed, or the script gate shut) and the stop key (a stopped frame): the
//     hover block cleared, the context popped, the answers no longer clickable (ink_input says what was released). A stopped
//     bridge keeps showing its state here, like the HUD panel, as the one status surface.
//   * Nothing here touches photo mode's stand-ins, moves or hides a vanilla widget, or declares another plugin's natives.
//
// Events (XFBridge_InkEvent): ink_tree (on each open: the root's children in order and whether the layer was created or
// reused; once laid out: their rectangles, the root's width from a probe, the screen and the measured visible area),
// ink_pointer (hover taken, refused, replayed and left; answer clicks), ink_input (the hover block and ModalPopup taken and
// released, with the push and pop counts).

module XFRuntimeBridge

@addField(gameuiPhotoModeMenuController)
private let m_xfPhotoPanel: ref<XFPhotoMenuPanel>;

// Set once, the first time this controller shows the panel, so an ink_tree event says whether a later open (or one after a
// load) found the same controller.
@addField(gameuiPhotoModeMenuController)
private let m_xfPhotoSerial: Int32;

public class XFPhotoMenuPanel {
  private let m_controller: wref<gameuiPhotoModeMenuController>;
  private let m_layer: ref<inkCanvas>;
  private let m_view: ref<XFInkPanel>;
  private let m_probe: ref<inkCanvas>;
  private let m_frame: ref<XFHudFrame>;
  private let m_serial: Int32;
  private let m_opens: Int32;
  private let m_open: Bool;      // between OnShow and OnHide (or photo mode found closed)
  private let m_showing: Bool;   // the panel on screen: layer photo_menu, show, a valid frame
  private let m_killed: Bool;
  private let m_since: Float;
  private let m_frames: Int32;
  private let m_visible: Vector4;
  private let m_from: String;
  private let m_hoverCount: Int32; // pointer entries less exits, over the plate or an answer
  private let m_hoverTaken: Bool;
  private let m_hoverWaiting: Bool;
  private let m_menuHovered: Bool; // photo mode's own menu area is hovered (its own hover block)
  private let m_modalPushed: Bool;
  // The Sol review of 0.8.6: the session whose UI system took the ModalPopup push (the bridge's registry, one per game
  // session), so it is popped only in that session, and dropped, never popped against another, once that session has ended.
  private let m_modalSession: wref<XFBridgeRegistry>;
  // The Sol review: a press the panel accepted on an answer (the question's id and the answer), which only a release on that
  // same answer completes; cleared on leaving the answer, on hide, on a stop and when the question changes.
  private let m_pressAsk: Int32;
  private let m_pressChoice: Int32;
  private let m_pushes: Int32;
  private let m_pops: Int32;
  private let m_reported: Bool;

  // The panel of the photo mode open now, if it is on screen.
  public static func Current() -> ref<XFPhotoMenuPanel> {
    let controller = XFPhoto.Controller();
    if !IsDefined(controller) {
      return null;
    }
    return controller.XFBridgePhotoPanel();
  }

  // Whether the panel inside photo mode's menu is the ink panel now (the HUD overlay then leaves the report to it).
  public static func Live() -> Bool {
    let panel = XFPhotoMenuPanel.Current();
    return IsDefined(panel) && panel.IsShowing();
  }

  // The question it shows with its keys (XFAnswerKeys), or null.
  public static func DrawnAsk() -> ref<XFHudFrame> {
    let panel = XFPhotoMenuPanel.Current();
    if !IsDefined(panel) || !panel.IsShowing() || panel.IsKilled() {
      return null;
    }
    return panel.View().drawn;
  }

  public func IsShowing() -> Bool {
    return this.m_open && this.m_showing && IsDefined(this.m_view);
  }

  public func IsKilled() -> Bool {
    return this.m_killed;
  }

  public func View() -> ref<XFInkPanel> {
    return this.m_view;
  }

  public func SetMenuHovered(hovered: Bool) -> Void {
    this.m_menuHovered = hovered;
  }

  public func HoverTaken() -> Bool {
    return this.m_hoverTaken;
  }

  // ---- Opening and closing -------------------------------------------------------------------------------------------------

  // From OnShow, after the game's own: ensure the layer, front it once, read the frame, announce the tree.
  public func Show(controller: wref<gameuiPhotoModeMenuController>, serial: Int32) -> Void {
    this.m_controller = controller;
    this.m_serial = serial;
    this.m_opens += 1;
    let root = controller.GetRootCompoundWidget();
    if !IsDefined(root) {
      XFBridgeLog.Warn("ink", "photo-menu panel: photo mode's menu has no root widget; the XF box stays the status surface");
      return;
    }
    // Input still owed from an earlier open (one that ended while the scripts' gate was shut) goes back first.
    this.Settle();
    let created = this.Ensure(root);
    let index = this.Front(root);
    this.m_open = true;
    this.m_killed = false;
    this.m_since = 0.0;
    this.m_frames = 0;
    this.m_hoverCount = 0;
    this.m_hoverWaiting = false;
    this.m_menuHovered = false;
    this.ClearPress();
    let frame = XFHudFrame.Parse(XFBridge_Hud());
    if frame.valid {
      this.Apply(frame);
    } else {
      this.m_layer.SetVisible(false);
      this.m_showing = false;
    }
    this.Tree(root, created, index, false);
    if created {
      XFBridge_Announce("ink_photo", "panel attached under photo mode's menu serial=" + IntToString(serial));
    }
  }

  // OnHide, photo mode found closed, or the scripts' gate shut (a load): the layer hides and the panel stops answering at once;
  // the game input it holds goes back now if its session is live, else as soon as it is (Settle).
  public func Hide(why: String) -> Void {
    if !this.m_open {
      return;
    }
    this.Release(why);
    if IsDefined(this.m_layer) {
      this.m_layer.SetVisible(false);
    }
    this.m_open = false;
    this.m_showing = false;
    if this.m_reported {
      XFBridge_InkDrawn(0, false);
      this.m_reported = false;
    }
  }

  // The answers stop answering clicks (owned widgets and bookkeeping, always), and the camera's mouse and the ModalPopup context
  // go back (Settle: only while the owning session is live; otherwise they stay owed and Update or the next Show settles them).
  public func Release(why: String) -> Void {
    let hover = this.m_hoverTaken;
    let modal = this.m_modalPushed;
    this.ClearPress();
    this.m_hoverCount = 0;
    this.m_hoverWaiting = false;
    this.Interactive(false);
    this.Settle();
    if hover || modal || NotEquals(why, "hidden") {
      XFBridge_InkEvent("ink_input", "photo-menu panel released (" + why + ")",
        "{\"why\":" + XFJson.Str(why) + ",\"hover_released\":" + XFJson.Flag(hover && !this.m_hoverTaken) + ",\"modal_popped\":" + XFJson.Flag(modal && !this.m_modalPushed)
        + ",\"owed\":" + XFJson.Flag(this.m_hoverTaken || this.m_modalPushed) + ",\"pushes\":" + IntToString(this.m_pushes) + ",\"pops\":" + IntToString(this.m_pops) + "}");
    }
  }

  // Gives back the game input the panel holds, only while the game's scripts are live (the live guard): the hover block on its
  // controller, and the ModalPopup push in the session that took it. A push whose session has ended went with that session's
  // context stack, so it is dropped, never popped against the session now running. With the gate shut nothing is asked of the
  // game; the input stays owed.
  private func Settle() -> Void {
    if !this.m_hoverTaken && !this.m_modalPushed {
      return;
    }
    if !XFBridge_Live() {
      return;
    }
    if this.m_modalPushed {
      let owner: ref<XFBridgeRegistry> = this.m_modalSession;
      let now = XFBridgeRegistry.Get();
      if IsDefined(owner) && IsDefined(now) && owner == now {
        this.SetModal(false);
      } else {
        this.m_modalPushed = false;
        this.m_modalSession = null;
        XFBridge_InkEvent("ink_input", "photo-menu panel dropped a ModalPopup push whose session had ended",
          "{\"modal\":false,\"dropped\":true,\"pushes\":" + IntToString(this.m_pushes) + ",\"pops\":" + IntToString(this.m_pops) + "}");
      }
    }
    if this.m_hoverTaken {
      this.Block(false);
    }
  }

  private func ClearPress() -> Void {
    this.m_pressAsk = 0;
    this.m_pressChoice = -1;
  }

  // The layer under the root, found by name or built: answers whether it was built now.
  private func Ensure(root: ref<inkCompoundWidget>) -> Bool {
    let found: ref<inkWidget> = root.GetWidgetByPathName(n"xfPhotoLayer");
    let mine: ref<inkWidget> = this.m_layer;
    if IsDefined(mine) && IsDefined(found) && found == mine {
      return false;
    }
    // A layer of ours the field no longer holds (a script reload): taken down before a fresh one is built.
    if IsDefined(found) {
      root.RemoveChild(found);
    }
    let layer = new inkCanvas();
    layer.SetName(n"xfPhotoLayer");
    layer.SetAnchor(inkEAnchor.Fill);
    layer.SetInteractive(false);
    layer.Reparent(root);
    this.m_layer = layer;
    // §15.3: a 1 x 1 probe at the root's top right; where it is laid out gives the root's width (ink_tree, laid out).
    let probe = new inkCanvas();
    probe.SetName(n"xfPhotoProbe");
    probe.SetAnchor(inkEAnchor.TopRight);
    probe.SetSize(new Vector2(1.0, 1.0));
    probe.SetInteractive(false);
    probe.Reparent(layer);
    this.m_probe = probe;
    this.m_view = XFInkPanel.Create(layer, n"xfs_photo_panel");
    this.m_view.canvas.SetInteractive(true);
    let plate = this.m_view.Plate();
    plate.SetInteractive(true);
    plate.RegisterToCallback(n"OnHoverOver", this, n"OnXFHoverOver");
    plate.RegisterToCallback(n"OnHoverOut", this, n"OnXFHoverOut");
    let i = 0;
    while i < this.m_view.ChipCount() {
      let chip = this.m_view.Chip(i);
      chip.RegisterToCallback(n"OnHoverOver", this, n"OnXFChipHoverOver");
      chip.RegisterToCallback(n"OnHoverOut", this, n"OnXFChipHoverOut");
      chip.RegisterToCallback(n"OnPress", this, n"OnXFChipPress");
      chip.RegisterToCallback(n"OnRelease", this, n"OnXFChipRelease");
      i += 1;
    }
    this.Interactive(false);
    return true;
  }

  // Draw order: on a backward root the first child is on top, so the layer goes to index 0; on a forward one, last. Once per
  // open. Answers the layer's index after.
  private func Front(root: ref<inkCompoundWidget>) -> Int32 {
    let count = root.GetNumChildren();
    let backward = Equals(root.GetChildOrder(), inkEChildOrder.Backward);
    root.ReorderChild(this.m_layer, backward ? 0 : count - 1);
    let i = 0;
    while i < root.GetNumChildren() {
      let child: ref<inkWidget> = root.GetWidgetByIndex(i);
      let mine: ref<inkWidget> = this.m_layer;
      if child == mine {
        return i;
      }
      i += 1;
    }
    return -1;
  }

  private func Interactive(on: Bool) -> Void {
    if !IsDefined(this.m_view) {
      return;
    }
    this.m_view.Plate().SetInteractive(on);
    let i = 0;
    while i < this.m_view.ChipCount() {
      this.m_view.Chip(i).SetInteractive(on);
      i += 1;
    }
    if !on {
      this.m_view.SetHovered(-1);
    }
  }

  // ---- Every frame (the controller's OnUpdate) -------------------------------------------------------------------------------

  public func Update(timeDelta: Float) -> Void {
    if !this.m_open {
      // Input owed since a close while the gate was shut goes back once it is live again.
      this.Settle();
      return;
    }
    if !IsDefined(this.m_layer) {
      return;
    }
    // The live guard: nothing asked of the game once its scripts' gate is shut (a load): only the panel's own widgets and
    // bookkeeping are touched, and the input it holds stays owed (Settle).
    if !XFBridge_Live() {
      this.Hide("scripts_not_live");
      return;
    }
    // Photo mode closed without OnHide reaching here.
    if !XFPhoto.Active() {
      this.Hide("photo_mode_closed");
      return;
    }
    this.m_frames += 1;
    this.m_since += timeDelta;
    if this.m_since >= 0.2 {
      this.m_since = 0.0;
      let frame = XFHudFrame.Parse(XFBridge_Hud());
      if frame.valid {
        this.Apply(frame);
      }
    }
    this.UpdateHover();
    if this.m_frames == 30 {
      let root = this.m_controller.GetRootCompoundWidget();
      if IsDefined(root) {
        this.Tree(root, false, -1, true);
      }
    }
  }

  private func Apply(frame: ref<XFHudFrame>) -> Void {
    this.m_frame = frame;
    let wanted = frame.show && Equals(frame.layer, "photo_menu");
    let killed = Equals(frame.tone, "killed");
    if killed && !this.m_killed {
      this.Release("killed");
    }
    this.m_killed = killed;
    if !wanted && this.m_showing {
      this.Release("hidden");
    }
    this.m_showing = wanted;
    this.m_layer.SetVisible(wanted);
    // A press on an answer belongs to the question it was made on.
    if this.m_pressAsk > 0 && frame.askId != this.m_pressAsk {
      this.ClearPress();
    }
    if wanted {
      let root = this.m_controller.GetRootCompoundWidget();
      let size = root.GetSize();
      let width = size.X > 100.0 ? size.X : 3840.0;
      let height = size.Y > 100.0 ? size.Y : 2160.0;
      let units = height / 2160.0;
      let screen = XFInkStyle.ScreenSize();
      let measured = XFInkStyle.MeasureVisible(this.m_layer, screen, width, height);
      if measured.Z > 0.0 {
        this.m_visible = measured;
        this.m_from = "measured";
      } else {
        this.m_visible = new Vector4(0.0, 0.0, width, height);
        this.m_from = "root";
      }
      let scale = ClampF(frame.scale, 0.5, 3.0) * units;
      this.m_view.canvas.SetScale(new Vector2(scale, scale));
      this.m_view.SizePlate();
      this.m_view.Place(frame, scale, this.m_visible, units, false);
      this.m_view.Apply(frame, XFInkHost.Available());
      this.Interactive(!killed);
    }
    if wanted && frame.modal && !killed {
      this.SetModal(true);
    } else {
      if this.m_modalPushed {
        this.Settle();
      }
    }
    this.Report(frame, wanted);
  }

  // The surfaces' rule: while this panel is on screen it is the one status surface (the plugin's XFBridge_InkDrawn), with the
  // question its keys answer (only with Codeware, whose key callback answers them), else the answered one it shows.
  private func Report(frame: ref<XFHudFrame>, wanted: Bool) -> Void {
    if !wanted {
      if this.m_reported {
        XFBridge_InkDrawn(0, false);
        this.m_reported = false;
      }
      return;
    }
    let keysAsk = 0;
    if XFInkHost.Available() && !this.m_killed && IsDefined(this.m_view.drawn) {
      keysAsk = this.m_view.drawn.askId;
    }
    XFBridge_InkDrawn(keysAsk > 0 ? keysAsk : frame.answeredId, true);
    this.m_reported = true;
  }

  // ---- The camera's mouse ---------------------------------------------------------------------------------------------------

  private func Faded() -> Bool {
    let root = this.m_controller.GetRootCompoundWidget();
    return !IsDefined(root) || root.GetOpacity() < 0.1;
  }

  private func UpdateHover() -> Void {
    let wanted = this.m_hoverCount > 0 && this.m_showing && !this.m_killed;
    if wanted && !this.m_hoverTaken {
      if XFBridge_MouseHeld() || this.Faded() {
        if !this.m_hoverWaiting {
          this.m_hoverWaiting = true;
          this.Pointer("refused", XFBridge_MouseHeld() ? "a mouse button is held" : "the menu is faded out", -1);
        }
        return;
      }
      let replay = this.m_hoverWaiting;
      this.m_hoverWaiting = false;
      this.Block(true);
      this.Pointer(replay ? "replayed" : "taken", "", -1);
      return;
    }
    if this.m_hoverTaken && (!wanted || this.Faded()) {
      this.Block(false);
      // Faded under the pointer: the camera gets the mouse until the menu shows again.
      this.m_hoverWaiting = wanted;
      this.Pointer(wanted ? "released_faded" : "left", "", -1);
      return;
    }
    if !wanted {
      this.m_hoverWaiting = false;
    }
  }

  // Sets or clears the controller's hover block (the vanilla menu area's own bookkeeping, photoModeMenuController.script
  // OnMenuHovered and OnMenuHoverOut); never clears it while the vanilla menu area is hovered.
  private func Block(on: Bool) -> Void {
    if !IsDefined(this.m_controller) {
      this.m_hoverTaken = false;
      return;
    }
    if on {
      this.m_controller.XFBridgeHoverBlock(true);
      this.m_hoverTaken = true;
      XFBridge_InkEvent("ink_input", "photo-menu panel holds the camera's mouse", "{\"hover\":true}");
    } else {
      if !this.m_menuHovered {
        this.m_controller.XFBridgeHoverBlock(false);
      }
      this.m_hoverTaken = false;
      XFBridge_InkEvent("ink_input", "photo-menu panel gives the camera its mouse back", "{\"hover\":false,\"menu_hovered\":" + XFJson.Flag(this.m_menuHovered) + "}");
    }
  }

  // ui.hud's modal: one ModalPopup push at most, popped by exactly one pop, in the session that pushed it (Settle decides a
  // pop), and only while the scripts are live.
  private func SetModal(on: Bool) -> Void {
    if Equals(on, this.m_modalPushed) || !XFBridge_Live() {
      return;
    }
    let ui = GameInstance.GetUISystem(GetGameInstance());
    if !IsDefined(ui) {
      return;
    }
    if on {
      ui.PushGameContext(UIGameContext.ModalPopup);
      this.m_pushes += 1;
    } else {
      ui.PopGameContext(UIGameContext.ModalPopup);
      this.m_pops += 1;
    }
    this.m_modalPushed = on;
    if on {
      this.m_modalSession = XFBridgeRegistry.Get();
    } else {
      this.m_modalSession = null;
    }
    XFBridge_InkEvent("ink_input", on ? "photo-menu panel pushed ModalPopup" : "photo-menu panel popped ModalPopup",
      "{\"modal\":" + XFJson.Flag(on) + ",\"pushes\":" + IntToString(this.m_pushes) + ",\"pops\":" + IntToString(this.m_pops) + "}");
  }

  private func Pointer(what: String, why: String, choice: Int32) -> Void {
    let data = "{\"what\":" + XFJson.Str(what) + ",\"choice\":" + IntToString(choice) + ",\"menu_hovered\":" + XFJson.Flag(this.m_menuHovered);
    if NotEquals(why, "") {
      data += ",\"why\":" + XFJson.Str(why);
    }
    XFBridge_InkEvent("ink_pointer", "photo-menu panel: " + what, data + "}");
  }

  private func PointerAt(what: String, e: ref<inkPointerEvent>, choice: Int32, extra: String) -> Void {
    let at = e.GetScreenSpacePosition();
    let screen = XFInkStyle.ScreenSize();
    XFBridge_InkEvent("ink_pointer", "photo-menu panel: " + what,
      "{\"what\":" + XFJson.Str(what) + ",\"choice\":" + IntToString(choice) + ",\"screen_px\":[" + XFJson.Num(at.X) + "," + XFJson.Num(at.Y)
      + "],\"window\":[" + XFJson.Num(screen.X) + "," + XFJson.Num(screen.Y) + "]" + extra + "}");
  }

  protected cb func OnXFHoverOver(e: ref<inkPointerEvent>) -> Bool {
    this.m_hoverCount += 1;
    if this.m_hoverCount == 1 && this.m_open {
      this.PointerAt("enter", e, -1, "");
    }
    return false;
  }

  protected cb func OnXFHoverOut(e: ref<inkPointerEvent>) -> Bool {
    this.m_hoverCount = Max(0, this.m_hoverCount - 1);
    if this.m_hoverCount == 0 {
      this.ClearPress();
    }
    return false;
  }

  protected cb func OnXFChipHoverOver(e: ref<inkPointerEvent>) -> Bool {
    this.m_hoverCount += 1;
    if this.m_open && !this.m_killed && IsDefined(this.m_view) {
      this.m_view.SetHovered(this.m_view.ChipIndex(e.GetCurrentTarget()));
    }
    return false;
  }

  protected cb func OnXFChipHoverOut(e: ref<inkPointerEvent>) -> Bool {
    this.m_hoverCount = Max(0, this.m_hoverCount - 1);
    this.ClearPress(); // leaving the answer pressed abandons the click
    if IsDefined(this.m_view) {
      this.m_view.SetHovered(-1);
    }
    return false;
  }

  // The Sol review of 0.8.6: a click is a press and a release on the same answer. A press counts only on an answer of the
  // question shown while the panel holds the camera's mouse (so the pointer isn't driving the camera); a release that ends a
  // camera drag over an answer has no press of the panel's and does nothing.
  protected cb func OnXFChipPress(e: ref<inkPointerEvent>) -> Bool {
    this.ClearPress();
    if !e.IsAction(n"click") || !this.m_open || this.m_killed || !this.m_hoverTaken || !IsDefined(this.m_view) {
      return false;
    }
    let choice = this.m_view.ChipIndex(e.GetCurrentTarget());
    let frame = this.m_view.drawn;
    if choice < 0 || !IsDefined(frame) || frame.askId <= 0 {
      return false;
    }
    this.m_pressAsk = frame.askId;
    this.m_pressChoice = choice;
    return false;
  }

  // A click on an answer answers the question this panel shows (as the CET buttons answer the one their window shows).
  protected cb func OnXFChipRelease(e: ref<inkPointerEvent>) -> Bool {
    let pressAsk = this.m_pressAsk;
    let pressChoice = this.m_pressChoice;
    this.ClearPress();
    if !e.IsAction(n"click") || !this.m_open || this.m_killed || !IsDefined(this.m_view) {
      return false;
    }
    let choice = this.m_view.ChipIndex(e.GetCurrentTarget());
    let frame = this.m_view.drawn;
    if choice < 0 || !IsDefined(frame) || frame.askId <= 0 {
      return false;
    }
    if pressAsk != frame.askId || pressChoice != choice {
      this.PointerAt("release_ignored", e, choice, ",\"ask\":" + IntToString(frame.askId) + ",\"why\":\"no press of the panel's on this answer\"");
      return false;
    }
    e.Handle();
    let answer = XFBridge_Answer(frame.askId, choice, "photo_click");
    this.PointerAt("click", e, choice, ",\"ask\":" + IntToString(frame.askId) + ",\"answer\":" + answer);
    XFBridgeLog.Info("ink", "photo-menu answer clicked: choice " + IntToString(choice) + ": " + answer);
    return true;
  }

  // ---- What the agent sees: ink_tree ------------------------------------------------------------------------------------------

  // On each open: the root's draw order and children (name, visible, opacity), the layer's index and whether it was created.
  // Once laid out (30 frames later): each child's position and size in the root's units, the root's size and its width by the
  // probe, the screen, the visible area the panel used and where it came from, and the panel's and the root's rectangles in
  // window pixels (WidgetUtils.LocalToGlobal).
  private func Tree(root: ref<inkCompoundWidget>, created: Bool, index: Int32, laidOut: Bool) -> Void {
    let backward = Equals(root.GetChildOrder(), inkEChildOrder.Backward);
    let out = "{\"when\":" + XFJson.Str(laidOut ? "laid_out" : "show") + ",\"serial\":" + IntToString(this.m_serial) + ",\"opens\":" + IntToString(this.m_opens)
      + ",\"order\":" + XFJson.Str(backward ? "backward" : "forward");
    if !laidOut {
      out += ",\"created\":" + XFJson.Flag(created) + ",\"reused\":" + XFJson.Flag(!created) + ",\"layer_index\":" + IntToString(index);
    }
    out += ",\"children\":[";
    let count = root.GetNumChildren();
    let i = 0;
    while i < count && i < 24 {
      let child = root.GetWidgetByIndex(i);
      if IsDefined(child) {
        out += (i > 0 ? "," : "") + "{\"i\":" + IntToString(i) + ",\"name\":" + XFJson.Str(NameToString(child.GetName())) + ",\"visible\":" + XFJson.Flag(child.IsVisible())
          + ",\"opacity\":" + XFJson.Num(child.GetOpacity());
        if laidOut {
          let at = root.GetChildPosition(child);
          let size = root.GetChildSize(child);
          out += ",\"pos\":[" + XFJson.Num(at.X) + "," + XFJson.Num(at.Y) + "],\"size\":[" + XFJson.Num(size.X) + "," + XFJson.Num(size.Y) + "]";
        }
        out += "}";
      }
      i += 1;
    }
    out += "],\"count\":" + IntToString(count);
    if laidOut {
      let size = root.GetSize();
      let screen = XFInkStyle.ScreenSize();
      let probeX = 0.0;
      if IsDefined(this.m_probe) {
        let laid = this.m_layer.GetChildPosition(this.m_probe);
        probeX = laid.X + 1.0;
      }
      let topLeft = WidgetUtils.LocalToGlobal(root, new Vector2(0.0, 0.0));
      let bottomRight = WidgetUtils.LocalToGlobal(root, size);
      out += ",\"root_size\":[" + XFJson.Num(size.X) + "," + XFJson.Num(size.Y) + "],\"probe_width\":" + XFJson.Num(probeX)
        + ",\"root_px\":[" + XFJson.Num(topLeft.X) + "," + XFJson.Num(topLeft.Y) + "," + XFJson.Num(bottomRight.X) + "," + XFJson.Num(bottomRight.Y) + "]"
        + ",\"screen\":[" + XFJson.Num(screen.X) + "," + XFJson.Num(screen.Y) + "],\"visible\":[" + XFJson.Num(this.m_visible.X) + "," + XFJson.Num(this.m_visible.Y) + ","
        + XFJson.Num(this.m_visible.Z) + "," + XFJson.Num(this.m_visible.W) + "],\"visible_from\":" + XFJson.Str(this.m_from) + ",\"showing\":" + XFJson.Flag(this.m_showing);
      if IsDefined(this.m_view) && this.m_showing {
        let plate = this.m_view.Plate();
        let a = WidgetUtils.LocalToGlobal(plate, new Vector2(0.0, 0.0));
        let b = WidgetUtils.LocalToGlobal(plate, plate.GetSize());
        out += ",\"panel_px\":[" + XFJson.Num(a.X) + "," + XFJson.Num(a.Y) + "," + XFJson.Num(b.X) + "," + XFJson.Num(b.Y) + "]";
      }
    }
    out += "}";
    XFBridge_InkEvent("ink_tree", (laidOut ? "photo mode's menu laid out" : (created ? "photo-menu layer created" : "photo-menu layer reused")) + ", serial " + IntToString(this.m_serial), out);
  }
}

// ---- The controller's side --------------------------------------------------------------------------------------------------

@addMethod(gameuiPhotoModeMenuController)
public func XFBridgePhotoPanel() -> ref<XFPhotoMenuPanel> {
  return this.m_xfPhotoPanel;
}

// From the OnShow wrap (XFRuntimeBridgeActions.reds), after the game's own OnShow.
@addMethod(gameuiPhotoModeMenuController)
public func XFBridgePhotoPanelShow() -> Void {
  if this.m_xfPhotoSerial == 0 {
    this.m_xfPhotoSerial = RandRange(100000, 999999);
  }
  if !IsDefined(this.m_xfPhotoPanel) {
    this.m_xfPhotoPanel = new XFPhotoMenuPanel();
  }
  this.m_xfPhotoPanel.Show(this, this.m_xfPhotoSerial);
}

// From the OnHide wrap, before the game's own OnHide.
@addMethod(gameuiPhotoModeMenuController)
public func XFBridgePhotoPanelHide() -> Void {
  if IsDefined(this.m_xfPhotoPanel) {
    this.m_xfPhotoPanel.Hide("photo_mode_closing");
  }
}

// The vanilla menu area's hover block, set or cleared the way its own OnMenuHovered and OnMenuHoverOut do.
@addMethod(gameuiPhotoModeMenuController)
public func XFBridgeHoverBlock(on: Bool) -> Void {
  if on {
    if !this.m_IsHoverOver {
      this.OnHoverStateChanged(true);
      this.SetCursorContext(n"Hover");
    }
    this.m_IsHoverOver = true;
  } else {
    if this.m_IsHoverOver {
      this.OnHoverStateChanged(false);
      this.SetCursorContext(n"Default");
    }
    this.m_IsHoverOver = false;
  }
}

@wrapMethod(gameuiPhotoModeMenuController)
protected cb func OnUpdate(timeDelta: Float) -> Bool {
  let result = wrappedMethod(timeDelta);
  if IsDefined(this.m_xfPhotoPanel) {
    this.m_xfPhotoPanel.Update(timeDelta);
  }
  return result;
}

// The vanilla menu area's hover: noted, so the panel never clears a block the menu set; the game's own handling is unchanged.
@wrapMethod(gameuiPhotoModeMenuController)
protected cb func OnMenuHovered(e: ref<inkPointerEvent>) -> Bool {
  let result = wrappedMethod(e);
  if IsDefined(this.m_xfPhotoPanel) {
    this.m_xfPhotoPanel.SetMenuHovered(true);
  }
  return result;
}

// Leaving the vanilla menu area clears the block; while the pointer is on the XF panel, the block is set again at once.
@wrapMethod(gameuiPhotoModeMenuController)
protected cb func OnMenuHoverOut(e: ref<inkPointerEvent>) -> Bool {
  let result = wrappedMethod(e);
  if IsDefined(this.m_xfPhotoPanel) {
    this.m_xfPhotoPanel.SetMenuHovered(false);
    if this.m_xfPhotoPanel.HoverTaken() {
      this.XFBridgeHoverBlock(true);
    }
  }
  return result;
}
