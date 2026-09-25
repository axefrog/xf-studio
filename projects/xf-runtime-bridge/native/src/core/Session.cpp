#include "core/Session.hpp"

#include <Windows.h>

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
} // namespace xfb
