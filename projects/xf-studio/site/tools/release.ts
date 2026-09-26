/**
 * Release-dependent home-page copy, driven only by site.config.json (`releaseStatus` + `release`).
 * While unreleased the site explains how releases will work and links nowhere near a download.
 * Switching to "prerelease" with a published tag renders the GitHub release link, the alpha warning,
 * checksum/attestation checks and SmartScreen guidance. Asset files are never linked directly.
 */
import { RELEASE_TAG, type SiteConfig } from "./config";

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The desktop release workflow's asset name for a tag (see authoring/desktop/release.ts). */
export const setupAssetName = (tag: string) => `XFStudio-${tag.slice(1)}-win-x64-setup.exe`;

export type ReleaseVars = { releaseStatement: string; downloadSection: string; releaseSummary: string };

const step = (num: string, title: string, body: string) =>
  `      <li class="step">\n        <span class="step-num">${num}</span>\n        <h3>${title}</h3>\n        <p>${body}</p>\n      </li>`;

function fromSource(blob: string) {
  return `    <div class="callout">
      <h3>Running it from source</h3>
      <p>Developers can run the Studio from the repository with Bun. Like the app, it builds the 3D preview from their own copy of the game the first time it runs, and nothing from the game is included. The <a href="${blob}/projects/xf-studio/authoring/README.md">authoring guide</a> describes the setup and its limits.</p>
    </div>`;
}

export function releaseVars(config: SiteConfig): ReleaseVars {
  const repo = config.repoUrl;
  const blob = `${repo}/blob/${config.repoBranch}`;
  if (config.releaseStatus === "unreleased") {
    return {
      releaseSummary: "No public release yet.",
      releaseStatement: `<div class="release-status" data-release-status>
        <span class="tag dev">In development</span>
        <p><strong>There is no public release or download yet.</strong> The Studio runs locally from source. The XF Eye Artistry mod it builds has been seen in game, but close-up rendering and finish looks are still being tuned. <a href="#download">How releases will work</a></p>
      </div>`,
      downloadSection: `<section class="section alt" id="download" aria-labelledby="download-title" data-download="unreleased">
  <div class="wrap">
    <header class="section-head">
      <p class="eyebrow"><span class="num">05</span>Download</p>
      <h2 id="download-title">Getting XF Studio</h2>
      <p class="lede"><strong>There is nothing to download yet.</strong> The first Windows desktop build is being prepared as an <em>alpha</em>: an early test version for people comfortable with rough edges. This is how it will be published.</p>
    </header>
    <ol class="steps">
${[
  step("01 · Where", "On GitHub", "Each version is listed on the project’s GitHub Releases page and marked as a pre-release while in alpha, with a plain-language changelog."),
  step("02 · Trust", "Checkable files", "Every file comes with its SHA-256 checksum and a GitHub build-provenance attestation, so you can confirm it is exactly what the project’s automated build produced from the public source."),
  step("03 · Install", "Unsigned at first", "The installer is not code-signed yet, so Windows SmartScreen warns before it runs. This section will show how to check the file first and then continue."),
  step("04 · Your game", "No game files included", "The flat UV editor, your library and export Check work without any game files. The 3D head preview is built from your own Cyberpunk 2077 files on your PC with WolvenKit, which XF Studio offers to download for you; building the XF Eye Artistry mod files uses the same two things."),
].join("\n")}
    </ol>
${fromSource(blob)}
  </div>
</section>`,
    };
  }

  const release = config.release!;
  const tag = escape(release.tag), title = escape(release.title);
  const setup = escape(setupAssetName(release.tag));
  const pre = config.releaseStatus === "prerelease";
  const stage = RELEASE_TAG.exec(release.tag)?.[1] ?? "";
  const stageName = stage === "rc" ? "release candidate" : stage;
  const releaseUrl = `${repo}/releases/tag/${encodeURIComponent(release.tag)}`;
  const warning = pre
    ? `<strong>${title} is an unsigned ${stageName} pre-release for testing on 64-bit Windows.</strong> It has no automatic updates. The XF Eye Artistry mod it builds has been seen in game, but close-up rendering and finish looks are still being tuned. Keep backups of anything you make.`
    : `<strong>${title} is an unsigned release for 64-bit Windows.</strong> It has no automatic updates. The XF Eye Artistry mod it builds has been seen in game, but close-up rendering and finish looks are still being tuned.`;
  return {
    releaseSummary: pre ? `An unsigned Windows ${stageName} is available for testing.` : "An unsigned Windows release is available.",
    releaseStatement: `<div class="release-status" data-release-status>
        <span class="tag ${pre ? "open" : "ok"}">${pre ? `${stageName[0].toUpperCase()}${stageName.slice(1)} pre-release` : "Released"}</span>
        <p>${warning} <a href="#download">How to get it</a></p>
      </div>`,
    downloadSection: `<section class="section alt" id="download" aria-labelledby="download-title" data-download="${config.releaseStatus}">
  <div class="wrap">
    <header class="section-head">
      <p class="eyebrow"><span class="num">05</span>Download</p>
      <h2 id="download-title">${pre ? `Try the ${stageName}` : "Get XF Studio"}</h2>
      <p class="lede">${warning}</p>
    </header>
    <div class="hero-actions download-actions">
      <a class="btn primary" href="${releaseUrl}">Get ${title} on GitHub</a>
      <a class="btn" href="${repo}/releases">All versions</a>
    </div>
    <ol class="steps">
${[
  step("01 · Download", "Get the setup program", `On the release page, download <code>${setup}</code>, a single setup program with nothing to extract, and the <code>SHA256SUMS.txt</code> beside it.`),
  step("02 · Check", "Confirm the file", `In PowerShell, run <code>(Get-FileHash .\\${setup} -Algorithm SHA256).Hash.ToLower()</code> and compare the result with <code>SHA256SUMS.txt</code>. With the GitHub CLI you can also run <code>gh attestation verify ${setup} --repo ${escape(new URL(repo).pathname.slice(1))}</code>.`),
  step("03 · Install", "Get past SmartScreen", "Run the setup program and choose <strong>Install</strong>; it installs for your Windows user only, without administrator rights, and adds a Start menu entry and an uninstaller. Because it is not code-signed yet, Windows may show <em>Windows protected your PC</em>: only if the checksum matched, choose <strong>More info</strong>, then <strong>Run anyway</strong>. If Smart App Control is on, Windows blocks unsigned apps and has no per-app override."),
  step("04 · First run", "Start designing", "Choose <strong>Start designing</strong> to go straight to the flat UV editor, your library and export Check; nothing from the game is included. The first time you open it, XF Studio builds the 3D head preview from your own Cyberpunk 2077 files. It finds your game folder and asks before downloading WolvenKit (45 MB, from its official release); WolvenKit needs Microsoft's free .NET 10 Runtime, and XF Studio links to Microsoft's installer if it's missing. Building the mod files uses the same two things."),
].join("\n")}
    </ol>
${fromSource(blob)}
  </div>
</section>`,
  };
}
