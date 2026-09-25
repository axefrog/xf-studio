import { describe, expect, test } from "bun:test";
import { type ArchiveFile, buildMountPlan, DepotIndex, parseArchiveModlist } from "../src/archive-precedence";
import { depotHash, isDecimalHash, sanitizeDepotPath } from "../src/depot-path";
import { parseRdarHeader, parseRdarIndexHashes } from "../src/rdar-index";

const file = (virtualPath: string, extra: Partial<ArchiveFile> = {}): ArchiveFile => ({ id: `${extra.providerName ?? "game"}:${virtualPath}`,
  virtualPath, provider: "game", providerName: "game", active: true, priority: null, ...extra });
const index = (plan: ReturnType<typeof buildMountPlan>, contents: Record<string, string[]>) =>
  new DepotIndex(plan, new Map(plan.archives.map(archive => [archive.id,
    BigUint64Array.from((contents[archive.name] ?? []).map(path => BigInt(depotHash(path)))).sort()])));

describe("depot paths", () => {
  test("hash the engine's sanitized path", () => {
    expect(sanitizeDepotPath("\"/Base//Characters\\Head/x.APP\"")).toBe("base\\characters\\head\\x.app");
    // Known resource hashes recorded from the reference save and archives.
    expect(depotHash("archive_xl/characters/head/player_base_heads/appearances/head/he_000_pwa__basehead.app")).toBe("7132639559252259433");
    expect(depotHash("ep1\\characters\\head\\player_base_heads\\appearances\\head\\face_rig\\h0_000__basehead_face_rig_ep1.app")).toBe("14034739559546167190");
    expect(depotHash("eagul\\piercingmorphs\\female\\fpm72.morphtarget")).toBe("13024786168400224632");
    expect(depotHash("")).toBe("0");
    expect(isDecimalHash("18446744073709551615")).toBe(true);
    expect(isDecimalHash("18446744073709551616")).toBe(false);
  });

  test("read an RDAR index", () => {
    const header = new Uint8Array(24); header.set([82, 68, 65, 82]);
    const view = new DataView(header.buffer); view.setBigUint64(8, 100n, true); view.setUint32(16, 28 + 2 * 56, true);
    expect(parseRdarHeader(header)).toEqual({ indexOffset: 100, indexSize: 140 });
    const block = new Uint8Array(140), blockView = new DataView(block.buffer);
    blockView.setUint32(16, 2, true); blockView.setBigUint64(28, 9n, true); blockView.setBigUint64(84, 3n, true);
    expect([...parseRdarIndexHashes(block)]).toEqual([3n, 9n]);
    blockView.setUint32(16, 3, true);
    expect(() => parseRdarIndexHashes(block)).toThrow();
    expect(() => parseRdarHeader(new Uint8Array(24))).toThrow();
  });
});

describe("mount plan", () => {
  test("MO2: overwrite, then the first modlist row, wins a virtual archive path; disabled copies do not mount", () => {
    const plan = buildMountPlan([
      file("archive/pc/mod/a.archive", { provider: "mo2-mod", providerName: "low", priority: 1 }),
      file("archive/pc/mod/a.archive", { provider: "mo2-mod", providerName: "high", priority: 5 }),
      file("archive/pc/mod/b.archive", { provider: "mo2-mod", providerName: "early", priority: 9 }),
      file("archive/pc/mod/b.archive", { provider: "mo2-overwrite", providerName: "overwrite", priority: 10 }),
      file("archive/pc/mod/c.archive", { provider: "mo2-mod", providerName: "off", priority: 3, active: false }),
    ], null);
    const a = plan.archives.find(x => x.name === "a.archive")!, b = plan.archives.find(x => x.name === "b.archive")!;
    expect(a.providerName).toBe("high");
    expect(a.shadowed.map(s => s.providerName)).toEqual(["low"]);
    expect(b.providerName).toBe("overwrite");
    expect(plan.archives.some(x => x.name === "c.archive")).toBe(false);
    expect(plan.unmounted.map(u => u.file.providerName)).toEqual(["off"]);
  });

  test("an MO2 copy over a game-folder file is chosen but recorded as unproven", () => {
    const plan = buildMountPlan([file("archive/pc/mod/x.archive"), file("archive/pc/mod/x.archive", { provider: "mo2-mod", providerName: "mod", priority: 0 })], null);
    expect(plan.archives[0]!.providerName).toBe("mod");
    expect(plan.ambiguities.map(a => a.code)).toContain("vfs-mo2-over-game-folder");
  });

  test("groups search mod, ArchiveXL bundle, ep1, then content; unsupported locations are listed, not mounted", () => {
    const plan = buildMountPlan([
      file("archive/pc/content/basegame_4_appearance.archive"), file("archive/pc/ep1/ep1_2_gamedata.archive"),
      file("red4ext/plugins/ArchiveXL/Bundle/ArchiveXL.archive"), file("archive/pc/mod/zz.archive"),
      file("archive/pc/mod/sub/nested.archive"), file("mods/redmod/archives/r.archive"),
    ], null);
    expect(plan.archives.map(a => a.group)).toEqual(["mod", "archivexl-bundle", "ep1", "content"]);
    expect(plan.archives.map(a => a.rank)).toEqual([0, 1, 2, 3]);
    expect(plan.ep1Installed).toBe(true);
    expect(plan.unmounted.map(u => u.file.virtualPath)).toEqual(["archive/pc/mod/sub/nested.archive", "mods/redmod/archives/r.archive"]);
  });

  test("mod archives: first alphabetical wins; a visible modlist.txt reorders and unlisted archives follow", () => {
    const files = [file("archive/pc/mod/PRC_z_999_Framework.archive"), file("archive/pc/mod/PRC_f_72_ring.archive"), file("archive/pc/mod/other.archive")];
    const shared = "eagul\\piercingmorphs\\female\\fpm72.morphtarget";
    const alphabetical = index(buildMountPlan(files, null), { "PRC_z_999_Framework.archive": [shared], "PRC_f_72_ring.archive": [shared] });
    const found = alphabetical.lookup(depotHash(shared));
    expect(found.winner!.name).toBe("PRC_f_72_ring.archive");
    expect(found.rule.rule).toBe("mod-order-alphabetical");
    expect(found.candidates.map(c => c.name)).toEqual(["PRC_f_72_ring.archive", "PRC_z_999_Framework.archive"]);
    const listed = buildMountPlan(files, "PRC_z_999_Framework.archive\r\n# comment\n");
    expect(listed.modOrder).toBe("modlist");
    expect(listed.archives.map(a => a.name)).toEqual(["PRC_z_999_Framework.archive", "other.archive", "PRC_f_72_ring.archive"]);
    expect(index(listed, { "PRC_z_999_Framework.archive": [shared], "PRC_f_72_ring.archive": [shared] }).lookup(depotHash(shared)).winner!.name)
      .toBe("PRC_z_999_Framework.archive");
    expect(parseArchiveModlist("﻿A.archive\n\n#x\nB.archive")).toEqual(["a.archive", "b.archive"]);
  });

  test("records unproven precedence: mod over base, base-internal collisions and case-sensitive collation", () => {
    const plan = buildMountPlan([file("archive/pc/mod/a_mod.archive"), file("archive/pc/mod/B_mod.archive"),
      file("archive/pc/content/basegame_1_engine.archive"), file("archive/pc/content/basegame_4_appearance.archive")], null);
    const idx = index(plan, { "a_mod.archive": ["x.app", "c.app"], "B_mod.archive": ["c.app"], "basegame_1_engine.archive": ["x.app", "y.app"], "basegame_4_appearance.archive": ["y.app"] });
    const overBase = idx.lookup(depotHash("x.app"));
    expect(overBase.rule.rule).toBe("mod-over-content");
    expect(overBase.ambiguities.map(a => a.code)).toEqual(["mod-over-base-native-unread"]);
    const internal = idx.lookup(depotHash("y.app"));
    expect(internal.rule.grade).toBe("hypothesis");
    expect(internal.ambiguities.map(a => a.code)).toEqual(["base-internal-collision"]);
    // Case-insensitively a_mod < B_mod, but ordinally "B" < "a": flagged.
    const collation = idx.lookup(depotHash("c.app"));
    expect(collation.winner!.name).toBe("a_mod.archive");
    expect(collation.ambiguities.map(a => a.code)).toEqual(["collation-sensitive-order"]);
    expect(idx.lookup(depotHash("missing.app")).winner).toBeNull();
  });
});
