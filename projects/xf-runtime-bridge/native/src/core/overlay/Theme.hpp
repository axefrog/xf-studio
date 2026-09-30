#pragma once

// The XF ImGui theme (bridge 0.7): XF Studio's design tokens as ImGui colours and metrics, from the generated table
// ThemeTable.inc (tools/overlay/theme.ts reads projects/xf-studio/authoring/public/studio.css; a test fails when the table
// drifts from the tokens). Game-independent: the overlay host's renderer applies it, the self-test checks it.
//
// Dark is the default theme and light a manual choice ([overlay] theme); nothing switches automatically.

#include <cstddef>
#include <string>

namespace xfb::overlay
{
enum class ThemeKind
{
    Dark,
    Light
};

struct ThemeColor
{
    const char* name;  // ImGui's colour name (ImGuiCol_<name>) or an XF semantic colour (Xf...)
    const char* token; // the Studio token it comes from
    float dark[4];
    float light[4];
};

struct ThemeMetric
{
    const char* name;
    const char* token;
    float value; // the Studio's pixels at 1x
};

const ThemeColor* ThemeColors(size_t& aCount);
const ThemeMetric* ThemeMetrics(size_t& aCount);
// A colour by name for the chosen theme (RGBA, sRGB); false when the table has no such name.
bool ThemeColorOf(const char* aName, ThemeKind aKind, float aOut[4]);
float ThemeMetricOf(const char* aName, float aFallback);
ThemeKind ThemeFromName(const std::string& aName); // "light" -> Light, anything else Dark
const char* ThemeName(ThemeKind aKind);
} // namespace xfb::overlay
