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

  // 0.8.6: the ink layer the overlay mounts on for ui.hud's layer: photo_menu is the HUD layer (photo mode's menu has its own
  // panel, XFPhotoMenuPanel).
  public static func HostLayer(layer: String) -> String {
    return Equals(layer, "photo_menu") ? "hud" : layer;
  }

  // The layer's root compound: "Root" under its virtual window where there is one (the HUD layer), else the window itself.
  // 0.8.6: photo_menu is the HUD layer here; inside photo mode the panel lives under photo mode's menu (XFPhotoMenuPanel).
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

  public static func HostLayer(layer: String) -> String {
    return Equals(layer, "photo_menu") ? "hud" : layer;
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
  // 0.8.6: ui.hud's modal (0.8.7: the panel inside photo mode's menu holds photo mode's exit while this is set).
  public let modal: Bool;

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
                              } else {
                                if Equals(key, "modal") {
                                  frame.modal = Equals(f[1], "1");
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
}

// ---- The game's look: its font family and colour tokens ----------------------------------------------------------------

public abstract class XFInkStyle {
  // 0.8.9: a phone screen is open on the HUD: the contact list or dialer (UI_ComDevice.ContactsActive, phoneSystem.script:177),
  // the text messenger (SmsMessengerActive, the player's context listener, player.script:1621-1622) or a message being read
  // (isDisplayingMessage, messagePopup.script:84 and 237). The journal, the codex and the other menus hide the HUD layer
  // themselves. 0.8.18 (Borg 3, DP3: the panel covered the incoming-call widget, its answer and reject key hints): the call
  // widget is one of the phone's screens too, up from the first ring (IncomingCall) through the call (StartCall) until it ends
  // (UI_ComDevice.PhoneCallInformation, the variant the HUD phone reads, newHudPhoneGameController.script:459 and 1000-1010).
  public static func CallWidgetUp() -> Bool {
    let defs = GetAllBlackboardDefs().UI_ComDevice;
    let board = GameInstance.GetBlackboardSystem(GetGameInstance()).Get(defs);
    if !IsDefined(board) {
      return false;
    }
    let info = FromVariant<PhoneCallInformation>(board.GetVariant(defs.PhoneCallInformation));
    return Equals(info.callPhase, questPhoneCallPhase.IncomingCall) || Equals(info.callPhase, questPhoneCallPhase.StartCall);
  }

  public static func PhoneOpen() -> Bool {
    let defs = GetAllBlackboardDefs().UI_ComDevice;
    let board = GameInstance.GetBlackboardSystem(GetGameInstance()).Get(defs);
    if !IsDefined(board) {
      return false;
    }
    let contacts = board.GetBool(defs.ContactsActive);
    let messenger = board.GetBool(defs.SmsMessengerActive);
    let reading = board.GetBool(defs.isDisplayingMessage);
    return contacts || messenger || reading || XFInkStyle.CallWidgetUp();
  }

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

  // 0.8.3 (session 10's B1 and B2: every anchor sat 280 to 350 px too low at 3840 x 1600, bottom_left below the screen): the
  // HUD layer's root does NOT show the middle of its 3840 x 2160 canvas. Its top-left corner is the screen's top-left corner
  // and its width the screen's width (session 10: margins of 640 and 340 units landed at about 640 and 360 px on a 1600 px
  // high screen, and top_right ended at the right edge), so the visible screen is the canvas's top 3840 / aspect units and
  // the rest hangs below the screen (0.8 had assumed the middle, and pushed every panel 280 units down). This is the model,
  // used until the overlay can measure: rootWidth x screenHeight * rootWidth / screenWidth from the root's top-left.
  public static func ModelVisible(rootWidth: Float, rootHeight: Float, screen: Vector2) -> Vector4 {
    if screen.X < 100.0 || screen.Y < 100.0 || rootWidth < 100.0 {
      return new Vector4(0.0, 0.0, rootWidth, rootHeight);
    }
    return new Vector4(0.0, 0.0, rootWidth, screen.Y * rootWidth / screen.X);
  }

  // 0.8.3: the visible screen as the game's own layout measures it: the screen's corners (window pixels, as the game's menus
  // compare a pointer's screen position with LocalToGlobal) mapped into the overlay's units by WidgetUtils.GlobalToLocal,
  // the inverse of what the game's perks screen uses to place its tooltips. Accepted only when it is plausible (a finite
  // area of the screen's own aspect, near the root); otherwise zero, and the model stands.
  public static func Plausible(a: Vector2, b: Vector2, screen: Vector2, rootWidth: Float, rootHeight: Float) -> Vector4 {
    let w = b.X - a.X;
    let h = b.Y - a.Y;
    if screen.X < 100.0 || screen.Y < 100.0 || !(w > 100.0) || !(h > 100.0) || w > rootWidth * 8.0 || h > rootHeight * 8.0 {
      return new Vector4(0.0, 0.0, 0.0, 0.0);
    }
    if !(AbsF(a.X) < rootWidth * 4.0) || !(AbsF(a.Y) < rootHeight * 4.0) || AbsF(w / h - screen.X / screen.Y) > 0.02 * screen.X / screen.Y {
      return new Vector4(0.0, 0.0, 0.0, 0.0);
    }
    return new Vector4(a.X, a.Y, w, h);
  }

  // The screen's size: 0.8.3, the game window's own size in pixels (UISystem.GetCurrentWindowSize, which the radial menu
  // uses for the mouse); else the display settings' resolution (as Codeware's ScreenHelper reads it). 0.8.6: here, for both
  // panels (it was XFInkOverlay's).
  public static func ScreenSize() -> Vector2 {
    let ui = GameInstance.GetUISystem(GetGameInstance());
    if IsDefined(ui) {
      let window = ui.GetCurrentWindowSize();
      if window.X > 100.0 && window.Y > 100.0 {
        return window;
      }
    }
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

  // 0.8.3: the visible screen in a laid-out widget's units, measured by the game's own layout (the window's corners through
  // WidgetUtils.GlobalToLocal), when it is plausible (Plausible); else zero, and the caller keeps its model. 0.8.6: here, for
  // both panels.
  public static func MeasureVisible(local: ref<inkWidget>, screen: Vector2, width: Float, height: Float) -> Vector4 {
    if !IsDefined(local) {
      return new Vector4(0.0, 0.0, 0.0, 0.0);
    }
    let a = WidgetUtils.GlobalToLocal(local, new Vector2(0.0, 0.0));
    let b = WidgetUtils.GlobalToLocal(local, new Vector2(screen.X, screen.Y));
    return XFInkStyle.Plausible(a, b, screen, width, height);
  }

  // 0.8.3 (session 10: top_right overlapped the minimap and the quest tracker): how far in from its edges each anchor keeps
  // the panel at least, in the HUD's design units (2160 per screen height: the game's HUD scales with the screen's height,
  // its minimap 375 px wide on a 1600 px high screen), so it clears the game's own HUD blocks, measured on session 10's
  // gameplay capture at 3840 x 1600: the minimap and the quest tracker at the top right (about 790 units wide, the tracker
  // reaching about 930 units down with two objectives), the status and cyberware icons at the bottom left (about 570 wide,
  // 440 high), the prompts and the weapon block at the bottom right, the status bars at the top left (the default 40, 360
  // sits under them) and subtitles at the bottom centre. The right edge's free height between the quest tracker (which can
  // grow to about 1250 units) and the weapon block is less than a panel, so bottom_right keeps left of both, as top_right and
  // center_right do. x is the floor from a left or right edge, y from a top or bottom edge; a middle axis has none. tools/overlay/ink-place.ts has the same table and checks it at 16:9, 21:9 and 32:9.
  public static func Floor(name: String) -> Vector2 {
    if Equals(name, "top_left") {
      return new Vector2(0.0, 300.0);
    }
    if Equals(name, "top_center") {
      return new Vector2(0.0, 140.0);
    }
    if Equals(name, "top_right") || Equals(name, "center_right") {
      return new Vector2(860.0, 0.0);
    }
    if Equals(name, "bottom_left") {
      return new Vector2(0.0, 520.0);
    }
    if Equals(name, "bottom_center") {
      return new Vector2(0.0, 480.0);
    }
    if Equals(name, "bottom_right") {
      return new Vector2(860.0, 480.0);
    }
    return new Vector2(0.0, 0.0);
  }

  // 0.8.10 (session 16's D1r: the pin mark at the side edge landed inside the minimap on the right and over the status bars
  // above the ink panel on the left): the game's own HUD blocks as rectangles in the root's units (left, top, width, height) for
  // the visible screen v, from Floor's measurements in design units (2160 per screen height): the minimap and the quest tracker
  // at the top right (the tracker grows to about 1250 units), the weapon block and prompts at the bottom right, the status bars
  // at the top left and the status and cyberware icons at the bottom left. tools/overlay/ink-place.ts has the same table.
  public static func HudBlocks(v: Vector4) -> array<Vector4> {
    let h = v.W / 2160.0;
    let blocks: array<Vector4>;
    ArrayPush(blocks, new Vector4(v.X + v.Z - 860.0 * h, v.Y, 860.0 * h, 1250.0 * h));
    ArrayPush(blocks, new Vector4(v.X + v.Z - 860.0 * h, v.Y + v.W - 480.0 * h, 860.0 * h, 480.0 * h));
    ArrayPush(blocks, new Vector4(v.X, v.Y, 700.0 * h, 300.0 * h));
    ArrayPush(blocks, new Vector4(v.X, v.Y + v.W - 520.0 * h, 570.0 * h, 520.0 * h));
    return blocks;
  }

  // The Sol review of 0.8.10, finding 2: a mark on a side edge keeps its left and moves along the edge only, to the nearest free
  // interval: the asked top when it is clear, else the nearest top just above or below a zone that it hits, inside the visible
  // screen v and clear of every zone (gap apart). With no free interval it stays where it was asked (clamped). The photo-menu
  // rule's Avoid can alternate between two zones and land across the screen; an edge mark must never leave its edge.
  public static func SlideAlong(r: Vector4, zones: array<Vector4>, v: Vector4, gap: Float) -> Vector4 {
    let low = v.Y + gap;
    let high = MaxF(low, v.Y + v.W - gap - r.W);
    let asked = ClampF(r.Y, low, high);
    let best = asked;
    if XFInkStyle.Clear(new Vector4(r.X, asked, r.Z, r.W), zones, gap) {
      return new Vector4(r.X, asked, r.Z, r.W);
    }
    let found = false;
    let bestAt = 0.0;
    let i = 0;
    while i < ArraySize(zones) {
      let k = 0;
      while k < 2 {
        let top = k == 0 ? zones[i].Y - gap - r.W : zones[i].Y + zones[i].W + gap;
        if top >= low && top <= high && XFInkStyle.Clear(new Vector4(r.X, top, r.Z, r.W), zones, gap) {
          if !found || AbsF(top - asked) < AbsF(bestAt - asked) {
            found = true;
            bestAt = top;
          }
        }
        k += 1;
      }
      i += 1;
    }
    if found {
      best = bestAt;
    }
    return new Vector4(r.X, best, r.Z, r.W);
  }

  // 0.8.9 (session 15's A5): the panel's rectangle p (left, top, width, height) kept out of photo mode's zones (its menu, its
  // top bar, the title row with its icon, its hint strips) inside the visible screen v, gap apart. The asked place when it is
  // clear; else the panel slides out of each zone it meets along its anchor's own edge first (sideways for a top or bottom
  // anchor, so bottom_right goes left of the menu, not up over it), then the other way, up to four zones; if it still meets
  // one, the first free corner, the anchor's own side first; how names which ("kept", "nudged", "corner:<the corner it
  // started from>" or "overlapping"). tools/overlay/ink-place.ts has the same rule (avoidZones) and tests it.
  public static func Avoid(p: Vector4, zones: array<Vector4>, v: Vector4, gap: Float, anchor: String, out how: String) -> Vector4 {
    let asked = XFInkStyle.Inside(p, v, gap);
    if XFInkStyle.Clear(asked, zones, gap) {
      how = "kept";
      return asked;
    }
    let sideways = !StrBeginsWith(anchor, "center");
    let nudged = XFInkStyle.Nudge(asked, zones, v, gap, sideways);
    if XFInkStyle.Clear(nudged, zones, gap) {
      how = "nudged";
      return nudged;
    }
    let bottom = !StrBeginsWith(anchor, "top");
    let right = !StrEndsWith(anchor, "left");
    let k = 0;
    while k < 4 {
      // The anchor's own edge on the other side, its own side on the other edge, the opposite corner, then its own corner.
      let cb = k == 0 || k == 3 ? bottom : !bottom;
      let cr = k == 1 || k == 3 ? right : !right;
      let at = new Vector4(cr ? v.X + v.Z - gap - p.Z : v.X + gap, cb ? v.Y + v.W - gap - p.W : v.Y + gap, p.Z, p.W);
      let r = XFInkStyle.Nudge(at, zones, v, gap, true);
      if XFInkStyle.Clear(r, zones, gap) {
        how = "corner:" + (cb ? "bottom" : "top") + (cr ? "_right" : "_left");
        return r;
      }
      k += 1;
    }
    how = "overlapping";
    return nudged;
  }

  public static func Hit(r: Vector4, z: Vector4, gap: Float) -> Bool {
    return r.X < z.X + z.Z + gap && r.X + r.Z + gap > z.X && r.Y < z.Y + z.W + gap && r.Y + r.W + gap > z.Y;
  }

  public static func Clear(r: Vector4, zones: array<Vector4>, gap: Float) -> Bool {
    let i = 0;
    while i < ArraySize(zones) {
      if XFInkStyle.Hit(r, zones[i], gap) {
        return false;
      }
      i += 1;
    }
    return true;
  }

  public static func Inside(r: Vector4, v: Vector4, gap: Float) -> Vector4 {
    return new Vector4(ClampF(r.X, v.X + gap, MaxF(v.X + gap, v.X + v.Z - gap - r.Z)), ClampF(r.Y, v.Y + gap, MaxF(v.Y + gap, v.Y + v.W - gap - r.W)), r.Z, r.W);
  }

  // UI-221 fix 4: stay within one panel width of the starting place, including when trying a corner. A longer slide
  // leaves the panel floating in the scene; Avoid then takes the first free corner. Pin marks use SlideAlong instead.
  // One zone at a time (up to four): the nearer side of the anchor's own axis first, then the other axis.
  public static func Nudge(r: Vector4, zones: array<Vector4>, v: Vector4, gap: Float, sideways: Bool) -> Vector4 {
    let out = XFInkStyle.Inside(r, v, gap);
    let pass = 0;
    while pass < 4 {
      let found = -1;
      let i = 0;
      while i < ArraySize(zones) && found < 0 {
        if XFInkStyle.Hit(out, zones[i], gap) {
          found = i;
        }
        i += 1;
      }
      if found < 0 {
        return out;
      }
      let z = zones[found];
      let leftOf = new Vector4(z.X - gap - out.Z, out.Y, out.Z, out.W);
      let rightOf = new Vector4(z.X + z.Z + gap, out.Y, out.Z, out.W);
      let above = new Vector4(out.X, z.Y - gap - out.W, out.Z, out.W);
      let below = new Vector4(out.X, z.Y + z.W + gap, out.Z, out.W);
      let across1 = AbsF(leftOf.X - out.X) <= AbsF(rightOf.X - out.X) ? leftOf : rightOf;
      let across2 = AbsF(leftOf.X - out.X) <= AbsF(rightOf.X - out.X) ? rightOf : leftOf;
      let along1 = AbsF(above.Y - out.Y) <= AbsF(below.Y - out.Y) ? above : below;
      let along2 = AbsF(above.Y - out.Y) <= AbsF(below.Y - out.Y) ? below : above;
      let tries: array<Vector4>;
      if sideways {
        ArrayPush(tries, across1);
        ArrayPush(tries, across2);
        ArrayPush(tries, along1);
        ArrayPush(tries, along2);
      } else {
        ArrayPush(tries, along1);
        ArrayPush(tries, along2);
        ArrayPush(tries, across1);
        ArrayPush(tries, across2);
      }
      let moved = false;
      let t = 0;
      while t < 4 && !moved {
        let c = XFInkStyle.Inside(tries[t], v, gap);
        if AbsF(c.X - r.X) <= r.Z && AbsF(c.Y - r.Y) <= r.Z && !XFInkStyle.Hit(c, z, gap) {
          out = c;
          moved = true;
        }
        t += 1;
      }
      if !moved {
        return out;
      }
      pass += 1;
    }
    return out;
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
  public let right: Vector4;
  public let up: Vector4;
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
    p.right = r;
    p.up = u;
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

  // 0.8.9 (session 15's D1: turned 120 degrees away, the XF mark drew low in the middle while the game's marker sat at the
  // right edge): Project answers (0, 0, 0, 0) for a point behind the camera, so the edge rule had no direction and fell to
  // straight down. The way to a point on screen terms, from the camera's own right and up: x to the right, y down.
  public func Direction(point: Vector4) -> Vector2 {
    let d = new Vector4(point.X - this.position.X, point.Y - this.position.Y, point.Z - this.position.Z, 0.0);
    let x = d.X * this.right.X + d.Y * this.right.Y + d.Z * this.right.Z;
    let y = -(d.X * this.up.X + d.Y * this.up.Y + d.Z * this.up.Z);
    return new Vector2(x, y);
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

// 0.8.11 (session 17: the tag read "TEST - LAYER PHOTO_MENU" in normal play, the configured layer's raw name and not where it
// draws): the surface the panel is on, in plain words, and only when the layer was moved off the default (ui_hud's layer
// check); the default layer (photo_menu: the HUD in play, photo mode's menu inside it) shows just "test".
public abstract class XFInkWhere {
  public static func Of(layer: String) -> String {
    if Equals(layer, "hud") {
      return "HUD";
    }
    if Equals(layer, "notifications") {
      return "notifications layer";
    }
    if Equals(layer, "top") {
      return "top layer";
    }
    return "";
  }
}

// ---- The panel's widgets (0.8.6: shared by the HUD overlay and the panel inside photo mode's menu) ----------------------

// The ink panel itself: the game's dark plate with the red edge, the heading, the status line, up to four message lines and
// the answers. 0.8.6: moved out of XFInkOverlay so that the panel inside photo mode's menu (XFPhotoMenuPanel) is the same
// widgets filled from the same frame; the only change is the answers, now one text each (so a click in photo mode can tell
// them apart) in a row where 0.8.5 had one text for all, spaced as its five spaces were.

public class XFInkPanel {
  public let canvas: ref<inkCanvas>;
  // 0.8 (session 8: the plate wasn't drawn; a Fill rectangle in a fit-to-content canvas got no size): the plate and the red
  // edge are sized from the body's own measured size on every frame read.
  private let m_body: ref<inkVerticalPanel>;
  private let m_plate: ref<inkRectangle>;
  private let m_under: ref<inkRectangle>;
  private let m_edge: ref<inkRectangle>;
  private let m_diamond: ref<inkRectangle>;
  private let m_tag: ref<inkText>;
  private let m_status: ref<inkText>;
  private let m_messages: array<ref<inkText>>;
  private let m_row: ref<inkHorizontalPanel>;
  private let m_answered: ref<inkText>;
  private let m_chips: array<ref<inkText>>;
  private let m_hovered: Int32;
  // 0.8.11 (UI review of 0.8.11, fix 3): the line under the answers (photo mode's menu only: it holds the place while a question
  // waits, so a held Esc fills it without moving anything) and the answers' flash.
  private let m_hint: ref<inkText>;
  private let m_hintReserved: Bool;
  private let m_flash: Float;
  // RB-114: the frame whose question and answer keys are on screen now (set when Apply draws them).
  public let drawn: ref<XFHudFrame>;

  public static func Create(parent: wref<inkCompoundWidget>, name: CName) -> ref<XFInkPanel> {
    let view = new XFInkPanel();
    view.m_hovered = -1;
    let panel = new inkCanvas();
    panel.SetName(name);
    panel.SetAnchor(inkEAnchor.TopLeft);
    panel.SetFitToContent(true);
    panel.Reparent(parent);
    view.canvas = panel;

    // 0.8 (the UI review): the game's own dark plate (its settings dialog's, MainColors.Fullscreen_PrimaryBackgroundDarkest)
    // so the panel reads over bright scenes, with the red edge; both sized from the body in SizePlate. 0.8.3 (session 10: hard
    // to read over the minimap and the quest tracker): an opaque near-black underlay below it, and the plate itself at full
    // opacity (the style's own colour may carry some transparency), so almost nothing shows through.
    let under = new inkRectangle();
    under.SetName(n"under");
    under.SetAnchor(inkEAnchor.TopLeft);
    under.SetSize(new Vector2(10.0, 10.0));
    under.SetTintColor(new HDRColor(0.0, 0.0, 0.0, 1.0));
    under.SetOpacity(0.88);
    under.Reparent(panel);
    view.m_under = under;
    let back = new inkRectangle();
    back.SetName(n"back");
    back.SetAnchor(inkEAnchor.TopLeft);
    back.SetSize(new Vector2(10.0, 10.0));
    XFInkStyle.Bind(back, n"MainColors.Fullscreen_PrimaryBackgroundDarkest");
    back.SetOpacity(1.0);
    back.Reparent(panel);
    view.m_plate = back;

    let edge = new inkRectangle();
    edge.SetName(n"edge");
    edge.SetAnchor(inkEAnchor.TopLeft);
    edge.SetSize(new Vector2(4.0, 10.0));
    XFInkStyle.Bind(edge, n"MainColors.Red");
    edge.Reparent(panel);
    view.m_edge = edge;

    let body = new inkVerticalPanel();
    body.SetName(n"body");
    body.SetAnchor(inkEAnchor.TopLeft);
    body.SetFitToContent(true);
    body.SetMargin(new inkMargin(28.0, 16.0, 0.0, 0.0));
    body.Reparent(panel);
    view.m_body = body;

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
    view.m_diamond = diamond;

    let title = XFInkStyle.Text(n"title", 32, n"Semi-Bold", n"MainColors.Red", true);
    title.SetText("XF Runtime Bridge");
    title.Reparent(header);

    let tag = XFInkStyle.Text(n"tag", 22, n"Medium", n"MainColors.MildRed", true);
    tag.SetText("test");
    tag.SetVAlign(inkEVerticalAlign.Center);
    tag.SetMargin(new inkMargin(16.0, 0.0, 0.0, 0.0));
    tag.Reparent(header);
    view.m_tag = tag;

    let status = XFInkStyle.Text(n"status", 26, n"Medium", n"MainColors.Grey", false);
    status.SetMargin(new inkMargin(0.0, 6.0, 0.0, 4.0));
    status.Reparent(body);
    view.m_status = status;

    let i = 0;
    while i < 4 {
      let line = XFInkStyle.Text(StringToName("message" + IntToString(i)), 26, n"Regular", n"MainColors.Blue", false);
      line.SetMargin(new inkMargin(0.0, 4.0, 0.0, 0.0));
      line.SetWrappingAtPosition(980.0);
      line.SetVisible(false);
      line.Reparent(body);
      ArrayPush(view.m_messages, line);
      i += 1;
    }

    // 0.7: the pending ask's answers and the keys that give them ("[F6] Ready   [F7] Yes   [F8] No"); 0.8.6: one text each.
    let row = new inkHorizontalPanel();
    row.SetName(n"choices");
    row.SetFitToContent(true);
    row.SetMargin(new inkMargin(0.0, 8.0, 0.0, 0.0));
    row.SetVisible(false);
    row.Reparent(body);
    view.m_row = row;
    let answered = XFInkStyle.Text(n"answered", 28, n"Semi-Bold", n"MainColors.Yellow", false);
    answered.SetVisible(false);
    answered.Reparent(row);
    view.m_answered = answered;
    let k = 0;
    while k < 4 {
      let chip = XFInkStyle.Text(StringToName("answer" + IntToString(k)), 28, n"Semi-Bold", n"MainColors.Yellow", false);
      chip.SetMargin(new inkMargin(k > 0 ? 36.0 : 0.0, 0.0, 0.0, 0.0));
      chip.SetVisible(false);
      chip.Reparent(row);
      ArrayPush(view.m_chips, chip);
      k += 1;
    }
    let hint = XFInkStyle.Text(n"hint", 24, n"Regular", n"MainColors.Grey", false);
    hint.SetMargin(new inkMargin(0.0, 6.0, 0.0, 0.0));
    hint.SetWrappingAtPosition(980.0);
    hint.SetVisible(false);
    hint.Reparent(body);
    view.m_hint = hint;
    return view;
  }

  public func Plate() -> ref<inkRectangle> {
    return this.m_plate;
  }

  // 0.8.11 (UI review of 0.8.11, fix 3): photo mode's menu panel keeps a line under the question for a note (a held Esc says so
  // there); the line holds its place, empty, while a question waits. ShowHint("") empties it.
  public func ReserveHint() -> Void {
    this.m_hintReserved = true;
  }

  public func ShowHint(text: String) -> Void {
    this.m_hint.SetText(StrLen(text) > 0 ? text : " ");
  }

  // The answers flash (red and back) for a moment: a key that did nothing is seen to have done nothing.
  public func Flash() -> Void {
    this.m_flash = 0.9;
  }

  public func Step(dt: Float) -> Void {
    if this.m_flash <= 0.0 {
      return;
    }
    this.m_flash -= dt;
    if this.m_flash <= 0.0 {
      this.m_flash = 0.0;
      this.SetHovered(this.m_hovered);
      return;
    }
    let on = (Cast<Int32>(this.m_flash / 0.15) % 2) == 0;
    let i = 0;
    while i < ArraySize(this.m_chips) {
      XFInkStyle.Bind(this.m_chips[i], on ? n"MainColors.Red" : n"MainColors.Yellow");
      i += 1;
    }
  }

  // 0.8.10 (session 16's A7r: after a reopen the HUD-layer panel could not be told from the one inside photo mode's menu): the
  // tag beside the heading names where this panel is drawn, in plain words (XFInkWhere); "test" alone for the default layer.
  public func SetWhere(place: String) -> Void {
    this.m_tag.SetText(StrLen(place) > 0 ? "test · " + place : "test");
  }

  public func ChipCount() -> Int32 {
    return ArraySize(this.m_chips);
  }

  public func Chip(index: Int32) -> ref<inkText> {
    return index >= 0 && index < ArraySize(this.m_chips) ? this.m_chips[index] : null;
  }

  // Which answer a widget is, or -1.
  public func ChipIndex(widget: ref<inkWidget>) -> Int32 {
    let i = 0;
    while i < ArraySize(this.m_chips) {
      let chip: ref<inkWidget> = this.m_chips[i];
      if chip == widget {
        return i;
      }
      i += 1;
    }
    return -1;
  }

  // 0.8.6: the answer under the pointer in photo mode (the game's blue, as its menus mark what the pointer is on), or -1.
  public func SetHovered(index: Int32) -> Void {
    this.m_hovered = index;
    let i = 0;
    while i < ArraySize(this.m_chips) {
      XFInkStyle.Bind(this.m_chips[i], i == index ? n"MainColors.Blue" : n"MainColors.Yellow");
      i += 1;
    }
  }

  // The frame's texts and tones. keys: the answers name their keys ("[F6] Done"); without Codeware no key answers, and the
  // panel inside photo mode's menu shows the answers alone, to click.
  public func Apply(frame: ref<XFHudFrame>, keys: Bool) -> Void {
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
      this.drawn = frame;
    } else {
      this.drawn = null;
    }
    let count = ArraySize(frame.askKeys);
    let k = 0;
    while k < ArraySize(this.m_chips) {
      let chip = this.m_chips[k];
      if k < count {
        // 0.8.6 (the Sol review): every choice is in the frame; one beyond the configured keys has the key "-" and shows its label
        // alone (on the HUD it is answered in the XF Runtime Bridge window, in photo mode by a click).
        let key = StrBeginsWith(frame.askKeys[k], "IK_") ? StrAfterFirst(frame.askKeys[k], "IK_") : frame.askKeys[k];
        let keyed = keys && NotEquals(frame.askKeys[k], "-") && NotEquals(frame.askKeys[k], "");
        chip.SetText(keyed ? "[" + key + "] " + frame.askLabels[k] : frame.askLabels[k]);
        chip.SetVisible(true);
      } else {
        chip.SetVisible(false);
      }
      k += 1;
    }
    if count == 0 && this.m_hovered >= 0 {
      this.SetHovered(-1);
    }
    // 0.8 (the UI review): once answered, the same line, same place and size, says what was answered.
    let answered = count == 0 && frame.answeredId > 0;
    this.m_answered.SetVisible(answered);
    if answered {
      this.m_answered.SetText("Answered: " + frame.answeredLabel);
    }
    this.m_row.SetVisible(count > 0 || answered);
    this.m_hint.SetVisible(this.m_hintReserved && count > 0);
  }

  // 0.8: the plate and the edge at the body's measured size (its content plus the body's margins); nothing until measured.
  public func SizePlate() -> Void {
    let size = this.m_body.GetDesiredSize();
    if size.X < 1.0 || size.Y < 1.0 {
      // The arranged size where the measured one isn't there (yet).
      size = this.canvas.GetChildSize(this.m_body);
    }
    if size.X < 1.0 || size.Y < 1.0 {
      return;
    }
    let w = size.X + 56.0;
    let h = size.Y + 36.0;
    this.m_plate.SetSize(new Vector2(w, h));
    this.m_under.SetSize(new Vector2(w, h));
    this.m_edge.SetSize(new Vector2(4.0, h));
  }

  // 0.8.2 (session 9's B1 and B2): the panel's top-left corner, worked out here and set as a margin from the root's top
  // left (session 10 proved the horizontal placement: top_right whole and right-aligned). The anchor's point of the visible
  // screen v (in the root's units) is moved inwards by x and y (from the middle for center), at least by the anchor's floor
  // where floors is set (0.8.3, XFInkStyle.Floor: clear of the game's own HUD blocks; 0.8.6: not in photo mode's menu, which
  // has no HUD), the panel's own point there is the same fractions of its measured size (scaled), and the whole panel is kept
  // inside the visible screen. An anchor other than top_left waits unseen until the panel has been measured, so it never
  // shows in the wrong place. 0.8.7: answers where it went (left, top, width, height), for the photo-menu panel's safe zones.
  public func Place(frame: ref<XFHudFrame>, scale: Float, v: Vector4, units: Float, floors: Bool) -> Vector4 {
    let point = XFInkStyle.AnchorPoint(frame.anchor);
    let size = this.m_plate.GetSize();
    let w = size.X * scale;
    let h = size.Y * scale;
    let measured = w > 20.0 && h > 20.0;
    let floor = floors ? XFInkStyle.Floor(frame.anchor) : new Vector2(0.0, 0.0);
    let hud = v.W / 2160.0;
    let ox = floor.X > 0.0 ? MaxF(frame.x * units, floor.X * hud) : frame.x * units;
    let oy = floor.Y > 0.0 ? MaxF(frame.y * units, floor.Y * hud) : frame.y * units;
    let dx = point.X > 0.9 ? -ox : ox;
    let dy = point.Y > 0.9 ? -oy : oy;
    let left = XFInkStyle.PanelEdge(v.X, v.Z, point.X, dx, w);
    let top = XFInkStyle.PanelEdge(v.Y, v.W, point.Y, dy, h);
    if measured {
      let margin = 8.0 * units;
      left = ClampF(left, v.X + margin, MaxF(v.X + margin, v.X + v.Z - margin - w));
      top = ClampF(top, v.Y + margin, MaxF(v.Y + margin, v.Y + v.W - margin - h));
    }
    this.canvas.SetAnchor(inkEAnchor.TopLeft);
    this.canvas.SetAnchorPoint(new Vector2(0.0, 0.0));
    this.canvas.SetRenderTransformPivot(new Vector2(0.0, 0.0));
    this.canvas.SetTranslation(new Vector2(0.0, 0.0));
    this.canvas.SetMargin(new inkMargin(left, top, 0.0, 0.0));
    this.canvas.SetOpacity(measured || (point.X < 0.1 && point.Y < 0.1) ? 1.0 : 0.0);
    return new Vector4(left, top, w, h);
  }

  // 0.8.7: the panel's top-left corner moved (the photo-menu panel's safe zones), in the same units as Place.
  public func MoveTo(left: Float, top: Float) -> Void {
    this.canvas.SetMargin(new inkMargin(left, top, 0.0, 0.0));
  }

  // 0.8.7: the answer under the pointer now (SetHovered), or -1.
  public func Hovered() -> Int32 {
    return this.m_hovered;
  }

  // BEGIN XFB_AUTONOMOUS_TEST_HOOKS
  @if(ModuleExists("Codeware"))
  public func XFRecordingUi(surface: String) -> String {
    let header = this.m_body.GetWidgetByPathName(n"header") as inkCompoundWidget;
    let title = IsDefined(header) ? header.GetWidgetByPathName(n"title") as inkText : null;
    let visible = true;
    let opacity = 1.0;
    let parent: ref<inkWidget> = this.canvas;
    let depth = 0;
    while IsDefined(parent) && depth < 32 {
      visible = visible && parent.IsVisible(); opacity *= parent.GetOpacity();
      parent = parent.parentWidget; depth += 1;
    }
    let answers = "";
    for chip in this.m_chips { answers += (StrLen(answers) > 0 ? "," : "") + XFRecordingUi.Text(chip); }
    let controller = this.canvas.GetController();
    let controllerName = IsDefined(controller) ? NameToString(controller.GetClassName()) : "";
    return "{\"surface\":" + XFJson.Str(surface) + ",\"view_owner\":\"XFInkPanel\",\"ink_controller\":" + (StrLen(controllerName) > 0 ? XFJson.Str(controllerName) : "null") + ",\"rect\":" + XFRecordingUi.Rect(this.canvas)
      + ",\"effective_visible\":" + XFJson.Flag(visible && opacity > 0.0) + ",\"opacity\":" + XFJson.Num(opacity) + ",\"ancestor_limit\":" + XFJson.Flag(IsDefined(parent))
      + ",\"heading\":" + XFRecordingUi.Text(title) + ",\"tag\":" + XFRecordingUi.Text(this.m_tag) + ",\"status\":" + XFRecordingUi.Text(this.m_status)
      + ",\"help\":" + XFRecordingUi.Text(this.m_hint) + ",\"answered\":" + XFRecordingUi.Text(this.m_answered) + ",\"answers\":[" + answers + "]}";
  }
  // END XFB_AUTONOMOUS_TEST_HOOKS
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
  // 0.8.6: the panel's widgets (XFInkPanel, shared with the panel inside photo mode's menu).
  private let m_view: ref<XFInkPanel>;
  private let m_visible: Vector4; // the visible screen in the layer root's units: x, y, width, height
  private let m_screen: Vector2;
  private let m_reported: Bool;
  // 0.8.3: where m_visible came from (measured: the game's own layout, GlobalToLocal; model: XFInkStyle.ModelVisible) and
  // the geometry last announced, so a change (a measurement after the first layout, a new resolution) is announced again.
  private let m_visibleFrom: String;
  private let m_announced: String;
  private let m_phoneOpen: Bool;
  // 0.8.10: where the panel sits now (left, top, width, height, the root's units) and whether it is on screen, so a pin's edge
  // mark keeps clear of it.
  private let m_panelRect: Vector4;
  private let m_panelShown: Bool;
  private let m_units: Float;
  private let m_platesRoot: ref<inkCanvas>;
  private let m_plates: array<ref<inkText>>;
  private let m_pinsRoot: ref<inkCanvas>;     // 0.8.2: the XF pins' marks in the world
  private let m_pinMarks: array<ref<inkCanvas>>;
  private let m_frame: ref<XFHudFrame>;
  private let m_layer: String; // the layer it is mounted on (0.8.6: hud for photo_menu too, XFInkHost.HostLayer)
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
    let layer = XFInkHost.HostLayer(frame.valid ? frame.layer : "hud");
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
    this.m_view = null;
    ArrayClear(this.m_plates);
    ArrayClear(this.m_pinMarks);
    if this.m_mounted {
      XFBridgeLog.Debug("ink", "ink overlay unmounted (" + why + ")");
    }
    this.m_mounted = false;
  }

  // 0.7 (session 7: on a 3840x1600 screen the panel sat off-screen at the right edge, and at bottom left it didn't show at
  // all): the overlay no longer sizes and scales itself from the display setting. It fills the layer's root, in whatever
  // units that root lays out in, so a panel anchored to a corner is at that corner of what the layer shows (21:9, 32:9 and
  // 16:9 alike), and its margins are clamped inside it. m_units converts the panel's design (2160 units per screen height)
  // into the root's units, from the root's own size where it reports one.
  //
  // Where the screen is in the root's units (m_visible; every anchor is a corner, edge or middle of it). 0.8 assumed the HUD's
  // 3840 x 2160 canvas COVERED the screen centred, so on 21:9 its top and bottom 280 units were off screen; session 10
  // showed that every anchor then sat about 280 units too low: the root's top-left corner is the screen's (XFInkStyle
  // ModelVisible). 0.8.3 measures it from the game's own layout once the overlay has been laid out (WidgetUtils.GlobalToLocal
  // of the window's corners, XFInkStyle.Plausible) and uses the corrected model until then. The root's size, the screen,
  // the visible part and where it came from are announced whenever they change (layers.status and the plugin log's
  // "panel geometry" line), so a session can check the arithmetic against a capture.
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
    this.m_screen = XFInkStyle.ScreenSize();
    let measured = XFInkStyle.MeasureVisible(this.m_root, this.m_screen, this.m_width, this.m_height);
    if measured.Z > 0.0 {
      this.m_visible = measured;
      this.m_visibleFrom = "measured";
    } else {
      this.m_visible = XFInkStyle.ModelVisible(this.m_width, this.m_height, this.m_screen);
      this.m_visibleFrom = "model";
    }
  }

  public func GeometryText() -> String {
    return "root=" + FloatToStringPrec(this.m_width, 0) + "x" + FloatToStringPrec(this.m_height, 0) + " screen=" + FloatToStringPrec(this.m_screen.X, 0) + "x" + FloatToStringPrec(this.m_screen.Y, 0)
      + " visible=" + FloatToStringPrec(this.m_visible.Z, 0) + "x" + FloatToStringPrec(this.m_visible.W, 0) + " at " + FloatToStringPrec(this.m_visible.X, 0) + "," + FloatToStringPrec(this.m_visible.Y, 0)
      + " from=" + this.m_visibleFrom + this.ModelText();
  }

  // 0.8.3: the model beside a measurement, so a session sees whether the two agree (the model is session 10's evidence).
  private func ModelText() -> String {
    if !Equals(this.m_visibleFrom, "measured") {
      return "";
    }
    let m = XFInkStyle.ModelVisible(this.m_width, this.m_height, this.m_screen);
    return " model=" + FloatToStringPrec(m.Z, 0) + "x" + FloatToStringPrec(m.W, 0) + " at " + FloatToStringPrec(m.X, 0) + "," + FloatToStringPrec(m.Y, 0);
  }

  private func Build(parent: wref<inkCompoundWidget>) -> Void {
    let root = new inkCanvas();
    root.SetName(n"xfs_overlay");
    root.SetAnchor(inkEAnchor.Fill);
    root.SetInteractive(false);
    root.Reparent(parent);
    this.m_root = root;
    this.m_parent = parent;
    this.m_announced = "";
    this.Measure(parent);

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

    this.m_view = XFInkPanel.Create(root, n"xfs_hud_panel");

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
        if NotEquals(XFInkHost.HostLayer(frame.layer), this.m_layer) && !this.m_remount {
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
    if !IsDefined(frame) || !IsDefined(this.m_view) {
      return;
    }
    this.m_remount = this.m_remount && NotEquals(XFInkHost.HostLayer(frame.layer), this.m_layer);
    // 0.8.9 (session 15: the panel drew over the phone's message reader, MESSAGES > N54 BREAKING NEWS): the phone's screens
    // draw on the HUD as the panel does, so the panel steps aside while one is open (only asked while the scripts are live).
    this.m_phoneOpen = frame.live && XFInkStyle.PhoneOpen();
    this.m_view.canvas.SetVisible(frame.show && !this.m_phoneOpen);
    if IsDefined(this.m_parent) {
      this.Measure(this.m_parent);
    }
    let units = this.m_units > 0.0 ? this.m_units : 1.0;
    let scale = ClampF(frame.scale, 0.5, 3.0) * units;
    this.m_view.canvas.SetScale(new Vector2(scale, scale));
    this.m_view.SizePlate();
    let v = this.m_visible;
    if v.Z < 100.0 || v.W < 100.0 {
      v = new Vector4(0.0, 0.0, this.m_width, this.m_height);
    }
    this.m_panelRect = this.m_view.Place(frame, scale, v, units, true);
    this.m_panelShown = frame.show && !this.m_phoneOpen;
    this.KeepOnTop();
    // 0.8.3: announced whenever it changes (the first measurement replaces the model a moment after mounting), so a session
    // can check the arithmetic against a capture.
    let geometry = this.GeometryText();
    if NotEquals(geometry, this.m_announced) {
      this.m_announced = geometry;
      this.m_reported = true;
      XFBridge_Announce("ink", "panel geometry " + geometry);
    }
    this.m_view.SetWhere(XFInkWhere.Of(frame.layer));
    this.m_view.Apply(frame, true);
    this.m_platesRoot.SetVisible(frame.nameplates);
    this.ReportDrawn(frame);
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
  // status surface and the XF box and the CET line stay off. The HUD layer is hidden outside normal play (menus,
  // photo mode, the appearance screen), so there it counts as not shown; the world is only asked while the scripts are live.
  // 0.8.6: while the panel inside photo mode's menu is showing, that panel reports instead (XFPhotoMenuPanel.Report).
  private func ReportDrawn(frame: ref<XFHudFrame>) -> Void {
    if XFPhotoMenuPanel.Live() {
      return;
    }
    // 0.8.2 (the review): id is the question this panel holds with its answer keys (DrawnAsk, which the keys answer, on screen
    // or not), else the answered one it shows; the plugin tells the other surfaces whether the keys work.
    let keysAsk = 0;
    let held = this.DrawnAsk();
    if IsDefined(held) {
      keysAsk = held.askId;
    }
    let id = keysAsk > 0 ? keysAsk : frame.answeredId;
    let shown = frame.show && this.m_mounted && frame.live && !this.m_phoneOpen;
    if shown && Equals(this.m_layer, "hud") {
      shown = Equals(XFBridgeActions.Phase(), "gameplay");
    }
    XFBridge_InkDrawn(id, shown);
  }

  // RB-114: the question the panel shows now with its keys, or null (nothing mounted, hidden, or no question drawn).
  public func DrawnAsk() -> ref<XFHudFrame> {
    // The Sol review of 0.8.9, finding 4: while a phone screen has the panel step aside its question is hidden, so the keys
    // answer nothing and the panel reports them disarmed (ReportDrawn reads this).
    if !this.m_mounted || this.m_phoneOpen {
      return null;
    }
    if IsDefined(this.m_view) && IsDefined(this.m_view.drawn) {
      return this.m_view.drawn;
    }
    // 0.8.9 (session 15: with the panel switched off, ui_hud {show: false}, the CET line showed the question and F6 did
    // nothing): the keys answer the question the CET line shows too, while the panel is switched off (not while a phone
    // screen has it step aside).
    let frame = this.m_frame;
    if IsDefined(frame) && frame.valid && !frame.show && frame.live && frame.askId > 0 && ArraySize(frame.askKeys) > 0 {
      return frame;
    }
    return null;
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

  // 0.8.3 (session 10's F1: the plugin logged "drawn by xf_overlay", yet in the world only the game's marker showed): the mark
  // is now a canvas of a fixed size (kMarkW x kMarkH design units) laid out from its own top-left corner, with every part
  // placed by a margin inside it (the placement proven for the panel). 0.8.2 reused the map badge, built for the game's sized
  // pin widgets: a 0 x 0 canvas whose parts were centred on it, and placed 280 units too low by the old visible-screen model.
  private func PinMark(index: Int32) -> ref<inkCanvas> {
    while ArraySize(this.m_pinMarks) <= index {
      let mark = new inkCanvas();
      mark.SetName(StringToName("pin" + IntToString(ArraySize(this.m_pinMarks))));
      mark.SetAnchor(inkEAnchor.TopLeft);
      mark.SetAnchorPoint(new Vector2(0.0, 0.0));
      mark.SetRenderTransformPivot(new Vector2(0.0, 0.0));
      mark.SetSize(new Vector2(XFInkPins.MarkWidth(), XFInkPins.MarkHeight()));
      mark.SetInteractive(false);
      mark.SetVisible(false);
      XFInkPins.BuildMark(mark);
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
    // 0.8.3: a pin whose mark wasn't placed this tick (behind the camera, too far, off the screen) says so in ui.state. Only
    // while the scripts are live (the review: the registry is a scriptable system of the session, and no game system is asked
    // once a load has begun); otherwise only this overlay's own widgets were touched above (hidden).
    if IsDefined(frame) && frame.live {
      let registry = XFPinRegistry.Get();
      if IsDefined(registry) {
        for entry in registry.Pins() {
          if !entry.markPlacedNow {
            entry.markShown = false;
          }
          entry.markPlacedNow = false;
        }
      }
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
    if s.W > 200.0 || s.W < -200.0 {
      return false;
    }
    // 0.8.7 (session 14's U2: off the screen only the game's own edge marker stayed): a pin off the screen, or behind the
    // camera (its projection mirrored), keeps its mark at the screen's edge in the pin's direction from the centre.
    let edge = s.W <= 0.0 || AbsF(s.X) > 1.0 || AbsF(s.Y) > 1.0;
    let edgeWay = new Vector2(0.0, 0.0);
    if edge {
      let dx = s.X;
      let dy = s.Y;
      let behind = s.W <= 0.0;
      if behind {
        // Behind the camera: the camera's own right and up give the way (0.8.9); a point behind goes to a side edge, as the
        // game's marker does, unless it is almost straight above or below.
        let way = projector.Direction(new Vector4(point.X, point.Y, point.Z, 1.0));
        dx = way.X;
        dy = way.Y;
        if AbsF(dx) < 0.0001 && AbsF(dy) < 0.0001 {
          dx = 1.0;
        }
        if AbsF(dx) >= AbsF(dy) * 0.25 {
          let side = MaxF(AbsF(dx), AbsF(dy));
          dx = dx >= 0.0 ? side : -side;
        }
      }
      let reach = MaxF(AbsF(dx), AbsF(dy));
      if reach < 0.0001 {
        dx = 1.0;
        dy = 0.0;
        reach = 1.0;
      }
      let far = AbsF(s.W);
      if behind {
        let bx = point.X - projector.position.X;
        let by = point.Y - projector.position.Y;
        let bz = point.Z - projector.position.Z;
        far = SqrtF(bx * bx + by * by + bz * bz);
      }
      edgeWay = new Vector2(dx, dy);
      s = new Vector4(dx / reach * 0.9, dy / reach * 0.86, s.Z, far);
    }
    let mark = this.PinMark(slot);
    XFInkPins.MarkLabel(mark, entry.label);
    XFInkPins.MarkEdge(mark, edge, edgeWay);
    let units = this.m_units > 0.0 ? this.m_units : 1.0;
    let at = this.ScreenPoint(s);
    let size = ClampF(8.0 / MaxF(s.W, 1.0), 0.55, 1.0) * units;
    // The canvas reserves 24 units above and below the original mark for its edge chevron. Subtracting the top reserve
    // keeps the diamond and label at their original on-screen place at every distance scale (64 units above the point).
    let left = at.X - XFInkPins.MarkWidth() * 0.5 * size;
    let top = at.Y - 64.0 * units - (XFInkPins.MarkHeight() - 24.0) * size;
    if edge {
      // At the edge the mark itself stays whole on the visible screen.
      let v = this.m_visible.Z > 100.0 ? this.m_visible : new Vector4(0.0, 0.0, this.m_width, this.m_height);
      left = ClampF(left, v.X + 8.0 * units, v.X + v.Z - 8.0 * units - XFInkPins.MarkWidth() * size);
      top = ClampF(top, v.Y + 8.0 * units, v.Y + v.W - 8.0 * units - XFInkPins.MarkHeight() * size);
      // 0.8.10: and clear of the HUD's own blocks and of the ink panel: it slides along the edge to the nearest free place, which
      // is where the game's own edge marker sits (lower down the side than the top).
      let zones = XFInkStyle.HudBlocks(v);
      if this.m_panelShown && this.m_panelRect.Z > 1.0 && this.m_panelRect.W > 1.0 {
        ArrayPush(zones, this.m_panelRect);
      }
      let kept = XFInkStyle.SlideAlong(new Vector4(left, top, XFInkPins.MarkWidth() * size, XFInkPins.MarkHeight() * size), zones, v, 12.0 * units);
      left = kept.X;
      top = kept.Y;
    }
    mark.SetScale(new Vector2(size, size));
    mark.SetMargin(new inkMargin(left, top, 0.0, 0.0));
    mark.SetVisible(true);
    // 0.8.3: the agent's own view of it (ui.state's pins[].xf_mark): where the overlay put it, in the root's units and, by the
    // game's own layout, in window pixels (WidgetUtils.LocalToGlobal of its top-left corner), and whether that is on screen.
    let px = WidgetUtils.LocalToGlobal(mark, new Vector2(0.0, 0.0));
    entry.markShown = true;
    entry.markAt = new Vector2(left, top);
    entry.markPx = px;
    entry.markOnScreen = px.X > -10.0 && px.Y > -10.0 && px.X < this.m_screen.X && px.Y < this.m_screen.Y;
    entry.markAtEdge = edge;
    // 0.8.4: the pin's point itself in window pixels (the projector's -1..1 across and down the window).
    entry.pointPx = new Vector2((s.X + 1.0) * 0.5 * this.m_screen.X, (s.Y + 1.0) * 0.5 * this.m_screen.Y);
    entry.markPlacedNow = true;
    XFInkPins.NoteDrawn(entry, "xf_overlay");
    return true;
  }

  // BEGIN XFB_AUTONOMOUS_TEST_HOOKS
  @if(ModuleExists("Codeware"))
  public func XFRecordingUi() -> String {
    return IsDefined(this.m_view) ? this.m_view.XFRecordingUi(this.m_layer) : "null";
  }
  // END XFB_AUTONOMOUS_TEST_HOOKS
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
    // 0.8.6: in photo mode, the question the panel inside its menu shows; else the HUD overlay's.
    let frame = XFPhotoMenuPanel.DrawnAsk();
    if !IsDefined(frame) {
      let overlay = XFInkOverlay.Get();
      if IsDefined(overlay) {
        frame = overlay.DrawnAsk();
      }
    }
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
