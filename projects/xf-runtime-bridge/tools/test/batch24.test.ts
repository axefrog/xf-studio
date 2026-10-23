// Bridge 0.8.11: session 17's findings. The plugin's logic (the facing target, the held face) is checked by xfb_selftest --unit;
// the redscript changes are read from the source (the self-test host can't run them; the session-18 card checks them in the
// game). Proves nothing about the game.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectDir } from "./helpers.ts";

const read = (...parts: string[]) => readFileSync(join(projectDir, ...parts), "utf8").split(String.fromCharCode(13)).join(""); // the sources may have CRLF line ends

describe("0.8.11 N1: a move's facing target is cleared, not left to steer later walks", () => {
  const npc = read("redscript", "XFRuntimeBridgeNpc.reds");
  test("every command clears it unless the move sets its own, and the clear is the game's own idiom", () => {
    expect(npc).toContain('ai.SetBehaviorArgument(n"FacingTarget", ToVariant(none));');
    expect(npc).toContain('if !(Equals(kind, "move") && faceV) {');
    expect(npc).toContain("XFNpc.ClearFacing(entry, puppet, cid, kind);");
    expect(npc).toContain("entry.facingSet = true;");
  });
  test("only a target our own move set is cleared (an actor handed back, or a pick, keeps what its own AI holds)", () => {
    expect(npc).toContain("if !entry.facingSet {\n      return;\n    }");
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

describe("0.8.11 review fixes: the held Esc says so, and only while a question waits", () => {
  const panel = read("redscript", "XFRuntimeBridgePhotoPanel.reds");
  const ink = read("redscript", "XFRuntimeBridgeInk.reds");
  test("Esc is held only with a question pending, and then the answers flash and the line under them says why", () => {
    expect(panel).toContain("if now.askId <= 0 || ArraySize(now.askKeys) == 0 {\n      return false;\n    }");
    expect(panel).toContain("this.m_view.Flash();");
    expect(panel).toContain("this.m_view.ShowHint(this.HeldText());");
    expect(panel).toContain('"Answer first, or press " + label + " to stop the bridge"');
    expect(panel).toContain('XFBridge_KillKey("get", "")');
  });
  test("the line holds its place (reserved while a question waits, so nothing moves) and is emptied after a few seconds", () => {
    expect(ink).toContain("this.m_hint.SetVisible(this.m_hintReserved && count > 0);");
    expect(ink).toContain('this.m_hint.SetText(StrLen(text) > 0 ? text : " ");');
    expect(panel).toContain("this.m_heldFor = 4.0;");
    expect(panel).toContain('this.m_view.ShowHint("");');
  });
});

describe("0.8.11 review fixes: the CET layer and the copy", () => {
  const init = read("cet", "xf_runtime_bridge", "init.lua");
  test("the status dot is drawn on the foreground draw list, under pcall, and what raised is named in the log", () => {
    expect(init).toContain("ImGui.ImDrawListAddCircleFilled(list,");
    expect(init).toContain("ImGui.GetForegroundDrawList()");
    expect(init).toContain('"the draw-list call raised: "');
    expect(init).not.toContain("ImGui.PushClipRect(");
  });
  test("one wording sends the player to the window: '(open the CET overlay)', never '(CET overlay)'", () => {
    for (const file of [read("cet", "xf_runtime_bridge", "init.lua"), read("native", "src", "core", "InkUi.cpp"), read("native", "src", "plugin", "Natives.cpp")]) {
      expect(file).not.toContain("(CET overlay)");
    }
    expect(read("native", "src", "plugin", "Natives.cpp")).toContain("Save anyway in the XF Runtime Bridge window (open the CET overlay).");
  });
  test("Save anyway's failure reads from the plain-copy table, never the raw reason", () => {
    const natives = read("native", "src", "plugin", "Natives.cpp");
    expect(natives).toContain("xfb::writes::SaveAnywayFailureCopy(e.code)");
    expect(natives).not.toContain("The save didn't go through: ");
  });
});
