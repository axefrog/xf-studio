// Test preload (bunfig.toml [test] preload): runs before every test file. No test may ever press a
// key on this machine's desktop: photo.open's real key sender refuses while XFB_NO_INPUT=1, and the
// command API honours the test-only window override for keys only then. Child processes inherit it.
import { sweptDir } from "./temp-dir.ts";
process.env.XFB_NO_INPUT = "1";
// Fake-key and MCP tests must not depend on, or read, the maintainer's installed settings.
// Child processes inherit this isolated profile; the existing end-of-run sweep owns it.
process.env.LOCALAPPDATA = sweptDir("xfb-test-appdata-");
