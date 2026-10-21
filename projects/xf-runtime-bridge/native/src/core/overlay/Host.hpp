#pragma once

// The XF ImGui overlay host, P0 (bridge 0.7; research/runtime/imgui-overlay-feasibility.md §8): draw-only, off by default,
// one diagnostic panel. This is the game-independent half (no RED4ext or D3D12 headers), so the self-test hosts it:
//   * OverlayHost: the host's state and every refusal reason, thread-safe, reported by overlay.state; the render thread asks
//     ShouldDraw() once per present (one atomic load when switched off: the pass-through flag, never an unhook);
//   * RefusalFor: the checks the renderer makes at first use (HDR, format, the engine's queue type, the game's window);
//   * TripleBuffer: the game thread publishes the panel's data every tick, the render thread takes the newest (never waits);
//   * DescriptorFreeList: the SRV slots the ImGui backend asks for (ImGui 1.92's allocator callbacks).
// The D3D12, hook and ImGui half is plugin/overlay/*.

#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/overlay/Theme.hpp"

namespace xfb::overlay
{
using json = nlohmann::json;

// What the renderer finds at its first present, for the refusal checks.
struct DeviceFacts
{
    bool deviceData = false;       // GpuApi::GetDeviceData resolved
    bool swapChain = false;        // a swap chain for the present's device index
    int hdrMode = 0;               // SSwapChainData::startupHdrMode: 0 Disabled, 1 PQ, 2 scRGB
    std::string format;            // the back buffer's DXGI format name, "R8G8B8A8_UNORM"
    bool directQueue = false;      // the engine's direct command queue is a DIRECT queue
    bool sameDevice = false;       // the swap chain belongs to the engine's device (directly or through a proxy, below)
    // 0.8 (session 8's I5c: DLSS frame generation put Streamline's proxy between the engine and DXGI, and the host refused):
    // "streamline" when the swap chain or the engine's device is one of Streamline's proxies and the two matched only once
    // each was resolved to its native object (DeviceMatch); "" otherwise.
    std::string proxy;
    std::string windowClass;       // the swap chain's window class ("W2ViewportClass")
    uint32_t bufferCount = 0;
    uint32_t width = 0, height = 0;
};

// The reason the host refuses to draw with these facts, or "" when it may.
std::string RefusalFor(const DeviceFacts& aFacts);

// 0.8: whether the swap chain's device and the engine's device are one device. Each identity is the object's IUnknown as
// given and, when it is a Streamline proxy, the native object behind it (Streamline answers that through its documented
// interface ID; 0 when the object isn't a proxy). Streamline's DLSS frame generation hands the engine proxies for the swap
// chain and possibly the device, so the two can differ as given and still be one device underneath [source] Streamline
// 2.14.1 docs/ProgrammingGuide.md §5.3, source/core/sl.interposer/dxgi/dxgiSwapchain.cpp (QueryInterface, GetDevice).
struct DeviceIdentity
{
    uintptr_t given = 0;
    uintptr_t native = 0; // 0: not a proxy
};
struct DeviceMatch
{
    bool same = false;
    bool throughProxy = false; // the match needed the native objects
};
DeviceMatch MatchDevices(const DeviceIdentity& aSwapChainDevice, const DeviceIdentity& aEngineDevice);
// RB-97: after a resize the renderer reads the swap chain again. Refuses what RefusalFor refuses (HDR switched on without a
// restart, a float or 10-bit format) and any change the renderer was built for: the back buffer's format (the pipeline
// state keeps the first) or its count (the heaps and allocators were sized for the first). "" when drawing may go on.
std::string RefusalAfterResize(const DeviceFacts& aFirst, const DeviceFacts& aNow);

// RB-99: the glyphs the host bakes into its font atlas once, at the start and after a resize, as inclusive code-point
// ranges (Latin, Latin-1, Latin Extended-A, general punctuation, the euro and trade marks, arrows, U+FFFD). Nothing outside
// them is ever drawn, so Dear ImGui never uploads a new glyph from the render thread.
const std::vector<std::pair<uint32_t, uint32_t>>& GlyphRanges();
// Panel text limited to GlyphRanges(): other code points and invalid UTF-8 become the bridge's one replacement mark, U+00A4
// (0.8: session 8 saw "?" where Segoe UI lacks U+FFFD; core/InkUi.hpp kReplacementMark), control characters spaces.
std::string LimitToGlyphs(const std::string& aText);

enum class Phase
{
    Disabled,  // [overlay] enabled = false: nothing hooked
    Unhooked,  // enabled, but a hook or an address is missing: nothing drawn
    Waiting,   // hooked, waiting for the first present
    Drawing,
    Refused,   // a check at first use failed (HDR, format, ...): passes everything through for the session
    Failed,    // an error while drawing (device removed, an exception): passes everything through
    ShutDown,  // the engine's render shutdown ran
};
const char* PhaseName(Phase aPhase);

// The panel's data, published by the game thread every tick.
struct PanelData
{
    std::string bridgeStatus; // one line: listening, writes, killed ...
    std::string tone;         // ok, write, paused, killed, off
    bool scriptsLive = false;
    uint64_t requests = 0;
    std::string pendingAsk;   // the question waiting for an answer, if any
    bool diagnostics = false; // 0.8: [overlay] diagnostics: the panel's diagnostic lines and moving bar
    // 0.8.2 (the surfaces' rule): the panel shows only while it is the status surface (the ink panel off screen: photo mode,
    // menus), and then carries the coordinator's lines (level, text, oldest first), the question's answer keys
    // ("F6 Done · F7 Not yet") or what was answered ("Answered: Done").
    bool show = false;
    std::vector<std::pair<std::string, std::string>> lines;
    std::string askHint;
    uint64_t tick = 0;
};

class OverlayHost
{
public:
    void Configure(bool aEnabled, ThemeKind aTheme, uint32_t aScalePercent);
    bool Enabled() const { return m_enabled.load(); }
    ThemeKind Theme() const { return m_theme; }
    float Scale() const { return static_cast<float>(m_scalePercent) / 100.0f; }

    // Load time: which hooks attached and which addresses were missing. Drawing needs all three: present, resize and the
    // render shutdown (RB-107: without the shutdown hook nothing would release the host before the device goes).
    void NoteHooks(bool aPresent, bool aResize, bool aShutdown, const std::string& aMissing);
    // The first present: the facts and the refusal (empty: drawing starts).
    void NoteInit(const DeviceFacts& aFacts, const std::string& aRefusal);
    void NoteFailure(const std::string& aWhy);
    void NoteShutdown();
    void NoteResize(uint32_t aWidth, uint32_t aHeight);
    // One drawn frame: the host's CPU time on the render thread in microseconds.
    void NoteFrame(double aCpuMicros);
    // RB-108 (Low 13): what the panel shows each frame, read from atomics (no JSON on the render thread).
    uint64_t Frames() const { return m_frames.load(); }
    double CpuMs() const { return m_cpuMicros.load() / 1000.0; }
    double CpuMsMax() const { return m_cpuMicrosMax.load() / 1000.0; }
    void NoteFrameGeneration(const std::vector<std::string>& aModules);
    // 0.8 (the UI review): the host was refused or stopped while a frame-generation module is loaded, so the CET label says
    // the overlay is off while frame generation is on.
    bool OffForFrameGeneration() const;

    // 0.8.2: whether the panel can be the status surface: drawing (hooked, not refused or failed) and not stopped by the kill
    // switch. A capture's hide and yielding to CET's overlay don't count: they are moments, and the CET line must not
    // take over during a capture.
    bool CanShowPanel() const { return m_enabled.load() && m_phase.load() == Phase::Drawing && !m_killed.load() && !m_passThrough.load(); }
    // Render thread, every present: draw now? (enabled, drawing, not hidden for a capture, not yielding to CET, not killed)
    bool ShouldDraw(std::chrono::steady_clock::time_point aNow = std::chrono::steady_clock::now()) const;
    bool Active() const { return m_phase.load() == Phase::Waiting || m_phase.load() == Phase::Drawing; }
    Phase CurrentPhase() const { return m_phase.load(); }

    // Captures hide the panel for their frames (overlay.hide); the flag lapses by itself after aMs.
    void HideForCapture(bool aHidden, uint32_t aMs, std::chrono::steady_clock::time_point aNow = std::chrono::steady_clock::now());
    bool HiddenForCapture(std::chrono::steady_clock::time_point aNow = std::chrono::steady_clock::now()) const;
    void SetCetOpen(bool aOpen) { m_cetOpen.store(aOpen); }
    void SetKilled(bool aKilled) { m_killed.store(aKilled); }
    // The pass-through switch (never an unhook, feasibility §2.4): false makes the detour call straight through.
    void SetPassThrough(bool aOn) { m_passThrough.store(aOn); }
    bool PassThrough() const { return m_passThrough.load(); }

    // overlay.state's answer.
    json Snapshot(std::chrono::steady_clock::time_point aNow = std::chrono::steady_clock::now()) const;

private:
    std::atomic<bool> m_enabled{false};
    std::atomic<Phase> m_phase{Phase::Disabled};
    std::atomic<bool> m_cetOpen{false};
    std::atomic<bool> m_killed{false};
    std::atomic<bool> m_passThrough{false};
    std::atomic<int64_t> m_hiddenUntilNs{0};
    std::atomic<uint64_t> m_frames{0};
    std::atomic<double> m_cpuMicros{0.0};
    std::atomic<double> m_cpuMicrosMax{0.0};
    ThemeKind m_theme = ThemeKind::Dark;
    uint32_t m_scalePercent = 100;
    mutable std::mutex m_mutex; // the fields below
    bool m_hookPresent = false, m_hookResize = false, m_hookShutdown = false;
    std::string m_missing;
    std::string m_refusal;
    std::string m_failure;
    DeviceFacts m_facts;
    uint32_t m_resizes = 0;
    std::vector<std::string> m_frameGeneration;
};

// A lock-free three-slot hand-off: the writer fills its slot and publishes it; the reader takes the newest published
// slot. Neither ever waits for the other. T must be copyable.
template<typename T>
class TripleBuffer
{
public:
    // Writer: the slot to fill.
    T& Back() { return m_slots[m_back]; }
    // Writer: publish Back() and get a fresh back slot.
    void Publish()
    {
        const uint32_t published = m_back | kFresh;
        const uint32_t old = m_middle.exchange(published);
        m_back = old & kIndex;
    }
    // Reader: true when a newer slot was published since the last take; Front() is then the newest.
    bool Take()
    {
        if ((m_middle.load() & kFresh) == 0)
        {
            return false;
        }
        const uint32_t old = m_middle.exchange(m_front);
        m_front = old & kIndex;
        return true;
    }
    const T& Front() const { return m_slots[m_front]; }

private:
    static constexpr uint32_t kFresh = 4;
    static constexpr uint32_t kIndex = 3;
    std::array<T, 3> m_slots{};
    uint32_t m_back = 0;
    uint32_t m_front = 1;
    std::atomic<uint32_t> m_middle{2};
};

// Fixed-capacity slot allocator (ImGui 1.92's SrvDescriptorAllocFn / FreeFn over our own heap).
class DescriptorFreeList
{
public:
    explicit DescriptorFreeList(uint32_t aCapacity = 64);
    int32_t Alloc();          // a slot index, or -1 when full
    bool Free(int32_t aSlot); // false for a slot that isn't allocated
    uint32_t InUse() const { return m_inUse; }
    uint32_t Capacity() const { return static_cast<uint32_t>(m_used.size()); }

private:
    std::vector<bool> m_used;
    uint32_t m_inUse = 0;
};
} // namespace xfb::overlay
