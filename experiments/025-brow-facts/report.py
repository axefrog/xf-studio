"""Print the README's per-set texture table and headline numbers from generated/*.json (experiment 025)."""
from __future__ import annotations

import json

from common import HERE

G = HERE / "generated"
# Creator style -> texture set (styles 01-08 use sets 01-08; 09-16 use 12-19); 14-16 have no creator option.
STYLE_OF_SET = {**{f"{i:02d}": f"{i:02d}" for i in range(1, 9)}, **{f"{i + 3:02d}": f"{i:02d}" for i in range(9, 17)}}


def main() -> None:
    t = json.loads((G / "textures.json").read_text())
    print("| Set | Style | `_d` FNV-1a64 | `_d` data SHA-256 | `_ds` FNV-1a64 | `_n` FNV-1a64 | `_n` data SHA-256 | Linear tone | Coverage outside both footprints |")
    print("|---|---|---|---|---|---|---|---|---|")
    for group in ("vanilla", "vanillaUnused"):
        for s, row in t[group].items():
            d, ds, n = row["d"], row.get("ds"), row["n"]
            style = STYLE_OF_SET.get(s, "none")
            if style in ("14", "15", "16"):
                style += " (no option)"
            print(f"| {s} | {style} | `{d['fnv1a64']}` | `{d['textureDataSha256'][:16]}…` | "
                  f"{('`' + ds['fnv1a64'] + '`') if ds else '–'} | `{n['fnv1a64']}` | `{n['textureDataSha256'][:16]}…` | "
                  f"{d['rgbLinear_coverageWeighted_mean']} | {d['coverageOutside_intersection_flipped']:.2%} |")
    print()
    for key, row in t["mods"].items():
        print(key, {k: {x: row[k][x] for x in ("header", "mipCount", "compression", "rawFormat", "isGamma", "bytes", "fnv1a64")} for k in ("d", "ds", "n")})


if __name__ == "__main__":
    main()
