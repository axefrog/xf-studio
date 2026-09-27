/**
 * Serves the face-capture prototype (experiment 026) on its own port and passes every other request through to an isolated Studio
 * server, so the prototype page and the Studio (`/?verify=1`, in an iframe) share one origin and the page can drive V's face through
 * the Studio's own actions. Nothing here is product code.
 *
 *     bun experiments/026-natural-expressions/face-capture/serve.ts --studio http://127.0.0.1:4463 --port 4464
 *
 * MediaPipe comes from the official downloads kept in D:/Dev/tools (`@mediapipe/tasks-vision` 1.0.1 and `face_landmarker.task`,
 * both Apache-2.0); test media from the experiment's ignored `generated/media/`. The prototype page is served with a Content Security
 * Policy that allows no connection off this origin, so camera frames cannot leave the machine and MediaPipe's usage-metrics upload
 * to Google is blocked.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1]! : fallback; };
const studio = new URL(arg("--studio", "http://127.0.0.1:4463"));
const port = Number(arg("--port", "4464"));
const here = import.meta.dir;
const MP = arg("--mediapipe", "D:/Dev/tools/mediapipe-tasks-vision/1.0.1/package");
const MODEL = arg("--model", "D:/Dev/tools/mediapipe-face-landmarker/float16-2023-05-03/face_landmarker.task");
const MEDIA = resolve(here, "..", "generated", "media");

const CSP = ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "connect-src 'self'", "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:", "worker-src 'self' blob:", "style-src 'self' 'unsafe-inline'", "frame-src 'self'"].join("; ");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm",
  ".task": "application/octet-stream", ".png": "image/png", ".jpg": "image/jpeg", ".webm": "video/webm", ".mp4": "video/mp4", ".y4m": "application/octet-stream" };

function file(path: string, extra: Record<string, string> = {}) {
  if (!existsSync(path) || !statSync(path).isFile()) return new Response("Not found", { status: 404 });
  return new Response(Bun.file(path), { headers: { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream", "Cache-Control": "no-store", ...extra } });
}
const inside = (root: string, rel: string) => { const full = resolve(root, rel); return full.startsWith(resolve(root)) ? full : null; };

Bun.serve({
  hostname: "127.0.0.1", port,
  async fetch(request) {
    const url = new URL(request.url), path = decodeURIComponent(url.pathname);
    if (path === "/face-capture" || path === "/face-capture/") return file(resolve(here, "index.html"), { "Content-Security-Policy": CSP });
    if (path === "/face-capture/app.js" || path === "/face-capture/mapping.js" || path === "/face-capture/filters.js") return file(resolve(here, path.split("/").pop()!));
    if (path.startsWith("/face-capture/mp/")) { const p = inside(MP, path.slice("/face-capture/mp/".length)); return p ? file(p) : new Response("Not found", { status: 404 }); }
    if (path === "/face-capture/model/face_landmarker.task") return file(MODEL);
    if (path === "/face-capture/media/") return Response.json(existsSync(MEDIA) ? readdirSync(MEDIA).filter(n => /\.(webm|mp4)$/.test(n)) : []);
    if (path.startsWith("/face-capture/media/")) { const p = inside(MEDIA, path.slice("/face-capture/media/".length)); return p ? file(p) : new Response("Not found", { status: 404 }); }
    // Everything else is the Studio. Its same-origin checks see its own origin.
    const headers = new Headers(request.headers);
    headers.delete("host"); headers.delete("referer");
    if (headers.has("origin")) headers.set("origin", studio.origin);
    const upstream = await fetch(new URL(url.pathname + url.search, studio), { method: request.method, headers, redirect: "manual",
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer() });
    const out = new Headers(upstream.headers);
    out.delete("content-encoding"); out.delete("content-length");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
});
console.log(`Face capture prototype: http://127.0.0.1:${port}/face-capture/ (Studio ${studio.origin})`);
