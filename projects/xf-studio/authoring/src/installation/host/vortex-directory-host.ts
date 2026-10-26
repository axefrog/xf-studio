/** Win32 search handles return one WIN32_FIND_DATAW at a time. Bun's opendir/read
 * materialises readdir internally, so it cannot enforce our enumeration budget. */
import { join } from "node:path";

export type VortexDirectoryEntry = { name: string; isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean };
export type VortexDirectoryReader = { read(): Promise<VortexDirectoryEntry | null>; close(): Promise<void> };
/** Counters are advanced at the native boundary, including dot entries, before filtering. */
export type VortexDirectoryStats = { materialised: number; searchesOpened: number; searchesClosed: number };

export async function openWindowsVortexDirectory(path: string, stats?: VortexDirectoryStats): Promise<VortexDirectoryReader> {
  if (process.platform !== "win32" || process.arch !== "x64") throw Error("Native Windows directory searches are unavailable.");
  const { dlopen, FFIType, ptr } = import.meta.require("bun:ffi") as typeof import("bun:ffi");
  const kernel = dlopen("kernel32.dll", {
    FindFirstFileW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i64 },
    FindNextFileW: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
    FindClose: { args: [FFIType.i64], returns: FFIType.i32 },
  });
  const data = Buffer.alloc(592), pattern = Buffer.from(join(path, "*") + "\0", "utf16le");
  let handle: number | bigint | undefined, closed = false, first = true;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (handle !== undefined && BigInt(handle) !== -1n) {
      kernel.symbols.FindClose(handle);
      if (stats) stats.searchesClosed++;
    }
    kernel.close();
  };
  // Defer FindFirst too: opening a reader must not fetch an entry before read().
  return { close, read: async () => {
    if (closed) return null;
    try {
      if (first) {
        first = false;
        handle = kernel.symbols.FindFirstFileW(ptr(pattern), ptr(data));
        if (BigInt(handle) === -1n) { await close(); return null; }
        if (stats) stats.searchesOpened++;
      } else if (!kernel.symbols.FindNextFileW(handle!, ptr(data))) { await close(); return null; }
      if (stats) stats.materialised++;
      const attributes = data.readUInt32LE(), name = data.toString("utf16le", 44, 564).split("\0", 1)[0]!;
      return { name, isSymbolicLink: () => !!(attributes & 0x400), isDirectory: () => !!(attributes & 0x10),
        isFile: () => !(attributes & (0x10 | 0x400)) };
    } catch (error) { await close(); throw error; }
  } };
}
