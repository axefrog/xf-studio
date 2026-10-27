import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

// Logical .json paths remain usable for earlier runs and archived .json.gz records.
export function readRunRecord<T = unknown>(path: string | URL): T {
  let file = path;
  if (!existsSync(file) && String(file).endsWith('.json')) {
    file = file instanceof URL ? new URL(file.href + '.gz') : file + '.gz';
  }
  const bytes = readFileSync(file);
  return JSON.parse((String(file).endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8')) as T;
}

