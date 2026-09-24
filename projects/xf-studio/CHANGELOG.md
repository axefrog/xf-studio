# XF Studio changelog

What changed in each XF Studio desktop release, newest first, written for the people using it. Each version has exactly two parts:

- **New and improved:** features and changes you can see, in plain language.
- **Fixes and under the hood:** bug fixes, performance, reliability and maintenance.

When a change lands, add a line to **Unreleased**. When a version is tagged, rename **Unreleased** to that version (for example `## 0.1.0-alpha.2`) and start a new, empty **Unreleased** above it. The release workflow copies the tagged version's section into the GitHub release and refuses to create the release if that section is missing or either part is empty. Say what was checked and how; never describe something as tested in the game until it has been.

## Unreleased

### New and improved

### Fixes and under the hood

## 0.1.0-alpha.1

### New and improved

- **First desktop preview for Windows.** XF Studio now installs as an ordinary app for your Windows user, with its own window, icon and About page showing the exact version and build.
- **Design eye makeup in layers.** Build complete looks from any number of layers (up to 32 in the preview), each with its own colour, strength and finish. Presets can be added, copied, renamed, reordered and removed.
- **Precise shape editing.** Draw each layer as a smooth or cornered curve, adjust the softness of its edge (including differently at different points), bend it with warp fields, and move, rotate or scale the whole shape. Zoom and pan the flat UV view. Every gesture can be undone.
- **Works without any game files.** On first launch you can skip setup and go straight to the flat UV editor, your library and the export check. Add prepared preview resources from your own copy of the game later to switch on the 3D head.
- **A 3D preview head.** Point the app at five preview files prepared from your own copy of the game to see your makeup on the head, alongside the flat UV view.
- **Your work is kept.** Presets are saved in a local library with version history, the current draft is restored after you close and reopen the app, and looks can be exported and imported as portable files.
- **Check before you build.** Check tells you which layers can be turned into mod files and which will be left out, and why. With your own game, WolvenKit and Python set up, Build turns your looks into your own copy of **XF Eye Artistry**, the eye-makeup mod, with Matte, Satin and Metallic layers independently verified before the files are kept.

### Fixes and under the hood

- Nothing from the game or other mods is included in the download. The build is checked automatically so that only the app's own files can be packaged.
- The XF Eye Artistry mod files the Studio builds are verified offline only. They have **not** been tested in the game yet, and nothing is installed into the game or your mod manager for you.
- Shimmer, Glitter, Glossy and Colour-shifting finishes are preview experiments. Build leaves them out and says so.
- The installer is not code-signed, so Windows SmartScreen may warn before it runs. Checksums and a build-provenance attestation are published with each release so you can check the file came from this project's automated build.
- The desktop preview accepts only the core head files so far. The idle animation, saved-V import, hair, brows, lashes and piercings still need the development version run from source.
- Automatic updates are switched off. Installing one version over another has not been tested yet, so export your looks as a backup first. Uninstalling with the default **App** option keeps your library and settings.
- Closing the window waits for your latest draft to be saved, and shows a message instead of closing if saving fails.
