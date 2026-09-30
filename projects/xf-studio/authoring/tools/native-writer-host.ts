/**
 * The native writer's `WriterHost` over the file system and the process clock, for the Build's CLI and the writer's tests
 * (src/native-resource-tools.ts takes its files and clock through this port).
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { WriterHost } from "../src/native-resource-tools";
import { fileTimeOf } from "../src/native/write/rdar-writer";

export const nodeWriterHost: WriterHost = {
  list: folder => readdirSync(folder, { withFileTypes: true }).map(entry => ({ name: entry.name, folder: entry.isDirectory(), link: entry.isSymbolicLink() })),
  read: path => new Uint8Array(readFileSync(path)),
  write: (path, bytes) => writeFileSync(path, bytes),
  copy: (from, to) => copyFileSync(from, to),
  makeFolder: path => { mkdirSync(path, { recursive: true }); },
  remove: path => rmSync(path, { recursive: true, force: true }),
  fileTime: path => fileTimeOf(statSync(path, { bigint: true }).mtimeNs),
  isFile: path => { try { return statSync(path).isFile(); } catch { return false; } },
  now: () => performance.now(),
};
