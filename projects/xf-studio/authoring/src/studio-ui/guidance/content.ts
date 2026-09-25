import { chordsLabel, KEY_BINDINGS } from "../../input-bindings";

/**
 * Markdown-lite for tours and help topics (see `HelpContent`). Parsing is pure so tests can check
 * every token; the DOM renderer lives in `render.ts`.
 */
export type Inline = Readonly<{ kind: "text"; text: string } | { kind: "strong"; text: string } | { kind: "key"; id: string; label: string }>;
export type Block = Readonly<{ kind: "p"; inlines: readonly Inline[] } | { kind: "list"; items: readonly (readonly Inline[])[] }>;

const TOKEN = /\*\*([^*]+)\*\*|\[\[key:([a-z0-9.-]+)\]\]/g;

/** The chord text for a key binding, e.g. "Ctrl+Z" or "Ctrl+Shift+Z / Ctrl+Y". */
export function keyLabel(id: string): string | undefined {
  const binding = KEY_BINDINGS.find(item => item.id === id);
  return binding ? chordsLabel(binding) : undefined;
}

export function parseInlines(text: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index! > at) out.push({ kind: "text", text: text.slice(at, match.index) });
    if (match[1] !== undefined) out.push({ kind: "strong", text: match[1] });
    else {
      const label = keyLabel(match[2]);
      // An unknown binding is a data error (tests reject it); show its ID rather than nothing.
      out.push({ kind: "key", id: match[2], label: label ?? match[2] });
    }
    at = match.index! + match[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

export function parseHelp(body: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of body.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map(line => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every(line => line.startsWith("- "))) blocks.push({ kind: "list", items: lines.map(line => parseInlines(line.slice(2))) });
    else blocks.push({ kind: "p", inlines: parseInlines(lines.join(" ")) });
  }
  return blocks;
}

const inlineText = (inline: Inline) => inline.kind === "key" ? inline.label : inline.text;
/** Plain text for search, announcements and accessible descriptions. */
export function plainText(body: string): string {
  return parseHelp(body).map(block => block.kind === "p" ? block.inlines.map(inlineText).join("")
    : block.items.map(item => item.map(inlineText).join("")).join(". ")).join(" ");
}
/** Every `[[key:…]]` binding ID the text names. */
export function keyTokens(body: string): string[] {
  return [...body.matchAll(TOKEN)].flatMap(match => match[2] ? [match[2]] : []);
}
