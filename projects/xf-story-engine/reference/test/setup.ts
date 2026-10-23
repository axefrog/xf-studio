// Preloaded by bunfig.toml: a longer default timeout for the tests that re-run the long scripts (the determinism digest, a Kabuki
// population, a simulated week). The tests themselves are unchanged.
import { setDefaultTimeout } from 'bun:test';

setDefaultTimeout(120_000);
