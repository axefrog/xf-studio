/**
 * Byte-exact reading and writing of an MO2 profile's `modlist.txt` (INSTALL-05). Pure: the host reads the bytes and the
 * system ANSI code page and passes them here.
 *
 * MO2 2.x writes the file as UTF-8 (`Profile::doWriteModlist`); a file from an older MO2 or edited by hand may carry a BOM, or be
 * in the system's ANSI code page. The file is decoded as UTF-8 (with or without a BOM) when every byte is valid UTF-8, otherwise
 * as the ANSI code page when that is a single-byte one; anything else is refused. A decode is accepted only when encoding its text
 * again gives back exactly the bytes read, so every row XF Studio doesn't change is written back byte for byte. Line endings and
 * trailing spaces live in the text itself (mo2-placement.ts keeps them per row).
 */

export type ModlistEncoding = { kind: "utf-8"; bom: boolean } | { kind: "ansi"; codePage: number };
export type DecodedModlist = { text: string; encoding: ModlistEncoding };

/** The single-byte Windows ANSI code pages a TextDecoder knows (Thai, Central European, Cyrillic, Western, Greek, … Vietnamese). */
const SINGLE_BYTE = new Set([874, 1250, 1251, 1252, 1253, 1254, 1255, 1256, 1257, 1258]);
const tables = new Map<number, { decode: string[]; encode: Map<string, number> } | null>();

function codePageTable(codePage: number) {
  if (tables.has(codePage)) return tables.get(codePage)!;
  let table: { decode: string[]; encode: Map<string, number> } | null = null;
  if (SINGLE_BYTE.has(codePage)) {
    try {
      const decoder = new TextDecoder(`windows-${codePage}`);
      const decode: string[] = [], encode = new Map<string, number>();
      for (let byte = 0; byte < 256; byte++) {
        const char = decoder.decode(new Uint8Array([byte]));
        decode.push(char);
        // A byte with no character of its own (U+FFFD) can't round-trip; a character two bytes share keeps the first.
        if (char.length === 1 && char !== "�" && !encode.has(char)) encode.set(char, byte);
      }
      table = { decode, encode };
    } catch { table = null; }
  }
  tables.set(codePage, table);
  return table;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);

/** The text of `modlist.txt` and how it was stored, or null when it can't be read back exactly (then it is never changed). */
export function decodeModlist(bytes: Uint8Array, ansiCodePage: number | null): DecodedModlist | null {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const candidates: ModlistEncoding[] = [{ kind: "utf-8", bom }];
  if (!bom && ansiCodePage !== null) candidates.push({ kind: "ansi", codePage: ansiCodePage });
  for (const encoding of candidates) {
    const text = decodeWith(bytes, encoding);
    if (text === null) continue;
    const again = encodeModlist(text, encoding);
    if (again && sameBytes(again, bytes)) return { text, encoding };
  }
  return null;
}

function decodeWith(bytes: Uint8Array, encoding: ModlistEncoding): string | null {
  if (encoding.kind === "utf-8") {
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); } catch { return null; }
  }
  const table = codePageTable(encoding.codePage);
  if (!table) return null;
  let text = "";
  for (const byte of bytes) {
    const char = table.decode[byte]!;
    if (table.encode.get(char) !== byte) return null;
    text += char;
  }
  return text;
}

/** The bytes of `text` stored as `encoding`, or null when a character can't be stored in it (a name the ANSI code page lacks). */
export function encodeModlist(text: string, encoding: ModlistEncoding): Uint8Array | null {
  if (encoding.kind === "utf-8") {
    const body = new TextEncoder().encode(text);
    if (!encoding.bom) return body;
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]); out.set(body, 3);
    return out;
  }
  const table = codePageTable(encoding.codePage);
  if (!table) return null;
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) {
    const byte = table.encode.get(text[index]!);
    if (byte === undefined) return null;
    out[index] = byte;
  }
  return out;
}
