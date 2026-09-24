/**
 * Local preview of the built site under the same base path GitHub Pages uses (e.g. /xf-studio/),
 * so path mistakes show up before deployment: bun tools/serve.ts [--port 4400] [--dir dist]
 * Missing paths return dist/404.html with status 404, as Pages does.
 */
import { existsSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { basePath, loadConfig, siteRoot } from "./config";

export function serveSite(options: { dir?: string; port?: number } = {}) {
  const dir = resolve(options.dir ?? join(siteRoot, "dist"));
  const base = basePath(loadConfig());
  const file = (path: string) => {
    const full = normalize(join(dir, path));
    return full.startsWith(dir) && existsSync(full) && statSync(full).isFile() ? full : null;
  };
  return Bun.serve({
    port: options.port ?? 4400,
    hostname: "127.0.0.1",
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/" || url.pathname === base.slice(0, -1)) return Response.redirect(new URL(base, url).href, 302);
      if (url.pathname.startsWith(base)) {
        let path = decodeURIComponent(url.pathname.slice(base.length));
        if (path === "" || path.endsWith("/")) path += "index.html";
        const found = file(path) ?? file(`${path}.html`);
        if (found) return new Response(Bun.file(found), { headers: { "cache-control": "no-store" } });
      }
      const missing = file("404.html");
      return new Response(missing ? Bun.file(missing) : "Not found", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const server = serveSite({ port: Number(option("--port") ?? 4400), dir: option("--dir") });
  console.log(`Serving ${option("--dir") ?? "dist"} at http://127.0.0.1:${server.port}${basePath(loadConfig())}  (Ctrl+C to stop)`);
}
