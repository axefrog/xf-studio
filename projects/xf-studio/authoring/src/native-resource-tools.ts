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
 *
 * What is written natively is only what an oracle proves (NATIVE-72, PIPE-135): the writer can encode any class in its table, but its
 * bytes are compared with WolvenKit's only on eye makeup's resources, so a document is written natively only when its `deserialize`
 * names an oracle (`NATIVE_WRITER_ORACLES`) that covers its root class, and only when the Build's WolvenKit is the release the class
 * table and the oracles come from (`NATIVE_WRITER_WOLVENKIT`). Everything else goes to WolvenKit, with the reason.
 *
 * Cancellation (NATIVE-74): the host's operations are synchronous and per file, so the tools check the Build's signal between files
 * and before packing, and stop with the Build's cancellation error.
 */
import { basename, dirname, join } from "node:path";
import type { DeserializeOptions, ResourceTools, ResourceWriters, TextureImportSettings, ToolStep } from "./platform/api";
import { PackageToolError } from "./package-build-wolvenkit";
import type { OodleLibrary } from "./native/oodle";
import type { BcnLibrary } from "./native/write/bcn";
import type { BcnCandidate } from "./packaged-build-tools";
import { writeCr2wDocument } from "./native/write/cr2w-writer";
import { packArchive, walkOrder } from "./native/write/rdar-writer";
import { NativeWriteRefusal } from "./native/write/red-encoder";
import { karkSegment, LEVEL_OPTIMAL2 } from "./native/write/segments";
import { importTexture } from "./native/write/xbm-writer";

/**
 * The oracles that prove the native writer byte for byte against WolvenKit 9.0.1, each with the root classes of the documents it compared
 * (tools/native-writer-oracle.ts, tests/native-writer.test.ts). Eye makeup's: the plate mesh (`CMesh`, whose local materials are
 * `CMaterialInstance` files written inside it) and morph target, the `.app` and the `.inkcharcustomization`. With its textures
 * (`CBitmapTexture`, whose import settings xbm-writer.ts matches or refuses) those are the six resource classes proven. A document of any
 * other root, or from an exporter that names no oracle (the expressions' face-rig `.app`, animation sets and table), is WolvenKit's until
 * an oracle of its own is captured and listed here.
 */
export const NATIVE_WRITER_ORACLES: Readonly<Record<string, readonly string[]>> = {
  "eye-makeup": ["CMesh", "MorphTargetMesh", "appearanceAppearanceResource", "gameuiCharacterCustomizationInfoResource"],
};
/** The WolvenKit release the writer's class table and oracles come from (PIPE-135). */
export const NATIVE_WRITER_WOLVENKIT = "9.0.1";

/** Why a document with root class `root`, converted under `options`, is not written natively; null when an oracle proves it. */
export function oracleRefusal(root: unknown, options: DeserializeOptions | undefined): string | null {
  const oracle = options?.oracle;
  if (oracle === undefined) return "No oracle proves the native writer on this exporter's files yet.";
  const roots = Object.hasOwn(NATIVE_WRITER_ORACLES, oracle) ? NATIVE_WRITER_ORACLES[oracle]! : null;
  if (!roots) return `The native writer has no oracle named ${oracle}.`;
  if (typeof root !== "string" || !roots.includes(root))
    return `The ${oracle} oracle doesn't cover ${typeof root === "string" ? root : "a document without a class"}.`;
  return null;
}

/** Why the Build's WolvenKit (its identity key, `wolvenkit:<version>:<hash>`) rules out native writing; null when it is the oracles' release. */
export function wolvenKitRefusal(identity: string | undefined): string | null {
  const version = identity ? /^wolvenkit:([^:]+):/.exec(identity)?.[1] : undefined;
  return version === NATIVE_WRITER_WOLVENKIT ? null
    : `The native writer matches WolvenKit ${NATIVE_WRITER_WOLVENKIT}; this Build's WolvenKit is ${version && version !== "unknown" ? version : "of an unknown version"}.`;
}

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
  options: { readonly log?: (line: string) => void; readonly signal?: AbortSignal } = {}): ResourceTools {
  const log = options.log ?? (() => {}), signal = options.signal;
  const native: string[] = [], fallback: { file: string; reason: string }[] = [];
  const oodle = loaded(libraries.oodle), bcn = loaded(libraries.bcn);
  const oodleMissing = missing(libraries.oodle), bcnMissing = missing(libraries.bcn);
  // A WolvenKit other than the oracles' release writes everything (PIPE-135).
  const notOracleRelease = wolvenKitRefusal(wolvenkit.identity);
  const compress = oodle?.compress ?? null;
  const noOodle = `The game's Oodle compressor can't be used: ${oodleMissing ?? "the library has no compressor export."}`;
  const noBcn = `XF Studio's texture compressor can't be used: ${bcnMissing}`;
  const cancelled = () => { if (signal?.aborted) throw new PackageToolError("package_build_cancelled", "Package Build was cancelled."); };
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
        cancelled();
        const file = name.replace(/\.dds$/i, ".xbm");
        const reason = notOracleRelease ?? (!compress ? noOodle : !bcn ? noBcn : null);
        if (reason) { refused.push({ path: join(input, name), file, reason }); continue; }
        try {
          const started = host.now();
          host.write(join(output, file), importTexture(host.read(join(input, name)), settings, bcn!, store));
          native.push(file);
          lines.push(`Imported ${name} natively (${Math.round(host.now() - started)} ms).`);
        } catch (error) { refused.push({ path: join(input, name), file, reason: reasonOf(error) }); }
      }
      cancelled();
      const tail = await viaWolvenKit(refused, `${input}-wolvenkit`, folder => wolvenkit.importTextures(folder, output, settings));
      return done(lines, tail);
    },

    async deserialize(input: string | readonly string[], output: string, deserializeOptions?: DeserializeOptions) {
      const lines: string[] = [], refused: { path: string; file: string; reason: string }[] = [];
      // Each input is a folder of documents or one document (the expressions exporter converts file by file).
      const documents = [input].flat().flatMap(item => host.isFile(item) ? [{ folder: dirname(item), name: basename(item) }]
        : host.list(item).filter(entry => !entry.folder && entry.name.endsWith(".json")).map(entry => entry.name).sort().map(name => ({ folder: item, name })));
      // Without an oracle, or with another WolvenKit, nothing is read: WolvenKit converts the inputs as given, in one launch.
      const blocked = notOracleRelease ?? (deserializeOptions?.oracle === undefined ? oracleRefusal(undefined, deserializeOptions) : null);
      if (blocked) {
        cancelled();
        for (const { name } of documents) {
          const file = name.slice(0, -".json".length);
          fallback.push({ file, reason: blocked });
          note(`${file} by WolvenKit: ${blocked}`);
        }
        return wolvenkit.deserialize(input, output, deserializeOptions);
      }
      for (const { folder, name } of documents) {
        cancelled();
        const file = name.slice(0, -".json".length);
        if (!compress) { refused.push({ path: join(folder, name), file, reason: noOodle }); continue; }
        try {
          const started = host.now();
          const text = new TextDecoder().decode(host.read(join(folder, name))).replace(/^\uFEFF/, "");
          const document = JSON.parse(text);
          const unproven = oracleRefusal(document?.Data?.RootChunk?.$type, deserializeOptions);
          if (unproven) { refused.push({ path: join(folder, name), file, reason: unproven }); continue; }
          host.write(join(output, file), writeCr2wDocument(document, store));
          native.push(file);
          lines.push(`Converted ${name} natively (${Math.round(host.now() - started)} ms).`);
        } catch (error) { refused.push({ path: join(folder, name), file, reason: reasonOf(error) }); }
      }
      cancelled();
      const tail = await viaWolvenKit(refused, join(output, "..", `${basename(output)}-wolvenkit`), folder => wolvenkit.deserialize(folder, output, deserializeOptions));
      return done(lines, tail);
    },

    async pack(input: string, output: string) {
      cancelled();
      let reason = notOracleRelease ?? (!compress ? noOodle : null);
      if (!reason) {
        try {
          const started = host.now();
          const paths = walkOrder(relative => host.list(join(input, ...relative.split("\\").filter(Boolean))));
          const files = paths.map(path => {
            cancelled();
            const full = join(input, ...path.split("\\"));
            return { path, bytes: host.read(full), fileTime: host.fileTime(full) };
          });
          host.write(join(output, `${basename(input)}.archive`), packArchive(files, compress!));
          native.push("archive");
          return done([`Packed ${files.length} files natively (${Math.round(host.now() - started)} ms).`]);
        } catch (error) { if (error instanceof PackageToolError) throw error; reason = reasonOf(error); }
      }
      cancelled();
      fallback.push({ file: "archive", reason });
      note(`archive by WolvenKit: ${reason}`);
      return wolvenkit.pack(input, output);
    },

    writers: (): ResourceWriters => ({ native: [...native], wolvenkit: fallback.map(item => ({ ...item })) }),
  };
}

/**
 * The native writer's libraries for a Build: the game's Oodle (with its compressor) from `gameRoot`, and XF Studio's texture compressor,
 * the first of `bcnCandidates` that exists (packaged-build-tools.ts decides them). A candidate bound to a SHA-256 loads only when its
 * bytes have it (NATIVE-75). What can't be loaded is reported, and its outputs go to WolvenKit.
 */
export function loadNativeWriterLibraries(gameRoot: string, bcnCandidates: readonly (string | BcnCandidate)[],
  load: { oodle: (gameRoot: string) => OodleLibrary; bcn: (path: string) => BcnLibrary; isFile: (path: string) => boolean;
    sha256?: (path: string) => string }): NativeWriterLibraries {
  let oodle: NativeWriterLibraries["oodle"];
  try {
    const library = load.oodle(gameRoot);
    if (library.compress) oodle = library;
    else { library.close(); oodle = { unavailable: "The game's Oodle library has no compressor export." }; }
  } catch (error) { oodle = { unavailable: (error as Error).message }; }
  let bcn: NativeWriterLibraries["bcn"] = { unavailable: "XF Studio's texture compressor is not installed." };
  const candidate = bcnCandidates.map(item => typeof item === "string" ? { path: item } as BcnCandidate : item).find(item => load.isFile(item.path));
  if (candidate) try {
    if (candidate.sha256 === null) bcn = { unavailable: "XF Studio's texture compressor has no record of its build; build it again with tools/build-native-bcn.ts." };
    else if (candidate.sha256 !== undefined && (!load.sha256 || load.sha256(candidate.path) !== candidate.sha256))
      bcn = { unavailable: "XF Studio's texture compressor differs from the one that was built." };
    else bcn = load.bcn(candidate.path);
  } catch (error) { bcn = { unavailable: (error as Error).message }; }
  return { oodle, bcn };
}

/** Release what `loadNativeWriterLibraries` loaded. */
export function closeNativeWriterLibraries(libraries: NativeWriterLibraries): void {
  loaded(libraries.oodle)?.close();
  loaded(libraries.bcn)?.close();
}
