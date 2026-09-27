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

  test("unreadable YAML and a tag on a whole list are gaps, never errors", () => {
    const overlay = readTweakOverlay([file("r6/tweaks/bad.yaml", "a: [unclosed"), file("r6/tweaks/list.yaml", "Items.X.tags: !append [a]\n")]);
    expect(overlay.gaps.some(gap => gap.includes("bad.yaml"))).toBe(true);
    // TweakXL reads operation tags on items only: a tagged list is an assignment.
    expect(overlay.gaps.some(gap => gap.includes("tags the whole list"))).toBe(true);
    expect(overlay.list("Items.X.tags", ["b"])).toEqual(["a"]);
  });

  test("scalars keep their text: a label written 01 stays \"01\", not the number 1", () => {
    const overlay = readTweakOverlay([file("r6/tweaks/p.yaml", "PhotoModePoses.a:\n  $base: PhotoModePoses.idle_stand_01\n  displayName: 01\n  animationTime: 0.50\n  locked: false\n")]);
    expect(overlay.field("PhotoModePoses.a", "displayName")).toBe("01");
    expect(overlay.field("PhotoModePoses.a", "animationTime")).toBe("0.50");
    expect(overlay.field("PhotoModePoses.a", "locked")).toBe("false");
    // A creator icon part written as a number keeps its text too.
    expect(overlayIcon(readTweakOverlay([file("r6/tweaks/i.yaml", "OptionsIcons.x:\n  $type: UIIcon\n  atlasPartName: 007\n")]), "OptionsIcons.x")!.part).toBe("007");
  });
});

describe("TweakXL list operations", () => {
  const list = "photo_mode.character.femalePoses";
  const edit = (...texts: string[]) => readTweakOverlay(texts.map((text, i) => file(`r6/tweaks/f${i}.yaml`, text)));

  test("!append adds at the end, even when the element is present", () => {
    expect(edit(`${list}:\n  - !append b\n  - !append c\n`).list(list, ["a", "b"])).toEqual(["a", "b", "b", "c"]);
  });
  test("!append-once skips an element already present, including one appended earlier", () => {
    expect(edit(`${list}:\n  - !append-once b\n  - !append-once c\n`, `${list}:\n  - !append-once c\n  - !append-once d\n`).list(list, ["a", "b"]))
      .toEqual(["a", "b", "c", "d"]);
  });
  test("!prepend inserts at the front in declaration order", () => {
    expect(edit(`${list}:\n  - !prepend x\n  - !prepend y\n`).list(list, ["a"])).toEqual(["x", "y", "a"]);
  });
  test("!prepend-once skips an element already present", () => {
    expect(edit(`${list}:\n  - !prepend-once a\n  - !prepend-once z\n`).list(list, ["a"])).toEqual(["z", "a"]);
  });
  test("!remove removes the first occurrence, before any insertion (a later file's append of it still lands)", () => {
    expect(edit(`${list}:\n  - !append-once b\n`, `${list}:\n  - !remove b\n  - !remove q\n`).list(list, ["a", "b", "c", "b"])).toEqual(["a", "c", "b"]);
  });
  test("!remove-all empties the compiled list; appends still apply", () => {
    expect(edit(`${list}:\n  - !remove-all\n  - !append z\n`).list(list, ["a", "b"])).toEqual(["z"]);
  });
  test("!append-from and !merge add another flat's elements not already present; !prepend-from at the front", () => {
    const overlay = edit(`${list}:\n  - !append-from extra.list\n  - !prepend-from front.list\n`, `other.list:\n  - !merge extra.list\n`);
    const source = (flat: string) => flat === "extra.list" ? ["b", "e"] : flat === "front.list" ? ["f", "a"] : null;
    expect(overlay.list(list, ["a", "b"], source)).toEqual(["f", "a", "b", "e"]);
    expect(overlay.list("other.list", null, source)).toEqual(["b", "e"]);
  });
  test("a plain list assigns; a later file's mutations apply over it; untagged items beside tags are ignored", () => {
    const overlay = edit(`${list}:\n  - p\n  - q\n`, `${list}:\n  - !append r\n  - ignored\n`);
    expect(overlay.list(list, ["a"])).toEqual(["p", "q", "r"]);
    expect(overlay.lists.get(list)!.mutations.map(m => m.op)).toEqual(["append"]);
    // No file touches it: the compiled value.
    expect(overlay.list("untouched.list", ["a"])).toEqual(["a"]);
  });
  test("a YAML anchor carries the item tags to every list that reuses it", () => {
    const overlay = edit(`${list}: &poses\n  - !append-once m1\n  - !append-once m2\nphoto_mode.character.judyPoses: *poses\n`);
    expect(overlay.list("photo_mode.character.judyPoses", ["j"])).toEqual(["j", "m1", "m2"]);
  });
  test("list operations in a record's field mutate that field's flat", () => {
    const overlay = edit("Items.A:\n  $base: Items.B\n  tags:\n    - !append-once New\n");
    expect(overlay.list("Items.A.tags", ["Old"])).toEqual(["Old", "New"]);
    expect(overlay.field("Items.A", "tags")).toBeNull();
  });
});

