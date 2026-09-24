# Public knowledge pages (background)

**Status (25 September 2026): queued, low priority.** Run occasionally in the background when enough of the [knowledge base](../../knowledge/README.md) has matured to be worth publishing.

## Goal

Share what the R&D lab learns with the Cyberpunk modding community. Every so often, and retrospectively, publish cleaned-up, organised and up-to-date versions of mature knowledge pages (for example the material/shader model, the character-customisation file chain, and how to read decompiled shaders) as a section of the public GitHub Pages site (`projects/xf-studio/site`).

## Rules

- **Complement the wiki, don't duplicate it.** The [Cyberpunk 2077 Modding Wiki](https://wiki.redmodding.org/cyberpunk-2077-modding) remains the community reference. Our pages restate and connect knowledge in an organised form, add our own findings, and link to wiki pages rather than copying them.
- **Always attribute.** Credit the origin of every piece of information sourced elsewhere (wiki pages and their authors, tools, mods, people), inline where it is used and in the site's credits. Never present others' findings as our own.
- **Caveat.** Each page says plainly that some information may be incomplete or wrong, shows how it was established (the knowledge base's evidence grades, simplified for readers), and invites corrections through an issue or pull request on [axefrog/xf-studio](https://github.com/axefrog/xf-studio).
- **Mature content only.** Publish only Draft-or-better knowledge pages whose key claims have been cross-checked. Mark unverified claims as hypotheses.
- **Public-safe.** No game or mod assets, no large decompiled shader dumps, no personal paths or names; short illustrative excerpts only. Follow the site's existing content and release-claim guards, and run `bun run verify` in the site project.
- **Date and version stamp each page** with the game and framework versions it describes.

## When to do it

After a knowledge page reaches Draft or Solid, and at natural lulls. It never displaces product or R&D work.
