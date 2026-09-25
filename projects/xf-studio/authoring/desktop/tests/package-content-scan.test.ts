import { expect, test } from "bun:test";
import { contentIssues, describeContentIssues, LICENCE_TEXT, SCANNED_TEXT } from "../package-content-scan";

// REL-01: the package inventory checks file names; this checks what packaged text contains.

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
