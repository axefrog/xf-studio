(() => {
  if (!window.__electrobunWebviewId || !location.search.includes("verify=1")) throw Error("Disposable WebView verification page required.");
  window.__trialOriginalFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === "/api/desktop/workspace?verify=1" && options?.method === "POST")
      return Promise.resolve(new Response("trial write failure", { status: 503 }));
    return window.__trialOriginalFetch(input, options);
  };
  document.querySelector("#dock-tab-presets").click();
  const add = [...document.querySelectorAll("button")].find(node => node.textContent?.trim() === "Add preset");
  add.click();
  const draft = window.xfStudioPresentation.library.summary().draft;
  return { count: draft.presets.length, selected: draft.selected, simulatedWriteFailure: true };
})()
