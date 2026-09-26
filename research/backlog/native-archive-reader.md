# Native archive and resource reader

**Status (26 September 2026): phases 1 and 2 done as R&D, not wired into the app; hardened against hostile files on `claude/native-hardening` (review findings NATIVE-01..17 fixed, [budgets](#budgets) below).** A TypeScript reader for the game's `.archive` container and CR2W resources. It decompresses through the Oodle library in the user's own game folder (`bun:ffi`), so XF Studio never ships the DLL. It writes the same JSON documents the resolver reads from WolvenKit. It removes WolvenKit from the resolver's user path: a first preparation that took minutes of WolvenKit launches takes seconds. It also becomes the base for the texture and mesh exports that still need WolvenKit. The format itself is documented in [archive and resource formats](../../knowledge/archive-format.md).

**Licensing, non-negotiable.** XF Studio stays MIT. WolvenKit is GPL-3.0: we study its source as format documentation and run its CLI as an oracle, and we never copy or port its code. RED4ext.SDK is MIT. The game's Oodle DLL is loaded where the game installed it and never copied or redistributed. Credits are in [community credits](../../docs/community-credits.md) (WolvenKit, RED4ext SDK, Cyber Engine Tweaks, red4ext-rs, the modding wiki, psiberx's RTTI dump).

## Phases

| Phase | Scope | State | Effort |
|---|---|---|---|
| 1. Bytes | RDAR index, `KARK` segments, Oodle through the game DLL, `LXRS` name lists; the resource file as an extractor writes it | **Done.** Byte-identical to WolvenKit `unbundle` | — |
| 2. Documents | CR2W tables and properties, value encodings, material appendices, `compiledData` packages, local material lists, the resolver's JSON shape and learned defaults | **Done** for the 13 root classes the resolver reads (list in [the knowledge page §5.1](../../knowledge/archive-format.md#51-roots-verified)); `.env` curves refused | — |
| 3. Textures | `.xbm` → PNG for the preview (and `.mlmask` → one PNG per layer) | Planned | 3–5 days |
| 4. Meshes | `.mesh` / `.morphtarget` render blobs → GLB with skin, bones and morph targets, plus the mesh's materials resolved through their `.mi` chains | Planned | 1.5–3 weeks |
| 5. Integration | Native-first fetch in the resolver host, then in game-asset export | Planned (below) | 2–3 days for the resolver; phases 3–4 bring their own |

### Phase 3: textures

`CBitmapTexture` already decodes (header, `setup`, `renderTextureResource`). What remains is its `rendRenderTextureBlobPC` buffer: the texture header (size, mip count, format, slices), then mip data in the platform layout.

- **Decoding BCn.** Character textures are BC1/BC3/BC4/BC5/BC7 (BC7 for most albedo). Two routes:
  - **Pure TypeScript** BC1–5 decoders are small (a day). BC7 is the costly one: eight modes, partitions and a p-bit table. It takes 2–3 days to write and test, and is about 10–30× slower than native code. That is acceptable for a cached export (a 2K BC7 map decodes in roughly 0.5–1 s in TS).
  - **C through `bun:ffi` `cc`**, compiling a permissively licensed single-file decoder at first use. It is faster but adds a C toolchain dependency to the desktop build. That breaks the "it just works" policy unless the binary is prebuilt, and a prebuilt binary is a new release artefact.
  - **Recommendation:** TypeScript first, measured against WolvenKit's PNGs on the textures the preview uses. Move to `cc` only if a real preview load shows decode time mattering after caching.
- **Mips and colour.** Export mip 0 only, as the preview does today. Keep sRGB versus linear from the texture's `setup` (the preview's colour handling depends on it). Normal maps (BC5) need Z reconstruction if the renderer expects three channels, so compare with WolvenKit's PNG convention.
- **Oracle.** Compare decoded pixels with `uncook --uext png` output (exact for BC1–5; within one level for BC7 if WolvenKit uses a different decoder). Run it opt-in, like the existing oracle tests.
- **`.mlmask`**: layer count and per-layer BC4 or raw data, with the atlas and tile tables already understood from WolvenKit's exporter (studied only).

### Phase 4: meshes

The render blob (`rendRenderMeshBlob`) holds a header with per-chunk vertex layouts (`rendChunk`: vertex factory, stream offsets, index offsets, `renderMask`) plus the vertex and index buffers, in quantised formats: positions as 16-bit normalised with per-mesh scale and offset, normals and tangents in 10:10:10:2, UVs as half floats, and eight skin weights per vertex split over two streams. A `.morphtarget` adds per-target sparse deltas and a diff/mapping block.

- **Head start:** [`eye-plate-cut.ts`](../../projects/xf-studio/authoring/src/eye-plate-cut.ts) already reads and rewrites the head mesh's render-blob vertex streams and the morph target's embedded base buffer at the byte level for the eye plate ([experiment 012](../../experiments/012-native-plate-bootstrap/README.md#built-in-production-plate)). Generalising that to every vertex factory the character meshes use is most of phase 4.
- **GLB writing:** [`glb.ts`](../../projects/xf-studio/authoring/src/glb.ts) exists. Bones come from the mesh's `boneNames`, `boneRigMatrices` and `boneVertexEpsilons`, and morph targets become glTF morph targets.
- **Materials:** the `.Material.json` WolvenKit writes is a resolved `.mi` chain. The resolver already walks those chains, so the native route can emit the same shape from resolver documents rather than re-deriving it.
- **Oracle:** compare vertex positions, normals, UVs, skin weights and morph deltas with WolvenKit's GLB (within quantisation) on the head, body, brows, lashes, hair and one piercing. This also shows whether WolvenKit applies any transform the preview has come to rely on.
- **Effort** is dominated by vertex-factory coverage and morph targets: 1.5 weeks for the character meshes the preview shows, up to 3 with garment and hair variants.

### Native modules for the hot loops

Direction (26 September 2026): performance-critical decoding may move into a small native module behind `bun:ffi` (C via `bun:ffi` `cc`, C++ or Rust, chosen per case), as the Oodle call and the bridge's window capture already do. The candidates are phase 3's BCn texture decompression and mip handling and phase 4's mesh buffer unpacking (vertex streams, morph targets, skin weights), where tight loops over megabytes dominate. The rule for choosing: first write and measure the TypeScript version against the budgets below; move a loop to native code only when the measurement shows it matters, keep a TypeScript reference implementation as the test oracle (byte-identical outputs), bound every native entry point by the same limits (`limits.ts`), and never run untrusted data through native code without the size and bounds checks happening before the call. Licence: our own code (MIT); no GPL sources consulted beyond format facts.

## Integration plan

1. **Wait for `claude/choice-prefetch`** (it changes `WolvenKitFetcher` and the resource graph's prefetch). Integrate after it lands, against its fetch-port shape; [`native-fetch-port.ts`](../../projects/xf-studio/authoring/src/native/native-fetch-port.ts) stays self-contained until then.
2. **Native first, WolvenKit fallback, per resource.** `openInstallation` opens a native decoder once per route: `await openNativeDecoderAsync(gameRoot)` (a worker with a time budget per resource) or `inProcessDecoder((await openNativeReaderAsync(gameRoot)).reader)`. The asynchronous forms never block the host's event loop while an unknown DLL's signature is checked; the synchronous `openNativeDecoder`/`openNativeReader` are for command-line tools. If that fails (not Windows x64, no DLL, a DLL that is neither on the known-hash list nor signed by CD PROJEKT S.A., a DLL that won't load), the route runs on WolvenKit alone and records why in its diagnostics. Otherwise the graph's port is `NativeFirstFetcher(decoder, wolvenKitFetcher)`. A resource goes to WolvenKit when the archive doesn't list it, when its root class is outside `NATIVE_ROOTS`, or when decoding refuses it. `stats.byKind` counts every fallback by kind (`not-indexed`, `not-verified`, `unsupported`, `malformed`, `decompress`, `over-budget`, `io`, `unavailable`, `internal`), `stats.samples` keeps up to 32 messages, and `stats.internal` keeps reader bugs with their stacks. `onFallback` feeds the diagnostics, and `strict` rethrows reader bugs in tests and benches. A new mod type that falls back therefore shows up by kind.
   - **Worker packaging.** `WorkerDecoder` starts `native-decode-worker.ts` from its own URL. The desktop build must bundle that file as a second entry point, or pass its built URL as `script`. The worker loads the Oodle library only when the bytes match the hash the parent checked. A worker that cannot start makes the decoder answer `unavailable` for a minute before one retry, and for the session after three failed starts in a row.
   - **What the answer adds.** A native answer is a `NativeFetchedResource`: `notes` (a property stored with a type the RTTI disagrees with) and `defaulted` (JSON paths of watched properties the file left out, today `rendChunk.renderMask`). The resolver should surface the notes on the resolved detail and read `defaulted` to tell a missing `renderMask` from a stored zero. `FetchedResource` in `resource-graph.ts` gains the two optional fields when the resolver consumes them; until then they live on the native type only.
3. **Cache keys by reader identity.** Native answers are fast enough not to cache: every resource of the reference save took 2.7 s in total. If a cache is added, key it by (depot hash, archive fingerprint, `NativeReader.identity`). The identity is `xfs-native:<NATIVE_READER_VERSION>:<hash of the RTTI slice and learned defaults>:<Oodle DLL hash>`. It is never the WolvenKit identity, so a WolvenKit update doesn't invalidate native answers and a reader change doesn't reuse old ones. Bump `NATIVE_READER_VERSION` with any change to decoding or JSON writing.
4. **Provenance unchanged.** A native answer carries the same `extractedSha256` as WolvenKit's (the bytes are identical), so render records and evidence don't depend on which reader answered. Documents carry `Header.XfsNativeReader` for traceability.
5. **Setup gating.** WolvenKit becomes optional for resolving and stays required for the texture and mesh exports until phases 3–4 land. The setup UI then asks for WolvenKit only when a preparation needs a fallback or an export, and phases 3–4 remove that need for the preview.
6. **Tests to add at integration:** the synthetic fetch-port tests move to the integrated fetcher. The opt-in oracle and [`tools/native-resolver-bench.ts`](../../projects/xf-studio/authoring/tools/native-resolver-bench.ts) become the release check for a new game patch or WolvenKit version.

## Budgets

Every size and count in an archive or resource is chosen by the file, so the reader checks each against a cap before allocating, and counts the work a small file can cause (knowledge page §8). A resource over a cap falls back to WolvenKit (`over-budget`), so a cap that is too tight costs speed, never correctness. The defaults (`DEFAULT_LIMITS` in `src/native/limits.ts`) come from `tools/native-limits.ts` on game 2.31 and the reference mod list, 26 September 2026. The tool read 1,157 archive indexes (647,849 entries) and decoded, with no caps, the resolver cache's 1,722 distinct resources and the 406 resources of verified root classes whose body is 1 MiB or more. The string-pool, name-count and index rows come from a capped rerun the same day (1,759 cached resources, every body of 1 MiB or more read for its pool; a smaller body holds a smaller pool). No resolver-cache resource passes any default. The caps bound one decode's memory near 1 GB at worst, so the few largest world meshes (up to 33 M values) fall back to WolvenKit; the resolver reads none of them.

| Budget | Largest measured | Default cap |
|---|---|---|
| Resource read from the archive (body + stored buffers) | 32.8 MiB (a verified-class mesh; any class: 221 MiB, a physics cache) | 128 MiB |
| Decompressed body | 31.8 MiB (verified classes) | 128 MiB |
| One buffer, stored or decompressed | 85.3 MiB in any archive; 11.1 MiB parsed | 128 MiB |
| Bytes decoded to names and parsed buffers, plus 4 per string-pool entry (the terminator index) | 15.6 MiB (16.8 MiB with the index) | 64 MiB |
| Values decoded | 0.6 M in the resolver cache; 33.2 M in the largest world mesh | 8 M |
| JSON values written | 1.3 M in the resolver cache (33.2 M in that mesh); at most 0.97 per decoded value beyond 2^20 | 16 M, and at most 8 per decoded value beyond 2^20 |
| Nesting (decode, derive, write) | 11 | 128 |
| One name or import path | 159 bytes | 1 KiB |
| Names decoded (distinct pool entries and package names; ~150 bytes of memory each) | 313,846 in one mesh (twice that through the port, which also reads the root class under the same budget) | 2 M |
| CR2W string pool | 2.7 MiB in any class (a `JsonResource`); 0.42 MiB in verified classes | 16 MiB |
| Archive name list (`LXRS`), stored or decompressed | 0.37 MiB | 16 MiB |
| One archive index block | 28.6 MiB (a `content` archive; 101,943 entries in the largest); 0.53 MiB in any mod | 128 MiB |
| Index blocks a pool keeps at once | 96.2 MiB for all 1,157 archives together | 512 MiB (least recently used dropped past it) |
| Time per resource (worker) | 0.67 s (the largest mesh, under load) | 10 s |
| Worker start | not measured separately (the test workers start within the default budgets) | 15 s; after a failed start, `unavailable` for 60 s, and for the session after 3 failed starts in a row |

Rerun `bun tools/native-limits.ts --game <game> --mods <MO2 mods> --cache <resolver-cache/json>` after a game patch or when a mod falls back `over-budget`. It runs under the default caps, so no cached resource may show a `NativeBudgetError` outcome. `--uncapped` measures true maxima (the table above), but the largest meshes then take several GB, so run it only on an idle machine. The first uncapped run, beside other agents' work, preceded a machine-wide out-of-memory freeze.

## Evidence so far

Game 2.31, WolvenKit CLI 9.0.1, reference MO2 route (1,079 mounted archives), 26 September 2026. Offline only; none of this is game rendering evidence.

| Check | Tool or test | Result |
|---|---|---|
| Bytes vs `unbundle` | `tools/native-archive-bench.ts` | 138/138 identical (60 + 60 spread entries of two content archives, 18 of a CCXL mod archive); open 6–9 ms for an 81,000-entry archive, 0.3 ms for a small mod archive, read 0.06–0.16 ms per resource; 595 MB read in 344 ms |
| Bytes of the resolver cache | `tools/native-cr2w-diff.ts` | 2,348/2,348 identical (SHA-256 against WolvenKit's extraction) |
| Documents | `tools/native-cr2w-diff.ts` | All 2,348 equal leaf for leaf except the name-only gaps (`.app` package references and CCO `icon` TweakDBIDs are hashes); resolver models equal for all 2,348 |
| Hold-out | `native-cr2w-diff.ts --learn --holdout` | Defaults learned on even hashes; resolver models equal on the 1,100 odd ones. Full documents miss only for classes never seen in training |
| Oracle test | `tests/native-reader-oracle.test.ts` (opt-in: `XFS_RESOLVER_GAME_ROOT`, `XFS_WOLVENKIT_CLI`) | 120 spread entries byte-identical, 12 resources' JSON equal |
| Unit tests | `tests/native-archive.test.ts`, `native-cr2w.test.ts`, `native-fetch-port.test.ts` | Synthetic fixtures (no game data) |
| Hostile input | `tests/native-hardening.test.ts` (each review finding's case), `native-fuzz.test.ts` (deterministic mutation fuzz, 1.5 s in the normal suite), `native-oodle.test.ts`, `native-boundary.test.ts` | Every reproduced hang or blow-up is refused in milliseconds with a typed error. The normal-suite fuzz runs about 100,000 mutants of synthetic resources and archives; three longer runs with other seeds covered 3.3 million. None failed internally, and the slowest case took 7 ms. The synthetic tests peak at 135 MiB |
| Real-data fuzz | `tests/native-reader-fuzz-oracle.test.ts` (opt-in: `XFS_RESOLVER_GAME_ROOT`; tight caps, at most 20,000 cases and 120 s, stops past 1.5 GB resident) | 18,700 mutants of 50 real resources in 10 s: no internal failure, slowest 9 ms, peak 164 MiB for the process. The game's Oodle refused 411 of 560 damaged or mis-sized streams and decoded 149 truncated or corrupted ones to other bytes (the streams carry no checksum) |
| Cold resolve, hardened | `tools/native-resolver-bench.ts --save … --order native-first` (strict: reader bugs rethrow) | Native run: 519 resources read natively, 0 fallbacks of any kind, 56 appearances. Its 4.8 s resolve is not comparable with the 2.7–2.9 s above: it ran on a machine loaded to its memory limit, minutes before an out-of-memory freeze, and the WolvenKit run failed there (the creator resource was not found). It was not repeated, to keep the machine free |
| Hardened output | `native-cr2w-diff.ts`, and a comparison of every document before and after hardening | All 1,722 distinct cached resources byte-identical to the unhardened reader's output; the harness report unchanged, including 41,904 hash-only package references, each now checked to hash the reference's path. Decode about 3% and JSON writing about 7% faster than before; reading 0.07 ms slower per resource (the archive is opened and closed per read) |
| **Cold resolve, reference save** | `tools/native-resolver-bench.ts --save …` (two runs, separate processes, separate fresh caches) | **WolvenKit only: 90.2–94.8 s resolve, 23 launches, 612 resources extracted, 117 MB of cached JSON. Native first: 2.7–2.9 s, 0 launches, 519 resources read natively, 0 fallbacks.** The route open took 3–4 s either way. Totals were 93–99 s against 5.4–6.6 s (15–17×) |
| Result equality | same | Equal (ambiguities and gaps compared as sets) except one appearance. WolvenKit 8.17.4 and 9.0.1 both refuse to serialize a body-UV framework mod's `l0_000_base__full.app` (`castShadows` stored as `Bool`, RTTI `shadowsShadowCastingMode`), so the WolvenKit route leaves the saved body appearance missing. The native route resolves it. The reference installation's production cache holds a lasting failure marker for it |
| Cold resolve, piercing UI state | `tools/native-resolver-bench.ts --ui-state … --order native-first` (the default V with one framework piercing, native run first to rule out file-cache order effects) | WolvenKit only: 118.9 s, 25 launches, 719 resources extracted. Native first: 3.9 s, 0 launches, 621 native reads, 0 fallbacks; route open 3.2–3.3 s either way. Equal except the same body appearance |

Why the native route reads fewer resources (519 against 612, 621 against 719): the graph prefetches the likely neighbours of a *freshly extracted* resource to batch WolvenKit launches. Native answers are not `fresh`, so nothing is fetched speculatively.

## Open caveats

- `rendChunk.renderMask` absent from a file is written as 0 (WolvenKit's default), which the resolver reads as not drawn. The engine's own default is unread. The reader now reports where it was absent (`defaulted`); no cached resource omits it.
- Learned defaults cover the classes seen in the cache. An unseen class's non-zero default becomes zero (the resolver's fields held on the hold-out). A per-class RTTI default read through the runtime bridge would close this.
- Only WolvenKit 9.0.1 served as the oracle for documents. 8.17.4 was not compared.
- The RTTI dump dates from May 2025, so newer properties come only from learned keys. A game patch that adds properties needs the harness rerun.
- The native reader decodes a value by the type the file declares, even when the RTTI disagrees (the `castShadows` case). The engine's handling of such a mismatch is unknown. The reader records the mismatch as a note on the answer; at integration the resolver should surface it, so a preview built from it can say so.
- Inside packages, a type name the RTTI dump doesn't know as a class is refused. A game patch that adds component or struct classes needs `tools/native-rtti-subset.ts --dump <dump> --hashes-only` rerun on a newer dump.
- Windows x64 only (the game's DLL). Another platform would need another decoder, and none is planned.
