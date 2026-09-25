import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractZip, readZip, safeEntryName, ZipError } from "../src/zip-extract";
import { makeZip } from "./zip-fixture";

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = mkdtempSync(join(tmpdir(), "xfs-zip-")); roots.push(root); return root; };
const limits = { maxEntries: 100, maxTotalBytes: 1_000_000 };

test("stored and deflated entries extract with their folders, sizes and hashes", () => {
  const destination = join(temporary(), "out");
  const entries = extractZip(makeZip([{ name: "lib/" }, { name: "lib/a.dll", data: "A".repeat(5000) },
    { name: "Tool.exe", data: "MZ tool", method: 0 }]), destination, limits);
  expect(entries.map(entry => [entry.name, entry.bytes])).toEqual([["lib/a.dll", 5000], ["Tool.exe", 7]]);
  expect(readFileSync(join(destination, "lib", "a.dll"), "utf8")).toBe("A".repeat(5000));
  expect(entries[1]!.sha256).toMatch(/^[0-9a-f]{64}$/);
  // Never overwrites.
  expect(() => extractZip(makeZip([{ name: "Tool.exe", data: "other" }]), destination, limits)).toThrow();
});

test("unsafe names, links, encryption, duplicates, bad checksums and oversize archives are refused before writing", () => {
  for (const name of ["../escape.dll", "/abs.dll", "C:/win.dll", "a/../../b", "a\\..\\b", "dir/./x", "bad:name", "trailing. "])
    expect(safeEntryName(name)).toBeNull();
  expect(safeEntryName("lib\\ok.dll")).toBe("lib/ok.dll");
  const refuse = (zip: Buffer, message: RegExp | string, custom = limits) => {
    const destination = join(temporary(), "out");
    expect(() => extractZip(zip, destination, custom)).toThrow(message);
    expect(existsSync(destination)).toBe(false);
  };
  refuse(makeZip([{ name: "ok.dll", data: "x" }, { name: "../evil.dll", data: "x" }]), "unsafe file name");
  refuse(makeZip([{ name: "link", data: "target", madeBy: 3, external: (0o120777 << 16) >>> 0 }]), "link");
  refuse(makeZip([{ name: "secret.dll", data: "x", flags: 0x801 }]), "Encrypted");
  refuse(makeZip([{ name: "A.dll", data: "x" }, { name: "a.DLL", data: "y" }]), "twice");
  refuse(makeZip([{ name: "a.dll", data: "hello", badCrc: true }]), "checksum");
  refuse(makeZip([{ name: "big.bin", data: "x".repeat(2000) }]), "allowed size", { maxEntries: 10, maxTotalBytes: 1000 });
  refuse(makeZip([{ name: "a" , data: "1" }, { name: "b", data: "2" }]), "too many entries", { maxEntries: 1, maxTotalBytes: 1000 });
  expect(() => readZip(Buffer.from("not a zip at all"), limits)).toThrow(ZipError);
  // A truncated archive (download cut short) is refused too.
  const whole = makeZip([{ name: "a.dll", data: "z".repeat(3000) }]);
  expect(() => readZip(whole.subarray(0, whole.length - 30), limits)).toThrow(ZipError);
});
