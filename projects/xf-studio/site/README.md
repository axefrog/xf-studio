# XF Studio public site

The public face of XF Studio: a small static site describing the product, its verified current capabilities, honest status, future directions, documentation and community credits. It presents XF Studio as a customisation studio for Cyberpunk 2077 that starts with the user's own V and may grow into other areas of the game, with eye makeup as its first working feature. It deploys to GitHub Pages at **https://axefrog.github.io/xf-studio/** once Pages is enabled (see [Repository settings](#repository-settings-one-time)).

The public site is independent of the Studio app at runtime and has its own `package.json`, tests and ignore rules. Its design follows the Studio's visual language. The [authoritative interface style guide](https://axefrog.github.io/xf-studio/style-guide.html) is published as a separate, directly viewable reference from the [generated local source](../authoring/public/style-guide.html); it is not a marketing page. The deployment workflow also watches the guide and its design sources. The site check rebuilds the guide and rejects stale source or a published copy that differs from it. Pages must be enabled before the public link works.

## Commands

Run from this folder with Bun 1.4.2 (the repository's toolchain version):

| Command | What it does |
|---|---|
| `bun run build` | Renders `src/` to `dist/` (ignored). `SITE_BASE_URL` overrides the base URL; CI sets it from `actions/configure-pages`. |
| `bun run check` | Static checks over `dist/` (structure, accessibility basics, links, content policy, release-claim and no-dates guards), plus exact and fresh style-guide verification. |
| `bun test` | Build/check unit tests, including negative tests proving each guard fires. |
| `bun run verify` | Build, check and test: the same gates CI runs. |
| `bun run preview` | Build, then serve at `http://127.0.0.1:4400/xf-studio/` with the Pages base path and 404 behaviour. |
| `bun run qa` | Build, then browser QA in headless Chrome (local; set `CHROME` if it is not in a standard location). |

## Layout

| Path | Purpose |
|---|---|
| `site.config.json` | Site name, base URL, repository URL/branch, author, `statusReviewed` date, `releaseStatus`, navigation and size budgets. |
| `src/layout.html` | Shared head, header, theme switch and footer. |
| `src/pages/*.html` | One file per page, starting with a `<!--page {json} -->` header. |
| `src/assets/` | `site.css`, `theme.js` and `favicon.svg`. All original; no fonts or raster images. |
| `../authoring/public/style-guide.html` | Generated Studio reference copied byte-for-byte to `dist/style-guide.html`; design source changes require regeneration. |
| `tools/build.ts`, `check.ts`, `serve.ts`, `qa.ts`, `cdp.ts`, `config.ts` | Build, checks, local server and browser QA. |
| `tests/site.test.ts` | Unit tests. |
| `evidence/` | Concise, committed QA records. Screenshots stay in ignored `.evidence/`. |

## Updating content

**Pages.** Edit `src/pages/<name>.html`. The header needs `title` and `description`; optional `nav` (the nav item id marked current), `noindex` and `absoluteLinks` (only for `404.html`, which Pages serves at any depth). Available placeholders: `{{root}}` (asset/page prefix), `{{home}}` (overview link), `{{repo}}`, `{{blob}}` and `{{tree}}` (repository URLs on the configured branch), `{{statusReviewed}}`, `{{statusReviewedIso}}`, `{{authorName}}`, `{{authorUrl}}` and `{{siteName}}`. An unknown placeholder fails the build. A new page needs no registration; add a `nav` entry in `site.config.json` if it belongs in the header.

**Status and capabilities.** Before changing product wording, check it against [docs/status.md](../../../docs/status.md), the [project README](../README.md) and the [authoring guide](../authoring/README.md). Then set `statusReviewed` in `site.config.json` to the review date; the page shows it. Rules:

- Describe only capabilities that are implemented and verified. Say *works locally*, *verified offline* or *preview study*, and keep previewed, packaged, verified and game-tested as separate claims.
- Label research and in-development work, and never state or imply a release, download or in-game test that has not happened. While `releaseStatus` is `unreleased`, the home page must keep its visible `data-release-status` statement, and the check rejects links to releases or packages and phrases such as “download now” or “tested in game” (`UNRELEASED_CLAIMS` in `tools/check.ts`). When a real release exists, change `releaseStatus` together with the wording.
- **Positioning.** XF Studio is a studio for customising many parts of Cyberpunk 2077, starting with the user's own V and potentially expanding into other areas of the game. Eye makeup is its first working feature and today's focus, not the product's definition or limit, so keep feature-specific wording out of the page title and hero heading. Present every other area as a direction under discussion, never as a feature, and label eye-makeup-specific sections, numbers and illustrations as such. A unit test pins the title, hero heading and description to this positioning; change it only with a deliberate positioning decision.
- Future directions carry no dates or schedule promises, and each later area requires discussion before it is built. Mark vision and direction sections with `data-future`. The check rejects years, months, quarters and schedule words such as “soon”, “upcoming” or “will ship” inside them (`FUTURE_SCHEDULE`), “coming soon” anywhere while unreleased, and a home page with no `data-future` section.
- Repository links use `{{blob}}/<path>`. The check verifies that every such target is a **tracked** file, so ignored local files cannot slip in as links.

**Credits.** `credits.html` summarises [docs/community-credits.md](../../../docs/community-credits.md), which remains authoritative. When that record gains or corrects an entry, update the public summary in the same checkpoint: copy names exactly as evidenced, never guess authorship, keep the kind of use explicit (learning, dependency, private local preview) and keep unresolved attributions visible. The site's own design and code came from the Studio style guide and official GitHub documentation, not from community sources.

## Design

The visual rules follow the Studio style guide: graphite surfaces; signal yellow only for commitment and focus (primary button, brand mark, current nav item, focus ring); cyan for live or selected state; the bevelled corner as the only ornament; and no neon glow, glitch, scanlines or fake HUD chrome. The illustration stage uses the same neutral surround in both themes, so pigment colours read the same. Fonts are system fonts: Bahnschrift display capitals only for short labels, Segoe UI Variable for text and Cascadia Mono for figures, with cross-platform fallbacks.

The theme follows the system by default. The header's System/Light/Dark switch stores an override in `localStorage` (`xf-studio-site:theme`), and System clears it. Without JavaScript, the page follows the system scheme and the switch stays hidden. Tokens use `light-dark()`; older browsers fall back to system colours.

A strict meta Content-Security-Policy allows only same-origin styles, scripts and images. Inline `style` attributes, `<style>` elements, inline scripts and `on*` handlers are blocked, and the check rejects them. Keep styling in `site.css`.

## Content policy

The site may publish only `.html`, `.css`, `.js`, `.svg`, `.xml` and `.txt` (`ALLOWED_EXTENSIONS`), within the byte budgets in `site.config.json`. The self-contained style guide has a separate 384 KiB file budget and intentionally uses inline CSS, live demo script and specimen styles. The public site's own pages retain their stricter Content-Security-Policy and page checks. Guide publication requires a byte-exact copy of the generated Studio source and a fresh rebuild from its design inputs.

- No extracted game or mod assets, game-derived renders, Studio viewport screenshots (the preview head is game-derived), personal saves, libraries, inventories or credentials.
- Visuals are original CSS/SVG and are labelled as illustrations, not renders.
- Adding any other file type (for example a rights-clear photo or an Open Graph image) needs a reviewed change to `ALLOWED_EXTENSIONS`, a provenance note here, and a credit entry when community work is involved.
- The check also rejects local machine paths, `file://` URLs, localhost links, remote CSS/JS loads and links to downloadable package or asset types.

## Visual QA

Run `bun run qa` after any visual or content change. It serves `dist/` under the base path and, for each page at desktop (1440), tablet (834), mobile (390) and narrow (320) widths in light and dark, checks for:

- console, CSP and network errors;
- horizontal overflow;
- WCAG text contrast against composited backgrounds;
- targets smaller than 24 px;
- persistence of the theme override;
- the no-JavaScript fallback;
- skip-link focus.

It also captures a forced-colours view. Screenshots and `summary.json` go to `.evidence/qa-<date>/` (ignored). The numbers catch regressions; they are not a substitute for looking at the screenshots at normal and enlarged size. Record a short dated summary in `evidence/`.

## Deployment

`.github/workflows/pages.yml` (repository root):

- **Triggers.** Pushes to `main` that touch this folder, the generated style guide, its design CSS/source or the workflow; pull requests that touch them (build, test and check only); and manual runs from the Actions tab (**Run workflow**). Manual runs on another branch build but do not deploy.
- **Build job.** Full shallow checkout (needed to validate repository links), Bun 1.4.2, `bun test`, build with the base URL from `actions/configure-pages`, `bun tools/check.ts`, then `actions/upload-pages-artifact` of `dist/`.
- **Deploy job.** `actions/deploy-pages` into the `github-pages` environment, with only `pages: write` and `id-token: write`. Deployments are serialised and never cancelled mid-run.
- **Actions.** Checked on 24 September 2026: `actions/checkout@v7`, `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5` and `actions/deploy-pages@v5` (GitHub-owned, major tags), plus `oven-sh/setup-bun` pinned by commit SHA (v2.2.0). The official custom-workflow guide showed older majors on that date; the release pages are authoritative. When updating, read each action's release notes, keep `setup-bun` SHA-pinned, and keep `bun-version` in step with [docs/toolchain.md](../../../docs/toolchain.md).

The workflow never enables Pages or changes repository settings. It does not use `configure-pages` `enablement`, and it needs no secrets.

### Repository settings (one-time)

These are manual owner decisions, not performed by any script here:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.** Do not choose “Deploy from a branch”. Until this is set, `configure-pages` fails on `main` with a “Get Pages site failed” error, while pull-request checks still pass.
2. **Settings → Environments → `github-pages`:** GitHub creates this environment on first use. Restrict deployment branches to `main`, as GitHub recommends.
3. After merging to `main`, deploy by pushing a site change or running the workflow manually. The job summary links to the published URL.

**Visibility and plan requirements** ([What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)):

- Pages is available for **public** repositories on GitHub Free, and for public **and private** repositories on GitHub Pro, Team, Enterprise Cloud and Enterprise Server.
- A Pages site is **publicly accessible even when its repository is private**. Private access control exists only for some Enterprise Cloud setups.
- Everything in `dist/` is therefore public. This is one reason for the content policy.

**State checked 24 September 2026** (read-only `gh api`): `axefrog/xf-studio` reported `visibility: public` and no Pages site (`GET /repos/axefrog/xf-studio/pages` → 404). If the repository becomes private, the site can still publish on a paid plan, but its repository links (documentation, source, credits record) will return 404 for visitors. The site would then need public copies of that information or different links.

**Custom domain.** Configure it in Settings → Pages; with Actions deployments a `CNAME` file is not used. The base URL comes from `configure-pages` automatically, so canonical URLs and the sitemap follow. Also update `baseUrl` in `site.config.json` for local builds. A `robots.txt` is honoured only at a domain root, which is why none is generated for the project-site path.

**Limits** ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)):

- published sites up to 1 GB;
- deployments time out after 10 minutes;
- soft limits of 100 GB bandwidth per month and 10 builds per hour.

Pages must not be used for commercial transactions, SaaS or sensitive data. The site uses about 86 KiB.

**Troubleshooting.**

| Symptom | Likely cause |
|---|---|
| `configure-pages` fails | Pages is not enabled, or its source is not GitHub Actions. |
| Deploy rejected by environment rules | The run is not from `main`, or the `github-pages` branch rule excludes it. |
| Check fails on a repository link | The linked file is not tracked on the current commit, e.g. still only in a branch or ignored. |
| Styling looks stale | Assets carry content-hash queries, so reload once. Pages caches HTML for about 10 minutes. |
