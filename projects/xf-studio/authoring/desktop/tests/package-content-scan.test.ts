import { expect, test } from "bun:test";
import { contentIssues, describeContentIssues, LICENCE_TEXT, PRIVATE_DATA, SCANNED_TEXT } from "../package-content-scan";

// REL-01/REL-02: the package inventory checks file names; this checks what packaged text contains.

const bundle = "XFStudio-canary/Resources/app/views/studio/build/studio-startup.js";

test("absolute user paths are refused in every spelling a bundle can carry", () => {
  const planted = [
    String.raw`const cache = "C:\Users\jdoe\AppData\Local\xf";`,
    String.raw`const cache = "C:\\Users\\jdoe\\AppData\\Local\\xf";`,
    `const cache = "c:/Users/jdoe/AppData";`,
    String.raw`{"root":"D:\/Users\/jdoe\/game"}`,
    String.raw`throw Error("at C:\\Users\\J.Doe-2\\src\\scene.ts:12")`,
  ];
  for (const text of planted) {
    const issues = contentIssues(bundle, text);
    expect(issues.map(issue => issue.kind), text).toEqual(["user-path"]);
    // The report never repeats the name: the release log is public.
    expect(describeContentIssues(issues)[0]).not.toMatch(/jdoe|J\.Doe/i);
    expect(describeContentIssues(issues)[0]).toContain(`${bundle}:1: absolute user path`);
  }
  expect(contentIssues(bundle, "one\ntwo\nC:/Users/jdoe/x")[0]!.line).toBe(3);
});

test("the shared vectors (tools/private-data.json): every user path and address is refused once, and every clean line passes", () => {
  // The repository check (tools/check_private_paths.py --self-test) and the site's privacy test run the same vectors.
  const { userPath, email, clean } = PRIVATE_DATA.vectors;
  expect(userPath.length).toBeGreaterThan(10);
  for (const text of userPath) {
    const issues = contentIssues(bundle, text);
    expect(issues.map(issue => issue.kind), text).toEqual(["user-path"]);
    expect(describeContentIssues(issues)[0], text).not.toMatch(/jdoe/i);
  }
  for (const text of email) {
    const issues = contentIssues(bundle, text);
    expect(issues.map(issue => issue.kind), text).toEqual(["email"]);
    expect(describeContentIssues(issues)[0], text).not.toMatch(/jane|jdoe|2077fan|someone\.real/);
  }
  for (const text of clean) expect(contentIssues(bundle, text), text).toEqual([]);
});

test("lower-case, WSL, percent-encoded, escaped and POSIX paths are redacted in the report", () => {
  const report = (text: string) => describeContentIssues(contentIssues(bundle, text))[0];
  const line = `${bundle}:1: absolute user path `;
  expect(report(String.raw`c:\users\jdoe\x`)).toBe(line + String.raw`c:\users\j***`);
  expect(report("/mnt/c/Users/jdoe/Games")).toBe(line + "/mnt/c/Users/j***");
  expect(report("C%3A%5CUsers%5Cjdoe%5CAppData")).toBe(line + "C%3A%5CUsers%5Cj***");
  expect(report(String.raw`"C:\u005cUsers\u005cjdoe"`)).toBe(line + String.raw`C:\u005cUsers\u005cj***`);
  expect(report("/Users/jdoe/Library")).toBe(line + "/Users/j***");
  expect(report("/home/jdoe/.config")).toBe(line + "/home/j***");
  expect(report("Contact jane.doe@gmail.com.")).toBe(`${bundle}:1: email address j*******@gmail.com`);
  // A path two patterns can see (an encoded Windows path also reads as `/Users/…`) is one finding.
  expect(contentIssues(bundle, "C%3A%2FUsers%2Fjdoe and /mnt/c/Users/jdoe").map(issue => issue.sample))
    .toEqual(["C%3A%2FUsers%2Fj***", "/mnt/c/Users/j***"]);
});

test("placeholders, shared profiles and pattern sources pass", () => {
  for (const text of [
    String.raw`"Your library is in C:\Users\<name>\AppData\Roaming\XF Studio."`,
    String.raw`C:\Users\%USERNAME%\Documents`, String.raw`C:\Users\Public\Documents`, "C:/Users/Default/NTUSER.DAT",
    String.raw`C:\Users\${user}\x`, String.raw`C:\Users\you\Downloads`, String.raw`C:\Users\YourName\Games`,
    String.raw`/^[A-Z]:\\Users\\[^\\]+/i.test(path)`, "D:/Dev/cp2077-modding-hq", "%USERPROFILE%\\Downloads",
  ]) expect(contentIssues(bundle, text), text).toEqual([]);
});

test("email addresses are refused outside licence text; example domains and file names pass", () => {
  expect(contentIssues(bundle, `const author = "someone.real@gmail.com";`).map(issue => issue.kind)).toEqual(["email"]);
  expect(describeContentIssues(contentIssues(bundle, "mail jane.doe@company.co.uk"))[0]).toMatch(/email address j\*+@company\.co\.uk$/);
  for (const text of ["user@example.com", "a@b.test", "srcset='icon@2x.png'", "three@0.186.0", "@media (min-width: 4px)",
    "import x from \"@types/bun\"", "support@example.org"])
    expect(contentIssues(bundle, text), text).toEqual([]);
  // Licence and notice files may name authors' addresses, but never a user path.
  for (const name of ["XFStudio-canary/Resources/app/views/studio/THIRD_PARTY_NOTICES.md", "views/studio/LICENSE.txt"]) {
    expect(LICENCE_TEXT.test(name)).toBe(true);
    expect(contentIssues(name, "Copyright (c) Jane Doe <jane@company.com>")).toEqual([]);
    expect(contentIssues(name, "C:/Users/jdoe/LICENSE").map(issue => issue.kind)).toEqual(["user-path"]);
  }
});

test("scripts, markup, styles and metadata are scanned; binaries aren't", () => {
  for (const name of ["a/index.html", "a/studio.css", "a/build/raster-worker.js", "Resources/version.json", "a/LICENSE.txt", "a/NOTICES.md"])
    expect(SCANNED_TEXT.test(name), name).toBe(true);
  for (const name of ["bin/bun.exe", "bin/libNativeWrapper.dll", "webview2/MicrosoftEdgeWebview2Setup.exe", "app.tar.zst"])
    expect(SCANNED_TEXT.test(name), name).toBe(false);
});
