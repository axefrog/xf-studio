#pragma once

// The XF ImGui overlay host's engine half, P0 (bridge 0.7; research/runtime/imgui-overlay-feasibility.md §7-8): a detour on
// the engine's own present (GpuApi::Present), chained with Cyber Engine Tweaks' hook on the same function, that draws one
// diagnostic panel with its own command list on the engine's direct queue; a detour on GpuApi::ResizeBackbuffer that lets
// go of the back buffers first; and one on the engine's render shutdown. Draw-only (no input), off by default, refused in
// HDR, never unhooked at run time (a pass-through flag instead). The state and the refusal logic are core/overlay/Host.hpp.

#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Api/v1/Sdk.hpp>

#include "core/overlay/Host.hpp"

namespace xfb::plugin::overlay
{
// At load, with [overlay] enabled: resolves the engine's addresses and attaches the three hooks through RED4ext. Logs and
// records what is missing in the host; attaches nothing when an address is missing.
void Install(RED4ext::v1::PluginHandle aHandle, const RED4ext::v1::Sdk* aSdk, xfb::overlay::OverlayHost& aHost);
// Game thread, every Running tick: the panel's data for the render thread (the three-slot hand-off).
void Publish(const xfb::overlay::PanelData& aData);
} // namespace xfb::plugin::overlay
