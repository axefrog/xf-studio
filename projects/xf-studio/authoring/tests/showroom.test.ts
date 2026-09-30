// XF Finish Showroom: the resource definitions (head, plate and pedestal per preset; the creator rig in the head's frame) and
// the independent verifier, driven with stand-in WolvenKit tools. The real build (WolvenKit, the game's plate) is exercised by
// tools/build_showroom_package.ts, recorded in the pipeline guide.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { CREATOR_HEAD_SLOT, CREATOR_RIG_FEMALE } from "../src/creator-lighting";
import {
  aimQuaternion, entityTemplate, HEAD_JOINT, NECK_CUT_Z, pedestalBoxes, rigAppearanceResource, rigLights, RIG_PROFILES, rigAppearance,
  showroomAppearanceResource, showroomCollectionId, showroomComponentId, showroomPaths, studioToEntity,
} from "../src/showroom/resources";
import { showroomCollection } from "../src/showroom/build";
import { verifyShowroomArchive } from "../src/showroom/verify";
import type { GeneratedFile, VerifierTools } from "../src/platform/api";

const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) <= e;

describe("showroom resources", () => {
  test("the showroom's collection ID is its own, stable and UUID-shaped; its copy drops the package plan", async () => {
    const id = "0200a5e5-2e55-4c02-9d0b-0000000000d0";
    const derived = showroomCollectionId(id);
    expect(derived).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(derived).toBe(showroomCollectionId(id.toUpperCase()));
    expect(derived).not.toBe(id);
    const copy = showroomCollection({ schema: "xfas/collection-1", id, name: "Board", presets: [], packagePlan: { schema: "xfs/package-plan-1" } });
    expect(copy.collection.id).toBe(derived);
    expect(copy.collection.name).toBe("Board · showroom");
    expect("packagePlan" in copy.collection).toBe(false);
    expect(copy.sourceId).toBe(id);
  });

  test("paths are the collection depot's showroom folder, and component IDs fit a signed 64-bit number", async () => {
    const paths = showroomPaths("axefrog/appearance_studio/collections/4426018f6966620881cdcb78569544ab");
    expect(paths.entity).toBe("axefrog/appearance_studio/collections/4426018f6966620881cdcb78569544ab/showroom/xfs_showroom.ent");
    expect(paths.archive).toBe("xfs_showroom_4426018f6966620881cdcb78569544ab");
    expect(() => showroomPaths("axefrog/elsewhere")).toThrow();
    for (const name of ["face_rig", "xfs_head", "xfs_light_main_face"]) expect(BigInt(showroomComponentId(name)) < 2n ** 63n).toBe(true);
  });

  test("the creator head slot lands on the head joint, and each light aims along its table axis", async () => {
    const slot = studioToEntity(CREATOR_HEAD_SLOT.female);
    expect(slot.every((v, i) => near(v, HEAD_JOINT[i]!))).toBe(true);
    for (const light of rigLights("creator")) {
      const [x, y, z, w] = light.orientation;
      const aimed = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
      expect(aimed.every((v, i) => near(v, light.axis[i]!, 1e-9))).toBe(true);
    }
    expect(aimQuaternion([0, -1, 0])).toEqual([0, 0, 1, 0]);
  });

  test("profiles: creator is the whole rig with its shadow flags, creator_face the lights that reach the head unshadowed, key Main_Face", async () => {
    expect(rigLights("creator").map(l => l.name)).toEqual(CREATOR_RIG_FEMALE.map(l => l.name));
    expect(rigLights("creator").filter(l => l.localShadows).map(l => l.name)).toEqual(CREATOR_RIG_FEMALE.filter(l => l.shadows).map(l => l.name));
    const face = rigLights("creator_face").map(l => l.name);
    expect(face).not.toContain("Main_Feet");
    expect(face).toContain("Main_Face");
    expect(rigLights("creator_face").some(l => l.localShadows || l.contactShadows)).toBe(false);
    expect(rigLights("key").map(l => [l.name, l.contactShadows])).toEqual([["Main_Face", true]]);
  });

  test("each preset's appearance has the face rig, head, eyes, its own plate appearance and the pedestal under the neck", async () => {
    const app = showroomAppearanceResource([{ appearance: "xfs_p1" }, { appearance: "xfs_p2" }], "a/models/xfs_eye_plate.mesh", { skin: "01_ca_pale", eyes: "gradient_brown" });
    const appearances = app.Data.RootChunk.appearances.map((a: any) => a.Data);
    expect(appearances.map((a: any) => a.name.$value)).toEqual(["xfs_p1", "xfs_p2"]);
    const plate = appearances[1].components.find((c: any) => c.name.$value === "xfs_plate");
    expect(plate.meshAppearance.$value).toBe("xfs_p2");
    expect(plate.mesh.DepotPath.$value).toBe("a\\models\\xfs_eye_plate.mesh");
    const boxes = pedestalBoxes();
    expect(boxes.map(b => b.name)).toEqual(["xfs_pedestal"]);
    const column = boxes[0]!;
    // Session 5: the head floated over a column 8 mm above the cut; the neck now sits 6 cm down into it, and the column
    // reaches 1.5 m below the origin so a head raised to the camera's eye line still stands on the floor.
    expect(column.position[2] + column.scale[2]).toBeCloseTo(NECK_CUT_Z + 0.0583, 3);
    expect(column.position[2]).toBeLessThanOrEqual(-1);
    expect(appearances[0].components.length).toBe(5);
    const entity = entityTemplate("a/showroom/xfs_showroom.app", ["xfs_p1", "xfs_p2"]).Data.RootChunk;
    expect(entity.entity.Data.$type).toBe("gameObject");
    expect(entity.defaultAppearance.$value).toBe("xfs_p1");
  });
});

// --- the verifier with stand-in tools --------------------------------------------------------------------

const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
function listFiles(root: string): GeneratedFile[] {
  const out: GeneratedFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else { const data = readFileSync(path); out.push({ path: relative(root, path).split(sep).join("/"), bytes: data.length, sha256: sha(data) }); }
    }
  };
  walk(root);
  return out.sort((a, b) => a.path < b.path ? -1 : 1);
}

/** A staged showroom tree whose "CR2W" members are their JSON, and tools that unbundle by copying and serialize by renaming. */
function fixture(tamper?: (json: Record<string, any>) => void) {
  const root = mkdtempSync(join(tmpdir(), "xfs-showroom-")), depot = "axefrog/appearance_studio/collections/4426018f6966620881cdcb78569544ab";
  const staged = join(root, "staged"), eye = join(root, "eye");
  const pieces = ["xfs_p0170d3e01f014a519c3e000000000005", "xfs_p0170d3e01f014a519c3e000000000006"];
  const plateJson = { Data: { RootChunk: { appearances: pieces.map((name, i) => ({ HandleId: String(i + 1), Data: { name: { $value: name } } })) } } };
  const members: Record<string, any> = {
    [`${depot}/models/xfs_eye_plate.mesh`]: plateJson,
    [`${depot}/textures/${pieces[0]}_diffuse.xbm`]: "texture-a",
    [`${depot}/textures/${pieces[1]}_diffuse.xbm`]: "texture-b",
    [`${depot}/showroom/xfs_showroom.app`]: showroomAppearanceResource(pieces.map(appearance => ({ appearance })), `${depot}/models/xfs_eye_plate.mesh`, { skin: "01_ca_pale", eyes: "gradient_brown" }),
    [`${depot}/showroom/xfs_showroom.ent`]: entityTemplate(`${depot}/showroom/xfs_showroom.app`, pieces),
    [`${depot}/showroom/xfs_showroom_rig.app`]: rigAppearanceResource(),
    [`${depot}/showroom/xfs_showroom_rig.ent`]: entityTemplate(`${depot}/showroom/xfs_showroom_rig.app`, RIG_PROFILES.map(rigAppearance)),
  };
  tamper?.(members);
  for (const [path, value] of Object.entries(members)) {
    for (const base of path.includes("/showroom/") ? [staged] : [staged, eye]) {
      const target = join(base, ...path.split("/"));
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
    }
  }
  const archive = join(root, "packed.archive");
  writeFileSync(archive, "archive-bytes");
  const tools: VerifierTools = {
    unbundle: async (_archive, output) => { cpSync(staged, output, { recursive: true }); return { exitCode: 0, stdout: "", stderr: "" }; },
    serialize: async (input, output) => {
      for (const name of readdirSync(input as string)) cpSync(join(input as string, name), join(output, `${name}.json`));
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    exportTextures: async () => { throw Error("not used"); },
  };
  return { root, depot, pieces, archive, tools, files: listFiles(staged), eye, eyeFiles: listFiles(eye) };
}

const verify = (f: ReturnType<typeof fixture>) => verifyShowroomArchive({ archive: f.archive, archiveSha256: sha("archive-bytes"), files: f.files, tools: f.tools,
  work: join(f.root, "verify"), expected: { depot: f.depot, pieces: f.pieces, skin: "01_ca_pale", eyes: "gradient_brown", eyeUnbundled: f.eye, eyeFiles: f.eyeFiles } });

describe("showroom verifier", () => {
  test("accepts a showroom built from its definitions and reports its limits", async () => {
    const report = await verify(fixture());
    expect(report.pieces).toBe(2);
    expect(report.rigLights).toEqual({ xfs_rig_creator: 15, xfs_rig_creator_face: rigLights("creator_face").length, xfs_rig_key: 1 });
    expect(report.gameRenderingVerified).toBe(false);
  });

  test("refuses a light that differs from the creator rig table", async () => {
    const f = fixture(members => {
      const app = members[Object.keys(members).find(k => k.endsWith("xfs_showroom_rig.app"))!];
      app.Data.RootChunk.appearances[0].Data.components[0].intensity = 41;
    });
    await expect(verify(f)).rejects.toThrow(/Main_Face has other lumens/);
  });

  test("refuses a head bound to something else, another skin, or a plate appearance the plate lacks", async () => {
    await expect(verify(fixture(members => {
      const app = members[Object.keys(members).find(k => k.endsWith("xfs_showroom.app"))!];
      app.Data.RootChunk.appearances[0].Data.components[1].meshAppearance.$value = "03_ca_senna";
    }))).rejects.toThrow(/xfs_head is not/);
    await expect(verify(fixture(members => {
      const plate = members[Object.keys(members).find(k => k.endsWith("xfs_eye_plate.mesh"))!];
      plate.Data.RootChunk.appearances.pop();
    }))).rejects.toThrow(/the plate has no appearance/);
  });

  test("refuses a texture that differs from the verified eye-makeup build", async () => {
    const f = fixture();
    writeFileSync(join(f.eye, ...`${f.depot}/textures/${f.pieces[0]}_diffuse.xbm`.split("/")), "other");
    await expect(verify(f)).rejects.toThrow(/differs from the verified eye-makeup build/);
  });
});
