import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGradingLut } from "../src/browser-grading-lut-device";
import { GradingLutHost } from "../src/grading-lut-host";
import { CREATOR_ENVIRONMENT, decodeGradingLut, decodeGradingLutBinary, displayTransform, encodeGradingLut, invertNeutralAxis,
  logC3Decode, logC3Encode, lutCoordinate, neutralGradingLut, readEnvironmentGrading, sampleGradingLut, selectGradingLut, srgbDecode,
  VANILLA_SDR_LUT, type GradingLut } from "../src/grading-lut";
import { depotHash } from "../src/depot-path";
import type { Installation } from "../src/resolver-host";
import { WolvenKitRunError } from "../src/wolvenkit-cli";
import { cr2w, fixtureInstallation, rp } from "./resolver-fixtures";

/** A WolvenKit-shaped CBitmapTexture LUT whose texel (r, g, b) holds `value(r, g, b)`, blob in [B][G][R] order. */
function lutDocument(size: number, value: (r: number, g: number, b: number) => [number, number, number], setup: object = {}) {
  const floats = new Float32Array(size ** 3 * 4);
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const i = ((b * size + g) * size + r) * 4;
    floats.set([...value(r, g, b), 1], i);
  }
  return cr2w({ $type: "CBitmapTexture", width: size, height: size, depth: size,
    setup: { $type: "STextureGroupSetup", rawFormat: "TRF_HDRFloat", compression: "TCM_None", group: "TEXG_Generic_LUT", ...setup },
    renderTextureResource: { $type: "rendRenderTextureResource", renderResourceBlobPC: { HandleId: "0", Data: { $type: "rendRenderTextureBlobPC",
      header: { $type: "rendRenderTextureBlobHeader", textureInfo: { $type: "rendRenderTextureBlobTextureInfo", type: "TEXTYPE_3D" } },
      textureData: { BufferId: "0", Flags: 131072, Bytes: Buffer.from(floats.buffer).toString("base64") } } } } });
}
const constantLut = (level: number) => lutDocument(2, () => [level, level, level]);
const environment = (ldrPath: string, input = "CMF_ArriLogC") => cr2w({ $type: "worldEnvironmentDefinition", areaParameters: [{ HandleId: "34",
  Data: { $type: "ColorGradingAreaSettings", enable: 1, forceHdrLut: 1,
    ldrLut: { $type: "ColorGradingLutParams", inputMapping: input, outputMapping: "CMF_Linear", LUT: rp(ldrPath) },
    hdrLut: { $type: "ColorGradingLutParams", inputMapping: "CMF_ArriLogC", outputMapping: "CMF_Linear", LUT: rp("base\\weather\\hdr.xbm") } } }] });

describe("display transform", () => {
  test("ARRI LogC3 (EI 800) as compiled, and the texel-centre coordinate", () => {
    expect(logC3Encode(0.18)).toBeCloseTo(0.391007, 5);
    expect(logC3Encode(0)).toBeCloseTo(0.092809, 6);
    for (const x of [0, 0.005, 0.18, 1, 10]) expect(logC3Decode(logC3Encode(x))).toBeCloseTo(x, 5);
    expect(lutCoordinate(0, 32)).toBeCloseTo(0.5 / 32, 9);
    expect(lutCoordinate(1, 32)).toBeCloseTo(31.5 / 32, 9);
  });

  test("the neutral LUT reduces the transform to clamp and sRGB encode", () => {
    const neutral = neutralGradingLut(32);
    expect(displayTransform([0.18, 0.18, 0.18], 1, neutral).map(v => Math.round(v * 255))).toEqual([118, 118, 118]);
    expect(displayTransform([4, 4, 4], 1, neutral)[0]).toBeCloseTo(1, 9);
    // Exposure scales scene light before the grade.
    expect(displayTransform([0.09, 0.09, 0.09], 2, neutral)[0]).toBeCloseTo(displayTransform([0.18, 0.18, 0.18], 1, neutral)[0], 3);
    // Inverting the grey response recovers the scene value.
    expect(invertNeutralAxis(neutral, srgbDecode(118 / 255))).toBeCloseTo(0.18, 2);
  });
});

describe("LUT resources", () => {
  test("decode a serialized 3D LUT in [B][G][R] order and sample it trilinearly", () => {
    const lut = decodeGradingLut(lutDocument(2, (r, g, b) => [r, g * 2, b * 3]));
    expect(lut.size).toBe(2);
    expect(sampleGradingLut(lut, 1, 0, 0)).toEqual([1, 0, 0]);
    expect(sampleGradingLut(lut, 0, 1, 0)).toEqual([0, 2, 0]);
    expect(sampleGradingLut(lut, 0, 0, 1)).toEqual([0, 0, 3]);
    expect(sampleGradingLut(lut, 0.5, 0.5, 0.5)).toEqual([0.5, 1, 1.5]);
    const round = decodeGradingLutBinary(encodeGradingLut(lut));
    expect(round.size).toBe(2); expect([...round.data]).toEqual([...lut.data]);
  });

  test("refuse what is not a supported LUT", () => {
    expect(() => decodeGradingLut(lutDocument(2, () => [0, 0, 0], { rawFormat: "TRF_TrueColor" }))).toThrow("format");
    const trimmed = lutDocument(2, () => [0, 0, 0]) as any;
    trimmed.Data.RootChunk.renderTextureResource.renderResourceBlobPC.Data.textureData.Bytes = { $trimmedBase64Length: 10 };
    expect(() => decodeGradingLut(trimmed)).toThrow("missing");
    const flat = lutDocument(2, () => [0, 0, 0]) as any; flat.Data.RootChunk.depth = 1;
    expect(() => decodeGradingLut(flat)).toThrow("cube");
    expect(() => decodeGradingLutBinary(new Uint8Array(20))).toThrow();
  });

  test("read the environment's SDR and HDR LUT slots", () => {
    expect(readEnvironmentGrading(environment("base\\x\\lut.xbm"))).toEqual({ forceHdrLut: true,
      ldr: { path: "base\\x\\lut.xbm", inputMapping: "CMF_ArriLogC", outputMapping: "CMF_Linear" },
      hdr: { path: "base\\weather\\hdr.xbm", inputMapping: "CMF_ArriLogC", outputMapping: "CMF_Linear" } });
    expect(readEnvironmentGrading(cr2w({ $type: "worldEnvironmentDefinition" }))).toBeNull();
  });
});

describe("LUT selection by archive precedence", () => {
  // Generic archive names: nothing here or in the code names a real mod.
  const archives = (withMods: boolean) => fixtureInstallation([
    { virtualPath: "archive/pc/content/basegame_3_nightcity.archive", files: { [VANILLA_SDR_LUT]: constantLut(0.1) } },
    ...(withMods ? [
      { virtualPath: "archive/pc/mod/###-lut-b.archive", files: { [VANILLA_SDR_LUT]: constantLut(0.3) } },
      { virtualPath: "archive/pc/mod/#####-lut-a.archive", files: { [VANILLA_SDR_LUT]: constantLut(0.2) } },
    ] : []),
  ]);
  const reader = (documents: Map<string, unknown>, broken: string[] = []) => async (archive: { name: string }, path: string) => {
    if (broken.includes(archive.name)) throw Error("unreadable");
    return decodeGradingLut(documents.get(`${archive.name}|${path}`));
  };
  const documents = new Map<string, unknown>([
    [`basegame_3_nightcity.archive|${VANILLA_SDR_LUT}`, constantLut(0.1)],
    [`###-lut-b.archive|${VANILLA_SDR_LUT}`, constantLut(0.3)],
    [`#####-lut-a.archive|${VANILLA_SDR_LUT}`, constantLut(0.2)],
  ]);
  const level = (lut: GradingLut | null) => lut ? Math.round(lut.data[0]! * 10) / 10 : null;

  test("the winning mod archive's LUT is used, with the losers recorded", async () => {
    const { graph } = archives(true);
    const result = await selectGradingLut({ environmentPath: VANILLA_SDR_LUT, lookup: path => graph.locate({ hash: depotHash(path), path }).lookup, read: reader(documents) });
    expect(result.source).toMatchObject({ kind: "installed", archive: "#####-lut-a.archive", group: "mod",
      alternatives: ["###-lut-b.archive", "basegame_3_nightcity.archive"] });
    expect(result.source.note).toContain("#####-lut-a.archive");
    expect(level(result.lut)).toBe(0.2);
  });

  test("vanilla alone, then the base copy when the winner is unreadable, then neutral", async () => {
    const lookupOf = (graph: ReturnType<typeof archives>["graph"]) => (path: string) => graph.locate({ hash: depotHash(path), path }).lookup;
    const vanilla = await selectGradingLut({ environmentPath: VANILLA_SDR_LUT, lookup: lookupOf(archives(false).graph), read: reader(documents) });
    expect(vanilla.source).toMatchObject({ kind: "installed", archive: "basegame_3_nightcity.archive", group: "content" });
    expect(vanilla.source.note).toBe("Colour grading: the game's own LUT.");
    const fallback = await selectGradingLut({ environmentPath: VANILLA_SDR_LUT, lookup: lookupOf(archives(true).graph),
      read: reader(documents, ["#####-lut-a.archive"]) });
    expect(fallback.source).toMatchObject({ kind: "vanilla-fallback", archive: "basegame_3_nightcity.archive" });
    expect(fallback.source.skipped).toEqual(["#####-lut-a.archive: unreadable"]);
    expect(level(fallback.lut)).toBe(0.1);
    const none = await selectGradingLut({ environmentPath: VANILLA_SDR_LUT, lookup: lookupOf(archives(true).graph),
      read: reader(documents, ["#####-lut-a.archive", "basegame_3_nightcity.archive"]) });
    expect(none.source.kind).toBe("neutral");
    expect(none.lut).toBeNull();
    // An environment naming a path no archive provides falls back to the base game's vanilla LUT.
    const moved = await selectGradingLut({ environmentPath: "base\\elsewhere\\missing.xbm", lookup: lookupOf(archives(true).graph), read: reader(documents) });
    expect(moved.source).toMatchObject({ kind: "vanilla-fallback", depotPath: VANILLA_SDR_LUT });
  });
});

describe("host and browser transport", () => {
  test("the host follows the environment to the winning LUT, caches the decoded cube, and the browser loads it", async () => {
    const root = mkdtempSync(join(tmpdir(), "xfs-lut-")), cli = join(root, "wk.exe");
    writeFileSync(cli, "fake");
    try {
      const fixture = fixtureInstallation([
        { virtualPath: "archive/pc/content/basegame_2_mainmenu.archive", files: { [CREATOR_ENVIRONMENT]: environment(VANILLA_SDR_LUT) } },
        { virtualPath: "archive/pc/content/basegame_3_nightcity.archive", files: { [VANILLA_SDR_LUT]: constantLut(0.1) } },
        { virtualPath: "archive/pc/mod/lut-a.archive", files: { [VANILLA_SDR_LUT]: constantLut(0.25) } },
      ]);
      let extracted = 0;
      const host = new GradingLutHost({ cacheRoot: root, resolverCache: join(root, "resolver"),
        settings: () => ({ gameRoot: root, launchRoute: "direct", mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: cli }),
        open: () => fixture as unknown as Installation,
        extract: async (_cli, archive) => { extracted++; return archive.name === "lut-a.archive" ? constantLut(0.25) : constantLut(0.1); } });
      expect(host.request().phase).toBe("preparing");
      await host.settled();
      const state = host.request();
      expect(state).toMatchObject({ phase: "ready", source: { kind: "installed", archive: "lut-a.archive" } });
      expect(state.file).toMatch(/^[a-f0-9]{64}\.bin$/);
      expect(host.filePath("../secret.bin")).toBeNull();
      expect(extracted).toBe(1);
      // The browser device polls the endpoint and downloads the decoded cube.
      const served = async (url: string) => url.startsWith("/assets/grading-lut/")
        ? new Response(Bun.file(host.filePath(url.slice("/assets/grading-lut/".length))!)) : Response.json(host.request());
      const loaded = await loadGradingLut(served);
      expect(loaded.source.archive).toBe("lut-a.archive");
      expect(loaded.lut!.data[0]).toBeCloseTo(0.25, 6);
      // A host that is not set up answers with the neutral grade and a plain note.
      const bare = new GradingLutHost({ cacheRoot: root, resolverCache: root,
        settings: () => ({ gameRoot: null, launchRoute: "direct", mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: null }) });
      bare.request(); await bare.settled();
      expect(bare.request()).toMatchObject({ phase: "ready", file: null, source: { kind: "neutral" } });
      expect((await loadGradingLut(async () => new Response("no", { status: 500 }))).source.kind).toBe("neutral");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  const lutFixture = () => fixtureInstallation([
    { virtualPath: "archive/pc/content/basegame_2_mainmenu.archive", files: { [CREATOR_ENVIRONMENT]: environment(VANILLA_SDR_LUT) } },
    { virtualPath: "archive/pc/content/basegame_3_nightcity.archive", files: { [VANILLA_SDR_LUT]: constantLut(0.1) } },
    { virtualPath: "archive/pc/mod/lut-a.archive", files: { [VANILLA_SDR_LUT]: constantLut(0.25) } },
  ]) as unknown as Installation;

  test("a WolvenKit failure answers neutral with a plain note and is retried later (PREV-30, PREV-31)", async () => {
    const root = mkdtempSync(join(tmpdir(), "xfs-lut-")), cli = join(root, "wk.exe");
    writeFileSync(cli, "fake");
    try {
      let now = 0, extracted = 0;
      let failure: WolvenKitRunError | null = new WolvenKitRunError("runtime_missing", "WolvenKit.CLI.exe unbundle needs a .NET runtime that isn't installed.");
      const fixture = lutFixture();
      const host = new GradingLutHost({ cacheRoot: root, resolverCache: join(root, "resolver"), now: () => now, retryAfterMs: 1_000,
        settings: () => ({ gameRoot: root, launchRoute: "direct", mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: cli }),
        open: () => fixture,
        extract: async (_cli, archive) => { extracted++; if (failure) throw failure; return archive.name === "lut-a.archive" ? constantLut(0.25) : constantLut(0.1); } });
      host.request(); await host.settled();
      const failed = host.request();
      expect(failed).toMatchObject({ phase: "ready", file: null, source: { kind: "neutral" } });
      expect(failed.source!.note).toContain(".NET runtime");
      // Within the retry interval the answer stands; after it, the next request prepares again.
      now = 999;
      expect(host.request().phase).toBe("ready");
      now = 1_000; failure = null;
      expect(host.request().phase).toBe("preparing");
      await host.settled();
      expect(host.request()).toMatchObject({ phase: "ready", source: { kind: "installed", archive: "lut-a.archive" } });
      // A success is not retried; the decoded cube is cached per archive, decoder and WolvenKit identity.
      const count = extracted;
      now = 60_000;
      expect(host.request().phase).toBe("ready");
      expect(extracted).toBe(count);
      writeFileSync(cli, "another WolvenKit build");
      host.request(); await host.settled();
      expect(extracted).toBe(count + 1);
      expect(host.request()).toMatchObject({ phase: "ready", source: { kind: "installed", archive: "lut-a.archive" } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("a changed installation cancels the running LUT preparation; only the newer answer is kept (PREV-30)", async () => {
    const root = mkdtempSync(join(tmpdir(), "xfs-lut-")), cli = join(root, "wk.exe");
    writeFileSync(cli, "fake");
    try {
      let route: "direct" | "mo2" = "direct";
      const signals: AbortSignal[] = [];
      const fixture = lutFixture();
      const host = new GradingLutHost({ cacheRoot: root, resolverCache: join(root, "resolver"),
        settings: () => ({ gameRoot: root, launchRoute: route, mo2Root: null, mo2ProfileId: null, manualModRoot: null, wolvenKitCli: cli }),
        open: () => fixture,
        extract: (_cli, _archive, _hash, _dir, signal) => new Promise((resolve, reject) => {
          signals.push(signal!);
          if (signals.length > 1) { resolve(constantLut(0.25)); return; }
          signal!.addEventListener("abort", () => reject(new WolvenKitRunError("cancelled", "WolvenKit.CLI.exe unbundle was cancelled.")), { once: true });
        }) });
      expect(host.request().phase).toBe("preparing");
      for (let i = 0; i < 100 && !signals.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
      expect(signals).toHaveLength(1);
      route = "mo2";
      expect(host.request().phase).toBe("preparing");
      expect(signals[0]!.aborted).toBe(true);
      await host.settled();
      expect(host.request()).toMatchObject({ phase: "ready", source: { kind: "installed", archive: "lut-a.archive" } });
      expect(signals).toHaveLength(2);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
