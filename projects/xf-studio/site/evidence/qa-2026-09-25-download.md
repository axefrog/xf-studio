# Site QA: download section and credits sync, 25 September 2026

## Changes reviewed

- **New section 05, “Download” (`#download`, nav item Download):** rendered by `tools/release.ts` from `site.config.json`.
  - `releaseStatus: "unreleased"` (current): “There is nothing to download yet”, four cards explaining how alphas will be published (GitHub Releases pre-releases with a changelog, SHA-256 and build-provenance attestation, unsigned with a SmartScreen warning, no game files included), and a “Running it from source” callout that replaces the status section's old “Can I try it?” box. No release link is rendered.
  - `releaseStatus: "prerelease"` with `release.tag`/`title` (reviewed from a local build, not deployed): alpha warning, **Get XF Studio 0.1.0 alpha 1 on GitHub** (tag page) and **All versions** buttons, then download, checksum (`Get-FileHash`, `gh attestation verify`), SmartScreen (**More info → Run anyway** only after a matching checksum; Smart App Control has no override) and first-run steps.
- **Hero statement and meta description** come from the same config. The in-game mod is named **XF Eye Artistry** here and in the eye-makeup sections.
- **Sections 06–08** renumbered, with alternating backgrounds kept.
- **Credits page** rewritten to match the new public `docs/community-credits.md`: game and frameworks, tools and documentation, libraries and runtimes, mods, research and references, open attributions. It no longer lists a first-party predecessor entry or links a “learning record”.
- **Guards:** game-test phrases are now rejected in every release state. Release-marketing phrases are rejected only while unreleased. The home page needs exactly one `#download` section whose `data-download` matches `releaseStatus`. Once released, release links may point only at `/releases` or the configured tag page; `/releases/latest` is refused because it skips pre-releases. Config validation ties a pre-release tag suffix to `prerelease`.

## Results

- `bun run verify` passes: build, check and 15 tests.
- `bun run qa` passes for the default (unreleased) build and a local prerelease build: 24 page scenarios each, minimum text contrast 4.67:1.
- Screenshots were checked at desktop and mobile width in light and dark. The first prerelease render had the buttons touching the step cards; a `.download-actions` bottom margin fixed it, and the result was re-checked. Screenshots stay in the ignored `.evidence/`.
