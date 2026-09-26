// The WolvenKit repair route's adapter (code-health PIPE-86, PIPE-87): `createWolvenKitMeshRepair` over a fake WolvenKit that writes
// what each command would, so its argument order, work-folder layout, packed archive, every missing output and the repair's own
// wording are checked without launching the tool.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { archiveExportSource, GameAssetExportError } from "../src/game-asset-export";
import { createWolvenKitMeshRepair, uncookArguments } from "../src/game-asset-export-wolvenkit";
import type { JsonObject } from "../src/red-json";
import { WolvenKitRunError, type runWolvenKit } from "../src/wolvenkit-cli";

const root = mkdtempSync(join(tmpdir(), "xfs-mesh-repair-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const PONY = "anru\\highpony\\fhair_highpony_pony.mesh", NAME = "fhair_highpony_pony.mesh";

/** A serialized mesh with `positions` bone positions for `bones` bones; `singular` makes the added bones' matrices non-invertible. */
function serializedMesh(bones: number, positions: number, singular = false): JsonObject {
  const vector = (X: number, Y: number, Z: number, W: number) => ({ $type: "Vector4", X, Y, Z, W });
  const matrix = (x: number) => singular ? { $type: "Matrix", X: vector(0, 0, 0, 0), Y: vector(0, 0, 0, 0), Z: vector(0, 0, 0, 0), W: vector(0, 0, 0, 1) }
    : { $type: "Matrix", X: vector(0, 1, 0, 0), Y: vector(-1, 0, 0, 0), Z: vector(0, 0, 1, 0), W: vector(0, x, -1.6, 1) };
  return { Header: {}, Data: { RootChunk: { $type: "CMesh",
    boneNames: Array.from({ length: bones }, (_, i) => ({ $type: "CName", $storage: "string", $value: `bone_${i}` })),
    boneRigMatrices: Array.from({ length: bones }, (_, i) => matrix(-i / 100)),
    renderResourceBlob: { HandleId: "0", Data: { $type: "rendRenderMeshBlob", header: { bonePositions: Array.from({ length: positions }, () => vector(9, 9, 9, 1)) } } } } } };
}

type Step = "serialize" | "deserialize" | "pack" | "uncook";
/**
 * A fake WolvenKit: each command writes what the real one does, unless `silent` names it (it then writes nothing) or `fail` names it
 * (it throws `fail.error`). Every launch's arguments are recorded.
 */
function fakeWolvenKit(options: { mesh?: JsonObject | string; silent?: Step; fail?: { step: Step; error: unknown } } = {}) {
  const launches: string[][] = [];
  const run = (async (_cli, args) => {
    launches.push([...args]);
    const step: Step = args[0] === "convert" ? args[1] as Step : args[0] as Step;
    if (options.fail?.step === step) throw options.fail.error;
    const out = args[args.indexOf("-o") + 1]!;
    if (options.silent !== step) {
      if (step === "serialize") writeFileSync(join(out, `${basename(args[2]!)}.json`), typeof options.mesh === "string" ? options.mesh : JSON.stringify(options.mesh ?? serializedMesh(5, 2)));
      if (step === "deserialize") for (const file of readdirSync(args[2]!)) writeFileSync(join(out, file.replace(/\.json$/, "")), "repaired mesh resource");
      if (step === "pack") writeFileSync(join(out, "pack.archive"), "archive");
      if (step === "uncook") {
        const stem = join(out, ...PONY.replace(/\.mesh$/, "").split("\\"));
        mkdirSync(join(stem, ".."), { recursive: true });
        writeFileSync(`${stem}.glb`, "glTF"); writeFileSync(`${stem}.Material.json`, "{}");
      }
    }
    return { exitCode: 0, stdout: "", stderr: "", output: "" };
  }) as typeof runWolvenKit;
  return { run, launches };
}

let work = 0;
/** Repair the pony mesh in a fresh work folder with `wolvenKit`. */
async function repairWith(wolvenKit: ReturnType<typeof fakeWolvenKit>) {
  const dir = join(root, `work-${work++}`), raw = join(root, `raw-${work}.mesh`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(raw, "raw mesh");
  const source = archiveExportSource(join(root, "hair.archive"), join(root, "game"));
  const outcome = await createWolvenKitMeshRepair("wk.exe", 1000, wolvenKit.run)({ source, depotPath: PONY, raw, workDir: dir });
  return { outcome, dir, source };
}

describe("the WolvenKit mesh repair adapter (PIPE-87)", () => {
  test("four launches in order, over the work folder's own layout, packing the repaired mesh alone at its depot path", async () => {
    const wolvenKit = fakeWolvenKit();
    const { outcome, dir, source } = await repairWith(wolvenKit);
    const stem = join(dir, "out", "anru", "highpony", "fhair_highpony_pony");
    expect(outcome).toEqual({ outcome: "repaired", glb: `${stem}.glb`, materials: `${stem}.Material.json`,
      detail: "its render data lists 2 bone positions for 5 bones, so the exported copy fills in the other 3 from the bones' own rig matrices" });
    expect(wolvenKit.launches).toEqual([
      ["convert", "serialize", join(dir, "raw", NAME), "-o", join(dir, "json")],
      ["convert", "deserialize", join(dir, "fixed-json"), "-o", join(dir, "fixed")],
      ["pack", join(dir, "pack"), "-o", join(dir, "archive")],
      uncookArguments(join(dir, "archive", "pack.archive"), [PONY], join(dir, "out"), source.gameRoot),
    ]);
    // The raw copy, the repaired document and the packed resource are where the launches read them.
    expect(readFileSync(join(dir, "raw", NAME), "utf8")).toBe("raw mesh");
    const fixed = JSON.parse(readFileSync(join(dir, "fixed-json", `${NAME}.json`), "utf8"));
    expect(fixed.Data.RootChunk.renderResourceBlob.Data.header.bonePositions).toHaveLength(5);
    expect(readFileSync(join(dir, "pack", "anru", "highpony", NAME), "utf8")).toBe("repaired mesh resource");
    // The uncook reads the packed archive and the game folder, for the mesh's materials.
    expect(wolvenKit.launches[3]).toContain("-gp");
    expect(wolvenKit.launches[3]).toContain(source.gameRoot);
  });

  test("a step that writes nothing is a failed outcome naming that step, and no later step runs", async () => {
    for (const [silent, detail, launches] of [["serialize", "WolvenKit wrote no serialized mesh", 1], ["deserialize", "WolvenKit wrote no repaired mesh", 2],
      ["pack", "WolvenKit wrote no archive", 3], ["uncook", "WolvenKit wrote no GLB for the repaired copy", 4]] as const) {
      const wolvenKit = fakeWolvenKit({ silent });
      expect((await repairWith(wolvenKit)).outcome).toEqual({ outcome: "failed", step: silent, detail });
      expect(wolvenKit.launches).toHaveLength(launches);
    }
    // WolvenKit's serialized output that isn't JSON is its failure too.
    const garbled = fakeWolvenKit({ mesh: "{ not json" });
    expect((await repairWith(garbled)).outcome).toEqual({ outcome: "failed", step: "serialize", detail: "WolvenKit's serialized mesh isn't valid JSON" });
  });

  test("a mesh the repair doesn't fit is not applicable, and nothing is packed", async () => {
    const wolvenKit = fakeWolvenKit({ mesh: serializedMesh(5, 5) });
    expect((await repairWith(wolvenKit)).outcome).toEqual({ outcome: "not-applicable", detail: "no known repair fits this mesh" });
    expect(wolvenKit.launches.map(args => args.slice(0, 2).join(" "))).toEqual(["convert serialize"]);
  });

  test("bones whose rig matrices can't be inverted are placed at the origin, and the detail says so", async () => {
    const { outcome } = await repairWith(fakeWolvenKit({ mesh: serializedMesh(4, 1, true) }));
    expect(outcome.outcome).toBe("repaired");
    expect(outcome.detail).toBe("its render data lists 1 bone position for 4 bones, so the exported copy fills in the other 3 from the bones' own rig matrices " +
      "(3 at the origin, their matrices can't be inverted)");
  });

  test("WolvenKit failing at a step is a failed outcome; cancellation, a missing tool and other errors are thrown (PIPE-86)", async () => {
    const failing = await repairWith(fakeWolvenKit({ fail: { step: "pack", error: new WolvenKitRunError("tool_failed", "WolvenKit pack exited with 1.") } }));
    expect(failing.outcome).toEqual({ outcome: "failed", step: "pack", detail: "WolvenKit's pack failed: WolvenKit pack exited with 1." });
    const slow = await repairWith(fakeWolvenKit({ fail: { step: "uncook", error: new WolvenKitRunError("tool_timeout", "WolvenKit uncook timed out.") } }));
    expect(slow.outcome).toMatchObject({ outcome: "failed", step: "uncook" });
    await expect(repairWith(fakeWolvenKit({ fail: { step: "serialize", error: new WolvenKitRunError("cancelled", "cancelled") } })))
      .rejects.toBeInstanceOf(GameAssetExportError);
    await expect(repairWith(fakeWolvenKit({ fail: { step: "serialize", error: new WolvenKitRunError("tool_missing", "missing") } })))
      .rejects.toMatchObject({ code: "tool_missing" });
    const disk = Object.assign(Error("EIO: i/o error, write"), { code: "EIO" });
    await expect(repairWith(fakeWolvenKit({ fail: { step: "deserialize", error: disk } }))).rejects.toBe(disk);
    expect(existsSync(root)).toBe(true);
  });
});
