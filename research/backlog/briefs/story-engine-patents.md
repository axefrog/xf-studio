# Research brief: active patents near the Story Engine's mechanisms

Requested by XF · Story Engine on 22 October 2026, through the [research queue](../research-queue.md).

## Why

The project never builds on patented techniques that would need a licence, royalties or negotiation; it designs around them instead. This is needed before the Story Engine's simulation-layer and procedural-engine designs (P3 and P5). They aren't urgent, but they come next after the reference model.

**Trigger:** research lens L8 found press coverage of Warner Bros.' Nemesis patent, reported as US 10,926,179 (persistent procedural antagonists with ranks, promotion and vendettas). L8 couldn't verify it against the patent record. The Story Engine's design has groups, memberships, rivalries, persistent NPC memory and beliefs, and grudges.

## Question

Which active patents and published applications (granted, or pending with live claims) cover:

- Nemesis-style systems;
- AI directors and dynamic pacing;
- procedural quest and mission generation;
- NPC memory, relationship and reputation systems;
- emergent or curated narrative?

## Wanted for each

- the holder, the number, the status and the expiry (or expected expiry);
- the independent claims in plain words;
- which Story Engine mechanisms come near them (see [foundation §5](../../story-engine/foundation.md) and `research/story-engine/spec/kernel.md` §10–12);
- the concrete design-around constraint.

## Method

- Verify every patent against the patent record (Google Patents or the USPTO/EPO registers), not press coverage.
- Grade each claim: verified against the record, or reported only.
- Include family members in other jurisdictions where they're live.
- State that this is not legal advice.

## Output

A page in `research/story-engine/`, `patent-constraints.md`, that the P3 and P5 designs can cite. It sets out the constraints as design rules.

## Done when

Each category above has been searched, with the search terms recorded. Each patent found is verified or marked as reported only, and each one that comes near the design has a design-around constraint.
