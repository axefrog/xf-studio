# Code health ledger

The code and architecture must stay clean enough that the long roadmap (V customisation, then body, then world tools) keeps moving forward instead of looping on bug fixes. This ledger drives threshold-triggered deep reviews. Routine merge gates (tests, typechecks, [architecture boundary tests](architecture-contract.md), link check, coordinator diff read) run on every merge regardless.

## Review triggers

Run `python tools/review_due.py` after each merge into `main`. A deep review is due when **any** of these holds since the last reviewed commit below:

- **Merges:** 5 or more merged feature branches.
- **Changed lines:** 4,000 or more lines of TypeScript/Python source under `projects/` (tests and generated files excluded).
- **New subsystem:** a new top-level module family or host capability landed. Record it by hand in the table below.
- **Boundary exception:** a new exception was added to the [UI architecture boundary](ui-architecture-boundary.md).
- **Release:** a release tag is about to be created.

## How a deep review runs

- **Reviewers:** independent, read-only reviewers work in parallel by area, typically (1) domain and application core, (2) pipeline, resolver and host adapters, and (3) presentation and desktop.
- **Checks:** conformance to the architecture contract, duplication and dead code, coupling and layering, complexity hotspots, test gaps, error and cancellation handling, and whether new code extends cleanly to later domains.
- **Findings:** each is recorded below with a severity.
  - **High:** a correctness bug, a broken or bypassed boundary, a security/data-loss risk, or a design that would force rework of later features.
  - **Medium:** maintainability debt that will slow the next features.
  - **Low:** polish.

## Debt budget

Reviews never block feature work directly. Fixes run as a parallel cleanup track. **If more than 3 High findings are open, feature merges pause** until the count is back to 3 or fewer; cleanup and critical-path fixes may still merge.

## Last reviewed

| Commit | Date | Scope | Result |
|---|---|---|---|
| (none yet) | | | |

## Open findings

| ID | Severity | Area | Finding | Status |
|---|---|---|---|---|

## New subsystems since last review

- Generic character resolver (`character-resolver.ts`, `resolver-host.ts` and related), 25 September 2026.
- TypeScript Build pipeline (`package-build-service.ts`, `package-resource-builder.ts` and related), 25 September 2026.
- Built-in eye plate derivation (`eye-plate-*.ts`), 25 September 2026.
- Install/MO2 detection and framework version check, 25 September 2026.
- Input bindings, hints and cursors (`input-bindings.ts`, `studio-ui/input-hints.ts`), 25 September 2026.

## Fixed in claude/cleanup-pipeline

- **PIPE-13:** a new Authoring workflow runs `bun test`, `bun run check` and `bun run build` on Ubuntu and the desktop typecheck (Electrobun devkit) and `bun test tests` on Windows for pushes to `main` and pull requests touching the authoring source. `XFS_REQUIRE_ORACLES=1` turns oracle, game-integration and declared private-asset skips into failures for release runs.
- **PIPE-02, PIPE-16:** the independent verifier unbundles its own copy of the archive, checks every member hash, then runs its own WolvenKit serialize and texture export on those members and the plate inputs; it parses the `.archive.xl` structurally, re-hashes plate inputs at the end, and takes the morph target count from the plate recipe. The builder no longer writes the round trip or texture export.
- **PIPE-01:** the built-in plate is cut from the head the launch route loads (generic resolver plus `.xl` patches), with topology gates, provenance in the plate and package manifests, a cache key over that provenance, a named `plate_source_modded` stop and the `XFS_EYE_PLATE_HEAD=base-game` escape hatch.
