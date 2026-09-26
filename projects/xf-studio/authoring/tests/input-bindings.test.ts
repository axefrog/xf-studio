import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACTION_DESCRIPTORS, REQUEST_DESCRIPTORS } from "../src/studio-action-descriptors";
import { ALL_TARGETS, bindingReference, cancelsGesture, chordMatches, CURSOR_FALLBACK, cursorFor, GESTURE_BINDINGS, GESTURES, KEY_BINDINGS,
  keyBinding, MAKEUP_TARGETS, MODIFIER_KEYS, MODIFIER_SUMMARIES, modifierKey, modifiersOf, PANEL_POINTER_BINDINGS, POINTER_BINDINGS,
  pointerBinding, shortcutLabel, targetTip, viewportHints, type BindingAction, type CursorKind, type GestureKind, type HeldModifiers,
  type ModifierKey, type PointerInput, type ViewportInputContext, type ViewportScope } from "../src/input-bindings";
import { SHELL_KEY_BINDINGS } from "../src/studio-ui/shortcuts";

const held = (key: ModifierKey): HeldModifiers => ({ ctrl: key.includes("ctrl"), alt: key.includes("alt"), shift: key.includes("shift") });
const scopes: ViewportScope[] = ["head", "uv"];
const gestures = Object.keys(GESTURES) as GestureKind[];
function contexts(): ViewportInputContext[] {
  const all: ViewportInputContext[] = [];
  for (const scope of scopes) for (const target of [undefined, ...ALL_TARGETS]) for (const mods of MODIFIER_KEYS)
    for (const gesture of [undefined, ...gestures]) for (const blocked of [undefined, "no-layer", "surface-off"] as const)
      all.push({ scope, target, modifiers: held(mods), gesture, blocked });
  return all;
}
const allBindingIds = new Map<string, string[]>([
  ...POINTER_BINDINGS.map(binding => [binding.id, [binding.label]] as [string, string[]]),
  ...KEY_BINDINGS.map(binding => [binding.id, [binding.label, binding.short ?? binding.label]] as [string, string[]]),
  ...GESTURE_BINDINGS.map(binding => [binding.id, [binding.label]] as [string, string[]]),
]);

test("binding IDs are unique and every binding performs a real catalogued action", () => {
  const ids = [...POINTER_BINDINGS, ...KEY_BINDINGS, ...GESTURE_BINDINGS, ...PANEL_POINTER_BINDINGS].map(binding => binding.id);
  expect(new Set(ids).size).toBe(ids.length);
  const actions: BindingAction[] = [...POINTER_BINDINGS, ...KEY_BINDINGS, ...GESTURE_BINDINGS, ...PANEL_POINTER_BINDINGS].map(binding => binding.action);
  const problems = actions.flatMap(action => {
    if (action.kind === "action") {
      const descriptor = (ACTION_DESCRIPTORS as Record<string, { variants?: Record<string, unknown> } | undefined>)[action.id];
      if (!descriptor) return [`missing action ${action.id}`];
      return action.variant && !descriptor.variants?.[action.variant] ? [`missing variant ${action.id}#${action.variant}`] : [];
    }
    if (action.kind === "request") return action.id in REQUEST_DESCRIPTORS ? [] : [`missing request ${action.id}`];
    if (action.kind === "view") return /^uv\.(both|single|other|fit|pan|zoom)$/.test(action.id) ? [] : [`bad view ${action.id}`];
    return [];
  });
  expect(problems).toEqual([]);
  // The shell handles every global key binding; nothing global is bound without a handler.
  expect(KEY_BINDINGS.filter(binding => binding.scope === "global").map(binding => binding.id).sort()).toEqual([...SHELL_KEY_BINDINGS].sort());
});

test("pointer resolution is unambiguous: one binding at most per scope, input, target and modifier set", () => {
  const inputs: PointerInput[] = ["drag", "wheel", "double-click", "right-drag", "middle-drag", "two-finger-drag", "right-click"];
  for (const scope of scopes) for (const input of inputs) for (const target of ALL_TARGETS) for (const mods of MODIFIER_KEYS) {
    const matches = POINTER_BINDINGS.filter(binding => binding.scope === scope && binding.input === input && binding.targets.includes(target) && binding.mods.includes(mods));
    expect(matches.length).toBeLessThanOrEqual(1);
  }
});

test("B-17 option (b): Shift always means a shape gesture and never moves the camera", () => {
  for (const scope of scopes) {
    for (const target of MAKEUP_TARGETS) {
      expect(pointerBinding(scope, "drag", target, "shift")?.effect).toBe("shape-rotate");
      expect(pointerBinding(scope, "wheel", target, "shift")?.effect).toBe("shape-scale");
    }
    expect(pointerBinding(scope, "drag", "empty", "shift")?.effect).toBe("none");
    expect(pointerBinding(scope, "wheel", "empty", "shift")?.effect).toBe("none");
    for (const mods of MODIFIER_KEYS.filter(key => key.includes("shift"))) for (const target of ALL_TARGETS)
      for (const input of ["drag", "wheel"] as const)
        expect(pointerBinding(scope, input, target, mods)?.effect ?? "none").not.toMatch(/^camera-|^view-/);
  }
  expect(pointerBinding("head", "drag", "empty", "")?.effect).toBe("camera-orbit");
  expect(pointerBinding("head", "drag", "shape", "ctrl")?.effect).toBe("camera-pan");
  expect(pointerBinding("uv", "drag", "point", "ctrl")?.effect).toBe("view-pan");
  expect(pointerBinding("uv", "drag", "empty", "")).toBeUndefined();
});

test("every bound gesture and shortcut has a hint or reference label, and every hint maps to a real binding", () => {
  const shown = new Set<string>(), problems: string[] = [];
  for (const context of contexts()) {
    const hints = viewportHints(context), tip = targetTip(context);
    for (const item of [...hints.items, ...hints.hold, ...hints.more, ...(tip?.lines ?? [])]) {
      if (!item.label) problems.push(`empty label in ${JSON.stringify(context)}`);
      if (!item.ids.length) {
        // Only the explicit placeholder for a modifier set with no binding at this target.
        if (item.label !== "no action here" || !hints.held) problems.push(`unbound hint ${item.label}`);
        continue;
      }
      for (const id of item.ids) {
        shown.add(id);
        if (!allBindingIds.has(id)) problems.push(`hint ${item.label} names unknown binding ${id}`);
      }
      if (item.ids.length === 1 && !allBindingIds.get(item.ids[0])?.includes(item.label) && !hints.hold.includes(item))
        problems.push(`hint label ${item.label} differs from ${item.ids[0]}`);
    }
  }
  expect(problems).toEqual([]);
  const stripBound = POINTER_BINDINGS.filter(binding => binding.strip !== false).map(binding => binding.id);
  expect(stripBound.filter(id => !shown.has(id))).toEqual([]);
  expect(GESTURE_BINDINGS.map(binding => binding.id).filter(id => !shown.has(id))).toEqual([]);
  expect(KEY_BINDINGS.filter(binding => binding.strip).map(binding => binding.id).filter(id => !shown.has(id))).toEqual([]);
  // The Keyboard & mouse dialog lists every binding, each with a label.
  const referenced = bindingReference().flatMap(section => section.rows.flatMap(row => { expect(row.label.length).toBeGreaterThan(2); expect(row.input.length).toBeGreaterThan(0); return row.ids; }));
  expect([...allBindingIds.keys(), ...PANEL_POINTER_BINDINGS.map(binding => binding.id)].filter(id => !referenced.includes(id))).toEqual([]);
});

test("each modifier that unlocks viewport bindings has a discovery summary", () => {
  for (const scope of scopes) {
    const used = new Set(POINTER_BINDINGS.filter(binding => binding.scope === scope && binding.mods.length < MODIFIER_KEYS.length)
      .flatMap(binding => binding.mods).filter(Boolean));
    expect([...used].filter(mods => !MODIFIER_SUMMARIES[scope][mods])).toEqual([]);
  }
});

test("hints follow the target and held modifiers; outside the viewport modifiers are ignored", () => {
  const base = { scope: "head" as const, modifiers: held("") };
  const idle = viewportHints({ ...base, target: "point" });
  expect(idle.items.map(item => `${item.input}: ${item.label}`)).toEqual(["Drag: move point", "Wheel: zoom view", "Right-drag: pan view", "F: front view"]);
  expect(idle.hold.map(item => `${item.input}: ${item.label}`)).toEqual(["Shift: shape tools", "Ctrl: pan", "Alt: orbit over makeup"]);
  const shift = viewportHints({ ...base, target: "shape", modifiers: held("shift") });
  expect(shift.held).toBe("Shift");
  expect(shift.items.map(item => `${item.input}: ${item.label}`)).toEqual(["Drag: rotate shape", "Wheel: scale shape", "Right-drag: pan view", "Esc: cancel"]);
  expect(viewportHints({ ...base, target: "empty", modifiers: held("shift") }).items[0]).toMatchObject({ input: "Drag / Wheel", label: "nothing off makeup" });
  expect(viewportHints({ ...base, modifiers: held("shift") }).held).toBeUndefined();
  expect(viewportHints({ ...base, target: "shape", modifiers: held("ctrl") }).items.some(item => item.ids.includes("gesture.cancel"))).toBe(false);
  expect(viewportHints({ ...base, target: "shape", gesture: "rotate" }).items.map(item => item.input)).toEqual(["Release", "Esc"]);
  expect(viewportHints({ ...base, target: "empty", blocked: "surface-off" }).note).toContain("Surface controls");
  expect(targetTip({ ...base, target: "shape" })?.lines.map(line => line.input)).toEqual(["Drag", "Shift-drag", "Wheel", "Right-click"]);
  expect(targetTip({ ...base, target: "empty" })).toBeUndefined();
});

test("cursors derive from the same bindings and every custom cursor has a crisp CSS rule with its fallback", () => {
  const ctx = (target: ViewportInputContext["target"], mods: ModifierKey, gesture?: GestureKind): ViewportInputContext =>
    ({ scope: "head", target, modifiers: held(mods), gesture });
  expect(cursorFor(ctx("shape", "shift"))).toBe("rotate");
  expect(cursorFor(ctx("point", ""))).toBe("grab");
  expect(cursorFor(ctx("shape", ""))).toBe("move");
  expect(cursorFor(ctx("empty", "shift"))).toBe("default");
  expect(cursorFor(ctx(undefined, "shift"))).toBe("default");
  expect(cursorFor(ctx("empty", "", "scale"))).toBe("scale");
  expect(cursorFor(ctx("shape", "", "handle"))).toBe("grabbing");
  const css = readFileSync(resolve(import.meta.dir, "../public/studio.css"), "utf8");
  const kinds = new Set<CursorKind>([...POINTER_BINDINGS.flatMap(binding => binding.cursor ? [binding.cursor] : []), ...Object.values(GESTURES).map(g => g.cursor)]);
  for (const kind of kinds) {
    const rule = new RegExp(`\\[data-cursor="${kind}"\\] canvas \\{ cursor: ([^;]+);`).exec(css);
    expect(rule, kind).not.toBeNull();
    expect(rule![1].trim().endsWith(CURSOR_FALLBACK[kind])).toBe(true);
    if (kind === "rotate" || kind === "scale") expect(rule![1]).toContain("data:image/svg+xml");
  }
});

test("key matching: Escape cancels with modifiers held, symbols ignore Shift and scopes stay separate", () => {
  expect(cancelsGesture({ key: "Escape", shiftKey: true })).toBe(true);
  expect(cancelsGesture({ key: "Z", ctrlKey: true, shiftKey: true })).toBe(true);
  expect(cancelsGesture({ key: "z", metaKey: true })).toBe(true);
  expect(cancelsGesture({ key: "z" })).toBe(false);
  expect(chordMatches({ key: "?" }, { key: "?", shiftKey: true })).toBe(true);
  expect(keyBinding("uv", { key: "F" })?.id).toBe("uv.fit");
  expect(keyBinding("head", { key: "f" })?.id).toBe("head.front");
  expect(keyBinding("head", { key: "f", ctrlKey: true })).toBeUndefined();
  expect(keyBinding("rows", { key: "ArrowUp", altKey: true })?.id).toBe("rows.reorder");
  expect(keyBinding("rows", { key: "ArrowUp" })?.id).toBe("rows.focus");
  expect(keyBinding("tabs", { key: "ArrowLeft", altKey: true, shiftKey: true })?.id).toBe("tabs.reorder");
  expect(keyBinding("global", { key: "z", ctrlKey: true }, { textInput: true })).toBeUndefined();
  expect(shortcutLabel("shell.redo")).toBe("Ctrl+Shift+Z");
  expect(modifierKey(modifiersOf({ metaKey: true, shiftKey: true }))).toBe("ctrl+shift");
});
