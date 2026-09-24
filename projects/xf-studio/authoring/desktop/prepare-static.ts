import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Deliberately enumerate distributable files. public/assets contains extracted
// game/mod resources and must never be copied into a shell bundle.
const authoring = resolve(import.meta.dir, "..");
const output = resolve(import.meta.dir, "static");
rmSync(output, { recursive: true, force: true });
mkdirSync(resolve(output, "build"), { recursive: true });
cpSync(resolve(authoring, "public", "studio.css"), resolve(output, "studio.css"));
cpSync(resolve(import.meta.dir, "about.css"), resolve(output, "about.css"));
const html = readFileSync(resolve(authoring, "public", "index.html"), "utf8");
const script = '<script type="module" src="/build/studio-main.js"></script>';
if (!html.includes(script)) throw Error("Studio entry changed; review desktop bootstrap before packaging.");
writeFileSync(resolve(output, "index.html"), html.replace(script, '<script type="module" src="/desktop-bootstrap.js"></script>'));
const bootstrap = await Bun.build({ entrypoints: [resolve(import.meta.dir, "bootstrap.js")], target: "browser" });
if (!bootstrap.success || bootstrap.outputs.length !== 1)
  throw Error(bootstrap.logs.map(String).join("\n") || "Desktop bootstrap did not bundle.");
writeFileSync(resolve(output, "desktop-bootstrap.js"), await bootstrap.outputs[0].text());
const result = await Bun.build({
  entrypoints: ["studio-main.ts", "raster-worker.ts"].map(name => resolve(authoring, "src", name)),
  outdir: resolve(output, "build"),
  target: "browser",
});
if (!result.success) throw Error(result.logs.map(String).join("\n"));
console.log(`Prepared ${result.outputs.length} browser bundles and four allowlisted static files.`);
