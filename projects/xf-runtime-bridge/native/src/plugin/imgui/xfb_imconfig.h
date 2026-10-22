#pragma once

// Dear ImGui's user configuration for the XF overlay host (IMGUI_USER_CONFIG, set for the xfb_imgui library and everything
// that includes imgui.h through it; CMakeLists.txt). RB-98 (deep review of bridge 0.7.0): Dear ImGui's default IM_ASSERT is
// the C runtime's assert, which does nothing in Release, so a failed backend step (no pipeline state, no root signature)
// went on to draw with nulls on the game's render thread. The bridge's IM_ASSERT records the failure and, inside the
// overlay's structured-exception guard, raises it so the guard stops the overlay (plugin/Overlay.cpp). It stays an
// expression, as Dear ImGui's own is.
//
// ImGuiConfigCheck.cpp and Overlay.cpp refuse to compile without it.

#define XFB_IMGUI_ASSERT_OVERRIDDEN 1

void XfbImGuiAssertFailed(const char* aExpr, const char* aFile, int aLine);

#define IM_ASSERT(_EXPR) ((void)((_EXPR) ? 0 : (XfbImGuiAssertFailed(#_EXPR, __FILE__, __LINE__), 0)))
