cmake_minimum_required(VERSION 3.25)

# XF Runtime Bridge: RED4ext plugin plus an offline self-test host for the bridge core.
# See ../README.md for the design and ../docs/test-card.md for the in-game session.

project(
  XFRuntimeBridge
  VERSION 0.1.0
  LANGUAGES CXX RC
)

if(NOT MSVC)
  message(FATAL_ERROR "XF Runtime Bridge is built with MSVC (Visual Studio 2022) only.")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Static CRT: the plugin must not depend on a particular VC++ redistributable being installed.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

include(FetchContent)

# -----------------------------------------------------------------------------
# Dependencies, pinned.
#
# RED4ext.SDK tag 1.0.0 (commit a4a78108) is the SDK that RED4ext v1.30.0 itself
# builds against (RED4ext cmake/deps/RED4extSdk.cmake). Set XFB_RED4EXT_SDK_GIT to
# a local clone to build offline; the clone is only read (git clone), never changed.
# -----------------------------------------------------------------------------
set(XFB_RED4EXT_SDK_GIT "https://github.com/wopss/RED4ext.SDK.git" CACHE STRING "RED4ext.SDK git repository")
set(XFB_RED4EXT_SDK_REF "a4a781088a92a8efa890d94fde4efd8985d497c7" CACHE STRING "RED4ext.SDK commit (tag 1.0.0)")

set(RED4EXT_HEADER_ONLY ON CACHE BOOL "" FORCE)
set(RED4EXT_USE_PCH OFF CACHE BOOL "" FORCE)
set(RED4EXT_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(RED4EXT_INSTALL OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  RED4ext.SDK
  GIT_REPOSITORY ${XFB_RED4EXT_SDK_GIT}
  GIT_TAG        ${XFB_RED4EXT_SDK_REF}
  GIT_SHALLOW    OFF
  # The SDK's generated headers have very long names; without this a deep build folder fails
  # with "Filename too long" on Windows.
  GIT_CONFIG     core.longpaths=true
)

# nlohmann/json v3.12.0 (MIT), official release tarball, pinned by SHA-256.
set(JSON_BuildTests OFF CACHE INTERNAL "")
set(JSON_Install OFF CACHE INTERNAL "")
FetchContent_Declare(
  nlohmann_json
  URL      https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz
  URL_HASH SHA256=42f6e95cad6ec532fd372391373363b62a14af6d771056dbfc86160e6dfff7aa
  DOWNLOAD_EXTRACT_TIMESTAMP ON
)

FetchContent_MakeAvailable(RED4ext.SDK nlohmann_json)

# -----------------------------------------------------------------------------
# Common compile settings
# -----------------------------------------------------------------------------
set(XFB_DEFINITIONS
  WIN32_LEAN_AND_MEAN
  NOMINMAX
  UNICODE
  _UNICODE
  XFB_VERSION_STRING="${PROJECT_VERSION}"
  XFB_VERSION_MAJOR=${PROJECT_VERSION_MAJOR}
  XFB_VERSION_MINOR=${PROJECT_VERSION_MINOR}
  XFB_VERSION_PATCH=${PROJECT_VERSION_PATCH}
)
set(XFB_OPTIONS /W4 /permissive- /utf-8 /EHsc /Zc:__cplusplus)

# -----------------------------------------------------------------------------
# Bridge core: game-independent transport, protocol, session and logging.
# It never includes RED4ext headers, so the self-test can host it without the game.
# -----------------------------------------------------------------------------
add_library(xfb_core STATIC
  src/core/Bridge.cpp
  src/core/Config.cpp
  src/core/Dispatcher.cpp
  src/core/GameThreadQueue.cpp
  src/core/Log.cpp
  src/core/PipeServer.cpp
  src/core/Session.cpp
  src/core/Win32.cpp
)
target_include_directories(xfb_core PUBLIC src)
target_compile_definitions(xfb_core PUBLIC ${XFB_DEFINITIONS})
target_compile_options(xfb_core PRIVATE ${XFB_OPTIONS} /WX)
target_link_libraries(xfb_core PUBLIC nlohmann_json::nlohmann_json bcrypt advapi32 version)

# -----------------------------------------------------------------------------
# RED4ext plugin
# -----------------------------------------------------------------------------
add_library(XFRuntimeBridge SHARED
  src/plugin/Main.cpp
  src/plugin/Natives.cpp
  src/plugin/GameHandlers.cpp
  src/plugin/Plugin.cpp
  src/plugin/Resource.rc
)
# Header-only SDK (RED4EXT_HEADER_ONLY is set by RED4ext/Common.hpp unless RED4EXT_STATIC_LIB):
# every translation unit must include <RED4ext/RED4ext.hpp> before any RED4ext/Api header.
target_compile_definitions(XFRuntimeBridge PRIVATE ${XFB_DEFINITIONS})
# SDK headers produce warnings we do not own; keep /W4 but do not treat them as errors here.
target_compile_options(XFRuntimeBridge PRIVATE ${XFB_OPTIONS})
target_link_libraries(XFRuntimeBridge PRIVATE xfb_core RED4ext::SDK)
set_target_properties(XFRuntimeBridge PROPERTIES OUTPUT_NAME "XFRuntimeBridge")

# -----------------------------------------------------------------------------
# Offline self-test host: runs the same bridge core with a simulated game thread.
# -----------------------------------------------------------------------------
add_executable(xfb_selftest src/selftest/Main.cpp)
target_compile_options(xfb_selftest PRIVATE ${XFB_OPTIONS} /WX)
target_link_libraries(xfb_selftest PRIVATE xfb_core)
