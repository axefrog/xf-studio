# Research queue

The one queue for research questions from any chat in this project: how the game, its file formats, its tools and its mod ecosystem work, and what the options are for something we want to build. The meta-coordinator (`XF · Meta-coordinator`) owns it and manages each request on the asking chat's behalf.

R&D *build* tracks (prototypes, bridge features, experiments with code) stay with the chat that owns them, in the [work queue's R&D lane](README.md#rd-runs-only-while-the-polish-lane-is-moving). This queue covers the understanding those tracks rest on.

## Asking for research

Send the meta-coordinator a message with this first line:

`[XF] request · research: <the question> · reply needed: yes · blocking: yes/no`

The body should say:
- what decision or piece of work the answer serves;
- when it's needed;
- what you've already checked.

A quick lookup inside your own scope doesn't need to come here. Anything bigger does, so that answers end up in the knowledge base rather than in one chat's context.

## What the meta-coordinator does with a request

1. **Checks what we already have:**
   - the [knowledge base](../../knowledge/README.md), `research/` and `experiments/`;
   - the [community credits](../../docs/community-credits.md) for prior art;
   - the local Cyberpunk Modding Docs clone.

   If the question is already answered, it points at the material and says whether it's current. If the answer is partial, it says what's missing and queues only that part.
2. **Queues the rest by priority:**
   1. blocking work in flight;
   2. beta and 1.0;
   3. the standing tracks;
   4. exploratory questions.

   Pace follows the usage mode on the board, and the work queue's rule that R&D runs only while the polish lane is moving.
3. **Runs it** with a research agent. That's read-only, or a documentation worktree when the result is a page. If the question needs the asking chat's own context, it goes back to that chat. Questions only the running game can answer are batched onto the owning chat's next session card.
4. **Delivers:**
   - the knowledge page is updated (cited and evidence-graded), with credits for any source;
   - the result lands on `main`;
   - the asking chat gets the links.

Requests from the Story Engine stay spoiler-free here: neutral wording, no plot, characters or story beats.

## Standing tracks

- The game's material and shader system: [materials and shader RE](materials-shader-re.md).
- The character-customisation file chain: [CC file chain](cc-file-chain.md).
- Load time and responsiveness: [performance](performance.md).

## Queue

| Question | Asked by | Serves | Priority | Status | Result |
|---|---|---|---|---|---|
| How the base game records main-story progress as state: the facts, quest phases and journal states that mark acts and turning points; tracked character states (alive, allied, romance); the point of no return and open endings. Delivered as a knowledge page plus a table of fact names and conditions (no assets). Brief: area A of [p2-game-substrate](../story-engine/p2-game-substrate.md). | XF · Story Engine (22 Oct) | Seed-language design (P4): evaluating authored story windows on any save | 4: exploratory, not urgent | Queued; runs when the usage mode allows. Already covered: the mechanics of facts, phases and the journal ([quests and story](../../knowledge/quests-and-story.md), [save files](../../knowledge/save-files.md)). Missing: the vanilla progress map itself. | — |
| How mods put their own ink UI inside photo mode's menus: where to attach (rows, pages, whole panels), input and focus, layout, coexistence between several photo-mode mods, pitfalls; plus questions only the game can answer, for the bridge's session cards. Source: the downloaded mod-study set (ignored), studied for technique only, never adopting its code; source-only claims graded as such; mods credited. | XF · Runtime bridge (22 Oct) | The bridge's surface rule: XF photo-mode controls native inside photo mode, the overlay only as a fallback | 4: not urgent, before XF Core C1 | Queued; runs when the usage mode allows. Already covered: adding and driving menu rows (`AddMenuItem`, the three attribute layers, write ordering, Photo Mode Preferences' re-apply window) in [photo mode §11](../../knowledge/photo-mode.md) and [ink UI §3](../../knowledge/ink-ui.md). Missing: custom panels and pages, input and focus, layout, coexistence. | — |

## Answered from existing material

Requests answered by pointing at what we already had. One line each, newest first.

| Date | Question | Asked by | Answered by |
|---|---|---|---|
| — | | | |
