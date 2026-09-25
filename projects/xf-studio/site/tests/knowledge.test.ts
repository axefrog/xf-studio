import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildSite } from "../tools/build";
import { checkSite } from "../tools/check";
import { loadConfig, repoRoot } from "../tools/config";
import { loadKnowledge, parseKnowledgeIndex } from "../tools/knowledge";
import { badgeGrades, checkTables, githubSlug, mermaidOutline, renderMarkdown } from "../tools/markdown";
import { findPersonalData, PRIVATE_DATA } from "../tools/privacy";

const temp: string[] = [];
const tempDir = (prefix: string) => { const dir = mkdtempSync(join(tmpdir(), prefix)); temp.push(dir); return dir; };
afterAll(() => { for (const dir of temp) rmSync(dir, { recursive: true, force: true }); });
const config = loadConfig();
const blob = `${config.repoUrl}/blob/${config.repoBranch}`;

const README = `# Test knowledge base

## Rules for knowledge pages

- **Grade every non-trivial claim:**
  - **[source]** read in source;
  - **[resource]** observed in resources;
  - **[hypothesis]** not yet established.

## Topics

| Topic | Page | Maturity | Existing research to consolidate |
|---|---|---|---|
| The \`.app\` chain | [alpha.md](alpha.md) | Draft (partial) | [x](../research/x.md) |
| Early notes | [beta.md](beta.md) | Seed | — |
| Future topic | \`gamma.md\` (to write) | Seed | — |
`;
const ALPHA = `# Alpha \`chain\`

**Maturity: Draft.** Rules follow the [knowledge rules](README.md); see [beta](beta.md) and [the evidence](../research/x.md#details).

## 1. What ArchiveXL/CCXL does

| Field | Value | Grade |
|---|---|---|
| \`a \\| b\` | pipe kept | [source] |
| [resource: file.xl] | long form | **[hypothesis]** |

Inline [source] claim, and \`[source]\` in code stays literal. A [folder](../research) link.

\`\`\`mermaid
flowchart TD
    A["First box<br/>with detail"] -->|merges| B
    B["Second box"] -.-> C
\`\`\`

## 1. What ArchiveXL/CCXL does
`;

/** A throwaway repository layout: knowledge/ plus the research files its pages link to. */
function fixture(files: Record<string, string>): string {
  const root = tempDir("xfs-knowledge-");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const base = { "knowledge/README.md": README, "knowledge/alpha.md": ALPHA, "knowledge/beta.md": "# Beta\n\nSeed notes.\n", "research/x.md": "# X\n" };
const load = (files: Record<string, string> = base) =>
  loadKnowledge({ repoRoot: fixture(files), repoUrl: config.repoUrl, repoBranch: config.repoBranch, tracked: null, dateOf: () => "2026-09-01" });

describe("knowledge generator", () => {
  test("reads grades and topics from knowledge/README.md and publishes only Draft-or-better pages", () => {
    const knowledge = load();
    expect(knowledge.grades.map(grade => grade.name)).toEqual(["source", "resource", "hypothesis"]);
    expect(knowledge.topics.map(topic => [topic.slug, topic.maturity, topic.written])).toEqual([["alpha", "Draft", true], ["beta", "Seed", true], ["gamma", "Seed", false]]);
    expect(knowledge.topics[0].summaryHtml).toBe("The <code>.app</code> chain");
    expect(knowledge.topics[0].maturityNote).toBe("partial");
    expect(knowledge.pages.map(page => page.slug)).toEqual(["alpha"]);
    expect(knowledge.skipped).toEqual([{ slug: "beta", reason: "maturity Seed" }]);
  });

  test("renders the page: title, GitHub-style ids, links, tables, grades and diagrams", () => {
    const page = load().pages[0];
    expect(page.title).toBe("Alpha chain");
    expect(page.updated).toBe("2026-09-01");
    const html = page.html;
    // Headings keep GitHub's anchors (punctuation dropped, duplicates numbered), so links shared from GitHub still work.
    expect(page.headings.map(heading => heading.id)).toEqual(["1-what-archivexlccxl-does", "1-what-archivexlccxl-does-1"]);
    // README → knowledge index; unpublished (Seed) sibling and research files → GitHub; folders → tree.
    expect(html).toContain('<a href="./">knowledge rules</a>');
    expect(html).toContain(`<a href="${blob}/knowledge/beta.md">beta</a>`);
    expect(html).toContain(`<a href="${blob}/research/x.md#details">the evidence</a>`);
    expect(html).toContain(`<a href="${config.repoUrl}/tree/${config.repoBranch}/research">folder</a>`);
    // Tables scroll in a labelled region; escaped pipes survive.
    expect(html).toContain('<div class="table-scroll" role="region" tabindex="0" aria-label="Table: Field, Value, Grade">');
    expect(html).toContain("<code>a | b</code>");
    // Grades become badges outside code; the long form badges its grade word.
    expect(html).toContain('<span class="grade" data-grade="source">source</span> claim');
    expect(html).toContain('[<span class="grade" data-grade="resource">resource</span>: file.xl]');
    expect(html).toContain('<strong><span class="grade" data-grade="hypothesis">hypothesis</span></strong>');
    expect(html).toContain("<code>[source]</code>");
    // Mermaid: listed as text, with the source and a link to GitHub's drawing.
    expect(html).toContain('<figure class="diagram"');
    expect(html).toContain(`href="${blob}/knowledge/alpha.md#1-what-archivexlccxl-does"`);
    expect(html).toMatch(/<span class="node">First box<\/span>.*<span class="node">Second box<\/span> <span class="edge-label">\(merges\)<\/span>/);
    expect(html).toContain("<dt>First box</dt><dd>with detail</dd>");
    expect(html).toContain("Mermaid source");
  });

  test("keeps the site in sync with the README: unlisted pages and missing linked pages fail", () => {
    expect(() => load({ ...base, "knowledge/delta.md": "# Delta\n" })).toThrow("not listed in the knowledge/README.md Topics table");
    const { "knowledge/alpha.md": _, ...missing } = base;
    expect(() => load(missing)).toThrow("links alpha.md, which does not exist");
  });

  test("refuses broken, private and out-of-repository links", () => {
    const withLink = (link: string) => ({ ...base, "knowledge/alpha.md": `# Alpha\n\nSee [x](${link}).\n` });
    expect(() => load(withLink("../research/missing.md"))).toThrow("broken link");
    expect(() => load({ ...withLink("../research/consumers/cc/raw.json"), "research/consumers/cc/raw.json": "{}" })).toThrow("private or raw-data location");
    expect(() => load(withLink("../../outside.md"))).toThrow("leaves the repository");
    expect(() => load(withLink("javascript:alert(1)"))).toThrow("not allowed");
    // With git tracking known, an ignored (untracked) file cannot be linked either.
    const root = fixture(withLink("../research/x.md"));
    expect(() => loadKnowledge({ repoRoot: root, repoUrl: config.repoUrl, repoBranch: "main", tracked: new Set(["knowledge/README.md"]), dateOf: () => null }))
      .toThrow("not tracked by git");
  });

  test("fails on personal paths and e-mail addresses in a page", () => {
    for (const secret of ["C:\\Users\\jdoe\\Documents\\save.dat", "C:/Users/jdoe/AppData", "jane@gmail.com"])
      expect(() => load({ ...base, "knowledge/alpha.md": `# Alpha\n\nFound in \`${secret}\`.\n` })).toThrow("personal data");
  });

  test("fails on personal data in the index's topic summaries (SITE-01)", () => {
    const summary = (text: string) => ({ ...base, "knowledge/README.md": README.replace("The `.app` chain", text) });
    expect(() => load(summary("Found in `C:\\Users\\jdoe\\AppData`"))).toThrow("knowledge/README.md: contains personal data");
    expect(() => load(summary("Ask jane.doe@gmail.com."))).toThrow("knowledge/README.md: contains personal data");
    // The error is redacted: build logs are public.
    expect(() => load(summary("Found in `C:\\Users\\jdoe\\AppData`"))).toThrow(/C:\\Users\\j\*\*\*/);
    // A placeholder passes, although the rendered summary splits it with <wbr>.
    expect(load(summary("Found in `C:\\Users\\<name>\\AppData`")).topics[0].summaryHtml).toContain("<wbr>");
  });

  test("fails on table rows that GFM would split, and on images", () => {
    expect(checkTables("| a | b |\n|---|---|\n| `x|y` | z |\n")).toHaveLength(1);
    expect(checkTables("| a | b |\n|---|---|\n| `x\\|y` | z |\n")).toEqual([]);
    expect(() => renderMarkdown("# T\n\n| a | b |\n|---|---|\n| `x|y` | z |\n", { link: href => href })).toThrow("escape pipes");
    expect(() => renderMarkdown("# T\n\n![alt](shot.png)\n", { link: href => href })).toThrow("images are not published");
  });

  test("small helpers", () => {
    const seen = new Set<string>();
    expect(githubSlug("Template → x & y's `code`", seen)).toBe("template--x--ys-code");
    expect(githubSlug("Dup", seen)).toBe("dup");
    expect(githubSlug("Dup", seen)).toBe("dup-1");
    expect(badgeGrades('<p>[source] <code>[source]</code> <a title="[source]">x</a></p>', [{ name: "source", description: "d" }]))
      .toBe('<p><span class="grade" data-grade="source">source</span> <code>[source]</code> <a title="[source]">x</a></p>');
    expect(mermaidOutline("sequenceDiagram\nA->>B: hi")).toBeNull();
    expect(parseKnowledgeIndex(README).rows).toHaveLength(3);
  });
});

describe("privacy guard", () => {
  test("the shared vectors (tools/private-data.json) agree with the repository check and the packaged-app scan (SITE-02)", () => {
    const { userPath, email, clean } = PRIVATE_DATA.vectors;
    for (const text of userPath) expect(findPersonalData(text), text).toHaveLength(1);
    for (const text of email) expect(findPersonalData(text).map(found => found.name), text).toEqual(["e-mail address"]);
    for (const text of clean) expect(findPersonalData(text), text).toEqual([]);
    // Real top-level domains are addresses; only the material-reference shape is not.
    expect(findPersonalData("jane@gmail.app").map(found => found.name)).toEqual(["e-mail address"]);
    expect(findPersonalData("jane@company.mt").map(found => found.name)).toEqual(["e-mail address"]);
    expect(findPersonalData("/mnt/c/Users/jdoe/x").map(found => found.name)).toEqual(["WSL user-profile path"]);
    // Findings are redacted.
    expect(findPersonalData("C:\\Users\\jdoe\\x")).toEqual([{ name: "Windows user-profile path", match: "C:\\Users\\j***" }]);
  });

  test("recognises personal paths and addresses, not placeholders or look-alikes", () => {
    for (const bad of ["C:\\Users\\alice\\x", "c:/users/alice/", "D:\\\\Users\\\\bob\\\\x", "/home/carol/.config", "/Users/dave/Library", "eve@mailbox.org", "file:///C:/Users/frank/"])
      expect(findPersonalData(bad).length).toBeGreaterThan(0);
    for (const ok of ["%USERPROFILE%\\Documents", "PATH_TO_GAME\\archive\\pc\\mod", "C:\\Users\\Public", "black_carbon@long", "name@tpl", "@context",
      "https://github.com/home/x", "noreply at example dot com", "ash_brown@long.mi"])
      expect(findPersonalData(ok)).toEqual([]);
  });
});

describe("published knowledge section", () => {
  const outDir = tempDir("xfs-knowledge-site-");
  const result = buildSite({ outDir });
  const read = (path: string) => readFileSync(join(outDir, path), "utf8");

  test("publishes an index and every Draft-or-better page listed in knowledge/README.md", () => {
    const readme = readFileSync(join(repoRoot, "knowledge", "README.md"), "utf8");
    const listed = parseKnowledgeIndex(readme).rows.filter(row => /^(Draft|Solid)/.test(row.maturity))
      .map(row => /\[[^\]]*\]\(([\w.-]+)\.md\)/.exec(row.page)?.[1]).filter(Boolean).sort();
    const pages = result.pages.filter(page => page.startsWith("knowledge/") && page !== "knowledge/index.html").map(page => page.slice(10, -5)).sort();
    expect(pages).toEqual(listed as string[]);
    expect(pages.length).toBeGreaterThan(0);
    const index = read("knowledge/index.html");
    for (const slug of pages) expect(index).toContain(`href="${slug}.html"`);
    // Linked from the header navigation of every page.
    expect(read("index.html")).toContain('href="knowledge/"');
    expect(read("knowledge/tooling.html")).toContain('<a href="../knowledge/" aria-current="page">Knowledge</a>');
  });

  test("every knowledge page carries the caveat, legend, date, source, improve link and credits link", () => {
    for (const page of result.pages.filter(page => page.startsWith("knowledge/"))) {
      const html = read(page);
      expect(html.match(/data-knowledge-caveat/g)).toHaveLength(1);
      expect(html).toContain("some of this may be wrong");
      expect(html).toContain('id="evidence-grades"');
      if (page === "knowledge/index.html") continue;
      const file = page.slice(10, -5) + ".md";
      expect(html).toMatch(/data-knowledge-updated>Last updated <time datetime="\d{4}-\d{2}-\d{2}">/);
      expect(html).toContain(`href="${blob}/knowledge/${file}" data-knowledge-source`);
      expect(html).toContain(`${config.repoUrl}/issues/new?title=Knowledge`);
      expect(html).toContain(`${config.repoUrl}/edit/${config.repoBranch}/knowledge/${file}`);
      expect(html).toContain('href="../credits.html"');
      expect(html).toContain('<link rel="canonical" href="' + config.baseUrl + page + '">');
    }
    expect(read("sitemap.xml")).toContain(`${config.baseUrl}knowledge/</loc>`);
  });

  test("the check rejects a knowledge page without its caveat or date, and personal data anywhere", async () => {
    const dir = tempDir("xfs-knowledge-check-");
    buildSite({ outDir: dir });
    const page = join(dir, "knowledge", "tooling.html");
    writeFileSync(page, read("knowledge/tooling.html").replace(" data-knowledge-caveat", "").replace(" data-knowledge-updated", "")
      .replace("</main>", "<p>Copied from C:\\Users\\jdoe\\Desktop, ask jane@mailbox.org</p></main>"));
    const issues = (await checkSite(dir, { repoFiles: null })).issues.map(issue => `${issue.file}: ${issue.message}`);
    expect(issues.some(m => m.includes("knowledge/tooling.html") && m.includes("[data-knowledge-caveat]"))).toBe(true);
    expect(issues.some(m => m.includes("[data-knowledge-updated]"))).toBe(true);
    expect(issues.some(m => m.includes("Windows user-profile path"))).toBe(true);
    expect(issues.some(m => m.includes("e-mail address"))).toBe(true);
    // Redacted in the check's output too: CI logs are public.
    expect(issues.some(m => /jdoe|jane@/.test(m))).toBe(false);
  });

  test("the check sees a path the renderer split with <wbr> in a code span (SITE-01)", async () => {
    const dir = tempDir("xfs-knowledge-wbr-");
    buildSite({ outDir: dir });
    const code = renderMarkdown("# T\n\nSee `C:\\Users\\jdoe\\AppData`.\n", { link: href => href, fragment: true }).html;
    expect(code).toContain("<wbr>");
    const page = join(dir, "knowledge", "tooling.html");
    writeFileSync(page, read("knowledge/tooling.html").replace("</main>", `${code}</main>`));
    const issues = (await checkSite(dir, { repoFiles: null })).issues.map(issue => `${issue.file}: ${issue.message}`);
    expect(issues.filter(m => m.includes("user-profile path"))).toEqual(["knowledge/tooling.html: contains personal data (Windows user-profile path): C:\\Users\\j***"]);
  });
});
