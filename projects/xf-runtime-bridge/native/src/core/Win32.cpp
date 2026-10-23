#include "core/Win32.hpp"
#include "core/LayoutGuard.hpp"

#include <Windows.h>
#include <bcrypt.h>
#include <sddl.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cwchar>
#include <exception>
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

bool FileSha256(const std::filesystem::path& aPath, std::string& aHex, std::string& aError, uint64_t aMaxBytes,
                const std::function<bool()>& aCancelled)
{
    std::error_code ec;
    const auto size = std::filesystem::file_size(aPath, ec);
    if (ec)
    {
        aError = "unreadable";
        return false;
    }
    if (size > aMaxBytes)
    {
        aError = "too large";
        return false;
    }
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0)
    {
        aError = "BCryptOpenAlgorithmProvider failed";
        return false;
    }
    bool ok = BCryptCreateHash(algorithm, &hash, nullptr, 0, nullptr, 0, 0) >= 0;
    const auto handle = CreateFileW(aPath.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
                                    FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
    if (handle == INVALID_HANDLE_VALUE)
    {
        aError = "unreadable";
        ok = false;
    }
    std::vector<unsigned char> buffer(1024 * 1024);
    std::exception_ptr thrown;
    while (ok)
    {
        try
        {
            if (aCancelled && aCancelled())
            {
                aError = "cancelled";
                ok = false;
                break;
            }
        }
        catch (...)
        {
            thrown = std::current_exception();
            aError = "cancelled";
            ok = false;
            break;
        }
        DWORD read = 0;
        if (!ReadFile(handle, buffer.data(), static_cast<DWORD>(buffer.size()), &read, nullptr))
        {
            aError = "read failed";
            ok = false;
            break;
        }
        if (read == 0)
        {
            break;
        }
        ok = BCryptHashData(hash, buffer.data(), read, 0) >= 0;
    }
    unsigned char digest[32]{};
    if (ok)
    {
        ok = BCryptFinishHash(hash, digest, sizeof(digest), 0) >= 0;
    }
    if (handle != INVALID_HANDLE_VALUE)
    {
        CloseHandle(handle);
    }
    if (hash)
    {
        BCryptDestroyHash(hash);
    }
    BCryptCloseAlgorithmProvider(algorithm, 0);
    if (thrown)
    {
        std::rethrow_exception(thrown);
    }
    if (!ok)
    {
        if (aError.empty())
        {
            aError = "hash failed";
        }
        return false;
    }
    static const char* hex = "0123456789abcdef";
    aHex.clear();
    for (const auto byte : digest)
    {
        aHex.push_back(hex[byte >> 4]);
        aHex.push_back(hex[byte & 15]);
    }
    return true;
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
    const auto length = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer, 4096);
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
    // 0.8.4 (the review): a failed flush counts as a failed write, so the original is never replaced by a file not on disk.
    const auto flushed = ok && FlushFileBuffers(file);
    const auto error = GetLastError();
    CloseHandle(file);
    if (!ok || !flushed)
    {
        aError = std::string(ok ? "FlushFileBuffers: " : "WriteFile: ") + LastErrorText(error);
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

bool ReadFileExact(const std::filesystem::path& aPath, std::string& aOut, bool& aMissing, std::string& aError, uint64_t aMaxBytes)
{
    aOut.clear();
    aMissing = false;
    const auto file = CreateFileW(aPath.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE)
    {
        const auto error = GetLastError();
        aMissing = error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND;
        aError = "CreateFile: " + LastErrorText(error);
        return false;
    }
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(file, &size) || size.QuadPart < 0 || static_cast<uint64_t>(size.QuadPart) > aMaxBytes)
    {
        aError = "the file is too large or its size can't be read";
        CloseHandle(file);
        return false;
    }
    aOut.resize(static_cast<size_t>(size.QuadPart));
    DWORD read = 0;
    const bool ok = aOut.empty() || (ReadFile(file, aOut.data(), static_cast<DWORD>(aOut.size()), &read, nullptr) && read == aOut.size());
    const auto error = GetLastError();
    CloseHandle(file);
    if (!ok)
    {
        aError = "ReadFile: " + LastErrorText(error);
        aOut.clear();
        return false;
    }
    return true;
}

namespace
{
// "20261022-081500-123": UTC, sortable, unique enough for a settings change made by hand.
std::wstring BackupStamp()
{
    SYSTEMTIME t{};
    GetSystemTime(&t);
    wchar_t text[32];
    std::swprintf(text, 32, L"%04u%02u%02u-%02u%02u%02u-%03u", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
    return text;
}

// Keeps the newest aKeep "<name>.*.bak" files in aDir (their names sort by time).
void PruneBackups(const std::filesystem::path& aDir, const std::wstring& aName, size_t aKeep)
{
    std::vector<std::filesystem::path> found;
    std::error_code ec;
    for (std::filesystem::directory_iterator it(aDir, ec), end; !ec && it != end; it.increment(ec))
    {
        const auto file = it->path().filename().wstring();
        if (file.size() > aName.size() + 5 && file.compare(0, aName.size() + 1, aName + L".") == 0 && file.ends_with(L".bak"))
        {
            found.push_back(it->path());
        }
    }
    std::sort(found.begin(), found.end());
    for (size_t i = 0; i + aKeep < found.size(); ++i)
    {
        DeleteFileW(found[i].c_str());
    }
}

// The content written and flushed to aTemp (created afresh).
bool WriteFlushed(const std::filesystem::path& aTemp, std::string_view aContent, std::string& aError)
{
    const auto file = CreateFileW(aTemp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE)
    {
        aError = "CreateFile: " + LastErrorText(GetLastError());
        return false;
    }
    DWORD written = 0;
    const auto ok = WriteFile(file, aContent.data(), static_cast<DWORD>(aContent.size()), &written, nullptr) && written == aContent.size();
    const auto flushed = ok && FlushFileBuffers(file);
    const auto error = GetLastError();
    CloseHandle(file);
    if (!ok || !flushed)
    {
        aError = std::string(ok ? "FlushFileBuffers: " : "WriteFile: ") + LastErrorText(error);
        DeleteFileW(aTemp.c_str());
        return false;
    }
    return true;
}
} // namespace

bool ReplaceSettingsFile(const std::filesystem::path& aPath, std::string_view aContent, const std::filesystem::path& aWorkDir, size_t aKeepBackups,
                         SettingsReplace& aDone, std::string& aError)
{
    aDone = {};
    std::error_code ec;
    std::filesystem::create_directories(aWorkDir, ec);
    const auto name = aPath.filename().wstring();
    const auto backup = aWorkDir / (name + L"." + BackupStamp() + L".bak");
    if (ec || !CopyFileW(aPath.c_str(), backup.c_str(), FALSE))
    {
        aError = "the backup copy couldn't be made (" + (ec ? ec.message() : "CopyFile: " + LastErrorText(GetLastError())) + "), so nothing was changed";
        return false;
    }
    aDone.backup = backup;
    PruneBackups(aWorkDir, name, aKeepBackups);
    std::string why;
    const auto temp = aWorkDir / (name + L".tmp");
    if (!WriteFlushed(temp, aContent, why))
    {
        aError = "the new file couldn't be written (" + why + "), so the old one stays";
        return false;
    }
    if (!MoveFileExW(temp.c_str(), aPath.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
    {
        const auto error = GetLastError();
        DeleteFileW(temp.c_str());
        if (error != ERROR_NOT_SAME_DEVICE)
        {
            aError = "the new file couldn't be put in place (MoveFileEx: " + LastErrorText(error) + "), so the old one stays";
            return false;
        }
        // Another volume: a move would be a copy, so the temporary file goes beside the original (an atomic rename there).
        aDone.tempBeside = true;
        if (!WriteFileAtomic(aPath, aContent, why))
        {
            aError = "the new file couldn't be put in place (" + why + "), so the old one stays";
            return false;
        }
    }
    std::string back;
    bool missing = false;
    if (!ReadFileExact(aPath, back, missing, why) || back != aContent)
    {
        aError = "the file reads back differently after the replace; the old one is kept as " + Narrow(backup.wstring());
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
