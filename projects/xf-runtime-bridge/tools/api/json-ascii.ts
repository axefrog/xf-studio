// JSON text that survives any console code page (0.8.18, Borg 3: a subtitle's "…" read as "nap" plus a replacement character).
// The bridge's wire, ring and files carry the text as UTF-8 byte for byte (tools/test/borg3-0818.test.ts and the native recorder
// unit tests prove it); what garbled it was the last hop, a console or shell that decodes a program's output in an ANSI or OEM
// code page and redirects it (a single 0x85, the code page's "…", then reads as one replacement character in UTF-8). Printing
// every non-ASCII character as a \uXXXX escape keeps the document valid JSON with the same meaning, and plain ASCII on the way.

/** `JSON.stringify` with every non-ASCII UTF-16 unit written as a \uXXXX escape (surrogate pairs stay valid as pairs). */
export function asciiJson(value: unknown, space?: number): string {
  const text = JSON.stringify(value, null, space);
  return text === undefined ? "null" : text.replace(/[\u0080-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}
