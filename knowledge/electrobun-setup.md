# Electrobun's setup program: what it does after installing

**Maturity: Draft.** What Electrobun 2.0.2's Windows setup stub does when an install finishes, and how XF Studio's scripted refresh works around it. Source read at the v2.0.2 tag of [Electrobun](https://github.com/blackboardsh/electrobun) (`package/src/extractor/main.zig`); the workaround is exercised by unit tests and one local build, not yet by a real installed refresh. Grades: **[source]** read in Electrobun's source; **[offline]** exercised by our tests or tool runs.

## 1. It always opens the app it installed

| Fact | Grade |
|---|---|
| Both install paths, `extractAdjacentArchive` (payload beside the setup, the one XF Studio ships) and `extractFromSelf` (legacy embedded payload), end with `if (installed) launchInstalledApp(allocator, app_dir);` after reporting success. The only condition is that the install succeeded; neither call checks an environment variable or a command-line flag. | [source] |
| `launchInstalledApp` spawns `bin\launcher.exe` with `std.process.spawn`, passing no environment map (the child inherits the setup's environment), no working folder and ignored standard streams, and does not wait for it. The only early return is a missing launcher path. | [source] |
| So a silent setup (`/VERYSILENT` on XF Studio's Inno wrapper, which runs Electrobun's setup) still opens the app, which outlives the setup and its wrapper. There is no switch to stop it. | [source] |

## 2. How XF Studio handles it

- The app's `main.ts` ends the launch at once, with exit code 0, before it opens its log, data folder, instance lock, window or server, when the environment holds `XFS_INSTALL_REFRESH=1` (`installRefreshRequested` in `startup-watchdog.ts`, tested in `desktop/tests/startup.test.ts`). The variable reaches it only through the setup's inherited environment. **[offline]**
- `desktop/tools/refresh-installed.ps1` sets it for the setup it runs, starts the setup through WMI as `pythonw.exe` (no console window, and outside the Claude app's Store package, whose private AppData would swallow the install), and follows the setup's process tree by parent links while it runs, because the detached app's parent is gone soon after. Whatever of that tree remains when the setup is done is stopped by process id. **[offline]**
- A scripted refresh never touches an app that is running: the setup would otherwise replace files under a live process (Electrobun reports `AccessDenied` or `FileBusy`; see the [desktop README](../projects/xf-studio/authoring/desktop/README.md#single-file-setup)).

## Open questions

- Whether a later Electrobun release adds a switch to skip the launch (check the setup's changelog when updating `electrobun`). The environment switch can then be dropped.
- A real installed refresh over a kept library, with timings, has not been run yet.
