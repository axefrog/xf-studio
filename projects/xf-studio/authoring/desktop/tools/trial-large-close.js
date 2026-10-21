(async () => {
  if (!window.__electrobunWebviewId || !location.search.includes("verify=1")) throw Error("Disposable WebView verification page required.");
  document.querySelector("#dock-tab-presets").click();
  const button = () => [...document.querySelectorAll("button")].find(node => node.textContent?.trim() === "Add preset");
  for (let count = 0; count < 140; count++) {
    const add = button();
    if (!add) throw Error("Add preset control unavailable.");
    add.click();
  }
  // The workspace lives in the host's file: flush it there, then read it back.
  await window.xfDesktopWorkspaceFlush();
  const raw = (await (await fetch("/api/workspace?verify=1", { cache: "no-store" })).json()).workspace;
  const snapshot = window.xfStudioPresentation.library.summary().draft;
  return { native: true, count: snapshot.presets.length, selected: snapshot.selected,
    bytes: new TextEncoder().encode(raw).length, hostFlush: typeof window.xfDesktopWorkspaceFlush };
})()
