#include "core/overlay/Host.hpp"
#include "core/LayoutGuard.hpp"
#include "core/Dispatcher.hpp"
#include "core/Params.hpp"

#include <algorithm>
#include <cmath>

namespace xfb::overlay
{
std::string RefusalFor(const DeviceFacts& aFacts)
{
    if (!aFacts.deviceData)
    {
        return "the engine's GPU device data wasn't found (address library)";
    }
    if (!aFacts.swapChain)
    {
        return "no swap chain for the device the engine presents";
    }
    if (aFacts.hdrMode != 0)
    {
        return std::string("the game outputs HDR (") + (aFacts.hdrMode == 1 ? "PQ" : aFacts.hdrMode == 2 ? "scRGB" : "unknown") +
               "); the P0 host draws only in SDR (feasibility §4)";
    }
    if (aFacts.format != "R8G8B8A8_UNORM" && aFacts.format != "B8G8R8A8_UNORM")
    {
        return "the back buffer's format is " + (aFacts.format.empty() ? std::string("unknown") : aFacts.format) + "; the P0 host draws only into 8-bit SDR buffers";
    }
    if (!aFacts.sameDevice)
    {
        return "the swap chain doesn't belong to the engine's device (not even through Streamline's proxy)";
    }
    if (!aFacts.directQueue)
    {
        return "the engine's direct command queue wasn't a DIRECT queue";
    }
    if (aFacts.windowClass != "W2ViewportClass")
    {
        return "the swap chain's window isn't the game's (" + (aFacts.windowClass.empty() ? std::string("none") : aFacts.windowClass) + ")";
    }
    if (aFacts.bufferCount == 0 || aFacts.bufferCount > 3)
    {
        return "the swap chain has " + std::to_string(aFacts.bufferCount) + " back buffers (1 to 3 expected)";
    }
    return {};
}

std::string RefusalAfterResize(const DeviceFacts& aFirst, const DeviceFacts& aNow)
{
    if (auto refusal = RefusalFor(aNow); !refusal.empty())
    {
        return "after a resize: " + refusal;
    }
    if (aNow.format != aFirst.format)
    {
        return "after a resize the back buffer's format is " + aNow.format + ", not " + aFirst.format + " (the overlay's pipeline was built for the first)";
    }
    if (aNow.bufferCount != aFirst.bufferCount)
    {
        return "after a resize the swap chain has " + std::to_string(aNow.bufferCount) + " back buffers, not " + std::to_string(aFirst.bufferCount) +
               " (the overlay's heaps and allocators were made for the first)";
    }
    return {};
}

DeviceMatch MatchDevices(const DeviceIdentity& aSwapChainDevice, const DeviceIdentity& aEngineDevice)
{
    if (aSwapChainDevice.given == 0 || aEngineDevice.given == 0)
    {
        return {};
    }
    if (aSwapChainDevice.given == aEngineDevice.given)
    {
        return {true, false};
    }
    const auto native = [](const DeviceIdentity& aId) { return aId.native != 0 ? aId.native : aId.given; };
    if (native(aSwapChainDevice) == native(aEngineDevice))
    {
        return {true, true};
    }
    return {};
}

const std::vector<std::pair<uint32_t, uint32_t>>& GlyphRanges()
{
    static const std::vector<std::pair<uint32_t, uint32_t>> ranges{
        {0x0020, 0x007E}, {0x00A0, 0x00FF}, {0x0100, 0x017F}, {0x2010, 0x205E}, {0x20AC, 0x20AC},
        {0x2122, 0x2122}, {0x2190, 0x2193}, {0xFFFD, 0xFFFD},
    };
    return ranges;
}

std::string LimitToGlyphs(const std::string& aText)
{
    const auto baked = [](uint32_t aCp) {
        for (const auto& [lo, hi] : GlyphRanges())
        {
            if (aCp >= lo && aCp <= hi)
            {
                return true;
            }
        }
        return false;
    };
    const auto put = [](std::string& aOut, uint32_t aCp) {
        if (aCp < 0x80)
        {
            aOut.push_back(static_cast<char>(aCp));
        }
        else if (aCp < 0x800)
        {
            aOut.push_back(static_cast<char>(0xC0 | (aCp >> 6)));
            aOut.push_back(static_cast<char>(0x80 | (aCp & 0x3F)));
        }
        else
        {
            aOut.push_back(static_cast<char>(0xE0 | (aCp >> 12)));
            aOut.push_back(static_cast<char>(0x80 | ((aCp >> 6) & 0x3F)));
            aOut.push_back(static_cast<char>(0x80 | (aCp & 0x3F)));
        }
    };
    std::string out;
    out.reserve(aText.size());
    size_t i = 0;
    while (i < aText.size())
    {
        const auto lead = static_cast<unsigned char>(aText[i]);
        uint32_t cp = 0;
        size_t length = lead < 0x80 ? 1 : (lead & 0xE0) == 0xC0 ? 2 : (lead & 0xF0) == 0xE0 ? 3 : (lead & 0xF8) == 0xF0 ? 4 : 0;
        bool valid = length != 0 && i + length <= aText.size();
        if (valid)
        {
            cp = length == 1 ? lead : length == 2 ? (lead & 0x1Fu) : length == 3 ? (lead & 0x0Fu) : (lead & 0x07u);
            for (size_t k = 1; k < length && valid; ++k)
            {
                const auto next = static_cast<unsigned char>(aText[i + k]);
                valid = (next & 0xC0) == 0x80;
                cp = (cp << 6) | (next & 0x3Fu);
            }
            valid = valid && !((length == 2 && cp < 0x80) || (length == 3 && cp < 0x800) || (length == 4 && cp < 0x10000) || cp > 0x10FFFF ||
                               (cp >= 0xD800 && cp <= 0xDFFF));
        }
        if (!valid)
        {
            put(out, 0xA4);
            i += 1;
            continue;
        }
        i += length;
        if (cp < 0x20 || cp == 0x7F || (cp >= 0x80 && cp < 0xA0))
        {
            out.push_back(' ');
        }
        else
        {
            put(out, baked(cp) && cp != 0xFFFD ? cp : 0xA4);
        }
    }
    return out;
}

std::pair<float, float> PanelOrigin(const std::string& aAnchor, double aX, double aY, float aScreenW, float aScreenH, float aBoxW, float aBoxH)
{
    // The floors of tools/overlay/ink-place.ts FLOORS and redscript XFInkStyle.Floor (session 10's capture at 3840 x 1600).
    struct Floor
    {
        const char* anchor;
        float x;
        float y;
    };
    static constexpr Floor kFloors[] = {{"top_left", 0, 300},  {"top_center", 0, 140},     {"top_right", 860, 0},
                                        {"center_left", 0, 0}, {"center", 0, 0},           {"center_right", 860, 0},
                                        {"bottom_left", 0, 520}, {"bottom_center", 0, 480}, {"bottom_right", 860, 480}};
    float fx = 0.0f;
    float fy = 0.0f;
    bool known = false;
    for (const auto& floor : kFloors)
    {
        if (aAnchor == floor.anchor)
        {
            fx = floor.x;
            fy = floor.y;
            known = true;
        }
    }
    const std::string anchor = known ? aAnchor : std::string("top_left");
    const auto endsWith = [&anchor](const char* aSuffix) {
        const std::string suffix(aSuffix);
        return anchor.size() >= suffix.size() && anchor.compare(anchor.size() - suffix.size(), suffix.size(), suffix) == 0;
    };
    const float px = endsWith("_right") ? 1.0f : (endsWith("_center") || anchor == "center") ? 0.5f : 0.0f;
    const float py = anchor.rfind("bottom_", 0) == 0 ? 1.0f : anchor.rfind("center", 0) == 0 ? 0.5f : 0.0f;
    const float unit = aScreenW > 0.0f ? aScreenW / 3840.0f : 1.0f;
    const float hud = aScreenH > 0.0f ? aScreenH / 2160.0f : 1.0f;
    const float ox = fx > 0.0f ? std::max(static_cast<float>(aX) * unit, fx * hud) : static_cast<float>(aX) * unit;
    const float oy = fy > 0.0f ? std::max(static_cast<float>(aY) * unit, fy * hud) : static_cast<float>(aY) * unit;
    float left = px * aScreenW + (px > 0.9f ? -ox : ox) - px * aBoxW;
    float top = py * aScreenH + (py > 0.9f ? -oy : oy) - py * aBoxH;
    const float margin = 8.0f * unit;
    left = std::clamp(left, margin, std::max(margin, aScreenW - margin - aBoxW));
    top = std::clamp(top, margin, std::max(margin, aScreenH - margin - aBoxH));
    return {left, top};
}

const char* PhaseName(Phase aPhase)
{
    switch (aPhase)
    {
    case Phase::Disabled:
        return "disabled";
    case Phase::Unhooked:
        return "unhooked";
    case Phase::Waiting:
        return "waiting";
    case Phase::Drawing:
        return "drawing";
    case Phase::Refused:
        return "refused";
    case Phase::Failed:
        return "failed";
    case Phase::ShutDown:
        return "shut_down";
    }
    return "unknown";
}

void OverlayHost::Configure(bool aEnabled, ThemeKind aTheme, uint32_t aScalePercent)
{
    std::scoped_lock _(m_mutex);
    m_enabled.store(aEnabled);
    SetTheme(aTheme);
    m_scalePercent = std::clamp<uint32_t>(aScalePercent, 50, 300);
    m_phase.store(aEnabled ? Phase::Unhooked : Phase::Disabled);
}

void OverlayHost::NoteHooks(bool aPresent, bool aResize, bool aShutdown, const std::string& aMissing)
{
    std::scoped_lock _(m_mutex);
    m_hookPresent = aPresent;
    m_hookResize = aResize;
    m_hookShutdown = aShutdown;
    m_missing = aMissing;
    if (m_enabled.load())
    {
        m_phase.store(aPresent && aResize && aShutdown && m_missing.empty() ? Phase::Waiting : Phase::Unhooked);
        if (!(aPresent && aResize && aShutdown) && m_missing.empty())
        {
            m_missing = std::string(!aPresent ? "GpuApi::Present hook" : !aResize ? "GpuApi::ResizeBackbuffer hook" : "render shutdown hook") + " not attached";
        }
    }
}

void OverlayHost::NoteInit(const DeviceFacts& aFacts, const std::string& aRefusal)
{
    std::scoped_lock _(m_mutex);
    m_facts = aFacts;
    m_refusal = aRefusal;
    m_phase.store(aRefusal.empty() ? Phase::Drawing : Phase::Refused);
}

void OverlayHost::NoteFailure(const std::string& aWhy)
{
    std::scoped_lock _(m_mutex);
    m_failure = aWhy;
    m_phase.store(Phase::Failed);
}

void OverlayHost::NoteShutdown()
{
    m_phase.store(Phase::ShutDown);
}

void OverlayHost::NoteResize(uint32_t aWidth, uint32_t aHeight)
{
    std::scoped_lock _(m_mutex);
    ++m_resizes;
    m_facts.width = aWidth;
    m_facts.height = aHeight;
}

void OverlayHost::NoteFrame(double aCpuMicros)
{
    m_frames.fetch_add(1);
    // A smoothed average (about the last 30 frames) and the worst frame seen.
    const double previous = m_cpuMicros.load();
    m_cpuMicros.store(previous == 0.0 ? aCpuMicros : previous + (aCpuMicros - previous) / 30.0);
    if (aCpuMicros > m_cpuMicrosMax.load())
    {
        m_cpuMicrosMax.store(aCpuMicros);
    }
}

void OverlayHost::NoteFrameGeneration(const std::vector<std::string>& aModules)
{
    std::scoped_lock _(m_mutex);
    m_frameGeneration = aModules;
    m_frameGenerationLoaded.store(!aModules.empty());
}

bool OverlayHost::RefreshFrameGeneration(const std::function<std::vector<std::string>()>& aProbe, std::chrono::steady_clock::time_point aNow)
{
    const auto nowNs = std::chrono::duration_cast<std::chrono::nanoseconds>(aNow.time_since_epoch()).count();
    if (m_frameGenerationProbed.load() && nowNs - m_frameGenerationProbedNs.load() < static_cast<int64_t>(kFrameGenerationProbeMs) * 1000000)
    {
        return false;
    }
    m_frameGenerationProbedNs.store(nowNs);
    m_frameGenerationProbed.store(true);
    auto modules = aProbe();
    bool changed;
    {
        std::scoped_lock _(m_mutex);
        changed = modules != m_frameGeneration;
    }
    if (changed)
    {
        NoteFrameGeneration(modules);
    }
    return true;
}

bool OverlayHost::OffForFrameGeneration() const
{
    std::scoped_lock _(m_mutex);
    const auto phase = m_phase.load();
    return m_enabled.load() && (phase == Phase::Refused || phase == Phase::Failed) && !m_frameGeneration.empty();
}

bool OverlayHost::ShouldDraw(std::chrono::steady_clock::time_point aNow) const
{
    return EnabledNow() && !m_passThrough.load() && m_phase.load() == Phase::Drawing && !m_killed.load() && (!m_cetOpen.load() || DiagnosticsRequested()) &&
           !HiddenForCapture(aNow);
}

void OverlayHost::HideForCapture(bool aHidden, uint32_t aMs, std::chrono::steady_clock::time_point aNow)
{
    const auto ms = std::clamp<uint32_t>(aMs, 50, 10000);
    m_hiddenUntilNs.store(aHidden ? std::chrono::duration_cast<std::chrono::nanoseconds>((aNow + std::chrono::milliseconds(ms)).time_since_epoch()).count() : 0);
}

bool OverlayHost::HiddenForCapture(std::chrono::steady_clock::time_point aNow) const
{
    return std::chrono::duration_cast<std::chrono::nanoseconds>(aNow.time_since_epoch()).count() < m_hiddenUntilNs.load();
}

json OverlayHost::Snapshot(std::chrono::steady_clock::time_point aNow) const
{
    std::scoped_lock _(m_mutex);
    const auto phase = m_phase.load();
    const auto cpuOverride = CpuOverride(); // loaded once for both fields
    json out{{"enabled", EnabledNow()},
             {"enabled_at_load", m_enabled.load()},
             {"switched_off", m_switchedOff.load()},
             {"diagnostics", m_diagnostics.load()},
             {"phase", PhaseName(phase)},
             {"drawing_now", ShouldDraw(aNow)},
             {"hooks", {{"present", m_hookPresent}, {"resize", m_hookResize}, {"render_shutdown", m_hookShutdown}}},
             {"theme", ThemeName(Theme())},
             {"scale_percent", m_scalePercent},
             {"frames", m_frames.load()},
             {"cpu_ms", cpuOverride ? *cpuOverride : std::round(m_cpuMicros.load()) / 1000.0},
             {"cpu_ms_measured", std::round(m_cpuMicros.load()) / 1000.0},
             {"cpu_ms_override", cpuOverride ? json(*cpuOverride) : json(nullptr)},
             {"cpu_ms_max", std::round(m_cpuMicrosMax.load()) / 1000.0},
             {"gpu_ms", nullptr},
             {"hidden_for_capture", HiddenForCapture(aNow)},
             {"cet_diagnostics", DiagnosticsRequested()},
             {"cet_open", m_cetKnown.load() ? json(m_cetOpen.load()) : json(nullptr)},
             {"killed", m_killed.load()},
             {"pass_through", m_passThrough.load()},
             {"resizes", m_resizes},
             {"frame_generation_modules", m_frameGeneration}};
    {
        // 0.8.22: the motion in force and why (the pulse and the settle stand still when it is reduced).
        const auto motion = Motion();
        out["motion"] = {{"setting", MotionSettingName(MotionSettingNow())},
                         {"effective", motion.effective},
                         {"reason", motion.reason},
                         {"windows_animations", m_windowsAnimations.load()}};
    }
    if (!m_missing.empty())
    {
        out["missing"] = m_missing;
    }
    if (!m_refusal.empty())
    {
        out["refusal"] = m_refusal;
    }
    if (!m_failure.empty())
    {
        out["failure"] = m_failure;
    }
    if (phase == Phase::Drawing || phase == Phase::Refused || phase == Phase::Failed)
    {
        out["back_buffer"] = {{"format", m_facts.format}, {"count", m_facts.bufferCount}, {"width", m_facts.width}, {"height", m_facts.height}};
        // 0.8: "streamline" when the host draws (or refused) through Streamline's proxy swap chain (DLSS frame generation).
        out["swap_chain_proxy"] = m_facts.proxy.empty() ? json(nullptr) : json(m_facts.proxy);
        out["hdr_mode"] = m_facts.hdrMode == 0 ? "disabled" : m_facts.hdrMode == 1 ? "pq" : "scrgb";
    }
    if (!m_enabled.load())
    {
        out["why"] = "[overlay] enabled = false in config.ini (the test packages turn it on)";
    }
    else if (m_switchedOff.load())
    {
        out["why"] = "switched off live (overlay.set {enabled: false}); overlay.set {enabled: true} draws again";
    }
    return out;
}

DescriptorFreeList::DescriptorFreeList(uint32_t aCapacity) : m_used(aCapacity, false)
{
}

int32_t DescriptorFreeList::Alloc()
{
    for (size_t i = 0; i < m_used.size(); ++i)
    {
        if (!m_used[i])
        {
            m_used[i] = true;
            ++m_inUse;
            return static_cast<int32_t>(i);
        }
    }
    return -1;
}

bool DescriptorFreeList::Free(int32_t aSlot)
{
    if (aSlot < 0 || static_cast<size_t>(aSlot) >= m_used.size() || !m_used[static_cast<size_t>(aSlot)])
    {
        return false;
    }
    m_used[static_cast<size_t>(aSlot)] = false;
    --m_inUse;
    return true;
}

json SetLive(OverlayHost& aHost, const json& aParams, bool aTestHooks)
{
    params::RequireOnly(aParams, {"theme", "motion", "diagnostics", "enabled", "diagnostics_cpu_ms"});
    const bool hasFigure = aParams.is_object() && aParams.contains("diagnostics_cpu_ms");
    std::optional<double> figure;
    if (hasFigure)
    {
        if (!aTestHooks)
        {
            throw MethodError("test_hooks_off", "diagnostics_cpu_ms is a test figure: it needs a build with test hooks and [bridge] allow_test_hooks = true");
        }
        const auto& value = aParams["diagnostics_cpu_ms"];
        if (!value.is_null())
        {
            if (!value.is_number() || !std::isfinite(value.get<double>()) || value.get<double>() < 0.0 || value.get<double>() > 100.0)
            {
                params::CheckFail("'diagnostics_cpu_ms' is a number of milliseconds from 0 to 100, or null to clear it");
            }
            figure = value.get<double>();
        }
    }
    const auto theme = params::CheckText(aParams, "theme", 8);
    const auto motion = params::CheckText(aParams, "motion", 8);
    const auto diagnostics = params::CheckBoolean(aParams, "diagnostics");
    const auto enabled = params::CheckBoolean(aParams, "enabled");
    if (!theme && !motion && !diagnostics && !enabled && !hasFigure)
    {
        params::CheckFail("give at least one of theme, motion, diagnostics, enabled or diagnostics_cpu_ms");
    }
    if (theme && *theme != "dark" && *theme != "light")
    {
        params::CheckFail("'theme' is dark or light");
    }
    MotionSetting motionSetting = MotionSetting::Auto;
    if (motion && !MotionSettingFromName(*motion, motionSetting))
    {
        params::CheckFail("'motion' is auto, reduced or full");
    }
    if (enabled && *enabled && !aHost.Enabled())
    {
        // The host's rule since 0.7 (RB-107): its detours on GpuApi::Present, the back-buffer resize and the render shutdown attach
        // at load only and never detach, so a profile with the overlay off never patches the render path. RED4ext's hooking could
        // attach later (its transaction suspends the other threads), but patching Present live, beside CET's own hook on it, is
        // untested; until a session tests it, switching on stays a restart.
        throw MethodError("needs_restart", "the XF overlay was off at load ([overlay] enabled = false), and its hooks attach only at load: set enabled = true "
                                           "in config.ini and restart the game; after that, overlay.set {enabled: false/true} switches it live");
    }
    const json previous{{"theme", ThemeName(aHost.Theme())},
                        {"motion", MotionSettingName(aHost.MotionSettingNow())},
                        {"diagnostics", aHost.Diagnostics()},
                        {"enabled", aHost.EnabledNow()}};
    json undo = json::object();
    if (theme)
    {
        undo["theme"] = previous["theme"];
        aHost.SetTheme(ThemeFromName(*theme));
    }
    if (motion)
    {
        undo["motion"] = previous["motion"];
        aHost.SetMotion(motionSetting);
    }
    if (diagnostics)
    {
        undo["diagnostics"] = previous["diagnostics"];
        aHost.SetDiagnostics(*diagnostics);
    }
    if (enabled)
    {
        undo["enabled"] = previous["enabled"];
        if (aHost.Enabled()) aHost.SetSwitchedOff(!*enabled);
    }
    if (hasFigure)
    {
        const auto before = aHost.CpuOverride();
        undo["diagnostics_cpu_ms"] = before ? json(*before) : json(nullptr);
        aHost.SetCpuOverride(figure ? *figure : std::numeric_limits<double>::quiet_NaN());
    }
    const auto effective = aHost.Motion();
    return json{{"theme", ThemeName(aHost.Theme())},
                {"motion", {{"setting", MotionSettingName(aHost.MotionSettingNow())}, {"effective", effective.effective}, {"reason", effective.reason}}},
                {"diagnostics", aHost.Diagnostics()},
                {"enabled", aHost.EnabledNow()},
                {"enabled_at_load", aHost.Enabled()},
                {"diagnostics_cpu_ms", aHost.CpuOverride() ? json(*aHost.CpuOverride()) : json(nullptr)},
                {"previous", previous},
                {"in_memory", true},
                {"config_ini", "unchanged: a restart goes back to config.ini's [overlay] values"},
                {"repaint", "the XF box restyles before its next frame; the CET window and line take the theme with their next info refresh "
                            "(about 2 s); the ink panel uses the game's own colours and is not themed"},
                {"undo", {{"method", "overlay.set"}, {"params", undo}}}};
}
} // namespace xfb::overlay
