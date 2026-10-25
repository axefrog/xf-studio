# Worked examples for the pattern language

**Status:** v0, 25 October 2026. Three examples that test the [pattern language](pattern-language.md) against the [library](README.md#the-patterns) and against S1's Kabuki ([S1](../spec/simulation.md)): the package thread, two patterns layered over Kabuki's real content, and one pattern in three contexts. Each ends with what worked and what didn't; the findings feed the design's proposed changes ([§13](pattern-language.md#13-proposed-specification-changes)).

People and situations here are invented for illustration and are not content ([D-26](../decisions.md)). Setting institutions (the Tyger Claws, The Mox, Kabuki's market) are used as S1 models them. "The protagonist" is the specs' `v` ([D-25](../decisions.md)).

## 1. The package thread

### 1.1 The example

The maintainer's example of how composition makes an errand less mundane: a fetch errand where, on the way back, someone follows the courier and takes the package; the courier then finds out it was meant for a crime boss; and now there is a price on the courier's head.

Told like that, it is one plot. In the pattern language it is five or six instances of library patterns over the same people, each with its own reasons, and most of its later beats happen only on some of the paths the protagonist can take.

### 1.2 The cast, as the world supplies it

| Role | Who | Where they come from |
|---|---|---|
| Sender | Okoro, who runs a repair stall at the Kabuki market | An S1 resident, profile role `vendor`, cast by the courier kit's role query |
| Recipient | Sato, a Tyger Claws lieutenant | **Must be a real person who leads.** S1 has no leader persons (§1.7), so today the kit casts a Claws `gang` resident and calls him a lieutenant, which the world doesn't back |
| The thing | A sealed case | Minted by the kit as a stand-in `xf:item` held by Okoro (§13 S1-4) |
| Leak | Danny, Okoro's nephew, who minds the stall at weekends | A resident in Okoro's household (S1's `household` focus) |
| Interceptor | Rhee, who sells at the next stall and runs errands for The Mox | A `vendor` resident of affiliation class `TheMox`; tied to Danny by the `market` focus |
| Courier | The protagonist | Only by accepting an offer ([D-09](../decisions.md)) |

Why Okoro sends the case at all is a juncture too, and the world can supply it: Okoro is squeezed by the Friday fee, and running a case for the lieutenant is how he pays this week. That is a [squeeze](patterns/tensions.json) instance whose `paid` juncture this errand would fill. It is optional texture here, but it is how an errand inherits a reason from the city instead of from a template.

### 1.3 The instances and their junctures

| # | Instance | Juncture | Function | What fills it | Source (§8.1) |
|---|---|---|---|---|---|
| I1 | [coveted](patterns/tensions.json) | `holds` | `hold(Okoro, case)` | The stand-in's `held-by` edge | Found (minted with the kit) |
| | | `wants` | `want(Sato, case)` | A goal frame on Sato, opened by the kit's role `goal` ([S2 §5.3](../spec/seeding.md#53-committing)) | Offer (the kit) |
| | | `asked` | `ask(Okoro, protagonist, case)` | The kit's offer; stakes named: the case, and Okoro's standing with whoever it is for; withheld: who it is for, discoverable at the drop ([S2 §2.9](../spec/seeding.md#29-offers-choices-responses-and-the-unattended-plan), L-86) | Offer |
| | | `moved` | `transfer(case, Okoro, Sato)` | Refined into I2 when the protagonist carries it | Refine |
| I2 | [interception](patterns/turns.json) | `plan` | `obligate(protagonist, Okoro)` | The `promise` event that accepting mints (§13 S2-6) | Found, once accepted |
| | | `known` | `learn(Danny, plan)` | Danny is among the promise event's witnesses (present at the stall cell, S1 `presentAt`) | Found if he was there; else constructed: "Danny took the call", if nothing the protagonist saw contradicts it |
| | | `leaked` | `learn(Rhee, plan)` | A `tell` from Danny to Rhee over the market tie (S1's telling policy, with §13 S1-5) | Wait; constructed only within latitude |
| | | `wanting` | `want(Rhee, case)` | The Mox's `retaliate` intention against the Claws (live if a Mox member was hurt recently) opens a goal frame on Rhee | Nudge, legal because a group intention serves it (§8.2) |
| | | `shadow` | `pursue(Rhee, protagonist)` | Rhee following the protagonist from the market: the **portent** | Nudge, on unobserved state |
| | | `taken` | `transfer(case, protagonist, Rhee)` | Refined into a [complication](patterns/turns.json): a confrontation staged as an obstacle with ways out (fight, outrun, talk, pay, hand it over). **Only the protagonist's response fills it** | Refine; the protagonist decides |
| I3 | [secret](patterns/tensions.json) | `hidden` | `conceal(Okoro, recipient, protagonist)` | The offer's `withheld` field | Found |
| | | `out` | `expose(·, recipient, protagonist)` | A delivery that names the recipient reaches `presented`: the drop address, Okoro's panicked call after a loss, or Danny | Wait (three routes, §9.2) |
| I4 | [misattribution](patterns/turns.json) | `wronged` | `wrong(Rhee, Sato)` | The theft, if it happened (the same filler as I2's `taken`: a layer) | Found |
| | | `misread` | `blame(Sato, protagonist, wronged)` | Sato's belief, formed from Okoro's account to him: Okoro, protecting himself, says the courier lost it or sold it (a distortion in the teller's favour, [SRC-07](../craft/d13-perception-curiosity.md)) | Wait (Okoro has his own reason to tell) |
| | | `cleared` | `expose(·, wronged, Sato)` | The protagonist brings Sato the truth: Danny's account, Rhee seen with the case, the market talk | Offer |
| I5 | [hunted](patterns/shapes.json) | `grudge` | `blame(Claws, protagonist, loss)` | Sato's belief, carried to his group (members report up, foundation §5.2) | Found from I4 |
| | | `decided` | `decide(Claws, protagonist)` | **Not an S1 intention.** No S1 process aims harm at the protagonist ([S1 §7.8](../spec/simulation.md#78-groupdecide)); the Claws' grudge is a belief that may raise offers through S2 | Offer: a demand seed with stances (pay for it, return it, clear yourself, refuse) |
| | | `hunting` | `pursue(Claws, protagonist)` | S2 seeds only: portents (a Claws member asking after the protagonist at the market, a message), then encounters with ways out | Offer, rung by rung |
| | | `paidOff`, `cleared`, `sheltered` | | Three routes to lift it: pay, clear (I4), find shelter (The Mox, ironically, or Okoro) | Offer |
| I6 | [feud](patterns/shapes.json) | `opened` | `wrong(Mox, Claws)` | The same theft, read at group level (a layer with I2 and I4) | Found |
| | | `answered` | `story(grievance, avenged)` | The Claws' retribution pulse aimed at The Mox | Wait (S1 `group.decide`) |

### 1.4 Where the director decides how far it escalates

Each rung is a point where the [escalation gate](pattern-language.md#85-the-escalation-gate) is checked. Nothing climbs unless the protagonist pulled and someone in the world wants the next step.

| Rung | Juncture | Gate | If it fails |
|---|---|---|---|
| 0 | The offer (I1 `asked`) | Ordinary sowing gates | No errand. Okoro finds someone else or pays the fee another way: [settled without you](patterns/closures.json) |
| 1 | The follower (I2 `shadow`) | Pull: the protagonist accepted and is carrying. A wanting actor: The Mox's intention. Bounds: person scale | The case arrives. I1 resolves `gained`; a [payoff](patterns/closures.json) may come later from a satisfied Okoro. An errand that stays an errand |
| 2 | The theft (I2 `taken`) | Escalation juncture: the portent (`shadow`) reached `presented` first; then **the protagonist's response decides** | The protagonist keeps the case: I2 resolves `delivered`, with a fight on the way as its story. Rhee's failure may itself start a grievance against the protagonist, at Rhee's own frame's pace |
| 3 | The blame (I4 `misread`) | Waits for Okoro's telling; not the director's | If Okoro tells the truth, Sato blames The Mox directly: I6 grows, and the protagonist is out of it |
| 4 | The hunt (I5 `decided`, `hunting`) | Pull since rung 3 (the protagonist answered the Claws' demand defiantly, or went looking for Sato); the cause shown (the protagonist was told why the Claws want them); bounds: engine-sown stake at most `block` | The protagonist ignored the demand, so there was no pull: the matter settles without them. The Claws take the loss out of Okoro, which the protagonist hears as news (I3's sender pays, [AGY-26](../craft/d09-agency-consequence.md)) |
| 5 | Caught (I5 `caught`) | Every condition again, and a hostile clock the protagonist can see ([DIR-48](../craft/d07-direction-pacing.md)) | The hunt cools after `within`, parked with a closing trace |

So "a price on your head" is the top of a ladder that most runs never reach. When it is reached, it is because the player leaned in at rungs 1, 2 and 4, and even then it is bounded: a handful of staged encounters, each with ways out, and three routes to end it.

### 1.5 What composition adds: the cross-causal layer

The theft is one event filling three instances: I2 (`taken`), I4 (`wronged`) and I6 (`opened`). That is the layer. It becomes **cross-causal** when the protagonist clears their name (I4 `cleared`): the replacement cause ([SRC-05](../craft/d13-perception-curiosity.md)) points the Claws at The Mox, which lifts I5 (`cleared` forecloses `caught`) and feeds I6 (`answered`). The protagonist's attempt to get out from under the Claws starts a gang feud at the market. Neither the errand nor the feud would produce that alone, and neither pattern names the other: the matcher finds the shared filler.

### 1.6 The thread's skeleton, on one path

The path where the protagonist accepts, loses the case, is blamed, answers the demand defiantly and then clears their name:

- **L1:** `tension:coveted › turn:interception › tension:secret › turn:misattribution › shape:hunted › shape:feud`
- **L2:** `ask(K1,P) · comply(P,K1)/help · pursue(N1,P)<enables · transfer(I1,P,N1)<enables/oppose · expose(K1,P)<reveals · blame(N2,P)<motive · demand(G1,P)<motive · refuse(P,G1)/refuse · expose(P,N2)<enables · wrong(G1,G2)<because · end:resolved/cleared`

Another path (refuses the offer) gives `ask(K1,P) · refuse(P,K1)/refuse · end:resolved/settled-without-you`: a one-juncture thread, which the errand-share measure counts.

### 1.7 What worked, and what didn't

**Worked.**
- The example decomposes into six instances of library patterns, and every juncture has a world source.
- The escalation points are explicit, and each has a reason the world must supply.
- The Mox's hostility to the Claws gives the interception a motive the city already holds.
- Clearing the protagonist turns the hunt into a feud through a layer nobody wrote.

**Didn't, or not yet.**
1. **Most of the early junctures are nudges.** S1 has no individual goal frames (a later capability), so `wants`, `wanting` and `shadow` are filled by seeds, not by people acting on their own concerns. The thread is honest (each nudge rests on a recorded cause), but its nudge share is high: adaptation carries what consequence should. §13 S1-3 (seed-opened goals act through the simulation's rates) is the minimum fix.
2. **"A crime boss" has to be a real person, and S1 has none.** Groups have no leader nodes (`gang-leader` is canon-assigned only), so the recipient can't be cast as someone who actually leads. §13 S1-6 proposes a keyed leadership drawn from each group's members.
3. **The price on the protagonist's head is bounded S2 content, not a city process.** That is right under D-09 and S1's rule that no process aims harm at the protagonist, but it makes the top of the ladder softer than the told example: a few staged encounters and messages, not a district full of hunters.
4. **The plan has to be a world fact.** Who knew about the delivery is only answerable if accepting the offer mints a `promise` event that S1's telling can carry (§13 S2-6, S1-5).
5. **The protagonist's "finding out" is exposure, not a belief.** The revelation pattern's `reframed` juncture (a belief revised) can't be filled for the protagonist, because the engine holds no beliefs about the protagonist's mind. The juncture is the [secret](patterns/tensions.json) pattern's `out`, filled when a delivery naming the recipient reaches `presented`. The vocabulary now says so for `learn` and `expose`.
6. **Staging the follower is P8's.** Offline, the follower is text (a message, a remark); a figure seen twice in the street needs the realiser.

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

**The shared juncture** is one S1 event: Friday's `shakedown`, Jun against Aiko. It fills `demand`, `comply` and `wrong` at once (its `fills` in the [vocabulary](vocabulary.json)), so it is `rule` and `paid` in A and `struck` in B. Neither pattern mentions the other.

### 2.3 What neither would produce alone

- **A alone** is the Friday-fee card M3's raters saw repeated: Aiko pays, the squeeze endures, perhaps she asks someone for help.
- **B alone** waits for someone to hurt a Mox associate, which in Kabuki's rates is an occasional assault.
- **Layered**, Friday's collection is the moment The Mox's protection is tested, and the two instances start to drive each other:
  1. B's `answer` becomes ready: The Mox should do something for one of their own. If they do (a Mox member at the stall the next Friday morning), B resolves `held`, and B's state now **enables** A's `refused`: Aiko can refuse because she knows who stands behind her. That `enables` edge crosses instances; neither pattern has it.
  2. Aiko refuses in public (the market cell, more than five witnesses). If no sanction follows within a week, A resolves `defied`. A public refusal that goes unpunished is exactly the act that moves a norm in one step ([NRM-04](../craft/d15-people-networks-order.md)): with the gap wide, other stallholders may follow, which is the entry of the [uprising](patterns/shapes.json) shape.
  3. The Claws' answer to a defiance backed by The Mox is aimed at The Mox: a `retaliate` intention with The Mox as rival, which is a [feud](patterns/shapes.json)'s `opened`.
  4. If The Mox don't answer, B ends `failed`: Aiko's tie to The Mox strains, she pays, A endures, and The Mox lose standing among the stalls. A quieter story, but still one neither pattern tells alone: a protection that wasn't there when it was needed.

**The protagonist's place** is an offer at A's `strain` → `asked` edge: Aiko asks for help before Friday. Help pay (A `paid`, with the protagonist's money as the cost), broker with Jun (an offer to Jun, a [settlement](patterns/closures.json) of terms), stand at the stall when Jun comes (a second protection instance with the protagonist as guard, layered on the same Friday), or stay out (B decides it alone). Each stance feeds a different instance, so the protagonist's choice decides which of the stories above happens, not whether a story happens.

**The authored seed is in the same graph.** R2, "The Friday Fee", realises A's junctures with its own beats ([pattern-language.md §4.2](pattern-language.md#42-three-points-on-the-range)). Run with B live, R2's waited-for shakedown is B's `struck`: an authored story and a procedural one share a juncture, as D-28 asks, with R2's fixed parts untouched.

### 2.4 What worked, and what didn't

**Worked.** One S1 event filled junctures of two instances through the vocabulary alone, and the layer produced a cross-instance `enables` edge, a route into the uprising shape and a route into the feud shape that neither pattern contains. R2 joined without changing a fixed part.

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
| What layers on | Nothing needed; a [sacrifice](patterns/turns.json) refines `paid` if he gives up a night's work to guard her clinic | [divided-loyalty](patterns/tensions.json) (`order` is the Dilemma: the job's target is his sister) | [protection](patterns/tensions.json), whose `answer` is the debt's `paid`; and, if no one comes, [misattribution](patterns/turns.json): Bea blames the runner, not the leadership that never decided |
| Likely outcome | `settled` → [payoff](patterns/closures.json), much later, when she treats someone he brings in | `broken` → [escalation](patterns/turns.json) inside the gang, or the [divided-loyalty](patterns/tensions.json) instance's `warned` → [betrayal](patterns/turns.json) from the gang's side | `broken` → [grievance](patterns/tensions.json) of a person against a group |

### 3.2 Their skeletons

| | L1 (shape) | L2 (cascade), masked |
|---|---|---|
| A | `tension:debt › turn:sacrifice › closure:payoff` | `obligate(N1,K1) · demand(K1,N1)<motive · sacrifice(N1,K1)<answers · help(K1,N2)<because · end:resolved/payoff` |
| B | `tension:debt › tension:divided-loyalty › turn:betrayal` | `obligate(N1,G1) · demand(G1,N1,K1)<motive · expose(N1,K1)<reveals · wrong(N1,G1)<answers · end:resolved/warned` |
| C | `tension:debt › tension:protection › turn:misattribution › tension:grievance` | `obligate(G1,K1) · wrong(N1,K1) · demand(K1,G1)<motive · blame(K1,N2)<motive · end:failed/broken` |

Only the first token of L1 is shared. At L2 every masked token differs, so each pair is at normalised edit distance 1.0; even comparing functions alone, with the arguments dropped, the pairs are at 0.6, 0.8 and 0.8, well past the starting δ of 0.25. Read as stories, A is about a kindness repaid, B about a man made to choose between his crew and his sister, and C about a promise a gang never meant to keep and the wrong person blamed for it.

### 3.3 What worked, and what didn't

**Worked.** The same pattern, unchanged, read three ways, and what made them different was the world: who the creditor was to the debtor, what made the debt due, and which other instances were already live on the same people. At thread level the skeletons differ; the shared pattern is visible only at L1's first token, which is the right place for a family resemblance.

**Didn't, or at risk.**
1. **The variety depends on the sources of obligation.** In M3's S1 the `obligate` fillers are favours and promises (recorded by seeds or the protagonist's acts), memberships and the fee norm; contracts and dues are phase 2. If the world produced debts from only one source, the three would converge (attack 1 in [pattern-language.md §15](pattern-language.md#15-break-it-yourself)). Context B's dues need S1's `order.members` or a pack norm for dues.
2. **The first token is always `obligate`.** A player who meets many debts learns that a debt is coming when someone does a favour (attack 12). The measure that catches it is R5, and the remedy is in what follows the first token, not in the debt pattern.
3. **The wording is the next place for repetition.** With one kit per function, all three `called` junctures would render alike ("You owe me"). Kits per function, conditioned on the world as M3's kits already condition their clauses ([kits.ts](../../../projects/xf-story-engine/reference/src/m3/kits.ts)), are needed before the structure's variety reaches the player (attack 13).
