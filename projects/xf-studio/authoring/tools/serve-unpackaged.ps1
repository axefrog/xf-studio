# Starts the localhost server outside the launching app's container, so it reads and writes the real
# %LOCALAPPDATA%\XF Studio (settings, and the install receipts it shares with the desktop app).
#
# A packaged desktop app (the Claude app, for one) redirects its child processes' AppData writes into a private copy. A
# server started directly from it would keep its own settings and receipts, which the desktop app and every other launch
# can't see. A process created through WMI belongs to no container, so its writes land where they should.
#
# Lifetime: the server is created suspended and put in a job object that kills everything in it when its last handle
# closes. This script holds that handle, so stopping this script (even killing it outright) ends the server. This script in
# turn ends, with the server's exit code, when the server does. Its output is mirrored from a log of its own.
param([string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path, [int]$Port = 4317)
$ErrorActionPreference = "Stop"

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  [Console]::Error.WriteLine("XF Studio is already running on port $Port. Stop it first, or open http://127.0.0.1:$Port/.")
  exit 1
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class XfsJob {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long a, b; public uint Flags; public UIntPtr c, d; public uint e; public UIntPtr f; public uint g, h; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr a, b, c, d; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits info, int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] public static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("ntdll.dll")] static extern int NtResumeProcess(IntPtr process);
  public static IntPtr Adopt(int pid) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (!SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(ExtendedLimits)))) throw new System.ComponentModel.Win32Exception();
    IntPtr process = OpenProcess(0x1F0FFF, false, pid); // PROCESS_ALL_ACCESS
    if (process == IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    if (!AssignProcessToJobObject(job, process)) throw new System.ComponentModel.Win32Exception();
    if (NtResumeProcess(process) != 0) throw new InvalidOperationException("Couldn't resume the server process.");
    return process; // the job handle stays open, unreferenced, until this PowerShell process ends
  }
}
"@

$scratch = Join-Path $env:USERPROFILE "xfs-scratch"
New-Item -ItemType Directory -Force $scratch | Out-Null
$log = Join-Path $scratch "studio-server-$PID.log"
Set-Content -Path $log -Value "" -Encoding utf8
# Paths reach cmd through variables expanded once, with delayed expansion off, so nothing in them is expanded again.
$environment = [string[]](@([System.Environment]::GetEnvironmentVariables().GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) +
  "XFS_SERVE_BUN=$((Get-Command bun).Source)" + "XFS_SERVE_LOG=$log")
$command = 'cmd.exe /d /v:off /c ""%XFS_SERVE_BUN%" server.ts >> "%XFS_SERVE_LOG%" 2>&1"'
# CREATE_SUSPENDED (4) until it is in the job, so nothing it starts escapes; CREATE_UNICODE_ENVIRONMENT (1024).
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; CreateFlags = [uint32]1028; EnvironmentVariables = $environment }
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $command; CurrentDirectory = $Root; ProcessStartupInformation = $startup }
if ($result.ReturnValue -ne 0) { throw "Couldn't start the server (Win32_Process.Create returned $($result.ReturnValue))." }
$server = [XfsJob]::Adopt([int]$result.ProcessId)

# Mirror the log until the server ends, then end with its exit code.
$reader = [System.IO.StreamReader]::new([System.IO.FileStream]::new($log, "Open", "Read", "ReadWrite"))
try {
  while ($true) {
    $done = [XfsJob]::WaitForSingleObject($server, 250) -eq 0
    while ($null -ne ($line = $reader.ReadLine())) { [Console]::Out.WriteLine($line) }
    [Console]::Out.Flush()
    if ($done) { break }
  }
} finally { $reader.Dispose() }
$code = [uint32]0; [void][XfsJob]::GetExitCodeProcess($server, [ref]$code)
Remove-Item $log -ErrorAction SilentlyContinue
[Console]::Error.WriteLine("XF Studio's server stopped (exit code $code).")
exit [int]$code
