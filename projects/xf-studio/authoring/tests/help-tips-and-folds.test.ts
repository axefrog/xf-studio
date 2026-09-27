// Help tips (help-tip.ts): what something is, in a keyboard-reachable tip whose text is the icon's description; and the remembered folds
// of panel headings (the `folded` UI preference).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parseUIPreferences, UIPreferenceActions } from "../src/ui-preferences";
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
  test("folding and unfolding headings, bounded and validated; nothing stored while nothing is folded", () => {
    const preferences = new UIPreferenceActions();
    preferences.dispatch({ kind: "folded.set", keys: ["character:head/hair", "character:group/body"], folded: true });
    expect(preferences.snapshot().folded).toEqual(["character:head/hair", "character:group/body"]);
    preferences.dispatch({ kind: "folded.set", keys: ["character:head/hair"], folded: false });
    expect(preferences.snapshot().folded).toEqual(["character:group/body"]);
    preferences.dispatch({ kind: "folded.set", keys: ["character:group/body"], folded: false });
    expect(preferences.snapshot().folded).toBeUndefined();
    expect(preferences.capability({ kind: "folded.set", keys: [], folded: true }).available).toBe(false);
    expect(preferences.capability({ kind: "folded.set", keys: ["no panel prefix"], folded: true }).available).toBe(false);
    expect(preferences.capability({ kind: "folded.set", keys: ["character:\u0000"], folded: true }).available).toBe(false);
    // A saved document keeps valid keys only.
    expect(parseUIPreferences({ schema: "xfs/ui-preferences-1", theme: "dark", inputHints: true, folded: ["character:head/eyes", 7, "bad", "character:head/eyes"] }).folded)
      .toEqual(["character:head/eyes"]);
  });
});
