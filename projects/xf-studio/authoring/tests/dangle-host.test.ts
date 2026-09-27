import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMountPlan, DepotIndex } from "../src/archive-precedence";
import { readArchiveXlConfig } from "../src/archivexl-config";
import { dangleSpecKey, serveDangle } from "../src/dangle-host";
import { refFromPath } from "../src/depot-path";
import { ResourceGraph } from "../src/resource-graph";

// A dangle rig and graph in the resolver's JSON shape (as tests/dangle-spec.test.ts builds them, reduced to one link).
const cn = (value: string) => ({ $type: "CName", $storage: "string", $value: value });
const ti = (name: string) => ({ $type: "animTransformIndex", name: cn(name) });
const qs = (t: [number, number, number] = [0, 0, 0]) => ({ $type: "QsTransform", Translation: { $type: "Vector4", X: t[0], Y: t[1], Z: t[2], W: 0 },
  Rotation: { $type: "Quaternion", i: 0, j: 0, k: 0, r: 1 }, Scale: { $type: "Vector4", X: 1, Y: 1, Z: 1, W: 1 } });
const rig = (headHeight = 1.6) => ({ $type: "animRig", boneNames: ["Root", "Head", "c1", "c2"].map(cn), boneParentIndexes: [-1, 0, 1, 2],
  boneTransforms: [qs(), qs([0, 0, headHeight]), qs([0.05, 0, 0]), qs([0.05, 0, 0])] });
let handle = 0;
const H = (data: object) => ({ HandleId: String(handle++), Data: data });
function graph(mass = 0.4): object {
  const simulation = { $type: "animDangleConstraint_SimulationDyng",
    particlesContainer: { $type: "animDyngParticlesContainer", particles: [{ $type: "animDyngParticle", bone: ti("c1"), isFree: 0, mass }, { $type: "animDyngParticle", bone: ti("c2"), mass }] },
    dyngConstraint: H({ $type: "animDyngConstraintMulti", innerConstraints: [H({ $type: "animDyngConstraintLink", bone1: ti("c1"), bone2: ti("c2") })] }) };
  let link: object = H({ $type: "animAnimNode_ReferencePoseTerminator" });
  for (const node of [{ $type: "animAnimNode_SharedMetaPose" }, { $type: "animAnimNode_PoseLsToMs" }, { $type: "animAnimNode_Dangle", dangleConstraint: H(simulation) },
    { $type: "animAnimNode_PoseMsToLs" }]) link = H({ ...node, inputLink: { $type: "animPoseLink", node: link } });
  return { $type: "animAnimGraph", rootNode: H({ $type: "animAnimNode_Root", nodes: [H({ $type: "animAnimNode_Output", node: { $type: "animPoseLink", node: link } })] }) };
}
const doc = (root: object) => ({ Header: {}, Data: { RootChunk: root } });

const RIG = "base\\test\\hair_dangle.rig", GRAPH = "base\\test\\hair_dangle.animgraph";
const dangle = { component: "hair_dangle", rig: { ref: refFromPath(RIG) }, graph: { ref: refFromPath(GRAPH) }, drivenBy: "" } as never;

/** One archive holding the rig and graph, answering with the given documents and content hashes; counts fetches. */
function graphOver(files: { rig: object; rigSha: string | null; graph: object; graphSha: string | null }) {
  const hashes = [refFromPath(RIG).hash, refFromPath(GRAPH).hash].map(BigInt).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const archive = { id: "x.archive", virtualPath: "archive/pc/mod/x.archive", provider: "manual" as const, providerName: "Test", active: true, priority: null };
  const plan = buildMountPlan([archive], null);
  const fetched: string[] = [];
  const port = { fetch: async (_archive: unknown, ref: { hash: string }) => {
    fetched.push(ref.hash);
    return ref.hash === refFromPath(RIG).hash ? { document: doc(files.rig), extractedSha256: files.rigSha } : { document: doc(files.graph), extractedSha256: files.graphSha };
  } };
  return { graph: new ResourceGraph(new DepotIndex(plan, new Map([["x.archive", BigUint64Array.from(hashes)]])), readArchiveXlConfig([]), port, false), fetched };
}
const specOf = (store: string, file: string) => JSON.parse(readFileSync(join(store, "records", file), "utf8"));
const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);

const stores: string[] = [];
const newStore = () => { const dir = mkdtempSync(join(tmpdir(), "xfs-dangle-host-")); stores.push(dir); return dir; };
afterEach(() => { for (const dir of stores.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("dangle spec cache key", () => {
  const key = (rigSha: string | null, graphSha: string | null, labels = ["r.rig", "g.animgraph"]) =>
    dangleSpecKey({ sha256: rigSha, label: labels[0]! }, graphSha === undefined ? null : { sha256: graphSha, label: labels[1]! });
  test("is the content identity of both files and their labels", () => {
    expect(key(A, B)).toMatch(/^[0-9a-f]{64}$/);
    expect(key(A, B)).toBe(key(A, B));
    expect(key(C, B)).not.toBe(key(A, B));
    expect(key(A, C)).not.toBe(key(A, B));
    expect(key(A, B, ["other.rig", "g.animgraph"])).not.toBe(key(A, B));
    expect(dangleSpecKey({ sha256: A, label: "r.rig" }, null)).not.toBe(key(A, B));
  });
  test("is null when a file's content identity is unknown", () => {
    expect(key(null, B)).toBeNull();
    expect(key(A, null)).toBeNull();
  });
});

describe("serveDangle", () => {
  test("compiles once per content: an unchanged rig and graph are served from the cache across graphs (restarts)", async () => {
    const store = newStore(), log: string[] = [];
    const first = await serveDangle(graphOver({ rig: rig(), rigSha: A, graph: graph(0.4), graphSha: B }).graph, dangle, store, line => log.push(line));
    expect(first.entry).not.toBeNull();
    expect(readdirSync(join(store, "dangle-specs"))).toHaveLength(1);
    // Same content hashes, different documents: the cached spec answers, so the second document is never compiled.
    const again = graphOver({ rig: rig(), rigSha: A, graph: graph(2), graphSha: B });
    const second = await serveDangle(again.graph, dangle, store, line => log.push(line));
    expect(second).toEqual(first);
    expect(specOf(store, second.entry!.file).simulation.particles[0].mass).toBe(0.4);
    // The rig and graph are still read (a preparation's reads stay complete for its manifest).
    expect(again.fetched.sort()).toEqual([refFromPath(RIG).hash, refFromPath(GRAPH).hash].sort());
    expect(log).toEqual([]);
  });

  test("a changed graph or rig (a mod update) compiles again", async () => {
    const store = newStore();
    const first = await serveDangle(graphOver({ rig: rig(), rigSha: A, graph: graph(0.4), graphSha: B }).graph, dangle, store, () => {});
    const graphChanged = await serveDangle(graphOver({ rig: rig(), rigSha: A, graph: graph(2), graphSha: C }).graph, dangle, store, () => {});
    expect(graphChanged.entry!.sha256).not.toBe(first.entry!.sha256);
    expect(specOf(store, graphChanged.entry!.file).simulation.particles[0].mass).toBe(2);
    const rigChanged = await serveDangle(graphOver({ rig: rig(1.7), rigSha: C, graph: graph(0.4), graphSha: B }).graph, dangle, store, () => {});
    expect(rigChanged.entry!.sha256).not.toBe(first.entry!.sha256);
    expect(readdirSync(join(store, "dangle-specs"))).toHaveLength(3);
  });

  test("a cached entry whose record was cleared compiles again", async () => {
    const store = newStore();
    const first = await serveDangle(graphOver({ rig: rig(), rigSha: A, graph: graph(0.4), graphSha: B }).graph, dangle, store, () => {});
    rmSync(join(store, "records", first.entry!.file));
    const second = await serveDangle(graphOver({ rig: rig(), rigSha: A, graph: graph(2), graphSha: B }).graph, dangle, store, () => {});
    expect(existsSync(join(store, "records", second.entry!.file))).toBe(true);
    expect(specOf(store, second.entry!.file).simulation.particles[0].mass).toBe(2);
  });

  test("a refusal is cached and logged each time", async () => {
    const store = newStore(), log: string[] = [];
    const bad = { ...rig(), boneParentIndexes: [-1, 0, 1, 1.5] };
    const first = await serveDangle(graphOver({ rig: bad, rigSha: A, graph: graph(), graphSha: B }).graph, dangle, store, line => log.push(line));
    expect(first.entry).toBeNull();
    const second = await serveDangle(graphOver({ rig: rig(), rigSha: A, graph: graph(), graphSha: B }).graph, dangle, store, line => log.push(line));
    expect(second).toEqual(first);
    expect(log).toHaveLength(2);
    expect(log[1]).toBe(log[0]);
  });

  test("nothing is cached without content hashes", async () => {
    const store = newStore();
    const served = await serveDangle(graphOver({ rig: rig(), rigSha: null, graph: graph(), graphSha: null }).graph, dangle, store, () => {});
    expect(served.entry).not.toBeNull();
    expect(existsSync(join(store, "dangle-specs"))).toBe(false);
  });
});
