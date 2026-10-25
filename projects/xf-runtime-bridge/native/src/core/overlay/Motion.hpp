#pragma once

// The in-game surfaces' two small motions (bridge 0.8.22; the Studio's style guide, "In-game motion: the pulse and the settle"),
// game-independent so the self-test checks them:
//   * the live pulse: a connected bridge's dot breathes, its alpha following 1 - depth * (0.5 - 0.5 cos(2 pi t / period)), so
//     it eases in and out and never steps. It changes alpha only. Period 2.4 s, depth 0.4 (the theme's PulsePeriodMs, PulseDepth);
//   * the settle: when a status tone changes, its fill takes the signal wash and fades out over SettleMs, once, at most once per
//     SettleGapMs per element.
// Both run on one clock the caller supplies (ImGui::GetTime in the host, ImGui.GetTime in CET) and are pure functions of it: no
// timer, no thread, no allocation. "Reduced" motion draws the dot at full alpha and starts no settle.
//
// Whether motion is reduced: [overlay] motion = auto | reduced | full. auto follows Windows' own setting (animation effects off,
// SPI_GETCLIENTAREAANIMATION) and also skips the animation while frame generation is on (generated frames ghost a moving dot);
// reduced and full say so by hand, full even over both.

#include <string>

namespace xfb::overlay
{
enum class MotionSetting
{
    Auto,
    Reduced,
    Full
};

// "auto", "reduced" or "full" (any case); false for anything else (aOut unchanged).
bool MotionSettingFromName(const std::string& aName, MotionSetting& aOut);
const char* MotionSettingName(MotionSetting aSetting);

struct MotionState
{
    bool reduced = false;
    const char* effective = "full"; // "full" or "reduced"
    const char* reason = "";        // why: "setting", "windows_animations_off", "frame_generation" or "" for full motion
};
// The effective motion for the setting and what the machine says now.
MotionState ResolveMotion(MotionSetting aSetting, bool aWindowsAnimations, bool aFrameGeneration);

// The pulse's alpha at aSeconds on the shared clock: 1 down to 1 - depth and back, once per period. aReduced: always 1.
float PulseAlpha(double aSeconds, bool aReduced);

// The settle wash's strength (1 down to 0) aElapsedMs after it started: ease-out over SettleMs, 0 before and after.
float SettleStrength(double aElapsedMs);

// One element's settle. Note() is called every frame with the element's state (a tone name); a change starts a settle unless
// motion is reduced or the last one began less than SettleGapMs ago. The first state seen is the element's starting point and
// settles nothing.
class Settle
{
public:
    // aNowMs: the shared clock in milliseconds. True when a settle started on this call.
    bool Note(const std::string& aState, double aNowMs, bool aReduced);
    // 0 when none is running.
    float Strength(double aNowMs) const;
    bool Running(double aNowMs) const;

private:
    std::string m_state;
    bool m_seen = false;
    bool m_started = false;
    double m_startMs = 0.0;
};
} // namespace xfb::overlay
