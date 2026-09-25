/**
 * Host adapter: whether a volume's folder timestamps can be trusted to show a changed mod setup (PIPE-58). The installation
 * registry notices added, removed and renamed files through their folder's modification time, which NTFS and ReFS update on every
 * such change. FAT32 and exFAT keep coarse times that some tools restore, and a network share may report the server's view late,
 * so on those a folder is stamped by its listing instead (source-discovery.ts `listingStamp`): slower to check, never fooled.
 *
 * Windows only (`GetVolumePathNameW`, `GetDriveTypeW`, `GetVolumeInformationW`; no process and no I/O on the volume's files). POSIX
 * file systems update a directory's time on every entry change, so elsewhere folder times are used. If the volume can't be
 * identified, its folders are stamped by their listing.
 */
export type FolderStampMode = "time" | "listing";

/** File systems whose folder times change whenever an entry is added, removed or renamed. */
const RELIABLE_FILE_SYSTEMS = new Set(["NTFS", "REFS"]);
const DRIVE_REMOTE = 4;
const byVolume = new Map<string, FolderStampMode>();
type Kernel = { symbols: {
  GetVolumePathNameW: (path: Buffer, out: Buffer, length: number) => number;
  GetDriveTypeW: (root: Buffer) => number;
  GetVolumeInformationW: (root: Buffer, name: null, nameLength: number, serial: null, maximum: null, flags: null, fileSystem: Buffer, fileSystemLength: number) => number;
} };
let kernel: Kernel | null | undefined;

function kernel32(): Kernel | null {
  if (kernel !== undefined) return kernel;
  try {
    const { dlopen, FFIType } = import.meta.require("bun:ffi") as typeof import("bun:ffi");
    kernel = dlopen("kernel32.dll", {
      GetVolumePathNameW: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      GetDriveTypeW: { args: [FFIType.ptr], returns: FFIType.u32 },
      GetVolumeInformationW: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    }) as unknown as Kernel;
  } catch { kernel = null; }
  return kernel;
}

const wide = (text: string) => Buffer.from(`${text}\0`, "utf16le");
const readWide = (buffer: Buffer) => { const text = buffer.toString("utf16le"); const end = text.indexOf("\0"); return end < 0 ? text : text.slice(0, end); };

/** How folders on the volume holding `path` are stamped. */
export function folderStampMode(path: string): FolderStampMode {
  if (process.platform !== "win32") return "time";
  const api = kernel32();
  if (!api) return "listing";
  try {
    const root = Buffer.alloc(1024);
    if (!api.symbols.GetVolumePathNameW(wide(path), root, root.length / 2)) return "listing";
    const volume = readWide(root);
    const known = byVolume.get(volume.toLowerCase());
    if (known) return known;
    let mode: FolderStampMode = "listing";
    if (api.symbols.GetDriveTypeW(wide(volume)) !== DRIVE_REMOTE) {
      const name = Buffer.alloc(128);
      if (api.symbols.GetVolumeInformationW(wide(volume), null, 0, null, null, null, name, name.length / 2))
        mode = RELIABLE_FILE_SYSTEMS.has(readWide(name).toUpperCase()) ? "time" : "listing";
    }
    byVolume.set(volume.toLowerCase(), mode);
    return mode;
  } catch { return "listing"; }
}
