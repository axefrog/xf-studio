(async () => {
  if (!window.__electrobunWebviewId || !location.search.includes("verify=1")) throw Error("Disposable WebView verification page required.");
  document.querySelector("#dock-tab-presets").click();
  const button = () => [...document.querySelectorAll("button")].find(node => node.textContent?.trim() === "Add preset");
  for (let count = 0; count < 140; count++) {
    const add = button();
    if (!add) throw Error("Add preset control unavailable.");
    add.click();
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  const raw = localStorage.getItem("xfas.workspace.verification.v1");
  const snapshot = window.xfStudioPresentation.library.summary().draft;
  return { native: true, count: snapshot.presets.length, selected: snapshot.selected,
    bytes: new TextEncoder().encode(raw).length, hostFlush: typeof window.xfDesktopWorkspaceFlush };
})()
