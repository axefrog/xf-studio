// Built into the xfb_imgui library: the build fails when Dear ImGui is compiled without the bridge's IM_ASSERT
// (xfb_imconfig.h, RB-98). Overlay.cpp checks the same for the plugin.
#include <imgui.h>

#if !defined(XFB_IMGUI_ASSERT_OVERRIDDEN)
#error "Dear ImGui must be built with IMGUI_USER_CONFIG=xfb_imconfig.h (the bridge's IM_ASSERT, RB-98)"
#endif
