/**
 * Host adapter: the Build's conversions written natively (PIPE-130), with WolvenKit per file wherever the native writer refuses an input.
 * It wraps the WolvenKit tools (package-build-wolvenkit.ts) behind the same `ResourceTools`:
 *
 * - `importTextures`: each DDS to its `.xbm` by the native texture import (native/write/xbm-writer.ts); refused ones in one WolvenKit
 *   import of their own folder;
 * - `deserialize`: each JSON document to its CR2W file (native/write/cr2w-writer.ts); refused ones in one WolvenKit conversion;
 * - `pack`: the staging tree to one archive (native/write/rdar-writer.ts), or WolvenKit's pack if the packer refuses;
 * - `serialize` stays WolvenKit's (only a plate without kept JSON needs it).
 *
 * Buffers and archive segments are compressed with the game's own Oodle (oodle.ts); textures with XF Studio's compressor (bcn.ts). Either
 * missing sends that kind of output to WolvenKit. `writers()` says which writer made each output, for the build record and manifest.
 * The independent verifiers never use any of this: they read the archive with WolvenKit.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ResourceTools, ResourceWriters, TextureImportSettings, ToolStep } from "./platform/api";
import type { OodleLibrary } from "./native/oodle";
import type { BcnLibrary } from "./native/write/bcn";
import { writeCr2wDocument } from "./native/write/cr2w-writer";
import { fileTimeOf, packArchive, walkOrder } from "./native/write/rdar-writer";
import { NativeWriteRefusal } from "./native/write/red-encoder";
import { karkSegment, LEVEL_OPTIMAL2 } from "./native/write/segments";
import { importTexture } from "./native/write/xbm-writer";

export interface NativeWriterLibraries {
  /** The game's Oodle library with its compressor, or why it can't be used. */
  readonly oodle: OodleLibrary | { readonly unavailable: string };
  /** XF Studio's texture compressor, or why it can't be used. */
  readonly bcn: BcnLibrary | { readonly unavailable: string };
}

const reasonOf = (error: unknown) => error instanceof NativeWriteRefusal ? error.message : `Native writer error: ${(error as Error)?.message ?? String(error)}`;
/** The loaded library, or null when it is only a reason. */
const loaded = <T extends object>(value: T | { readonly unavailable: string }): T | null => "unavailable" in value ? null : value as T;
const missing = (value: object): string | null => "unavailable" in value ? (value as { unavailable: string }).unavailable : null;

/** The Build's tools, writing natively where it can. `wolvenkit` makes whatever the native writer refuses. */
export function createNativeResourceTools(wolvenkit: ResourceTools, libraries: NativeWriterLibraries, log: (line: string) => void = () => {}): ResourceTools {
  const native: string[] = [], fallback: { file: string; reason: string }[] = [];
  const oodle = loaded(libraries.oodle), bcn = loaded(libraries.bcn);
  const oodleMissing = missing(libraries.oodle), bcnMissing = missing(libraries.bcn);
  const compress = oodle?.compress ?? null;
  const noOodle = `The game's Oodle compressor can't be used: ${oodleMissing ?? "the library has no compressor export."}`;
  const noBcn = `XF Studio's texture compressor can't be used: ${bcnMissing}`;
  const store = (raw: Uint8Array) => karkSegment(raw, LEVEL_OPTIMAL2, compress!);
  const note = (text: string) => log(`native writer: ${text}`);
  const done = (lines: string[], extra?: ToolStep): ToolStep => ({ exitCode: extra?.exitCode ?? 0, log: [...lines, ...(extra ? [extra.log] : [])].join("\n") + "\n" });

  /** Run `wolvenkit` on copies of the refused inputs (one launch), then report them. */
  const viaWolvenKit = async (refused: { path: string; file: string; reason: string }[], folder: string,
    run: (folder: string) => Promise<ToolStep>): Promise<ToolStep | undefined> => {
    if (!refused.length) return undefined;
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    for (const item of refused) copyFileSync(item.path, join(folder, basename(item.path)));
    for (const item of refused) { fallback.push({ file: item.file, reason: item.reason }); note(`${item.file} by WolvenKit: ${item.reason}`); }
    try { return await run(folder); } finally { rmSync(folder, { recursive: true, force: true }); }
  };

  return {
    ...wolvenkit.identity ? { identity: wolvenkit.identity } : {},
    serialize: (input, output) => wolvenkit.serialize(input, output),

    async importTextures(input: string, output: string, settings: TextureImportSettings) {
      const lines: string[] = [], refused: { path: string; file: string; reason: string }[] = [];
      for (const name of readdirSync(input).filter(name => name.toLowerCase().endsWith(".dds")).sort()) {
        const file = name.replace(/\.dds$/i, ".xbm");
        const reason = !compress ? noOodle : !bcn ? noBcn : null;
        if (reason) { refused.push({ path: join(input, name), file, reason }); continue; }
        try {
          const started = performance.now();
          writeFileSync(join(output, file), importTexture(new Uint8Array(readFileSync(join(input, name))), settings, bcn!, store));
          native.push(file);
          lines.push(`Imported ${name} natively (${Math.round(performance.now() - started)} ms).`);
        } catch (error) { refused.push({ path: join(input, name), file, reason: reasonOf(error) }); }
      }
      const tail = await viaWolvenKit(refused, `${input}-wolvenkit`, folder => wolvenkit.importTextures(folder, output, settings));
      return done(lines, tail);
    },

    async deserialize(input: string | readonly string[], output: string) {
      const lines: string[] = [], refused: { path: string; file: string; reason: string }[] = [];
      const folders = [input].flat();
      for (const folder of folders) for (const name of readdirSync(folder).filter(name => name.endsWith(".json")).sort()) {
        const file = name.slice(0, -".json".length);
        if (!compress) { refused.push({ path: join(folder, name), file, reason: noOodle }); continue; }
        try {
          const started = performance.now();
          writeFileSync(join(output, file), writeCr2wDocument(JSON.parse(readFileSync(join(folder, name), "utf8").replace(/^﻿/, "")), store));
          native.push(file);
          lines.push(`Converted ${name} natively (${Math.round(performance.now() - started)} ms).`);
        } catch (error) { refused.push({ path: join(folder, name), file, reason: reasonOf(error) }); }
      }
      const tail = await viaWolvenKit(refused, join(output, "..", `${basename(output)}-wolvenkit`), folder => wolvenkit.deserialize(folder, output));
      return done(lines, tail);
    },

    async pack(input: string, output: string) {
      let reason = !compress ? noOodle : null;
      if (!reason) {
        try {
          const started = performance.now();
          const paths = walkOrder(relative => readdirSync(join(input, ...relative.split("\\").filter(Boolean)), { withFileTypes: true })
            .map(entry => ({ name: entry.name, folder: entry.isDirectory(), link: entry.isSymbolicLink() })));
          const files = paths.map(path => {
            const full = join(input, ...path.split("\\"));
            return { path, bytes: new Uint8Array(readFileSync(full)), fileTime: fileTimeOf(statSync(full, { bigint: true }).mtimeNs) };
          });
          writeFileSync(join(output, `${basename(input)}.archive`), packArchive(files, compress!));
          native.push("archive");
          return done([`Packed ${files.length} files natively (${Math.round(performance.now() - started)} ms).`]);
        } catch (error) { reason = reasonOf(error); }
      }
      fallback.push({ file: "archive", reason });
      note(`archive by WolvenKit: ${reason}`);
      return wolvenkit.pack(input, output);
    },

    writers: (): ResourceWriters => ({ native: [...native], wolvenkit: fallback.map(item => ({ ...item })) }),
  };
}

/**
 * The native writer's libraries for a Build: the game's Oodle (with its compressor) from `gameRoot`, and XF Studio's texture compressor,
 * the first of `bcnCandidates` that exists. What can't be loaded is reported, and its outputs go to WolvenKit.
 */
export function loadNativeWriterLibraries(gameRoot: string, bcnCandidates: readonly string[],
  load: { oodle: (gameRoot: string) => OodleLibrary; bcn: (path: string) => BcnLibrary }): NativeWriterLibraries {
  let oodle: NativeWriterLibraries["oodle"];
  try {
    const library = load.oodle(gameRoot);
    if (library.compress) oodle = library;
    else { library.close(); oodle = { unavailable: "The game's Oodle library has no compressor export." }; }
  } catch (error) { oodle = { unavailable: (error as Error).message }; }
  let bcn: NativeWriterLibraries["bcn"] = { unavailable: "XF Studio's texture compressor is not installed." };
  const path = bcnCandidates.find(candidate => { try { return statSync(candidate).isFile(); } catch { return false; } });
  if (path) try { bcn = load.bcn(path); } catch (error) { bcn = { unavailable: (error as Error).message }; }
  return { oodle, bcn };
}

/** Release what `loadNativeWriterLibraries` loaded. */
export function closeNativeWriterLibraries(libraries: NativeWriterLibraries): void {
  loaded(libraries.oodle)?.close();
  loaded(libraries.bcn)?.close();
}
