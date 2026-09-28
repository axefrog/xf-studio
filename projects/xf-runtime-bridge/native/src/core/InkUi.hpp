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

namespace xfb::inkui
{
using json = nlohmann::json;

// ---- Demo A: the HUD panel -------------------------------------------------------------------------------------------

inline constexpr int kFrameVersion = 1;
inline constexpr double kMaxOffset = 4000.0; // virtual pixels (the overlay is 2160 units high)
inline constexpr double kMinScale = 0.5;
inline constexpr double kMaxScale = 2.5;

// Where the panel sits and what the overlay draws. x and y are the panel's distance in the overlay's units (2160 per
// screen height) from the corner or edge its anchor names.
struct HudSettings
{
    bool show = true;
    std::string anchor = "top_right"; // top_left, top_right, bottom_left, bottom_right, top_center, center_left, center_right
    double x = 72.0;
    double y = 300.0;
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
    bool scriptReady = false; // the script layer's gate (RB-76): world queries (nameplates) only while it is open
};

// The status line: tone (ok, write, paused, killed, off, idle) and a plain sentence.
struct Status
{
    std::string tone;
    std::string text;
};
Status Summarize(const BridgeView& aView);

struct MessageLine
{
    std::string level; // info, ask, warn, done
    std::string text;
};

// XFBridge_Hud()'s answer: one record per line, fields separated by tabs, first line "xfhud<TAB>1". The redscript layer
// reads it with StrSplit, so no JSON parser is needed in script. Records: show, layer, anchor, pos (x y), scale,
// nameplates, cet_label, live (the script gate), tone, status, then msg (level text) per message line, oldest first. Text
// fields never contain tabs or newlines (message text is already one clean line; see CleanField). A disabled bridge
// answers show 0 (the panel is only drawn while the bridge is on, like the CET label); a killed one shows its state and
// no messages.
std::string Frame(const HudSettings& aSettings, const BridgeView& aView, const std::vector<MessageLine>& aMessages);
// Parses a frame back into JSON (the self-test and the tests read what the redscript layer would draw).
json ParseFrame(const std::string& aFrame);
// Replaces tabs, carriage returns and newlines with spaces.
std::string CleanField(const std::string& aText);

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

// world.pin: exactly one of position [x, y, z] (a world point), piece (a showroom head's index: the pin stands above its
// eyes and follows the head) or at "v" (above V); label (1-48 characters after cleaning); variant (the vanilla mappin
// variant whose map filter and fallback icon it uses: custom, apartment, clothes, default); lift_m (metres above the point;
// default 0 for a position, 0.45 above a head's eyes or V's head).
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
