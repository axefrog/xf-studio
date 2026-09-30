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

#include <RED4ext/RED4ext.hpp>
#include <RED4ext/GpuApi/DeviceData.hpp>

#include <Windows.h>
#include <d3d12.h>
#include <dxgi1_6.h>
#include <wrl/client.h>

#include <chrono>
#include <cmath>
#include <filesystem>
#include <mutex>
#include <string>
#include <vector>

#include <imgui.h>
#include <imgui_impl_dx12.h>

#include "core/Log.hpp"
#include "plugin/Overlay.hpp"

// Dear ImGui's DirectX 12 backend (docking branch) asks DXGI for a factory once, to read tearing support for secondary
// viewports, which the host never opens. Rather than import dxgi.dll (on the reference install ReShade's proxy) and make a
// factory of our own, the host answers with the factory the game's own swap chain was made from (GetParent): no new DXGI
// object is created.
namespace xfb::plugin::overlay
{
IDXGISwapChain3* CurrentSwapChain();
}

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

namespace xfb::plugin::overlay
{
namespace
{
using Microsoft::WRL::ComPtr;
using xfb::overlay::DeviceFacts;
using xfb::overlay::OverlayHost;
using xfb::overlay::PanelData;
using xfb::overlay::ThemeKind;

constexpr uint32_t kHashPresent = 2468877568UL;
constexpr uint32_t kHashResize = 239671909UL;
constexpr uint32_t kHashShutdown = 3192982283UL;
constexpr uint32_t kHashDeviceData = 1239944840UL;
constexpr uint32_t kSrvSlots = 64;

using Present_t = void* (*)(int32_t*, uint8_t, UINT);
using Resize_t = void* (*)(uint32_t, uint32_t, uint32_t, uint8_t, int32_t*);
using Shutdown_t = void* (*)(uint64_t, uint64_t, uint64_t, uint64_t);

Present_t gPresent = nullptr;
Resize_t gResize = nullptr;
Shutdown_t gShutdown = nullptr;
uintptr_t gDeviceDataSlot = 0;
OverlayHost* gHost = nullptr;

xfb::overlay::TripleBuffer<PanelData> gPanel;

// Render-thread state. Only the present, resize and shutdown detours touch it, and the engine calls them from its render
// thread; the mutex covers a resize arriving from another thread.
struct Renderer
{
    std::mutex mutex;
    bool initialised = false;
    bool gaveUp = false;
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
    ImFont* display = nullptr;
    std::chrono::steady_clock::time_point last = std::chrono::steady_clock::now();
    std::chrono::steady_clock::time_point started = std::chrono::steady_clock::now();
    PanelData panel;
    std::vector<std::string> frameGeneration;
};
Renderer gR;

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

bool SameObject(IUnknown* aA, IUnknown* aB)
{
    if (!aA || !aB)
    {
        return false;
    }
    ComPtr<IUnknown> a, b;
    aA->QueryInterface(IID_PPV_ARGS(&a));
    aB->QueryInterface(IID_PPV_ARGS(&b));
    return a && b && a.Get() == b.Get();
}

std::vector<std::string> FrameGenerationModules()
{
    std::vector<std::string> out;
    for (const auto* name : {L"sl.dlss_g.dll", L"ffx_frameinterpolation_x64.dll", L"libxess_fg.dll", L"nvngx_dlssg.dll"})
    {
        if (GetModuleHandleW(name))
        {
            std::string text;
            for (const wchar_t* c = name; *c; ++c)
            {
                text.push_back(static_cast<char>(*c));
            }
            out.push_back(text);
        }
    }
    return out;
}

// The XF Studio theme (core/overlay/ThemeTable.inc, generated from the Studio's tokens) as the ImGui style.
void ApplyTheme(ThemeKind aKind, float aScale)
{
    auto& style = ImGui::GetStyle();
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
    style.ScaleAllSizes(aScale);
}

ImFont* LoadFont(const char* aKind, float aSize)
{
    auto& io = ImGui::GetIO();
    wchar_t windows[MAX_PATH]{};
    GetWindowsDirectoryW(windows, MAX_PATH);
    const std::vector<const wchar_t*> files = std::string(aKind) == "display" ? std::vector<const wchar_t*>{L"bahnschrift.ttf"}
                                                                               : std::vector<const wchar_t*>{L"SegUIVar.ttf", L"segoeui.ttf"};
    for (const auto* file : files)
    {
        const auto path = std::filesystem::path(windows) / L"Fonts" / file;
        std::error_code error;
        if (std::filesystem::exists(path, error))
        {
            if (auto* font = io.Fonts->AddFontFromFileTTF(path.string().c_str(), aSize))
            {
                return font;
            }
        }
    }
    ImFontConfig config;
    config.SizePixels = aSize;
    return io.Fonts->AddFontDefault(&config);
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

void WaitBuffer(size_t aIndex, DWORD aMs)
{
    if (aIndex < gR.fenceValues.size() && gR.fence && gR.fence->GetCompletedValue() < gR.fenceValues[aIndex])
    {
        gR.fence->SetEventOnCompletion(gR.fenceValues[aIndex], gR.fenceEvent);
        WaitForSingleObject(gR.fenceEvent, aMs);
    }
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

bool MakeBuffers()
{
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

// First present: the checks (Host.hpp RefusalFor), then our heaps, allocators, list, fence and ImGui.
bool Initialise(int32_t aDeviceIndex)
{
    DeviceFacts facts;
    auto* dd = DeviceData();
    facts.deviceData = dd != nullptr;
    RED4ext::GpuApi::SSwapChainData* sc = nullptr;
    const uint32_t id = aDeviceIndex > 0 ? static_cast<uint32_t>(aDeviceIndex) : 0;
    if (dd && dd->swapChains.IsUsedID(id))
    {
        sc = &dd->swapChains.GetData(id);
    }
    facts.swapChain = sc && sc->swapChain;
    DXGI_SWAP_CHAIN_DESC1 desc{};
    if (facts.swapChain)
    {
        facts.hdrMode = static_cast<int>(sc->startupHdrMode);
        sc->swapChain->GetDesc1(&desc);
        facts.format = FormatName(desc.Format);
        facts.bufferCount = desc.BufferCount;
        facts.width = desc.Width;
        facts.height = desc.Height;
        wchar_t cls[64]{};
        if (sc->windowHandle && GetClassNameW(sc->windowHandle, cls, 64) > 0)
        {
            for (const wchar_t* c = cls; *c; ++c)
            {
                facts.windowClass.push_back(static_cast<char>(*c < 128 ? *c : '?'));
            }
        }
        ComPtr<ID3D12Device> scDevice;
        sc->swapChain->GetDevice(IID_PPV_ARGS(&scDevice));
        facts.sameDevice = SameObject(scDevice.Get(), dd->device.Get());
        facts.directQueue = dd->directCommandQueue && dd->directCommandQueue->GetDesc().Type == D3D12_COMMAND_LIST_TYPE_DIRECT;
    }
    gR.frameGeneration = FrameGenerationModules();
    gHost->NoteFrameGeneration(gR.frameGeneration);
    const auto refusal = xfb::overlay::RefusalFor(facts);
    if (!refusal.empty())
    {
        gHost->NoteInit(facts, refusal);
        log::Warn("overlay.refused", "why=" + refusal);
        return false;
    }
    gR.device = dd->device;
    gR.queue = dd->directCommandQueue;
    sc->swapChain.As(&gR.swapChain);
    gR.format = desc.Format;
    gR.bufferCount = desc.BufferCount;
    gR.width = desc.Width;
    gR.height = desc.Height;

    D3D12_DESCRIPTOR_HEAP_DESC srv{D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV, kSrvSlots, D3D12_DESCRIPTOR_HEAP_FLAG_SHADER_VISIBLE, 0};
    D3D12_DESCRIPTOR_HEAP_DESC rtv{D3D12_DESCRIPTOR_HEAP_TYPE_RTV, gR.bufferCount, D3D12_DESCRIPTOR_HEAP_FLAG_NONE, 0};
    if (FAILED(gR.device->CreateDescriptorHeap(&srv, IID_PPV_ARGS(&gR.srvHeap))) || FAILED(gR.device->CreateDescriptorHeap(&rtv, IID_PPV_ARGS(&gR.rtvHeap))))
    {
        gHost->NoteInit(facts, "couldn't create the overlay's descriptor heaps");
        return false;
    }
    gR.srvStride = gR.device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV);
    gR.rtvStride = gR.device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_RTV);
    gR.allocators.resize(gR.bufferCount);
    gR.fenceValues.assign(gR.bufferCount, 0);
    for (auto& allocator : gR.allocators)
    {
        if (FAILED(gR.device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&allocator))))
        {
            gHost->NoteInit(facts, "couldn't create the overlay's command allocators");
            return false;
        }
    }
    if (FAILED(gR.device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, gR.allocators[0].Get(), nullptr, IID_PPV_ARGS(&gR.list))) ||
        FAILED(gR.list->Close()) || FAILED(gR.device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&gR.fence))))
    {
        gHost->NoteInit(facts, "couldn't create the overlay's command list or fence");
        return false;
    }
    gR.fenceEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);

    IMGUI_CHECKVERSION();
    gR.context = ImGui::CreateContext();
    ImGui::SetCurrentContext(gR.context);
    auto& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.ConfigFlags |= ImGuiConfigFlags_NoMouseCursorChange;
    const float scale = (static_cast<float>(gR.height) / 1080.0f) * gHost->Scale();
    const float body = xfb::overlay::ThemeMetricOf("FontSize", 13.0f) * scale;
    LoadFont("ui", body);
    gR.display = LoadFont("display", xfb::overlay::ThemeMetricOf("FontSizeLarge", 15.0f) * scale);
    ApplyTheme(gHost->Theme(), scale);

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
        gHost->NoteInit(facts, "Dear ImGui's DirectX 12 renderer didn't start");
        return false;
    }
    gR.initialised = true;
    gHost->NoteInit(facts, "");
    log::Info("overlay.init", "ok=true format=" + facts.format + " buffers=" + std::to_string(facts.bufferCount) + " size=" + std::to_string(facts.width) + "x" +
                                  std::to_string(facts.height) + " hdr=" + std::to_string(facts.hdrMode) + " theme=" + xfb::overlay::ThemeName(gHost->Theme()));
    return true;
}

ImVec4 ThemeColour(const char* aName)
{
    float rgba[4] = {1, 1, 1, 1};
    xfb::overlay::ThemeColorOf(aName, gHost->Theme(), rgba);
    return ImVec4(rgba[0], rgba[1], rgba[2], rgba[3]);
}

// The one diagnostic panel (P0): no input, top left under the CET label's place, a moving bar so flicker and ghosting show.
void DrawPanel(double aSeconds)
{
    if (gPanel.Take())
    {
        gR.panel = gPanel.Front();
    }
    const auto scale = static_cast<float>(gR.height) / 1080.0f * gHost->Scale();
    ImGui::SetNextWindowPos(ImVec2(12.0f * scale, 120.0f * scale), ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(360.0f * scale, 0.0f), ImGuiCond_Always);
    const auto flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoInputs | ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoFocusOnAppearing |
                       ImGuiWindowFlags_NoNav;
    if (ImGui::Begin("XF overlay##xf_overlay_diag", nullptr, flags))
    {
        if (gR.display)
        {
            ImGui::PushFont(gR.display, 0.0f);
        }
        ImGui::TextColored(ThemeColour("XfAccentText"), "XF RUNTIME BRIDGE");
        if (gR.display)
        {
            ImGui::PopFont();
        }
        ImGui::SameLine();
        ImGui::TextDisabled("overlay P0");
        const char* tone = gR.panel.tone == "ok" ? "XfSuccess" : gR.panel.tone == "killed" ? "XfDanger" : gR.panel.tone == "write" || gR.panel.tone == "paused" ? "XfWarning" : "TextDisabled";
        ImGui::TextColored(ThemeColour(tone), "%s", gR.panel.bridgeStatus.empty() ? "Waiting for the bridge..." : gR.panel.bridgeStatus.c_str());
        if (!gR.panel.pendingAsk.empty())
        {
            ImGui::PushTextWrapPos(0.0f);
            ImGui::TextColored(ThemeColour("XfAccentText"), "Question: %s", gR.panel.pendingAsk.c_str());
            ImGui::PopTextWrapPos();
        }
        ImGui::Separator();
        const auto state = gHost->Snapshot();
        ImGui::TextDisabled("frames %llu   cpu %.3f ms (max %.3f)", static_cast<unsigned long long>(state.value("frames", 0ull)), state.value("cpu_ms", 0.0),
                            state.value("cpu_ms_max", 0.0));
        ImGui::TextDisabled("%s x%u  %ux%u  sdr  theme %s", FormatName(gR.format).c_str(), gR.bufferCount, gR.width, gR.height, xfb::overlay::ThemeName(gHost->Theme()));
        std::string fg;
        for (const auto& name : gR.frameGeneration)
        {
            fg += (fg.empty() ? "" : ", ") + name;
        }
        ImGui::TextDisabled("frame generation modules: %s", fg.empty() ? "none" : fg.c_str());
        ImGui::TextDisabled("scripts %s   requests %llu", gR.panel.scriptsLive ? "live" : "not live", static_cast<unsigned long long>(gR.panel.requests));
        // The moving bar: one sweep a second, so a skipped or doubled frame shows as a jump.
        const float phase = static_cast<float>(std::fmod(aSeconds, 1.0));
        ImGui::PushStyleColor(ImGuiCol_PlotHistogram, ThemeColour("XfSignal"));
        ImGui::ProgressBar(phase, ImVec2(-1.0f, 6.0f * scale), "");
        ImGui::PopStyleColor();
    }
    ImGui::End();
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
    auto& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(static_cast<float>(gR.width), static_cast<float>(gR.height));
    io.DeltaTime = std::max(1e-4f, std::chrono::duration<float>(started - gR.last).count());
    gR.last = started;
    ImGui_ImplDX12_NewFrame();
    ImGui::NewFrame();
    DrawPanel(std::chrono::duration<double>(started - gR.started).count());
    ImGui::Render();

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

// The C++ body of the present detour (objects with destructors live here, not in the SEH frame).
void PresentBody(int32_t* aDeviceIndex)
{
    std::scoped_lock _(gR.mutex);
    if (gR.gaveUp)
    {
        return;
    }
    if (!gR.initialised)
    {
        if (!Initialise(aDeviceIndex ? *aDeviceIndex : 0))
        {
            gR.gaveUp = true; // refused or failed for the session: pass-through from now on
            return;
        }
    }
    if (gR.device && gR.device->GetDeviceRemovedReason() != S_OK)
    {
        gHost->NoteFailure("the GPU device was removed");
        gR.gaveUp = true;
        return;
    }
    if (!gHost->ShouldDraw())
    {
        return;
    }
    DrawFrame();
}

int PresentGuarded(int32_t* aDeviceIndex)
{
    __try
    {
        PresentBody(aDeviceIndex);
        return 0;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return 1;
    }
}

void* PresentDetour(int32_t* aDeviceIndex, uint8_t aSomeSync, UINT aSyncInterval)
{
    if (gHost && gHost->Enabled() && gHost->Active())
    {
        if (PresentGuarded(aDeviceIndex) != 0)
        {
            gR.gaveUp = true;
            gHost->NoteFailure("an exception while drawing; the overlay passes everything through for the rest of the session");
        }
    }
    return gPresent(aDeviceIndex, aSomeSync, aSyncInterval);
}

void ResizeBody(uint32_t aWidth, uint32_t aHeight)
{
    std::scoped_lock _(gR.mutex);
    if (gR.initialised)
    {
        ReleaseBuffers();
        gR.width = aWidth ? aWidth : gR.width;
        gR.height = aHeight ? aHeight : gR.height;
        gHost->NoteResize(gR.width, gR.height);
        log::Info("overlay.reset", "size=" + std::to_string(gR.width) + "x" + std::to_string(gR.height));
    }
}

int ResizeGuarded(uint32_t aWidth, uint32_t aHeight)
{
    __try
    {
        ResizeBody(aWidth, aHeight);
        return 0;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        return 1;
    }
}

void* ResizeDetour(uint32_t aWidth, uint32_t aHeight, uint32_t a3, uint8_t a4, int32_t* aDeviceIndex)
{
    if (gHost && gHost->Enabled() && ResizeGuarded(aWidth, aHeight) != 0)
    {
        gR.gaveUp = true;
        gHost->NoteFailure("an exception while letting go of the back buffers for a resize");
    }
    return gResize(aWidth, aHeight, a3, a4, aDeviceIndex);
}

void* ShutdownDetour(uint64_t a1, uint64_t a2, uint64_t a3, uint64_t a4)
{
    if (gHost && gHost->Enabled() && !gR.gaveUp)
    {
        gR.gaveUp = true; // no more drawing; RED4ext detaches at exit, nothing is released here
        gHost->NoteShutdown();
        log::Info("overlay.shutdown", "render shutdown seen; the overlay stops drawing");
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
    gPanel.Back() = aData;
    gPanel.Publish();
}
} // namespace xfb::plugin::overlay
