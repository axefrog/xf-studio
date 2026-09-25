/**
 * The public Knowledge section, generated at build time from the repository's knowledge/*.md pages.
 * knowledge/README.md is the source of truth for which topics exist, their one-line summaries, maturity and the
 * evidence-grade legend. Only Draft-or-better pages are published (see research/backlog/public-knowledge-site.md).
 * Relative links to other published knowledge pages stay on the site; every other repository link goes to GitHub.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { escapeHtml } from "./html";
import { renderMarkdown, stripTags, type Grade, type Heading } from "./markdown";
import { findPersonalData } from "./privacy";

export type Maturity = "Seed" | "Draft" | "Solid";
export type KnowledgeTopic = {
  /** Page slug (file name without .md), or the planned slug for a page still to write. */
  slug: string;
  /** Whether knowledge/<slug>.md exists. */
  written: boolean;
  summaryHtml: string;
  summaryText: string;
  maturity: Maturity;
  /** Anything after the maturity word, e.g. "resolver phase 1 implemented". */
  maturityNote: string;
};
export type KnowledgePage = {
  slug: string;
  file: string;
  title: string;
  titleHtml: string;
  html: string;
  headings: Heading[];
  diagrams: number;
  topic: KnowledgeTopic;
  /** ISO date of the last commit touching the file, or null when it has never been committed. */
  updated: string | null;
};
export type Knowledge = { grades: Grade[]; topics: KnowledgeTopic[]; pages: KnowledgePage[]; skipped: { slug: string; reason: string }[] };
export type KnowledgeOptions = {
  repoRoot: string;
  repoUrl: string;
  repoBranch: string;
  /** Folder of the knowledge pages relative to repoRoot. */
  dir?: string;
  /** Last-commit date per repository path; defaults to git. */
  dateOf?: (path: string) => string | null;
  /** Tracked repository paths; links to anything else fail the build. Null skips the check (git unavailable). */
  tracked?: Set<string> | null;
};

/** Repository areas that hold private or raw third-party data and are never linked from the public site, even where tracked. */
export const PRIVATE_LINK_PREFIXES = ["research/consumers/", "inventory/", "local/", "captures/"];
const MATURITIES: Maturity[] = ["Seed", "Draft", "Solid"];
const PUBLISHED: Maturity[] = ["Draft", "Solid"];

const git = (repoRoot: string, args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString() : null;
};

/** Last-commit dates from git. A shallow clone would date every file to its one commit, so it is refused. */
export function gitDates(repoRoot: string): (path: string) => string | null {
  const shallow = git(repoRoot, ["rev-parse", "--is-shallow-repository"])?.trim();
  if (shallow === "true") throw Error("Knowledge pages need full git history for their “last updated” dates; fetch with fetch-depth: 0.");
  return path => git(repoRoot, ["log", "-1", "--format=%cs", "--", path])?.trim() || null;
}

export function trackedFiles(repoRoot: string): Set<string> | null {
  const out = git(repoRoot, ["ls-files", "-z"]);
  return out === null ? null : new Set(out.split("\0").filter(Boolean));
}

/** Splits a GFM table row into raw cell texts (escaped pipes stay escaped). */
const rowCells = (line: string) => {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map(cell => cell.trim());
};

/** Reads the grade legend and the topic table from knowledge/README.md. */
export function parseKnowledgeIndex(readme: string): { grades: Grade[]; rows: { topic: string; page: string; maturity: string }[] } {
  const grades: Grade[] = [];
  for (const [, name, description] of readme.matchAll(/^\s*[-*]\s+\*\*\[([a-z]+)\]\*\*\s+(.+?)[;.]?\s*$/gm))
    grades.push({ name, description: description.replace(/\s*\(cite [^)]*\)/, "") });
  if (!grades.length) throw Error("knowledge/README.md: no evidence grades found (expected “- **[grade]** description” items)");

  const section = /^## Topics\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(readme)?.[1];
  if (!section) throw Error("knowledge/README.md: no “## Topics” section");
  const lines = section.split(/\r?\n/).filter(line => line.trim().startsWith("|"));
  const header = rowCells(lines[0] ?? "").map(cell => cell.toLowerCase());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw Error(`knowledge/README.md: the Topics table needs a “${name}” column`);
    return i;
  };
  const [topic, page, maturity] = [col("topic"), col("page"), col("maturity")];
  const rows = lines.slice(2).map(line => rowCells(line)).map(cells => ({ topic: cells[topic], page: cells[page], maturity: cells[maturity] }));
  return { grades, rows };
}

export function loadKnowledge(options: KnowledgeOptions): Knowledge {
  const dirPath = options.dir ?? "knowledge";
  const dir = join(options.repoRoot, dirPath);
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  const { grades, rows } = parseKnowledgeIndex(readme);
  const files = new Set(readdirSync(dir).filter(name => name.endsWith(".md") && name !== "README.md"));
  const blob = `${options.repoUrl}/blob/${options.repoBranch}`;
  const tree = `${options.repoUrl}/tree/${options.repoBranch}`;
  const tracked = options.tracked === undefined ? trackedFiles(options.repoRoot) : options.tracked;
  const dateOf = options.dateOf ?? gitDates(options.repoRoot);

  const topics: KnowledgeTopic[] = rows.map(row => {
    const linked = /^\[[^\]]*\]\(([\w.-]+)\.md\)$/.exec(row.page);
    const planned = /^`([\w.-]+)\.md`/.exec(row.page);
    const slug = linked?.[1] ?? planned?.[1];
    if (!slug) throw Error(`knowledge/README.md: cannot read the Topics page cell “${row.page}”`);
    const level = /^(\w+)/.exec(row.maturity)?.[1] as Maturity;
    if (!MATURITIES.includes(level)) throw Error(`knowledge/README.md: unknown maturity “${row.maturity}” for ${slug}`);
    const written = files.has(`${slug}.md`);
    if (linked && !written) throw Error(`knowledge/README.md links ${slug}.md, which does not exist`);
    return { slug, written, summaryHtml: "", summaryText: "", maturity: level, maturityNote: row.maturity.slice(level.length).replace(/^\s*\(|\)\s*$/g, "").trim(), row };
  }).map(({ row, ...topic }) => topic);
  for (const file of files)
    if (!topics.some(topic => topic.slug === file.slice(0, -3))) throw Error(`knowledge/${file} is not listed in the knowledge/README.md Topics table`);

  const skipped: { slug: string; reason: string }[] = [];
  const published = new Set(topics.filter(topic => topic.written && PUBLISHED.includes(topic.maturity)).map(topic => topic.slug));
  for (const topic of topics) if (topic.written && !published.has(topic.slug)) skipped.push({ slug: topic.slug, reason: `maturity ${topic.maturity}` });

  /** Link resolver for Markdown in `fromDir` (repository-relative), as seen from a page in the published knowledge folder. */
  const link = (source: string) => (href: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      if (/^(?:javascript|data|file):/i.test(href)) throw Error(`${source}: link scheme not allowed: ${href}`);
      return href;
    }
    if (href.startsWith("#")) return href;
    const hashAt = href.indexOf("#");
    const path = decodeURIComponent(hashAt < 0 ? href : href.slice(0, hashAt));
    const hash = hashAt < 0 ? "" : href.slice(hashAt);
    const target = posix.normalize(posix.join(dirPath, path)).replace(/\/$/, "");
    if (target.startsWith("../") || target === "..") throw Error(`${source}: link leaves the repository: ${href}`);
    const lower = target.toLowerCase() + "/";
    if (PRIVATE_LINK_PREFIXES.some(prefix => lower.startsWith(prefix)) || /^experiments\/[^/]+\/generated\//.test(lower))
      throw Error(`${source}: links into a private or raw-data location, which the public site never publishes: ${href}`);
    if (target === dirPath || target === `${dirPath}/README.md`) return `./${hash}`;
    const page = new RegExp(`^${dirPath}/([\\w.-]+)\\.md$`).exec(target);
    if (page && published.has(page[1])) return `${page[1]}.html${hash}`;
    const full = join(options.repoRoot, target);
    if (!existsSync(full)) throw Error(`${source}: broken link, ${target} does not exist`);
    const isDir = statSync(full).isDirectory();
    if (tracked && !(isDir ? [...tracked].some(file => file.startsWith(target + "/")) : tracked.has(target)))
      throw Error(`${source}: link target is not tracked by git, so it is not public: ${target}`);
    return `${isDir ? tree : blob}/${target.split("/").map(encodeURIComponent).join("/")}${hash}`;
  };

  for (const topic of topics) {
    const rendered = renderMarkdown(rows[topics.indexOf(topic)].topic, { link: link("knowledge/README.md"), fragment: true, source: "knowledge/README.md" });
    topic.summaryHtml = rendered.html.trim().replace(/^<p>([\s\S]*)<\/p>$/, "$1");
    topic.summaryText = stripTags(topic.summaryHtml).replace(/\s+/g, " ").trim();
  }

  const pages: KnowledgePage[] = [];
  for (const topic of topics.filter(topic => published.has(topic.slug))) {
    const file = `${topic.slug}.md`;
    const source = `${dirPath}/${file}`;
    const markdown = readFileSync(join(dir, file), "utf8");
    const rendered = renderMarkdown(markdown, { link: link(source), grades, sourceUrl: `${blob}/${source}`, source });
    const personal = findPersonalData(markdown).concat(findPersonalData(rendered.html));
    if (personal.length) throw Error(`${source}: contains personal data that must not be published: ${personal.map(p => `${p.name} “${p.match}”`).join(", ")}`);
    pages.push({ slug: topic.slug, file, title: rendered.title, titleHtml: rendered.titleHtml, html: rendered.html, headings: rendered.headings,
      diagrams: rendered.diagrams, topic, updated: dateOf(source) });
  }
  return { grades, topics, pages, skipped };
}

/** The shared “research in progress” banner. Every knowledge page and the index carry it; tools/check.ts enforces that. */
export function caveatHtml(issueUrl: string, editUrl?: string): string {
  return `<div class="notice kb-caveat" role="note" data-knowledge-caveat>
  <p><strong>Research in progress: some of this may be wrong.</strong> These notes record what XF Studio’s research has worked out so far about how Cyberpunk 2077 and its modding frameworks behave. Most of it comes from reading source code and game resources offline; not all of it has been confirmed in the running game, and claims graded <span class="grade" data-grade="hypothesis">hypothesis</span> are unproven. If you spot a mistake or know more, please <a href="${escapeHtml(issueUrl)}">open an issue</a>${editUrl ? ` or <a href="${escapeHtml(editUrl)}">suggest an edit</a>` : " or a pull request"}.</p>
</div>`;
}

export function legendHtml(grades: Grade[]): string {
  const items = grades.map(grade => `<div><dt><span class="grade" data-grade="${escapeHtml(grade.name)}">${escapeHtml(grade.name)}</span></dt><dd>${escapeHtml(grade.description.charAt(0).toUpperCase() + grade.description.slice(1))}.</dd></div>`).join("\n");
  return `<div class="grade-legend" id="evidence-grades">
<p class="grade-legend-title">Evidence grades</p>
<dl>
${items}
</dl>
</div>`;
}

export const maturityTag = (topic: KnowledgeTopic) =>
  `<span class="tag ${topic.maturity === "Solid" ? "ok" : topic.maturity === "Draft" ? "study" : "later"}" title="${escapeHtml(
    topic.maturity === "Solid" ? "Consolidated, cited and cross-checked" : topic.maturity === "Draft" ? "Consolidated, with significant gaps" : "Only pointers to existing research")}">${topic.maturity}</span>`;
