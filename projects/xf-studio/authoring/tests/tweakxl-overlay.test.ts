// The shared TweakXL YAML reader (tweakxl-overlay.ts) over a synthetic set of files: load bands, templates with `$instances`, `$base`,
// a flat override, a conflict, `$dlc`, and a `.tweak` file listed as a gap. The creator icons it answers are tested in cc-presentation.test.ts.
import { describe, expect, test } from "bun:test";
import { overlayIcon, readTweakOverlay, tweakBand, tweakOrder } from "../src/tweakxl-overlay";

const file = (path: string, text: string, provider = "A mod") => ({ path, provider, text });

describe("the TweakXL overlay", () => {
  test("files load by band: _ # $ ! first, ^ last, the rest by path between", () => {
    expect(tweakOrder([{ path: "r6/tweaks/b.yaml" }, { path: "r6/tweaks/^late.yaml" }, { path: "r6/tweaks/_first.yaml" }, { path: "r6/tweaks/a/z.yml" }])
      .map(entry => entry.path)).toEqual(["r6/tweaks/_first.yaml", "r6/tweaks/a/z.yml", "r6/tweaks/b.yaml", "r6/tweaks/^late.yaml"]);
    expect([tweakBand("x/#a.yaml"), tweakBand("x/$a.yaml"), tweakBand("x/a.yaml"), tweakBand("x/^a.yaml")]).toEqual([0, 0, 1, 2]);
  });

  test("templates expand per instance, $base inherits, a later flat overrides and a differing value is a conflict", () => {
    const overlay = readTweakOverlay([
      file("r6/tweaks/pack/icons.yaml", [
        "OptionsIcons.pack_$(eye):",
        "  $type: gamedataUIIcon_Record",
        "  $instances:",
        "    - { eye: e01 }",
        "    - { eye: e02, part: special }",
        "  atlasPartName: $(eye)",
        "  atlasResourcePath: pack\\ui\\icons.inkatlas",
        "OptionsIcons.pack_child:",
        "  $base: OptionsIcons.pack_e01",
        "  atlasPartName: child",
      ].join("\n")),
      file("r6/tweaks/^fix.yaml", "OptionsIcons.pack_e02.atlasPartName: fixed\n", "A later mod"),
      file("r6/tweaks/pack/ep1_only.yaml", "OptionsIcons.dlc:\n  $type: UIIcon\n  $dlc: EP1\n  atlasPartName: d\n"),
      file("r6/tweaks/old.tweak", "package x"),
    ]);
    expect(overlay.records.get("OptionsIcons.pack_e01")?.type).toBe("UIIcon");
    expect(overlayIcon(overlay, "OptionsIcons.pack_e01")).toEqual({ atlasPath: "pack\\ui\\icons.inkatlas", part: "e01" });
    // The later file's flat wins, and the two files are named as a conflict.
    expect(overlayIcon(overlay, "OptionsIcons.pack_e02")!.part).toBe("fixed");
    expect(overlay.conflicts).toEqual([{ record: "OptionsIcons.pack_e02", field: "atlasPartName", files: ["r6/tweaks/pack/icons.yaml", "r6/tweaks/^fix.yaml"] }]);
    // `$base` gives the atlas; its own part overrides.
    expect(overlayIcon(overlay, "OptionsIcons.pack_child")).toEqual({ atlasPath: "pack\\ui\\icons.inkatlas", part: "child" });
    // A `$dlc` node without the DLC is skipped; with it, kept.
    expect(overlay.records.has("OptionsIcons.dlc")).toBe(false);
    expect(readTweakOverlay([file("r6/tweaks/a.yaml", "OptionsIcons.dlc:\n  $type: UIIcon\n  $dlc: EP1\n  atlasPartName: d\n")], { dlc: new Set(["EP1"]) })
      .records.has("OptionsIcons.dlc")).toBe(true);
    expect(overlay.gaps.some(gap => gap.includes("old.tweak"))).toBe(true);
    expect(overlay.files).toBe(3);
    expect(overlayIcon(overlay, "OptionsIcons.unknown")).toBeNull();
  });

  test("unreadable YAML and list operations are gaps, never errors", () => {
    const overlay = readTweakOverlay([file("r6/tweaks/bad.yaml", "a: [unclosed"), file("r6/tweaks/list.yaml", "Items.X.tags: !append [a]\n")]);
    expect(overlay.gaps.some(gap => gap.includes("bad.yaml"))).toBe(true);
    expect(overlay.gaps.some(gap => gap.includes("list operations"))).toBe(true);
  });
});

