# Research brief: open questions that public framework source can settle

Raised by the meta-coordinator on 23 October 2026, through the [research queue](../research-queue.md), for XF · Story Engine and XF · Runtime bridge. Several questions in this week's knowledge pages stayed open only because no one had read the frameworks' source. This run reads the source. It's also the project's first cloud research session, so it needs nothing from the local machine.

## Environment

This runs as a Claude Code cloud session (Ubuntu) on a clone of this repository. The game, its files and the private ignored folders (`research/consumers/*`, `local/`) aren't available, and you don't need them. Ignore Windows-specific instructions in `AGENTS.md` (paths on C or D, the memory guard, the Python interpreter path): use `python3`. Everything else in `AGENTS.md` applies, especially "Evidence and honesty", "Community credit — mandatory" and "Writing repository documents".

## Sources

Clone each into a scratch folder outside the repository, and record the commit you read:

- TweakXL: `https://github.com/psiberx/cp2077-tweak-xl`
- ArchiveXL: `https://github.com/psiberx/cp2077-archive-xl`
- Codeware: `https://github.com/psiberx/cp2077-codeware` (source and wiki)
- redscript: `https://github.com/jac3km4/redscript`
- RED4ext.SDK: `https://github.com/WopsS/RED4ext.SDK` (generated type headers include the game's record and class layouts)
- Cyberpunk Modding Docs: `https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs`

If a repository has moved, follow the move and record the new address.

## Questions

1. **Scanner records (knowledge/player-channels.md).** What are the exact TweakDB record types, and therefore the TweakXL `$type` names, for the records behind `npc_scanning_data`, `device_scanning_data` and `FocusClue`, and which fields does each carry? Can a TweakXL item record for a shard use `$base` to inherit from a vanilla shard record, rather than spelling out every field (that page's open question 6)?
2. **Literal text in localised fields (player-channels open question 2, source side only).** Does TweakXL or ArchiveXL accept a literal string where a `LocKey` or localised-string field is expected, and how is it stored? Is there a documented route for plain text?
3. **Codeware localisation (player-channels open question 7).** Can a `ModLocalizationProvider` change a key's text after the language has loaded, and how (events, re-registration, cache behaviour)?
4. **ArchiveXL journal merge (player-channels open question 8, source side).** Does ArchiveXL's journal merging accept a pool of objective entries under a `gameJournalQuest` with a generic phase? What are the merge rules and limits? The question of whether the tracker redraws is a runtime one, so leave it marked "needs the game".
5. **Codeware session events (knowledge/save-identity.md open question 4; knowledge/game-events.md, save and load).** Which native points does Codeware hook to raise `Session/BeforeSave`, `Session/AfterSave` and the load events? From source, would they fire for autosaves and quick-saves as well as manual saves? What exactly do `GameSessionEvent.IsRestored` and `IsPreGame` mean?
6. **Wrapping native methods (knowledge/game-events.md).** Does redscript's `@wrapMethod` resolve on native methods of native classes, or only on scripted methods? Cite the compiler or runtime source.

## Method and grading

Read the source, the docs and the tests, and cite the repository, commit, file and line for each claim. Grade each claim as source-observed or community-claimed. Nothing here can be runtime-proven. Where only the game can settle something, say so and leave it marked as needing the game.

## Deliverables

- Edit the existing pages in place. Answer each question in the relevant section and in that page's "Open questions" list: either resolve the question (with its citation) or narrow it to what still needs the game. The pages are `knowledge/player-channels.md`, `knowledge/save-identity.md` and `knowledge/game-events.md`.
- Credit any party not yet credited in `docs/community-credits.md`, following the file's rules. Most of these authors are already credited, so extend their entries only where this run taught something new.
- Run `python3 tools/check_links.py` and `python3 tools/check_private_paths.py`; both must report 0.
- Commit with a plain message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, and push the branch `claude/research-framework-sources`. Don't merge into `main` and don't open a pull request; the meta-coordinator reviews and lands it.
- In `research/backlog/research-queue.md`, mark this request's row "Delivered" with links.

## Done when

Each question is answered from source with a citation, or explicitly narrowed to what needs the game, and the branch is pushed.
