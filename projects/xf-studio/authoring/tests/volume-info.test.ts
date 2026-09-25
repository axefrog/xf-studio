import { expect, test } from "bun:test";
import { createFolderStampMode, folderStampMode, type VolumeApi } from "../src/volume-info";

/** A volume API over a table of volumes, counting its queries. */
function fakeApi(volumes: Record<string, { type: number; fs: string | null }>, calls = { volumePath: 0, fileSystem: 0 }): VolumeApi {
  return {
    volumePath: path => { calls.volumePath++; const root = Object.keys(volumes).find(v => path.toLowerCase().startsWith(v.toLowerCase())); return root ?? null; },
    driveType: root => volumes[root].type,
    fileSystem: root => { calls.fileSystem++; return volumes[root].fs; },
  };
}

test("outside Windows folder times are used and no volume API is loaded", () => {
  let loaded = 0;
  const mode = createFolderStampMode("linux", () => { loaded++; throw Error("no kernel32 here"); });
  expect(mode("/home/user/mods")).toBe("time");
  expect(mode("")).toBe("time");
  expect(loaded).toBe(0);
});

test("when kernel32 can't be loaded, or a query fails, folders are stamped by their listing", () => {
  expect(createFolderStampMode("win32", () => null)("C:\\Games")).toBe("listing");
  expect(createFolderStampMode("win32", () => { throw Error("dlopen failed"); })("C:\\Games")).toBe("listing");
  const throwing: VolumeApi = { volumePath: () => { throw Error("bad path"); }, driveType: () => 3, fileSystem: () => "NTFS" };
  expect(createFolderStampMode("win32", () => throwing)("C:\\Games")).toBe("listing");
  // Unknown volume, unnamed file system and a network share: listing.
  const api = fakeApi({ "D:\\": { type: 3, fs: null }, "\\\\server\\share\\": { type: 4, fs: "NTFS" } });
  const mode = createFolderStampMode("win32", () => api);
  expect(mode("Q:\\nothing")).toBe("listing");
  expect(mode("D:\\Mods")).toBe("listing");
  expect(mode("\\\\server\\share\\Mods")).toBe("listing");
});

test("NTFS and ReFS use folder times, FAT and exFAT their listing; answers are kept per scan root and per volume", () => {
  const calls = { volumePath: 0, fileSystem: 0 };
  const api = fakeApi({ "C:\\": { type: 3, fs: "NTFS" }, "E:\\": { type: 3, fs: "ReFS" }, "F:\\": { type: 2, fs: "exFAT" }, "G:\\": { type: 3, fs: "FAT32" } }, calls);
  let loaded = 0;
  const mode = createFolderStampMode("win32", () => { loaded++; return api; });
  expect(["C:\\Games", "E:\\Mods", "F:\\Mods", "G:\\Mods"].map(mode)).toEqual(["time", "time", "listing", "listing"]);
  expect(loaded).toBe(1);
  // The same root again asks nothing; another root on a known volume asks only for its volume path.
  const before = { ...calls };
  expect(mode("C:\\Games")).toBe("time");
  expect(mode("c:\\games")).toBe("time");
  expect(calls).toEqual(before);
  expect(mode("C:\\Other")).toBe("time");
  expect(calls).toEqual({ volumePath: before.volumePath + 1, fileSystem: before.fileSystem });
});

test("the host's own system drive is NTFS: C:\\ uses folder times", () => {
  // On Windows this asks kernel32; elsewhere folder times are used anyway.
  expect(folderStampMode("C:\\")).toBe("time");
});
