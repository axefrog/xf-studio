"""Fingerprint Cyberpunk 2077 crashes from the game's own crash reports (no debugger needed).

The game writes each crash to %LOCALAPPDATA%\\REDEngine\\ReportQueue\\<exe>-<date>-<time>-<pid>-<tid>\\
with Cyberpunk2077.dmp (a minidump), stacktrace.txt and report.txt. This reads the minidump's
exception, module list, crashing thread's registers and stack memory, and prints:

  - the exception code and the faulting address as <module>+<offset> (the crash's fingerprint:
    two crashes at the same module+offset almost always share a cause);
  - the message from stacktrace.txt;
  - return-address candidates found by scanning the crashing thread's stack, as <module>+<offset>
    (a heuristic scan, not an unwound stack: it lists values that point into loaded modules).

    python tools/minidump_summary.py                 # the five newest reports
    python tools/minidump_summary.py --newest 20 --frames 0
    python tools/minidump_summary.py <report folder or .dmp> [...]

Read-only; prints module names and offsets, never memory contents.
"""

from __future__ import annotations

import argparse
import os
import struct
import sys
from pathlib import Path

QUIET_MODULES = ("ntdll", "KERNEL", "ucrtbase", "msvcp", "VCRUNTIME")


class Minidump:
    def __init__(self, path: Path):
        self.f = path.open("rb")
        signature, _version, count, directory = self._read(0, "<IIII")
        if signature != 0x504D444D:  # "MDMP"
            raise ValueError(f"{path} is not a minidump")
        self.streams: dict[int, tuple[int, int]] = {}
        for i in range(count):
            kind, size, rva = self._read(directory + i * 12, "<III")
            self.streams.setdefault(kind, (size, rva))
        self.modules = self._modules()
        self.memory = self._memory()

    def _read(self, offset: int, fmt: str):
        self.f.seek(offset)
        return struct.unpack(fmt, self.f.read(struct.calcsize(fmt)))

    def _string(self, rva: int) -> str:
        (length,) = self._read(rva, "<I")
        self.f.seek(rva + 4)
        return self.f.read(length).decode("utf-16-le", "replace")

    def _modules(self):
        mods = []
        if 4 not in self.streams:
            return mods
        _size, rva = self.streams[4]
        (count,) = self._read(rva, "<I")
        for i in range(count):
            entry = rva + 4 + i * 108
            base, size = self._read(entry, "<QI")
            (name_rva,) = self._read(entry + 20, "<I")
            mods.append((base, base + size, os.path.basename(self._string(name_rva))))
        return mods

    def _memory(self):
        ranges = []
        if 5 in self.streams:
            _size, rva = self.streams[5]
            (count,) = self._read(rva, "<I")
            for i in range(count):
                start, size, data = self._read(rva + 4 + i * 16, "<QII")
                ranges.append((start, size, data))
        if 9 in self.streams:
            _size, rva = self.streams[9]
            count, data = self._read(rva, "<QQ")
            for i in range(count):
                start, size = self._read(rva + 16 + i * 16, "<QQ")
                ranges.append((start, size, data))
                data += size
        return ranges

    def where(self, address: int) -> str | None:
        for base, end, name in self.modules:
            if base <= address < end:
                return f"{name}+0x{address - base:x}"
        return None

    def read(self, address: int, length: int) -> bytes | None:
        for start, size, data in self.memory:
            if start <= address and address + length <= start + size:
                self.f.seek(data + address - start)
                return self.f.read(length)
        return None

    def exception(self):
        _size, rva = self.streams[6]
        (thread,) = self._read(rva, "<I")
        code, _flags, _record, address, count = self._read(rva + 8, "<IIQQI")
        params = self._read(rva + 40, "<15Q")[:count]
        _ctx_size, ctx_rva = self._read(rva + 160, "<II")
        rsp = self._read(ctx_rva + 0x98, "<Q")[0]
        return thread, code, address, params, rsp


def summarise(target: Path, frames: int) -> None:
    folder = target if target.is_dir() else target.parent
    dump_path = target if target.is_file() else folder / "Cyberpunk2077.dmp"
    print(f"== {folder.name}")
    message = folder / "stacktrace.txt"
    if message.exists():
        for line in message.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith(("Expression:", "Message:")):
                print("   " + line.strip())
    if not dump_path.exists():
        print("   (no minidump)")
        return
    dump = Minidump(dump_path)
    thread, code, address, params, rsp = dump.exception()
    print(f"   exception 0x{code:08x} at {dump.where(address) or hex(address)} (thread {thread}, "
          f"params {[hex(p) for p in params]})")
    if frames <= 0:
        return
    stack = dump.read(rsp, 0x4000) or dump.read(rsp, 0x1000)
    if not stack:
        print("   (stack memory not in the dump)")
        return
    shown = 0
    for offset in range(0, len(stack) - 8, 8):
        (value,) = struct.unpack_from("<Q", stack, offset)
        place = dump.where(value)
        if place and not place.startswith(QUIET_MODULES):
            print(f"   [rsp+0x{offset:x}] {place}")
            shown += 1
            if shown >= frames:
                break


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("targets", nargs="*", type=Path, help="report folders or .dmp files")
    parser.add_argument("--newest", type=int, default=5, help="with no targets: how many recent reports")
    parser.add_argument("--frames", type=int, default=12, help="stack candidates to print (0 = none)")
    args = parser.parse_args()
    targets = args.targets
    if not targets:
        queue = Path(os.environ.get("LOCALAPPDATA", "")) / "REDEngine" / "ReportQueue"
        if not queue.is_dir():
            print(f"No crash reports folder at %LOCALAPPDATA%\\REDEngine\\ReportQueue", file=sys.stderr)
            return 1
        targets = sorted((p for p in queue.iterdir() if p.is_dir()), key=lambda p: p.name)[-args.newest:]
    for target in targets:
        try:
            summarise(target, args.frames)
        except (OSError, ValueError, struct.error, KeyError) as error:
            print(f"== {target.name}\n   unreadable: {error}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
