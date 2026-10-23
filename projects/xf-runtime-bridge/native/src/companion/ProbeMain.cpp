// xfb_companion_probe (bridge 0.8.7, a test probe; the -writes package only): the companion that XF Runtime Bridge's
// test.companion.probe launches under companion@1's containment (core/Probes.cpp). "probe <file> <folder>" writes one JSON
// line to standard output, whether it sees that file and how many .archive files that folder holds (MO2's virtual files
// reaching a child of the game: XF Core's O4), and its own job's limits, then exits. "sleep <s>" just waits, so a session can
// check that the job's kill-on-close ends it when the game exits. Nothing else: no network, no window, no writes.

#include <Windows.h>

#include <cstdio>
#include <cwchar>

int wmain(int argc, wchar_t** argv)
{
    if (argc >= 3 && wcscmp(argv[1], L"sleep") == 0)
    {
        const int seconds = _wtoi(argv[2]);
        Sleep(static_cast<DWORD>(seconds < 1 ? 1 : (seconds > 3600 ? 3600 : seconds)) * 1000u);
        return 0;
    }
    if (argc < 4 || wcscmp(argv[1], L"probe") != 0)
    {
        std::printf("{\"probe\":\"xfb_companion_probe\",\"error\":\"usage: probe <file> <folder> | sleep <s>\"}\n");
        return 2;
    }
    BOOL inJob = FALSE;
    IsProcessInJob(GetCurrentProcess(), nullptr, &inJob);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    const BOOL read = QueryInformationJobObject(nullptr, JobObjectExtendedLimitInformation, &limits, sizeof(limits), nullptr);
    const DWORD flags = read ? limits.BasicLimitInformation.LimitFlags : 0;
    const DWORD attributes = GetFileAttributesW(argv[2]);
    const DWORD fileError = attributes == INVALID_FILE_ATTRIBUTES ? GetLastError() : 0;
    wchar_t pattern[1024];
    swprintf(pattern, 1024, L"%ls\\*.archive", argv[3]);
    WIN32_FIND_DATAW found{};
    int archives = 0;
    HANDLE search = FindFirstFileW(pattern, &found);
    if (search != INVALID_HANDLE_VALUE)
    {
        do
        {
            ++archives;
        } while (FindNextFileW(search, &found));
        FindClose(search);
    }
    std::printf("{\"probe\":\"xfb_companion_probe\",\"pid\":%lu,\"in_job\":%s,\"limits_read\":%s,\"kill_on_close\":%s,\"active_process_limit\":%lu,"
                "\"memory_limit_mb\":%llu,\"file_seen\":%s,\"file_error\":%lu,\"folder_archives\":%d}\n",
                GetCurrentProcessId(), inJob ? "true" : "false", read ? "true" : "false",
                (flags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) ? "true" : "false",
                (flags & JOB_OBJECT_LIMIT_ACTIVE_PROCESS) ? limits.BasicLimitInformation.ActiveProcessLimit : 0ul,
                (flags & JOB_OBJECT_LIMIT_PROCESS_MEMORY) ? static_cast<unsigned long long>(limits.ProcessMemoryLimit / (1024 * 1024)) : 0ull,
                attributes != INVALID_FILE_ATTRIBUTES ? "true" : "false", fileError, archives);
    std::fflush(stdout);
    return 0;
}
