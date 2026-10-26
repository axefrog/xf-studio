# Electrobun's setup program: what it does around an install

**Maturity: Draft.** What Electrobun 2.0.2's Windows setup stub does when an install finishes and when it meets a running app, and how XF Studio's scripted refresh of the installed app works around it. Source read at the v2.0.2 tag of [Electrobun](https://github.com/blackboardsh/electrobun) (`package/src/extractor/main.zig`, `package/src/…/Utils.ts` as shipped in the Hutch devkit); the refresh is exercised by unit tests with a fake setup and one WMI experiment, not yet by a real installed refresh. Grades: **[source]** read in Electrobun's source; **[offline]** exercised by our tests or tool runs; **[unverified]** reported but not confirmed by us.

## 1. It always opens the app it installed

| Fact | Grade |
|---|---|
| Both install paths, `extractAdjacentArchive` (payload beside the setup, the one XF Studio ships) and `extractFromSelf` (legacy embedded payload), end with `if (installed) launchInstalledApp(allocator, app_dir);` after reporting success. The only condition is that the install succeeded; neither call checks an environment variable or a command-line flag. | [source] |
| `launchInstalledApp` spawns `bin\launcher.exe` with `std.process.spawn`, passing no environment map (the child inherits the setup's environment), no working folder and ignored standard streams, and does not wait for it. The only early return is a missing launcher path. | [source] |
| So a silent setup (`/VERYSILENT` on XF Studio's Inno wrapper, which runs Electrobun's setup) still opens the app, which outlives the setup and its wrapper. There is no switch to stop it. | [source] |

## 2. What it does to a running app

| Fact | Grade |
|---|---|
| `terminateWindowsAppProcesses(allocator, app_dir)` runs PowerShell that finds every `Win32_Process` whose `ExecutablePath` is under the app folder (case-insensitive prefix) and calls `Stop-Process -Force` on it, errors suppressed, then sleeps 500 ms. `uninstallWindows` calls it and, if the PowerShell call itself fails, prints "Warning: Could not stop running app processes" and carries on. | [source] |
| The installer, `extractAndInstall`, takes an install lock (`acquireWindowsInstallLock`) and, in the code we read, does not stop the app: files in use make the swap fail with `AccessDenied`, `FileBusy` or `PermissionDenied` (`installErrorMessage`: "still running or its files are locked") and roll back. An independent review of the source reports that the setup also terminates running app processes at the install path (near line 5105 of `main.zig`); we have not found that call from the install path ourselves. Treat the app's processes as at risk during any install. | [source] for the uninstaller and the failure message; **[unverified]** for termination during install |
| The extracted archive keeps its one top folder (`XFStudio-<channel>/`); on Windows that folder's contents are copied into `%LOCALAPPDATA%\<identifier>\<channel>\app`, so the installed files are the archive's paths minus the first component. A listing of the build's archive checked complete against a real extraction of it. | [source], [offline] |
| An installed app's `Utils.paths.userData` is `%LOCALAPPDATA%\<identifier>\<channel>`: it joins the app-data folder (`%LOCALAPPDATA%`), the `version.json` identifier and the install root's folder name, which for an install at `<LOCALAPPDATA>\<identifier>\<channel>\app` is the channel (`resolveInstalledRootNameForPaths`). | [source] |

## 3. What the app's own start-up does before our check

`main.ts` ends a launch made with `XFS_INSTALL_REFRESH=1` at its top, but the `electrobun/main` import has already run: per an independent review it loads native libraries, patches `process.exit` and starts a 16 ms timer, with no write of the app's own (no log, data folder, lock, window or server). **[unverified]** by us; the guard therefore sits where it does, before anything the app owns.

## 4. How XF Studio handles it

- The app exits at once, code 0, when the environment holds `XFS_INSTALL_REFRESH=1` (`installRefreshRequested` in `startup-watchdog.ts`, tested in `desktop/tests/startup.test.ts`). The variable reaches it only through the setup's inherited environment. **[offline]**
- `desktop/tools/refresh-installed.ps1` does the building and logging; one unpackaged helper (`tools/refresh-helper.py`, started through WMI as `pythonw.exe`) does everything that touches the installed app:
  - **Exclusion.** It takes the app's own single-instance mutex first (named by `tools/installed-instance-name.ts` from `single-instance.ts`, for `%LOCALAPPDATA%\<identifier>\<channel>`). A held mutex means the app is running, so nothing is touched, and while the helper holds it a normal launch ends quietly. A mutex held by an ordinary process of the interactive session was seen as held by the WMI-started helper. **[offline]**
  - **Containment.** It joins a kill-on-close Job Object before starting the setup, so the setup, the app it opens and their children end with the helper however it ends; a setup that outlasts its deadline was stopped and left nothing running. **[offline]** Joining the job worked from a WMI-started process and from under the memory guard's own job.
  - **Completeness.** Success is decided by the installed files (every file of the build's update archive with its listed size, `version.json` naming the build, `bin\launcher.exe`, the uninstall entry), never by the setup's exit code. **[offline]**
- A Store (MSIX) app such as the Claude desktop app virtualises the registry as well as AppData: a key written from inside it is invisible to an unpackaged process (seen: a `reg add` from an agent's shell was not found by the WMI-started helper). Installed state is therefore only ever read from the helper. **[offline]**

## Open questions

- Whether the setup terminates running app processes during install (section 2); read the call sites of `terminateWindowsAppProcesses` in `main.zig` at the tag.
- Whether a later Electrobun release adds a switch to skip the launch (check the setup's changelog when updating `electrobun`). The environment switch can then be dropped.
- A real installed refresh over a kept library, with timings, has not been run yet.
