#include "core/overlay/Theme.hpp"
#include "core/LayoutGuard.hpp"

#include <cstring>

namespace xfb::overlay
{
namespace
{
// The generated table is included once per kind of line; the macros of the other kinds are empty.
#define XF_THEME_COLOR(name, token, dr, dg, db, da, lr, lg, lb, la) {#name, token, {dr, dg, db, da}, {lr, lg, lb, la}},
#define XF_THEME_METRIC(name, token, value)
#define XF_THEME_VALUE(name, source, value)
#define XF_THEME_TYPE(role, face, size, caps)
#define XF_THEME_FONT(face, file)
const ThemeColor kColors[] = {
#include "core/overlay/ThemeTable.inc"
};
#undef XF_THEME_COLOR
#undef XF_THEME_METRIC
#undef XF_THEME_VALUE
#undef XF_THEME_TYPE
#undef XF_THEME_FONT

#define XF_THEME_COLOR(name, token, dr, dg, db, da, lr, lg, lb, la)
#define XF_THEME_METRIC(name, token, value) {#name, token, value},
#define XF_THEME_VALUE(name, source, value)
#define XF_THEME_TYPE(role, face, size, caps)
#define XF_THEME_FONT(face, file)
const ThemeMetric kMetrics[] = {
#include "core/overlay/ThemeTable.inc"
};
#undef XF_THEME_COLOR
#undef XF_THEME_METRIC
#undef XF_THEME_VALUE
#undef XF_THEME_TYPE
#undef XF_THEME_FONT

#define XF_THEME_COLOR(name, token, dr, dg, db, da, lr, lg, lb, la)
#define XF_THEME_METRIC(name, token, value)
#define XF_THEME_VALUE(name, source, value) {#name, source, value},
#define XF_THEME_TYPE(role, face, size, caps)
#define XF_THEME_FONT(face, file)
const ThemeValue kValues[] = {
#include "core/overlay/ThemeTable.inc"
};
#undef XF_THEME_COLOR
#undef XF_THEME_METRIC
#undef XF_THEME_VALUE
#undef XF_THEME_TYPE
#undef XF_THEME_FONT

#define XF_THEME_COLOR(name, token, dr, dg, db, da, lr, lg, lb, la)
#define XF_THEME_METRIC(name, token, value)
#define XF_THEME_VALUE(name, source, value)
#define XF_THEME_TYPE(role, face, size, caps) {#role, #face, size, caps},
#define XF_THEME_FONT(face, file)
const ThemeType kTypes[] = {
#include "core/overlay/ThemeTable.inc"
};
#undef XF_THEME_COLOR
#undef XF_THEME_METRIC
#undef XF_THEME_VALUE
#undef XF_THEME_TYPE
#undef XF_THEME_FONT

struct FontFile
{
    const char* face;
    const wchar_t* file;
};
#define XF_THEME_COLOR(name, token, dr, dg, db, da, lr, lg, lb, la)
#define XF_THEME_METRIC(name, token, value)
#define XF_THEME_VALUE(name, source, value)
#define XF_THEME_TYPE(role, face, size, caps)
#define XF_THEME_FONT(face, file) {#face, file},
const FontFile kFonts[] = {
#include "core/overlay/ThemeTable.inc"
};
#undef XF_THEME_COLOR
#undef XF_THEME_METRIC
#undef XF_THEME_VALUE
#undef XF_THEME_TYPE
#undef XF_THEME_FONT
} // namespace

const ThemeColor* ThemeColors(size_t& aCount)
{
    aCount = sizeof(kColors) / sizeof(kColors[0]);
    return kColors;
}

const ThemeMetric* ThemeMetrics(size_t& aCount)
{
    aCount = sizeof(kMetrics) / sizeof(kMetrics[0]);
    return kMetrics;
}

const ThemeValue* ThemeValues(size_t& aCount)
{
    aCount = sizeof(kValues) / sizeof(kValues[0]);
    return kValues;
}

const ThemeType* ThemeTypes(size_t& aCount)
{
    aCount = sizeof(kTypes) / sizeof(kTypes[0]);
    return kTypes;
}

bool ThemeColorOf(const char* aName, ThemeKind aKind, float aOut[4])
{
    for (const auto& color : kColors)
    {
        if (std::strcmp(color.name, aName) == 0)
        {
            const float* source = aKind == ThemeKind::Light ? color.light : color.dark;
            for (int i = 0; i < 4; ++i)
            {
                aOut[i] = source[i];
            }
            return true;
        }
    }
    return false;
}

float ThemeMetricOf(const char* aName, float aFallback)
{
    for (const auto& metric : kMetrics)
    {
        if (std::strcmp(metric.name, aName) == 0)
        {
            return metric.value;
        }
    }
    return aFallback;
}

float ThemeValueOf(const char* aName, float aFallback)
{
    for (const auto& value : kValues)
    {
        if (std::strcmp(value.name, aName) == 0)
        {
            return value.value;
        }
    }
    return aFallback;
}

const ThemeType* ThemeTypeOf(const char* aRole)
{
    for (const auto& type : kTypes)
    {
        if (std::strcmp(type.role, aRole) == 0)
        {
            return &type;
        }
    }
    return nullptr;
}

std::vector<const wchar_t*> ThemeFontFiles(const char* aFace)
{
    std::vector<const wchar_t*> out;
    for (const auto& font : kFonts)
    {
        if (std::strcmp(font.face, aFace) == 0)
        {
            out.push_back(font.file);
        }
    }
    return out;
}

ThemeKind ThemeFromName(const std::string& aName)
{
    return aName == "light" ? ThemeKind::Light : ThemeKind::Dark;
}

const char* ThemeName(ThemeKind aKind)
{
    return aKind == ThemeKind::Light ? "light" : "dark";
}
} // namespace xfb::overlay
