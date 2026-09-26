/**
 * Code-only scanning for the boundary tests: a source with its comments and the contents of its string, template
 * and regular-expression literals blanked (line structure kept), so prose and messages never look like code.
 * A template's `${…}` expressions are blanked too, which only makes the scans more lenient there.
 */
export function codeOnly(text: string): string {
  const out: string[] = [];
  /** What precedes a `/`: a value (then it divides) or an operator or keyword (then it starts a regular expression). */
  let value = false, word = "";
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let i = 0;
  while (i < text.length) {
    const c = text[i], next = text[i + 1];
    if (c === "/" && (next === "/" || next === "*")) {
      const end = next === "/" ? text.indexOf("\n", i) : text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : next === "/" ? end : end + 2;
      out.push(blank(text.slice(i, stop))); i = stop; continue;
    }
    if (c === "\"" || c === "'" || c === "`" || (c === "/" && !value)) {
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
      out.push(c + blank(text.slice(i + 1, Math.min(j, text.length))) + (text[j] ?? "")); i = j + 1;
      value = true; word = ""; continue;
    }
    out.push(c);
    if (/[\w$]/.test(c)) { word += c; value = true; }
    else {
      if (word && /^(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(word)) value = false;
      word = "";
      if (!/\s/.test(c)) value = c === ")" || c === "]" || c === "}";
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
