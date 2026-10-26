/** Query-only process metadata, without a WMI/PowerShell startup on the panel's path.
 * Toolhelp layout matches mod-install-host.ts. CommandLineInformation (60) returns a
 * UNICODE_STRING in our buffer (Chromium GetCommandLineUsingProcessInformation).
 * Unsupported/denied queries contribute no lead; no remote memory reads or fallback process.
 */
import type { VortexDataFacts } from "../vortex-data";

export function readWindowsVortexProcesses(signal: AbortSignal, image = "vortex.exe", onlyPid?: number): NonNullable<VortexDataFacts["processes"]> {
  signal.throwIfAborted();
  if (process.platform !== "win32" || process.arch !== "x64") return [];
  try {
    const { dlopen, FFIType, ptr } = import.meta.require("bun:ffi") as typeof import("bun:ffi");
    const kernel = dlopen("kernel32.dll", {
      CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.i64 },
      Process32FirstW: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
      Process32NextW: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
      OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.i64 },
      QueryFullProcessImageNameW: { args: [FFIType.i64, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.i64], returns: FFIType.i32 },
    });
    try {
      const nt = dlopen("ntdll.dll", { NtQueryInformationProcess: {
        args: [FFIType.i64, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32,
      } });
      try {
        const snapshot = kernel.symbols.CreateToolhelp32Snapshot(2, 0);
        if (BigInt(snapshot) === -1n || BigInt(snapshot) === 0n) return [];
        try {
          const entry = Buffer.alloc(568), rows: { pid: number; executable: string; commandLine: string }[] = [];
          entry.writeUInt32LE(entry.length);
          let visited = 0;
          for (let more = kernel.symbols.Process32FirstW(snapshot, ptr(entry)); more && visited++ < 16384;
            more = kernel.symbols.Process32NextW(snapshot, ptr(entry))) {
            signal.throwIfAborted();
            if (entry.toString("utf16le", 44).split("\0", 1)[0]!.toLowerCase() !== image.toLowerCase()) continue;
            const pid = entry.readUInt32LE(8);
            if (onlyPid !== undefined && pid !== onlyPid) continue;
            const handle = kernel.symbols.OpenProcess(0x400 /* PROCESS_QUERY_INFORMATION */, 0, pid);
            if (BigInt(handle) === 0n) continue;
            try {
              const required = Buffer.alloc(4);
              nt.symbols.NtQueryInformationProcess(handle, 60, null, 0, ptr(required));
              const size = required.readUInt32LE();
              if (size < 16 || size > 128 * 1024) continue;
              const info = Buffer.alloc(size);
              if (nt.symbols.NtQueryInformationProcess(handle, 60, ptr(info), size, ptr(required)) < 0) continue;
              const length = info.readUInt16LE(), offset = Number(info.readBigUInt64LE(8) - BigInt(ptr(info)));
              if (length % 2 || offset < 16 || offset + length > size) continue;
              const commandLine = info.toString("utf16le", offset, offset + length);
              if (!commandLine || commandLine.includes("\0")) continue;
              const exe = Buffer.alloc(65536), chars = Buffer.alloc(4);
              chars.writeUInt32LE(exe.length / 2);
              if (!kernel.symbols.QueryFullProcessImageNameW(handle, 0, ptr(exe), ptr(chars))) continue;
              rows.push({ pid, executable: exe.toString("utf16le", 0, chars.readUInt32LE() * 2), commandLine });
            } finally { kernel.symbols.CloseHandle(handle); }
          }
          return rows.sort((a, b) => a.pid - b.pid).map(({ pid: _pid, ...row }) => row);
        } finally { kernel.symbols.CloseHandle(snapshot); }
      } finally { nt.close(); }
    } finally { kernel.close(); }
  } catch { signal.throwIfAborted(); return []; }
}
