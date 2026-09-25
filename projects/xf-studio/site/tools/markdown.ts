/**
 * Markdown → HTML for the knowledge section, on Bun's built-in GFM parser (no dependencies).
 * Adds what the site needs on top of plain rendering: GitHub-compatible heading ids (so anchors shared from GitHub
 * work here too), link rewriting through a caller-supplied resolver, scrollable tables, evidence-grade badges and an
 * accessible text form of Mermaid flowcharts (the site cannot run Mermaid under its CSP, and GitHub renders them).
 */
import { escapeHtml } from "./html";

export type Heading = { level: number; id: string; text: string; html: string };
export type Grade = { name: string; description: string };
export type MarkdownOptions = {
  /** Maps a Markdown link target to the published href. Throw to refuse a link. */
  link: (href: string) => string;
  /** Evidence grades rendered as badges when they appear as literal "[name]" text outside code. */
  grades?: Grade[];
  /** URL of the source document on GitHub, for "view this diagram on GitHub" links (a heading anchor is appended). */
  sourceUrl?: string;
  /** Used in error messages. */
  source?: string;
  /** Render a fragment (e.g. a table cell's text) with no title heading; the result has an empty title. */
  fragment?: boolean;
};
export type RenderedMarkdown = { title: string; titleHtml: string; html: string; headings: Heading[]; diagrams: number };

/** Private-use placeholder for GFM's escaped table pipe, which Bun's parser splits on. */
const PIPE = "\uE000";

export const stripTags = (html: string) =>
  html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** github-slugger's rule: lower-case, drop punctuation except hyphen and underscore, each space becomes a hyphen. */
export function githubSlug(text: string, seen: Set<string>): string {
  const base = text.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");
  let slug = base;
  for (let n = 1; seen.has(slug); n++) slug = `${base}-${n}`;
  seen.add(slug);
  return slug;
}

/** GFM splits table rows on every unescaped pipe, even inside code spans; a row with the wrong cell count loses content. */
export function checkTables(markdown: string, source = "markdown"): string[] {
  const problems: string[] = [];
  const cells = (line: string) => {
    let row = line.trim();
    if (row.startsWith("|")) row = row.slice(1);
    if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
    return row.split(/(?<!\\)\|/).length;
  };
  const lines = markdown.split(/\r?\n/);
  let columns = 0, fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) { columns = 0; return; }
    if (i > 0 && line.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line) && lines[i - 1].includes("|")) {
      columns = cells(lines[i - 1]);
      if (cells(line) !== columns) problems.push(`${source}:${i + 1}: table delimiter has ${cells(line)} cells, header has ${columns}`);
      return;
    }
    if (columns && line.trim().startsWith("|")) {
      const count = cells(line);
      if (count !== columns) problems.push(`${source}:${i + 1}: table row has ${count} cells, header has ${columns} (escape pipes inside code as \\|)`);
    } else columns = 0;
  });
  return problems;
}

/** Replaces literal "[grade]" text with badges, and badges the grade word of longer forms such as "[source: file]". Skips code. */
export function badgeGrades(html: string, grades: Grade[]): string {
  if (!grades.length) return html;
  const names = grades.map(grade => grade.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const exact = new RegExp(`\\[(${names})\\]`, "g");
  const lead = new RegExp(`\\[(${names})(?=[:;, ])`, "g");
  const badge = (name: string) => `<span class="grade" data-grade="${name}">${name}</span>`;
  return html.split(/(<pre[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>|<[^>]+>)/).map((part, i) =>
    i % 2 ? part : part.replace(exact, (_, name: string) => badge(name)).replace(lead, (_, name: string) => `[${badge(name)}`)).join("");
}

export type FlowNode = { id: string; name: string; detail: string };
export type FlowEdge = { from: string; to: string; label?: string; dotted: boolean };
export type FlowOutline = { kind: string; nodes: FlowNode[]; edges: FlowEdge[] };
/**
 * A Mermaid flowchart's boxes and arrows, or null when the diagram is not a simple flowchart. A box's name is the first line
 * of its label and its detail the remaining lines, so the text form can name each box briefly and describe it once.
 */
export function mermaidOutline(source: string): FlowOutline | null {
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("%%"));
  const header = /^(flowchart|graph)\b/i.exec(lines[0] ?? "");
  if (!header) return null;
  const nodes = new Map<string, FlowNode>();
  const clean = (text: string) => text.replace(/\s+/g, " ").trim();
  const shape = /(\w+)\s*(?:\["([^"]*)"\]|\("([^"]*)"\)|\{"([^"]*)"\}|\[([^\]"]*)\]|\(([^)"]*)\)|\{([^}"]*)\})/g;
  const edges: FlowEdge[] = [];
  const node = (id: string) => nodes.get(id) ?? nodes.set(id, { id, name: id, detail: "" }).get(id)!;
  for (const line of lines.slice(1)) {
    for (const match of line.matchAll(shape)) {
      const text = match.slice(2).find(value => value !== undefined);
      if (text === undefined) continue;
      const [first, ...rest] = text.split(/<br\s*\/?>/i).map(clean);
      Object.assign(node(match[1]), { name: first || match[1], detail: rest.filter(Boolean).join("; ") });
    }
    const bare = line.replace(shape, "$1");
    const edge = /^(\w+)\s*(-->|-\.->|==>|---|-\.-)\s*(?:\|([^|]*)\|\s*)?(\w+)\s*$/.exec(bare);
    if (edge) {
      node(edge[1]); node(edge[4]);
      edges.push({ from: edge[1], to: edge[4], label: edge[3] ? clean(edge[3].replace(/<br\s*\/?>/gi, " ")) : undefined, dotted: edge[2].includes(".") });
    } else if (/^\w+$/.test(bare)) node(bare);
    else if (!/^(style|classDef|class|linkStyle|click|subgraph|end|direction)\b/.test(bare)) return null;
  }
  if (!edges.length) return null;
  return { kind: header[1].toLowerCase(), nodes: [...nodes.values()], edges };
}

export function renderMarkdown(markdown: string, options: MarkdownOptions): RenderedMarkdown {
  const source = options.source ?? "markdown";
  const tableProblems = checkTables(markdown, source);
  if (tableProblems.length) throw Error(tableProblems.join("\n"));
  // Protect GFM's escaped table pipes (Bun's parser splits on them) outside fenced code.
  let fenced = false;
  const prepared = markdown.split(/\r?\n/).map(line => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    return !fenced && line.trim().startsWith("|") ? line.replaceAll("\\|", PIPE) : line;
  }).join("\n");

  const seen = new Set<string>();
  const headings: Heading[] = [];
  let diagrams = 0, lastHeadingId = "";
  const cellAlign = (meta?: { align?: string }) => meta?.align ? ` class="align-${meta.align}"` : "";
  let html = Bun.markdown.render(prepared, {
    text: text => escapeHtml(text.replaceAll(PIPE, "|")),
    heading: (children, meta) => {
      const text = stripTags(children);
      const id = githubSlug(text, seen);
      headings.push({ level: meta.level, id, text, html: children });
      lastHeadingId = id;
      return `<h${meta.level} id="${id}">${children}</h${meta.level}>\n`;
    },
    paragraph: children => `<p>${children}</p>\n`,
    blockquote: children => `<blockquote>\n${children}</blockquote>\n`,
    list: (children, meta) => meta.ordered
      ? `<ol${meta.start !== undefined && meta.start !== 1 ? ` start="${meta.start}"` : ""}>\n${children}</ol>\n`
      : `<ul>\n${children}</ul>\n`,
    listItem: children => `<li>${children.trim()}</li>\n`,
    hr: () => "<hr>\n",
    table: children => {
      const head = /<thead>([\s\S]*?)<\/thead>/.exec(children)?.[1] ?? "";
      const columns = (head.match(/<th[\s>]/g) ?? []).length;
      const label = escapeHtml(`Table: ${[...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => stripTags(m[1]).trim()).join(", ")}`);
      return `<div class="table-scroll" role="region" tabindex="0" aria-label="${label}">\n<table class="cols-${Math.min(columns, 6)}">\n${children}</table>\n</div>\n`;
    },
    thead: children => `<thead>\n${children}</thead>\n`,
    tbody: children => `<tbody>\n${children}</tbody>\n`,
    tr: children => `<tr>${children}</tr>\n`,
    th: (children, meta) => `<th scope="col"${cellAlign(meta)}>${children}</th>`,
    td: (children, meta) => `<td${cellAlign(meta)}>${children}</td>`,
    strong: children => `<strong>${children}</strong>`,
    emphasis: children => `<em>${children}</em>`,
    strikethrough: children => `<del>${children}</del>`,
    // Break opportunities after path separators and underscores, so long identifiers wrap at sensible points, never mid-word.
    codespan: children => `<code>${children.replace(/([\\/_])(?=[^\s<])/g, "$1<wbr>")}</code>`,
    link: (children, meta) => {
      const href = options.link(meta.href);
      const title = meta.title ? ` title="${escapeHtml(meta.title)}"` : "";
      return `<a href="${escapeHtml(href)}"${title}>${children}</a>`;
    },
    image: (children, meta) => { throw Error(`${source}: images are not published (${meta.src}); link to the file instead`); },
    html: children => escapeHtml(children),
    code: (children, meta) => {
      if (meta?.language === "mermaid") {
        diagrams++;
        return renderMermaid(stripTags(children), options.sourceUrl ? `${options.sourceUrl}${lastHeadingId ? `#${lastHeadingId}` : ""}` : undefined, diagrams);
      }
      const language = meta?.language ? ` data-language="${escapeHtml(meta.language)}"` : "";
      return `<pre class="code" tabindex="0"${language}><code>${children.replace(/\n$/, "")}</code></pre>\n`;
    },
  }, { tables: true, strikethrough: true, tasklists: false, noHtmlBlocks: true, noHtmlSpans: true, autolinks: false });

  if (options.grades) html = badgeGrades(html, options.grades);
  if (options.fragment) return { title: "", titleHtml: "", html, headings, diagrams };
  // The first level-1 heading is the page title, rendered by the page template.
  const first = headings.find(heading => heading.level === 1);
  if (!first) throw Error(`${source}: needs a level-1 heading for its title`);
  if (headings.filter(heading => heading.level === 1).length > 1) throw Error(`${source}: has more than one level-1 heading`);
  html = html.replace(new RegExp(`<h1 id="${first.id}">[\\s\\S]*?</h1>\\n?`), "");
  const titleHtml = options.grades ? badgeGrades(first.html, options.grades) : first.html;
  return { title: first.text, titleHtml, html, headings: headings.filter(heading => heading !== first), diagrams };
}

function renderMermaid(source: string, githubUrl: string | undefined, index: number): string {
  const outline = mermaidOutline(source);
  const view = githubUrl ? ` <a href="${escapeHtml(githubUrl)}">View the drawn diagram on GitHub</a>.` : "";
  const id = `diagram-${index}`;
  let body = "";
  if (outline) {
    const name = (id: string) => escapeHtml(outline.nodes.find(node => node.id === id)?.name ?? id);
    const described = outline.nodes.filter(node => node.detail);
    body = `<p class="diagram-part">Arrows</p>
<ol class="diagram-edges">
${outline.edges.map(edge =>
      `<li><span class="node">${name(edge.from)}</span> <span class="arrow" aria-hidden="true">${edge.dotted ? "⇢" : "→"}</span><span class="sr-only">${edge.dotted ? " dotted arrow to " : " arrow to "}</span> ` +
      `<span class="node">${name(edge.to)}</span>${edge.label ? ` <span class="edge-label">(${escapeHtml(edge.label)})</span>` : ""}</li>`).join("\n")}
</ol>
${described.length ? `<p class="diagram-part">Boxes</p>
<dl class="diagram-nodes">
${described.map(node => `<div><dt>${escapeHtml(node.name)}</dt><dd>${escapeHtml(node.detail)}</dd></div>`).join("\n")}
</dl>
` : ""}`;
  }
  return `<figure class="diagram" aria-labelledby="${id}-caption">
<figcaption id="${id}-caption"><strong>Diagram.</strong> ${outline ? "Its boxes and arrows are listed here as text; GitHub draws it as a flowchart." : "GitHub draws this diagram from the source below."}${view}</figcaption>
${body}<details class="diagram-source">
<summary>Mermaid source</summary>
<pre class="code" tabindex="0" data-language="mermaid"><code>${escapeHtml(source.replace(/\n$/, ""))}</code></pre>
</details>
</figure>\n`;
}
