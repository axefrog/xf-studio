# Vortex support

**Status: read-only prototype built (26 September 2026), not wired into the UI.** How Vortex deploys Cyberpunk 2077 mods, where it keeps its metadata and what XF Studio reads is in [knowledge/vortex.md](../../knowledge/vortex.md); [experiment 023](../../experiments/023-vortex-sandbox/README.md) observed Vortex 2.7.1 deploying test mods in Windows Sandbox and confirmed the manifest, hard links, winner-only listing, unmanaged-file tolerance and `--install-archive` behaviour. Background, low priority: most of the maintainer's work runs through MO2, but AGENTS.md requires the resolver to accept Vortex setups too, and many players use Vortex.

## Done

- **Attribution on every route.** Source discovery reads `vortex.deployment*.json` in the game folder. Each game-folder file Vortex deployed carries `deployedBy` (the Vortex mod, deployed or changed since) and its provider name becomes that mod, so resource provenance and the diagnostics' mod identities name the Vortex mod instead of "Installed game". The manifest is watched, so a redeploy reopens the route. Archive order is unchanged: Vortex's files are real files in the game folder.
- **Setup inspection** (`inspectVortexSetup`, `tools/vortex-check.ts`): which Vortex installation deployed (matched by instance id, per-user or shared data folder), the staging folder and its marker, the profile, each mod's name, version and Nexus ids, and a comparison with the game folder: files Vortex didn't deploy, deployed files now missing or changed, and deployed mods that are now disabled or uninstalled (an out-of-date deployment).
- **State reading without Vortex.** A small read-only LevelDB reader reads `state.v2`'s files, never its `LOCK`, and falls back to Vortex's own full-state JSON backup when files are held open. Tested against Vortex's real database, including a Snappy-compressed table. While Vortex runs it locks the files that hold everything since it started, so state read then is marked not current and never used to call a deployed mod uninstalled.

## Next

1. **First-run detection.** Add a `vortex` source to install detection: a game folder Vortex discovered (`settings.gameMode.discovered.cyberpunk2077.path`) is a game candidate, as an MO2 instance's `gamePath` already is. Show "Managed by Vortex (profile …)" beside the launch route; the direct route stays correct because the game reads Vortex's deployed files.
2. **Placement of XF Eye Artistry.** Build a Vortex-installable archive (`XF Eye Artistry.zip` with `archive/pc/mod/...`) and, with the user's consent, hand it to their Vortex with its documented `--install-archive` command, which installs, enables and deploys it like any download (observed, with no prompt). Vortex's Mods page shows the archive's file name, extension included. Never write into Vortex's staging folder or state, never deploy or purge for the user, and never drop loose files into the game folder of a Vortex-managed setup without saying that Vortex won't manage them. Needs: the update path (Vortex's replace-or-variant prompt for an archive with the same name), and a fallback message when Vortex isn't installed where we expect.
3. **Staleness guidance.** When the deployment is out of date and Vortex's state was read completely (Vortex closed) (a deployed mod is disabled, or an enabled mod isn't deployed), tell the user in one sentence to click Deploy in Vortex; never deploy for them.
4. **Diagnostics report.** Include Vortex mod names, versions and Nexus mod and file ids for winners (coordinate with the diagnostics track).
5. **REDmod.** Vortex's Cyberpunk extension manages a separate REDmod load order (`V2077/Load Order/V2077-load-order-<profile>.json`, `V2077/modlist.txt`, `redMod.exe deploy`). The resolver doesn't mount REDmod archives on any route yet; when it does, read that order.
6. **In-game confirmation.** One maintainer-supervised check on a Vortex-managed copy is not planned: the maintainer uses MO2. A community tester with Vortex could confirm that the Studio's provenance names the right mods (see the knowledge page's test asks).

## Constraints

- **Never touch the user's setup:** no writes to Vortex's staging, state, profiles or `nxm://` association; add only our own mod, through Vortex itself.
- **Never run Vortex on the development machine,** and never point a Vortex at the real game folder. Research runs in Windows Sandbox with a synthetic game folder.
- **No per-mod code.** Attribution comes from Vortex's generic records, not from recognising particular mods.
