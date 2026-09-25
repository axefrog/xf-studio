import { describe, expect, test } from "bun:test";
import { type ArchiveFile, buildMountPlan, DepotIndex, type MountedArchive } from "../src/archive-precedence";
import { readArchiveXlConfig, type XlDocument } from "../src/archivexl-config";
import { ccoPath, loadMergedCco, resolveCharacter } from "../src/character-resolver";
import { depotHash, type DepotRef, refFromPath } from "../src/depot-path";
import { chunkInScene, type FetchedResource, type ResourceFetchPort, ResourceGraph } from "../src/resource-graph";
import { app, cco, cr2w, ent, mesh, meshComponent, morphtarget, rp } from "./resolver-fixtures";

/**
 * What the long-lived resource graph keeps and reports (prepare speed review, `88b5379`): shapes instead of whole mesh, morph
 * target and `.app` documents (PIPE-55), precedence ambiguities from consumer reads only (PIPE-63), an appearance's own parts
 * and patches read only for a provided target (PIPE-64), a custom creator file that could not be read worded as such (PIPE-66),
 * failures that may not repeat counted for consumers only (PIPE-54), and render masks (PIPE-67).
 */
type Archive = { virtualPath: string; files: Record<string, object> };
/** A synthetic installation whose port answers after a tick, counts reads in flight, and marks reads fresh when asked. */
function installation(archives: Archive[], options: { fresh?: boolean; unreadable?: string[]; transient?: boolean; xl?: XlDocument[] } = {}) {
  const files: ArchiveFile[] = archives.map((archive, i) => ({ id: `a${i}:${archive.virtualPath}`, virtualPath: archive.virtualPath,
    provider: "game", providerName: archive.virtualPath.split("/").pop()!, active: true, priority: null }));
  const content = new Map<string, Map<string, object>>(), indexes = new Map<string, BigUint64Array>();
  archives.forEach((archive, i) => {
    const byHash = new Map(Object.entries(archive.files).map(([path, document]) => [depotHash(path), document]));
    content.set(files[i]!.id, byHash);
    indexes.set(files[i]!.id, BigUint64Array.from([...byHash.keys()].map(BigInt)).sort());
  });
  const fetched: string[] = [];
  let inflight = 0;
  const peak = new Map<string, number>();
  const unreadable = new Set((options.unreadable ?? []).map(depotHash));
  const port: ResourceFetchPort = {
    async fetch(archive: MountedArchive, ref: DepotRef): Promise<FetchedResource | null> {
      fetched.push(ref.path ?? ref.hash);
      const kind = /\.([a-z]+)$/.exec(ref.path ?? "")?.[1] ?? "?";
      inflight++; peak.set(kind, Math.max(peak.get(kind) ?? 0, inflight));
      await new Promise(resolve => setTimeout(resolve, 1));
      inflight--;
      const document = unreadable.has(ref.hash) ? undefined : content.get(archive.id)?.get(ref.hash);
      return document ? { document: structuredClone(document), extractedSha256: null, fresh: options.fresh } : null;
    },
    transient: () => options.transient ?? false,
  };
  const depot = new DepotIndex(buildMountPlan(files, null), indexes);
  return { graph: new ResourceGraph(depot, readArchiveXlConfig(options.xl ?? []), port), fetched, peak };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe("what the graph keeps (PIPE-55)", () => {
  const MESH = "base\\v\\hair.mesh", MORPH = "base\\v\\head.morphtarget", APP = "base\\v\\hair.app";
  const bulky = "x".repeat(200_000);
  const archives = (): Archive[] => [{ virtualPath: "archive/pc/content/basegame_1.archive", files: {
    [MESH]: { ...mesh({ appearances: [{ name: "default", chunkMaterials: ["hair"] }], entries: [{ name: "hair", local: false, index: 0 }],
      external: ["base\\v\\hair.mi"], chunks: 2 }), bulky },
    [MORPH]: (() => { const doc = morphtarget(MESH, 2, [["h012", "nose"]]) as { Data: { RootChunk: Record<string, unknown> } };
      doc.Data.RootChunk.targetsData = bulky; return doc; })(),
    [APP]: app([{ name: "a", parts: ["base\\v\\a.ent"] }, { name: "b", parts: ["base\\v\\b.ent"] }]),
  } }];

  test("a mesh, morph target or .app is kept as the shape its model reads; the models are unchanged", async () => {
    const { graph } = installation(archives());
    const model = await graph.mesh(refFromPath(MESH));
    expect(model).toMatchObject({ appearances: [{ name: "default", chunkMaterials: ["hair"] }], entries: [{ name: "hair", local: false, index: 0 }],
      renderChunks: 2, renderChunkLods: [1, 1], renderChunkScene: [true, true] });
    expect(model!.externalMaterials[0]!.ref!.path).toBe("base\\v\\hair.mi");
    const morph = await graph.morph(refFromPath(MORPH));
    expect(morph).toMatchObject({ baseMesh: { path: MESH }, renderChunks: 2, targets: [{ name: "h012", region: "nose" }] });
    const hair = await graph.app(refFromPath(APP));
    expect(hair!.appearances.map(entry => [entry.name, entry.partsValues.map(part => part.path)])).toEqual([["a", ["base\\v\\a.ent"]], ["b", ["base\\v\\b.ent"]]]);
    // The loaded roots keep only their type; the bulk around what the models read is not kept.
    for (const path of [MESH, MORPH, APP]) expect(Object.keys((await graph.load(refFromPath(path)))!.root)).toEqual(["$type"]);
    expect(graph.retainedBytes).toBeGreaterThan(0);
    expect(graph.retainedBytes).toBeLessThan(bulky.length);
    // A model's copy is its own: a second graph over the same documents builds the same models.
    expect(await installation(archives()).graph.mesh(refFromPath(MESH))).toMatchObject({ appearances: model!.appearances });
  });

  test("any other document is kept whole and counted by its JSON length", async () => {
    const { graph } = installation([{ virtualPath: "archive/pc/content/basegame_1.archive", files: { "base\\v\\a.mi": cr2w({ $type: "CMaterialInstance", note: "y".repeat(5000) }) } }]);
    const loaded = await graph.load(refFromPath("base\\v\\a.mi"));
    expect(loaded!.root.note).toBe("y".repeat(5000));
    expect(graph.retainedBytes).toBeGreaterThan(5000);
  });
});

describe("failures that may not repeat (PIPE-54)", () => {
  test("only a consumer's read counts; a prefetched resource nobody asked for does not", async () => {
    const files = { "base\\v\\hair.mesh": mesh({ appearances: [], entries: [], local: [{ $type: "CMaterialInstance", values: [{ $type: "rRef:CHairProfile", HairProfile: rp("base\\v\\tip.hp") }] }] }),
      "base\\v\\tip.hp": cr2w({ $type: "CHairProfile" }) };
    const { graph, fetched } = installation([{ virtualPath: "archive/pc/content/basegame_1.archive", files }], { fresh: true, unreadable: ["base\\v\\tip.hp"], transient: true });
    await graph.mesh(refFromPath("base\\v\\hair.mesh"));
    await settle();
    expect(fetched).toContain("base\\v\\tip.hp");
    expect(graph.loadErrors.size).toBe(1);
    expect(graph.retryableFailures).toBe(0);
    expect(await graph.load(refFromPath("base\\v\\tip.hp"))).toBeNull();
    expect(graph.retryableFailures).toBe(1);
    // A lasting failure (the port says it will repeat) is not one.
    const lasting = installation([{ virtualPath: "archive/pc/content/basegame_1.archive", files }], { unreadable: ["base\\v\\tip.hp"], transient: false });
    expect(await lasting.graph.load(refFromPath("base\\v\\tip.hp"))).toBeNull();
    expect(lasting.graph.retryableFailures).toBe(0);
  });
});

describe("precedence ambiguities come from consumer reads (PIPE-63)", () => {
  const MESH = "base\\v\\hair.mesh", HP = "base\\v\\tip.hp", MT = "base\\v\\hair.mt";
  const base = { [MESH]: mesh({ appearances: [], entries: [], local: [{ $type: "CMaterialInstance", values: [
    { $type: "rRef:CHairProfile", HairProfile: rp(HP) }, { $type: "rRef:CMaterialTemplate", Template: rp(MT) }] }] }),
    [HP]: cr2w({ $type: "CHairProfile" }), [MT]: cr2w({ $type: "CMaterialTemplate" }) };
  // A mod replaces the profile and the template: each lookup meets a mod-over-base ambiguity.
  const archives: Archive[] = [{ virtualPath: "archive/pc/content/basegame_1.archive", files: base },
    { virtualPath: "archive/pc/mod/recolour.archive", files: { [HP]: cr2w({ $type: "CHairProfile" }), [MT]: cr2w({ $type: "CMaterialTemplate" }) } }];
  const read = async (fresh: boolean) => {
    const { graph, fetched } = installation(archives, { fresh });
    const first = await graph.collect(async () => { await graph.mesh(refFromPath(MESH)); await settle(); return graph.load(refFromPath(HP)); });
    // A later V on the same graph reads the (memoised) mesh and the profile again.
    const second = await graph.collect(async () => { await graph.mesh(refFromPath(MESH)); return graph.load(refFromPath(HP)); });
    return { first: first.ambiguities.map(a => a.subject).sort(), second: second.ambiguities.map(a => a.subject).sort(), fetched, graph };
  };

  test("a cold cache (prefetching the template) and a warm one report the same ambiguities; a later V on the graph reports its own", async () => {
    const cold = await read(true), warm = await read(false);
    expect(cold.fetched).toContain(MT);
    expect(warm.fetched).not.toContain(MT);
    expect(cold.first).toEqual([HP]);
    expect(warm.first).toEqual(cold.first);
    expect(cold.second).toEqual([HP]);
    expect([...cold.graph.observedAmbiguities.values()].map(a => a.subject)).toEqual([HP]);
  });
});

describe("what an appearance reads (PIPE-64)", () => {
  const APP = "base\\v\\earring.app", FEMALE_CCO = ccoPath("female", false);
  const parts = (letter: string) => [1, 2].map(n => `base\\v\\${letter}${n}.ent`);
  const files = {
    [FEMALE_CCO]: cco([], {}),
    [APP]: app(["a", "b", "c"].map(name => ({ name, parts: parts(name) }))),
    ...Object.fromEntries(["a", "b", "c"].flatMap(letter => parts(letter).map(path => [path, ent([meshComponent(path, "base\\v\\missing.mesh")])]))),
  };

  test("only the requested appearance's parts are read, together; an .app's parts are not prefetched", async () => {
    const { graph, fetched, peak } = installation([{ virtualPath: "archive/pc/content/basegame_1.archive", files }], { fresh: true });
    await graph.app(refFromPath(APP));
    await settle();
    expect(fetched.filter(path => path.endsWith(".ent"))).toEqual([]);
    const cco = await loadMergedCco(graph, "female");
    await resolveCharacter(graph, { bodyGender: "female", origin: "save", morphs: [],
      appearances: [{ part: "head", group: "TPP", option: "piercings_x", app: refFromPath(APP), definition: "b" }] }, cco);
    expect(fetched.filter(path => path.endsWith(".ent")).sort()).toEqual(parts("b"));
    expect(peak.get("ent")).toBe(2);
  });

  test("a patch of a resource no archive provides is never read", async () => {
    const xl: XlDocument[] = [{ id: "archive/pc/mod/p.xl", document: { resource: { patch: { "mod\\patch.mesh": ["base\\v\\absent.mesh"] } } } }];
    const { graph, fetched } = installation([{ virtualPath: "archive/pc/mod/p.archive", files: { "mod\\patch.mesh": mesh({ appearances: [], entries: [] }) } }], { xl });
    expect(graph.patchesFor(depotHash("base\\v\\absent.mesh"))).toHaveLength(1);
    expect(await graph.mesh(refFromPath("base\\v\\absent.mesh"))).toBeNull();
    await settle();
    expect(fetched).toEqual([]);
  });
});

describe("a custom creator file that could not be read (PIPE-66)", () => {
  test("is reported as unreadable, not as provided by no archive", async () => {
    const custom = "mod\\pretty.inkcharcustomization", missing = "mod\\gone.inkcharcustomization";
    const xl: XlDocument[] = [{ id: "archive/pc/mod/pretty.archive.xl", document: { customizations: { female: [custom, missing] } } }];
    const { graph } = installation([{ virtualPath: "archive/pc/content/basegame_4_appearance.archive", files: { [ccoPath("female", false)]: cco([], {}) } },
      { virtualPath: "archive/pc/mod/pretty.archive", files: { [custom]: cco([], {}) } }], { unreadable: [custom], xl });
    const merged = await loadMergedCco(graph, "female");
    expect(merged.gaps.map(gap => [gap.code, gap.subject]).sort()).toEqual([["custom-cco-missing", missing], ["custom-cco-unreadable", custom]]);
    expect(merged.gaps.find(gap => gap.subject === custom)!.detail).toContain("could not be extracted or converted");
  });
});

describe("render masks (PIPE-67)", () => {
  test("only a missing mask counts as drawn", () => {
    expect(chunkInScene(undefined)).toBe(true);
    expect(chunkInScene(null)).toBe(true);
    expect(chunkInScene("")).toBe(false);
    expect(chunkInScene("MCF_RenderInShadows")).toBe(false);
    expect(chunkInScene("MCF_RenderInScene, MCF_RenderInShadows")).toBe(true);
    expect(chunkInScene(0)).toBe(false);
    expect(chunkInScene(3)).toBe(true);
    expect(chunkInScene({})).toBe(false);
  });
});
