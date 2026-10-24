#include "core/BuildInfo.hpp"
#include "core/LayoutGuard.hpp"

#include "XfbBuildInfo.hpp" // generated in the build folder

namespace xfb
{
namespace
{
#define XFB_STRINGIFY_(x) #x
#define XFB_STRINGIFY(x) XFB_STRINGIFY_(x)
#ifdef XFB_AUTONOMOUS_TEST_HOOKS
#define XFB_TEST_MARKER ";XFB_AUTONOMOUS_TEST_HOOKS=1"
#else
#define XFB_TEST_MARKER ";XFB_AUTONOMOUS_TEST_HOOKS=0"
#endif
constexpr char kMarker[] = "XFB_BUILD=" XFB_BUILD_COMMIT ";dirty=" XFB_STRINGIFY(XFB_BUILD_DIRTY) XFB_TEST_MARKER;
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
