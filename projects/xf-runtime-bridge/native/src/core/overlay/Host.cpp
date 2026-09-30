#include "core/overlay/Host.hpp"

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
        return "the swap chain doesn't belong to the engine's device";
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
    m_theme = aTheme;
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
        m_phase.store(aPresent && aResize && m_missing.empty() ? Phase::Waiting : Phase::Unhooked);
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
}

bool OverlayHost::ShouldDraw(std::chrono::steady_clock::time_point aNow) const
{
    return m_enabled.load() && !m_passThrough.load() && m_phase.load() == Phase::Drawing && !m_killed.load() && !m_cetOpen.load() &&
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
    json out{{"enabled", m_enabled.load()},
             {"phase", PhaseName(phase)},
             {"drawing_now", ShouldDraw(aNow)},
             {"hooks", {{"present", m_hookPresent}, {"resize", m_hookResize}, {"render_shutdown", m_hookShutdown}}},
             {"theme", ThemeName(m_theme)},
             {"scale_percent", m_scalePercent},
             {"frames", m_frames.load()},
             {"cpu_ms", std::round(m_cpuMicros.load()) / 1000.0},
             {"cpu_ms_max", std::round(m_cpuMicrosMax.load()) / 1000.0},
             {"gpu_ms", nullptr},
             {"hidden_for_capture", HiddenForCapture(aNow)},
             {"cet_open", m_cetOpen.load()},
             {"killed", m_killed.load()},
             {"pass_through", m_passThrough.load()},
             {"resizes", m_resizes},
             {"frame_generation_modules", m_frameGeneration}};
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
        out["hdr_mode"] = m_facts.hdrMode == 0 ? "disabled" : m_facts.hdrMode == 1 ? "pq" : "scrgb";
    }
    if (!m_enabled.load())
    {
        out["why"] = "[overlay] enabled = false in config.ini (the test packages turn it on)";
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
} // namespace xfb::overlay
