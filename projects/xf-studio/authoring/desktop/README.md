# XF Studio Electrobun Windows feasibility slice

24 September 2026. This is a **development-only desktop host trial**, not an installer, update feed or releasable Studio. It uses the committed Opus UI entry from `cec7089`, Electrobun 2.0.1, Bun main and Windows WebView2. The independent `authoring/bun start` entry is unchanged. Follow the [desktop architecture](../../../../research/authoring/desktop-packaging.md) before expanding this host.

## Build and launch

From this directory, after `bun install --frozen-lockfile` in `authoring/` and here:

```powershell
bun run check
bun test tests
bun run build:dev
bun run run:dev
```

`prepare-static.ts` copies only `index.html`, `studio.css`, `about.css`, `desktop-bootstrap.js` and the browser bundles for `studio-main.ts` and `raster-worker.ts`. Electrobun copies that allowlisted tree to `Resources/app/views/studio`; Bun main reads it from `PATHS.VIEWS_FOLDER`. The builder never copies `public/assets`, SQLite, credentials or game/mod files. `build/dev-win-x64/` and generated `static/` are ignored. The script fails if the shared Studio script tag changes, forcing review of this bootstrap.

Main creates an ephemeral `127.0.0.1` server. An unguessable startup token establishes an HttpOnly, SameSite cookie. Every later request needs the cookie; writes need a matching `Origin`, or WebView2's browser-controlled `Sec-Fetch-Site: same-origin` plus a same-origin referrer. The latter is needed because this WebView2 build omitted `Origin` on same-origin JSON `fetch`; the adapter adds it **only after** validating those signals so existing SQLite handlers can keep their contract. No arbitrary command, SQL or filesystem action is offered to the view. `GET /api/desktop/capabilities` exposes a small typed, read-only host record: exact packaged version/channel, WebView2, SQLite library support, asset readiness and absent package/install/update capabilities. A development-only smoke report checks UI mount, WebGL2 and module-worker construction. `/api/package` returns a clear 503 rather than calling the localhost server's source-tree-dependent toolchain.

`Utils.paths.userData` contains `library.sqlite`, `verification.sqlite` and an optional **private** `preview-assets/` directory. The trial has no asset discovery/intake UI or provenance validator. With no `preview-assets/head.glb`, its bootstrap shows a clear missing-input state instead of trying to parse a 404 body as GLB. To exercise the actual editor in a private test, place an already prepared local preview asset tree in that user-data directory, then restart. The trial does not source assets from the HQ checkout at runtime. Do not commit or distribute any private input. The About control is desktop-only and reads the packaged version from `Resources/version.json` through the host capability; it reports that updates are unavailable.

## Windows evidence

`bun run check`: passed. `bun test tests`: 2 passed, 17 assertions. The full `authoring/bun test` passed 353/353 when private inputs were available locally; without those ignored assets, its five real-geometry tests fail with explicit missing-file errors. `authoring/bun run check` and `bun run build` passed. `bun run build:dev`: emitted `build/dev-win-x64/XFStudioDesktopSpike-dev`; Hutch reported `embedded Windows icon in launcher.exe` and `bun.exe`. The bundle contained only the six listed browser files plus runtime/main resources; it had no `assets/` tree. `bun run run:dev` launched a `XF Studio` WebView2 window. With a private local preview tree, the browser reached the packaged Studio bundle and `/assets/head.glb`; the smoke result was `interactive; WebGL2=true; Worker=true` at 3 and 12 seconds. SQLite databases appeared under `%LOCALAPPDATA%/dev.axefrog.xf-studio-spike/dev/`, separate from the bundle. Holding `head.glb` aside for a clean-machine-like test produced `missing-assets; WebGL2=true; Worker=true` at both checks; the private file was restored. The focused transport test rejects unauthenticated and cross-origin requests, serves the worker, verifies the missing asset 404 and stores a SQLite collection revision in a supplied data root.

These are startup and API proofs. No screenshot was captured: this task's computer-use bridge did not expose native app windows. Editing gestures, revision persistence after restart, real raster-worker messages, 4K memory/frame cadence, GPU fallback, external build tools and WebView2-missing bootstrap still need hands-on acceptance. The only worker proof here is that the packaged module worker can be constructed. The first pre-bootstrap run without a private head asset threw a GLB parsing error; the current bootstrap now prevents that path.

The pinned npm bootstrap repeatedly timed out fetching its paired Hutch artifact index and fell back to installed compatible Hutch 0.24.3. Build and launch worked, but a release build must use a verified paired toolchain and a clean Windows machine. The `dev` bundle is neither a signed installer nor an update candidate.

## Icon candidate and install behavior

`icon/icon.svg` is the original vector master: a graphite bevel matching the [Opus style guide](../public/style-guide.html), signal-yellow X and cyan edit knot. `python icon/make_icon.py` uses Pillow 12.3.0 to generate transparent 16/24/32/48/64/128/256 PNGs and a 16/32/48/256 multi-resolution `icon.ico`. The 256px and enlarged 16px renderings were visually inspected. `build.win.icon` points to the ICO. The final production icon still needs Windows taskbar, title bar, Start menu and light/dark desktop review; this is a reviewable candidate.

Electrobun's [Windows distribution guide](https://framework.blackboard.sh/electrobun/guides/bundling-and-distribution/) documents a setup artifact but does not specify the exact app executable path. Its [uninstall guide](https://framework.blackboard.sh/electrobun/guides/uninstalling/) places the standalone manager under `%LOCALAPPDATA%/<identifier>/<channel>/uninstall.exe`; [path documentation](https://framework.blackboard.sh/electrobun/apis/paths/) locates writable data under `%LOCALAPPDATA%/<identifier>/<channel>/`. The documented uninstall default **App** preserves that data; **App and Data** explicitly removes the app-scoped data/cache/log root. We did not build or run a release installer, so exact app-bit placement, update replacement and both uninstall choices remain unmeasured. Verify them with two signed test versions before publication. Keep the release identifier/channel stable so user data is not stranded.

Next gates are the production asset intake and provenance check, shell-aware Check/Build toolchain that works outside HQ, complete library/edit/Undo/worker acceptance on a clean install, WebView2 runtime absence handling, installed-path and update/uninstall tests, notices/licensing, signing and a separate game session. The existing private plate and finish-export gates still apply. Do not treat an offline archive as game-tested.
