# XF Studio changelog

What changed in each XF Studio desktop release, newest first, written for the people using it. Each version has exactly two parts:

- **New and improved:** features and changes you can see, in plain language.
- **Fixes and under the hood:** bug fixes, performance, reliability and maintenance.

When a change lands, add a line to **Unreleased**. When a version is tagged, rename **Unreleased** to that version (for example `## 0.1.0-alpha.2`) and start a new, empty **Unreleased** above it. The release workflow copies the tagged version's section into the GitHub release and refuses to create the release if that section is missing or either part is empty. Say what was checked and how; never describe something as tested in the game until it has been.

## Unreleased

### New and improved

- **The 3D head preview, built from your own game.** Once XF Studio knows your Cyberpunk 2077 folder and WolvenKit CLI, it prepares the 3D head preview from your own game files the first time you open it: the head with its facial shapes, the eye-makeup area and the eyes, with the game's default skin and eye textures. On the test PC this took 11 to 16 seconds. It shows its progress, can be cancelled, changes nothing in your game, and the head appears without restarting. If XF Studio finds your game folder it offers to use it; if WolvenKit isn't set up it says so, and the UV editor keeps working. The eyes use the game's plain eye texture rather than your character's eye colour, and brows, lashes, hair and piercings aren't in this preview yet. Checked on one PC with game version 2.31 in a browser run of the app's own server; not yet tried in an installed copy of the app.
- The built-in eye plate is now cut from the head your game actually loads for the launch route in Local setup, including a head supplied or adjusted by an installed mod, so the makeup follows that head. If a head mod changes the head in a way XF Eye Artistry does not support yet, Build stops and names the mod; the message explains how to build anyway.

### Fixes and under the hood

- **Hair looks the same in light and dark mode and is closer to how dense it looks in game.** The page behind the 3D view used to show through the hair, so hair looked much lighter in light mode and darker in dark mode. The 3D view now draws its own background, and hair and lashes cover the scalp the way the game's hair shader works it out, which makes them a little denser. The jagged dark edge at the hair parting is gone. Checked by measuring the same views in both themes in a browser run of the app; not yet compared with the game.
- **Autosave rests when you do.** Your draft used to be saved again several times a second even when nothing had changed. It is now saved only after you change something.
- **Your work no longer stops autosaving when you have lots of Undo history.** A big collection with long Undo histories could outgrow the browser's storage, and autosave then stopped without telling you. Saved drafts now keep full Undo for the preset you are working on and the last few steps for the others, so they stay well within the limit. If storage still runs short, the status bar tells you and suggests saving to the library.
- **One damaged backup no longer loses your whole draft.** If an earlier draft kept for recovery, or a removed preset kept for Restore, was damaged, the Studio used to refuse to restore anything. It now drops just the damaged entry, restores the rest and tells you.
- **Undo stays accurate after very long editing sessions.** Once the 80-step Undo limit was reached, some steps were named wrongly and some did nothing. Each step now keeps its own name, and a slider you touch without changing no longer uses up a step.
- **Sliders and switches report problems clearly.** An out-of-range or rejected value from a panel control is now refused with a plain message and leaves your look unchanged.
- Build's independent check now unpacks and converts the finished archive itself instead of reusing the builder's own conversions, and checks the ArchiveXL file line by line, so fewer kinds of faulty output can slip through.
- **Build no longer needs Python.** Building your XF Eye Artistry mod files now needs only your game folder and WolvenKit CLI. The Python, NumPy and Pillow setup is gone, and so is the Python field in Local setup; a Python path you saved earlier is simply ignored. The new builder was checked offline on two test collections: every file inside the finished mod came out byte-for-byte identical to the previous builder's. This has not yet been tried in an installed copy of the app or in the game.

## 0.1.0-alpha.1

### New and improved

- **The first test version of XF Studio for Windows.** XF Studio is a desktop app for designing your own eye makeup for V. It installs for your Windows user, with its own window, icon and About page.
- **Design eye makeup in layers on the flat UV map.** Build complete looks from stacked layers (up to 32), each with its own colour, opacity, strength and finish. Draw each layer as a smooth or cornered curve, soften its edge (differently at different points if you like), bend it with warp controls, and move, rotate or scale the whole shape. Zoom and pan the map. Every change can be undone.
- **Keep your looks in a library.** Presets can be added, copied, renamed, reordered and removed. Your collection is saved in a local library with version history, your current draft comes back when you reopen the app, and looks can be exported and imported as files to back up or share.
- **Check which looks can become mod files.** Check lists every preset and layer that can be built into **XF Eye Artistry**, the eye-makeup mod the Studio makes for you, and names anything that would be left out, and why. It needs no game files.
- **What isn't in this alpha yet.** The **3D head preview** isn't available: a preview built from your own game files is planned. **Building the mod files** still needs a developer setup (the game, WolvenKit and build tools), so most people can design and Check but not Build yet. Anything that isn't ready says so where you would use it.
- **Licences in About.** About → Licences shows XF Studio's MIT licence and the notices for the software it includes.

### Fixes and under the hood

- Nothing from the game or other mods is included in the download. Every build is checked automatically so that only the app's own files, its licence and the third-party notices are packaged.
- Mod files the Studio builds are checked automatically but have **not** been tested in the game yet, and nothing is installed into the game or your mod manager for you.
- Matte, Satin and Metallic can be built. Shimmer, Glitter, Glossy and Colour-shifting are preview only: Check and Build leave those layers out and tell you which.
- The installer is not code-signed, so Windows SmartScreen may warn before it runs. Checksums and a build-provenance attestation are published with each release so you can check the file came from this project's automated build.
- Automatic updates are off. Download new versions from the releases page. Installing one version over another hasn't been tested yet, so export your looks as a backup first. Uninstalling with the default **App** option keeps your library and settings.
- Closing the window waits for your latest draft to be saved, and shows a message instead of closing if saving fails.
- XF Studio needs the Microsoft Edge WebView2 Runtime, which most Windows 10 and 11 PCs already have. If it's missing, the app says so and offers Microsoft's download page instead of showing an empty window, and any other startup failure shows **Try again** and **Copy diagnostics**.
