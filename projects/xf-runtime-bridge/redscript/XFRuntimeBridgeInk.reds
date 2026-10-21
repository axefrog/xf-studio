// XF Runtime Bridge: TEMPORARY TEST FEATURES (bridge 0.5.3), the first in-game UI in the game's own UI system (ink).
//
//   Demo A, the XF HUD panel: a panel in the game's HUD style (the game's Rajdhani font family and its main_colors.inkstyle
//     tokens) showing the bridge's state and the coordinator's ui.message lines. It works without Cyber Engine Tweaks.
//   Demo B, pedestal nameplates: each XF Finish Showroom head's preset name on the front of its pedestal. They are
//     projected from the pedestal's world point every tick (the technique the game's own nameplates and mappins use: a world
//     anchor, a screen-space widget), not rendered into the world as a texture; knowledge/ink-ui.md §5 has the
//     render-to-texture route (a world widget component) and why it isn't built yet.
//
// How it stays safe (RB-76 and the plugin's rules): the plugin never calls into this file. The overlay PULLS: a looping ink
// animation on a hidden 1x1 widget ticks it (about 30 times a second, on the UI's own clock, so it runs while the game is
// paused), and every few ticks it reads XFBridge_Hud(), a plugin native that only reads the bridge's bookkeeping
// (core/InkUi.hpp builds its tab-separated frame). World queries (the camera, the showroom's entities) run only while the
// frame says the script gate is open (live 1). The widgets hang under the chosen ink layer's root; mounting removes any
// earlier XF overlay left there (a layer can outlive a session), and the system's OnDetach stops the tick and removes it.
//
// Where it draws: ui.hud's layer: hud (default; inkHUDLayer's Root, the way Dark Future and Vehicle Navigation System add
// their HUD widgets, so it hides where the game hides its HUD: menus, photo mode, the creator), notifications
// (inkGameNotificationsLayer) or top (inkWatermarksLayer, the topmost layer Red Hot Tools draws its inspector on); which
// of the last two stay visible in photo mode and menus is session 7's check. Finding a layer needs Codeware's inkSystem
// (GameInstance.GetInkSystem); without Codeware XFInkHost below finds none and nothing is drawn (the CET label remains).
// Vanilla 2.31 types plus Codeware's; linted against the game's bundle with and without Codeware's scripts.

module XFRuntimeBridge

// ---- Codeware-dependent pieces -----------------------------------------------------------------------------------------

@if(ModuleExists("Codeware"))
public abstract class XFInkHost {
  public static func Available() -> Bool {
    return true;
  }

  // The layer's root compound: "Root" under its virtual window where there is one (the HUD layer), else the window itself.
  public static func LayerRoot(layer: String) -> wref<inkCompoundWidget> {
    let name = n"inkHUDLayer";
    if Equals(layer, "notifications") {
      name = n"inkGameNotificationsLayer";
    } else {
      if Equals(layer, "top") {
        name = n"inkWatermarksLayer";
      }
    }
    let system = GameInstance.GetInkSystem();
    if !IsDefined(system) {
      return null;
    }
    let wrapper = system.GetLayer(name);
    if !IsDefined(wrapper) {
      return null;
    }
    let window: wref<inkCompoundWidget> = wrapper.GetVirtualWindow();
    if !IsDefined(window) {
      return null;
    }
    let root = window.GetWidgetByPathName(n"Root") as inkCompoundWidget;
    if IsDefined(root) {
      return root;
    }
    return window;
  }

  // A showroom head's entity, once Codeware's static entity system has spawned it.
  public static func Entity(id: EntityID) -> ref<Entity> {
    let system = GameInstance.GetStaticEntitySystem();
    if !IsDefined(system) || !system.IsSpawned(id) {
      return null;
    }
    return system.GetEntity(id);
  }
}

@if(!ModuleExists("Codeware"))
public abstract class XFInkHost {
  public static func Available() -> Bool {
    return false;
  }

  public static func LayerRoot(layer: String) -> wref<inkCompoundWidget> {
    return null;
  }

  public static func Entity(id: EntityID) -> ref<Entity> {
    return null;
  }
}

// ---- The frame XFBridge_Hud answers (core/InkUi.hpp) -------------------------------------------------------------------

public class XFHudFrame {
  public let valid: Bool;
  public let show: Bool;
  public let layer: String;
  public let anchor: String;
  public let x: Float;
  public let y: Float;
  public let scale: Float;
  public let nameplates: Bool;
  public let live: Bool;
  public let tone: String;
  public let status: String;
  public let levels: array<String>;
  public let texts: array<String>;
  // 0.7 (session 7, in-game driving): the ask waiting for an answer: its id and each choice's key and label.
  public let askId: Int32;
  public let askKeys: array<String>;
  public let askLabels: array<String>;
  // 0.8 (the UI review): the answered ask (its answer shows where its keys were, until the next message).
  public let answeredId: Int32;
  public let answeredLabel: String;

  public static func Parse(text: String) -> ref<XFHudFrame> {
    let frame = new XFHudFrame();
    frame.layer = "hud";
    frame.anchor = "top_left";
    frame.scale = 1.0;
    for line in StrSplit(text, "\n") {
      frame.Read(StrSplit(line, "\t"));
    }
    if frame.scale < 0.5 || frame.scale > 2.5 {
      frame.scale = 1.0;
    }
    return frame;
  }

  // One record of the frame (redscript has no `continue`, so each line is read here).
  private func Read(f: array<String>) -> Void {
    let frame = this;
    if ArraySize(f) >= 2 {
      let key = f[0];
      if Equals(key, "xfhud") {
        frame.valid = Equals(f[1], "1");
      } else {
        if Equals(key, "show") {
          frame.show = Equals(f[1], "1");
        } else {
          if Equals(key, "layer") {
            frame.layer = f[1];
          } else {
            if Equals(key, "anchor") {
              frame.anchor = f[1];
            } else {
              if Equals(key, "pos") && ArraySize(f) >= 3 {
                frame.x = StringToFloat(f[1]);
                frame.y = StringToFloat(f[2]);
              } else {
                if Equals(key, "scale") {
                  frame.scale = StringToFloat(f[1]);
                } else {
                  if Equals(key, "nameplates") {
                    frame.nameplates = Equals(f[1], "1");
                  } else {
                    if Equals(key, "live") {
                      frame.live = Equals(f[1], "1");
                    } else {
                      if Equals(key, "tone") {
                        frame.tone = f[1];
                      } else {
                        if Equals(key, "status") {
                          frame.status = f[1];
                        } else {
                          if Equals(key, "msg") && ArraySize(f) >= 3 {
                            ArrayPush(frame.levels, f[1]);
                            ArrayPush(frame.texts, f[2]);
                          } else {
                            if Equals(key, "ask") && ArraySize(f) >= 4 {
                              frame.askId = StringToInt(f[1]);
                              let i = 2;
                              while i + 1 < ArraySize(f) {
                                ArrayPush(frame.askKeys, f[i]);
                                ArrayPush(frame.askLabels, f[i + 1]);
                                i += 2;
                              }
                            } else {
                              if Equals(key, "answered") && ArraySize(f) >= 3 {
                                frame.answeredId = StringToInt(f[1]);
                                frame.answeredLabel = f[2];
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

// ---- The game's look: its font family and colour tokens ----------------------------------------------------------------

public abstract class XFInkStyle {
  public static func Font() -> String {
    return "base\\gameplay\\gui\\fonts\\raj\\raj.inkfontfamily";
  }

  // Binds a widget's tint to one of the game's own colour tokens (main_colors.inkstyle), so it follows the game's theme.
  public static func Bind(widget: ref<inkWidget>, token: CName) -> Void {
    widget.SetStyle(r"base\\gameplay\\gui\\common\\main_colors.inkstyle");
    widget.BindProperty(n"tintColor", token);
  }

  public static func Text(name: CName, size: Int32, style: CName, token: CName, upper: Bool) -> ref<inkText> {
    let text = new inkText();
    text.SetName(name);
    text.SetFontFamily(XFInkStyle.Font(), style);
    text.SetFontStyle(style);
    text.SetFontSize(size);
    if upper {
      text.SetLetterCase(textLetterCase.UpperCase);
    } else {
      text.SetLetterCase(textLetterCase.OriginalCase);
    }
    XFInkStyle.Bind(text, token);
    return text;
  }

  public static func ToneToken(tone: String) -> CName {
    if Equals(tone, "ok") {
      return n"MainColors.Green";
    }
    if Equals(tone, "write") || Equals(tone, "paused") {
      return n"MainColors.Yellow";
    }
    if Equals(tone, "killed") {
      return n"MainColors.Red";
    }
    return n"MainColors.Grey";
  }

  public static func LevelToken(level: String) -> CName {
    if Equals(level, "ask") {
      return n"MainColors.Yellow";
    }
    if Equals(level, "warn") {
      return n"MainColors.ActiveRed";
    }
    if Equals(level, "done") {
      return n"MainColors.Green";
    }
    return n"MainColors.Blue";
  }

  // 0.8: where an anchor sits on the visible screen, as fractions across and down (0, 0.5 or 1); the panel's own point at that
  // place is the same fractions of its size, so it grows away from its corner or edge (and from the middle for center).
  // 0.8.2: one edge of the panel along one axis of the visible screen (start, length): the anchor's fraction of it, moved by
  // offset, less the same fraction of the panel's size (so top_right ends at the right edge, center sits in the middle).
  // tools/test/ink-place.test.ts checks the same arithmetic for all nine anchors.
  public static func PanelEdge(start: Float, length: Float, fraction: Float, offset: Float, size: Float) -> Float {
    return start + fraction * length + offset - fraction * size;
  }

  public static func AnchorPoint(name: String) -> Vector2 {
    let x = 0.0;
    let y = 0.0;
    if StrEndsWith(name, "_right") {
      x = 1.0;
    } else {
      if StrEndsWith(name, "_center") || Equals(name, "center") {
        x = 0.5;
      }
    }
    if StrBeginsWith(name, "bottom_") {
      y = 1.0;
    } else {
      if StrBeginsWith(name, "center") {
        y = 0.5;
      }
    }
    return new Vector2(x, y);
  }
}

// ---- Screen projection for the nameplates ------------------------------------------------------------------------------

// Which screen space CameraSystem.ProjectPoint answers in is not settled in game (knowledge/runtime-access.md, open question
// 9), so each tick works it out as photo.frame does (tools/api/framing.ts): the projection of a point straight ahead of the
// camera is the screen's centre (about 0 in NDC, 0.5 in unit space, half the window in pixels), and points up and right of
// it give the axes' directions.
public class XFProjector {
  public let ok: Bool;
  public let camera: ref<CameraSystem>;
  public let position: Vector4;
  public let forward: Vector4;
  public let kind: Int32; // 0 ndc, 1 unit, 2 pixels
  public let cx: Float;
  public let cy: Float;
  public let sx: Float;
  public let sy: Float;

  public static func Persp(v: Vector4) -> Vector4 {
    if AbsF(v.W) > 0.000001 && AbsF(v.W - 1.0) > 0.0001 {
      return new Vector4(v.X / v.W, v.Y / v.W, v.Z, 1.0);
    }
    return v;
  }

  public static func Create() -> ref<XFProjector> {
    let p = new XFProjector();
    p.camera = GameInstance.GetCameraSystem(GetGameInstance());
    let transform: Transform;
    if !IsDefined(p.camera) || !p.camera.GetActiveCameraWorldTransform(transform) {
      return p;
    }
    p.position = transform.position;
    p.forward = p.camera.GetActiveCameraForward();
    let r = p.camera.GetActiveCameraRight();
    let u = p.camera.GetActiveCameraUp();
    let ahead = new Vector4(p.position.X + p.forward.X * 5.0, p.position.Y + p.forward.Y * 5.0, p.position.Z + p.forward.Z * 5.0, 1.0);
    let c = XFProjector.Persp(p.camera.ProjectPoint(ahead));
    let up = XFProjector.Persp(p.camera.ProjectPoint(new Vector4(ahead.X + u.X * 0.5, ahead.Y + u.Y * 0.5, ahead.Z + u.Z * 0.5, 1.0)));
    let right = XFProjector.Persp(p.camera.ProjectPoint(new Vector4(ahead.X + r.X * 0.5, ahead.Y + r.Y * 0.5, ahead.Z + r.Z * 0.5, 1.0)));
    p.cx = c.X;
    p.cy = c.Y;
    p.sy = up.Y - c.Y > 0.0 ? -1.0 : 1.0; // up on screen becomes a smaller y
    p.sx = right.X - c.X > 0.0 ? 1.0 : -1.0;
    if AbsF(c.X) < 0.2 && AbsF(c.Y) < 0.2 {
      p.kind = 0;
    } else {
      if AbsF(c.X - 0.5) < 0.2 && AbsF(c.Y - 0.5) < 0.2 {
        p.kind = 1;
      } else {
        p.kind = 2;
      }
    }
    p.ok = p.kind != 2 || (AbsF(p.cx) > 1.0 && AbsF(p.cy) > 1.0);
    return p;
  }

  // Normalised screen position of a world point, -1 to 1 across the screen, y down; W is the distance, 0 when it's behind.
  public func Project(point: Vector4) -> Vector4 {
    let d = new Vector4(point.X - this.position.X, point.Y - this.position.Y, point.Z - this.position.Z, 0.0);
    let along = d.X * this.forward.X + d.Y * this.forward.Y + d.Z * this.forward.Z;
    if along < 0.2 {
      return new Vector4(0.0, 0.0, 0.0, 0.0);
    }
    let q = XFProjector.Persp(this.camera.ProjectPoint(point));
    let nx = 0.0;
    let ny = 0.0;
    if this.kind == 0 {
      nx = this.sx * (q.X - this.cx);
      ny = this.sy * (q.Y - this.cy);
    } else {
      if this.kind == 1 {
        nx = 2.0 * this.sx * (q.X - this.cx);
        ny = 2.0 * this.sy * (q.Y - this.cy);
      } else {
        nx = this.sx * (q.X - this.cx) / this.cx;
        ny = this.sy * (q.Y - this.cy) / this.cy;
      }
    }
    return new Vector4(nx, ny, 0.0, SqrtF(d.X * d.X + d.Y * d.Y + d.Z * d.Z));
  }
}

// ---- The overlay --------------------------------------------------------------------------------------------------------

public class XFInkMountCallback extends DelayCallback {
  public let overlay: wref<XFInkOverlay>;

  public func Call() -> Void {
    if IsDefined(this.overlay) {
      this.overlay.TryMount();
    }
  }
}

// One per game session. Mounts after the player attaches (the HUD exists by then), retrying for a while.
public class XFInkOverlay extends ScriptableSystem {
  private let m_root: ref<inkCanvas>;
  private let m_parent: wref<inkCompoundWidget>;
  private let m_ticker: ref<inkRectangle>;
  private let m_proxy: ref<inkAnimProxy>;
  private let m_panel: ref<inkCanvas>;
  // 0.8 (session 8: the plate wasn't drawn; a Fill rectangle in a fit-to-content canvas got no size): the plate and the red
  // edge are sized from the body's own measured size on every frame read.
  private let m_body: ref<inkVerticalPanel>;
  private let m_plate: ref<inkRectangle>;
  private let m_edge: ref<inkRectangle>;
  private let m_visible: Vector4; // the visible screen in the layer root's units: x, y, width, height
  private let m_screen: Vector2;
  private let m_reported: Bool;
  private let m_diamond: ref<inkRectangle>;
  private let m_status: ref<inkText>;
  private let m_messages: array<ref<inkText>>;
  private let m_choices: ref<inkText>;
  private let m_units: Float;
  private let m_platesRoot: ref<inkCanvas>;
  private let m_plates: array<ref<inkText>>;
  private let m_pinsRoot: ref<inkCanvas>;     // 0.8.2: the XF pins' marks in the world
  private let m_pinMarks: array<ref<inkCanvas>>;
  private let m_frame: ref<XFHudFrame>;
  // RB-114: the frame whose question and answer keys are on screen now (set when Apply draws them).
  private let m_drawn: ref<XFHudFrame>;
  private let m_layer: String;
  private let m_tries: Int32;
  private let m_ticks: Int32;
  private let m_width: Float;
  private let m_height: Float;
  private let m_mounted: Bool;
  private let m_remount: Bool;

  public static func Get() -> ref<XFInkOverlay> {
    let game = GetGameInstance();
    if !GameInstance.IsValid(game) {
      return null;
    }
    let container = GameInstance.GetScriptableSystemsContainer(game);
    if !IsDefined(container) {
      return null;
    }
    return container.Get(n"XFRuntimeBridge.XFInkOverlay") as XFInkOverlay;
  }

  private func OnPlayerAttach(request: ref<PlayerAttachRequest>) -> Void {
    if !XFInkHost.Available() {
      XFBridgeLog.Info("ink", "ink overlay: Codeware isn't loaded, so no ink layer can be reached; the CET label remains");
      return;
    }
    this.m_tries = 0;
    this.Schedule(1.0);
  }

  private func OnDetach() -> Void {
    // Only ink calls here (no game systems): stop the tick and take the widgets down with the session.
    this.Unmount("detach");
  }

  private func Schedule(delay: Float) -> Void {
    let callback = new XFInkMountCallback();
    callback.overlay = this;
    GameInstance.GetDelaySystem(GetGameInstance()).DelayCallback(callback, delay, false);
  }

  public func TryMount() -> Void {
    this.m_tries += 1;
    let frame = XFHudFrame.Parse(XFBridge_Hud());
    let layer = frame.valid ? frame.layer : "hud";
    let parent = XFInkHost.LayerRoot(layer);
    if !IsDefined(parent) {
      if this.m_tries < 30 {
        this.Schedule(1.0);
      } else {
        XFBridgeLog.Warn("ink", "ink overlay: the " + layer + " layer's root never appeared; giving up for this session");
      }
      return;
    }
    this.Unmount("remount");
    // A layer can outlive the session that drew on it: remove any XF overlay left there first.
    let stale = parent.GetWidgetByPathName(n"xfs_overlay");
    if IsDefined(stale) {
      stale.StopAllAnimations();
      parent.RemoveChild(stale);
      XFBridgeLog.Debug("ink", "ink overlay: removed an earlier overlay from the " + layer + " layer");
    }
    this.Build(parent);
    this.m_layer = layer;
    this.m_frame = frame;
    this.m_mounted = true;
    this.Apply();
    XFBridge_Announce("ink", "overlay attached layer=" + layer + " size=" + FloatToStringPrec(this.m_width, 0) + "x" + FloatToStringPrec(this.m_height, 0));
    XFBridgeLog.Info("ink", "ink overlay mounted on the " + layer + " layer after " + IntToString(this.m_tries) + " tries");
  }

  private func Unmount(why: String) -> Void {
    if IsDefined(this.m_proxy) {
      this.m_proxy.UnregisterFromAllCallbacks(inkanimEventType.OnEndLoop);
      this.m_proxy.Stop(true);
      this.m_proxy = null;
    }
    if IsDefined(this.m_root) {
      this.m_root.StopAllAnimations();
      if IsDefined(this.m_parent) {
        this.m_parent.RemoveChild(this.m_root);
      }
      this.m_root = null;
      this.m_parent = null;
    }
    ArrayClear(this.m_messages);
    ArrayClear(this.m_plates);
    ArrayClear(this.m_pinMarks);
    if this.m_mounted {
      XFBridgeLog.Debug("ink", "ink overlay unmounted (" + why + ")");
    }
    this.m_mounted = false;
  }

  // The screen's size from the display settings (as Codeware's ScreenHelper reads it), for the overlay's scale.
  private func ScreenSize() -> Vector2 {
    let settings = GameInstance.GetSettingsSystem(GetGameInstance());
    let variable: ref<ConfigVarListString>;
    if IsDefined(settings) {
      variable = settings.GetVar(n"/video/display", n"Resolution") as ConfigVarListString;
    }
    if IsDefined(variable) {
      let parts = StrSplit(variable.GetValue(), "x");
      if ArraySize(parts) == 2 {
        return new Vector2(StringToFloat(parts[0]), StringToFloat(parts[1]));
      }
    }
    return new Vector2(3840.0, 2160.0);
  }

  // 0.7 (session 7: on a 3840x1600 screen the panel sat off-screen at the right edge, and at bottom left it didn't show at
  // all): the overlay no longer sizes and scales itself from the display setting. It fills the layer's root, in whatever
  // units that root lays out in, so a panel anchored to a corner is at that corner of what the layer shows (21:9, 32:9 and
  // 16:9 alike), and its margins are clamped inside it. m_units converts the panel's design (2160 units per screen height)
  // into the root's units, from the root's own size where it reports one.
  //
  // 0.8 (session 8: on 3840 x 1600 the root reported 3840 x 2160, top_right was cut off and the bottom anchors had shown
  // nothing since session 7): the HUD lays out on its 3840 x 2160 design canvas scaled to COVER the screen, the way the
  // game's own right-anchored widgets (the minimap, the quest tracker) reach the screen's edges on 21:9 and 32:9. A screen
  // wider than the canvas shows its full width and the middle 3840 / aspect of its height (1600 of 2160 at 3840 x 1600: 280
  // units cut off at the top and at the bottom); a narrower one shows its full height and the middle part of its width.
  // The game's own notifications place themselves by native black-bar and safe-zone offsets for the same reason
  // (ingameUINotification.script AdjustScreenPosition: GetBlackBarFullscreenWidgetOffsets). m_visible is that part in the
  // root's units; every anchor is a corner, edge or middle of it. The root's size, the screen and the visible part are
  // announced once (layers.status), so a session can check the arithmetic against a capture.
  private func Measure(parent: wref<inkCompoundWidget>) -> Void {
    let size = parent.GetSize();
    if size.X > 100.0 && size.Y > 100.0 {
      this.m_width = size.X;
      this.m_height = size.Y;
    } else {
      this.m_width = 3840.0;
      this.m_height = 2160.0;
    }
    this.m_units = this.m_height > 100.0 ? this.m_height / 2160.0 : 1.0;
    this.m_screen = this.ScreenSize();
    let aspect = this.m_screen.Y > 100.0 ? this.m_screen.X / this.m_screen.Y : this.m_width / this.m_height;
    let rootAspect = this.m_width / this.m_height;
    if aspect > rootAspect * 1.005 {
      let shownHeight = this.m_width / aspect;
      this.m_visible = new Vector4(0.0, (this.m_height - shownHeight) * 0.5, this.m_width, shownHeight);
    } else {
      if aspect < rootAspect / 1.005 {
        let shownWidth = this.m_height * aspect;
        this.m_visible = new Vector4((this.m_width - shownWidth) * 0.5, 0.0, shownWidth, this.m_height);
      } else {
        this.m_visible = new Vector4(0.0, 0.0, this.m_width, this.m_height);
      }
    }
  }

  public func GeometryText() -> String {
    return "root=" + FloatToStringPrec(this.m_width, 0) + "x" + FloatToStringPrec(this.m_height, 0) + " screen=" + FloatToStringPrec(this.m_screen.X, 0) + "x" + FloatToStringPrec(this.m_screen.Y, 0)
      + " visible=" + FloatToStringPrec(this.m_visible.Z, 0) + "x" + FloatToStringPrec(this.m_visible.W, 0) + " at " + FloatToStringPrec(this.m_visible.X, 0) + "," + FloatToStringPrec(this.m_visible.Y, 0);
  }

  private func Build(parent: wref<inkCompoundWidget>) -> Void {
    this.Measure(parent);
    let root = new inkCanvas();
    root.SetName(n"xfs_overlay");
    root.SetAnchor(inkEAnchor.Fill);
    root.SetInteractive(false);
    root.Reparent(parent);
    this.m_root = root;
    this.m_parent = parent;

    // Nameplates first, so the panel draws over them.
    let plates = new inkCanvas();
    plates.SetName(n"xfs_plates");
    plates.SetAnchor(inkEAnchor.Fill);
    plates.Reparent(root);
    this.m_platesRoot = plates;

    // 0.8.2: the XF pins' marks, under the panel too.
    let pins = new inkCanvas();
    pins.SetName(n"xfs_pin_marks");
    pins.SetAnchor(inkEAnchor.Fill);
    pins.Reparent(root);
    this.m_pinsRoot = pins;

    let panel = new inkCanvas();
    panel.SetName(n"xfs_hud_panel");
    panel.SetAnchor(inkEAnchor.TopLeft);
    panel.SetFitToContent(true);
    panel.Reparent(root);
    this.m_panel = panel;

    // 0.8 (the UI review): the game's own dark plate (its settings dialog's, MainColors.Fullscreen_PrimaryBackgroundDarkest)
    // at 90 % so the panel reads over bright scenes, with the red edge; both sized from the body in Apply.
    let back = new inkRectangle();
    back.SetName(n"back");
    back.SetAnchor(inkEAnchor.TopLeft);
    back.SetSize(new Vector2(10.0, 10.0));
    XFInkStyle.Bind(back, n"MainColors.Fullscreen_PrimaryBackgroundDarkest");
    back.SetOpacity(0.9);
    back.Reparent(panel);
    this.m_plate = back;

    let edge = new inkRectangle();
    edge.SetName(n"edge");
    edge.SetAnchor(inkEAnchor.TopLeft);
    edge.SetSize(new Vector2(4.0, 10.0));
    XFInkStyle.Bind(edge, n"MainColors.Red");
    edge.Reparent(panel);
    this.m_edge = edge;

    let body = new inkVerticalPanel();
    body.SetName(n"body");
    body.SetAnchor(inkEAnchor.TopLeft);
    body.SetFitToContent(true);
    body.SetMargin(new inkMargin(28.0, 16.0, 0.0, 0.0));
    body.Reparent(panel);
    this.m_body = body;

    let header = new inkHorizontalPanel();
    header.SetName(n"header");
    header.SetFitToContent(true);
    header.Reparent(body);

    let diamond = new inkRectangle();
    diamond.SetName(n"state");
    diamond.SetSize(new Vector2(14.0, 14.0));
    diamond.SetRotation(45.0);
    diamond.SetVAlign(inkEVerticalAlign.Center);
    diamond.SetMargin(new inkMargin(2.0, 0.0, 18.0, 0.0));
    diamond.Reparent(header);
    this.m_diamond = diamond;

    let title = XFInkStyle.Text(n"title", 32, n"Semi-Bold", n"MainColors.Red", true);
    title.SetText("XF Runtime Bridge");
    title.Reparent(header);

    let tag = XFInkStyle.Text(n"tag", 22, n"Medium", n"MainColors.MildRed", true);
    tag.SetText("test");
    tag.SetVAlign(inkEVerticalAlign.Center);
    tag.SetMargin(new inkMargin(16.0, 0.0, 0.0, 0.0));
    tag.Reparent(header);

    let status = XFInkStyle.Text(n"status", 26, n"Medium", n"MainColors.Grey", false);
    status.SetMargin(new inkMargin(0.0, 6.0, 0.0, 4.0));
    status.Reparent(body);
    this.m_status = status;

    let i = 0;
    while i < 4 {
      let line = XFInkStyle.Text(StringToName("message" + IntToString(i)), 26, n"Regular", n"MainColors.Blue", false);
      line.SetMargin(new inkMargin(0.0, 4.0, 0.0, 0.0));
      line.SetWrappingAtPosition(980.0);
      line.SetVisible(false);
      line.Reparent(body);
      ArrayPush(this.m_messages, line);
      i += 1;
    }

    // 0.7: the pending ask's answers and the keys that give them ("[F6] Ready   [F7] Yes   [F8] No").
    let choices = XFInkStyle.Text(n"choices", 28, n"Semi-Bold", n"MainColors.Yellow", false);
    choices.SetMargin(new inkMargin(0.0, 8.0, 0.0, 0.0));
    choices.SetVisible(false);
    choices.Reparent(body);
    this.m_choices = choices;

    // The tick: a hidden widget's endless transparency animation on the UI's own clock.
    let ticker = new inkRectangle();
    ticker.SetName(n"tick");
    ticker.SetSize(new Vector2(1.0, 1.0));
    ticker.SetOpacity(0.0);
    ticker.Reparent(root);
    this.m_ticker = ticker;
    let fade = new inkAnimTransparency();
    fade.SetStartTransparency(0.0);
    fade.SetEndTransparency(0.0);
    fade.SetDuration(0.033);
    let definition = new inkAnimDef();
    definition.AddInterpolator(fade);
    let options: inkAnimOptions;
    options.loopType = inkanimLoopType.Cycle;
    options.loopInfinite = true;
    this.m_proxy = ticker.PlayAnimationWithOptions(definition, options);
    this.m_proxy.RegisterToCallback(inkanimEventType.OnEndLoop, this, n"OnTick");
  }

  protected cb func OnTick(proxy: ref<inkAnimProxy>) -> Bool {
    if !this.m_mounted {
      return false;
    }
    this.m_ticks += 1;
    if this.m_ticks % 6 == 0 {
      let frame = XFHudFrame.Parse(XFBridge_Hud());
      if frame.valid {
        this.m_frame = frame;
        if NotEquals(frame.layer, this.m_layer) && !this.m_remount {
          // ui.hud moved the overlay to another layer: mount again from outside this callback.
          this.m_remount = true;
          this.m_tries = 0;
          this.Schedule(0.1);
        }
        this.Apply();
      }
    }
    // The script gate on every tick, not only with the frame every sixth (RB-86): no world query after a detach begins.
    if IsDefined(this.m_frame) {
      this.m_frame.live = XFBridge_Live();
    }
    this.UpdatePlates();
    return false;
  }

  private func Apply() -> Void {
    let frame = this.m_frame;
    if !IsDefined(frame) || !IsDefined(this.m_panel) {
      return;
    }
    this.m_remount = this.m_remount && NotEquals(frame.layer, this.m_layer);
    this.m_panel.SetVisible(frame.show);
    if IsDefined(this.m_parent) {
      this.Measure(this.m_parent);
    }
    let units = this.m_units > 0.0 ? this.m_units : 1.0;
    let scale = ClampF(frame.scale, 0.5, 3.0) * units;
    this.m_panel.SetScale(new Vector2(scale, scale));
    this.SizePlate();
    this.Place(frame, scale);
    this.KeepOnTop();
    if !this.m_reported {
      this.m_reported = true;
      XFBridge_Announce("ink", "panel geometry " + this.GeometryText());
    }
    XFInkStyle.Bind(this.m_diamond, XFInkStyle.ToneToken(frame.tone));
    XFInkStyle.Bind(this.m_status, XFInkStyle.ToneToken(frame.tone));
    this.m_status.SetText(frame.status);
    let i = 0;
    while i < ArraySize(this.m_messages) {
      let line = this.m_messages[i];
      if i < ArraySize(frame.texts) {
        line.SetText(frame.texts[i]);
        XFInkStyle.Bind(line, XFInkStyle.LevelToken(frame.levels[i]));
        line.SetVisible(true);
      } else {
        line.SetVisible(false);
      }
      i += 1;
    }
    if frame.show && frame.askId > 0 && ArraySize(frame.askKeys) > 0 {
      this.m_drawn = frame;
    } else {
      this.m_drawn = null;
    }
    if ArraySize(frame.askKeys) > 0 {
      let text = "";
      let k = 0;
      while k < ArraySize(frame.askKeys) {
        let key = StrBeginsWith(frame.askKeys[k], "IK_") ? StrAfterFirst(frame.askKeys[k], "IK_") : frame.askKeys[k];
        text += (k > 0 ? "     " : "") + "[" + key + "] " + frame.askLabels[k];
        k += 1;
      }
      this.m_choices.SetText(text);
      this.m_choices.SetVisible(true);
    } else {
      if frame.answeredId > 0 {
        // 0.8 (the UI review): the same line, same place and size, now saying what was answered.
        this.m_choices.SetText("Answered: " + frame.answeredLabel);
        this.m_choices.SetVisible(true);
      } else {
        this.m_choices.SetVisible(false);
      }
    }
    this.m_platesRoot.SetVisible(frame.nameplates);
    this.ReportDrawn(frame);
  }

  // 0.8: the plate and the edge at the body's measured size (its content plus the body's margins); nothing until measured.
  private func SizePlate() -> Void {
    if !IsDefined(this.m_body) || !IsDefined(this.m_plate) {
      return;
    }
    let size = this.m_body.GetDesiredSize();
    if size.X < 1.0 || size.Y < 1.0 {
      // The arranged size where the measured one isn't there (yet).
      size = this.m_panel.GetChildSize(this.m_body);
    }
    if size.X < 1.0 || size.Y < 1.0 {
      return;
    }
    let w = size.X + 56.0;
    let h = size.Y + 36.0;
    this.m_plate.SetSize(new Vector2(w, h));
    this.m_edge.SetSize(new Vector2(4.0, h));
  }

  // 0.8.2 (session 9's B1 and B2): the panel's top-left corner, worked out here and set as a margin from the root's top
  // left, the one placement proven in game (sessions 7 and 8: a margin of 40, 640 sat at 40, 360 of a 3840 x 1600 screen).
  // 0.8's anchor point and translation put top_left half way down the screen and left every other anchor's panel hanging
  // from its corner (top_right a sliver at the right edge, bottom_left below the screen). Now the anchor's point of the
  // visible screen is moved inwards by x and y (from the middle for center), the panel's own point there is the same
  // fractions of its measured size (scaled), and the whole panel is kept inside the visible screen. An anchor other than
  // top_left waits unseen until the panel has been measured, so it never shows in the wrong place.
  private func Place(frame: ref<XFHudFrame>, scale: Float) -> Void {
    let point = XFInkStyle.AnchorPoint(frame.anchor);
    let v = this.m_visible;
    if v.Z < 100.0 || v.W < 100.0 {
      v = new Vector4(0.0, 0.0, this.m_width, this.m_height);
    }
    let units = this.m_units > 0.0 ? this.m_units : 1.0;
    let size = IsDefined(this.m_plate) ? this.m_plate.GetSize() : new Vector2(0.0, 0.0);
    let w = size.X * scale;
    let h = size.Y * scale;
    let measured = w > 20.0 && h > 20.0;
    let dx = point.X > 0.9 ? -frame.x : frame.x;
    let dy = point.Y > 0.9 ? -frame.y : frame.y;
    let left = XFInkStyle.PanelEdge(v.X, v.Z, point.X, dx * units, w);
    let top = XFInkStyle.PanelEdge(v.Y, v.W, point.Y, dy * units, h);
    if measured {
      let margin = 8.0 * units;
      left = ClampF(left, v.X + margin, MaxF(v.X + margin, v.X + v.Z - margin - w));
      top = ClampF(top, v.Y + margin, MaxF(v.Y + margin, v.Y + v.W - margin - h));
    }
    this.m_panel.SetAnchor(inkEAnchor.TopLeft);
    this.m_panel.SetAnchorPoint(new Vector2(0.0, 0.0));
    this.m_panel.SetRenderTransformPivot(new Vector2(0.0, 0.0));
    this.m_panel.SetTranslation(new Vector2(0.0, 0.0));
    this.m_panel.SetMargin(new inkMargin(left, top, 0.0, 0.0));
    this.m_panel.SetOpacity(measured || (point.X < 0.1 && point.Y < 0.1) ? 1.0 : 0.0);
  }

  // 0.8 (the UI review: a quest marker drew over the answer keys): the overlay is the layer root's last child, so it draws
  // over everything else there; widgets added after it (HUD entries spawning later) are passed again on the next read.
  private func KeepOnTop() -> Void {
    if !IsDefined(this.m_parent) || !IsDefined(this.m_root) {
      return;
    }
    let count = this.m_parent.GetNumChildren();
    let last = this.m_parent.GetWidgetByIndex(count - 1);
    if count > 1 && (!IsDefined(last) || NotEquals(last.GetName(), n"xfs_overlay")) {
      this.m_parent.ReorderChild(this.m_root, -1);
    }
  }

  // 0.8 (the UI review: the question showed in three places): tells the plugin which question the panel shows on screen
  // now. 0.8.2 (the surfaces' rule): and whether the panel is on screen at all, question or not: while it is, it is the one
  // status surface and the overlay panel and the status label stay off. The HUD layer is hidden outside normal play (menus,
  // photo mode, the appearance screen), so there it counts as not shown; the world is only asked while the scripts are live.
  private func ReportDrawn(frame: ref<XFHudFrame>) -> Void {
    let id = frame.askId > 0 ? frame.askId : frame.answeredId;
    let shown = frame.show && this.m_mounted && frame.live;
    if shown && Equals(this.m_layer, "hud") {
      shown = Equals(XFBridgeActions.Phase(), "gameplay");
    }
    XFBridge_InkDrawn(id, shown);
  }

  // RB-114: the question the panel shows now with its keys, or null (nothing mounted, hidden, or no question drawn).
  public func DrawnAsk() -> ref<XFHudFrame> {
    return this.m_mounted ? this.m_drawn : null;
  }

  private func Plate(index: Int32) -> ref<inkText> {
    while ArraySize(this.m_plates) <= index {
      let plate = XFInkStyle.Text(StringToName("plate" + IntToString(ArraySize(this.m_plates))), 30, n"Semi-Bold", n"MainColors.Blue", true);
      plate.SetAnchor(inkEAnchor.TopLeft);
      plate.SetAnchorPoint(new Vector2(0.5, 0.5));
      plate.SetRenderTransformPivot(new Vector2(0.5, 0.5));
      plate.SetVisible(false);
      plate.Reparent(this.m_platesRoot);
      ArrayPush(this.m_plates, plate);
    }
    return this.m_plates[index];
  }

  private func HidePlates(from: Int32) -> Void {
    let i = from;
    while i < ArraySize(this.m_plates) {
      this.m_plates[i].SetVisible(false);
      i += 1;
    }
  }

  // Demo B: each spawned showroom head's preset name at the front of its pedestal, about 17 cm below the column's top
  // (the showroom build's column: 0.24 m wide, top 1.52 m above the entity's origin, centred 7 cm behind it).
  private func UpdatePlates() -> Void {
    this.UpdatePinMarks();
    let frame = this.m_frame;
    if !IsDefined(frame) || !frame.nameplates || !frame.live || !IsDefined(this.m_platesRoot) {
      this.HidePlates(0);
      return;
    }
    let registry = XFShowroomRegistry.Get();
    if !IsDefined(registry) || registry.Count("pieces") == 0 {
      this.HidePlates(0);
      return;
    }
    let projector = XFProjector.Create();
    if !projector.ok {
      this.HidePlates(0);
      return;
    }
    let used = 0;
    for item in registry.Items() {
      if this.PlacePlate(item, projector, used) {
        used += 1;
      }
    }
    this.HidePlates(used);
  }

  // One head's label, if its pedestal is in view within 15 m; answers whether it used plate `slot`.
  private func PlacePlate(item: ref<XFShowroomItem>, projector: ref<XFProjector>, slot: Int32) -> Bool {
    if !Equals(item.kind, "pieces") {
      return false;
    }
    let entity = XFInkHost.Entity(item.id);
    if !IsDefined(entity) {
      return false;
    }
    let origin = entity.GetWorldPosition();
    let f = entity.GetWorldForward();
    let point = new Vector4(origin.X + f.X * 0.10, origin.Y + f.Y * 0.10, origin.Z + 1.35, 1.0);
    let s = projector.Project(point);
    if s.W <= 0.0 || s.W > 15.0 || AbsF(s.X) > 1.2 || AbsF(s.Y) > 1.2 {
      return false;
    }
    let plate = this.Plate(slot);
    plate.SetText(IntToString(item.index + 1) + "  " + item.label);
    plate.SetTranslation(this.ScreenPoint(s));
    let size = ClampF(3.0 / MaxF(s.W, 0.5), 0.55, 1.0);
    plate.SetScale(new Vector2(size, size));
    plate.SetOpacity(ClampF((15.0 - s.W) / 5.0, 0.0, 1.0));
    plate.SetVisible(true);
    return true;
  }


  // ---- 0.8.2: the XF pins' marks in the world ----------------------------------------------------------------------------------

  private func PinMark(index: Int32) -> ref<inkCanvas> {
    while ArraySize(this.m_pinMarks) <= index {
      let mark = new inkCanvas();
      mark.SetName(StringToName("pin" + IntToString(ArraySize(this.m_pinMarks))));
      mark.SetAnchor(inkEAnchor.TopLeft);
      mark.SetInteractive(false);
      mark.SetVisible(false);
      mark.Reparent(this.m_pinsRoot);
      ArrayPush(this.m_pinMarks, mark);
    }
    return this.m_pinMarks[index];
  }

  // A projected point (the projector's -1..1 across and down the screen) in the root's units: the screen is the visible part
  // of the root (m_visible), not the whole 2160-high canvas (0.8.2; the pedestal labels used the canvas before).
  private func ScreenPoint(s: Vector4) -> Vector2 {
    let v = this.m_visible;
    if v.Z < 100.0 || v.W < 100.0 {
      v = new Vector4(0.0, 0.0, this.m_width, this.m_height);
    }
    return new Vector2(v.X + (s.X + 1.0) * 0.5 * v.Z, v.Y + (s.Y + 1.0) * 0.5 * v.W);
  }

  // 0.8.2 (session 9's F1: in the world only the game's own marker showed, with no XF diamond and no label, although the
  // world view's controller ran): each XF pin's diamond, "XF" and label drawn by the bridge's own overlay above the pin's
  // world point, projected every tick as the pedestal labels are, while the scripts are live. The map and the minimap keep
  // their controller badges. drawn_by gains "xf_overlay" the first time a pin's mark is on screen.
  private func UpdatePinMarks() -> Void {
    let frame = this.m_frame;
    let used = 0;
    if IsDefined(frame) && frame.show && frame.live && IsDefined(this.m_pinsRoot) {
      let registry = XFPinRegistry.Get();
      if IsDefined(registry) && registry.Count() > 0 {
        let projector = XFProjector.Create();
        if projector.ok {
          for entry in registry.Pins() {
            if this.PlacePinMark(entry, projector, used) {
              used += 1;
            }
          }
        }
      }
    }
    let i = used;
    while i < ArraySize(this.m_pinMarks) {
      this.m_pinMarks[i].SetVisible(false);
      i += 1;
    }
  }

  private func PlacePinMark(entry: ref<XFPinEntry>, projector: ref<XFProjector>, slot: Int32) -> Bool {
    let point = entry.position;
    if entry.bound && entry.piece >= 0 {
      let registry = XFShowroomRegistry.Get();
      if IsDefined(registry) {
        let item = registry.Piece(entry.piece);
        if IsDefined(item) {
          let entity = XFInkHost.Entity(item.id);
          if IsDefined(entity) {
            let at = entity.GetWorldPosition();
            point = new Vector4(at.X, at.Y, entry.position.Z, 1.0);
          }
        }
      }
    }
    let s = projector.Project(new Vector4(point.X, point.Y, point.Z, 1.0));
    if s.W <= 0.0 || s.W > 200.0 || AbsF(s.X) > 1.1 || AbsF(s.Y) > 1.1 {
      return false;
    }
    let mark = this.PinMark(slot);
    XFInkPins.Badge(mark, entry.label, true);
    let units = this.m_units > 0.0 ? this.m_units : 1.0;
    let at = this.ScreenPoint(s);
    // Above the game's own marker (about 60 design units tall at the point).
    mark.SetTranslation(new Vector2(at.X, at.Y - 64.0 * units));
    let size = ClampF(8.0 / MaxF(s.W, 1.0), 0.55, 1.0) * units;
    mark.SetScale(new Vector2(size, size));
    mark.SetVisible(true);
    XFInkPins.NoteDrawn(entry, "xf_overlay");
    return true;
  }
}

// ---- 0.7: answering XF Studio's questions from the game (session 7, in-game driving) ------------------------------------

// The maintainer can't see the chat while the game is in front, so an ask (ui.message level ask) shows its answers in the
// panel with a key each ([ui] answer_keys, F6 F7 F8 F11 by default: unbound in the 2.31 defaults). Codeware's callback
// system delivers the raw key (Input/Key, KeyInputEvent; no input binding needed) to this scriptable system; a press of
// one of the pending ask's keys answers it through XFBridge_Answer, which records the answer in the session's event
// stream (session.wait returns it). Keys do nothing while no ask is drawn, and they still reach the game (which binds none
// of them by default). Without Codeware there is no ink panel either, and the CET window's buttons answer instead.
// RB-114: a key answers the question the panel shows (the drawn frame's askId, as the CET buttons answer the one their
// window shows), never a newer one that arrived since the panel last drew.
@if(ModuleExists("Codeware"))
public class XFAnswerKeys extends ScriptableSystem {
  private func OnAttach() -> Void {
    GameInstance.GetCallbackSystem().RegisterCallback(n"Input/Key", this, n"OnXFKey");
  }

  private cb func OnXFKey(event: ref<KeyInputEvent>) {
    if NotEquals(event.GetAction(), EInputAction.IACT_Press) {
      return;
    }
    let overlay = XFInkOverlay.Get();
    if !IsDefined(overlay) {
      return;
    }
    let frame = overlay.DrawnAsk();
    if !IsDefined(frame) || !frame.valid || frame.askId <= 0 {
      return;
    }
    let key = EnumValueToString("EInputKey", Cast<Int64>(EnumInt(event.GetKey())));
    let choice = -1;
    let i = 0;
    while i < ArraySize(frame.askKeys) {
      if Equals(frame.askKeys[i], key) {
        choice = i;
      }
      i += 1;
    }
    if choice < 0 {
      return;
    }
    let answer = XFBridge_Answer(frame.askId, choice, "ink_key");
    XFBridgeLog.Info("ink", "answer key " + key + " -> choice " + IntToString(choice) + ": " + answer);
  }
}
