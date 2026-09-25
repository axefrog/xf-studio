/**
 * Static checks over a built site: bun tools/check.ts [distDir]
 * Structure and accessibility basics, link integrity (including repository links against tracked files),
 * the content/asset policy, the personal-data guard, the release-claim guard, the no-dates guard for future directions and the
 * knowledge pages' caveat, date, source and correction links. Exits non-zero on any issue.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { buildGuide } from "../../authoring/tools/build-style-guide";
import { basePath, loadConfig, repoRoot, siteRoot, styleGuideSource, type SiteConfig } from "./config";
import { stripTags } from "./markdown";
import { findPersonalData } from "./privacy";

export type Issue = { file: string; message: string };
export type CheckOptions = {
  config?: SiteConfig;
  /** Tracked repository paths for validating {{blob}}/{{tree}} links; null skips that validation. */
  repoFiles?: Set<string> | null;
};
export type CheckReport = { issues: Issue[]; pages: number; files: number; bytes: number; internalLinks: number; repoLinks: number; externalLinks: string[]; repoLinksChecked: boolean };

/** Everything the site may publish. Raster images, fonts, archives and game formats need a reviewed policy change first. */
export const ALLOWED_EXTENSIONS = new Set([".html", ".css", ".js", ".svg", ".xml", ".txt"]);
const PRIVATE_PATH = /\b[A-Za-z]:[\\/](?:Dev|Games|Users|Program Files|RedModding|MO2)\b/i;
const DOWNLOADABLE = /\.(?:zip|7z|rar|archive|xl|exe|msi|dmg|glb|gltf|blend|xbm|mesh|sav)$/i;
/** Phrases that would imply a release or download while releaseStatus is "unreleased". */
export const UNRELEASED_CLAIMS = ["download now", "now available", "available now", "install now", "get it now", "latest release",
  "release notes", "coming soon"];
/** Blanket in-game claims, rejected in every release state: runtime evidence is per feature, so copy names what was seen instead. */
export const GAME_CLAIMS = ["tested in game", "tested in-game", "verified in game", "verified in-game", "game-verified", "works in game", "works in-game"];
/** Dates and schedule language that future-direction copy ([data-future]) must not use: directions are discussed, not scheduled.
 *  “May” is omitted because it is also the modal verb, and the game's title is not a year. */
export const FUTURE_SCHEDULE = /\b(?:(?<!Cyberpunk )(?:19|20)\d{2}|Q[1-4]|H[12]|January|February|March|April|June|July|August|September|October|November|December|soon|upcoming|coming|imminent|this (?:week|month|year|quarter)|next (?:week|month|year|quarter|release|update|version)|by the end of|scheduled|due (?:in|by|for)|(?:is|are) planned for|will (?:ship|launch|arrive|land|release|be (?:released|available|ready|added)))\b/i;

export function trackedRepoFiles(): Set<string> | null {
  const result = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) return null;
  return new Set(result.stdout.toString().split("\0").filter(Boolean));
}

function walk(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full, root) : [relative(root, full).replaceAll("\\", "/")];
  });
}

type PageScan = {
  lang: string | null; title: string; description: string | null; canonical: string | null; robots: string | null;
  csp: boolean; charset: boolean; viewport: boolean; headings: number[]; ids: string[];
  links: { attr: string; value: string; tag: string }[]; text: string; releaseStatus: boolean; download: string[]; main: boolean;
  problems: string[]; labelledBy: string[]; futureSections: number; futureText: string;
  knowledge: { caveat: number; updated: number; source: number; improve: number };
};

async function scanPage(html: string): Promise<PageScan> {
  const scan: PageScan = { lang: null, title: "", description: null, canonical: null, robots: null, csp: false, charset: false, viewport: false,
    headings: [], ids: [], links: [], text: "", releaseStatus: false, download: [], main: false, problems: [], labelledBy: [], futureSections: 0, futureText: "",
    knowledge: { caveat: 0, updated: 0, source: 0, improve: 0 } };
  const named: { what: string; label: string | null; text: string }[] = [];
  const nameHandler = (what: string) => ({
    element(el: HTMLRewriterTypes.Element) {
      const entry = { what: `${what}${el.getAttribute("href") ? ` → ${el.getAttribute("href")}` : ""}`, label: el.getAttribute("aria-label"), text: "" };
      named.push(entry);
      if (what === "button" && !el.getAttribute("type")) scan.problems.push(`<button> without type: ${entry.what}`);
      if (what === "a") {
        if (!el.getAttribute("href")) scan.problems.push("<a> without href");
        if (el.getAttribute("target") === "_blank" && !/\bnoopener\b/.test(el.getAttribute("rel") ?? "")) scan.problems.push(`target=_blank without rel=noopener: ${entry.what}`);
      }
    },
    text(chunk: HTMLRewriterTypes.Text) { named[named.length - 1].text += chunk.text; },
  });
  await new HTMLRewriter()
    .on("html", { element(el) { scan.lang = el.getAttribute("lang"); } })
    .on("meta", { element(el) {
      if (el.getAttribute("charset")) scan.charset = true;
      const name = el.getAttribute("name"); const equiv = el.getAttribute("http-equiv");
      if (name === "viewport") scan.viewport = true;
      if (name === "description") scan.description = el.getAttribute("content");
      if (name === "robots") scan.robots = el.getAttribute("content");
      if (equiv?.toLowerCase() === "content-security-policy") scan.csp = true;
    } })
    .on("title", { text(chunk) { scan.title += chunk.text; } })
    .on("link[rel=canonical]", { element(el) { scan.canonical = el.getAttribute("href"); } })
    .on("h1, h2, h3, h4, h5, h6", { element(el) { scan.headings.push(Number(el.tagName.slice(1))); } })
    .on("[id]", { element(el) { scan.ids.push(el.getAttribute("id")!); if (el.getAttribute("id") === "main" && el.tagName === "main") scan.main = true; } })
    .on("[href]", { element(el) { scan.links.push({ attr: "href", value: el.getAttribute("href")!, tag: el.tagName }); } })
    .on("[src]", { element(el) { scan.links.push({ attr: "src", value: el.getAttribute("src")!, tag: el.tagName }); } })
    .on("[data-release-status]", { element() { scan.releaseStatus = true; } })
    .on("[data-download]", { element(el) { scan.download.push(el.getAttribute("data-download")!); } })
    .on("[data-future]", { element() { scan.futureSections++; scan.futureText += " "; }, text(chunk) { scan.futureText += chunk.text; } })
    .on("[data-knowledge-caveat]", { element() { scan.knowledge.caveat++; } })
    .on("[data-knowledge-updated]", { element() { scan.knowledge.updated++; } })
    .on("a[data-knowledge-source]", { element(el) { if (el.getAttribute("href")) scan.knowledge.source++; } })
    .on("a[data-knowledge-improve]", { element(el) { if (el.getAttribute("href")) scan.knowledge.improve++; } })
    .on("[aria-labelledby]", { element(el) { scan.labelledBy.push(...el.getAttribute("aria-labelledby")!.split(/\s+/)); } })
    .on("*", { element(el) {
      for (const [name] of el.attributes) {
        if (/^on/i.test(name)) scan.problems.push(`inline event handler ${name} on <${el.tagName}>`);
        if (name === "style") scan.problems.push(`inline style attribute on <${el.tagName}> (blocked by the CSP)`);
      }
    } })
    .on("script", { element(el) { if (!el.getAttribute("src")) scan.problems.push("inline <script> (blocked by the CSP)"); } })
    .on("style", { element() { scan.problems.push("<style> element (blocked by the CSP); use assets/site.css"); } })
    .on("img", { element(el) { if (el.getAttribute("alt") === null) scan.problems.push(`<img> without alt: ${el.getAttribute("src")}`); } })
    .on("svg[role=img]", { element(el) { if (!el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")) scan.problems.push("svg[role=img] without an accessible name"); } })
    .on("a", nameHandler("a"))
    .on("button", nameHandler("button"))
    .on("body", { text(chunk) { scan.text += chunk.text; } })
    .transform(new Response(html)).text();
  for (const entry of named)
    if (!entry.label?.trim() && !entry.text.replace(/\s+/g, "")) scan.problems.push(`${entry.what} has no accessible name`);
  return scan;
}

export async function checkSite(dir: string, options: CheckOptions = {}): Promise<CheckReport> {
  const config = options.config ?? loadConfig();
  const repoFiles = options.repoFiles === undefined ? trackedRepoFiles() : options.repoFiles;
  const base = new URL(config.baseUrl);
  const baseDir = basePath(config);
  const issues: Issue[] = [];
  const add = (file: string, message: string) => issues.push({ file, message });
  const files = walk(dir).sort();
  const guideFile = "style-guide.html";
  if (!files.includes(guideFile)) add(guideFile, "missing published Studio style guide");
  else if (!existsSync(styleGuideSource)) add(guideFile, "missing generated Studio style-guide source");
  else if (!readFileSync(join(dir, guideFile)).equals(readFileSync(styleGuideSource)))
    add(guideFile, "published style guide differs from the generated Studio source");
  if (existsSync(styleGuideSource)) {
    const source = readFileSync(styleGuideSource, "utf8");
    const generatedDate = /Authoritative reference · generated (\d{4}-\d{2}-\d{2})/.exec(source)?.[1];
    if (!generatedDate) add(guideFile, "generated Studio style-guide source has no build date");
    else {
      try {
        if (source !== await buildGuide(generatedDate))
          add(guideFile, "generated Studio style-guide source is stale against its design sources");
      } catch (error) { add(guideFile, `could not rebuild Studio style guide: ${String(error)}`); }
    }
  }
  let bytes = 0;
  for (const file of files) {
    const size = statSync(join(dir, file)).size;
    bytes += size;
    if (!ALLOWED_EXTENSIONS.has(extname(file).toLowerCase())) add(file, `file type ${extname(file) || "(none)"} is not allowed on the public site; see README “Content policy”`);
    const fileBudget = file === guideFile ? config.budgets.styleGuideBytes
      : file.startsWith("knowledge/") ? config.budgets.knowledgeFileBytes : config.budgets.fileBytes;
    if (size > fileBudget) add(file, `${size} bytes exceeds the per-file budget of ${fileBudget}`);
    if ([".html", ".css", ".js", ".svg", ".xml", ".txt"].includes(extname(file))) {
      const text = readFileSync(join(dir, file), "utf8");
      // Markup splits text (the renderer puts <wbr> after path separators in code spans), so the text
      // without tags is checked as well as the raw file, which keeps attributes such as href in view.
      const views = file.endsWith(".html") || file.endsWith(".svg") || file.endsWith(".xml") ? [text, stripTags(text)] : [text];
      const machinePath = views.map(view => PRIVATE_PATH.exec(view)?.[0]).find(Boolean);
      if (machinePath) add(file, `contains a local machine path: ${machinePath}`);
      const personal = new Map(views.flatMap(view => findPersonalData(view)).map(found => [found.name, found.match]));
      for (const [name, match] of personal) add(file, `contains personal data (${name}): ${match}`);
      if (/file:\/\//i.test(text)) add(file, "contains a file:// URL");
      if (/\{\{\w+\}\}/.test(text)) add(file, "contains an unrendered {{placeholder}}");
      if (file.endsWith(".css") || file.endsWith(".js")) {
        if (/\b(?:127\.0\.0\.1|localhost)\b/.test(text)) add(file, "references localhost");
        if (/@import|url\(\s*["']?https?:/i.test(text)) add(file, "loads a remote resource (the site must be self-contained)");
      }
    }
  }
  if (bytes > config.budgets.totalBytes) add(".", `site is ${bytes} bytes, over the ${config.budgets.totalBytes}-byte budget`);

  // The generated guide intentionally carries inline CSS, live demos and specimen styles.
  // Byte equality with the reviewed, freshly rebuilt Studio source is its publishing gate; the public
  // marketing pages retain their stricter CSP/structure/link checks below.
  const pages = files.filter(file => file.endsWith(".html") && file !== guideFile);
  const scans = new Map<string, PageScan>();
  for (const page of pages) {
    const html = readFileSync(join(dir, page), "utf8");
    if (!/^<!doctype html>/i.test(html)) add(page, "missing <!doctype html>");
    scans.set(page, await scanPage(html));
  }

  let internalLinks = 0, repoLinks = 0;
  const externalLinks = new Set<string>();
  for (const [page, scan] of scans) {
    for (const problem of scan.problems) add(page, problem);
    if (scan.lang !== "en") add(page, "<html> needs lang=\"en\"");
    if (!scan.charset) add(page, "missing <meta charset>");
    if (!scan.viewport) add(page, "missing viewport meta");
    if (!scan.csp) add(page, "missing Content-Security-Policy meta");
    if (!scan.title.trim()) add(page, "empty <title>");
    if (!scan.description?.trim()) add(page, "missing meta description");
    const noindex = /noindex/.test(scan.robots ?? "");
    if (!noindex && !scan.canonical) add(page, "missing canonical link");
    if (scan.canonical && !scan.canonical.startsWith(config.baseUrl)) add(page, `canonical ${scan.canonical} is outside ${config.baseUrl}`);
    if (scan.headings.filter(level => level === 1).length !== 1) add(page, `expected exactly one <h1>, found ${scan.headings.filter(level => level === 1).length}`);
    scan.headings.forEach((level, i) => { if (i > 0 && level > scan.headings[i - 1] + 1) add(page, `heading level jumps from h${scan.headings[i - 1]} to h${level}`); });
    const seen = new Set<string>();
    for (const id of scan.ids) { if (seen.has(id)) add(page, `duplicate id "${id}"`); seen.add(id); }
    for (const id of scan.labelledBy) if (!seen.has(id)) add(page, `aria-labelledby references missing id "${id}"`);
    if (!scan.main) add(page, "missing <main id=\"main\">");
    if (!scan.links.some(link => link.value === "#main")) add(page, "missing skip link to #main");
    const text = scan.text.toLowerCase().replace(/\s+/g, " ");
    // Whole-word match, so honest negatives such as "untested in game" are not mistaken for claims.
    for (const phrase of GAME_CLAIMS)
      if (new RegExp(`(?<![a-z])${phrase}(?![a-z])`).test(text))
        add(page, `text contains “${phrase}”; blanket in-game claims need recorded runtime evidence`);
    if (config.releaseStatus === "unreleased")
      for (const phrase of UNRELEASED_CLAIMS) if (text.includes(phrase)) add(page, `text contains “${phrase}” while releaseStatus is unreleased`);
    if (page === "index.html") {
      if (!scan.releaseStatus) add(page, "home page must keep a visible [data-release-status] statement");
      if (scan.download.length !== 1 || scan.download[0] !== config.releaseStatus)
        add(page, `home page needs one #download section rendered for releaseStatus "${config.releaseStatus}" (found: ${scan.download.join(", ") || "none"})`);
    }
    const schedule = FUTURE_SCHEDULE.exec(scan.futureText.replace(/\s+/g, " "));
    if (schedule) add(page, `future-direction text ([data-future]) contains a date or schedule: “${schedule[0]}”`);
    if (page.startsWith("knowledge/")) {
      // Every knowledge page says it may be wrong and how to correct it; articles also show their date and source.
      if (scan.knowledge.caveat !== 1) add(page, `knowledge pages need exactly one [data-knowledge-caveat] banner (found ${scan.knowledge.caveat})`);
      if (page !== "knowledge/index.html") {
        if (!scan.knowledge.updated) add(page, "knowledge page is missing its [data-knowledge-updated] date");
        if (!scan.knowledge.source) add(page, "knowledge page is missing its a[data-knowledge-source] link to the Markdown on GitHub");
        if (!scan.knowledge.improve) add(page, "knowledge page is missing its a[data-knowledge-improve] link");
      }
    }
    if (page === "index.html" && !scan.futureSections) add(page, "home page must mark its vision and directions sections with [data-future] so the no-dates guard applies");

    const pageUrl = new URL(page === "index.html" ? "" : page, base);
    for (const link of scan.links) {
      const value = link.value.trim();
      if (!value) { add(page, `empty ${link.attr} on <${link.tag}>`); continue; }
      if (/^(?:mailto|tel):/i.test(value)) continue;
      if (/^(?:javascript|data):/i.test(value)) { add(page, `${link.attr}="${value.slice(0, 40)}" is not allowed`); continue; }
      if (/^http:/i.test(value)) { add(page, `insecure link ${value}`); continue; }
      if (/^\/\//.test(value)) { add(page, `protocol-relative link ${value}`); continue; }
      if (/\b(?:127\.0\.0\.1|localhost)\b/.test(value)) { add(page, `link to localhost: ${value}`); continue; }
      const url = new URL(value, pageUrl);
      if (DOWNLOADABLE.test(url.pathname)) add(page, `link to a downloadable package/asset: ${value}`);
      const repoPath = new URL(config.repoUrl + "/").pathname.replace(/\/$/, "");
      // Only XF Studio's own releases are guarded; citing another project's release page (e.g. a tool version) is fine.
      const ownRepo = url.origin === new URL(config.repoUrl).origin && (url.pathname === repoPath || url.pathname.startsWith(repoPath + "/"));
      if ((ownRepo || url.origin === base.origin) && /\/releases(?:\/|$)/.test(url.pathname)) {
        const allowed = config.release ? [`/releases`, `/releases/tag/${encodeURIComponent(config.release.tag)}`] : [];
        if (config.releaseStatus === "unreleased") add(page, `link to releases while unreleased: ${value}`);
        // /releases/latest skips pre-releases and /releases/download/ is a direct asset; link the configured tag page.
        else if (url.origin !== "https://github.com" || !allowed.some(path => url.pathname === repoPath + path))
          add(page, `release link must be ${config.repoUrl}/releases or the configured tag page: ${value}`);
      }
      if (url.origin !== base.origin || !url.pathname.startsWith(baseDir)) {
        const repoPrefix = new URL(config.repoUrl + "/").pathname;
        if (url.origin === "https://github.com" && url.pathname.startsWith(repoPrefix)) {
          const rest = url.pathname.slice(repoPrefix.length);
          const match = /^(blob|tree)\/([^/]+)\/(.+)$/.exec(rest);
          if (match) {
            repoLinks++;
            if (match[2] !== config.repoBranch) add(page, `repository link uses branch ${match[2]}, expected ${config.repoBranch}: ${value}`);
            if (repoFiles) {
              const path = decodeURIComponent(match[3]).replace(/\/$/, "");
              const ok = match[1] === "blob" ? repoFiles.has(path) : [...repoFiles].some(file => file.startsWith(path + "/"));
              if (!ok) add(page, `repository link target is not a tracked file: ${path}`);
            }
            continue;
          }
        }
        if (url.protocol === "https:") externalLinks.add(url.origin + url.pathname);
        continue;
      }
      internalLinks++;
      let target = decodeURIComponent(url.pathname.slice(baseDir.length));
      if (target === "" || target.endsWith("/")) target += "index.html";
      if (!files.includes(target) && files.includes(`${target}.html`)) target += ".html";
      if (!files.includes(target)) { add(page, `broken internal ${link.attr}: ${value} (→ ${target})`); continue; }
      if (url.hash && target.endsWith(".html")) {
        const id = decodeURIComponent(url.hash.slice(1));
        if (!scans.get(target)?.ids.includes(id)) add(page, `broken anchor ${value} (no id "${id}" in ${target})`);
      }
    }
  }

  if (!files.includes("index.html")) add(".", "missing index.html");
  if (!files.includes("404.html")) add(".", "missing 404.html");
  if (files.includes("sitemap.xml")) {
    for (const [, loc] of readFileSync(join(dir, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g))
      if (!loc.startsWith(config.baseUrl)) add("sitemap.xml", `URL outside the base URL: ${loc}`);
  } else add(".", "missing sitemap.xml");

  return { issues, pages: pages.length, files: files.length, bytes, internalLinks, repoLinks, externalLinks: [...externalLinks].sort(), repoLinksChecked: !!repoFiles };
}

if (import.meta.main) {
  const dir = resolve(process.argv[2] ?? join(siteRoot, "dist"));
  const report = await checkSite(dir);
  for (const issue of report.issues) console.error(`✗ ${issue.file}: ${issue.message}`);
  console.log(`${report.pages} pages, ${report.files} files, ${(report.bytes / 1024).toFixed(1)} KiB; ${report.internalLinks} internal links, ` +
    `${report.repoLinks} repository links${report.repoLinksChecked ? " checked against tracked files" : " (not checked: git unavailable)"}, ` +
    `${report.externalLinks.length} other external URLs.`);
  if (report.issues.length) { console.error(`${report.issues.length} issue(s).`); process.exit(1); }
  console.log("Site checks passed.");
}
