/**
 * Lossless CSS shrinking for the published style guide: comments go and whitespace collapses. Nothing is rewritten, merged or
 * reordered, so every rule keeps its meaning and cascade position. Strings and unquoted url() bodies are copied untouched.
 * Whitespace is dropped only beside `{ } ; ,` and after a declaration's colon; elsewhere a run becomes one space, because a
 * space can be a combinator (`a b`) or separate tokens (`1px 2px`, `) and (`, `a :hover`).
 */
export function minifyCss(css: string): string {
  const out: string[] = [];
  const n = css.length;
  let space = false;
  let last = "";
  /** Emits `text`, preceded by one pending space unless one side is a character that never needs it. */
  const emit = (text: string) => {
    const first = text[0];
    if (space && last !== "" && !"{};,:".includes(last) && !"{};,".includes(first)) out.push(" ");
    space = false;
    out.push(text);
    last = text[text.length - 1];
  };
  let i = 0;
  while (i < n) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      space = true;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && css[j] !== c) j += css[j] === "\\" ? 2 : 1;
      emit(css.slice(i, j + 1));
      i = j + 1;
    } else if (/\s/.test(c)) {
      space = true;
      i++;
    } else if (c === "(" && /\burl$/i.test(out.slice(-3).join("")) && !/^\s*["']/.test(css.slice(i + 1, i + 12))) {
      const end = css.indexOf(")", i);
      const stop = end < 0 ? n : end + 1;
      emit(css.slice(i, stop));
      i = stop;
    } else {
      emit(c);
      i++;
    }
  }
  return out.join("");
}
