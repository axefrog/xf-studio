// Help tips (help-tip.ts): what something is, in a keyboard-reachable tip whose text is the icon's description; and the remembered folds
// of panel headings (the `folded` UI preference).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { foldedKeys, parseUIPreferences, UIPreferenceActions } from "../src/ui-preferences";
import { installLightDom, type LightElement, uninstallLightDom } from "./light-dom";

beforeAll(() => installLightDom());
afterAll(() => uninstallLightDom());

describe("help tips", () => {
  test("a help icon is a named button whose text is its description; an empty one keeps its place but leaves the tab order", async () => {
    const { helpTip, setHelp } = await import("../src/studio-ui/help-tip");
    const tip = helpTip("Hair", ["Hair physics is not simulated.", "Second line."], "Hair") as unknown as LightElement;
    expect(tip.tagName).toBe("button");
    expect(tip.getAttribute("type")).toBe("button");
    expect(tip.getAttribute("aria-label")).toBe("About Hair");
    expect(tip.getAttribute("data-help")).toBe("Hair physics is not simulated.\nSecond line.");
    expect(tip.getAttribute("aria-description")).toBe("Hair. Hair physics is not simulated. Second line.");
    expect(tip.tabIndex).toBe(0);
    setHelp(tip as unknown as HTMLElement, "");
    expect(tip.classList.contains("empty")).toBe(true);
    expect(tip.tabIndex).toBe(-1);
    expect(tip.hasAttribute("aria-description")).toBe(false);
  });
});

describe("remembered folds", () => {
  test("folding and opening headings, bounded and validated; the older folded list is read in", () => {
    const preferences = new UIPreferenceActions();
    preferences.dispatch({ kind: "expanded.set", keys: ["character:head/hair", "character:group/body"], expanded: false });
    expect(foldedKeys(preferences.snapshot())).toEqual(["character:head/hair", "character:group/body"]);
    preferences.dispatch({ kind: "expanded.set", keys: ["character:head/hair"], expanded: true });
    expect(preferences.snapshot().expanded).toEqual({ "character:group/body": false, "character:head/hair": true });
    expect(preferences.capability({ kind: "expanded.set", keys: [], expanded: true }).available).toBe(false);
    expect(preferences.capability({ kind: "expanded.set", keys: ["no panel prefix"], expanded: true }).available).toBe(false);
    expect(preferences.capability({ kind: "expanded.set", keys: ["character:\u0000"], expanded: true }).available).toBe(false);
    // Author names in any script are fine.
    expect(preferences.capability({ kind: "expanded.set", keys: ["character:maker:hair/\u5c71\u7530"], expanded: false }).available).toBe(true);
    // A saved document keeps valid keys only; the older `folded` list (headings folded) becomes folded entries, a newer entry wins.
    expect(parseUIPreferences({ schema: "xfs/ui-preferences-1", theme: "dark", inputHints: true, folded: ["character:head/eyes", 7, "bad", "character:head/nose"],
      expanded: { "character:head/nose": true, bad: false, "character:x": "yes" } }).expanded)
      .toEqual({ "character:head/eyes": false, "character:head/nose": true });
  });
  test("least recently set go first, per namespace and in all", () => {
    const preferences = new UIPreferenceActions();
    const keys = Array.from({ length: 200 }, (_, i) => `tree:group/${i}`);
    preferences.dispatch({ kind: "expanded.set", keys, expanded: true });
    preferences.dispatch({ kind: "expanded.set", keys: ["character:head/eyes"], expanded: false });
    // Touching an old key makes it the newest.
    preferences.dispatch({ kind: "expanded.set", keys: ["tree:group/0"], expanded: false });
    const stored = Object.keys(preferences.snapshot().expanded!);
    expect(stored.filter(key => key.startsWith("tree:")).length).toBe(192);
    expect(stored).toContain("tree:group/0");
    expect(stored).not.toContain("tree:group/1");
    expect(stored).toContain("character:head/eyes");
    expect(stored.at(-1)).toBe("tree:group/0");
  });
});
