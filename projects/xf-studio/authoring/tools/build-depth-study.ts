import { resolve } from "node:path";
const output = resolve(import.meta.dir, "../public/build");
const result = await Bun.build({ entrypoints: [resolve(import.meta.dir, "depth-study.ts")], outdir: output, target: "browser" });
if (!result.success) throw new Error(JSON.stringify(result.logs));
await Bun.write(resolve(output, "depth-study.html"), `<!doctype html><html><head><title>XF Studio depth study</title></head>
<body><button id="run">Run depth study</button><div id="stage" style="width:640px;height:640px"></div>
<pre id="output">Ready</pre><script type="module" src="/build/depth-study.js"></script></body></html>`);
console.log("Open http://127.0.0.1:4317/build/depth-study.html and select Run depth study. This uses no workspace or library data.");
