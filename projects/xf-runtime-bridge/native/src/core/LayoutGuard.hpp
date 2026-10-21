#pragma once

// 0.8.2: every object file that includes this records the stamp of the headers it was compiled against
// (cmake/HeaderStamp.cmake). The linker refuses (LNK2038) to put objects with different stamps into one binary, so a stale
// object compiled against an older class layout can never be linked again. 0.8.1 shipped one: Main.obj allocated a Bridge
// of the old size, the constructor wrote the new one, and the overrun corrupted the game's heap at load.
//
// Included from core/Log.hpp and plugin/Plugin.hpp, so every translation unit of the plugin, the core and the self-test
// carries it.

#include "XfbHeaderStamp.hpp" // generated in the build folder

#pragma detect_mismatch("xfb_header_stamp", XFB_HEADER_STAMP)
