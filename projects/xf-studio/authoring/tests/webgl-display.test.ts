import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, type Session } from "../tools/cdp";
import { oracleDescribe } from "./optional-oracles";

/**
 * Real-GPU checks in headless Chrome (tests/webgl-probe-page.ts): every renderer material variant compiles and draws in
 * WebGL 2 (PREV-56), and the studio display blends in linear light, so a face decal shows the colour of the game's
 * square-root-space blend in both lighting presets (PREV-50). Needs a local Chrome; public CI has none and skips, and
 * XFS_REQUIRE_ORACLES=1 turns the skip into a failure.
 */
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
type Probe = { ok: boolean; linear: boolean; renderer: string; errors: string[]; programs: string[]; failure?: string;
  blends: { name: string; target: number[]; studio: number[]; creator: number[]; creatorTarget: number[]; direct: number[] }[];
  opaque: { studio: number[]; direct: number[] }; backdrop: { studio: number[]; direct: number[] } };
const gap = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((value, k) => Math.abs(value - b[k]!)));

oracleDescribe(existsSync(CHROME), `headless Chrome is not installed at ${CHROME} (set CHROME)`)("renderer shaders on a real GPU", () => {
  const out = mkdtempSync(join(tmpdir(), "xfs-webgl-probe-"));
  let server: ReturnType<typeof Bun.serve> | undefined, page: Session | undefined, probe: Probe;
  beforeAll(async () => {
    const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, "webgl-probe-page.ts")], outdir: out, target: "browser", naming: "probe.js" });
    if (!build.success) throw Error(build.logs.map(String).join("\n"));
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: request => new URL(request.url).pathname === "/probe.js"
      ? new Response(Bun.file(join(out, "probe.js")), { headers: { "content-type": "text/javascript" } })
      : new Response(`<!doctype html><meta charset="utf-8"><body><script type="module" src="/probe.js"></script>`, { headers: { "content-type": "text/html" } }) });
    page = await launch(`http://127.0.0.1:${server.port}/`, { width: 200, height: 200, debugPort: 9200 + (server.port! % 500) });
    await page.waitFor("window.probe", 60_000);
    probe = await page.evaluate("window.probe");
  }, 90_000);
  afterAll(async () => { await page?.close(); server?.stop(true); rmSync(out, { recursive: true, force: true }); });

  test("every decal family variant (plain, double diffuse, gradient recolour), the brows, skin, eyes and display passes compile and draw", () => {
    expect(probe.failure).toBeUndefined();
    expect(probe.ok).toBe(true);
    expect(probe.errors).toEqual([]);
    expect(probe.programs.length).toBeGreaterThanOrEqual(10);
  });

  test("the studio stage shows a decal as the game's square-root blend, within rounding, as the creator preset does (PREV-50)", () => {
    expect(probe.linear).toBe(true);
    for (const blend of probe.blends) {
      expect(gap(blend.studio, blend.target)).toBeLessThanOrEqual(2);
      expect(gap(blend.creator, blend.creatorTarget)).toBeLessThanOrEqual(2);
    }
    // Drawn straight to the canvas (the old studio path) the blend happens after tone mapping and encoding: the liner is far off.
    expect(gap(probe.blends.find(blend => blend.name === "dark liner")!.direct, probe.blends[0]!.target)).toBeGreaterThan(10);
  });

  test("opaque surfaces and the stage backdrop keep the pixels they had when drawn straight to the canvas", () => {
    expect(gap(probe.opaque.studio, probe.opaque.direct)).toBeLessThanOrEqual(1);
    expect(probe.backdrop.studio).toEqual(probe.backdrop.direct);
  });
});
