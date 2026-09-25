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

- **The first test version of XF Studio for Windows.** XF Studio is a desktop app for customising Cyberpunk 2077, starting with your own V. Eye makeup is the first supported feature. It installs for your Windows user, with its own window, icon and About page.
- **Design eye makeup in layers on the flat UV map.** Build complete looks from stacked layers (up to 32), each with its own colour, opacity, strength and finish. Draw each layer as a smooth or cornered curve, soften its edge (differently at different points if you like), bend it with warp controls, and move, rotate or scale the whole shape. Zoom and pan the map. Every change can be undone.
- **The 3D head preview, built from your own game.** Once XF Studio knows your Cyberpunk 2077 folder and WolvenKit CLI, it prepares the 3D head preview from your own game files the first time you open it: the head with its facial shapes, the eye-makeup area and the eyes, with the game's default skin and eye textures. On the test PC this took 11 to 16 seconds. It shows its progress, can be cancelled, changes nothing in your game, and the head appears without restarting. If XF Studio finds your game folder it offers to use it; if WolvenKit isn't set up it says so, and the UV editor keeps working. The eyes use the game's plain eye texture rather than your character's eye colour, and brows, lashes, hair and piercings aren't in this preview yet. Checked on one PC with game version 2.31 in a browser run of the app's own server; not yet tried in an installed copy of the app.
- **Keep your looks in a library.** Presets can be added, copied, renamed, reordered and removed. Your collection is saved in a local library with version history, your current draft comes back when you reopen the app, and looks can be exported and imported as files to back up or share.
- **Check which looks can become mod files.** Check lists every preset and layer that can be built into **XF Eye Artistry**, the eye-makeup mod the Studio makes for you, and names anything that would be left out, and why. It needs no game files.
- **What you set up yourself for now.** The 3D head preview and **Build** both need your game folder and the WolvenKit CLI, set up under **About → Build setup**; XF Studio finds your game folder when it can. No Python is needed. Anything that isn't ready says so where you would use it.
- **Licences in About.** About → Licences shows XF Studio's MIT licence and the notices for the software it includes.

### Fixes and under the hood

- Nothing from the game or other mods is included in the download. Every build is checked automatically so that only the app's own files, its licence and the third-party notices are packaged.
- Mod files the Studio builds are checked automatically but have **not** been tested in the game yet, and nothing is installed into the game or your mod manager for you.
- Matte, Satin and Metallic can be built. Shimmer, Glitter, Glossy and Colour-shifting are preview only: Check and Build leave those layers out and tell you which.
- The installer is not code-signed, so Windows SmartScreen may warn before it runs. Checksums and a build-provenance attestation are published with each release so you can check the file came from this project's automated build.
- Automatic updates are off. Download new versions from the releases page. Installing one version over another hasn't been tested yet, so export your looks as a backup first. Uninstalling with the default **App** option keeps your library and settings.
- **Autosave you can rely on.** Your draft is saved only after you change something, keeps full Undo for the preset you are working on and the last few steps for the others, and a damaged backup entry no longer stops the rest of your draft from coming back. If storage runs short, the status bar says so.
- Closing the window waits for your latest draft to be saved, and shows a message instead of closing if saving fails.
- XF Studio needs the Microsoft Edge WebView2 Runtime, which most Windows PCs already have. If it's missing, XF Studio offers to install it for you with one click, using Microsoft's own installer, and then opens. Any other startup failure shows **Try again** and **Copy diagnostics** instead of an empty window.
