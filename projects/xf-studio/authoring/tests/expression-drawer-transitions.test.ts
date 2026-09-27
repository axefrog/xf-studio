// The Expression drawer's Transitions (features/expressions/view/drawer.ts; design §5.5): Animate changes, Duration and Curve, in the
// light DOM. Off, Duration and Curve keep their place and read as inactive; on, they work; every change is the one platform action
// `transition.set`; nothing moves the layout between the states.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { installLightDom, lightEvent, uninstallLightDom, type LightElement } from "./light-dom";
import type { FacialPreviewSnapshot } from "../src/platform/api/facial";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());
beforeEach(async () => { (await import("../src/studio-ui/view-state")).bindViewState(); document.body.replaceChildren(); });

async function drawer() {
  const { expressionDrawer } = await import("../src/features/expressions/view/drawer");
  const platform: { kind: string; [key: string]: unknown }[] = [];
  let snapshot: FacialPreviewSnapshot = { phase: "idle", startPoints: { phase: "ready", items: [] }, samples: [],
    transition: { enabled: false, seconds: 1, easing: "linear" } };
  const ctx = {
    facade: { view: () => ({ part: { controls: {}, links: {} } }), editable: () => ({ available: true }), controlBegin: () => true,
      controlEdit: () => ({ ok: true }), controlCommit: () => {}, controlCancel: () => {} },
    dispatch: () => true, platform: (action: { kind: string }) => { platform.push(action); return true; },
    feedback: { toast: () => {}, announce: () => {}, record: () => {} }, easing: { get: () => undefined, set: () => {} },
    facial: { snapshot: () => snapshot, retry: () => {} },
    presets: { list: () => ({ phase: "ready", items: [] }), capability: () => ({ available: true }), execute: async () => ({ ok: true }) },
    links: { open: async () => {} }, openSettings: () => {},
  };
  const panel = expressionDrawer(ctx as never);
  document.body.append(panel.spec.element);
  panel.update(undefined as never);
  const section = panel.spec.element.querySelector<HTMLElement>('[data-view-key="expressions.transitions"]')!;
  return { panel, section, platform, set(next: Partial<NonNullable<FacialPreviewSnapshot["transition"]>>) {
    snapshot = { ...snapshot, transition: { ...snapshot.transition!, ...next } }; panel.update(undefined as never);
  } };
}
const fire = (element: Element, type: string) => (element as unknown as LightElement).dispatchEvent(lightEvent(type));
/** What the section shows, in document order: every element and whether it is hidden (the layout must not change between states). */
const shape = (root: HTMLElement): string[] => [...root.querySelectorAll<HTMLElement>("*")].map(el => `${el.tagName}:${el.hidden}`);

const curveNote = (section: HTMLElement) => section.querySelector<HTMLElement>(".expr-curve")!.querySelector<HTMLElement>(".control-note")!;
const curveReadout = (section: HTMLElement) => section.querySelector<HTMLElement>(".expr-curve")!.querySelector<HTMLElement>(".segmented-readout")!;

test("off: Animate changes is off and Duration and Curve read as inactive in place, the reason said once on Curve's line", async () => {
  const { section } = await drawer();
  const toggle = section.querySelector<HTMLInputElement>('input[role="switch"]')!;
  const duration = section.querySelector<HTMLInputElement>('input[type="range"]')!;
  const curves = [...section.querySelector<HTMLElement>(".expr-curve")!.querySelectorAll<HTMLButtonElement>(".segment")];
  expect([toggle.checked, toggle.disabled, duration.disabled]).toEqual([false, false, true]);
  expect(duration.title).toBe("Turn on Animate changes to set these.");
  // Every curve, icon only, named, by family (each gentle curve beside its strong one); the chosen one pressed; all inactive while off.
  expect(curves.map(button => button.getAttribute("aria-label"))).toEqual(["Linear", "Ease in", "Ease out", "Strong ease out", "Ease in-out", "Strong ease in-out"]);
  expect(curves.map(button => button.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false", "false", "false"]);
  expect(curves.every(button => button.disabled && !button.querySelector("span"))).toBe(true);
  // The reason, once, in words on the strip's reserved line (as Point blend's is under its switch); the chosen curve is the readout; both
  // controls marked disabled.
  expect([curveNote(section).textContent, curveReadout(section).textContent]).toEqual(["Turn on Animate changes to set these.", "Linear"]);
  expect([...section.querySelectorAll<HTMLElement>(".control")].filter(control => control.classList.contains("disabled")).length).toBe(2);
  expect(section.querySelector<HTMLElement>(".readout-value")!.textContent).toBe("1 s");
});

test("on: the controls work, each change is one transition.set, and nothing moves between off and on", async () => {
  const { section, platform, set } = await drawer();
  const before = shape(section);
  const toggle = section.querySelector<HTMLInputElement>('input[role="switch"]')!;
  toggle.checked = true; fire(toggle, "change");
  expect(platform).toEqual([{ kind: "transition.set", source: "expression", enabled: true }]);
  set({ enabled: true });
  expect(shape(section)).toEqual(before);
  const duration = section.querySelector<HTMLInputElement>('input[type="range"]')!;
  const curves = [...section.querySelector<HTMLElement>(".expr-curve")!.querySelectorAll<HTMLButtonElement>(".segment")];
  expect([duration.disabled, curves.some(button => button.disabled)]).toEqual([false, false]);
  // On, the note line is kept empty (its height reserved) and nothing is disabled.
  expect([curveNote(section).textContent, curveNote(section).hidden]).toEqual(["", false]);
  curves[4]!.click();
  expect(platform.at(-1)).toEqual({ kind: "transition.set", source: "expression", easing: "inOut" });
  set({ easing: "inOut", seconds: 0 });
  expect(curves.map(button => button.getAttribute("aria-pressed"))[4]).toBe("true");
  expect(curveReadout(section).textContent).toBe("Ease in-out");
  expect(curves.map(button => button.title)).toEqual(["Linear: steady from start to end.", "Ease in: starts slowly and speeds up into the end.",
    "Ease out: starts quickly and slows into the end.", "Strong ease out: most of the change at once, then a long settle.", "Ease in-out: gentle at both ends.",
    "Strong ease in-out: a slow start and finish around a quick middle."]);
  // 0 s reads as a duration like any other.
  expect(section.querySelector<HTMLElement>(".readout-value")!.textContent).toBe("0 s");
  // The duration's reset returns to 1 s as one change.
  section.querySelector<HTMLButtonElement>(".slider-reset")!.click();
  expect(platform.at(-1)).toEqual({ kind: "transition.set", source: "expression", seconds: 1 });
  set({ enabled: false });
  expect(shape(section)).toEqual(before);
});
