# Hair Lab experiment

The maintainer approved an experimental, feature-flagged Hair Lab prototype: long loosely wavy hair generated from a strand-budget volume graph, replacing the resolved hairstyle only while the lab is active. This is an approved research exception; broader hair functionality still waits for the current product to be finished and polished. It is not a requirement for 1.0.

Current state: the [approved design and model contracts](../hair/hair-lab-design.md) have a rough M2 vertical slice on V: derived clump cores, layered cards through the native hair shader and colour profile, and generated cap coverage. Five data-only styles exercise head/body contact, convergence, tip-line trimming and warm continuation. Remaining fidelity priorities are tip density, crown lift, swept-bang placement and lock separation. Coarse latency still exceeds its target; warm refined display is measured at about 0.75 s. M3 styling and build-only export remain later work. Nobody runs the game during this prototype run.

The active R&D questions are scalp derivation, head/shoulder contact, stable identity across field transport, and action-to-frame latency. Budgets and evidence grades live in the design. Reuse installed vanilla strand atlases through the existing resolver; never package extracted references. No deployment is authorised.
