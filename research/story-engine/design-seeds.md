# Design seeds

Fine-grained design points that come up before the plan reaches their level. Each one waits here until a second-level plan absorbs it. That plan then owns the point, and the entry here links to where it went. Add a seed whenever one comes up. Plans are named in the [first-level plan](plan.md#5-second-level-plans).

Status: **waiting** (not yet absorbed), **anchored** (absorbed by a written plan, with a link), **resolved** (designed or decided), **dropped** (with the reason).

| ID | Seed | Anchors in | Status |
|---|---|---|---|
| DS-01 | **Selection over generation.** Simulate, then sift the record for story-shaped patterns, then let a director choose what surfaces. Pure simulation and pure templates are the two known failure modes | P4 | waiting |
| DS-02 | **Seeding is casting.** Top-down and bottom-up seeds are the same operation: binding a fragment's roles to world entities under constraints. They differ only in which roles arrive bound, and in whether the search may add detail where V hasn't looked | P4, P3 | waiting |
| DS-03 | **Observed means canon.** What V has observed constrains every later refinement. Unobserved state stays loose (a range of possibilities or a summary) until something needs it, as in alibi generation | P3 | waiting |
| DS-04 | **Forgetting is garbage collection.** V's observations and committed seeds are the root set. What they depend on persists; the rest may be dropped, or regenerated from its seed. "How rigorous the simulation is" becomes "how wide the root set is" | P3 | waiting |
| DS-05 | **The director steers only through the unobserved.** It also pins whatever V could base a choice on, so a choice is never quietly overridden (the tabletop "quantum ogre" problem) | P4 | waiting |
| DS-06 | **Every fact has a provenance:** seen by V, told to V, inferred, simulated but unseen, or generated on demand | P3 | waiting |
| DS-07 | **People hold beliefs, not just truth.** Information asymmetry drives reveals, lies and betrayals. Beliefs exist only at fine levels of detail | P3, P4 | waiting |
| DS-08 | **Saves make history a tree.** The record branches with each save, so a reload never leaks the future into the past | P3, P5 | waiting |
| DS-09 | **Big stories grow from small ones.** Hooks V engages with gain detail and length; ignored ones fade. Engagement is the selection signal | P4 | waiting |
| DS-10 | **Reincorporation.** Callbacks to V's past are the strongest sign that content isn't random | P4, P7 | waiting |
| DS-11 | **Collisions are material.** Intersections between threads produce the best stories, so the director may prefer castings that make threads cross | P4 | waiting |
| DS-12 | **Discovery holds up.** Three clues for every conclusion that matters, and node-based structure, so simulation drift never strands V | P4 | waiting |
| DS-13 | **Untethered clues.** Secrets and clues not tied to a place can surface wherever V is: bottom-up anchoring in tabletop form | P4 | waiting |
| DS-14 | **Flashbacks fill in the past lazily.** V's own preparation can be decided when it matters, consistent with what has been observed (Blades in the Dark) | P3, P4 | waiting |
| DS-15 | **Spend detail where it can be perceived.** Simulation the player can't perceive is wasted ("The Simulation Dream") | P3, P5 | waiting |
| DS-16 | **Perceptible variety beats mathematical variety** ("10,000 bowls of oatmeal") | P6, P7 | waiting |
| DS-17 | **Generated text renders; structure stays deterministic.** A pre-generated text library is the baseline, and live generation is an option, because a live model brings keys, cost, latency and privacy concerns | P5, P6 | waiting |
| DS-18 | **In-world channels.** The Kiroshi scanner suits an NPC's concerns; other channels are overheard calls, overhead text, shards, messages and graffiti | P6 | waiting |
| DS-19 | **Play to procedural strengths.** Systemic, environmental and text-driven content, not imitations of cinematic voiced quests | P4, P6 | waiting |
| DS-20 | **The live DM is the hand-run prototype** of the director and of the action set. Its friction log feeds the runtime requirements | P6, [requirements](runtime-requirements.md) | waiting |
| DS-21 | **The game's quest graphs are a corpus.** Decompose strong and forgettable quests alike, and test whether the composite can say what separates them | P1, P2 | waiting |
| DS-22 | **Adversarial pass.** An agent tries to write a quest that satisfies the whole composite and still sucks. Each success exposes a missing discipline | P1, P7 | waiting |
| DS-23 | **Radiant quests as the negative case:** no stakes, no causality, no consequence, no characters who matter, a visible template | P7 | waiting |
| DS-24 | **"Surprising yet inevitable."** The causes really exist in the record; the director only chooses what to reveal and when | P4 | waiting |
| DS-25 | **Fresh eyes.** Anyone who learns the generator's grammar starts seeing templates. Evaluation needs judges who don't know it, and the maintainer shouldn't see outputs meant for them to play later | P7 | waiting |
| DS-26 | **Agents get their own view of the simulation:** machine-readable state and "why did this happen" traces | P8 | waiting |
| DS-27 | **A tension budget.** Limit the active threads near V, give rest beats, and respect the game's own cooldowns | P4 | waiting |
| DS-28 | **One representation at every scale.** Encounters, gigs and arcs are composed from the same fragments. They differ in cast depth, the distance between setup and payoff, and the stakes | P4 | waiting |
| DS-29 | **Generate, then justify.** Invent the event first and its causes afterwards, consistent with the record, as Caves of Qud's histories do. It's often cheaper and more coherent than simulating forwards | P3, P4 | waiting |
| DS-30 | **Tone and content controls.** Dark themes are the setting, but intensity and sensitive content are configurable, and the project's nudity policy applies | P6 | waiting |
| DS-31 | **Coexist with other mods** that change crowds, reactions or gigs: detect them, then step aside or layer | P5, P6 | waiting |
| DS-32 | **The world model reads the installed game,** modded places and records included, through the generic resolver, the world index and TweakDB | P3 | waiting |
