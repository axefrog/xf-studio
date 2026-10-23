"""Read resources straight from a game .archive (RDAR) with the game's own Oodle DLL, without WolvenKit.

Used by the places research (area D) to take a census of every streaming sector's header tables in seconds.
Standard library only; Windows only (it loads the game's `oo2ext_7_win64.dll` through ctypes).

  python places_archive.py census --game PATH_TO_GAME --archive content/basegame_3_nightcity.archive \
      --paths PATH_LIST.txt --out census.json

PATH_LIST.txt is the output of `WolvenKit.CLI archive <archive> -l`. The census records, for every
`.streamingsector` in the list, the file size and the number of exported objects per class name.
The bytes `extracted()` returns equal WolvenKit's `extract` output byte for byte (checked on a sector).
"""
import argparse, collections, ctypes, json, mmap, re, struct, sys, time

M64 = (1 << 64) - 1
BS = chr(92)


def fnv1a64(b):
    h = 0xCBF29CE484222325
    for x in b:
        h = ((h ^ x) * 0x100000001B3) & M64
    return h


def depot_hash(path):
    """FNV-1a 64 of the sanitised depot path (lower case, single backslashes, no leading slash)."""
    p = re.sub("[/" + BS + BS + "]+", lambda m: BS, path.lstrip("/" + BS).lower())
    return fnv1a64(p.encode())


class Oodle:
    def __init__(self, game):
        dll = ctypes.WinDLL(game + "/bin/x64/oo2ext_7_win64.dll")
        f = dll.OodleLZ_Decompress
        f.restype = ctypes.c_int64
        f.argtypes = [ctypes.c_char_p, ctypes.c_int64, ctypes.c_void_p, ctypes.c_int64, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                      ctypes.c_void_p, ctypes.c_int64, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int64, ctypes.c_int]
        self.f = f

    def decompress(self, raw):
        assert raw[:4] == b"KARK", "not a KARK stream"
        size = struct.unpack_from("<I", raw, 4)[0]
        dst = ctypes.create_string_buffer(size)
        n = self.f(bytes(raw[8:]), len(raw) - 8, dst, size, 0, 0, 0, None, 0, None, None, None, 0, 3)
        assert n == size, (n, size)
        return dst.raw


class Archive:
    def __init__(self, path, oodle):
        self.oodle = oodle
        self.f = open(path, "rb")
        self.mm = mmap.mmap(self.f.fileno(), 0, access=mmap.ACCESS_READ)
        assert self.mm[:4] == b"RDAR", "not an RDAR archive"
        offset, size = struct.unpack_from("<QI", self.mm, 8)
        idx = self.mm[offset:offset + size]
        files, segments, _deps = struct.unpack_from("<III", idx, 16)
        seg_at = 28 + files * 56
        self.segs = [struct.unpack_from("<QII", idx, seg_at + 16 * i) for i in range(segments)]
        self.entries = {}
        for i in range(files):
            h, _ts, _nb, first, end = struct.unpack_from("<QqIII", idx, 28 + 56 * i)[:5]
            self.entries[h] = (first, end)

    def body(self, path):
        """The decompressed CR2W body (the first segment) of one resource, or None."""
        h = path if isinstance(path, int) else depot_hash(path)
        if h not in self.entries:
            return None
        first, _end = self.entries[h]
        off, stored, size = self.segs[first]
        raw = self.mm[off:off + stored]
        return bytes(raw) if stored == size else self.oodle.decompress(raw)

    def extracted(self, path):
        """The file WolvenKit's `extract` writes: the decompressed body followed by the buffer segments as stored."""
        h = path if isinstance(path, int) else depot_hash(path)
        if h not in self.entries:
            return None
        first, end = self.entries[h]
        parts = [self.body(h)]
        for si in range(first + 1, end):
            off, stored, _size = self.segs[si]
            parts.append(bytes(self.mm[off:off + stored]))
        return b"".join(parts)


def cr2w_exports(body):
    """Class name -> number of exported objects, from the header tables only (strings, names, exports)."""
    tables = [struct.unpack_from("<III", body, 40 + 12 * k) for k in range(10)]
    strings_off, strings_len, _ = tables[0]
    names_off, _, _ = tables[1]
    exports_off, exports_count, _ = tables[4]
    pool = body[strings_off:strings_off + strings_len]
    cache, counts = {}, collections.Counter()
    for k in range(exports_count):
        ci = struct.unpack_from("<H", body, exports_off + 24 * k)[0]
        if ci not in cache:
            off = struct.unpack_from("<I", body, names_off + 8 * ci)[0]
            cache[ci] = pool[off:pool.index(b"\0", off)].decode("ascii", "replace")
        counts[cache[ci]] += 1
    return dict(counts)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["census"])
    ap.add_argument("--game", required=True, help="the game folder (PATH_TO_GAME)")
    ap.add_argument("--archive", required=True, help="archive path relative to PATH_TO_GAME/archive/pc")
    ap.add_argument("--paths", required=True, help="text file of depot paths, one per line (`archive -l` output)")
    ap.add_argument("--suffix", default=".streamingsector")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    arc = Archive(a.game + "/archive/pc/" + a.archive, Oodle(a.game))
    paths = [l.strip() for l in open(a.paths, encoding="utf-8", errors="replace") if l.strip().endswith(a.suffix)]
    out, t0 = {}, time.time()
    for p in paths:
        body = arc.body(p)
        if body is not None:
            out[p] = {"size": len(body), "exports": cr2w_exports(body)}
    json.dump(out, open(a.out, "w"))
    print(len(out), "files in", round(time.time() - t0), "s", file=sys.stderr)


if __name__ == "__main__":
    main()
