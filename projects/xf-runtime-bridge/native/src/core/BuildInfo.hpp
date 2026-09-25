#pragma once

// Which source this binary was built from (git commit and whether the project tree was dirty).
// The values come from a header generated at build time (native/cmake/BuildInfo.cmake).

#include <string_view>

namespace xfb
{
std::string_view BuildCommit();
bool BuildDirty();

// "XFB_BUILD=<commit>;dirty=<0|1>", also stored verbatim in the binary so that
// tools/package.ts can read it without loading the DLL.
std::string_view BuildMarker();
} // namespace xfb
