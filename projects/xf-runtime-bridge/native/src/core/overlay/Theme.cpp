#include "core/overlay/Theme.hpp"
#include "core/LayoutGuard.hpp"

#include <cstring>

namespace xfb::overlay
{
namespace
{
#define XF_THEME_COLOR(name, token, dr, dg, db, da, lr, lg, lb, la) {#name, token, {dr, dg, db, da}, {lr, lg, lb, la}},
#define XF_THEME_METRIC(name, token, value)
const ThemeColor kColors[] = {
#include "core/overlay/ThemeTable.inc"
};
#undef XF_THEME_COLOR
#undef XF_THEME_METRIC

#define XF_THEME_COLOR(name, token, dr, dg, db, da, lr, lg, lb, la)
#define XF_THEME_METRIC(name, token, value) {#name, token, value},
const ThemeMetric kMetrics[] = {
#include "core/overlay/ThemeTable.inc"
};
#undef XF_THEME_COLOR
#undef XF_THEME_METRIC
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

ThemeKind ThemeFromName(const std::string& aName)
{
    return aName == "light" ? ThemeKind::Light : ThemeKind::Dark;
}

const char* ThemeName(ThemeKind aKind)
{
    return aKind == ThemeKind::Light ? "light" : "dark";
}
} // namespace xfb::overlay
