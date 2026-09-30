# XF Studio's block-compression library (xfs_bcn.dll) over DirectXTex's encoders. DirectXTex is not vendored: pass the folder of
# an official DirectXTex source release as DIRECTXTEX_DIR and its compute shaders compiled with fxc as COMPILED_SHADERS
# (tools/build-native-bcn.ts does both).
cmake_minimum_required(VERSION 3.20)
project(xfs_bcn LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
if(NOT DIRECTXTEX_DIR)
  message(FATAL_ERROR "Set DIRECTXTEX_DIR to a DirectXTex source release folder.")
endif()
set(BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(BUILD_SAMPLE OFF CACHE BOOL "" FORCE)
set(BUILD_DX11 ON CACHE BOOL "" FORCE)
set(BUILD_DX12 OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
# Without OpenMP the library needs no runtime beyond Windows (BC4 is fast on one thread; BC7 runs on the GPU).
set(BC_USE_OPENMP OFF CACHE BOOL "" FORCE)
add_subdirectory(${DIRECTXTEX_DIR} directxtex EXCLUDE_FROM_ALL)
add_library(xfs_bcn SHARED xfs_bcn.cpp)
target_link_libraries(xfs_bcn PRIVATE DirectXTex d3d11.lib)
