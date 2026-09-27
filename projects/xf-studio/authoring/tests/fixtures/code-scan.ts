/**
 * Code-only scanning for the boundary tests: a source with its comments and the contents of its string, template
 * and regular-expression literals blanked (line structure kept), so prose and messages never look like code.
 * A template's `${…}` expressions are blanked too, which only makes the scans more lenient there.
 */
export function codeOnly(text: string): string { return scan(text, false); }
/** The source with only its comments blanked: literals keep their contents (markup in a string, for the component ratchet). */
export function withoutComments(text: string): string { return scan(text, true); }
function scan(text: string, keepLiterals: boolean): string {
  const out: string[] = [];
  /**
   * What precedes a `/`: a value (then it divides) or an operator or keyword (then it starts a regular expression). A `}` that
   * closes a line is a block's end, so a `/` opening the next line starts a regular expression (UI-121).
   */
  let value = false, word = "", afterBrace = false, newline = false;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let i = 0;
  while (i < text.length) {
    const c = text[i], next = text[i + 1];
    if (c === "/" && (next === "/" || next === "*")) {
      const end = next === "/" ? text.indexOf("\n", i) : text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : next === "/" ? end : end + 2;
      out.push(blank(text.slice(i, stop))); i = stop; continue;
    }
    if (c === "\"" || c === "'" || c === "`" || (c === "/" && (!value || (afterBrace && newline)))) {
      let j = i + 1, klass = false;
      while (j < text.length) {
        const d = text[j];
        if (d === "\\") { j += 2; continue; }
        if (c === "/" && d === "[") klass = true;
        else if (c === "/" && d === "]") klass = false;
        else if (d === c && !klass) break;
        else if (c !== "`" && d === "\n") break;
        j++;
      }
      if (c === "/") while (/[a-z]/.test(text[j + 1] ?? "")) j++;
      const body = text.slice(i + 1, Math.min(j, text.length));
      out.push(c + (keepLiterals ? body : blank(body)) + (text[j] ?? "")); i = j + 1;
      value = true; word = ""; afterBrace = newline = false; continue;
    }
    out.push(c);
    if (/[\w$]/.test(c)) { word += c; value = true; afterBrace = newline = false; }
    else {
      if (word && /^(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(word)) value = false;
      word = "";
      if (c === "\n") newline = true;
      else if (!/\s/.test(c)) { value = c === ")" || c === "]" || c === "}"; afterBrace = c === "}"; newline = false; }
    }
    i++;
  }
  return out.join("");
}

/**
 * Page and host globals that pure code must not read: the window by any use but a property name (`.window`, a
 * `window:` member or parameter annotation), `self.`, `document.`, `globalThis`, the page's storage and navigator,
 * network access, `process.env` and `Bun.env`. Run it on `codeOnly` text.
 */
export const PAGE_GLOBALS = /(?<![.\w$])window\b(?!\s*\??:)|(?<![.\w$])(?:self|document)\s*\.|\b(?:localStorage|sessionStorage|navigator|globalThis|indexedDB)\b|(?<![.\w$])fetch\s*\(|\bprocess\s*\.\s*env\b|\bBun\s*\.\s*env\b/;
/** Every page or host global a source reads (its code only), for failure messages. */
export const pageGlobals = (text: string) =>
  [...codeOnly(text).matchAll(new RegExp(PAGE_GLOBALS.source, "g"))].map(match => match[0].replace(/\s+/g, ""));
