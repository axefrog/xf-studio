#include "core/Win32.hpp"

#include <Windows.h>
#include <bcrypt.h>
#include <sddl.h>

#include <chrono>
#include <cstdio>
#include <vector>

namespace xfb::win32
{
std::string Narrow(std::wstring_view aText)
{
    if (aText.empty())
    {
        return {};
    }
    const auto size = WideCharToMultiByte(CP_UTF8, 0, aText.data(), static_cast<int>(aText.size()), nullptr, 0,
                                          nullptr, nullptr);
    std::string out(static_cast<size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, aText.data(), static_cast<int>(aText.size()), out.data(), size, nullptr, nullptr);
    return out;
}

std::wstring Widen(std::string_view aText)
{
    if (aText.empty())
    {
        return {};
    }
    const auto size = MultiByteToWideChar(CP_UTF8, 0, aText.data(), static_cast<int>(aText.size()), nullptr, 0);
    std::wstring out(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, aText.data(), static_cast<int>(aText.size()), out.data(), size);
    return out;
}

bool RandomHex(size_t aBytes, std::string& aOut)
{
    std::vector<unsigned char> buffer(aBytes);
    const auto status = BCryptGenRandom(nullptr, buffer.data(), static_cast<ULONG>(buffer.size()),
                                        BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    if (!BCRYPT_SUCCESS(status))
    {
        return false;
    }
    static constexpr char kHex[] = "0123456789abcdef";
    aOut.clear();
    aOut.reserve(aBytes * 2);
    for (const auto byte : buffer)
    {
        aOut.push_back(kHex[byte >> 4]);
        aOut.push_back(kHex[byte & 0x0F]);
    }
    return true;
}

bool CurrentUserSid(std::string& aOut)
{
    HANDLE token = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token))
    {
        return false;
    }
    DWORD size = 0;
    GetTokenInformation(token, TokenUser, nullptr, 0, &size);
    std::vector<unsigned char> buffer(size);
    bool ok = false;
    if (size > 0 && GetTokenInformation(token, TokenUser, buffer.data(), size, &size))
    {
        const auto* user = reinterpret_cast<const TOKEN_USER*>(buffer.data());
        LPWSTR sidText = nullptr;
        if (ConvertSidToStringSidW(user->User.Sid, &sidText))
        {
            aOut = Narrow(sidText);
            LocalFree(sidText);
            ok = true;
        }
    }
    CloseHandle(token);
    return ok;
}

std::filesystem::path ModuleDirectory(const void* aAddressInModule)
{
    HMODULE module = nullptr;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                            static_cast<LPCWSTR>(aAddressInModule), &module))
    {
        return {};
    }
    std::wstring buffer(MAX_PATH, L'\0');
    for (;;)
    {
        const auto length = GetModuleFileNameW(module, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (length == 0)
        {
            return {};
        }
        if (length < buffer.size())
        {
            buffer.resize(length);
            break;
        }
        buffer.resize(buffer.size() * 2);
    }
    return std::filesystem::path(buffer).parent_path();
}

std::filesystem::path ProcessImagePath()
{
    std::wstring buffer(MAX_PATH, L'\0');
    for (;;)
    {
        const auto length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        if (length == 0)
        {
            return {};
        }
        if (length < buffer.size())
        {
            buffer.resize(length);
            return buffer;
        }
        buffer.resize(buffer.size() * 2);
    }
}

bool FileVersion(const std::filesystem::path& aPath, std::string& aOut)
{
    DWORD handle = 0;
    const auto size = GetFileVersionInfoSizeW(aPath.c_str(), &handle);
    if (size == 0)
    {
        return false;
    }
    std::vector<unsigned char> data(size);
    if (!GetFileVersionInfoW(aPath.c_str(), 0, size, data.data()))
    {
        return false;
    }
    VS_FIXEDFILEINFO* info = nullptr;
    UINT infoSize = 0;
    if (!VerQueryValueW(data.data(), L"\\", reinterpret_cast<void**>(&info), &infoSize) || !info)
    {
        return false;
    }
    char text[64];
    std::snprintf(text, sizeof(text), "%u.%u.%u.%u", HIWORD(info->dwFileVersionMS), LOWORD(info->dwFileVersionMS),
                  HIWORD(info->dwFileVersionLS), LOWORD(info->dwFileVersionLS));
    aOut = text;
    return true;
}

std::filesystem::path RuntimeDirectory()
{
    wchar_t buffer[4096];
    auto length = GetEnvironmentVariableW(L"XFB_RUNTIME_DIR", buffer, 4096);
    if (length > 0 && length < 4096)
    {
        return std::filesystem::path(std::wstring(buffer, length));
    }
    length = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer, 4096);
    if (length > 0 && length < 4096)
    {
        return std::filesystem::path(std::wstring(buffer, length)) / L"XFStudio" / L"runtime-bridge";
    }
    return {};
}

bool WriteFileAtomic(const std::filesystem::path& aPath, std::string_view aContent, std::string& aError)
{
    std::error_code ec;
    std::filesystem::create_directories(aPath.parent_path(), ec);
    if (ec)
    {
        aError = "create_directories: " + ec.message();
        return false;
    }
    auto temp = aPath;
    temp += L".tmp";
    const auto file = CreateFileW(temp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL,
                                  nullptr);
    if (file == INVALID_HANDLE_VALUE)
    {
        aError = "CreateFile: " + LastErrorText(GetLastError());
        return false;
    }
    DWORD written = 0;
    const auto ok = WriteFile(file, aContent.data(), static_cast<DWORD>(aContent.size()), &written, nullptr) &&
                    written == aContent.size();
    FlushFileBuffers(file);
    CloseHandle(file);
    if (!ok)
    {
        aError = "WriteFile: " + LastErrorText(GetLastError());
        DeleteFileW(temp.c_str());
        return false;
    }
    if (!MoveFileExW(temp.c_str(), aPath.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
    {
        aError = "MoveFileEx: " + LastErrorText(GetLastError());
        DeleteFileW(temp.c_str());
        return false;
    }
    return true;
}

std::string LastErrorText(uint32_t aError)
{
    LPWSTR buffer = nullptr;
    const auto length = FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
                                           FORMAT_MESSAGE_IGNORE_INSERTS,
                                       nullptr, aError, 0, reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
    std::string text = "error " + std::to_string(aError);
    if (length > 0 && buffer)
    {
        auto message = Narrow(std::wstring_view(buffer, length));
        while (!message.empty() && (message.back() == '\n' || message.back() == '\r' || message.back() == ' '))
        {
            message.pop_back();
        }
        text += ": " + message;
    }
    if (buffer)
    {
        LocalFree(buffer);
    }
    return text;
}

std::string UtcNowIso8601()
{
    SYSTEMTIME now;
    GetSystemTime(&now);
    char text[32];
    std::snprintf(text, sizeof(text), "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ", now.wYear, now.wMonth, now.wDay,
                  now.wHour, now.wMinute, now.wSecond, now.wMilliseconds);
    return text;
}

uint64_t MonotonicMs()
{
    return static_cast<uint64_t>(GetTickCount64());
}
} // namespace xfb::win32
