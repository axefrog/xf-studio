// The library's Segmented control with a data-driven list (the Motion panel's Body source): choices replaced after construction keep
// focus on the same choice, an unchanged list rebuilds nothing, the whole group disables with one visible reason, and a reserved note
// line carries a transient state.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { installLightDom, lightDocument, type LightElement, uninstallLightDom } from "./light-dom";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());

test("setOptions rebuilds only a changed list, keeps focus on the same choice, and each button selects its value", async () => {
  const { Segmented } = await import("../src/studio-ui/controls");
  const chosen: string[] = [];
  const control = new Segmented<string>({ label: "Body", wrap: true, reserveNote: true, options: [{ value: "still", label: "Still" }], onSelect: value => chosen.push(value) });
  const root = control.element as unknown as LightElement;
  const buttons = () => root.querySelectorAll(".segment") as unknown as LightElement[];
  expect(root.querySelector(".segmented.wrap")).toBeTruthy();
  control.setOptions([{ value: "still", label: "Still" }, { value: "closeup", label: "Creator close-up" }]);
  expect(buttons().map(b => b.textContent)).toEqual(["Still", "Creator close-up"]);
  const first = buttons()[1]!;
  first.focus();
  control.setOptions([{ value: "still", label: "Still" }, { value: "closeup", label: "Creator close-up" }]);
  expect(buttons()[1]).toBe(first);
  control.setOptions([{ value: "still", label: "Still" }, { value: "inventory", label: "Inventory" }, { value: "closeup", label: "Creator close-up" }]);
  expect(buttons()[2]).not.toBe(first);
  expect(lightDocument.activeElement).toBe(buttons()[2]!);
  buttons()[1]!.click();
  expect(chosen).toEqual(["inventory"]);
  control.update("inventory", undefined, { note: "Loading that idle; the previous one plays until it's ready." });
  expect(buttons().map(b => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  const note = root.querySelector(".control-note") as unknown as LightElement;
  expect(note.textContent).toContain("Loading that idle");
  control.update("still", undefined, { disabled: true, reason: "Your V's motion appears once the 3D preview is ready." });
  expect(buttons().every(b => b.disabled)).toBe(true);
  expect(note.textContent).toBe("Your V's motion appears once the 3D preview is ready.");
  control.update("still");
  expect(buttons().some(b => b.disabled)).toBe(false);
  expect(note.hidden).toBe(false); // reserved: the line keeps its place when empty
});
