// Bridge 0.8.18: the combat stand-ins (npc.spawn casts fighter_melee and fighter_pistol, and the engage option), offline:
// the two TweakXL records are well-formed clones of real street-gang grunts, the catalogue's casts equal the plugin's
// table, the records ship in the test profile's -writes package only, and the plugin service (the self-test host runs
// core/Npc.cpp) takes the casts with the stance rules. Proves nothing about the game: whether a hostile gang grunt starts
// the fight is the 0.8.18 session card's rows.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CommandApi } from "../api/command-api.ts";
import { NPC_CASTS } from "../api/catalogue080npc.ts";
import { findCommand } from "../api/catalogue.ts";
import { validate } from "../api/schema.ts";
import { NPC_ACTORS_FILE, stageVariant, VARIANTS, type Variant } from "../packaging.ts";
import { HOOK_TIMEOUT_MS, projectDir, startSelftestHost, tempDir, type Host } from "./helpers.ts";

type Any = any;
const FIGHTERS = ["fighter_melee", "fighter_pistol"] as const;
const yaml = (Bun as Any).YAML.parse(readFileSync(join(projectDir, "tweaks", "test-profile", "xf_npc_actors.yaml"), "utf8"));
const npcSource = readFileSync(join(projectDir, "native", "src", "core", "Npc.cpp"), "utf8");

describe("0.8.18 combat stand-ins: isolation from the world's factions (review)", () => {
  test("the fighters are in their own attitude group, which has no parent, no hostile pair and a neutral default", () => {
    const group = yaml["Attitudes.Group_XFSFighter"];
    expect(group).toBeDefined();
    expect(group.$type).toBe("gamedataAttitudeGroup_Record");
    expect(group.name).toBe("xfs_fighter");
    expect(group.parent).toBeUndefined(); // a parent would bring its relations
    expect(group.defaultAttitude).toBe("Neutral"); // towards every group it has no explicit relation to
    expect(group.attitudeToSelf).toBe("Friendly");
    for (const cast of FIGHTERS) {
      const record = yaml[`Character.xfs_actor_${cast}`];
      expect(record.baseAttitudeGroup).toBe("xfs_fighter"); // never the Scavengers' own, which is hostile to the Maelstrom
      expect(record.squadParamsID).toBe("FactionSquads.GenericSquad");
      expect(JSON.stringify(record)).not.toMatch(/scavenger"|ScavengersSquad/);
    }
  });

  test("the file writes no relation between groups and touches no vanilla attitude record", () => {
    const keys = Object.keys(yaml);
    // The only Attitudes.* key is the new group; no Attitude record (a pair's relation) of any kind, no vanilla group edited.
    expect(keys.filter((k) => k.startsWith("Attitudes."))).toEqual(["Attitudes.Group_XFSFighter"]);
    for (const [key, value] of Object.entries<Any>(yaml)) {
      if (value && typeof value === "object") expect(value.$type, key).not.toBe("gamedataAttitude_Record");
    }
    const text = readFileSync(join(projectDir, "tweaks", "test-profile", "xf_npc_actors.yaml"), "utf8");
    expect(text).not.toMatch(/^\s*group[12]:/m);
    // The bridge never writes a group relation either (SetAttitudeRelation and its persistent variants change the world's groups).
    for (const file of ["XFRuntimeBridgeNpc.reds", "XFRuntimeBridgeDm.reds"]) {
      const src = readFileSync(join(projectDir, file.includes("Dm") ? "redscript-dm" : "redscript", file), "utf8");
      expect(src, file).not.toMatch(/SetAttitudeRelation|SetAttitudeGroupRelation|SetAttitudeTowardsAgentGroup/);
    }
  });

  test("a fighter is checked against the live attitude system when it appears, and moved to the plain neutral group if it is not isolated", () => {
    const reds = readFileSync(join(projectDir, "redscript", "XFRuntimeBridgeNpc.reds"), "utf8");
    const isolate = reds.slice(reds.indexOf("public static func Isolate("), reds.indexOf("public static func Prepare("));
    expect(isolate).toContain('Equals(group, n"xfs_fighter")');
    expect(isolate).toContain("attitudes.GetAttitudeRelation(group, other)");
    for (const group of ["maelstrom", "scavenger", "police", "civilian"]) expect(isolate, group).toContain(`n"${group}"`);
    expect(isolate).toContain('agent.SetAttitudeGroup(n"neutral");');
    expect(isolate).toContain("XFBridgeLog.Warn");
    // It runs for fighters before the directed attitude towards V is set.
    const prepare = reds.slice(reds.indexOf("public static func Prepare("));
    expect(prepare.indexOf('if StrContains(entry.record, "xfs_actor_fighter_") { XFNpc.Isolate(entry, puppet); }')).toBeGreaterThan(-1);
    expect(prepare.indexOf("XFNpc.Isolate(entry, puppet)")).toBeLessThan(prepare.indexOf("agent.SetAttitudeTowards(player.GetAttitudeAgent(), stance);"));
  });
});

describe("0.8.18 combat stand-ins: the records", () => {
  test("each fighter cast has a TweakXL clone of a street-gang grunt (not a crowd record), on the base game's gang template", () => {
    for (const cast of FIGHTERS) {
      const record = yaml[`Character.xfs_actor_${cast}`];
      expect(record, cast).toBeDefined();
      // A real combat-capable base record: a tier-1 grunt of the Scavengers (REDmod scavengers.tweak), never a crowd record.
      expect(record.$base).toMatch(/^Character\.scavenger_grunt1_(melee1_fists|ranged1_slaughtomatic)_ma$/);
      expect(record.isCrowd).toBe(false);
      expect(String(record.entityTemplatePath)).toBe(String.raw`base\characters\entities\gang\gang__scavenger_ma.ent`);
      expect(record.affiliation).toBe("Factions.Unaffiliated");
      expect(record.priority).toBe("SpawnableObjectPriority.Regular");
      expect(record.objectActions).toEqual([]);
      expect(record.savable).toBe(false);
      expect(record.lootDrop).toBe("LootTables.Empty");
      expect(record.dropsWeaponOnDeath).toBe(false);
      // The gang's own reaction preset is what makes it fight, so it is neither replaced nor given a civilian twin.
      expect(record.reactionPreset).toBeUndefined();
      expect(yaml[`Character.xfs_actor_${cast}_reactive`]).toBeUndefined();
    }
    expect(yaml["Character.xfs_actor_fighter_melee"].$base).toContain("melee1_fists");
    expect(yaml["Character.xfs_actor_fighter_pistol"].$base).toContain("ranged1_slaughtomatic");
  });

  test("the tools' cast list and the plugin's table agree, and the fighters are marked combat", () => {
    for (const cast of FIGHTERS) {
      expect(NPC_CASTS).toContain(cast);
      expect(npcSource).toContain(`{"${cast}", "Character.xfs_actor_${cast}", "man_average", "Fighter", false, {}, false, true}`);
    }
    const spawn = findCommand("npc_spawn")!;
    const castSchema = (spawn.input as Any).properties.cast;
    expect(castSchema.enum).toEqual([...NPC_CASTS]);
    expect(validate(spawn.input, { cast: "fighter_melee", ahead_m: 6, attitude: "hostile", immortal: false, engage: true })).toEqual([]);
    expect(validate(spawn.input, { cast: "fighter_unknown", ahead_m: 6 }).length).toBeGreaterThan(0);
  });

  test("the records ship in the test profile's -writes package only, as the other XF actors do", () => {
    const work = tempDir("xfb-combat-pkg-");
    const dll = join(work, "XFRuntimeBridge.dll");
    writeFileSync(dll, "stand-in DLL XFB_BUILD=0000000000000000000000000000000000000000;dirty=0");
    writeFileSync(join(work, "xfb_companion_probe.exe"), "stand-in companion probe");
    for (const variant of VARIANTS as readonly Variant[]) {
      const stageDir = join(work, variant);
      const manifest = stageVariant({ projectDir, variant, dll, stageDir, version: "0.0.0", commit: "0".repeat(40) });
      const shipped = manifest.files.some((f) => f.path === NPC_ACTORS_FILE);
      expect(shipped, variant).toBe(variant === "writes");
      if (variant === "writes") {
        const staged = readFileSync(join(stageDir, NPC_ACTORS_FILE), "utf8");
        for (const cast of FIGHTERS) expect(staged).toContain(`Character.xfs_actor_${cast}:`);
      } else {
        expect(manifest.files.some((f) => /xf_npc_actors|fighter/.test(f.path)), variant).toBe(false);
      }
    }
  });
});

describe("0.8.18 combat stand-ins: npc.spawn against the plugin's service", () => {
  let host: Host;
  let api: CommandApi;
  const bridge = async (method: string, params: Record<string, unknown> = {}): Promise<Any> => {
    const response = await api.callBridge(method, params, `t-${method}`);
    expect(response.ok, `${method} ${JSON.stringify(response)}`).toBe(true);
    return response.ok ? response.result : null;
  };
  beforeAll(async () => {
    host = await startSelftestHost(["--allow-writes", "--write-classes", "photo,world,character,save,showroom,player,npc"], 120);
    api = new CommandApi({ runtimeDir: host.dir, captureRoot: join(tempDir("xfb-combat-cap-"), "captures"), auditDir: tempDir("xfb-combat-audit-"), idleCloseMs: 300 });
    await bridge("selftest.npc", { speed: 8 });
    await bridge("selftest.player", { busy: "", position: [100, 200, 10], yaw: 0 });
  }, HOOK_TIMEOUT_MS);
  afterAll(async () => {
    await host?.stop();
  });

  const spawn = async (input: Record<string, unknown>): Promise<Any> => api.run("npc.spawn", input);

  test("a hostile, mortal fighter takes its own record, with the gang's reactions, and is a stand-in", async () => {
    const out = await spawn({ cast: "fighter_melee", ahead_m: 5, attitude: "hostile", immortal: false });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.result).toMatchObject({ cast: "fighter_melee", record: "Character.xfs_actor_fighter_melee", attitude: "hostile", immortal: false, reactions: "game", engage: false });
    expect(out.result.stand_in_note).toContain("handed_back");
    expect(out.result.combat_note).toBeUndefined();
    await api.run("npc.release", { who: out.result.who });
  }, 30_000);

  test("engage needs hostile; quiet reactions are refused for a fighter; a friendly fighter is told it won't fight", async () => {
    const wrong = await spawn({ cast: "fighter_pistol", ahead_m: 5, engage: true });
    expect(wrong.ok).toBe(false);
    expect(wrong.ok ? "" : wrong.error.code).toBe("bad_params");
    const quiet = await spawn({ cast: "fighter_melee", ahead_m: 5, attitude: "hostile", reactions: "quiet" });
    expect(quiet.ok).toBe(false);
    expect(quiet.ok ? "" : quiet.error.code).toBe("bad_params");
    const friendly = await spawn({ cast: "fighter_pistol", ahead_m: 5 });
    expect(friendly.ok, JSON.stringify(friendly)).toBe(true);
    expect(friendly.result).toMatchObject({ record: "Character.xfs_actor_fighter_pistol", attitude: "friendly", reactions: "game" });
    expect(friendly.result.combat_note).toContain("attitude hostile");
    await api.run("npc.release", { who: friendly.result.who });
  }, 30_000);

  test("engage on a hostile fighter is answered and shown in the status", async () => {
    const out = await spawn({ cast: "fighter_melee", ahead_m: 5, attitude: "hostile", engage: true });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.result).toMatchObject({ attitude: "hostile", immortal: true, engage: true });
    const status = await api.run("npc.status", {});
    expect(status.ok).toBe(true);
    const entry = (status.ok ? (status.result as Any).npcs : []).find((n: Any) => n.who === out.result.who);
    expect(entry).toMatchObject({ cast: "fighter_melee", engage: true, attitude: "hostile" });
    const casts = (status.ok ? (status.result as Any).casts : []) as Any[];
    expect(casts.filter((c) => c.combat).map((c) => c.cast).sort()).toEqual([...FIGHTERS]);
    await api.run("npc.release", { who: out.result.who });
  }, 30_000);
});
