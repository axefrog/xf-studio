"""Run a command under a memory guard (Windows).

Heavy work (full test suites, fuzzing, benches, real-data oracles, blow-up reproductions,
WolvenKit batches) runs inside a Windows Job Object, so every process it starts is tracked.
The guard polls the job's private memory and the machine's free memory, and kills the whole
tree when either line is crossed:

    python tools/memory_guard.py --limit 6 -- bun test
    python tools/memory_guard.py --limit 2 --floor 20 -- bun tools/native-limits.ts

--limit   GB of private memory the command's processes may use together (default 8).
--floor   GB of free physical memory the machine must keep (default 16).

The job also carries a hard commit limit (limit x 1.25) that the operating system enforces,
in case polling is too slow for a sudden allocation, and kill-on-close, so the tree dies with
the guard. A kill exits with code 99 and a plain message; each kill is appended to
local/memory-guard.log. A clean run ends with one line giving the peak, to size the next limit. Raising the limit to get past a kill is not the fix: shrink the work.
"""

from __future__ import annotations

import argparse
import ctypes
import subprocess
import sys
import time
from ctypes import wintypes
from datetime import datetime
from pathlib import Path

KILLED_EXIT = 99
GB = 1024**3

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
psapi = ctypes.WinDLL("psapi", use_last_error=True)
ntdll = ctypes.WinDLL("ntdll")


class IO_COUNTERS(ctypes.Structure):
    _fields_ = [(n, ctypes.c_ulonglong) for n in (
        "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
        "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]


class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_longlong),
        ("PerJobUserTimeLimit", ctypes.c_longlong),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD),
    ]


class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
        ("IoInfo", IO_COUNTERS),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
    ]


class MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ("dwLength", wintypes.DWORD),
        ("dwMemoryLoad", wintypes.DWORD),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


JobObjectBasicProcessIdList = 3
JobObjectExtendedLimitInformation = 9
JOB_OBJECT_LIMIT_JOB_MEMORY = 0x200
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
CREATE_SUSPENDED = 0x4
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

kernel32.CreateJobObjectW.restype = wintypes.HANDLE
kernel32.OpenProcess.restype = wintypes.HANDLE


def free_physical() -> int:
    status = MEMORYSTATUSEX()
    status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
    kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
    return status.ullAvailPhys


def create_job(hard_limit: int) -> wintypes.HANDLE:
    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        raise OSError(ctypes.get_last_error(), "CreateJobObject failed")
    info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    info.JobMemoryLimit = hard_limit
    if not kernel32.SetInformationJobObject(job, JobObjectExtendedLimitInformation, ctypes.byref(info),
                                            ctypes.sizeof(info)):
        raise OSError(ctypes.get_last_error(), "SetInformationJobObject failed")
    return job


def job_pids(job) -> list[int]:
    count = 1024
    while True:
        class LIST(ctypes.Structure):
            _fields_ = [("Assigned", wintypes.DWORD), ("InList", wintypes.DWORD),
                        ("Ids", ctypes.c_size_t * count)]
        data = LIST()
        ok = kernel32.QueryInformationJobObject(job, JobObjectBasicProcessIdList, ctypes.byref(data),
                                                ctypes.sizeof(data), None)
        if ok or data.Assigned <= count:
            return [data.Ids[i] for i in range(data.InList)]
        count = data.Assigned + 64


def private_bytes(pid: int) -> int:
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return 0
    try:
        counters = PROCESS_MEMORY_COUNTERS_EX()
        counters.cb = ctypes.sizeof(counters)
        if psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            return counters.PrivateUsage
        return 0
    finally:
        kernel32.CloseHandle(handle)


def peak_job_memory(job) -> int:
    info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    kernel32.QueryInformationJobObject(job, JobObjectExtendedLimitInformation, ctypes.byref(info),
                                       ctypes.sizeof(info), None)
    return info.PeakJobMemoryUsed


def record(line: str) -> None:
    log = Path(__file__).resolve().parent.parent / "local" / "memory-guard.log"
    try:
        log.parent.mkdir(exist_ok=True)
        with log.open("a", encoding="utf-8") as out:
            out.write(f"{datetime.now().isoformat(timespec='seconds')} {line}\n")
    except OSError:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--limit", type=float, default=8.0, help="GB the command's processes may use together")
    parser.add_argument("--floor", type=float, default=16.0, help="GB of free physical memory to keep")
    parser.add_argument("--interval", type=float, default=0.5, help="seconds between checks")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("give the command after --")
    limit, floor = int(args.limit * GB), int(args.floor * GB)

    if free_physical() < floor:
        print(f"MEMORY GUARD: not starting; only {free_physical() / GB:.1f} GB free, below the {args.floor:g} GB "
              "floor. Wait for other work to finish.", file=sys.stderr)
        return KILLED_EXIT

    job = create_job(int(limit * 1.25))
    # Started suspended and resumed only once it is in the job, so no child escapes the job.
    proc = subprocess.Popen(command, creationflags=CREATE_SUSPENDED, shell=False)
    if not kernel32.AssignProcessToJobObject(job, wintypes.HANDLE(int(proc._handle))):
        proc.kill()
        raise OSError(ctypes.get_last_error(), "AssignProcessToJobObject failed")
    ntdll.NtResumeProcess(wintypes.HANDLE(int(proc._handle)))

    peak = 0
    reason = ""
    try:
        while proc.poll() is None:
            used = sum(private_bytes(pid) for pid in job_pids(job))
            peak = max(peak, used)
            free = free_physical()
            if used > limit:
                reason = f"its processes used {used / GB:.1f} GB (limit {args.limit:g} GB)"
            elif free < floor:
                reason = (f"the machine's free memory fell to {free / GB:.1f} GB (floor {args.floor:g} GB) "
                          f"while it held {used / GB:.1f} GB")
            if reason:
                kernel32.TerminateJobObject(job, KILLED_EXIT)
                proc.wait()
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        kernel32.TerminateJobObject(job, 130)
        proc.wait()
        return 130

    hard_hit = not reason and proc.returncode != 0 and peak_job_memory(job) >= int(limit * 1.25) * 0.98
    if hard_hit:
        reason = f"it hit the hard memory cap of {args.limit * 1.25:g} GB and failed to allocate"
    kernel32.CloseHandle(job)
    if reason:
        shown = " ".join(command)
        print("\n" + "=" * 78 + f"\nMEMORY GUARD: killed `{shown}` because {reason}.\n"
              "That was careless: this machine is shared with other work, and running it out of memory\n"
              "freezes everything. Scale the work down (smaller inputs, bounded batches, fewer workers,\n"
              "streaming instead of holding everything) before running it again. Raising --limit to get\n"
              "past this is not the fix; if a larger limit is genuinely needed, say so in your report.\n"
              + "=" * 78, file=sys.stderr)
        record(f"killed ({reason}): {shown}")
        return KILLED_EXIT
    print(f"memory guard: peak {peak / GB:.1f} GB of {args.limit:g} GB", file=sys.stderr)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
