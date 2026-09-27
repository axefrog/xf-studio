/**
 * Host adapter for choice previews (choice-previews-design.md §6.2–6.4): the store of rendered channel images and the index of preview
 * sources, both in the host's private derived cache (never committed, published or packaged).
 *
 * - **Store.** `<root>/images/<key>.webp`, content-addressed by the preview key (choice-preview.ts): stills and turntable strips alike. Only WebP files within
 *   `PREVIEW_IMAGE_MAX_BYTES` are kept. "Clear prepared game files" removes them with the rest, and the prepared files' budget evicts
 *   the least recently used (prepared-files.ts, PREV-157): serving or keeping an image or a source marks it used, which also keeps it
 *   for the rest of the session.
 * - **Source index.** A prepared choice's source (the parts its record draws for the row's detail), by the choice's manifest name
 *   (choice-manifest.ts `choiceKey`), stamped with that manifest's size and time: a choice prepared again (a mod updated, another archive
 *   wins) has a new manifest, so its old source is never reused. A choice whose slot draws nothing is indexed as `null` (no preview).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { type ChoicePreviewSource, isPreviewKey, parsePreviewSource } from "./choice-preview";
import { writeFileAtomic } from "./derived-cache";
import { touchUsed } from "./game-asset-export";

/** The largest preview image kept (a 256² channel image is a few kilobytes; a 24-frame turntable strip a few hundred). */
export const PREVIEW_IMAGE_MAX_BYTES = 1024 * 1024;
const isWebp = (bytes: Uint8Array) => bytes.byteLength >= 16 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
const MANIFEST_KEY = /^[a-f0-9]{40}$/;

export class ChoicePreviewStore {
  private readonly memory = new Map<string, { stamp: string; source: ChoicePreviewSource | null }>();
  constructor(readonly root: string) {}
  private get images() { return join(this.root, "images"); }
  private get sources() { return join(this.root, "sources"); }

  imagePath(key: string): string | null {
    if (!isPreviewKey(key)) return null;
    const path = join(this.images, `${key}.webp`);
    if (!existsSync(path)) return null;
    touchUsed(path);
    return path;
  }
  /** Keep a rendered image under its key; refuses anything but a WebP within the limit. */
  putImage(key: string, bytes: Uint8Array): boolean {
    if (!isPreviewKey(key) || bytes.byteLength > PREVIEW_IMAGE_MAX_BYTES || !isWebp(bytes)) return false;
    mkdirSync(this.images, { recursive: true, mode: 0o700 });
    const path = join(this.images, `${key}.webp`);
    writeFileAtomic(path, bytes);
    touchUsed(path);
    return true;
  }

  /** A choice's indexed source (`null`: its slot draws nothing), or undefined when unknown or stale for `stamp`. */
  source(manifestKey: string, stamp: string): ChoicePreviewSource | null | undefined {
    if (!MANIFEST_KEY.test(manifestKey)) return undefined;
    const known = this.memory.get(manifestKey);
    if (known) return known.stamp === stamp ? known.source : undefined;
    try {
      const path = join(this.sources, `${manifestKey}.json`);
      const entry = JSON.parse(readFileSync(path, "utf8")) as { stamp?: unknown; source?: unknown };
      if (entry.stamp !== stamp) return undefined;
      touchUsed(path);
      const source = entry.source === null ? null : parsePreviewSource(entry.source);
      this.memory.set(manifestKey, { stamp, source });
      return source;
    } catch { return undefined; }
  }
  setSource(manifestKey: string, stamp: string, source: ChoicePreviewSource | null): void {
    if (!MANIFEST_KEY.test(manifestKey)) return;
    this.memory.set(manifestKey, { stamp, source });
    if (this.memory.size > 4096) this.memory.delete(this.memory.keys().next().value!);
    try {
      mkdirSync(this.sources, { recursive: true, mode: 0o700 });
      const path = join(this.sources, `${manifestKey}.json`);
      writeFileAtomic(path, JSON.stringify({ stamp, source }));
      touchUsed(path);
    }
    catch { /* Advisory: the source is derived again next time. */ }
  }

  /** Bytes on disk (images and sources). */
  bytes(): number {
    let total = 0;
    for (const dir of [this.images, this.sources]) {
      let names: string[] = [];
      try { names = readdirSync(dir); } catch { continue; }
      for (const name of names) { try { total += statSync(join(dir, name)).size; } catch { /* Gone meanwhile. */ } }
    }
    return total;
  }
  clear(): { freed: number } {
    const freed = this.bytes();
    this.memory.clear();
    rmSync(this.images, { recursive: true, force: true });
    rmSync(this.sources, { recursive: true, force: true });
    return { freed };
  }
}

/** A manifest file's stamp (size and modification time), or null when there is none. */
export function manifestStamp(dir: string, key: string): string | null {
  try { const stat = statSync(join(dir, `${key}.json`)); return `${stat.size}:${Math.trunc(stat.mtimeMs)}`; } catch { return null; }
}
