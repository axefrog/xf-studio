// Inlined into the desktop index.html as a classic script, ahead of the module
// bootstrap, so it runs even if a module fails to load or throws. If the Studio
// has not mounted within the deadline, or an uncaught error happens before it
// mounts, it replaces the "Starting…" screen with a plain explanation, Try again
// and Copy diagnostics. It never shows a blank window.
(function () {
  var DEADLINE_MS = 30000, started = Date.now(), errors = [], shown = false;
  function ready() { return !!document.querySelector("#studio.studio-ready"); }
  function note(kind, detail) { if (errors.length < 20) errors.push(kind + ": " + String(detail).slice(0, 400)); }
  function diagnostics() {
    var webgl2 = false;
    try { webgl2 = !!document.createElement("canvas").getContext("webgl2"); } catch (e) { /* No GPU. */ }
    return ["XF Studio page diagnostics", "Time since start: " + Math.round((Date.now() - started) / 1000) + " s",
      "User agent: " + navigator.userAgent, "WebGL2: " + webgl2, "Studio mounted: " + ready()].concat(errors).join("\n");
  }
  function show(reason) {
    if (shown || ready()) return;
    shown = true;
    var specific = document.querySelector(".boot-error");
    if (specific && specific.textContent) reason = specific.textContent;
    var root = document.getElementById("studio") || document.body;
    var box = document.createElement("div");
    box.className = "boot-failed";
    box.setAttribute("role", "alert");
    // Inline styles: this screen must render even if no stylesheet or module loaded.
    box.style.cssText = "display:grid;justify-items:start;gap:12px;max-width:520px;margin:15vh auto;padding:24px;" +
      "font:14px/1.5 'Segoe UI',sans-serif;text-transform:none;letter-spacing:normal;color:#f0f2f2;background:#20272f;border:1px solid #59616b";
    var title = document.createElement("strong");
    title.textContent = "XF Studio couldn't finish starting.";
    var text = document.createElement("p");
    text.textContent = reason + " Try again. If it keeps happening, copy the diagnostics and include them when you report the problem.";
    var retry = document.createElement("button");
    retry.type = "button"; retry.textContent = "Try again";
    retry.onclick = function () { location.reload(); };
    var copy = document.createElement("button");
    copy.type = "button"; copy.textContent = "Copy diagnostics";
    copy.onclick = function () {
      var value = diagnostics();
      (navigator.clipboard ? navigator.clipboard.writeText(value) : Promise.reject()).then(
        function () { copy.textContent = "Copied"; },
        function () { var area = document.createElement("textarea"); area.value = value; area.rows = 8; box.appendChild(area); area.select(); });
    };
    box.append(title, text, retry, copy);
    root.removeAttribute("aria-busy");
    root.replaceChildren(box);
  }
  window.addEventListener("error", function (event) {
    // Script errors and scripts that fail to load; optional images or models that 404 are not fatal.
    var script = event.target && event.target.tagName === "SCRIPT";
    if (!(event instanceof ErrorEvent) && !script) return;
    note("error", event.message || "Could not load " + event.target.src);
    if (!ready()) setTimeout(function () { show("Something went wrong while it was loading."); }, 1500);
  }, true);
  window.addEventListener("unhandledrejection", function (event) {
    note("unhandled", event.reason && event.reason.message || event.reason);
    if (!ready()) setTimeout(function () { show("Something went wrong while it was loading."); }, 1500);
  });
  setTimeout(function () { show("It didn't finish loading within " + DEADLINE_MS / 1000 + " seconds."); }, DEADLINE_MS);
})();
