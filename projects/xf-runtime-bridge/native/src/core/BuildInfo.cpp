#include "core/BuildInfo.hpp"

#include "XfbBuildInfo.hpp" // generated in the build folder

namespace xfb
{
namespace
{
#define XFB_STRINGIFY_(x) #x
#define XFB_STRINGIFY(x) XFB_STRINGIFY_(x)
constexpr char kMarker[] = "XFB_BUILD=" XFB_BUILD_COMMIT ";dirty=" XFB_STRINGIFY(XFB_BUILD_DIRTY);
} // namespace

std::string_view BuildCommit()
{
    return XFB_BUILD_COMMIT;
}

bool BuildDirty()
{
    return XFB_BUILD_DIRTY != 0;
}

std::string_view BuildMarker()
{
    return kMarker;
}
} // namespace xfb
