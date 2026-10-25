import { setDefaultTimeout } from "bun:test";

// Heavy seeded and end-to-end tests take 3–5 s alone and pass the 5 s default when the full suite shares the machine (25–26 Oct:
// profile-sessions, finish-export, collection-owner crash runs, mod-install-host). 20 s still catches a real hang.
setDefaultTimeout(20_000);
