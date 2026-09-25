#pragma once

// Small Win32 helpers shared by the plugin and the self-test. No game headers here.

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>

namespace xfb::win32
{
std::string Narrow(std::wstring_view aText);
std::wstring Widen(std::string_view aText);

// Cryptographically random bytes as lowercase hex (BCryptGenRandom, system RNG).
bool RandomHex(size_t aBytes, std::string& aOut);

// String SID of the user running this process, e.g. "S-1-5-21-...".
bool CurrentUserSid(std::string& aOut);

// Folder that holds this module (the plugin DLL or the self-test exe).
std::filesystem::path ModuleDirectory(const void* aAddressInModule);

// Four-part file version from a PE version resource, e.g. "3.0.80.51928".
bool FileVersion(const std::filesystem::path& aPath, std::string& aOut);
std::filesystem::path ProcessImagePath();

// %LOCALAPPDATA%\XFStudio\runtime-bridge unless XFB_RUNTIME_DIR overrides it.
std::filesystem::path RuntimeDirectory();

// Writes a file via a temporary sibling and an atomic replace.
bool WriteFileAtomic(const std::filesystem::path& aPath, std::string_view aContent, std::string& aError);

std::string LastErrorText(uint32_t aError);
std::string UtcNowIso8601();
uint64_t MonotonicMs();
} // namespace xfb::win32
