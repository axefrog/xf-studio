/**
 * Host adapter: whether a volume's folder timestamps can be trusted to show a changed mod setup (PIPE-58). The installation
 * registry notices added, removed and renamed files through their folder's modification time, which NTFS and ReFS update on every
 * such change. FAT32 and exFAT keep coarse times that some tools restore, and a network share may report the server's view late,
 * so on those a folder is stamped by its listing instead (source-discovery.ts `listingStamp`): slower to check, never fooled.
 *
 * Windows only (`GetVolumePathNameW`, `GetDriveTypeW`, `GetVolumeInformationW`; no process and no I/O on the volume's files). POSIX
 * file systems update a directory's time on every entry change, so elsewhere folder times are used. If the volume can't be
 * identified, its folders are stamped by their listing. The answer is kept per scan root and per volume (PIPE-77).
 */
export type FolderStampMode = "time" | "listing";

/** File systems whose folder times change whenever an entry is added, removed or renamed. */
const RELIABLE_FILE_SYSTEMS = new Set(["NTFS", "REFS"]);
const DRIVE_REMOTE = 4;
/** Scan roots remembered; a resolver scans a handful, so this only bounds a pathological caller. */
const MAX_REMEMBERED_ROOTS = 256;

/** The three volume queries, as a seam: null where the query fails. */
export interface VolumeApi {
  /** The volume mount point holding `path` (e.g. `C:\`), or null. */
  volumePath(path: string): string | null;
  /** `GetDriveTypeW` of a volume root (4: remote). */
  driveType(root: string): number;
  /** The volume's file system name (e.g. `NTFS`), or null. */
  fileSystem(root: string): string | null;
}

type Kernel = { symbols: {
  GetVolumePathNameW: (path: Buffer, out: Buffer, length: number) => number;
  GetDriveTypeW: (root: Buffer) => number;
  GetVolumeInformationW: (root: Buffer, name: null, nameLength: number, serial: null, maximum: null, flags: null, fileSystem: Buffer, fileSystemLength: number) => number;
} };
const wide = (text: string) => Buffer.from(`${text}\0`, "utf16le");
const readWide = (buffer: Buffer) => { const text = buffer.toString("utf16le"); const end = text.indexOf("\0"); return end < 0 ? text : text.slice(0, end); };

/** kernel32's volume queries through Bun's FFI; null when the library can't be loaded. */
export function kernel32VolumeApi(): VolumeApi | null {
  let kernel: Kernel;
  try {
    const { dlopen, FFIType } = import.meta.require("bun:ffi") as typeof import("bun:ffi");
    kernel = dlopen("kernel32.dll", {
      GetVolumePathNameW: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      GetDriveTypeW: { args: [FFIType.ptr], returns: FFIType.u32 },
      GetVolumeInformationW: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    }) as unknown as Kernel;
  } catch { return null; }
  return {
    volumePath: path => { const out = Buffer.alloc(1024); return kernel.symbols.GetVolumePathNameW(wide(path), out, out.length / 2) ? readWide(out) : null; },
    driveType: root => kernel.symbols.GetDriveTypeW(wide(root)),
    fileSystem: root => { const name = Buffer.alloc(128); return kernel.symbols.GetVolumeInformationW(wide(root), null, 0, null, null, null, name, name.length / 2) ? readWide(name) : null; },
  };
}

/**
 * A `folderStampMode` for one platform and volume API (test seams). The API is loaded on first use; a failure to load it,
 * or any failing query, means "listing". Answers are cached per scan root and per volume.
 */
export function createFolderStampMode(platform: string = process.platform, loadApi: () => VolumeApi | null = kernel32VolumeApi): (path: string) => FolderStampMode {
  let api: VolumeApi | null | undefined;
  const byRoot = new Map<string, FolderStampMode>(), byVolume = new Map<string, FolderStampMode>();
  const identify = (path: string): FolderStampMode => {
    if (api === undefined) { try { api = loadApi(); } catch { api = null; } }
    if (!api) return "listing";
    try {
      const volume = api.volumePath(path);
      if (!volume) return "listing";
      const known = byVolume.get(volume.toLowerCase());
      if (known) return known;
      let mode: FolderStampMode = "listing";
      if (api.driveType(volume) !== DRIVE_REMOTE) {
        const name = api.fileSystem(volume);
        if (name) mode = RELIABLE_FILE_SYSTEMS.has(name.toUpperCase()) ? "time" : "listing";
      }
      byVolume.set(volume.toLowerCase(), mode);
      return mode;
    } catch { return "listing"; }
  };
  return path => {
    if (platform !== "win32") return "time";
    const key = path.toLowerCase(), known = byRoot.get(key);
    if (known) return known;
    const mode = identify(path);
    if (byRoot.size >= MAX_REMEMBERED_ROOTS) byRoot.clear();
    byRoot.set(key, mode);
    return mode;
  };
}

/** How folders on the volume holding `path` are stamped. */
export const folderStampMode = createFolderStampMode();
