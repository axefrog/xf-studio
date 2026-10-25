#pragma once

// The XF ImGui theme (bridge 0.7; 0.8.22: the Studio's "In-game surfaces" table): XF Studio's design tokens as ImGui colours and
// metrics, from the generated table ThemeTable.inc (tools/overlay/theme.ts reads projects/xf-studio/authoring/public/studio.css
// and the Studio's in-game theme table; a test fails when the table drifts from the tokens). Game-independent: the overlay
// host's renderer applies it, the self-test checks it.
//
// Dark is the default theme and light a manual choice ([overlay] theme); nothing switches automatically.

#include <cstddef>
#include <string>
#include <vector>

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

// A number the Studio sets on a rule (DisabledAlpha, SweepSeconds) or a design constant of the in-game spec (the pulse and the
// settle, a chip's border alpha, a labelled bar's fill alpha).
struct ThemeValue
{
    const char* name;
    const char* source;
    float value;
};

// A type role (title, eyebrow, body, label, value): the face it uses, its size in the Studio's pixels at 1x and whether its
// text is capitals. The host bakes one font per role.
struct ThemeType
{
    const char* role;
    const char* face; // ui, display or mono
    float size;
    bool caps;
};

const ThemeColor* ThemeColors(size_t& aCount);
const ThemeMetric* ThemeMetrics(size_t& aCount);
const ThemeValue* ThemeValues(size_t& aCount);
const ThemeType* ThemeTypes(size_t& aCount);
// A colour by name for the chosen theme (RGBA, sRGB); false when the table has no such name.
bool ThemeColorOf(const char* aName, ThemeKind aKind, float aOut[4]);
float ThemeMetricOf(const char* aName, float aFallback);
float ThemeValueOf(const char* aName, float aFallback);
// The role's entry, or null.
const ThemeType* ThemeTypeOf(const char* aRole);
// The Windows font files a face loads, first found first.
std::vector<const wchar_t*> ThemeFontFiles(const char* aFace);
ThemeKind ThemeFromName(const std::string& aName); // "light" -> Light, anything else Dark
const char* ThemeName(ThemeKind aKind);
} // namespace xfb::overlay
