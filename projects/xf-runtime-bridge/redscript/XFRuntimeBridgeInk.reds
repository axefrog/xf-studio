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

  public static func Parse(text: String) -> ref<XFHudFrame> {
    let frame = new XFHudFrame();
    frame.layer = "hud";
    frame.anchor = "top_right";
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

  public static func Anchor(name: String) -> inkEAnchor {
    if Equals(name, "top_left") {
      return inkEAnchor.TopLeft;
    }
    if Equals(name, "bottom_left") {
      return inkEAnchor.BottomLeft;
    }
    if Equals(name, "bottom_right") {
      return inkEAnchor.BottomRight;
    }
    if Equals(name, "top_center") {
      return inkEAnchor.TopCenter;
    }
    if Equals(name, "center_left") {
      return inkEAnchor.CenterLeft;
    }
    if Equals(name, "center_right") {
      return inkEAnchor.CenterRight;
    }
    return inkEAnchor.TopRight;
  }

  // The panel's own point that sits at the anchor, so it grows away from its corner.
  public static func AnchorPoint(name: String) -> Vector2 {
    if Equals(name, "top_left") {
      return new Vector2(0.0, 0.0);
    }
    if Equals(name, "bottom_left") {
      return new Vector2(0.0, 1.0);
    }
    if Equals(name, "bottom_right") {
      return new Vector2(1.0, 1.0);
    }
    if Equals(name, "top_center") {
      return new Vector2(0.5, 0.0);
    }
    if Equals(name, "center_left") {
      return new Vector2(0.0, 0.5);
    }
    if Equals(name, "center_right") {
      return new Vector2(1.0, 0.5);
    }
    return new Vector2(1.0, 0.0);
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
  private let m_diamond: ref<inkRectangle>;
  private let m_status: ref<inkText>;
  private let m_messages: array<ref<inkText>>;
  private let m_platesRoot: ref<inkCanvas>;
  private let m_plates: array<ref<inkText>>;
  private let m_frame: ref<XFHudFrame>;
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

  private func Build(parent: wref<inkCompoundWidget>) -> Void {
    // The overlay is 2160 units high whatever the resolution and as wide as the screen's aspect makes it, scaled to the
    // screen (a uniform scale, so text keeps its shape on ultrawide screens).
    let screen = this.ScreenSize();
    let factor = screen.Y > 100.0 ? screen.Y / 2160.0 : 1.0;
    this.m_height = 2160.0;
    this.m_width = screen.Y > 100.0 ? 2160.0 * screen.X / screen.Y : 3840.0;
    let root = new inkCanvas();
    root.SetName(n"xfs_overlay");
    root.SetAnchor(inkEAnchor.TopLeft);
    root.SetSize(new Vector2(this.m_width, this.m_height));
    root.SetRenderTransformPivot(new Vector2(0.0, 0.0));
    root.SetScale(new Vector2(factor, factor));
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

    let panel = new inkCanvas();
    panel.SetName(n"xfs_hud_panel");
    panel.SetFitToContent(true);
    panel.Reparent(root);
    this.m_panel = panel;

    let back = new inkRectangle();
    back.SetName(n"back");
    back.SetAnchor(inkEAnchor.Fill);
    back.SetTintColor(new HDRColor(0.035, 0.035, 0.06, 1.0));
    back.SetOpacity(0.62);
    back.Reparent(panel);

    let edge = new inkRectangle();
    edge.SetName(n"edge");
    edge.SetAnchor(inkEAnchor.LeftFillVerticaly);
    edge.SetSize(new Vector2(4.0, 10.0));
    XFInkStyle.Bind(edge, n"MainColors.Red");
    edge.Reparent(panel);

    let body = new inkVerticalPanel();
    body.SetName(n"body");
    body.SetFitToContent(true);
    body.SetMargin(new inkMargin(28.0, 16.0, 28.0, 20.0));
    body.Reparent(panel);

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
      line.SetWrappingAtPosition(760.0);
      line.SetVisible(false);
      line.Reparent(body);
      ArrayPush(this.m_messages, line);
      i += 1;
    }

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
    this.m_panel.SetAnchor(XFInkStyle.Anchor(frame.anchor));
    this.m_panel.SetAnchorPoint(XFInkStyle.AnchorPoint(frame.anchor));
    this.m_panel.SetRenderTransformPivot(XFInkStyle.AnchorPoint(frame.anchor));
    this.m_panel.SetMargin(new inkMargin(frame.x, frame.y, frame.x, frame.y));
    this.m_panel.SetScale(new Vector2(frame.scale, frame.scale));
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
    this.m_platesRoot.SetVisible(frame.nameplates);
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
    plate.SetTranslation(new Vector2((s.X + 1.0) * 0.5 * this.m_width, (s.Y + 1.0) * 0.5 * this.m_height));
    let size = ClampF(3.0 / MaxF(s.W, 0.5), 0.55, 1.0);
    plate.SetScale(new Vector2(size, size));
    plate.SetOpacity(ClampF((15.0 - s.W) / 5.0, 0.0, 1.0));
    plate.SetVisible(true);
    return true;
  }
}
