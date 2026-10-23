#include "core/Probes.hpp"

#include <Windows.h>

#include <algorithm>
#include <vector>

#include "core/Dispatcher.hpp"
#include "core/Params.hpp"
#include "core/Win32.hpp"

namespace xfb::probes
{
using json = nlohmann::json;

bool KindOk(const std::string& aKind)
{
    if (aKind.empty() || aKind.size() > 40)
    {
        return false;
    }
    return std::all_of(aKind.begin(), aKind.end(), [](char c) {
        return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '.' || c == ':' || c == '/';
    });
}

ProbeRing::ProbeRing(size_t aCapacity, int aPerKindPerSecond)
    : m_capacity(std::max<size_t>(aCapacity, 16))
    , m_rate(std::max(aPerKindPerSecond, 1))
{
}

bool ProbeRing::Push(const std::string& aKind, json aData, int64_t aNowMs)
{
    std::scoped_lock _(m_mutex);
    auto& [second, count] = m_window[aKind];
    const int64_t now = aNowMs / 1000;
    if (second != now)
    {
        second = now;
        count = 0;
    }
    if (count >= m_rate)
    {
        ++m_dropped[aKind];
        ++m_pendingDrops[aKind];
        return false;
    }
    ++count;
    if (!aData.is_object())
    {
        aData = json{{"value", std::move(aData)}};
    }
    if (const auto pending = m_pendingDrops.find(aKind); pending != m_pendingDrops.end() && pending->second > 0)
    {
        aData["dropped_before"] = pending->second;
        pending->second = 0;
    }
    m_entries.push_back(Entry{m_next++, aNowMs, aKind, std::move(aData)});
    while (m_entries.size() > m_capacity)
    {
        m_entries.pop_front();
        ++m_evicted;
    }
    return true;
}

json ProbeRing::Read(uint64_t aSince, size_t aLimit, const std::vector<std::string>& aKinds) const
{
    std::scoped_lock _(m_mutex);
    const size_t limit = std::clamp<size_t>(aLimit, 1, 500);
    const auto wanted = [&](const std::string& aKind) {
        if (aKinds.empty())
        {
            return true;
        }
        return std::any_of(aKinds.begin(), aKinds.end(), [&](const std::string& k) {
            return aKind == k || (aKind.size() > k.size() && aKind.compare(0, k.size(), k) == 0 && aKind[k.size()] == '.');
        });
    };
    json events = json::array();
    uint64_t next = aSince;
    for (const auto& entry : m_entries)
    {
        if (entry.seq < aSince)
        {
            continue;
        }
        if (events.size() >= limit)
        {
            break;
        }
        if (!wanted(entry.kind))
        {
            next = entry.seq + 1;
            continue;
        }
        events.push_back(json{{"seq", entry.seq}, {"t_ms", entry.tMs}, {"kind", entry.kind}, {"data", entry.data}});
        next = entry.seq + 1;
    }
    json dropped = json::object();
    for (const auto& [kind, n] : m_dropped)
    {
        dropped[kind] = n;
    }
    const uint64_t oldest = m_entries.empty() ? m_next : m_entries.front().seq;
    return json{{"events", events},       {"next", std::max(next, aSince)}, {"latest", m_next - 1},
                {"evicted", m_evicted},   {"missed", aSince > 0 && aSince < oldest ? oldest - aSince : 0},
                {"dropped", dropped},     {"capacity", m_capacity},
                {"rate_per_kind_s", m_rate}};
}

size_t ProbeRing::Size() const
{
    std::scoped_lock _(m_mutex);
    return m_entries.size();
}

CompanionRequest ParseCompanion(const json& aParams)
{
    params::RequireOnly(aParams, {"mode", "seconds", "memory_mb"});
    CompanionRequest request;
    if (const auto mode = params::CheckText(aParams, "mode", 8))
    {
        if (*mode != "probe" && *mode != "sleep" && *mode != "stop")
        {
            throw MethodError("bad_params", "'mode' is probe, sleep or stop");
        }
        request.mode = *mode;
    }
    request.seconds = static_cast<int>(params::CheckInteger(aParams, "seconds", 1, 3600).value_or(600));
    request.memoryMb = static_cast<uint32_t>(params::CheckInteger(aParams, "memory_mb", 16, 1024).value_or(64));
    return request;
}

namespace
{
// The kept job of a sleeping companion (one at a time), and its process. Closed by stop, or by the system when the game exits.
std::mutex g_keptMutex;
HANDLE g_keptJob = nullptr;
HANDLE g_keptProcess = nullptr;
DWORD g_keptPid = 0;

struct Handle
{
    HANDLE h = nullptr;
    Handle() = default;
    explicit Handle(HANDLE aHandle) : h(aHandle == INVALID_HANDLE_VALUE ? nullptr : aHandle) {}
    ~Handle() { Reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    void Reset()
    {
        if (h)
        {
            CloseHandle(h);
        }
        h = nullptr;
    }
    HANDLE Release()
    {
        auto out = h;
        h = nullptr;
        return out;
    }
};

std::string ErrorText(const char* aStep)
{
    const auto error = GetLastError();
    return std::string(aStep) + " failed: " + win32::LastErrorText(error) + " (" + std::to_string(error) + ")";
}

json StopKept()
{
    std::scoped_lock _(g_keptMutex);
    if (!g_keptJob)
    {
        return json{{"stopped", false}, {"why", "no sleeping companion"}};
    }
    const DWORD pid = g_keptPid;
    CloseHandle(g_keptJob); // kill-on-close ends it
    g_keptJob = nullptr;
    DWORD exitCode = STILL_ACTIVE;
    bool ended = false;
    if (g_keptProcess)
    {
        ended = WaitForSingleObject(g_keptProcess, 3000) == WAIT_OBJECT_0;
        GetExitCodeProcess(g_keptProcess, &exitCode);
        CloseHandle(g_keptProcess);
        g_keptProcess = nullptr;
    }
    g_keptPid = 0;
    return json{{"stopped", true}, {"pid", pid}, {"ended_by_job_close", ended}, {"exit_code", exitCode}};
}
} // namespace

json RunCompanion(const CompanionRequest& aRequest, const std::filesystem::path& aExe, const std::filesystem::path& aSeeFile,
                  const std::filesystem::path& aSeeDir, int aWaitMs)
{
    if (aRequest.mode == "stop")
    {
        return StopKept();
    }
    if (aRequest.mode == "sleep")
    {
        std::scoped_lock _(g_keptMutex);
        if (g_keptJob)
        {
            throw MethodError("companion_running", "a sleeping companion runs already (pid " + std::to_string(g_keptPid) + "); stop it first");
        }
    }
    std::error_code ec;
    if (!aExe.is_absolute() || !std::filesystem::is_regular_file(aExe, ec))
    {
        throw MethodError("not_in_this_package", "the companion probe (xfb_companion_probe.exe) isn't in the plugin's folder; only the -writes package has it");
    }
    json out{{"mode", aRequest.mode}, {"exe", aExe.filename().string()}};

    // The executable stays open with sharing that refuses writers from before its hash is read until the process exists.
    Handle lock(CreateFileW(aExe.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!lock.h)
    {
        throw MethodError("failed", ErrorText("opening the companion without writers"));
    }
    std::string hash, hashError;
    if (win32::FileSha256(aExe, hash, hashError, 16u * 1024 * 1024))
    {
        out["sha256"] = hash;
    }
    else
    {
        out["sha256_error"] = hashError;
    }

    // The job: kill-on-close, one active process, a memory cap, UI limits.
    Handle job(CreateJobObjectW(nullptr, nullptr));
    if (!job.h)
    {
        throw MethodError("failed", ErrorText("CreateJobObjectW"));
    }
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_PROCESS_MEMORY |
                                              JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
    limits.BasicLimitInformation.ActiveProcessLimit = 1;
    limits.ProcessMemoryLimit = static_cast<SIZE_T>(aRequest.memoryMb) * 1024 * 1024;
    if (!SetInformationJobObject(job.h, JobObjectExtendedLimitInformation, &limits, sizeof(limits)))
    {
        throw MethodError("failed", ErrorText("setting the job's limits"));
    }
    JOBOBJECT_BASIC_UI_RESTRICTIONS ui{};
    ui.UIRestrictionsClass = JOB_OBJECT_UILIMIT_DESKTOP | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS | JOB_OBJECT_UILIMIT_EXITWINDOWS |
                             JOB_OBJECT_UILIMIT_GLOBALATOMS | JOB_OBJECT_UILIMIT_HANDLES | JOB_OBJECT_UILIMIT_READCLIPBOARD |
                             JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS | JOB_OBJECT_UILIMIT_WRITECLIPBOARD;
    const bool uiLimited = SetInformationJobObject(job.h, JobObjectBasicUIRestrictions, &ui, sizeof(ui)) != 0;
    out["ui_limits"] = uiLimited;

    // Its standard output (and error) into a private pipe; the write end is the only handle it inherits.
    SECURITY_ATTRIBUTES inherit{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE readRaw = nullptr, writeRaw = nullptr;
    if (!CreatePipe(&readRaw, &writeRaw, &inherit, 64 * 1024))
    {
        throw MethodError("failed", ErrorText("CreatePipe"));
    }
    Handle readEnd(readRaw), writeEnd(writeRaw);
    SetHandleInformation(readEnd.h, HANDLE_FLAG_INHERIT, 0);

    SIZE_T attrSize = 0;
    InitializeProcThreadAttributeList(nullptr, 2, 0, &attrSize);
    std::vector<unsigned char> attrBuffer(attrSize);
    auto* attrs = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attrBuffer.data());
    if (!InitializeProcThreadAttributeList(attrs, 2, 0, &attrSize))
    {
        throw MethodError("failed", ErrorText("InitializeProcThreadAttributeList"));
    }
    HANDLE jobs[1] = {job.h};
    HANDLE inherited[1] = {writeEnd.h};
    const bool jobListed = UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, jobs, sizeof(jobs), nullptr, nullptr) != 0;
    const bool handlesListed = UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited, sizeof(inherited), nullptr, nullptr) != 0;

    STARTUPINFOEXW si{};
    si.StartupInfo.cb = sizeof(si);
    si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    si.StartupInfo.hStdInput = nullptr;
    si.StartupInfo.hStdOutput = writeEnd.h;
    si.StartupInfo.hStdError = writeEnd.h;
    si.lpAttributeList = attrs;

    // A fixed command line: the mode and, for probe, the file and folder the plugin chose; no shell.
    std::wstring command = L"\"" + aExe.wstring() + L"\" ";
    if (aRequest.mode == "sleep")
    {
        command += L"sleep " + std::to_wstring(aRequest.seconds);
    }
    else
    {
        command += L"probe \"" + aSeeFile.wstring() + L"\" \"" + aSeeDir.wstring() + L"\"";
    }
    std::vector<wchar_t> commandLine(command.begin(), command.end());
    commandLine.push_back(L'\0');
    const auto workDir = aExe.parent_path().wstring();
    const DWORD flags = CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT | BELOW_NORMAL_PRIORITY_CLASS;
    PROCESS_INFORMATION pi{};
    std::string route = "atomic";
    BOOL created = jobListed && handlesListed &&
                   CreateProcessW(aExe.c_str(), commandLine.data(), nullptr, nullptr, TRUE, flags, nullptr, workDir.c_str(), &si.StartupInfo, &pi);
    if (!created)
    {
        // The job named in the attribute list was refused (or couldn't be listed): the design's other route, a checked
        // assignment before the process resumes, with only the handle list.
        out["atomic_error"] = jobListed && handlesListed ? ErrorText("CreateProcessW with the job listed") : std::string("the job or handle list couldn't be set");
        DeleteProcThreadAttributeList(attrs);
        if (!InitializeProcThreadAttributeList(attrs, 1, 0, &attrSize) ||
            !UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited, sizeof(inherited), nullptr, nullptr))
        {
            throw MethodError("failed", ErrorText("the handle list"));
        }
        route = "assigned";
        created = CreateProcessW(aExe.c_str(), commandLine.data(), nullptr, nullptr, TRUE, flags, nullptr, workDir.c_str(), &si.StartupInfo, &pi);
        if (created && !AssignProcessToJobObject(job.h, pi.hProcess))
        {
            out["assign_error"] = ErrorText("AssignProcessToJobObject");
        }
    }
    DeleteProcThreadAttributeList(attrs);
    writeEnd.Reset();
    if (!created)
    {
        throw MethodError("failed", ErrorText("CreateProcessW"));
    }
    Handle process(pi.hProcess), thread(pi.hThread);
    out["route"] = route;
    out["pid"] = pi.dwProcessId;

    // Checked in the job before it runs; anything else ends it (fail closed).
    BOOL inJob = FALSE;
    if (!IsProcessInJob(process.h, job.h, &inJob) || !inJob)
    {
        TerminateProcess(process.h, 1);
        WaitForSingleObject(process.h, 2000);
        out["in_job"] = false;
        throw MethodError("failed", "the companion wasn't in its job before it resumed, so it was ended (route " + route + ")");
    }
    out["in_job"] = true;
    ResumeThread(thread.h);
    lock.Reset();

    if (aRequest.mode == "sleep")
    {
        std::scoped_lock _(g_keptMutex);
        g_keptJob = job.Release();
        g_keptProcess = process.Release();
        g_keptPid = pi.dwProcessId;
        out["sleeping_s"] = aRequest.seconds;
        out["note"] = "ends when the game exits or crashes (the job's last handle closes) or with mode stop";
        return out;
    }

    // probe: its one line of report, then it exits.
    const auto started = win32::MonotonicMs();
    std::string text;
    bool exited = false;
    while (true)
    {
        DWORD available = 0;
        if (PeekNamedPipe(readEnd.h, nullptr, 0, nullptr, &available, nullptr) && available > 0)
        {
            std::string chunk(std::min<DWORD>(available, 8192), '\0');
            DWORD got = 0;
            if (ReadFile(readEnd.h, chunk.data(), static_cast<DWORD>(chunk.size()), &got, nullptr) && got > 0)
            {
                text.append(chunk.data(), got);
            }
        }
        if (exited || text.size() > 16384)
        {
            break;
        }
        exited = WaitForSingleObject(process.h, 50) == WAIT_OBJECT_0;
        if (!exited && win32::MonotonicMs() - started > static_cast<uint64_t>(aWaitMs))
        {
            break;
        }
    }
    DWORD exitCode = STILL_ACTIVE;
    GetExitCodeProcess(process.h, &exitCode);
    out["exited"] = exited;
    out["exit_code"] = exitCode;
    out["waited_ms"] = win32::MonotonicMs() - started;
    const auto line = text.substr(0, text.find('\n'));
    auto report = json::parse(line, nullptr, false);
    if (report.is_discarded())
    {
        out["report_text"] = line.substr(0, 400);
    }
    else
    {
        out["report"] = report;
    }
    // Closing the job ends it if it still runs (kill-on-close).
    return out;
}
} // namespace xfb::probes
