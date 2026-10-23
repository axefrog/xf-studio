// Bridge 0.8.11: session 17's findings. The plugin's logic (the facing target, the held face) is checked by xfb_selftest --unit;
// the redscript changes are read from the source (the self-test host can't run them; the session-18 card checks them in the
// game). Proves nothing about the game.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectDir } from "./helpers.ts";

const read = (...parts: string[]) => readFileSync(join(projectDir, ...parts), "utf8");

describe("0.8.11 N1: a move's facing target is cleared, not left to steer later walks", () => {
  const npc = read("redscript", "XFRuntimeBridgeNpc.reds");
  test("every command clears it unless the move sets its own, and the clear is the game's own idiom", () => {
    expect(npc).toContain('ai.SetBehaviorArgument(n"FacingTarget", ToVariant(none));');
    expect(npc).toContain('if !(Equals(kind, "move") && faceV) {');
    expect(npc).toContain("XFNpc.ClearFacing(entry, puppet, cid, kind);");
    expect(npc).toContain("entry.facingSet = true;");
  });
  test("a crowd member the bridge picked keeps what its own AI holds", () => {
    expect(npc).toContain('if !entry.facingSet && (Equals(entry.kind, "pick") || !IsDefined(before)) {');
  });
  test("V is not the facing target of a move unless face_v is asked", () => {
    expect(read("native", "src", "core", "Npc.cpp")).toContain('params::CheckBoolean(aParams, "face_v").value_or(false)');
  });
});

describe("0.8.11 N3: a held face is sent again, and the sends are logged", () => {
  test("the script logs the first sends with whether the actor was prepared", () => {
    expect(read("redscript", "XFRuntimeBridgeNpc.reds")).toContain('" sent (" + IntToString(entry.faceLogged) + "), prepared "');
  });
});

describe("0.8.11 SS5: Equipment-EX's outfit decides what an area shows", () => {
  const ex = read("redscript", "XFRuntimeBridgeEquipmentEx.reds");
  const wardrobe = read("redscript", "XFRuntimeBridgeWardrobe.reds");
  test("the part for an area is read through Equipment-EX's outfit slots, and a build without it has a stub", () => {
    expect(ex.match(/public static func ItemFor\(player: ref<PlayerPuppet>, area: gamedataEquipmentArea\) -> ItemID/g)?.length).toBe(2);
    expect(ex).toContain("XFInventory.ItemArea(ItemID.GetTDBID(item))");
  });
  test("Shows reports 'outfit' before it looks at the vanilla hidden flag, and outfit_item follows the part", () => {
    const shows = wardrobe.slice(wardrobe.indexOf("public static func Shows("));
    expect(shows.indexOf('return "outfit";')).toBeLessThan(shows.indexOf("data.IsSlotHidden(area)"));
    expect(wardrobe).toContain("XFWardrobe.OutfitItem(data, areas[i])");
    expect(wardrobe).not.toContain("XFInventory.ItemName(data.GetSlotOverridenVisualItem(");
  });
});
