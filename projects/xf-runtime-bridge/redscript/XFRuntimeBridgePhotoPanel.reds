// XF Runtime Bridge 0.8.7 (0.8.6's panel): the ink panel inside photo mode's menu (knowledge/photo-mode.md §15.6, the
// recommended route).
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
//   * Clicks: a press and a release of the left button on the same answer (0.8.6, the Sol review: a release alone also ends a
//     camera drag). 0.8.7 (session 14's P5: every release logged release_ignored and no press was ever accepted, while the
//     hover block was held at every release): photo mode's input context maps the left button to click (PhotoMode_Click) and
//     to PhotoMode_CameraMouseMove, and photo mode's own sticker layer reads a press as PhotoMode_CameraMouseMove, never click
//     (photoModeStickersController.script:161; r6/config/inputContexts.xml, context PhotoModeUI), so 0.8.6's press test asked
//     for the wrong action. A press now counts as either, on the answer's own OnPress or, should that never arrive, on the
//     controller's global OnPostOnPress with the answer under the pointer; a release on the same answer completes it (its own
//     OnRelease or the global OnPostOnRelease, whichever comes first), and a release anywhere else abandons it. Each press
//     says its route and its actions (ink_pointer press), so session 15 shows which one the game used. The answer keys still
//     answer through XFAnswerKeys (Codeware's key callback).
//   * ui.hud's modal: 0.8.6 pushed the ModalPopup game context, which session 14 proved holds off neither photo mode's camera
//     keys (P8) nor its exit (P9). 0.8.7: photo mode's exit is a script callback (the ExitPhotoMode action reaches the
//     controller's OnTryExitPhotomode, photoModeMenuController.script:213, which shows "Exit photo mode?"), so modal holds it
//     there and nowhere else: while modal is on and the panel is live, OnTryExitPhotomode does nothing (ink_input
//     exit_held). Nothing is taken from the game, so nothing is owed back on any exit path, and the bridge's own photo_exit
//     (OnExitConfirmed) is unaffected. Photo mode's camera reads its movement axes natively from the same context
//     (PhotoMode_CameraMovementX/Y; no script listener moves the camera), so no contained route holds them: ui_hud's
//     modal_note says so, and the camera keys keep working.
//   * Safe zones (0.8.7, session 14's P11: bottom_left sat on photo mode's control hints): the panel keeps out of photo mode's
//     menu, its top bar and its hint strips, measured from the controller's own widgets each time the frame is read
//     (XFBridgeZones); the laid-out ink_tree event reports the zones and where the panel went.
//   * Teardown on OnHide, a load (photo mode found closed, or the script gate shut) and the stop key (a stopped frame): the
//     hover block cleared, the global input callbacks unregistered, the answers no longer clickable (ink_input says what was
//     released). A stopped bridge keeps showing its state here, like the HUD panel, as the one status surface.
//   * Nothing here touches photo mode's stand-ins, moves or hides a vanilla widget, or declares another plugin's natives.
//
// Events (XFBridge_InkEvent): ink_tree (on each open: the root's children in order and whether the layer was created or
// reused; once laid out: their rectangles, the root's width from a probe, the screen, the measured visible area, photo mode's
// zones and the panel's rectangle), ink_pointer (hover taken, refused, replayed and left; presses with their route and
// actions; clicks and ignored releases), ink_input (the hover block taken and released; photo mode's exit held by modal).

module XFRuntimeBridge

@addField(gameuiPhotoModeMenuController)
private let m_xfPhotoPanel: ref<XFPhotoMenuPanel>;

// Set once, the first time this controller shows the panel, so an ink_tree event says whether a later open (or one after a
// load) found the same controller.
@addField(gameuiPhotoModeMenuController)
private let m_xfPhotoSerial: Int32;

@addField(gameuiPhotoModeMenuController)
private let m_xfInputGeneration: Int32;

@addField(gameuiPhotoModeMenuController)
private let m_xfInputShown: Bool;

@addField(gameuiPhotoModeMenuController)
private let m_xfInputConfirmation: Bool;

// Read-only observations from the existing controller owner. No token is created or cleared here.
@addMethod(gameuiPhotoModeMenuController)
public func XFBridgeInputPhotoObserve(stage: String) -> Void {
  if !XFBridge_Live() || (XFBridge_ProbeFlags() & 8) == 0 { return; }
  let confirmation = IsDefined(this.m_exitConfirmationToken);
  if NotEquals(stage, "update") {
    XFBridge_Event("input.photo." + stage, "{\"generation\":" + IntToString(this.m_xfInputGeneration) + ",\"shown\":" + XFJson.Flag(this.m_xfInputShown) + ",\"changed\":" + XFJson.Flag(this.m_anyOptionChanged) + ",\"confirmation\":" + XFJson.Flag(confirmation) + "}");
  }
  if (confirmation && !this.m_xfInputConfirmation) || (!confirmation && this.m_xfInputConfirmation) {
    this.m_xfInputConfirmation = confirmation;
    XFBridge_Event("input.photo.confirmation", "{\"generation\":" + IntToString(this.m_xfInputGeneration) + ",\"confirmation\":" + XFJson.Flag(confirmation) + ",\"observed_at\":" + XFJson.Str(stage) + "}");
  }
}

@addMethod(gameuiPhotoModeMenuController)
public func XFBridgeInputPhotoReady(generation: Int32) -> Bool {
  return XFBridge_Live() && this.m_xfInputShown && this.m_xfInputGeneration == generation;
}

@addMethod(gameuiPhotoModeMenuController)
public func XFBridgeInputPhotoState() -> String {
  return "{\"ok\":true,\"shown\":" + XFJson.Flag(this.m_xfInputShown) + ",\"generation\":" + IntToString(this.m_xfInputGeneration) + ",\"changed\":" + XFJson.Flag(this.m_anyOptionChanged) + ",\"confirmation\":" + XFJson.Flag(IsDefined(this.m_exitConfirmationToken)) + "}";
}

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
  // The Sol review: a press the panel accepted on an answer (the question's id and the answer), which only a release on that
  // same answer completes; cleared by a release anywhere else, on hide, on a stop and when the question changes.
  private let m_pressAsk: Int32;
  private let m_pressChoice: Int32;
  // 0.8.7: the frame of the last click, so the other route of the same release (the answer's OnRelease and the global
  // OnPostOnRelease both see it) stays quiet.
  private let m_clickedFrame: Int32;
  // 0.8.7: the controller's global press and release callbacks are registered (from Show to Hide).
  private let m_global: Bool;
  // 0.8.7: how often modal held photo mode's exit in this open.
  private let m_exitHolds: Int32;
  // 0.8.11: how long the note about a held Esc stays on the panel.
  private let m_heldFor: Float;
  // 0.8.7: photo mode's zones the panel keeps out of (layer units: left, top, width, height), their names, and where the
  // panel went.
  private let m_zones: array<Vector4>;
  private let m_zoneNames: array<String>;
  // 0.8.9: how the zone rule placed the panel ("kept", "nudged", "corner:<name>" or "overlapping"), for the laid-out event.
  private let m_zoneHow: String;
  private let m_placed: Vector4;
  private let m_reported: Bool;
  // 0.8.7 (the Sol review, finding 3): the plugin's frame couldn't be read; the panel holds nothing until a valid one arrives.
  private let m_frameBad: Bool;

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

  // The left button in photo mode: its input context maps it to click and to PhotoMode_CameraMouseMove (both priority -1),
  // and a press arrives as the camera action (see the file's head).
  public static func LeftButton(e: ref<inkPointerEvent>) -> Bool {
    return e.IsAction(n"click") || e.IsAction(n"PhotoMode_CameraMouseMove");
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

  // 0.8.7, ui.hud's modal: whether photo mode's exit is held now (the controller's OnTryExitPhotomode wrap asks); when it is,
  // it says so. Only while the panel shows and the scripts are live, and (the Sol review, finding 3) on a frame read at this
  // moment: modal set, the panel on photo mode's menu, the bridge not stopped. A frame that can't be read lets the exit work
  // (fail open), and the stop key reaches the veto at once rather than with the next frame.
  public func HoldExit() -> Bool {
    if !this.m_open || !this.m_showing || this.m_frameBad || !XFBridge_Live() {
      return false;
    }
    let now = XFHudFrame.Parse(XFBridge_Hud());
    if !now.valid || !now.modal || !now.show || !Equals(now.layer, "photo_menu") || Equals(now.tone, "killed") {
      return false;
    }
    // 0.8.11 (UI review of 0.8.11, fix 3): only while a question is waiting for its answer; with none, Esc leaves as always.
    if now.askId <= 0 || ArraySize(now.askKeys) == 0 {
      return false;
    }
    this.m_exitHolds += 1;
    XFBridge_InkEvent("ink_input", "photo-menu panel held photo mode's exit (ui_hud modal)",
      "{\"exit_held\":true,\"holds\":" + IntToString(this.m_exitHolds) + "}");
    // A key that does nothing looks like a glitch: the answers flash and the line under them says why.
    if IsDefined(this.m_view) {
      this.m_view.Flash();
      this.m_view.ShowHint(this.HeldText());
      this.m_heldFor = 4.0;
    }
    return true;
  }

  // What the held Esc says: the bridge's real stop key where it has one.
  private func HeldText() -> String {
    let text = XFBridge_KillKey("get", "");
    let label = StrBeforeFirst(StrAfterFirst(text, "\"label\":\""), "\"");
    if StrContains(text, "\"enabled\":true") && StrLen(label) > 0 {
      return "Answer first, or press " + label + " to stop the bridge";
    }
    return "Answer first, or stop the bridge in the XF Runtime Bridge window (open the CET overlay)";
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
    this.m_view.ReserveHint();
    this.m_view.ShowHint("");
    let index = this.Front(root);
    this.m_open = true;
    this.m_killed = false;
    this.m_since = 0.0;
    this.m_frames = 0;
    this.m_clickedFrame = -1;
    this.m_hoverCount = 0;
    this.m_hoverWaiting = false;
    this.m_menuHovered = false;
    this.m_exitHolds = 0;
    this.m_heldFor = 0.0;
    this.ClearPress();
    this.Listen(true);
    let frame = XFHudFrame.Parse(XFBridge_Hud());
    this.m_frameBad = !frame.valid;
    if frame.valid {
      this.Apply(frame);
    } else {
      this.m_frame = null;
      this.m_layer.SetVisible(false);
      this.m_showing = false;
      this.Interactive(false);
      this.Listen(false);
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

  // The answers stop answering clicks (owned widgets and bookkeeping, always), the global input callbacks go, and the camera's
  // mouse goes back (Settle: only while the scripts are live; otherwise it stays owed and Update or the next Show settles it).
  // 0.8.7: modal takes nothing from the game (it answers OnTryExitPhotomode), so nothing of it is owed.
  public func Release(why: String) -> Void {
    let hover = this.m_hoverTaken;
    this.ClearPress();
    this.m_hoverCount = 0;
    this.m_hoverWaiting = false;
    this.Interactive(false);
    this.Listen(false);
    this.Settle();
    if hover || NotEquals(why, "hidden") {
      XFBridge_InkEvent("ink_input", "photo-menu panel released (" + why + ")",
        "{\"why\":" + XFJson.Str(why) + ",\"hover_released\":" + XFJson.Flag(hover && !this.m_hoverTaken) + ",\"owed\":" + XFJson.Flag(this.m_hoverTaken)
        + ",\"exit_holds\":" + IntToString(this.m_exitHolds) + "}");
    }
  }

  // Gives back the camera's mouse (the hover block on its controller), only while the game's scripts are live (the live
  // guard). With the gate shut nothing is asked of the game; the block stays owed.
  private func Settle() -> Void {
    if !this.m_hoverTaken || !XFBridge_Live() {
      return;
    }
    this.Block(false);
  }

  // 0.8.7: the controller's global press and release callbacks (as photo mode's own sticker layer and the two studied mods
  // register them), from Show to Hide. Registering touches only the controller's own callback list.
  private func Listen(on: Bool) -> Void {
    if !IsDefined(this.m_controller) {
      this.m_global = false;
      return;
    }
    if Equals(on, this.m_global) {
      return;
    }
    if on {
      this.m_controller.RegisterToGlobalInputCallback(n"OnPostOnPress", this, n"OnXFGlobalPress");
      this.m_controller.RegisterToGlobalInputCallback(n"OnPostOnRelease", this, n"OnXFGlobalRelease");
    } else {
      this.m_controller.UnregisterFromGlobalInputCallback(n"OnPostOnPress", this, n"OnXFGlobalPress");
      this.m_controller.UnregisterFromGlobalInputCallback(n"OnPostOnRelease", this, n"OnXFGlobalRelease");
    }
    this.m_global = on;
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
    this.m_view.Step(timeDelta);
    if this.m_heldFor > 0.0 {
      this.m_heldFor -= timeDelta;
      if this.m_heldFor <= 0.0 {
        this.m_view.ShowHint("");
      }
    }
    if this.m_since >= 0.2 {
      this.m_since = 0.0;
      let frame = XFHudFrame.Parse(XFBridge_Hud());
      if frame.valid {
        if this.m_frameBad {
          this.m_frameBad = false;
          XFBridge_InkEvent("ink_input", "photo-menu panel: the bridge's frame reads again", "{\"frame\":\"valid\"}");
        }
        this.Apply(frame);
      } else {
        this.FrameLost();
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

  // 0.8.7 (the Sol review, finding 3): the plugin's frame can't be read (XFBridge_Hud failed). Fail open: the last frame's modal
  // and stop state are forgotten, the press is dropped, the answers stop taking clicks and the camera gets the mouse back,
  // until a valid frame arrives (Apply then gives the panel back its input).
  private func FrameLost() -> Void {
    if this.m_frameBad {
      return;
    }
    this.m_frameBad = true;
    this.m_frame = null;
    this.Release("frame_invalid");
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
      let placed = this.m_view.Place(frame, scale, this.m_visible, units, false);
      // Out of photo mode's menu, top bar and hint strips. UI-221 fix 4: Avoid limits a slide to one panel width,
      // then tries the first free corner, so bottom_right cannot drift across the scene.
      this.MeasureZones();
      let how: String;
      let kept = XFInkStyle.Avoid(placed, this.m_zones, this.m_visible, 24.0 * units, frame.anchor, how);
      this.m_zoneHow = how;
      if kept.X != placed.X || kept.Y != placed.Y {
        this.m_view.MoveTo(kept.X, kept.Y);
      }
      this.m_placed = kept;
      this.m_view.SetWhere(""); // 0.8.11: the default layer shows just "test" (XFInkWhere)
      this.m_view.Apply(frame, XFInkHost.Available());
      if !killed && !this.m_global {
        this.Listen(true);
      }
      this.Interactive(!killed);
    }
    this.Report(frame, wanted);
  }

  // 0.8.7: photo mode's own blocks, in the layer's units: its menu (both list areas), its top bar (the tab buttons and the
  // tab's title) and its hint strips (the bottom row and the exit and screenshot hints), each only while it is visible.
  private func MeasureZones() -> Void {
    ArrayClear(this.m_zones);
    ArrayClear(this.m_zoneNames);
    if !IsDefined(this.m_controller) || !IsDefined(this.m_layer) {
      return;
    }
    let widgets: array<wref<inkWidget>>;
    let names: array<String>;
    this.m_controller.XFBridgeZones(widgets, names);
    let i = 0;
    while i < ArraySize(widgets) {
      let w = widgets[i];
      if IsDefined(w) && w.IsVisible() && w.GetOpacity() > 0.05 {
        let a = WidgetUtils.LocalToGlobal(w, new Vector2(0.0, 0.0));
        let b = WidgetUtils.LocalToGlobal(w, w.GetSize());
        let la = WidgetUtils.GlobalToLocal(this.m_layer, a);
        let lb = WidgetUtils.GlobalToLocal(this.m_layer, b);
        let zw = lb.X - la.X;
        let zh = lb.Y - la.Y;
        if zw > 2.0 && zh > 2.0 {
          // 0.8.9: widgets under one name make one zone, their union (the title row is its icon and its words; the top bar
          // is each tab button).
          let at = -1;
          let k = 0;
          while k < ArraySize(this.m_zoneNames) {
            if Equals(this.m_zoneNames[k], names[i]) {
              at = k;
            }
            k += 1;
          }
          if at < 0 {
            ArrayPush(this.m_zones, new Vector4(la.X, la.Y, zw, zh));
            ArrayPush(this.m_zoneNames, names[i]);
          } else {
            let u = this.m_zones[at];
            let x0 = MinF(u.X, la.X);
            let y0 = MinF(u.Y, la.Y);
            let x1 = MaxF(u.X + u.Z, la.X + zw);
            let y1 = MaxF(u.Y + u.W, la.Y + zh);
            this.m_zones[at] = new Vector4(x0, y0, x1 - x0, y1 - y0);
          }
        }
      }
      i += 1;
    }
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
    let wanted = this.m_hoverCount > 0 && this.m_showing && !this.m_killed && !this.m_frameBad;
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
      // 0.8.7 (the Sol review, finding 4): a press made while the panel held the mouse ends with that hold; once the camera has
      // the mouse, coming back over the answer and letting go answers nothing.
      this.ClearPress();
      XFBridge_InkEvent("ink_input", "photo-menu panel gives the camera its mouse back", "{\"hover\":false,\"menu_hovered\":" + XFJson.Flag(this.m_menuHovered) + "}");
    }
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

  // Which of the left button's actions an event carries, for the log.
  private static func Actions(e: ref<inkPointerEvent>) -> String {
    return ",\"click\":" + XFJson.Flag(e.IsAction(n"click")) + ",\"camera_move\":" + XFJson.Flag(e.IsAction(n"PhotoMode_CameraMouseMove"));
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
    if IsDefined(this.m_view) {
      this.m_view.SetHovered(-1);
    }
    return false;
  }

  // ---- Clicks: a press and a release of the left button on the same answer -------------------------------------------------

  // A press counts only on an answer of the question shown, while the panel holds the camera's mouse (so the pointer isn't
  // driving the camera). Either route may arm it; the second one for the same press finds it armed.
  private func Arm(e: ref<inkPointerEvent>, choice: Int32, route: String) -> Void {
    if !this.m_open || this.m_killed || !IsDefined(this.m_view) || choice < 0 {
      return;
    }
    let frame = this.m_view.drawn;
    if !IsDefined(frame) || frame.askId <= 0 {
      return;
    }
    if !this.m_hoverTaken {
      this.PointerAt("press_refused", e, choice, ",\"route\":" + XFJson.Str(route) + ",\"why\":\"the panel doesn't hold the camera's mouse\"" + XFPhotoMenuPanel.Actions(e));
      return;
    }
    if this.m_pressAsk == frame.askId && this.m_pressChoice == choice {
      return;
    }
    this.m_pressAsk = frame.askId;
    this.m_pressChoice = choice;
    this.PointerAt("press", e, choice, ",\"ask\":" + IntToString(frame.askId) + ",\"route\":" + XFJson.Str(route) + XFPhotoMenuPanel.Actions(e));
  }

  // A release on the pressed answer answers the question this panel shows (as the CET buttons answer the one their window
  // shows); a release on another answer, or one with no press of the panel's (the end of a camera drag), does nothing.
  private func Complete(e: ref<inkPointerEvent>, choice: Int32, route: String) -> Bool {
    let pressAsk = this.m_pressAsk;
    let pressChoice = this.m_pressChoice;
    this.ClearPress();
    if !this.m_open || this.m_killed || !IsDefined(this.m_view) || choice < 0 {
      return false;
    }
    let frame = this.m_view.drawn;
    if !IsDefined(frame) || frame.askId <= 0 {
      return false;
    }
    if pressAsk == 0 && this.m_clickedFrame == this.m_frames {
      return false; // the other route of the same release already answered
    }
    if !this.m_hoverTaken {
      this.PointerAt("release_ignored", e, choice, ",\"ask\":" + IntToString(frame.askId) + ",\"route\":" + XFJson.Str(route)
        + ",\"why\":\"the panel doesn't hold the camera's mouse\"" + XFPhotoMenuPanel.Actions(e));
      return false;
    }
    if pressAsk != frame.askId || pressChoice != choice {
      this.PointerAt("release_ignored", e, choice, ",\"ask\":" + IntToString(frame.askId) + ",\"route\":" + XFJson.Str(route)
        + ",\"why\":" + XFJson.Str(pressAsk == 0 ? "no press of the panel's on this answer" : "pressed on another answer") + XFPhotoMenuPanel.Actions(e));
      return false;
    }
    this.m_clickedFrame = this.m_frames;
    let answer = XFBridge_Answer(frame.askId, choice, "photo_click");
    this.PointerAt("click", e, choice, ",\"ask\":" + IntToString(frame.askId) + ",\"route\":" + XFJson.Str(route) + ",\"answer\":" + answer);
    XFBridgeLog.Info("ink", "photo-menu answer clicked: choice " + IntToString(choice) + " (" + route + "): " + answer);
    return true;
  }

  protected cb func OnXFChipPress(e: ref<inkPointerEvent>) -> Bool {
    if !XFPhotoMenuPanel.LeftButton(e) || !IsDefined(this.m_view) {
      return false;
    }
    this.Arm(e, this.m_view.ChipIndex(e.GetCurrentTarget()), "answer");
    return false;
  }

  protected cb func OnXFChipRelease(e: ref<inkPointerEvent>) -> Bool {
    if !XFPhotoMenuPanel.LeftButton(e) || !IsDefined(this.m_view) {
      return false;
    }
    if this.Complete(e, this.m_view.ChipIndex(e.GetCurrentTarget()), "answer") {
      e.Handle();
      return true;
    }
    return false;
  }

  // The controller's global callbacks: a press over an answer arms it should the answer's own OnPress not arrive; a release
  // completes it over the pressed answer (should the answer's own OnRelease not come first) and abandons it anywhere else.
  protected cb func OnXFGlobalPress(e: ref<inkPointerEvent>) -> Bool {
    if this.m_open && IsDefined(this.m_view) && XFPhotoMenuPanel.LeftButton(e) {
      let hovered = this.m_view.Hovered();
      if hovered >= 0 {
        this.Arm(e, hovered, "global");
      }
    }
    return false;
  }

  protected cb func OnXFGlobalRelease(e: ref<inkPointerEvent>) -> Bool {
    if !this.m_open || !IsDefined(this.m_view) || !XFPhotoMenuPanel.LeftButton(e) || this.m_pressAsk == 0 {
      return false;
    }
    let hovered = this.m_view.Hovered();
    if hovered == this.m_pressChoice {
      this.Complete(e, hovered, "global");
    } else {
      this.PointerAt("press_abandoned", e, this.m_pressChoice, ",\"released_over\":" + IntToString(hovered));
      this.ClearPress();
    }
    return false;
  }

  // ---- What the agent sees: ink_tree ------------------------------------------------------------------------------------------

  // On each open: the root's draw order and children (name, visible, opacity), the layer's index and whether it was created.
  // Once laid out (30 frames later): each child's position and size in the root's units, the root's size and its width by the
  // probe, the screen, the visible area the panel used and where it came from, photo mode's zones and the panel's rectangle
  // in the layer's units, and the panel's and the root's rectangles in window pixels (WidgetUtils.LocalToGlobal).
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
      out += ",\"zones\":[";
      let z = 0;
      while z < ArraySize(this.m_zones) {
        let r = this.m_zones[z];
        out += (z > 0 ? "," : "") + "{\"name\":" + XFJson.Str(this.m_zoneNames[z]) + ",\"rect\":[" + XFJson.Num(r.X) + "," + XFJson.Num(r.Y) + "," + XFJson.Num(r.Z) + "," + XFJson.Num(r.W) + "]}";
        z += 1;
      }
      out += "],\"zone_rule\":" + XFJson.Str(this.m_zoneHow) + ",\"panel_rect\":[" + XFJson.Num(this.m_placed.X) + "," + XFJson.Num(this.m_placed.Y) + "," + XFJson.Num(this.m_placed.Z) + "," + XFJson.Num(this.m_placed.W) + "]";
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
  if this.m_xfInputGeneration == 0 { this.m_xfInputGeneration = RandRange(100000, 999999); }
  this.m_xfInputGeneration += 1;
  this.m_xfInputShown = true;
  this.XFBridgeInputPhotoObserve("show");
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
  this.m_xfInputShown = false;
  this.XFBridgeInputPhotoObserve("hide");
  if IsDefined(this.m_xfPhotoPanel) {
    this.m_xfPhotoPanel.Hide("photo_mode_closing");
  }
}

// 0.8.7: photo mode's own blocks for the panel's safe zones, read from the controller's widget references (read only): the
// two list areas of its menu, its top bar (the tab buttons and the tab's title) and its hint strips.
@addMethod(gameuiPhotoModeMenuController)
public func XFBridgeZones(out widgets: array<wref<inkWidget>>, out names: array<String>) -> Void {
  ArrayPush(widgets, inkWidgetRef.Get(this.m_menuArea));
  ArrayPush(names, "menu");
  ArrayPush(widgets, inkWidgetRef.Get(this.m_additionalMenuArea));
  ArrayPush(names, "menu_more");
  ArrayPush(widgets, inkWidgetRef.Get(this.m_radioButtons));
  ArrayPush(names, "top_bar");
  // 0.8.9 (session 15's A5: the compound measured nothing, so no top_bar zone): each tab button as well.
  let topBar = inkWidgetRef.GetController(this.m_radioButtons) as PhotoModeTopBarController;
  if IsDefined(topBar) {
    topBar.XFBridgeToggles(widgets, names);
  }
  // 0.8.9 (session 15's A5: the words alone left the category icon, the "V" of POSE, uncovered): the whole title row.
  ArrayPush(widgets, inkWidgetRef.Get(this.m_tabTitleIcon));
  ArrayPush(names, "top_bar_title");
  ArrayPush(widgets, inkWidgetRef.Get(this.m_tabTitleText));
  ArrayPush(names, "top_bar_title");
  ArrayPush(widgets, inkWidgetRef.Get(this.m_inputBottomRoot));
  ArrayPush(names, "hints");
  ArrayPush(widgets, inkWidgetRef.Get(this.m_inputExit));
  ArrayPush(names, "hint_exit");
  ArrayPush(widgets, inkWidgetRef.Get(this.m_inputScreenshot));
  ArrayPush(names, "hint_screenshot");
}

// 0.8.9: the top bar's tab buttons (read only), one top_bar zone between them.
@addMethod(PhotoModeTopBarController)
public func XFBridgeToggles(out widgets: array<wref<inkWidget>>, out names: array<String>) -> Void {
  let i = 0;
  while i < ArraySize(this.m_photoModeTogglesArray) {
    ArrayPush(widgets, inkWidgetRef.Get(this.m_photoModeTogglesArray[i]));
    ArrayPush(names, "top_bar");
    i += 1;
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
  this.XFBridgeInputPhotoObserve("update");
  if IsDefined(this.m_xfPhotoPanel) {
    this.m_xfPhotoPanel.Update(timeDelta);
  }
  return result;
}

// 0.8.7, ui.hud's modal: photo mode's exit (Esc, the ExitPhotoMode action) is held while modal is on and the panel is live;
// otherwise the game's own handling runs unchanged.
@wrapMethod(gameuiPhotoModeMenuController)
protected cb func OnTryExitPhotomode() -> Bool {
  this.XFBridgeInputPhotoObserve("entry");
  let held = IsDefined(this.m_xfPhotoPanel) && this.m_xfPhotoPanel.HoldExit();
  if held {
    this.XFBridgeInputPhotoObserve("held");
    if XFBridge_Live() && (XFBridge_ProbeFlags() & 8) != 0 {
      XFBridge_Event("input.photo.callback", "{\"generation\":" + IntToString(this.m_xfInputGeneration) + ",\"held\":true,\"changed\":" + XFJson.Flag(this.m_anyOptionChanged) + ",\"confirmation\":" + XFJson.Flag(IsDefined(this.m_exitConfirmationToken)) + "}");
    }
    return false;
  }
  let result = wrappedMethod();
  this.XFBridgeInputPhotoObserve("return");
  if XFBridge_Live() && (XFBridge_ProbeFlags() & 8) != 0 {
    XFBridge_Event("input.photo.callback", "{\"generation\":" + IntToString(this.m_xfInputGeneration) + ",\"held\":false,\"changed\":" + XFJson.Flag(this.m_anyOptionChanged) + ",\"confirmation\":" + XFJson.Flag(IsDefined(this.m_exitConfirmationToken)) + "}");
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
