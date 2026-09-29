# Open questions for the model review

Design decisions made while writing the catalogue, or left open, each with a recommendation. The coordinator's model review settles them; a settled question moves into the models (or the README) and leaves this list.

## Format

1. **Members the README didn't list.** The catalogue needed a few members beyond the README's table: a field spec's `doc` and `shape`, a type's `migration`, a driver's `raises`, a process's and request's `faults`, a runtime's `environment`, and an action's `name` and `input`. The README now lists them as optional. *Recommendation:* keep them; they carry what the development loop asks a model to state (migration, what a driver raises, the payload a script sends).
