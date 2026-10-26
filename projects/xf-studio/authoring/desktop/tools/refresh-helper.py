"""The one unpackaged helper of tools/refresh-installed.ps1: everything that touches the installed app happens here.

    pythonw.exe refresh-helper.py <config.json>

It runs as a process of Windows Management Instrumentation, not inside the Claude app's Store package (whose private AppData would
swallow an install, and would hide the real %LOCALAPPDATA% from anything the script itself read), and with no console window. It
writes one JSON result (config "result") and exits; nothing else is left behind.

In order:
 1. Takes the app's own single-instance mutex (config "mutex", computed by tools/installed-instance-name.ts from single-instance.ts,
    so the two can't drift). Held by someone else means XF Studio is running: result "pending", nothing touched. Held here until
    the helper exits, a normal launch meanwhile finds the lock taken and ends quietly (single-instance.ts).
 2. Config "skipIfCurrent" and the install already complete for this build: result "installed", nothing run.
 3. Puts itself in a Job Object that kills everything in it when it closes, then starts the setup (/VERYSILENT ...) with
    XFS_INSTALL_REFRESH=1. The setup, the app it opens at its end (which that variable makes exit at once) and anything they start are
    in the job, so when this process ends, on any path, none of them is left running.
 4. Waits for the setup (config "timeoutSec"), then checks the install is complete: every file of the built update archive is in the
    app folder with the listed size, version.json names the built hash, bin/launcher.exe exists and Electrobun's uninstall entry exists.
    Anything less is "failed", never "installed".

Result: {"outcome": "installed" | "pending" | "failed", "reason": str, "current": bool, "setupExit": int | null, "problems": [str]}.
Standard library only; Windows only.
"""
import json
import os
import re
import subprocess
import sys

CREATE_NO_WINDOW = 0x08000000
WAIT_OBJECT_0, WAIT_ABANDONED, WAIT_TIMEOUT = 0, 0x80, 0x102
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
MAX_PROBLEMS = 8

# `tar -tvf` (Windows' bsdtar): "-rw-rw-rw-  0 0      0        6674 Oct 26 13:12 XFStudio-canary/Resources/app.ico"
_LISTING_LINE = re.compile(r"^(?P<kind>[-dl])\S*\s+\d+\s+\S+\s+\S+\s+(?P<size>\d+)\s+\w{3}\s+\d+\s+[\d:]+\s+(?P<path>.+?)\s*$")


def parse_listing(text):
    """{relative path: size} for the files of an update archive listing. The archive's one top folder is the app folder's content."""
    files = {}
    for line in text.splitlines():
        match = _LISTING_LINE.match(line)
        if not match or match["kind"] != "-":
            continue
        parts = match["path"].split("/", 1)
        if len(parts) == 2 and parts[1]:
            files[parts[1]] = int(match["size"])
    return files


def check_complete(listing, app_dir, build_hash, has_uninstall_entry):
    """What is missing or wrong in the installed app folder, as plain lines; empty when the install is complete."""
    problems = []
    if not listing:
        return ["the build's update archive lists no files"]
    for relative, size in sorted(listing.items()):
        path = os.path.join(app_dir, *relative.split("/"))
        try:
            found = os.path.getsize(path)
        except OSError:
            problems.append(f"missing: {relative}")
            continue
        if found != size:
            problems.append(f"wrong size: {relative} ({found} bytes, expected {size})")
    try:
        with open(os.path.join(app_dir, "Resources", "version.json"), encoding="utf-8-sig") as handle:
            installed = json.load(handle).get("hash")
        if installed != build_hash:
            problems.append(f"version.json names build {installed}, not {build_hash}")
    except (OSError, ValueError):
        problems.append("version.json can't be read")
    if not os.path.isfile(os.path.join(app_dir, "bin", "launcher.exe")):
        problems.append("missing: bin/launcher.exe")
    if not has_uninstall_entry:
        problems.append("Electrobun's uninstall entry is missing")
    return problems


def _summary(problems):
    shown = "; ".join(problems[:MAX_PROBLEMS])
    return shown + (f"; and {len(problems) - MAX_PROBLEMS} more" if len(problems) > MAX_PROBLEMS else "")


def write_result(path, result):
    temporary = f"{path}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(result, handle)
    os.replace(temporary, path)


def _outcome(outcome, reason, current=False, setup_exit=None, problems=()):
    return {"outcome": outcome, "reason": reason, "current": current, "setupExit": setup_exit, "problems": list(problems)}


def _kernel32():
    import ctypes
    from ctypes import wintypes
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.CreateMutexW.argtypes, k.CreateMutexW.restype = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR], wintypes.HANDLE
    k.WaitForSingleObject.argtypes, k.WaitForSingleObject.restype = [wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD
    k.CreateJobObjectW.argtypes, k.CreateJobObjectW.restype = [wintypes.LPVOID, wintypes.LPCWSTR], wintypes.HANDLE
    k.SetInformationJobObject.argtypes, k.SetInformationJobObject.restype = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD], wintypes.BOOL
    k.AssignProcessToJobObject.argtypes, k.AssignProcessToJobObject.restype = [wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL
    k.GetCurrentProcess.argtypes, k.GetCurrentProcess.restype = [], wintypes.HANDLE
    return ctypes, wintypes, k


def acquire_mutex(name):
    """The handle (kept open for this process's life: closing it would release the mutex), or None when another process owns it."""
    _, _, k = _kernel32()
    handle = k.CreateMutexW(None, False, name)
    if not handle:
        raise OSError("the single-instance mutex couldn't be created")
    result = k.WaitForSingleObject(handle, 0)
    if result in (WAIT_OBJECT_0, WAIT_ABANDONED):
        return handle
    if result == WAIT_TIMEOUT:
        return None
    raise OSError(f"waiting on the single-instance mutex failed ({result})")


def join_kill_on_close_job():
    """Puts this process in a new Job Object that kills every process in it when its last handle closes (when this process ends)."""
    ctypes, wintypes, k = _kernel32()

    class Basic(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64), ("LimitFlags", wintypes.DWORD),
                    ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class Counters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ("ReadOps", "WriteOps", "OtherOps", "ReadBytes", "WriteBytes", "OtherBytes")]

    class Extended(ctypes.Structure):
        _fields_ = [("Basic", Basic), ("Io", Counters), ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    job = k.CreateJobObjectW(None, None)
    info = Extended()
    info.Basic.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    # 9 = JobObjectExtendedLimitInformation
    if not job or not k.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)) or \
            not k.AssignProcessToJobObject(job, k.GetCurrentProcess()):
        raise OSError(f"the helper couldn't put itself in a job object (error {ctypes.get_last_error()})")
    return job


def archive_listing(archive):
    tar = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "tar.exe")
    run = subprocess.run([tar, "-tvf", archive], capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=CREATE_NO_WINDOW)
    if run.returncode != 0:
        raise OSError(f"tar couldn't list the update archive ({run.returncode})")
    return run.stdout


def uninstall_entry_exists(key):
    import winreg
    try:
        winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CURRENT_USER, key))
        return True
    except OSError:
        return False


def run(config):
    """The whole refresh for one config; returns the result (it never touches the installed app unless the mutex was won)."""
    expected = os.path.normcase(os.path.normpath(config["localAppData"]))
    if os.path.normcase(os.path.normpath(os.environ.get("LOCALAPPDATA", ""))) != expected:
        return _outcome("failed", "the helper's LOCALAPPDATA isn't the one the instance lock name was computed for")
    if acquire_mutex(config["mutex"]) is None:
        return _outcome("pending", "XF Studio is running")
    if "listingFile" in config:
        with open(config["listingFile"], encoding="utf-8") as handle:
            text = handle.read()
    else:
        text = archive_listing(config["archive"])
    listing = parse_listing(text)
    app_dir, build_hash, key = config["appDir"], config["hash"], config["uninstallKey"]
    if config.get("skipIfCurrent") and not check_complete(listing, app_dir, build_hash, uninstall_entry_exists(key)):
        return _outcome("installed", "the installed app is already this build", current=True)
    join_kill_on_close_job()
    environment = dict(os.environ, XFS_INSTALL_REFRESH="1")
    setup = subprocess.Popen(config["setup"], env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW)
    try:
        code = setup.wait(timeout=config.get("timeoutSec", 300))
    except subprocess.TimeoutExpired:
        return _outcome("failed", f"the setup did not finish within {config.get('timeoutSec', 300)} s and was stopped")
    if code != 0:
        return _outcome("failed", f"the setup exited with code {code}", setup_exit=code)
    problems = check_complete(listing, app_dir, build_hash, uninstall_entry_exists(key))
    if problems:
        return _outcome("failed", f"the install is incomplete: {_summary(problems)}", setup_exit=code, problems=problems)
    return _outcome("installed", "installed", setup_exit=code)


def main(argv):
    with open(argv[1], encoding="utf-8-sig") as handle:
        config = json.load(handle)
    try:
        result = run(config)
    except Exception as error:  # the script reads a result however this ends
        result = _outcome("failed", f"the helper stopped: {error}")
    write_result(config["result"], result)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
