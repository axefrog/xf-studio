// Bridge 0.8.10: session 16's findings. The pin mark's edge rule is checked through its TypeScript mirror
// (tools/overlay/ink-place.ts) at session 16's geometry; the redscript, CET and probe changes are read from the source (the
// self-test host can't show them; the session-17 card checks them in the game). Proves nothing about the game.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hudBlocks, placeEdgeMark, slideAlong, type Rect } from "../overlay/ink-place.ts";
import { validate } from "../api/schema.ts";
import { GIB, freeCommitBytes, parseReading, tripped } from "../commit-tripwire.ts";
import { findCommand } from "../api/catalogue.ts";
import { projectDir } from "./helpers.ts";

const read = (...parts: string[]) => readFileSync(join(projectDir, ...parts), "utf8");
const hit = (r: Rect, z: Rect, gap: number) => r.x < z.x + z.w + gap && r.x + r.w + gap > z.x && r.y < z.y + z.h + gap && r.y + r.h + gap > z.y;

describe("0.8.10 D1: the pin mark at a side edge keeps clear of the minimap, the quest tracker, the status bars and the ink panel", () => {
  // Session 16's screen: 3840 x 1600, the HUD layer 5184 x 2160 units (the edge marks landed at px [3549, 225] and [93, 234]).
  const visible: Rect = { x: 0, y: 0, w: 5184, h: 2160 };
  const mark = { w: 360, h: 96 };
  const blocks = hudBlocks(visible);

  test("the right edge: asked high (a pin up and behind), it slides down below the tracker and above the weapon block", () => {
    const asked: Rect = { x: 5184 - 12 - mark.w, y: 300, ...mark };
    const kept = placeEdgeMark(asked, visible, null);
    for (const z of blocks) expect(hit(kept, z, 12)).toBe(false);
    expect(kept.y).toBeGreaterThanOrEqual(1250 + 12);
    expect(kept.y + kept.h).toBeLessThanOrEqual(2160 - 480 - 12);
    expect(kept.x).toBe(asked.x);
  });

  test("the left edge: asked high, it slides below the status bars and clear of the ink panel (the panel sits right under them)", () => {
    const panel: Rect = { x: 40, y: 300, w: 561, h: 340 };
    const asked: Rect = { x: 12, y: 230, ...mark };
    const kept = placeEdgeMark(asked, visible, panel);
    for (const z of [...blocks, panel]) expect(hit(kept, z, 12)).toBe(false);
    // The Sol review of 0.8.10, finding 2: it stays on its edge (0.8.10's first rule alternated between the bars and the panel
    // and landed near (3952, 2052)); the nearest free interval is just below the panel.
    expect(kept.x).toBe(asked.x);
    expect(kept.y).toBe(panel.y + panel.h + 12);
    const withoutPanel = placeEdgeMark(asked, visible, null);
    expect(withoutPanel.y).toBeGreaterThanOrEqual(300 + 12);
    expect(withoutPanel.y).toBeLessThan(kept.y);
  });

  test("a mark already in a free place stays where it is; at other screens the blocks scale with the screen's height", () => {
    const free: Rect = { x: 5184 - 12 - mark.w, y: 1400, ...mark };
    expect(placeEdgeMark(free, visible, null)).toMatchObject({ x: free.x, y: free.y });
    for (const [w, h] of [[3840, 2160], [5760, 2160], [3840, 1080]] as const) {
      const v: Rect = { x: 0, y: 0, w, h };
      const s = h / 2160;
      const k = placeEdgeMark({ x: w - 12 * s - mark.w * s, y: 100, w: mark.w * s, h: mark.h * s }, v, null, s);
      for (const z of hudBlocks(v)) expect(hit(k, z, 12 * s)).toBe(false);
    }
  });

  test("the redscript clamps with the same blocks and the panel's place", () => {
    const ink = read("redscript", "XFRuntimeBridgeInk.reds");
    expect(ink).toContain("public static func HudBlocks(v: Vector4) -> array<Vector4> {");
    expect(ink).toContain("new Vector4(v.X + v.Z - 860.0 * h, v.Y, 860.0 * h, 1250.0 * h)");
    expect(ink).toContain("new Vector4(v.X + v.Z - 860.0 * h, v.Y + v.W - 480.0 * h, 860.0 * h, 480.0 * h)");
    expect(ink).toContain("new Vector4(v.X, v.Y, 700.0 * h, 300.0 * h)");
    expect(ink).toContain("new Vector4(v.X, v.Y + v.W - 520.0 * h, 570.0 * h, 520.0 * h)");
    expect(ink).toContain("this.m_panelRect = this.m_view.Place(frame, scale, v, units, true);");
    expect(ink).toContain("public static func SlideAlong(r: Vector4, zones: array<Vector4>, v: Vector4, gap: Float) -> Vector4 {");
    expect(ink).toContain("XFInkStyle.SlideAlong(new Vector4(left, top, XFInkPins.MarkWidth() * size, XFInkPins.MarkHeight() * size), zones, v, 12.0 * units);");
  });

  test("an edge mark never leaves its edge, whatever the zones: no free interval keeps the asked place, and a tight screen stays on its edge", () => {
    const zones: Rect[] = [{ x: 0, y: 0, w: 5184, h: 1000 }, { x: 0, y: 1000, w: 5184, h: 1160 }];
    const asked: Rect = { x: 12, y: 500, ...mark };
    expect(slideAlong(asked, zones, visible, 12)).toMatchObject({ x: 12, y: 500 });
    for (const y of [0, 300, 1000, 2000]) {
      const kept = placeEdgeMark({ x: 5184 - 12 - mark.w, y, ...mark }, visible, { x: 4000, y: 1300, w: 1000, h: 200 });
      expect(kept.x).toBe(5184 - 12 - mark.w);
      for (const z of [...blocks, { x: 4000, y: 1300, w: 1000, h: 200 }]) expect(hit(kept, z, 12)).toBe(false);
    }
  });
});

describe("0.8.10 A7: each layer's panel says where it is drawn", () => {
  test("the tag beside the heading names the layer (or the photo menu); the HUD layer keeps plain 'test'", () => {
    const ink = read("redscript", "XFRuntimeBridgeInk.reds");
    expect(ink).toContain("public func SetWhere(place: String) -> Void {");
    expect(ink).toContain('"layer " + frame.layer');
    expect(read("redscript", "XFRuntimeBridgePhotoPanel.reds")).toContain('this.m_view.SetWhere("photo menu");');
  });
});

describe("0.8.10 G6: dialogue.hub also comes from the 2 Hz poll", () => {
  const probe = read("redscript-probes", "XFRuntimeBridgeProbeEvents.reds");
  test("the poll reads the hubs; both paths record a change once; a first look at none is the baseline", () => {
    expect(probe).toContain("this.PollHubs();");
    expect(probe).toContain("private func NoteHubs(hubs: DialogChoiceHubs) -> Void {");
    expect(probe).toContain("if Equals(out, this.m_lastHubs) {");
    expect(probe).toContain("if first && ArraySize(hubs.choiceHubs) == 0 {");
    expect(probe.match(/XFProbeOut\.Emit\("dialogue\.hub"/g)?.length).toBe(1);
  });

  test("the Sol review of 0.8.10, finding 1: the poll reads no game system while the gate is closed, and keeps rescheduling", () => {
    const at = probe.indexOf("public func Poll() -> Void {");
    const body = probe.slice(at, probe.indexOf("this.PollHubs();", at));
    expect(body.indexOf("if !XFBridge_Live() {")).toBeGreaterThan(0);
    expect(body.indexOf("if !XFBridge_Live() {")).toBeLessThan(body.indexOf("GetPlayer(game)"));
    expect(body.slice(body.indexOf("if !XFBridge_Live() {"), body.indexOf("let game = this.GetGameInstance();", body.indexOf("if !XFBridge_Live() {") + 10))).toContain("DelayCallback(this.m_poll, 0.5, false);");
  });

  test("the Sol review of 0.8.10, finding 3: npc.where answers V's real head and the sight ray starts there", () => {
    const npc = read("redscript", "XFRuntimeBridgeNpc.reds");
    expect(npc).toContain("if XFScene.Head(player, head) {");
    expect(npc).toContain('headText = ",\\"head\\":" + XFScene.Arr(head);');
    expect(read("native", "src", "core", "Npc.cpp")).toContain('const Vec3 eye = aV.contains("head") ? ToVec(aV["head"])');
  });
});

describe("0.8.10 N7: the old holocall style is refused with a pointer to call_subtitle", () => {
  test("the validation names the new style", () => {
    const say = findCommand("npc.say")!;
    const problems = validate(say.input, { text: "x", speaker: "A", style: "holocall" });
    expect(problems.join(" ")).toContain("'holocall' is now called call_subtitle");
    expect(validate(say.input, { text: "x", speaker: "A", style: "nonsense" }).join(" ")).not.toContain("is now called");
  });
});

describe("0.8.10 SS5r: equipped says what it covers and clothing lists the areas", () => {
  test("the inventory read adds the per-area clothing and a plain note", () => {
    const senses = read("redscript", "XFRuntimeBridgeSenses.reds");
    expect(senses).toContain("XFWardrobe.Shows(equipment, areas[a])");
    expect(senses).toContain('\\"clothing\\":');
    expect(senses).toContain("equipped_note");
    expect(findCommand("player.status")!.description).toContain("clothing lists per area");
  });
});

describe("0.8.10 N5: the reactions held back are logged", () => {
  test("each hold counts on the entry and the first few are logged", () => {
    const npc = read("redscript", "XFRuntimeBridgeNpc.reds");
    expect(npc).toContain('XFBridgeLog.Info("npc-reactions", entry.who + " held the game\'s " + what');
    expect(npc).toContain("public let held: Int32;");
  });
});

describe("0.8.10 M: the memory rule is a tripwire on the machine's free commit, not a skip", () => {
  test("it trips below the floor (4 GB by default) and not at or above it", () => {
    const limit = 100 * GIB;
    expect(freeCommitBytes({ limit, committed: 96 * GIB })).toBe(4 * GIB);
    expect(tripped({ limit, committed: 96 * GIB }, 4)).toBe(false);
    expect(tripped({ limit, committed: 96 * GIB + 1 }, 4)).toBe(true);
    expect(tripped({ limit, committed: 60 * GIB }, 4)).toBe(false);
  });

  test("the counters' line parses; anything else is not a reading", () => {
    expect(parseReading("102768369664 77999026176\r\n")).toEqual({ limit: 102768369664, committed: 77999026176 });
    expect(parseReading("")).toBeNull();
    expect(parseReading("0 5")).toBeNull();
    expect(parseReading("a b")).toBeNull();
  });

  test("the card names the tripwire and no longer skips a heavy row on a climb of the game's private bytes", () => {
    const card = read("..", "..", "research", "runtime", "runtime-bridge-test-card.md");
    const at = card.indexOf("## Session 17 checks");
    expect(at).toBeGreaterThan(0);
    const session17 = card.slice(at, card.indexOf("## Session 16 checks"));
    expect(session17).toContain("commit-tripwire.ts");
    expect(session17).not.toContain("skip G9");
  });
});
