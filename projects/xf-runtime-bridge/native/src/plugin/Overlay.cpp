// The XF ImGui overlay host's engine half, P0 (bridge 0.7). See Overlay.hpp and research/runtime/imgui-overlay-feasibility.md.
//
// Engine addresses (the address library RED4ext ships for the game's build, resolved with RED4ext_ResolveAddress at load;
// the same hashes Cyber Engine Tweaks hooks, CET src/reverse/Addresses.h at 9a8522f2, and the SDK's g_DeviceData):
//   2468877568  GpuApi::Present              void* (int32_t* aDeviceIndex, uint8_t aSomeSync, UINT aSyncInterval)
//   239671909   GpuApi::ResizeBackbuffer     void* (uint32_t aWidth, uint32_t aHeight, uint32_t, uint8_t, int32_t* aDeviceIndex)
//   3192982283  the render shutdown          void* (uint64_t, uint64_t, uint64_t, uint64_t), called once per device slot
//   1239944840  g_DeviceData                 a pointer to GpuApi::SDeviceData (SDK GpuApi/DeviceData.hpp, tag 1.0.0)
// Signatures [source] CET src/d3d12/D3D12_Hooks.cpp:11-62 (9a8522f2); layouts [source] RED4ext.SDK 1.0.0
// GpuApi/SwapChain.hpp, DeviceData.hpp (asserted offsets, identical to CET's hand-written ones).
//
// Rules (feasibility §2.4, §4): draw, then call the trampoline (CET's detour and the engine run after ours, so CET's windows
// draw over XF's); record into our own command list with our own descriptor heaps on the engine's DIRECT queue (never a
// queue of our own); never hook DXGI; never detach at run time (the host's pass-through flag instead; RED4ext detaches at
// exit); release the back buffers before the engine resizes; stop at the render shutdown; the drawing body runs under a
// structured-exception guard that switches the host off instead of ending the game.
//
// Deep review of 0.7.0 (research/authoring/code-health.md, RB-96..RB-118):
//   * RB-97: after a resize the swap chain's description and HDR mode are read again and the first-use checks run again
//     (core RefusalAfterResize); any change of format or buffer count refuses, since the pipeline and heaps were made for
//     the first.
//   * RB-98: the backend's device objects are created explicitly at start-up and a failure refuses; IM_ASSERT is ours
//     (xfb_imconfig.h): a failed assertion is recorded and, inside the guard, raised as a structured exception the guard
//     catches, so Release builds never draw on with a null pipeline.
//   * RB-99: the font atlas is baked once (Dear ImGui's legacy, non-dynamic atlas: core GlyphRanges()), panel text is
//     limited to those glyphs (core LimitToGlyphs), and a texture upload asked for at any other time stops the host instead
//     of letting the backend wait INFINITE on the engine's queue. Uploads happen only on the first frame and after a resize.
//   * RB-100: the render shutdown tears everything down under the lock: bounded fence waits, the backend's shutdown, the
//     context, every COM reference and the fence event.
//   * RB-105 (Low 10): every present checks the swap chain against the engine's for that device index; a new one stops the
//     host and lets go of the old one.
//   * RB-106 (Low 11): the lock is taken outside the structured-exception frame, so an exception can't leave it held; the
//     resize skips the lock once the host has given up.
//
// 0.8:
//   * Session 8's I5c: with DLSS frame generation the engine's swap chain (and possibly its device) is one of Streamline's
//     proxies, so "the swap chain belongs to the engine's device" failed and the host refused. Both are now resolved to
//     their native objects through Streamline's documented base-interface ID before they are compared (core MatchDevices).
//     The host makes its own objects on the native device and submits on the native direct queue (Streamline's rule for
//     third-party overlays: never use its proxies), and still takes the back buffers and their index from the engine's own
//     swap-chain object, as the engine and CET do: with frame generation on those are Streamline's buffers, the ones the
//     engine renders into and the frame generator reads. Cyber Engine Tweaks draws the same way and worked in session 8
//     with frame generation on. The panel is drawn before the interpolation, so it may ghost in generated frames.
//   * The UI review: the panel sits right of the CET label (x 700 px, unscaled like the label's wrap), its title is
//     "XF Runtime Bridge", the status line is the one every surface shows (core/InkUi.cpp Summarize), the question is left
//     to the ink panel and the CET window, and the diagnostic lines (with the moving bar) show only with
//     [overlay] diagnostics.
//
// 0.8.22 (the Studio's "In-game surfaces", style guide section 09; core/overlay/ThemeTable.inc is generated from its table):
//   * five fonts, one per type role (title and eyebrow in the display face at 15 and 11, body and label in the UI face at 13 and
//     12, value in the mono face at 12), baked together in BuildFonts at start and after a resize and never in a frame; the panel
//     draws the Studio's components (heading with the chamfered brand mark, status line, key-value rows, cards, bars on XfLine,
//     chamfered chips with tracked capitals) from the palette and sizes LoadStyle looked up when it baked;
//   * the pulse and the settle run on one clock (ImGui::GetTime), are functions of it (core/overlay/Motion.cpp) and stand still
//     when the effective motion is reduced ([overlay] motion, Windows' animation-effects setting, frame generation);
//   * nothing is allocated per frame beyond the visible rows: text goes through stack buffers and the window's draw list.

#include <RED4ext/RED4ext.hpp>
#include <RED4ext/GpuApi/DeviceData.hpp>

#include <Windows.h>
#include <d3d12.h>
#include <dxgi1_6.h>
#include <wrl/client.h>

#include <algorithm>
#include <atomic>
#include <cfloat>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <mutex>
#include <string>
#include <vector>

#include <imgui.h>
#include <imgui_impl_dx12.h>
#include <imgui_internal.h>

#include "core/Log.hpp"
#include "core/Win32.hpp"
#include "core/overlay/Motion.hpp"
#include "plugin/Overlay.hpp"
#include "plugin/CanvasDraw.hpp"
#include "plugin/Plugin.hpp"

#if !defined(XFB_IMGUI_ASSERT_OVERRIDDEN)
#error "Dear ImGui must be built with the bridge's IM_ASSERT (IMGUI_USER_CONFIG=xfb_imconfig.h): Release builds would otherwise ignore backend failures (RB-98)"
#endif

namespace xfb::plugin::overlay
{
IDXGISwapChain3* CurrentSwapChain();
}

// Dear ImGui's DirectX 12 backend (docking branch) asks DXGI for a factory once, to read tearing support for secondary
// viewports, which the host never opens. Rather than import dxgi.dll (on the reference install ReShade's proxy) and make a
// factory of our own, the host answers with the factory the game's own swap chain was made from (GetParent): no new DXGI
// object is created.
extern "C" HRESULT WINAPI CreateDXGIFactory1(REFIID aRiid, void** aOut)
{
    if (!aOut)
    {
        return E_POINTER;
    }
    *aOut = nullptr;
    auto* swapChain = xfb::plugin::overlay::CurrentSwapChain();
    return swapChain ? swapChain->GetParent(aRiid, aOut) : E_FAIL;
}

namespace
{
// RB-98: Dear ImGui's assertions (xfb_imconfig.h). Recorded once; inside the render-thread guard they are raised as a
// structured exception with this code, which the guard catches and turns into "the overlay stops".
constexpr DWORD kImGuiAssertCode = 0xE0584641; // 'XFA'
thread_local int tGuardDepth = 0;
std::atomic<bool> gAssertFailed{false};
char gAssertText[256] = {};
} // namespace

void XfbImGuiAssertFailed(const char* aExpr, const char* aFile, int aLine)
{
    if (!gAssertFailed.exchange(true))
    {
        const char* name = aFile ? aFile : "";
        for (const char* c = name; *c; ++c)
        {
            if (*c == '/' || *c == '\\')
            {
                name = c + 1;
            }
        }
        std::snprintf(gAssertText, sizeof(gAssertText), "%s (%s:%d)", aExpr ? aExpr : "?", name, aLine);
    }
    if (tGuardDepth > 0)
    {
        RaiseException(kImGuiAssertCode, 0, 0, nullptr);
    }
}

namespace xfb::plugin::overlay
{
namespace
{
using Microsoft::WRL::ComPtr;

// 0.8.4 (the UI review's fix 4): the panel's place is the ink panel's (core PanelOrigin), no longer a fixed 700, 12.
float gPanelHeight = 0.0f; // the panel's height last frame (render thread), for anchors measured from the bottom or centre
using xfb::overlay::DeviceFacts;
using xfb::overlay::OverlayHost;
using xfb::overlay::PanelData;
using xfb::overlay::ThemeKind;

constexpr uint32_t kHashPresent = 2468877568UL;
constexpr uint32_t kHashResize = 239671909UL;
constexpr uint32_t kHashShutdown = 3192982283UL;
constexpr uint32_t kHashDeviceData = 1239944840UL;
constexpr uint32_t kSrvSlots = 64;
constexpr DWORD kTeardownWaitMs = 500;

using Present_t = void* (*)(int32_t*, uint8_t, UINT);
using Resize_t = void* (*)(uint32_t, uint32_t, uint32_t, uint8_t, int32_t*);
using Shutdown_t = void* (*)(uint64_t, uint64_t, uint64_t, uint64_t);

Present_t gPresent = nullptr;
Resize_t gResize = nullptr;
Shutdown_t gShutdown = nullptr;
uintptr_t gDeviceDataSlot = 0;
OverlayHost* gHost = nullptr;

xfb::overlay::TripleBuffer<PanelData> gPanel;

// Render-thread state. Only the present, resize and shutdown detours touch it, each under the mutex (taken outside the
// structured-exception frame, RB-106); gaveUp is atomic so a detour can skip the lock once the host has stopped.
struct Renderer
{
    std::mutex mutex;
    std::atomic<bool> gaveUp{false};
    bool initialised = false;
    bool backendInit = false;
    bool shutDown = false;
    int32_t deviceIndex = 0;
    IDXGISwapChain4* engineSwapChain = nullptr; // the engine's swap chain the host was made for (identity only, RB-105)
    DeviceFacts firstFacts;
    ComPtr<ID3D12Device> device;
    ComPtr<ID3D12CommandQueue> queue;
    ComPtr<IDXGISwapChain3> swapChain;
    ComPtr<ID3D12DescriptorHeap> srvHeap;
    ComPtr<ID3D12DescriptorHeap> rtvHeap;
    UINT rtvStride = 0, srvStride = 0;
    std::vector<ComPtr<ID3D12CommandAllocator>> allocators;
    std::vector<ComPtr<ID3D12Resource>> buffers;
    std::vector<uint64_t> fenceValues;
    ComPtr<ID3D12GraphicsCommandList> list;
    ComPtr<ID3D12Fence> fence;
    HANDLE fenceEvent = nullptr;
    uint64_t fenceNext = 1;
    DXGI_FORMAT format = DXGI_FORMAT_UNKNOWN;
    UINT bufferCount = 0;
    UINT width = 0, height = 0;
    bool needBuffers = true;
    xfb::overlay::DescriptorFreeList slots{kSrvSlots};
    ImGuiContext* context = nullptr;
    // 0.8.22: one baked font per type role (the Studio's scale), the palette and sizes looked up when they were baked, and the
    // render-thread state of the motion (the status row's settle).
    struct Fonts
    {
        ImFont* title = nullptr;   // display face, the heading
        ImFont* eyebrow = nullptr; // display face, group labels and chips
        ImFont* body = nullptr;    // UI face, status and messages
        ImFont* label = nullptr;   // UI face, key-value labels
        ImFont* value = nullptr;   // mono face, figures
    } fonts;
    struct Colours
    {
        ImVec4 text, textDisabled, textMuted, accent, accentInk, accentEdge, accentText, signal, signalBg, signalLine, line, success, successBg,
            warning, warningBg, danger, dangerBg, plot, childBg;
    } colours;
    struct Metrics
    {
        float itemSpacingX = 8, itemSpacingY = 6, itemInnerSpacingX = 6, sectionGap = 16, childPadX = 8, childPadY = 6, chipPadX = 8, chipPadY = 2,
              bevelSmall = 4, bevelLarge = 7, barThin = 6, barLabelled = 16, rounding = 2, dot = 8, markW = 30, markH = 24, eyebrowSquare = 6, edge = 2,
              tracking = 0.1f;
    } metrics;
    float scale = 1.0f;          // the back buffer's height over 1080 times the player's overlay scale
    ImVec4 cardEdge{0, 0, 0, 0}; // the open card's left edge colour (alpha 0: none)
    xfb::overlay::Settle statusSettle;
    float statusRowHeight = 0.0f; // the status row's height last frame (the settle wash is drawn before the row)
    UINT fontHeight = 0;         // the back buffer height the fonts were baked for (RB-108: rebuilt after a resize)
    uint32_t themeGeneration = 0; // 0.8.22: the host's theme generation the style was built for (overlay.set restyles)
    bool uploadsAllowed = false; // RB-99: a font texture upload is expected (the first frame, the frame after a rebuild)
    std::chrono::steady_clock::time_point last = std::chrono::steady_clock::now();
    std::chrono::steady_clock::time_point started = std::chrono::steady_clock::now();
    PanelData panel;
    std::vector<std::string> frameGeneration;
    // 0.8.22: the diagnostics card's two strings that don't change after start-up, made once in Initialise (nothing is built per frame).
    std::string frameGenerationText = "none";
    std::string formatText;
};
Renderer gR;

// The baked glyph ranges as ImGui wants them (pairs, zero-terminated), from core GlyphRanges().
const ImWchar* GlyphRangesForImGui()
{
    static const std::vector<ImWchar> ranges = [] {
        std::vector<ImWchar> out;
        for (const auto& [lo, hi] : xfb::overlay::GlyphRanges())
        {
            out.push_back(static_cast<ImWchar>(lo));
            out.push_back(static_cast<ImWchar>(hi));
        }
        out.push_back(0);
        return out;
    }();
    return ranges.data();
}

std::string FormatName(DXGI_FORMAT aFormat)
{
    switch (aFormat)
    {
    case DXGI_FORMAT_R8G8B8A8_UNORM:
        return "R8G8B8A8_UNORM";
    case DXGI_FORMAT_B8G8R8A8_UNORM:
        return "B8G8R8A8_UNORM";
    case DXGI_FORMAT_R10G10B10A2_UNORM:
        return "R10G10B10A2_UNORM";
    case DXGI_FORMAT_R16G16B16A16_FLOAT:
        return "R16G16B16A16_FLOAT";
    case DXGI_FORMAT_R8G8B8A8_UNORM_SRGB:
        return "R8G8B8A8_UNORM_SRGB";
    default:
        return "format " + std::to_string(static_cast<int>(aFormat));
    }
}

RED4ext::GpuApi::SDeviceData* DeviceData()
{
    if (!gDeviceDataSlot)
    {
        return nullptr;
    }
    return *reinterpret_cast<RED4ext::GpuApi::SDeviceData**>(gDeviceDataSlot);
}

RED4ext::GpuApi::SSwapChainData* SwapChainData(int32_t aDeviceIndex)
{
    auto* dd = DeviceData();
    const uint32_t id = aDeviceIndex > 0 ? static_cast<uint32_t>(aDeviceIndex) : 0;
    if (!dd || !dd->swapChains.IsUsedID(id))
    {
        return nullptr;
    }
    return &dd->swapChains.GetData(id);
}

// Streamline's interface ID for "the native object behind this proxy" (StreamlineRetrieveBaseInterface): a proxy answers
// its base object (with a reference), anything else answers E_NOINTERFACE [source] Streamline 2.14.1
// docs/ProgrammingGuide.md §5.3, source/core/sl.interposer/dxgi/dxgiSwapchain.cpp:117-128.
constexpr GUID kStreamlineBase = {0xADEC44E2, 0x61F0, 0x45C3, {0xAD, 0x9F, 0x1B, 0x37, 0x37, 0x92, 0x84, 0xFF}};

// The native object behind a Streamline proxy, or null when aObject isn't one.
ComPtr<IUnknown> StreamlineNative(IUnknown* aObject)
{
    ComPtr<IUnknown> base;
    if (aObject && SUCCEEDED(aObject->QueryInterface(kStreamlineBase, reinterpret_cast<void**>(base.GetAddressOf()))) && base)
    {
        ComPtr<IUnknown> identity;
        base->QueryInterface(IID_PPV_ARGS(&identity));
        return identity ? identity : base;
    }
    return nullptr;
}

// An object's identity for MatchDevices: its IUnknown and, for a Streamline proxy, the native object's.
xfb::overlay::DeviceIdentity IdentityOf(IUnknown* aObject)
{
    xfb::overlay::DeviceIdentity id;
    if (!aObject)
    {
        return id;
    }
    ComPtr<IUnknown> unknown;
    aObject->QueryInterface(IID_PPV_ARGS(&unknown));
    id.given = reinterpret_cast<uintptr_t>(unknown.Get());
    if (const auto native = StreamlineNative(aObject))
    {
        id.native = reinterpret_cast<uintptr_t>(native.Get());
    }
    return id;
}

// The native interface behind a possible Streamline proxy, as type T (the object itself when it isn't a proxy).
template<typename T>
ComPtr<T> NativeOf(T* aObject)
{
    ComPtr<T> out;
    if (const auto native = StreamlineNative(aObject))
    {
        native.As(&out);
    }
    if (!out)
    {
        out = aObject;
    }
    return out;
}

// What the renderer sees now for a device index: the facts the refusal checks read, the swap chain's description, and the
// engine's swap-chain record (null when there is none). Used at the first present and again after every resize (RB-97).
RED4ext::GpuApi::SSwapChainData* ReadFacts(int32_t aDeviceIndex, DeviceFacts& aFacts, DXGI_SWAP_CHAIN_DESC1& aDesc)
{
    auto* dd = DeviceData();
    aFacts.deviceData = dd != nullptr;
    auto* sc = SwapChainData(aDeviceIndex);
    aFacts.swapChain = sc && sc->swapChain;
    if (!aFacts.swapChain)
    {
        return nullptr;
    }
    aFacts.hdrMode = static_cast<int>(sc->startupHdrMode);
    sc->swapChain->GetDesc1(&aDesc);
    aFacts.format = FormatName(aDesc.Format);
    aFacts.bufferCount = aDesc.BufferCount;
    aFacts.width = aDesc.Width;
    aFacts.height = aDesc.Height;
    wchar_t cls[64]{};
    if (sc->windowHandle && GetClassNameW(sc->windowHandle, cls, 64) > 0)
    {
        for (const wchar_t* c = cls; *c; ++c)
        {
            aFacts.windowClass.push_back(static_cast<char>(*c < 128 ? *c : '?'));
        }
    }
    ComPtr<ID3D12Device> scDevice;
    sc->swapChain->GetDevice(IID_PPV_ARGS(&scDevice));
    // 0.8: through Streamline's proxies where the engine has them (session 8's I5c).
    const auto swapChainId = IdentityOf(sc->swapChain.Get());
    const auto match = xfb::overlay::MatchDevices(IdentityOf(scDevice.Get()), IdentityOf(dd->device.Get()));
    aFacts.sameDevice = match.same;
    aFacts.proxy = match.throughProxy || swapChainId.native != 0 ? "streamline" : "";
    aFacts.directQueue = dd->directCommandQueue && dd->directCommandQueue->GetDesc().Type == D3D12_COMMAND_LIST_TYPE_DIRECT;
    return sc;
}

// The XF Studio theme (core/overlay/ThemeTable.inc, generated from the Studio's tokens and its in-game table) as the ImGui style,
// from scratch (ScaleAllSizes is cumulative, so a rebuild after a resize starts from the default style). Every colour slot of the
// pinned ImGui 1.92.9 has an entry, so no widget shows ImGui's default blue; the names are looked up by ImGui's own colour name.
void ApplyTheme(ThemeKind aKind, float aScale)
{
    auto& style = ImGui::GetStyle();
    style = ImGuiStyle();
    for (int i = 0; i < ImGuiCol_COUNT; ++i)
    {
        float rgba[4];
        if (xfb::overlay::ThemeColorOf(ImGui::GetStyleColorName(i), aKind, rgba))
        {
            style.Colors[i] = ImVec4(rgba[0], rgba[1], rgba[2], rgba[3]);
        }
    }
    using xfb::overlay::ThemeMetricOf;
    style.WindowPadding = ImVec2(ThemeMetricOf("WindowPaddingX", 12), ThemeMetricOf("WindowPaddingY", 12));
    style.FramePadding = ImVec2(ThemeMetricOf("FramePaddingX", 8), ThemeMetricOf("FramePaddingY", 6));
    style.ItemSpacing = ImVec2(ThemeMetricOf("ItemSpacingX", 8), ThemeMetricOf("ItemSpacingY", 6));
    style.ItemInnerSpacing = ImVec2(ThemeMetricOf("ItemInnerSpacingX", 6), ThemeMetricOf("ItemInnerSpacingY", 4));
    const float rounding = ThemeMetricOf("Rounding", 2);
    style.WindowRounding = style.FrameRounding = style.GrabRounding = style.PopupRounding = style.ScrollbarRounding = style.TabRounding =
        style.ChildRounding = rounding;
    style.WindowBorderSize = 1.0f;
    style.FrameBorderSize = 1.0f;
    style.ChildBorderSize = 1.0f;
    // 0.8.22: the Studio's thin scrollbars and its disabled opacity (the .btn:disabled rule), from the table.
    style.ScrollbarSize = ThemeMetricOf("ScrollbarSize", 8);
    style.DisabledAlpha = xfb::overlay::ThemeValueOf("DisabledAlpha", 0.45f);
    style.ScaleAllSizes(aScale);
}

// A face's font at a pixel size (the Studio's size times the back buffer's scale), from the first of the face's Windows font
// files that exists, else ImGui's built-in font. Baked with the panel's glyph ranges only (RB-99). aWeight is the Studio's weight
// for the role: no static file of any face here has another weight (see BuildFonts), so it is carried to this point and the
// file's default instance is what is drawn.
ImFont* LoadFont(const char* aFace, float aSize, int aWeight)
{
    (void)aWeight;
    auto& io = ImGui::GetIO();
    wchar_t windows[MAX_PATH]{};
    GetWindowsDirectoryW(windows, MAX_PATH);
    for (const auto* file : xfb::overlay::ThemeFontFiles(aFace))
    {
        const auto path = std::filesystem::path(windows) / L"Fonts" / file;
        std::error_code error;
        if (std::filesystem::exists(path, error))
        {
            ImFontConfig config;
            config.GlyphRanges = GlyphRangesForImGui();
            if (auto* font = io.Fonts->AddFontFromFileTTF(path.string().c_str(), aSize, &config))
            {
                return font;
            }
        }
    }
    ImFontConfig config;
    config.SizePixels = aSize;
    config.GlyphRanges = GlyphRangesForImGui();
    return io.Fonts->AddFontDefault(&config);
}

ImVec4 ThemeVec(const char* aName, ThemeKind aKind)
{
    float rgba[4] = {1, 1, 1, 1};
    xfb::overlay::ThemeColorOf(aName, aKind, rgba);
    return ImVec4(rgba[0], rgba[1], rgba[2], rgba[3]);
}

// The colours and sizes the panel draws with, looked up once per (re)build, never per frame (0.8.22: the draw code reads these
// and carries no colour or pixel literal of its own).
void LoadStyle(float aScale)
{
    const auto kind = gHost->Theme();
    auto& c = gR.colours;
    c.text = ThemeVec("Text", kind);
    c.textDisabled = ThemeVec("TextDisabled", kind);
    c.textMuted = ThemeVec("XfTextMuted", kind);
    c.accent = ThemeVec("XfAccent", kind);
    c.accentInk = ThemeVec("XfAccentInk", kind);
    c.accentEdge = ThemeVec("XfAccentEdge", kind);
    c.accentText = ThemeVec("XfAccentText", kind);
    c.signal = ThemeVec("XfSignal", kind);
    c.signalBg = ThemeVec("XfSignalBg", kind);
    c.signalLine = ThemeVec("XfSignalLine", kind);
    c.line = ThemeVec("XfLine", kind);
    c.success = ThemeVec("XfSuccess", kind);
    c.successBg = ThemeVec("XfSuccessBg", kind);
    c.warning = ThemeVec("XfWarning", kind);
    c.warningBg = ThemeVec("XfWarningBg", kind);
    c.danger = ThemeVec("XfDanger", kind);
    c.dangerBg = ThemeVec("XfDangerBg", kind);
    c.plot = ThemeVec("PlotHistogram", kind);
    c.childBg = ThemeVec("ChildBg", kind);
    using xfb::overlay::ThemeMetricOf;
    auto& m = gR.metrics;
    m.itemSpacingX = ThemeMetricOf("ItemSpacingX", 8) * aScale;
    m.itemSpacingY = ThemeMetricOf("ItemSpacingY", 6) * aScale;
    m.itemInnerSpacingX = ThemeMetricOf("ItemInnerSpacingX", 6) * aScale;
    m.sectionGap = ThemeMetricOf("SectionGap", 16) * aScale;
    m.childPadX = ThemeMetricOf("ChildPaddingX", 8) * aScale;
    m.childPadY = ThemeMetricOf("ChildPaddingY", 6) * aScale;
    m.chipPadX = ThemeMetricOf("ChipPaddingX", 8) * aScale;
    m.chipPadY = ThemeMetricOf("ChipPaddingY", 2) * aScale;
    m.bevelSmall = ThemeMetricOf("BevelSmall", 4) * aScale;
    m.bevelLarge = ThemeMetricOf("BevelLarge", 7) * aScale;
    m.barThin = ThemeMetricOf("BarThin", 6) * aScale;
    m.barLabelled = ThemeMetricOf("BarLabelled", 16) * aScale;
    m.rounding = ThemeMetricOf("Rounding", 2) * aScale;
    m.dot = 8.0f * aScale; // the status dot's diameter: the Studio's 8 px (the style guide's Status line anatomy)
    m.markW = 30.0f * aScale; // the brand mark: the Studio's .brand-mark, 30 x 24
    m.markH = 24.0f * aScale;
    m.eyebrowSquare = 6.0f * aScale; // the eyebrow's square and its gap
    m.edge = 2.0f * aScale;          // a card's left edge
    m.tracking = 0.1f;               // a tracked label's gap, in em
}

// 0.8.22: ImGui's style and the panel's colours for the host's theme now, at aScale; the fonts stay as baked. BuildFonts calls it,
// and so does the frame after overlay.set changes the theme (the generation is read first, so a change while this runs restyles again).
void Restyle(float aScale)
{
    gR.themeGeneration = gHost->ThemeGeneration();
    ApplyTheme(gHost->Theme(), aScale);
    LoadStyle(aScale);
    ImGui::GetStyle().FontSizeBase = gR.fonts.body ? gR.fonts.body->LegacySize : 13.0f * aScale;
}

// RB-99, RB-108: the fonts at the current height's scale, every glyph baked now (the atlas is never grown while drawing, and
// never per frame), and the theme at the same scale. 0.8.22: one font per type role, five in all (title and eyebrow in the
// display face, body and label in the UI face, value in the mono face), sized by the Studio's scale. The next frame uploads the
// new atlas; that upload is expected.
void BuildFonts()
{
    auto& io = ImGui::GetIO();
    io.Fonts->Clear();
    const float scale = (static_cast<float>(gR.height) / 1080.0f) * gHost->Scale();
    std::string weights; // roles whose Studio weight (600) the builder cannot draw, for the log line below
    const auto roleFont = [scale, &weights](const char* aRole, const char* aFace, float aFallback) {
        const auto* type = xfb::overlay::ThemeTypeOf(aRole);
        const int weight = type ? type->weight : 400;
        if (weight != 400)
        {
            weights += (weights.empty() ? "" : ",") + std::string(aRole) + "=" + std::to_string(weight);
        }
        return LoadFont(type ? type->face : aFace, (type ? type->size : aFallback) * scale, weight);
    };
    gR.fonts.title = roleFont("title", "display", 15.0f);
    gR.fonts.eyebrow = roleFont("eyebrow", "display", 11.0f);
    gR.fonts.body = roleFont("body", "ui", 13.0f);
    gR.fonts.label = roleFont("label", "ui", 12.0f);
    gR.fonts.value = roleFont("value", "mono", 12.0f);
    io.FontDefault = gR.fonts.body;
    ImFontAtlasBuildMain(io.Fonts);
    Restyle(scale);
    if (!weights.empty())
    {
        // 0.8.22: the Studio sets the title and eyebrow roles at weight 600 (Bahnschrift SemiBold). The display face on Windows is one
        // variable font (bahnschrift.ttf: wght 300-700, default 400, no static instances), and this build's font builder (Dear ImGui's
        // stb_truetype) draws a variable font's default instance only: choosing wght needs FreeType (a new dependency), which
        // ImGui's builder would then drive. So these roles are drawn at the default weight (400); the size, face and capitals are
        // the Studio's. Said once per bake, in the log, so a review does not take it for a bug.
        log::Info("overlay.fonts", "weights_asked=" + weights + " drawn=400 (the display face is a variable font; the font builder cannot select a weight)");
    }
    gR.fontHeight = gR.height;
    gR.uploadsAllowed = true;
}

void SrvAlloc(ImGui_ImplDX12_InitInfo*, D3D12_CPU_DESCRIPTOR_HANDLE* aCpu, D3D12_GPU_DESCRIPTOR_HANDLE* aGpu)
{
    const auto slot = gR.slots.Alloc();
    const auto index = slot < 0 ? 0 : slot; // a full list reuses slot 0 rather than writing outside the heap
    aCpu->ptr = gR.srvHeap->GetCPUDescriptorHandleForHeapStart().ptr + static_cast<SIZE_T>(index) * gR.srvStride;
    aGpu->ptr = gR.srvHeap->GetGPUDescriptorHandleForHeapStart().ptr + static_cast<UINT64>(index) * gR.srvStride;
}

void SrvFree(ImGui_ImplDX12_InitInfo*, D3D12_CPU_DESCRIPTOR_HANDLE aCpu, D3D12_GPU_DESCRIPTOR_HANDLE)
{
    const auto base = gR.srvHeap->GetCPUDescriptorHandleForHeapStart().ptr;
    gR.slots.Free(static_cast<int32_t>((aCpu.ptr - base) / gR.srvStride));
}

// Waits (bounded) until the GPU is done with our last use of buffer aIndex; false when it isn't within aMs.
bool WaitBuffer(size_t aIndex, DWORD aMs)
{
    if (aIndex < gR.fenceValues.size() && gR.fence && gR.fenceEvent && gR.fence->GetCompletedValue() < gR.fenceValues[aIndex])
    {
        gR.fence->SetEventOnCompletion(gR.fenceValues[aIndex], gR.fenceEvent);
        return WaitForSingleObject(gR.fenceEvent, aMs) == WAIT_OBJECT_0;
    }
    return true;
}

void ReleaseBuffers()
{
    for (size_t i = 0; i < gR.buffers.size(); ++i)
    {
        WaitBuffer(i, 500);
    }
    gR.buffers.clear();
    gR.needBuffers = true;
}

// RB-100: everything the host made or holds, released. The GPU's use of our objects is waited for first, bounded; if it
// doesn't finish in time the host's own objects are left alive (a leak until the process ends) rather than freed under
// the GPU, and only the references to the engine's objects are let go.
void Teardown()
{
    bool idle = true;
    for (size_t i = 0; i < gR.fenceValues.size(); ++i)
    {
        idle = WaitBuffer(i, kTeardownWaitMs) && idle;
    }
    gR.buffers.clear();
    gR.swapChain.Reset();
    gR.engineSwapChain = nullptr;
    gR.initialised = false;
    if (!idle)
    {
        log::Warn("overlay.teardown", "the GPU didn't finish the overlay's last frames within " + std::to_string(kTeardownWaitMs) +
                                          " ms; its own objects are left alive rather than freed under the GPU");
        return;
    }
    if (gR.context)
    {
        ImGui::SetCurrentContext(gR.context);
        if (gR.backendInit)
        {
            gR.backendInit = false;
            ImGui_ImplDX12_Shutdown();
        }
        ImGui::DestroyContext(gR.context);
        gR.context = nullptr;
        gR.fonts = {};
    }
    gR.list.Reset();
    gR.allocators.clear();
    gR.fenceValues.clear();
    gR.fence.Reset();
    gR.srvHeap.Reset();
    gR.rtvHeap.Reset();
    gR.queue.Reset();
    gR.device.Reset();
    gR.slots = xfb::overlay::DescriptorFreeList(kSrvSlots);
    if (gR.fenceEvent)
    {
        CloseHandle(gR.fenceEvent);
        gR.fenceEvent = nullptr;
    }
}

// A refusal or failure at start-up: recorded, logged, and whatever was made so far released.
bool Refuse(const DeviceFacts& aFacts, const std::string& aWhy)
{
    gHost->NoteInit(aFacts, aWhy);
    log::Warn("overlay.refused", "why=" + aWhy);
    Teardown();
    return false;
}

// First present: the checks (Host.hpp RefusalFor), then our heaps, allocators, list, fence and ImGui.
bool Initialise(int32_t aDeviceIndex)
{
    DeviceFacts facts;
    DXGI_SWAP_CHAIN_DESC1 desc{};
    auto* sc = ReadFacts(aDeviceIndex, facts, desc);
    gR.frameGeneration = win32::FrameGenerationModules();
    gHost->NoteFrameGeneration(gR.frameGeneration);
    gR.frameGenerationText.clear();
    for (const auto& name : gR.frameGeneration)
    {
        gR.frameGenerationText += (gR.frameGenerationText.empty() ? "" : ", ") + name;
    }
    if (gR.frameGenerationText.empty())
    {
        gR.frameGenerationText = "none";
    }
    if (const auto refusal = xfb::overlay::RefusalFor(facts); !refusal.empty())
    {
        return Refuse(facts, refusal);
    }
    auto* dd = DeviceData();
    gR.deviceIndex = aDeviceIndex;
    gR.firstFacts = facts;
    gR.engineSwapChain = sc->swapChain.Get();
    // 0.8: our own objects on the native device and the native direct queue (the same objects when there is no proxy); the
    // back buffers still come from the engine's own swap-chain object below.
    gR.device = NativeOf(dd->device.Get());
    gR.queue = NativeOf(dd->directCommandQueue.Get());
    sc->swapChain.As(&gR.swapChain);
    gR.format = desc.Format;
    gR.formatText = FormatName(desc.Format);
    gR.bufferCount = desc.BufferCount;
    gR.width = desc.Width;
    gR.height = desc.Height;

    D3D12_DESCRIPTOR_HEAP_DESC srv{D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV, kSrvSlots, D3D12_DESCRIPTOR_HEAP_FLAG_SHADER_VISIBLE, 0};
    D3D12_DESCRIPTOR_HEAP_DESC rtv{D3D12_DESCRIPTOR_HEAP_TYPE_RTV, gR.bufferCount, D3D12_DESCRIPTOR_HEAP_FLAG_NONE, 0};
    if (FAILED(gR.device->CreateDescriptorHeap(&srv, IID_PPV_ARGS(&gR.srvHeap))) || FAILED(gR.device->CreateDescriptorHeap(&rtv, IID_PPV_ARGS(&gR.rtvHeap))))
    {
        return Refuse(facts, "couldn't create the overlay's descriptor heaps");
    }
    gR.srvStride = gR.device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV);
    gR.rtvStride = gR.device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_RTV);
    gR.allocators.resize(gR.bufferCount);
    gR.fenceValues.assign(gR.bufferCount, 0);
    for (auto& allocator : gR.allocators)
    {
        if (FAILED(gR.device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&allocator))))
        {
            return Refuse(facts, "couldn't create the overlay's command allocators");
        }
    }
    if (FAILED(gR.device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, gR.allocators[0].Get(), nullptr, IID_PPV_ARGS(&gR.list))) ||
        FAILED(gR.list->Close()) || FAILED(gR.device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&gR.fence))))
    {
        return Refuse(facts, "couldn't create the overlay's command list or fence");
    }
    gR.fenceEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!gR.fenceEvent)
    {
        return Refuse(facts, "couldn't create the overlay's fence event");
    }

    IMGUI_CHECKVERSION();
    gR.context = ImGui::CreateContext();
    ImGui::SetCurrentContext(gR.context);
    auto& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.ConfigFlags |= ImGuiConfigFlags_NoMouseCursorChange;

    ImGui_ImplDX12_InitInfo info;
    info.Device = gR.device.Get();
    info.CommandQueue = gR.queue.Get();
    info.NumFramesInFlight = static_cast<int>(gR.bufferCount);
    info.RTVFormat = gR.format;
    info.DSVFormat = DXGI_FORMAT_UNKNOWN;
    info.SrvDescriptorHeap = gR.srvHeap.Get();
    info.SrvDescriptorAllocFn = &SrvAlloc;
    info.SrvDescriptorFreeFn = &SrvFree;
    if (!ImGui_ImplDX12_Init(&info))
    {
        return Refuse(facts, "Dear ImGui's DirectX 12 renderer didn't start");
    }
    gR.backendInit = true;
    // RB-99: no dynamic atlas. With the backend's texture flag cleared Dear ImGui bakes every glyph of the ranges once and
    // never asks the backend for a new glyph while drawing (whose upload waits INFINITE on the engine's queue).
    io.BackendFlags &= ~ImGuiBackendFlags_RendererHasTextures;
    BuildFonts();
    // RB-98: the pipeline and root signature now, not lazily in the first NewFrame, where a failure was only an IM_ASSERT
    // (nothing in Release) and drawing went on with nulls.
    if (!ImGui_ImplDX12_CreateDeviceObjects())
    {
        return Refuse(facts, "Dear ImGui's DirectX 12 pipeline couldn't be created");
    }
    if (gAssertFailed.load())
    {
        return Refuse(facts, std::string("Dear ImGui reported a failed check while starting: ") + gAssertText);
    }
    gR.initialised = true;
    gHost->NoteInit(facts, "");
    log::Info("overlay.init", "ok=true format=" + facts.format + " buffers=" + std::to_string(facts.bufferCount) + " size=" + std::to_string(facts.width) + "x" +
                                  std::to_string(facts.height) + " hdr=" + std::to_string(facts.hdrMode) + " theme=" + xfb::overlay::ThemeName(gHost->Theme()) +
                                  " proxy=" + (facts.proxy.empty() ? std::string("none") : facts.proxy));
    return true;
}

// Stops the host for the session with a reason: everything released, the reason in overlay.state. aRefusal: a check failed
// (phase refused, with these facts) rather than an error (phase failed).
void StopFor(const std::string& aWhy, const DeviceFacts* aRefusal = nullptr)
{
    gR.gaveUp = true;
    if (aRefusal)
    {
        gHost->NoteInit(*aRefusal, aWhy);
        log::Warn("overlay.refused", "why=" + aWhy);
    }
    else
    {
        gHost->NoteFailure(aWhy);
        log::Warn("overlay.stopped", "why=" + aWhy);
    }
    Teardown();
}

// RB-97: after a resize the back buffers are fetched again, and the swap chain is checked again first.
bool MakeBuffers()
{
    DeviceFacts now;
    DXGI_SWAP_CHAIN_DESC1 desc{};
    ReadFacts(gR.deviceIndex, now, desc);
    if (const auto refusal = xfb::overlay::RefusalAfterResize(gR.firstFacts, now); !refusal.empty())
    {
        StopFor(refusal, &now);
        return false;
    }
    gR.width = desc.Width;
    gR.height = desc.Height;
    gR.buffers.assign(gR.bufferCount, nullptr);
    auto rtv = gR.rtvHeap->GetCPUDescriptorHandleForHeapStart();
    for (UINT i = 0; i < gR.bufferCount; ++i)
    {
        if (FAILED(gR.swapChain->GetBuffer(i, IID_PPV_ARGS(&gR.buffers[i]))))
        {
            gR.buffers.clear();
            return false;
        }
        D3D12_CPU_DESCRIPTOR_HANDLE handle{rtv.ptr + static_cast<SIZE_T>(i) * gR.rtvStride};
        gR.device->CreateRenderTargetView(gR.buffers[i].Get(), nullptr, handle);
    }
    gR.needBuffers = false;
    return true;
}

// ---- 0.8.22: the Studio's in-game components (the style guide's "In-game surfaces", "In-game components") ------------------------
// Each is a recipe of theme slots and metrics, drawn here because Dear ImGui has no bevel, tracking or live pulse of its own.
// Nothing here allocates: text goes through stack buffers, shapes through the window's draw list, and every colour and size comes
// from the palette LoadStyle() filled when the fonts were baked. All text is drawn at the baked size of its font (LegacySize).

ImU32 Col(const ImVec4& aColour, float aAlpha = 1.0f)
{
    ImVec4 c = aColour;
    c.w *= aAlpha;
    return ImGui::GetColorU32(c);
}

float Tracked(ImFont* aFont, const char* aText, bool aMeasureOnly, ImDrawList* aList, float aX, float aY, ImU32 aColour)
{
    // The Studio tracks capitals; ImGui cannot. Short fixed labels are drawn glyph by glyph with a 0.1 em gap.
    const float size = aFont->LegacySize;
    float x = aX;
    for (const char* c = aText; *c; ++c)
    {
        const ImVec2 advance = aFont->CalcTextSizeA(size, FLT_MAX, 0.0f, c, c + 1);
        if (!aMeasureOnly)
        {
            aList->AddText(aFont, size, ImVec2(x, aY), aColour, c, c + 1);
        }
        x += advance.x + gR.metrics.tracking * size;
    }
    return x - aX - (*aText ? gR.metrics.tracking * size : 0.0f);
}

// Upper-case ASCII copy of a short label into a caller's buffer (capitals roles).
void Caps(char* aOut, size_t aSize, const char* aText)
{
    size_t i = 0;
    for (; aText[i] && i + 1 < aSize; ++i)
    {
        const char c = aText[i];
        aOut[i] = (c >= 'a' && c <= 'z') ? static_cast<char>(c - 'a' + 'A') : c;
    }
    aOut[i] = 0;
}

// A chamfered rectangle (top-right and bottom-left corners cut by aBevel): six points, convex.
void ChamferPoints(ImVec2 aPoints[6], ImVec2 aMin, ImVec2 aMax, float aBevel)
{
    aPoints[0] = ImVec2(aMin.x, aMin.y);
    aPoints[1] = ImVec2(aMax.x - aBevel, aMin.y);
    aPoints[2] = ImVec2(aMax.x, aMin.y + aBevel);
    aPoints[3] = ImVec2(aMax.x, aMax.y);
    aPoints[4] = ImVec2(aMin.x + aBevel, aMax.y);
    aPoints[5] = ImVec2(aMin.x, aMax.y - aBevel);
}

enum class Tone
{
    Neutral,
    Success,
    Warning,
    Danger,
    Info
};

Tone ToneOfStatus(const std::string& aTone)
{
    return aTone == "ok" ? Tone::Success : aTone == "write" || aTone == "paused" ? Tone::Warning : aTone == "killed" ? Tone::Danger : Tone::Neutral;
}

const ImVec4& ToneColour(Tone aTone)
{
    const auto& c = gR.colours;
    return aTone == Tone::Success ? c.success : aTone == Tone::Warning ? c.warning : aTone == Tone::Danger ? c.danger : aTone == Tone::Info ? c.signal : c.textDisabled;
}

float TextHeight(ImFont* aFont)
{
    return aFont->CalcTextSizeA(aFont->LegacySize, FLT_MAX, 0.0f, "X").y;
}

// A chip's height: the eyebrow line, ChipPaddingY above and below, and the 1 px border (the Studio's 20 px chip at 1080p).
float ChipHeight()
{
    return gR.fonts.eyebrow ? TextHeight(gR.fonts.eyebrow) + 2.0f * gR.metrics.chipPadY + 2.0f * std::max(1.0f, gR.scale) : 0.0f;
}

// The chip: eyebrow-role capitals in the tone, the tone's wash, a 1 px border of the tone at ChipBorderAlpha, the top-right and
// bottom-left corners chamfered BevelSmall. Hollow (paused) has no fill. Takes the cursor's place as an item.
void Chip(const char* aLabel, Tone aTone, bool aHollow)
{
    auto* list = ImGui::GetWindowDrawList();
    auto* font = gR.fonts.eyebrow;
    if (!font)
    {
        return;
    }
    char caps[48];
    Caps(caps, sizeof(caps), aLabel);
    const auto& c = gR.colours;
    const float border = std::max(1.0f, gR.scale);
    const float textW = Tracked(font, caps, true, nullptr, 0, 0, 0);
    const float lineH = TextHeight(font);
    const ImVec2 size(textW + 2.0f * gR.metrics.chipPadX + 2.0f * border, ChipHeight());
    const ImVec2 min = ImGui::GetCursorScreenPos();
    const ImVec2 max(min.x + size.x, min.y + size.y);
    ImVec2 points[6];
    ChamferPoints(points, min, max, gR.metrics.bevelSmall);
    const float borderAlpha = xfb::overlay::ThemeValueOf("ChipBorderAlpha", 0.5f);
    ImVec4 text = c.textMuted, wash(0, 0, 0, 0), edge = c.line;
    switch (aTone)
    {
    case Tone::Success:
        text = c.success, wash = c.successBg, edge = c.success, edge.w *= borderAlpha;
        break;
    case Tone::Warning:
        text = c.warning, wash = c.warningBg, edge = c.warning, edge.w *= borderAlpha;
        break;
    case Tone::Danger:
        text = c.danger, wash = c.dangerBg, edge = c.danger, edge.w *= borderAlpha;
        break;
    case Tone::Info:
        text = c.signal, wash = c.signalBg, edge = c.signalLine;
        break;
    case Tone::Neutral:
        break;
    }
    if (!aHollow && wash.w > 0.0f)
    {
        list->AddConvexPolyFilled(points, 6, Col(wash));
    }
    list->AddPolyline(points, 6, Col(edge), border, ImDrawFlags_Closed);
    Tracked(font, caps, false, list, min.x + border + gR.metrics.chipPadX, min.y + (size.y - lineH) * 0.5f, Col(text));
    ImGui::Dummy(size);
}

// The status dot: an 8 px disc in the tone's slot; paused is a warning ring. aAlpha is the live pulse (1 when still).
void StatusDot(const ImVec2& aCentre, const std::string& aTone, float aAlpha)
{
    auto* list = ImGui::GetWindowDrawList();
    const float radius = gR.metrics.dot * 0.5f;
    const auto& c = gR.colours;
    if (aTone == "paused")
    {
        list->AddCircle(aCentre, radius - 0.75f * gR.scale, Col(c.warning), 20, 1.5f * gR.scale);
        return;
    }
    const ImVec4& colour = aTone == "ok" ? c.success : aTone == "write" ? c.warning : aTone == "killed" ? c.danger : c.textDisabled;
    list->AddCircleFilled(aCentre, radius, Col(colour, aAlpha), 20);
}

// The heading: the brand mark (the Studio's chamfered .brand-mark: XfAccent with XfAccentInk), the title in the title role, an
// info chip saying this is a test build.
void Heading()
{
    auto* list = ImGui::GetWindowDrawList();
    const auto& c = gR.colours;
    const ImVec2 origin = ImGui::GetCursorScreenPos();
    const float rowTop = ImGui::GetCursorPosY();
    const ImVec2 min = origin, max(origin.x + gR.metrics.markW, origin.y + gR.metrics.markH);
    ImVec2 points[6];
    ChamferPoints(points, min, max, gR.metrics.bevelLarge);
    list->AddConvexPolyFilled(points, 6, Col(c.accent));
    if (gR.fonts.title)
    {
        const float size = gR.fonts.title->LegacySize;
        const ImVec2 text = gR.fonts.title->CalcTextSizeA(size, FLT_MAX, 0.0f, "XF");
        list->AddText(gR.fonts.title, size, ImVec2(min.x + (gR.metrics.markW - text.x) * 0.5f, min.y + (gR.metrics.markH - text.y) * 0.5f), Col(c.accentInk), "XF");
    }
    ImGui::Dummy(ImVec2(gR.metrics.markW, gR.metrics.markH));
    ImGui::SameLine(0.0f, gR.metrics.itemSpacingX);
    if (gR.fonts.title)
    {
        ImGui::PushFont(gR.fonts.title, gR.fonts.title->LegacySize);
        ImGui::SetCursorPosY(rowTop + (gR.metrics.markH - ImGui::GetTextLineHeight()) * 0.5f);
        ImGui::TextColored(c.accentText, "XF Runtime Bridge");
        ImGui::PopFont();
    }
    ImGui::SameLine(0.0f, gR.metrics.itemSpacingX);
    ImGui::SetCursorPosY(rowTop + (gR.metrics.markH - ChipHeight()) * 0.5f);
    Chip("test", Tone::Info, false);
    ImGui::SetCursorPosY(rowTop + gR.metrics.markH + gR.metrics.itemSpacingY);
}

// An eyebrow: a 6 px XfAccentEdge square, then a tracked capitals label in XfTextMuted. SectionGap above a new group (aFlush: none,
// as at the top of a card).
void Eyebrow(const char* aLabel, bool aFlush)
{
    auto* font = gR.fonts.eyebrow;
    if (!font)
    {
        return;
    }
    if (!aFlush)
    {
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + gR.metrics.sectionGap - gR.metrics.itemSpacingY);
    }
    char caps[64];
    Caps(caps, sizeof(caps), aLabel);
    auto* list = ImGui::GetWindowDrawList();
    const ImVec2 at = ImGui::GetCursorScreenPos();
    const float lineH = font->LegacySize;
    list->AddRectFilled(ImVec2(at.x, at.y + (lineH - gR.metrics.eyebrowSquare) * 0.5f),
                        ImVec2(at.x + gR.metrics.eyebrowSquare, at.y + (lineH + gR.metrics.eyebrowSquare) * 0.5f), Col(gR.colours.accentEdge));
    Tracked(font, caps, false, list, at.x + gR.metrics.eyebrowSquare * 2.0f, at.y, Col(gR.colours.textMuted));
    ImGui::Dummy(ImVec2(1.0f, lineH));
}

// A key-value row: the label (label role, XfTextMuted) in a column as wide as 9 em, then the value (mono for figures, body else).
void KeyValue(const char* aLabel, const char* aValue, bool aFigure)
{
    const auto& c = gR.colours;
    auto* labelFont = gR.fonts.label ? gR.fonts.label : gR.fonts.body;
    auto* valueFont = aFigure ? (gR.fonts.value ? gR.fonts.value : gR.fonts.body) : gR.fonts.body;
    const float column = labelFont->LegacySize * 9.0f;
    const float start = ImGui::GetCursorPosX(); // SameLine's offset is from the window's edge, so the card's padding is part of it
    ImGui::PushFont(labelFont, labelFont->LegacySize);
    ImGui::TextColored(c.textMuted, "%s", aLabel);
    ImGui::PopFont();
    ImGui::SameLine(start + column + gR.metrics.itemSpacingX);
    ImGui::PushFont(valueFont, valueFont->LegacySize);
    ImGui::PushTextWrapPos(0.0f);
    ImGui::TextColored(c.text, "%s", aValue);
    ImGui::PopTextWrapPos();
    ImGui::PopFont();
}

// A value bar: a track in XfLine, the fill PlotHistogram (or the warning / danger tone of a meter), square ends, no border. Thin
// (BarThin) or labelled (BarLabelled, the figure inside in the value role, the fill at LabelledBarAlpha with no opaque cap so
// the figure stays readable). aFraction < 0 is indeterminate: a 35 % segment that sweeps (still, at the left, when motion is
// reduced).
void Bar(float aFraction, bool aLabelled, const char* aLabel, Tone aTone, bool aReduced, double aSeconds)
{
    auto* list = ImGui::GetWindowDrawList();
    const auto& c = gR.colours;
    const float height = aLabelled ? gR.metrics.barLabelled : gR.metrics.barThin;
    const ImVec2 min = ImGui::GetCursorScreenPos();
    const float width = std::max(1.0f, ImGui::GetContentRegionAvail().x);
    const ImVec2 max(min.x + width, min.y + height);
    list->AddRectFilled(min, max, Col(c.line));
    const ImVec4& fill = aTone == Tone::Warning ? c.warning : aTone == Tone::Danger ? c.danger : c.plot;
    const float alpha = aLabelled ? xfb::overlay::ThemeValueOf("LabelledBarAlpha", 0.3f) : 1.0f;
    if (aFraction < 0.0f)
    {
        const float segment = width * 0.35f;
        float left = 0.0f;
        if (!aReduced)
        {
            const float sweep = xfb::overlay::ThemeValueOf("SweepSeconds", 1.1f);
            const float phase = static_cast<float>(std::fmod(aSeconds, static_cast<double>(sweep)) / sweep);
            const float eased = phase * phase * (3.0f - 2.0f * phase);
            left = -segment + (width + segment) * eased;
        }
        list->PushClipRect(min, max, true);
        list->AddRectFilled(ImVec2(min.x + left, min.y), ImVec2(min.x + left + segment, max.y), Col(fill, alpha));
        list->PopClipRect();
    }
    else if (aFraction > 0.0f)
    {
        list->AddRectFilled(min, ImVec2(min.x + width * std::min(1.0f, aFraction), max.y), Col(fill, alpha));
    }
    if (aLabelled && aLabel && gR.fonts.value)
    {
        const float size = gR.fonts.value->LegacySize;
        const ImVec2 text = gR.fonts.value->CalcTextSizeA(size, FLT_MAX, 0.0f, aLabel);
        list->AddText(gR.fonts.value, size, ImVec2(min.x + (width - text.x) * 0.5f, min.y + (height - text.y) * 0.5f), Col(c.text), aLabel);
    }
    ImGui::Dummy(ImVec2(width, height));
}

// A card: a child with ChildBg, a 1 px XfLine border, ChildPaddingX/Y and the 2 px radius; aEdge adds a 2 px left edge. Cards
// never nest. Click-through like the window.
bool BeginCard(const char* aId, const ImVec4* aEdge)
{
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(gR.metrics.childPadX, gR.metrics.childPadY));
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, gR.metrics.rounding);
    ImGui::PushStyleColor(ImGuiCol_Border, gR.colours.line);
    ImGui::PushStyleColor(ImGuiCol_ChildBg, gR.colours.childBg);
    gR.cardEdge = aEdge ? *aEdge : ImVec4(0, 0, 0, 0);
    return ImGui::BeginChild(aId, ImVec2(0.0f, 0.0f), ImGuiChildFlags_Borders | ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_AlwaysUseWindowPadding,
                             ImGuiWindowFlags_NoInputs | ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoSavedSettings);
}

void EndCard()
{
    if (gR.cardEdge.w > 0.0f)
    {
        auto* list = ImGui::GetWindowDrawList();
        const ImVec2 at = ImGui::GetWindowPos();
        list->AddRectFilled(at, ImVec2(at.x + gR.metrics.edge, at.y + ImGui::GetWindowSize().y), Col(gR.cardEdge));
    }
    ImGui::EndChild();
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(2);
}

// The panel (P0): no input. 0.8 (the UI review): placed where the ink panel stands; the status line every surface shows; the
// diagnostics only with [overlay] diagnostics. 0.8.22: the Studio's in-game components (heading with the brand mark, status line
// with its live pulse and settle, message lines, a diagnostics card of key-value rows and bars). Its text is limited to the
// baked glyphs when the game thread publishes it (Publish); the figures come from atomics.
void DrawPanel(double aSeconds)
{
    if (gPanel.Take())
    {
        gR.panel = gPanel.Front();
    }
    // 0.8.2: one status surface at a time; while the ink panel is on screen (or the CET line is the fallback) this
    // panel doesn't draw.
    const bool cetDiagnostics = gHost->DiagnosticsRequested();
    if (!gR.panel.show && !cetDiagnostics)
    {
        return;
    }
    const auto scale = static_cast<float>(gR.height) / 1080.0f * gHost->Scale();
    gR.scale = scale;
    const float width = 360.0f * scale;
    const auto [left, top] = xfb::overlay::PanelOrigin(gR.panel.anchor, gR.panel.x, gR.panel.y, static_cast<float>(gR.width), static_cast<float>(gR.height), width, gPanelHeight);
    ImGui::SetNextWindowPos(cetDiagnostics ? ImVec2(std::max(16.0f, static_cast<float>(gR.width) - width - 16.0f), 16.0f) : ImVec2(left, top), ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(width, 0.0f), ImGuiCond_Always);
    const auto flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoInputs | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoFocusOnAppearing |
                       ImGuiWindowFlags_NoNav;
    // One clock for the pulse and the settle (ImGui::GetTime, which accumulates the frame's real delta): time-based, so a slow
    // or doubled frame never changes the motion's speed. Reduced motion (the setting, Windows, or frame generation) draws the
    // dot at full alpha and starts no settle.
    const double clock = ImGui::GetTime();
    const auto motion = gHost->Motion();
    if (ImGui::Begin("XF Runtime Bridge##xf_overlay_panel", nullptr, flags))
    {
        if (!cetDiagnostics) gPanelHeight = ImGui::GetWindowSize().y; // its auto-fitted height (from last frame's content), for the next placement
        const auto& c = gR.colours;
        if (!cetDiagnostics)
        {
            Heading();

            // The status line: the dot in the tone's slot (live tones pulse), then the plugin's sentence, hanging under its own
            // words when it wraps. A change of tone settles once: the signal wash fades out behind the row.
            const std::string& tone = gR.panel.tone;
            gR.statusSettle.Note(tone, clock * 1000.0, motion.reduced);
            const float settle = gR.statusSettle.Strength(clock * 1000.0);
            const ImVec2 rowAt = ImGui::GetCursorScreenPos();
            if (settle > 0.0f)
            {
                ImGui::GetWindowDrawList()->AddRectFilled(ImVec2(rowAt.x - gR.metrics.childPadX, rowAt.y - gR.metrics.itemSpacingY * 0.5f),
                                                          ImVec2(rowAt.x + ImGui::GetContentRegionAvail().x + gR.metrics.childPadX, rowAt.y + gR.statusRowHeight + gR.metrics.itemSpacingY * 0.5f),
                                                          Col(c.signalBg, settle), gR.metrics.rounding);
            }
            const float lineH = ImGui::GetTextLineHeight();
            const bool live = tone == "ok" || tone == "write";
            StatusDot(ImVec2(rowAt.x + gR.metrics.dot * 0.5f, rowAt.y + lineH * 0.5f), tone, live ? xfb::overlay::PulseAlpha(clock, motion.reduced) : 1.0f);
            const float hang = gR.metrics.dot + gR.metrics.itemSpacingX;
            ImGui::Indent(hang);
            ImGui::PushTextWrapPos(0.0f);
            const ImVec4& sentence = tone == "paused" ? c.warning : tone == "killed" ? c.danger : c.textMuted;
            ImGui::TextColored(sentence, "%s", gR.panel.bridgeStatus.empty() ? "Not ready yet." : gR.panel.bridgeStatus.c_str());
            ImGui::PopTextWrapPos();
            ImGui::Unindent(hang);
            gR.statusRowHeight = std::max(lineH, ImGui::GetCursorScreenPos().y - rowAt.y - gR.metrics.itemSpacingY);
            ImGui::PushTextWrapPos(0.0f);
            // 0.8.2: as the status surface, the coordinator's lines and the question too (the ink panel's content), each level in
            // the theme's colour; at most four lines, the oldest going first. The answer keys sit under the question, muted.
            const size_t first = gR.panel.lines.size() > 4 ? gR.panel.lines.size() - 4 : 0;
            for (size_t i = first; i < gR.panel.lines.size(); ++i)
            {
                const auto& [level, text] = gR.panel.lines[i];
                const ImVec4& colour = level == "warn" ? c.warning : level == "done" ? c.success : level == "ask" ? c.accentText : c.text;
                ImGui::TextColored(colour, "%s", text.c_str());
            }
            if (!gR.panel.askHint.empty())
            {
                ImGui::TextColored(c.textMuted, "%s", gR.panel.askHint.c_str());
            }
            ImGui::PopTextWrapPos();
        }
        if (!gR.panel.diagnostics && !cetDiagnostics)
        {
            ImGui::End();
            return;
        }
        // The diagnostics card: eyebrow, key-value rows, the CPU time as a labelled meter against a 1 ms budget (warning past 75 %,
        // danger past 90 %) and the moving bar, an instrument (one sweep a second so a skipped or doubled frame shows as a jump).
        ImGui::SetCursorPosY(ImGui::GetCursorPosY() + gR.metrics.sectionGap - gR.metrics.itemSpacingY);
        BeginCard("##xf_overlay_diagnostics", nullptr);
        Eyebrow("Diagnostics", true);
        char value[160];
        std::snprintf(value, sizeof(value), "%llu", static_cast<unsigned long long>(gHost->Frames()));
        KeyValue("Frames", value, true);
        std::snprintf(value, sizeof(value), "%.3f ms (max %.3f)", gHost->DisplayCpuMs(), gHost->CpuMsMax());
        KeyValue("CPU", value, true);
        std::snprintf(value, sizeof(value), "%s \xC3\x97 %u, %u \xC3\x97 %u, sdr", gR.formatText.c_str(), gR.bufferCount, gR.width, gR.height);
        KeyValue("Back buffer", value, true);
        KeyValue("Frame generation", gR.frameGenerationText.c_str(), false);
        std::snprintf(value, sizeof(value), "%s, %llu requests", gR.panel.scriptsLive ? "scripts live" : "scripts not live", static_cast<unsigned long long>(gR.panel.requests));
        KeyValue("Bridge", value, false);
        std::snprintf(value, sizeof(value), "%s, motion %s", xfb::overlay::ThemeName(gHost->Theme()), motion.effective);
        KeyValue("Theme", value, false);
        const double cpu = gHost->DisplayCpuMs(); // 0.8.22: a test figure from overlay.set, where one is set
        char label[48];
        std::snprintf(label, sizeof(label), "%.2f ms of 1 ms", cpu);
        Bar(static_cast<float>(cpu), true, label, cpu > 0.9 ? Tone::Danger : cpu > 0.75 ? Tone::Warning : Tone::Neutral, motion.reduced, aSeconds);
        Bar(static_cast<float>(std::fmod(aSeconds, 1.0)), false, nullptr, Tone::Neutral, motion.reduced, aSeconds);
        EndCard();
    }
    ImGui::End();
}

// RB-99: whether Dear ImGui asks the backend to create or update a texture this frame (the backend would wait INFINITE on
// the engine's queue for it).
bool WantsUpload()
{
    for (ImTextureData* tex : ImGui::GetPlatformIO().Textures)
    {
        if (tex && (tex->Status == ImTextureStatus_WantCreate || tex->Status == ImTextureStatus_WantUpdates))
        {
            return true;
        }
    }
    return false;
}

void DrawFrame()
{
    if (gR.needBuffers && !MakeBuffers())
    {
        return;
    }
    const UINT index = gR.swapChain->GetCurrentBackBufferIndex();
    if (index >= gR.buffers.size())
    {
        return;
    }
    // Our last use of this buffer's allocator must be done (bounded: a stall skips a frame rather than holding the engine).
    if (gR.fence->GetCompletedValue() < gR.fenceValues[index])
    {
        gR.fence->SetEventOnCompletion(gR.fenceValues[index], gR.fenceEvent);
        if (WaitForSingleObject(gR.fenceEvent, 20) != WAIT_OBJECT_0)
        {
            return;
        }
    }
    const auto started = std::chrono::steady_clock::now();
    ImGui::SetCurrentContext(gR.context);
    if (gR.height != gR.fontHeight)
    {
        BuildFonts(); // RB-108: the new size's fonts, between frames (the atlas is unlocked here)
    }
    else if (gR.themeGeneration != gHost->ThemeGeneration())
    {
        Restyle(static_cast<float>(gR.height) / 1080.0f * gHost->Scale()); // 0.8.22: overlay.set changed the theme
    }
    auto& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(static_cast<float>(gR.width), static_cast<float>(gR.height));
    io.DeltaTime = std::max(1e-4f, std::chrono::duration<float>(started - gR.last).count());
    gR.last = started;
    ImGui_ImplDX12_NewFrame();
    ImGui::NewFrame();
    if (!gHost->CanvasOnlyCapture()) DrawPanel(std::chrono::duration<double>(started - gR.started).count());
    if (!Get().cetOverlayOpen.load()) DrawCanvas(Get().canvas, *gHost, static_cast<float>(gR.width), static_cast<float>(gR.height), gR.scale, gR.fonts.value, gR.fonts.title);
    ImGui::Render();
    if (WantsUpload() && !gR.uploadsAllowed)
    {
        StopFor("Dear ImGui asked for a font texture upload outside the start and a resize; the overlay stops rather than wait on the render thread");
        return;
    }

    gR.allocators[index]->Reset();
    gR.list->Reset(gR.allocators[index].Get(), nullptr);
    D3D12_RESOURCE_BARRIER barrier{};
    barrier.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
    barrier.Transition.pResource = gR.buffers[index].Get();
    barrier.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
    barrier.Transition.StateBefore = D3D12_RESOURCE_STATE_PRESENT;
    barrier.Transition.StateAfter = D3D12_RESOURCE_STATE_RENDER_TARGET;
    gR.list->ResourceBarrier(1, &barrier);
    D3D12_CPU_DESCRIPTOR_HANDLE rtv{gR.rtvHeap->GetCPUDescriptorHandleForHeapStart().ptr + static_cast<SIZE_T>(index) * gR.rtvStride};
    gR.list->OMSetRenderTargets(1, &rtv, FALSE, nullptr);
    ID3D12DescriptorHeap* heaps[] = {gR.srvHeap.Get()};
    gR.list->SetDescriptorHeaps(1, heaps);
    ImGui_ImplDX12_RenderDrawData(ImGui::GetDrawData(), gR.list.Get());
    gR.uploadsAllowed = false;
    barrier.Transition.StateBefore = D3D12_RESOURCE_STATE_RENDER_TARGET;
    barrier.Transition.StateAfter = D3D12_RESOURCE_STATE_PRESENT;
    gR.list->ResourceBarrier(1, &barrier);
    gR.list->Close();
    ID3D12CommandList* lists[] = {gR.list.Get()};
    gR.queue->ExecuteCommandLists(1, lists);
    gR.fenceValues[index] = gR.fenceNext++;
    gR.queue->Signal(gR.fence.Get(), gR.fenceValues[index]);
    gHost->NoteFrame(std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - started).count());
}

// The C++ body of the present detour (runs inside the guard, with the lock already held by the detour).
void PresentBody(int32_t aDeviceIndex)
{
    if (!gR.initialised)
    {
        if (!Initialise(aDeviceIndex))
        {
            gR.gaveUp = true; // refused or failed for the session: pass-through from now on
            return;
        }
    }
    // RB-105: the swap chain must still be the one the host was made for. A new one (the engine recreated it) stops the
    // host, which lets go of its references to the old one.
    if (aDeviceIndex != gR.deviceIndex)
    {
        return; // another device slot's present: not ours to draw on
    }
    auto* sc = SwapChainData(aDeviceIndex);
    if (!sc || sc->swapChain.Get() != gR.engineSwapChain)
    {
        StopFor("the game's swap chain changed (it was recreated); the overlay stops for this session");
        return;
    }
    if (gR.device && gR.device->GetDeviceRemovedReason() != S_OK)
    {
        StopFor("the GPU device was removed");
        return;
    }
    if (!gHost->ShouldDraw())
    {
        return;
    }
    DrawFrame();
}

void PresentThunk(void* aArg)
{
    PresentBody(*static_cast<int32_t*>(aArg));
}

void ResizeBody(uint32_t aWidth, uint32_t aHeight)
{
    if (gR.initialised)
    {
        ReleaseBuffers();
        gR.width = aWidth ? aWidth : gR.width;
        gR.height = aHeight ? aHeight : gR.height;
        gHost->NoteResize(gR.width, gR.height);
        log::Info("overlay.reset", "size=" + std::to_string(gR.width) + "x" + std::to_string(gR.height));
    }
}

struct ResizeArgs
{
    uint32_t width, height;
};

void ResizeThunk(void* aArg)
{
    const auto* args = static_cast<ResizeArgs*>(aArg);
    ResizeBody(args->width, args->height);
}

void TeardownThunk(void*)
{
    Teardown();
}

// The structured-exception guard (no C++ objects with destructors in this frame). Counts the guard depth for IM_ASSERT.
DWORD gLastExceptionCode = 0;
int RunGuarded(void (*aBody)(void*), void* aArg)
{
    int result = 0;
    ++tGuardDepth;
    __try
    {
        aBody(aArg);
    }
    __except (gLastExceptionCode = GetExceptionCode(), EXCEPTION_EXECUTE_HANDLER)
    {
        result = 1;
    }
    --tGuardDepth;
    return result;
}

std::string ExceptionWhy(const char* aDoing)
{
    if (gLastExceptionCode == kImGuiAssertCode)
    {
        return std::string("Dear ImGui reported a failed check ") + aDoing + " (" + gAssertText + "); the overlay passes everything through for the rest of the session";
    }
    char code[16];
    std::snprintf(code, sizeof(code), "0x%08lX", static_cast<unsigned long>(gLastExceptionCode));
    return std::string("an exception ") + code + " " + aDoing + "; the overlay passes everything through for the rest of the session";
}

// After an exception the ImGui state may be half-way through a frame: the host stops and lets go of the engine's objects
// only (its own are left alive, a small leak, rather than torn down from an unknown state).
void StopAfterException(const char* aDoing)
{
    gR.gaveUp = true;
    const auto why = ExceptionWhy(aDoing);
    gHost->NoteFailure(why);
    log::Error("overlay.exception", "why=" + why);
    gR.buffers.clear();
    gR.swapChain.Reset();
    gR.engineSwapChain = nullptr;
}

void* PresentDetour(int32_t* aDeviceIndex, uint8_t aSomeSync, UINT aSyncInterval)
{
    if (gHost && gHost->Enabled() && gHost->Active() && !gHost->PassThrough() && !gR.gaveUp.load())
    {
        std::scoped_lock _(gR.mutex); // outside the SEH frame (RB-106)
        if (!gR.gaveUp.load())
        {
            int32_t index = aDeviceIndex ? *aDeviceIndex : 0;
            if (RunGuarded(&PresentThunk, &index) != 0)
            {
                StopAfterException("while drawing");
            }
            else if (gAssertFailed.load() && !gR.gaveUp.load())
            {
                StopFor(std::string("Dear ImGui reported a failed check (") + gAssertText + ")");
            }
        }
    }
    return gPresent(aDeviceIndex, aSomeSync, aSyncInterval);
}

void* ResizeDetour(uint32_t aWidth, uint32_t aHeight, uint32_t a3, uint8_t a4, int32_t* aDeviceIndex)
{
    // RB-106: once the host has given up it holds no back buffers, so the resize doesn't take the lock at all.
    if (gHost && gHost->Enabled() && !gR.gaveUp.load())
    {
        std::scoped_lock _(gR.mutex);
        ResizeArgs args{aWidth, aHeight};
        if (!gR.gaveUp.load() && RunGuarded(&ResizeThunk, &args) != 0)
        {
            StopAfterException("while letting go of the back buffers for a resize");
        }
    }
    return gResize(aWidth, aHeight, a3, a4, aDeviceIndex);
}

void* ShutdownDetour(uint64_t a1, uint64_t a2, uint64_t a3, uint64_t a4)
{
    if (gHost && gHost->Enabled())
    {
        std::scoped_lock _(gR.mutex);
        if (!gR.shutDown)
        {
            gR.shutDown = true;
            const bool wasActive = gHost->Active();
            gR.gaveUp = true;
            // RB-100: release everything before the engine's device goes: bounded fence waits, the backend, the context, every
            // COM reference and the fence event.
            const bool clean = RunGuarded(&TeardownThunk, nullptr) == 0;
            if (wasActive)
            {
                gHost->NoteShutdown();
            }
            log::Info("overlay.shutdown", std::string("render shutdown seen; the overlay stopped and released its objects") + (clean ? "" : " (an exception part-way; the rest is left to the process's exit)"));
        }
    }
    return gShutdown(a1, a2, a3, a4);
}
} // namespace

IDXGISwapChain3* CurrentSwapChain()
{
    return gR.swapChain.Get();
}

void Install(RED4ext::v1::PluginHandle aHandle, const RED4ext::v1::Sdk* aSdk, OverlayHost& aHost)
{
    gHost = &aHost;
    if (!aHost.Enabled())
    {
        log::Info("overlay.disabled", "set [overlay] enabled = true in config.ini to draw the XF overlay (test builds)");
        return;
    }
    using Resolve_t = uintptr_t (*)(uint32_t);
    Resolve_t resolve = nullptr;
    if (const auto red4ext = GetModuleHandleW(L"RED4ext.dll"))
    {
        resolve = reinterpret_cast<Resolve_t>(GetProcAddress(red4ext, "RED4ext_ResolveAddress"));
    }
    const auto present = resolve ? resolve(kHashPresent) : 0;
    const auto resize = resolve ? resolve(kHashResize) : 0;
    const auto shutdown = resolve ? resolve(kHashShutdown) : 0;
    gDeviceDataSlot = resolve ? resolve(kHashDeviceData) : 0;
    std::string missing;
    const auto need = [&missing](uintptr_t aAddress, const char* aName) {
        if (!aAddress)
        {
            missing += (missing.empty() ? "" : ",") + std::string(aName);
        }
    };
    need(present, "GpuApi::Present");
    need(resize, "GpuApi::ResizeBackbuffer");
    need(shutdown, "render shutdown");
    need(gDeviceDataSlot, "g_DeviceData");
    if (!aSdk || !aSdk->hooking || !missing.empty())
    {
        aHost.NoteHooks(false, false, false, missing.empty() ? "RED4ext's hooking API" : missing);
        log::Error("overlay.addresses_missing", "missing=" + missing + " (the overlay stays off; the bridge runs as usual)");
        return;
    }
    const bool p = aSdk->hooking->Attach(aHandle, reinterpret_cast<void*>(present), reinterpret_cast<void*>(&PresentDetour), reinterpret_cast<void**>(&gPresent));
    const bool r = aSdk->hooking->Attach(aHandle, reinterpret_cast<void*>(resize), reinterpret_cast<void*>(&ResizeDetour), reinterpret_cast<void**>(&gResize));
    const bool s = aSdk->hooking->Attach(aHandle, reinterpret_cast<void*>(shutdown), reinterpret_cast<void*>(&ShutdownDetour), reinterpret_cast<void**>(&gShutdown));
    aHost.NoteHooks(p, r, s, "");
    log::Info("overlay.hook_attached", std::string("present=") + (p ? "true" : "false") + " resize=" + (r ? "true" : "false") + " render_shutdown=" + (s ? "true" : "false"));
}

void Publish(const PanelData& aData)
{
    // RB-99: the panel's text limited to the baked glyphs here, on the game thread, not per frame on the render thread.
    auto& back = gPanel.Back();
    back = aData;
    back.bridgeStatus = xfb::overlay::LimitToGlyphs(aData.bridgeStatus);
    back.pendingAsk = xfb::overlay::LimitToGlyphs(aData.pendingAsk);
    for (auto& [level, text] : back.lines)
    {
        text = xfb::overlay::LimitToGlyphs(text);
    }
    back.askHint = xfb::overlay::LimitToGlyphs(aData.askHint);
    gPanel.Publish();
}
} // namespace xfb::plugin::overlay
