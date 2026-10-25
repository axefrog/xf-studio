#include "core/overlay/Motion.hpp"
#include "core/overlay/Theme.hpp"
#include "core/LayoutGuard.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>

namespace xfb::overlay
{
namespace
{
// The theme's constants, read once (the table is generated and constant).
struct Constants
{
    double periodMs = ThemeValueOf("PulsePeriodMs", 2400.0f);
    double depth = ThemeValueOf("PulseDepth", 0.4f);
    double settleMs = ThemeValueOf("SettleMs", 600.0f);
    double gapMs = ThemeValueOf("SettleGapMs", 2000.0f);
};
const Constants& K()
{
    static const Constants constants;
    return constants;
}
} // namespace

bool MotionSettingFromName(const std::string& aName, MotionSetting& aOut)
{
    std::string name;
    for (const char c : aName)
    {
        name.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    if (name == "auto")
    {
        aOut = MotionSetting::Auto;
    }
    else if (name == "reduced")
    {
        aOut = MotionSetting::Reduced;
    }
    else if (name == "full")
    {
        aOut = MotionSetting::Full;
    }
    else
    {
        return false;
    }
    return true;
}

const char* MotionSettingName(MotionSetting aSetting)
{
    switch (aSetting)
    {
    case MotionSetting::Reduced:
        return "reduced";
    case MotionSetting::Full:
        return "full";
    case MotionSetting::Auto:
        break;
    }
    return "auto";
}

MotionState ResolveMotion(MotionSetting aSetting, bool aWindowsAnimations, bool aFrameGeneration)
{
    MotionState out;
    if (aSetting == MotionSetting::Reduced)
    {
        out.reduced = true;
        out.reason = "setting";
    }
    else if (aSetting == MotionSetting::Auto && !aWindowsAnimations)
    {
        out.reduced = true;
        out.reason = "windows_animations_off";
    }
    else if (aSetting == MotionSetting::Auto && aFrameGeneration)
    {
        out.reduced = true;
        out.reason = "frame_generation";
    }
    out.effective = out.reduced ? "reduced" : "full";
    return out;
}

float PulseAlpha(double aSeconds, bool aReduced)
{
    if (aReduced)
    {
        return 1.0f;
    }
    constexpr double kTwoPi = 6.283185307179586;
    const double phase = std::fmod(std::max(0.0, aSeconds) * 1000.0, K().periodMs) / K().periodMs;
    return static_cast<float>(1.0 - K().depth * (0.5 - 0.5 * std::cos(kTwoPi * phase)));
}

float SettleStrength(double aElapsedMs)
{
    if (aElapsedMs < 0.0 || aElapsedMs >= K().settleMs)
    {
        return 0.0f;
    }
    const double left = 1.0 - aElapsedMs / K().settleMs;
    return static_cast<float>(left * left * left); // a fast fade with a soft tail (the Studio's ease-out curve)
}

bool Settle::Note(const std::string& aState, double aNowMs, bool aReduced)
{
    if (!m_seen)
    {
        m_seen = true;
        m_state = aState;
        return false;
    }
    if (aState == m_state)
    {
        return false;
    }
    m_state = aState;
    if (aReduced || (m_started && aNowMs - m_startMs < K().gapMs))
    {
        return false;
    }
    m_started = true;
    m_startMs = aNowMs;
    return true;
}

float Settle::Strength(double aNowMs) const
{
    return m_started ? SettleStrength(aNowMs - m_startMs) : 0.0f;
}

bool Settle::Running(double aNowMs) const
{
    return m_started && aNowMs - m_startMs >= 0.0 && aNowMs - m_startMs < K().settleMs;
}
} // namespace xfb::overlay
