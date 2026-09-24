/** Regenerate the self-contained style guide: bun tools/build-style-guide.ts [YYYY-MM-DD] */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { guideDocument } from "../src/studio-ui/style-guide/guide";

const root = resolve(import.meta.dir, "..");
export async function buildGuide(generated = new Date().toISOString().slice(0, 10)) {
  const css = readFileSync(resolve(root, "public/studio.css"), "utf8").replace(/\r\n/g, "\n");
  const bundle = await Bun.build({ entrypoints: [resolve(root, "src/studio-ui/style-guide/demo.ts")], target: "browser", minify: true });
  if (!bundle.success) throw Error(bundle.logs.map(String).join("\n"));
  // An inline module must never contain a literal closing script tag.
  const script = (await bundle.outputs[0].text()).replace(/<\/script/gi, "<\\/script");
  return guideDocument({ css, script, generated });
}
if (import.meta.main) {
  const html = await buildGuide(process.argv[2]);
  writeFileSync(resolve(root, "public/style-guide.html"), html);
  console.log(`public/style-guide.html · ${(html.length / 1024).toFixed(0)} KiB`);
}
