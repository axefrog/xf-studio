import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite, fill, parsePage } from "../tools/build";
import { checkSite, trackedRepoFiles } from "../tools/check";
import { loadConfig, normalizeBaseUrl, validateRelease, type SiteConfig } from "../tools/config";

const temp: string[] = [];
const fresh = (baseUrl?: string, release: Partial<Pick<SiteConfig, "releaseStatus" | "release">> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "xfs-site-test-"));
  temp.push(dir);
  return buildSite({ outDir: dir, baseUrl, ...release });
};
afterAll(() => { for (const dir of temp) rmSync(dir, { recursive: true, force: true }); });
const messages = async (dir: string, repoFiles: Set<string> | null = null) =>
  (await checkSite(dir, { repoFiles })).issues.map(issue => `${issue.file}: ${issue.message}`);

describe("build", () => {
  test("renders every page with no leftover placeholders and versioned assets", () => {
    const result = fresh();
    expect(result.pages.filter(page => !page.startsWith("knowledge/"))).toEqual(["404.html", "credits.html", "index.html"]);
    expect(result.pages).toContain("knowledge/index.html");
    for (const page of result.pages) {
      const html = readFileSync(join(result.outDir, page), "utf8");
      expect(html).not.toMatch(/\{\{\w+\}\}/);
      expect(html).toMatch(/assets\/site\.css\?v=[0-9a-f]{10}/);
    }
  });

  test("publishes the complete generated style guide verbatim and rejects drift", async () => {
    const result = fresh();
    const published = join(result.outDir, "style-guide.html");
    const source = readFileSync(join(import.meta.dir, "../../authoring/public/style-guide.html"));
    expect(readFileSync(published).equals(source)).toBe(true);
    expect(result.files).toContain("style-guide.html");
    writeFileSync(published, Buffer.concat([source, Buffer.from("\n<!-- drift -->\n")]));
    expect((await messages(result.outDir)).some(m => m.includes("differs from the generated Studio source"))).toBe(true);
  });

  test("normal pages use relative links; 404 uses base-path links so it works at any depth", () => {
    const result = fresh("https://example.github.io/other-repo");
    const index = readFileSync(join(result.outDir, "index.html"), "utf8");
    const missing = readFileSync(join(result.outDir, "404.html"), "utf8");
    expect(index).toContain('href="assets/site.css?v=');
    expect(index).toContain('<link rel="canonical" href="https://example.github.io/other-repo/">');
    expect(missing).toContain('href="/other-repo/assets/site.css?v=');
    expect(missing).toContain('href="/other-repo/credits.html"');
    expect(missing).toContain('<meta name="robots" content="noindex">');
    expect(missing).not.toContain('rel="canonical"');
    expect(readFileSync(join(result.outDir, "sitemap.xml"), "utf8")).not.toContain("404");
  });

  test("positions XF Studio as a broader customisation studio, with eye makeup as its first feature", () => {
    const { outDir } = fresh();
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    const meta = (pattern: RegExp) => pattern.exec(html)?.[1] ?? "";
    const title = meta(/<title>([^<]*)<\/title>/);
    const description = meta(/<meta name="description" content="([^"]*)"/);
    const h1 = meta(/<h1 id="hero-title">([^<]*)<\/h1>/);
    // The product is not defined by its first feature; eye makeup is presented as today's focus.
    for (const text of [title, h1]) expect(text).not.toMatch(/eye.?makeup/i);
    expect(title).toContain("Cyberpunk 2077");
    expect(description).toMatch(/starting with your own V/);
    expect(description).toMatch(/eye makeup is its first working feature/i);
    expect(html).toContain('href="./#eye-makeup"');
  });

  test("placeholders and page headers fail loudly", () => {
    expect(() => fill("{{nope}}", {}, "x.html")).toThrow("unknown placeholder {{nope}}");
    expect(() => parsePage("<p>no header</p>", "x.html")).toThrow("missing <!--page");
    expect(() => parsePage('<!--page {"title": ""} -->', "x.html")).toThrow("title and description");
  });

  test("base URLs are normalised and must be https", () => {
    expect(normalizeBaseUrl("https://axefrog.github.io/xf-studio")).toBe("https://axefrog.github.io/xf-studio/");
    expect(() => normalizeBaseUrl("http://axefrog.github.io/xf-studio/")).toThrow("https");
    expect(loadConfig({ baseUrl: "https://a.example/b" }).baseUrl).toBe("https://a.example/b/");
  });
});

describe("checks", () => {
  test("the real site passes, including repository links against tracked files", async () => {
    const result = fresh();
    const repoFiles = trackedRepoFiles();
    const report = await checkSite(result.outDir, { repoFiles });
    expect(report.issues).toEqual([]);
    expect(report.repoLinks).toBeGreaterThan(5);
    expect(report.bytes).toBeLessThan(result.config.budgets.totalBytes);
  });

  test("rejects files outside the content policy", async () => {
    const { outDir } = fresh();
    writeFileSync(join(outDir, "assets", "head-render.png"), new Uint8Array(8));
    writeFileSync(join(outDir, "assets", "notes.txt"), "copied from D:/Dev/cp2077-modding-hq/inventory");
    const found = await messages(outDir);
    expect(found.some(m => m.includes("head-render.png") && m.includes("not allowed"))).toBe(true);
    expect(found.some(m => m.includes("notes.txt") && m.includes("local machine path"))).toBe(true);
  });

  test("rejects broken links, anchors, downloads and untracked repository targets", async () => {
    const { outDir } = fresh();
    const file = join(outDir, "credits.html");
    const repo = loadConfig().repoUrl;
    writeFileSync(file, readFileSync(file, "utf8").replace("</main>",
      `<a href="missing.html">x</a><a href="./#no-such-section">y</a><a href="https://example.com/xfs.zip">z</a>` +
      `<a href="${repo}/releases/latest">r</a><a href="${repo}/blob/main/inventory/snapshots/private.json">p</a></main>`));
    const found = await messages(outDir, new Set(["docs/status.md"]));
    expect(found.some(m => m.includes("broken internal href: missing.html"))).toBe(true);
    expect(found.some(m => m.includes('no id "no-such-section"'))).toBe(true);
    expect(found.some(m => m.includes("downloadable package"))).toBe(true);
    expect(found.some(m => m.includes("link to releases while unreleased"))).toBe(true);
    expect(found.some(m => m.includes("not a tracked file: inventory/snapshots/private.json"))).toBe(true);
  });

  test("guards release claims and the visible release-status statement", async () => {
    const { outDir } = fresh();
    const file = join(outDir, "index.html");
    writeFileSync(file, readFileSync(file, "utf8").replace(" data-release-status", "").replace("</main>", "<p>Download now!</p></main>"));
    const found = await messages(outDir);
    expect(found.some(m => m.includes("[data-release-status]"))).toBe(true);
    expect(found.some(m => m.includes("“download now”"))).toBe(true);
  });

  test("the default unreleased download section explains releases without linking one", async () => {
    const { outDir } = fresh();
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    expect(html).toContain('data-download="unreleased"');
    expect(html).toContain("There is nothing to download yet.");
    expect(html).not.toMatch(/\/releases/);
    expect(html).toMatch(/<meta name="description" content="[^"]*No public release yet\."/);
  });

  test("a configured pre-release renders the tag link, checksums, attestation and SmartScreen steps", async () => {
    const release = { tag: "v0.1.0-alpha.1", title: "XF Studio 0.1.0 alpha 1" };
    const result = fresh(undefined, { releaseStatus: "prerelease", release });
    const html = readFileSync(join(result.outDir, "index.html"), "utf8");
    expect(html).toContain('data-download="prerelease"');
    expect(html).toContain('href="https://github.com/axefrog/xf-studio/releases/tag/v0.1.0-alpha.1"');
    expect(html).toContain("XFStudio-0.1.0-alpha.1-win-x64-setup.exe");
    expect(html).toContain("nothing to extract");
    expect(html).not.toContain("ZIP");
    expect(html).toContain("Get-FileHash");
    expect(html).toContain("gh attestation verify XFStudio-0.1.0-alpha.1-win-x64-setup.exe --repo axefrog/xf-studio");
    expect(html).toContain("<strong>Run anyway</strong>");
    expect(html).toContain("Alpha pre-release");
    expect(html).toMatch(/<meta name="description" content="[^"]*unsigned Windows alpha/);
    expect((await checkSite(result.outDir, { config: result.config, repoFiles: null })).issues).toEqual([]);

    // Pre-releases are invisible to /releases/latest, and direct asset links bypass the release page.
    const file = join(result.outDir, "index.html");
    writeFileSync(file, html.replace("</main>", '<a href="https://github.com/axefrog/xf-studio/releases/latest">x</a>' +
      '<a href="https://github.com/axefrog/xf-studio/releases/tag/v0.0.9-alpha.1">y</a><p>Now tested in game.</p></main>'));
    const found = (await checkSite(result.outDir, { config: result.config, repoFiles: null })).issues.map(issue => issue.message);
    expect(found.filter(m => m.includes("release link must be"))).toHaveLength(2);
    expect(found.some(m => m.includes("“tested in game”"))).toBe(true);
    // The rendered section must match the configured state.
    expect((await checkSite(result.outDir, { repoFiles: null })).issues.some(issue => issue.message.includes('rendered for releaseStatus "unreleased"'))).toBe(true);
  });

  test("release configuration is validated", () => {
    expect(() => validateRelease({ releaseStatus: "unreleased", release: { tag: "v0.1.0-alpha.1", title: "x" } })).toThrow("must be null");
    expect(() => validateRelease({ releaseStatus: "prerelease", release: null })).toThrow("needs release.tag");
    expect(() => validateRelease({ releaseStatus: "prerelease", release: { tag: "v0.1.0", title: "x" } })).toThrow("use releaseStatus released");
    expect(() => validateRelease({ releaseStatus: "released", release: { tag: "v1.0.0-rc.1", title: "x" } })).toThrow("use releaseStatus prerelease");
    expect(() => validateRelease({ releaseStatus: "prerelease", release: { tag: "0.1.0-alpha.1", title: "x" } })).toThrow("needs release.tag");
    expect(() => validateRelease({ releaseStatus: "released", release: { tag: "v1.0.0", title: "XF Studio 1.0.0" } })).not.toThrow();
  });

  test("future directions carry no dates or schedule promises, and the home page keeps them marked", async () => {
    const { outDir } = fresh();
    const file = join(outDir, "index.html");
    const html = readFileSync(file, "utf8");
    writeFileSync(file, html.replace("Quest design is one possibility.", "Quest design is coming in 2027."));
    const dated = await messages(outDir);
    expect(dated.some(m => m.includes("contains a date or schedule: “coming”"))).toBe(true);
    writeFileSync(file, html.replaceAll(" data-future", ""));
    expect((await messages(outDir)).some(m => m.includes("[data-future]"))).toBe(true);
  });

  test("flags accessibility and CSP regressions", async () => {
    const { outDir } = fresh();
    const file = join(outDir, "credits.html");
    writeFileSync(file, readFileSync(file, "utf8").replace("</main>",
      `<h4>skipped level</h4><h1>second h1</h1><img src="assets/favicon.svg"><button>go</button><a href="#main"></a>` +
      `<div style="color:red" onclick="x()">bad</div><script>alert(1)</script></main>`));
    const found = (await messages(outDir)).join("\n");
    for (const expected of ["heading level jumps", "exactly one <h1>", "<img> without alt", "<button> without type",
      "has no accessible name", "inline style attribute", "inline event handler onclick", "inline <script>"])
      expect(found).toContain(expected);
  });
});
