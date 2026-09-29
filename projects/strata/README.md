# XF Strata

XF Strata (Strata for short) is a standalone graph engine: every node is a stream, nothing runs without demand, and cycles are glitch-free. On that kernel it keeps an event-sourced graph of typed nodes that can reference, fork from and feed from each other to any depth, with compensating undo, time views, compaction and conflicts, and it tests itself by deterministic simulation. It imports nothing from XF Studio, which is its first user; another project can start from it. MIT licensed, like the repository.

**Status:** being built (slice G1 of the Studio's [profiles and graph design](../../research/authoring/profiles-and-graph-design.md)). The normative statement of the engine is [SPEC.md](SPEC.md), with conformance vectors in [`conformance/`](conformance/) that every implementation runs; a native implementation for the game side is planned.

This README is completed as the package lands: concepts, the public API, guarantees and the minimal example.
