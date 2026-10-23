// Preloaded by bunfig.toml: a longer default timeout for the tests that re-run the long scripts (the determinism digest, a Kabuki
// population, a simulated week). The tests themselves are unchanged.
//
// Bun 1.4 applies a default set here to the first test file only; every later file has the five seconds again. The files of test/sim,
// whose tests run worlds, set the same default themselves; elsewhere a test that can take longer than five seconds gives its own timeout.
import { setDefaultTimeout } from 'bun:test';

setDefaultTimeout(120_000);
