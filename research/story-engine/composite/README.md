# The composite

**Status:** v0, 25 October 2026 (work package [WP16](../plan.md#82-work-packages)). The multi-scale core is in place: 29 story patterns in the [pattern language](pattern-language.md), with the principles, mechanisms, failure modes and measures they connect to. The adversarial pass and the corpus test ([P1 §2.6](../p1-research-method.md#26-try-to-break-the-result)) are still to run.

The composite is the Story Engine's design knowledge as one typed graph ([P1 §5](../p1-research-method.md#5-the-composite)). Its core is a library of composable story patterns: the abstract plotlines that [D-27](../decisions.md) makes the engine's main source material, in the form [D-28](../decisions.md) asks for (patterns that adapt and compose, not whole plots replayed with new people). Around the patterns sit the principles they trace to, the mechanisms that realise them in the layers, the ways they fail and the measures that catch each failure.

## Pages and files

| File | What it holds |
|---|---|
| [pattern-language.md](pattern-language.md) | The design: what a pattern is, the abstraction range, matching, composition, fitting, legibility, cost, the mapping onto the specifications, the alternatives rejected, the proposed specification changes, the repetition measures for M3 iteration 3, and the author's own attempt to break it |
| [worked-examples.md](worked-examples.md) | The package thread decomposed; two patterns layered over Kabuki; one pattern in three contexts |
| [vocabulary.json](vocabulary.json) | The 27 juncture functions, the 7 link types, the relations, and what each of M3's event kinds fills |
| [patterns/tensions.json](patterns/tensions.json) | 9 tensions: lasting states between people and groups |
| [patterns/turns.json](patterns/turns.json) | 10 turns: moves that change a thread's direction |
| [patterns/closures.json](patterns/closures.json) | 6 closures: the forms that end or park a thread |
| [patterns/shapes.json](patterns/shapes.json) | 4 larger shapes, each a composition of the others |
| [graph.json](graph.json) | The other nodes (principle references, concepts, mechanisms, failure modes, measures) and the edges no node carries |

**One file per family**, not per pattern: a family is read and revised together (tensions open threads, turns redirect them, closures end them, shapes compose them), and 29 small files would scatter that. Every pattern has its own stable id (`xf.composite:<name>`), so a family file can be split later without changing any reference.

## The graph

**Node types** are P1 §5's, plus one:

| Type | Where | Count |
|---|---|---|
| `principle` | [graph.json](graph.json), as references: the statement lives in the dossier, and the node's label quotes it briefly. Ids are `<dossier>.<id>` (`d04.QST-01`), since two dossiers share the `AGT` prefix, or a design seed (`DS-70`) | 224 |
| `concept` | graph.json | 18 |
| `mechanism` | graph.json; each names the specification change or section that realises it | 32 |
| `failure` | graph.json | 23 |
| `measure` | graph.json | 28 |
| `pattern` | patterns/*.json (added to P1 §5's types: a pattern is a principle made operational, with context, forces and an open instance, after [FIT-37](../craft/d03-fitting-casting.md)) | 29 |

**Edge types** are P1 §5's (`requires`, `supports`, `conflicts-with`, `refines`, `instance-of`, `realised-by`, `detects`, `prevents`), plus `chains-to`, `layers-with` and `risks`. A pattern carries its own edges: `links.refines` (which patterns may fill each of its junctures: the multi-scale `refines` of P1 §5), `links.chains` and `links.layers` (typical compositions, as hints), `traces` (`realised-by` from each principle), and `risks` (to a failure node, with a note that makes the failure specific to the pattern). graph.json lists only the edges no node carries.

**P1 §5's checks, as of v0:**

| # | Check | State |
|---|---|---|
| 1 | Every principle traces back to dossiers | Met: every principle node names its dossier or design seed, and every pattern trace resolves to one |
| 2 | Every mechanism in the layer designs traces to principles | Met for the 32 mechanisms here; the layer designs' own mechanisms (P3 to P5) are not yet entered as nodes |
| 3 | Every failure mode has a measure or a preventing mechanism | Met: all 23 have at least one, most have both |
| 4 | The corpus test | Not yet run (P1 phase E, with WP12's decompositions) |
| 5 | The adversarial pass | Not yet run; [pattern-language.md §15](pattern-language.md#15-break-it-yourself) is the author's own first attempt |

## The patterns

Columns: scale (the context level an outcome turns, S2 §2.13); the number of junctures; typical chains and layers (hints: the matcher finds compositions by function, not from these lists); and refinements, which are binding: a child outcome that produces the juncture through an explicit role map ([pattern-language.md §7.4](pattern-language.md#74-refinement-a-juncture-filled-by-a-smaller-pattern)).

### Tensions

| Pattern | Scale | J | Summary | Chains to | Layers with | Refined by |
|---|---|---|---|---|---|---|
| `debt` | concern | 5 | Someone owes someone else, and the debt comes due | grievance, settlement, payoff | divided-loyalty, squeeze, ambition-vs-obligation, protection | — |
| `divided-loyalty` | concern | 8 | One membership demands what another tie forbids, and the person in the middle must answer | secret, betrayal, grievance, escalation | debt, protection, squeeze | — |
| `secret` | concern | 5 | Someone keeps something from someone it matters to, and others may come to know | revelation, betrayal, misattribution, debt | divided-loyalty, rivalry | — |
| `rivalry` | concern | 5 | Two people who are alike and near each other compete for the same thing | grievance, feud, misattribution | squeeze, ambition-vs-obligation, secret | — |
| `protection` | concern | 6 | Someone stands between another and harm, and the harm comes calling | grievance, feud, sacrifice | squeeze, debt, divided-loyalty | — |
| `ambition-vs-obligation` | concern | 7 | A chance to rise appears, and taking it breaks a duty to someone else | grievance, betrayal, test-of-creed | debt, divided-loyalty, rivalry | — |
| `coveted` | goal | 6 | Someone wants a thing that someone else holds; told as an offer, the fetch errand, one form among many | payoff, grievance, debt | rivalry, squeeze, interception | interception |
| `grievance` | concern | 5 | Someone was wronged and holds it against the one who did it | feud, settlement, escalation, hunted | misattribution, protection, rivalry | — |
| `squeeze` | concern | 7 | A power takes a cut from someone who can't easily refuse, and the burden builds | uprising, grievance, debt, protection | protection, rivalry, divided-loyalty | — |

### Turns

| Pattern | Scale | J | Summary | Chains to | Layers with | Refined by |
|---|---|---|---|---|---|---|
| `complication` | step | 4 | Something gets in the way of a goal under way: a third party's act, or plain bad luck | coveted, grievance | rivalry, interception | — |
| `reversal` | step | 5 | What was gained turns against the one who gained it | grievance, misattribution | coveted, betrayal | — |
| `revelation` | step | 5 | Someone learns a hidden fact that changes what an earlier event meant | grievance, betrayal | secret, misattribution | — |
| `escalation` | goal | 4 | An answer raises the stakes: from words to harm, or from a person to the group behind them | grievance, feud, hunted | protection, squeeze | — |
| `betrayal` | goal | 7 | Someone trusted acts against the one who trusted them, for a reason the record holds | grievance, secret, feud | divided-loyalty, heist, reversal | — |
| `sacrifice` | step | 3 | Someone bears a cost so that another's need is met | payoff, debt | protection, debt | — |
| `closing-choice` | goal | 4 | Someone can serve one of two claims but not both, and choosing closes the other | settled-without-you, grievance | divided-loyalty, rivalry | — |
| `interception` | goal | 8 | Someone learns that a thing is on the move and goes after it | grievance, misattribution, hunted | coveted, rivalry, feud | — |
| `misattribution` | goal | 4 | Someone is blamed for a wrong another did | grievance, feud, settlement | grievance, interception, revelation | — |
| `test-of-creed` | concern | 7 | A person's stand is pressed from two sides, and they hold or they turn | payoff, betrayal | squeeze, divided-loyalty, ambition-vs-obligation | — |

### Closures

| Pattern | Scale | J | Summary | Chains to | Layers with |
|---|---|---|---|---|---|
| `payoff` | goal | 3 | Something set up earlier comes back and is paid, at the size it was set up | — | debt, sacrifice, protection |
| `loss` | goal | 3 | Something that mattered is lost for good, and the loss leaves a mark | grievance, reckoning | protection, feud |
| `settlement` | goal | 4 | A dispute is settled on terms: redress is made, the tie is partly mended, and the terms bind | debt, payoff | grievance, feud, hunted |
| `loose-end` | situation | 2 | A thread stops unresolved and is set down where it can be picked up again | — | — |
| `settled-without-you` | goal | 5 | The protagonist said no, or never answered, and the world settled the matter on its own | — | closing-choice, coveted, squeeze |
| `reckoning` | goal | 4 | An act comes back on the one who did it, later, from someone who learned of it | debt, grievance | heist, squeeze |

### Larger shapes

Each is a composition: its junctures are filled by the smaller patterns in the last column. In v0 shapes are recognisers: none of their junctures is realised directly, and the director works only on the child instances, so no shape can run as a whole plot ([pattern-language.md §7.3](pattern-language.md#73-growth-small-instances-fill-a-larger-shape)).

| Shape | Scale | J | Summary | Composed of |
|---|---|---|---|---|
| `heist` | goal | 8 | A crew is hired to take something from someone who holds it; the run goes some way wrong; there is a split and an aftermath | coveted, protection, divided-loyalty, revelation, complication, interception, betrayal, payoff, debt, reckoning |
| `feud` | concern | 7 | A wrong is avenged, the vengeance is answered, and people with ties to both sides are caught between | misattribution, rivalry, grievance (twice, sides swapped), divided-loyalty, escalation, settlement, loss |
| `hunted` | concern | 8 | A group decides someone must pay, warns and puts the word out, and the hunted look for shelter or a way to lift it; under D-30 the hunters may be after the protagonist, as a city process | grievance, misattribution, escalation, protection, sacrifice, loss, settlement, revelation |
| `uprising` | standing | 6 | People squeezed alike refuse in public, others follow, and the power answers or gives way | squeeze, test-of-creed, escalation, loss, settlement |

## Rules for changing the composite

- **Write current truth.** Revise a pattern in place and raise its `version`; never keep an old copy beside it.
- **Every pattern traces to principles and names its risks.** A new failure mode gets a measure or a preventing mechanism in graph.json in the same change (P1 §5, check 3).
- **No main characters, no V lore.** Patterns cast from the simulation; the protagonist is a role filled only through offers and acts ([D-25](../decisions.md), [D-26](../decisions.md)). Adult material is an author-fill seam, never pattern content ([D-23](../decisions.md)).
- **Stable ids.** Never rename a pattern, function or node id; retire it instead.
