/**
 * A small YAML reader for TweakXL files that keeps what TweakXL itself reads and a general-purpose parser throws away: **node tags**
 * (`- !append-once PhotoModePoses.x`: TweakXL's list operations are tags on sequence items) and **scalar text** (`displayName: 01` is the
 * text "01"; TweakXL converts a scalar by the field's type, so a label is never read as the number 1). Pure: text in, a node tree out.
 *
 * TweakXL loads its files with yaml-cpp (`YAML::LoadFile`: the first document), iterates map entries in file order (duplicate keys
 * included) and reads tags with `Node::Tag()` [source: TweakXL 1.11.4 `f8da6be4`, `Yaml/YamlReader.cpp`]. This reader covers the YAML
 * those files use: block mappings and sequences (compact forms included), flow collections, plain, single- and double-quoted scalars,
 * literal and folded block scalars, comments, tags, anchors and aliases (an alias is the anchored node itself, tag included). It refuses,
 * with the line, what it does not read: complex `?` keys, tabs in indentation, unknown escapes, unterminated quotes or collections.
 * Merge keys (`<<`) stay ordinary keys, as yaml-cpp leaves them [hypothesis: TweakXL does no merge-key handling of its own].
 */

export type YamlNode =
  | { readonly kind: "scalar"; readonly text: string; readonly tag: string | null; readonly style: "plain" | "single" | "double" | "block" }
  | { readonly kind: "seq"; readonly items: readonly YamlNode[]; readonly tag: string | null }
  /** Entries in file order; a key given twice appears twice, as yaml-cpp iterates it. */
  | { readonly kind: "map"; readonly entries: readonly (readonly [string, YamlNode])[]; readonly tag: string | null };

export class YamlError extends Error {
  override name = "YamlError";
  constructor(message: string, readonly line: number) { super(`line ${line}: ${message}`); }
}

/** Largest nesting, anchors and nodes a file may use (a record file of the reference installation is far below each). */
const MAX_DEPTH = 64, MAX_NODES = 2_000_000;

interface Props { tag: string | null; anchor: string | null }
type Mutable = { kind: "scalar"; text: string; tag: string | null; style: "plain" | "single" | "double" | "block" }
  | { kind: "seq"; items: YamlNode[]; tag: string | null } | { kind: "map"; entries: [string, YamlNode][]; tag: string | null };

class Parser {
  private pos = 0;
  private readonly anchors = new Map<string, YamlNode>();
  private nodes = 0;
  private depth = 0;
  constructor(private readonly src: string) {}

  // ---- position helpers ----
  private lineOf(at = this.pos) { let line = 1; for (let i = 0; i < at && i < this.src.length; i++) if (this.src.charCodeAt(i) === 10) line++; return line; }
  private fail(message: string, at = this.pos): never { throw new YamlError(message, this.lineOf(at)); }
  private column(at = this.pos) { const start = this.src.lastIndexOf("\n", at - 1) + 1; return at - start; }
  private peek(offset = 0) { return this.src[this.pos + offset] ?? ""; }
  private eol(at = this.pos) { const c = this.src[at]; return c === undefined || c === "\n" || c === "\r"; }
  private blank(c: string) { return c === " " || c === "\t"; }
  private skipSpaces() { while (this.blank(this.peek())) this.pos++; }
  /** At a comment or the end of the line (after spaces). */
  private atLineEnd() { this.skipSpaces(); return this.eol() || this.peek() === "#"; }
  private toNextLine() { const next = this.src.indexOf("\n", this.pos); this.pos = next < 0 ? this.src.length : next + 1; }
  /**
   * Move to the first character of the next line with content (skipping blank and comment-only lines) and return its indent, or -1 at the
   * end of the document (`---` or `...` at column 0, or the end of the text). Leaves `pos` at that line's first non-space character.
   */
  private nextContentLine(): number {
    for (;;) {
      if (this.pos >= this.src.length) return -1;
      const lineStart = this.pos;
      let indent = 0;
      while (this.peek() === " ") { this.pos++; indent++; }
      if (this.peek() === "\t") {
        // A tab before content is indentation, which YAML forbids; a line of only whitespace is blank.
        let at = this.pos; while (this.blank(this.src[at] ?? "")) at++;
        if (!this.eol(at) && this.src[at] !== "#") this.fail("a tab is used for indentation");
        this.pos = at;
      }
      if (this.eol() || this.peek() === "#") { this.toNextLine(); continue; }
      if (indent === 0 && (this.src.startsWith("---", lineStart) || this.src.startsWith("...", lineStart)) && (this.eol(lineStart + 3) || this.blank(this.src[lineStart + 3]!))) {
        this.pos = lineStart;
        return -1;
      }
      return indent;
    }
  }
  private count() { if (++this.nodes > MAX_NODES) this.fail("the file has too many nodes"); }
  private enter() { if (++this.depth > MAX_DEPTH) this.fail("the file nests too deeply"); }
  private leave() { this.depth--; }

  // ---- document ----
  document(): YamlNode | null {
    // Directives and a leading `---` start the first document; only the first document is read, as yaml-cpp's LoadFile does.
    for (;;) {
      const indent = this.nextContentLine();
      if (indent === 0 && this.peek() === "%") { this.toNextLine(); continue; }
      if (indent === -1 && this.src.startsWith("---", this.pos)) { this.pos += 3; if (this.atLineEnd()) { this.toNextLine(); continue; } return this.finish(this.node(-1, false)); }
      if (indent === -1) return null;
      return this.finish(this.node(-1, false));
    }
  }
  private finish(node: YamlNode): YamlNode {
    const indent = this.nextContentLine();
    if (indent > 0 || (indent === 0 && this.pos < this.src.length)) this.fail("unexpected content after the document's top node");
    return node;
  }

  // ---- properties ----
  private props(): Props {
    const props: Props = { tag: null, anchor: null };
    for (;;) {
      this.skipSpaces();
      const c = this.peek();
      if (c === "!" && props.tag === null) {
        const start = this.pos;
        while (!this.eol() && !this.blank(this.peek()) && !",[]{}".includes(this.peek())) this.pos++;
        props.tag = this.src.slice(start, this.pos);
      } else if (c === "&" && props.anchor === null) {
        this.pos++;
        const start = this.pos;
        while (!this.eol() && !this.blank(this.peek()) && !",[]{}".includes(this.peek())) this.pos++;
        if (this.pos === start) this.fail("an anchor has no name");
        props.anchor = this.src.slice(start, this.pos);
      } else return props;
    }
  }
  private register(props: Props, node: Mutable): YamlNode {
    if (props.tag !== null) node.tag = props.tag;
    if (props.anchor !== null) this.anchors.set(props.anchor, node);
    return node;
  }
  private alias(): YamlNode {
    this.pos++;
    const start = this.pos;
    while (!this.eol() && !this.blank(this.peek()) && !",[]{}".includes(this.peek())) this.pos++;
    const name = this.src.slice(start, this.pos);
    const node = this.anchors.get(name);
    if (!node) this.fail(`the alias *${name} names no anchor`, start);
    return node;
  }

  // ---- block context ----
  /** A dash that starts a block sequence item: `-` then a space or the end of the line. */
  private atDash(at = this.pos) { return this.src[at] === "-" && (this.eol(at + 1) || this.blank(this.src[at + 1]!)); }

  /**
   * A node whose first character may be on this line after `pos` (a mapping value or sequence item) or on following lines. `parent` is
   * the indent of the owning collection: content on following lines must be indented deeper, except that a mapping's value may be a block
   * sequence at the mapping's own indent (`sameIndentSeq`).
   */
  private node(parent: number, sameIndentSeq: boolean): YamlNode {
    this.count(); this.enter();
    try {
      const props = this.props();
      if (this.atLineEnd()) {
        const lineStart = this.pos;
        const indent = this.nextContentLine();
        // Properties on their own line belong to the block node below.
        if (indent > parent || (sameIndentSeq && indent === parent && this.atDash())) return this.register(props, this.blockAt(indent) as Mutable);
        // No content: an empty (null) scalar; the next line belongs to an outer collection.
        this.pos = lineStart;
        return this.register(props, { kind: "scalar", text: "", tag: null, style: "plain" });
      }
      return this.register(props, this.inline(parent) as Mutable);
    } finally { this.leave(); }
  }

  /** A block node starting at `pos`, the first content character of a line indented `indent`. */
  private blockAt(indent: number): YamlNode {
    const props = this.props();
    if (props.tag === null && props.anchor === null) return this.inline(indent - 1, indent);
    // `!tag` or `&anchor` alone on a line, then the node on the next lines (at least as deep).
    if (this.atLineEnd()) {
      const next = this.nextContentLine();
      if (next < indent) this.fail("a tag or anchor has no node");
      return this.register(props, this.blockAt(next) as Mutable);
    }
    return this.register(props, this.inline(indent - 1, this.column()) as Mutable);
  }

  /** A node starting at `pos` on the current line. `parent` bounds plain-scalar continuation lines; `column` is where the node starts. */
  private inline(parent: number, column = this.column()): YamlNode {
    const c = this.peek();
    if (this.atDash()) return this.blockSeq(column);
    if (c === "|" || c === ">") return this.blockScalar(parent);
    if (c === "*") { const node = this.alias(); return this.mapAfterKey(node, column) ?? node; }
    if (c === "[" || c === "{") {
      const node = this.flow();
      return this.mapAfterKey(node, column) ?? node;
    }
    if (c === "?" && (this.eol(this.pos + 1) || this.blank(this.peek(1)))) this.fail("complex mapping keys (?) are not read");
    // A key on this line makes this a block mapping at this column.
    const key = this.tryKey();
    if (key !== null) return this.blockMap(column, key);
    if (c === '"' || c === "'") return this.quoted(c);
    return this.plain(parent, false);
  }

  /** After a flow node or alias used as a key (`[a]: b` is not TweakXL syntax): refused. */
  private mapAfterKey(_node: YamlNode, _column: number): YamlNode | null {
    const save = this.pos;
    this.skipSpaces();
    if (this.peek() === ":" && (this.eol(this.pos + 1) || this.blank(this.peek(1)))) this.fail("a collection or alias used as a mapping key is not read");
    this.pos = save;
    return null;
  }

  /**
   * If a mapping key starts at `pos` on this line (a plain or quoted scalar followed by `:` and a space or the line end), consume it and
   * the colon and return its text; otherwise leave `pos` and return null.
   */
  private tryKey(): string | null {
    const start = this.pos;
    const c = this.peek();
    let text: string;
    if (c === '"' || c === "'") {
      try { text = (this.quoted(c) as { text: string }).text; } catch { this.pos = start; return null; }
      this.skipSpaces();
      if (this.peek() === ":" && (this.eol(this.pos + 1) || this.blank(this.peek(1)))) { this.pos++; return text; }
      this.pos = start; return null;
    }
    let at = this.pos;
    while (!this.eol(at)) {
      const ch = this.src[at]!;
      if (ch === ":" && (this.eol(at + 1) || this.blank(this.src[at + 1]!))) {
        text = this.src.slice(this.pos, at).trimEnd();
        if (!text) return null;
        this.pos = at + 1;
        return text;
      }
      if (ch === "#" && at > this.pos && this.blank(this.src[at - 1]!)) return null;
      at++;
    }
    return null;
  }

  private blockMap(column: number, firstKey: string): YamlNode {
    const entries: [string, YamlNode][] = [];
    let key: string | null = firstKey;
    for (;;) {
      entries.push([key, this.node(column, true)]);
      const lineStart = this.pos;
      const indent = this.nextContentLine();
      if (indent < column) { this.pos = indent === -1 ? this.pos : lineStart; break; }
      if (indent > column) this.fail("a line is indented deeper than its mapping");
      if (this.atDash()) { this.pos = lineStart; break; }
      if (this.peek() === "?" && (this.eol(this.pos + 1) || this.blank(this.peek(1)))) this.fail("complex mapping keys (?) are not read");
      key = this.tryKey();
      if (key === null) this.fail("a mapping entry has no key");
    }
    return { kind: "map", entries, tag: null };
  }

  private blockSeq(column: number): YamlNode {
    const items: YamlNode[] = [];
    for (;;) {
      this.pos++; // the dash
      items.push(this.node(column, false));
      const lineStart = this.pos;
      const indent = this.nextContentLine();
      if (indent === column && this.atDash()) continue;
      if (indent > column) this.fail("a line is indented deeper than its sequence");
      if (indent !== -1) this.pos = lineStart;
      break;
    }
    return { kind: "seq", items, tag: null };
  }

  private blockScalar(parent: number): YamlNode {
    const folded = this.peek() === ">";
    this.pos++;
    let chomp: "clip" | "strip" | "keep" = "clip", explicit = 0;
    for (let i = 0; i < 2; i++) {
      const c = this.peek();
      if (c === "-") { chomp = "strip"; this.pos++; } else if (c === "+") { chomp = "keep"; this.pos++; }
      else if (c >= "1" && c <= "9") { explicit = Number(c); this.pos++; }
    }
    if (!this.atLineEnd()) this.fail("unexpected text after a block scalar indicator");
    this.toNextLine();
    const lines: string[] = [];
    let indent = explicit ? Math.max(parent, 0) + explicit : -1;
    while (this.pos < this.src.length) {
      const lineEnd = this.src.indexOf("\n", this.pos), end = lineEnd < 0 ? this.src.length : lineEnd;
      const line = this.src.slice(this.pos, end).replace(/\r$/, "");
      const spaces = line.length - line.trimStart().length;
      if (line.trim() === "") { lines.push(""); this.pos = end + 1; continue; }
      if (indent < 0) { if (spaces <= parent) break; indent = spaces; }
      if (spaces < indent) break;
      lines.push(line.slice(indent));
      this.pos = end + 1;
    }
    if (this.pos > this.src.length) this.pos = this.src.length;
    // Give back trailing blank lines' positions: they are part of the scalar only for chomping.
    let trailing = 0; while (lines.length && lines.at(-1) === "") { lines.pop(); trailing++; }
    let text: string;
    if (!folded) text = lines.join("\n");
    else {
      text = "";
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (i === 0) { text = line; continue; }
        const prev = lines[i - 1]!;
        text += line === "" || prev === "" || line.startsWith(" ") || prev.startsWith(" ") ? "\n" + line : " " + line;
      }
    }
    if (lines.length) text += chomp === "strip" ? "" : chomp === "keep" ? "\n".repeat(trailing + 1) : "\n";
    // Step back to the start of the line that ended the scalar.
    if (this.pos > 0 && this.pos <= this.src.length) { const back = this.src.lastIndexOf("\n", this.pos - 1); this.pos = back + 1; }
    return { kind: "scalar", text, tag: null, style: "block" };
  }

  // ---- scalars ----
  private quoted(q: string): YamlNode {
    const start = this.pos;
    this.pos++;
    let text = "";
    for (;;) {
      if (this.pos >= this.src.length) this.fail("a quoted scalar is not closed", start);
      const c = this.src[this.pos]!;
      if (q === "'" && c === "'") {
        if (this.peek(1) === "'") { text += "'"; this.pos += 2; continue; }
        this.pos++; break;
      }
      if (q === '"' && c === '"') { this.pos++; break; }
      if (q === '"' && c === "\\") { text += this.escape(); continue; }
      if (c === "\r" || c === "\n") {
        // Line folding inside quotes: trailing spaces dropped, a single break becomes a space, blank lines become breaks.
        text = text.replace(/[ \t]+$/, "");
        let breaks = 0;
        while (this.pos < this.src.length && (this.peek() === "\n" || this.peek() === "\r" || this.blank(this.peek()))) { if (this.peek() === "\n") breaks++; this.pos++; }
        text += breaks > 1 ? "\n".repeat(breaks - 1) : " ";
        continue;
      }
      text += c; this.pos++;
    }
    return { kind: "scalar", text, tag: null, style: q === '"' ? "double" : "single" };
  }
  private escape(): string {
    const at = this.pos;
    this.pos++;
    const c = this.src[this.pos++] ?? "";
    const simple: Record<string, string> = { "0": "\0", a: "\x07", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\v", f: "\f", r: "\r", e: "\x1b", " ": " ",
      '"': '"', "/": "/", "\\": "\\", N: "\u0085", _: " ", L: " ", P: " " };
    if (c in simple) return simple[c]!;
    const hex = c === "x" ? 2 : c === "u" ? 4 : c === "U" ? 8 : 0;
    if (hex) {
      const digits = this.src.slice(this.pos, this.pos + hex);
      if (!/^[0-9a-fA-F]+$/.test(digits) || digits.length !== hex) this.fail("a malformed escape", at);
      this.pos += hex;
      return String.fromCodePoint(parseInt(digits, 16));
    }
    if (c === "\n" || c === "\r") { if (c === "\r" && this.peek() === "\n") this.pos++; this.skipSpaces(); return ""; }
    this.fail(`an unknown escape \\${c}`, at);
  }

  /** A plain scalar: to the line end or a comment in block context, continued on deeper-indented lines; to `,[]{}` or `: ` in flow. */
  private plain(parent: number, flow: boolean): YamlNode {
    const start = this.pos;
    const readLine = () => {
      const from = this.pos;
      while (!this.eol()) {
        const c = this.peek();
        if (c === "#" && this.pos > from && this.blank(this.src[this.pos - 1]!)) break;
        if (flow && (c === "," || c === "]" || c === "}" || c === "[" || c === "{")) break;
        if (c === ":" && (this.eol(this.pos + 1) || this.blank(this.peek(1)) || (flow && ",[]{}".includes(this.peek(1))))) {
          if (flow) break;
          this.fail("a mapping key is not allowed here");
        }
        this.pos++;
      }
      return this.src.slice(from, this.pos).trim();
    };
    let text = readLine();
    if (!text) this.fail("a value is missing", start);
    // Block context: deeper-indented lines that are neither comments nor `key: value` continue the scalar (a line break folds to a space,
    // each blank line to a break).
    while (!flow && this.eol()) {
      const save = this.pos;
      this.toNextLine();
      let breaks = 0, indent = -1;
      while (this.pos < this.src.length) {
        const lineStart = this.pos;
        indent = 0; while (this.peek() === " ") { this.pos++; indent++; }
        if (this.eol()) { breaks++; this.toNextLine(); indent = -1; continue; }
        if (indent === 0 && (this.src.startsWith("---", lineStart) || this.src.startsWith("...", lineStart))) indent = -1;
        break;
      }
      const probe = this.pos;
      if (indent <= parent || this.peek() === "#" || this.tryKey() !== null) { this.pos = save; break; }
      this.pos = probe;
      const more = readLine();
      text += breaks ? "\n".repeat(breaks) + more : " " + more;
    }
    return { kind: "scalar", text, tag: null, style: "plain" };
  }

  // ---- flow context ----
  private skipFlowSpace() {
    for (;;) {
      const c = this.peek();
      if (c === " " || c === "\t" || c === "\r" || c === "\n") this.pos++;
      else if (c === "#" && (this.pos === 0 || /\s/.test(this.src[this.pos - 1]!))) this.toNextLine();
      else return;
    }
  }
  private flowItem(): YamlNode {
    this.count(); this.enter();
    try {
      this.skipFlowSpace();
      const props = this.props();
      this.skipFlowSpace();
      const c = this.peek();
      let node: YamlNode;
      if (c === "[" || c === "{") node = this.flow();
      else if (c === "*") node = this.alias();
      else if (c === '"' || c === "'") node = this.quoted(c);
      else if (c === "," || c === "]" || c === "}") node = { kind: "scalar", text: "", tag: null, style: "plain" };
      else node = this.plain(Number.MAX_SAFE_INTEGER, true);
      return props.tag === null && props.anchor === null ? node : this.register(props, node as Mutable);
    } finally { this.leave(); }
  }
  private flow(): YamlNode {
    const open = this.pos;
    const seq = this.peek() === "[";
    this.pos++;
    const items: YamlNode[] = [], entries: [string, YamlNode][] = [];
    this.enter();
    for (;;) {
      this.skipFlowSpace();
      if (this.pos >= this.src.length) this.fail("a flow collection is not closed", open);
      if (this.peek() === (seq ? "]" : "}")) { this.pos++; break; }
      const item = this.flowItem();
      this.skipFlowSpace();
      if (this.peek() === ":") {
        this.pos++;
        if (item.kind !== "scalar") this.fail("a collection used as a mapping key is not read");
        const value = this.peek() === "," || this.peek() === (seq ? "]" : "}") ? { kind: "scalar" as const, text: "", tag: null, style: "plain" as const } : this.flowItem();
        if (seq) items.push({ kind: "map", entries: [[item.text, value]], tag: null }); else entries.push([item.text, value]);
      } else if (seq) items.push(item);
      else entries.push([item.kind === "scalar" ? item.text : this.fail("a collection used as a mapping key is not read"), { kind: "scalar", text: "", tag: null, style: "plain" }]);
      this.skipFlowSpace();
      if (this.peek() === ",") { this.pos++; continue; }
      if (this.peek() === (seq ? "]" : "}")) { this.pos++; break; }
      this.fail(`a flow ${seq ? "sequence" : "mapping"} expects "," or "${seq ? "]" : "}"}"`);
    }
    this.leave();
    return seq ? { kind: "seq", items, tag: null } : { kind: "map", entries, tag: null };
  }
}

/** Parse a TweakXL YAML file's first document (null when it is empty). Throws a `YamlError` naming the line when it can't be read. */
export function parseTweakYaml(text: string): YamlNode | null {
  return new Parser(text.replace(/^﻿/, "")).document();
}

/** A scalar's text, or null for a collection or an empty (null) scalar. */
export const scalarText = (node: YamlNode | null | undefined): string | null =>
  node?.kind === "scalar" && !(node.style === "plain" && (node.text === "" || node.text === "~" || /^null$/i.test(node.text))) ? node.text : null;

/** The first value of `key` in a mapping node, as yaml-cpp's `node[key]` finds it. */
export const mapGet = (node: YamlNode | null | undefined, key: string): YamlNode | undefined =>
  node?.kind === "map" ? node.entries.find(([name]) => name === key)?.[1] : undefined;

/**
 * Plain JavaScript values: every scalar as its text (an empty or `null` plain scalar as null), sequences as arrays, mappings as objects
 * (for a key given twice, the later value, which is what a later assignment in TweakXL leaves). Tags are dropped.
 */
export function toPlain(node: YamlNode | null): unknown {
  if (!node) return null;
  if (node.kind === "scalar") return scalarText(node);
  if (node.kind === "seq") return node.items.map(toPlain);
  const out: Record<string, unknown> = {};
  for (const [key, value] of node.entries) out[key] = toPlain(value);
  return out;
}
