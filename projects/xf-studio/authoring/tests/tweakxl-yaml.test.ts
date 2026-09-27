// The TweakXL YAML reader (tweakxl-yaml.ts): tags and scalar text survive, the block and flow forms TweakXL files use parse to the same tree,
// and what it doesn't read is refused with a line number.
import { describe, expect, test } from "bun:test";
import { mapGet, parseTweakYaml, scalarText, toPlain, YamlError, type YamlNode } from "../src/tweakxl-yaml";

const tags = (node: YamlNode | undefined) => node?.kind === "seq" ? node.items.map(item => [item.tag, scalarText(item)]) : null;

describe("the TweakXL YAML reader", () => {
  test("scalars keep their text: 01, 0.50, true and a quoted string are all text", () => {
    expect(toPlain(parseTweakYaml("a: 01\nb: 0.50\nc: true\nd: '01'\ne: \"x\\ty\"\nf: ~\ng:\n"))).toEqual({ a: "01", b: "0.50", c: "true", d: "01", e: "x\ty", f: null, g: null });
  });

  test("item tags survive in block and flow lists, with or without a tag on the key's own line", () => {
    const doc = parseTweakYaml([
      "photo_mode.character.femalePoses:",
      "  - !append-once PhotoModePoses.a   # a comment",
      "  - !remove PhotoModePoses.b",
      "same.indent:",
      "- !prepend x",
      "flow: [!append y, !append-once 'z z', plain]",
      "removeAll:",
      "  - !remove-all",
    ].join("\n"));
    expect(tags(mapGet(doc, "photo_mode.character.femalePoses"))).toEqual([["!append-once", "PhotoModePoses.a"], ["!remove", "PhotoModePoses.b"]]);
    expect(tags(mapGet(doc, "same.indent"))).toEqual([["!prepend", "x"]]);
    expect(tags(mapGet(doc, "flow"))).toEqual([["!append", "y"], ["!append-once", "z z"], [null, "plain"]]);
    expect(tags(mapGet(doc, "removeAll"))).toEqual([["!remove-all", null]]);
  });

  test("anchors and aliases share the node, tags included; duplicate keys stay in order", () => {
    const doc = parseTweakYaml("a: &list\n  - !append-once m\nb: *list\nk: 1\nk: 2\n");
    expect(mapGet(doc, "b")).toBe(mapGet(doc, "a")!);
    expect(doc?.kind === "map" && doc.entries.filter(([key]) => key === "k").map(([, v]) => scalarText(v))).toEqual(["1", "2"]);
    expect(toPlain(doc)).toMatchObject({ k: "2" });
  });

  test("records: nested maps, compact maps in lists, flow maps, block scalars, multi-line plain text and a document marker", () => {
    const doc = parseTweakYaml([
      "---",
      "PhotoModePoses.x:",
      "  $base: PhotoModePoses.idle_stand_01",
      "  displayName: a long",
      "    label",
      "  positionOffset: { x: 0, y: 0, z: 0.35 }",
      "  filterOutForGarmentTags: [ Coat, HeadCover ]",
      "  notes: |",
      "    line 1",
      "    line 2",
      "  list:",
      "    - name: a",
      "      value: 1",
      "    - - nested",
      "...",
      "ignored: second document",
    ].join("\r\n"));
    expect(toPlain(doc)).toEqual({ "PhotoModePoses.x": {
      $base: "PhotoModePoses.idle_stand_01", displayName: "a long label", positionOffset: { x: "0", y: "0", z: "0.35" },
      filterOutForGarmentTags: ["Coat", "HeadCover"], notes: "line 1\nline 2\n", list: [{ name: "a", value: "1" }, ["nested"]],
    } });
  });

  test("keys with spaces, quoted keys, colons inside values, and # inside text", () => {
    expect(toPlain(parseTweakYaml("'quoted key': v\nplain key: a:b\nurl: http://x#y\nhash: a #comment\n")))
      .toEqual({ "quoted key": "v", "plain key": "a:b", url: "http://x#y", hash: "a" });
  });

  test("what it doesn't read is refused with the line", () => {
    for (const [text, line] of [["a: [x, y", 1], ["a:\n\t- x", 2], ["a: 'open", 1], ["? complex\n: v", 1], ["a: \"\\q\"", 1], ["a: *missing", 1]] as const) {
      let error: unknown;
      try { parseTweakYaml(text); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(YamlError);
      expect((error as YamlError).line).toBe(line);
    }
  });

  test("an empty file is null; a byte order mark is skipped", () => {
    expect(parseTweakYaml("# only a comment\n")).toBeNull();
    expect(toPlain(parseTweakYaml("\uFEFFa: b"))).toEqual({ a: "b" });
  });
});
