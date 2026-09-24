# Partial mod export checkpoint — 24 September 2026

**Status (25 September 2026): current policy.** The finish filter below is still what Check and Build use. Exportable finishes are Matte, Satin (internal `regular`) and Metallic (`SUPPORTED_FLAT_FINISHES` in `projects/xf-studio/authoring/src/preset-compiler.ts`); Shimmer, Glitter, Glossy and Colour-shifting layers are omitted with warnings. Check/Build — in the browser Studio, the local CLI and the installed desktop trial — produce independently verified **private candidates**. A diagnostic MO2 profile has the four-preset (Matte/Metallic/Off) candidate staged; a five-preset candidate adding a Satin control is built but not staged. **No in-game test has happened yet**; Nathan runs it from the [prepared session card](first-makeup-runtime-preflight-2026-09-25.md). The maintained end-to-end description is [the Studio-to-mod pipeline guide](studio-to-mod-pipeline.md). The evidence below is the original 24 September verification of the filter.

The package filter removes unsupported **active** finish layers from a package-only collection copy. It separately reports a whole-preset omission when no active exportable layer remains. Check and Build use the same filter; the normal flat compiler keeps its strict unsupported-finish guard for other callers. An invalid collection, an empty filtered package, a failed compiler, or a failed independent verifier still prevents promotion.

Verification used the checked-in Experiment 005 four-preset collection. In an ignored local source copy, the first preset's single active layer was changed to Glitter, leaving three exportable presets. The original fixture and SQLite data were untouched. A real local build using the private plate resource, WolvenKit and game files completed Experiment 005 conversion and independent verification, then created an ignored private `dist` candidate. Its manifest records:

| Field | Observed value |
|---|---|
| Original / packaged presets | 4 / 3 |
| Omissions | `Petal wash` Glitter layer in `Verification — metallic copy`; the now-empty whole preset |
| Verified unpacked resources | 13 = 4 shared resources + 3 textures × 3 presets |
| Original source SHA-256 | `526b71b521d687d10f41339c61cfd10b0b1a3226fe40bfe3af04e2a31777cce2` |
| Filtered snapshot SHA-256 | `096728c08a68939d9e16141721dafc910c1da643000ccfe8613e54421bc79c26` |
| Verified archive SHA-256 | `62a6fcd821c0feb173b6bda3681acff1d57f3b4152c85722163b3e5892d27de9` |
| Installation / game rendering | `false` / `false` |

A direct `--check` of that same ignored source returned the same retained preset identities, omissions and filtered snapshot hash as the build manifest. The original source hash also matched its manifest entry. The result is an offline-verified package candidate, not an observed game rendering. No package was installed or distributed.

The actual localhost package handler was also exercised with an equivalent unsaved in-memory draft and the same local build inputs. Its Build request returned HTTP 200 only after the verifier and manifest checks, with three packaged presets, both omission records, and `installed: false` / `gameRenderingVerified: false`. The two runs used different original JSON serialization and generated different archive hashes; no byte-for-byte archive reproducibility claim follows from this check.

Focused package/server/collection-service tests and TypeScript typecheck passed. The [pipeline diagrams](studio-to-mod-pipeline.md#maintenance-and-visual-review-record) were rendered with Mermaid CLI 11.17.0 and inspected at original and 800px widths; they now show partial warnings, refusal only for no eligible preset, the verified candidate and the untested game boundary.
