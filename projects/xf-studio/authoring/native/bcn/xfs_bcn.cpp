// XF Studio's block-compression library: a C entry point over DirectXTex's encoders (MIT, Microsoft Corporation), so the native
// resource writer can compress an imported texture's mip chain the way WolvenKit's import does (it calls DirectXTex too): BC4 and
// friends on the CPU, BC7 with DirectXTex's DirectCompute encoder on a hardware Direct3D 11 device, as WolvenKit's import does when it
// can make one. Built by tools/build-native-bcn.ts; loaded through bun:ffi by src/native/write/bcn.ts. The only state kept between
// calls is the Direct3D device, made on first use.
#include <cstdint>
#include <cstring>
#include <new>
#include <d3d11.h>
#include <wrl/client.h>
#include "DirectXTex.h"

using namespace DirectX;

extern "C" {

// Version of this entry point's contract (bump on any change of behaviour or signature).
__declspec(dllexport) uint32_t xfs_bcn_version() { return 1; }

// Compress a full mip chain. `pixels` holds every level of a width x height chain (largest first, each level tightly packed in
// `srcFormat`); `out` receives every compressed level back to back. Returns 0 on success, else a negative code or the HRESULT.
__declspec(dllexport) int32_t xfs_bcn_compress(uint32_t srcFormat, const uint8_t* pixels, uint64_t pixelBytes, uint32_t width, uint32_t height,
                                               uint32_t mipLevels, uint32_t dstFormat, uint32_t flags, float threshold,
                                               uint8_t* out, uint64_t outBytes, uint64_t* written) {
  if (!pixels || !out || !written || !width || !height || !mipLevels) return -1;
  *written = 0;
  ScratchImage source;
  HRESULT hr = source.Initialize2D(static_cast<DXGI_FORMAT>(srcFormat), width, height, 1, mipLevels);
  if (FAILED(hr)) return hr;
  uint64_t at = 0;
  for (size_t level = 0; level < mipLevels; ++level) {
    const Image* image = source.GetImage(level, 0, 0);
    if (!image) return -2;
    const size_t rows = image->height, row = image->rowPitch;
    size_t tight = 0, slice = 0;
    if (FAILED(ComputePitch(image->format, image->width, image->height, tight, slice))) return -3;
    if (at + tight * rows > pixelBytes) return -4;
    for (size_t y = 0; y < rows; ++y) std::memcpy(image->pixels + y * row, pixels + at + y * tight, tight);
    at += tight * rows;
  }
  if (at != pixelBytes) return -5;
  ScratchImage compressed;
  if (flags & 0x80000000u) {
    // DirectCompute (BC6H/BC7 only): a hardware device, as texconv makes one.
    static Microsoft::WRL::ComPtr<ID3D11Device> device;
    if (!device) {
      D3D_FEATURE_LEVEL levels[] = { D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0 };
      D3D_FEATURE_LEVEL got;
      hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, levels, 3, D3D11_SDK_VERSION, device.GetAddressOf(), &got, nullptr);
      if (FAILED(hr)) { device.Reset(); return hr; }
    }
    hr = Compress(device.Get(), source.GetImages(), source.GetImageCount(), source.GetMetadata(), static_cast<DXGI_FORMAT>(dstFormat),
                  static_cast<TEX_COMPRESS_FLAGS>(flags & 0x7fffffffu), threshold, compressed);
  } else
  hr = Compress(source.GetImages(), source.GetImageCount(), source.GetMetadata(), static_cast<DXGI_FORMAT>(dstFormat),
                static_cast<TEX_COMPRESS_FLAGS>(flags), threshold, compressed);
  if (FAILED(hr)) return hr;
  uint64_t total = 0;
  for (size_t level = 0; level < mipLevels; ++level) {
    const Image* image = compressed.GetImage(level, 0, 0);
    if (!image) return -6;
    if (total + image->slicePitch > outBytes) return -7;
    std::memcpy(out + total, image->pixels, image->slicePitch);
    total += image->slicePitch;
  }
  *written = total;
  return 0;
}

}  // extern "C"
