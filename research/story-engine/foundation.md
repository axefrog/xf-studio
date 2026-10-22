# Foundation: the dimensional model

**Status:** v0 draft, 22 October 2026. This is the anchoring theory for the whole Story Engine. Every design states how it realises this model. Every pragmatic departure goes in the [compromise ledger](#9-the-reference-model-and-the-compromise-ledger), with a trigger for revisiting it. When a compromise stops serving us, the fix is to move closer to this model, not to bolt something on beside it.

## 1. The idea

Everything the engine knows, or could know, is a **locality in a dimension**, and every locality can itself be opened into further dimensions.

- **People.** An NPC is a locality of the people dimension. Opened, that NPC is a bundle of dimensions: behaviour program, dialogue, appearance, body, name, routine, concerns, beliefs. Each of those can be opened again.
- **No atoms.** Even a settled name is a bundle. It has letters, a given and a family name, the cultures and genders it is used with, and the fact that it names a person rather than a place. "Atomic" only ever means "not opened yet".
- **Level of detail** is how far the opening has gone. Opening stops wherever nothing needs more detail.
- **Underneath, everything is relationships.** A dimension is a set of relationships of one kind; a bundle is the relationship "described by"; an address is one path through them. Nothing is absolute.
- **Level of detail is relative to a vantage point.** It is not a property of the world. It is what matters to some actor in some context right now ([§5](#5-context-and-relevance)).

The structure is the same at every scale, from the city down to the words on a bag. It is also the same for story as for the world.

## 2. Primitives

| Term | Meaning | Example |
|---|---|---|
| **Dimension** | A space of possibilities. It is defined by a rule, not by a list, so it can be huge or infinite, and only what is sampled is ever enumerated. It may have structure: unordered, ordered, metric, cyclic, a graph, or a continuous range | Every possible NPC name; Night City's geography (metric); time of day (cyclic); social ties (a graph) |
| **Locality** | A point or region of a dimension | "Kabuki"; "raining"; one particular name |
| **Bundle** | A locality opened into the dimensions that describe it | The vendor at stall 7 opened into name, appearance, routine, concerns and beliefs |
| **Identity and address** | Every locality that exists has a stable **identity**. An **address** is a path to it through bundles, one view among many: the vendor is reachable through the market, through the Tyger Claws' protection list, or through V's memory. Determinism and persistence key on identity. A locality that is not yet materialised takes its identity from the path that first generates it, and keeps it from then on, so moving the vendor never re-rolls them | `city/watson/kabuki/market/stall-7/vendor/concerns/0` |
| **Map** | A relation between dimensions that respects their structure:<br>- projection: a stall lies in Kabuki;<br>- embedding: a person's home is a place;<br>- aggregation: a district's crime comes from its streets;<br>- derivation: crime pressure from wealth, policing and gang presence.<br>Maps compose | `stall → district`, `person → home → place` |
| **Contribution** | Anything that says which localities are possible or likely: a constant, a set, a distribution, a field with falloff, diffusion over a graph, a rule, an authored constraint, or the game's own state. A contribution carries provenance, priority and scope, and contributions combine by explicit rules | Tyger Claw influence as control points with falloff; "this NPC is Takemura", pinned by an author |
| **Resolution state** | For each address, what is known:<br>- **open:** only contributions;<br>- **narrowed:** a region;<br>- **pinned:** one locality.<br>Every pin carries a reason: observed by V, committed by a seed, mirrored from the game, or fixed by an author | The vendor's name is open until V scans them; then it is pinned, as observed |

## 3. Operations

| Operation | Meaning |
|---|---|
| **Sample** | Evaluate the contributions at an address and resolve it, deterministically ([§4](#4-rules)) |
| **Query** | The inverse: find the addresses whose localities satisfy given constraints. Contributions give conservative bounds per region, so whole branches are ruled out at once ([DS-49](design-seeds.md)) |
| **Open** | Open a locality's bundle to a finer level |
| **Close** | Fold a bundle back into a summary when nothing needs it, keeping its pins |
| **Pin** | Fix an address to a locality, with a reason |
| **Forget** | Drop resolved but unpinned state. It regenerates identically from the seed and the contributions ([DS-48](design-seeds.md)) |
| **Evolve** | Time is a dimension; simulation is contributions that relate one time to the next |
| **Contribute** | Add a contribution, with provenance and priority. With Pin, this is the only kind of write |

## 4. Rules

1. **Determinism.** An unpinned address resolves as a pure function of the world seed, the address and the contributions in effect. The same inputs always give the same world.
2. **Consistency within a perspective.** Finer resolution agrees with coarser resolution, and neighbours agree where they overlap (the sheaf condition). Pins are hard constraints. This holds within the world's own state and within each actor's beliefs; different perspectives may disagree with each other and with the world ([§5.4](#54-perspectives-everyone-has-their-own-model)).
3. **Canon.** What V has observed is pinned. The base can always be regenerated, so only pins and contributions need storing.
4. **Relevance drives resolution.** Nothing is resolved until something samples it. What gets resolved, and how finely, is what the actors' open context frames need, computed as increments over what each frame's parents already established, within a budget ([§5](#5-context-and-relevance)). Detail persists only while a context needs it or a pin holds it ([DS-15](design-seeds.md)).
5. **Uniformity.** No kind of thing gets a separate model. People, places, events, beliefs, seeds and quests are all addresses in bundles.
6. **Provenance.** Every pin and contribution records where it came from, so any locality can be explained by tracing them ([DS-26](design-seeds.md)).
7. **No atoms, and pins propagate both ways.** Every locality can be opened, however settled it looks, so a pin fixes a locality only at the level where it was made.
   - **Downwards:** pinning a locality constrains everything inside it. Some parts are determined by it (a name's letter count); others stay open (how the person came by the name).
   - **Upwards:** pinning or narrowing a part narrows the whole without pinning it. Overhearing only a first name narrows the full name.

   Partial knowledge therefore needs no special case.

## 5. Context and relevance

**Context** answers "how is this relevant to what matters to this actor right now?".

- **Actors.** An actor is any locality that wants things: V, the people of the city, factions and corporations, and also the director and every seed. A seed's context is whatever it needs in order to happen.
- **Contexts.** A context is an actor's goal, intention, need, ideal or value, together with its relationships to other contexts:
  - **serves:** buying a paintbrush serves painting the wall;
  - **requires** and **blocked by:** painting the wall is blocked until there's a paintbrush;
  - **conflicts with:** two actors' goals can't both succeed;
  - **weighted by:** values decide which goals matter most.

  An actor holds many contexts at once, nested and interleaved, as goal hierarchies in agent architectures do (belief–desire–intention agents, goal-oriented planning).
- **Context unfolds from the top.** An actor's context at any moment is a chain of frames, opened top-down:
  1. its drives;
  2. the concern currently active;
  3. the goal serving it;
  4. the step under way;
  5. the situation it's in.

  Each frame is its parent plus an increment, and is predicated on everything above it. Opening a frame is the ordinary Open operation, applied along the actor's context.
- **Relevance is only ever an increment.** Nothing is computed globally. When a frame opens, only what it adds over its parent is worked out. When something new happens, the question is how much it changes what this chain has already established. The result is a small graph per actor of what matters at this juncture, cheap to read.
- **Frames carry small indexes.** Each frame keeps tiny, context-relative lookups:
  - what it wants;
  - what it would react to;
  - what blocks it;
  - what threatens it.

  The world finds who cares about an event by asking those indexes, as incremental rule matchers do, instead of scoring everything against everyone. A frame inherits its parent's indexes and adds its own, as a scope chain does, so pushing and popping frames is cheap, and a hypothetical ("what if V helps?") is a cheap fork.
- **Resolution follows relevance.** Localities resolve when an open frame needs them, within a budget. Level of detail is therefore attention:
  - V's frames usually dominate;
  - an NPC's goal (paying the rent) can call for detail of its own (their income, their landlord);
  - so can the director's search for a story window.

### 5.1 Drives: what governs relevance

The top of every chain is a set of **drives**, the kinds of thing that make anything matter to an actor. This catalogue is the key design surface. It is data, so content packs can extend it. A first draft, to be replaced by P1's motivation dossier:

| Family | Drives | Typical localities they make relevant |
|---|---|---|
| **Body** | Hunger, rest, health, pain, addiction (stims, braindances) | Food, a bed, a ripperdoc, a dealer |
| **Survival and safety** | Staying alive, avoiding harm, avoiding the police, escaping danger | Threats, exits, protectors, cover |
| **Security and resources** | Money, debt, housing, work, protection payments | Jobs, creditors, landlords, collectors, eddies |
| **Bonds** | Family, partner and romance, friends, crew or gang, belonging, obligation | The people they're tied to, and those people's troubles |
| **Standing** | Status, street cred, reputation, respect, face, fame | Witnesses, rivals, audiences, gossip |
| **Power and ambition** | Advancement, control, territory, wealth, the corporate ladder | Opportunities, obstacles, superiors, competitors |
| **Self and identity** | Freedom, body and chrome, humanity, self-expression, faith | Clinics, chrome, temples, art, choices that define them |
| **Curiosity and pleasure** | Interests and hobbies, thrills, novelty, art, fun | Places, events and people that feed them |
| **Justice and feeling** | Revenge, honour, ideals (against the corps, for the street), guilt, fear | Wrongdoers, causes, debts of honour |
| **Legacy and escape** | Leaving Night City, providing for the next generation, a mark on the world, facing mortality | Ways out, heirs, works, endings |

Every drive has a few properties:
- an **importance** per actor, which is personality and values;
- an **urgency** that changes over time (hunger rises; a debt falls due);
- a **horizon:** now, soon, or a lifetime;
- **satisfiers** and **threats**, which seed the frames' indexes;
- a **scope:** self, family, group, or the city.

Groups have drives too (a gang's territory, revenue, prestige and vendettas). So do the director (tension, variety, relevance to V) and every seed (whatever it needs in order to happen).

**Worked increment.** The vendor's top drives are family, money and safety, and their active concern is a protection payment due on Friday. While they work the stall, their frame wants customers, would react to Tyger Claws, police and calls from home, and is blocked by a shortfall.
- V walks up as a customer: the increment is small (a sale).
- If V is known for crossing the Claws, V also matches the frame's "would react to" index under the protection concern. The increment is large, and the concern surfaces as a possible hook.

Only the increment was computed.

### 5.2 Groups and membership

No actor's context stands alone. Every actor opts into higher contexts (a family, a crew, a gang, a company, a cause), and those groups' concerns become part of its own.

- **Groups are actors.** A group has drives, concerns and goals like anyone else.
  - Its **leadership** is the part that decides. The leaders' own contexts decide for the group, and they can bend it towards their personal ends.
  - Its **members** carry out its intents.
- **Membership is a relationship with properties:**
  - **role:** leader, member, associate, contractor;
  - **strength:** loyalty and commitment;
  - **visibility:** open, secret, or deniable;
  - **terms:** standing, or a contract that ends;
  - **obligations and benefits;**
  - **exit cost.**
- **Groups join groups,** and the pattern is the same at every level. A gang that takes a deniable job from Arasaka to frame Militech is, for that operation, a contractor of Arasaka. The terms are temporary, the visibility is deniable, and the two sides' interests are not the same.
- **Family is a group.** So is V's crew, and so is a fixer's roster.
- **Context inherits from every membership.** An actor's context is not one chain but a small graph: its own drives, plus the concerns of each group it belongs to, each weighted by the membership's strength. Frames therefore have several parents, and their indexes inherit from all of them.
- **Intent flows down; reports flow up.**
  - A group's intent becomes a goal assigned to its members, weighted by loyalty and fear.
  - What members see and do flows back up to the leadership.
  - Where a member's interests and the group's diverge, there's room for shirking, skimming and betrayal, as principal–agent theory predicts.

**Cross-pressure is where many stories come from.** A membership can demand something that another membership, or the actor's own values, forbids. Sociology calls this role conflict. It is also the oldest tragic shape there is: Antigone, bound to bury her brother against the law of her city.

The engine needs nothing special to find it. Take "my gang wants me to kill my brother":
1. **Detection is an index hit.** The gang's order arrives as a goal whose target sits in the member's family frame, under its protected and threatened sets.
2. **The member's options play out by weights:**
   - comply;
   - refuse;
   - fake it;
   - warn the brother;
   - betray the gang;
   - run;
   - bring in someone else.
3. **Every outcome changes memberships:** expulsion, a vendetta, a family rift, a debt. That seeds the next threads, the butterfly effect the design wants.
4. **V can be drawn in** in several ways:
   - as the one hired to do the killing, who finds out who the target is;
   - as the brother's protection;
   - as the go-between;
   - as a witness who now knows too much.

   If V is involved, the outcome stays open until V acts, then it is pinned.

V has memberships too, and they shape what is relevant to V and which hooks are offered.

### 5.3 V: observed, never owned

The engine owns the city: its people, groups and setting. It does not own the player. The player and the engine share a frame of reference, the story CD PROJEKT RED laid down, which the player accepts by playing. Beyond that baseline, V's context belongs to the player. The engine only observes it and models it. This was decided on 22 October 2026: there is no setting where the player declares V's drives.

- **The engine's model of V is a belief, not a pin.** It is one case of the general pattern in [§5.4](#54-perspectives-everyone-has-their-own-model), with confidence attached. It is built from three sources:
  - the canon story state, which is the shared baseline;
  - what V actually did, which is pinned as observed;
  - what the player engages with or ignores ([DS-09](design-seeds.md)).

  It is never assigned.
- **The engine never acts as V.** It doesn't choose for V, move V, or speak for V. The player's own choices are the only source of V's decisions.
- **Content offers; it never presumes.**
  - Hooks are situations and offers, not statements of how V feels.
  - Where content gives V a voice, it offers choices that span the stances a V could plausibly take.
  - Fitting uses the model of V only to decide what to offer and when, never to decide who V is.
- **The model stays humble.**
  - It prefers offers that hold up across the Vs it can't yet tell apart.
  - It updates as soon as play contradicts it.
  - The player never pays for a misreading.

### 5.4 Perspectives: everyone has their own model

The engine's belief about V is one case of a general pattern. Every actor keeps an internal model of the world, built only from what it has observed, been told or inferred, and that model can be wrong.

**An example.** Alice works for Arasaka. A Militech employee, Bob, bumps into her on the street, spills coffee on her and hurries off without apologising. Alice now believes Bob is a jerk. In fact he may be having the worst day of his life, and he may be someone who would give Alice the shirt off his back.

- **A belief is a pin in the believer, not in the subject.** "Bob is a jerk" is canon about Alice. Bob's actual character is whatever it is in the world, possibly still open. Both stand, and the gap between them is material.
- **Beliefs form by attribution, with human biases:**
  - people judge character from one moment and discount circumstance, which psychology calls the fundamental attribution error;
  - first impressions stick;
  - group membership colours judgement: Alice's view of a Militech employee inherits her company's rivalry ([§5.2](#52-groups-and-membership)).
- **Beliefs travel.** They are told on, distorted as they go, and add up. Reputation is what many people believe about someone, so V's street cred is the city's beliefs about V.
- **Beliefs are cheap.** A belief is a small record: who believes it, about whom, what they inferred, the evidence, and how confident they are. An interaction relevant enough to notice creates one. Unmemorable beliefs fade unless something pins them.
- **Stories come from the gap:**
  - misunderstandings and grudges;
  - dramatic irony, where V or the player knows what an NPC doesn't;
  - reveals and reconciliations.

  If Bob later becomes relevant, his side of that day is resolved consistently with what Alice saw: he did bump into her and he did hurry off. Only why is still free.
- **The layers keep perspectives too:**
  - what V has been shown is pinned as observed;
  - what the player concluded from it can only be inferred ([§5.3](#53-v-observed-never-owned));
  - authors can give characters beliefs that differ from the truth, which is how mysteries are built.

**What it means for story:**
- **Hooks come from blocked contexts.** Wherever an actor's goal is blocked and V could be the means of unblocking it, there's a potential gig. A fixer's job is someone's blocked context, brokered. The frames' indexes find these matches as they happen.
- **Drama comes from conflict.** Where contexts block or conflict with each other across actors, there's drama.
- **Relevance to V decides what surfaces.** Callbacks are contexts V once had that are still near the present ([DS-10](design-seeds.md)).
- **The player model is the engine's belief about V's context,** inferred from the shared story baseline and from what the player chooses and engages with ([§5.3](#53-v-observed-never-owned), [DS-09](design-seeds.md)).

## 6. Story in the same space

- **An event** is a locality in a bundle of time, place, participants, kind, causes and effects.
- **A quest** is a bundle of roles, beats, stakes, windows, channels and outcomes. A particular quest is a locality in the space of possible quests.
- **A seed** is a partly resolved quest: some addresses pinned, some constrained, some open, together with its contributions. It is also an actor, whose context is what it needs in order to happen.
- **Author priorities map directly** ([DS-42](design-seeds.md)):
  - *fixed* is a pin;
  - *preferred* is a weighted contribution;
  - *open* is left open for fitting.
- **The narrative operations are the model's operations:**
  - casting is query, then pin;
  - fitting is query, sample, and contributions of connecting material;
  - materialising is opening and sampling near V;
  - perception pins.
- **Beliefs** are a bundle inside a person: that person's own view of other addresses, which can differ from what is pinned ([DS-07](design-seeds.md)).

## 7. How the layers map onto it

The [four layers](plan.md#2-the-system-at-first-level) stay as ownership boundaries. The model gives them one shared data model.

| Layer | Role in the model |
|---|---|
| 1. Simulation | Owns the space and resolution (driven by relevance from active contexts), evolution, and the persistence of pins and contributions. Mirrors the game: what the game owns arrives as pins and contributions with the game as their source ([DS-34](design-seeds.md)) |
| 2. Seeding | The write gate: the only way anything outside layer 1 contributes or pins. Enforces provenance and priority, and schedules |
| 3. Procedural engine | An actor that queries and contributes: sowing on its own, fitting for authors |
| 4. Authored content | Contributions and pins, as data, in packs |
| Tooling | Explanation is tracing provenance |

## 8. Formal grounding

To be researched in P3, so the model stays honest. We implement a small toolkit, not a general prover.

- **Structure: applied category theory.**
  - Dimensions are objects and maps are morphisms.
  - Ologs are a way of writing down knowledge.
  - Sheaves capture consistency between local resolutions ([DS-51](design-seeds.md)).
- **Computation: probabilistic programming.**
  - Open addresses are random variables and contributions are factors.
  - Sampling is lazy and memoised by address, as in Church's stochastic memoisation.
  - Canon is conditioning on observations.
- **Context and relevance:**
  - agent architectures: belief–desire–intention agents, goal-oriented action planning, hierarchical task networks;
  - scripts and frames (Schank and Abelson) for top-down expectation;
  - scope chains and persistent data structures for cheap parent-plus-increment frames;
  - incremental rule matching (the Rete algorithm; incremental story sifting) for finding who cares about an event;
  - motivation research: Maslow, Reiss's basic desires, self-determination theory, Schwartz's basic values; and needs models in games such as The Sims;
  - groups: role theory and role conflict, cross-pressure from multiple memberships, social identity theory, and principal–agent theory for leaders, members and contractors;
  - perspectives: attribution theory and the fundamental attribution error, theory of mind, rumour transmission, and reputation systems;
  - Doran and Parberry's finding that game quests derive from NPC motivations.
- **Search:** constraint satisfaction, interval bounds and hierarchical spatial indexing for queries.

## 9. The reference model and the compromise ledger

**The reference model** is a small, slow, fully generic implementation of §2–§4 in TypeScript: the oracle. Every optimised or specialised implementation must agree with it on shared tests. That covers the native core ([DS-53](design-seeds.md)) and any dimension given special handling for speed. The project already works this way for native code checked against TypeScript oracles.

**The compromise ledger** records each departure from the model:
- what the model says;
- what we do instead, and why;
- when to revisit it.

| # | The model says | We do instead | Why | Revisit when |
|---|---|---|---|---|
| C-01 | Canon conditions the whole world's distribution on what V observed | Generate, then justify: construct causes consistent with the pins ([DS-29](design-seeds.md)) | Inference over the whole world is far too expensive | Constructed causes contradict each other or read as implausible |
| C-02 | A believer's view is a full perspective over every dimension | Beliefs are sparse records formed by fixed attribution rules ([kernel §11](spec/kernel.md#11-beliefs-and-perspectives)) | Full per-actor perspectives cost too much | A story needs an NPC to reason about something no rule covers |
| C-03 | Relevance follows from what matters to each actor | Fixed match weights per index type and key type ([kernel §10.4](spec/kernel.md#104-the-interest-registry-and-matching)) | Simple and cheap; tunable | Evaluation shows misplaced attention that tuning can't fix |
| C-04 | Text is a dimension like any other | Text is sampled by grammar with bounded retries under constraints ([kernel §5.1](spec/kernel.md#51-algorithm)) | Inverse cumulative distribution over all strings is impractical | Constrained text generation fails or repeats noticeably |

## 10. Worked example: one vendor

1. **Opening down to the vendor.** `city → watson → kabuki → market → stall-7` is opened as V walks in, and the stall's vendor is a locality of the people dimension. Opened, the vendor's bundle has:
   - **name:** open. Contributions: the names dimension, weighted by the district's demographics.
   - **appearance:** constrained by the game's models for the stall's archetype.
   - **routine:** pinned by the game, which places the vendor at the stall's workspot.
   - **concerns:** open. Contributions: rent pressure from the economy field, Tyger Claw protection from the influence field, and a personal history.
   - **beliefs:** open.
2. **V scans the vendor.** The scanner text samples the name and one concern, and both are pinned as observed. Had V only overheard someone call the vendor by a first name, the name would be narrowed, not pinned: the first name is fixed and the family name is still open, within whatever the first name implies ([§4](#4-rules), rule 7).
3. **V walks away.** The bundle closes. The pins persist and the rest is forgotten.
4. **V comes back a week later.**
   - The same vendor resolves with the same name and concern. The unpinned details regenerate identically, unless their contributions changed.
   - If the Tyger Claws have lost the market in the meantime, the derived concern can change.
   - That change is explainable by tracing the influence contribution, and it never contradicts the pinned concern, which is now part of the vendor's history.

**In scenario R1** ([plan §2](plan.md#2-the-system-at-first-level)), the author pins Takemura, the romance and their scenes, adds weighted contributions for the moment and district they prefer, and leaves the rest open. Fitting queries for windows and places where the pins and contributions hold, samples one, and contributes the hook.

## 11. Open questions

1. What is the smallest set of rules for combining contributions: override, blend, intersect, and what else?
2. Is time an ordinary dimension, or does evolution need a special operator?
3. The drive catalogue's first real version: which drives, how urgency evolves, how importance is assigned per actor, and how the setting's own pressures (debt, chrome, cyberpsychosis, leaving the city) enter it.
4. How are frames pruned and budgets split between V's chain and everyone else's?
5. How literal should the probabilistic semantics be (distributions) versus constraint regions?
