# Language check 1: a vanilla gig in the seed language's core

**Status:** 23 October 2026. A check that S2 v1.4's **core** (§0.3) can express a real gig, both precisely and vaguely, before the reference model's coding reaches the language's details. It is the first step towards milestone M2's test: "the seed language can express both a precise and a vague version of one of them" ([plan §4](plan.md#4-milestones)).

The gig is *Hippocratic Oath* (`sts_wat_kab_02`), Regina Jones's job in Kabuki, M3's district. Its structure is read from [the gig decompositions](gig-decompositions.md#1-hippocratic-oath-sts_wat_kab_02). This page reproduces no game text; names are the game's identifiers.

## 1. The gig's shape

- **Offer.** A map pin made discoverable by the fixer's phase and her tier fact. Arriving at the trigger brings Regina's call, or a text fallback if calls are muted.
- **Objectives.** Get inside, find the patient, talk, **persuade**, then three optional ones in parallel (scan a ganger, take blood, inject), then escort the patient to the car.
- **Failure.** The patient dies, or falls too far behind.
- **Outcomes.** A finished fact, a failed fact, a success or failure debrief, a reward record, a district counter. Then a gang retaliation, after a 3-hour game-time delay.

## 2. The precise version

```yaml
id: xf.check:hippocratic-oath
version: 1
maturity: playable
level: gig
turns: [ { level: goal, who: patient, kind: exit, what: { seedFact: delivered, op: eq, value: 1 } } ]
purpose: { tags: [rescue, medical, gang-pressure], sentence: "Get a sick man out from under a gang, alive." }
context: { fact: q101_done, op: ge, value: 0 }
intent: { prohibitions: [], tone: [grounded] }
roles:
  fixer:   { kind: core:person, identity: game:regina_jones, anchor: true }
  patient: { kind: core:person, must: [ <in Kabuki>, <alive>, <adult> ], onUnfilled: [wait, withdraw] }
  ganger:  { kind: core:person, must: [ <member of Maelstrom> ], optional: true, onUnfilled: [shrink] }
  place:   { kind: core:place, must: [ <in Kabuki>, <interior> ] }
facts:
  persuaded: { route: { consumers: [escort] } }
  delivered: { route: { consumers: [debrief-success, end] } }
windows:
  - id: main
    opens: { all: [ { fact: sts_wat_kab_tier_1, op: ge, value: 1 }, { fact: sts_wat_kab_02_finished, op: eq, value: 0 } ] }
    onClose: withdraw
start: [brief]
beats:
  brief:    { play: pack:hip-brief-call }             # the fixer's call; offer: accept / decline / not now
  inside:   { play: pack:hip-get-inside, kind: obstacle, links: [ { because: brief, on: { response: brief, is: [action:accept] } } ],
              obstacle: { affordances: [ { needs: <door code known>, cost: low, exposure: low, combat: false },
                                         { needs: <hack device>, cost: low, exposure: medium, combat: false },
                                         { needs: yes, cost: high, exposure: high, combat: true } ] } }
  find:     { play: pack:hip-find, links: [ { because: inside } ], leaves: [] }
  persuade: { play: pack:hip-persuade, kind: decision, links: [ { because: find } ],
              decision: { atStake: patient, stances: [help, bargain, refuse] } }     # see finding F-1
  scan:     { play: pack:hip-scan,   kind: texture, links: [ { because: persuade, on: { seedFact: persuaded, op: eq, value: 1 } } ] }
  blood:    { play: pack:hip-blood,  kind: texture, links: [ { because: persuade, on: { seedFact: persuaded, op: eq, value: 1 } } ] }
  escort:   { play: pack:hip-escort, links: [ { because: persuade, on: { seedFact: persuaded, op: eq, value: 1 } } ],
              objective: { kind: task, succeeds: <patient at the car>, fails: { role: patient, p: <dead> } },
              failure: [ { when: <patient beyond 60 m>, warnFirst: <patient beyond 40 m>, leadsTo: debrief-fail } ],
              leaves: [ { fact: delivered, set: 1 } ] }
  debrief-success: { play: pack:hip-debrief-success, kind: exit, links: [ { because: escort } ],
                     leaves: [ { reward: { table: fixer-gig, tier: kabuki-1 } }, { game: { fact: sts_wat_kab_02_finished, set: 1 }, capability: story.write-vanilla } ] }
  debrief-fail:    { play: pack:hip-debrief-fail, kind: exit, leaves: [ { game: { fact: sts_wat_kab_02_failed, set: 1 }, capability: story.write-vanilla } ] }
  retaliation:     { play: pack:hip-retaliation, kind: aftermath, links: [ { because: debrief-success } ],
                     aftermath: { delay: { clock: game, s: 10800 }, signposts: [pack:hip-claws-word, pack:hip-tagged-door] } }
end: { any: [ { beat: debrief-success, state: [done] }, { beat: debrief-fail, state: [done] } ] }
unattended: { after: { clock: game, s: 86400 }, outcome: [] }
closing: pack:hip-closing
```

**Everything the gig does is expressible in the core:**
- the tier gate;
- the brief and its decline;
- the entry routes, including a non-combat one;
- the optional parallel tasks, as texture;
- failure by death or distance, with a warning first;
- two debriefs and the reward;
- the outcome facts;
- the delayed retaliation, with signposts.

Three things needed care, and two of them are gaps.

## 3. The vague version

The same gig with its specifics left open, for the engine to fit:

```yaml
roles:
  fixer:   { kind: core:person, prefer: [ { p: <fixer for this district>, strength: 3 } ] }
  patient: { kind: core:person, must: [ <in district>, <alive>, <adult>, <needs medical help> ] }
  ganger:  { kind: core:person, must: [ <member of the group holding the patient> ], optional: true }
  place:   { kind: core:place, prefer: [ { p: <gang-held interior>, strength: 2 } ] }
windows:
  - id: main
    opens: { city: { band: { cell: place } }, is: [simmering, hot] }      # a later capability in the core (§2.16)
```

The beats stay as they are. The vague version leaves the people, the place and the moment open, and fitting chooses them from the world. Two notes:
- **No gig profile yet.** The vague version can't also leave its **structure** open: that needs a gig profile, which is a later capability (S2 §0.3). The structure is the authored graph above.
- **City reads.** Opening on a city band is a later capability too. In the core, the window uses a registered read with the same meaning.

## 4. Findings for the design

| # | Finding | Severity | Proposed change |
|---|---|---|---|
| F-1 | **Choices inside a running scene have no path.** S2 routes every choice through an offer, and offers are deliveries the arbiter releases. But the arbiter refuses to release anything while V is in dialogue (§8.3, gate 1). So the persuasion choice, which happens inside the conversation with the patient, would never be released | **Blocks the gig** | An offer released **within a running beat's own scene** is part of that scene's content, not a new push. It skips the arbiter's busy-UI, spacing, cap and session gates, and still follows the response lifecycle (§7.4) and the honesty rules. Mark such offers `inScene: true` on the beat. Only offers that start contact go through the arbiter's gates |
| F-2 | **Obstacles and affordances are in the language (§2.8) but not clearly in the core.** S2 §0.3 lists execution without naming obstacles, and L-27 isn't among the core lints. The gig's three entry routes need them | Ambiguity | State that `obstacle` beats and their affordances are in the core, and add L-27 to the core lints |
| F-3 | **A role used only by optional beats.** The ganger is needed only by the optional scan. `optional: true` with `shrink` works, but only because the scan is texture. The rule that shrinking skips the role's beats (§5.4) is right; this is a confirmation, not a gap | None | — |

## 5. What this means for the code

F-1 changes how offers and the arbiter work, which the coding agent is building now. So it goes into S2 before the agent reaches offers. F-2 is a one-line scope clarification.
