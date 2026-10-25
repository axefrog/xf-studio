# Worked examples for the pattern language

**Status:** v0, 25 October 2026. Three examples that test the [pattern language](pattern-language.md) against the [library](README.md#the-patterns) and against S1's Kabuki ([S1](../spec/simulation.md)): the package thread, two patterns layered over Kabuki's real content, and one pattern in three contexts. Each ends with what worked and what didn't; the findings feed the design's proposed changes ([§13](pattern-language.md#13-proposed-specification-changes)).

People and situations here are invented for illustration and are not content ([D-26](../decisions.md)). Setting institutions (the Tyger Claws, The Mox, Kabuki's market) are used as S1 models them. "The protagonist" is the specs' `v` ([D-25](../decisions.md)).

## 1. The package thread

### 1.1 The example

The maintainer's example of how composition makes an errand less mundane: a fetch errand where, on the way back, someone follows the courier and takes the package; the courier then finds out it was meant for a crime boss; and now there is a price on the courier's head.

Told like that, it is one plot. In the pattern language it is seven instances of library patterns over the same people, each with its own reasons, and most of its later beats happen only on some of the paths the protagonist can take.

### 1.2 The cast, as the world supplies it

| Role | Who | Where they come from |
|---|---|---|
| Sender | Okoro, who runs a repair stall at the Kabuki market | An S1 resident, profile role `vendor`, cast by the courier kit's role query |
| Recipient | Sato, a Tyger Claws lieutenant | **Must be a real person who leads.** S1 has no leader persons (§1.7), so today the kit casts a Claws `gang` resident and calls him a lieutenant, which the world doesn't back |
| The thing | A sealed case | Minted by the kit as a stand-in `xf:item` held by Okoro (§13 S1-4) |
| Leak | Danny, Okoro's nephew, who minds the stall at weekends | A resident in Okoro's household (S1's `household` focus) |
| Interceptor | Rhee, who sells at the next stall and runs errands for The Mox | A `vendor` resident of affiliation class `TheMox`; tied to Danny by the `market` focus |
| Courier | The protagonist | Only by accepting an offer ([D-09](../decisions.md)) |

**Why Okoro asks at all** is a juncture too, and it has to be a recorded relationship to the beneficiary, not a role the pattern assumes. Okoro owes Sato: last month Sato covered his Friday fee, and this week Sato calls it in by having Okoro deliver a case. That is a [debt](patterns/tensions.json) (I0), and it is why the request reaches the protagonist from Okoro while the case is meant for Sato. An errand inherits its reason from the city instead of from a template.

### 1.3 The instances and their junctures

| # | Instance | Juncture | Function | What fills it | Source (§8.1) |
|---|---|---|---|---|---|
| I0 | [debt](patterns/tensions.json) | `owed` | `obligate(Okoro, Sato)` | A `favour` event: Sato covered Okoro's fee (it fills `help` and `obligate`) | Found if recorded; otherwise the kit's sowing constructs it within latitude, if nothing the protagonist saw contradicts it |
| | | `called` | `demand(Sato, Okoro, owed)` | Sato's order to deliver the case | Found, or minted with the kit |
| | | `paid` | `repay(Okoro, Sato)` | The delivery, if it happens: the courier kit's offer (Okoro asks the protagonist) realises it, and the delivery event the kit leaves fills it | Offer |
| I1 | [coveted](patterns/tensions.json) | `holds` | `hold(Okoro, case)` | The stand-in's `held-by` edge | Found (minted with the kit) |
| | | `wants` | `want(Sato, case)` | A goal frame on Sato, opened by the kit's role `goal` ([S2 §5.3](../spec/seeding.md#53-committing)) | Offer (the kit) |
| | | `asked` | (unfilled) | Sato never asks the protagonist, and his order to Okoro is I0's `demand`, not a request without threat, so coveted's optional `asked` stays open | — |
| | | `moved` | `transfer(case, Okoro, Sato)` | Refined by I2: the `refine` names interception's `delivered` outcome and binds `?by` to Okoro, `?to` to Sato and `?x` to the case (the contract of [§7.4](pattern-language.md#74-refinement-a-juncture-filled-by-a-smaller-pattern)) | Refine |
| I2 | [interception](patterns/turns.json) | `plan` | `obligate(protagonist, Okoro)` | The `promise` event that accepting mints (§13 S2-6) | Found, once accepted |
| | | `known` | `learn(Danny, plan)` | Danny is among the promise event's witnesses (present at the stall cell, S1 `presentAt`) | Found if he was there; else constructed ("Danny took the call"), if nothing the protagonist saw contradicts it |
| | | `leaked` | `learn(Rhee, plan)` | A `tell` from Danny to Rhee over the market tie (S1's telling policy, with §13 S1-5) | Wait; constructed only within latitude |
| | | `wanting` | `want(Rhee, case)` | The Mox's `retaliate` intention against the Claws (live if a Mox member was hurt recently) opens a goal frame on Rhee | Nudge, legal because a group intention serves it (§8.2) |
| | | `shadow` | `pursue(Rhee, protagonist)` | Rhee following the protagonist from the market: the **portent** | Nudge, on unobserved state |
| | | `taken` | `transfer(case, protagonist, Rhee)` | A confrontation: an obstacle seed with ways out (fight, outrun, talk, pay, hand it over) whose leaves record the transfer only if the protagonist loses or yields the case. No library pattern's outcome produces this transfer, so it is an offer, not a refinement | Offer; the protagonist decides |
| I3 | [secret](patterns/tensions.json) | `hidden` | `conceal(Okoro, recipient, protagonist)` | The offer's `withheld` field | Found |
| | | `out` | `expose(·, recipient, protagonist)` | A delivery naming the recipient reaches `presented`: the drop address, Okoro's panicked call after a loss, or Danny. The protagonist is the one kept in the dark, so `out` records an **exposure**, never a belief of the protagonist's (its guarded change) | Wait (three routes, §9.2) |
| I4 | [misattribution](patterns/turns.json) | `wronged` | `wrong(Rhee, Sato)` | The theft, if it happened (the same occurrence as I2's `taken`: a layer) | Found |
| | | `misread` | `blame(Sato, protagonist, wronged)` | Sato's belief, formed from Okoro's account: Okoro, protecting himself, says the courier lost it or sold it (a distortion in the teller's favour, [SRC-07](../craft/d13-perception-curiosity.md)). It rests on observed acts of the protagonist's (taking the job, carrying the case, losing it) | Wait (Okoro has his own reason to tell) |
| | | `cleared` | `expose(·, wronged, Sato)` | The protagonist brings Sato the truth: Danny's account, Rhee seen with the case, the market talk | Offer |
| I5 | [hunted](patterns/shapes.json) | `grudge` | `blame(Claws, protagonist, loss)` | Sato's belief, carried to his group (members report up, foundation §5.2); its `observed-act` requirement holds | Found from I4 |
| | | `decided` | `decide(Claws, protagonist)` | **The Claws' own intention against the protagonist, under [D-30](../decisions.md)** (§13 S1-10): it can start only from this belief about the protagonist's acts, and only if the group's retribution and reputation drives carry it over the threshold | Wait: the world's move |
| | | `warned` | `threaten(Claws, protagonist)` | The intention's first visible act: word put out at the market, a message, a demand to pay for the case. No harmful act may follow until it reached `presented` | Wait |
| | | `hunting` | `pursue(Claws, protagonist)` | The intention while active: members asking after the protagonist, watching the places the protagonist is known at | Wait |
| | | `caught` | `wrong(Claws, protagonist)` | When members find the protagonist: an encounter realised in the game (P8), with ways out | Wait |
| | | `paidOff`, `cleared`, `sheltered` | | Three routes to lift it: pay for the case, clear the name (I4), find shelter (The Mox, ironically, or Okoro) | Offer, or the world |
| I6 | [feud](patterns/shapes.json) | `opened` | `wrong(Mox, Claws)` | The same theft, read at group level (a layer with I2 and I4) | Found |
| | | `answered` | `story(grievance, avenged)` | The Claws' retribution aimed at The Mox | Wait (S1 `group.decide`) |

I5 and I6 are shapes, so they are recognisers here: the director realises nothing of theirs directly and works only on the instances that fill them (§7.3).

### 1.4 Where the escalation is decided

Rungs 1 and 2 pass the director's [escalation gate](pattern-language.md#85-the-escalation-gate): nothing climbs unless the protagonist pulled and someone in the world wants the next step. Rungs 4 and 5 belong to the Claws: a group's decision under D-30, bounded by its own conditions and the proactivity setting, which the director neither climbs nor stops.

| Rung | Juncture | Who decides, and on what | If it doesn't happen |
|---|---|---|---|
| 0 | The offer (I0 `paid`, by offer) | Ordinary sowing gates | No errand. Okoro finds someone else or settles with Sato another way: [settled without you](patterns/closures.json) |
| 1 | The follower (I2 `shadow`) | The director's gate. Pull: the protagonist accepted and is carrying. A wanting actor: The Mox's intention. Bounds: person scale | The case arrives. I1 resolves `gained`, I0 `settled`, and a [payoff](patterns/closures.json) may come later from Okoro. An errand that stays an errand |
| 2 | The theft (I2 `taken`) | The director's gate: the portent (`shadow`) reached `presented` first. Then **the protagonist's response decides** | The protagonist keeps the case: I2 resolves `delivered`, with a fight on the way as its story. Rhee's failure may start a grievance against the protagonist, at Rhee's own frame's pace |
| 3 | The blame (I4 `misread`) | Okoro's telling; not the director's | If Okoro tells the truth, Sato blames The Mox directly: I6 grows, and the protagonist is out of it |
| 4 | The hunt (I5 `decided`, `warned`, `hunting`) | **The Claws**, under D-30 (S1-10): from their belief about what the protagonist did, by their own drives, with a warning first. The proactivity setting bounds whether the intention may target the protagonist at all, and how far it may go. The director's part is to make the cause legible: the protagonist is told why the Claws are angry | The Claws' drives don't reach the threshold: nothing beyond Okoro's anger and a cold reception at the market. Or the protagonist cleared their name first, the belief was revised, and the intention never starts |
| 5 | Caught (I5 `caught`) | The Claws again: no harmful act before the warning reached `presented`; a hostile clock the protagonist can see ([DIR-48](../craft/d07-direction-pacing.md)); an encounter with ways out | The intention expires: the hunt cools, and the thread parks with a closing trace |

So the price on the protagonist's head, when it comes, is real: the Claws put the word out and their people look, as a city process (D-30). It comes only from what they believe the protagonist did, only after a warning the protagonist could see, and only as far as the proactivity setting allows. It ends when the protagonist pays, clears their name or finds shelter, or when the intention runs out. Most runs never reach it: they stop at rung 0, 1 or 2.

### 1.5 What composition adds: the cross-causal layer

The theft is one occurrence filling three instances: I2 (`taken`), I4 (`wronged`) and I6 (`opened`). That is the layer. It becomes **cross-causal** when the protagonist clears their name (I4 `cleared`): the replacement cause ([SRC-05](../craft/d13-perception-curiosity.md)) points the Claws at The Mox, which revises the belief behind I5 (`cleared` forecloses `caught`) and feeds I6 (`answered`). The protagonist's attempt to get out from under the Claws starts a gang feud at the market. Neither the errand nor the feud would produce that alone, and neither pattern names the other: the matcher finds the shared occurrence.

### 1.6 The thread's skeleton, on one path

A hand-built illustration, not generated output. The path: the protagonist accepts, is followed, loses the case, learns who it was for, is warned by the Claws, and clears their name. One token per perceived occurrence, canonical ([pattern-language.md §14.1](pattern-language.md#141-the-thread-skeleton)):

- **L1:** `tension:debt › tension:coveted › turn:interception › tension:secret › turn:misattribution › shape:hunted › shape:feud`
- **L2:** `ask(K1,P) · comply(P,K1)/help · pursue(N1,P)<enables · wrong(N1,P)<enables/oppose · expose(K1,P)<reveals · threaten(G1,P)<motive · expose(P,N2)<enables/bargain · wrong(G1,G2)<because · end:resolved/cleared`

The theft is one token, `wrong(N1,P)`, though three instances read it. Sato's belief never appears on its own: the protagonist perceives it only through the warning.

The path where the protagonist refuses the offer gives `ask(K1,P) · refuse(P,K1)/refuse · end:resolved/settled-without-you`. Its first involvement is an ask to carry something and nothing develops, so R7 counts it as a declined errand.

### 1.7 What worked, and what didn't

**Worked.**
- The example decomposes into seven instances of library patterns, and every juncture has a world source.
- The escalation points are explicit, and each has a reason the world must supply.
- The Mox's hostility to the Claws gives the interception a motive the city already holds.
- Clearing the protagonist turns the hunt into a feud through a layer nobody wrote.
- Under D-30 the top rung is a city process with stated conditions, not a few staged scenes.

**Didn't, or not yet.**
1. **Most of the early junctures are nudges.** S1 has no individual goal frames (a later capability), so `wants`, `wanting` and `shadow` are filled by seeds, not by people acting on their own concerns. Each nudge rests on a recorded cause, so the thread is honest, but adaptation carries what consequence should. §13 S1-3 (seed-opened goals act through the simulation's rates) is the minimum fix.
2. **"A crime boss" has to be a real person, and S1 has none.** Groups have no leader nodes (`gang-leader` is assigned only by canon), so the recipient can't be cast as someone who leads. §13 S1-6 proposes a keyed leadership drawn from each group's members.
3. **The top rung waits on S1.** D-30 allows the Claws to hunt the protagonist, but S1 has no intention aimed at a person, let alone at the protagonist. Until S1-10 lands (with S1-6 for the lieutenant whose word starts it), the hunt can only be staged as S2 seeds.
4. **The intermediary needs its own pattern.** The first draft had Okoro fill coveted's `asked`, which the pattern doesn't allow: `asked` is the wanter's own request. The fix is I0: Okoro's reason to ask is what he owes Sato, a recorded relationship to the beneficiary.
5. **`taken` is an offer, not a refinement.** No library pattern's outcome produces the transfer of the case to Rhee, so by the refinement contract the confrontation is an obstacle seed whose leaves record it.
6. **The plan has to be a world fact.** Who knew about the delivery is only answerable if accepting the offer mints a `promise` event that S1's telling can carry (§13 S2-6, S1-5).
7. **The protagonist's "finding out" is exposure, not a belief.** The revelation pattern's `reframed` juncture (a belief revised) can't be filled for the protagonist, because the engine holds no beliefs about the protagonist's mind. The juncture is the secret's `out`, whose guarded change records an exposure when the one kept in the dark is the protagonist.
8. **Staging the follower is P8's.** Offline, the follower is text (a message, a remark); a figure seen twice in the street needs the realiser.

## 2. Two patterns layered over Kabuki

### 2.1 The world

From S1's Kabuki ([S1 §3.2](../spec/simulation.md#32-the-kabuki-slice-and-the-fixture-slices), [§5.2](../spec/simulation.md#52-the-ten-city-kinds-m3-data), [§7.5](../spec/simulation.md#75-ordernorms), [§7.8](../spec/simulation.md#78-groupdecide)):
- **The market** is a set of venue cells whose stallholders are `vendor` residents.
- **The Friday fee** is a norm: private support 0.35, behaviour 0.875, perceived support 0.85, so its gap is `wide`. Stallholders pay because they think everyone else thinks they should.
- **Shakedowns** pulse three-fold on Fridays from 10 to 16, cast with a Tyger Claws aggressor and a `vendor` or `shopkeeper` victim of any affiliation.
- **The Tyger Claws** carry `collect-fee` (a boost to shakedowns) when their treasury runs short.
- **The Mox** carry `protect-members`, driven by `care_of_members`.
- The two groups are hostile.

### 2.2 The two instances

Aiko Tan runs a noodle stall. Her affiliation class is `TheMox`: an associate who keeps out of the street side of things. Jun collects for the Claws.

| Instance | Roles | What starts it |
|---|---|---|
| A: [squeeze](patterns/tensions.json) | `?pw` Tyger Claws, `?col` Jun, `?wk` Aiko | Friday's shakedown fills `rule`. `burden` is the fee norm, which marks Aiko as a stallholder in its sector |
| B: [protection](patterns/tensions.json) | `?gd` The Mox, `?wd` Aiko, `?th` Jun | The same shakedown fills `struck`, because it fills `wrong(Jun, Aiko)`. `covers` is Aiko's membership of The Mox |

**The shared juncture** is one S1 event: Friday's `shakedown`, Jun against Aiko. It fills `demand`, `comply`, `transfer` and `wrong` at once (its `fills` in the [vocabulary](vocabulary.json)). It starts A as `rule`, and in the same Change fills A's `paid` through `comply` (the multi-function advancement runs for a new instance too, [pattern-language.md §6.2](pattern-language.md#62-handling-a-change)). It starts B as `struck`. Neither pattern mentions the other.

The event names Jun and Aiko but not the two groups. Bounded state queries ([§6.2a](pattern-language.md#62a-bounded-state-queries)) find them: A's `rule` requires `member(?col, ?pw)`, searched from Jun along his membership edge to the Claws; B's `covers` is `protect(?gd, Aiko)`, searched from Aiko along her membership of The Mox.

### 2.3 What neither would produce alone

- **A alone** is the Friday-fee card M3's raters saw repeated: Aiko pays, the squeeze endures, perhaps she asks someone for help.
- **B alone** waits for someone to hurt a Mox associate, which in Kabuki's rates is an occasional assault.
- **Layered**, Friday's collection is the moment The Mox's protection is tested, and the two instances start to drive each other:
  1. B's `answer` becomes ready: The Mox should do something for one of their own. If they do (a Mox member at the stall the next Friday morning), B resolves `held`, and B's answer becomes a **cause** of A's `refused`: with §13 S1-9, the next shakedown's failed outcome is drawn from Aiko's protection, so the Mox member's presence is among the failed shakedown's causes. A later juncture of A is filled by something B produced: the layer is cross-causal, and neither pattern has that edge.
  2. Aiko refuses in public (the market cell, more than five witnesses). If no sanction follows within a week, A resolves `defied`. A public refusal that goes unpunished is exactly the act that moves a norm in one step ([NRM-04](../craft/d15-people-networks-order.md)): with the gap wide, other stallholders may follow, which is the entry of the [uprising](patterns/shapes.json) shape.
  3. The Claws' answer to a defiance backed by The Mox is aimed at The Mox: a `retaliate` intention with The Mox as rival, which is a [feud](patterns/shapes.json)'s `opened`.
  4. If The Mox don't answer, B ends `failed`: Aiko's tie to The Mox strains, she pays, A endures, and The Mox lose standing among the stalls. A quieter story, but still one neither pattern tells alone: a protection that wasn't there when it was needed.

**The protagonist's place** is an offer at A's `strain` → `asked` edge: Aiko asks for help before Friday. Help pay (A `paid`, with the protagonist's money as the cost), broker with Jun (an offer to Jun, a [settlement](patterns/closures.json) of terms), stand at the stall when Jun comes (a second protection instance with the protagonist as guard, layered on the same Friday), or stay out (B decides it alone). Each stance feeds a different instance, so the protagonist's choice decides which of the stories above happens, not whether a story happens.

**The authored seed can join the same graph, once adapted.** R2, "The Friday Fee", as written reads only aggregate conditions (the fee norm's gap, the stalls' view of the protagonist, the market's heat) and waits for no shakedown. The proposed adaptation R2′ ([pattern-language.md §4.2](pattern-language.md#42-three-points-on-the-range)) binds its collector and stallholder from a matched shakedown, declares which of A's junctures its beats realise, and has its `paid` and `standup-scene` exits mint the payment and the refusal as events. Run with B live, the shakedown R2′ binds is B's `struck`: an authored story and a procedural one share a juncture, as D-28 asks, with R2's fixed parts untouched.

### 2.4 What worked, and what didn't

**Worked.** One S1 event filled junctures of two instances through the vocabulary alone, and the layer produced a cross-instance `enables` edge, a route into the uprising shape and a route into the feud shape that neither pattern contains. R2 can join without changing a fixed part, but only as R2′, with the event binding and world effects it lacks today.

**Didn't, against S1 as specified today.** Five gaps, each a proposed change:
1. **The Mox never feel it.** S1's group pulses read only `assault` and `gang-clash` with The Mox on the victim's side. A shakedown of an associate pulses nothing, so `care_of_members` never rises and B's `answer` never comes. §13 S1-2: pulses read the function `wrong` on a member, whatever kind filled it.
2. **Protection has no visible act.** Even when `protect-members` is active, it only lowers the assault rate. Nothing fills `help(Mox, Aiko)`, so the answer would be a nudge. §13 S1-7: every group intention produces at least one visible act kind (a presence at a member's place, filling `protect` and `help`).
3. **Nobody refuses a shakedown.** S1 occurrences are always `done`; a shakedown is always paid. `refused` has no producer. §13 S1-9: occurrences draw an outcome of `failed` or `prevented` from the victim's protection and the norm's state (S0 events already carry `outcome`), and a kind declares what a failed outcome fills: a failed shakedown fills `refuse`.
4. **A public refusal moves no norm.** S1's norm signals come only from public enforcement, which pushes compliance up. A public refusal that goes unsanctioned is the opposite signal, and nothing in S1 makes it. Without it the squeeze can never break, and the uprising shape can't form. §13 S1-8.
5. **Associates are invisible to enforcement.** The fee norm's enforcement casts targets only among adult `civilian` non-compliers, so a Mox associate is never fee-enforced. S1 already encodes "protected by The Mox", but silently: it is a rule nobody can see, not a story. The layering makes the same fact a visible test. No change proposed; it is noted so the two don't contradict each other when S1-9 lands.

Two of S1's reads that the vocabulary uses for states, `protected(node)` and `contract(id)`, are phase 2 and answer `maybe` in M3. Until they are built, `protect` is filled by membership and group intention only, and `obligate` by favours, promises, memberships and norms.

## 3. One pattern, three contexts

The [debt](patterns/tensions.json) pattern, realised in three world states. The point to test: does the same abstract pattern read as the same story recast?

### 3.1 Three realisations

| | A. A favour on credit | B. A gang member's dues | C. A promise of protection |
|---|---|---|---|
| World state | Kabuki's ripperdoc cell; a regime of high prices | The Claws' treasury low (`collect-fee` active); a member's sister keeps a stall | The Mox promised a stallholder they would see off collectors, in return for feeding their runners |
| `owed` | `obligate(teenager, ripperdoc)`: she patched him up and said "pay me when you can", a `favour` event (a market tie turning communal, [DRV-03](../craft/d01-motivation-drives.md)) | `obligate(Marco, Claws)`: membership dues | `obligate(Mox, Bea)`: a `promise` event |
| `due` | Her own supplier calls in what she owes: a debt caused by another debt | The group's treasury drive (runway under 30 days) | Bea is shaken down on Friday |
| `called` | She asks him for help, not money | An order: pay, or do a job, and the job is collecting at his sister's row | Bea goes to the Mox runner and asks them to keep their word |
| What layers on | Nothing needed; a [sacrifice](patterns/turns.json) layers on `paid` if he gives up a night's work to guard her clinic | [divided-loyalty](patterns/tensions.json) (`order` is the Dilemma: the job's target is his sister) | [protection](patterns/tensions.json), whose `answer` is the debt's `paid`; and, if no one comes, [misattribution](patterns/turns.json): Bea blames the runner, not the leadership that never decided |
| Likely outcome | `settled` → [payoff](patterns/closures.json), much later, when she treats someone he brings in | `broken` → [escalation](patterns/turns.json) inside the gang, or the [divided-loyalty](patterns/tensions.json) instance's `warned` → [betrayal](patterns/turns.json) from the gang's side | `broken` → [grievance](patterns/tensions.json) of a person against a group |

### 3.2 Their skeletons

Hand-built illustrations of one likely path each, not generated output, with one canonical token per perceived occurrence ([pattern-language.md §14.1](pattern-language.md#141-the-thread-skeleton)):

| | L1 (shape) | L2 (cascade), masked |
|---|---|---|
| A | `tension:debt › turn:sacrifice › closure:payoff` | `help(K1,N1) · ask(K1,N1)<motive · sacrifice(N1,K1)<answers · help(K1,N2)<because · end:resolved/payoff` |
| B | `tension:debt › tension:divided-loyalty › turn:betrayal` | `obligate(N1,G1) · demand(G1,N1)<motive · expose(N1,K1)<reveals · wrong(G1,N1)<because · end:resolved/warned` |
| C | `tension:debt › tension:protection › turn:misattribution › tension:grievance` | `obligate(G1,K1) · demand(N1,K1) · ask(K1,N2)<motive · blame(K1,N2)<motive · end:failed/broken` |

A's first token is `help`, not `obligate`: the favour fills both, and `help` comes first in the token order. A's sacrifice layers on the repayment rather than refining it (a sacrifice's outcome doesn't produce a `repay`).

Only the first token of L1 is shared. With R1's substitution costs (half for tokens with the same function and link, and for closing tokens with the same outcome kind; one for any other), the normalised edit distances are 0.9 (A and B), 1.0 (A and C) and 0.9 (B and C), well past the starting δ of 0.25. That shows the measure can tell these three apart; it is not evidence that a run would generate such variety, which only iteration 3 can show. Read as stories, A is about a kindness repaid, B about a man made to choose between his crew and his sister, and C about a promise a gang never meant to keep and the wrong person blamed for it.

### 3.3 What worked, and what didn't

**Worked.** The same pattern, unchanged, read three ways, and what made them different was the world: who the creditor was to the debtor, what made the debt due, and which other instances were already live on the same people. At thread level the skeletons differ; the shared pattern is visible only at L1's first token, which is the right place for a family resemblance.

**Didn't, or at risk.**
1. **The variety depends on the sources of obligation.** In M3's S1 the `obligate` fillers are favours and promises (recorded by seeds or the protagonist's acts), memberships and the fee norm; contracts and dues are phase 2. If the world produced debts from only one source, the three would converge (attack 1 in [pattern-language.md §15](pattern-language.md#15-break-it-yourself)). Context B's dues need S1's `order.members` or a pack norm for dues.
2. **The first token is always `obligate`.** A player who meets many debts learns that a debt is coming when someone does a favour (attack 12). The measure that catches it is R5, and the remedy is in what follows the first token, not in the debt pattern.
3. **The wording is the next place for repetition.** With one kit per function, all three `called` junctures would render alike ("You owe me"). Kits per function, conditioned on the world as M3's kits already condition their clauses ([kits.ts](../../../projects/xf-story-engine/reference/src/m3/kits.ts)), are needed before the structure's variety reaches the player (attack 13).
