/**
 * Host adapter: the Build's conversions written natively (PIPE-130), with WolvenKit per file wherever the native writer refuses an input.
 * It wraps the WolvenKit tools (package-build-wolvenkit.ts) behind the same `ResourceTools`:
 *
 * - `importTextures`: each DDS to its `.xbm` by the native texture importer, native/write/xbm-writer.ts; refused ones in one WolvenKit
 *   import of their own folder;
 * - `deserialize`: each JSON document to its CR2W file (native/write/cr2w-writer.ts); refused ones in one WolvenKit conversion;
 * - `pack`: the staging tree to one archive (native/write/rdar-writer.ts), or WolvenKit's pack if the packer refuses;
 * - `serialize` stays WolvenKit's (only a plate without kept JSON needs it).
 *
 * Buffers and archive segments are compressed with the game's own Oodle (oodle.ts); textures with XF Studio's compressor (bcn.ts). Either
 * missing sends that kind of output to WolvenKit. `writers()` says which writer made each output, for the build record and manifest.
 * The independent verifiers never use any of this: they read the archive with WolvenKit. Files and the clock come through a
 * `WriterHost` the caller supplies (the Build's CLI passes the file system's, tools/native-writer-host.ts).
 */
import { basename, join } from "node:path";
import type { ResourceTools, ResourceWriters, TextureImportSettings, ToolStep } from "./platform/api";
import type { OodleLibrary } from "./native/oodle";
import type { BcnLibrary } from "./native/write/bcn";
import { writeCr2wDocument } from "./native/write/cr2w-writer";
import { packArchive, walkOrder } from "./native/write/rdar-writer";
import { NativeWriteRefusal } from "./native/write/red-encoder";
import { karkSegment, LEVEL_OPTIMAL2 } from "./native/write/segments";
import { importTexture } from "./native/write/xbm-writer";

export interface NativeWriterLibraries {
  /** The game's Oodle library with its compressor, or why it can't be used. */
  readonly oodle: OodleLibrary | { readonly unavailable: string };
  /** XF Studio's texture compressor, or why it can't be used. */
  readonly bcn: BcnLibrary | { readonly unavailable: string };
}

/** What the tools need of the host: the build's folders and files, and a clock for the log's timings. */
export interface WriterHost {
  /** A folder's entries: name, whether it is a folder, whether it is a link. */
  list(folder: string): readonly { readonly name: string; readonly folder: boolean; readonly link: boolean }[];
  read(path: string): Uint8Array;
  write(path: string, bytes: Uint8Array): void;
  copy(from: string, to: string): void;
  /** Make a folder and its parents. */
  makeFolder(path: string): void;
  /** Remove a folder and everything in it, if it exists. */
  remove(path: string): void;
  /** A file's modification time as a Windows file time (100 ns since 1601). */
  fileTime(path: string): bigint;
  isFile(path: string): boolean;
  /** Milliseconds, for the log's timings. */
  now(): number;
}

const reasonOf = (error: unknown) => error instanceof NativeWriteRefusal ? error.message : `Native writer error: ${(error as Error)?.message ?? String(error)}`;
/** The loaded library, or null when it is only a reason. */
const loaded = <T extends object>(value: T | { readonly unavailable: string }): T | null => "unavailable" in value ? null : value as T;
const missing = (value: object): string | null => "unavailable" in value ? (value as { unavailable: string }).unavailable : null;

/** The Build's tools, writing natively where it can. `wolvenkit` makes whatever the native writer refuses. */
export function createNativeResourceTools(wolvenkit: ResourceTools, libraries: NativeWriterLibraries, host: WriterHost,
  log: (line: string) => void = () => {}): ResourceTools {
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
    host.remove(folder);
    host.makeFolder(folder);
    for (const item of refused) host.copy(item.path, join(folder, basename(item.path)));
    for (const item of refused) { fallback.push({ file: item.file, reason: item.reason }); note(`${item.file} by WolvenKit: ${item.reason}`); }
    try { return await run(folder); } finally { host.remove(folder); }
  };

  return {
    ...wolvenkit.identity ? { identity: wolvenkit.identity } : {},
    serialize: (input, output) => wolvenkit.serialize(input, output),

    async importTextures(input: string, output: string, settings: TextureImportSettings) {
      const lines: string[] = [], refused: { path: string; file: string; reason: string }[] = [];
      for (const name of host.list(input).filter(entry => !entry.folder && entry.name.toLowerCase().endsWith(".dds")).map(entry => entry.name).sort()) {
        const file = name.replace(/\.dds$/i, ".xbm");
        const reason = !compress ? noOodle : !bcn ? noBcn : null;
        if (reason) { refused.push({ path: join(input, name), file, reason }); continue; }
        try {
          const started = host.now();
          host.write(join(output, file), importTexture(host.read(join(input, name)), settings, bcn!, store));
          native.push(file);
          lines.push(`Imported ${name} natively (${Math.round(host.now() - started)} ms).`);
        } catch (error) { refused.push({ path: join(input, name), file, reason: reasonOf(error) }); }
      }
      const tail = await viaWolvenKit(refused, `${input}-wolvenkit`, folder => wolvenkit.importTextures(folder, output, settings));
      return done(lines, tail);
    },

    async deserialize(input: string | readonly string[], output: string) {
      const lines: string[] = [], refused: { path: string; file: string; reason: string }[] = [];
      const folders = [input].flat();
      for (const folder of folders) for (const name of host.list(folder).filter(entry => !entry.folder && entry.name.endsWith(".json")).map(entry => entry.name).sort()) {
        const file = name.slice(0, -".json".length);
        if (!compress) { refused.push({ path: join(folder, name), file, reason: noOodle }); continue; }
        try {
          const started = host.now();
          const text = new TextDecoder().decode(host.read(join(folder, name))).replace(/^\uFEFF/, "");
          host.write(join(output, file), writeCr2wDocument(JSON.parse(text), store));
          native.push(file);
          lines.push(`Converted ${name} natively (${Math.round(host.now() - started)} ms).`);
        } catch (error) { refused.push({ path: join(folder, name), file, reason: reasonOf(error) }); }
      }
      const tail = await viaWolvenKit(refused, join(output, "..", `${basename(output)}-wolvenkit`), folder => wolvenkit.deserialize(folder, output));
      return done(lines, tail);
    },

    async pack(input: string, output: string) {
      let reason = !compress ? noOodle : null;
      if (!reason) {
        try {
          const started = host.now();
          const paths = walkOrder(relative => host.list(join(input, ...relative.split("\\").filter(Boolean))));
          const files = paths.map(path => {
            const full = join(input, ...path.split("\\"));
            return { path, bytes: host.read(full), fileTime: host.fileTime(full) };
          });
          host.write(join(output, `${basename(input)}.archive`), packArchive(files, compress!));
          native.push("archive");
          return done([`Packed ${files.length} files natively (${Math.round(host.now() - started)} ms).`]);
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
  load: { oodle: (gameRoot: string) => OodleLibrary; bcn: (path: string) => BcnLibrary; isFile: (path: string) => boolean }): NativeWriterLibraries {
  let oodle: NativeWriterLibraries["oodle"];
  try {
    const library = load.oodle(gameRoot);
    if (library.compress) oodle = library;
    else { library.close(); oodle = { unavailable: "The game's Oodle library has no compressor export." }; }
  } catch (error) { oodle = { unavailable: (error as Error).message }; }
  let bcn: NativeWriterLibraries["bcn"] = { unavailable: "XF Studio's texture compressor is not installed." };
  const path = bcnCandidates.find(candidate => load.isFile(candidate));
  if (path) try { bcn = load.bcn(path); } catch (error) { bcn = { unavailable: (error as Error).message }; }
  return { oodle, bcn };
}

/** Release what `loadNativeWriterLibraries` loaded. */
export function closeNativeWriterLibraries(libraries: NativeWriterLibraries): void {
  loaded(libraries.oodle)?.close();
  loaded(libraries.bcn)?.close();
}
