// Test preload (bunfig.toml [test] preload): runs before every test file. No test may ever press a
// key on this machine's desktop: photo.open's real key sender refuses while XFB_NO_INPUT=1, and the
// command API honours the test-only window override for keys only then. Child processes inherit it.
process.env.XFB_NO_INPUT = "1";
