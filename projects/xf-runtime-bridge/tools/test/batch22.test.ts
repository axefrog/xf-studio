// Bridge 0.8.9: session 15's findings. The photo-menu panel's zone rule is checked through its TypeScript mirror
// (tools/overlay/ink-place.ts) at session 15's measured geometry; the redscript, CET and probe changes are read from the
// source (the self-test host can't show them; the session-16 card checks them in the game). Proves nothing about the game.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avoidZones, type Rect } from "../overlay/ink-place.ts";
import { findCommand } from "../api/catalogue.ts";
import { projectDir } from "./helpers.ts";

const read = (...parts: string[]) => readFileSync(join(projectDir, ...parts), "utf8");
const hit = (r: Rect, z: Rect, gap: number) => r.x < z.x + z.w + gap && r.x + r.w + gap > z.x && r.y < z.y + z.h + gap && r.y + r.h + gap > z.y;

describe("0.8.9 A5: the photo-menu panel keeps out of the menu, the top bar and the whole title row", () => {
  // Session 15's laid-out event (3840 x 1600, the layer 5184 x 2160), with the title row as 0.8.9 measures it: the
  // category icon left of the word, one zone (the icon's rectangle here is a stand-in of plausible size).
  const visible: Rect = { x: 0, y: 0, w: 5184, h: 2160 };
  const menu: Rect = { x: 3575, y: 616, w: 2025, h: 1350 };
  const menuMore: Rect = { x: 3499, y: 750, w: 2160, h: 1215 };
  const title: Rect = { x: 4010, y: 505, w: 196, h: 52 };
  const topBar: Rect = { x: 3700, y: 380, w: 900, h: 100 };
  const hints: Rect = { x: 3059, y: 2045, w: 337.5, h: 135 };
  const exit: Rect = { x: 4690, y: 2045, w: 54, h: 86 };
  const shot: Rect = { x: 3964, y: 2045, w: 54, h: 86 };
  const zones = [menu, menuMore, title, topBar, hints, exit, shot];
  const panel = { w: 561, h: 197 };

  test("UI-221 fix 4: bottom_right takes the first free corner when the menu needs a slide longer than one panel width", () => {
    const asked: Rect = { x: 5184 - 860 - panel.w, y: 2160 - 480 - panel.h, ...panel };
    const kept = avoidZones(asked, zones, visible, 24, "bottom_right");
    expect(kept.how).toBe("corner:bottom_left");
    for (const z of zones) expect(hit(kept, z, 24)).toBe(false);
    expect([kept.x, kept.y]).toEqual([24, visible.h - 24 - panel.h]);
  });

  test("UI-221 fix 4: the slide limit includes exactly one panel width and scales with the panel in an offset viewport", () => {
    for (const scale of [0.5, 1, 2]) {
      const v = { x: 100, y: 70, w: 2000 * scale, h: 1000 * scale };
      const gap = 24 * scale;
      const asked = { x: v.x + v.w - gap - 200 * scale, y: v.y + v.h - gap - 100 * scale, w: 200 * scale, h: 100 * scale };
      const z = { x: asked.x + gap, y: v.y, w: 300 * scale, h: v.h };
      const within = avoidZones(asked, [z], v, gap, "bottom_right");
      expect(within.how).toBe("nudged");
      expect(within.x).toBe(asked.x - asked.w);
      expect(within.y).toBe(asked.y);
      const beyond = avoidZones(asked, [{ ...z, x: z.x - scale }], v, gap, "bottom_right");
      expect(beyond.how).toBe("corner:bottom_left");
      expect(beyond.x).toBe(v.x + gap);
    }
  });

  test("UI-221 fix 4: several short nudges cannot accumulate a long slide, including at fallback corners", () => {
    const v = { x: 0, y: 0, w: 2000, h: 1000 };
    const asked = { x: 1776, y: 876, w: 200, h: 100 };
    const blocks = [
      { x: 1850, y: 0, w: 150, h: 1000 },
      { x: 1650, y: 0, w: 200, h: 1000 },
      { x: 0, y: 0, w: 300, h: 1000 },
    ];
    const kept = avoidZones(asked, blocks, v, 24, "bottom_right");
    // Both right corners need > 200 px left, both left corners > 200 px right. The middle is free, but no corner owns it.
    expect(kept.how).toBe("overlapping");
    expect(Math.abs(kept.x - asked.x)).toBeLessThanOrEqual(asked.w);
    expect(Math.abs(kept.y - asked.y)).toBeLessThanOrEqual(asked.w);
  });

  test("bottom_left and top_left stay where asked; a panel on the title row never covers the icon", () => {
    const bottomLeft = avoidZones({ x: 40, y: 2160 - 520 - panel.h, ...panel }, zones, visible, 24, "bottom_left");
    expect(bottomLeft.how).toBe("kept");
    const onTitle = avoidZones({ x: 3900, y: 450, ...panel }, zones, visible, 24, "top_right");
    for (const z of zones) expect(hit(onTitle, z, 24)).toBe(false);
  });

  test("with no way out along its edge, the panel takes the first free corner", () => {
    // Blocks down the right, along the bottom, in the middle and on the left leave one pocket at the top left; sliding from
    // bottom_right goes round in circles, and so do the bottom-left and top-right corners; the top-left corner is free.
    const right: Rect = { x: 2400, y: 0, w: 2784, h: 2160 };
    const bottom: Rect = { x: 0, y: 1400, w: 5184, h: 760 };
    const middle: Rect = { x: 700, y: 0, w: 1700, h: 1400 };
    const left: Rect = { x: 0, y: 400, w: 700, h: 1000 };
    const blocks = [right, bottom, middle, left];
    const kept = avoidZones({ x: 4400, y: 1700, ...panel }, blocks, visible, 24, "bottom_right");
    expect(kept.how).toBe("corner:top_left");
    for (const z of blocks) expect(hit(kept, z, 24)).toBe(false);
    expect([kept.x, kept.y]).toEqual([24, 24]);
  });

  test("the redscript measures the tab buttons and the title row's icon, unions widgets under one name, and reports the rule", () => {
    const photo = read("redscript", "XFRuntimeBridgePhotoPanel.reds");
    expect(photo).toContain("topBar.XFBridgeToggles(widgets, names);");
    expect(photo).toContain("ArrayPush(widgets, inkWidgetRef.Get(this.m_tabTitleIcon));");
    expect(photo).toContain("this.m_zones[at] = new Vector4(x0, y0, x1 - x0, y1 - y0);");
    expect(photo).toContain('"],\\"zone_rule\\":"');
    const ink = read("redscript", "XFRuntimeBridgeInk.reds");
    expect(ink).toContain("public static func Avoid(p: Vector4, zones: array<Vector4>, v: Vector4, gap: Float, anchor: String, out how: String) -> Vector4 {");
    expect(ink).toContain('how = "corner:" + (cb ? "bottom" : "top") + (cr ? "_right" : "_left");');
    expect(ink).toContain("AbsF(c.X - r.X) <= r.Z && AbsF(c.Y - r.Y) <= r.Z");
  });
});

describe("0.8.9 D1: the pin mark at the edge, and ui.state's pins", () => {
  const ink = read("redscript", "XFRuntimeBridgeInk.reds");
  const pins = read("redscript", "XFRuntimeBridgePins.reds");

  test("a pin behind the camera takes its way from the camera's right and up, to a side edge (0.8.8 fell to the bottom centre)", () => {
    expect(ink).toContain("public func Direction(point: Vector4) -> Vector2 {");
    expect(ink).toContain("let way = projector.Direction(new Vector4(point.X, point.Y, point.Z, 1.0));");
    expect(ink).toContain("dx = dx >= 0.0 ? side : -side;");
    expect(ink).not.toContain("dx = 0.0;\n        dy = 1.0;");
  });

  test("drawn_by is a bit set the UI's worker threads can't corrupt (0.8.8's shared array gave '????????ay' and pins_error failed)", () => {
    expect(pins).not.toContain("drawnBits");
    expect(pins).toContain("let before = XFBridge_PinDrawn(entry.id, bit);");
    expect(pins).toContain("XFBridge_PinDrawn(entry.id, -1);");
    expect(read("redscript", "Natives.reds")).toContain("public static native func XFBridge_PinDrawn(pin: Int32, bits: Int32) -> Int32");
    expect(pins).not.toContain("ArrayPush(entry.drawnBy");
  });
});

describe("0.8.9 NPC direction: device screens, the actor's own reactions, the walk, the release", () => {
  const npc = read("redscript", "XFRuntimeBridgeNpc.reds");

  test("a device screen in focus counts as busy: refused, a live hub withdrawn, and the key left to the device", () => {
    expect(npc).toContain("public static func DeviceFocus() -> Bool {");
    expect(npc).toContain("return XFNpcHub.DeviceFocus();");
    expect(npc).toContain("V turned to a device's screen; hub ");
    const onAction = npc.slice(npc.indexOf("public static func OnChoiceAction("), npc.indexOf("@wrapMethod(InteractionUIBase)"));
    expect(onAction.indexOf("XFNpcHub.DeviceFocus()")).toBeGreaterThan(0);
    expect(onAction.indexOf("XFNpcHub.DeviceFocus()")).toBeLessThan(onAction.indexOf("registry.SetHubAnswer(index);"));
  });

  test("the look-at reaction (face, bark, chest twist) and its face resets are held back on quiet actors and while directed", () => {
    for (const fn of ["TriggerFacialLookAtReaction", "CanTriggerExpressionLookAt", "ActivateReactionLookAt", "ResetFacial", "OnResetFacialEvent"]) {
      const at = npc.indexOf(`func ${fn}(`);
      expect(at, fn).toBeGreaterThan(0);
      expect(npc.slice(at, at + 400)).toContain("XFNpcRegistry.HoldsReactionsOf(this.GetOwner(), ");
    }
    expect(npc).toContain('(Equals(entry.kind, "actor") && !StrEndsWith(entry.record, "_reactive"))');
    expect(npc).toContain("reactions.XFBridgeEndReactionLook();");
  });

  test("a walk to V faces V as the game's own move does: no strafing target", () => {
    const move = npc.slice(npc.indexOf('if Equals(kind, "move") {\n      let move = new AIMoveToCommand();'));
    expect(move.slice(0, 1600)).not.toContain("move.rotateEntityTowardsFacingTarget = true;");
  });

  test("the greeting smiles unless a face is directed; a released crowd pick is told to walk on", () => {
    expect(npc).toContain('if Equals(trigger, "greeting") && !entry.faced {');
    expect(npc).toContain('crowd.ChangeMoveType(n"normal");');
  });

  test("npc.say takes near_m in the catalogue; the holocall style is call_subtitle", () => {
    const say = findCommand("npc.say")!;
    expect(Object.keys((say.input as any).properties)).toContain("near_m");
    expect(JSON.stringify(say.input)).toContain("call_subtitle");
    expect(JSON.stringify(say.input)).not.toContain('"holocall"');
  });
});

describe("0.8.9, the Sol review's finding 1: the new helpers ask no game system while the scripts aren't live", () => {
  test("the reaction wraps, the device check and the probe's attitude check the gate before any lookup", () => {
    const npc = read("redscript", "XFRuntimeBridgeNpc.reds");
    for (const fn of ["public static func HoldsReactionsOf(", "public static func DeviceFocus("]) {
      const body = npc.slice(npc.indexOf(fn), npc.indexOf(fn) + 700);
      const gate = body.indexOf("XFBridge_Live()");
      expect(gate, fn).toBeGreaterThan(0);
      for (const lookup of ["XFNpcRegistry.Get()", "XFPlayer.Player()", "GetBlackboardSystem", "GetTargetingSystem"]) {
        const at = body.indexOf(lookup);
        if (at >= 0) expect(at, `${fn} ${lookup}`).toBeGreaterThan(gate);
      }
    }
    const probe = read("redscript-probes", "XFRuntimeBridgeProbeEvents.reds");
    const attitude = probe.slice(probe.indexOf("public static func Attitude("), probe.indexOf("public static func Attitude(") + 600);
    expect(attitude.indexOf("XFBridge_Live()")).toBeGreaterThan(0);
    expect(attitude.indexOf("XFBridge_Live()")).toBeLessThan(attitude.indexOf("GetPlayer("));
  });
});

describe("0.8.9 the senses, the surfaces, the answer keys and the probes", () => {
  test("player.status counts what the inventory screen shows, equipped apart, and heat reads the wanted bar's own blackboard", () => {
    const senses = read("redscript", "XFRuntimeBridgeSenses.reds");
    for (const tag of ["HideInBackpackUI", "SoftwareShard", "HideInUI", "TppHead", "Currency", "Ammo", "base_fists"]) expect(senses).toContain(`n"${tag}"`);
    expect(senses).toContain("gameEItemIDFlag.Preview");
    expect(senses).toContain('"],\\"equipped\\":["');
    expect(senses).toContain("bar.GetName(barDefs.CurrentChaseState)");
  });

  test("the ink panel steps aside for the phone's screens; ui.state says phone_open", () => {
    const ink = read("redscript", "XFRuntimeBridgeInk.reds");
    expect(ink).toContain("public static func PhoneOpen() -> Bool {");
    expect(ink).toContain("this.m_view.canvas.SetVisible(frame.show && !this.m_phoneOpen);");
    expect(read("redscript", "XFRuntimeBridgeUi.reds")).toContain('\\"phone_open\\":');
  });

  test("the answer keys work while the CET line shows the question (the panel switched off); keys wait out 0.5 s after a question", () => {
    const ink = read("redscript", "XFRuntimeBridgeInk.reds");
    // The Sol review of 0.8.9, finding 4: never while the phone hides the question.
    const drawn = ink.slice(ink.indexOf("public func DrawnAsk() -> ref<XFHudFrame> {"), ink.indexOf("public func DrawnAsk() -> ref<XFHudFrame> {") + 900);
    expect(drawn).toContain("if !this.m_mounted || this.m_phoneOpen {");
    expect(ink).toContain("let held = this.DrawnAsk();");
    expect(ink).toContain("if IsDefined(frame) && frame.valid && !frame.show && frame.live && frame.askId > 0 && ArraySize(frame.askKeys) > 0 {");
    const natives = read("native", "src", "plugin", "Natives.cpp");
    expect(natives).toContain('const bool byKey = via.size() >= 4 && via.compare(via.size() - 4, 4, "_key") == 0;');
  });

  test("the window's question slot gives way to a newer line, info included", () => {
    const init = read("cet", "xf_runtime_bridge", "init.lua");
    expect(init).toContain("if not state.pendingAsk and newest and (not state.answeredAsk or newest.id > state.answeredAsk.id) then");
    expect(read("cet", "xf_runtime_bridge", "panel.lua")).toContain('coloured(panel.colour(theme, which, "XfAccentText", AMBER), "From XF Studio")');
  });

  test("the event probe records dialogue.index and call only on a change, and death and defeated carry the victim's attitude", () => {
    const probe = read("redscript-probes", "XFRuntimeBridgeProbeEvents.reds");
    expect(probe).toContain("if Equals(text, this.m_lastIndex) {");
    expect(probe).toContain("if Equals(text, this.m_lastCall) {");
    expect((probe.match(/\\"attitude\\":" \+ XFJson\.Str\(XFProbeOut\.Attitude\(this\)\)/g) ?? []).length).toBe(2);
    expect(JSON.stringify(findCommand("test.events")!.input)).toContain('"kinds"');
  });
});
