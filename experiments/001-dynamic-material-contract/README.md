# Experiment 001: dynamic material contract

**Status:** superseded — it showed offline (serialization and a source-derived resolver model only, never a runtime test) that the legacy Eye Artistry 4 × 20 × 49 × 4 matrix and ArchiveXL dynamic `design+colour+finish` material references can be modelled and round-tripped, but XF Studio no longer uses that matrix: users author complete presets that export as a collection for one selector ([Experiment 005](../005-preset-collection/README.md)).

Result: passed offline. Run `check_contract.py`; inspect [result.json](result.json). The experiment creates only local generated fixtures, never modifies a reference resource and never installs a mod.

- Enumerates the legacy baseline of 4 layers × 20 designs × 49 colours × 4 finishes with unique selectors.
- Resolves the intended `design+colour+finish@makeup` syntax to 20 texture paths and 196 shared colour/finish materials.
- Rejects four malformed/unknown-name cases.
- Authors a fresh material fixture, converts JSON → CR2W `.mi` → JSON using WolvenKit 8.17.4, and verifies both dynamic resource references and their `Soft` flags remain identical.

The fixture's external resource targets are deliberately not supplied. This verifies serialization, not resource loading. The Python resolver is a small model of source-inspected ArchiveXL behavior, not a port or runtime test of the extension. Larger-palette load and runtime cache benchmarks belong to the first implementation slice.
