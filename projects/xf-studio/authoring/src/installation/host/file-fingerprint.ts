import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { createHash } from "node:crypto";

/** Receipt fingerprint v1: size and at most 64 KiB at either end. Not a substitute for full-file verification. */
export function fileFingerprint(path: string): string {
  const fd = openSync(path, "r");
  try {
    const before = fstatSync(fd), size = before.size, chunk = 64 * 1024;
    const hash = createHash("sha256").update(`xfs/file-ends-1:${size}:`);
    const read = (offset: number, length: number) => {
      const bytes = Buffer.allocUnsafe(length);
      let done = 0;
      while (done < length) {
        const count = readSync(fd, bytes, done, length - done, offset + done);
        if (!count) throw Error("File changed while fingerprinting.");
        done += count;
      }
      hash.update(bytes);
    };
    read(0, Math.min(size, chunk));
    if (size > chunk) read(Math.max(chunk, size - chunk), Math.min(chunk, size - chunk));
    const after = fstatSync(fd);
    if (after.size !== size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
      throw Error("File changed while fingerprinting.");
    return `ends-1:${hash.digest("hex")}`;
  } finally { closeSync(fd); }
}
