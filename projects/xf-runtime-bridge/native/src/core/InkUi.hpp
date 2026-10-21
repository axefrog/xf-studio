#pragma once

// TEMPORARY TEST FEATURE (bridge 0.5.3): the first in-game UI demos in the game's own UI system (ink), kept separate so
// they can be removed or promoted as a unit. Research and routes: knowledge/ink-ui.md and
// research/runtime/in-game-ui-design.md.
//
//   Demo A, the XF HUD panel: an ink panel in the game's HUD style (the redscript layer, XFRuntimeBridgeInk.reds) showing
//     the bridge's connection state and the coordinator's ui.message lines. It PULLS its content from the plugin through
//     one native, XFBridge_Hud(), which answers the text frame built here; the plugin never calls into scripts for it, so
//     it needs no game gate (RB-76). ui.hud shows, hides or moves it. It works without Cyber Engine Tweaks; the CET label
//     stays, switched by [ui] cet_label (and ui.hud's cet_label).
//   Demo B, pedestal nameplates: the same overlay draws each XF Finish Showroom head's preset name on its pedestal, projected
//     from the pedestal's world point every tick (the technique the game's nameplates and mappins use), appearing and
//     vanishing with the showroom's heads. ui.hud's nameplates switches them.
//   Demo C, XF map pins (world.pin, world.pin.clear): a mappin with an ink-drawn XF badge and a label, on the world map, the
//     minimap and in the world, placed at a world point or above a showroom head; cleared by world.pin.clear, the kill switch
//     and loading a save. Its parameter checks are here; the redscript layer (XFRuntimeBridgePins.reds) registers it.
//
// Game-independent: shared by the plugin and the self-test host.

#include <cstdint>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/Messages.hpp"

namespace xfb::inkui
{
using json = nlohmann::json;

// ---- Demo A: the HUD panel -------------------------------------------------------------------------------------------

inline constexpr int kFrameVersion = 1;
inline constexpr double kMaxOffset = 4000.0; // virtual pixels (the overlay is 2160 units high)
inline constexpr double kMinScale = 0.5;
inline constexpr double kMaxScale = 2.5;

// Where the panel sits and what the overlay draws. x and y are the panel's distance, in the HUD's design units, from the
// corner or edge of the VISIBLE screen its anchor names (0.8, session 8: the HUD lays out on a 3840 x 2160 design canvas
// scaled to cover the screen, so on 21:9 its top and bottom 280 units are off screen; XFRuntimeBridgeInk.reds places the
// panel inside the part the screen shows). For center the offsets move it from the middle.
// 0.8 default: top left, below the CET label and the overlay panel (session 8 proved x 40, y 640 on the old canvas-relative
// placement at 3840 x 1600, which is y 360 of the visible screen).
struct HudSettings
{
    bool show = true;
    std::string anchor = "top_left"; // top_left, top_center, top_right, center_left, center, center_right, bottom_left, bottom_center, bottom_right
    double x = 40.0;
    double y = 360.0;
    double scale = 1.0;
    std::string layer = "hud"; // hud (inkHUDLayer, hidden with the game's HUD), notifications, top (research: inkWatermarksLayer)
    bool nameplates = true;    // Demo B
    bool cetLabel = true;      // the CET layer's status label and message lines ([ui] cet_label)
};
json ToJson(const HudSettings& aSettings);
bool AnchorOk(const std::string& aAnchor);
bool LayerOk(const std::string& aLayer);

// ui.hud: {show, anchor, x, y, scale, layer, nameplates, cet_label, reset}. Every key is optional; none reads the settings
// without changing them. reset: true goes back to aDefaults ([ui] in config.ini), and cannot be combined with values.
// Throws MethodError bad_params.
HudSettings ApplyHudParams(const HudSettings& aCurrent, const HudSettings& aDefaults, const json& aParams);

// What the plugin knows about itself, for the panel's status line.
struct BridgeView
{
    bool pluginEnabled = false; // [bridge] enabled
    bool killed = false;
    bool listening = false;
    bool allowWrites = false;
    bool writesPaused = false;
    bool hasClient = false;
    bool inSession = false;   // 0.8.2: Bridge::InSession (a client now, a request in the last three minutes, or the session lock)
    bool scriptReady = false; // the script layer's gate (RB-76): world queries (nameplates) only while it is open
};

// 0.8.2: the in-game surfaces' rule (the maintainer's decision of 21 October, after session 9): one status surface at a
// time. The ink panel while it is on screen (the game shows its HUD); otherwise the overlay panel (the XF ImGui panel with
// the yellow heading: photo mode, menus), which then carries the messages and the question too; the status label (CET's,
// top left) only when neither can draw. The XF Runtime Bridge window (CET's overlay) stays the interactive place and the
// home for diagnostics; it isn't a status surface.
enum class StatusSurface
{
    InkPanel,
    OverlayPanel,
    StatusLabel
};
struct SurfaceFacts
{
    bool inkShowing = false;     // the ink panel reported itself on screen in the last moment (XFBridge_InkDrawn)
    bool overlayDrawing = false; // the overlay host is drawing (hooked, not refused, not stopped by the kill switch)
};
StatusSurface ChooseStatusSurface(const SurfaceFacts& aFacts);
// The frame's and XFBridge_Info's name for it: ink_panel, overlay_panel, status_label.
const char* SurfaceName(StatusSurface aSurface);

// The status line: tone (ok, write, paused, killed, off, idle) and a plain sentence. 0.8 (the UI review): one wording on
// every surface, made here. text is the ink panel's and the overlay panel's status line ("XF Studio connected · changes
// allowed"); label is the CET label's first line ("XF Runtime Bridge · " + text); connection and changes are the CET
// window's two lines, each with its own tone. Colour meaning: amber (write, paused) only while changes are allowed or
// paused, and the text says so; green (ok) connected or read-only; red (killed) stopped; grey (off, idle) otherwise.
struct Status
{
    std::string tone;
    std::string text;
    std::string label;
    std::string connection;
    std::string connectionTone;
    std::string changes;
    std::string changesTone;
};
Status Summarize(const BridgeView& aView);
json StatusJson(const BridgeView& aView);

// ---- 0.8: text as each surface can draw it (session 8's I7) ------------------------------------------------------------

// The mark a surface draws for a character its font lacks. Session 8 saw blank gaps (the ink panel) and "?" (CET, the
// overlay), which read as nothing or as a real question mark. CET's Latin-1 font and the overlay's baked Segoe UI draw U+00A4
// (the currency sign), kReplacementMark. 0.8.2 (session 9's B4: the ink panel drew U+00A4 as a blank gap too): the game's
// ink font lacks it, so the ink panel draws U+2022 (the bullet), kInkReplacementMark, which all four of its styles carry
// (read from the game's own font files: inkUiInkGlyphs below).
inline constexpr const char* kReplacementMark = "\xC2\xA4";
inline constexpr const char* kInkReplacementMark = "\xE2\x80\xA2";
// The ink panel's copy: a character every style of the game's ink font has stays; a Latin letter or punctuation mark it
// lacks becomes its plain form (å to a, Æ to AE, ‰ to %), the way the CET copy does; anything else becomes the ink mark.
// Control characters become spaces.
std::string ForInk(const std::string& aText);
// 0.8.2: whether every style the ink panel uses can draw this code point: the code points mapped in all four fonts of the
// game's raj.inkfontfamily (raj-medium, raj-semibold, raj-bold, rajdhani-regular .fnt in basegame_1_engine.archive, game 2.31;
// their cmap tables read offline, 249 code points). Session 9 saw U+00A4 drawn as a gap; the fonts don't map it.
bool InkHas(uint32_t aCp);
// The CET layer's copy: CET's own font covers Basic Latin and Latin-1 only (Dear ImGui's default glyph ranges, plus a
// chosen language's), and the bridge never changes the player's CET setup, so Latin Extended-A letters are transliterated
// (Ł to L, ż to z, Œ to OE), typographic punctuation becomes ASCII (em dash to -, the ellipsis to ...), and anything else
// becomes the mark.
std::string ForCet(const std::string& aText);

struct MessageLine
{
    std::string level; // info, ask, warn, done
    std::string text;
};

// 0.7 (session 7, in-game driving): the ask waiting for the player's answer, with the key that answers each choice
// ([ui] answer_keys: EInputKey names such as IK_F6). The frame's record is "ask<TAB>id<TAB>key<TAB>label..." and the ink
// panel draws "[F6] Done" under the ask; a press of one of those keys answers it (XFBridge_Answer).
// 0.8: "answered<TAB>id<TAB>label" once the player has answered (the ink panel draws "Answered: <label>" where the keys
// were, until the next message), and "inkask<TAB>id" while the ink panel reports drawing that question on screen
// (XFBridge_InkDrawn), which tells the CET label to show only the status and the answer keys.
struct AskView
{
    uint64_t id = 0;
    std::vector<std::pair<std::string, std::string>> keyed; // (key, label) per choice
    uint64_t answeredId = 0;
    std::string answeredLabel;
    uint64_t inkShown = 0;
};

// XFBridge_Hud()'s answer: one record per line, fields separated by tabs, first line "xfhud<TAB>1". The redscript layer
// reads it with StrSplit, so no JSON parser is needed in script. Records: show, layer, anchor, pos (x y), scale,
// nameplates, cet_label, live (the script gate), tone, status, then msg (level text) per message line, oldest first. Text
// fields never contain tabs or newlines (message text is already one clean line; see CleanField). A disabled bridge
// answers show 0 (the panel is only drawn while the bridge is on, like the CET label); a killed one shows its state and
// no messages.
// 0.8.2: a surface record ("surface<TAB>ink_panel|overlay_panel|status_label") says which status surface shows now; the CET
// layer draws its status label only for status_label.
std::string Frame(const HudSettings& aSettings, const BridgeView& aView, const std::vector<MessageLine>& aMessages, const AskView* aAsk = nullptr,
                  StatusSurface aSurface = StatusSurface::StatusLabel);
// Parses a frame back into JSON (the self-test and the tests read what the redscript layer would draw).
json ParseFrame(const std::string& aFrame);
// Replaces tabs, carriage returns and newlines with spaces.
std::string CleanField(const std::string& aText);

// 0.8: the frame the plugin answers (and the self-test's selftest.hud), made in one place: the board's lines, its pending
// ask with the answer keys, its answered ask and the question the ink panel last reported drawing; the ink panel's copy of
// every text.
std::string BuildFrame(const HudSettings& aSettings, const BridgeView& aView, MessageBoard& aBoard, const std::vector<std::string>& aAnswerKeys,
                       uint64_t aInkShownAsk, StatusSurface aSurface = StatusSurface::StatusLabel);
// A key's name as the panels show it ("IK_F6" to "F6").
std::string KeyLabel(const std::string& aKey);

// The panel's settings, shared by the pipe (ui.hud) and the game thread (XFBridge_Hud). Thread-safe.
class HudPanel
{
public:
    void SetDefaults(const HudSettings& aDefaults);
    HudSettings Current() const;
    HudSettings Defaults() const;
    // ui.hud: {settings, previous, changed, undo: {method: "ui.hud", params: previous}}.
    json Configure(const json& aParams);

private:
    mutable std::mutex m_mutex;
    HudSettings m_defaults;
    HudSettings m_current;
};

// ---- Demo C: XF map pins ---------------------------------------------------------------------------------------------

inline constexpr size_t kMaxPins = 8;
inline constexpr size_t kMaxLabelChars = 48;
inline constexpr double kMaxCoordinate = 20000.0; // metres; Night City fits well inside
inline constexpr double kMaxLift = 5.0;
inline constexpr double kPieceLift = 0.25; // 0.8: a head pin's default height above its eyes

// world.pin: exactly one of position [x, y, z] (a world point), piece (a showroom head's index: the pin stands above its
// eyes and follows the head) or at "v" (above V); label (1-48 characters after cleaning); variant (the vanilla mappin
// variant whose map filter and fallback icon it uses: custom, apartment, clothes, default, interaction); lift_m (metres above the point;
// default 0 for a position, 0.25 above a head's eyes (0.8: kPieceLift, just above its crown) or 0.45 above V's head).
struct PinRequest
{
    enum class Target
    {
        Position,
        Piece,
        V
    };
    Target target = Target::Position;
    double x = 0, y = 0, z = 0;
    int32_t piece = -1;
    std::string label;
    std::string variant = "custom";
    double lift = 0.0;
};
PinRequest ParsePin(const json& aParams);
bool VariantOk(const std::string& aVariant);
const char* TargetName(PinRequest::Target aTarget);

// world.pin.clear: {id} removes one pin (the id world.pin answered); no id removes every XF pin. -1 = all.
int64_t ParsePinClear(const json& aParams);
} // namespace xfb::inkui
