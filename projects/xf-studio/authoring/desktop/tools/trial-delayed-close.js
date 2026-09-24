(() => {
  if (!window.__electrobunWebviewId || !location.search.includes("verify=1")) throw Error("Disposable WebView verification page required.");
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === "/api/desktop/workspace?verify=1" && options?.method === "POST")
      return new Promise(resolve => setTimeout(() => resolve(originalFetch(input, options)), 2500));
    return originalFetch(input, options);
  };
  document.querySelector("#dock-tab-presets").click();
  const add = [...document.querySelectorAll("button")].find(node => node.textContent?.trim() === "Add preset");
  if (!add) throw Error("Add preset control unavailable.");
  add.click();
  const draft = window.xfStudioPresentation.library.summary().draft;
  return { count: draft.presets.length, selected: draft.selected, hostWriteDelayedMs: 2500 };
})()
