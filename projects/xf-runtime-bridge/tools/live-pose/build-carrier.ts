// Builds the live-posing experiment's test package "XF Live Pose (test)" into the ignored dist/:
// the carrier set (one clip, xfs_live_carrier, every joint of woman_base.rig as a constant rotation and
// translation key at the rig's reference pose), its ArchiveXL attachment to V's photo-mode puppets, and
// TweakXL records for an "XF Live" category holding one pose, "XF Live Carrier". For the XF test profile
// only; never distributed, never installed by this script.
//
//   bun tools/live-pose/build-carrier.ts --rig <WolvenKit JSON of woman_base.rig> [--wolvenkit <WolvenKit.CLI.exe>]
//
// The rig comes from the player's own game files (a WolvenKit serialisation of
// base\characters\base_entities\woman_base\woman_base.rig); only its reference transforms are used.
// WolvenKit 9.0.1 turns the planned JSON into the set and packs the archive; the set is then read back
// through WolvenKit and checked key by key against the plan (the verifier), and the keys hash the plugin's
// pose.live.read reports is recorded in the manifest for comparison in game.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { CARRIER, carrierProblems, carrierSetJson, carrierTweak, carrierXl, decodeSet, keysHash, planCarrier, readRig } from "./carrier.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const rigPath = option("--rig");
const wolvenkit = option("--wolvenkit") ?? process.env.XFB_WOLVENKIT_CLI ?? "F:/Games/RedModding/WolvenKit.Console-9.0.1/WolvenKit.CLI.exe";
if (!rigPath || !existsSync(rigPath)) {
  console.error("pass --rig <WolvenKit JSON of base\\characters\\base_entities\\woman_base\\woman_base.rig, from your own game files>");
  process.exit(2);
}
if (!existsSync(wolvenkit)) {
  console.error(`WolvenKit CLI not found at ${wolvenkit} (pass --wolvenkit or set XFB_WOLVENKIT_CLI)`);
  process.exit(2);
}

const projectDir = resolve(import.meta.dir, "..", "..");
const version = /project\(\s*XFRuntimeBridge\s+VERSION\s+([0-9.]+)/m.exec(readFileSync(join(projectDir, "native", "CMakeLists.txt"), "utf8"))?.[1];
if (!version) throw new Error("could not read the version from native/CMakeLists.txt");
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const work = join(projectDir, "dist", "live-pose");
rmSync(work, { recursive: true, force: true });
const setRelative = CARRIER.set.replaceAll("\\", "/");
const jsonDir = join(work, "json", dirname(setRelative));
const packRoot = join(work, CARRIER.archive); // WolvenKit names the archive after this folder
const packDir = join(packRoot, dirname(setRelative));
const verifyDir = join(work, "verify");
for (const dir of [jsonDir, packDir, verifyDir]) mkdirSync(dir, { recursive: true });

const wk = (...commandArgs: string[]) => {
  const result = spawnSync(wolvenkit, commandArgs, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0 || /\b(error|exception)\b/i.test(output.replace(/0 errors?/gi, ""))) {
    throw new Error(`WolvenKit ${commandArgs[0]} failed (exit ${result.status}):\n${output}`);
  }
  return output;
};

// 1. Plan the keys and write the set as WolvenKit JSON.
const rig = readRig(JSON.parse(readFileSync(rigPath, "utf8")));
if (rig.names.length !== 71 || rig.names[2] !== "Hips") throw new Error(`expected woman_base.rig (71 joints, Hips third), got ${rig.names.length} joints`);
const plan = planCarrier(rig);
const hash = keysHash(plan.keys);
const setName = basename(setRelative);
const jsonPath = join(jsonDir, `${setName}.json`);
writeFileSync(jsonPath, JSON.stringify(carrierSetJson(rig, plan, new Date().toISOString()), null, 2));

// 2. JSON to the set (CR2W), into the folder that becomes the archive.
wk("convert", "deserialize", jsonPath, "-o", packDir);
const setPath = join(packDir, setName);
if (!existsSync(setPath)) throw new Error(`WolvenKit wrote no ${setName} into ${packDir}`);

// 3. The verifier: read the built set back through WolvenKit and compare every key with the plan.
wk("convert", "serialize", setPath, "-o", verifyDir);
const backPath = readdirSync(verifyDir).map((n) => join(verifyDir, n)).find((p) => p.endsWith(".json"));
if (!backPath) throw new Error("WolvenKit wrote no JSON when reading the set back");
const back = JSON.parse(readFileSync(backPath, "utf8"));
const clips = decodeSet(back);
const problems: string[] = [];
if (clips.length !== 1 || clips[0].name !== CARRIER.clip) problems.push(`the set holds ${clips.map((c) => c.name).join(", ") || "nothing"}, not only ${CARRIER.clip}`);
const clip = clips[0];
if (clip) {
  problems.push(...carrierProblems(clip));
  if (clip.keys.length !== plan.keys.length) problems.push(`${clip.keys.length} constant keys, planned ${plan.keys.length}`);
  plan.keys.forEach((key, i) => {
    const got = clip.keys[i];
    if (!got || got.joint !== key.joint || got.channel !== key.channel || got.wSign !== key.wSign || got.x !== key.x || got.y !== key.y || got.z !== key.z) {
      problems.push(`key ${i} (joint ${key.joint}, channel ${key.channel}) differs from the plan`);
    }
  });
  if (clip.tracks.length !== plan.tracks.length || plan.tracks.some((t, i) => clip.tracks[i]?.track !== t.track || clip.tracks[i]?.value !== t.value)) {
    problems.push("the constant track keys differ from the plan");
  }
  if (keysHash(clip.keys) !== hash) problems.push("the keys hash differs from the plan's");
}
const root = back.Data.RootChunk;
if ((root.fallbackAnimFrameDescs ?? []).length || (root.fallbackDataAddresses ?? []).length) problems.push("the set carries fallback frames (none were planned)");
if (root.rig?.DepotPath?.$value !== CARRIER.rig) problems.push(`the set's rig is ${root.rig?.DepotPath?.$value}`);
if (problems.length) {
  console.error(`verifier FAILED:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

// 4. Pack the archive.
wk("pack", packRoot, "-o", work);
const archive = join(work, `${CARRIER.archive}.archive`);
if (!existsSync(archive)) throw new Error(`WolvenKit wrote no ${CARRIER.archive}.archive`);

// 5. Stage the package (paths relative to the game folder, an MO2 mod root) and zip it.
const stage = join(work, "stage");
const put = (to: string, from?: string, text?: string) => {
  const target = join(stage, to);
  mkdirSync(dirname(target), { recursive: true });
  if (from) cpSync(from, target);
  else writeFileSync(target, text!);
};
put(`archive/pc/mod/${CARRIER.archive}.archive`, archive);
put(`archive/pc/mod/${CARRIER.archive}.archive.xl`, undefined, carrierXl());
put("r6/tweaks/XFLivePoseTest/xf_live_pose_test.yaml", undefined, carrierTweak());
const listFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? listFiles(join(dir, name)) : [join(dir, name)]));
const files = listFiles(stage).map((path) => ({ path: relative(stage, path).replaceAll("\\", "/"), bytes: statSync(path).size, sha256: sha256(path) }));
const wkVersion = (spawnSync(wolvenkit, ["--version"], { encoding: "utf8" }).stdout ?? "").trim();
const manifest = {
  name: "XF Live Pose (test)",
  version,
  purpose: "The live-posing experiment's carrier pose (research/animation/pose-editor-design.md §7.4). XF test profile only; never distributed.",
  set: CARRIER.set,
  clip: CARRIER.clip,
  record: CARRIER.record,
  category: CARRIER.category,
  labels: { pose: CARRIER.poseLabel, category: CARRIER.categoryLabel },
  keys: { constant: plan.keys.length, tracks: plan.tracks.length, joints: rig.names.length, pose: "the rig's reference pose" },
  keys_hash: hash,
  joint_names: rig.names,
  rig_source_sha256: sha256(rigPath),
  wolvenkit: wkVersion || "9.0.1",
  verified: "read back through WolvenKit: one clip, only constant joint keys, one rotation per joint, every key equal to the plan, no fallback frames",
  requires: { archivexl: "1.27.3 or later", tweakxl: "1.11.4 or later" },
  files,
};
// TweakXL reads only .yaml, .yml and .tweak, so the manifest beside the records is never loaded.
put("r6/tweaks/XFLivePoseTest/xf_live_pose_test.manifest.json", undefined, JSON.stringify(manifest, null, 2) + "\n");

const zip = join(projectDir, "dist", `xf-live-pose-test-${version}.zip`);
rmSync(zip, { force: true });
const tarExe = join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe");
const tar = spawnSync(tarExe, ["-a", "-c", "-f", zip, "-C", stage, "archive", "r6"], { encoding: "utf8" });
if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`);
console.log(`${zip}\n  sha256 ${sha256(zip)}  (XF Live Pose test package; the XF test profile only)`);
for (const file of files) console.log(`  ${file.sha256.slice(0, 16)}  ${file.path}`);
console.log(`  keys_hash ${hash} (compare with pose_live_read's keys_hash, or pass it as expect_hash)`);
console.log("\nNothing was installed.");
