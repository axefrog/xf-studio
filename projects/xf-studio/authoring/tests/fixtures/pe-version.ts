/** Minimal synthetic PE with fixed and optional string versions; contains no executable code. */
export function peVersionFixture(version: readonly [number, number, number, number], product?: string): Uint8Array {
  const align = (value: number) => (value + 3) & ~3;
  const block = (key: string, value: Uint8Array, children: Uint8Array[] = [], text = true) => {
    const name = Buffer.from(`${key}\0`, "utf16le"), valueAt = align(6 + name.length), childrenAt = align(valueAt + value.length);
    const size = children.length ? childrenAt + children.reduce((n, child) => n + align(child.length), 0) : valueAt + value.length;
    const bytes = Buffer.alloc(size);
    bytes.writeUInt16LE(size, 0); bytes.writeUInt16LE(text ? value.length / 2 : value.length, 2); bytes.writeUInt16LE(text ? 1 : 0, 4);
    bytes.set(name, 6); bytes.set(value, valueAt);
    let at = childrenAt;
    for (const child of children) { bytes.set(child, at); at += align(child.length); }
    return bytes;
  };
  const fixed = Buffer.alloc(52);
  fixed.writeUInt32LE(0xfeef04bd, 0); fixed.writeUInt32LE(0x00010000, 4);
  fixed.writeUInt32LE(((version[0] << 16) | version[1]) >>> 0, 8);
  fixed.writeUInt32LE(((version[2] << 16) | version[3]) >>> 0, 12);
  const strings = product === undefined ? [] : [block("StringFileInfo", new Uint8Array(), [block("040904b0", new Uint8Array(),
    [block("ProductVersion", Buffer.from(`${product}\0`, "utf16le"))])])];
  const resource = block("VS_VERSION_INFO", fixed, strings, false);
  const image = Buffer.alloc(256 + resource.length);
  image.set([0x4d, 0x5a]); image.writeUInt32LE(64, 0x3c); image.writeUInt32LE(0x00004550, 64);
  image.writeUInt16LE(1, 70); image.writeUInt16LE(0, 84); image.set(Buffer.from(".rsrc"), 88);
  image.writeUInt32LE(resource.length, 104); image.writeUInt32LE(256, 108); image.set(resource, 256);
  return image;
}
