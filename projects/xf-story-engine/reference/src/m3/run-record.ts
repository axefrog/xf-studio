import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

// Logical .json paths remain usable for earlier runs and archived .json.gz records.
export function readRunRecord<T = unknown>(path: string | URL): T {
  let file = path;
  if (!existsSync(file) && String(file).endsWith('.json')) {
    file = file instanceof URL ? new URL(file.href + '.gz') : file + '.gz';
  }
  const bytes = readFileSync(file);
  return JSON.parse((String(file).endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as T;
}


// Archived run records are gzip with a fixed header: zlib writes the host OS into
// byte 9 (10 on Windows, 3 on Unix), so it is pinned to 255 ("unknown") to keep
// the bytes identical on every platform.
export function encodeRunRecord(record: unknown): Buffer {
  const bytes = gzipSync(JSON.stringify(record));
  bytes[9] = 255;
  return bytes;
}
