#pragma once
#include "core/overlay/Canvas.hpp"
struct ImFont;
namespace xfb::plugin::overlay
{
void DrawCanvas(canvas::Service&, xfb::overlay::OverlayHost&, float width, float height, float scale, ImFont* mono, ImFont* title);
}
