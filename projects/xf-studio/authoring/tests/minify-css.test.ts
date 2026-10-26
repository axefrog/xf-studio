import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { minifyCss } from "../src/studio-ui/style-guide/minify-css";

test("drops comments and whitespace beside punctuation, keeps the spaces that mean something", () => {
  expect(minifyCss("/* c */\n.a  b > .c ,\n.d:hover   :is(x, y) {\n  margin: 0  auto; /* tail */\n  padding: calc(1px + 2px) 3px !important;\n}\n"))
    .toBe(".a b > .c,.d:hover :is(x,y){margin:0 auto;padding:calc(1px + 2px) 3px !important;}");
  expect(minifyCss("@media (min-width: 600px) and (max-width: 900px) { .a { color: red } }")).toBe("@media (min-width:600px) and (max-width:900px){.a{color:red}}");
});

test("copies strings and unquoted url() bodies untouched", () => {
  const css = `.a::before { content: "  a  /* not a comment */ ; b  "; background: url(data:image/svg+xml;utf8,<svg a  b/>) , url( "x  y.png" ); }`;
  expect(minifyCss(css)).toBe(`.a::before{content:"  a  /* not a comment */ ; b  ";background:url(data:image/svg+xml;utf8,<svg a  b/>),url( "x  y.png" );}`);
  expect(minifyCss(String.raw`.a { content: 'it\'s  ok' }`)).toBe(String.raw`.a{content:'it\'s  ok'}`);
});

test("shrinks the Studio stylesheet without changing what the browser parses", async () => {
  const path = resolve(import.meta.dir, "../public/studio.css");
  const css = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const small = minifyCss(css);
  expect(small.length).toBeLessThan(css.length * 0.85);
  // Bun's CSS parser rewrites both to one canonical form; they must agree (it prints `@supports (a: b)` with the space, we without).
  const canonical = async (text: string) => {
    const result = await Bun.build({ entrypoints: ["style.css"], files: { "style.css": text }, minify: true });
    return (await result.outputs[0].text()).replace(/\(([a-z-]+): /g, "($1:");
  };
  expect(await canonical(small)).toBe(await canonical(css));
});
