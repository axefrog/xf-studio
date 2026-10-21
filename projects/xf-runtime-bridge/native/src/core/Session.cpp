#include "core/Session.hpp"
#include "core/LayoutGuard.hpp"

#include <Windows.h>

#include <fstream>
#include <iterator>

#include <nlohmann/json.hpp>

#include "core/Win32.hpp"

namespace xfb
{
std::filesystem::path Session::SessionFile() const
{
    return runtimeDir / L"session.json";
}

std::filesystem::path Session::KillFile() const
{
    return runtimeDir / L"KILL";
}

bool CreateSession(Session& aOut, std::string& aError, const std::filesystem::path& aRuntimeDirOverride)
{
    std::string pipeSuffix;
    if (!win32::RandomHex(8, aOut.sessionId) || !win32::RandomHex(32, aOut.token) ||
        !win32::RandomHex(6, pipeSuffix))
    {
        aError = "BCryptGenRandom failed";
        return false;
    }
    aOut.processId = GetCurrentProcessId();
    aOut.pipeName = L"\\\\.\\pipe\\xf-runtime-bridge-" + std::to_wstring(aOut.processId) + L"-" +
                    win32::Widen(pipeSuffix);
    aOut.startedAt = win32::UtcNowIso8601();
    aOut.runtimeDir = aRuntimeDirOverride.empty() ? win32::RuntimeDirectory() : aRuntimeDirOverride;
    if (aOut.runtimeDir.empty())
    {
        aError = "LOCALAPPDATA is not set";
        return false;
    }
    return true;
}

bool KillFilePresent(const Session& aSession)
{
    const auto attributes = GetFileAttributesW(aSession.KillFile().c_str());
    return attributes != INVALID_FILE_ATTRIBUTES;
}

bool SessionRunnerActive(const Session& aSession)
{
    if (aSession.runtimeDir.empty())
    {
        return false;
    }
    try
    {
        std::ifstream in(aSession.runtimeDir / L"session-runner.lock", std::ios::binary);
        if (!in)
        {
            return false;
        }
        std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        if (text.size() > 4096)
        {
            return false;
        }
        const auto lock = nlohmann::json::parse(text, nullptr, false);
        if (!lock.is_object() || !lock.contains("pid") || !lock["pid"].is_number_unsigned())
        {
            return false;
        }
        const auto pid = lock["pid"].get<uint64_t>();
        if (pid == 0 || pid > 0xFFFFFFFFull)
        {
            return false;
        }
        const auto process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, static_cast<DWORD>(pid));
        if (!process)
        {
            return false;
        }
        DWORD code = 0;
        const bool alive = GetExitCodeProcess(process, &code) && code == STILL_ACTIVE;
        CloseHandle(process);
        return alive;
    }
    catch (...)
    {
        return false;
    }
}
} // namespace xfb
