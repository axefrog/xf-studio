// modlist.txt is written back byte for byte (INSTALL-05): its encoding (UTF-8 with or without a BOM, or a single-byte ANSI code
// page), every row's own line ending and trailing spaces are kept; a file that can't be read back exactly is never changed.
import { expect, test } from "bun:test";
import { decodeModlist, encodeModlist } from "../src/mo2-modlist-text";
import { applyMo2Placement, planMo2Placement } from "../src/mo2-placement";

const bytes = (...parts: (string | number[])[]) => new Uint8Array(Buffer.concat(parts.map(part => typeof part === "string" ? Buffer.from(part, "utf8") : Buffer.from(part))));
const place = (text: string) => applyMo2Placement(text, planMo2Placement(text, "XF Eye Artistry"));

test("UTF-8 with or without a BOM decodes and encodes back to the same bytes", () => {
  for (const file of [bytes("+Café Mod\r\n+A\n+B  \r\n"), bytes([0xef, 0xbb, 0xbf], "# gen\r\n+Ämod"), bytes("")]) {
    const decoded = decodeModlist(file, 1252)!;
    expect(decoded.encoding.kind).toBe("utf-8");
    expect(encodeModlist(decoded.text, decoded.encoding)).toEqual(file);
  }
  expect(decodeModlist(bytes([0xef, 0xbb, 0xbf], "+A\r\n"), null)).toEqual({ text: "+A\r\n", encoding: { kind: "utf-8", bom: true } });
});

test("a list in the system's ANSI code page keeps its bytes; one that can't be read back exactly is refused", () => {
  const ansi = bytes("+Caf", [0xe9], " Mod\r\n+A\n+B  \r\n");
  const decoded = decodeModlist(ansi, 1252)!;
  expect(decoded).toEqual({ text: "+Café Mod\r\n+A\n+B  \r\n", encoding: { kind: "ansi", codePage: 1252 } });
  // One row added, and every other byte exactly as it was (the reviewer's reproduction turned 0xE9 into U+FFFD).
  const next = encodeModlist(place(decoded.text), decoded.encoding)!;
  expect(next).toEqual(bytes("+XF Eye Artistry\r\n+Caf", [0xe9], " Mod\r\n+A\n+B  \r\n"));
  // Without a code page (not Windows), or with a multi-byte one, only UTF-8 is changed.
  expect(decodeModlist(ansi, null)).toBeNull();
  expect(decodeModlist(ansi, 932)).toBeNull();
  // A BOM followed by bytes that aren't UTF-8 is damaged: refused.
  expect(decodeModlist(bytes([0xef, 0xbb, 0xbf, 0x2b, 0xe9]), 1252)).toBeNull();
  // A name the code page can't hold can't be written into it.
  expect(encodeModlist("+日本\r\n", { kind: "ansi", codePage: 1252 })).toBeNull();
});

test("placement keeps each row's line ending and trailing spaces, and only flips the prefix of an existing row", () => {
  // The new row takes the line ending of the row it goes above.
  expect(place("# gen\r\n+A\n+Looks_separator")).toBe("# gen\r\n+XF Eye Artistry\n+A\n+Looks_separator");
  expect(place("\uFEFF+A\n+B  \r\n")).toBe("\uFEFF+XF Eye Artistry\n+A\n+B  \r\n");
  const off = "+Z\r\n-XF Eye Artistry  \n+Looks_separator\r\n";
  expect(place(off)).toBe("+Z\r\n+XF Eye Artistry  \n+Looks_separator\r\n");
  // At the very end of a list without a final line ending, the new row follows the last one.
  const end = "+ArchiveXL\r\n-FRAMEWORKS_separator";
  const placement = { ...planMo2Placement(end, "XF Eye Artistry"), rule: "list-end" as const, row: 2 };
  expect(applyMo2Placement(end, placement)).toBe("+ArchiveXL\r\n-FRAMEWORKS_separator\r\n+XF Eye Artistry");
});
